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


def _connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or _DB_PATH
    if path is None:
        raise RuntimeError("database path is not initialized")
    conn = sqlite3.connect(str(path), timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


def _ensure_schema(db_path: Path) -> None:
    """Create tables and seed preset tags if not present. Idempotent."""
    with _connect(db_path) as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
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


def init_db(input_dir: Path) -> None:
    global _DB_PATH
    path = input_dir / "fafa.db"
    with _db_lock:
        _ensure_schema(path)
        path.chmod(0o600)
        if _DB_PATH is None:
            _DB_PATH = path


def get_activity_meta(filename: str, db_path: Path | None = None) -> dict:
    with _db_lock, _connect(db_path) as conn:
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


def save_note(filename: str, note: str, db_path: Path | None = None) -> None:
    with _db_lock, _connect(db_path) as conn:
        conn.execute(
            """INSERT INTO activity_meta (filename, note, updated_at)
               VALUES (?, ?, datetime('now'))
               ON CONFLICT(filename) DO UPDATE SET
                 note = excluded.note, updated_at = datetime('now')""",
            (filename, note),
        )


def save_tags(filename: str, tag_ids: list, db_path: Path | None = None) -> None:
    with _db_lock, _connect(db_path) as conn:
        _validate_tag_ids_conn(conn, set(tag_ids))
        conn.execute("DELETE FROM activity_tags WHERE filename = ?", (filename,))
        for tid in tag_ids:
            conn.execute(
                "INSERT OR IGNORE INTO activity_tags (filename, tag_id) VALUES (?, ?)",
                (filename, int(tid)),
            )


def _validate_tag_ids_conn(conn: sqlite3.Connection, tag_ids: set[int]) -> None:
    if not tag_ids:
        return
    placeholders = ','.join('?' for _ in tag_ids)
    rows = conn.execute(
        f"SELECT id FROM tags WHERE id IN ({placeholders})", tuple(tag_ids)
    ).fetchall()
    existing = {int(row["id"]) for row in rows}
    missing = sorted(tag_ids - existing)
    if missing:
        raise ValueError(f"unknown tag id: {missing[0]}")


def validate_tag_ids(tag_ids: set[int], db_path: Path | None = None) -> None:
    with _db_lock, _connect(db_path) as conn:
        _validate_tag_ids_conn(conn, tag_ids)


def batch_update_tags(
    filenames: list[str], add_ids: set[int], remove_ids: set[int],
    db_path: Path | None = None,
) -> int:
    unique_filenames = list(dict.fromkeys(filenames))
    if not unique_filenames:
        return 0
    with _db_lock, _connect(db_path) as conn:
        _validate_tag_ids_conn(conn, add_ids | remove_ids)
        if remove_ids:
            placeholders = ','.join('?' for _ in remove_ids)
            for filename in unique_filenames:
                conn.execute(
                    f"DELETE FROM activity_tags WHERE filename = ? AND tag_id IN ({placeholders})",
                    (filename, *remove_ids),
                )
        if add_ids:
            conn.executemany(
                "INSERT OR IGNORE INTO activity_tags (filename, tag_id) VALUES (?, ?)",
                ((filename, tag_id) for filename in unique_filenames for tag_id in add_ids),
            )
    return len(unique_filenames)


def get_all_tags(db_path: Path | None = None) -> list:
    with _db_lock, _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, name, color, is_preset FROM tags ORDER BY is_preset DESC, id"
        ).fetchall()
        return [
            {"id": r["id"], "name": r["name"], "color": r["color"], "is_preset": bool(r["is_preset"])}
            for r in rows
        ]


def create_tag(name: str, color: str, db_path: Path | None = None) -> dict:
    with _db_lock, _connect(db_path) as conn:
        try:
            cur = conn.execute(
                "INSERT INTO tags (name, color, is_preset) VALUES (?, ?, 0)", (name, color)
            )
        except sqlite3.IntegrityError:
            raise ValueError("tag name already exists")
        return {"id": cur.lastrowid, "name": name, "color": color, "is_preset": False}


def delete_tag(tag_id: int, db_path: Path | None = None) -> bool:
    with _db_lock, _connect(db_path) as conn:
        row = conn.execute("SELECT is_preset FROM tags WHERE id = ?", (tag_id,)).fetchone()
        if not row or row["is_preset"]:
            return False
        conn.execute("DELETE FROM activity_tags WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        return True


def get_all_activity_tags(db_path: Path | None = None) -> dict:
    """Return {filename: [tag dicts]} for all activities that have tags."""
    with _db_lock, _connect(db_path) as conn:
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
