/**
 * Helpers for series placeholders - entries for books that belong to a series
 * but are not in the library, shown on the series page so gaps are visible.
 *
 * These are deliberately free of database and request access so the matching
 * rules can be unit tested against plain objects.
 */

const MaxTitleLength = 500
const MaxSubtitleLength = 500
const MaxAuthorNameLength = 500
const MaxSequenceLength = 50

/** Where a placeholder came from. */
const Sources = ['manual', 'hardcover']

/**
 * Key set on a library item's `extraData` to mark it as a promoted
 * placeholder - a book record with no files behind it.
 *
 * It lives in `extraData` because that JSON column already exists. A real
 * column is not an option on this fork: sequelize.sync({ alter: false })
 * never adds columns to an existing table, and migrations are version gated.
 */
const PlaceholderExtraDataKey = 'isPlaceholder'

/**
 * Whether a library item is a promoted placeholder rather than real media.
 *
 * Anything that treats a file-less item as broken must consult this first.
 * A promoted placeholder has no path on disk by design, so the scanner would
 * otherwise flag it `isMissing` on every run and the "remove items with
 * issues" sweep would then delete it.
 *
 * @param {{ extraData?: object }} libraryItem
 * @returns {boolean}
 */
function isPlaceholderLibraryItem(libraryItem) {
  return !!libraryItem?.extraData?.[PlaceholderExtraDataKey]
}

/**
 * Canonical form of a series sequence for comparison.
 *
 * Sequences are free-text strings in Audiobookshelf ("1", "01", "1.5", "Book 2"),
 * so numeric values are compared as numbers to make "01" and "1" the same slot,
 * and everything else falls back to a trimmed lowercase string.
 *
 * @param {string|number} sequence
 * @returns {string} empty string when there is no usable sequence
 */
function normalizeSequence(sequence) {
  if (sequence === null || sequence === undefined) return ''
  const trimmed = String(sequence).trim()
  if (!trimmed) return ''
  // Number() rather than parseFloat: parseFloat('1abc') is 1, which would
  // wrongly collapse '1abc' onto slot 1.
  const asNumber = Number(trimmed)
  if (!isNaN(asNumber) && isFinite(asNumber)) return String(asNumber)
  return trimmed.toLowerCase()
}

/**
 * Canonical form of a title for comparison. Used only as a secondary signal,
 * since series with messy numbering may not line up on sequence alone.
 *
 * @param {string} title
 * @returns {string}
 */
function normalizeTitle(title) {
  if (!title) return ''
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Sort comparator for placeholders and books by series sequence.
 * Numeric sequences sort numerically and ahead of non-numeric ones;
 * entries with no sequence sort last.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareSequences(a, b) {
  const normA = normalizeSequence(a)
  const normB = normalizeSequence(b)
  if (normA === normB) return 0
  if (!normA) return 1
  if (!normB) return -1

  const numA = Number(normA)
  const numB = Number(normB)
  const aIsNum = !isNaN(numA) && isFinite(numA)
  const bIsNum = !isNaN(numB) && isFinite(numB)

  if (aIsNum && bIsNum) return numA - numB
  if (aIsNum) return -1
  if (bIsNum) return 1
  return normA < normB ? -1 : 1
}

/**
 * Whether a placeholder is already satisfied by a book in the library.
 *
 * Matching is done at read time rather than written to the database, so a
 * placeholder disappears on its own once the real book is scanned in and
 * there is no stored state to go stale.
 *
 * A placeholder matches when it shares a sequence with a book in the series,
 * or - for series whose numbering is unreliable - when the titles match.
 *
 * @param {{ sequence?: string, title?: string }} placeholder
 * @param {{ sequence?: string, title?: string }[]} booksInSeries
 * @returns {boolean}
 */
function isFulfilled(placeholder, booksInSeries) {
  if (!placeholder || !Array.isArray(booksInSeries) || !booksInSeries.length) return false

  const placeholderSequence = normalizeSequence(placeholder.sequence)
  const placeholderTitle = normalizeTitle(placeholder.title)

  return booksInSeries.some((book) => {
    if (placeholderSequence && normalizeSequence(book.sequence) === placeholderSequence) return true
    if (placeholderTitle && normalizeTitle(book.title) === placeholderTitle) return true
    return false
  })
}

/**
 * Drop placeholders that the library already covers, and sort what is left
 * into series order.
 *
 * @param {object[]} placeholders
 * @param {{ sequence?: string, title?: string }[]} booksInSeries
 * @returns {object[]}
 */
function filterUnfulfilled(placeholders, booksInSeries) {
  if (!Array.isArray(placeholders)) return []
  return placeholders.filter((placeholder) => !isFulfilled(placeholder, booksInSeries)).sort((a, b) => compareSequences(a?.sequence, b?.sequence))
}

/**
 * Validate and clean untrusted placeholder input from a request body.
 *
 * @param {object} body
 * @returns {{ title: string, sequence: string, subtitle: string|null, authorName: string|null, source: string }|null} null when invalid
 */
function sanitizePlaceholderInput(body) {
  if (!body || typeof body !== 'object') return null

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title || title.length > MaxTitleLength) return null

  const sequence = body.sequence === null || body.sequence === undefined ? '' : String(body.sequence).trim()
  if (sequence.length > MaxSequenceLength) return null

  const subtitle = typeof body.subtitle === 'string' ? body.subtitle.trim() : ''
  if (subtitle.length > MaxSubtitleLength) return null

  const authorName = typeof body.authorName === 'string' ? body.authorName.trim() : ''
  if (authorName.length > MaxAuthorNameLength) return null

  const source = Sources.includes(body.source) ? body.source : 'manual'

  return {
    title,
    sequence,
    subtitle: subtitle || null,
    authorName: authorName || null,
    source
  }
}

/**
 * Whether the library already holds a book matching this input, used to reject
 * a placeholder for a book the user actually has.
 *
 * @param {{ title: string, sequence: string }} input - already sanitized
 * @param {{ sequence?: string, title?: string }[]} booksInSeries
 * @returns {boolean}
 */
function conflictsWithLibrary(input, booksInSeries) {
  return isFulfilled(input, booksInSeries)
}

/**
 * Whether an equivalent placeholder already exists, to keep the list free of
 * duplicates when the same gap is added twice.
 *
 * @param {{ title: string, sequence: string }} input - already sanitized
 * @param {{ title?: string, sequence?: string }[]} existing
 * @returns {boolean}
 */
function isDuplicate(input, existing) {
  if (!Array.isArray(existing) || !existing.length) return false
  const sequence = normalizeSequence(input.sequence)
  const title = normalizeTitle(input.title)
  return existing.some((placeholder) => {
    // A shared sequence is only a duplicate when there is a sequence to share;
    // two untitled gaps with no sequence are not the same entry.
    if (sequence && normalizeSequence(placeholder.sequence) === sequence) return true
    return title && normalizeTitle(placeholder.title) === title
  })
}

module.exports = {
  Sources,
  PlaceholderExtraDataKey,
  isPlaceholderLibraryItem,
  MaxTitleLength,
  MaxSubtitleLength,
  MaxAuthorNameLength,
  MaxSequenceLength,
  normalizeSequence,
  normalizeTitle,
  compareSequences,
  isFulfilled,
  filterUnfulfilled,
  sanitizePlaceholderInput,
  conflictsWithLibrary,
  isDuplicate
}
