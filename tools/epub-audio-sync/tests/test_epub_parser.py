import os

from epub_audio_sync.epub_parser import (
    build_fragments,
    normalize_whitespace,
    split_sentences,
    to_iso2,
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


def test_to_iso2_mapping():
    assert to_iso2("eng") == "en"
    assert to_iso2("DEU") == "de"
    assert to_iso2("fr") == "fr"       # already 2-letter, passed through
    assert to_iso2("xyz") == "en"      # unknown -> English default
    assert to_iso2("") == "en"


def test_split_sentences_unsupported_language_falls_back():
    # pysbd has no "xx" rules; the splitter must fall back to English rules
    # instead of raising.
    sentences = split_sentences("One sentence. Another one.", language="xx")
    assert sentences == ["One sentence.", "Another one."]


def test_clip_to_ms_formats():
    assert _clip_to_ms("12.340s") == 12340
    assert _clip_to_ms("12.340") == 12340
    assert _clip_to_ms("00:00:12.340") == 12340
    assert _clip_to_ms("00:01:02.500") == 62500


def test_parse_smil_fixture():
    rows = parse_smil(os.path.join(FIXTURES, "sample.smil"))
    assert rows == [(0, 3240), (3240, 7500), (7500, 12000)]
