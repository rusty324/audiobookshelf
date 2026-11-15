const { expect } = require('chai')
const { Sequelize } = require('sequelize')
const sinon = require('sinon')

const Database = require('../../../server/Database')
const ApiRouter = require('../../../server/routers/ApiRouter')
const LibraryItemController = require('../../../server/controllers/LibraryItemController')
const SeriesController = require('../../../server/controllers/SeriesController')
const LibraryItemScanner = require('../../../server/scanner/LibraryItemScanner')
const CoverManager = require('../../../server/managers/CoverManager')
const ApiCacheManager = require('../../../server/managers/ApiCacheManager')
const SocketAuthority = require('../../../server/SocketAuthority')
const Watcher = require('../../../server/Watcher')
const Auth = require('../../../server/Auth')
const Logger = require('../../../server/Logger')
const fs = require('../../../server/libs/fsExtra')

/** A response double that records what the handler sent. */
function fakeRes() {
  const res = { statusCode: 200, body: undefined, headersSent: false }
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.sendStatus = (code) => {
    res.statusCode = code
    res.headersSent = true
    return res
  }
  res.send = (body) => {
    res.body = body
    res.headersSent = true
    return res
  }
  res.json = (body) => {
    res.body = body
    res.headersSent = true
    return res
  }
  return res
}

// A handler that throws used to be an unhandled rejection, which Server.js
// answers with process.exit(1). These pin the fork's handlers against that.
describe('Fork fixes', () => {
  /** @type {ApiRouter} */
  let apiRouter

  beforeEach(async () => {
    global.ServerSettings = {}
    Database.sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    Database.sequelize.uppercaseFirst = (str) => (str ? `${str[0].toUpperCase()}${str.substr(1)}` : '')
    await Database.buildModels()

    apiRouter = new ApiRouter({ auth: new Auth(), apiCacheManager: new ApiCacheManager() })

    sinon.stub(Logger, 'info')
    sinon.stub(Logger, 'error')
    sinon.stub(Logger, 'warn')
  })

  afterEach(async () => {
    sinon.restore()
    await Database.sequelize.sync({ force: true })
  })

  describe('forkRoute', () => {
    const req = { method: 'GET', originalUrl: '/api/x' }

    it('turns a throwing handler into a 500 instead of a rejection', async () => {
      const res = fakeRes()
      await ApiRouter.forkRoute(async () => {
        throw new Error('boom')
      })(req, res)
      expect(res.statusCode).to.equal(500)
      expect(Logger.error.calledOnce).to.be.true
    })

    it('leaves a response that was already sent alone', async () => {
      const res = fakeRes()
      await ApiRouter.forkRoute(async (rq, rs) => {
        rs.json({ ok: true })
        throw new Error('late')
      })(req, res)
      expect(res.statusCode).to.equal(200)
      expect(res.body).to.deep.equal({ ok: true })
    })

    it('passes a normal handler through untouched', async () => {
      const res = fakeRes()
      await ApiRouter.forkRoute(async (rq, rs) => rs.sendStatus(204))(req, res)
      expect(res.statusCode).to.equal(204)
      expect(Logger.error.called).to.be.false
    })
  })

  describe('organize', () => {
    let library
    let folder

    /** A request for a book at `path` with the given metadata. */
    const organizeReq = ({ path, title = 'The Book', authorName = 'An Author', isFile = false }) => ({
      user: { isAdminOrUp: true, username: 'root' },
      libraryItem: {
        id: 'li_1',
        isBook: true,
        isFile,
        path,
        libraryId: library.id,
        libraryFolderId: folder.id,
        media: { title, authorName, series: [] },
        toOldJSON: () => ({ id: 'li_1' })
      }
    })

    beforeEach(async () => {
      library = await Database.libraryModel.create({ name: 'Books', mediaType: 'book' })
      folder = await Database.libraryFolderModel.create({ path: '/lib', libraryId: library.id })
      sinon.stub(Watcher, 'addIgnoreDir')
      sinon.stub(Watcher, 'removeIgnoreDir')
      sinon.stub(fs, 'pathExists').resolves(false)
      sinon.stub(fs, 'move').resolves()
      sinon.stub(fs, 'ensureDir').resolves()
      sinon.stub(fs, 'readdir').resolves(['something'])
    })

    it('refuses an item whose title cannot name a folder, without moving anything', async () => {
      for (const title of ['', '   ']) {
        const res = fakeRes()
        await LibraryItemController.organize.bind(apiRouter)(organizeReq({ path: '/lib/loose', title }), res)
        expect(res.statusCode, `title "${title}"`).to.equal(400)
      }
      expect(fs.move.called).to.be.false
    })

    it('refuses to move a book into its own folder', async () => {
      // The book currently IS the author folder
      const res = fakeRes()
      await LibraryItemController.organize.bind(apiRouter)(organizeReq({ path: '/lib/An Author' }), res)
      expect(res.statusCode).to.equal(409)
      expect(fs.move.called).to.be.false
      expect(Watcher.addIgnoreDir.called).to.be.false
    })

    it('answers 500 and releases the watcher when the rescan fails after the move', async () => {
      sinon.stub(LibraryItemScanner, 'scanLibraryItem').rejects(new Error('scan blew up'))
      const res = fakeRes()
      await LibraryItemController.organize.bind(apiRouter)(organizeReq({ path: '/lib/loose' }), res)
      expect(fs.move.calledOnce).to.be.true
      expect(res.statusCode).to.equal(500)
      expect(res.body).to.match(/files were moved/)
      expect(Watcher.removeIgnoreDir.callCount).to.equal(2)
    })

    it('still organizes normally', async () => {
      sinon.stub(LibraryItemScanner, 'scanLibraryItem').resolves(3)
      sinon.stub(Database.libraryItemModel, 'getExpandedById').resolves(null)
      sinon.stub(Database, 'resetLibraryIssuesFilterData').resolves()
      const res = fakeRes()
      await LibraryItemController.organize.bind(apiRouter)(organizeReq({ path: '/lib/loose' }), res)
      expect(res.statusCode).to.equal(200)
      expect(fs.move.firstCall.args.slice(0, 2)).to.deep.equal(['/lib/loose', '/lib/An Author/The Book'])
      expect(Watcher.removeIgnoreDir.callCount).to.equal(2)
    })
  })

  describe('placeholders', () => {
    let series
    let libraryId

    beforeEach(async () => {
      const library = await Database.libraryModel.create({ name: 'Books', mediaType: 'book' })
      libraryId = library.id
      series = await Database.seriesModel.create({ name: 'A Series', libraryId })
    })

    const req = (params) => ({ params, series, libraryItems: [], user: { username: 'root', canUpdate: true, checkCanAccessLibraryItem: () => true } })

    it('promoting succeeds even when announcing the new item throws', async () => {
      const placeholder = await Database.seriesPlaceholderModel.create({ seriesId: series.id, title: 'Book Two', sequence: '2', source: 'manual' })
      sinon.stub(SocketAuthority, 'libraryItemEmitter').throws(new Error('socket down'))
      const res = fakeRes()
      await SeriesController.promotePlaceholder.bind(apiRouter)(req({ placeholderId: placeholder.id }), res)
      expect(res.statusCode).to.equal(200)
      expect(res.body.libraryItemId).to.be.a('string')
      expect(await Database.seriesPlaceholderModel.count()).to.equal(0)
      expect(await Database.libraryItemModel.count()).to.equal(1)
    })

    it('demoting succeeds even when announcing the removal throws', async () => {
      const placeholder = await Database.seriesPlaceholderModel.create({ seriesId: series.id, title: 'Book Two', sequence: '2', source: 'manual' })
      const promoted = fakeRes()
      sinon.stub(SocketAuthority, 'libraryItemEmitter').returns()
      await SeriesController.promotePlaceholder.bind(apiRouter)(req({ placeholderId: placeholder.id }), promoted)
      SocketAuthority.libraryItemEmitter.throws(new Error('socket down'))
      const res = fakeRes()
      await SeriesController.demotePlaceholder.bind(apiRouter)(req({ libraryItemId: promoted.body.libraryItemId }), res)
      expect(res.statusCode).to.equal(200)
      expect(await Database.libraryItemModel.count()).to.equal(0)
      expect(await Database.seriesPlaceholderModel.count()).to.equal(1)
    })

    it('a promoted placeholder (no folder) keeps its cover in the metadata directory', () => {
      global.ServerSettings = { storeCoverWithItem: true }
      global.MetadataPath = '/metadata'
      expect(CoverManager.getCoverDirectory({ id: 'li_p', isFile: false, path: null })).to.equal('/metadata/items/li_p')
      expect(CoverManager.getCoverDirectory({ id: 'li_r', isFile: false, path: '/lib/A/B' })).to.equal('/lib/A/B')
    })
  })

  describe('deleting a library item', () => {
    it('removes its listening log', async () => {
      const user = await Database.userModel.create({ username: 'u', pash: 'x', type: 'user', isActive: true })
      const event = (libraryItemId) =>
        Database.playbackEventModel.recordEvents({
          userId: user.id,
          mediaItemId: '11111111-1111-4111-8111-111111111111',
          mediaItemType: 'book',
          libraryItemId,
          events: [{ eventType: 'play', currentTime: 1, source: 'server', createdAt: new Date() }]
        })
      const gone = '22222222-2222-4222-8222-222222222222'
      const kept = '33333333-3333-4333-8333-333333333333'
      await event(gone)
      await event(kept)
      sinon.stub(require('../../../server/managers/RssFeedManager'), 'closeFeedForEntityId').resolves()
      sinon.stub(require('../../../server/managers/CacheManager'), 'purgeCoverCache').resolves()
      sinon.stub(SocketAuthority, 'emitter').returns()
      global.MetadataPath = null
      await apiRouter.handleDeleteLibraryItem(gone, ['11111111-1111-4111-8111-111111111111'], 'lib')
      const left = await Database.playbackEventModel.findAll()
      expect(left.map((e) => e.libraryItemId)).to.deep.equal([kept])
    })
  })
})
