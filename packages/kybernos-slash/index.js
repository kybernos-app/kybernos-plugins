// ── Host plugin "kybernos-slash" ────────────────────────────────────────────
// Makes the "slash commands & actions" REAL: a CRUD route that the client reads
// and that the `slash-msgaction-creator` skill writes.
//
//   GET  /kybernos/slash/entries   → { ok, version, path, entries }
//   POST /kybernos/slash/entries   → upsert / delete / replace, reply { ok, ... }
//   GET  /kybernos/slash/status    → diagnostics (path, existence, count)
//
// Storage: ONE file, `$DSH_HOME/kybernos-slash/entries.json` — a JSON array of
// entries, merged by `id`. It is exactly the fallback the skill uses when the
// route answers 404: both paths lead to the same file, so wiring the route loses
// nothing that was already written.
//
// A file that is present but cannot be trusted (unreadable, or not a JSON array:
// half-written, edited by hand) is NEVER read as an empty list, because the next
// write would then replace it and lose every saved entry. GET reports the problem,
// and POST is refused with a 500 and leaves the file untouched until it is
// repaired. Before refusing, a POST keeps a copy of a corrupt file next to it.
//
// The semantics (conditions, visibility, required fields, rendering, normalisation
// of the legacy models) are NOT rewritten here: they come from `./model.js`, the
// dependency-free core.
import { chmodSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_VERSION, normalize, runOf, hasForm, visibleFields, validate, render } from './model.js'

const pluginDir = dirname(fileURLToPath(import.meta.url))

// ── HTTP: same guards as kybernos-skills/index.js (method, then origin) ──────
const sendJson = (res, status, payload) => {
  try {
    const body = JSON.stringify(payload === undefined ? null : payload)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  } catch (e) { try { res.writeHead(500); res.end('{}') } catch (e2) { /* socket closed */ } }
}

const sameOrigin = (req) => {
  try {
    const origin = req.headers && typeof req.headers.origin === 'string' ? req.headers.origin : null
    const hostHeader = req.headers && typeof req.headers.host === 'string' ? req.headers.host : null
    if (origin === null || hostHeader === null) return true
    const u = new URL(origin)
    return u.host === hostHeader
  } catch (e) { return false }
}

const readJsonBody = async (req, maxBytes) => {
  const cap = typeof maxBytes === 'number' ? maxBytes : 262144
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > cap) throw new Error('corps de requete trop volumineux')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(text)
}

const queryParam = (req, key) => {
  try {
    const raw = str(req.url) !== null ? String(req.url) : ''
    const q = raw.indexOf('?')
    if (q < 0) return null
    const parts = raw.slice(q + 1).split('&')
    for (const p of parts) {
      const eq = p.indexOf('=')
      const k = eq < 0 ? p : p.slice(0, eq)
      if (decodeURIComponent(k) !== key) continue
      const v = eq < 0 ? '' : decodeURIComponent(p.slice(eq + 1).replace(/\+/g, ' '))
      return v === '' ? null : v
    }
  } catch (e) { return null }
  return null
}

const str = (v) => (typeof v === 'string' && v !== '' ? v : null)

// ── Where the store lives ───────────────────────────────────────────────────
// `DSH_HOME` can move the home folder; `KYBERNOS_SLASH_STORE` only exists so that
// a test harness can aim at a temporary file without touching the real one.
export function dshHome() {
  const env = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : null
  return env !== null ? env : join(homedir(), '.dsh')
}

export function storePath() {
  const forced = typeof process.env.KYBERNOS_SLASH_STORE === 'string' && process.env.KYBERNOS_SLASH_STORE !== ''
    ? process.env.KYBERNOS_SLASH_STORE
    : null
  return forced !== null ? forced : join(dshHome(), 'kybernos-slash', 'entries.json')
}

// ── Reading / writing ───────────────────────────────────────────────────────
const CORRUPT_COPY_SUFFIX = '.corrupt-'
const CORRUPT_COPIES_MAX = 5

/**
 * The store on disk, in one of three shapes:
 *   - `{ entries }`           a JSON array; a MISSING or empty file is an empty list
 *   - `{ corrupt: true, text }` present but not a JSON array (truncated, hand-edited)
 *   - `{ unreadable: code }`  present but cannot be read (permissions, a directory...)
 * Only the first shape may be written over: the other two would lose saved entries.
 */
export function readStoreState(path) {
  const p = path !== undefined && path !== null ? path : storePath()
  let text = null
  try { text = readFileSync(p, 'utf8') } catch (e) {
    if (e !== null && e !== undefined && e.code === 'ENOENT') return { entries: [] }
    return { unreadable: e && e.code ? String(e.code) : 'unknown error' }
  }
  if (text.trim() === '') return { entries: [] }
  let data = null
  try { data = JSON.parse(text) } catch (e) { return { corrupt: true, text } }
  return Array.isArray(data) ? { entries: data } : { corrupt: true, text }
}

/**
 * Keeps a copy of a corrupt file next to it, as `<name>.corrupt-<timestamp>`. A copy
 * with the same content is reused, and there are never more than CORRUPT_COPIES_MAX
 * copies, so repeated attempts do not pile up files. Returns the copy's path or null.
 */
function keepCorruptCopy(file, text) {
  try {
    const folder = dirname(file)
    const prefix = basename(file) + CORRUPT_COPY_SUFFIX
    const copies = readdirSync(folder).filter((name) => name.startsWith(prefix))
    for (const name of copies) {
      try { if (readFileSync(join(folder, name), 'utf8') === text) return join(folder, name) } catch (e) { /* unreadable copy: ignored */ }
    }
    if (copies.length >= CORRUPT_COPIES_MAX) return null
    // Exclusive create ('wx'): two copies made in the same millisecond must never
    // overwrite each other, so a name that is taken gets a counter.
    const base = join(folder, prefix + Date.now())
    for (let i = 0; i < CORRUPT_COPIES_MAX; i += 1) {
      const copy = i === 0 ? base : base + '-' + i
      try { writeFileSync(copy, text, { mode: 0o600, flag: 'wx' }); return copy } catch (e) { if (!(e && e.code === 'EEXIST')) return null }
    }
    return null
  } catch (e) { return null }
}

/**
 * Why the store on disk must NOT be used (listed as empty, or written over), or null
 * when it can. `saving` says whether a write was asked for: only then is a copy of a
 * corrupt file kept, so a plain read never writes anything.
 */
export function storeProblem(state, file, saving) {
  if (state.entries !== undefined) return null
  const name = basename(file)
  const tail = saving === true ? 'so nothing was saved' : 'so the saved commands cannot be listed'
  if (state.unreadable !== undefined) return name + ' cannot be read (' + state.unreadable + '), ' + tail + '. Check its permissions, then try again.'
  const copy = saving === true ? keepCorruptCopy(file, state.text) : null
  return name + ' is not a valid JSON array, ' + tail + (copy === null ? '' : ' (a copy is kept as ' + basename(copy) + ')') + '. Fix or remove the file, then try again.'
}

/**
 * Atomic write: a temp file in the same directory, then a rename, so a crash never
 * leaves truncated JSON. An existing file keeps its permissions (a new one is 0600),
 * and a symlinked store stays a symlink: the target is replaced, not the link. The
 * temp file is removed when anything fails, and the error is thrown.
 */
export function writeStore(list, path) {
  const p = path !== undefined && path !== null ? path : storePath()
  let target = p
  try { target = realpathSync(p) } catch (e) { /* new file */ }
  let mode = 0o600
  try { mode = statSync(target).mode & 0o777 } catch (e) { /* new file: private by default */ }
  mkdirSync(dirname(target), { recursive: true })
  const temp = join(dirname(target), '.' + basename(target) + '.tmp-' + process.pid + '-' + Date.now())
  try {
    writeFileSync(temp, JSON.stringify(list, null, 2) + '\n', { encoding: 'utf8', mode })
    chmodSync(temp, mode) // the mode given to writeFileSync is masked by the umask
    renameSync(temp, target)
  } catch (e) {
    try { rmSync(temp, { force: true }) } catch (e2) { /* nothing left to clean */ }
    throw e
  }
  return p
}

// ── Canonicalisation (validated by model.js) ────────────────────────────────
const isI18n = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
const asArray = (v) => (Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]))

/**
 * Validates and canonicalises a raw entry WITHOUT losing i18n.
 *
 * `model.js#normalize` does the real work: it accepts `slug`/`cmd`/`name`, the
 * legacy models (`visibleWhen`, `hiddenIf`, `data.prompt_message`), and derives
 * `id`, `run`, the fields and the template. But it FLATTENS `{fr,en}` labels
 * into one string (SPEC rule 9: the three forms are allowed and the client picks
 * its language). So the localised object is attached again when the source had one.
 */
export function canonicalize(raw, kind, opts) {
  const src = isI18n(raw) ? raw : {}
  const k = kind !== undefined ? kind : (src.kind === 'action' ? 'action' : 'slash')
  // An ACTION from the mockup carries its template in `submit` (with `{message}`),
  // where a command carries it in `template`. `model.js` only knows `template`:
  // without this bridge the body of an action was lost silently — `normalize`
  // does not throw, it returns an empty string.
  const withTemplate = (src.template === undefined && src.submit !== undefined)
    ? Object.assign({}, src, { template: src.submit })
    : src
  const base = normalize(withTemplate, k, opts)
  if (isI18n(src.label)) base.label = src.label
  if (isI18n(src.description)) base.description = src.description
  const srcFields = asArray(src.fields !== undefined ? src.fields : (isI18n(src.data) ? src.data.fields : []))
  base.fields = (base.fields || []).map((f, i) => {
    const rf = isI18n(srcFields[i]) ? srcFields[i] : {}
    const out = Object.assign({}, f)
    if (isI18n(rf.label)) out.label = rf.label
    if (isI18n(rf.placeholder)) out.placeholder = rf.placeholder
    if (Array.isArray(rf.options) && Array.isArray(f.options) && rf.options.length === f.options.length) {
      out.options = f.options.map((o, j) => (isI18n(rf.options[j]) && isI18n(rf.options[j].label)
        ? Object.assign({}, o, { label: rf.options[j].label })
        : o))
    }
    if (rf.requireIf !== undefined) out.requireIf = rf.requireIf
    return out
  })
  // `name` is the historical alias of `slug` (mockup, original kybernos): it is
  // exposed so that the client does not have to choose between the two.
  base.name = base.slug
  base.run = runOf(base)
  base.version = MODEL_VERSION
  return base
}

/** The identity of an entry, whatever shape it was received in. */
export function idOf(entry) {
  if (isI18n(entry) === false) return null
  const raw = entry.id !== undefined ? entry.id : (entry.slug !== undefined ? entry.slug : entry.name)
  if (raw === undefined || raw === null) return null
  const id = String(raw).replace(/^\/+/, '').trim()
  return id === '' ? null : id
}

/** Display order: `order` ascending, then `slug` — stable and predictable. */
export const compareEntries = (a, b) => {
  const oa = Number.isFinite(a.order) ? a.order : 0
  const ob = Number.isFinite(b.order) ? b.order : 0
  if (oa !== ob) return oa - ob
  return String(a.name || a.slug || a.id || '').localeCompare(String(b.name || b.slug || b.id || ''))
}

/**
 * Merge by `id`: an incoming entry REPLACES the one with the same id, it never
 * duplicates. Returns `{ entries, added, updated }`.
 */
export function mergeEntries(existing, incoming) {
  const list = asArray(existing).slice()
  const byId = new Map()
  list.forEach((e) => { const id = idOf(e); if (id !== null) byId.set(id, e) })
  let added = 0
  let updated = 0
  asArray(incoming).forEach((e) => {
    const id = idOf(e)
    if (id === null) return
    const next = Object.assign({}, e, { id })
    if (byId.has(id)) updated += 1; else added += 1
    byId.set(id, next)
  })
  const entries = Array.from(byId.values()).sort(compareEntries)
  return { entries, added, updated }
}

/** Removes entries by id. Returns `{ entries, removed }`. */
export function removeEntries(existing, ids) {
  const kill = new Set(asArray(ids).map((x) => String(x).replace(/^\/+/, '').trim()))
  const before = asArray(existing)
  const entries = before.filter((e) => { const id = idOf(e); return id === null || kill.has(id) === false })
  return { entries, removed: before.length - entries.length }
}

// ── The route ───────────────────────────────────────────────────────────────
const MAX_ENTRIES = 500

/**
 * Applies a POST body to the store. Accepted contract:
 *   - a single entry (object with `id`/`slug`/`name`)         → upsert
 *   - an array of entries                                     → multiple upsert
 *   - `{ entry: {...} }` or `{ entries: [...] }`              → upsert
 *   - `{ delete: "id" | ["id", ...] }` / `{ remove: ... }`    → deletion
 *   - `{ replace: [...] }`                                    → full replacement
 * Returns `{ ok, entries, added, updated, removed, error? }` and never throws.
 */
export function applyMutation(store, body) {
  try {
    const b = isI18n(body) ? body : {}
    const list = asArray(store)

    if (b.replace !== undefined) {
      const next = asArray(b.replace).map((e) => canonicalize(e)).filter((e) => idOf(e) !== null)
      if (next.length > MAX_ENTRIES) return { ok: false, error: 'trop d entrées', entries: list }
      // Merge onto an empty base: two entries with the same id in the batch
      // produce one row only, exactly like an upsert.
      const dedup = mergeEntries([], next).entries
      return { ok: true, entries: dedup, added: dedup.length, updated: 0, removed: list.length }
    }

    const del = b.delete !== undefined ? b.delete : b.remove
    if (del !== undefined) {
      const out = removeEntries(list, del)
      return { ok: true, entries: out.entries, added: 0, updated: 0, removed: out.removed }
    }

    const incoming = Array.isArray(body)
      ? body
      : (b.entry !== undefined ? b.entry : (b.entries !== undefined ? b.entries : (idOf(b) !== null ? b : [])))
    const raws = asArray(incoming)
    if (raws.length === 0) return { ok: false, error: 'aucune entree fournie', entries: list }

    const canon = []
    for (const raw of raws) {
      const entry = canonicalize(raw)
      if (idOf(entry) === null) return { ok: false, error: 'id manquant', entries: list }
      canon.push(entry)
    }
    const out = mergeEntries(list, canon)
    if (out.entries.length > MAX_ENTRIES) return { ok: false, error: 'trop d entrées', entries: list }
    return { ok: true, entries: out.entries, added: out.added, updated: out.updated, removed: 0 }
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message) : 'mutation impossible' }
  }
}

const mountWebRoutes = (ctx, webServerSvc) => {
  // The web server's "exact" registry is indexed by PATH, not by (path, method):
  // "Duplicate paths throw" (dsh-host-webserver/lib/index.js, `exact` table).
  // Registering a GET *and* a POST on `/kybernos/slash/entries` therefore makes
  // the second one throw — and the surviving route answers 405 to the other
  // method. That is why the "entries" path has only ONE registration, which
  // dispatches on `req.method` itself.
  const ROUTE = (path, label, fn) => ctx.effect(() => webServerSvc.register({ kind: 'exact', path, handler: async (req, res) => {
    try { await fn(req, res) } catch (e) { sendJson(res, 500, { ok: false, error: 'requete impossible' }) }
  } }), label)

  const GET = (path, label, fn) => ROUTE(path, label, async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET attendu' })
    sendJson(res, 200, await fn(req))
  })

  ROUTE('/kybernos/slash/entries', 'kybernos-slash: entrees (lire et ecrire)', async (req, res) => {
    if (req.method === 'GET') {
      const p = storePath()
      const state = readStoreState(p)
      // A file that is there but unusable is an ERROR, never an empty list: the UI
      // must be able to say so, and a client that then saves must not be led to
      // believe that there is nothing to lose.
      const problem = storeProblem(state, p, false)
      if (problem !== null) return sendJson(res, 500, { ok: false, version: MODEL_VERSION, path: p, state: state.corrupt === true ? 'corrupt' : 'unreadable', error: problem })
      // m10: the read carried no `total` while POST and /status expose it — a
      // paginating client had to count itself. Same shape as /status so that the
      // two routes read alike.
      const entries = state.entries.sort(compareEntries)
      return sendJson(res, 200, {
        ok: true, version: MODEL_VERSION, path: p,
        total: entries.length,
        slash: entries.filter((e) => (e.kind === 'action' ? 'action' : 'slash') === 'slash').length,
        action: entries.filter((e) => e.kind === 'action').length,
        entries: entries,
      })
    }
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'GET ou POST attendu' })
    // Guards in this order: method first, origin next. No POST request touches
    // the disk before both.
    if (sameOrigin(req) === false) return sendJson(res, 403, { ok: false, error: 'origine refusee' })
    let body = null
    try { body = await readJsonBody(req) } catch (e) { return sendJson(res, 400, { ok: false, error: 'corps JSON invalide' }) }
    const p = storePath()
    const state = readStoreState(p)
    // Present but unreadable or corrupt: nothing is written, whatever the body asks
    // for (the file is only ever left as it is, plus a copy of it next to it).
    const problem = storeProblem(state, p, true)
    if (problem !== null) return sendJson(res, 500, { ok: false, path: p, state: state.corrupt === true ? 'corrupt' : 'unreadable', error: problem })
    const before = state.entries
    const out = applyMutation(before, body)
    // A validation refusal goes out as a 400: a caller that only reads the status
    // code must never take a refused entry for a successful write.
    if (out.ok === false) return sendJson(res, 400, { ok: false, error: out.error, path: p, total: before.length })
    try { writeStore(out.entries, p) } catch (e) {
      return sendJson(res, 500, { ok: false, path: p, total: before.length, error: basename(p) + ' could not be written (' + (e && e.code ? e.code : 'unknown error') + '), so nothing was saved' })
    }
    // What was just written is read back: the route never says "written" about a
    // file it has not checked (same requirement as the skill).
    const after = readStoreState(p)
    if (after.entries === undefined) return sendJson(res, 500, { ok: false, path: p, error: basename(p) + ' was written but cannot be read back, please check the file' })
    return sendJson(res, 200, { ok: true, path: p, total: after.entries.length, added: out.added, updated: out.updated, removed: out.removed, entries: after.entries })
  })

  GET('/kybernos/slash/status', 'kybernos-slash: etat du magasin', async () => {
    const p = storePath()
    let exists = false
    let bytes = 0
    let mtime = null
    try { const st = statSync(p); exists = st.isFile(); bytes = st.size; mtime = st.mtime.toISOString() } catch (e) { exists = false }
    const state = readStoreState(p)
    const problem = storeProblem(state, p, false)
    const entries = problem === null ? state.entries : []
    return {
      ok: true, version: MODEL_VERSION, path: p, exists, bytes, mtime,
      total: entries.length,
      slash: entries.filter((e) => (e.kind === 'action' ? 'action' : 'slash') === 'slash').length,
      action: entries.filter((e) => e.kind === 'action').length,
      // Only present when the file cannot be used: a total of 0 must not pass for "empty".
      ...(problem === null ? {} : { state: state.corrupt === true ? 'corrupt' : 'unreadable', error: problem }),
    }
  })

  // The text of a received message: an action whose template contains `{message}`
  // needs it, and the action bar only knows its identifier. Same path as the
  // voice synthesis (sessionPersistence).
  GET('/kybernos/slash/message', 'kybernos-slash: texte d un message', async (req) => {
    const sessionId = queryParam(req, 'sessionId')
    const messageId = queryParam(req, 'messageId')
    if (sessionId === null || messageId === null) return { ok: false, error: 'sessionId et messageId requis' }
    return messageText(ctx, sessionId, messageId)
  })

  console.log('[kybernos-slash] routes /kybernos/slash/* enregistrees (entries GET+POST sur un seul chemin, status, message) — magasin ' + storePath())
}

/**
 * Finds the text of a message from its identifier, by re-reading the session
 * thread. It is the only way for a template that contains `{message}`: the
 * action bar only receives `sessionId` + `messageId`.
 * Never throws; returns `{ok:false}` when the text is not found.
 * @param ctx - cordis context (for `sessionPersistence`).
 * @param sessionId - the targeted session.
 * @param messageId - the targeted message identifier.
 * @returns {Promise<{ok:true,text:string}|{ok:false,error:string}>} the message text.
 */
export async function messageText(ctx, sessionId, messageId) {
  const persistence = (ctx !== null && ctx !== undefined && typeof ctx.get === 'function') ? ctx.get('sessionPersistence') : null
  if (persistence === null || persistence === undefined || typeof persistence.open !== 'function') {
    return { ok: false, error: 'sessionPersistence indisponible' }
  }
  let events = []
  try {
    const handle = await persistence.open(sessionId, 'read')
    try {
      const read = await handle.read()
      events = (read !== null && read !== undefined && Array.isArray(read.events) === true) ? read.events : []
    } finally {
      try { if (handle !== null && handle !== undefined && typeof handle.close === 'function') await handle.close() } catch (e) { /* already closed */ }
    }
  } catch (e) {
    return { ok: false, error: 'fil illisible' }
  }
  for (const ev of events) {
    if (ev === null || ev === undefined || typeof ev !== 'object') continue
    if (ev.type !== 'assistant/message') continue
    const data = ev.data
    const message = (data !== null && data !== undefined && typeof data === 'object') ? data.message : null
    if (message === null || message === undefined) continue
    if (String(message.id) !== String(messageId)) continue
    const parts = []
    if (Array.isArray(message.content) === true) {
      for (const block of message.content) {
        if (block !== null && block !== undefined && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      }
    }
    return { ok: true, text: parts.join('\n') }
  }
  return { ok: false, error: 'message introuvable' }
}

export function apply(ctx) {
  // Mirror of the safety net in kybernos-plugin/index.js: a mounting error must
  // not cut the GUI — the routes fall alone, the error is logged.
  try {
    ctx.inject(['webServer'], (hostCtx) => {
      try {
        mountWebRoutes(hostCtx, hostCtx.get('webServer'))
      } catch (e) {
        try { console.error('[kybernos-slash] montage des routes impossible', e) } catch (e2) { /* console unavailable */ }
      }
    })
  } catch (ksBootError) {
    try {
      console.error('[kybernos-slash] demarrage impossible — routes /kybernos/slash/* non montees', ksBootError)
    } catch (e2) { /* console unavailable */ }
  }
}

export { MODEL_VERSION, normalize, runOf, hasForm, visibleFields, validate, render, pluginDir }
