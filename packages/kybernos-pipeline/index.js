// kybernos-pipeline — host half.
//
//   GET  /kybernos-pipeline/flows            the boards (the active theme's, or the plain default one), with their number of cards
//   GET  /kybernos-pipeline/board?flow=      one board: columns in the theme's order, each with its cards and its total (&archived=1 adds the archived cards)
//   GET  /kybernos-pipeline/card?id=         one card with its linked contact and item
//   GET  /kybernos-pipeline/links?kind=&q=   contacts or items to pick from (looked up through the base, never by importing the other plugins)
//   POST /kybernos-pipeline/create | update | move | archive | restore | clear-demo
//
// EVERY route needs DSH's signed session (session-guard.mjs, the shared byte-identical copy): the cards are personal data and plugin routes are served
// before DSH's own sign-in. The data is the shared business base, read through `globalThis[Symbol.for('kybernos.business')]` at request time (the answer is
// `{ ok: false, error: 'base_missing' }` without it). Two agent tools: `pipeline_list` (free) and `pipeline_move` (asks every time). The point
// `kybernos/pipeline#flow` is told to the registry as before. Nothing here may stop DSH from starting.
import { PIPELINE_POINT } from './pipeline-flow.mjs'
import { createPipelineHost } from './pipeline-host.mjs'
import { approvalGate, toolDefinitions } from './pipeline-tools.mjs'
import { writeGuard } from './session-guard.mjs'

export const name = 'kybernos-pipeline'

// ── telling the registry (the SAME text in the three business plugins; scripts/test-business-points.mjs compares them) ────────────────────────
const registrySeam = () => { try { const r = globalThis[Symbol.for('kybernos.registry')]; return r !== undefined && r !== null && r.version === 1 ? r : null } catch (e) { return null } }

/** Tells the registry the point this plugin owns. `true` when the registry was there to hear it (telling it twice changes nothing). */
export const tellPoint = () => {
  try {
    const registry = registrySeam()
    if (registry === null) return false
    registry.definePoint(PIPELINE_POINT)
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

// ── the routes ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PREFIX = '/kybernos-pipeline'
const BODY_MAX = 16 * 1024

// Hosted instance: also accept the authorities declared to DSH with --trusted-host (the core publishes the predicate; absent or failing, loopback only).
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs): DSH serves plugin routes BEFORE its own authentication, so a page that rebinds its own name to this machine
// reaches them with its own name as Host. Every route refuses a Host that is not this listener's before its own guard runs. A request with no socket (a test) is not judged.
const hostOk = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}

const send = (res, status, payload) => {
  try {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(payload))
  } catch (e) { /* the socket is closed */ }
}

/** The JSON body of a POST, or `null` after the refusal has been sent (not JSON, too large). */
const readBody = (req, res) => new Promise((resolve) => {
  const ct = req.headers !== null && req.headers !== undefined && typeof req.headers['content-type'] === 'string' ? req.headers['content-type'].toLowerCase() : ''
  if (ct.indexOf('application/json') !== 0) { send(res, 415, { ok: false, error: 'application/json content-type expected' }); resolve(null); return }
  const chunks = []
  let size = 0
  let done = false
  const finish = (v) => { if (done) return; done = true; chunks.length = 0; resolve(v) }
  req.on('data', (d) => {
    if (done) return
    const buf = typeof d === 'string' ? Buffer.from(d) : d
    size += buf.length
    if (size > BODY_MAX) { send(res, 413, { ok: false, error: 'request body too large' }); finish(null); return }
    chunks.push(buf)
  })
  req.on('end', () => {
    if (done) return
    const raw = chunks.length === 0 ? '' : Buffer.concat(chunks).toString('utf8')
    try { finish(raw === '' ? {} : JSON.parse(raw)) } catch (e) { send(res, 400, { ok: false, error: 'body is not JSON' }); finish(null) }
  })
})

/** The routes, each with the host operation it calls. `read` routes take the query, `write` routes the JSON body; a write is made by the person. */
export const ROUTES = [
  { path: PREFIX + '/flows', method: 'GET', run: (host) => host.flows() },
  { path: PREFIX + '/board', method: 'GET', run: (host, query) => host.board(query) },
  { path: PREFIX + '/card', method: 'GET', run: (host, query) => host.card(query) },
  { path: PREFIX + '/links', method: 'GET', run: (host, query) => host.links(query) },
  { path: PREFIX + '/create', method: 'POST', run: (host, body) => host.create(body, 'person') },
  { path: PREFIX + '/update', method: 'POST', run: (host, body) => host.update(body, 'person') },
  { path: PREFIX + '/move', method: 'POST', run: (host, body) => host.move(body, 'person') },
  { path: PREFIX + '/archive', method: 'POST', run: (host, body) => host.archive(body, 'person') },
  { path: PREFIX + '/restore', method: 'POST', run: (host, body) => host.restore(body, 'person') },
  { path: PREFIX + '/clear-demo', method: 'POST', run: (host) => host.clearDemo('person') },
]

const queryOf = (req) => {
  const out = {}
  try { for (const [k, v] of new URL(req.url, 'http://127.0.0.1').searchParams) out[k] = v } catch (e) { /* no query */ }
  return out
}

/** One route's handler: Host fence, method, the signed session (reads too), then the body of a POST. */
export const handlerOf = (route, host) => async (req, res) => {
  try {
    if (!hostOk(req)) { send(res, 403, { ok: false, error: 'origin refused' }); return }
    if (String(req.method || 'GET').toUpperCase() !== route.method) { send(res, 405, { ok: false, error: 'method not allowed' }); return }
    const refusal = writeGuard(req)
    if (refusal !== null) { send(res, refusal.status, { ok: false, error: refusal.error }); return }
    const input = route.method === 'POST' ? await readBody(req, res) : queryOf(req)
    if (input === null) return
    send(res, 200, route.run(host, input))
  } catch (e) {
    console.log('[kybernos-pipeline] route failed: ' + String(e && e.message ? e.message : e).slice(0, 200))
    send(res, 500, { ok: false, error: 'failed' })
  }
}

/** Mounts the routes on the web server; returns the function that takes them off again. */
export function mountRoutes (webServer, host) {
  const offs = []
  for (const route of ROUTES) {
    const off = webServer.register({ kind: 'exact', path: route.path, handler: handlerOf(route, host) })
    if (typeof off === 'function') offs.push(off)
  }
  return () => { for (const off of offs.splice(0).reverse()) { try { off() } catch (e) { /* already gone */ } } }
}

// ── the ports: read when a question is asked, never at boot ──────────────────────────────────────────────────────────────────────────────────
export const hostFor = () => createPipelineHost({
  business: () => globalThis[Symbol.for('kybernos.business')],
  registry: () => globalThis[Symbol.for('kybernos.registry')],
})

/** A service of the context, read now when it is there and later when DSH brings it; whatever `use` does, it never throws out of here. */
const withService = (ctx, service, use) => {
  const guarded = (svc) => { try { use(svc) } catch (e) { console.log('[kybernos-pipeline] ' + service + ' not used: ' + String(e && e.message ? e.message : e).slice(0, 200)) } }
  const direct = ctx.get(service)
  if (direct !== undefined) guarded(direct)
  else ctx.inject([service], (scope) => guarded(scope[service]))
}

export function apply (ctx, options) {
  try {
    tellWhenReady(options)
  } catch (e) {
    console.log('[kybernos-pipeline] disabled: ' + String(e && e.message ? e.message : e))
  }
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.get !== 'function' || typeof ctx.inject !== 'function') return // no services to mount on (a bare context)
  try {
    const host = hostFor()
    let unmount = null
    if (typeof ctx.effect === 'function') ctx.effect(() => () => { if (unmount !== null) unmount() }, 'kybernos-pipeline: routes')
    withService(ctx, 'webServer', (webServer) => { unmount = mountRoutes(webServer, host); console.log('[kybernos-pipeline] routes mounted') })
    withService(ctx, 'tools', (tools) => { for (const tool of toolDefinitions(host)) tools.register(tool); console.log('[kybernos-pipeline] tools pipeline_list, pipeline_move registered') })
    if (typeof ctx.on === 'function') ctx.on('tools/pre-execute', approvalGate(host))
  } catch (e) {
    console.log('[kybernos-pipeline] routes and tools not mounted: ' + String(e && e.message ? e.message : e))
  }
}
