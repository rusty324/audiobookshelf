from epub_audio_sync import db as db_module

from conftest import insert_book, insert_fragments


def test_schema_idempotent(conn):
    # connect() already created the schema; running it again must not fail.
    db_module.init_schema(conn)
    tables = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"books", "sync_map", "reading_position"} <= tables


def test_upsert_book_reuses_row_on_resync(conn):
    a = db_module.upsert_book(
        conn, title="A", epub_path="/book.epub", audio_path="/a.mp3",
        canonical_text="hello", text_sha256="x")
    b = db_module.upsert_book(
        conn, title="A2", epub_path="/book.epub", audio_path="/b.mp3",
        canonical_text="hello world", text_sha256="y")
    assert a == b
    row = db_module.get_book(conn, a)
    assert row["title"] == "A2"
    assert row["audio_path"].endswith("b.mp3")
    assert row["text_length"] == len("hello world")


def test_foreign_key_cascade_delete(conn):
    book_id = insert_book(conn)
    insert_fragments(conn, book_id, [(0, 5, 0, 500)])
    db_module.set_position(conn, book_id, 3, 300)
    conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
    conn.commit()
    assert conn.execute("SELECT COUNT(*) FROM sync_map").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM reading_position").fetchone()[0] == 0


def test_position_upsert(conn):
    book_id = insert_book(conn)
    db_module.set_position(conn, book_id, 10, 1000)
    db_module.set_position(conn, book_id, 20, 2000)
    row = db_module.get_position(conn, book_id)
    assert row["char_offset"] == 20
    assert row["audio_timestamp_ms"] == 2000
    # exactly one row per book
    assert conn.execute("SELECT COUNT(*) FROM reading_position").fetchone()[0] == 1


def test_replace_sync_map_replaces(conn):
    book_id = insert_book(conn)
    insert_fragments(conn, book_id, [(0, 5, 0, 500)])
    n = insert_fragments(conn, book_id, [(0, 5, 0, 500), (5, 10, 500, 1000)])
    assert n == 2
    assert conn.execute(
        "SELECT COUNT(*) FROM sync_map WHERE book_id=?", (book_id,)
    ).fetchone()[0] == 2
