// ── A route that writes needs DSH's signed session, not only an Origin ───────────────────────────────────────────────────
//
// DSH serves plugin routes BEFORE its own authentication (measured), and an Origin header is forgeable by any local program (or by another
// account on the same machine): a same-origin check alone is not a login. A route that spends the person's money, deletes their data,
// installs software or stores a key therefore needs what kybernos-terminal's run route already needs: a strict same-origin request AND
// the signed browser-session cookie DSH hands the signed-in browser.
//
// This file is kybernos-terminal's code, word for word: `autorites`, `origineOK`, `dshHome`, `lireSecretSession` and `cookieSessionValide`
// are the terminal's functions, and `writeGuard` below only joins them. Bundles are installed on their own and import nothing from one
// another, so every bundle that guards a write carries an identical copy of this file; `node scripts/test-session-guard.mjs` fails when a
// copy drifts from the terminal's functions or from the other copies. Change it in kybernos-terminal first, then copy it everywhere.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve as resoudre } from 'node:path'

const METHODES_LECTURE = ['GET', 'HEAD', 'OPTIONS']

// Hosted instance: the origin may also be an authority declared to DSH with --trusted-host. This only widens the ORIGIN check: the
// session-cookie check below still lists the loopback authorities, so the shell stays closed to anything that is not the local browser.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }

/** The hosts a request to this server may legitimately carry (127.0.0.1, localhost, [::1] on its own port). */
function autorites (req) {
  const port = (req && req.socket && typeof req.socket.localPort === 'number') ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}

/** Strict same-origin guard. Necessary, not sufficient: see `cookieSessionValide`. */
export function origineOK (req) {
  const headers = (req !== null && req !== undefined && req.headers != null) ? req.headers : {}
  const lecture = METHODES_LECTURE.indexOf(String((req && req.method) || 'GET').toUpperCase()) !== -1
  const o = String(headers.origin || headers.referer || '')
  if (o === '') return lecture
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return autorites(req).indexOf(u.host) >= 0 || kbTrusted(u.host)
  } catch { return false }
}

// ── DSH browser session ─────────────────────────────────────────────────────
// DSH signs its browser cookie with a secret it keeps for the machine (same scheme as scripts/cdp-lib.mjs
// and docs/dev/live-testing.md):
//   name  = "dsh-auth-" + b64url(sha256(authority))      authority = "127.0.0.1:<port>"
//   value = "v1." + body + "." + b64url(hmac_sha256(secret, body))
//   body  = b64url(JSON { version: 1, authority, issuedAt, expiresAt })

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** The DSH folder, resolved the way DSH does: a non-blank $DSH_HOME (a leading `~` expanded), else ~/.dsh. */
export function dshHome (env = process.env, osHome = homedir) {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(osHome(), '.dsh')
  if (raw === '~') return osHome()
  return resoudre(raw.startsWith('~/') ? join(osHome(), raw.slice(2)) : raw)
}

/** The machine secret that signs the browser cookie (32 bytes), or null when it cannot be read. */
export function lireSecretSession (home = dshHome()) {
  try {
    const raw = String(readFileSync(join(home, '.credentials.yaml'), 'utf8'))
    const at = raw.indexOf('client-connection/browser-session')
    const m = at < 0 ? null : raw.slice(at).match(/secret:\s*(\S+)/)
    if (m === null) return null
    const buf = Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
    return buf.byteLength === 32 ? buf : null
  } catch { return null }
}

/** True when `cookieHeader` carries a valid, unexpired DSH session cookie for one of `authorities`. */
export function cookieSessionValide (cookieHeader, authoritiesList, secret, nowMs = Date.now()) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0 || cookieHeader.length > 8192) return false
  if (!Buffer.isBuffer(secret) || secret.byteLength === 0) return false
  const jar = new Map()
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && jar.has(part.slice(0, i).trim()) === false) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim())
  }
  for (const authority of authoritiesList) {
    const value = jar.get('dsh-auth-' + b64url(createHash('sha256').update(authority).digest()))
    const m = value === undefined ? null : /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(value)
    if (m === null) continue
    const want = Buffer.from(b64url(createHmac('sha256', secret).update(m[1]).digest()))
    const have = Buffer.from(m[2])
    if (want.length !== have.length || timingSafeEqual(want, have) !== true) continue
    let body = null
    try { body = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) } catch { continue }
    if (body !== null && typeof body === 'object' && body.version === 1 && body.authority === authority &&
        Number.isFinite(body.expiresAt) && body.expiresAt > nowMs) return true
  }
  return false
}

// ── The guard of a write route ──────────────────────────────────────────────

/** Where the guard reads the machine secret and the clock; a test replaces them (the guard has no other switch). */
export const sessionSource = { secret: () => lireSecretSession(), now: () => Date.now() }

// A request that came through the phone link carries this marker: kybernos-mobile's remote half sets it on every request it replays and drops any a phone sends.
// A phone has the power of the keyboard, not of the machinery that decides what this computer trusts, so a write that carries it never passes this guard.
const TUNNEL_HEADER = 'x-kybernos-tunnel'
const tunnelled = (req) => { try { return req.headers[TUNNEL_HEADER] !== undefined } catch (e) { return true } }

/**
 * Whether a request may write. `null` lets it go on; otherwise `{ status, error }` is the refusal to send:
 * 403 when the request names no Origin or Referer, or one that is not this listener's; 403 `refused_on_phone` when a write came through the phone link;
 * 503 when the machine secret cannot be read
 * (a guard that cannot judge refuses, like the terminal's); 401 when DSH's signed session cookie is missing, forged or expired.
 * The cookie is looked up under the loopback authorities, and under the public one when DSH was told about it (--trusted-host):
 * a forged Host can only choose which cookie name is looked up, the value still has to carry a valid signature.
 */
export function writeGuard (req) {
  if (!origineOK(req)) return { status: 403, error: 'origin refused' }
  if (METHODES_LECTURE.indexOf(String((req && req.method) || 'GET').toUpperCase()) === -1 && tunnelled(req)) return { status: 403, error: 'refused_on_phone' }
  const secret = sessionSource.secret()
  if (secret === null || secret === undefined) return { status: 503, error: 'the DSH session secret cannot be read, so this write stays closed' }
  const authorities = autorites(req)
  try {
    const host = new URL('http://' + req.headers.host).host
    if (kbTrusted(host)) authorities.push(host)
  } catch (e) { /* no or unparsable Host: the loopback authorities only */ }
  if (cookieSessionValide(req.headers && req.headers.cookie, authorities, secret, sessionSource.now()) !== true) return { status: 401, error: 'sign-in required' }
  return null
}
