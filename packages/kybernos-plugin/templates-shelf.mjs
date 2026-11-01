// The templates shelf, host half: the catalogue of examples the new-chat page shows under its types (a picture, a name, the request each one starts from).
//
// The catalogue is a PUBLIC file of the Kybernos server (`GET /v1/templates/catalogue.json` and its pictures, `docs/dev/templates-catalogue.md`). This module keeps it on
// disk the way the connectors' catalogue is kept (`kybernos-cloud/connections-host.mjs`): loaded in the background after the start, renewed once a day, served from the
// disk copy so the page opens at once, even offline, and the older copy stays when the server is silent. It has TWO floors under it, so the page never waits on a network:
//   1. the copy on disk (the last valid answer of the server);
//   2. `templates-fallback.json`, shipped next to this file: the same catalogue as text, with no picture (AGENTS rule 4). The page draws its type tile where a picture is not there yet.
// Nothing but the public catalogue and its pictures is written, and no token, account or path of the person is ever sent. Pure of the plugin host: `index.js` gives it the folder,
// the server's address and the routes. Every answer of the server is checked again as if it came from outside; every failure is a miss, never a throw.
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SHELF_SCHEMA = 'kybernos.templates/1'
export const SHELF_CATALOGUE_PATH = '/v1/templates/catalogue.json'
/** The pictures sit next to the catalogue, under `imageBase`. */
export const SHELF_IMAGE_BASE = 'shelf/'
const SERVER_BASE_PATH = '/v1/templates/'

const DAY_MS = 24 * 60 * 60 * 1000
/** The first load waits a little after the start (DSH is not slowed down), then a check every hour says whether a day has passed. */
export const SHELF_FIRST_LOAD_MS = 20000
export const SHELF_CHECK_EVERY_MS = 60 * 60 * 1000
/** A server that has no catalogue yet (404) or does not answer is asked again this far away, not at every check. */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000
const TIMEOUT_MS = 8000
const CATALOGUE_MAX = 512 * 1024
const CARD_MAX = 300 * 1024
const LARGE_MAX = 900 * 1024
/** The load asks a few pictures at once and at most about 6 a second. */
const LOAD_PACE = Object.freeze({ batch: 3, everyMs: 500 })

const TYPES_MAX = 40
const TEMPLATES_MAX = 600
const ID = /^[a-z0-9][a-z0-9_]{0,63}$/
const KIT = /^[a-z0-9][a-z0-9-]{0,39}$/
const IMAGE = /^(?:large\/)?[a-z0-9][a-z0-9_-]{0,63}\.webp$/
const KINDS = ['template', 'start']
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/

const obj = (v) => (v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v) ? v : null)
/** A short plain text: control characters and the line separators out, clipped. */
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, max) : '')
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null)

/** A picture name the catalogue may carry: `<id>.webp` or `large/<id>.webp`, nothing that climbs out of the folder. */
export const shelfImageName = (v) => (typeof v === 'string' && IMAGE.test(v) ? v : '')

const cleanImage = (v) => {
  const i = obj(v)
  if (i === null) return null
  const src = shelfImageName(i.src)
  if (src === '' || src.startsWith('large/')) return null
  const out = { src, width: int(i.width, 16, 4096) || 720, height: int(i.height, 16, 4096) || 450, alt: text(i.alt, 160) }
  const large = shelfImageName(i.large)
  if (large.startsWith('large/')) { out.large = large; out.largeWidth = int(i.largeWidth, 16, 4096) || 1280; out.largeHeight = int(i.largeHeight, 16, 4096) || 800 }
  return out
}

/** How a generated example was made, so the person can reproduce or remix it: the model (its id, as the provider names it, and an optional display name),
 *  and the knobs that were set. The prompt itself is the example's `prompt`. null (the example stays, with no « made with » line) when the model is not a plain id. */
const cleanMade = (v) => {
  const m = obj(v)
  if (m === null || typeof m.model !== 'string' || !MODEL.test(m.model)) return null
  const out = { model: m.model }
  const label = text(m.label, 40)
  if (label !== '') out.label = label
  const seed = int(m.seed, 0, 4294967295)
  if (seed !== null) out.seed = seed
  const width = int(m.width, 16, 8192)
  const height = int(m.height, 16, 8192)
  if (width !== null && height !== null) { out.width = width; out.height = height }
  const steps = int(m.steps, 1, 200)
  if (steps !== null) out.steps = steps
  return out
}

const cleanTemplate = (t, typeIds) => {
  const e = obj(t)
  if (e === null || typeof e.id !== 'string' || !ID.test(e.id) || typeof e.type !== 'string' || typeIds.indexOf(e.type) < 0) return null
  const out = { id: e.id, type: e.type, name: text(e.name, 80), tag: text(e.tag, 24), line: text(e.line, 200), meta: text(e.meta, 60), prompt: text(e.prompt, 700) }
  if (out.name === '' || out.prompt === '') return null
  if (e.kind !== undefined) { if (KINDS.indexOf(e.kind) < 0) return null; out.kind = e.kind }
  if (e.shelf !== undefined) out.shelf = text(e.shelf, 4)
  if (e.kit !== undefined) { if (typeof e.kit !== 'string' || !KIT.test(e.kit)) return null; out.kit = e.kit }
  const image = cleanImage(e.image)
  if (image !== null) out.image = image
  const made = cleanMade(e.made)
  if (made !== null) out.made = made
  if (Array.isArray(e.tables)) {
    const tables = e.tables.slice(0, 12).map((x) => text(x, 30)).filter((x) => x !== '')
    if (tables.length > 0) {
      out.tables = tables
      out.links = (Array.isArray(e.links) ? e.links : []).slice(0, 30).filter((l) => Array.isArray(l) && l.length === 2 && int(l[0], 0, tables.length - 1) !== null && int(l[1], 0, tables.length - 1) !== null).map((l) => [l[0], l[1]])
      if (Array.isArray(e.layout)) {
        const rows = e.layout.slice(0, 4).map((r) => (Array.isArray(r) ? r.slice(0, 8).filter((n) => int(n, 0, tables.length - 1) !== null) : []))
        if (rows.every((r) => r.length > 0)) out.layout = rows
      }
    }
  }
  if (Array.isArray(e.inside)) {
    const inside = e.inside.slice(0, 8).map((x) => ({ t: text(obj(x) === null ? '' : x.t, 60), d: text(obj(x) === null ? '' : x.d, 200) })).filter((x) => x.t !== '')
    if (inside.length > 0) out.inside = inside
  }
  return out
}

/** The catalogue as the page may read it, or null: the schema, the types and templates of a known shape, strings clipped, ids unique. Unknown keys are dropped. */
export const shelfValidate = (raw) => {
  const c = obj(raw)
  if (c === null || c.schema !== SHELF_SCHEMA || !Number.isInteger(c.version) || c.version < 1) return null
  if (!Array.isArray(c.types) || c.types.length < 1 || c.types.length > TYPES_MAX || !Array.isArray(c.templates) || c.templates.length < 1 || c.templates.length > TEMPLATES_MAX) return null
  const types = []
  for (const t of c.types) {
    const x = obj(t)
    if (x === null || typeof x.id !== 'string' || !ID.test(x.id) || types.some((y) => y.id === x.id)) return null
    types.push({ id: x.id, name: text(x.name, 40), group: text(x.group, 40), blurb: text(x.blurb, 160) })
  }
  const typeIds = types.map((t) => t.id)
  const seen = new Set()
  const templates = []
  for (const t of c.templates) {
    const e = cleanTemplate(t, typeIds)
    if (e === null || seen.has(e.id)) continue   // one bad entry never costs the others
    seen.add(e.id)
    templates.push(e)
  }
  if (templates.length === 0) return null
  return {
    schema: SHELF_SCHEMA, version: c.version, updatedAt: text(c.updatedAt, 32), locale: text(c.locale, 16) || 'en', imageBase: SHELF_IMAGE_BASE,
    groups: (Array.isArray(c.groups) ? c.groups : []).slice(0, 8).map((g) => text(g, 40)).filter((g) => g !== ''), types, templates,
  }
}

const isWebp = (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'

/** The server's address, as the one this module may ask: https, or http on the loopback (tests, a local server). Else null. */
const originOf = (api) => {
  try {
    const u = new URL(String(api))
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.origin
  } catch (e) { /* not an address */ }
  return null
}

const here = dirname(fileURLToPath(import.meta.url))
let bundled
/** The catalogue shipped as text (no picture): the floor the page never falls below. null only if the file itself is broken, which a test pins. */
export const shelfBundled = () => {
  if (bundled === undefined) {
    try { bundled = shelfValidate(JSON.parse(readFileSync(join(here, 'templates-fallback.json'), 'utf8'))) } catch (e) { bundled = null }
  }
  return bundled
}

/**
 * createShelf({ dir, api, fetchFn, now, pace, log })
 *   dir()     → the folder where the public catalogue and its pictures are kept, or null for memory only (tests)
 *   api()     → the server's address (`https://server.kybernos.app`), or '' when none is known
 *   fetchFn   → fetch (a test gives its own)
 */
export const createShelf = ({ dir = () => null, api = () => '', fetchFn = globalThis.fetch, now = () => Date.now(), pace = LOAD_PACE, log = () => {} } = {}) => {
  let kept = null            // { at, catalogue } — the last valid answer, from disk or from the server
  let keptMtime = -1
  const pics = new Set()     // the pictures on disk: 'a.webp', 'large/a.webp'
  const inflight = new Map()
  let retryAt = 0
  let loading = null

  const root = () => { try { const d = dir(); return typeof d === 'string' && d !== '' ? d : null } catch (e) { return null } }
  const writeAtomic = async (file, data) => {
    const tmp = file + '.' + process.pid + '.tmp'
    await writeFile(tmp, data)
    await rename(tmp, file)
  }
  const mtimeOf = (file) => { try { return statSync(file).mtimeMs } catch (e) { return -1 } }

  /** The disk copy, read again only when the file changed. */
  const readKept = async () => {
    const r = root()
    if (r === null) return kept
    const file = join(r, 'catalogue.json')
    const m = mtimeOf(file)
    if (m < 0) { kept = null; keptMtime = -1; return null }
    if (m === keptMtime) return kept
    try {
      const c = shelfValidate(JSON.parse(await readFile(file, 'utf8')))
      kept = c === null ? null : { at: m, catalogue: c }
    } catch (e) { kept = null }
    keptMtime = m
    return kept
  }
  const scan = async () => {
    const r = root()
    if (r === null) return
    for (const sub of ['', 'large']) {
      try { for (const f of await readdir(join(r, 'shelf', sub))) { const name = (sub === '' ? '' : sub + '/') + f; if (shelfImageName(name) !== '') pics.add(name) } } catch (e) { /* none yet */ }
    }
  }
  let scanned = false

  /** What the page reads: the best catalogue there is, each picture marked `ready` once its file is here. `source` says where it came from. */
  const catalogue = async () => {
    if (scanned !== true) { scanned = true; await scan() }
    const k = await readKept()
    const base = k !== null ? k.catalogue : shelfBundled()
    if (base === null) return null
    const templates = base.templates.map((t) => {
      if (t.image === undefined) return t
      const image = Object.assign({}, t.image, { ready: pics.has(t.image.src) })
      if (image.large !== undefined) image.readyLarge = pics.has(image.large)
      return Object.assign({}, t, { image })
    })
    return Object.assign({}, base, { templates, source: k !== null ? 'server' : 'bundled', loadedAt: k !== null ? k.at : 0 })
  }

  const get = async (url, max, accept) => {
    if (typeof fetchFn !== 'function') return { status: 0, body: null }
    try {
      const res = await fetchFn(url, { redirect: 'manual', headers: { accept }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res === null || res === undefined) return { status: 0, body: null }
      if (res.status !== 200) return { status: res.status, body: null }
      const len = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : 0)
      if (Number.isFinite(len) && len > max) return { status: 200, body: null }
      const body = Buffer.from(await res.arrayBuffer())
      return { status: 200, body: body.length > max ? null : body }
    } catch (e) { return { status: 0, body: null } }
  }
  const serverUrl = (rel) => {
    let a = ''
    try { a = api() } catch (e) { a = '' }
    const o = originOf(a)
    return o === null ? null : o + SERVER_BASE_PATH + rel
  }

  /** One picture: from the disk, else from the server (and kept). null when it is not there. A name outside the shape is never asked for. */
  const image = async (name) => {
    const rel = shelfImageName(name)
    if (rel === '') return null
    const r = root()
    if (r !== null && pics.has(rel)) {
      try { return await readFile(join(r, 'shelf', rel)) } catch (e) { pics.delete(rel) }
    }
    if (inflight.has(rel)) return inflight.get(rel)
    const job = (async () => {
      const url = serverUrl(SHELF_IMAGE_BASE + rel)
      if (url === null) return null
      const got = await get(url, rel.startsWith('large/') ? LARGE_MAX : CARD_MAX, 'image/webp')
      if (got.body === null || !isWebp(got.body)) return null
      if (r !== null) {
        try {
          await mkdir(join(r, 'shelf', 'large'), { recursive: true })
          await writeAtomic(join(r, 'shelf', rel), got.body)
          pics.add(rel)
        } catch (e) { /* served from memory this time */ }
      }
      return got.body
    })().finally(() => { inflight.delete(rel) })
    inflight.set(rel, job)
    return job
  }

  const due = async () => {
    if (now() < retryAt) return false
    const k = await readKept()
    return k === null || now() - k.at >= DAY_MS
  }

  const wait = (ms) => (ms > 0 ? new Promise((resolve) => { setTimeout(resolve, ms) }) : Promise.resolve())
  const loadImages = async (c) => {
    if (scanned !== true) { scanned = true; await scan() }
    const want = c.templates.filter((t) => t.image !== undefined && !pics.has(t.image.src)).map((t) => t.image.src)
    let fetched = 0
    let failedBatches = 0
    for (let i = 0; i < want.length; i += pace.batch) {
      const batch = want.slice(i, i + pace.batch)
      const done = await Promise.all(batch.map((n) => image(n).then((b) => b !== null).catch(() => false)))
      fetched += done.filter(Boolean).length
      failedBatches = done.some(Boolean) ? 0 : failedBatches + 1
      if (failedBatches >= 3) { retryAt = now() + RETRY_AFTER_MS; break }
      await wait(pace.everyMs)
    }
    return fetched
  }

  /** Ask the server for the catalogue (when a day old, or `force`), keep it, then the pictures this copy is missing. Never throws. */
  const load = async ({ force = false } = {}) => {
    if (loading !== null) return loading
    loading = (async () => {
      try {
        if (force !== true && (await due()) !== true) return { ok: true, skipped: true }
        const url = serverUrl('catalogue.json')
        if (url === null) return { ok: false, error: 'no_server' }
        const got = await get(url, CATALOGUE_MAX, 'application/json')
        let c = null
        try { c = got.body === null ? null : shelfValidate(JSON.parse(got.body.toString('utf8'))) } catch (e) { c = null }
        if (c === null) { retryAt = now() + RETRY_AFTER_MS; return { ok: false, error: got.status === 404 ? 'not_published' : (got.status === 0 ? 'network' : 'unreadable') } }
        const r = root()
        if (r !== null) {
          try {
            await mkdir(join(r, 'shelf', 'large'), { recursive: true })
            await writeAtomic(join(r, 'catalogue.json'), JSON.stringify(c))
            keptMtime = -1
          } catch (e) { log('templates catalogue not kept: ' + String((e && e.message) || e)) }
        }
        kept = { at: now(), catalogue: c }
        const images = await loadImages(c)
        return { ok: true, version: c.version, templates: c.templates.length, images }
      } catch (e) {
        retryAt = now() + RETRY_AFTER_MS
        return { ok: false, error: 'failed' }
      }
    })().finally(() => { loading = null })
    return loading
  }

  /** The background cycle: a first load a little after the start, then an hourly look at whether a day has passed. Returns what stops it. */
  const start = ({ firstMs = SHELF_FIRST_LOAD_MS, everyMs = SHELF_CHECK_EVERY_MS } = {}) => {
    const first = setTimeout(() => { load() }, firstMs)
    const hourly = setInterval(() => { load() }, everyMs)
    if (typeof first.unref === 'function') first.unref()
    if (typeof hourly.unref === 'function') hourly.unref()
    return () => { clearTimeout(first); clearInterval(hourly) }
  }

  return { catalogue, image, load, due, start }
}
