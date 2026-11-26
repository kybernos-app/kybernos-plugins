// token.mjs — signed, expiring tokens (HMAC-SHA256), and the owner's API token built on them. Pure: node:crypto only, the clock is injected.
//
//   token = base64url(JSON claims) + '.' + base64url(HMAC(key, kind + '.' + first part))
//
// The kind is inside the MAC, so a token made for one purpose (« open », « invite », « owner-api ») never verifies for another. The signature is checked before the claims are
// parsed, and an expiry is part of every token: `x`, in seconds since the epoch.
//
// This is the one copy both sides use: the hosted team space (templates/tables, vendored) verifies with it, and the DSH side that talks to the team space mints with it.
//
// The owner's API token (`owner-api`) is how a machine acts as the owner of a team space without a cookie: `Authorization: Bearer <token>`. It is signed with the space's boot
// key, carries its own issue time (`i`) and lives five minutes at most, so a caller mints a fresh one per request and a stolen one is worth little. The verifier checks the
// lifetime the token itself claims (`x - i`), not only that it has not expired, so a token minted for an hour is refused however recently it was made.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const TOKEN_MAX = 1024

const mac = (kind, body, key) => createHmac('sha256', key).update(kind + '.' + body).digest()
const isKey = (key) => (Buffer.isBuffer(key) && key.length >= 16) || (typeof key === 'string' && key.length >= 16)

/** A hex string of at least 16 bytes as a key, or null. */
export const hexKey = (s) => (typeof s === 'string' && s.length >= 32 && s.length <= 256 && s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s) ? Buffer.from(s, 'hex') : null)

/** `claims` is a plain object; the token expires `ttlSec` seconds after `now()` (milliseconds). */
export function signToken (kind, claims, key, { now = Date.now, ttlSec }) {
  if (!isKey(key)) throw new Error('token key: at least 16 bytes')
  if (!Number.isInteger(ttlSec) || ttlSec < 1) throw new Error('token ttl: a whole number of seconds')
  const body = Buffer.from(JSON.stringify({ ...claims, x: Math.floor(now() / 1000) + ttlSec })).toString('base64url')
  return body + '.' + mac(kind, body, key).toString('base64url')
}

/** `{ ok: true, claims }`, or `{ ok: false, reason: 'malformed' | 'bad-signature' | 'expired' }`. */
export function verifyToken (kind, token, key, { now = Date.now } = {}) {
  if (typeof token !== 'string' || token.length > TOKEN_MAX || !isKey(key)) return { ok: false, reason: 'malformed' }
  const parts = token.split('.')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return { ok: false, reason: 'malformed' }
  const given = Buffer.from(parts[1], 'base64url')
  const expected = mac(kind, parts[0], key)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad-signature' }
  let claims
  try { claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) } catch (e) { return { ok: false, reason: 'malformed' } }
  if (claims === null || typeof claims !== 'object' || Array.isArray(claims) || !Number.isInteger(claims.x)) return { ok: false, reason: 'malformed' }
  if (Math.floor(now() / 1000) >= claims.x) return { ok: false, reason: 'expired' }
  return { ok: true, claims }
}

export const OWNER_API_KIND = 'owner-api'
/** The longest an owner API token may live, in seconds. */
export const OWNER_API_MAX_TTL_SEC = 5 * 60
/** How far ahead of this clock a token's issue time may be (two machines never agree to the second). */
export const OWNER_API_SKEW_SEC = 60

/** A fresh owner API token. `ttlSec` is at most five minutes (the default). */
export function mintOwnerApiToken ({ key, now = Date.now, ttlSec = OWNER_API_MAX_TTL_SEC, random = randomBytes }) {
  if (!Number.isInteger(ttlSec) || ttlSec < 1 || ttlSec > OWNER_API_MAX_TTL_SEC) throw new Error('owner api token ttl: 1 to ' + OWNER_API_MAX_TTL_SEC + ' seconds')
  return signToken(OWNER_API_KIND, { n: random(12).toString('base64url'), i: Math.floor(now() / 1000) }, key, { now, ttlSec })
}

/** `{ ok: true }`, or `{ ok: false, reason: 'malformed' | 'bad-signature' | 'expired' | 'lifetime' | 'not-yet' }`. */
export function verifyOwnerApiToken (token, key, { now = Date.now } = {}) {
  const v = verifyToken(OWNER_API_KIND, token, key, { now })
  if (!v.ok) return v
  const { i, x } = v.claims
  if (!Number.isInteger(i) || i > x) return { ok: false, reason: 'malformed' }
  if (x - i > OWNER_API_MAX_TTL_SEC) return { ok: false, reason: 'lifetime' }
  if (i - Math.floor(now() / 1000) > OWNER_API_SKEW_SEC) return { ok: false, reason: 'not-yet' }
  return { ok: true }
}

/** The bearer token of an `Authorization` header: a string (possibly not a valid token), or null when the header is not a bearer one. */
export function bearerOf (header) {
  if (typeof header !== 'string') return null
  const m = /^bearer(?:[ \t]+(.*))?$/i.exec(header.trim())
  return m === null ? null : (m[1] ?? '').trim()
}
