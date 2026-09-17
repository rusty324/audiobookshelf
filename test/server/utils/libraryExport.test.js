const chai = require('chai')
const expect = chai.expect
const libraryExport = require('../../../server/utils/libraryExport')

describe('libraryExport', () => {
  describe('buildExportTitle', () => {
    it('returns the title when there is no subtitle', () => {
      expect(libraryExport.buildExportTitle('Pandora’s Star', null)).to.equal('Pandora’s Star')
    })

    it('joins title and subtitle with an underscore', () => {
      expect(libraryExport.buildExportTitle('Dune', 'Book One')).to.equal('Dune_Book One')
    })

    it('ignores a whitespace-only subtitle', () => {
      expect(libraryExport.buildExportTitle('Dune', '   ')).to.equal('Dune')
    })

    it('trims surrounding whitespace', () => {
      expect(libraryExport.buildExportTitle('  Dune  ', '  Book One  ')).to.equal('Dune_Book One')
    })
  })

  describe('buildExportSeries', () => {
    it('formats name and sequence', () => {
      expect(libraryExport.buildExportSeries([{ name: 'Commonwealth Saga', sequence: '1' }])).to.equal('Commonwealth Saga #1')
    })

    it('uses the last series when there are several', () => {
      const series = [
        { name: 'First Series', sequence: '3' },
        { name: 'Crescent City', sequence: '1' }
      ]
      expect(libraryExport.buildExportSeries(series)).to.equal('Crescent City #1')
    })

    it('omits the sequence when there is none', () => {
      expect(libraryExport.buildExportSeries([{ name: 'Standalone', sequence: '' }])).to.equal('Standalone')
    })

    it('returns an empty string when there are no series', () => {
      expect(libraryExport.buildExportSeries([])).to.equal('')
      expect(libraryExport.buildExportSeries(null)).to.equal('')
    })

    it('preserves a decimal sequence', () => {
      expect(libraryExport.buildExportSeries([{ name: 'Saga', sequence: '2.5' }])).to.equal('Saga #2.5')
    })
  })

  describe('buildExportFormats', () => {
    it('reports an audiobook when there are included audio files', () => {
      expect(libraryExport.buildExportFormats({ audioFiles: [{ exclude: false }] })).to.deep.equal(['audiobook'])
    })

    it('reports an ebook when there is an ebook file', () => {
      expect(libraryExport.buildExportFormats({ ebookFile: { metadata: {} } })).to.deep.equal(['ebook'])
    })

    it('reports both, audiobook first', () => {
      expect(libraryExport.buildExportFormats({ audioFiles: [{}], ebookFile: {} })).to.deep.equal(['audiobook', 'ebook'])
    })

    it('does not count excluded audio files', () => {
      expect(libraryExport.buildExportFormats({ audioFiles: [{ exclude: true }] })).to.deep.equal([])
    })

    it('returns nothing for a book with no files', () => {
      expect(libraryExport.buildExportFormats({})).to.deep.equal([])
    })
  })

  describe('buildExportEntry', () => {
    it('matches the audiobook-only example', () => {
      const entry = libraryExport.buildExportEntry({
        libraryItemId: 'li-1',
        book: {
          title: 'Pandora’s Star',
          authors: [{ name: 'Peter F. Hamilton' }],
          series: [{ name: 'Commonwealth Saga', sequence: '1' }],
          audioFiles: [{}],
          genres: ['Science Fiction']
        }
      })
      expect(entry).to.deep.equal({
        title: 'Pandora’s Star',
        author: 'Peter F. Hamilton',
        series: 'Commonwealth Saga #1',
        formats: ['audiobook'],
        genre: ['Science Fiction']
      })
    })

    it('matches the both-formats example, including the cover path', () => {
      const entry = libraryExport.buildExportEntry({
        libraryItemId: 'li-2',
        book: {
          title: 'House of Earth and Blood',
          authors: [{ name: 'Sarah J. Maas' }],
          series: [{ name: 'Crescent City', sequence: '1' }],
          audioFiles: [{}],
          ebookFile: {},
          coverPath: '/metadata/items/li-2/cover.jpg',
          genres: ['Fantasy']
        }
      })
      expect(entry.formats).to.deep.equal(['audiobook', 'ebook'])
      expect(entry.coverUrl).to.equal('/api/items/li-2/cover')
      expect(entry.genre).to.deep.equal(['Fantasy'])
    })

    it('matches the multi-author, empty-genre example', () => {
      const entry = libraryExport.buildExportEntry({
        libraryItemId: 'li-3',
        book: {
          title: 'Crystal Awakening',
          authors: [{ name: 'Andrew Rowe' }, { name: 'Kayleigh Nicol' }],
          series: [{ name: 'Shattered Legacy', sequence: '1' }],
          ebookFile: {},
          genres: []
        }
      })
      expect(entry).to.deep.equal({
        title: 'Crystal Awakening',
        author: 'Andrew Rowe, Kayleigh Nicol',
        series: 'Shattered Legacy #1',
        formats: ['ebook'],
        genre: []
      })
    })

    it('omits coverUrl when the book has no cover', () => {
      const entry = libraryExport.buildExportEntry({
        libraryItemId: 'li-4',
        book: { title: 'No Cover', authors: [], series: [], audioFiles: [{}], genres: [] }
      })
      expect(entry).to.not.have.property('coverUrl')
    })

    it('skips a book with neither an audiobook nor an ebook', () => {
      const entry = libraryExport.buildExportEntry({
        libraryItemId: 'li-5',
        book: { title: 'Empty', authors: [], series: [], genres: [] }
      })
      expect(entry).to.equal(null)
    })

    it('skips a book whose only audio file is excluded', () => {
      const entry = libraryExport.buildExportEntry({
        libraryItemId: 'li-6',
        book: { title: 'Excluded', authors: [], series: [], audioFiles: [{ exclude: true }], genres: [] }
      })
      expect(entry).to.equal(null)
    })

    it('combines title and subtitle and uses the last of several series', () => {
      const entry = libraryExport.buildExportEntry({
        libraryItemId: 'li-7',
        book: {
          title: 'Main Title',
          subtitle: 'A Subtitle',
          authors: [{ name: 'An Author' }],
          series: [
            { name: 'Old Series', sequence: '9' },
            { name: 'Current Series', sequence: '2' }
          ],
          audioFiles: [{}],
          genres: ['Fantasy', 'Adventure']
        }
      })
      expect(entry.title).to.equal('Main Title_A Subtitle')
      expect(entry.series).to.equal('Current Series #2')
      expect(entry.genre).to.deep.equal(['Fantasy', 'Adventure'])
    })

    it('copies genres rather than sharing the array', () => {
      const genres = ['Fantasy']
      const entry = libraryExport.buildExportEntry({
        libraryItemId: 'li-8',
        book: { title: 'T', authors: [], series: [], audioFiles: [{}], genres }
      })
      entry.genre.push('Mutated')
      expect(genres).to.deep.equal(['Fantasy'])
    })

    it('returns null when there is no book', () => {
      expect(libraryExport.buildExportEntry({ libraryItemId: 'x', book: null })).to.equal(null)
    })
  })
})
