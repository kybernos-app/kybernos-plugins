// kybernos-websearch: the host half's logic, with its I/O injected so test-host.mjs plays it without DSH, a disk or a network.
//
//   createWebSearch(io)  the service: the provider DSH's web seam is given, the settings, the keys, the page's state
//   mountRoutes(...)     the four HTTP routes of the Settings page
//
// DSH serves plugin routes BEFORE its own authentication, so every route refuses a foreign Host, and every route that
// changes or spends something also checks the request comes from the page's own origin. A key never leaves this module:
// the page is told whether a key is there, never what it is, and only the credential names the engines declare can be written.
import { ENGINES } from './engines.mjs'
import { createRouter } from './router.mjs'
import { applyPatch, normalizeSettings } from './settings.mjs'

export const PROVIDER_ID = 'kybernos-search'

export const ROUTES = {
  state: '/kybernos-websearch/state',
  settings: '/kybernos-websearch/settings',
  key: '/kybernos-websearch/key',
  test: '/kybernos-websearch/test',
  seam: '/kybernos-websearch/seam'
}

const KEY_NAMES = new Set(ENGINES.flatMap((e) => e.refs.map((r) => r.ref)))
const TEST_QUERY = 'open source search engine'

/**
 * @param {{
 *   read: () => unknown,
 *   write: (doc: object) => void,
 *   resolveKey: (ref: string) => Promise<string|null>,
 *   describeKey?: (ref: string) => Promise<{ configured: boolean, source?: string }>,
 *   setKey?: (ref: string, value: string) => Promise<void>,
 *   unsetKey?: (ref: string) => Promise<void>,
 *   http: Function,
 *   seam?: () => { registered: boolean, pinned: string|null },
 *   now?: () => number
 * }} io
 */
export function createWebSearch (io) {
  const readSettings = () => { try { return normalizeSettings(io.read()) } catch (e) { return normalizeSettings(null) } }
  const router = createRouter({
    engines: ENGINES,
    readSettings,
    key: async (ref) => { try { const v = await io.resolveKey(ref); return typeof v === 'string' && v !== '' ? v : null } catch (e) { return null } },
    http: io.http,
    now: io.now
  })

  const provider = {
    id: PROVIDER_ID,
    available: () => router.available(),
    search: async (request, signal) => {
      const r = await router.search(request, signal)
      return { sources: r.sources, truncated: r.truncated }
    }
  }

  const keyState = async (ref) => {
    try {
      if (typeof io.describeKey === 'function') {
        const d = await io.describeKey(ref)
        if (d !== null && typeof d === 'object') return { configured: d.configured === true, source: typeof d.source === 'string' ? d.source : null }
      }
      const v = await io.resolveKey(ref)
      return { configured: typeof v === 'string' && v !== '', source: null }
    } catch (e) { return { configured: false, source: null } }
  }

  const state = async () => {
    const s = readSettings()
    const seam = typeof io.seam === 'function' ? io.seam() : { registered: false, pinned: null }
    const engines = []
    for (const id of s.order) {
      const e = ENGINES.find((x) => x.id === id)
      if (e === undefined) continue
      const refs = []
      for (const r of e.refs) refs.push({ ref: r.ref, optional: r.optional === true, ...(await keyState(r.ref)) })
      const keysOk = refs.every((r) => r.optional || r.configured)
      const addressOk = e.field === undefined || e.access === 'free' || (typeof s[e.field] === 'string' && s[e.field] !== '')
      engines.push({
        id: e.id,
        access: e.access,
        field: e.field || null,
        home: e.home || null,
        enabled: s.enabled[e.id] === true,
        configured: e.access === 'free' ? true : (e.access === 'url' ? addressOk : keysOk && addressOk),
        refs,
        health: router.health(e.id)
      })
    }
    return {
      ok: true,
      provider: PROVIDER_ID,
      registered: seam.registered === true,
      pinned: typeof seam.pinned === 'string' ? seam.pinned : null,
      settings: s,
      engines,
      last: router.last()
    }
  }

  const update = (patch) => {
    const next = applyPatch(readSettings(), patch)
    io.write(next)
    // An address that changed may have been what an engine was paused for.
    router.clearCache()
    for (const id of ['searxng', 'custom', 'google-pse']) router.forget(id)
    return next
  }

  const engineOfRef = (ref) => ENGINES.find((e) => e.refs.some((r) => r.ref === ref))

  const setKey = async (ref, value) => {
    if (typeof ref !== 'string' || !KEY_NAMES.has(ref)) return { ok: false, error: 'unknown-key' }
    if (typeof value !== 'string' || value.length < 8 || value.length > 300 || /\s/.test(value)) return { ok: false, error: 'invalid-key' }
    if (typeof io.setKey !== 'function') return { ok: false, error: 'store-unavailable' }
    try { await io.setKey(ref, value) } catch (e) { return { ok: false, error: 'store-refused' } }
    const e = engineOfRef(ref)
    if (e !== undefined) router.forget(e.id)
    return { ok: true }
  }

  const clearKey = async (ref) => {
    if (typeof ref !== 'string' || !KEY_NAMES.has(ref)) return { ok: false, error: 'unknown-key' }
    if (typeof io.unsetKey !== 'function') return { ok: false, error: 'store-unavailable' }
    try { await io.unsetKey(ref) } catch (e) { return { ok: false, error: 'store-refused' } }
    return { ok: true }
  }

  const test = async (id, query) => {
    const q = typeof query === 'string' && query.trim() !== '' ? query.trim().slice(0, 200) : TEST_QUERY
    return router.probe(id, q)
  }

  /** One search THROUGH DSH's web seam: proves the seam picks this provider (the pin in the profile is what decides). */
  const seamTest = async (query) => {
    if (typeof io.seamSearch !== 'function') return { ok: false, code: 'NO_SEAM', message: 'the web seam is not available' }
    const q = typeof query === 'string' && query.trim() !== '' ? query.trim().slice(0, 200) : TEST_QUERY
    const t0 = (io.now || Date.now)()
    try {
      const r = await io.seamSearch(q)
      const last = router.last()
      return {
        ok: true,
        count: Array.isArray(r && r.sources) ? r.sources.length : 0,
        ms: (io.now || Date.now)() - t0,
        engine: last !== null && last !== undefined ? last.engine : null,
        sample: (Array.isArray(r && r.sources) ? r.sources : []).slice(0, 3).map((x) => ({ title: String(x.title || ''), url: String(x.url || '') }))
      }
    } catch (e) {
      return { ok: false, code: typeof (e && e.code) === 'string' ? e.code : 'ERROR', message: String((e && e.message) || e).slice(0, 400) }
    }
  }

  return { provider, router, state, update, setKey, clearKey, test, seamTest, readSettings }
}

// ── routes ──────────────────────────────────────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' ? v : null)
const errText = (e) => (e && e.message ? String(e.message) : String(e))
// Hosted instance: also accept the authorities declared to DSH with --trusted-host (published by the core bundle; absent or failing, false).
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs): a page that rebinds its own name to this machine reaches plugin routes with its own name as Host.
const kbHostOK = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}
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
      }
    })
    : route)
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => target.register(fence(route)) : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

/** Strict origin check, for the routes that act: no Origin (nor Referer) is refused; compared to the socket's real address. */
export const sameOriginStrict = (req) => {
  try {
    const headers = (req !== null && req !== undefined && req.headers !== null && req.headers !== undefined) ? req.headers : {}
    const source = str(headers.origin) ?? str(headers.referer)
    if (source === null) return false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const sock = (req.socket !== null && req.socket !== undefined) ? req.socket : null
    const port = (sock !== null && typeof sock.localPort === 'number') ? ':' + sock.localPort : ''
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host)
  } catch (e) { return false }
}

export const sendJson = (res, status, payload) => {
  try {
    const body = JSON.stringify(payload === undefined ? null : payload)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  } catch (e) { try { res.writeHead(500); res.end('{}') } catch (e2) { /* socket closed */ } }
}

export const readJsonBody = async (req, maxBytes = 16384) => {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (e) { return {} }
}

/** Registers the routes. `effect(fn, label)` wraps each registration so it is undone with the plugin (ctx.effect in DSH). */
export function mountRoutes (webServer, svc, effect = (fn) => fn()) {
  const server = kbFenced(webServer)
  const reg = (path, handler, label) => effect(() => server.register({ kind: 'exact', path, handler }), 'kybernos-websearch: route ' + label)
  const guarded = (method, fn) => async (req, res) => {
    if (req.method !== method) return sendJson(res, 405, { ok: false, error: method + ' expected' })
    if (method === 'POST' && sameOriginStrict(req) !== true) return sendJson(res, 403, { ok: false, error: 'origin refused' })
    try { return await fn(req, res) } catch (e) { return sendJson(res, 500, { ok: false, error: errText(e).slice(0, 200) }) }
  }

  reg(ROUTES.state, guarded('GET', async (req, res) => sendJson(res, 200, await svc.state())), 'state')

  reg(ROUTES.settings, guarded('POST', async (req, res) => {
    const body = await readJsonBody(req)
    svc.update(body)
    return sendJson(res, 200, await svc.state())
  }), 'settings')

  reg(ROUTES.key, guarded('POST', async (req, res) => {
    const body = await readJsonBody(req)
    const done = body.clear === true ? await svc.clearKey(body.ref) : await svc.setKey(body.ref, body.value)
    if (done.ok !== true) return sendJson(res, 400, done)
    return sendJson(res, 200, await svc.state())
  }), 'key')

  reg(ROUTES.test, guarded('POST', async (req, res) => {
    const body = await readJsonBody(req)
    if (typeof body.id !== 'string') return sendJson(res, 400, { ok: false, error: 'engine expected' })
    const result = await svc.test(body.id, body.query)
    return sendJson(res, 200, { ok: true, result, state: await svc.state() })
  }), 'test')

  reg(ROUTES.seam, guarded('POST', async (req, res) => {
    const body = await readJsonBody(req)
    const result = await svc.seamTest(body.query)
    return sendJson(res, 200, { ok: true, result, state: await svc.state() })
  }), 'seam')
}
