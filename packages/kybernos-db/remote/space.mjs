// space.mjs — this computer's side of a conversation with a team space (packages/kybernos-webapp-creator/templates/tables): the owner's calls over http, and nothing else.
//
// Every call acts as the owner with `Authorization: Bearer <owner API token>`, a token minted for that one request with the space's boot key (token.mjs) and good for five
// minutes at most. The boot key lives in this closure and nowhere else: not in an answer, not in an error, not on a property of the client. `fetch` is injected, so a test
// never touches a network; `redirect` is never followed (the token goes to the one address that was configured, or to nobody).
//
// Every answer is `{ ok: true, … }` or `{ ok: false, code, message, status? }`; a call never throws. Codes: `unreachable` (the space did not answer, or not in time),
// `refused` (it did not accept this computer's key), `rate-limited`, `too-large`, `space` (it answered with a server error), `manifest` / `mismatch` (it answered, but not
// with something this computer can trust), and the door's own codes (`unknown_object`, `invalid`, `forbidden`, …) passed through for a write. The `message` is plain English
// and never carries the body of a response.
import { randomBytes } from 'node:crypto'
import { isHash } from '../store/blobs.mjs'
import { DEFAULT_MAX_BYTES, checkManifest } from './bundle.mjs'
import { hexKey, mintOwnerApiToken, signToken } from './token.mjs'

const SLUG = /^[a-z][a-z0-9-]{0,39}$/
const FINGERPRINT = /^[0-9A-Za-z._-]{1,64}$/
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
/** The kind and lifetime of the owner's one-time link: they must equal the team space's own (lib/bootstrap.mjs), which scripts/check-publish.mjs proves by opening one. */
export const OPEN_KIND = 'open'
export const OPEN_TTL_SEC = 10 * 60
const JSON_CAP = 1024 * 1024
const MANIFEST_CAP = 8 * 1024 * 1024

const fail = (code, message, extra) => ({ ok: false, code, message, ...(extra || {}) })

/** The origin of a team space as this computer will talk to it, or null: https, or http for a loopback address (a space run on this machine); no credentials, no path, no query. */
export function normalizeSpaceUrl (url) {
  let u
  try { u = new URL(String(url)) } catch (e) { return null }
  if (u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '' || (u.pathname !== '/' && u.pathname !== '')) return null
  if (u.protocol === 'https:') return u.origin
  if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return u.origin
  return null
}

/** The body of a response, whole, or null when it is over `max` (by its announced length or by what really arrives). */
async function readCapped (res, max) {
  const announced = Number(res.headers.get('content-length'))
  if (Number.isFinite(announced) && announced > max) { try { await res.body?.cancel() } catch (e) { /* already closed */ } return null }
  if (res.body === null || res.body === undefined) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) { try { await reader.cancel() } catch (e) { /* already closed */ } return null }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
  }
  return Buffer.concat(chunks, size)
}

const SAID = {
  401: ['refused', 'The web app did not accept this computer’s key.'],
  413: ['too-large', 'That is more than the web app accepts.'],
  429: ['rate-limited', 'The web app asked this computer to slow down. Try again in a moment.'],
}

/**
 * `url` is the space's origin, `bootKey` its secret in hex. Throws only when they are not usable (a bad configuration, found before any call).
 * `timeoutMs` bounds a small call, `bytesTimeoutMs` one that moves a database or a file; `maxBytes` bounds what is read back.
 */
export function makeSpaceClient ({ url, bootKey, fetch: doFetch = globalThis.fetch, now = Date.now, random = randomBytes, timeoutMs = 20000, bytesTimeoutMs = 120000, maxBytes = DEFAULT_MAX_BYTES }) {
  const base = normalizeSpaceUrl(url)
  const key = hexKey(bootKey)
  if (base === null) throw new Error('a team space address is https://…, or http://localhost for a space on this machine')
  if (key === null) throw new Error('a team space key is at least 32 hexadecimal characters')
  if (typeof doFetch !== 'function') throw new Error('no fetch to talk to the space with')

  /** One call. `kind` is what is read back: `json` or `bytes`. `body` is a Buffer to send. */
  async function call (method, path, { json, body, type, kind = 'json', cap, timeout } = {}) {
    const headers = { authorization: 'Bearer ' + mintOwnerApiToken({ key, now, random }), accept: kind === 'json' ? 'application/json' : 'application/octet-stream' }
    let payload
    if (json !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(json) }
    else if (body !== undefined) { headers['content-type'] = type || 'application/octet-stream'; payload = body }
    const ctl = new AbortController()
    const limit = timeout !== undefined ? timeout : (kind === 'bytes' || body !== undefined ? bytesTimeoutMs : timeoutMs)
    const timer = setTimeout(() => ctl.abort(), limit)
    let timedOut = false
    ctl.signal.addEventListener('abort', () => { timedOut = true })
    try {
      let res
      try { res = await doFetch(base + path, { method, headers, body: payload, redirect: 'manual', signal: ctl.signal, cache: 'no-store' }) } catch (e) {
        return timedOut ? fail('unreachable', 'The web app did not answer in time.') : fail('unreachable', 'The web app could not be reached.')
      }
      if (res.status >= 300 && res.status < 400) return fail('space', 'The web app sent this computer somewhere else, which it will not follow.', { status: res.status })
      const ok = res.status >= 200 && res.status < 300
      if (ok && kind === 'bytes') {
        const bytes = await readCapped(res, cap === undefined ? maxBytes : cap)
        return bytes === null ? fail('too-large', 'That is more than this computer will take in one piece.', { status: res.status }) : { ok: true, status: res.status, bytes, headers: res.headers }
      }
      const raw = await readCapped(res, ok ? (cap === undefined ? JSON_CAP : cap) : JSON_CAP)
      let parsed = null
      if (raw !== null) { try { parsed = JSON.parse(raw.toString('utf8')) } catch (e) { parsed = null } }
      const obj = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
      if (ok) return obj === null ? fail('space', 'The web app answered something this computer cannot read.', { status: res.status }) : { ...obj, ok: obj.ok !== false, status: res.status }
      const said = SAID[res.status]
      const code = typeof (obj && obj.error) === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(obj.error) ? obj.error : (said ? said[0] : (res.status >= 500 ? 'space' : 'invalid'))
      const message = said && (res.status === 401 || res.status === 429) ? said[1] : (typeof (obj && obj.message) === 'string' ? obj.message.slice(0, 300) : (said ? said[1] : (res.status >= 500 ? 'The web app had a problem.' : 'The web app did not accept that.')))
      return fail(res.status === 401 ? 'refused' : code, message, { status: res.status, ...(obj !== null && Array.isArray(obj.errors) ? { errors: obj.errors.slice(0, 8) } : {}) })
    } catch (e) {
      return timedOut ? fail('unreachable', 'The web app did not answer in time.') : fail('space', 'The web app answered something this computer cannot read.')
    } finally { clearTimeout(timer) }
  }
  const slugOk = (slug) => (SLUG.test(String(slug)) ? null : fail('invalid', 'an app slug is lower-case letters, digits and -'))
  const path = (slug, tail) => '/api/apps/' + slug + '/' + tail

  return {
    url: base,
    /** `{ ok, fingerprint }`: the hosted app's change stamp, cheap. */
    async fingerprint (slug) {
      const bad = slugOk(slug); if (bad) return bad
      const r = await call('GET', path(slug, 'fingerprint'))
      if (!r.ok) return r
      return FINGERPRINT.test(String(r.fingerprint)) ? { ok: true, fingerprint: r.fingerprint } : fail('manifest', 'The web app gave a fingerprint this computer cannot read.')
    },
    /** `{ ok, manifest }`: what a snapshot taken now would hold, checked. */
    async manifest (slug) {
      const bad = slugOk(slug); if (bad) return bad
      const r = await call('GET', path(slug, 'snapshot/manifest'), { cap: MANIFEST_CAP })
      if (!r.ok) return r
      const checked = checkManifest({ format: r.format, db: r.db, fingerprint: r.fingerprint, blobs: r.blobs }, { maxBytes: maxBytes })
      return checked.ok ? { ok: true, manifest: checked.manifest } : fail('manifest', 'The web app described its data in a way this computer cannot trust.')
    },
    /** `{ ok, bytes, fingerprint }`: the SQLite file of the snapshot the manifest described (compare the fingerprint with the manifest's). */
    async snapshotDb (slug) {
      const bad = slugOk(slug); if (bad) return bad
      const r = await call(('GET'), path(slug, 'snapshot/db'), { kind: 'bytes' })
      if (!r.ok) return r
      const fp = r.headers.get('x-kb-fingerprint')
      return typeof fp === 'string' && FINGERPRINT.test(fp) ? { ok: true, bytes: r.bytes, fingerprint: fp } : fail('mismatch', 'The web app did not say which state its data was in.')
    },
    /** `{ ok, bytes }`: one attachment, by the hash of what it holds (the caller checks the hash). */
    async blob (slug, hash) {
      const bad = slugOk(slug); if (bad) return bad
      if (!isHash(hash)) return fail('invalid', 'a file is named by the 64 hex characters of its SHA-256')
      const r = await call('GET', path(slug, 'blobs/' + hash), { kind: 'bytes' })
      return r.ok ? { ok: true, bytes: r.bytes } : r
    },
    /** Brings an app in as a new slug: `{ ok, slug, db, fingerprint }`, or `exists` / `db-exists` / `invalid-bundle`. */
    async putBundle (slug, bytes) {
      const bad = slugOk(slug); if (bad) return bad
      const r = await call('PUT', path(slug, 'bundle'), { body: bytes, type: 'application/octet-stream' })
      return r.ok && typeof r.fingerprint === 'string' && FINGERPRINT.test(r.fingerprint) ? { ok: true, slug, fingerprint: r.fingerprint } : (r.ok ? fail('manifest', 'The web app did not confirm what it received.') : r)
    },
    /** Takes an app out of the space (its folder is deleted there). `unknown` means it is already gone. */
    async release (slug) {
      const bad = slugOk(slug); if (bad) return bad
      const r = await call('POST', path(slug, 'release'), { json: { confirm: slug } })
      return r.ok ? { ok: true } : r
    },
    /** A row write as the owner: `{ object, op, id?, values? }`; the door's answer, or `{ ok: false, code, message }`. */
    async write (slug, body) {
      const bad = slugOk(slug); if (bad) return bad
      const r = await call('POST', path(slug, 'write'), { json: { object: body.object, op: body.op, id: body.id, values: body.values } })
      if (r.ok) { const { status, ...rest } = r; return rest }
      return r
    },
    /** One file for an attachment field: `{ ok, file }` to write into the row. */
    async upload (slug, { object, field, name, type, bytes }) {
      const bad = slugOk(slug); if (bad) return bad
      const q = new URLSearchParams({ object: String(object), field: String(field), name: String(name) }).toString()
      const r = await call('POST', path(slug, 'upload?' + q), { body: bytes, type: type || 'application/octet-stream' })
      if (r.ok) { const { status, ...rest } = r; return rest }
      return r
    },
    /** The one-time link that signs the owner in (`<space>/open?t=…`, ten minutes, once). It makes no request. It is a secret: hand it to the person and to nobody else. */
    openLink () {
      const token = signToken(OPEN_KIND, { n: random(16).toString('base64url') }, key, { now, ttlSec: OPEN_TTL_SEC })
      return base + '/open?t=' + encodeURIComponent(token)
    },
  }
}
