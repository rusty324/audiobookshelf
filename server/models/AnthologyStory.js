const { DataTypes, Model } = require('sequelize')

/**
 * A story inside an anthology book that has its own place in a series.
 *
 * A book's series entries are matched by series name and hold one sequence
 * each (see Book.updateSeriesFromRequest), so an anthology cannot sit at both
 * 2.5 and 4.5 in the same series through the normal series field. Stories
 * carry those positions instead, each pointing at a time range of the book.
 *
 * A separate table rather than new columns on books: sequelize.sync()
 * creates missing tables on this fork, but never adds columns to existing
 * ones, and migrations are version gated.
 *
 * A book is an anthology exactly when it has stories, so there is no
 * separate flag to keep in step.
 */
class AnthologyStory extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {UUIDV4} */
    this.id
    /** @type {UUIDV4} */
    this.bookId
    /** @type {UUIDV4} */
    this.seriesId
    /** @type {string} */
    this.title
    /** @type {number} seconds */
    this.startTime
    /** @type {number} seconds */
    this.endTime
    /** @type {string} */
    this.sequence
    /** @type {Date} */
    this.createdAt
    /** @type {Date} */
    this.updatedAt
  }

  /**
   * A book's stories in playback order, with their series.
   *
   * @param {string} bookId
   * @returns {Promise<AnthologyStory[]>}
   */
  static getForBook(bookId) {
    return this.findAll({
      where: { bookId },
      include: { model: this.sequelize.models.series, attributes: ['id', 'name'] },
      order: [['startTime', 'ASC']]
    })
  }

  toJSONForClient() {
    return {
      id: this.id,
      bookId: this.bookId,
      title: this.title,
      startTime: this.startTime,
      endTime: this.endTime,
      sequence: this.sequence || '',
      series: this.series ? { id: this.series.id, name: this.series.name } : null
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
        startTime: DataTypes.FLOAT,
        endTime: DataTypes.FLOAT,
        sequence: DataTypes.STRING
      },
      {
        sequelize,
        modelName: 'anthologyStory',
        indexes: [
          { name: 'anthology_stories_book', fields: ['bookId'] },
          { name: 'anthology_stories_series', fields: ['seriesId'] }
        ]
      }
    )

    const { book, series } = sequelize.models

    // Deleting the book deletes its stories
    book.hasMany(AnthologyStory, { onDelete: 'CASCADE' })
    AnthologyStory.belongsTo(book)

    // Deleting a series keeps the story, just without a series position
    series.hasMany(AnthologyStory, { onDelete: 'SET NULL' })
    AnthologyStory.belongsTo(series)
  }
}

module.exports = AnthologyStory
