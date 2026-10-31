// token.mjs — signed, expiring tokens (HMAC-SHA256). Pure: node:crypto only, the clock is injected.
//
//   token = base64url(JSON claims) + '.' + base64url(HMAC(key, kind + '.' + first part))
//
// The kind is inside the MAC, so a token made for one purpose (« open », « invite ») never verifies for another. The signature is checked before the claims are parsed,
// and an expiry is part of every token: `x`, in seconds since the epoch.
import { createHmac, timingSafeEqual } from 'node:crypto'

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
