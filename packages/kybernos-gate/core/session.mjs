// The gate's own session cookie: a signed, expiring token. Same shape as DSH's cookie (`v1.<body>.<hmac>`),
// but the gate's own name and secret, so one never validates the other.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'kybernos_gate'

const b64 = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
const unb64 = (text) => (/^[A-Za-z0-9_-]+$/u.test(text) ? Buffer.from(text.replaceAll('-', '+').replaceAll('_', '/'), 'base64') : null)
const mac = (secret, body) => createHmac('sha256', secret).update(body).digest()

/** Create a session value valid for `ttlMs` from `now`. */
export function signSession (secret, { now = Date.now(), ttlMs }) {
  const body = b64(Buffer.from(JSON.stringify({ v: 1, iat: now, exp: now + ttlMs, sid: b64(randomBytes(12)) }), 'utf8'))
  return `v1.${body}.${b64(mac(secret, body))}`
}

/** The payload of a valid, unexpired session value; null for anything else. Constant-time on the signature. */
export function verifySession (secret, value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 512) return null
  const parts = value.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  const given = unb64(parts[2])
  const want = mac(secret, parts[1])
  if (given === null || given.length !== want.length || !timingSafeEqual(given, want)) return null
  const raw = unb64(parts[1])
  if (raw === null) return null
  let payload
  try { payload = JSON.parse(raw.toString('utf8')) } catch (e) { return null }
  if (payload === null || typeof payload !== 'object' || payload.v !== 1 || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) return null
  return payload.exp > now && payload.iat <= now + 60000 ? payload : null
}

/** `name=value; Max-Age=…; Path=/; HttpOnly; SameSite=Strict[; Secure]`. Names and values must be cookie-safe. */
export function serializeCookie (name, value, { maxAgeSeconds, secure }) {
  if (!/^[A-Za-z0-9_.-]+$/u.test(name) || !/^[A-Za-z0-9_.-]*$/u.test(value)) throw new Error('cookie name or value is not cookie-safe')
  return `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

/** The header that deletes a cookie. */
export const clearCookie = (name, { secure }) => serializeCookie(name, '', { maxAgeSeconds: 0, secure })

/** Value of one cookie in a Cookie header, or undefined. */
export function readCookie (header, name) {
  if (typeof header !== 'string') return undefined
  for (const segment of header.split(';')) {
    const at = segment.indexOf('=')
    if (at > 0 && segment.slice(0, at).trim() === name) return segment.slice(at + 1).trim()
  }
  return undefined
}

/** The Cookie header without `name`; undefined when nothing is left (so no empty header is forwarded). */
export function stripCookie (header, name) {
  if (typeof header !== 'string') return undefined
  const kept = header.split(';').filter((segment) => { const at = segment.indexOf('='); return !(at > 0 && segment.slice(0, at).trim() === name) }).map((s) => s.trim()).filter(Boolean)
  return kept.length === 0 ? undefined : kept.join('; ')
}
