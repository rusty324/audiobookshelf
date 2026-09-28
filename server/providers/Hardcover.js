const axios = require('axios')
const Logger = require('../Logger')
const { mapSeriesBooksToProposals, pickSeriesMatch } = require('../utils/hardcoverSeries')

/**
 * Hardcover (https://hardcover.app) GraphQL provider, used to enumerate the
 * books in a series so gaps in a library can be filled in as placeholders.
 *
 * This is the only provider here that can list a series. The others - Audible,
 * Audnex, Google Books, Open Library, iTunes, FantLab, MusicBrainz - all
 * search by title/author/ASIN and return one book at a time, with its series
 * position attached as a by-product. Goodreads stopped issuing API keys in
 * 2020 and StoryGraph has no public API, so Hardcover is the practical option.
 *
 * Requires a free API token from the user's Hardcover account settings. With
 * no token configured the feature is simply unavailable; nothing else changes.
 */
class Hardcover {
  #responseTimeout = 15000
  _baseUrl = 'https://api.hardcover.app/v1/graphql'

  /** Most books to pull for one series. Longer series exist, but not many. */
  static get MaxBooksPerSeries() {
    return 200
  }

  /** Most series candidates to consider for one name. */
  static get MaxSeriesCandidates() {
    return 10
  }

  constructor() {}

  /**
   * @param {string} token
   * @returns {object}
   */
  buildHeaders(token) {
    return {
      // Hardcover tokens are issued with the "Bearer " prefix already present
      // in some places and not others, so normalize rather than double it up.
      Authorization: /^bearer /i.test(token) ? token : `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }

  /**
   * Execute a GraphQL query.
   *
   * @param {string} query
   * @param {object} variables
   * @param {string} token
   * @param {number} [timeout]
   * @returns {Promise<object|null>} the `data` object, or null on failure
   */
  async request(query, variables, token, timeout = this.#responseTimeout) {
    if (!token) {
      Logger.warn('[Hardcover] No API token configured')
      return null
    }
    try {
      const response = await axios.post(this._baseUrl, { query, variables }, { headers: this.buildHeaders(token), timeout })
      if (response.data?.errors?.length) {
        // GraphQL reports errors with HTTP 200, so this is not caught below
        Logger.error(`[Hardcover] GraphQL error: ${response.data.errors.map((e) => e.message).join('; ')}`)
        return null
      }
      return response.data?.data || null
    } catch (error) {
      const status = error.response?.status
      if (status === 401 || status === 403) {
        Logger.error('[Hardcover] Request rejected - check that the API token is valid')
      } else {
        Logger.error(`[Hardcover] Request failed: ${error.message}`)
      }
      return null
    }
  }

  /**
   * Find a series by name.
   *
   * @param {string} name
   * @param {string} token
   * @param {number} [timeout]
   * @returns {Promise<{id: number, name: string, is_completed: boolean}|null>}
   */
  async findSeries(name, token, timeout) {
    const trimmed = (name || '').trim()
    if (!trimmed) return null

    const query = `
      query FindSeries($name: String!, $limit: Int!) {
        series(where: { name: { _ilike: $name } }, limit: $limit) {
          id
          name
          is_completed
        }
      }
    `
    const data = await this.request(query, { name: trimmed, limit: Hardcover.MaxSeriesCandidates }, token, timeout)
    if (!data) return null
    return pickSeriesMatch(data.series, trimmed)
  }

  /**
   * Books in a series, ordered by position.
   *
   * @param {number} seriesId
   * @param {string} token
   * @param {number} [timeout]
   * @returns {Promise<object[]|null>} raw book_series rows, or null on failure
   */
  async getSeriesBooks(seriesId, token, timeout) {
    const query = `
      query SeriesBooks($seriesId: Int!, $limit: Int!) {
        book_series(
          where: { series_id: { _eq: $seriesId } }
          order_by: { position: asc }
          limit: $limit
        ) {
          position
          compilation
          book {
            id
            title
            subtitle
            release_year
            compilation
            is_partial_book
            cached_contributors
          }
        }
      }
    `
    const data = await this.request(query, { seriesId, limit: Hardcover.MaxBooksPerSeries }, token, timeout)
    if (!data) return null
    return Array.isArray(data.book_series) ? data.book_series : []
  }

  /**
   * Resolve a series name to a list of placeholder proposals.
   *
   * @param {string} seriesName
   * @param {string} token
   * @param {number} [timeout]
   * @returns {Promise<{ series: object, isCompleted: boolean, proposals: object[] }|null>} null when the series could not be resolved
   */
  async getSeriesProposals(seriesName, token, timeout) {
    const series = await this.findSeries(seriesName, token, timeout)
    if (!series) {
      Logger.info(`[Hardcover] No series found matching "${seriesName}"`)
      return null
    }

    const rows = await this.getSeriesBooks(series.id, token, timeout)
    if (!rows) return null

    return {
      series: { id: series.id, name: series.name },
      // Whether the series is finished, so the client can distinguish
      // "this is the whole series" from "more may still be coming"
      isCompleted: !!series.is_completed,
      proposals: mapSeriesBooksToProposals(rows)
    }
  }
}

module.exports = Hardcover
