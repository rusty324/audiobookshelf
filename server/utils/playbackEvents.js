/**
 * Pure helpers for the per-item listening log.
 *
 * Kept free of database and request access so they can be unit tested directly.
 */

const EVENT_TYPES = ['play', 'pause', 'seek', 'chapterSkip', 'finished']
const SOURCES = ['web', 'server', 'mobile', 'unknown']

/** A jump landing this close to a chapter start counts as landing on it. */
const CHAPTER_SNAP_TOLERANCE_SECONDS = 2

/** Consecutive seeks closer together than this are merged into one entry. */
const SEEK_COALESCE_WINDOW_MS = 5000

/**
 * Find the chapter containing a given time.
 *
 * @param {{ start: number, end: number, title: string }[]} chapters
 * @param {number} time
 * @returns {{ chapterTitle: string|null, chapterIndex: number|null }}
 */
function resolveChapter(chapters, time) {
  if (!Array.isArray(chapters) || !chapters.length || !Number.isFinite(time)) {
    return { chapterTitle: null, chapterIndex: null }
  }

  const index = chapters.findIndex((chapter) => time >= chapter.start && time < chapter.end)
  if (index < 0) {
    // A time at or past the end of the last chapter belongs to that chapter.
    const lastIndex = chapters.length - 1
    if (time >= chapters[lastIndex].end) {
      return { chapterTitle: chapters[lastIndex].title ?? null, chapterIndex: lastIndex }
    }
    return { chapterTitle: null, chapterIndex: null }
  }

  return { chapterTitle: chapters[index].title ?? null, chapterIndex: index }
}

/**
 * Decide whether a jump is a chapter skip or an ordinary seek.
 *
 * A jump counts as a chapter skip when it lands on a chapter boundary (within
 * a small tolerance) and leaves the chapter it started in. Scrubbing inside the
 * current chapter stays an ordinary seek.
 *
 * @param {{ start: number, end: number, title: string }[]} chapters
 * @param {number} fromTime
 * @param {number} toTime
 * @param {number} [tolerance]
 * @returns {'seek'|'chapterSkip'}
 */
function classifyJump(chapters, fromTime, toTime, tolerance = CHAPTER_SNAP_TOLERANCE_SECONDS) {
  if (!Array.isArray(chapters) || !chapters.length) return 'seek'
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return 'seek'

  const landedOnBoundary = chapters.some((chapter) => Math.abs(toTime - chapter.start) <= tolerance)
  if (!landedOnBoundary) return 'seek'

  const from = resolveChapter(chapters, fromTime)
  const to = resolveChapter(chapters, toTime)
  if (from.chapterIndex === null || to.chapterIndex === null) return 'seek'

  return from.chapterIndex === to.chapterIndex ? 'seek' : 'chapterSkip'
}

/**
 * Clamp a time into the playable range. Returns null when not a usable number.
 *
 * @param {unknown} value
 * @param {number} duration
 * @returns {number|null}
 */
function clampTime(value, duration) {
  const time = Number(value)
  if (!Number.isFinite(time)) return null
  const upperBound = Number.isFinite(duration) && duration > 0 ? duration : Number.MAX_SAFE_INTEGER
  return Math.min(Math.max(time, 0), upperBound)
}

/**
 * Validate and normalize a client-submitted event.
 *
 * Client input is untrusted: unknown event types are rejected and times are
 * clamped to the item's duration rather than stored as given.
 *
 * @param {object} raw
 * @param {{ duration?: number, chapters?: object[], source?: string }} context
 * @returns {object|null} normalized event, or null when unusable
 */
function sanitizeClientEvent(raw, { duration, chapters = [], source = 'web' } = {}) {
  if (!raw || typeof raw !== 'object') return null

  const currentTime = clampTime(raw.currentTime, duration)
  if (currentTime === null) return null

  const fromTime = raw.fromTime === undefined || raw.fromTime === null ? null : clampTime(raw.fromTime, duration)

  let eventType = typeof raw.eventType === 'string' ? raw.eventType : null
  if (!eventType || !EVENT_TYPES.includes(eventType)) return null

  // Re-derive the jump type server-side rather than trusting the client's label.
  if ((eventType === 'seek' || eventType === 'chapterSkip') && fromTime !== null) {
    eventType = classifyJump(chapters, fromTime, currentTime)
  }

  const { chapterTitle, chapterIndex } = resolveChapter(chapters, currentTime)

  return {
    eventType,
    currentTime,
    fromTime: eventType === 'seek' || eventType === 'chapterSkip' ? fromTime : null,
    chapterTitle,
    chapterIndex,
    source: SOURCES.includes(source) ? source : 'unknown',
    createdAt: parseTimestamp(raw.createdAt)
  }
}

/**
 * Accept a client-supplied timestamp only when it is a sane epoch value,
 * otherwise fall back to now.
 *
 * @param {unknown} value
 * @returns {Date}
 */
function parseTimestamp(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return new Date()
  const date = new Date(ms)
  if (Number.isNaN(date.valueOf())) return new Date()
  // Never accept a future timestamp from a client with a skewed clock.
  const now = new Date()
  return date > now ? now : date
}

/**
 * Merge bursts of consecutive seeks into a single entry so that scrubbing does
 * not fill the log. The merged entry keeps where the burst started and where it
 * ended up.
 *
 * @param {object[]} events - chronologically ordered, already sanitized
 * @param {number} [windowMs]
 * @returns {object[]}
 */
function coalesceSeeks(events, windowMs = SEEK_COALESCE_WINDOW_MS) {
  if (!Array.isArray(events) || events.length < 2) return Array.isArray(events) ? [...events] : []

  const isJump = (event) => event.eventType === 'seek' || event.eventType === 'chapterSkip'
  const result = []

  for (const event of events) {
    const previous = result[result.length - 1]
    const mergeable = previous && isJump(previous) && isJump(event) && event.createdAt - previous.createdAt <= windowMs

    if (mergeable) {
      // Extend the previous jump instead of appending a new one.
      previous.currentTime = event.currentTime
      previous.chapterTitle = event.chapterTitle
      previous.chapterIndex = event.chapterIndex
      previous.createdAt = event.createdAt
      // A burst that ends up crossing a chapter boundary is a chapter skip.
      previous.eventType = event.eventType === 'chapterSkip' ? 'chapterSkip' : previous.eventType
    } else {
      result.push({ ...event })
    }
  }

  return result
}

module.exports = {
  EVENT_TYPES,
  SOURCES,
  CHAPTER_SNAP_TOLERANCE_SECONDS,
  SEEK_COALESCE_WINDOW_MS,
  resolveChapter,
  classifyJump,
  clampTime,
  sanitizeClientEvent,
  parseTimestamp,
  coalesceSeeks
}
