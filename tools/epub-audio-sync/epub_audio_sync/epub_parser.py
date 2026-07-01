"""Extract sentence fragments from an EPUB with exact character offsets.

The load-bearing invariant of the whole tool lives here: the *canonical text*
returned by :func:`build_fragments` must satisfy, for every fragment ``f``::

    canonical_text[f.char_start:f.char_end] == f.text

That canonical text is exactly what we write to Aeneas (one sentence per line)
and what we persist in the database, so the character offsets stored in
``sync_map`` are meaningful against it.
"""

from __future__ import annotations

import hashlib
import logging
import re
from typing import List, Tuple

from .models import TextFragment

log = logging.getLogger(__name__)

# Fallback sentence splitter used only when pysbd is unavailable. Splits after
# sentence-ending punctuation when followed by whitespace and a likely start of
# a new sentence. Deliberately conservative; pysbd is strongly preferred.
_FALLBACK_SENT_RE = re.compile(r'(?<=[.!?])\s+(?=[\"\'\(\[]?[A-Z0-9])')
_WHITESPACE_RE = re.compile(r"\s+")


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalize_whitespace(text: str) -> str:
    """Collapse all whitespace runs to single spaces and strip the ends.

    Applied before offset computation so offsets match the exact text handed to
    Aeneas.
    """
    return _WHITESPACE_RE.sub(" ", text).strip()


def split_sentences(text: str) -> List[str]:
    """Split normalized text into sentences.

    Uses :mod:`pysbd` when available (handles abbreviations, decimals, quotes),
    falling back to a simple regex so core parsing still works without it.
    """
    text = text.strip()
    if not text:
        return []
    try:
        import pysbd  # type: ignore

        seg = pysbd.Segmenter(language="en", clean=False)
        sentences = [s.strip() for s in seg.segment(text)]
    except Exception:  # pragma: no cover - exercised only without pysbd
        log.warning(
            "pysbd unavailable or failed; falling back to regex sentence splitter"
        )
        sentences = [s.strip() for s in _FALLBACK_SENT_RE.split(text)]
    return [s for s in sentences if s]


def build_fragments(sentences: List[str]) -> Tuple[str, List[TextFragment]]:
    """Turn an ordered list of sentences into fragments + canonical text.

    Fragments are joined with ``"\\n"`` (one per line, as Aeneas expects for
    ``is_text_type=plain``); the ``+1`` per fragment in the running cursor
    accounts for that separator so the slice invariant holds exactly.
    """
    fragments: List[TextFragment] = []
    parts: List[str] = []
    cursor = 0
    for sentence in sentences:
        # Fragments must be single-line for Aeneas plain text; normalization
        # already removed newlines, but guard anyway.
        sentence = sentence.replace("\n", " ")
        start = cursor
        end = start + len(sentence)
        fragments.append(
            TextFragment(index=len(fragments), text=sentence,
                         char_start=start, char_end=end)
        )
        parts.append(sentence)
        cursor = end + 1  # +1 for the "\n" join separator
    canonical_text = "\n".join(parts)
    return canonical_text, fragments


def _iter_documents_in_spine_order(book):
    """Yield EPUB document items in reading (spine) order.

    Falls back to natural item order if the spine is empty or unresolved.
    """
    import ebooklib

    docs = list(book.get_items_of_type(ebooklib.ITEM_DOCUMENT))
    items_by_id = {it.get_id(): it for it in docs}
    ordered = []
    for entry in getattr(book, "spine", []) or []:
        idref = entry[0] if isinstance(entry, (list, tuple)) else entry
        item = items_by_id.get(idref)
        if item is not None:
            ordered.append(item)
    return ordered or docs


def extract_text(book) -> str:
    """Concatenate normalized document text across the spine into one string."""
    from bs4 import BeautifulSoup

    chunks: List[str] = []
    for item in _iter_documents_in_spine_order(book):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        for tag in soup(["script", "style"]):
            tag.decompose()
        text = normalize_whitespace(soup.get_text(separator=" "))
        if text:
            chunks.append(text)
    return normalize_whitespace(" ".join(chunks))


def get_title(book, epub_path: str) -> str:
    """Best-effort title from EPUB metadata, falling back to the file stem."""
    import os

    try:
        meta = book.get_metadata("DC", "title")
        if meta and meta[0] and meta[0][0]:
            return str(meta[0][0]).strip()
    except Exception:
        pass
    return os.path.splitext(os.path.basename(epub_path))[0]


def parse_epub(epub_path: str) -> Tuple[str, List[TextFragment], str]:
    """Parse an EPUB into ``(title, fragments, canonical_text)``.

    Requires ``ebooklib`` and ``beautifulsoup4`` (core dependencies).
    """
    from ebooklib import epub

    book = epub.read_epub(epub_path)
    title = get_title(book, epub_path)
    full_text = extract_text(book)
    sentences = split_sentences(full_text)
    canonical_text, fragments = build_fragments(sentences)
    log.info("Parsed %d sentence fragments from %s", len(fragments), epub_path)
    return title, fragments, canonical_text
