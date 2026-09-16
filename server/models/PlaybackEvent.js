const { DataTypes, Model, Op } = require('sequelize')

/**
 * Discrete playback actions (play, pause, seek, chapter skip) used to build the
 * per-item listening log shown on the book page.
 *
 * Events come from two places:
 *  - the server, at playback session boundaries, which covers every client
 *    including the mobile apps
 *  - the web player, which adds finer-grained seek and chapter-skip events
 *
 * `source` records which, so the UI can be honest about what it can and cannot see.
 */
class PlaybackEvent extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {UUIDV4} */
    this.id
    /** @type {UUIDV4} */
    this.userId
    /** @type {UUIDV4} */
    this.mediaItemId
    /** @type {string} */
    this.mediaItemType
    /** @type {UUIDV4} */
    this.libraryItemId
    /** @type {UUIDV4} */
    this.playbackSessionId
    /** @type {string} */
    this.eventType
    /** @type {number} */
    this.currentTime
    /** @type {number} */
    this.fromTime
    /** @type {string} */
    this.chapterTitle
    /** @type {number} */
    this.chapterIndex
    /** @type {string} */
    this.source
    /** @type {Date} */
    this.createdAt
    /** @type {Date} */
    this.updatedAt
  }

  /** Event types accepted from clients and written by the server. */
  static get EventTypes() {
    return ['play', 'pause', 'seek', 'chapterSkip', 'finished']
  }

  /** Where an event was captured. */
  static get Sources() {
    return ['web', 'server', 'mobile', 'unknown']
  }

  /**
   * Default maximum number of events retained per user per media item.
   * Scrubbing can generate events quickly, so the table is pruned on write.
   */
  static get DefaultMaxEventsPerItem() {
    return 500
  }

  /**
   * Record a batch of events for one media item and prune the oldest beyond the cap.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.mediaItemId
   * @param {string} params.mediaItemType
   * @param {string} params.libraryItemId
   * @param {string} [params.playbackSessionId]
   * @param {object[]} params.events - already sanitized by utils/playbackEvents
   * @param {number} [params.maxEventsPerItem]
   * @returns {Promise<number>} number of events written
   */
  static async recordEvents({ userId, mediaItemId, mediaItemType, libraryItemId, playbackSessionId = null, events, maxEventsPerItem = PlaybackEvent.DefaultMaxEventsPerItem }) {
    if (!Array.isArray(events) || !events.length) return 0

    const rows = events.map((event) => ({
      userId,
      mediaItemId,
      mediaItemType,
      libraryItemId,
      playbackSessionId,
      eventType: event.eventType,
      currentTime: event.currentTime,
      fromTime: event.fromTime ?? null,
      chapterTitle: event.chapterTitle ?? null,
      chapterIndex: event.chapterIndex ?? null,
      source: event.source || 'unknown',
      createdAt: event.createdAt || new Date()
    }))

    await PlaybackEvent.bulkCreate(rows)
    await PlaybackEvent.pruneForItem(userId, mediaItemId, maxEventsPerItem)
    return rows.length
  }

  /**
   * Keep only the newest `maxEvents` for a user and media item.
   *
   * Scrubbing can generate events quickly, so the log is bounded rather than
   * growing without limit.
   *
   * @param {string} userId
   * @param {string} mediaItemId
   * @param {number} maxEvents
   * @returns {Promise<number>} number of events removed
   */
  static async pruneForItem(userId, mediaItemId, maxEvents = PlaybackEvent.DefaultMaxEventsPerItem) {
    if (!Number.isFinite(maxEvents) || maxEvents <= 0) return 0

    const cutoffRows = await PlaybackEvent.findAll({
      where: { userId, mediaItemId },
      order: [['createdAt', 'DESC']],
      offset: maxEvents,
      limit: 1,
      attributes: ['createdAt']
    })
    if (!cutoffRows.length) return 0

    return PlaybackEvent.destroy({
      where: {
        userId,
        mediaItemId,
        createdAt: { [Op.lte]: cutoffRows[0].createdAt }
      }
    })
  }

  /**
   * Paginated events for one library item, newest first.
   *
   * @param {string} userId
   * @param {string} libraryItemId
   * @param {{ page?: number, itemsPerPage?: number }} [options]
   * @returns {Promise<{ total: number, numPages: number, page: number, itemsPerPage: number, events: object[] }>}
   */
  static async getForLibraryItem(userId, libraryItemId, { page = 0, itemsPerPage = 25 } = {}) {
    const { count, rows } = await PlaybackEvent.findAndCountAll({
      where: { userId, libraryItemId },
      order: [['createdAt', 'DESC']],
      offset: page * itemsPerPage,
      limit: itemsPerPage
    })

    return {
      total: count,
      numPages: Math.ceil(count / itemsPerPage),
      page,
      itemsPerPage,
      events: rows.map((row) => row.toJSON())
    }
  }

  static init(sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        mediaItemId: DataTypes.UUID,
        mediaItemType: DataTypes.STRING,
        libraryItemId: DataTypes.UUID,
        playbackSessionId: DataTypes.UUID,
        eventType: DataTypes.STRING,
        currentTime: DataTypes.FLOAT,
        fromTime: DataTypes.FLOAT,
        chapterTitle: DataTypes.STRING,
        chapterIndex: DataTypes.INTEGER,
        source: DataTypes.STRING
      },
      {
        sequelize,
        modelName: 'playbackEvent',
        indexes: [
          {
            name: 'playback_events_user_item_created',
            fields: ['userId', 'mediaItemId', 'createdAt']
          },
          {
            name: 'playback_events_user_library_item_created',
            fields: ['userId', 'libraryItemId', 'createdAt']
          }
        ]
      }
    )

    const { user } = sequelize.models

    user.hasMany(PlaybackEvent, { onDelete: 'CASCADE' })
    PlaybackEvent.belongsTo(user)
  }
}

module.exports = PlaybackEvent
