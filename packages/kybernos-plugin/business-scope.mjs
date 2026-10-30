// ── Which template the Business pages show ───────────────────────────────────────────────────────────────────────────────────────
//
// Contacts, Catalog and Pipeline show ONE sector template at a time (docs/dev/business-visuals.md, « One active template »). The templates
// that bring Business points (a contacts schema, a catalogue type, a board) stay installed side by side; the one the pages follow is the
// ACTIVE one, and every row of the shared base belongs to the scope of exactly one template (its plugin id, `kybernos-themes/ecommerce`).
//
// This file is the pure half, over its ports (the registry seam and one small file), so a test drives it with no DSH:
//   readActive / writeActive   <DSH home>/kybernos/business/active-template.json, `{ v: 1, active, at }`: bounded, atomic (a temporary file, then
//                              a rename), 0600, a corrupt or oversized file reads as « none »
//   templatesOf(registry)      the installed templates that touch the Business pages, read from what the registry hands the three points and the
//                              field-of-work pack of the same plugin (its name, icon, accent and the words of the three rows): nothing new in a template
//   resolveActive              the stored choice when it is still installed, else the template installed last, else the first by id; none when none
//   liveScope(ports)           what the base asks at each question (a string, or null: no template, the pages behave as they always did)
//   handleScope(request, ports)  the body of /kybernos/business/scope: method, origin, signed session, then `set`
//
// Nothing here throws: a registry that is not there, a file that cannot be read or written, a garbage body all answer as « no choice ».
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The three Business points a template extends, by the row of the sidebar they feed. */
export const BUSINESS_POINTS = Object.freeze({ contacts: 'kybernos/contacts#schema', catalog: 'kybernos/catalog#type', pipeline: 'kybernos/pipeline#flow' })
export const PACK_POINT = 'kybernos/core#domain-pack'
/** A scope is a plugin id; the same shape the base accepts for the theme of a seed. */
export const SCOPE_RE = /^[a-z0-9][a-z0-9/_-]{0,60}$/
export const FILE_NAME = 'active-template.json'
const FILE_MAX = 4 * 1024
const TEMPLATES_MAX = 24
const ROWS = Object.freeze(['contacts', 'catalog', 'pipeline'])
const LANGS = ['en', 'fr', 'es', 'ar']

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v, max) => (typeof v === 'string' && v.trim() !== '' && v.length <= max && !/[<>\u0000-\u001f]/.test(v) ? v.trim() : null)

/** `{ en, fr… }` kept as given when every text is short and plain; `null` for anything else. */
const pairOf = (v, max) => {
  if (!plain(v)) return null
  const out = {}
  for (const l of LANGS) { if (v[l] === undefined) continue; const t = text(v[l], max); if (t !== null) out[l] = t }
  return out.en === undefined ? null : out
}

// ── the stored choice ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The file next to the base: `<dir of the base>/active-template.json`. */
export const activeFileFor = (businessFile) => join(dirname(businessFile), FILE_NAME)

/** The stored template id, or null (no file, too large, not JSON, not an id). Never throws. */
export function readActive (file) {
  try {
    if (typeof file !== 'string' || file === '' || statSync(file).size > FILE_MAX) return null
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return plain(j) && j.v === 1 && typeof j.active === 'string' && SCOPE_RE.test(j.active) ? j.active : null
  } catch (e) { return null }
}

/** Writes the choice atomically (a temporary file beside it, then a rename), mode 0600. `{ ok: true }` or `{ ok: false, error }`. */
export function writeActive (file, id, now = () => new Date().toISOString()) {
  try {
    if (typeof file !== 'string' || file === '') return { ok: false, error: 'file' }
    if (id !== null && (typeof id !== 'string' || !SCOPE_RE.test(id))) return { ok: false, error: 'id' }
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    const tmp = file + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify({ v: 1, active: id, at: now() }, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, file)
    try { chmodSync(file, 0o600) } catch (e) { /* a filesystem that keeps the mode it has */ }
    return { ok: true }
  } catch (e) { return { ok: false, error: 'write' } }
}

/** The ids of the templates the person installed, the last one first (`<kybernos dir>/themes.json`, the installer's own record). Never throws. */
export function recentTemplates (themesFile) {
  try {
    if (statSync(themesFile).size > 256 * 1024) return []
    const j = JSON.parse(readFileSync(themesFile, 'utf8'))
    const ids = (plain(j) && Array.isArray(j.records) ? j.records : []).map((r) => (plain(r) && typeof r.id === 'string' ? r.id : null)).filter((x) => x !== null).reverse()
    if (plain(j) && typeof j.active === 'string' && ids.indexOf(j.active) < 0) ids.unshift(j.active)
    return ids
  } catch (e) { return [] }
}

// ── is the registry ready to be asked ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Whether the registry has heard the three Business points yet. Each Business plugin tells the registry its point a moment after DSH starts (the registry may
 * mount after them), and until then it hands back no contribution for it: « no template installed » and « not told yet » look the same from outside. A registry
 * that cannot list its points (a fake in a test, an older one) is taken as ready. Never throws.
 */
export function registryReady (registry) {
  try {
    if (registry === null || registry === undefined) return false
    if (typeof registry.points !== 'function') return true
    const have = new Set((registry.points() || []).map((p) => (plain(p) ? p.id : null)))
    return Object.values(BUSINESS_POINTS).every((ref) => have.has(ref))
  } catch (e) { return false }
}

// ── what is installed ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const contributionsOf = (registry, ref) => {
  try {
    const list = registry !== null && registry !== undefined && typeof registry.contributions === 'function' ? registry.contributions(ref) : []
    return Array.isArray(list) ? list.filter((c) => plain(c) && typeof c.plugin === 'string' && SCOPE_RE.test(c.plugin)) : []
  } catch (e) { return [] }
}

/**
 * The installed templates that touch the Business pages, by id: `[{ id, name, icon, accent, words }]`.
 * `name` is `{ en, fr… }` (the template's own name, from its field-of-work pack, else the plugin's English name, else the id's last word),
 * `icon` a pack icon name or null, `accent` a colour or null, `words` the pack's words for the rows that have some (`{ contacts, catalog, pipeline }`).
 * Only plugins the registry reads (status ok) bring contributions, so a
 * template waiting for consent, switched off or invalid is not listed. Never throws.
 */
export function templatesOf (registry) {
  try {
    const byId = new Map()
    for (const row of ROWS) {
      for (const c of contributionsOf(registry, BUSINESS_POINTS[row])) {
        if (!byId.has(c.plugin)) byId.set(c.plugin, { id: c.plugin, name: null, icon: null, accent: null, words: {} })
      }
    }
    for (const c of contributionsOf(registry, PACK_POINT)) {
      const t = byId.get(c.plugin)
      const v = plain(c.value) ? c.value : null
      if (t === undefined || v === null || t.name !== null) continue
      t.name = pairOf(v.name, 80)
      t.icon = text(v.icon, 24)
      t.accent = typeof v.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.accent) ? v.accent : null
      const labels = plain(v.menu) && plain(v.menu.labels) ? v.menu.labels : {}
      for (const row of ROWS) { const w = pairOf(labels[row], 40); if (w !== null) t.words[row] = w }
    }
    let plugins = null
    for (const t of byId.values()) {
      if (t.name !== null) continue
      try { plugins = plugins === null ? (typeof registry.plugins === 'function' ? registry.plugins() : []) : plugins } catch (e) { plugins = [] }
      const hit = (Array.isArray(plugins) ? plugins : []).find((p) => plain(p) && p.id === t.id)
      const en = hit !== undefined ? text(hit.name, 80) : null
      t.name = { en: en !== null ? en : t.id.split('/').pop() }
    }
    return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, TEMPLATES_MAX)
  } catch (e) { return [] }
}

/**
 * The template the pages follow: the stored choice while it is still installed, else the one installed last (`recent`, newest first), else the first by
 * id. `null` when no template touches the Business pages (the pages then behave as they always did, with the default types).
 */
export function resolveActive ({ stored, templates, recent }) {
  const ids = (Array.isArray(templates) ? templates : []).map((t) => (typeof t === 'string' ? t : t.id))
  if (ids.length === 0) return null
  if (typeof stored === 'string' && ids.indexOf(stored) >= 0) return stored
  for (const id of Array.isArray(recent) ? recent : []) if (ids.indexOf(id) >= 0) return id
  return ids[0]
}

/**
 * What the base asks at each question: the active scope as a string, or null. `ports`: `file()` (the stored choice), `registry()` (the seam or null),
 * `recent()` (the installer's order). Without the registry, or before it has heard the three points (the first seconds after DSH starts), the stored choice
 * stands as it is; a registry that is ready and knows no template means no scope at all. Never throws.
 */
export function liveScope (ports) {
  try {
    const stored = readActive(ports.file())
    const registry = ports.registry()
    // Not mounted yet, or mounted but not yet told the three points: nothing can be said about what is installed, so the person's own choice stands.
    if (registry === null || registry === undefined || !registryReady(registry)) return stored
    return resolveActive({ stored, templates: templatesOf(registry), recent: ports.recent() })
  } catch (e) { return null }
}

// ── the route body ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * What the selector draws: the templates, which one is active, and which one the file says (they differ while the stored one is not installed).
 * `ready` is false while the registry has not heard the three points: an empty list then means « not known yet », and the page asks again.
 */
export function viewOf (ports) {
  const registry = ports.registry()
  const ready = registryReady(registry)
  const templates = ready ? templatesOf(registry) : []
  const stored = readActive(ports.file())
  return { ok: true, ready, active: ready ? resolveActive({ stored, templates, recent: ports.recent() }) : stored, stored, templates }
}

/**
 * Makes `id` the template the pages follow. `strict` (the selector) wants a template the registry already reads; the install path
 * (`strict: false`) also accepts a plugin that is installed and extends one of the three points but is not read yet (it waits for the
 * restart that switches its pages on): the choice is stored and takes effect as soon as it is listed.
 */
export function activate (ports, id, strict = true) {
  if (typeof id !== 'string' || !SCOPE_RE.test(id)) return { ok: false, error: 'id' }
  const listed = templatesOf(ports.registry()).some((t) => t.id === id)
  if (!listed) {
    let known = false
    if (strict === false) {
      try {
        const registry = ports.registry()
        const plugins = registry !== null && registry !== undefined && typeof registry.plugins === 'function' ? registry.plugins() : []
        const hit = (Array.isArray(plugins) ? plugins : []).find((p) => plain(p) && p.id === id)
        const points = Object.values(BUSINESS_POINTS)
        known = hit !== undefined && Array.isArray(hit.extends) && hit.extends.some((e) => plain(e) && points.indexOf(e.point) >= 0)
      } catch (e) { known = false }
    }
    if (!known) return { ok: false, error: 'unknown_template' }
  }
  const written = writeActive(ports.file(), id)
  return written.ok === true ? { ok: true, active: id } : { ok: false, error: written.error }
}

/**
 * `handleScope(request, ports)` → `{ status, body }`: the body of `/kybernos/business/scope`, pure over its ports.
 * GET → `{ ok, active, stored, templates }`; POST `{ action: 'set', id }` → the same view after the choice is stored. Order of the refusals:
 * method (405), origin (403), signed session (401/403/503), then the body (400/404). `ports.sameOrigin(req)` must be the STRICT same-origin
 * check (a read names the listener too: this route tells which sector the person works in), `ports.session(req)` answers `true` or `{ status, error }`.
 */
export function handleScope (request, ports) {
  const answer = (status, body) => ({ status, body })
  try {
    const req = plain(request) ? request : {}
    const p = plain(ports) ? ports : {}
    const method = typeof req.method === 'string' ? req.method.toUpperCase() : ''
    if (method !== 'GET' && method !== 'POST') return answer(405, { ok: false, error: 'GET or POST expected' })
    if (typeof p.sameOrigin === 'function' && p.sameOrigin(req) !== true) return answer(403, { ok: false, error: 'origin refused' })
    const session = typeof p.session === 'function' ? p.session(req) : true
    if (session !== true) return answer(plain(session) && typeof session.status === 'number' ? session.status : 403, { ok: false, error: plain(session) && typeof session.error === 'string' ? session.error : 'sign-in required' })
    if (method === 'GET') return answer(200, viewOf(p))
    const body = plain(req.body) ? req.body : null
    if (body === null || body.action !== 'set') return answer(400, { ok: false, error: 'an action "set" with an id is expected' })
    const done = activate(p, body.id, true)
    if (done.ok !== true) return answer(done.error === 'unknown_template' ? 404 : (done.error === 'id' ? 400 : 500), { ok: false, error: done.error })
    return answer(200, viewOf(p))
  } catch (e) { return answer(500, { ok: false, error: 'internal error' }) }
}
