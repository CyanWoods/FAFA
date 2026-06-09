"""User auth helpers. users.db lives at project root."""
import sqlite3
import threading
from functools import wraps
from pathlib import Path

from flask import session, redirect, url_for, request
from werkzeug.security import generate_password_hash, check_password_hash

USERS_DB = Path(__file__).parent.parent / 'users.db'
_db_lock = threading.Lock()


def init_db() -> None:
    with _db_lock:
        conn = sqlite3.connect(str(USERS_DB))
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                username   TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()
        conn.close()


def create_user(username: str, password: str) -> None:
    with _db_lock:
        conn = sqlite3.connect(str(USERS_DB))
        try:
            conn.execute(
                'INSERT INTO users (username, password_hash) VALUES (?, ?)',
                (username.strip(), generate_password_hash(password)),
            )
            conn.commit()
        finally:
            conn.close()


def verify_user(username: str, password: str) -> dict | None:
    conn = sqlite3.connect(str(USERS_DB))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        'SELECT * FROM users WHERE username = ? COLLATE NOCASE', (username,)
    ).fetchone()
    conn.close()
    if row and check_password_hash(row['password_hash'], password):
        return dict(row)
    return None


def get_user_by_id(user_id: int) -> dict | None:
    conn = sqlite3.connect(str(USERS_DB))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        'SELECT id, username FROM users WHERE id = ?', (user_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def list_users() -> list[dict]:
    conn = sqlite3.connect(str(USERS_DB))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        'SELECT id, username, created_at FROM users ORDER BY id'
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_user(username: str) -> bool:
    with _db_lock:
        conn = sqlite3.connect(str(USERS_DB))
        cur = conn.execute(
            'DELETE FROM users WHERE username = ? COLLATE NOCASE', (username,)
        )
        conn.commit()
        conn.close()
        return cur.rowcount > 0


def change_password(username: str, new_password: str) -> bool:
    with _db_lock:
        conn = sqlite3.connect(str(USERS_DB))
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
        if 'user_id' not in session:
            if request.is_json or request.path.startswith('/api/'):
                return {'error': 'unauthorized'}, 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated
