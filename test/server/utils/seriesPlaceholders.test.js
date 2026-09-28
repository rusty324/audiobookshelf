const chai = require('chai')
const expect = chai.expect

const { normalizeSequence, normalizeTitle, compareSequences, isFulfilled, filterUnfulfilled, sanitizePlaceholderInput, conflictsWithLibrary, isDuplicate, MaxTitleLength, MaxSequenceLength } = require('../../../server/utils/seriesPlaceholders')

describe('seriesPlaceholders', () => {
  describe('normalizeSequence', () => {
    it('treats padded and plain numbers as the same slot', () => {
      expect(normalizeSequence('01')).to.equal('1')
      expect(normalizeSequence('1')).to.equal('1')
      expect(normalizeSequence(1)).to.equal('1')
    })

    it('normalizes decimal sequences used for novellas', () => {
      expect(normalizeSequence('1.50')).to.equal('1.5')
      expect(normalizeSequence('1.5')).to.equal('1.5')
    })

    it('trims surrounding whitespace', () => {
      expect(normalizeSequence('  7  ')).to.equal('7')
    })

    it('lowercases non-numeric sequences rather than discarding them', () => {
      expect(normalizeSequence('Book Two')).to.equal('book two')
    })

    it('does not collapse a partially numeric string onto a numeric slot', () => {
      // parseFloat('1abc') would be 1; Number() gives NaN, which is what we want
      expect(normalizeSequence('1abc')).to.equal('1abc')
    })

    it('returns empty string for missing values', () => {
      expect(normalizeSequence(null)).to.equal('')
      expect(normalizeSequence(undefined)).to.equal('')
      expect(normalizeSequence('')).to.equal('')
      expect(normalizeSequence('   ')).to.equal('')
    })
  })

  describe('normalizeTitle', () => {
    it('ignores case, punctuation and extra spacing', () => {
      expect(normalizeTitle('Storm Front')).to.equal('storm front')
      expect(normalizeTitle('STORM  FRONT!')).to.equal('storm front')
      expect(normalizeTitle('Storm-Front: A Novel')).to.equal('storm front a novel')
    })

    it('returns empty string for missing values', () => {
      expect(normalizeTitle(null)).to.equal('')
      expect(normalizeTitle('')).to.equal('')
    })
  })

  describe('compareSequences', () => {
    it('orders numerically rather than lexically', () => {
      const sorted = ['10', '2', '1'].sort(compareSequences)
      expect(sorted).to.deep.equal(['1', '2', '10'])
    })

    it('places a novella between its neighbours', () => {
      const sorted = ['2', '1.5', '1'].sort(compareSequences)
      expect(sorted).to.deep.equal(['1', '1.5', '2'])
    })

    it('sorts numeric sequences ahead of non-numeric ones', () => {
      expect(compareSequences('1', 'prequel')).to.be.below(0)
      expect(compareSequences('prequel', '1')).to.be.above(0)
    })

    it('sorts entries with no sequence last', () => {
      const sorted = ['', '2', '1'].sort(compareSequences)
      expect(sorted).to.deep.equal(['1', '2', ''])
    })

    it('treats equal sequences as equal', () => {
      expect(compareSequences('3', '03')).to.equal(0)
    })
  })

  describe('isFulfilled', () => {
    const booksInSeries = [
      { sequence: '1', title: 'Storm Front' },
      { sequence: '2', title: 'Fool Moon' },
      { sequence: '10', title: 'Small Favor' }
    ]

    it('matches on sequence', () => {
      expect(isFulfilled({ sequence: '2', title: 'Something Else' }, booksInSeries)).to.be.true
    })

    it('matches a padded sequence against a plain one', () => {
      expect(isFulfilled({ sequence: '02', title: 'Something Else' }, booksInSeries)).to.be.true
    })

    it('matches on title when the sequence does not line up', () => {
      expect(isFulfilled({ sequence: '99', title: 'small favor' }, booksInSeries)).to.be.true
    })

    it('does not match a genuine gap', () => {
      expect(isFulfilled({ sequence: '11', title: 'Turn Coat' }, booksInSeries)).to.be.false
    })

    it('does not match on empty sequence alone', () => {
      // Two entries both lacking a sequence are not the same book
      expect(isFulfilled({ sequence: '', title: 'Turn Coat' }, [{ sequence: '', title: 'Storm Front' }])).to.be.false
    })

    it('returns false when the library has no books in the series', () => {
      expect(isFulfilled({ sequence: '1', title: 'Storm Front' }, [])).to.be.false
      expect(isFulfilled({ sequence: '1', title: 'Storm Front' }, null)).to.be.false
    })
  })

  describe('filterUnfulfilled', () => {
    it('drops covered entries and sorts what is left into series order', () => {
      const booksInSeries = [
        { sequence: '1', title: 'Storm Front' },
        { sequence: '12', title: 'Changes' }
      ]
      const placeholders = [
        { sequence: '12', title: 'Changes' },
        { sequence: '11', title: 'Turn Coat' },
        { sequence: '1', title: 'Storm Front' },
        { sequence: '2', title: 'Fool Moon' }
      ]
      const result = filterUnfulfilled(placeholders, booksInSeries)
      expect(result.map((p) => p.sequence)).to.deep.equal(['2', '11'])
    })

    it('returns everything sorted when the library has nothing', () => {
      const placeholders = [
        { sequence: '10', title: 'B' },
        { sequence: '2', title: 'A' }
      ]
      const result = filterUnfulfilled(placeholders, [])
      expect(result.map((p) => p.sequence)).to.deep.equal(['2', '10'])
    })

    it('returns an empty array for invalid input', () => {
      expect(filterUnfulfilled(null, [])).to.deep.equal([])
    })
  })

  describe('sanitizePlaceholderInput', () => {
    it('accepts a normal entry and trims it', () => {
      const result = sanitizePlaceholderInput({ title: '  Turn Coat  ', sequence: ' 11 ', authorName: ' Jim Butcher ' })
      expect(result).to.deep.equal({
        title: 'Turn Coat',
        sequence: '11',
        subtitle: null,
        authorName: 'Jim Butcher',
        source: 'manual'
      })
    })

    it('allows an entry with no sequence, for a book whose position is unknown', () => {
      const result = sanitizePlaceholderInput({ title: 'Untitled Dresden 18' })
      expect(result.sequence).to.equal('')
      expect(result.title).to.equal('Untitled Dresden 18')
    })

    it('keeps a known source and defaults an unknown one to manual', () => {
      expect(sanitizePlaceholderInput({ title: 'X', source: 'hardcover' }).source).to.equal('hardcover')
      expect(sanitizePlaceholderInput({ title: 'X', source: 'wat' }).source).to.equal('manual')
    })

    it('rejects a missing or blank title', () => {
      expect(sanitizePlaceholderInput({ sequence: '1' })).to.be.null
      expect(sanitizePlaceholderInput({ title: '   ' })).to.be.null
      expect(sanitizePlaceholderInput({ title: 42 })).to.be.null
    })

    it('rejects oversized fields', () => {
      expect(sanitizePlaceholderInput({ title: 'a'.repeat(MaxTitleLength + 1) })).to.be.null
      expect(sanitizePlaceholderInput({ title: 'ok', sequence: '1'.repeat(MaxSequenceLength + 1) })).to.be.null
    })

    it('rejects non-object input', () => {
      expect(sanitizePlaceholderInput(null)).to.be.null
      expect(sanitizePlaceholderInput('title')).to.be.null
    })

    it('coerces a numeric sequence to a string', () => {
      expect(sanitizePlaceholderInput({ title: 'X', sequence: 11 }).sequence).to.equal('11')
    })
  })

  describe('conflictsWithLibrary', () => {
    it('rejects a placeholder for a book already held', () => {
      const books = [{ sequence: '1', title: 'Storm Front' }]
      expect(conflictsWithLibrary({ sequence: '1', title: 'Whatever' }, books)).to.be.true
    })

    it('allows a placeholder for a genuine gap', () => {
      const books = [{ sequence: '1', title: 'Storm Front' }]
      expect(conflictsWithLibrary({ sequence: '2', title: 'Fool Moon' }, books)).to.be.false
    })
  })

  describe('isDuplicate', () => {
    const existing = [{ sequence: '11', title: 'Turn Coat' }]

    it('detects the same sequence', () => {
      expect(isDuplicate({ sequence: '11', title: 'Different Title' }, existing)).to.be.true
    })

    it('detects the same title', () => {
      expect(isDuplicate({ sequence: '99', title: 'turn coat' }, existing)).to.be.true
    })

    it('allows a different entry', () => {
      expect(isDuplicate({ sequence: '12', title: 'Changes' }, existing)).to.be.false
    })

    it('does not treat two unsequenced entries as duplicates of each other', () => {
      const unsequenced = [{ sequence: '', title: 'Unknown Book A' }]
      expect(isDuplicate({ sequence: '', title: 'Unknown Book B' }, unsequenced)).to.be.false
    })

    it('handles an empty existing list', () => {
      expect(isDuplicate({ sequence: '1', title: 'X' }, [])).to.be.false
      expect(isDuplicate({ sequence: '1', title: 'X' }, null)).to.be.false
    })
  })
})
