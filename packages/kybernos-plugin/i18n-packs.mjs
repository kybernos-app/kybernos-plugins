// Ready-made translations of the interface: signed language packs, so a language the project has already translated and
// reviewed does not have to be translated again on every machine.
//
// What is published (the `catalog/languages/` folder of the open-core repo, read from `main`):
//   · languages.catalog.json       the INDEX: which packs exist, each with its SHA-256 and size, signed by
//   · languages.catalog.json.sig   an Ed25519 signature over the exact bytes of the index (key: languages-pubkey.json);
//   · <lang>.pack.json             one pack per language: { kb, dsh, src } = the translated texts and, for each, the hash of
//                                  the SOURCE text it was made from. Not signed on its own: the signed index carries its hash.
//
// The chain of trust is the Suite's (packages/kybernos-hub/catalogue-distant.mjs): the key embedded in this bundle verifies the
// index; the index verifies each pack by its hash and size; nothing of a pack is parsed before its hash matches; an index that is
// unsigned, signed by a key nobody trusts, malformed, or OLDER than the one already known (a replay) is refused.
//
// What installing a pack does to a language: it FILLS what the store lacks (a text with no translation, or only a test mark) and
// records each text's source hash. It never replaces a translation that is already there: the person's own run, or an earlier
// pack, stands. What the pack does not cover (a text added since, a source that changed) is what the translation job is for.
//
// Pure but for the disk cache and the network, both injected (fetch, clock): tested on a local server and a temp folder
// (test-i18n-packs.mjs). The bundle holds no key until the maintainer generates one: then the network is never asked.
import { createHash, createPublicKey, verify } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_ID } from './i18n-store.mjs'

export const KIND_INDEX = 'kybernos-language-packs'
export const KIND_PACK = 'kybernos-language-pack'
export const SCHEMA = 1
export const MAX_INDEX_BYTES = 256 * 1024
export const MAX_PACK_BYTES = 6 * 1024 * 1024
export const MAX_PACKS = 200
export const MAX_SIGNATURE_BYTES = 4096
export const FETCH_TIMEOUT_MS = 15000
/** Where `main` of the open-core repo publishes them; the setting `languagePacksUrl` (the folder) overrides it, '' turns it off. */
export const DEFAULT_BASE = 'https://raw.githubusercontent.com/kybernos-app/kybernos-plugins/main/catalog/languages/'
export const INDEX_FILE = 'languages.catalog.json'
export const CACHE_DIR = 'language-packs'
export const RESERVED = ['en', 'kybernos']
const FILE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{1,8})?\.pack\.json$/
const SHA256 = /^[0-9a-f]{64}$/
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]']
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype']

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (error, detail) => (detail === undefined ? { ok: false, error } : { ok: false, error, detail })
const coded = (code, message) => Object.assign(new Error(message === undefined ? code : message), { code })
const errText = (e) => (e && e.message ? e.message : String(e))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** The shape of an index. { ok, doc } with a clean copy, or { ok:false, error, detail? }. */
export function sanitizeIndex(doc) {
  if (!plain(doc)) return fail('not-an-object')
  if (doc.schema !== SCHEMA) return fail('schema')
  if (doc.kind !== KIND_INDEX) return fail('kind')
  if (typeof doc.publishedAt !== 'string' || doc.publishedAt.length > 40 || Number.isNaN(Date.parse(doc.publishedAt))) return fail('publishedAt')
  if (!Number.isInteger(doc.seq) || doc.seq < 0 || doc.seq > 1000000000) return fail('seq')
  if (!Array.isArray(doc.packs) || doc.packs.length > MAX_PACKS) return fail('packs')
  const seen = new Set()
  const packs = []
  for (const p of doc.packs) {
    if (!plain(p) || typeof p.lang !== 'string' || !STORE_ID.test(p.lang) || RESERVED.indexOf(p.lang) >= 0) return fail('pack', 'invalid language id')
    if (seen.has(p.lang)) return fail('pack', 'duplicate ' + p.lang)
    seen.add(p.lang)
    if (typeof p.file !== 'string' || !FILE_RE.test(p.file) || p.file !== p.lang + '.pack.json') return fail('pack', p.lang + ': invalid file')
    if (typeof p.sha256 !== 'string' || !SHA256.test(p.sha256)) return fail('pack', p.lang + ': invalid sha256')
    if (!Number.isInteger(p.size) || p.size < 2 || p.size > MAX_PACK_BYTES) return fail('pack', p.lang + ': invalid size')
    if (!Number.isInteger(p.seq) || p.seq < 0) return fail('pack', p.lang + ': invalid seq')
    const label = typeof p.label === 'string' ? p.label.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) : ''
    const counts = plain(p.counts) ? { kb: Number.isInteger(p.counts.kb) ? p.counts.kb : 0, dsh: Number.isInteger(p.counts.dsh) ? p.counts.dsh : 0 } : { kb: 0, dsh: 0 }
    packs.push({ lang: p.lang, label, file: p.file, sha256: p.sha256, size: p.size, seq: p.seq, counts, reviewed: p.reviewed === true })
  }
  packs.sort((a, b) => (a.lang < b.lang ? -1 : 1))
  return { ok: true, doc: { schema: SCHEMA, kind: KIND_INDEX, publishedAt: doc.publishedAt, seq: doc.seq, packs } }
}

/** The shape of a pack. { ok, pack } with a clean copy, or { ok:false, error }. A text is a short string; a key is short and not a prototype name. */
export function sanitizePack(doc, expected) {
  if (!plain(doc)) return fail('not-an-object')
  if (doc.schema !== SCHEMA || doc.kind !== KIND_PACK) return fail('kind')
  if (typeof doc.lang !== 'string' || !STORE_ID.test(doc.lang) || RESERVED.indexOf(doc.lang) >= 0) return fail('lang')
  if (expected !== undefined && doc.lang !== expected.lang) return fail('lang', 'the pack is for ' + doc.lang + ', the index says ' + expected.lang)
  if (expected !== undefined && doc.seq !== expected.seq) return fail('seq', 'the pack is seq ' + doc.seq + ', the index says ' + expected.seq)
  const out = { schema: SCHEMA, kind: KIND_PACK, lang: doc.lang, seq: doc.seq, label: typeof doc.label === 'string' ? doc.label.slice(0, 80) : '', kb: Object.create(null), dsh: Object.create(null), src: Object.create(null) }
  let n = 0
  for (const sec of ['kb', 'dsh']) {
    if (!plain(doc[sec])) return fail(sec)
    for (const k of Object.keys(doc[sec])) {
      const v = doc[sec][k]
      if (k === '' || k.length > 300 || FORBIDDEN_KEYS.indexOf(k) >= 0 || typeof v !== 'string' || v === '' || v.length > 6000) return fail(sec, 'invalid entry ' + k.slice(0, 40))
      out[sec][k] = v
      n += 1
    }
  }
  if (n === 0) return fail('empty')
  if (doc.src !== undefined) {
    if (!plain(doc.src)) return fail('src')
    for (const k of Object.keys(doc.src)) {
      const v = doc.src[k]
      if (FORBIDDEN_KEYS.indexOf(k) >= 0 || k.length > 320 || typeof v !== 'string' || !/^[0-9a-f]{8}$/.test(v)) continue
      out.src[k] = v
    }
  }
  return { ok: true, pack: out }
}

/** Does `signature` (base64) sign exactly `bytes` under one of the trusted keys ({ keyId, pem })? The key id, or null. */
export function verifySignature({ bytes, signature, keys }) {
  const sig = Buffer.from(String(signature === undefined || signature === null ? '' : signature).trim(), 'base64')
  if (sig.length !== 64) return null
  for (const k of Array.isArray(keys) ? keys : []) {
    try { if (verify(null, bytes, createPublicKey(k.pem), sig)) return String(k.keyId === undefined ? '' : k.keyId) } catch (e) { /* a key that does not parse verifies nothing */ }
  }
  return null
}

/** The verdict on a downloaded index: signature first, then shape, then age (`floor` = { seq } already known). */
export function evaluateIndex({ bytes, signature, keys, floor }) {
  if (!Array.isArray(keys) || keys.length === 0) return fail('no-key')
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_INDEX_BYTES) return fail('size')
  const key = verifySignature({ bytes, signature, keys })
  if (key === null) return fail('signature')
  let doc
  try { doc = JSON.parse(bytes.toString('utf8')) } catch (e) { return fail('json') }
  const v = sanitizeIndex(doc)
  if (v.ok !== true) return v
  if (floor !== undefined && floor !== null && v.doc.seq < floor.seq) return fail('older', 'seq ' + v.doc.seq + ' < ' + floor.seq)
  return { ok: true, doc: v.doc, key }
}

/** One pack's bytes against the signed index: size and hash first, then JSON, then shape. { ok, pack } or { ok:false, error }. */
export function evaluatePack({ bytes, entry }) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_PACK_BYTES) return fail('size')
  if (bytes.length !== entry.size) return fail('size', bytes.length + ' bytes, the index says ' + entry.size)
  if (sha256(bytes) !== entry.sha256) return fail('hash')
  let doc
  try { doc = JSON.parse(bytes.toString('utf8')) } catch (e) { return fail('json') }
  return sanitizePack(doc, { lang: entry.lang, seq: entry.seq })
}

const isTestMark = (v) => typeof v === 'string' && v.length > 2 && v.charAt(0) === '⟦' && v.charAt(v.length - 1) === '⟧'
const holds = (v) => typeof v === 'string' && v !== '' && !isTestMark(v)

/**
 * Fill the store's language with a pack: what is missing (or a test mark) is written, what is there stands.
 * @returns {{ ok: true, added: number, kept: number, total: number } | { ok: false, error: string }}
 */
export function applyPack(store, pack, now) {
  const have = store.read(pack.lang)
  const patch = { kb: {}, dsh: {}, src: {} }
  let added = 0
  let kept = 0
  for (const [sec, prefix] of [['kb', 'kb:'], ['dsh', 'dsh:']]) {
    for (const k of Object.keys(pack[sec])) {
      const present = have !== null && holds(have[sec][k])
      if (present) { kept += 1; continue }
      patch[sec][k] = pack[sec][k]
      if (pack.src[prefix + k] !== undefined) patch.src[prefix + k] = pack.src[prefix + k]
      added += 1
    }
  }
  const total = Object.keys(pack.kb).length + Object.keys(pack.dsh).length
  if (added === 0) return { ok: true, added, kept, total }
  const body = { kb: patch.kb, dsh: patch.dsh, src: patch.src }
  if (have === null || have.label === '') body.label = pack.label
  // The page's bilan: the browser takes the host's copy when this stamp is the newer one.
  body.meta = Object.assign({}, have !== null && plain(have.meta) ? have.meta : {}, { at: now(), fromPack: pack.seq })
  const w = store.write(pack.lang, body)
  if (w.ok !== true) return { ok: false, error: String(w.error) }
  return { ok: true, added, kept, total }
}

// ── the disk and the network ──────────────────────────────────────────────────────────────────────────────────────────

/** May this URL be asked for? https, or http on a loopback address; no user name or password. */
export function urlAllowed(raw) {
  let u
  try { u = new URL(raw) } catch (e) { return false }
  if (u.username !== '' || u.password !== '') return false
  if (u.protocol === 'https:') return true
  return u.protocol === 'http:' && LOOPBACK.indexOf(u.hostname) >= 0
}

/** The setting `languagePacksUrl` of <dsh home>/kybernos/settings.json: '' = off, a string = that folder, else the default. */
export function readBase(dir) {
  try {
    const v = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).languagePacksUrl
    if (typeof v === 'string') return v.trim() === '' ? '' : (v.trim().endsWith('/') ? v.trim() : v.trim() + '/')
  } catch (e) { /* no settings file, or a damaged one: the default */ }
  return DEFAULT_BASE
}

/** A document, in memory, never more than `max` bytes. */
export async function download(fetchImpl, url, max, timeoutMs = FETCH_TIMEOUT_MS) {
  if (!urlAllowed(url)) throw coded('url', 'url not allowed')
  const rep = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { accept: '*/*' } })
  if (!rep.ok) throw coded('http', 'HTTP ' + String(rep.status))
  if (typeof rep.url === 'string' && rep.url !== '' && !urlAllowed(rep.url)) throw coded('url', 'redirect to a url that is not allowed')
  if (rep.body === null || rep.body === undefined) throw coded('empty')
  const chunks = []
  let n = 0
  const reader = rep.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.length
    if (n > max) { try { await reader.cancel() } catch (e) { /* closing anyway */ } throw coded('too-large') }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/** The public keys this bundle trusts for the index: [{ keyId, pem }]. Empty = the network is never asked. */
export function loadKeys(file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(j.keys) ? j.keys.filter((k) => k !== null && typeof k === 'object' && typeof k.pem === 'string') : []
  } catch (e) { return [] }
}

/**
 * One set of packs over one folder (`dir` = <dsh home>/kybernos), writing into `store`.
 * @param {{ dir: string, store: object, keys: object[], base?: string | (() => string), fetchImpl?: Function, now?: () => number }} o
 */
export function createPacks(o) {
  const cacheDir = join(o.dir, CACHE_DIR)
  const docFile = join(cacheDir, INDEX_FILE)
  const sigFile = join(cacheDir, INDEX_FILE + '.sig')
  const now = o.now || (() => Date.now())
  const fetchImpl = o.fetchImpl || ((...a) => fetch(...a))
  const baseNow = () => (typeof o.base === 'function' ? o.base() : (o.base === undefined ? DEFAULT_BASE : o.base))
  let last = { state: baseNow() === '' ? 'off' : 'never', at: 0, reason: null }
  let busy = false

  /** The cached index, verified AGAIN; null when there is none or it no longer verifies. */
  const cached = () => {
    try {
      const ev = evaluateIndex({ bytes: readFileSync(docFile), signature: readFileSync(sigFile, 'utf8'), keys: o.keys })
      return ev.ok === true ? ev : null
    } catch (e) { return null }
  }
  const store = (bytes, signature) => {
    mkdirSync(cacheDir, { recursive: true })
    for (const [file, data] of [[docFile, bytes], [sigFile, signature]]) {
      const tmp = file + '.tmp'
      try { writeFileSync(tmp, data); renameSync(tmp, file) } catch (e) { try { rmSync(tmp, { force: true }) } catch (e2) { /* nothing to clean */ } throw e }
    }
  }
  const snapshot = () => {
    const known = cached()
    const packs = known === null ? [] : known.doc.packs.map((p) => {
      const have = o.store.read(p.lang)
      return { lang: p.lang, label: p.label, seq: p.seq, counts: p.counts, reviewed: p.reviewed, installed: have !== null && (Object.keys(have.kb).length + Object.keys(have.dsh).length) > 0 }
    })
    return { ok: true, v: 1, online: { ...last }, seq: known === null ? 0 : known.doc.seq, publishedAt: known === null ? null : known.doc.publishedAt, packs }
  }

  return {
    snapshot,
    async refresh() {
      const base = baseNow()
      if (base === '') { last = { state: 'off', at: now(), reason: null }; return snapshot() }
      if (busy) return snapshot()
      busy = true
      try {
        if (!Array.isArray(o.keys) || o.keys.length === 0) { last = { state: 'refused', at: now(), reason: 'no-key' }; return snapshot() }
        const known = cached()
        let bytes
        let signature
        try {
          bytes = await download(fetchImpl, base + INDEX_FILE, MAX_INDEX_BYTES)
          signature = (await download(fetchImpl, base + INDEX_FILE + '.sig', MAX_SIGNATURE_BYTES)).toString('utf8')
        } catch (e) { last = { state: 'offline', at: now(), reason: e && e.code ? e.code : 'network' }; return snapshot() }
        const ev = evaluateIndex({ bytes, signature, keys: o.keys, floor: known === null ? undefined : { seq: known.doc.seq } })
        if (ev.ok !== true) { last = { state: 'refused', at: now(), reason: ev.error }; return snapshot() }
        try { store(bytes, signature) } catch (e) { last = { state: 'refused', at: now(), reason: 'cache-not-written' }; return snapshot() }
        last = { state: 'ok', at: now(), reason: null }
        return snapshot()
      } finally { busy = false }
    },
    /** Download one pack named by the verified index, check it against that index, and fill the store's language with it. */
    async install(lang) {
      if (typeof lang !== 'string' || !STORE_ID.test(lang) || RESERVED.indexOf(lang) >= 0) return fail('invalid language id')
      const base = baseNow()
      if (base === '') return fail('off')
      const known = cached()
      if (known === null) return fail('no-index')
      const entry = known.doc.packs.find((p) => p.lang === lang)
      if (entry === undefined) return fail('no-pack')
      let bytes
      try { bytes = await download(fetchImpl, base + entry.file, MAX_PACK_BYTES) } catch (e) { return fail('download', e && e.code ? e.code : errText(e)) }
      const ev = evaluatePack({ bytes, entry })
      if (ev.ok !== true) return ev
      const applied = applyPack(o.store, ev.pack, now)
      if (applied.ok !== true) return fail('write', applied.error)
      return { ok: true, lang, seq: entry.seq, added: applied.added, kept: applied.kept, total: applied.total }
    },
  }
}

// One set per folder for the life of the process (`online`, what the last refresh said, lives in memory).
const sets = new Map()
const setFor = (dir, io) => {
  let c = sets.get(dir)
  if (c === undefined) {
    c = createPacks({ dir, store: io.store(dir), keys: io.keys(), base: () => readBase(dir), fetchImpl: io.fetchImpl, now: io.now })
    sets.set(dir, c)
  }
  return c
}
export const forgetPacks = () => sets.clear()
export const MAX_BODY_BYTES = 4096

/**
 * The route, with the host's helpers handed in (`io`) so it can be tested without the host:
 *   GET                                 → the cached index: which packs exist and which are installed (never the network)
 *   POST { op: 'refresh' }              → ask the online index, verify, cache; answers like GET
 *   POST { op: 'install', lang }        → fill that language from its pack; { ok, added, kept, total }
 * io = { home(), store(dir) → i18n store over <dir>/i18n, sameOriginStrict(req), sameOriginLax(req), readJson(req, max), send(res, status, body),
 *        keys(): object[], fetchImpl?, now? }
 */
export async function servePacks(req, res, io) {
  if (req.method !== 'GET' && req.method !== 'POST') return io.send(res, 405, fail('GET or POST expected'))
  if ((req.method === 'POST' ? io.sameOriginStrict(req) : io.sameOriginLax(req)) === false) return io.send(res, 403, fail('origin refused'))
  try {
    const home = await io.home()
    if (home === null || home === undefined || home === '') return io.send(res, 200, fail('DSH home not found'))
    const set = setFor(join(home, 'kybernos'), io)
    if (req.method === 'GET') return io.send(res, 200, set.snapshot())
    let body = null
    try { body = await io.readJson(req, MAX_BODY_BYTES) } catch (e) { return io.send(res, 413, fail('request body too large')) }
    if (!plain(body) || typeof body.op !== 'string') return io.send(res, 400, fail('unknown op'))
    if (body.op === 'refresh') return io.send(res, 200, await set.refresh())
    if (body.op === 'install') {
      let r = await set.install(body.lang)
      // No index yet (never asked): ask once, then try again.
      if (r.ok !== true && r.error === 'no-index') { await set.refresh(); r = await set.install(body.lang) }
      return io.send(res, r.ok === true ? 200 : (r.error === 'invalid language id' ? 400 : 200), r)
    }
    return io.send(res, 400, fail('unknown op'))
  } catch (e) {
    return io.send(res, 500, fail('language packs failed: ' + errText(e)))
  }
}
