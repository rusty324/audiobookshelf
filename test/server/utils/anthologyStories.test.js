const chai = require('chai')
const expect = chai.expect

const { sanitizeStories, buildReadingOrder, storiesAsCoveredEntries, MaxStoriesPerBook } = require('../../../server/utils/anthologyStories')

const story = (overrides = {}) => ({
  title: 'The Home Crowd Advantage',
  startTime: 0,
  endTime: 600,
  seriesName: 'Rivers of London',
  sequence: '2.5',
  ...overrides
})

describe('anthologyStories', () => {
  describe('sanitizeStories', () => {
    it('accepts the Tales From The Folly shape: two stories at different sequences in one series', () => {
      const { stories, error } = sanitizeStories([story({ title: 'The Home Crowd Advantage', startTime: 0, endTime: 600, sequence: '2.5' }), story({ title: 'A Dedicated Follower of Fashion', startTime: 600, endTime: 1500, sequence: '4.5' })], { duration: 20000 })
      expect(error).to.be.undefined
      expect(stories.map((s) => s.sequence)).to.deep.equal(['2.5', '4.5'])
    })

    it('trims fields and sorts stories into playback order', () => {
      const { stories } = sanitizeStories([story({ title: '  B  ', startTime: 600, endTime: 900 }), story({ title: 'A', startTime: 0, endTime: 300, seriesName: '  Rivers of London ' })])
      expect(stories.map((s) => s.title)).to.deep.equal(['A', 'B'])
      expect(stories[0].seriesName).to.equal('Rivers of London')
    })

    it('allows a story with no series, which then has no position', () => {
      const { stories, error } = sanitizeStories([story({ seriesName: '', sequence: '' })])
      expect(error).to.be.undefined
      expect(stories[0].seriesName).to.be.null
      expect(stories[0].sequence).to.equal('')
    })

    it('allows a story in a series with no sequence', () => {
      const { stories } = sanitizeStories([story({ sequence: '' })])
      expect(stories[0].seriesName).to.equal('Rivers of London')
      expect(stories[0].sequence).to.equal('')
    })

    it('rejects a sequence without a series', () => {
      expect(sanitizeStories([story({ seriesName: '', sequence: '2.5' })]).error).to.match(/sequence but no series/)
    })

    it('rejects overlapping stories', () => {
      const result = sanitizeStories([story({ title: 'First', startTime: 0, endTime: 600 }), story({ title: 'Second', startTime: 500, endTime: 900 })])
      expect(result.error).to.match(/"First" and "Second" overlap/)
    })

    it('treats stories that merely touch, within tolerance, as not overlapping', () => {
      // Chapter boundaries and durations come from separate probes
      const result = sanitizeStories([story({ startTime: 0, endTime: 600.3 }), story({ startTime: 600, endTime: 900 })])
      expect(result.error).to.be.undefined
    })

    it('rejects a story that ends before it starts, or is empty', () => {
      expect(sanitizeStories([story({ startTime: 600, endTime: 300 })]).error).to.match(/end after it starts/)
      expect(sanitizeStories([story({ startTime: 300, endTime: 300 })]).error).to.match(/end after it starts/)
    })

    it('rejects a negative start and a story running past the end of the book', () => {
      expect(sanitizeStories([story({ startTime: -1, endTime: 10 })]).error).to.match(/before the beginning/)
      expect(sanitizeStories([story({ startTime: 0, endTime: 1000 })], { duration: 900 }).error).to.match(/after the end of the book/)
    })

    it('clamps an end time slightly past the duration to the duration', () => {
      const { stories } = sanitizeStories([story({ startTime: 0, endTime: 900.4 })], { duration: 900 })
      expect(stories[0].endTime).to.equal(900)
    })

    it('does not enforce an end limit when the duration is unknown', () => {
      expect(sanitizeStories([story({ startTime: 0, endTime: 99999 })]).error).to.be.undefined
    })

    it('rejects a missing title, non-numeric times and non-object entries', () => {
      expect(sanitizeStories([story({ title: '   ' })]).error).to.match(/needs a title/)
      expect(sanitizeStories([story({ startTime: 'abc' })]).error).to.match(/start and end time/)
      expect(sanitizeStories(['nope']).error).to.match(/not an object/)
    })

    it('rejects a non-array and too many stories', () => {
      expect(sanitizeStories(null).error).to.match(/must be an array/)
      const many = Array.from({ length: MaxStoriesPerBook + 1 }, (_, i) => story({ startTime: i * 10, endTime: i * 10 + 5 }))
      expect(sanitizeStories(many).error).to.match(/Too many stories/)
    })

    it('accepts an empty list, which stops a book being an anthology', () => {
      expect(sanitizeStories([])).to.deep.equal({ stories: [] })
    })
  })

  describe('buildReadingOrder', () => {
    const books = [
      { libraryItemId: 'b1', title: 'Rivers of London', sequence: '1' },
      { libraryItemId: 'b3', title: 'Whispers Under Ground', sequence: '3' },
      { libraryItemId: 'b2', title: 'Moon Over Soho', sequence: '2' },
      { libraryItemId: 'b5', title: 'Foxglove Summer', sequence: '5' }
    ]
    const stories = [
      { id: 's2', title: 'A Dedicated Follower of Fashion', sequence: '4.5' },
      { id: 's1', title: 'The Home Crowd Advantage', sequence: '2.5' }
    ]

    it('interleaves stories between books by sequence', () => {
      const order = buildReadingOrder({ books, stories })
      expect(order.map((e) => e.sequence)).to.deep.equal(['1', '2', '2.5', '3', '4.5', '5'])
      expect(order.find((e) => e.sequence === '2.5').type).to.equal('story')
    })

    it('includes placeholders in the same order', () => {
      const order = buildReadingOrder({ books, stories, placeholders: [{ id: 'p4', title: 'Broken Homes', sequence: '4' }] })
      expect(order.map((e) => `${e.type}:${e.sequence}`)).to.deep.equal(['book:1', 'book:2', 'story:2.5', 'book:3', 'placeholder:4', 'story:4.5', 'book:5'])
    })

    it('keeps both a book and a story that share a sequence, book first', () => {
      const order = buildReadingOrder({ books: [{ title: 'B', sequence: '7' }], stories: [{ title: 'S', sequence: '7' }] })
      expect(order.map((e) => e.type)).to.deep.equal(['book', 'story'])
    })

    it('puts entries with no sequence last', () => {
      const order = buildReadingOrder({
        books: [
          { title: 'Unnumbered', sequence: '' },
          { title: 'One', sequence: '1' }
        ]
      })
      expect(order.map((e) => e.title)).to.deep.equal(['One', 'Unnumbered'])
    })

    it('returns an empty list for no input', () => {
      expect(buildReadingOrder({})).to.deep.equal([])
    })
  })

  describe('storiesAsCoveredEntries', () => {
    it('reduces stories to the fields placeholder matching uses', () => {
      expect(storiesAsCoveredEntries([{ id: 'x', title: 'T', sequence: '2.5', startTime: 5 }])).to.deep.equal([{ title: 'T', sequence: '2.5' }])
    })

    it('tolerates bad input', () => {
      expect(storiesAsCoveredEntries(null)).to.deep.equal([])
    })
  })
})
