/**
 * kybernos-terminal — host half.
 *
 * v2 adds one route: POST /kybernos-terminal/run — executes the command of a
 * shell fence when the user clicks ▶ in the GUI (the click and the confirmation
 * live on the client side; the route only ever runs what the page sends).
 *
 * Guards, copied from kybernos-sessions (recette 2026-10, M-02/S-03):
 * - same-origin only: DSH serves plugin routes BEFORE its own authentication,
 *   so the route guards itself with the strict same-origin check;
 * - one command, one bounded process: single zsh -c, hard timeout, capped
 *   output — the route cannot become a log pump or a fork bomb.
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'

export const name = 'kybernos-terminal'

const TIMEOUT_MS = 30_000
const SORTIE_MAX = 64 * 1024

/** Run one shell command, bounded. Never throws — answers `ok:false`. */
export function executer ({ commande, cwd } = {}) {
  return new Promise((resolve) => {
    const cmd = String(commande ?? '').trim()
    if (cmd === '' || cmd.length > 500) {
      resolve({ ok: false, erreur: 'commande vide ou trop longue (500 caractères max)' })
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
    let periome = false
    const minuteur = setTimeout(() => { periome = true }, TIMEOUT_MS + 500)
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
      clearTimeout(minuteur)
      /* node's `timeout` option kills with SIGTERM — that is the timeout path
         (this route never signals the child itself). */
      rendu(code, code === null && enfant.signalCode === 'SIGTERM')
    })
  })
}

/** Same-origin guard — DSH serves plugin routes before its own authentication. */
const METHODES_LECTURE = ['GET', 'HEAD', 'OPTIONS']
export function origineOK (req) {
  const headers = (req !== null && req !== undefined && req.headers != null) ? req.headers : {}
  const lecture = METHODES_LECTURE.indexOf(String((req && req.method) || 'GET').toUpperCase()) !== -1
  const o = String(headers.origin || headers.referer || '')
  if (o === '') return lecture
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = (req.socket && typeof req.socket.localPort === 'number') ? ':' + req.socket.localPort : ''
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0
  } catch { return false }
}

const lireCorps = (req) => new Promise((res) => {
  let corps = ''
  req.on('data', (d) => { corps += d })
  req.on('end', () => { try { res(JSON.parse(corps || '{}')) } catch (e) { res({}) } })
})

/** Attach the route to the DSH `webServer` service. Testable without DSH. */
export function monterRoutes (webServerSvc) {
  webServerSvc.register({
    kind: 'exact',
    path: '/kybernos-terminal/run',
    handler: async (req, res) => {
      if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
      if (String(req.method || '').toUpperCase() !== 'POST') { res.writeHead(405); res.end('POST attendu'); return }
      const corps = await lireCorps(req)
      const r = await executer(corps)
      res.writeHead(r.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(r))
    }
  })
}

/** Host entry — same shape as kybernos-sessions: mount now, or when webServer lands. */
export function apply (ctx) {
  try {
    const demarrer = (hostCtx) => {
      monterRoutes(hostCtx.webServer)
      console.log('[kybernos-terminal] route /kybernos-terminal/run enregistree')
    }
    if (ctx.get('webServer') !== undefined) demarrer(ctx)
    else ctx.inject(['webServer'], demarrer)
  } catch (e) {
    console.error('[kybernos-terminal] demarrage hote impossible', e)
  }
}
