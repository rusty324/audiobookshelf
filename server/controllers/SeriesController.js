const { Request, Response, NextFunction } = require('express')
const Logger = require('../Logger')
const SocketAuthority = require('../SocketAuthority')
const Database = require('../Database')

const RssFeedManager = require('../managers/RssFeedManager')

const libraryItemsBookFilters = require('../utils/queries/libraryItemsBookFilters')
const seriesPlaceholders = require('../utils/seriesPlaceholders')

/**
 * @typedef RequestUserObject
 * @property {import('../models/User')} user
 *
 * @typedef {Request & RequestUserObject} RequestWithUser
 *
 * @typedef RequestEntityObject
 * @property {import('../models/Series')} series
 *
 * @typedef {RequestWithUser & RequestEntityObject} SeriesControllerRequest
 */

/**
 * The books the requesting user can see in this series, reduced to the fields
 * placeholder matching needs.
 *
 * Module scope rather than a class method on purpose: routes here are
 * registered with `.bind(this)` where `this` is the ApiRouter, so `this` inside
 * a controller method is not the controller and `this.helper()` would throw.
 *
 * @param {SeriesControllerRequest} req
 * @returns {{ sequence: string, title: string }[]}
 */
function getBooksInSeriesForMatching(req) {
  return (req.libraryItemsInSeries || []).map((libraryItem) => ({
    sequence: libraryItem.series?.sequence || '',
    title: libraryItem.media?.title || libraryItem.title || ''
  }))
}

class SeriesController {
  constructor() {}

  /**
   * @deprecated
   * /api/series/:id
   *
   * TODO: Update mobile app to use /api/libraries/:id/series/:seriesId API route instead
   * Series are not library specific so we need to know what the library id is
   *
   * @param {SeriesControllerRequest} req
   * @param {Response} res
   */
  async findOne(req, res) {
    const include = (req.query.include || '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => !!v)

    const seriesJson = req.series.toOldJSON()

    // Add progress map with isFinished flag
    if (include.includes('progress')) {
      const libraryItemsInSeries = req.libraryItemsInSeries
      const libraryItemsFinished = libraryItemsInSeries.filter((li) => {
        return req.user.getMediaProgress(li.media.id)?.isFinished
      })
      seriesJson.progress = {
        libraryItemIds: libraryItemsInSeries.map((li) => li.id),
        libraryItemIdsFinished: libraryItemsFinished.map((li) => li.id),
        isFinished: libraryItemsFinished.length === libraryItemsInSeries.length
      }
    }

    if (include.includes('rssfeed')) {
      const feedObj = await RssFeedManager.findFeedForEntityId(seriesJson.id)
      seriesJson.rssFeed = feedObj?.toOldJSONMinified() || null
    }

    res.json(seriesJson)
  }

  /**
   * TODO: Currently unused in the client, should check for duplicate name
   *
   * @param {SeriesControllerRequest} req
   * @param {Response} res
   */
  async update(req, res) {
    const keysToUpdate = ['name', 'description']
    const payload = {}
    for (const key of keysToUpdate) {
      if (req.body[key] !== undefined && typeof req.body[key] === 'string') {
        payload[key] = req.body[key]
      }
    }
    if (!Object.keys(payload).length) {
      return res.status(400).send('No valid fields to update')
    }
    req.series.set(payload)
    if (req.series.changed()) {
      await req.series.save()
      SocketAuthority.emitter('series_updated', req.series.toOldJSON())
    }
    res.json(req.series.toOldJSON())
  }

  /**
   * GET /api/series/:id/placeholders
   *
   * Placeholders for books in this series that are not in the library.
   * Entries the library already covers are filtered out here rather than
   * deleted, so a placeholder resolves itself once the real book is scanned
   * in and nothing has to be cleaned up.
   *
   * @param {SeriesControllerRequest} req
   * @param {Response} res
   */
  async getPlaceholders(req, res) {
    const placeholders = await Database.seriesPlaceholderModel.getForSeries(req.series.id)
    const booksInSeries = getBooksInSeriesForMatching(req)
    const unfulfilled = seriesPlaceholders.filterUnfulfilled(
      placeholders.map((p) => p.toJSONForClient()),
      booksInSeries
    )
    res.json({
      placeholders: unfulfilled,
      // Total includes entries now covered by the library, so the client can
      // say how many have been filled in rather than silently dropping them.
      total: placeholders.length
    })
  }

  /**
   * POST /api/series/:id/placeholders
   *
   * @param {SeriesControllerRequest} req
   * @param {Response} res
   */
  async createPlaceholder(req, res) {
    const input = seriesPlaceholders.sanitizePlaceholderInput(req.body)
    if (!input) {
      return res.status(400).send('Invalid placeholder')
    }

    const booksInSeries = getBooksInSeriesForMatching(req)
    if (seriesPlaceholders.conflictsWithLibrary(input, booksInSeries)) {
      return res.status(409).send('A book matching this placeholder is already in the library')
    }

    const existing = await Database.seriesPlaceholderModel.getForSeries(req.series.id)
    if (seriesPlaceholders.isDuplicate(input, existing)) {
      return res.status(409).send('A placeholder for this book already exists')
    }

    const placeholder = await Database.seriesPlaceholderModel.create({
      seriesId: req.series.id,
      title: input.title,
      subtitle: input.subtitle,
      sequence: input.sequence,
      authorName: input.authorName,
      source: input.source
    })
    Logger.info(`[SeriesController] Added placeholder "${input.title}" to series "${req.series.name}"`)
    res.json(placeholder.toJSONForClient())
  }

  /**
   * PATCH /api/series/:id/placeholders/:placeholderId
   *
   * @param {SeriesControllerRequest} req
   * @param {Response} res
   */
  async updatePlaceholder(req, res) {
    const placeholder = await Database.seriesPlaceholderModel.findOne({
      where: { id: req.params.placeholderId, seriesId: req.series.id }
    })
    if (!placeholder) return res.sendStatus(404)

    const input = seriesPlaceholders.sanitizePlaceholderInput({
      title: req.body.title ?? placeholder.title,
      subtitle: req.body.subtitle ?? placeholder.subtitle,
      sequence: req.body.sequence ?? placeholder.sequence,
      authorName: req.body.authorName ?? placeholder.authorName,
      source: placeholder.source
    })
    if (!input) {
      return res.status(400).send('Invalid placeholder')
    }

    placeholder.set({
      title: input.title,
      subtitle: input.subtitle,
      sequence: input.sequence,
      authorName: input.authorName
    })
    if (placeholder.changed()) {
      await placeholder.save()
    }
    res.json(placeholder.toJSONForClient())
  }

  /**
   * DELETE /api/series/:id/placeholders/:placeholderId
   *
   * @param {SeriesControllerRequest} req
   * @param {Response} res
   */
  async deletePlaceholder(req, res) {
    const rowsDeleted = await Database.seriesPlaceholderModel.destroy({
      where: { id: req.params.placeholderId, seriesId: req.series.id }
    })
    if (!rowsDeleted) return res.sendStatus(404)
    res.sendStatus(200)
  }

  /**
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   * @param {NextFunction} next
   */
  async middleware(req, res, next) {
    const series = await Database.seriesModel.findByPk(req.params.id)
    if (!series) return res.sendStatus(404)

    /**
     * Filter out any library items not accessible to user
     */
    const libraryItems = await libraryItemsBookFilters.getLibraryItemsForSeries(series, req.user)
    if (!libraryItems.length) {
      Logger.warn(`[SeriesController] User "${req.user.username}" attempted to access series "${series.id}" with no accessible books`)
      return res.sendStatus(404)
    }

    if (req.method == 'DELETE' && !req.user.canDelete) {
      Logger.warn(`[SeriesController] User "${req.user.username}" attempted to delete without permission`)
      return res.sendStatus(403)
    } else if ((req.method == 'PATCH' || req.method == 'POST') && !req.user.canUpdate) {
      Logger.warn(`[SeriesController] User "${req.user.username}" attempted to update without permission`)
      return res.sendStatus(403)
    }

    req.series = series
    req.libraryItemsInSeries = libraryItems
    next()
  }

  /**
   * Access control for the placeholder routes.
   *
   * Same series lookup and accessibility check as `middleware`, but every
   * mutation needs only `canUpdate`. Managing a list of books you do not own
   * is editing library metadata, not deleting library content, so it should
   * not require the stronger `canDelete` that `middleware` applies to DELETE.
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   * @param {NextFunction} next
   */
  async placeholderMiddleware(req, res, next) {
    const series = await Database.seriesModel.findByPk(req.params.id)
    if (!series) return res.sendStatus(404)

    const libraryItems = await libraryItemsBookFilters.getLibraryItemsForSeries(series, req.user)
    if (!libraryItems.length) {
      Logger.warn(`[SeriesController] User "${req.user.username}" attempted to access series "${series.id}" with no accessible books`)
      return res.sendStatus(404)
    }

    if (req.method !== 'GET' && !req.user.canUpdate) {
      Logger.warn(`[SeriesController] User "${req.user.username}" attempted to modify series placeholders without permission`)
      return res.sendStatus(403)
    }

    req.series = series
    req.libraryItemsInSeries = libraryItems
    next()
  }
}
module.exports = new SeriesController()
