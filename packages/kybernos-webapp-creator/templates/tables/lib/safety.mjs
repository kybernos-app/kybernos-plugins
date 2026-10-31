// safety.mjs — the rules every request goes through: which Origin is ours, the CSRF token, the headers, the address a request comes from. Pure.
//
// CSRF is a signed double submit: `GET /api/csrf` sets an HttpOnly cookie holding a random value and hands back HMAC(secret, value); a request that changes anything must send
// that HMAC (header `x-csrf-token`, or the form field `_csrf`). A page of another site can neither read the answer nor set the cookie. Origin is checked as well, strictly:
// a request that changes something and does not say where it comes from is refused.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const CSRF_HEADER = 'x-csrf-token'
export const CSRF_FIELD = '_csrf'
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** The origins the app answers to: the public address when there is one, else the two loopback spellings of its port. */
export function allowedOrigins ({ publicUrl, port }) {
  if (typeof publicUrl === 'string' && publicUrl !== '') {
    const u = new URL(publicUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('KB_PUBLIC_URL must be an http or https address')
    return [u.origin]
  }
  return ['http://127.0.0.1:' + port, 'http://localhost:' + port]
}

export const isHttps = (origins) => origins[0].startsWith('https:')
export const originOk = (origin, allowed) => typeof origin === 'string' && allowed.includes(origin)

/** The cookie name carries the `__Host-` prefix on https: the browser then refuses one set from another path or domain. */
export const csrfCookieName = (https) => (https ? '__Host-kb_csrf' : 'kb_csrf')

export const newCsrfValue = (random = randomBytes) => random(24).toString('base64url')
export const csrfToken = (secret, value) => createHmac('sha256', secret).update('kybernos-tables/csrf.' + value).digest('base64url')

export function csrfOk (secret, value, given) {
  if (typeof value !== 'string' || value === '' || typeof given !== 'string' || given === '') return false
  const want = Buffer.from(csrfToken(secret, value))
  const got = Buffer.from(given)
  return want.length === got.length && timingSafeEqual(want, got)
}

/** The attributes of the CSRF cookie. */
export const csrfCookie = (name, value, https) => name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax' + (https ? '; Secure' : '')

/** The headers of every answer. The pages need no script and no inline style, so the policy allows neither. */
export function securityHeaders (https) {
  return {
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...(https ? { 'strict-transport-security': 'max-age=31536000' } : {}),
  }
}

/** Where a request comes from, for the limiter: the socket's address, or the first `x-forwarded-for` when the operator says a proxy is in front. */
export function clientIp ({ forwardedFor, remote, trustProxy }) {
  if (trustProxy === true && typeof forwardedFor === 'string' && forwardedFor !== '') return forwardedFor.split(',')[0].trim().slice(0, 64)
  return typeof remote === 'string' && remote !== '' ? remote.slice(0, 64) : 'local'
}
