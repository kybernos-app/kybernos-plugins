// kybernos-registry, host half: the routes, and the seam other bundles reach the registry through.
//
//   GET  /kybernos-registry/state[?fresh=1]                    { ok, version, plugins: [...], points: [...] }: what was read, with each plugin's status (fresh: read the folder again now)
//   GET  /kybernos-registry/contributions?point=owner/n%23p    { ok, contributions: [...] }: what the enabled plugins give one point
//   GET  /kybernos-registry/preview?id=<plugin id>             what an installed plugin brings, checked, for the person to read BEFORE accepting it
//   GET  /kybernos-registry/drafts                              the plugins the AI prepared in <DSH home>/kybernos/plugin-drafts, not installed (same ?fresh=1)
//   POST /kybernos-registry/consent { id, accepted }           the person has read and accepted what a plugin brings (switching on and off is DSH's)
//   POST /kybernos-registry/import  (raw .tgz, x-filename)     keeps an archive the person chose, so DSH's manager can install it from a path (nothing is unpacked here)
//
// The registry READS what DSH's own plugin manager installed (<DSH home>/profiles/web); it installs and switches nothing. The seam, for the host halves of other bundles (they import nothing from each other): `globalThis[Symbol.for('kybernos.registry')]`, the same
// idiom as the trusted-authority predicate. A bundle that finds none works without it. The registry is created lazily and ONCE: reading the plugin
// folder happens when a question is asked, never at boot, so a broken plugin cannot stop DSH from starting.
//
// Plugin routes are served before DSH's own sign-in: a read refuses a foreign Host and a foreign Origin; the write (enable) needs the strict origin
// AND the signed session cookie (docs/dev/route-origin-rule.md, session-guard.mjs).
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
  const registry = createRegistry({ profileDir: join(home, 'profiles', 'web'), stateFile: join(home, 'kybernos', 'plugins-state.json'), draftsDir: join(home, 'kybernos', 'plugin-drafts'), kybernosVersion: suiteVersion(), ...options })
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
/** The request body as bytes, or null when it is larger than `cap` (the rest is not read into memory). */
const readRaw = async (req, cap) => {
  try {
    let size = 0
    const chunks = []
    for await (const chunk of req) { size += chunk.length; if (size > cap) return null; chunks.push(chunk) }
    return Buffer.concat(chunks)
  } catch (e) { return null }
}
export const IMPORT_MAX = 8 * 1024 * 1024
export const IMPORT_KEEP = 20
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

/** A page that has just asked DSH for a change (install, switch, remove) wants the folder read again now, not after the scan's few seconds of reuse. */
const fresh = (registry, req) => { if (queryOf(req).get('fresh') === '1') registry.refresh() }
const stateRoute = (registry) => async (req) => { fresh(registry, req); return { ok: true, version: 1, plugins: registry.plugins(), points: registry.points() } }
const contributionsRoute = (registry) => async (req) => {
  const point = queryOf(req).get('point')
  if (typeof point !== 'string' || !/^[a-z][a-z0-9-]{1,31}\/[a-z][a-z0-9-]{1,39}#[a-z][a-z0-9-]{1,31}$/.test(point)) return { ok: false, error: 'a point is owner/name#point' }
  return { ok: true, contributions: registry.contributions(point) }
}
const previewRoute = (registry) => async (req) => {
  const id = queryOf(req).get('id')
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{1,31}\/[a-z][a-z0-9-]{1,39}$/.test(id)) return { ok: false, error: 'a plugin id is author/name' }
  const preview = registry.preview(id)
  return preview === null ? { ok: false, error: 'unknown plugin' } : { ok: true, preview }
}
const draftsRoute = (registry) => async (req) => { fresh(registry, req); return { ok: true, drafts: registry.drafts() } }
/** Keeps the archive the person chose where DSH's manager can read it. The archive is NOT unpacked here: pnpm, inside DSH's manager, does that. */
const importRoute = (registry, paths) => async (req, body) => {
  if (body === null) return { ok: false, error: 'the file is larger than ' + Math.round(IMPORT_MAX / 1048576) + ' MB' }
  const name = typeof req.headers['x-filename'] === 'string' ? req.headers['x-filename'] : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(tgz|tar\.gz)$/.test(name)) return { ok: false, error: 'a .tgz or .tar.gz file is expected' }
  if (body.length < 32 || body[0] !== 0x1f || body[1] !== 0x8b) return { ok: false, error: 'this is not a gzip archive' }
  mkdirSync(paths.importsDir, { recursive: true, mode: 0o700 })
  const file = join(paths.importsDir, new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + name)
  const tmp = file + '.tmp-' + process.pid
  writeFileSync(tmp, body, { mode: 0o600 })
  renameSync(tmp, file)
  try {
    const old = readdirSync(paths.importsDir).filter((f) => /\.(tgz|tar\.gz)$/.test(f)).sort().slice(0, -IMPORT_KEEP)
    for (const f of old) rmSync(join(paths.importsDir, f), { force: true })
  } catch (e) { /* housekeeping only */ }
  return { ok: true, path: file, bytes: statSync(file).size }
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
  { path: '/kybernos-registry/preview', method: 'GET', guarded: true, make: previewRoute },
  { path: '/kybernos-registry/drafts', method: 'GET', guarded: true, make: draftsRoute },
  { path: '/kybernos-registry/consent', method: 'POST', guarded: true, session: true, body: true, make: consentRoute },
  { path: '/kybernos-registry/import', method: 'POST', guarded: true, session: true, raw: IMPORT_MAX, make: importRoute }
]

export function mount (ctx, webServer, registry = ensureRegistry(), paths = { importsDir: join(dshHome(), 'kybernos', 'plugin-imports') }) {
  const server = kbFenced(webServer)
  for (const route of ROUTES) {
    const run = route.make(registry, paths)
    const handler = async (req, res) => {
      if (req.method !== route.method) return sendJson(res, 405, { ok: false, error: route.method + ' expected' })
      if (route.guarded === true && sameOrigin(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
      if (route.session === true) {
        const refused = writeGuard(req)
        if (refused !== null) return sendJson(res, refused.status, { ok: false, error: refused.error })
      }
      try {
        const body = route.body === true ? await readJsonBody(req) : route.raw !== undefined ? await readRaw(req, route.raw) : null
        const answer = await run(req, body)
        sendJson(res, answer.ok === false && answer.error === 'unknown plugin' ? 404 : answer.ok === false && /larger than/.test(answer.error) ? 413 : answer.ok === false ? 400 : 200, answer)
      } catch (e) {
        console.error('[kybernos-registry] ' + route.path + ': ' + String((e && e.message) || e))
        sendJson(res, 500, { ok: false, error: 'internal error' })
      }
    }
    ctx.effect(() => server.register({ kind: 'exact', path: route.path, handler }), 'kybernos-registry: route ' + route.path)
  }
}
