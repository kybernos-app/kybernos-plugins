// The disk and network half of the local-models catalogue (the rules of belief are in modeles-catalogue.mjs).
//
//   GET  /modeles-locaux/catalogue                 what to show NOW, from the disk only: the signed catalogue cached by the
//                                                  last successful refresh when it is at least as recent as the shipped
//                                                  one, else the shipped one (catalogue.json). Never touches the network.
//   POST /modeles-locaux/catalogue { op:'refresh' } asks the online catalogue, verifies it, caches it, answers like GET and
//                                                  adds `nouveaux`: the models that were not in the list shown before.
//
// The answer always carries `online`: what the last refresh said ('never' | 'ok' | 'offline' | 'refused' | 'off'), so the page
// can say why it shows the shipped list instead of staying silent.
//
// Where the catalogue is: the setting `modelesCatalogueUrl` of <dsh home>/kybernos/settings.json ('' turns it off), else
// DEFAULT_URL. https only (plain http only for a loopback address, which is how it is tested), no credentials in the URL, a
// redirect may not downgrade the transport, the document is capped at 256 KiB and the signature at 4 KB. What is cached is
// the verified bytes; they are verified AGAIN on every read, so a cache that was edited by hand, or signed by a key that has
// since been dropped, simply stops counting.
//
// Everything outside the node standard library is injected (fetch, clock), which is what makes it testable on a local server
// and a temp folder (test-modeles-distant.mjs). Same shape as packages/kybernos-theme/themes-gallery.mjs.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_URL, MAX_DOC_BYTES, effective, evaluate, readDocument } from './modeles-catalogue.mjs'

export const CACHE_DIR = 'modeles-locaux-catalogue'
export const FETCH_TIMEOUT_MS = 8000
export const MAX_SIGNATURE_BYTES = 4096
export const MAX_BODY_BYTES = 4096
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]']

const errText = (e) => (e && e.message ? e.message : String(e))
const fail = (error) => ({ ok: false, error })
const coded = (code, message) => Object.assign(new Error(message === undefined ? code : message), { code })

/** May this URL be asked for? https, or http on a loopback address; no user name or password. */
export function urlAllowed(raw) {
  let u
  try { u = new URL(raw) } catch (e) { return false }
  if (u.username !== '' || u.password !== '') return false
  if (u.protocol === 'https:') return true
  return u.protocol === 'http:' && LOOPBACK.indexOf(u.hostname) >= 0
}

/** The setting `modelesCatalogueUrl`: '' = off, a string = that URL (checked later), absent or not a string = the default. */
export function readCatalogueUrl(dir) {
  try {
    const v = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).modelesCatalogueUrl
    if (typeof v === 'string') return v.trim()
  } catch (e) { /* no settings file, or a damaged one: the default */ }
  return DEFAULT_URL
}

/** A small document, in memory, never more than `max` bytes. */
export async function download(fetchImpl, url, max, timeoutMs = FETCH_TIMEOUT_MS) {
  if (!urlAllowed(url)) throw coded('url', 'url not allowed')
  const rep = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { accept: '*/*' } })
  if (!rep.ok) throw coded('http', 'HTTP ' + String(rep.status))
  // A redirect must not downgrade the transport.
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

/** The shipped catalogue document, or an empty one when the file is missing or damaged (the page then keeps its built-in list). */
export function loadShipped(file) {
  try {
    const r = readDocument(readFileSync(file))
    if (r.ok === true) return r.doc
  } catch (e) { /* missing */ }
  return { schema: 1, kind: 'kybernos-local-models', publishedAt: '1970-01-01T00:00:00.000Z', seq: 0, models: [] }
}
/** The public keys this bundle trusts for the online catalogue: [{ keyId, pem }]. Empty = the online catalogue is never asked. */
export function loadKeys(file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(j.keys) ? j.keys.filter((k) => k !== null && typeof k === 'object' && typeof k.pem === 'string') : []
  } catch (e) { return [] }
}

/**
 * One catalogue over one folder (`dir` = <dsh home>/kybernos). `url` is read at each refresh when it is a function.
 * @param {{ dir: string, shipped: object, keys: object[], url?: string | (() => string), fetchImpl?: Function, now?: () => number }} o
 */
export function createCatalogue(o) {
  const cacheDir = join(o.dir, CACHE_DIR)
  const docFile = join(cacheDir, 'catalog.json')
  const sigFile = join(cacheDir, 'catalog.sig')
  const now = o.now || (() => Date.now())
  const fetchImpl = o.fetchImpl || ((...a) => fetch(...a))
  const urlNow = () => (typeof o.url === 'function' ? o.url() : (o.url === undefined ? DEFAULT_URL : o.url))
  let last = { state: urlNow() === '' ? 'off' : 'never', at: 0, reason: null }
  let busy = false

  /** The cached catalogue, verified again; null when there is none or it no longer verifies. */
  const cached = () => {
    try {
      const ev = evaluate({ bytes: readFileSync(docFile), signature: readFileSync(sigFile, 'utf8'), keys: o.keys })
      return ev.ok === true ? ev : null
    } catch (e) { return null }
  }
  const snapshot = () => ({ ok: true, ...effective({ shipped: o.shipped, evaluation: cached() }), online: { ...last } })
  const store = (bytes, signature) => {
    mkdirSync(cacheDir, { recursive: true })
    for (const [file, data] of [[docFile, bytes], [sigFile, signature]]) {
      const tmp = file + '.tmp'
      try { writeFileSync(tmp, data); renameSync(tmp, file) } catch (e) { try { rmSync(tmp, { force: true }) } catch (e2) { /* nothing to clean */ } throw e }
    }
  }

  return {
    snapshot,
    cacheFile: docFile,
    async refresh() {
      const before = snapshot()
      // `nouveaux`: what this refresh brought that the list shown before did not hold.
      const withNew = (after) => {
        const had = new Set(before.models.map((m) => m.id))
        return { ...after, nouveaux: after.models.filter((m) => !had.has(m.id)).map((m) => m.id), depuis: before.publishedAt }
      }
      const url = urlNow()
      if (url === '') { last = { state: 'off', at: now(), reason: null }; return withNew(snapshot()) }
      if (busy) return withNew(snapshot())
      busy = true
      try {
        if (!Array.isArray(o.keys) || o.keys.length === 0) { last = { state: 'refused', at: now(), reason: 'no-key' }; return withNew(snapshot()) }
        const known = cached()
        const floor = { seq: Math.max(o.shipped.seq, known === null ? 0 : known.doc.seq) }
        let bytes
        let signature
        try {
          bytes = await download(fetchImpl, url, MAX_DOC_BYTES)
          signature = (await download(fetchImpl, url + '.sig', MAX_SIGNATURE_BYTES)).toString('utf8')
        } catch (e) { last = { state: 'offline', at: now(), reason: e && e.code ? e.code : 'network' }; return withNew(snapshot()) }
        const ev = evaluate({ bytes, signature, keys: o.keys, floor })
        if (ev.ok !== true) { last = { state: 'refused', at: now(), reason: ev.error }; return withNew(snapshot()) }
        try { store(bytes, signature) } catch (e) { last = { state: 'refused', at: now(), reason: 'cache-not-written' }; return withNew(snapshot()) }
        last = { state: 'ok', at: now(), reason: null }
        return withNew(snapshot())
      } finally { busy = false }
    },
  }
}

// One catalogue per folder for the life of the process: `online` (what the last refresh said) lives in memory.
const catalogues = new Map()
const catalogueFor = (dir, io) => {
  let c = catalogues.get(dir)
  if (c === undefined) {
    c = createCatalogue({ dir, shipped: io.shipped(), keys: io.keys(), url: () => readCatalogueUrl(dir), fetchImpl: io.fetchImpl, now: io.now })
    catalogues.set(dir, c)
  }
  return c
}
export const forgetCatalogues = () => catalogues.clear()

/**
 * The route, with the host's helpers handed in (`io`) so it can be tested without the host.
 * io = { home, sameOriginStrict(req), sameOriginLax(req), readJson(req, maxBytes), send(res, status, body),
 *        shipped(): object, keys(): object[], fetchImpl?, now? }
 */
export async function serveCatalogue(req, res, io) {
  if (req.method !== 'GET' && req.method !== 'POST') return io.send(res, 405, fail('GET or POST expected'))
  if ((req.method === 'POST' ? io.sameOriginStrict(req) : io.sameOriginLax(req)) === false) return io.send(res, 403, fail('origin refused'))
  try {
    const home = await io.home()
    if (home === null || home === undefined || home === '') return io.send(res, 200, fail('DSH home not found'))
    const catalogue = catalogueFor(join(home, 'kybernos'), io)
    if (req.method === 'GET') return io.send(res, 200, catalogue.snapshot())
    let body = null
    try { body = await io.readJson(req, MAX_BODY_BYTES) } catch (e) { return io.send(res, 413, fail('request body too large')) }
    if (body === null || typeof body !== 'object' || body.op !== 'refresh') return io.send(res, 400, fail('unknown op'))
    return io.send(res, 200, await catalogue.refresh())
  } catch (e) {
    // The page treats any non-ok answer as "no catalogue": never let a host fault escape the route.
    return io.send(res, 500, fail('catalogue failed: ' + errText(e)))
  }
}
