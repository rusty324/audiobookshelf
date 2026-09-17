/**
 * Builds the JSON export of every book in the library.
 *
 * Kept free of database and request access so the shaping rules can be unit
 * tested directly against plain objects.
 */

/**
 * Title and subtitle are combined with an underscore, per the export format.
 *
 * @param {string} title
 * @param {string} [subtitle]
 * @returns {string}
 */
function buildExportTitle(title, subtitle) {
  const cleanTitle = (title || '').trim()
  const cleanSubtitle = (subtitle || '').trim()
  if (!cleanSubtitle) return cleanTitle
  return `${cleanTitle}_${cleanSubtitle}`
}

/**
 * The export carries a single series string. When a book belongs to several,
 * the last one is used.
 *
 * @param {{ name: string, sequence?: string }[]} series - in display order
 * @returns {string} "Name #sequence", "Name" when there is no sequence, or ""
 */
function buildExportSeries(series) {
  if (!Array.isArray(series) || !series.length) return ''

  const last = series[series.length - 1]
  if (!last?.name) return ''

  const sequence = (last.sequence ?? '').toString().trim()
  return sequence ? `${last.name} #${sequence}` : last.name
}

/**
 * Which formats the library actually holds for this book.
 *
 * Audio files flagged as excluded do not count, so a book whose only audio is
 * excluded is not reported as an audiobook.
 *
 * @param {{ audioFiles?: object[], ebookFile?: object }} book
 * @returns {string[]}
 */
function buildExportFormats(book) {
  const formats = []

  const includedAudioFiles = Array.isArray(book?.audioFiles) ? book.audioFiles.filter((af) => !af?.exclude) : []
  if (includedAudioFiles.length) formats.push('audiobook')
  if (book?.ebookFile) formats.push('ebook')

  return formats
}

/**
 * Shape one library item for the export.
 *
 * @param {object} params
 * @param {string} params.libraryItemId
 * @param {object} params.book - title, subtitle, authors, series, genres, audioFiles, ebookFile, coverPath
 * @returns {object|null} the entry, or null when the book has neither an audiobook nor an ebook
 */
function buildExportEntry({ libraryItemId, book }) {
  if (!book) return null

  const formats = buildExportFormats(book)
  // Nothing to list for a book with no playable or readable file
  if (!formats.length) return null

  const authors = Array.isArray(book.authors) ? book.authors.map((author) => author?.name).filter(Boolean) : []
  const series = buildExportSeries(book.series)

  const entry = {
    title: buildExportTitle(book.title, book.subtitle),
    author: authors.join(', '),
    series,
    formats
  }

  // Covers are served by the API rather than stored as external URLs, so the
  // export carries the API path for items that have one.
  if (book.coverPath) {
    entry.coverUrl = `/api/items/${libraryItemId}/cover`
  }

  entry.genre = Array.isArray(book.genres) ? [...book.genres] : []

  return entry
}

module.exports = {
  buildExportTitle,
  buildExportSeries,
  buildExportFormats,
  buildExportEntry
}
