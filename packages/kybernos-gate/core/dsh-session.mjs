// Single sign-in: once the gate has accepted the password it also hands the browser DSH's own session cookie,
// so the user does not meet DSH's "authentication required" page.
//
// DSH (0.2.0-rc.2, dsh-client-connection) authenticates a browser with a cookie it signs with a secret it keeps
// in `<DSH_HOME>/.credentials.yaml` (record `client-connection/browser-session`):
//   name  = "dsh-auth-" + b64url(sha256(authority))    authority = new URL('http://' + Host).host
//   value = "v1." + body + "." + b64url(hmac_sha256(secret, body))
//   body  = b64url(JSON { version: 1, authority, issuedAt, expiresAt })
// The secret is persistent, so a cookie minted here survives a DSH restart (unlike the launch token, which
// changes at every start). The test suite re-checks the format against the installed engine when it is present.
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const b64 = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

/** DSH's session secret (32 bytes) or null when it cannot be read. */
export function readDshSecret (dshHome) {
  try {
    const raw = String(readFileSync(join(dshHome, '.credentials.yaml'), 'utf8'))
    const at = raw.indexOf('client-connection/browser-session')
    const m = at < 0 ? null : raw.slice(at).match(/secret:\s*(\S+)/u)
    if (m === null || !/^[A-Za-z0-9_-]+$/u.test(m[1])) return null
    const buf = Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
    return buf.byteLength === 32 ? buf : null
  } catch (e) { return null }
}

/** The authority DSH derives from a Host header, or null. */
export function dshAuthority (hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader === '') return null
  try { return new URL(`http://${hostHeader}`).host } catch (e) { return null }
}

/**
 * The Set-Cookie header for DSH's session cookie, bound to the host the browser used.
 * @returns {{ name: string, header: string } | null} null when the secret or the host is unusable.
 */
export function mintDshCookie ({ secret, hostHeader, now = Date.now(), ttlMs, secure = false }) {
  const authority = dshAuthority(hostHeader)
  if (secret === null || secret === undefined || authority === null) return null
  const body = b64(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + ttlMs }), 'utf8'))
  const value = `v1.${body}.${b64(createHmac('sha256', secret).update(body).digest())}`
  const name = 'dsh-auth-' + b64(createHash('sha256').update(authority).digest())
  return { name, header: `${name}=${value}; Max-Age=${Math.floor(ttlMs / 1000)}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}` }
}

/** The name of DSH's cookie for a host (to delete it on logout). */
export const dshCookieName = (hostHeader) => {
  const authority = dshAuthority(hostHeader)
  return authority === null ? null : 'dsh-auth-' + b64(createHash('sha256').update(authority).digest())
}
