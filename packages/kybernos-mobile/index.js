// kybernos-mobile: host half.
//
// The bundle is a stylesheet and a menu button. This half only serves the stylesheet:
//
//   (every index render)   mobile.css as <style id="kbmob-sheet"> right after <head>, through DSH's own
//                          `webserver/index-inject` seam, so a phone never paints the desktop layout first
//                          (on a slow link the shell can be on screen long before the plugin bundles are)
//   GET /kybernos-mobile/mobile.css   the same file, for the browser half to link when the seam did not deliver it
//
// Rules this file keeps: it only touches plugin seams (ctx.on, ctx.effect, the web server service), patches nothing in
// the engine, and no failure escapes apply(): a missing service, an unreadable file or a refused row is logged and
// the rest still starts.
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'kybernos-mobile'
export const SHEET_ID = 'kbmob-sheet'
export const ROUTE = '/kybernos-mobile/mobile.css'
const here = dirname(fileURLToPath(import.meta.url))
export const CSS_FILE = join(here, 'mobile.css')

const logError = (what, e) => { try { if (e === undefined) console.error('[kybernos-mobile] ' + what); else console.error('[kybernos-mobile] ' + what, e) } catch (e2) { /* console unavailable */ } }

// The stylesheet, kept in memory and re-read when the file changes on disk (a style edit reaches the next page load
// without restarting DSH); `null` = not read yet, `''` = unreadable (nothing is injected then).
let cached = null
let cachedAt = 0
export const resetCache = () => { cached = null; cachedAt = 0 }
export function sheetCss (file = CSS_FILE) {
  let at = 0
  try { at = statSync(file).mtimeMs } catch (e) { at = -1 }
  if (cached !== null && (at === cachedAt || at === -1)) return cached
  try { cached = readFileSync(file, 'utf8'); cachedAt = at } catch (e) { if (cached === null) { logError('mobile.css unreadable', e); cached = '' } }
  return cached
}
/** One head row per index render. `</style` inside the file would close the element early: refused. */
export function sheetRows (file = CSS_FILE) {
  const css = sheetCss(file)
  if (css === '' || /<\/style/i.test(css)) return []
  return [{ kind: 'html', placement: 'head', html: '<style id="' + SHEET_ID + '">' + css + '</style>' }]
}

// Host fence (scripts/test-route-hosts.mjs): DSH serves plugin routes BEFORE its own authentication, so a page that
// rebinds its own name to this machine reaches them with its own name as Host. A Host that is not this listener's
// (loopback + the socket's real port, or an authority declared with --trusted-host) is refused before anything else.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
const hostOK = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}

// A read: no Origin or Referer is fine (a <link> in the page, a direct navigation); a foreign one is not.
export const sameOriginLax = (req) => {
  try {
    const h = req.headers !== null && req.headers !== undefined ? req.headers : {}
    const source = typeof h.origin === 'string' && h.origin !== '' ? h.origin : (typeof h.referer === 'string' && h.referer !== '' ? h.referer : null)
    if (source === null) return true
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = req.socket !== null && req.socket !== undefined && typeof req.socket.localPort === 'number' ? ':' + req.socket.localPort : ''
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch (e) { return true }
}

export function serveSheet (req, res, file = CSS_FILE) {
  try {
    if (hostOK(req) !== true || sameOriginLax(req) !== true) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('origin refused'); return }
    if (req.method !== 'GET') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' }); res.end('GET expected'); return }
    const css = sheetCss(file)
    if (css === '') { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('stylesheet not found'); return }
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' })
    res.end(css)
  } catch (e) { try { res.writeHead(500); res.end('') } catch (e2) { /* socket closed */ } }
}

// ── The remote half: QR pairing and the relay link ───────────────────────────────────────────────────────────────────
// Its routes are the person's gestures (Settings › Remote Control and the sidebar's phone panel). They are registered here,
// synchronously and behind the Host and Origin fences, but their answers come from `remote-mount.mjs`, loaded lazily
// and inside its own try/catch: a failure there can never reach the phone layout above or stop DSH from starting.
export const REMOTE_PREFIX = '/kybernos-mobile/remote/'
export const REMOTE_ROUTES = Object.freeze({
  status: 'GET', pair: 'POST', 'pair/approve': 'POST', 'pair/deny': 'POST', 'pair/cancel': 'POST', 'devices/revoke': 'POST', 'devices/revoke-all': 'POST',
})
export const TUNNEL_HEADER = 'x-kybernos-tunnel'

/** A request that arrived through the phone link carries this marker (set by the remote half, never by a phone): a phone
 *  never manages phones, so these routes refuse it. */
export const tunnelled = (req) => { try { return req.headers !== null && req.headers !== undefined && req.headers[TUNNEL_HEADER] !== undefined } catch (e) { return true } }

// Every route here shows or changes who can reach this computer: an Origin or a Referer is required and must be this page's.
export const sameOriginStrict = (req) => {
  try {
    const h = req.headers !== null && req.headers !== undefined ? req.headers : {}
    const source = typeof h.origin === 'string' && h.origin !== '' ? h.origin : (typeof h.referer === 'string' && h.referer !== '' ? h.referer : null)
    if (source === null) return false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = req.socket !== null && req.socket !== undefined && typeof req.socket.localPort === 'number' ? ':' + req.socket.localPort : ''
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch (e) { return false }
}

let remoteModule = null
const loadRemote = () => { if (remoteModule === null) remoteModule = import('./remote-mount.mjs'); return remoteModule }
const refuse = (res, status, error) => { try { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: false, error })) } catch (e) { /* socket closed */ } }

export function serveRemote (name, req, res) {
  try {
    if (hostOK(req) !== true) return refuse(res, 403, 'origin-refused')
    if (tunnelled(req) === true) return refuse(res, 403, 'refused-on-phone')
    const want = REMOTE_ROUTES[name]
    if (want === undefined) return refuse(res, 404, 'not-found')
    if (req.method !== want) return refuse(res, 405, 'method-not-allowed')
    if (sameOriginStrict(req) !== true) return refuse(res, 403, 'origin-refused')
    loadRemote().then((m) => m.route(name, req, res)).catch((e) => { logError('remote half unavailable', e); refuse(res, 503, 'remote-unavailable') })
  } catch (e) { refuse(res, 500, 'internal') }
}

export function apply (ctx) {
  // A failure here must never stop DSH from starting: log it and let the rest go on.
  try {
    ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
      try { table.push(...sheetRows()) } catch (e) { logError('stylesheet not injected', e) }
    }), 'kybernos-mobile: stylesheet')
  } catch (e) { logError('index injection not mounted', e) }
  try {
    const mount = (svc) => {
      try { ctx.effect(() => svc.register({ kind: 'exact', path: ROUTE, handler: (req, res) => serveSheet(req, res) }), 'kybernos-mobile: route stylesheet') } catch (e) { logError('route not mounted', e) }
      // The remote half's routes: separate from the stylesheet's, so one cannot take the other down.
      for (const name of Object.keys(REMOTE_ROUTES)) {
        try { ctx.effect(() => svc.register({ kind: 'exact', path: REMOTE_PREFIX + name, handler: (req, res) => serveRemote(name, req, res) }), 'kybernos-mobile: route remote ' + name) } catch (e) { logError('remote route not mounted', e) }
      }
    }
    const svc = ctx.get('webServer')
    if (svc !== undefined && svc !== null) mount(svc)
    else ctx.inject(['webServer'], (host) => { try { mount(host.webServer) } catch (e) { logError('route not mounted', e) } })
  } catch (e) { logError('start failed: route not mounted', e) }
  // The link itself: reconnects the phones paired earlier. With none paired this reads one file and does nothing else.
  if (process.env.KYBERNOS_MOBILE_REMOTE === '0') return
  try {
    ctx.effect(() => {
      let live = true
      let mod = null
      loadRemote().then((m) => { if (live !== true) return undefined; mod = m; return m.start(ctx) }).catch((e) => logError('remote link not started', e))
      return () => { live = false; try { if (mod !== null) mod.stop() } catch (e) { /* closing */ } }
    }, 'kybernos-mobile: remote link')
  } catch (e) { logError('remote link not mounted', e) }
}
