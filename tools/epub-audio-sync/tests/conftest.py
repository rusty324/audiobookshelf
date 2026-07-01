import os
import sqlite3
import sys

import pytest

# Make the package importable when running pytest from this directory.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from epub_audio_sync import db as db_module  # noqa: E402
from epub_audio_sync.models import SyncFragment  # noqa: E402


@pytest.fixture
def conn(tmp_path):
    """A fresh SQLite connection backed by a temp-file database."""
    c = db_module.connect(str(tmp_path / "test.db"))
    yield c
    c.close()


def insert_book(conn, title="Test", epub="/x.epub", audio="/x.mp3",
                canonical_text="", sha="0" * 64):
    return db_module.upsert_book(
        conn, title=title, epub_path=epub, audio_path=audio,
        canonical_text=canonical_text, text_sha256=sha,
    )


def insert_fragments(conn, book_id, triples):
    """triples: list of (char_start, char_end, audio_start_ms, audio_end_ms)."""
    frags = [SyncFragment(*t) for t in triples]
    return db_module.replace_sync_map(conn, book_id, frags)


@pytest.fixture
def seeded(conn):
    """A book with three fragments containing a char gap and an audio gap.

        chars [0,10)   audio [0,1000)
        chars [11,20)  audio [1000,2000)   # char gap 10->11 (newline)
        chars [21,30)  audio [2500,3500)   # audio gap 2000->2500
    """
    book_id = insert_book(conn)
    insert_fragments(conn, book_id, [
        (0, 10, 0, 1000),
        (11, 20, 1000, 2000),
        (21, 30, 2500, 3500),
    ])
    return conn, book_id
