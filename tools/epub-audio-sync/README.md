# epub-audio-sync

A standalone Python CLI that synchronizes an EPUB ebook with its audiobook —
like Amazon's Whispersync. It force-aligns the ebook text to the narration and
lets you map any character position in the text to a timestamp in the audio (and
back), so you can switch between reading and listening without losing your place.

This tool is self-contained under `tools/epub-audio-sync/` and shares nothing
with the surrounding audiobookshelf (Node.js) codebase.

## How it works

```
EPUB ──ebooklib+BeautifulSoup──▶ sentences (with char offsets)
                                        │
                                        ▼
                        Aeneas forced alignment (CPU, DTW)
                                        │
                                        ▼
                 char range ↔ audio time range  ──▶  SQLite
                                        │
                                        ▼
              text_to_audio() / audio_to_text() queries
```

1. **Parse** the EPUB in spine (reading) order, strip markup, and split into
   sentences with [`pysbd`](https://github.com/nipunsadvilkar/pySBD).
2. **Track offsets**: sentences are joined with newlines into a *canonical text*;
   each sentence records its `[char_start, char_end)` range in that text.
3. **Align** the canonical text against the audiobook with
   [Aeneas](https://github.com/readbeyond/aeneas) via `ExecuteTask` (no CLI
   shell-out). Aeneas is CPU-only — no GPU required.
4. **Store** each fragment's char range ↔ audio time range (ms) in SQLite. The
   raw SMIL is never persisted; only the derived numeric ranges are.

### What a `char_offset` means

A `char_offset` is an index into a book's **canonical text**: the normalized,
newline-joined sentence stream that was aligned and stored. Offsets are Python
string (Unicode code-point) positions — not raw EPUB bytes and not UTF-16 code
units. The canonical text is saved on the `books` row (with a SHA-256 and
length) so any offset can be resolved back to its exact substring. If you feed
these offsets to a JavaScript reader (which uses UTF-16), convert accordingly
for text containing astral characters.

## Install

Core (parsing + lookups + tests) — works anywhere, no GPU:

```bash
cd tools/epub-audio-sync
pip install -r requirements.txt
```

Alignment (only needed for `sync`) also needs Aeneas and its system packages:

```bash
# Debian/Ubuntu
sudo apt-get install ffmpeg espeak espeak-data libespeak-dev libespeak1 \
    python3-dev build-essential
pip install -r requirements-align.txt
```

## Usage

Run as a module:

```bash
python -m epub_audio_sync [--db PATH] [-v] <command> ...
```

The database path defaults to `$SYNC_DB` or `./sync.db`.

| Command | Description |
| --- | --- |
| `sync <epub_path> <audio_path> [--title T] [--language eng]` | Align and populate the DB; prints the new `book_id`. |
| `lookup text <book_id> <char_offset>` | Print the audio timestamp (ms) for a character offset. |
| `lookup audio <book_id> <timestamp_ms>` | Print the character offset for an audio timestamp. |
| `position get <book_id>` | Print the last saved reading position. |
| `position set <book_id> <char_offset> <timestamp_ms>` | Save the current reading position. |

Example:

```bash
BOOK_ID=$(python -m epub_audio_sync sync book.epub book.m4b)
python -m epub_audio_sync lookup text  "$BOOK_ID" 12000   # -> e.g. 431200  (ms)
python -m epub_audio_sync lookup audio "$BOOK_ID" 431200  # -> e.g. 11987   (char)
python -m epub_audio_sync position set "$BOOK_ID" 12000 431200
python -m epub_audio_sync position get "$BOOK_ID"
```

Lookups print just the number to stdout (script-friendly); logs and warnings go
to stderr. Exit code is `1` when there is no mapping / book / saved position.

## Robustness

- **Gaps** between aligned fragments are preserved; lookups that land in a gap
  return the nearest fragment boundary rather than failing.
- **Overlaps** and zero/negative-duration fragments from alignment are repaired
  (clamped or dropped) with logged warnings — the tool never crashes on messy
  Aeneas output.
- Re-running `sync` on the same EPUB updates the existing book row and replaces
  its sync map (idempotent).

## Development

```bash
pip install -r requirements.txt pytest
python -m pytest
```

The test suite covers the schema, both query directions (including gap and
overlap handling), the char-offset invariant, and the SMIL parser — all without
requiring Aeneas or a real audio file.
