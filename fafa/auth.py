"""User auth helpers. users.db lives at project root."""
import re
import sqlite3
import threading
from functools import wraps
from pathlib import Path

_USERNAME_RE = re.compile(r'^[A-Za-z0-9_-]{1,32}$')

from flask import session, redirect, url_for, request
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


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not _server_mode:
            return f(*args, **kwargs)
        if 'user_id' not in session:
            if request.is_json or request.path.startswith('/api/'):
                return {'error': 'unauthorized'}, 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated
