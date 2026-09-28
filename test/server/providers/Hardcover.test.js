const http = require('http')
const chai = require('chai')
const expect = chai.expect

const Hardcover = require('../../../server/providers/Hardcover')

/**
 * The real Hardcover API cannot be reached from the environment this was
 * written in, so these tests stand a local server in its place. They cover
 * everything up to the wire - auth header, query variables, GraphQL error
 * handling, transport failures - but they cannot confirm that Hardcover's
 * live schema matches the queries. That needs a run against the real API.
 */
describe('Hardcover provider', () => {
  let server
  let baseUrl
  let lastRequest
  /** @type {(body: object) => {status: number, body: object}} */
  let respond

  before((done) => {
    server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => {
        lastRequest = { headers: req.headers, body: JSON.parse(raw || '{}') }
        const { status, body } = respond(lastRequest.body)
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(body))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/v1/graphql`
      done()
    })
  })

  after(() => server.close())

  /** @returns {Hardcover} */
  const provider = () => {
    const p = new Hardcover()
    p._baseUrl = baseUrl
    return p
  }

  beforeEach(() => {
    lastRequest = null
    respond = () => ({ status: 200, body: { data: {} } })
  })

  describe('authentication', () => {
    it('sends a bearer token', async () => {
      respond = () => ({ status: 200, body: { data: { series: [] } } })
      await provider().findSeries('Dune', 'abc123')
      expect(lastRequest.headers.authorization).to.equal('Bearer abc123')
    })

    it('does not double up a token that already carries the prefix', async () => {
      respond = () => ({ status: 200, body: { data: { series: [] } } })
      await provider().findSeries('Dune', 'Bearer abc123')
      expect(lastRequest.headers.authorization).to.equal('Bearer abc123')
    })

    it('makes no request at all without a token', async () => {
      const result = await provider().findSeries('Dune', '')
      expect(result).to.be.null
      expect(lastRequest).to.be.null
    })
  })

  describe('findSeries', () => {
    it('passes the series name as a variable rather than inlining it', async () => {
      respond = () => ({ status: 200, body: { data: { series: [{ id: 1, name: 'Dune', is_completed: true }] } } })
      await provider().findSeries('Dune', 'token')
      expect(lastRequest.body.variables.name).to.equal('Dune')
      expect(lastRequest.body.query).to.include('$name: String!')
    })

    it('returns the exact match rather than the first result', async () => {
      respond = () => ({
        status: 200,
        body: {
          data: {
            series: [
              { id: 1, name: 'Dune Chronicles' },
              { id: 2, name: 'Dune' }
            ]
          }
        }
      })
      const result = await provider().findSeries('Dune', 'token')
      expect(result.id).to.equal(2)
    })

    it('returns null for an empty name without calling out', async () => {
      const result = await provider().findSeries('   ', 'token')
      expect(result).to.be.null
      expect(lastRequest).to.be.null
    })
  })

  describe('error handling', () => {
    it('treats a GraphQL error payload as a failure despite HTTP 200', async () => {
      respond = () => ({ status: 200, body: { errors: [{ message: 'field not found' }] } })
      const result = await provider().findSeries('Dune', 'token')
      expect(result).to.be.null
    })

    it('returns null on an auth rejection', async () => {
      respond = () => ({ status: 401, body: { message: 'unauthorized' } })
      const result = await provider().findSeries('Dune', 'token')
      expect(result).to.be.null
    })

    it('returns null on a server error', async () => {
      respond = () => ({ status: 500, body: { message: 'boom' } })
      const result = await provider().getSeriesBooks(1, 'token')
      expect(result).to.be.null
    })
  })

  describe('getSeriesProposals', () => {
    it('resolves a name to filtered, ordered proposals', async () => {
      respond = (body) => {
        if (body.query.includes('FindSeries')) {
          return { status: 200, body: { data: { series: [{ id: 7, name: 'The Dresden Files', is_completed: false }] } } }
        }
        return {
          status: 200,
          body: {
            data: {
              book_series: [
                { position: 2, compilation: false, book: { id: 2, title: 'Fool Moon', cached_contributors: [{ name: 'Jim Butcher' }] } },
                { position: 1, compilation: false, book: { id: 1, title: 'Storm Front', cached_contributors: [{ name: 'Jim Butcher' }] } },
                { position: 1, compilation: true, book: { id: 99, title: 'Books 1-3' } }
              ]
            }
          }
        }
      }
      const result = await provider().getSeriesProposals('The Dresden Files', 'token')
      expect(result.series.id).to.equal(7)
      expect(result.isCompleted).to.be.false
      expect(result.proposals.map((p) => p.title)).to.deep.equal(['Storm Front', 'Fool Moon'])
      expect(lastRequest.body.variables.seriesId).to.equal(7)
    })

    it('reports a completed series', async () => {
      respond = (body) => {
        if (body.query.includes('FindSeries')) {
          return { status: 200, body: { data: { series: [{ id: 7, name: 'Done', is_completed: true }] } } }
        }
        return { status: 200, body: { data: { book_series: [] } } }
      }
      const result = await provider().getSeriesProposals('Done', 'token')
      expect(result.isCompleted).to.be.true
      expect(result.proposals).to.deep.equal([])
    })

    it('returns null when the series is not found, without fetching books', async () => {
      respond = () => ({ status: 200, body: { data: { series: [] } } })
      const result = await provider().getSeriesProposals('Nope', 'token')
      expect(result).to.be.null
      expect(lastRequest.body.query).to.include('FindSeries')
    })
  })
})
