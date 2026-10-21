// kybernos-registry, host half: the routes, and the seam other bundles reach the registry through.
//
//   GET  /kybernos-registry/state                              { ok, version, plugins: [...], points: [...] }: what was read, with each plugin's status
//   GET  /kybernos-registry/contributions?point=owner/n%23p    { ok, contributions: [...] }: what the enabled plugins give one point
//   POST /kybernos-registry/consent { id, accepted }           the person has read and accepted what a plugin brings (switching on and off is DSH's)
//
// The registry READS what DSH's own plugin manager installed (<DSH home>/profiles/web); it installs and switches nothing. The seam, for the host halves of other bundles (they import nothing from each other): `globalThis[Symbol.for('kybernos.registry')]`, the same
// idiom as the trusted-authority predicate. A bundle that finds none works without it. The registry is created lazily and ONCE: reading the plugin
// folder happens when a question is asked, never at boot, so a broken plugin cannot stop DSH from starting.
//
// Plugin routes are served before DSH's own sign-in: a read refuses a foreign Host and a foreign Origin; the write (enable) needs the strict origin
// AND the signed session cookie (docs/dev/route-origin-rule.md, session-guard.mjs).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRegistry } from './registry.mjs'
import { dshHome, writeGuard } from './session-guard.mjs'

export const SEAM = Symbol.for('kybernos.registry')
const HERE = dirname(fileURLToPath(import.meta.url))
/** The suite's version (VERSION at the root of the install), or null: `requires.kybernos` is then not enforced. */
const suiteVersion = () => { try { const v = readFileSync(join(HERE, '..', '..', 'VERSION'), 'utf8').trim(); return /^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(v) ? v : null } catch (e) { return null } }

/** The registry, created once per process and shared through the seam. `options` replace the defaults (a test points it at a temp folder). */
export function ensureRegistry (options = {}) {
  const existing = globalThis[SEAM]
  if (existing !== undefined && existing !== null && existing.version === 1) return existing
  const home = dshHome()
  const registry = createRegistry({ profileDir: join(home, 'profiles', 'web'), stateFile: join(home, 'kybernos', 'plugins-state.json'), kybernosVersion: suiteVersion(), ...options })
  globalThis[SEAM] = registry
  return registry
}

const sendJson = (res, status, payload) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload === undefined ? null : payload))
  } catch (e) {
    try { res.writeHead(500); res.end('{}') } catch (e2) { /* socket closed */ }
  }
}
const readJsonBody = async (req, cap = 4096) => {
  try {
    let size = 0
    const chunks = []
    for await (const chunk of req) { size += chunk.length; if (size > cap) return {}; chunks.push(chunk) }
    const text = Buffer.concat(chunks).toString('utf8')
    if (text.length === 0) return {}
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && Array.isArray(parsed) === false ? parsed : {}
  } catch (e) { return {} }
}
const queryOf = (req) => { try { return new URL(req.url, 'http://localhost').searchParams } catch (e) { return new URLSearchParams('') } }

// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs): a page that rebinds its own name to this machine reaches the routes with its own name as Host.
// Every route refuses a Host that is not this listener's before its own guard runs. A request with no socket (a test) is not judged.
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
/** Never cross-origin: an Origin that is not this listener's is refused (no Origin = a same-origin GET, which a browser sends without one). */
const sameOrigin = (req) => {
  try {
    const origin = req.headers && typeof req.headers.origin === 'string' ? req.headers.origin : ''
    if (origin === '') return true
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (sock === null || typeof sock.localPort !== 'number') return typeof req.headers.host === 'string' && u.host === req.headers.host
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host)
  } catch (e) { return false }
}

const stateRoute = (registry) => async () => ({ ok: true, version: 1, plugins: registry.plugins(), points: registry.points() })
const contributionsRoute = (registry) => async (req) => {
  const point = queryOf(req).get('point')
  if (typeof point !== 'string' || !/^[a-z][a-z0-9-]{1,31}\/[a-z][a-z0-9-]{1,39}#[a-z][a-z0-9-]{1,31}$/.test(point)) return { ok: false, error: 'a point is owner/name#point' }
  return { ok: true, contributions: registry.contributions(point) }
}
const consentRoute = (registry) => async (req, body) => {
  if (typeof body.id !== 'string' || typeof body.accepted !== 'boolean') return { ok: false, error: 'id and accepted are expected' }
  const done = registry.setConsent(body.id, body.accepted)
  return done ? { ok: true, plugin: registry.plugins().find((p) => p.id === body.id) ?? null } : { ok: false, error: 'unknown plugin' }
}

// One path per route (the web server indexes by path only). `session: true` is a route that WRITES.
export const ROUTES = [
  { path: '/kybernos-registry/state', method: 'GET', guarded: true, make: stateRoute },
  { path: '/kybernos-registry/contributions', method: 'GET', guarded: true, make: contributionsRoute },
  { path: '/kybernos-registry/consent', method: 'POST', guarded: true, session: true, body: true, make: consentRoute }
]

export function mount (ctx, webServer, registry = ensureRegistry()) {
  const server = kbFenced(webServer)
  for (const route of ROUTES) {
    const run = route.make(registry)
    const handler = async (req, res) => {
      if (req.method !== route.method) return sendJson(res, 405, { ok: false, error: route.method + ' expected' })
      if (route.guarded === true && sameOrigin(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
      if (route.session === true) {
        const refused = writeGuard(req)
        if (refused !== null) return sendJson(res, refused.status, { ok: false, error: refused.error })
      }
      try {
        const body = route.body === true ? await readJsonBody(req) : null
        const answer = await run(req, body)
        sendJson(res, answer.ok === false && answer.error === 'unknown plugin' ? 404 : answer.ok === false ? 400 : 200, answer)
      } catch (e) {
        console.error('[kybernos-registry] ' + route.path + ': ' + String((e && e.message) || e))
        sendJson(res, 500, { ok: false, error: 'internal error' })
      }
    }
    ctx.effect(() => server.register({ kind: 'exact', path: route.path, handler }), 'kybernos-registry: route ' + route.path)
  }
}
