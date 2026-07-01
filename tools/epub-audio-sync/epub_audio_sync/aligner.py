"""Forced alignment via Aeneas and mapping into the SQLite schema.

Aeneas (``aeneas.executetask.ExecuteTask``) is imported lazily inside
:func:`align` so that the rest of the tool — the query interface, position
commands, and the test suite — runs without the heavy native alignment stack
(aeneas/numpy/espeak/ffmpeg) installed.

Timings are read directly from Aeneas' in-memory sync map for precision; a
stdlib SMIL parser is kept as a fallback and is unit-tested independently. Only
the derived numeric ranges are stored — raw SMIL is never persisted.
"""

from __future__ import annotations

import logging
import os
import tempfile
import xml.etree.ElementTree as ET
from typing import List, Optional

from .models import SyncFragment, TextFragment

log = logging.getLogger(__name__)


def _time_value_to_ms(value) -> int:
    """Convert an Aeneas ``TimeValue`` (Decimal seconds) to integer ms."""
    return int(round(float(value) * 1000))


def _clip_to_ms(clip: Optional[str]) -> int:
    """Parse a SMIL clip value into milliseconds.

    Handles bare seconds ("12.340"), the "s" suffix ("12.340s"), and clock
    format ("00:00:12.340").
    """
    if clip is None:
        raise ValueError("missing clip value")
    clip = clip.strip()
    if clip.endswith("s") and ":" not in clip:
        clip = clip[:-1]
    if ":" in clip:
        parts = [float(p) for p in clip.split(":")]
        seconds = 0.0
        for p in parts:
            seconds = seconds * 60 + p
        return int(round(seconds * 1000))
    return int(round(float(clip) * 1000))


def parse_smil(smil_path: str) -> List[tuple]:
    """Parse an Aeneas SMIL file into ordered ``(begin_ms, end_ms)`` tuples.

    Namespace-agnostic (matches local tag names) to survive the SMIL / EPUB
    media-overlay namespaces Aeneas emits. Used as a fallback when the
    in-memory sync map is unavailable, and exercised directly in tests.
    """
    tree = ET.parse(smil_path)
    result: List[tuple] = []
    for elem in tree.iter():
        if elem.tag.rsplit("}", 1)[-1] != "par":
            continue
        audio = next(
            (c for c in elem.iter() if c.tag.rsplit("}", 1)[-1] == "audio"),
            None,
        )
        if audio is None:
            continue
        result.append(
            (_clip_to_ms(audio.get("clipBegin")), _clip_to_ms(audio.get("clipEnd")))
        )
    return result


def _read_in_memory(task) -> Optional[List[tuple]]:
    """Read ``(begin_ms, end_ms)`` from Aeneas' in-memory sync map, or None."""
    try:
        from aeneas.syncmap import SyncMapFragment
    except Exception:  # pragma: no cover
        SyncMapFragment = None

    leaves = None
    try:
        if SyncMapFragment is not None and hasattr(task, "sync_map_leaves"):
            leaves = task.sync_map_leaves(SyncMapFragment.REGULAR)
    except Exception:  # pragma: no cover
        leaves = None
    if not leaves:
        try:
            leaves = [
                leaf for leaf in (task.sync_map_leaves() or [])
                if getattr(leaf, "is_regular", True)
            ]
        except Exception:  # pragma: no cover
            return None
    if not leaves:
        return None
    return [(_time_value_to_ms(l.begin), _time_value_to_ms(l.end)) for l in leaves]


def _zip_to_fragments(
    text_fragments: List[TextFragment], timings: List[tuple]
) -> List[SyncFragment]:
    """Join text fragments to their aligned timings positionally."""
    if len(timings) != len(text_fragments):
        log.warning(
            "Alignment produced %d timings for %d text fragments; "
            "zipping to the shorter length",
            len(timings), len(text_fragments),
        )
    rows: List[SyncFragment] = []
    for tf, (begin_ms, end_ms) in zip(text_fragments, timings):
        rows.append(
            SyncFragment(
                char_offset_start=tf.char_start,
                char_offset_end=tf.char_end,
                audio_start_ms=begin_ms,
                audio_end_ms=end_ms,
            )
        )
    return rows


def sanitize_fragments(rows: List[SyncFragment]) -> List[SyncFragment]:
    """Repair gaps / overlaps from alignment. Logs warnings, never raises.

    - end < start (zero/negative duration): dropped with a warning.
    - overlap (start < previous end): start clamped up to previous end; if that
      inverts the fragment it is dropped.
    - gap (start > previous end): preserved; queries bridge gaps via nearest
      fragment fallback. Logged at DEBUG since gaps are normal (silence).
    """
    ordered = sorted(rows, key=lambda r: (r.audio_start_ms, r.audio_end_ms))
    cleaned: List[SyncFragment] = []
    prev: Optional[SyncFragment] = None
    for r in ordered:
        if r.audio_end_ms < r.audio_start_ms:
            log.warning(
                "Fragment chars [%d,%d) has end < start (%d < %d); dropping",
                r.char_offset_start, r.char_offset_end,
                r.audio_end_ms, r.audio_start_ms,
            )
            continue
        if prev is not None:
            if r.audio_start_ms < prev.audio_end_ms:
                overlap = prev.audio_end_ms - r.audio_start_ms
                log.warning(
                    "Overlap of %d ms (start %d < previous end %d); clamping",
                    overlap, r.audio_start_ms, prev.audio_end_ms,
                )
                r.audio_start_ms = prev.audio_end_ms
                if r.audio_end_ms < r.audio_start_ms:
                    log.warning(
                        "Fragment chars [%d,%d) collapsed after clamp; dropping",
                        r.char_offset_start, r.char_offset_end,
                    )
                    continue
            elif r.audio_start_ms > prev.audio_end_ms:
                log.debug(
                    "Gap of %d ms between fragments (audio %d -> %d)",
                    r.audio_start_ms - prev.audio_end_ms,
                    prev.audio_end_ms, r.audio_start_ms,
                )
        cleaned.append(r)
        prev = r
    return cleaned


def align(
    text_fragments: List[TextFragment],
    audio_path: str,
    language: str = "eng",
) -> List[SyncFragment]:
    """Force-align text fragments against the audio file using Aeneas.

    Returns sanitized :class:`SyncFragment` rows ready for the database.
    """
    from aeneas.executetask import ExecuteTask
    from aeneas.task import Task

    audio_abs = os.path.abspath(audio_path)
    audio_ref = os.path.basename(audio_abs)
    config_string = (
        f"task_language={language}|"
        "is_text_type=plain|"
        "os_task_file_format=smil|"
        "os_task_file_smil_page_ref=book.xhtml|"
        f"os_task_file_smil_audio_ref={audio_ref}"
    )

    with tempfile.TemporaryDirectory() as tmp:
        text_path = os.path.join(tmp, "fragments.txt")
        with open(text_path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(tf.text.replace("\n", " ") for tf in text_fragments))

        task = Task(config_string=config_string)
        task.audio_file_path_absolute = audio_abs
        task.text_file_path_absolute = os.path.abspath(text_path)

        smil_path = os.path.join(tmp, "sync.smil")
        task.sync_map_file_path_absolute = smil_path

        log.info("Running Aeneas forced alignment (%d fragments)...",
                 len(text_fragments))
        ExecuteTask(task).execute()

        # Still produce a SMIL sync map file (satisfies "produce a SMIL-format
        # sync map"); it is not our primary timing source.
        try:
            task.output_sync_map_file()
        except Exception:  # pragma: no cover
            log.warning("Could not write SMIL output file", exc_info=True)

        timings = _read_in_memory(task)
        if timings is None:
            log.warning("In-memory sync map unavailable; parsing SMIL file")
            timings = parse_smil(smil_path)

    rows = _zip_to_fragments(text_fragments, timings)
    return sanitize_fragments(rows)
