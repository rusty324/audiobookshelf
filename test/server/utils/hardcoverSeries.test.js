const chai = require('chai')
const expect = chai.expect

const { parseContributors, formatPosition, isOfferable, mapSeriesBooksToProposals, filterNewProposals, pickSeriesMatch } = require('../../../server/utils/hardcoverSeries')

/** Minimal book_series row in the shape the Hardcover schema describes. */
const row = (position, title, extra = {}) => ({
  position,
  compilation: extra.rowCompilation || false,
  book: {
    id: extra.id ?? Math.floor(Math.random() * 100000),
    title,
    subtitle: extra.subtitle ?? null,
    release_year: extra.release_year ?? null,
    compilation: extra.compilation || false,
    is_partial_book: extra.is_partial_book || false,
    cached_contributors: extra.cached_contributors ?? null
  }
})

describe('hardcoverSeries', () => {
  describe('parseContributors', () => {
    it('reads the nested author shape', () => {
      expect(parseContributors([{ author: { name: 'Jim Butcher' } }])).to.equal('Jim Butcher')
    })

    it('reads the flat name shape', () => {
      expect(parseContributors([{ name: 'Jim Butcher' }])).to.equal('Jim Butcher')
    })

    it('reads a plain array of strings', () => {
      expect(parseContributors(['Jim Butcher'])).to.equal('Jim Butcher')
    })

    it('parses a JSON string', () => {
      expect(parseContributors('[{"author":{"name":"Jim Butcher"}}]')).to.equal('Jim Butcher')
    })

    it('falls back to the raw string when it is not JSON', () => {
      expect(parseContributors('Jim Butcher')).to.equal('Jim Butcher')
    })

    it('joins and de-duplicates multiple contributors', () => {
      expect(parseContributors([{ name: 'A' }, { name: 'B' }, { name: 'A' }])).to.equal('A, B')
    })

    it('returns null rather than throwing on an unrecognized shape', () => {
      expect(parseContributors(null)).to.be.null
      expect(parseContributors([])).to.be.null
      expect(parseContributors([{ unexpected: true }])).to.be.null
      expect(parseContributors(42)).to.be.null
    })
  })

  describe('formatPosition', () => {
    it('drops the decimal from whole numbers', () => {
      expect(formatPosition(1)).to.equal('1')
      expect(formatPosition(1.0)).to.equal('1')
      expect(formatPosition('2')).to.equal('2')
    })

    it('preserves a novella position', () => {
      expect(formatPosition(1.5)).to.equal('1.5')
    })

    it('returns empty string when there is no position', () => {
      expect(formatPosition(null)).to.equal('')
      expect(formatPosition(undefined)).to.equal('')
      expect(formatPosition('')).to.equal('')
      expect(formatPosition('abc')).to.equal('')
    })
  })

  describe('isOfferable', () => {
    it('accepts an ordinary entry', () => {
      expect(isOfferable(row(1, 'Storm Front'))).to.be.true
    })

    it('rejects a box set flagged on the series row', () => {
      expect(isOfferable(row(1, 'Dresden Files 1-3', { rowCompilation: true }))).to.be.false
    })

    it('rejects a box set flagged on the book', () => {
      expect(isOfferable(row(1, 'Dresden Files 1-3', { compilation: true }))).to.be.false
    })

    it('rejects a partial book', () => {
      expect(isOfferable(row(1, 'Storm Front Part 1', { is_partial_book: true }))).to.be.false
    })

    it('rejects an entry with no usable title', () => {
      expect(isOfferable(row(1, '   '))).to.be.false
      expect(isOfferable({ position: 1, book: null })).to.be.false
      expect(isOfferable(null)).to.be.false
    })
  })

  describe('mapSeriesBooksToProposals', () => {
    it('maps fields and sorts into series order', () => {
      const rows = [row(2, 'Fool Moon'), row(1, 'Storm Front', { subtitle: 'A Novel', release_year: 2000, cached_contributors: [{ name: 'Jim Butcher' }] })]
      const result = mapSeriesBooksToProposals(rows)
      expect(result).to.have.lengthOf(2)
      expect(result[0]).to.include({
        title: 'Storm Front',
        subtitle: 'A Novel',
        sequence: '1',
        authorName: 'Jim Butcher',
        releaseYear: 2000,
        source: 'hardcover'
      })
      expect(result[1].title).to.equal('Fool Moon')
    })

    it('places a novella between its neighbours', () => {
      const result = mapSeriesBooksToProposals([row(2, 'B'), row(1.5, 'Novella'), row(1, 'A')])
      expect(result.map((p) => p.sequence)).to.deep.equal(['1', '1.5', '2'])
    })

    it('strips box sets out of the series listing', () => {
      const result = mapSeriesBooksToProposals([row(1, 'Storm Front'), row(1, 'Books 1-3', { compilation: true })])
      expect(result.map((p) => p.title)).to.deep.equal(['Storm Front'])
    })

    it('de-duplicates two editions sharing a position', () => {
      const result = mapSeriesBooksToProposals([row(1, 'Storm Front', { id: 1 }), row(1, 'Storm Front', { id: 2 })])
      expect(result).to.have.lengthOf(1)
    })

    it('keeps entries that have no position', () => {
      const result = mapSeriesBooksToProposals([row(null, 'Unplaced Short Story')])
      expect(result).to.have.lengthOf(1)
      expect(result[0].sequence).to.equal('')
    })

    it('carries the book id through as sourceId', () => {
      const result = mapSeriesBooksToProposals([row(1, 'Storm Front', { id: 4242 })])
      expect(result[0].sourceId).to.equal('4242')
    })

    it('returns an empty array for invalid input', () => {
      expect(mapSeriesBooksToProposals(null)).to.deep.equal([])
      expect(mapSeriesBooksToProposals([])).to.deep.equal([])
    })
  })

  describe('filterNewProposals', () => {
    const proposals = [
      { title: 'Storm Front', sequence: '1' },
      { title: 'Fool Moon', sequence: '2' },
      { title: 'Turn Coat', sequence: '11' }
    ]

    it('drops books already in the library', () => {
      const result = filterNewProposals(proposals, [{ title: 'Storm Front', sequence: '1' }], [])
      expect(result.map((p) => p.sequence)).to.deep.equal(['2', '11'])
    })

    it('drops books already recorded as placeholders', () => {
      const result = filterNewProposals(proposals, [], [{ title: 'Turn Coat', sequence: '11' }])
      expect(result.map((p) => p.sequence)).to.deep.equal(['1', '2'])
    })

    it('drops both at once', () => {
      const result = filterNewProposals(proposals, [{ title: 'Storm Front', sequence: '1' }], [{ title: 'Turn Coat', sequence: '11' }])
      expect(result.map((p) => p.sequence)).to.deep.equal(['2'])
    })

    it('returns everything when the library and list are empty', () => {
      expect(filterNewProposals(proposals, [], [])).to.have.lengthOf(3)
    })

    it('tolerates missing arguments', () => {
      expect(filterNewProposals(proposals, null, null)).to.have.lengthOf(3)
      expect(filterNewProposals(null, [], [])).to.deep.equal([])
    })
  })

  describe('pickSeriesMatch', () => {
    it('prefers an exact name match over an earlier partial one', () => {
      const candidates = [{ name: 'Dune Chronicles' }, { name: 'Dune' }]
      expect(pickSeriesMatch(candidates, 'Dune').name).to.equal('Dune')
    })

    it('ignores case and surrounding whitespace', () => {
      expect(pickSeriesMatch([{ name: 'The Dresden Files' }], '  the dresden files ').name).to.equal('The Dresden Files')
    })

    it('falls back to the first candidate when nothing matches exactly', () => {
      const candidates = [{ name: 'Dune Chronicles' }, { name: 'Dune Universe' }]
      expect(pickSeriesMatch(candidates, 'Dune').name).to.equal('Dune Chronicles')
    })

    it('returns null when there is nothing to pick', () => {
      expect(pickSeriesMatch([], 'Dune')).to.be.null
      expect(pickSeriesMatch(null, 'Dune')).to.be.null
      expect(pickSeriesMatch([{ name: 'Dune' }], '')).to.be.null
    })
  })
})
