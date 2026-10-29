// kybernos-catalog — host half.
//
// What you sell, rent or recruit for: the items of the shared business base (docs/dev/business-base.md), their routes and their two agent tools.
//
//   GET  /kybernos-catalog/types                        → { ok, source, types }   the types of the active theme, or the one default type
//   GET  /kybernos-catalog/list?q=&type=&status=&archived=only&limit=&offset=
//                                                       → { ok, rows, total, counts, demo }   at most 500 rows
//   GET  /kybernos-catalog/get?id=                      → { ok, row }
//   POST /kybernos-catalog/create   { type, title, subtitle, status, price_text, price_num, fields }
//   POST /kybernos-catalog/update   { id, patch }
//   POST /kybernos-catalog/archive  { id }   ·   POST /kybernos-catalog/restore { id }
//   POST /kybernos-catalog/clear-demo { confirm: true }  removes the sample rows (of the three business tables: the seam clears them together)
//
// EVERY route, reads included, needs DSH's signed session cookie (session-guard.mjs, the shared byte-identical copy): the items are the person's
// customers' goods and DSH serves plugin routes before its own login. A write also needs the strict same origin.
// The base is read lazily, at request time, through the seam `Symbol.for('kybernos.business')`; absent, a route answers `{ ok: false, error: 'base_missing' }`.
// Nothing here throws into DSH or stops it from starting (AGENTS rule 2).
import { writeGuard } from './session-guard.mjs'
import { CATALOG_POINT } from './catalog-type.mjs'
import { createCatalog } from './catalog-core.mjs'
import { catalogTools } from './catalog-tools.mjs'

export const name = 'kybernos-catalog'

const say = (msg) => console.log('[kybernos-catalog] ' + msg)

// ── telling the registry (the SAME text in the three business plugins; scripts/test-business-points.mjs compares them) ────────────────────────
const registrySeam = () => { try { const r = globalThis[Symbol.for('kybernos.registry')]; return r !== undefined && r !== null && r.version === 1 ? r : null } catch (e) { return null } }

/** Tells the registry the point this plugin owns. `true` when the registry was there to hear it (telling it twice changes nothing). */
export const tellPoint = () => {
  try {
    const registry = registrySeam()
    if (registry === null) return false
    registry.definePoint(CATALOG_POINT)
    return true
  } catch (e) { return false }
}

/**
 * Tells the point now, and again after each delay until the registry has heard it: the registry mounts when DSH decides, maybe after this plugin
 * (measured in a sandbox: at boot the seam was not there yet, and nothing asked a question later). Never throws; the timers never hold DSH open.
 * `options.schedule` and `options.delays` are for the test.
 */
export function tellWhenReady (options = {}) {
  const schedule = options.schedule || setTimeout
  const delays = Array.isArray(options.delays) ? options.delays : [500, 1500, 4000, 10000, 30000]
  let told = tellPoint()
  let tries = 0
  const next = () => {
    if (told || tries >= delays.length) return
    const timer = schedule(() => { told = tellPoint(); next() }, delays[tries++])
    if (timer !== undefined && timer !== null && typeof timer.unref === 'function') timer.unref()
  }
  next()
  return () => told
}
// ── end of the telling ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// ── the seams, read at each question ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const businessSeam = () => { try { const b = globalThis[Symbol.for('kybernos.business')]; return b !== undefined && b !== null && b.version === 1 ? b : null } catch (e) { return null } }
/** The catalog over the live seams: nothing is read until a question is asked. */
export const liveCatalog = () => createCatalog({ base: businessSeam, registry: registrySeam })

// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs). DSH serves plugin routes BEFORE its own authentication, and a page that rebinds its own name to this machine
// (DNS rebinding) reaches them with its own name as Host, no cookie and, on a same-origin GET, no Origin. Every route of this bundle refuses a Host that is
// not this listener's (the port the socket is bound to, on 127.0.0.1 / localhost / [::1], or an authority declared with --trusted-host) before its own
// guard runs. A request with no socket (a test) is not judged.
const kbHostOK = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}
// What `register` hands back takes the route off again. It is kept here and given to `ctx.effect` by `apply`, so that unloading the plugin removes every
// route it added (scripts/test-routes-unload.mjs).
const kbRetraits = []
const kbRetirerRoutes = () => { for (const retrait of kbRetraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } } }
const kbFenced = (service) => {
  if (service === null || service === undefined || typeof service.register !== 'function') return service
  const fence = (route) => (route !== null && typeof route === 'object' && typeof route.handler === 'function'
    ? Object.assign({}, route, {
      handler: (req, res, ...rest) => {
        if (kbHostOK(req) !== true) {
          try { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"ok":false,"error":"origin refused"}') } catch (e) { /* closed */ }
          return undefined
        }
        return route.handler(req, res, ...rest)
      },
    })
    : route)
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => { const retrait = target.register(fence(route)); if (typeof retrait === 'function') kbRetraits.push(retrait); return retrait } : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const BODY_MAX = 32 * 1024
const send = (res, status, payload) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  } catch (e) { try { res.destroy() } catch (e2) { /* closed */ } }
}
const refuse = (res, refusal) => send(res, refusal.status, { ok: false, error: refusal.error })
const jsonOnly = (req) => {
  const ct = req.headers !== null && req.headers !== undefined && typeof req.headers['content-type'] === 'string' ? req.headers['content-type'].toLowerCase() : ''
  return ct.indexOf('application/json') === 0
}
const readBody = (req, res) => new Promise((resolve) => {
  const chunks = []
  let size = 0
  let done = false
  const finish = (v) => { if (done) return; done = true; chunks.length = 0; resolve(v) }
  req.on('data', (d) => {
    if (done) return
    const part = typeof d === 'string' ? Buffer.from(d) : d
    size += part.length
    if (size > BODY_MAX) { send(res, 413, { ok: false, error: 'request body too large' }); finish(null); return }
    chunks.push(part)
  })
  req.on('end', () => {
    if (done) return
    const raw = chunks.length === 0 ? '' : Buffer.concat(chunks).toString('utf8')
    try {
      const parsed = raw === '' ? {} : JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { send(res, 400, { ok: false, error: 'body is not a JSON object' }); finish(null); return }
      finish(parsed)
    } catch (e) { send(res, 400, { ok: false, error: 'body is not JSON' }); finish(null) }
  })
  req.on('error', () => finish(null))
})
const queryOf = (req) => { try { return new URL(req.url, 'http://127.0.0.1').searchParams } catch (e) { return new URLSearchParams('') } }
const rowId = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : (typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : null))

// ── the routes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Every route, pure over `catalog`: `[path, method, handler(request) → payload]`. A write takes the parsed body, a read the query. */
export const routeTable = (catalog) => [
  ['/kybernos-catalog/types', 'GET', () => catalog.types()],
  ['/kybernos-catalog/list', 'GET', (q) => catalog.list({ q: q.get('q') || '', type: q.get('type') || '', status: q.get('status') || '', archived: q.get('archived') || '', limit: q.get('limit'), offset: q.get('offset') })],
  ['/kybernos-catalog/get', 'GET', (q) => { const id = rowId(q.get('id')); return id === null ? { ok: false, error: 'bad_id', detail: 'id: a row id' } : catalog.get(id) }],
  ['/kybernos-catalog/create', 'POST', (b) => catalog.create(b)],
  ['/kybernos-catalog/update', 'POST', (b) => { const id = rowId(b.id); return id === null ? { ok: false, error: 'bad_id', detail: 'id: a row id' } : catalog.update(id, b.patch) }],
  ['/kybernos-catalog/archive', 'POST', (b) => { const id = rowId(b.id); return id === null ? { ok: false, error: 'bad_id', detail: 'id: a row id' } : catalog.archive(id) }],
  ['/kybernos-catalog/restore', 'POST', (b) => { const id = rowId(b.id); return id === null ? { ok: false, error: 'bad_id', detail: 'id: a row id' } : catalog.restore(id) }],
  ['/kybernos-catalog/clear-demo', 'POST', (b) => (b.confirm === true ? catalog.clearDemo() : { ok: false, error: 'confirm_required', detail: 'clear-demo needs { confirm: true }' })],
]

/** Mounts the routes on a web server service. Every route answers 405 to the wrong method, and the guard comes before anything else is read. */
export function mountRoutes (server, catalog = liveCatalog()) {
  for (const [path, method, run] of routeTable(catalog)) {
    server.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        try {
          if (String(req.method || 'GET').toUpperCase() !== method) { send(res, 405, { ok: false, error: method + ' expected' }); return }
          const refusal = writeGuard(req)
          if (refusal !== null) { refuse(res, refusal); return }
          if (method === 'GET') { send(res, 200, run(queryOf(req))); return }
          if (!jsonOnly(req)) { send(res, 415, { ok: false, error: 'application/json content-type expected' }); return }
          const body = await readBody(req, res)
          if (body === null) return
          send(res, 200, run(body))
        } catch (e) {
          say('route failed: ' + String(e && e.message ? e.message : e).slice(0, 200))
          send(res, 500, { ok: false, error: 'failed' })
        }
      },
    })
  }
}

/** Registers the two agent tools on the `tools` service. */
export function mountTools (tools, catalog = liveCatalog()) {
  for (const tool of catalogTools(catalog)) tools.register(tool)
}

export function apply (ctx, options) {
  try {
    tellWhenReady(options)
  } catch (e) {
    say('disabled: ' + String(e && e.message ? e.message : e))
  }
  try {
    if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => kbRetirerRoutes, 'kybernos-catalog: routes')
    const mount = (c) => {
      try {
        const server = kbFenced(c.get('webServer'))
        if (server === undefined) return
        mountRoutes(server)
        say('routes mounted')
      } catch (e) { say('routes not mounted: ' + String(e && e.message ? e.message : e)) }
    }
    if (typeof ctx.get === 'function') {
      if (ctx.get('webServer') !== undefined) mount(ctx)
      else if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mount)
    }
  } catch (e) { say('routes not mounted: ' + String(e && e.message ? e.message : e)) }
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['tools'], (scope) => {
        try { mountTools(scope.tools) } catch (e) { say('tools not mounted: ' + String(e && e.message ? e.message : e)) }
      })
    }
  } catch (e) { say('tools not mounted: ' + String(e && e.message ? e.message : e)) }
}
