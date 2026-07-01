import os

from epub_audio_sync.epub_parser import (
    build_fragments,
    normalize_whitespace,
    split_sentences,
)
from epub_audio_sync.aligner import _clip_to_ms, parse_smil

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def test_build_fragments_offset_invariant():
    sentences = ["The cat sat.", "The dog ran.", "All was well."]
    canonical, frags = build_fragments(sentences)
    assert len(frags) == 3
    # The load-bearing invariant: each fragment slices back to its own text.
    for f in frags:
        assert canonical[f.char_start:f.char_end] == f.text
    # Fragments are newline-joined.
    assert canonical == "The cat sat.\nThe dog ran.\nAll was well."
    # +1 accounting: fragment 2 starts one past fragment 1's end.
    assert frags[1].char_start == frags[0].char_end + 1


def test_build_fragments_empty():
    canonical, frags = build_fragments([])
    assert canonical == ""
    assert frags == []


def test_normalize_whitespace():
    assert normalize_whitespace("  a\n\t b   c ") == "a b c"


def test_split_sentences_basic():
    text = "Hello there. How are you? I am fine."
    sentences = split_sentences(text)
    assert len(sentences) == 3
    assert sentences[0] == "Hello there."


def test_split_then_build_roundtrip():
    text = normalize_whitespace("First sentence. Second one! Third here.")
    canonical, frags = build_fragments(split_sentences(text))
    for f in frags:
        assert canonical[f.char_start:f.char_end] == f.text


def test_clip_to_ms_formats():
    assert _clip_to_ms("12.340s") == 12340
    assert _clip_to_ms("12.340") == 12340
    assert _clip_to_ms("00:00:12.340") == 12340
    assert _clip_to_ms("00:01:02.500") == 62500


def test_parse_smil_fixture():
    rows = parse_smil(os.path.join(FIXTURES, "sample.smil"))
    assert rows == [(0, 3240), (3240, 7500), (7500, 12000)]
