const chai = require('chai')
const expect = chai.expect
const playbackEvents = require('../../../server/utils/playbackEvents')

// Three 10 minute chapters
const chapters = [
  { start: 0, end: 600, title: 'Chapter 1' },
  { start: 600, end: 1200, title: 'Chapter 2' },
  { start: 1200, end: 1800, title: 'Chapter 3' }
]
const duration = 1800

describe('playbackEvents', () => {
  describe('resolveChapter', () => {
    it('resolves a time inside a chapter', () => {
      expect(playbackEvents.resolveChapter(chapters, 650)).to.deep.equal({ chapterTitle: 'Chapter 2', chapterIndex: 1 })
    })

    it('treats a chapter start as belonging to that chapter', () => {
      expect(playbackEvents.resolveChapter(chapters, 600)).to.deep.equal({ chapterTitle: 'Chapter 2', chapterIndex: 1 })
    })

    it('resolves a time at or past the end to the last chapter', () => {
      expect(playbackEvents.resolveChapter(chapters, 1800)).to.deep.equal({ chapterTitle: 'Chapter 3', chapterIndex: 2 })
    })

    it('returns nulls when there are no chapters', () => {
      expect(playbackEvents.resolveChapter([], 100)).to.deep.equal({ chapterTitle: null, chapterIndex: null })
    })

    it('returns nulls for a non-numeric time', () => {
      expect(playbackEvents.resolveChapter(chapters, undefined)).to.deep.equal({ chapterTitle: null, chapterIndex: null })
    })
  })

  describe('classifyJump', () => {
    it('classifies a jump onto the next chapter start as a chapter skip', () => {
      expect(playbackEvents.classifyJump(chapters, 300, 600)).to.equal('chapterSkip')
    })

    it('allows a small tolerance around the boundary', () => {
      expect(playbackEvents.classifyJump(chapters, 300, 601)).to.equal('chapterSkip')
    })

    it('classifies scrubbing within the same chapter as a seek', () => {
      expect(playbackEvents.classifyJump(chapters, 100, 300)).to.equal('seek')
    })

    it('classifies a jump that lands mid-chapter as a seek', () => {
      expect(playbackEvents.classifyJump(chapters, 100, 900)).to.equal('seek')
    })

    it('falls back to seek when the item has no chapters', () => {
      expect(playbackEvents.classifyJump([], 100, 600)).to.equal('seek')
    })
  })

  describe('clampTime', () => {
    it('clamps a negative time to zero', () => {
      expect(playbackEvents.clampTime(-5, duration)).to.equal(0)
    })

    it('clamps beyond the duration back to the duration', () => {
      expect(playbackEvents.clampTime(9999, duration)).to.equal(duration)
    })

    it('returns null for a non-numeric value', () => {
      expect(playbackEvents.clampTime('abc', duration)).to.equal(null)
    })
  })

  describe('sanitizeClientEvent', () => {
    it('rejects an unknown event type', () => {
      const result = playbackEvents.sanitizeClientEvent({ eventType: 'explode', currentTime: 10 }, { duration, chapters })
      expect(result).to.equal(null)
    })

    it('rejects an event with no usable time', () => {
      const result = playbackEvents.sanitizeClientEvent({ eventType: 'play', currentTime: 'soon' }, { duration, chapters })
      expect(result).to.equal(null)
    })

    it('normalizes a play event and resolves its chapter', () => {
      const result = playbackEvents.sanitizeClientEvent({ eventType: 'play', currentTime: 650 }, { duration, chapters })
      expect(result.eventType).to.equal('play')
      expect(result.currentTime).to.equal(650)
      expect(result.chapterTitle).to.equal('Chapter 2')
      expect(result.chapterIndex).to.equal(1)
      expect(result.fromTime).to.equal(null)
    })

    it('clamps an out-of-range time rather than storing it as given', () => {
      const result = playbackEvents.sanitizeClientEvent({ eventType: 'play', currentTime: 99999 }, { duration, chapters })
      expect(result.currentTime).to.equal(duration)
    })

    it('re-derives the jump type instead of trusting the client label', () => {
      // Client claims a plain seek, but it lands on a chapter boundary from another chapter
      const result = playbackEvents.sanitizeClientEvent({ eventType: 'seek', currentTime: 600, fromTime: 300 }, { duration, chapters })
      expect(result.eventType).to.equal('chapterSkip')
      expect(result.fromTime).to.equal(300)
    })

    it('downgrades a falsely claimed chapter skip to a seek', () => {
      const result = playbackEvents.sanitizeClientEvent({ eventType: 'chapterSkip', currentTime: 300, fromTime: 100 }, { duration, chapters })
      expect(result.eventType).to.equal('seek')
    })

    it('drops fromTime on non-jump events', () => {
      const result = playbackEvents.sanitizeClientEvent({ eventType: 'pause', currentTime: 100, fromTime: 50 }, { duration, chapters })
      expect(result.fromTime).to.equal(null)
    })

    it('marks an unknown source rather than storing it verbatim', () => {
      const result = playbackEvents.sanitizeClientEvent({ eventType: 'play', currentTime: 10 }, { duration, chapters, source: 'haxx' })
      expect(result.source).to.equal('unknown')
    })

    it('rejects a future client timestamp', () => {
      const future = Date.now() + 1000 * 60 * 60 * 24
      const result = playbackEvents.sanitizeClientEvent({ eventType: 'play', currentTime: 10, createdAt: future }, { duration, chapters })
      expect(result.createdAt.valueOf()).to.be.at.most(Date.now())
    })
  })

  describe('coalesceSeeks', () => {
    const base = Date.now()
    const jump = (offsetMs, from, to, eventType = 'seek') => ({
      eventType,
      fromTime: from,
      currentTime: to,
      chapterTitle: null,
      chapterIndex: null,
      source: 'web',
      createdAt: new Date(base + offsetMs)
    })

    it('merges a burst of seeks into a single entry', () => {
      const merged = playbackEvents.coalesceSeeks([jump(0, 10, 20), jump(500, 20, 30), jump(1000, 30, 40)])
      expect(merged).to.have.length(1)
      expect(merged[0].fromTime).to.equal(10)
      expect(merged[0].currentTime).to.equal(40)
    })

    it('keeps seeks separated by more than the window', () => {
      const merged = playbackEvents.coalesceSeeks([jump(0, 10, 20), jump(60000, 20, 30)])
      expect(merged).to.have.length(2)
    })

    it('promotes a merged burst that ends on a chapter boundary to a chapter skip', () => {
      const merged = playbackEvents.coalesceSeeks([jump(0, 10, 20), jump(500, 20, 600, 'chapterSkip')])
      expect(merged).to.have.length(1)
      expect(merged[0].eventType).to.equal('chapterSkip')
    })

    it('does not merge across a play or pause', () => {
      const play = { ...jump(500, 0, 0), eventType: 'play', fromTime: null }
      const merged = playbackEvents.coalesceSeeks([jump(0, 10, 20), play, jump(1000, 20, 30)])
      expect(merged).to.have.length(3)
    })

    it('does not mutate the input events', () => {
      const events = [jump(0, 10, 20), jump(500, 20, 30)]
      playbackEvents.coalesceSeeks(events)
      expect(events[0].currentTime).to.equal(20)
    })

    it('handles empty and single-event input', () => {
      expect(playbackEvents.coalesceSeeks([])).to.deep.equal([])
      expect(playbackEvents.coalesceSeeks([jump(0, 1, 2)])).to.have.length(1)
    })
  })
})
