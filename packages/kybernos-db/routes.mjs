// kybernos-db — the routes of the Tables page.
//
//   GET  /kybernos-db/state                         the dbs, their tables, fields and views, the template each came from (or null), and a fingerprint per db to poll
//   GET  /kybernos-db/records?db=&object=&deleted=  the records of one table
//   GET  /kybernos-db/links?db=&object=&id=         what points at a record, from the other tables (the first 50 of each link field, and how many there are)
//   POST /kybernos-db/write                         { db, object, op: create | update | delete | restore, id?, values? }
//   POST /kybernos-db/view                          { db, object, op: save | remove, view?, id? }
//   POST /kybernos-db/app                           { db, object?, op: archive | restore | delete, confirm? }: put an app or one of its tables away, bring it back, or delete it for good (archived only, name typed back)
//   GET  /kybernos-db/impact?db=&object=            what deleting that app or table would take (tables, rows, links cut, files)
//   POST /kybernos-db/upload?db=&object=&field=&name=&type=   the bytes of one file (application/octet-stream, 25 MB at most): { ok, file } to write into the field
//   GET  /kybernos-db/file?db=&object=&id=&field=&hash=   a file a row holds: a picture is shown, anything else is handed over as a download (type from the bytes, closed CSP)
//   GET  /kybernos-db/publish-check?db=             the facts of the Publish card for an app, and whether it can be published (remote/publisher.mjs)
//   POST /kybernos-db/publish                       { db, confirm: true }: put the app in a team space (the confirm button; nothing happens without it)
//   POST /kybernos-db/unpublish                     { db } brings the app back to this computer; { db, forget: true, confirm: <name> } keeps the local copy and forgets the hosted one
//   POST /kybernos-db/open-web                      { db } -> { url }: the one-time link that signs the owner in to the web app (ten minutes, once); the page opens it in a new tab
//   POST /kybernos-db/refresh                       { db } brings the read-only copy up to date with the web app now
//   GET  /kybernos-db/core/<file>.mjs               the pure rules of core/, so the browser runs the very code the agent runs
//   GET  /kybernos-db/vendor/maplibre-gl.js|.css    the map library the Map view loads, and only when the person opens that view (vendor/NOTICES.md)
//
// EVERY data route, reads included, needs DSH's signed session (session-guard.mjs): the records are personal data and plugin routes are served before DSH's own
// sign-in. The actor of a write is `person`, never read from the request. The core files are public (they are this repository's own open code and hold no data),
// but only the files that sit in core/, by name, and only to a request whose Host is this listener's.
//
// For a PUBLISHED app the page's `write` and `upload` are forwarded to the web app (remote/publisher.mjs) and answer in the very same shape, with the status of the same code; the
// copy on this computer is refreshed before the answer goes back. `file` and every read are served from that copy. The five publish routes are mounted only when the host has a
// publisher, and each is the same guarded POST as a write (or GET, for the card's facts): a link that signs the owner in is a POST so that nothing can prefetch it.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_ATTACHMENT_BYTES, isUlid } from './core/index.mjs'
import { doorShape } from './remote/facade.mjs'
import { sendUserFile } from './serve-user-file.mjs'
import { writeGuard } from './session-guard.mjs'

export const ROUTE = '/kybernos-db/'
export const CORE_ROUTE = ROUTE + 'core/'
export const BODY_MAX = 64 * 1024
export const UPLOAD_MAX = MAX_ATTACHMENT_BYTES
const CORE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'core')
const VENDOR_DIR = join(dirname(fileURLToPath(import.meta.url)), 'vendor')
const CORE_FILE = /^[a-z]+\.mjs$/

// Hosted instance: also accept the authorities declared to DSH with --trusted-host (published by the core bundle); absent or failing, loopback only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs): DSH serves plugin routes BEFORE its own sign-in, and a page that rebinds its own name to this machine reaches
// them with its own name as Host. Every route refuses a Host that is not this listener's before its own guard runs. A request with no socket (a test) is not judged.
export const hostOk = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}

const STATUS = {
  'too-big': 413, 'too-large': 413, unknown_db: 404, unknown_object: 404, no_db: 404, which_db: 400, missing: 404, deleted: 409, exists: 409, archived: 409, 'not-archived': 409, published: 409, confirm: 400, forbidden: 403,
  sqlite_unavailable: 503, db_newer: 503, not_a_db: 503, failed: 500,
  // the web app and the hosting behind Publish
  unreachable: 503, unavailable: 503, refused: 502, space: 502, mismatch: 502, 'hosting-failed': 502, 'rate-limited': 429, budget: 402, sensitive: 409, busy: 409, changed: 409, 'not-published': 409, 'db-exists': 409, registry: 500,
}
const statusOf = (answer) => (answer.ok === true ? 200 : (STATUS[answer.error] || 400))

const sendJson = (res, status, payload) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  } catch (e) { try { res.end() } catch (e2) { /* socket closed */ } }
}
const refuse = (res, status, error) => sendJson(res, status, { ok: false, error })

/** The JSON body of a POST, or null once the answer (413, 400) has been sent. */
const readBody = (req, res) => new Promise((resolve) => {
  const chunks = []
  let size = 0
  let done = false
  const finish = (v) => { if (done) return; done = true; chunks.length = 0; resolve(v) }
  req.on('data', (d) => {
    if (done) return
    const part = typeof d === 'string' ? Buffer.from(d) : d
    size += part.length
    if (size > BODY_MAX) { refuse(res, 413, 'request body too large'); finish(null); return }
    chunks.push(part)
  })
  req.on('end', () => {
    if (done) return
    const raw = chunks.length === 0 ? '' : Buffer.concat(chunks).toString('utf8')
    try {
      const parsed = raw === '' ? {} : JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { refuse(res, 400, 'the body is a JSON object'); finish(null); return }
      finish(parsed)
    } catch (e) { refuse(res, 400, 'body is not JSON'); finish(null) }
  })
  req.on('error', () => finish(null))
})
const jsonContent = (req) => { const t = req.headers !== null && req.headers !== undefined && typeof req.headers['content-type'] === 'string' ? req.headers['content-type'].toLowerCase() : ''; return t.indexOf('application/json') === 0 }
/** The raw bytes of an upload, or null once the answer (413, 400) has been sent. Past the cap the rest of the body is read and dropped, so the answer reaches the page. */
const readBytes = (req, res, max) => new Promise((resolve) => {
  const chunks = []
  let size = 0
  let done = false
  const finish = (v) => { if (done) return; done = true; chunks.length = 0; resolve(v) }
  req.on('data', (d) => {
    if (done) return
    const part = typeof d === 'string' ? Buffer.from(d) : d
    size += part.length
    if (size > max) { refuse(res, 413, 'too-big'); finish(null); return }
    chunks.push(part)
  })
  req.on('end', () => { if (!done) finish(Buffer.concat(chunks)) })
  req.on('error', () => finish(null))
})
const queryOf = (req) => { try { return Object.fromEntries(new URL(req.url, 'http://127.0.0.1').searchParams) } catch (e) { return {} } }

/** The db id a publish request names, or the answer that refuses it: nothing but a ULID is ever looked up. */
const dbOf = (input) => (isUlid(input.db) ? { id: input.db } : { err: { ok: false, error: 'unknown_db', message: 'no such database' } })
const through = (publisher, input, fn) => { const t = dbOf(input); return t.err ? t.err : Promise.resolve(fn(t.id)).then(doorShape) }

/**
 * One row per route: the method, and what it does with the parsed query (GET) or body (POST); `run` may answer with a Promise. `publisher` (remote/publisher.mjs) is optional: without
 * it a write is always the local door's and the publish routes do not exist.
 */
export const routeTable = (api, publisher) => ({
  state: { method: 'GET', run: () => api.state() },
  records: { method: 'GET', run: (q) => api.records(q) },
  links: { method: 'GET', run: (q) => api.links(q) },
  write: { method: 'POST', run: (b) => { const forwarded = publisher ? publisher.forwardWrite(b) : null; return forwarded !== null ? forwarded : api.write(b) } },
  view: { method: 'POST', run: (b) => api.view(b) },
  app: { method: 'POST', run: (b) => api.app(b) },
  impact: { method: 'GET', run: (q) => api.impact(q) },
  ...(publisher ? {
    'publish-check': { method: 'GET', run: (q) => through(publisher, q, (id) => publisher.check(id)) },
    publish: { method: 'POST', run: (b) => through(publisher, b, (id) => publisher.publish(id, { confirm: b.confirm === true })) },
    unpublish: { method: 'POST', run: (b) => through(publisher, b, (id) => publisher.unpublish(id, { forget: b.forget === true, confirm: typeof b.confirm === 'string' ? b.confirm : undefined })) },
    'open-web': { method: 'POST', run: (b) => through(publisher, b, (id) => publisher.openWeb(id)) },
    refresh: { method: 'POST', run: (b) => through(publisher, b, (id) => publisher.refresh(id)) },
  } : {}),
})

const handlerFor = (route) => async (req, res) => {
  try {
    if (hostOk(req) !== true) return refuse(res, 403, 'origin refused')
    if (String(req.method || 'GET').toUpperCase() !== route.method) { res.setHeader && res.setHeader('allow', route.method); return refuse(res, 405, 'method not allowed') }
    const denied = writeGuard(req)
    if (denied !== null) return refuse(res, denied.status, denied.error)
    let input = {}
    if (route.method === 'POST') {
      if (!jsonContent(req)) return refuse(res, 415, 'application/json content-type expected')
      input = await readBody(req, res)
      if (input === null) return undefined
    } else input = queryOf(req)
    const answer = await route.run(input)
    return sendJson(res, statusOf(answer), answer)
  } catch (e) {
    console.log('[kybernos-db] route failed: ' + String((e && e.message) || e).slice(0, 200))
    return refuse(res, 500, 'failed')
  }
}

/** `POST /kybernos-db/upload`: one file, as raw bytes, behind the same guards as a write. For a published app it goes to the web app (`publisher`), which answers with the value to write. */
export const uploadHandler = (api, publisher) => async (req, res) => {
  try {
    if (hostOk(req) !== true) return refuse(res, 403, 'origin refused')
    if (String(req.method || 'GET').toUpperCase() !== 'POST') { res.setHeader && res.setHeader('allow', 'POST'); return refuse(res, 405, 'method not allowed') }
    const denied = writeGuard(req)
    if (denied !== null) return refuse(res, denied.status, denied.error)
    const kind = req.headers !== null && req.headers !== undefined && typeof req.headers['content-type'] === 'string' ? req.headers['content-type'].toLowerCase().split(';')[0].trim() : ''
    if (kind !== 'application/octet-stream') return refuse(res, 415, 'application/octet-stream content-type expected')
    const length = Number(req.headers['content-length'])
    if (Number.isFinite(length) && length > UPLOAD_MAX) return refuse(res, 413, 'too-big')
    const bytes = await readBytes(req, res, UPLOAD_MAX)
    if (bytes === null) return undefined
    const q = queryOf(req)
    const args = { db: q.db, object: q.object, field: q.field, name: q.name, type: q.type === undefined || q.type === '' ? 'application/octet-stream' : q.type, bytes }
    const forwarded = publisher ? publisher.forwardUpload(args) : null
    const answer = forwarded !== null ? await forwarded : api.upload(args)
    return sendJson(res, statusOf(answer), answer)
  } catch (e) {
    console.log('[kybernos-db] upload failed: ' + String((e && e.message) || e).slice(0, 200))
    return refuse(res, 500, 'failed')
  }
}

/**
 * `GET /kybernos-db/file`: a file a row holds, if the row says so (a hash alone opens nothing). A person's file is never shown as a document in DSH's origin
 * (DL-04, serve-user-file.mjs): its type comes from its first bytes and never from what was said at upload, a picture is shown in place and everything else (a PDF, an SVG,
 * a page) is a download, always with `nosniff` and a closed content-security-policy. The name a download is saved under is the page's (the link's `download`).
 */
export const fileHandler = (api) => async (req, res) => {
  try {
    if (hostOk(req) !== true) return refuse(res, 403, 'origin refused')
    if (String(req.method || 'GET').toUpperCase() !== 'GET') { res.setHeader && res.setHeader('allow', 'GET'); return refuse(res, 405, 'method not allowed') }
    const denied = writeGuard(req)
    if (denied !== null) return refuse(res, denied.status, denied.error)
    const answer = api.file(queryOf(req))
    if (answer.ok !== true) return sendJson(res, statusOf(answer), answer)
    return sendUserFile(res, Buffer.from(answer.bytes))
  } catch (e) {
    console.log('[kybernos-db] file failed: ' + String((e && e.message) || e).slice(0, 200))
    return refuse(res, 500, 'failed')
  }
}

/** The core files the browser may import: the `.mjs` files that sit in core/, read when asked (so an edit shows at once in a test). */
export const coreFiles = (dir = CORE_DIR) => { try { return readdirSync(dir).filter((f) => CORE_FILE.test(f)).sort() } catch (e) { return [] } }

/** Serves `/kybernos-db/core/<file>.mjs`: a GET of a file that is in core/, nothing else. */
export const coreHandler = (dir = CORE_DIR) => async (req, res) => {
  try {
    if (hostOk(req) !== true) return refuse(res, 403, 'origin refused')
    const method = String(req.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') { res.setHeader && res.setHeader('allow', 'GET, HEAD'); return refuse(res, 405, 'method not allowed') }
    let name = ''
    try { name = new URL(req.url, 'http://127.0.0.1').pathname.slice(CORE_ROUTE.length) } catch (e) { name = '' }
    if (!CORE_FILE.test(name) || coreFiles(dir).indexOf(name) < 0) return refuse(res, 404, 'not found')
    const text = readFileSync(join(dir, name), 'utf8')
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' })
    return res.end(method === 'HEAD' ? undefined : text)
  } catch (e) {
    return refuse(res, 500, 'failed')
  }
}

/** The map library and its stylesheet: the files of vendor/ the page asks for, by route name. Nothing else of that folder is served. */
export const VENDOR_ROUTES = {
  'vendor/maplibre-gl.js': ['maplibre-gl.js', 'text/javascript; charset=utf-8'],
  'vendor/maplibre-gl.css': ['maplibre-gl.css', 'text/css; charset=utf-8'],
}
/**
 * Serves one file of vendor/ (GET and HEAD). It carries the same guards as the data routes (this listener's Host, DSH's signed session: the page's own <script> and <link> send
 * the cookie), so that no route of this bundle answers without the person. The files are public code that never change between releases (the page names the version in the
 * query), so the browser may keep them for a day.
 */
export const vendorHandler = (file, type, dir = VENDOR_DIR) => async (req, res) => {
  try {
    if (hostOk(req) !== true) return refuse(res, 403, 'origin refused')
    const method = String(req.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') { res.setHeader && res.setHeader('allow', 'GET, HEAD'); return refuse(res, 405, 'method not allowed') }
    const denied = writeGuard(req)
    if (denied !== null) return refuse(res, denied.status, denied.error)
    const bytes = readFileSync(join(dir, file))
    res.writeHead(200, { 'content-type': type, 'cache-control': 'private, max-age=86400', 'content-length': String(bytes.length), 'x-content-type-options': 'nosniff' })
    return res.end(method === 'HEAD' ? undefined : bytes)
  } catch (e) {
    return refuse(res, 404, 'not found')
  }
}

/** Mounts the routes on the web server service; answers what `register` gave back so the caller can take them off again. `publisher` is optional (see routeTable). */
export function mountRoutes (webServer, api, publisher) {
  const off = []
  for (const [name, route] of Object.entries(routeTable(api, publisher))) {
    const retrait = webServer.register({ kind: 'exact', path: ROUTE + name, handler: handlerFor(route) })
    if (typeof retrait === 'function') off.push(retrait)
  }
  for (const [name, handler] of [['upload', uploadHandler(api, publisher)], ['file', fileHandler(api)]]) {
    const retrait = webServer.register({ kind: 'exact', path: ROUTE + name, handler })
    if (typeof retrait === 'function') off.push(retrait)
  }
  const retrait = webServer.register({ kind: 'prefix', path: CORE_ROUTE.slice(0, -1), handler: coreHandler() })
  if (typeof retrait === 'function') off.push(retrait)
  for (const [name, [file, type]] of Object.entries(VENDOR_ROUTES)) {
    const gone = webServer.register({ kind: 'exact', path: ROUTE + name, handler: vendorHandler(file, type) })
    if (typeof gone === 'function') off.push(gone)
  }
  return off
}
