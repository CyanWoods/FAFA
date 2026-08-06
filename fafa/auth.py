"""User auth helpers. users.db lives at project root."""
import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

_USERNAME_RE = re.compile(r'^[A-Za-z0-9_-]{1,32}$')

from flask import session, redirect, url_for, request, g
from werkzeug.security import generate_password_hash, check_password_hash

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
        # 迁移：为旧库补 users.last_login_at 列
        cols = {r[1] for r in conn.execute('PRAGMA table_info(users)').fetchall()}
        if 'last_login_at' not in cols:
            conn.execute('ALTER TABLE users ADD COLUMN last_login_at TEXT')
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
        'SELECT id, username FROM users WHERE id = ?', (user_id,)
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
        'SELECT id, username, created_at FROM users ORDER BY id'
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_user(username: str) -> bool:
    with _db_lock:
        conn = _connect()
        cur = conn.execute(
            'DELETE FROM users WHERE username = ? COLLATE NOCASE', (username,)
        )
        conn.commit()
        conn.close()
        return cur.rowcount > 0


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


def create_api_token(user_id: int, name: str, expires_days: int | None = None) -> str:
    """生成一个授权码，只在此刻返回一次明文；库中仅存 sha256。"""
    name = (name or '').strip()
    if not name:
        raise ValueError('授权码名称不能为空')
    if len(name) > _MAX_TOKEN_NAME_LEN:
        raise ValueError(f'授权码名称不能超过 {_MAX_TOKEN_NAME_LEN} 位')
    if expires_days is not None and not (1 <= expires_days <= 3650):
        raise ValueError('有效期需在 1-3650 天之间')
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
                '''INSERT INTO api_tokens (user_id, name, token_prefix, token_hash, expires_at)
                   VALUES (?, ?, ?, ?, ?)''',
                (user_id, name, prefix, _hash_token(token), expires_at),
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
            '''SELECT t.id, t.user_id, t.token_hash, t.scopes, t.expires_at, u.username
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
        with _db_lock:
            conn.execute(
                'UPDATE api_tokens SET last_used_at = ? WHERE id = ?', (now, row['id'])
            )
            conn.commit()
        return {
            'user_id':  row['user_id'],
            'username': row['username'],
            'scopes':   row['scopes'],
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
