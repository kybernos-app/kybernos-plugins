// kybernos-contacts — host half.
//
// It opens the point `kybernos/contacts#schema` for the themes that extend it, serves the routes of the Contacts page, and gives the agents two
// tools. The data is the shared business base of the core, reached through its seam when a request comes (never at boot, never imported); the words
// (types, fields, tags) come from the active theme through the registry seam, plain English defaults when no theme speaks.
//
//   GET  /kybernos-contacts/schema                       the merged words of the active themes
//   GET  /kybernos-contacts/list?q=&kind=&type=&tag=&company_id=&archived=1&limit=&offset=
//   GET  /kybernos-contacts/get?id=                      one contact with its notes, its company, its people
//   POST /kybernos-contacts/create | update | archive | restore | note | clear-demo
//
// EVERY route, reads included, needs DSH's signed session (session-guard.mjs): a contact is personal data and plugin routes are served before DSH's own
// sign-in. Writes name the actor `person`; the agent tools name `agent`. A broken or missing base or registry never stops DSH from starting.
import { CONTACTS_POINT } from './contacts-schema.mjs'
import { createApi } from './contacts-api.mjs'
import { schemaFrom } from './contacts-words.mjs'
import { approvalGate, tools as contactsTools } from './contacts-tools.mjs'
import { writeGuard } from './session-guard.mjs'

export const name = 'kybernos-contacts'

// ── telling the registry (the SAME text in the three business plugins; scripts/test-business-points.mjs compares them) ────────────────────────
const registrySeam = () => { try { const r = globalThis[Symbol.for('kybernos.registry')]; return r !== undefined && r !== null && r.version === 1 ? r : null } catch (e) { return null } }

/** Tells the registry the point this plugin owns. `true` when the registry was there to hear it (telling it twice changes nothing). */
export const tellPoint = () => {
  try {
    const registry = registrySeam()
    if (registry === null) return false
    registry.definePoint(CONTACTS_POINT)
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

// ── the business base, looked up when a question comes ───────────────────────────────────────────────────────────────────────────────────────
const businessSeam = () => { try { const b = globalThis[Symbol.for('kybernos.business')]; return b !== undefined && b !== null && b.version === 1 ? b : null } catch (e) { return null } }
/** The template the pages follow, asked of the base each time (its plugin id), or null: none is active, or an older core cannot say. */
const scopeNow = () => { try { const b = businessSeam(); const r = b !== null && typeof b.scope === 'function' ? b.scope() : null; return r !== null && r.ok === true && typeof r.scope === 'string' && r.scope !== '' ? r.scope : null } catch (e) { return null } }
/** The api over the live seams. Every question looks them up again: the base and the registry may appear after this plugin. */
export const makeApi = () => createApi({ base: businessSeam, schema: () => schemaFrom(registrySeam(), scopeNow()) })

// ── the routes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const BODY_MAX = 32 * 1024
const ROUTE = '/kybernos-contacts/'
// Hosted instance: also accept the authorities declared to DSH with --trusted-host (published by the core bundle); absent or failing, loopback only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs): DSH serves plugin routes BEFORE its own sign-in, and a page that rebinds its own name to this machine reaches
// them with its own name as Host. Every route refuses a Host that is not this listener's before its own guard runs. A request with no socket (a test) is not judged.
const hostOk = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}
const STATUS = { base_missing: 503, sqlite_unavailable: 503, cannot_open: 503, not_a_database: 503, schema_newer: 503, read_only: 503, busy: 503, not_found: 404, failed: 500 }
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
const queryOf = (req) => { try { return Object.fromEntries(new URL(req.url, 'http://127.0.0.1').searchParams) } catch (e) { return {} } }
const idOf = (body) => (body.id !== undefined ? body.id : null)
const without = (body, key) => { const out = Object.assign({}, body); delete out[key]; return out }

/** One row per route: the method, and what it does with the parsed query (GET) or body (POST). The actor of a write is never read from the request. */
export const routeTable = (api) => ({
  schema: { method: 'GET', run: () => api.schema() },
  list: { method: 'GET', run: (q) => api.list(q) },
  get: { method: 'GET', run: (q) => api.get(q.id) },
  create: { method: 'POST', run: (b) => api.create(b, { actor: 'person' }) },
  update: { method: 'POST', run: (b) => api.update(idOf(b), without(b, 'id'), { actor: 'person' }) },
  archive: { method: 'POST', run: (b) => api.archive(idOf(b), { actor: 'person' }) },
  restore: { method: 'POST', run: (b) => api.restore(idOf(b), { actor: 'person' }) },
  note: { method: 'POST', run: (b) => api.addNote(idOf(b), b.text, { actor: 'person' }) },
  'clear-demo': { method: 'POST', run: (b) => (b.confirm === true ? api.clearDemo({ actor: 'person' }) : { ok: false, error: 'confirm_required', detail: 'clear-demo needs { confirm: true }' }) },
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
    const answer = route.run(input)
    return sendJson(res, statusOf(answer), answer)
  } catch (e) {
    console.log('[kybernos-contacts] route failed: ' + String((e && e.message) || e).slice(0, 200))
    return refuse(res, 500, 'failed')
  }
}

/** Mounts the routes on the web server service; answers what `register` gave back so the caller can take them off again. */
export function mountRoutes (webServer, api) {
  const off = []
  for (const [name, route] of Object.entries(routeTable(api))) {
    const retrait = webServer.register({ kind: 'exact', path: ROUTE + name, handler: handlerFor(route) })
    if (typeof retrait === 'function') off.push(retrait)
  }
  return off
}

export function apply (ctx, options) {
  try {
    tellWhenReady(options)
  } catch (e) {
    console.log('[kybernos-contacts] disabled: ' + String(e && e.message ? e.message : e))
  }
  try {
    if (ctx === null || ctx === undefined || typeof ctx.get !== 'function') return // no services to mount on: nothing to do, nothing to say
    const api = makeApi()
    const retraits = []
    if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => () => { for (const retrait of retraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } } }, 'kybernos-contacts: routes and tools')
    const mount = (c) => {
      try {
        const webServer = c.get('webServer')
        if (webServer !== undefined) retraits.push(...mountRoutes(webServer, api))
      } catch (e) { console.log('[kybernos-contacts] routes not mounted: ' + String((e && e.message) || e)) }
    }
    if (ctx.get('webServer') !== undefined) mount(ctx)
    else ctx.inject(['webServer'], mount)
    const mountTools = (c) => {
      try {
        const registry = c.get('tools')
        if (registry === undefined) return
        for (const tool of contactsTools(api)) { const retrait = registry.register(tool); if (typeof retrait === 'function') retraits.push(retrait) }
      } catch (e) { console.log('[kybernos-contacts] tools not registered: ' + String((e && e.message) || e)) }
    }
    if (ctx.get('tools') !== undefined) mountTools(ctx)
    else ctx.inject(['tools'], mountTools)
    // The approval of a write: the engine asks the person before contacts_upsert runs, every time (a read tool is never gated).
    if (typeof ctx.on === 'function') {
      const retrait = ctx.on('tools/pre-execute', async (exec, next) => {
        let gate = null
        try { gate = approvalGate(exec) } catch (e) { gate = null }
        return gate === null ? next() : gate
      })
      if (typeof retrait === 'function') retraits.push(retrait)
    }
  } catch (e) {
    console.log('[kybernos-contacts] host disabled: ' + String(e && e.message ? e.message : e))
  }
}
