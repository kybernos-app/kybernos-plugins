// ── Host plugin « kybernos-models » ─────────────────────────────────────────
// The custom model catalogue: an overlay on the « Settings → Models » page
// that prefills a model's characteristics from models.dev and lets the
// user override them.
//
// TWO LEVELS, and that is the heart of the contract:
//
//   · APPLIED TO THE HARNESS — only six fields are accepted by `llm-pi-ai`
//     for an installed model (`providers.<route>.modelOverrides.<id>`):
//     `name`, `contextWindow`, `maxTokens`, `input`, `reasoningEfforts`,
//     `compat`. Written to `settings.yaml`, they really change the calls
//     that follow, with no restart (the profile is re-read at every operation).
//
//   · KYBERNOS ANNOTATION — everything else in the mock-up (pricing, type, family,
//     knowledge, release, weights, TTS/image/video outputs, `search`, `s2s`,
//     max input) has NO equivalent in the harness configuration: the
//     model service does not read the cost (« the absence of a fact, not a
//     configurable rate ») and only knows two input modalities, `text` and
//     `image`. These values therefore live in a plugin file and serve the
//     Kybernos views (cost, readability) — never the calls.
//
// This file is the HOST half: it owns the annotations file and the cached
// models.dev index (4.7 MB: one download for everyone, never per browser).
// Writing the applied fields goes through `remote.settings.mutate` on the
// client side — exactly the path the native Models page takes — so that the settings
// service's validation is the same on both sides.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkKey } from './key-check.mjs'
import { liveModels, probeModel } from './live-models.mjs'
import { origineOK, writeGuard } from './session-guard.mjs'
// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs). DSH serves plugin routes BEFORE its own authentication, and a page that rebinds its own name to this machine
// (DNS rebinding) reaches them with its own name as Host, no cookie and, on a same-origin GET, no Origin (a browser sends none): a guard that looks at the
// Origin alone lets every read through. Every route of this bundle refuses a Host that is not this listener's (the port the socket is bound to, on
// 127.0.0.1 / localhost / [::1], or an authority declared with --trusted-host) before its own guard runs. A request with no socket (a test) is not judged.
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
      },
    })
    : route)
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => target.register(fence(route)) : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

const pluginDir = dirname(fileURLToPath(import.meta.url))

/** Version of the data contract exposed to the client. */
export const MODEL_CATALOG_VERSION = 1

/** The six fields an `llm-pi-ai` profile accepts PER MODEL (source: the
  *  `modelFields` schema of dsh-llm-pi-ai — `models` and `modelOverrides` share these
  *  keys, only the place of the `id` changes). */
export const WIRED_FIELDS = ['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts', 'compat']

/** Every other field of the mock-up: kept, never written to
  *  `settings.yaml` because the harness does not read them. */
export const ANNOTATION_FIELDS = [
  'textIn', 'vision', 'video', 'audioIn', 'textOut', 'tts', 'imageGen', 'videoGen',
  'tools', 'search', 's2s', 'reasoning', 'structured', 'temperature', 'type',
  'context', 'inputLimit', 'outputLimit',
  'costIn', 'costOut', 'cacheRead', 'cacheWrite',
  'family', 'knowledge', 'release', 'weights',
]

// The harness root: `$DSH_HOME` when it is set (like the rest of DSH),
// otherwise `~/.dsh`. The plugin's folder is the same in both cases.
const HOME = (() => {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env
  try { return join(homedir(), '.dsh') } catch (e) { return join('/tmp', '.dsh') }
})()
const STORE_DIR = join(HOME, 'kybernos-models')
const ANNOTATIONS_FILE = join(STORE_DIR, 'catalog.json')
const MODELSDEV_CACHE = join(STORE_DIR, 'modelsdev.json')
const JOURNAL_FILE = join(STORE_DIR, 'journal.ndjson')
/** Age beyond which a models.dev index is considered stale. */
const MODELSDEV_TTL_MS = 6 * 60 * 60 * 1000

// ── External scores: two sources read, no API key ─────────────────
const SCORES_FILE = join(STORE_DIR, 'scores.json')
const SCORES_VERSION = 1
/** Both sources publish a daily snapshot: 24 h of freshness. */
const SCORES_TTL_MS = 24 * 60 * 60 * 1000
const AA_LB_URL = 'https://artificialanalysis.ai/leaderboards/models'
const BENCHLM_URL = 'https://benchlm.ai/data/models.json'
const BENCHLM_CATALOG_URL = 'https://benchlm.ai/data/benchmarks.json'

let bootedAt = null
let annotationsCache = null
let modelsDevCache = null
let modelsDevInflight = null
let scoresCache = null
let scoresInflight = null
let scoresJob = null

// ── Safe JSON: no write must be able to break the profile ──────────────
const readJson = (path, fallback) => {
  try {
    if (existsSync(path) !== true) return fallback
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed === null || parsed === undefined ? fallback : parsed
  } catch (e) { return fallback }
}

const writeJsonAtomic = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.tmp-' + String(process.pid)
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, path)
}

const sendJson = (res, status, body) => {
  try {
    const txt = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(txt)
  } catch (e) { try { res.end('{}') } catch (e2) { /* socket ferme */ } }
}

const readBody = (req) => new Promise((resolve) => {
  let raw = ''
  try {
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 2_000_000) raw = raw.slice(0, 2_000_000) })
    req.on('end', () => { try { resolve(raw.length === 0 ? {} : JSON.parse(raw)) } catch (e) { resolve(null) } })
    req.on('error', () => resolve(null))
  } catch (e) { resolve(null) }
})

// A route that WRITES or ACTS (stores a key or a provider profile, saves a note, starts a download, spends a call on a pasted key) needs DSH's
// signed browser session as well as the right Origin (session-guard.mjs, kybernos-terminal's rule): plugin routes are served before DSH's own
// login and an Origin header is forgeable by any local program, so before this a `curl -X POST` with a made-up Origin rewrote the person's
// notes or parked their provider. Every caller is a page of this DSH (the Models page and the first-run wizard of kybernos-plugin), which
// carries the cookie by itself; nothing else calls these routes (scripts/audit-routes.mjs). The reads stay open behind the Host fence.
// Answers the refusal and returns true when the request must stop there.
const kbRefused = (req, res) => {
  const refused = writeGuard(req)
  if (refused === null) return false
  sendJson(res, refused.status, { ok: false, error: refused.error })
  return true
}

// ── Annotations: one file, merged by `route/id` key ─────────────────
const kbMaRead = () => {
  if (annotationsCache !== null) return annotationsCache
  const raw = readJson(ANNOTATIONS_FILE, {})
  const models = (raw !== null && typeof raw.models === 'object' && raw.models !== null) ? raw.models : {}
  const clean = {}
  for (const key of Object.keys(models)) {
    const entry = models[key]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const fields = {}
    for (const k of Object.keys(entry)) {
      if (ANNOTATION_FIELDS.indexOf(k) < 0) continue
      const v = entry[k]
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') fields[k] = v
      else if (v === null) fields[k] = null
    }
    clean[key] = fields
  }
  annotationsCache = { version: MODEL_CATALOG_VERSION, models: clean }
  return annotationsCache
}

const kbMaWrite = (key, fields) => {
  const current = kbMaRead()
  const models = Object.assign({}, current.models)
  if (fields === null) delete models[key]
  else {
    const merged = Object.assign({}, models[key], fields)
    for (const k of Object.keys(merged)) {
      if (merged[k] === null || merged[k] === undefined || merged[k] === '') delete merged[k]
    }
    if (Object.keys(merged).length === 0) delete models[key]
    else models[key] = merged
  }
  const next = { version: MODEL_CATALOG_VERSION, models }
  writeJsonAtomic(ANNOTATIONS_FILE, next)
  annotationsCache = next
  return next
}

// ── Journal: one JSON line per write attempt (local proof) ───────
const kbJournalAppend = (entry) => {
  const line = Object.assign({ at: new Date().toISOString() }, entry)
  let text = ''
  try { text = readFileSync(JOURNAL_FILE, 'utf8') } catch (e) { text = '' }
  const rows = text.split('\n').filter((l) => l.trim().length > 0)
  rows.push(JSON.stringify(line))
    // The last 200 lines are kept: a journal, not an archive.
  const kept = rows.slice(Math.max(0, rows.length - 200))
  // The store folder does not exist on a fresh install (writeJsonAtomic makes it for the other files; this one writes directly).
  mkdirSync(dirname(JOURNAL_FILE), { recursive: true })
  writeFileSync(JOURNAL_FILE, kept.join('\n') + '\n')
  return line
}

const kbJournalRead = () => {
  let text = ''
  try { text = readFileSync(JOURNAL_FILE, 'utf8') } catch (e) { return [] }
  const out = []
  for (const raw of text.split('\n')) {
    if (raw.trim().length === 0) continue
    try { out.push(JSON.parse(raw)) } catch (e) { /* ligne tronquee : ignoree */ }
  }
  return out
}

// ── Parked providers: "disabled" without deleting ───────────────────────────
// The engine has no per-provider off switch (measured on DSH 0.2.0-rc.2: no
// `enabled`/`disabled` in dsh-llm or dsh-llm-pi-ai). What it does have: a route
// exists only while its profile sits in `llm-pi-ai.providers`, and profiles are
// re-read on every request. So "disable" = move the profile out of the settings
// into this file, "enable" = put it back. While parked the provider is not
// routable and its models are gone from every picker: a hard block, no engine
// patch. The profile holds an env-var NAME (`apiKeyEnv`), never a key; it may
// hold `headers`, so the file is 0600 and only the same-origin page reads it.
export const PARKED_VERSION = 1
const PARKED_FILE = join(STORE_DIR, 'providers-parked.json')
const PARKED_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const PARKED_MAX_PROFILE_CHARS = 200000
const PARKED_MAX_MODELS = 5000

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Read the store; anything unreadable or malformed reads as "nothing parked". */
export const kbPkRead = (file = PARKED_FILE) => {
  const raw = readJson(file, {})
  const src = isPlainObject(raw) && isPlainObject(raw.providers) ? raw.providers : {}
  const providers = {}
  for (const slug of Object.keys(src)) {
    const e = src[slug]
    if (PARKED_SLUG.test(slug) !== true || !isPlainObject(e) || !isPlainObject(e.profile)) continue
    providers[slug] = {
      parkedAt: typeof e.parkedAt === 'string' ? e.parkedAt : null,
      models: Array.isArray(e.models) ? e.models.filter((x) => typeof x === 'string').slice(0, PARKED_MAX_MODELS) : [],
      profile: e.profile,
    }
  }
  return { version: PARKED_VERSION, providers }
}

const kbPkWrite = (file, providers) => {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + String(process.pid)
  writeFileSync(tmp, JSON.stringify({ version: PARKED_VERSION, providers }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
}

/** What the page may list without ever receiving a profile (headers can carry tokens). */
export const kbPkPublic = (store) => Object.keys(store.providers).map((slug) => {
  const e = store.providers[slug]
  return {
    slug,
    parkedAt: e.parkedAt,
    displayName: typeof e.profile.displayName === 'string' ? e.profile.displayName : null,
    models: e.models,
  }
})

/** Park a profile. Refuses a slug already parked: never overwrite a saved profile. */
export const kbPkPark = (slug, profile, models, file = PARKED_FILE) => {
  if (typeof slug !== 'string' || PARKED_SLUG.test(slug) !== true) return { ok: false, error: 'bad-slug' }
  if (!isPlainObject(profile)) return { ok: false, error: 'bad-profile' }
  let size = 0
  try { size = JSON.stringify(profile).length } catch (e) { return { ok: false, error: 'bad-profile' } }
  if (size > PARKED_MAX_PROFILE_CHARS) return { ok: false, error: 'profile-too-large' }
  const store = kbPkRead(file)
  if (store.providers[slug] !== undefined) return { ok: false, error: 'already-parked' }
  const ids = Array.isArray(models) ? models.filter((x) => typeof x === 'string' && x.length > 0 && x.length <= 300).slice(0, PARKED_MAX_MODELS) : []
  store.providers[slug] = { parkedAt: new Date().toISOString(), models: ids, profile }
  try { kbPkWrite(file, store.providers) } catch (e) { return { ok: false, error: 'write-failed', detail: String(e && e.message ? e.message : e) } }
  return { ok: true, slug }
}

/** The saved profile, left in place: the caller deletes it only after the settings write succeeded. */
export const kbPkTake = (slug, file = PARKED_FILE) => {
  if (typeof slug !== 'string' || PARKED_SLUG.test(slug) !== true) return { ok: false, error: 'bad-slug' }
  const e = kbPkRead(file).providers[slug]
  return e === undefined ? { ok: false, error: 'not-parked' } : { ok: true, slug, profile: e.profile, models: e.models }
}

export const kbPkForget = (slug, file = PARKED_FILE) => {
  if (typeof slug !== 'string' || PARKED_SLUG.test(slug) !== true) return { ok: false, error: 'bad-slug' }
  const store = kbPkRead(file)
  if (store.providers[slug] === undefined) return { ok: true, slug, removed: false }
  delete store.providers[slug]
  try { kbPkWrite(file, store.providers) } catch (e) { return { ok: false, error: 'write-failed', detail: String(e && e.message ? e.message : e) } }
  return { ok: true, slug, removed: true }
}

/** Mount the first-run wizard's key check on a webServer-like `{ register }`: a POST of the signed-in page only (it spends a call to the
 *  provider with a pasted key), answers one word (`ok`, `invalid`, `denied`, `rate_limited`, `unreachable`, `unexpected`), never the key
 *  or the provider's answer. */
export const kbKeyMount = (register, options = {}) => {
  register({ kind: 'exact', path: '/kybernos-models/key/check', handler: async (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
    if (kbRefused(req, res)) return
    const body = await readBody(req)
    if (!isPlainObject(body)) { sendJson(res, 400, { ok: false, error: 'bad-json' }); return }
    const out = await checkKey(body.provider, body.key, options)
    if (out.ok !== true) { sendJson(res, 400, { ok: false, error: out.error }); return }
    sendJson(res, 200, { ok: true, result: out.result })
  } })
}

// The shipped provider catalogue (models.dev: id, name, env, url), read once: the address and key reference of a provider whose profile
// names neither (a catalog route such as `opencode-go` is saved with a key reference and models only).
let providerCatalogCache = null
const kbCatalogEntry = (route) => {
  try {
    if (providerCatalogCache === null) providerCatalogCache = JSON.parse(readFileSync(join(pluginDir, 'provider-catalog.json'), 'utf8'))
    const list = isPlainObject(providerCatalogCache) && Array.isArray(providerCatalogCache.providers) ? providerCatalogCache.providers : []
    return list.find((p) => isPlainObject(p) && p.id === route) || null
  } catch (e) { return null }
}

/** Mount the live model list (and the protocol probe of a model outside the catalog) on a webServer-like `{ register }`: « Fetch available models » asks the provider's own endpoint, from here, with the
 *  key its profile names (live-models.mjs). A POST of the signed-in page only (it spends a call to the provider). Answers the list, or one word
 *  that says why there is none (the page then falls back to the engine's answer and says so); never the key or the provider's raw body.
 *  `services()` gives the host's `{ settings, credentials }`, read at the time of the request: either may be missing. */
export const kbLiveMount = (register, services = () => ({}), options = {}) => {
  register({ kind: 'exact', path: '/kybernos-models/models/live', handler: async (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
    if (kbRefused(req, res)) return
    const body = await readBody(req)
    if (!isPlainObject(body)) { sendJson(res, 400, { ok: false, error: 'bad-json' }); return }
    let svc = {}
    try { svc = services() || {} } catch (e) { svc = {} }
    const out = await liveModels(body, { settings: svc.settings, credentials: svc.credentials, entry: kbCatalogEntry(typeof body.route === 'string' ? body.route : ''), ...options })
    if (out.ok !== true) { sendJson(res, ['bad-route', 'bad-key', 'bad-endpoint'].indexOf(out.error) >= 0 ? 400 : 200, out); return }
    sendJson(res, 200, { ok: true, source: 'live', url: out.url, models: out.models })
  } })
  register({ kind: 'exact', path: '/kybernos-models/models/probe', handler: async (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
    if (kbRefused(req, res)) return
    const body = await readBody(req)
    if (!isPlainObject(body)) { sendJson(res, 400, { ok: false, error: 'bad-json' }); return }
    let svc = {}
    try { svc = services() || {} } catch (e) { svc = {} }
    const out = await probeModel(body, { settings: svc.settings, credentials: svc.credentials, entry: kbCatalogEntry(typeof body.route === 'string' ? body.route : ''), ...options })
    sendJson(res, ['bad-route', 'bad-model', 'bad-key', 'bad-endpoint'].indexOf(out.error) >= 0 ? 400 : 200, out)
  } })
}

/** Mount the four parked-provider routes on a webServer-like `{ register }`. */
export const kbPkMount = (register, file = PARKED_FILE) => {
  const guard = (req, res, method) => {
    if (req.method !== method) { sendJson(res, 405, { ok: false, error: 'method' }); return false }
    return kbRefused(req, res) !== true
  }
  const post = async (req, res) => {
    if (guard(req, res, 'POST') !== true) return null
    const body = await readBody(req)
    if (!isPlainObject(body)) { sendJson(res, 400, { ok: false, error: 'bad-json' }); return null }
    return body
  }
  register({ kind: 'exact', path: '/kybernos-models/providers/parked', handler: async (req, res) => {
    if (req.method !== 'GET') { sendJson(res, 405, { ok: false, error: 'method' }); return }
    // Listing carries no profile; a foreign Origin is still refused (DNS rebinding), no Origin passes (a page sends none on a same-origin GET).
    if (origineOK(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin refused' }); return }
    sendJson(res, 200, { ok: true, version: PARKED_VERSION, parked: kbPkPublic(kbPkRead(file)) })
  } })
  register({ kind: 'exact', path: '/kybernos-models/providers/park', handler: async (req, res) => {
    const b = await post(req, res)
    if (b === null) return
    const r = kbPkPark(b.slug, b.profile, b.models, file)
    sendJson(res, r.ok === true ? 200 : (r.error === 'already-parked' ? 409 : 400), r)
  } })
  register({ kind: 'exact', path: '/kybernos-models/providers/take', handler: async (req, res) => {
    const b = await post(req, res)
    if (b === null) return
    const r = kbPkTake(b.slug, file)
    sendJson(res, r.ok === true ? 200 : (r.error === 'not-parked' ? 404 : 400), r)
  } })
  register({ kind: 'exact', path: '/kybernos-models/providers/forget', handler: async (req, res) => {
    const b = await post(req, res)
    if (b === null) return
    const r = kbPkForget(b.slug, file)
    sendJson(res, r.ok === true ? 200 : (r.error === 'write-failed' ? 500 : 400), r)
  } })
}

// ── models.dev index: one fetch for everyone, 6 h disk cache ──────────────────
/** The disk cache lives in the form `{ at, data }`; files written by
  *  an earlier version carried the index at the root. Both are read. */
const kbMdUnwrap = (disk) => {
  if (disk === null || typeof disk !== 'object') return null
  const payload = disk.data !== null && typeof disk.data === 'object' ? disk.data : (disk.byKey !== undefined ? disk : null)
  if (payload === null) return null
    // The envelope's timestamp is authoritative: it carries the age of the cache.
  if (typeof payload.at !== 'number' && typeof disk.at === 'number') return Object.assign({}, payload, { at: disk.at })
  return payload
}
/** Direct read, outside the engine's web service: the latter truncates the body to 100 000 characters while the index weighs ~4.7 MB
  *  (JSON.parse failed at 100000) and, above all, it can kill the whole process when a connection fails at once
  *  (no route, firewall: its dispatcher is closed while a second attempt is still armed). The global `fetch` rejects
  *  normally. The body is read in chunks and cut at `cap` bytes: a third party that answers endlessly does not fill the memory. */
const kbMdFetchDirect = async (url, cap = 12000000, extra = null) => {
  try {
    const control = new AbortController()
    const timer = setTimeout(() => { try { control.abort() } catch (e) { /* deja termine */ } }, 30000)
    try {
      const headers = Object.assign({ accept: 'application/json' }, extra === null ? {} : extra)
      const res = await fetch(url, { signal: control.signal, headers })
      if (res === null || res === undefined) return null
      if (res.ok === false) return null
      if (res.body !== null && res.body !== undefined && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader()
        const chunks = []
        let total = 0
        for (;;) {
          const part = await reader.read()
          if (part.done === true) break
          total += part.value.byteLength
          if (total > cap) { await reader.cancel().catch(() => {}); return null }
          chunks.push(part.value)
        }
        const text = Buffer.concat(chunks).toString('utf8')
        return text.length > 0 ? text : null
      }
      if (typeof res.text !== 'function') return null
      const text = await res.text()
      return typeof text === 'string' && text.length > 0 && text.length <= cap ? text : null
    } finally { clearTimeout(timer) }
  } catch (e) { return null }
}
const kbMdLoad = async (web, force) => {
  if (force !== true && modelsDevCache !== null && (Date.now() - modelsDevCache.at) < MODELSDEV_TTL_MS) return modelsDevCache
  if (force !== true) {
        // Without this read, the 6 h window was useless and every session
        // downloaded the whole index again.
    const disk = readJson(MODELSDEV_CACHE, null)
    const payload = kbMdUnwrap(disk)
    if (payload !== null && typeof disk.at === 'number' && (Date.now() - disk.at) < MODELSDEV_TTL_MS) {
      modelsDevCache = payload
      return payload
    }
  }
  if (modelsDevInflight !== null) return modelsDevInflight
    // `web` (the engine's service) is no longer called: see kbMdFetchDirect. The parameter stays for the callers.
  modelsDevInflight = (async () => {
    try {
            // No network: the read fails, the cache is served, even an old one — the route will say « stale » rather than let
            // anyone believe in a fresh index.
      const raw = await kbMdFetchDirect('https://models.dev/api.json')
      if (raw === null) throw new Error('empty answer')
      const data = JSON.parse(raw)
      // Indexed by « provider/model » AND by bare id: the mock-up looks up by id,
      // the pi-ai routes often name « provider/model ».
      const byKey = {}
      const byId = {}
      for (const provider of Object.keys(data)) {
        const models = (data[provider] !== null && typeof data[provider] === 'object' && data[provider].models !== null && typeof data[provider].models === 'object') ? data[provider].models : {}
        for (const id of Object.keys(models)) {
          const entry = models[id]
          if (entry === null || typeof entry !== 'object') continue
          const norm = kbMdNormalize(provider, id, entry)
          byKey[provider + '/' + id] = norm
          if (byId[id] === undefined) byId[id] = []
          byId[id].push(norm)
        }
      }
      const payload = { version: MODEL_CATALOG_VERSION, at: Date.now(), providers: Object.keys(data).length, byKey, byId }
      writeJsonAtomic(MODELSDEV_CACHE, { at: payload.at, data: payload })
      modelsDevCache = payload
      return payload
    } catch (e) {
      const payload = kbMdUnwrap(readJson(MODELSDEV_CACHE, null))
      modelsDevCache = payload
      return payload
    } finally { modelsDevInflight = null }
  })()
  return modelsDevInflight
}

/** A models.dev entry → the mock-up's keys (no invention: only the
  *  keys present in the answer are set). */
export const kbMdNormalize = (provider, id, entry) => {
  const modalities = (entry.modalities !== null && typeof entry.modalities === 'object') ? entry.modalities : {}
  const input = Array.isArray(modalities.input) ? modalities.input : []
  const output = Array.isArray(modalities.output) ? modalities.output : []
  const limit = (entry.limit !== null && typeof entry.limit === 'object') ? entry.limit : {}
  const cost = (entry.cost !== null && typeof entry.cost === 'object') ? entry.cost : {}
  const out = {
    provider, id,
    name: typeof entry.name === 'string' ? entry.name : id,
    textIn: input.indexOf('text') >= 0,
    vision: input.indexOf('image') >= 0,
    video: input.indexOf('video') >= 0,
    audioIn: input.indexOf('audio') >= 0,
    textOut: output.indexOf('text') >= 0,
    tts: output.indexOf('audio') >= 0,
    imageGen: output.indexOf('image') >= 0,
    videoGen: output.indexOf('video') >= 0,
    tools: entry.tool_call === true,
    structured: entry.structured_output === true,
    temperature: entry.temperature === true,
    reasoning: entry.reasoning === true,
    type: typeof entry.type === 'string' ? entry.type : '',
    context: limit.context === undefined ? '' : String(limit.context),
    outputLimit: limit.output === undefined ? '' : String(limit.output),
    costIn: cost.input === undefined ? '' : String(cost.input),
    costOut: cost.output === undefined ? '' : String(cost.output),
    cacheRead: cost.cache_read === undefined ? '' : String(cost.cache_read),
    cacheWrite: cost.cache_write === undefined ? '' : String(cost.cache_write),
    family: typeof entry.family === 'string' ? entry.family : '',
    knowledge: typeof entry.knowledge === 'string' ? entry.knowledge : '',
    release: typeof entry.release_date === 'string' ? entry.release_date : '',
    weights: entry.open_weights === true ? 'Open' : (entry.open_weights === false ? 'Closed' : ''),
  }
  const efforts = Array.isArray(entry.reasoning_options) ? entry.reasoning_options : []
  for (const option of efforts) {
    if (option !== null && typeof option === 'object' && option.type === 'effort' && Array.isArray(option.values)) {
      out.reasoningLevels = option.values.filter((v) => typeof v === 'string')
      break
    }
  }
  return out
}

const findModelsDev = (index, route, id) => {
  if (index === null || index === undefined) return null
  const byKey = index.byKey || {}
  const byId = index.byId || {}
  if (byKey[route + '/' + id] !== undefined) return byKey[route + '/' + id]
  if (byKey[id] !== undefined) return byKey[id]
  const list = byId[id]
  if (Array.isArray(list) && list.length > 0) return list[0]
  return null
}

// ── External scores: Artificial Analysis + BenchLM, by reading pages ─────
// Both sources publish the equivalent of a catalogue in ONE page each:
//
//   · Artificial Analysis — the ranking embeds, for its ~660 models, the
//     intelligence score AND the evaluation scores that make it up (SciCode,
//     Terminal-Bench, HLE, GPQA, MMMU-Pro…), plus prices and speed. No
//     key is needed: the key only opens the API, and the free API gives
//     no more than this page.
//   · BenchLM — `/data/models.json` is a published set that carries its own
//     category indices (coding, agentic, knowledge…). CC BY-NC 4.0 licence:
//     attribution is due, and commercial use needs an agreement.
//
// These are two DISTINCT provenances: they are never merged into one score, and
// the gap between them is information — on MiMo-V2.5-Pro, AA counts 21.3
// of agentic where BenchLM counts 58.9. Merging these two numbers would manufacture
// a conclusion that neither source supports.

/** Normalisation to match a harness model to a source slug. */
export const kbScoreNorm = (v) => String(v === null || v === undefined ? '' : v)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** The name without its qualifiers: « X (Reasoning, Max Effort) » → « x ». */
const kbScoreBase = (v) => kbScoreNorm(String(v === null || v === undefined ? '' : v).replace(/\([^)]*\)/g, ' '))

/** The RSC chunks of a Next.js App Router page, glued back together. Quotation marks
  *  are escaped in them (`\"slug\"`): looking for the key in clear finds nothing
  *  while the data is two metres away — the trap that wrongly makes one believe
  *  the page does not carry the scores. */
const kbScoreRsc = (html) => {
  const parts = []
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  let m
  while ((m = re.exec(html)) !== null) {
    try { parts.push(JSON.parse(m[1])) } catch (e) { /* morceau illisible */ }
  }
  return parts.join('')
}

/** The objects of a payload that carry `"<anchor>": "…"` AND `"<num>": number`.
  *  The enclosing object is delimited by balancing braces. */
const kbScoreObjects = (blob, ancre, num) => {
  const out = []
  const re = new RegExp('"' + ancre + '":"([A-Za-z0-9][A-Za-z0-9.\\-_]{0,80})"', 'g')
  let m
  while ((m = re.exec(blob)) !== null) {
    const deb = blob.lastIndexOf('{', m.index)
    if (deb < 0) continue
    let prof = 0
    let fin = -1
    const plafond = Math.min(blob.length, deb + 8000)
    for (let i = deb; i < plafond; i += 1) {
      const c = blob[i]
      if (c === '{') prof += 1
      else if (c === '}') { prof -= 1; if (prof === 0) { fin = i; break } }
    }
    if (fin < 0) continue
    const txt = blob.slice(deb, fin + 1)
    if (txt.indexOf('"' + num + '":') < 0) continue
    try {
      const o = JSON.parse(txt)
      if (typeof o[ancre] === 'string' && typeof o[num] === 'number') out.push(o)
    } catch (e) { /* truncated object: ignored */ }
  }
  return out
}

/** What is kept of a model of the AA ranking: the score, its ingredients, the
  *  price, the speed. A key absent from the source stays absent here. */
const AA_KEEP = [
  'slug', 'name', 'shortName', 'deprecated', 'isReasoning', 'isOpenWeights', 'paramClass', 'priceClass',
  'modelCreatorName', 'modelCreatorColor', 'contextWindowTokens',
  'intelligenceIndex', 'intelligenceIndexIsEstimated', 'intelligenceIndexCostPerTask',
  'scicode', 'terminalBench40', 'terminalBench21', 'terminalbenchHard', 'hle', 'gpqa', 'critpt', 'lcr',
  'tau2', 'tauBanking', 'mmmuPro', 'ifbench', 'gdpvalNormalized', 'analystAgent', 'apexAgents', 'itbenchSre',
  'omniscience', 'omniscienceAccuracy', 'omniscienceNonHallucination',
  'price1mInputTokens', 'price1mOutputTokens', 'cacheHitPrice', 'cacheWritePrice',
  'medianOutputTokensPerSecond', 'medianTimeToFirstTokenSeconds', 'medianTimeToFirstAnswerTokenSeconds',
  'medianEndToEndResponseTimeSeconds', 'medianReasoningTimeSeconds',
]
/** AA's evaluations — the ones for which a readable label is looked for. */
const AA_EVAL_KEYS = [
  'scicode', 'terminalBench40', 'terminalBench21', 'terminalbenchHard', 'hle', 'gpqa', 'critpt', 'lcr',
  'tau2', 'tauBanking', 'mmmuPro', 'ifbench', 'gdpvalNormalized', 'analystAgent', 'apexAgents', 'itbenchSre', 'omniscience',
]
/** AA's labels: BenchLM's catalogue does not cover its keys (it writes
  *  `terminalBench4` where AA writes `terminalBench40`), so they are named here. */
const AA_EVAL_LABELS = {
  scicode: 'SciCode', terminalBench40: 'Terminal-Bench 4.0', terminalBench21: 'Terminal-Bench 2.1',
  terminalbenchHard: 'Terminal-Bench Hard', hle: 'Humanity\u2019s Last Exam', gpqa: 'GPQA Diamond',
  critpt: 'CritPt', lcr: 'AA-LCR', tau2: '\u03c4\u00b2-bench', tauBanking: '\u03c4\u00b2-bench Banking',
  mmmuPro: 'MMMU-Pro', ifbench: 'IFBench', gdpvalNormalized: 'GDPval (normalized)',
  analystAgent: 'Analyst Agent', apexAgents: 'APEX-Agents', itbenchSre: 'ITBench SRE', omniscience: 'Omniscience',
}
/** An identifier with no known label, made readable rather than left raw. */
const kbScorePretty = (k) => String(k)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/([a-zA-Z])(\d)/g, '$1 $2')
  .replace(/^./, (c) => c.toUpperCase())
const kbScoreFromAa = (o) => {
  const out = {}
  for (const k of AA_KEEP) if (o[k] !== undefined) out[k] = o[k]
  return out
}

/** What is kept of a BenchLM model: its category indices (coding and
  *  agentic among them), its position, its coverage, and the per-benchmark values that
  *  feed them. The published set does NOT carry the sources line by line — these
  *  live on the HTML page, and that is written in the panel's note rather than
  *  implied here. */
const kbScoreFromBenchlm = (it) => {
  const scores = (it.scores !== null && typeof it.scores === 'object') ? it.scores : {}
  const ranking = (it.ranking !== null && typeof it.ranking === 'object') ? it.ranking : {}
  const bm = (it.benchmarks !== null && typeof it.benchmarks === 'object') ? it.benchmarks : {}
  const benchmarks = {}
  for (const cat of Object.keys(bm)) {
    const liste = bm[cat]
    if (liste === null || typeof liste !== 'object' || Array.isArray(liste)) continue
    const vals = {}
    for (const k of Object.keys(liste)) if (typeof liste[k] === 'number') vals[k] = liste[k]
    if (Object.keys(vals).length > 0) benchmarks[cat] = vals
  }
  return {
    slug: it.slug, name: it.model === undefined ? null : it.model,
    creator: it.creator === undefined ? null : it.creator,
    releaseDate: it.releaseDate === undefined ? null : it.releaseDate,
    contextWindow: it.contextWindow === undefined ? null : it.contextWindow,
    displayScore: it.displayScore === undefined ? null : it.displayScore,
    provisionalDisplayScore: it.provisionalDisplayScore === undefined ? null : it.provisionalDisplayScore,
    verifiedDisplayScore: scores.verifiedDisplayScore === undefined ? null : scores.verifiedDisplayScore,
    categories: scores.displayCategoryScores === undefined ? null : scores.displayCategoryScores,
    verifiedCategories: scores.verifiedDisplayCategoryScores === undefined ? null : scores.verifiedDisplayCategoryScores,
    rankingEligible: it.rankingEligible === true,
    overallRank: it.overallRank === undefined ? null : it.overallRank,
    rankingMode: it.publicRankingMode === undefined ? null : it.publicRankingMode,
    categoryRankingEligible: ranking.categoryRankingEligible === undefined ? null : ranking.categoryRankingEligible,
    coverage: it.coverage === undefined ? null : it.coverage,
    url: it.url === undefined ? null : it.url,
    benchmarks,
  }
}

const kbScoreUa = { 'user-agent': 'Mozilla/5.0 (Kybernos model panel; releve ponctuel)', accept: 'text/html,application/json' }

const kbScoreLoadAa = async () => {
  const html = await kbMdFetchDirect(AA_LB_URL, 12000000, kbScoreUa)
  if (html === null) return null
  const objs = kbScoreObjects(kbScoreRsc(html), 'slug', 'intelligenceIndex')
  const bySlug = {}
  for (const o of objs) {
        // The same slug appears in several objects: the richest wins.
    const precedent = bySlug[o.slug]
    if (precedent === undefined || Object.keys(o).length > Object.keys(precedent).length) bySlug[o.slug] = kbScoreFromAa(o)
  }
  return Object.keys(bySlug).length === 0 ? null : bySlug
}

const kbScoreLoadBenchlm = async () => {
  const raw = await kbMdFetchDirect(BENCHLM_URL, 12000000, kbScoreUa)
  if (raw === null) return null
  let data = null
  try { data = JSON.parse(raw) } catch (e) { return null }
  const items = (data !== null && Array.isArray(data.items)) ? data.items : []
  const bySlug = {}
  for (const it of items) if (it !== null && typeof it === 'object' && typeof it.slug === 'string') bySlug[it.slug] = kbScoreFromBenchlm(it)
  return Object.keys(bySlug).length === 0 ? null : bySlug
}

/** The catalogue of evaluations: it gives a readable name to each key used by
  *  the models (`terminalBench21` → « Terminal-Bench 2.1 »), without which the sheet
  *  would show internal identifiers in place of a label. */
const kbScoreLoadBenchlmCatalog = async () => {
  const raw = await kbMdFetchDirect(BENCHLM_CATALOG_URL, 12000000, kbScoreUa)
  if (raw === null) return null
  let data = null
  try { data = JSON.parse(raw) } catch (e) { return null }
  const items = (data !== null && (Array.isArray(data.items) ? data.items : (Array.isArray(data.benchmarks) ? data.benchmarks : null)))
  if (items === null) return null
  const byKey = {}
  for (const it of items) {
    if (it === null || typeof it !== 'object') continue
    const cle = typeof it.benchmarkKey === 'string' ? it.benchmarkKey : (typeof it.key === 'string' ? it.key : null)
    if (cle === null) continue
    byKey[cle] = {
      name: it.name === undefined ? null : it.name,
      category: it.categoryLabel === undefined ? (it.category === undefined ? null : it.category) : it.categoryLabel,
      paperUrl: it.paperUrl === undefined ? null : it.paperUrl,
      year: it.year === undefined ? null : it.year,
      weight: it.weight === undefined ? null : it.weight,
    }
  }
  return Object.keys(byKey).length === 0 ? null : byKey
}

/** Refreshes both sources, in the background. An unreachable source must
  *  NEVER erase the one already held: the old one is kept and the status says
  *  so, rather than leaving the screen empty on a network cut. */
const kbScoresRefresh = async () => {
  if (scoresInflight !== null) return scoresInflight
  scoresJob = { running: true, startedAt: Date.now(), finishedAt: null, error: null, sources: {} }
  scoresInflight = (async () => {
    const precedent = readJson(SCORES_FILE, null)
    let aa = null
    let benchlm = null
    let catalogue = null
    try { aa = await kbScoreLoadAa() } catch (e) { aa = null }
    try { benchlm = await kbScoreLoadBenchlm() } catch (e) { benchlm = null }
    try { catalogue = await kbScoreLoadBenchlmCatalog() } catch (e) { catalogue = null }
    const precAa = (precedent !== null && precedent.aa !== null && typeof precedent.aa === 'object') ? precedent.aa : {}
    const precBl = (precedent !== null && precedent.benchlm !== null && typeof precedent.benchlm === 'object') ? precedent.benchlm : {}
    const precCat = (precedent !== null && precedent.catalogue !== null && typeof precedent.catalogue === 'object') ? precedent.catalogue : {}
    const precSrc = (precedent !== null && precedent.sources !== null && typeof precedent.sources === 'object') ? precedent.sources : {}
    scoresJob.sources.aa = aa === null ? 0 : Object.keys(aa).length
    scoresJob.sources.benchlm = benchlm === null ? 0 : Object.keys(benchlm).length
    scoresJob.sources.catalogue = catalogue === null ? 0 : Object.keys(catalogue).length
    if (aa === null) scoresJob.sources.aaError = 'artificialanalysis-injoignable'
    if (benchlm === null) scoresJob.sources.benchlmError = 'benchlm-injoignable'
    const next = {
      version: SCORES_VERSION,
      at: Date.now(),
      sources: {
        aa: aa === null ? (precSrc.aa === undefined ? null : precSrc.aa) : { at: Date.now(), count: Object.keys(aa).length, url: AA_LB_URL, source: 'Artificial Analysis' },
        benchlm: benchlm === null ? (precSrc.benchlm === undefined ? null : precSrc.benchlm) : { at: Date.now(), count: Object.keys(benchlm).length, url: BENCHLM_URL, source: 'BenchLM', licence: 'CC BY-NC 4.0' },
      },
      aa: aa === null ? precAa : aa,
      benchlm: benchlm === null ? precBl : benchlm,
      catalogue: catalogue === null ? precCat : catalogue,
    }
    writeJsonAtomic(SCORES_FILE, next)
    scoresCache = next
    scoresJob.running = false
    scoresJob.finishedAt = Date.now()
    if (aa === null && benchlm === null) scoresJob.error = 'aucune-source-injoignable'
    return next
  })()
  try { return await scoresInflight } finally { scoresInflight = null }
}

/** The snapshot on disk, re-read if the memory cache is cold. */
const kbScoresRead = (force) => {
  if (force !== true && scoresCache !== null && typeof scoresCache.at === 'number' && (Date.now() - scoresCache.at) < SCORES_TTL_MS) return scoresCache
  const disk = readJson(SCORES_FILE, null)
  if (disk !== null && typeof disk === 'object' && typeof disk.at === 'number') {
    scoresCache = disk
    if (force !== true && (Date.now() - disk.at) < SCORES_TTL_MS) return disk
  }
  return scoresCache
}

/** An identifier with a variant (`glm-5.2:free`, `minimax-m3:nitro`) names the same
  *  model served otherwise: the catalogues only know the base name, and
  *  without this stripping two models in five did not match. */
const kbScoreSansVariante = (v) => String(v === null || v === undefined ? '' : v).replace(/:[a-zA-Z0-9._-]+$/, '')

/** The matching rules, from the surest to the weakest.
  *
  *  AA's « short name » is a display ABBREVIATION, not a name: it loses
  *  the word that distinguishes (« Llama 3.1 8B Instruct » is written « Llama 3.1 8B » there).
  *  It is therefore used ONLY on identifiers, never on a displayed name —
  *  otherwise « Llama 3.1 8B Instant » received the scores of the « Instruct » model,
  *  that is a wrong value presented as a fact. And each rule must
  *  designate a single model: a hesitation that stays silent would be worse than an
  *  absence, which is visible. */
const kbMatchIn = (catalogue, nameKey, cibles, bases, ciblesId) => {
  const etapes = [
    ['slug', (slug) => cibles.indexOf(kbScoreNorm(slug)) >= 0],
    ['nom', (slug, e) => cibles.indexOf(kbScoreNorm(e[nameKey])) >= 0],
    ['nom-sans-qualificatif', (slug, e) => bases.indexOf(kbScoreBase(e[nameKey])) >= 0],
    ['id-court', (slug, e) => typeof e.shortName === 'string' && e.shortName.length > 0 && ciblesId.indexOf(kbScoreNorm(e.shortName)) >= 0],
  ]
  for (const etape of etapes) {
    const trouve = []
    for (const slug of Object.keys(catalogue)) {
      const e = catalogue[slug]
      if (e === null || typeof e !== 'object') continue
      if (etape[1](slug, e) === true) trouve.push(slug)
    }
    if (trouve.length === 1) return { slug: trouve[0], method: etape[0], entry: catalogue[trouve[0]] }
    if (trouve.length > 1) return null
  }
  return null
}

/** The same words in another order designate the same model: AA writes
  *  « Claude 4.5 Sonnet », the harness « Claude Sonnet 4.5 ». Two possible
  *  candidates ⇒ nothing is chosen: a hesitation that stays silent would be worse than an
  *  absence, which is visible. */
const kbScoreJetons = (v) => kbScoreBase(v).split('-').filter((x) => x.length > 0).sort().join('-')
const kbMatchEnDesordre = (catalogue, nameKey, bases) => {
  const jetons = bases.map(kbScoreJetons).filter((x) => x.length > 0)
  if (jetons.length === 0) return null
  const trouve = []
  for (const slug of Object.keys(catalogue)) {
    const e = catalogue[slug]
    if (e === null || e === undefined) continue
    if (jetons.indexOf(kbScoreJetons(e[nameKey])) >= 0) trouve.push(slug)
  }
  return trouve.length === 1 ? { slug: trouve[0], method: 'nom-en-desordre', entry: catalogue[trouve[0]] } : null
}

/** Matches a harness model with the two catalogues. The matching method
  *  is returned with the data: an approximate match that stays
  *  silent is exactly what must not be built. */
export const kbScoreMatch = (snapshot, route, id, name) => {
  const aa = (snapshot !== null && snapshot !== undefined && snapshot.aa !== null && typeof snapshot.aa === 'object') ? snapshot.aa : {}
  const bl = (snapshot !== null && snapshot !== undefined && snapshot.benchlm !== null && typeof snapshot.benchlm === 'object') ? snapshot.benchlm : {}
  const seg = String(id === undefined || id === null ? '' : id).split('/').filter((s) => s.length > 0)
  const dernier = seg.length > 0 ? seg[seg.length - 1] : String(id === undefined || id === null ? '' : id)
  const brut = [dernier, id]
  const brutId = [dernier, id]
  if (typeof name === 'string' && name.length > 0) brut.push(name)
  const cibles = []
  const bases = []
  const ciblesId = []
  for (const v of brut) {
    cibles.push(kbScoreNorm(v))
    bases.push(kbScoreBase(v))
    const sv = kbScoreSansVariante(v)
    if (sv !== v) { cibles.push(kbScoreNorm(sv)); bases.push(kbScoreBase(sv)) }
  }
  for (const v of brutId) {
    ciblesId.push(kbScoreNorm(v))
    const sv = kbScoreSansVariante(v)
    if (sv !== v) ciblesId.push(kbScoreNorm(sv))
  }
  return {
    aa: Object.keys(aa).length === 0 ? null : (kbMatchIn(aa, 'name', cibles, bases, ciblesId) || kbMatchEnDesordre(aa, 'name', bases)),
    benchlm: Object.keys(bl).length === 0 ? null : (kbMatchIn(bl, 'model', cibles, bases, ciblesId) || kbMatchEnDesordre(bl, 'model', bases)),
  }
}

/** The one number the Models tab shows, filters and sorts on: Artificial Analysis' intelligence index (a single scale, the one the
 *  local models' catalogue quotes too). BenchLM's overall score is another scale and stays in the model's own sheet; mixing the two in
 *  one column would rank them against each other. null when the model is not in AA's list. */
export const kbScoreHeadline = (match) => {
  const e = match !== null && match !== undefined && match.aa !== null && match.aa !== undefined ? match.aa.entry : null
  const n = e === null || e === undefined ? NaN : Number(e.intelligenceIndex)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null
}

/** The readable labels of the evaluations used by THIS model, and nothing else:
  *  the sheet does not need the catalogue's 447 evaluations to show ten. */
const kbScoreLabels = (snapshot, match) => {
  const cat = (snapshot !== null && snapshot !== undefined && snapshot.catalogue !== null && typeof snapshot.catalogue === 'object') ? snapshot.catalogue : {}
  const out = {}
  const aa = match === null || match === undefined ? null : match.aa
  if (aa !== null && aa !== undefined) {
    for (const k of AA_EVAL_KEYS) {
      if (aa.entry[k] === undefined || aa.entry[k] === null) continue
      const c = cat[k]
      out[k] = {
        name: AA_EVAL_LABELS[k] !== undefined ? AA_EVAL_LABELS[k] : (c !== undefined && c.name !== null ? c.name : kbScorePretty(k)),
        category: c === undefined || c.category === null ? 'Artificial Analysis' : c.category,
        year: c === undefined ? null : c.year,
      }
    }
  }
  const bl = match === null || match === undefined ? null : match.benchlm
  if (bl !== null && bl !== undefined) {
    const bm = bl.entry.benchmarks !== null && typeof bl.entry.benchmarks === 'object' ? bl.entry.benchmarks : {}
    for (const c of Object.keys(bm)) {
      for (const k of Object.keys(bm[c])) {
        const e = cat[k]
        out[k] = {
          name: e !== undefined && e.name !== null ? e.name : kbScorePretty(k),
          category: e === undefined || e.category === null ? c : e.category,
          year: e === undefined ? null : e.year,
        }
      }
    }
  }
  return out
}

export function apply(ctx) {
  bootedAt = new Date().toISOString()
  try {
    ctx.inject(['webServer'], (hostCtx) => {
      const webServer = kbFenced(hostCtx.get('webServer'))
      const web = hostCtx.get('web')

            // Diagnostic: proves that the host half is running and exposes the contract.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/status', handler: async (req, res) => {
        const annotations = kbMaRead()
        const snap = kbScoresRead(false)
        sendJson(res, 200, {
          ok: true,
          version: MODEL_CATALOG_VERSION,
          bootedAt,
          mode: 'cable',
          wired: WIRED_FIELDS,
          annotation: ANNOTATION_FIELDS,
          store: { dir: STORE_DIR, annotations: Object.keys(annotations.models).length, annotationsFile: ANNOTATIONS_FILE },
          modelsDev: { cached: modelsDevCache === null ? 0 : Object.keys(modelsDevCache.byKey || {}).length, file: MODELSDEV_CACHE },
          scores: {
            file: SCORES_FILE,
            at: snap === null ? null : snap.at,
            aa: snap === null ? 0 : Object.keys(snap.aa || {}).length,
            benchlm: snap === null ? 0 : Object.keys(snap.benchlm || {}).length,
            running: scoresJob !== null && scoresJob.running === true,
          },
        })
      }}), 'kybernos-models: statut')

            // Reading the annotations (one entry per « route/id »).
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/annotations', handler: async (req, res) => {
        sendJson(res, 200, { ok: true, version: MODEL_CATALOG_VERSION, models: kbMaRead().models })
      }}), 'kybernos-models: annotations (lecture)')

            // Writing: a patch of annotation fields for a model. `null` purges
            // the whole entry (it is the path of the global revert).
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/annotations/save', handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (kbRefused(req, res)) return
        const body = await readBody(req)
        if (body === null || typeof body !== 'object') { sendJson(res, 400, { ok: false, error: 'bad-json' }); return }
        const key = typeof body.key === 'string' ? body.key : ''
        const slash = key.indexOf('/')
        if (key.length === 0 || key.length > 300 || slash <= 0 || slash === key.length - 1) { sendJson(res, 400, { ok: false, error: 'bad-key' }); return }
        const fields = body.fields
        if (fields !== null && (typeof fields !== 'object' || Array.isArray(fields))) { sendJson(res, 400, { ok: false, error: 'bad-fields' }); return }
        try {
          const next = kbMaWrite(key, fields)
          sendJson(res, 200, { ok: true, version: MODEL_CATALOG_VERSION, key, fields: next.models[key] || null, count: Object.keys(next.models).length })
        } catch (e) {
          sendJson(res, 500, { ok: false, error: 'write-failed', detail: String(e && e.message ? e.message : e) })
        }
      }}), 'kybernos-models: annotations (ecriture)')

      // Parked ("disabled") providers: list, park, take, forget.
      kbPkMount((route) => hostCtx.effect(() => webServer.register(route), 'kybernos-models: ' + route.path))
      // The first-run wizard asks the provider whether a pasted key is accepted, before saving it.
      kbKeyMount((route) => hostCtx.effect(() => webServer.register(route), 'kybernos-models: ' + route.path))
      // « Fetch available models »: the provider's own list, live, with the key its profile names (no engine patch, no engine web.fetch).
      kbLiveMount((route) => hostCtx.effect(() => webServer.register(route), 'kybernos-models: ' + route.path), () => ({ settings: hostCtx.get('settings'), credentials: hostCtx.get('credentials') }))

            // Journal of the writes: every attempt of the panel (real field or
            // annotation) leaves a line there, with the harness's answer. It is the
            // readable proof of what happened — and it does not leave the machine.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/journal', handler: async (req, res) => {
        const url = new URL('http://x' + (req.url || '/'))
        if (req.method === 'GET') {
          const limit = Number(url.searchParams.get('limit') || '60')
          const lines = kbJournalRead()
          sendJson(res, 200, { ok: true, version: MODEL_CATALOG_VERSION, file: JOURNAL_FILE, count: lines.length, lines: lines.slice(Math.max(0, lines.length - limit)) })
          return
        }
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (kbRefused(req, res)) return
        const body = await readBody(req)
        if (body === null || typeof body !== 'object') { sendJson(res, 400, { ok: false, error: 'bad-json' }); return }
        try {
          const line = kbJournalAppend(body)
          sendJson(res, 200, { ok: true, version: MODEL_CATALOG_VERSION, line })
        } catch (e) {
          // No detail: the system message carries the absolute path of the home folder.
          sendJson(res, 500, { ok: false, error: 'write-failed' })
        }
      }}), 'kybernos-models: journal des ecritures')

            // Prefill: the models.dev index, one fetch for everyone.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/modelsdev', handler: async (req, res) => {
        const url = new URL('http://x' + (req.url || '/'))
        const route = url.searchParams.get('route') || ''
        const id = url.searchParams.get('id') || ''
        const force = url.searchParams.get('force') === '1'
        // A forced refresh downloads the 4.7 MB index again: that is an act, so it is the page's own pair or nothing. The plain read stays open.
        if (force && kbRefused(req, res)) return
        const index = await kbMdLoad(web, force)
        if (index === null) { sendJson(res, 200, { ok: false, error: 'modelsdev-unavailable' }); return }
        // `stale` : l'index vient d'un cache de plus de 6 h (poste hors ligne).
        const stale = typeof index.at === 'number' ? (Date.now() - index.at) >= MODELSDEV_TTL_MS : false
        if (id.length === 0) {
          sendJson(res, 200, { ok: true, version: MODEL_CATALOG_VERSION, at: index.at, stale, providers: index.providers || 0, entries: Object.keys(index.byKey || {}).length })
          return
        }
        const hit = findModelsDev(index, route, id)
        sendJson(res, 200, { ok: true, version: MODEL_CATALOG_VERSION, at: index.at, stale, id, route, match: hit === null ? null : hit })
      }}), 'kybernos-models: index models.dev')

            // ── Provider catalogue (models.dev) and their logos ─────────────
            // Generated by `scripts/build-provider-catalog.mjs`: a JSON file and a
            // cleaned SVG per provider, read from disk — no network call.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/providers', handler: async (req, res) => {
        try {
          const txt = readFileSync(join(pluginDir, 'provider-catalog.json'), 'utf8')
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' })
          res.end(txt)
        } catch (e) { sendJson(res, 200, { ok: false, error: 'catalog-unavailable' }) }
      }}), 'kybernos-models: catalogue de fournisseurs')

      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/logo', handler: async (req, res) => {
        const id = new URL('http://x' + (req.url || '/')).searchParams.get('id') || ''
        const fichier = join(pluginDir, 'logos', id + '.svg')
        if (/^[a-z0-9][a-z0-9._-]{0,60}$/.test(id) !== true || id.includes('..') || existsSync(fichier) !== true) {
          try { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found') } catch (e) { /* socket closed */ }
          return
        }
        try {
          res.writeHead(200, {
            'content-type': 'image/svg+xml; charset=utf-8',
            'cache-control': 'public, max-age=86400',
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
          })
          res.end(readFileSync(fichier))
        } catch (e) { try { res.end() } catch (e2) { /* socket closed */ } }
      }}), 'kybernos-models: logos de fournisseurs')

            // ── External scores: read, served, never merged ────────────────
            // The provenance travels with the data: `method` says how the model was
            // matched, `sources` says when each catalogue was read.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/scores', handler: async (req, res) => {
        const url = new URL('http://x' + (req.url || '/'))
        const key = url.searchParams.get('key') || ''
        const name = url.searchParams.get('name') || ''
        const force = url.searchParams.get('force') === '1'
        const snapshot = kbScoresRead(force)
        const slash = key.indexOf('/')
        const route = slash > 0 ? key.slice(0, slash) : ''
        const id = slash > 0 ? key.slice(slash + 1) : ''
        const stale = snapshot === null || typeof snapshot.at !== 'number' ? true : (Date.now() - snapshot.at) >= SCORES_TTL_MS
        const match = snapshot === null ? { aa: null, benchlm: null } : kbScoreMatch(snapshot, route, id, name)
        sendJson(res, 200, {
          ok: true, version: SCORES_VERSION, key, at: snapshot === null ? null : snapshot.at, stale,
          running: scoresJob !== null && scoresJob.running === true,
          sources: snapshot === null ? null : snapshot.sources,
          labels: snapshot === null ? {} : kbScoreLabels(snapshot, match),
          aa: match.aa, benchlm: match.benchlm,
        })
      }}), 'kybernos-models: notes externes (lecture)')

      // The headline score of many models at once (the Score badge, filter and sort of the Models tab): { models: [{ key, name? }] } →
      // { scores: { "route/id": 32.1 } }, only for the models the snapshot knows. A POST so a long list never lands in an URL.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/scores/list', handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (kbRefused(req, res)) return
        const body = await readBody(req)
        if (body === null || typeof body !== 'object' || !Array.isArray(body.models)) { sendJson(res, 400, { ok: false, error: 'bad-json' }); return }
        const snapshot = kbScoresRead(false)
        const scores = {}
        if (snapshot !== null) {
          for (const m of body.models.slice(0, 800)) {
            const key = m !== null && typeof m === 'object' && typeof m.key === 'string' ? m.key : ''
            const slash = key.indexOf('/')
            if (key.length > 300 || slash <= 0 || slash === key.length - 1) continue
            const n = kbScoreHeadline(kbScoreMatch(snapshot, key.slice(0, slash), key.slice(slash + 1), typeof m.name === 'string' ? m.name.slice(0, 200) : ''))
            if (n !== null) scores[key] = n
          }
        }
        const stale = snapshot === null || typeof snapshot.at !== 'number' ? true : (Date.now() - snapshot.at) >= SCORES_TTL_MS
        sendJson(res, 200, { ok: true, version: SCORES_VERSION, at: snapshot === null ? null : snapshot.at, stale, scores })
      }}), 'kybernos-models: notes externes (liste des scores)')

            // The trigger: the answer leaves RIGHT AWAY, the scrape goes on.
            // An up-to-date scrape is not started again — it costs ~4 MB and two requests.
      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/scores/sync', handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        if (kbRefused(req, res)) return
        const body = await readBody(req)
        const force = body !== null && typeof body === 'object' && body.force === true
        if (scoresInflight !== null) { sendJson(res, 200, { ok: true, started: false, running: true }); return }
        const snapshot = kbScoresRead(false)
        if (force !== true && snapshot !== null && typeof snapshot.at === 'number' && (Date.now() - snapshot.at) < SCORES_TTL_MS) {
          sendJson(res, 200, { ok: true, started: false, running: false, at: snapshot.at, frais: true })
          return
        }
        kbScoresRefresh().catch(() => { /* le statut porte l'erreur */ })
        sendJson(res, 200, { ok: true, started: true, running: true })
      }}), 'kybernos-models: notes externes (rafraichissement)')

      hostCtx.effect(() => webServer.register({ kind: 'exact', path: '/kybernos-models/scores/status', handler: async (req, res) => {
        const snapshot = kbScoresRead(false)
        sendJson(res, 200, {
          ok: true, version: SCORES_VERSION,
          at: snapshot === null ? null : snapshot.at,
          sources: snapshot === null ? null : snapshot.sources,
          job: scoresJob,
        })
      }}), 'kybernos-models: notes externes (statut)')
    })
  } catch (kbBootError) {
    try { console.error('[kybernos-models] montage des routes impossible', kbBootError) } catch (e2) { /* console indisponible */ }
  }
}

export { STORE_DIR, ANNOTATIONS_FILE, MODELSDEV_CACHE, SCORES_FILE, JOURNAL_FILE, kbJournalAppend, pluginDir, kbScoresRefresh, kbScoresRead }
