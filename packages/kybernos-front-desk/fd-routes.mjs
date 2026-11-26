// The routes of the front-desk plugin, all under /kybernos-front-desk/. DSH serves plugin routes BEFORE its own sign-in, so every route here (reads
// included: they show a shop's conversations) is behind the host fence and DSH's signed session cookie (session-guard.mjs, the shared copy):
//
//   GET  /kybernos-front-desk/state              the service's state, the settings (never a secret), what is missing to start
//   POST /kybernos-front-desk/config             { publicUrl?, model?: { baseUrl, name, apiKey }, telegram?: { token } | { off: true } }
//   POST /kybernos-front-desk/start | stop
//   GET  /kybernos-front-desk/logs?n=
//   GET  /kybernos-front-desk/atelier | boite | preview      the service's own owner pages, forwarded (they are framed by this plugin's page)
//   *    /kybernos-front-desk/api/*              the service's owner API, forwarded with the owner token the browser never sees
//
// The plugin's own routes only drive the supervisor and the config file; everything about a shop goes through the forwarded API.

import { writeGuard } from './session-guard.mjs'
import { createProxy } from './fd-proxy.mjs'

export const ROUTE = '/kybernos-front-desk'
const BODY_MAX = 8 * 1024

// Hosted instance: also accept the authorities declared to DSH with --trusted-host (published by the core bundle).
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs): a Host that is not this listener's is refused before anything else runs. A request with no socket (a test) is not judged.
export const hostOk = (req) => {
  try {
    const host = typeof (req.headers && req.headers.host) === 'string' ? req.headers.host : null
    const sock = req.socket
    if (host === null || sock === null || sock === undefined || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].includes(host) || kbTrusted(host)
  } catch (e) { return false }
}

const send = (res, code, obj, extra) => {
  try {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra })
    res.end(JSON.stringify(obj))
  } catch (e) { /* socket closed */ }
}

async function readJson (req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > BODY_MAX) throw Object.assign(new Error('too large'), { code: 413 })
    chunks.push(c)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  const body = JSON.parse(text)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('not an object'), { code: 400 })
  return body
}
const isJson = (req) => String((req.headers && req.headers['content-type']) || '').toLowerCase().startsWith('application/json')

/** The shop's name, slug and version as the service says them, or null while it is not reachable. */
async function shopOf (target, fetchImpl) {
  if (target === null) return null
  try {
    const r = await fetchImpl(`http://127.0.0.1:${target.port}/api/status`, { headers: { authorization: `Bearer ${target.token}` }, signal: AbortSignal.timeout(2500) })
    if (r.status !== 200) return null
    const s = await r.json()
    return { name: s.shop && s.shop.name, slug: s.shop && s.shop.slug, version: s.version, channels: s.channels || {}, killed: s.killed === true }
  } catch (e) { return null }
}

/**
 * Mounts the routes on `webServer` (DSH's service). `kbSuivi` wrapping, if any, is done by the caller.
 * `supervisor`, `config`: see fd-supervisor.mjs and fd-config.mjs. Returns nothing; a route that fails to mount throws to the caller's try/catch.
 */
export function mountRoutes (webServer, { supervisor, config, fetchImpl = globalThis.fetch, log = () => {}, request }) {
  const proxy = createProxy({ getTarget: () => supervisor.target(), ...(request ? { request } : {}) })
  const guarded = (handler) => async (req, res) => {
    if (!hostOk(req)) { send(res, 403, { ok: false, error: 'origin refused' }); return }
    const refusal = writeGuard(req)
    if (refusal !== null) { send(res, refusal.status, { ok: false, error: refusal.error }); return }
    try { await handler(req, res) } catch (e) {
      const code = e && Number.isInteger(e.code) && e.code >= 400 && e.code < 500 ? e.code : (e instanceof SyntaxError ? 400 : 500)
      if (code === 500) log('route failed: ' + String((e && e.message) || e).slice(0, 200))
      send(res, code, { ok: false, error: code === 413 ? 'too_big' : code === 400 ? 'bad_json' : 'error' })
    }
  }
  const write = (handler) => guarded(async (req, res) => {
    if (String(req.method || 'GET').toUpperCase() !== 'POST') { send(res, 405, { ok: false, error: 'method' }); return }
    if (!isJson(req)) { send(res, 415, { ok: false, error: 'json_only' }); return }
    await handler(await readJson(req), req, res)
  })
  const get = (handler) => guarded(async (req, res) => {
    if (String(req.method || 'GET').toUpperCase() !== 'GET') { send(res, 405, { ok: false, error: 'method' }); return }
    await handler(req, res)
  })

  webServer.register({ kind: 'exact', path: ROUTE + '/state', handler: get(async (_req, res) => {
    const target = supervisor.target()
    const cfg = config.read()
    const shop = await shopOf(target, fetchImpl)
    const base = target === null || shop === null ? null : `http://127.0.0.1:${target.port}`
    send(res, 200, {
      ok: true,
      service: supervisor.status(),
      ready: config.ready(),
      config: cfg,
      secrets: config.secretsSet(),
      shop: shop === null ? null : { name: shop.name, slug: shop.slug, version: shop.version, killed: shop.killed },
      channels: shop === null ? null : shop.channels,
      localLink: base === null || shop === null ? null : `${base}/c/${shop.slug}`,
      publicLink: cfg.publicUrl === null || shop === null ? null : `${cfg.publicUrl}/c/${shop.slug}`,
    })
  }) })

  webServer.register({ kind: 'exact', path: ROUTE + '/config', handler: write(async (body, _req, res) => {
    const r = config.write(body)
    if (!r.ok) { send(res, 400, r); return }
    // A model, a bot or an address changed: the running service reads them at start, so it is told to restart by the page (not restarted behind the owner's back).
    send(res, 200, { ok: true, ready: config.ready(), config: config.read(), secrets: config.secretsSet(), restartNeeded: supervisor.status().state === 'running' })
  }) })

  webServer.register({ kind: 'exact', path: ROUTE + '/start', handler: write(async (_body, _req, res) => {
    const r = await supervisor.start()
    if (r.ok) config.write({ autostart: true })
    send(res, r.ok ? 200 : 409, r)
  }) })
  webServer.register({ kind: 'exact', path: ROUTE + '/stop', handler: write(async (_body, _req, res) => {
    const r = await supervisor.stop()
    config.write({ autostart: false })
    send(res, 200, r)
  }) })

  webServer.register({ kind: 'exact', path: ROUTE + '/logs', handler: get(async (req, res) => {
    const n = Number(new URL(req.url, 'http://127.0.0.1').searchParams.get('n'))
    send(res, 200, { ok: true, text: supervisor.logs(Number.isFinite(n) && n > 0 ? n : 100) })
  }) })

  // The service's own pages and API, forwarded. `rest` is what follows the plugin's prefix, query string included.
  const forward = guarded(async (req, res) => {
    const url = String(req.url || '')
    const rest = url.slice(url.indexOf(ROUTE + '/') + ROUTE.length + 1)
    await proxy(req, res, rest)
  })
  for (const page of ['atelier', 'boite', 'preview']) webServer.register({ kind: 'exact', path: `${ROUTE}/${page}`, handler: forward })
  // No trailing slash: DSH's prefix match is `path` or `path + '/…'`, so `/api/` would never match anything (seen on a real DSH).
  webServer.register({ kind: 'prefix', path: ROUTE + '/api', handler: forward })
}
