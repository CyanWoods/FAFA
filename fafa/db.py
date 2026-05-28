"""SQLite persistence layer for activity metadata (notes, tags)."""

import sqlite3
import threading
from pathlib import Path

_DB_PATH: Path | None = None
_db_lock = threading.Lock()

_PRESET_TAGS = [
    ("训练",   "#4a9eff", 1),
    ("比赛",   "#ff4a4a", 1),
    ("恢复",   "#2ed573", 1),
    ("通勤",   "#ffa502", 1),
    ("长距离", "#a29bfe", 1),
]


def init_db(input_dir: Path) -> None:
    global _DB_PATH
    _DB_PATH = input_dir / "fafa.db"
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS activity_meta (
                filename   TEXT PRIMARY KEY,
                note       TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS tags (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT UNIQUE NOT NULL,
                color     TEXT NOT NULL,
                is_preset INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS activity_tags (
                filename  TEXT NOT NULL,
                tag_id    INTEGER NOT NULL,
                PRIMARY KEY (filename, tag_id)
            );
        """)
        for name, color, is_preset in _PRESET_TAGS:
            conn.execute(
                "INSERT OR IGNORE INTO tags (name, color, is_preset) VALUES (?, ?, ?)",
                (name, color, is_preset),
            )


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def get_activity_meta(filename: str) -> dict:
    with _db_lock, _connect() as conn:
        row = conn.execute(
            "SELECT note FROM activity_meta WHERE filename = ?", (filename,)
        ).fetchone()
        note = row["note"] if row else None
        tags = conn.execute(
            """SELECT t.id, t.name, t.color
               FROM tags t JOIN activity_tags at ON at.tag_id = t.id
               WHERE at.filename = ?""",
            (filename,),
        ).fetchall()
        return {
            "note": note,
            "tags": [{"id": r["id"], "name": r["name"], "color": r["color"]} for r in tags],
        }


def save_note(filename: str, note: str) -> None:
    with _db_lock, _connect() as conn:
        conn.execute(
            """INSERT INTO activity_meta (filename, note, updated_at)
               VALUES (?, ?, datetime('now'))
               ON CONFLICT(filename) DO UPDATE SET
                 note = excluded.note, updated_at = datetime('now')""",
            (filename, note),
        )


def save_tags(filename: str, tag_ids: list) -> None:
    with _db_lock, _connect() as conn:
        conn.execute("DELETE FROM activity_tags WHERE filename = ?", (filename,))
        for tid in tag_ids:
            conn.execute(
                "INSERT OR IGNORE INTO activity_tags (filename, tag_id) VALUES (?, ?)",
                (filename, int(tid)),
            )


def get_all_tags() -> list:
    with _db_lock, _connect() as conn:
        rows = conn.execute(
            "SELECT id, name, color, is_preset FROM tags ORDER BY is_preset DESC, id"
        ).fetchall()
        return [
            {"id": r["id"], "name": r["name"], "color": r["color"], "is_preset": bool(r["is_preset"])}
            for r in rows
        ]


def create_tag(name: str, color: str) -> dict:
    with _db_lock, _connect() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO tags (name, color, is_preset) VALUES (?, ?, 0)", (name, color)
            )
        except sqlite3.IntegrityError:
            raise ValueError("tag name already exists")
        return {"id": cur.lastrowid, "name": name, "color": color, "is_preset": False}


def delete_tag(tag_id: int) -> bool:
    with _db_lock, _connect() as conn:
        row = conn.execute("SELECT is_preset FROM tags WHERE id = ?", (tag_id,)).fetchone()
        if not row or row["is_preset"]:
            return False
        conn.execute("DELETE FROM activity_tags WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        return True


def get_all_activity_tags() -> dict:
    """Return {filename: [tag dicts]} for all activities that have tags."""
    with _db_lock, _connect() as conn:
        rows = conn.execute(
            """SELECT at.filename, t.id, t.name, t.color
               FROM activity_tags at JOIN tags t ON t.id = at.tag_id"""
        ).fetchall()
        result: dict = {}
        for r in rows:
            result.setdefault(r["filename"], []).append(
                {"id": r["id"], "name": r["name"], "color": r["color"]}
            )
        return result
