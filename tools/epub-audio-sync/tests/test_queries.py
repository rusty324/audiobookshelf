from epub_audio_sync import db as db_module
from epub_audio_sync.aligner import sanitize_fragments
from epub_audio_sync.models import SyncFragment

from conftest import insert_book


def test_text_to_audio_within_fragment(seeded):
    conn, book_id = seeded
    # Start of first fragment.
    assert db_module.text_to_audio(conn, book_id, 0) == 0
    # Middle of first fragment (chars [0,10) -> ms [0,1000)), interpolated.
    assert db_module.text_to_audio(conn, book_id, 5) == 500


def test_audio_to_text_within_fragment(seeded):
    conn, book_id = seeded
    # ms 1500 is in fragment 2 (audio [1000,2000) -> chars [11,20)).
    result = db_module.audio_to_text(conn, book_id, 1500)
    assert 11 <= result < 20


def test_text_to_audio_gap_fallback(seeded):
    conn, book_id = seeded
    # char offset 10 sits in the newline gap between fragment 1 (ends 10) and
    # fragment 2 (starts 11). Nearest boundary should resolve, not None.
    result = db_module.text_to_audio(conn, book_id, 10)
    assert result is not None
    assert result in (1000,)  # end of fragment 1 == start of fragment 2 audio


def test_audio_to_text_gap_fallback(seeded):
    conn, book_id = seeded
    # ms 2200 is in the audio gap between fragment 2 (ends 2000) and fragment 3
    # (starts 2500). Closer to 2000 -> fragment 2's end char (20).
    result = db_module.audio_to_text(conn, book_id, 2200)
    assert result == 20


def test_lookup_empty_book_returns_none(conn):
    book_id = insert_book(conn)
    assert db_module.text_to_audio(conn, book_id, 5) is None
    assert db_module.audio_to_text(conn, book_id, 5) is None


def test_roundtrip_lands_in_same_fragment(seeded):
    conn, book_id = seeded
    ms = db_module.text_to_audio(conn, book_id, 5)
    back = db_module.audio_to_text(conn, book_id, ms)
    assert 0 <= back < 10


def test_sanitize_drops_negative_duration():
    rows = [SyncFragment(0, 5, 100, 50)]
    assert sanitize_fragments(rows) == []


def test_sanitize_clamps_overlap():
    rows = [
        SyncFragment(0, 5, 0, 1000),
        SyncFragment(5, 10, 800, 2000),   # overlaps previous end (1000)
    ]
    cleaned = sanitize_fragments(rows)
    assert len(cleaned) == 2
    assert cleaned[1].audio_start_ms == 1000  # clamped up to previous end


def test_sanitize_preserves_gap():
    rows = [
        SyncFragment(0, 5, 0, 1000),
        SyncFragment(5, 10, 2000, 3000),  # gap 1000->2000
    ]
    cleaned = sanitize_fragments(rows)
    assert len(cleaned) == 2
    assert cleaned[1].audio_start_ms == 2000  # gap left intact


def test_sanitize_drops_fragment_collapsed_by_clamp():
    rows = [
        SyncFragment(0, 5, 0, 1000),
        SyncFragment(5, 10, 500, 900),  # fully inside previous; clamp inverts it
    ]
    cleaned = sanitize_fragments(rows)
    assert len(cleaned) == 1
