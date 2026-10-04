// On-disk store for interface translations: ~/.dsh/kybernos/i18n/<lang>.json
//
// Translating an interface costs minutes of model time and real money, so the
// result lives on the user's disk, next to the rest of ~/.dsh, not only in one
// browser's localStorage. The browser keeps a copy (first paint must stay
// synchronous); this store is the copy that survives clearing site data, a new
// browser profile, another browser, and is the one to back up.
//
// One file per language:
//   { version, id, label, kb: {key: text}, dsh: {"ns::key": text},
//     live: {fr text: text}, meta: {...}, updatedAt }
// `kb` is the Kybernos dictionary, `dsh` DSH's own namespaces, `live` the texts
// learned while browsing (see kybernos-language). `meta` is the progress record
// the Language page shows (done / total / complete / at).
//
// Removing a language leaves a tombstone (`.removed.json`, id -> time): a browser
// that still has an older copy sees it and drops its copy instead of pushing the
// language back. Writing the language again clears the tombstone.
//
// Pure node:fs, no DSH service: unit-testable on a temp folder.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const STORE_VERSION = 1
// Same shape as the Language page's ids (ISO 639-1, optional region), length-capped:
// the id becomes a file name, so nothing else may get through.
export const STORE_ID = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})?$/
export const SECTIONS = ['kb', 'dsh', 'live']
export const LIMITS = { key: 300, value: 6000, label: 80, meta: 4000, packBytes: 24 * 1024 * 1024 }
const TOMBSTONES = '.removed.json'
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype']

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const dictOf = (v) => { const d = Object.create(null); if (plain(v)) for (const k of Object.keys(v)) d[k] = v[k]; return d }
const sizeOf = (d) => Object.keys(d).length

/** @param {{ dir: string, now?: () => number }} opts */
export function createI18nStore(opts) {
  const dir = opts.dir
  const now = opts.now || (() => Date.now())
  const fileOf = (id) => join(dir, id + '.json')

  const readTombstones = () => {
    try { const t = JSON.parse(readFileSync(join(dir, TOMBSTONES), 'utf8')); return plain(t) ? t : {} } catch (e) { return {} }
  }
  const writeText = (file, text) => {
    mkdirSync(dir, { recursive: true })
    const tmp = file + '.tmp'
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, file) // atomic: a reader never sees half a file
  }

  /** The pack, or null when absent. A damaged file is set aside (.bad-<time>) and counts as absent. */
  const read = (id) => {
    if (typeof id !== 'string' || !STORE_ID.test(id)) return null
    const file = fileOf(id)
    if (!existsSync(file)) return null
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      if (!plain(raw)) throw new Error('not an object')
      return {
        version: STORE_VERSION,
        id,
        label: typeof raw.label === 'string' ? raw.label : '',
        kb: dictOf(raw.kb),
        dsh: dictOf(raw.dsh),
        live: dictOf(raw.live),
        meta: plain(raw.meta) ? raw.meta : {},
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
      }
    } catch (e) {
      try { renameSync(file, file + '.bad-' + now()) } catch (e2) { /* already gone */ }
      return null
    }
  }

  const summary = (pack, bytes) => ({
    id: pack.id,
    label: pack.label,
    meta: pack.meta,
    counts: { kb: sizeOf(pack.kb), dsh: sizeOf(pack.dsh), live: sizeOf(pack.live) },
    bytes,
    updatedAt: pack.updatedAt,
  })

  /** One summary per stored language, without the strings (cheap to poll). */
  const list = () => {
    let names = []
    try { names = readdirSync(dir) } catch (e) { return [] }
    const out = []
    for (const name of names.sort()) {
      const m = /^(.+)\.json$/.exec(name)
      if (m === null || !STORE_ID.test(m[1])) continue
      const pack = read(m[1])
      if (pack === null) continue
      let bytes = 0
      try { bytes = readFileSync(fileOf(m[1])).length } catch (e) { /* raced with a removal */ }
      out.push(summary(pack, bytes))
    }
    return out
  }

  /**
   * Merge `patch` into the pack (creating it). `kb` / `dsh` / `live` are merged key
   * by key; with `replace: true` a section that is present REPLACES the stored one
   * (the way to take a text away). `label` and `meta` replace. Entries that are not
   * short strings are refused and counted, never stored.
   */
  const write = (id, patch) => {
    if (typeof id !== 'string' || !STORE_ID.test(id)) return { ok: false, error: 'invalid language id' }
    if (!plain(patch)) return { ok: false, error: 'invalid body' }
    const pack = read(id) || { version: STORE_VERSION, id, label: '', kb: dictOf(null), dsh: dictOf(null), live: dictOf(null), meta: {}, updatedAt: '' }
    let rejected = 0
    for (const sec of SECTIONS) {
      if (patch[sec] === undefined) continue
      if (!plain(patch[sec])) { rejected += 1; continue }
      if (patch.replace === true) pack[sec] = dictOf(null)
      for (const k of Object.keys(patch[sec])) {
        const v = patch[sec][k]
        if (k === '' || k.length > LIMITS.key || FORBIDDEN_KEYS.indexOf(k) >= 0 || typeof v !== 'string' || v.length > LIMITS.value) { rejected += 1; continue }
        pack[sec][k] = v
      }
    }
    if (typeof patch.label === 'string') pack.label = patch.label.slice(0, LIMITS.label)
    if (patch.meta !== undefined) {
      if (plain(patch.meta) && JSON.stringify(patch.meta).length <= LIMITS.meta) pack.meta = patch.meta
      else rejected += 1
    }
    pack.updatedAt = new Date(now()).toISOString()
    const text = JSON.stringify(pack)
    if (text.length > LIMITS.packBytes) return { ok: false, error: 'pack too large' }
    try {
      writeText(fileOf(id), text)
      const t = readTombstones()
      if (t[id] !== undefined) { delete t[id]; writeText(join(dir, TOMBSTONES), JSON.stringify(t)) }
    } catch (e) { return { ok: false, error: 'could not write: ' + (e && e.message ? e.message : String(e)) } }
    return Object.assign({ ok: true, rejected }, summary(pack, text.length))
  }

  /** Delete the language and remember it was removed on purpose. Idempotent. */
  const remove = (id) => {
    if (typeof id !== 'string' || !STORE_ID.test(id)) return { ok: false, error: 'invalid language id' }
    try {
      rmSync(fileOf(id), { force: true })
      const t = readTombstones()
      t[id] = now()
      writeText(join(dir, TOMBSTONES), JSON.stringify(t))
    } catch (e) { return { ok: false, error: 'could not remove: ' + (e && e.message ? e.message : String(e)) } }
    return { ok: true }
  }

  return { dir, read, list, write, remove, removed: readTombstones }
}

/**
 * The whole request logic, minus the origin check (the route does that):
 *   GET            -> { ok, dir, packs: [summary], removed: { id: time } }
 *   GET ?id=ar     -> { ok, pack } or 404
 *   POST { id, ...patch }          -> merge   (see write)
 *   POST { id, remove: true }      -> delete
 * Returns { status, body }.
 */
export function handleI18nStore(store, req) {
  if (req.method === 'GET') {
    if (typeof req.id !== 'string' || req.id === '') return { status: 200, body: { ok: true, dir: store.dir, packs: store.list(), removed: store.removed() } }
    const pack = store.read(req.id)
    if (pack === null) return { status: 404, body: { ok: false, error: 'no such language' } }
    return { status: 200, body: { ok: true, pack } }
  }
  if (req.method === 'POST') {
    const body = req.body
    if (!plain(body)) return { status: 400, body: { ok: false, error: 'invalid body' } }
    const res = body.remove === true ? store.remove(body.id) : store.write(body.id, body)
    return { status: res.ok === true ? 200 : 400, body: res }
  }
  return { status: 405, body: { ok: false, error: 'GET or POST expected' } }
}

export const MAX_BODY_BYTES = 8 * 1024 * 1024

/**
 * The route itself, with the host's helpers handed in (`io`) so it can be tested
 * without the host: origin guard (strict for writes, lax for reads, like the other
 * Kybernos routes), the DSH home, the bounded body, then handleI18nStore.
 * io = { home: () => Promise<string|null>, sameOriginStrict(req), sameOriginLax(req),
 *        readJson(req, maxBytes), query(req) -> URLSearchParams, send(res, status, body) }
 */
export async function serveI18nStore(req, res, io) {
  if (req.method !== 'GET' && req.method !== 'POST') return io.send(res, 405, { ok: false, error: 'GET or POST expected' })
  if ((req.method === 'POST' ? io.sameOriginStrict(req) : io.sameOriginLax(req)) === false) return io.send(res, 403, { ok: false, error: 'origin refused' })
  try {
    const home = await io.home()
    if (home === null || home === undefined || home === '') return io.send(res, 200, { ok: false, error: 'DSH home not found' })
    let body = null
    if (req.method === 'POST') {
      try { body = await io.readJson(req, MAX_BODY_BYTES) } catch (e) { return io.send(res, 413, { ok: false, error: 'request body too large' }) }
    }
    const out = handleI18nStore(createI18nStore({ dir: join(home, 'kybernos', 'i18n') }), { method: req.method, id: io.query(req).get('id'), body })
    return io.send(res, out.status, out.body)
  } catch (e) {
    // The page treats any non-ok answer as "no disk copy": never let a host fault escape the route.
    return io.send(res, 500, { ok: false, error: 'i18n store failed: ' + (e && e.message ? e.message : String(e)) })
  }
}
