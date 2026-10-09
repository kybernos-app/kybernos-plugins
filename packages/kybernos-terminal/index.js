/**
 * kybernos-terminal — host half.
 *
 * v2 adds one route: POST /kybernos-terminal/run — executes the command of a
 * shell fence when the user clicks ▶ in the GUI (the click lives on the client
 * side, with no confirmation dialog by user decision; the route only ever runs
 * what the page sends).
 *
 * Guards:
 * - DSH serves plugin routes BEFORE its own authentication, and an Origin header
 *   is forgeable by any local program, so a same-origin check alone is not a
 *   login. The route needs the same two things as the automations route of
 *   `@local/kybernos`: a strict same-origin request AND DSH's signed
 *   browser-session cookie. It FAILS CLOSED: if the machine secret that signs
 *   the cookie cannot be read, nothing runs (503) — unlike the automations
 *   route, which falls back to the Origin rule, this one starts a shell.
 * - one command, one bounded process: single zsh -c, hard timeout, capped
 *   output, capped request body — the route cannot become a log pump or a fork bomb.
 */
import { spawn } from 'node:child_process'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve as resoudre } from 'node:path'

export const name = 'kybernos-terminal'

const TIMEOUT_MS = 30_000
const SORTIE_MAX = 64 * 1024
const COMMANDE_MAX = 500
const CORPS_MAX = 16 * 1024

/** Run one shell command, bounded. Never throws — answers `ok:false`. */
export function executer ({ commande, cwd } = {}) {
  return new Promise((resolve) => {
    const cmd = String(commande ?? '').trim()
    if (cmd === '' || cmd.length > COMMANDE_MAX) {
      resolve({ ok: false, erreur: 'empty command, or longer than ' + COMMANDE_MAX + ' characters' })
      return
    }
    const dir = String(cwd ?? '').trim() || homedir()
    let fini = false
    let enfant
    try {
      enfant = spawn('/bin/zsh', ['-c', cmd], { cwd: dir, timeout: TIMEOUT_MS, env: process.env })
    } catch (error) {
      resolve({ ok: false, erreur: String(error && error.message ? error.message : error) })
      return
    }
    let out = ''
    let err = ''
    let temoin = false
    const cap = (s) => {
      if (temoin) return
      out += s
      if (out.length > SORTIE_MAX) { out = out.slice(0, SORTIE_MAX); temoin = true }
    }
    const capErr = (s) => {
      if (temoin) return
      err += s
      if (err.length > SORTIE_MAX) { err = err.slice(0, SORTIE_MAX); temoin = true }
    }
    enfant.stdout.on('data', cap)
    enfant.stderr.on('data', capErr)
    const rendu = (code, timedOut) => {
      if (fini) return
      fini = true
      resolve({ ok: true, code, timedOut: timedOut === true, stdout: out, stderr: err, cwd: dir })
    }
    enfant.on('error', (error) => {
      if (fini) return
      fini = true
      resolve({ ok: false, erreur: String(error && error.message ? error.message : error) })
    })
    enfant.on('close', (code) => {
      /* node's `timeout` option kills with SIGTERM — that is the timeout path
         (this route never signals the child itself). */
      rendu(code, code === null && enfant.signalCode === 'SIGTERM')
    })
  })
}

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

/** Reads the JSON body, capped: a larger body is dropped (the command itself is capped at 500 characters). */
const lireCorps = (req) => new Promise((res) => {
  let corps = ''
  let trop = false
  req.on('data', (d) => {
    if (trop) return
    corps += d
    if (corps.length > CORPS_MAX) { trop = true; corps = '' }
  })
  req.on('end', () => {
    if (trop) { res(null); return }
    try { res(JSON.parse(corps || '{}')) } catch (e) { res({}) }
  })
})

const repondre = (res, statut, objet) => {
  res.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(objet))
}

/**
 * Attach the route to the DSH `webServer` service. Testable without DSH.
 * @param {object} webServerSvc the DSH `webServer` service
 * @param {{lireSecret?: () => (Buffer|null), executer?: Function, maintenant?: () => number}} [options] test seams
 */
export function monterRoutes (webServerSvc, options = {}) {
  const lireSecret = options.lireSecret ?? (() => lireSecretSession())
  const lancer = options.executer ?? executer
  const maintenant = options.maintenant ?? Date.now
  webServerSvc.register({
    kind: 'exact',
    path: '/kybernos-terminal/run',
    handler: async (req, res) => {
      if (!origineOK(req)) { repondre(res, 403, { ok: false, erreur: 'origin refused' }); return }
      if (String(req.method || '').toUpperCase() !== 'POST') { repondre(res, 405, { ok: false, erreur: 'POST expected' }); return }
      // Closed unless DSH's own session cookie proves a signed-in browser. No secret = no shell.
      const secret = lireSecret()
      if (secret === null || secret === undefined) {
        repondre(res, 503, { ok: false, erreur: 'the DSH session secret cannot be read, so the terminal stays closed' })
        return
      }
      if (cookieSessionValide(req.headers && req.headers.cookie, autorites(req), secret, maintenant()) !== true) {
        repondre(res, 401, { ok: false, erreur: 'sign-in required' })
        return
      }
      const corps = await lireCorps(req)
      if (corps === null) { repondre(res, 413, { ok: false, erreur: 'request body too large' }); return }
      const r = await lancer(corps)
      repondre(res, r.ok ? 200 : 400, r)
    }
  })
}

/** Host entry — same shape as kybernos-sessions: mount now, or when webServer lands. */
export function apply (ctx) {
  try {
    const demarrer = (hostCtx) => {
      monterRoutes(hostCtx.webServer)
      console.log('[kybernos-terminal] route /kybernos-terminal/run registered')
    }
    if (ctx.get('webServer') !== undefined) demarrer(ctx)
    else ctx.inject(['webServer'], demarrer)
  } catch (e) {
    console.error('[kybernos-terminal] host start failed', e)
  }
}
