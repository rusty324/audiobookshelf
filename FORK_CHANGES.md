# Fork Changes

This document records how this fork (`rusty324/audiobookshelf`) differs from upstream (`advplyr/audiobookshelf`). It is intended as a reference when syncing with upstream, so it is clear which local changes must survive a merge.

|                                   |                                                       |
| --------------------------------- | ----------------------------------------------------- |
| **Last synced with upstream**     | 2026-09-14                                            |
| **Upstream commit at sync**       | `5cb75a8` (Merge PR #5558 — weblate-credits-workflow) |
| **Version**                       | v2.36.0                                               |
| **Fork-only commits on `master`** | 7                                                     |
| **Net divergence**                | 48 files, ~3,850 insertions / ~120 deletions          |

### Regenerating this log

The upstream tip is the second parent of the sync merge commit, so the divergence can always be recomputed without network access to upstream:

```bash
UP=$(git rev-parse <sync-merge-commit>^2)      # e.g. 441f6f5^2 -> 5cb75a8
git log --oneline --no-merges $UP..origin/master   # fork-only commits
git diff --stat $UP...origin/master                # fork-only file changes
```

---

## 1. Features added

### Organize into folders (PR #2 — `8ce25b7`)

Admin-only, per-item action that moves a book's files into a canonical `[author]/[series]/Book NN - [title]/` layout, creating folders as needed, then re-syncs the DB.

- `server/utils/fileUtils.js` — new exported helpers `formatSeriesSequence()` and `buildBookOrganizeRelParts()`.
- `server/controllers/LibraryItemController.js` — new `organize()` method. Guards: admin-only, book-only, no-op when already organized, 409 on target collision, watcher ignore-dir around the move, empty-parent cleanup that never ascends above the library folder.
- `server/routers/ApiRouter.js` — `POST /api/items/:id/organize`.
- `client/components/cards/LazyBookCard.vue`, `client/components/modals/item/tabs/Tools.vue` — UI entry points.
- `client/strings/en-us.json` — organize button/label/confirm/toast strings.
- `test/server/utils/fileUtils.test.js` — unit tests for the two helpers.

### Series reorder buttons (PR #4 — `78444b1`)

Up/down arrow buttons on each chip in the book-edit **Series** field, since `series[0]` is the primary series and order was previously only changeable by remove-and-re-add.

- `client/components/ui/MultiSelectQueryInput.vue` — new `orderable` prop; `moveItemUp()` / `moveItemDown()`; reorder buttons rendered on the **opposite side** of the chip from edit/remove to avoid accidental deletion; chip widened in orderable mode.
- `client/components/widgets/SeriesInputWidget.vue` — passes `orderable`, so **only** the series field is affected (authors/tags/genres/narrators share the component and are unchanged).
- `client/strings/en-us.json` — `ButtonMoveUp` / `ButtonMoveDown`.

### EPUB ↔ audiobook sync CLI (PRs #7, #8 — `77ca2e3`, `3b9711d`)

Standalone Python 3.10+ tool at `tools/epub-audio-sync/` that force-aligns an EPUB to its audiobook and maps character offsets to audio timestamps (Whispersync-style). Entirely self-contained — shares nothing with the Node codebase and does not affect the server.

- Pipeline: `epub_parser.py` (ebooklib + BeautifulSoup + pysbd) → `aligner.py` (Aeneas, CPU-only) → `db.py` (stdlib sqlite3) → `cli.py` (argparse).
- Tests: `tools/epub-audio-sync/tests/` — 24 passing, runnable without the heavy Aeneas stack.

---

## 2. Tooling and infrastructure

### ESLint + CI lint gate (PR #6 — `78d9a22`)

Upstream has Prettier (formatting) but no ESLint (correctness). This fork adds both server and client linting.

- `.eslintrc.js` (new) — server, Node/CommonJS, `eslint:recommended` + `plugin:promise/recommended`.
- `client/.eslintrc.js` (new) — Nuxt 2/Vue 2, `eslint:recommended` + `plugin:vue/essential`.
- `.github/workflows/lint.yml` (new) — CI job that fails on errors.
- `package.json`, `client/package.json` — `lint` / `lint:fix` scripts and ESLint devDependencies.

Configs keep high-value bug rules as **errors** and downgrade pre-existing stylistic noise to **warnings** (162 server + 84 client) so the gate is meaningful without a full-codebase rewrite.

### Docker Compose builds locally (PR #3 — `7d1a62b`)

- `docker-compose.yml` — service now builds from this repo's `Dockerfile` (`build: context: .`, tagged `audiobookshelf:local`) instead of pulling `ghcr.io/advplyr/audiobookshelf:latest`, so the running container reflects this fork's code. **Rebuild with `docker compose up -d --build` after merging any change.**

---

## 3. Bug fixes not in upstream

### Security / correctness (PR #1 — `ae3c7e5`)

- `server/controllers/ApiKeyController.js` — **authorization gap**: `delete()` lacked the root-user guard that `create()` and `update()` both have, letting a non-root admin delete a root user's API key.
- `server/controllers/SessionController.js` — null deref on a deleted user (`user?.username`).
- `server/utils/podcastUtils.js` — `extractStringOrStringify()` referenced an undefined `value` (param is `json`), silently dropping non-CDATA podcast descriptions.
- `server/providers/OpenLibrary.js` — unchecked `docs` array in `search()` / `searchTitle()`.
- `server/controllers/ShareController.js` — null-guarded audio file/track metadata on the public share endpoint.
- `server/Watcher.js`, `server/scanner/LibraryScanner.js` — unhandled promise rejections in recursive chains.

### Found by ESLint (PR #6 — `78d9a22`)

- `server/utils/scandir.js` — `series`, `author`, `pattern` assigned without `var` → implicit globals.
- `server/scanner/LibraryScanner.js` — **duplicate `path` key** in two Sequelize `where` clauses silently dropped the `Op.not` condition, so child-item lookups also matched the item itself.
- `server/managers/BackupManager.js` — error handler logged an undefined `path` (module imports `Path`).
- `server/managers/BinaryManager.js` — `binaryPath` declared inside `try`, referenced in `catch`.
- `server/controllers/MiscController.js` — lexical declaration in a `case` without a block; nested function declaration.
- `client/components/controls/VolumeControl.vue`, `client/components/tables/library/LibraryItem.vue` — `catch` blocks referenced `err` while the bound param was `error`.
- `client/components/modals/UploadImageModal.vue` — `fileUploadSelected` used an undefined `file`.
- `client/components/ui/QueryInput.vue` — `setItem` referenced an undefined `val`.
- `client/components/ui/MultiSelectQueryInput.vue` — `identifier` was a computed returning `Math.random()` (impure, new value per access); moved to a stable per-instance `data` value.

---

## 4. Pending — not yet on `master`

| PR            | Branch                             | Contents                                                                                                                                        |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **#5** (open) | `claude/dependency-security-fixes` | `npm audit fix` (non-breaking): 38 → 13 vulns, criticals 3 → 1. Adds `.github/dependabot.yml`. Lockfile-only; no `package.json` ranges changed. |

### Known deferred items

- **Major dependency bumps** (all remaining advisories need these): `axios` → 1.x, `nodemailer` → 9.x, and the `sqlite3` → 6.x native-module cluster (`sqlite3`, `tar`, `node-gyp`, `make-fetch-happen`, `cacache`). The last remaining **critical (`tar`)** is inside that cluster.
- **`LibraryItem.hasAudioTracks`** is defined as _both_ a getter and a method; the method wins, so property-style call sites (`libraryItem.hasAudioTracks`) get a truthy function reference instead of a boolean and those guards never fire. Left as an ESLint warning pending a focused fix.

---

## 5. Upstream direction to watch

As of v2.36.0 upstream's readme states:

> Frontend pull requests are not being reviewed or merged for the existing Vue frontend. The frontend is currently being rewritten and migrated to **React**.

No rewrite code has landed yet (only the note plus some server-side Next.js `basePath` handling), but this fork's client-side changes — series reorder, the organize UI entry points, `client/.eslintrc.js`, and the client bug fixes above — all live in the Vue client that upstream intends to replace. Expect those to need reimplementation, and weigh further Vue-side investment accordingly. The server-side changes (organize endpoint, bug fixes, ESLint, the epub tool) are unaffected.
