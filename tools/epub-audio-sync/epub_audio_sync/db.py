"""SQLite persistence layer and the two core query functions.

This module depends only on the Python standard library (``sqlite3``) so it —
and the query interface built on it — works without the heavy alignment stack
(aeneas/ebooklib) installed.

Char-offset semantics
---------------------
A ``char_offset`` is an index into a book's *canonical text*: the normalized,
newline-joined stream of sentences produced by :mod:`epub_audio_sync.epub_parser`
and fed to Aeneas. Offsets are Python string (Unicode code point) positions, not
raw EPUB bytes and not UTF-16 code units. The canonical text is stored on the
``books`` row so any offset can be resolved back to the exact substring.
"""

from __future__ import annotations

import os
import sqlite3
from typing import Iterable, Optional

from .models import SyncFragment

DEFAULT_DB_PATH = "./sync.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    epub_path TEXT NOT NULL,
    audio_path TEXT NOT NULL,
    canonical_text TEXT,
    text_sha256 TEXT,
    text_length INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    char_offset_start INTEGER NOT NULL,
    char_offset_end INTEGER NOT NULL,
    audio_start_ms INTEGER NOT NULL,
    audio_end_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_position (
    book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    char_offset INTEGER NOT NULL,
    audio_timestamp_ms INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_syncmap_book_char
    ON sync_map(book_id, char_offset_start, char_offset_end);

CREATE INDEX IF NOT EXISTS idx_syncmap_book_audio
    ON sync_map(book_id, audio_start_ms, audio_end_ms);
"""


def resolve_db_path(explicit: Optional[str] = None) -> str:
    """Resolve the database path from an explicit arg, env var, or default."""
    return explicit or os.environ.get("SYNC_DB") or DEFAULT_DB_PATH


def connect(db_path: Optional[str] = None) -> sqlite3.Connection:
    """Open a connection with foreign keys enabled and the schema ensured."""
    conn = sqlite3.connect(resolve_db_path(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    init_schema(conn)
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    """Create tables and indexes if they do not already exist (idempotent)."""
    conn.executescript(SCHEMA)
    conn.commit()


# --------------------------------------------------------------------------- #
# Book / sync-map writes
# --------------------------------------------------------------------------- #

def upsert_book(
    conn: sqlite3.Connection,
    *,
    title: str,
    epub_path: str,
    audio_path: str,
    canonical_text: str,
    text_sha256: str,
) -> int:
    """Insert or update a book keyed on its (normalized) EPUB path.

    Re-syncing the same EPUB reuses the existing row so ``sync_map`` can be
    replaced cleanly. Returns the book id.
    """
    epub_path = os.path.abspath(epub_path)
    audio_path = os.path.abspath(audio_path)
    cur = conn.execute("SELECT id FROM books WHERE epub_path = ?", (epub_path,))
    row = cur.fetchone()
    if row is not None:
        book_id = int(row["id"])
        conn.execute(
            """UPDATE books
               SET title = ?, audio_path = ?, canonical_text = ?,
                   text_sha256 = ?, text_length = ?
               WHERE id = ?""",
            (title, audio_path, canonical_text, text_sha256,
             len(canonical_text), book_id),
        )
    else:
        cur = conn.execute(
            """INSERT INTO books
               (title, epub_path, audio_path, canonical_text, text_sha256, text_length)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (title, epub_path, audio_path, canonical_text, text_sha256,
             len(canonical_text)),
        )
        book_id = int(cur.lastrowid)
    conn.commit()
    return book_id


def replace_sync_map(
    conn: sqlite3.Connection,
    book_id: int,
    fragments: Iterable[SyncFragment],
) -> int:
    """Replace all sync_map rows for a book. Returns the number inserted."""
    conn.execute("DELETE FROM sync_map WHERE book_id = ?", (book_id,))
    rows = [
        (book_id, f.char_offset_start, f.char_offset_end,
         f.audio_start_ms, f.audio_end_ms)
        for f in fragments
    ]
    conn.executemany(
        """INSERT INTO sync_map
           (book_id, char_offset_start, char_offset_end, audio_start_ms, audio_end_ms)
           VALUES (?, ?, ?, ?, ?)""",
        rows,
    )
    conn.commit()
    return len(rows)


def get_book(conn: sqlite3.Connection, book_id: int) -> Optional[sqlite3.Row]:
    return conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()


# --------------------------------------------------------------------------- #
# Core query interface
# --------------------------------------------------------------------------- #

def text_to_audio(
    conn: sqlite3.Connection, book_id: int, char_offset: int
) -> Optional[int]:
    """Map a character offset in the ebook to an audio timestamp in ms.

    Interpolates linearly within the containing fragment for sub-fragment
    precision. If the offset falls in a gap between fragments, the nearest
    fragment boundary is used. Returns ``None`` only when the book has no
    sync data at all.
    """
    row = conn.execute(
        """SELECT audio_start_ms, audio_end_ms, char_offset_start, char_offset_end
           FROM sync_map
           WHERE book_id = ? AND char_offset_start <= ? AND char_offset_end > ?
           ORDER BY char_offset_start
           LIMIT 1""",
        (book_id, char_offset, char_offset),
    ).fetchone()
    if row is not None:
        a_start, a_end, c_start, c_end = (
            row["audio_start_ms"], row["audio_end_ms"],
            row["char_offset_start"], row["char_offset_end"],
        )
        span = c_end - c_start
        if span > 0:
            frac = (char_offset - c_start) / span
            return int(round(a_start + frac * (a_end - a_start)))
        return a_start

    # Offset lands in a gap (or before/after all fragments): nearest boundary.
    before = conn.execute(
        """SELECT audio_end_ms AS ms, char_offset_end AS c
           FROM sync_map WHERE book_id = ? AND char_offset_end <= ?
           ORDER BY char_offset_end DESC LIMIT 1""",
        (book_id, char_offset),
    ).fetchone()
    after = conn.execute(
        """SELECT audio_start_ms AS ms, char_offset_start AS c
           FROM sync_map WHERE book_id = ? AND char_offset_start >= ?
           ORDER BY char_offset_start ASC LIMIT 1""",
        (book_id, char_offset),
    ).fetchone()
    return _nearest_ms(char_offset, before, after)


def audio_to_text(
    conn: sqlite3.Connection, book_id: int, timestamp_ms: int
) -> Optional[int]:
    """Map an audio timestamp (ms) to a character offset in the ebook text.

    Symmetric to :func:`text_to_audio`: interpolates within the containing
    fragment, else falls back to the nearest fragment boundary in time.
    """
    row = conn.execute(
        """SELECT char_offset_start, char_offset_end, audio_start_ms, audio_end_ms
           FROM sync_map
           WHERE book_id = ? AND audio_start_ms <= ? AND audio_end_ms > ?
           ORDER BY audio_start_ms
           LIMIT 1""",
        (book_id, timestamp_ms, timestamp_ms),
    ).fetchone()
    if row is not None:
        c_start, c_end, a_start, a_end = (
            row["char_offset_start"], row["char_offset_end"],
            row["audio_start_ms"], row["audio_end_ms"],
        )
        span = a_end - a_start
        if span > 0:
            frac = (timestamp_ms - a_start) / span
            return int(round(c_start + frac * (c_end - c_start)))
        return c_start

    before = conn.execute(
        """SELECT char_offset_end AS c, audio_end_ms AS ms
           FROM sync_map WHERE book_id = ? AND audio_end_ms <= ?
           ORDER BY audio_end_ms DESC LIMIT 1""",
        (book_id, timestamp_ms),
    ).fetchone()
    after = conn.execute(
        """SELECT char_offset_start AS c, audio_start_ms AS ms
           FROM sync_map WHERE book_id = ? AND audio_start_ms >= ?
           ORDER BY audio_start_ms ASC LIMIT 1""",
        (book_id, timestamp_ms),
    ).fetchone()
    return _nearest_c(timestamp_ms, before, after)


def _nearest_ms(char_offset, before, after) -> Optional[int]:
    """Pick the audio ms of whichever neighbouring fragment is closer by char."""
    if before is None and after is None:
        return None
    if before is None:
        return int(after["ms"])
    if after is None:
        return int(before["ms"])
    if (char_offset - before["c"]) <= (after["c"] - char_offset):
        return int(before["ms"])
    return int(after["ms"])


def _nearest_c(timestamp_ms, before, after) -> Optional[int]:
    """Pick the char offset of whichever neighbouring fragment is closer by time."""
    if before is None and after is None:
        return None
    if before is None:
        return int(after["c"])
    if after is None:
        return int(before["c"])
    if (timestamp_ms - before["ms"]) <= (after["ms"] - timestamp_ms):
        return int(before["c"])
    return int(after["c"])


# --------------------------------------------------------------------------- #
# Reading position
# --------------------------------------------------------------------------- #

def set_position(
    conn: sqlite3.Connection, book_id: int, char_offset: int, audio_timestamp_ms: int
) -> None:
    """Store the last known reading position for a book (one row per book)."""
    conn.execute(
        """INSERT INTO reading_position (book_id, char_offset, audio_timestamp_ms)
           VALUES (?, ?, ?)
           ON CONFLICT(book_id) DO UPDATE SET
               char_offset = excluded.char_offset,
               audio_timestamp_ms = excluded.audio_timestamp_ms,
               updated_at = datetime('now')""",
        (book_id, char_offset, audio_timestamp_ms),
    )
    conn.commit()


def get_position(conn: sqlite3.Connection, book_id: int) -> Optional[sqlite3.Row]:
    """Return the saved reading position row, or ``None`` if unset."""
    return conn.execute(
        "SELECT char_offset, audio_timestamp_ms, updated_at "
        "FROM reading_position WHERE book_id = ?",
        (book_id,),
    ).fetchone()
