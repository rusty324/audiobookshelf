const { DataTypes, Model } = require('sequelize')

/**
 * A book that belongs to a series but is not in the library, recorded so the
 * gaps in a series are visible on the series page.
 *
 * Deliberately a separate table rather than a flag on libraryItems:
 *  - the scanner only walks libraryItems, so a placeholder can never be marked
 *    isMissing or swept up by "remove items with issues"
 *  - adding a table works on this fork, where adding a column does not:
 *    sequelize.sync({ alter: false }) creates missing tables but never adds
 *    columns, and migrations are version gated
 *
 * Placeholders are library metadata, not per-user state, so they are shared by
 * every user who can see the series.
 */
class SeriesPlaceholder extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {UUIDV4} */
    this.id
    /** @type {UUIDV4} */
    this.seriesId
    /** @type {string} */
    this.title
    /** @type {string} */
    this.subtitle
    /** @type {string} */
    this.sequence
    /** @type {string} */
    this.authorName
    /** @type {string} */
    this.source
    /** @type {string} */
    this.sourceId
    /** @type {Date} */
    this.createdAt
    /** @type {Date} */
    this.updatedAt
  }

  /**
   * All placeholders for a series, in series order.
   *
   * Sorting is done in JS rather than SQL because sequences are free-text
   * strings ("1", "01", "1.5", "Book 2") and SQL would order them lexically,
   * putting 10 before 2.
   *
   * @param {string} seriesId
   * @returns {Promise<SeriesPlaceholder[]>}
   */
  static async getForSeries(seriesId) {
    const { compareSequences } = require('../utils/seriesPlaceholders')
    const placeholders = await this.findAll({ where: { seriesId } })
    return placeholders.sort((a, b) => compareSequences(a.sequence, b.sequence))
  }

  toJSONForClient() {
    return {
      id: this.id,
      seriesId: this.seriesId,
      title: this.title,
      subtitle: this.subtitle || null,
      sequence: this.sequence || '',
      authorName: this.authorName || null,
      source: this.source,
      createdAt: this.createdAt
    }
  }

  /**
   * Initialize model
   * @param {import('../Database').sequelize} sequelize
   */
  static init(sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        title: DataTypes.STRING,
        subtitle: DataTypes.STRING,
        sequence: DataTypes.STRING,
        authorName: DataTypes.STRING,
        source: DataTypes.STRING,
        sourceId: DataTypes.STRING
      },
      {
        sequelize,
        modelName: 'seriesPlaceholder',
        indexes: [
          {
            name: 'series_placeholders_series',
            fields: ['seriesId']
          }
        ]
      }
    )

    const { series } = sequelize.models
    series.hasMany(SeriesPlaceholder, {
      onDelete: 'CASCADE'
    })
    SeriesPlaceholder.belongsTo(series)
  }
}

module.exports = SeriesPlaceholder
