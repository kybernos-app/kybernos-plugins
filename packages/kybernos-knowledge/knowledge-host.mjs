// ═══════════════════════════════════════════════════════════════════════════
// kybernos-knowledge — Guarded HTTP routes & in-process runtime seam.
//
// Routes (under `/kybernos-knowledge/`, all behind Host fence + Origin check):
//   GET  /kybernos-knowledge/collections
//   GET  /kybernos-knowledge/documents?collection=<id>
//   GET  /kybernos-knowledge/search?q=...&collection=...&frontDeskOnly=1&limit=6
//   GET  /kybernos-knowledge/front-desk/facts?collection=...&q=...&limit=15
//   POST /kybernos-knowledge/collections/add      (writeGuard + capped body)
//   POST /kybernos-knowledge/collections/reindex  (writeGuard + capped body)
//   POST /kybernos-knowledge/collections/update   (writeGuard + capped body)
//   POST /kybernos-knowledge/collections/remove   (writeGuard + capped body)
// ═══════════════════════════════════════════════════════════════════════════

import { writeGuard } from './session-guard.mjs'

export const MAX_BODY_BYTES = 32 * 1024
export const KNOWLEDGE_SEAM_KEY = Symbol.for('kybernos.knowledge')

const str = (v) => (typeof v === 'string' ? v : '')

const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }

const localHosts = (req) => {
  const port = typeof (req && req.socket && req.socket.localPort) === 'number' ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}

export const hostOk = (req) => {
  try {
    const host = str(req && req.headers && req.headers.host)
    const port = req && req.socket && typeof req.socket.localPort === 'number' ? req.socket.localPort : null
    if (host === '' || port === null) return true
    return localHosts(req).includes(host) || kbTrusted(host)
  } catch { return false }
}

export const originOk = (req, strict) => {
  try {
    const source = str(req && req.headers && req.headers.origin) || str(req && req.headers && req.headers.referer)
    if (source === '') return strict === false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return localHosts(req).includes(u.host) || kbTrusted(u.host)
  } catch { return false }
}

const send = (res, status, obj) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(obj))
  } catch { /* socket closed */ }
}

const readBodyCapped = (req, res, cap = MAX_BODY_BYTES) => new Promise((resolve) => {
  const chunks = []
  let size = 0
  let done = false
  const finish = (val) => { if (done) return; done = true; chunks.length = 0; resolve(val) }
  req.on('data', (chunk) => {
    if (done) return
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buf.length
    if (size > cap) {
      try { res.setHeader?.('Connection', 'close') } catch { /* stub */ }
      try { res.once?.('finish', () => req.destroy?.()) } catch { /* stub */ }
      send(res, 413, { ok: false, error: 'body-too-large' })
      finish(null)
      return
    }
    chunks.push(buf)
  })
  req.on('end', () => {
    if (done) return
    const raw = chunks.length === 0 ? '' : Buffer.concat(chunks).toString('utf8')
    try { finish(JSON.parse(raw || '{}') ?? {}) } catch {
      send(res, 400, { ok: false, error: 'bad-json' })
      finish(null)
    }
  })
  req.on('error', () => finish(null))
  req.on('close', () => finish(null))
})

export function publishKnowledgeSeam (store) {
  const seam = Object.freeze({
    version: 1,
    listCollections: () => store.listCollections(),
    listDocuments: (id) => store.listDocuments(id),
    search: (opts) => store.search(opts),
    exportFrontDeskFacts: (opts) => store.exportFrontDeskFacts(opts),
    getWikiPath: (id) => store.getWikiPath(id)
  })
  globalThis[KNOWLEDGE_SEAM_KEY] = seam
  return () => {
    if (globalThis[KNOWLEDGE_SEAM_KEY] === seam) delete globalThis[KNOWLEDGE_SEAM_KEY]
  }
}

export function mountRoutes (webServer, store) {
  const disposers = []
  const reg = (path, handler) => {
    const off = webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        if (!hostOk(req)) { send(res, 403, { ok: false, error: 'origin refused' }); return }
        await handler(req, res)
      }
    })
    if (typeof off === 'function') disposers.push(off)
  }

  reg('/kybernos-knowledge/collections', async (req, res) => {
    if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'method-not-allowed' }); return }
    if (!originOk(req, false)) { send(res, 403, { ok: false, error: 'origin refused' }); return }
    const collections = store.listCollections()
    const totalDocs = collections.reduce((a, c) => a + (Number(c.docCount) || 0), 0)
    const totalChunks = collections.reduce((a, c) => a + (Number(c.chunkCount) || 0), 0)
    send(res, 200, { ok: true, collections, summary: { collections: collections.length, docs: totalDocs, chunks: totalChunks } })
  })

  reg('/kybernos-knowledge/documents', async (req, res) => {
    if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'method-not-allowed' }); return }
    if (!originOk(req, false)) { send(res, 403, { ok: false, error: 'origin refused' }); return }
    const u = new URL(req.url || '/kybernos-knowledge/documents', 'http://127.0.0.1')
    const col = u.searchParams.get('collection') || ''
    const out = store.listDocuments(col)
    send(res, out.ok ? 200 : 404, out)
  })

  reg('/kybernos-knowledge/search', async (req, res) => {
    if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'method-not-allowed' }); return }
    if (!originOk(req, false)) { send(res, 403, { ok: false, error: 'origin refused' }); return }
    const u = new URL(req.url || '/kybernos-knowledge/search', 'http://127.0.0.1')
    const out = store.search({
      query: u.searchParams.get('q') || '',
      collection: u.searchParams.get('collection') || '',
      frontDeskOnly: u.searchParams.get('frontDeskOnly') === '1' || u.searchParams.get('frontDeskOnly') === 'true',
      limit: Number(u.searchParams.get('limit')) || 6
    })
    send(res, 200, out)
  })

  reg('/kybernos-knowledge/front-desk/facts', async (req, res) => {
    if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'method-not-allowed' }); return }
    if (!originOk(req, false)) { send(res, 403, { ok: false, error: 'origin refused' }); return }
    const u = new URL(req.url || '/kybernos-knowledge/front-desk/facts', 'http://127.0.0.1')
    const out = store.exportFrontDeskFacts({
      collection: u.searchParams.get('collection') || '',
      query: u.searchParams.get('q') || '',
      maxFacts: Number(u.searchParams.get('limit')) || 15
    })
    send(res, 200, out)
  })

  const postRoute = (path, run) => reg(path, async (req, res) => {
    if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'method-not-allowed' }); return }
    const denied = writeGuard(req)
    if (denied !== null) { send(res, denied.status, { ok: false, error: denied.error }); return }
    const body = await readBodyCapped(req, res)
    if (body === null) return
    const result = await run(body)
    send(res, result && result.ok === false ? (result.error === 'collection-not-found' ? 404 : 400) : 200, result)
  })

  postRoute('/kybernos-knowledge/collections/add', (body) => store.addCollection({
    name: body.name,
    rootPath: body.rootPath || body.path,
    kind: body.kind,
    includeFrontDesk: body.includeFrontDesk === true,
    indexNow: body.indexNow !== false
  }))

  postRoute('/kybernos-knowledge/collections/reindex', (body) => {
    const id = str(body.id || body.collection).trim()
    if (id !== '') return store.indexCollection(id)
    const all = store.listCollections()
    const results = all.map((c) => store.indexCollection(c.id))
    return { ok: true, results }
  })

  postRoute('/kybernos-knowledge/collections/update', (body) => store.updateCollection(str(body.id || body.collection), {
    name: body.name,
    includeFrontDesk: body.includeFrontDesk
  }))

  postRoute('/kybernos-knowledge/collections/remove', (body) => store.removeCollection(str(body.id || body.collection)))

  return () => { for (const off of disposers.splice(0).reverse()) { try { off() } catch { /* ignore */ } } }
}
