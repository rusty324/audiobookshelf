"""Lightweight data structures shared across the tool.

These are plain dataclasses with no I/O so they can be imported anywhere
(including in tests) without pulling in ebooklib, aeneas, or a database.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TextFragment:
    """A single sentence extracted from the EPUB.

    ``char_start`` / ``char_end`` are offsets into the *canonical text* — the
    normalized, newline-joined sentence stream that is written to Aeneas and
    stored in the database. The half-open range ``[char_start, char_end)``
    slices exactly to ``text`` within that canonical string.
    """

    index: int
    text: str
    char_start: int
    char_end: int


@dataclass
class SyncFragment:
    """A mapping between a character range and an audio time range (ms)."""

    char_offset_start: int
    char_offset_end: int
    audio_start_ms: int
    audio_end_ms: int


@dataclass(frozen=True)
class Book:
    id: int
    title: str
    epub_path: str
    audio_path: str
