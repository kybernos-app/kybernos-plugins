// kybernos-servers, host half: add a Kybernos server from its address, switch between servers, rename and remove them.
//
// The open half of the cloud (kybernos-cloud) reads which server is active; this plugin MANAGES the list. They meet in two places only: the
// registry file (<DSH home>/kybernos/servers.json, `KYBERNOS_SERVERS_FILE` overrides) and two routes of the cloud plugin
// (GET /kybernos-cloud/server, POST /kybernos-cloud/server/apply). The cloud plugin is the judge of a profile: what it refuses is undone here.
//
//   GET  /kybernos-servers/status    the servers the cloud plugin sees (which one is active, signed in), with the addresses each publishes
//   POST /kybernos-servers/check     { address }                      discovery only (three steps, the name to propose); writes nothing
//   POST /kybernos-servers/add       { address, name?, activate? }    discovers again HERE (the page's profile is never trusted), writes, switches
//   POST /kybernos-servers/switch    { id }
//   POST /kybernos-servers/rename    { id, name }
//   POST /kybernos-servers/remove    { id }                           forgets that server's sign-in on this device; nothing is touched on the server
//
// A server is an address and the person's account on it: nothing here asks for anything else. Every POST is same-origin strict (plugin
// routes are served before DSH's own auth): a request that names no origin of this server is refused.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { discover, slugFor } from './discovery.mjs'
import { BUILTIN_ID, ID, cleanName, findByApi, suggestName, uniqueId, uniqueName, withName, withProfile, without } from './registry.mjs'

export const dshHome = (env = process.env) => {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(homedir(), '.dsh')
  if (raw === '~') return homedir()
  return resolve(raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw)
}
const registryFile = () => { const v = typeof process.env.KYBERNOS_SERVERS_FILE === 'string' ? process.env.KYBERNOS_SERVERS_FILE.trim() : ''; return v === '' ? join(dshHome(), 'kybernos', 'servers.json') : v }
const connectionFile = (id) => join(dshHome(), 'kybernos-cloud-' + id + '.json')

const writeText = (file, text) => {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = file + '.tmp-' + process.pid
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, file)
  try { chmodSync(file, 0o600) } catch (e) { /* exotic filesystem */ }
}

/** The registry as written on disk, for WRITING it back: `{ registry, text }`; `text` is the file as it was (null when there was none).
 *  `registry: null` = the file exists but is not ours to overwrite (unreadable, or not an object). */
const loadRegistry = () => {
  const file = registryFile()
  let text = null
  try { text = readFileSync(file, 'utf8') } catch (e) { return { registry: { active: null, servers: [] }, text: null } }
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { registry: null, text }
    return { registry: { active: typeof parsed.active === 'string' ? parsed.active : null, servers: Array.isArray(parsed.servers) ? parsed.servers.slice() : [] }, text }
  } catch (e) { return { registry: null, text } }
}
const saveRegistry = (registry) => writeText(registryFile(), JSON.stringify(registry, null, 2) + '\n')
/** Puts the file back exactly as it was before an operation (or removes it when there was none). */
const restoreRegistry = (text) => { if (text === null) { try { rmSync(registryFile(), { force: true }) } catch (e) { /* nothing to remove */ } } else writeText(registryFile(), text) }

/** A call to a sibling route of this same DSH (the cloud plugin). Never throws: `{ ok, status, body }`. */
const localCall = async (req, path, method = 'GET') => {
  const port = req.socket !== undefined && req.socket !== null ? req.socket.localPort : undefined
  if (typeof port !== 'number') return { ok: false, status: 0, body: null }
  try {
    const r = await fetch('http://127.0.0.1:' + port + path, { method, headers: { origin: 'http://127.0.0.1:' + port }, signal: AbortSignal.timeout(60000) })
    let body = null
    try { body = await r.json() } catch (e) { body = null }
    return { ok: r.ok, status: r.status, body }
  } catch (e) { return { ok: false, status: 0, body: null } }
}
const engineVersion = async (req) => {
  const r = await localCall(req, '/kybernos-maintenance/state')
  return r.ok && r.body !== null && typeof r.body.global === 'string' ? r.body.global : null
}
const cloudView = async (req) => {
  const r = await localCall(req, '/kybernos-cloud/server')
  return r.ok && r.body !== null && r.body.ok === true ? r.body : null
}
const applyActive = async (req) => {
  const r = await localCall(req, '/kybernos-cloud/server/apply', 'POST')
  return r.ok && r.body !== null && r.body.ok === true ? { ok: true, apply: r.body } : { ok: false, error: r.status === 0 ? 'cloud_plugin_missing' : 'apply_failed' }
}

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

/** One strict same-origin check, the same rule as the cloud plugin's relay: no origin named = refused. */
export const sameOriginStrict = (req) => {
  try {
    const headers = req !== null && req !== undefined && req.headers !== null && req.headers !== undefined ? req.headers : {}
    const source = typeof headers.origin === 'string' && headers.origin !== '' ? headers.origin : (typeof headers.referer === 'string' && headers.referer !== '' ? headers.referer : null)
    if (source === null) return false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    const port = sock !== null && typeof sock.localPort === 'number' ? ':' + sock.localPort : ''
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host)
  } catch (e) { return false }
}

const namesOf = (servers) => servers.map((s) => (s !== null && typeof s === 'object' ? s.name : null)).filter((n) => typeof n === 'string')
const idsOf = (servers) => servers.map((s) => (s !== null && typeof s === 'object' ? s.id : null)).filter((n) => typeof n === 'string')
const bodyOf = (body) => (body !== null && typeof body === 'object' ? body : {})

// ── Operations (exported for the tests) ─────────────────────────────────────────────────────────────

export const status = async (req) => {
  const cloud = await cloudView(req)
  if (cloud === null) return { ok: true, cloud: null }
  // The cloud plugin lists each server's api and llm; the page also shows web and console when the profile names them.
  const { registry } = loadRegistry()
  const stored = registry === null ? [] : registry.servers
  const servers = cloud.servers.map((s) => {
    const entry = stored.find((e) => e !== null && typeof e === 'object' && e.id === s.id)
    return entry === undefined ? s : Object.assign({}, s, typeof entry.web === 'string' ? { web: entry.web } : {}, typeof entry.console === 'string' ? { console: entry.console } : {})
  })
  return { ok: true, cloud: { server: cloud.server, servers, source: cloud.source, error: cloud.error, rejected: cloud.rejected } }
}

export const check = async (req, body) => {
  const found = await discover(bodyOf(body).address, { dshVersion: await engineVersion(req) })
  if (found.ok !== true) return { ok: false, steps: found.steps, error: found.error, dsh_min: found.dsh_min }
  const cloud = await cloudView(req)
  const listed = cloud === null ? undefined : findByApi(cloud.servers, found.profile.api)
  if (listed !== undefined) return { ok: false, steps: found.steps, error: 'already_listed', id: listed.id }
  const names = cloud === null ? [] : namesOf(cloud.servers)
  return { ok: true, steps: found.steps, profile: found.profile, host: found.host, published: found.published, suggested: suggestName(found.published, found.host, names) }
}

export const add = async (req, body) => {
  const input = bodyOf(body)
  const loaded = loadRegistry()
  if (loaded.registry === null) return { ok: false, error: 'registry_unreadable' }
  const cloud = await cloudView(req)
  if (cloud === null) return { ok: false, error: 'cloud_plugin_missing' }
  const found = await discover(input.address, { dshVersion: await engineVersion(req) })
  if (found.ok !== true) return { ok: false, error: found.error, steps: found.steps, dsh_min: found.dsh_min }
  const listed = findByApi(cloud.servers, found.profile.api)
  if (listed !== undefined) return { ok: false, error: 'already_listed', id: listed.id }
  const names = namesOf(cloud.servers)
  const typed = uniqueName(input.name, names)
  const name = typed !== '' ? typed : suggestName(found.published, found.host, names)
  // The id follows the name the person will see (it ends up in a file name), never the name every server answers by default.
  const profile = Object.assign({}, found.profile, { id: uniqueId(slugFor(name, found.host), idsOf(loaded.registry.servers)), name })
  const before = loaded.registry.active
  saveRegistry(withProfile(loaded.registry, profile))
  // The cloud plugin is the judge of a profile: if it refuses this one, the file goes back exactly as it was.
  const seen = await cloudView(req)
  if (seen === null || seen.servers.some((s) => s.id === profile.id) !== true) {
    restoreRegistry(loaded.text)
    const why = seen !== null && Array.isArray(seen.rejected) ? seen.rejected.find((r) => r.id === profile.id) : undefined
    return { ok: false, error: seen === null ? 'cloud_plugin_missing' : 'profile_refused', detail: why !== undefined ? why.error : undefined }
  }
  if (input.activate === false) return { ok: true, id: profile.id, active: false, profile: seen.servers.find((s) => s.id === profile.id) }
  saveRegistry({ active: profile.id, servers: withProfile(loaded.registry, profile).servers })
  const out = await applyActive(req)
  if (out.ok !== true) {
    // The server stays added; only the switch is undone.
    saveRegistry({ active: before, servers: withProfile(loaded.registry, profile).servers })
    return { ok: false, error: out.error, id: profile.id, added: true }
  }
  return { ok: true, id: profile.id, active: true, profile: seen.servers.find((s) => s.id === profile.id), apply: out.apply }
}

export const switchTo = async (req, body) => {
  const id = bodyOf(body).id
  if (typeof id !== 'string' || ID.test(id) !== true) return { ok: false, error: 'bad_id' }
  const { registry } = loadRegistry()
  if (registry === null) return { ok: false, error: 'registry_unreadable' }
  const cloud = await cloudView(req)
  if (cloud === null) return { ok: false, error: 'cloud_plugin_missing' }
  if (cloud.servers.some((s) => s.id === id) !== true) return { ok: false, error: 'unknown_server' }
  const before = registry.active
  saveRegistry({ active: id, servers: registry.servers })
  const out = await applyActive(req)
  if (out.ok !== true) { saveRegistry({ active: before, servers: registry.servers }); return out }
  return { ok: true, id, apply: out.apply }
}

export const rename = async (req, body) => {
  const input = bodyOf(body)
  if (typeof input.id !== 'string' || ID.test(input.id) !== true || input.id === BUILTIN_ID) return { ok: false, error: 'bad_id' }
  const { registry } = loadRegistry()
  if (registry === null) return { ok: false, error: 'registry_unreadable' }
  if (registry.servers.some((s) => s !== null && typeof s === 'object' && s.id === input.id) !== true) return { ok: false, error: 'unknown_server' }
  const others = namesOf(registry.servers.filter((s) => s !== null && typeof s === 'object' && s.id !== input.id)).concat(['Kybernos Cloud'])
  const name = uniqueName(input.name, others)
  if (name === '' || cleanName(input.name) === '') return { ok: false, error: 'bad_name' }
  saveRegistry(withName(registry, input.id, name))
  return { ok: true, id: input.id, name }
}

export const remove = async (req, body) => {
  const id = bodyOf(body).id
  if (typeof id !== 'string' || ID.test(id) !== true || id === BUILTIN_ID) return { ok: false, error: 'bad_id' }
  const { registry } = loadRegistry()
  if (registry === null) return { ok: false, error: 'registry_unreadable' }
  if (registry.servers.some((s) => s !== null && typeof s === 'object' && s.id === id) !== true) return { ok: false, error: 'unknown_server' }
  let apply = null
  let next = registry
  if (registry.active === id) {
    // Leaving the server being removed comes first, so the model route it left is cleaned by the cloud plugin.
    next = { active: BUILTIN_ID, servers: registry.servers }
    saveRegistry(next)
    const out = await applyActive(req)
    if (out.ok !== true) { saveRegistry(registry); return out }
    apply = out.apply
  }
  saveRegistry(without(next, id))
  try { rmSync(connectionFile(id), { force: true }) } catch (e) { /* nothing to forget */ }
  return { ok: true, id, apply }
}

export const ROUTES = [
  { path: '/kybernos-servers/status', method: 'GET', run: status },
  { path: '/kybernos-servers/check', method: 'POST', strict: true, body: true, run: check },
  { path: '/kybernos-servers/add', method: 'POST', strict: true, body: true, run: add },
  { path: '/kybernos-servers/switch', method: 'POST', strict: true, body: true, run: switchTo },
  { path: '/kybernos-servers/rename', method: 'POST', strict: true, body: true, run: rename },
  { path: '/kybernos-servers/remove', method: 'POST', strict: true, body: true, run: remove },
]

const sendJson = (res, code, payload) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(payload)) }
const readBody = (req, cap = 8 * 1024) => new Promise((resolveBody) => {
  const chunks = []
  let size = 0
  req.on('data', (c) => { size += c.length; if (size > cap) { resolveBody(null); req.destroy?.() } else chunks.push(c) })
  req.on('end', () => { try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { resolveBody(null) } })
  req.on('error', () => resolveBody(null))
})

export const mount = (ctx, rawWebServer) => {
  const webServer = kbFenced(rawWebServer)
  for (const route of ROUTES) {
    const handler = async (req, res) => {
      if (req.method !== route.method) return sendJson(res, 405, { ok: false, error: route.method + ' expected' })
      if (route.strict === true && sameOriginStrict(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
      try {
        const body = route.body === true ? await readBody(req, route.cap) : null
        if (route.body === true && body === null) return sendJson(res, 400, { ok: false, error: 'a JSON body was expected' })
        sendJson(res, 200, await route.run(req, body))
      } catch (e) {
        console.error('[kybernos-servers] ' + route.path + ': ' + String((e && e.message) || e))
        sendJson(res, 500, { ok: false, error: 'internal error' })
      }
    }
    ctx.effect(() => webServer.register({ kind: 'exact', path: route.path, handler }), 'kybernos-servers: route ' + route.path)
  }
  console.log('[kybernos-servers] routes /kybernos-servers/* registered (status, check, add, switch, rename, remove)')
}
