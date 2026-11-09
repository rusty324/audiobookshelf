/**
 * Helpers for anthology stories - stories inside one book that each take
 * their own place in a series, so an anthology's contents can be read in
 * series order. Tales From The Folly, for example, has one story at Rivers of
 * London 2.5 and another at 4.5.
 *
 * Stories are stored as time ranges rather than chapter indices. Chapters get
 * edited and re-imported (the chapter editor, Audible chapter lookup), which
 * renumbers them; a time range keeps pointing at the same part of the audio.
 *
 * Kept free of database and request access so the rules can be unit tested
 * against plain objects.
 */

const { compareSequences, normalizeSequence } = require('./seriesPlaceholders')

const MaxStoriesPerBook = 200
const MaxTitleLength = 500
const MaxSeriesNameLength = 500
const MaxSequenceLength = 50

/**
 * Tolerance, in seconds, for a story ending slightly past the book's duration
 * or two stories touching. Chapter boundaries and durations come from separate
 * probes and can disagree by a fraction of a second.
 */
const TimeToleranceSeconds = 0.5

/**
 * Validate and clean a book's full list of stories from a request body.
 *
 * The list is validated as a whole because the rules span stories: two
 * stories may not overlap, since one stretch of audio is one story.
 *
 * @param {any} rawStories
 * @param {{ duration?: number }} [options] - the book's duration, when known
 * @returns {{ stories: { title: string, startTime: number, endTime: number, seriesName: string|null, sequence: string }[] } | { error: string }}
 */
function sanitizeStories(rawStories, { duration } = {}) {
  if (!Array.isArray(rawStories)) return { error: 'stories must be an array' }
  if (rawStories.length > MaxStoriesPerBook) return { error: `Too many stories, maximum is ${MaxStoriesPerBook}` }

  const hasDuration = typeof duration === 'number' && isFinite(duration) && duration > 0
  const stories = []

  for (let i = 0; i < rawStories.length; i++) {
    const raw = rawStories[i]
    const label = `Story ${i + 1}`
    if (!raw || typeof raw !== 'object') return { error: `${label} is not an object` }

    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    if (!title) return { error: `${label} needs a title` }
    if (title.length > MaxTitleLength) return { error: `${label} title is too long` }

    const startTime = Number(raw.startTime)
    const endTime = Number(raw.endTime)
    if (!isFinite(startTime) || !isFinite(endTime)) return { error: `${label} needs a start and end time` }
    if (startTime < 0) return { error: `${label} starts before the beginning of the book` }
    if (endTime <= startTime) return { error: `${label} must end after it starts` }
    if (hasDuration && endTime > duration + TimeToleranceSeconds) return { error: `${label} ends after the end of the book` }

    const seriesName = typeof raw.seriesName === 'string' ? raw.seriesName.trim() : ''
    if (seriesName.length > MaxSeriesNameLength) return { error: `${label} series name is too long` }

    const sequence = raw.sequence === null || raw.sequence === undefined ? '' : String(raw.sequence).trim()
    if (sequence.length > MaxSequenceLength) return { error: `${label} sequence is too long` }
    // A position means nothing without a series to be a position in
    if (sequence && !seriesName) return { error: `${label} has a sequence but no series` }

    stories.push({
      title,
      startTime,
      endTime: hasDuration ? Math.min(endTime, duration) : endTime,
      seriesName: seriesName || null,
      sequence
    })
  }

  stories.sort((a, b) => a.startTime - b.startTime)
  for (let i = 1; i < stories.length; i++) {
    if (stories[i].startTime < stories[i - 1].endTime - TimeToleranceSeconds) {
      return { error: `"${stories[i - 1].title}" and "${stories[i].title}" overlap` }
    }
  }

  return { stories }
}

/**
 * Merge a series' books, anthology stories and missing-book placeholders into
 * one list in reading order.
 *
 * A story and a book at the same sequence are both kept: they are different
 * things the user owns, and hiding either would misreport the library.
 * Placeholders are expected to be already filtered to the unfulfilled ones.
 *
 * Ties keep a stable order (book, then story, then placeholder) so the list
 * does not reshuffle between requests.
 *
 * @param {{ books?: object[], stories?: object[], placeholders?: object[] }} parts
 * @returns {object[]} entries with a `type` of 'book', 'story' or 'placeholder'
 */
function buildReadingOrder({ books = [], stories = [], placeholders = [] }) {
  const typeRank = { book: 0, story: 1, placeholder: 2 }
  const entries = [...books.map((b) => ({ ...b, type: 'book' })), ...stories.map((s) => ({ ...s, type: 'story' })), ...placeholders.map((p) => ({ ...p, type: 'placeholder' }))]

  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const bySequence = compareSequences(a.entry.sequence, b.entry.sequence)
      if (bySequence !== 0) return bySequence
      const byType = typeRank[a.entry.type] - typeRank[b.entry.type]
      if (byType !== 0) return byType
      return a.index - b.index
    })
    .map(({ entry }) => entry)
}

/**
 * Stories in a series, reduced to what placeholder matching needs, so a story
 * at 2.5 counts as owning slot 2.5.
 *
 * @param {{ title?: string, sequence?: string }[]} stories
 * @returns {{ title: string, sequence: string }[]}
 */
function storiesAsCoveredEntries(stories) {
  if (!Array.isArray(stories)) return []
  return stories.filter((s) => normalizeSequence(s?.sequence) || s?.title).map((s) => ({ title: s.title || '', sequence: s.sequence || '' }))
}

module.exports = {
  MaxStoriesPerBook,
  MaxTitleLength,
  MaxSequenceLength,
  TimeToleranceSeconds,
  sanitizeStories,
  buildReadingOrder,
  storiesAsCoveredEntries
}
