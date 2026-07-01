"""Command-line interface for the EPUB ↔ audiobook sync tool.

Subcommands:
    sync <epub> <audio>                 run alignment and populate the database
    lookup text  <book_id> <char>       print the audio timestamp (ms)
    lookup audio <book_id> <ms>         print the character offset
    position get <book_id>              print last saved position
    position set <book_id> <char> <ms>  save current position

The heavy alignment module (``aligner``) is imported lazily inside the ``sync``
handler only, so lookups and position commands work without aeneas installed.
"""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Optional

from . import db
from .epub_parser import parse_epub, sha256, to_iso2


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="epub_audio_sync",
        description="Synchronize an EPUB ebook with its audiobook (Whispersync-style).",
    )
    parser.add_argument(
        "--db", dest="db_path", default=None,
        help="Path to the SQLite database (default: $SYNC_DB or ./sync.db)",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Enable debug logging"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_sync = sub.add_parser("sync", help="Align an EPUB with an audiobook")
    p_sync.add_argument("epub_path")
    p_sync.add_argument("audio_path")
    p_sync.add_argument("--title", default=None, help="Override the book title")
    p_sync.add_argument("--language", default="eng", help="Aeneas task language (default: eng)")
    p_sync.set_defaults(func=_cmd_sync)

    p_lookup = sub.add_parser("lookup", help="Look up a mapping in either direction")
    lookup_sub = p_lookup.add_subparsers(dest="direction", required=True)
    p_lt = lookup_sub.add_parser("text", help="char offset -> audio timestamp (ms)")
    p_lt.add_argument("book_id", type=int)
    p_lt.add_argument("char_offset", type=int)
    p_lt.set_defaults(func=_cmd_lookup_text)
    p_la = lookup_sub.add_parser("audio", help="audio timestamp (ms) -> char offset")
    p_la.add_argument("book_id", type=int)
    p_la.add_argument("timestamp_ms", type=int)
    p_la.set_defaults(func=_cmd_lookup_audio)

    p_pos = sub.add_parser("position", help="Get or set the reading position")
    pos_sub = p_pos.add_subparsers(dest="action", required=True)
    p_pg = pos_sub.add_parser("get", help="Print the last saved position")
    p_pg.add_argument("book_id", type=int)
    p_pg.set_defaults(func=_cmd_position_get)
    p_ps = pos_sub.add_parser("set", help="Save the current position")
    p_ps.add_argument("book_id", type=int)
    p_ps.add_argument("char_offset", type=int)
    p_ps.add_argument("timestamp_ms", type=int)
    p_ps.set_defaults(func=_cmd_position_set)

    return parser


def _cmd_sync(args) -> int:
    conn = db.connect(args.db_path)
    try:
        title, fragments, canonical_text = parse_epub(
            args.epub_path, language=to_iso2(args.language)
        )
        if not fragments:
            print("No text fragments extracted from EPUB.", file=sys.stderr)
            return 1
        title = args.title or title

        # Lazy import: aeneas is only needed here.
        from .aligner import align

        sync_fragments = align(fragments, args.audio_path, language=args.language)
        if not sync_fragments:
            print("Alignment produced no usable fragments.", file=sys.stderr)
            return 1

        book_id = db.upsert_book(
            conn,
            title=title,
            epub_path=args.epub_path,
            audio_path=args.audio_path,
            canonical_text=canonical_text,
            text_sha256=sha256(canonical_text),
        )
        count = db.replace_sync_map(conn, book_id, sync_fragments)
        logging.getLogger(__name__).info(
            "Stored %d sync fragments for book %d (%s)", count, book_id, title
        )
        print(book_id)
        return 0
    finally:
        conn.close()


def _cmd_lookup_text(args) -> int:
    conn = db.connect(args.db_path)
    try:
        if db.get_book(conn, args.book_id) is None:
            print(f"No book with id {args.book_id}.", file=sys.stderr)
            return 1
        result = db.text_to_audio(conn, args.book_id, args.char_offset)
        return _print_or_missing(result, "No sync data for this book.")
    finally:
        conn.close()


def _cmd_lookup_audio(args) -> int:
    conn = db.connect(args.db_path)
    try:
        if db.get_book(conn, args.book_id) is None:
            print(f"No book with id {args.book_id}.", file=sys.stderr)
            return 1
        result = db.audio_to_text(conn, args.book_id, args.timestamp_ms)
        return _print_or_missing(result, "No sync data for this book.")
    finally:
        conn.close()


def _cmd_position_get(args) -> int:
    conn = db.connect(args.db_path)
    try:
        row = db.get_position(conn, args.book_id)
        if row is None:
            print(f"No saved position for book {args.book_id}.", file=sys.stderr)
            return 1
        print(f"char_offset={row['char_offset']} "
              f"audio_timestamp_ms={row['audio_timestamp_ms']} "
              f"updated_at={row['updated_at']}")
        return 0
    finally:
        conn.close()


def _cmd_position_set(args) -> int:
    conn = db.connect(args.db_path)
    try:
        if db.get_book(conn, args.book_id) is None:
            print(f"No book with id {args.book_id}.", file=sys.stderr)
            return 1
        db.set_position(conn, args.book_id, args.char_offset, args.timestamp_ms)
        print(f"Saved position for book {args.book_id}.")
        return 0
    finally:
        conn.close()


def _print_or_missing(result: Optional[int], missing_msg: str) -> int:
    if result is None:
        print(missing_msg, file=sys.stderr)
        return 1
    print(result)
    return 0


def main(argv: Optional[list] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    try:
        return args.func(args)
    except ImportError as exc:
        # Most likely aeneas (or a system dep) is missing for `sync`.
        print(f"Missing dependency: {exc}. "
              f"Install alignment deps: pip install -r requirements-align.txt",
              file=sys.stderr)
        return 1
    except Exception as exc:
        # Covers OSError, corrupt EPUBs (zipfile.BadZipFile, EpubException),
        # bad values, and alignment failures with a clean one-line message.
        if args.verbose:
            raise
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
