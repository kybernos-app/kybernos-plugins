// kybernos-mobile: how the remote half reaches THIS DSH's own page (loopback), and where it keeps its files.
//
// DSH authenticates a browser with a cookie it signs with a secret it keeps in `<DSH home>/.credentials.yaml`
// (record `client-connection/browser-session`); the cookie's name and signature depend on the authority (`host:port`) of
// the page. The remote half replays a phone's requests as if they came from that page, so it mints the same cookie
// (the same rule as kybernos-gate/core/dsh-session.mjs; this bundle ships alone, so the few lines are repeated here).
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** The DSH home, resolved the way DSH does: a non-blank $DSH_HOME (trimmed, a leading ~ expanded), else <os home>/.dsh. */
export const dshHome = (env = process.env, osHome = homedir) => {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(osHome(), '.dsh')
  if (raw === '~') return osHome()
  return resolve(raw.startsWith('~/') || raw.startsWith('~\\') ? join(osHome(), raw.slice(2)) : raw)
}

/** Where this half keeps its identity and its paired phones. */
export const remoteDir = (env = process.env, osHome = homedir) => join(dshHome(env, osHome), 'kybernos', 'mobile-remote')

const b64 = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

/** DSH's session secret (32 bytes) or null when it cannot be read. */
export function readDshSecret (home) {
  try {
    const raw = String(readFileSync(join(home, '.credentials.yaml'), 'utf8'))
    const at = raw.indexOf('client-connection/browser-session')
    const m = at < 0 ? null : raw.slice(at).match(/secret:\s*(\S+)/u)
    if (m === null || !/^[A-Za-z0-9_-]+$/u.test(m[1])) return null
    const buf = Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
    return buf.byteLength === 32 ? buf : null
  } catch (e) { return null }
}

/** `name=value` of DSH's cookie for an authority (`127.0.0.1:3080`), valid one hour, or null. */
export function mintCookie (secret, authority, now = Date.now()) {
  if (secret === null || secret === undefined || typeof authority !== 'string' || authority === '') return null
  const body = b64(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 3600000 }), 'utf8'))
  const value = 'v1.' + body + '.' + b64(createHmac('sha256', secret).update(body).digest())
  return 'dsh-auth-' + b64(createHash('sha256').update(authority).digest()) + '=' + value
}

/**
 * The function the remote half calls for `deps.local`: `{ base, cookie }` or null.
 * The port is DSH's own listening port: the web server's `listenedPort`, else $DSH_WEB_PORT, else the one a request of
 * the page revealed (`learn`).
 */
export function localReach ({ webServer, env = process.env, home = () => dshHome(env), now = Date.now } = {}) {
  let learned = null
  let cached = null // { authority, cookie, at }
  const reach = () => {
    let port = null
    try { if (webServer !== undefined && webServer !== null && Number.isInteger(webServer.listenedPort) && webServer.listenedPort > 0) port = webServer.listenedPort } catch (e) { /* no port */ }
    if (port === null && /^\d{2,5}$/u.test(String(env.DSH_WEB_PORT || ''))) port = Number(env.DSH_WEB_PORT)
    if (port === null) port = learned
    if (port === null) return null
    const authority = '127.0.0.1:' + port
    if (cached === null || cached.authority !== authority || now() - cached.at > 600000) {
      const cookie = mintCookie(readDshSecret(home()), authority, now())
      if (cookie === null) return null
      cached = { authority, cookie, at: now() }
    }
    return { base: 'http://' + authority, cookie: cached.cookie }
  }
  reach.learn = (port) => { if (Number.isInteger(port) && port > 0 && port < 65536) learned = port }
  return reach
}
