// Which Kybernos server this DSH talks to: the profile, the registry, and the rules that turn them into addresses.
//
// This file is the open half of "Select server". It knows how to READ the registry and answer « which server is active, and
// where are its api, web, console and LLM »; it has no screen, no licence and no way to add a server. A paid module (a
// separate plugin, in the private repo) owns that: its screen writes the registry file, then asks the cloud plugin to apply
// it (POST /kybernos-cloud/server/apply). Anyone can edit the file by hand: what the module sells is the management of
// servers (discovery, sign-in, the licence), not the ability to read a file.
//
// Registry: <DSH home>/kybernos/servers.json  (KYBERNOS_SERVERS_FILE overrides)
//   { "active": "acme", "servers": [ { "id": "acme", "name": "Acme", "api": "https://kb.acme.example",
//       "web": "https://kb.acme.example/app", "console": "https://kb.acme.example/app/workspace-console",
//       "services": { "llm": "https://llm.acme.example", "gateway": null } } ] }
//   - `api` is required; `web` and `console` are derived from it when absent;
//   - services.llm: a URL = the OpenAI-compatible base DSH sends chat to; null/absent = same host as `api` (today's Kybernos
//     Cloud); false = THIS SERVER HAS NO KYBERNOS LLM (a normal case: DSH imports no « kybernos » models and the console hides
//     the LLM pages);
//   - services.gateway: the LLM service's admin gateway, only used by the console's key mode, which goes away with the key
//     hand-off (docs/dev/servers.md);
//   - https only; http only for a loopback address (a bearer token never crosses a clear network).
// One server is active at a time. Each server has its OWN connection file (kybernos-cloud-<id>.json), so switching never
// signs anyone out and never lets one server's token reach another.
import { readFileSync } from 'node:fs'

export const DEFAULT_SERVER_ID = 'kybernos-cloud'
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const MAX_URL = 300

const urlOrNull = (value) => {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw === '' || raw.length > MAX_URL) return null
  let u = null
  try { u = new URL(raw) } catch (e) { return null }
  if (u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '') return null
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return null
  return u.origin + u.pathname.replace(/\/+$/, '')
}

/** « https://api.x.y » → « https://x.y » (the Kybernos convention); any other host keeps its own origin. */
export const deriveWeb = (api) => {
  const clean = urlOrNull(api)
  if (clean === null) return null
  const u = new URL(clean)
  return u.protocol + '//' + u.host.replace(/^api\./, '')
}

export const DEFAULT_PROFILE = Object.freeze({
  id: DEFAULT_SERVER_ID,
  name: 'Kybernos Cloud',
  api: 'https://api.dev.kybernos.app',
  web: 'https://dev.kybernos.app',
  console: 'https://dev.kybernos.app/workspace-console',
  services: Object.freeze({ llm: null, gateway: 'https://api.dev2.kybernos.app' }),
})

/** `{ ok: true, profile }` or `{ ok: false, error }`. A field that is present and invalid refuses the whole profile: a
 *  typo must never silently fall back to another server's address. */
export const normalizeProfile = (raw) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not_an_object' }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (ID.test(id) !== true) return { ok: false, error: 'bad_id' }
  if (id === DEFAULT_SERVER_ID) return { ok: false, error: 'reserved_id' }
  const api = urlOrNull(raw.api)
  if (api === null) return { ok: false, error: 'bad_api' }
  const given = (key) => raw[key] !== undefined && raw[key] !== null
  let web = deriveWeb(api)
  if (given('web')) { web = urlOrNull(raw.web); if (web === null) return { ok: false, error: 'bad_web' } }
  let consoleUrl = web + '/workspace-console'
  if (given('console')) { consoleUrl = urlOrNull(raw.console); if (consoleUrl === null) return { ok: false, error: 'bad_console' } }
  const services = raw.services !== null && typeof raw.services === 'object' && Array.isArray(raw.services) === false ? raw.services : {}
  let llm = null
  if (services.llm === false) llm = false
  else if (services.llm !== undefined && services.llm !== null) { llm = urlOrNull(services.llm); if (llm === null) return { ok: false, error: 'bad_llm' } }
  let gateway = null
  if (services.gateway !== undefined && services.gateway !== null) { gateway = urlOrNull(services.gateway); if (gateway === null) return { ok: false, error: 'bad_gateway' } }
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim().slice(0, 60) : id
  return { ok: true, profile: Object.freeze({ id, name, api, web, console: consoleUrl, services: Object.freeze({ llm, gateway }) }) }
}

/** Never throws: a missing, unreadable or malformed file is « no registry ». Invalid entries are dropped and listed. */
export const readRegistry = (file) => {
  const empty = { active: null, servers: [], rejected: [] }
  let parsed = null
  try { parsed = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return empty }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return empty
  const servers = []
  const rejected = []
  const seen = new Set()
  for (const raw of Array.isArray(parsed.servers) ? parsed.servers : []) {
    const out = normalizeProfile(raw)
    const id = raw !== null && typeof raw === 'object' && typeof raw.id === 'string' ? raw.id : null
    if (out.ok !== true) { rejected.push({ id, error: out.error }); continue }
    if (seen.has(out.profile.id)) { rejected.push({ id: out.profile.id, error: 'duplicate_id' }); continue }
    seen.add(out.profile.id)
    servers.push(out.profile)
  }
  return { active: typeof parsed.active === 'string' ? parsed.active.trim() : null, servers, rejected }
}

/** The active server. Precedence: the environment override (KYBERNOS_CLOUD_API: tests and developers), then the registry's
 *  `active`, then the built-in Kybernos Cloud. `error` says why the registry's choice was not honoured. */
export const activeServer = ({ env = process.env, registryFile }) => {
  const registry = registryFile !== undefined ? readRegistry(registryFile) : { active: null, servers: [], rejected: [] }
  const summary = (s) => ({ id: s.id, name: s.name, api: s.api, llm: s.services.llm === false ? 'none' : (s.services.llm !== null ? s.services.llm : 'api') })
  const list = [summary(DEFAULT_PROFILE)].concat(registry.servers.map(summary))
  const fromEnv = urlOrNull(typeof env.KYBERNOS_CLOUD_API === 'string' ? env.KYBERNOS_CLOUD_API : '')
  if (fromEnv !== null) {
    const base = registry.servers.find((s) => s.id === registry.active) || DEFAULT_PROFILE
    return { profile: Object.freeze(Object.assign({}, base, { api: fromEnv, web: deriveWeb(fromEnv), console: deriveWeb(fromEnv) + '/workspace-console' })), source: 'env', servers: list, rejected: registry.rejected }
  }
  if (registry.active !== null && registry.active !== '' && registry.active !== DEFAULT_SERVER_ID) {
    const found = registry.servers.find((s) => s.id === registry.active)
    if (found !== undefined) return { profile: found, source: 'registry', servers: list, rejected: registry.rejected }
    return { profile: DEFAULT_PROFILE, source: 'default', error: 'active_unknown', servers: list, rejected: registry.rejected }
  }
  return { profile: DEFAULT_PROFILE, source: 'default', servers: list, rejected: registry.rejected }
}

/** Each server keeps its own connection file; the built-in one keeps today's name, so nobody is signed out by this change. */
export const stateFileName = (profile) => (profile.id === DEFAULT_SERVER_ID ? 'kybernos-cloud.json' : 'kybernos-cloud-' + profile.id + '.json')

/** The OpenAI-compatible base DSH sends chat to, or null when the server has no Kybernos LLM. */
export const llmBase = (profile) => (profile.services.llm === false ? null : (profile.services.llm !== null ? profile.services.llm : profile.api) + '/v1')

/** What the page may know. No secret lives in a profile; this only drops the shape's internals. */
export const publicProfile = (profile) => ({
  id: profile.id,
  name: profile.name,
  api: profile.api,
  web: profile.web,
  console: profile.console,
  llm: profile.services.llm === false ? 'none' : (profile.services.llm !== null ? profile.services.llm : 'api'),
  gateway: profile.services.gateway,
})
