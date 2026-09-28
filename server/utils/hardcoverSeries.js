/**
 * Shaping of Hardcover series responses into series placeholder proposals.
 *
 * Kept free of network and database access so the filtering rules can be unit
 * tested against recorded response shapes. This matters more than usual here:
 * the Hardcover API cannot be reached from the environment this was written
 * in, so these transforms are the only part that can be verified directly.
 */

const { isFulfilled, isDuplicate, compareSequences } = require('./seriesPlaceholders')

/**
 * Hardcover stores contributors as a denormalized JSON blob whose exact shape
 * is not described by the schema (it is typed only as `json`). Parsing is
 * therefore deliberately forgiving: an unrecognized shape costs an author
 * name, which is cosmetic, rather than failing the lookup.
 *
 * @param {any} cachedContributors
 * @returns {string|null}
 */
function parseContributors(cachedContributors) {
  let value = cachedContributors
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return value.trim() || null
    }
  }
  if (!value) return null

  const list = Array.isArray(value) ? value : [value]
  const names = list
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (!entry || typeof entry !== 'object') return null
      // Seen in the wild as { author: { name } } and as a flat { name }
      return entry.author?.name || entry.name || null
    })
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter(Boolean)

  if (!names.length) return null
  return [...new Set(names)].join(', ')
}

/**
 * Format a Hardcover `position` (float8) as an Audiobookshelf sequence string.
 * Whole numbers lose the decimal so they match how sequences are normally
 * entered; 1.5 is preserved, since that is how novellas are positioned.
 *
 * @param {number|string|null} position
 * @returns {string}
 */
function formatPosition(position) {
  if (position === null || position === undefined || position === '') return ''
  const num = Number(position)
  if (isNaN(num) || !isFinite(num)) return ''
  return String(num)
}

/**
 * Whether a Hardcover series entry should be offered as a placeholder at all.
 *
 * Box sets and omnibus editions are excluded because they are not missing
 * books - they are repackagings of books the series already lists, and
 * offering them would pad every series with duplicates.
 *
 * @param {object} row - a book_series row
 * @returns {boolean}
 */
function isOfferable(row) {
  if (!row) return false
  const book = row.book
  if (!book?.title || typeof book.title !== 'string' || !book.title.trim()) return false
  if (row.compilation || book.compilation) return false
  if (book.is_partial_book) return false
  return true
}

/**
 * Map Hardcover book_series rows to placeholder proposals, in series order.
 *
 * @param {object[]} rows
 * @returns {{ title: string, subtitle: string|null, sequence: string, authorName: string|null, releaseYear: number|null, source: string, sourceId: string|null }[]}
 */
function mapSeriesBooksToProposals(rows) {
  if (!Array.isArray(rows)) return []

  const proposals = rows.filter(isOfferable).map((row) => {
    const book = row.book
    return {
      title: book.title.trim(),
      subtitle: typeof book.subtitle === 'string' && book.subtitle.trim() ? book.subtitle.trim() : null,
      sequence: formatPosition(row.position),
      authorName: parseContributors(book.cached_contributors),
      releaseYear: Number.isInteger(book.release_year) ? book.release_year : null,
      source: 'hardcover',
      sourceId: book.id !== undefined && book.id !== null ? String(book.id) : null
    }
  })

  // A book can be listed twice in one series (different editions sharing a
  // position). Keep the first and drop the rest.
  const seen = []
  const deduped = []
  for (const proposal of proposals) {
    if (isDuplicate(proposal, seen)) continue
    seen.push(proposal)
    deduped.push(proposal)
  }

  return deduped.sort((a, b) => compareSequences(a.sequence, b.sequence))
}

/**
 * Reduce proposals to the ones actually worth offering: not already in the
 * library, and not already recorded as a placeholder.
 *
 * @param {object[]} proposals
 * @param {{ sequence?: string, title?: string }[]} booksInSeries
 * @param {{ sequence?: string, title?: string }[]} existingPlaceholders
 * @returns {object[]}
 */
function filterNewProposals(proposals, booksInSeries, existingPlaceholders) {
  if (!Array.isArray(proposals)) return []
  return proposals.filter((proposal) => {
    if (isFulfilled(proposal, booksInSeries || [])) return false
    if (isDuplicate(proposal, existingPlaceholders || [])) return false
    return true
  })
}

/**
 * Pick the best series match for a name from Hardcover search results.
 *
 * An exact case-insensitive name match always wins over a partial one, so a
 * search for "Dune" does not silently resolve to "Dune Chronicles".
 *
 * @param {object[]} candidates
 * @param {string} name
 * @returns {object|null}
 */
function pickSeriesMatch(candidates, name) {
  if (!Array.isArray(candidates) || !candidates.length) return null
  const target = (name || '').trim().toLowerCase()
  if (!target) return null

  const exact = candidates.find((candidate) => (candidate?.name || '').trim().toLowerCase() === target)
  if (exact) return exact
  return candidates[0] || null
}

module.exports = {
  parseContributors,
  formatPosition,
  isOfferable,
  mapSeriesBooksToProposals,
  filterNewProposals,
  pickSeriesMatch
}
