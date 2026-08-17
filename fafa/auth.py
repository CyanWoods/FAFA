"""User auth helpers. users.db lives at project root."""
import base64
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from flask import session, redirect, url_for, request, g
from werkzeug.security import generate_password_hash, check_password_hash

from . import config_schema

_USERNAME_RE = re.compile(r'^[A-Za-z0-9_-]{1,32}$')
USERS_DB = Path(__file__).parent.parent / 'users.db'
_db_lock = threading.Lock()

_server_mode: bool = True


def set_server_mode(enabled: bool) -> None:
    global _server_mode
    _server_mode = enabled


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(USERS_DB), timeout=10)
    conn.execute('PRAGMA busy_timeout = 10000')
    return conn


# ── 配置密文加解密 ───────────────────────────────────────────────────────────
# 密钥从 FAFA_SECRET（服务器模式下已强制要求的环境变量）走 HKDF-SHA256 派生，
# 不额外要求运维再管理第二个密钥；轮换 FAFA_SECRET 会让旧密文解不开，见
# _decrypt 的降级处理。本地模式没有 FAFA_SECRET，用固定字符串派生——本地模式
# 单机单用户，config 与 users.db 同机同权限，这层加密不为对抗本地攻击者，只
# 是让存取路径在两种模式下保持一致，不必为"要不要加密"写分支。
_LOCAL_MODE_KEY_MATERIAL = b'fafa-local-mode-fixed-key-not-secret'


def _fernet() -> Fernet:
    secret = os.environ.get('FAFA_SECRET', '').encode('utf-8') or _LOCAL_MODE_KEY_MATERIAL
    key = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None,
        info=b'fafa-config-encryption-v1',
    ).derive(secret)
    return Fernet(base64.urlsafe_b64encode(key))


def _encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode('utf-8')).decode('ascii')


def _decrypt(cipher: str) -> str:
    try:
        return _fernet().decrypt(cipher.encode('ascii')).decode('utf-8')
    except InvalidToken:
        # FAFA_SECRET 被更换过，旧密文解不开；返回空串而不是抛异常炸掉整个
        # config 读取——该字段在前端显示为未配置，等同"需要重新填写"。
        return ''


def init_db() -> None:
    with _db_lock:
        conn = _connect()
        conn.execute('PRAGMA journal_mode = WAL')
        conn.execute('PRAGMA synchronous = NORMAL')
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                username   TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS login_attempts (
                rate_key TEXT PRIMARY KEY,
                fail_count INTEGER NOT NULL DEFAULT 0,
                lockout_until REAL NOT NULL DEFAULT 0,
                updated_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS api_tokens (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER NOT NULL,
                name         TEXT NOT NULL,
                token_prefix TEXT NOT NULL,
                token_hash   TEXT NOT NULL,
                scopes       TEXT NOT NULL DEFAULT 'read',
                created_at   TEXT DEFAULT (datetime('now')),
                last_used_at TEXT,
                expires_at   TEXT,
                revoked      INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute(
            'CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens(token_prefix)'
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_config (
                user_id    INTEGER NOT NULL,
                key        TEXT NOT NULL,
                value      TEXT,
                is_secret  INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, key)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_files (
                user_id    INTEGER NOT NULL,
                filename   TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                mtime_ns   INTEGER NOT NULL DEFAULT 0,
                indexed_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, filename)
            )
        """)
        # 迁移：为旧库补新增列（users.last_login_at 早期迁移 + 本次新增的身份/资料字段）
        cols = {r[1] for r in conn.execute('PRAGMA table_info(users)').fetchall()}
        if 'last_login_at' not in cols:
            conn.execute('ALTER TABLE users ADD COLUMN last_login_at TEXT')
        if 'is_admin' not in cols:
            conn.execute('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0')
        if 'is_frozen' not in cols:
            conn.execute('ALTER TABLE users ADD COLUMN is_frozen INTEGER NOT NULL DEFAULT 0')
        if 'display_name' not in cols:
            conn.execute('ALTER TABLE users ADD COLUMN display_name TEXT')
        if 'avatar_blob' not in cols:
            conn.execute('ALTER TABLE users ADD COLUMN avatar_blob BLOB')
        if 'avatar_mime' not in cols:
            conn.execute('ALTER TABLE users ADD COLUMN avatar_mime TEXT')
        if 'avatar_updated_at' not in cols:
            conn.execute('ALTER TABLE users ADD COLUMN avatar_updated_at TEXT')
        conn.commit()
        conn.close()
        USERS_DB.chmod(0o600)


_MIN_PASSWORD_LEN = 8
_MAX_PASSWORD_LEN = 1024
_DUMMY_PASSWORD_HASH = generate_password_hash("fafa-invalid-user-password")


def create_user(username: str, password: str) -> None:
    username = username.strip()
    if not _USERNAME_RE.match(username):
        raise ValueError("用户名只能包含字母、数字、_ 和 -，长度 1-32 位")
    if len(password) < _MIN_PASSWORD_LEN:
        raise ValueError(f"密码长度不能少于 {_MIN_PASSWORD_LEN} 位")
    if len(password) > _MAX_PASSWORD_LEN:
        raise ValueError(f"密码长度不能超过 {_MAX_PASSWORD_LEN} 位")
    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                'INSERT INTO users (username, password_hash) VALUES (?, ?)',
                (username, generate_password_hash(password)),
            )
            conn.commit()
        finally:
            conn.close()


def verify_user(username: str, password: str) -> dict | None:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        'SELECT * FROM users WHERE username = ? COLLATE NOCASE', (username,)
    ).fetchone()
    conn.close()
    password_hash = row['password_hash'] if row else _DUMMY_PASSWORD_HASH
    valid = check_password_hash(password_hash, password)
    if row and valid:
        return dict(row)
    return None


def get_user_by_id(user_id: int) -> dict | None:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        'SELECT id, username, is_admin, is_frozen, display_name FROM users WHERE id = ?',
        (user_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def login_allowed(rate_key: str) -> bool:
    import time
    now = time.time()
    with _db_lock, _connect() as conn:
        row = conn.execute(
            'SELECT lockout_until FROM login_attempts WHERE rate_key = ?', (rate_key,)
        ).fetchone()
        return not row or now >= float(row[0])


def record_login_failure(rate_key: str, max_fails: int = 5, base_lockout_s: int = 30) -> None:
    import time
    now = time.time()
    with _db_lock, _connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute(
            'SELECT fail_count FROM login_attempts WHERE rate_key = ?', (rate_key,)
        ).fetchone()
        fails = (int(row[0]) if row else 0) + 1
        lockout = 0
        if fails >= max_fails:
            lockout = now + base_lockout_s * (2 ** min(fails - max_fails, 4))
        conn.execute(
            '''INSERT INTO login_attempts(rate_key, fail_count, lockout_until, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(rate_key) DO UPDATE SET
                 fail_count=excluded.fail_count,
                 lockout_until=excluded.lockout_until,
                 updated_at=excluded.updated_at''',
            (rate_key, fails, lockout, now),
        )
        conn.execute('DELETE FROM login_attempts WHERE updated_at < ?', (now - 86400 * 7,))


def clear_login_failures(rate_key: str) -> None:
    with _db_lock, _connect() as conn:
        conn.execute('DELETE FROM login_attempts WHERE rate_key = ?', (rate_key,))


def list_users() -> list[dict]:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        '''SELECT id, username, created_at, last_login_at, is_admin, is_frozen, display_name
           FROM users ORDER BY id'''
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_user(username: str) -> bool:
    """删除账号本身（users/api_tokens/user_config/user_files 行）；
    input/<username>/ 目录下的 fit 文件不动，留在磁盘上可人工找回。"""
    with _db_lock:
        conn = _connect()
        try:
            row = conn.execute(
                'SELECT id FROM users WHERE username = ? COLLATE NOCASE', (username,)
            ).fetchone()
            if not row:
                return False
            uid = row[0]
            conn.execute('DELETE FROM api_tokens WHERE user_id = ?', (uid,))
            conn.execute('DELETE FROM user_config WHERE user_id = ?', (uid,))
            conn.execute('DELETE FROM user_files WHERE user_id = ?', (uid,))
            cur = conn.execute('DELETE FROM users WHERE id = ?', (uid,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()


def set_admin(user_id: int, is_admin: bool) -> bool:
    with _db_lock:
        conn = _connect()
        cur = conn.execute(
            'UPDATE users SET is_admin = ? WHERE id = ?', (1 if is_admin else 0, user_id)
        )
        conn.commit()
        conn.close()
        return cur.rowcount > 0


def set_frozen(user_id: int, is_frozen: bool) -> bool:
    with _db_lock:
        conn = _connect()
        cur = conn.execute(
            'UPDATE users SET is_frozen = ? WHERE id = ?', (1 if is_frozen else 0, user_id)
        )
        conn.commit()
        conn.close()
        return cur.rowcount > 0


def set_display_name(user_id: int, name: str) -> bool:
    name = (name or '').strip()
    with _db_lock:
        conn = _connect()
        cur = conn.execute(
            'UPDATE users SET display_name = ? WHERE id = ?', (name or None, user_id)
        )
        conn.commit()
        conn.close()
        return cur.rowcount > 0


def admin_count() -> int:
    conn = _connect()
    n = conn.execute('SELECT COUNT(*) FROM users WHERE is_admin = 1').fetchone()[0]
    conn.close()
    return n


# ── 头像 ─────────────────────────────────────────────────────────────────────
def get_avatar(user_id: int) -> tuple[bytes, str, str] | None:
    """返回 (blob, mime, updated_at)；无头像时 None。"""
    conn = _connect()
    row = conn.execute(
        'SELECT avatar_blob, avatar_mime, avatar_updated_at FROM users WHERE id = ?',
        (user_id,),
    ).fetchone()
    conn.close()
    if not row or row[0] is None:
        return None
    return (row[0], row[1], row[2])


def set_avatar(user_id: int, blob: bytes, mime: str) -> None:
    with _db_lock:
        conn = _connect()
        conn.execute(
            '''UPDATE users SET avatar_blob = ?, avatar_mime = ?,
               avatar_updated_at = datetime('now') WHERE id = ?''',
            (blob, mime, user_id),
        )
        conn.commit()
        conn.close()


def change_password(username: str, new_password: str) -> bool:
    if len(new_password) < _MIN_PASSWORD_LEN:
        raise ValueError(f"密码长度不能少于 {_MIN_PASSWORD_LEN} 位")
    if len(new_password) > _MAX_PASSWORD_LEN:
        raise ValueError(f"密码长度不能超过 {_MAX_PASSWORD_LEN} 位")
    with _db_lock:
        conn = _connect()
        cur = conn.execute(
            'UPDATE users SET password_hash = ? WHERE username = ? COLLATE NOCASE',
            (generate_password_hash(new_password), username),
        )
        conn.commit()
        conn.close()
        return cur.rowcount > 0


def update_last_login(user_id: int) -> None:
    with _db_lock:
        conn = _connect()
        conn.execute(
            "UPDATE users SET last_login_at = datetime('now') WHERE id = ?", (user_id,)
        )
        conn.commit()
        conn.close()


# ── 授权码 / API token ─────────────────────────────────────────────────────────
_TOKEN_PREFIX = 'fafa'
_MAX_TOKENS_PER_USER = 20
_MAX_TOKEN_NAME_LEN = 64


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


_API_SCOPES = ('read', 'read_write')


def create_api_token(user_id: int, name: str, expires_days: int | None = None,
                      scope: str = 'read') -> str:
    """生成一个授权码，只在此刻返回一次明文；库中仅存 sha256。

    scope='read'（默认）只能访问 /api/v1 的只读接口；'read_write' 额外解锁
    上传/删除 fit 文件、触发同步等写操作。旧库里已发出的授权码 scopes 列
    默认值就是 'read'，不会因为这个参数的加入而被动提权。
    """
    name = (name or '').strip()
    if not name:
        raise ValueError('授权码名称不能为空')
    if len(name) > _MAX_TOKEN_NAME_LEN:
        raise ValueError(f'授权码名称不能超过 {_MAX_TOKEN_NAME_LEN} 位')
    if expires_days is not None and not (1 <= expires_days <= 3650):
        raise ValueError('有效期需在 1-3650 天之间')
    if scope not in _API_SCOPES:
        raise ValueError('授权范围只能是 read 或 read_write')
    prefix = secrets.token_hex(6)           # 12 位十六进制，无下划线，便于解析定位
    secret = secrets.token_urlsafe(32)
    token = f'{_TOKEN_PREFIX}_{prefix}_{secret}'
    expires_at = None
    if expires_days is not None:
        expires_at = (datetime.now(timezone.utc) + timedelta(days=expires_days)) \
            .strftime('%Y-%m-%d %H:%M:%S')
    with _db_lock:
        conn = _connect()
        try:
            count = conn.execute(
                'SELECT COUNT(*) FROM api_tokens WHERE user_id = ? AND revoked = 0',
                (user_id,),
            ).fetchone()[0]
            if count >= _MAX_TOKENS_PER_USER:
                raise ValueError(f'每个账号最多 {_MAX_TOKENS_PER_USER} 个有效授权码')
            conn.execute(
                '''INSERT INTO api_tokens (user_id, name, token_prefix, token_hash, expires_at, scopes)
                   VALUES (?, ?, ?, ?, ?, ?)''',
                (user_id, name, prefix, _hash_token(token), expires_at, scope),
            )
            conn.commit()
        finally:
            conn.close()
    return token


def verify_api_token(token: str) -> dict | None:
    """校验授权码，命中返回 {user_id, username, scopes}，并惰性更新 last_used_at。"""
    if not isinstance(token, str) or not token.startswith(_TOKEN_PREFIX + '_'):
        return None
    parts = token.split('_', 2)
    if len(parts) != 3 or not parts[1]:
        return None
    prefix = parts[1]
    token_hash = _hash_token(token)
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    conn = _connect()
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            '''SELECT t.id, t.user_id, t.token_hash, t.scopes, t.expires_at,
                      u.username, u.is_admin, u.is_frozen, u.display_name
               FROM api_tokens t JOIN users u ON u.id = t.user_id
               WHERE t.token_prefix = ? AND t.revoked = 0''',
            (prefix,),
        ).fetchone()
        if not row:
            return None
        if not hmac.compare_digest(token_hash, row['token_hash']):
            return None
        if row['expires_at'] and now >= row['expires_at']:
            return None
        if row['is_frozen']:
            # 冻结用户的 token 立即失效，不用等它过期或被单独撤销
            return None
        with _db_lock:
            conn.execute(
                'UPDATE api_tokens SET last_used_at = ? WHERE id = ?', (now, row['id'])
            )
            conn.commit()
        return {
            'user_id':      row['user_id'],
            'username':     row['username'],
            'scopes':       row['scopes'],
            'is_admin':     bool(row['is_admin']),
            'display_name': row['display_name'],
        }
    finally:
        conn.close()


def list_api_tokens(user_id: int) -> list[dict]:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        '''SELECT id, name, token_prefix, scopes, created_at, last_used_at,
                  expires_at, revoked
           FROM api_tokens WHERE user_id = ? ORDER BY id DESC''',
        (user_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def revoke_api_token(user_id: int, token_id: int) -> bool:
    with _db_lock:
        conn = _connect()
        cur = conn.execute(
            'UPDATE api_tokens SET revoked = 1 WHERE id = ? AND user_id = ? AND revoked = 0',
            (token_id, user_id),
        )
        conn.commit()
        conn.close()
        return cur.rowcount > 0


# ── 每用户配置（原 config.json，现存 user_config 表）────────────────────────────
# key-value 存储而非固定宽表：配置项这几年一直在增（wind_source/map_tile 是后
# 加的），固定列每加一个设置就要 ALTER TABLE。类型信息（哪些是数字/要加密）
# 由 fafa/config_schema.py 集中定义，这里和 app.py 的字段校验共用同一份，不
# 会因为各存一份定义而跑偏。

def _cast_config_value(key: str, raw: str):
    if key in config_schema.NUMBER_KEYS:
        try:
            num = float(raw)
        except (TypeError, ValueError):
            return raw
        return int(num) if key in config_schema.INT_KEYS else num
    return raw


def get_user_config(user_id: int) -> dict:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        'SELECT key, value, is_secret FROM user_config WHERE user_id = ?', (user_id,)
    ).fetchall()
    conn.close()
    out = {}
    for row in rows:
        value = row['value']
        if row['is_secret'] and value:
            value = _decrypt(value)
        out[row['key']] = _cast_config_value(row['key'], value) if value is not None else value
    return out


def get_user_config_values(user_id: int, keys: list[str]) -> dict:
    if not keys:
        return {}
    conn = _connect()
    conn.row_factory = sqlite3.Row
    placeholders = ','.join('?' * len(keys))
    # placeholders is synthesized entirely from '?' tokens; values stay bound parameters.
    rows = conn.execute(
        f'SELECT key, value, is_secret FROM user_config WHERE user_id = ? AND key IN ({placeholders})',  # nosec B608
        (user_id, *keys),
    ).fetchall()
    conn.close()
    out = {}
    for row in rows:
        value = row['value']
        if row['is_secret'] and value:
            value = _decrypt(value)
        out[row['key']] = _cast_config_value(row['key'], value) if value is not None else value
    return out


def set_user_config_values(user_id: int, updates: dict) -> None:
    if not updates:
        return
    with _db_lock:
        conn = _connect()
        try:
            for key, value in updates.items():
                is_secret = key in config_schema.SECRET_KEYS
                text = '' if value is None else str(value)
                if is_secret and text:
                    text = _encrypt(text)
                conn.execute(
                    '''INSERT INTO user_config (user_id, key, value, is_secret, updated_at)
                       VALUES (?, ?, ?, ?, datetime('now'))
                       ON CONFLICT(user_id, key) DO UPDATE SET
                         value=excluded.value, is_secret=excluded.is_secret,
                         updated_at=excluded.updated_at''',
                    (user_id, key, text, 1 if is_secret else 0),
                )
            conn.commit()
        finally:
            conn.close()


def migrate_config_from_file(user_id: int, config_path: Path) -> bool:
    """一次性把旧 config.json 的内容搬进 user_config 表。调用方负责在成功后把
    源文件改名（本函数只管数据库这一侧，职责单一，不做文件系统改名）。"""
    import json
    if config_path.is_symlink():
        return False
    try:
        with open(config_path, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return False
    data.pop('_comment', None)
    data.pop('_comments', None)
    if not data:
        return False
    set_user_config_values(user_id, data)
    return True


def archive_config_file(config_path: Path) -> Path:
    """把已迁移的明文配置原子归档为不覆盖旧文件的 `.bak[.N]`。

    hard-link 使用 O_EXCL 语义：并发迁移或已有备份时不会覆盖任何历史文件；
    链接成功后再删源路径，任一步失败都至少保留一份完整明文配置供人工恢复。
    """
    if config_path.is_symlink():
        raise OSError('refusing to archive a symlinked config file')
    index = 0
    while True:
        suffix = '.bak' if index == 0 else f'.bak.{index}'
        backup = config_path.with_name(config_path.name + suffix)
        try:
            os.link(config_path, backup)
        except FileExistsError:
            index += 1
            continue
        try:
            os.chmod(backup, 0o600)
            config_path.unlink()
        except OSError:
            # 源文件仍在，备份也完整存在；向调用方报告失败，由运维人工检查。
            raise
        return backup


# ── fit 文件索引（磁盘仍是最终真相，这是读时协调的缓存）─────────────────────────
def upsert_user_file(user_id: int, filename: str, size_bytes: int, mtime_ns: int) -> None:
    with _db_lock:
        conn = _connect()
        conn.execute(
            '''INSERT INTO user_files (user_id, filename, size_bytes, mtime_ns, indexed_at)
               VALUES (?, ?, ?, ?, datetime('now'))
               ON CONFLICT(user_id, filename) DO UPDATE SET
                 size_bytes=excluded.size_bytes, mtime_ns=excluded.mtime_ns,
                 indexed_at=excluded.indexed_at''',
            (user_id, filename, size_bytes, mtime_ns),
        )
        conn.commit()
        conn.close()


def remove_user_file(user_id: int, filename: str) -> None:
    with _db_lock:
        conn = _connect()
        conn.execute(
            'DELETE FROM user_files WHERE user_id = ? AND filename = ?', (user_id, filename)
        )
        conn.commit()
        conn.close()


def bulk_reindex_user_files(user_id: int, files: list[tuple]) -> None:
    """files: [(filename, size_bytes, mtime_ns), ...]，一次性把该用户的索引
    行同步成这批——扫盘结果是权威来源，这里只是把它落进表里供管理员看板用。"""
    with _db_lock:
        conn = _connect()
        try:
            names = [f[0] for f in files]
            if names:
                placeholders = ','.join('?' * len(names))
                # placeholders is synthesized entirely from '?' tokens; values stay bound.
                conn.execute(
                    f'DELETE FROM user_files WHERE user_id = ? AND filename NOT IN ({placeholders})',  # nosec B608
                    (user_id, *names),
                )
            else:
                conn.execute('DELETE FROM user_files WHERE user_id = ?', (user_id,))
            for filename, size_bytes, mtime_ns in files:
                conn.execute(
                    '''INSERT INTO user_files (user_id, filename, size_bytes, mtime_ns, indexed_at)
                       VALUES (?, ?, ?, ?, datetime('now'))
                       ON CONFLICT(user_id, filename) DO UPDATE SET
                         size_bytes=excluded.size_bytes, mtime_ns=excluded.mtime_ns,
                         indexed_at=excluded.indexed_at''',
                    (user_id, filename, size_bytes, mtime_ns),
                )
            conn.commit()
        finally:
            conn.close()


def admin_storage_summary() -> list[dict]:
    """按用户聚合的文件数/总字节数，供管理员看板用；一条 SQL 出结果，不用挨
    个用户扫目录树。"""
    conn = _connect()
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        '''SELECT user_id, COUNT(*) AS file_count, COALESCE(SUM(size_bytes), 0) AS total_bytes
           FROM user_files GROUP BY user_id'''
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not _server_mode:
            return f(*args, **kwargs)
        # g.user_id 由 _load_user 依据 session 或 Bearer 授权码填充
        if not getattr(g, 'user_id', None):
            if request.is_json or request.path.startswith('/api/'):
                return {'error': 'unauthorized'}, 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    """管理员专用路由的门禁。只认会话登录，不认 Bearer 授权码——哪怕该 token
    是 read_write 且属主是管理员：API 授权码代表"操作我自己的账号数据"，不
    代表"以管理员身份操作全站"，这是两个权限维度，混一起是提权隐患。管理员
    操作必须在浏览器里、会话登录后完成。本地模式无角色概念，直接放行（单
    用户隐含管理员）。"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not _server_mode:
            return f(*args, **kwargs)
        if not getattr(g, 'user_id', None):
            return {'error': 'unauthorized'}, 401
        if getattr(g, 'api_scopes', None) is not None:
            return {'error': '管理员操作不支持通过授权码调用，请在浏览器中登录后操作'}, 403
        if not getattr(g, 'is_admin', False):
            return {'error': 'forbidden'}, 403
        return f(*args, **kwargs)
    return decorated
