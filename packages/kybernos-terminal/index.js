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
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve as resoudre } from 'node:path'

export const name = 'kybernos-terminal'

const TIMEOUT_MS = 30_000
const SORTIE_MAX = 64 * 1024
const COMMANDE_MAX = 500
const CORPS_MAX = 16 * 1024

/** What a person can read of a process's bytes: C0 controls (NUL, ESC...) become their visible "control pictures" (U+2400...), except newline, tab and carriage return. */
export function lisible (texte) {
  return String(texte).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (c) => String.fromCharCode(c === '\u007f' ? 0x2421 : 0x2400 + c.charCodeAt(0)))
}

/**
 * Run one shell command, bounded. Never throws — answers `ok:false`. `limites` (timeoutMs, sortieMax) is for tests: the route never passes it.
 * The command has no standard input (it is closed at once): a program that waits for a keypress fails immediately instead of hanging until the timeout.
 * It always runs in the folder it is given: there is no default (a silent run in the home folder is where `rm -rf build` does harm).
 * The shell leads its own process group, and the timeout kills the whole group: killing the shell alone (node's `timeout` option) leaves what it started
 * running, holding the output pipes open, so the answer used to wait for them (« sleep 77 » answered after 77 s, a server started from a block never).
 */
export function executer ({ commande, cwd } = {}, limites = {}) {
  return new Promise((resolve) => {
    const timeoutMs = limites.timeoutMs ?? TIMEOUT_MS
    const sortieMax = limites.sortieMax ?? SORTIE_MAX
    const cmd = String(commande ?? '').trim()
    if (cmd === '' || cmd.length > COMMANDE_MAX) {
      resolve({ ok: false, erreur: 'empty command, or longer than ' + COMMANDE_MAX + ' characters' })
      return
    }
    const dir = String(cwd ?? '').trim()
    if (dir === '') {
      resolve({ ok: false, erreur: 'no folder to run in: nothing was run' })
      return
    }
    try {
      if (statSync(dir).isDirectory() !== true) throw new Error('not a folder')
    } catch (error) {
      resolve({ ok: false, erreur: 'the folder to run in does not exist any more' })
      return
    }
    let fini = false
    let enfant
    try {
      enfant = spawn('/bin/zsh', ['-c', cmd], { cwd: dir, detached: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ ok: false, erreur: String(error && error.message ? error.message : error) })
      return
    }
    let out = ''
    let err = ''
    let temoin = false
    let tronque = false
    const cap = (s) => {
      if (temoin) return
      out += s
      if (out.length > sortieMax) { out = out.slice(0, sortieMax); temoin = true; tronque = true }
    }
    const capErr = (s) => {
      if (temoin) return
      err += s
      if (err.length > sortieMax) { err = err.slice(0, sortieMax); temoin = true; tronque = true }
    }
    enfant.stdout.setEncoding('utf8')
    enfant.stderr.setEncoding('utf8')
    enfant.stdout.on('data', cap)
    enfant.stderr.on('data', capErr)
    let minuteur = null
    const rendu = (code, timedOut) => {
      if (fini) return
      fini = true
      if (minuteur !== null) clearTimeout(minuteur)
      resolve({ ok: true, code, signal: enfant.signalCode ?? null, timedOut: timedOut === true, truncated: tronque, stdout: lisible(out), stderr: lisible(err), cwd: dir })
    }
    enfant.on('error', (error) => {
      if (fini) return
      fini = true
      if (minuteur !== null) clearTimeout(minuteur)
      resolve({ ok: false, erreur: String(error && error.message ? error.message : error) })
    })
    enfant.on('close', (code) => rendu(code, false))
    // The deadline: the whole group goes down, and the answer does not wait for the pipes (a process that left the group could still hold them).
    minuteur = setTimeout(() => {
      if (fini) return
      try { process.kill(-enfant.pid, 'SIGKILL') } catch (error) { try { enfant.kill('SIGKILL') } catch (e) { /* already gone */ } }
      try { enfant.stdout.destroy(); enfant.stderr.destroy() } catch (error) { /* closed */ }
      rendu(null, true)
    }, timeoutMs)
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

/**
 * The folder the agent works in for a session: what the core plugin publishes (`kybernos.workspace`), read from the session store by the host.
 * The page names the session, never a path. null when it cannot be found.
 */
export async function dossierDeSession (session) {
  try {
    const w = globalThis[Symbol.for('kybernos.workspace')]
    if (w === undefined || w === null || typeof w.sessionCwd !== 'function') return null
    const dir = await w.sessionCwd(session)
    return typeof dir === 'string' && dir.trim() !== '' ? dir : null
  } catch { return null }
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
  const dossier = options.dossierDeSession ?? dossierDeSession
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
      // Where it runs: the folder of the session the click was made in, found by the host. A path sent by the page is never used.
      // A request that names no session, or a session whose folder cannot be found, runs nothing (a silent run in the home folder
      // is where `rm -rf build` does harm).
      const args = corps !== null && typeof corps === 'object' ? { ...corps } : {}
      const session = typeof args.session === 'string' ? args.session.trim() : ''
      delete args.cwd
      delete args.session
      if (session === '') {
        repondre(res, 400, { ok: false, erreur: 'no chat session to run in: nothing was run' })
        return
      }
      const dir = await dossier(session)
      if (dir === null || dir === undefined) {
        repondre(res, 400, { ok: false, erreur: 'the folder of this session cannot be found: nothing was run' })
        return
      }
      args.cwd = dir
      const r = await lancer(args)
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
