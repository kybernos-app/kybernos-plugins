// kybernos-mobile: host half.
//
// The bundle is a stylesheet and a menu button. This half only serves the stylesheet:
//
//   (every index render)   mobile.css as <style id="kbmob-sheet"> right after <head>, through DSH's own
//                          `webserver/index-inject` seam, so a phone never paints the desktop layout first
//                          (on a slow link the shell can be on screen long before the plugin bundles are)
//   GET /kybernos-mobile/mobile.css   the same file, for the browser half to link when the seam did not deliver it
//   (every index render)   the head tags of an installed copy (manifest, home-screen icon, iOS web-app tags), and
//   GET /kybernos-mobile/pwa/<file>   the manifest and the icons they point at (pwa.mjs). KYBERNOS_MOBILE_PWA=0 turns both off.
//   (every index render)   the display mode: the sheet's rules and the few lines that put `kb-simple` and `data-kb-mode` on <html> before the first paint, with the account's choice (mode.mjs), and
//   GET|POST /kybernos-mobile/mode   the person's choice (Auto, Simple, Complete), kept per account in the DSH folder (mode-store.mjs); on the phone's own engine too.
//
// Rules this file keeps: it only touches plugin seams (ctx.on, ctx.effect, the web server service), patches nothing in
// the engine, and no failure escapes apply(): a missing service, an unreadable file or a refused row is logged and
// the rest still starts.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHome, writeGuard } from './session-guard.mjs'
import { FILES as PWA_FILES, PWA_PREFIX, pwaRows, servePwa } from './pwa.mjs'
import { KABY_ROUTE, kabyCss, kabyRows } from './kaby-mode.mjs'
import { MODE_ROUTE, modeRows } from './mode.mjs'
import { modePath, parseBody, readMode, writeMode, MAX_BODY } from './mode-store.mjs'

export const name = 'kybernos-mobile'
export const SHEET_ID = 'kbmob-sheet'
export const ROUTE = '/kybernos-mobile/mobile.css'
const here = dirname(fileURLToPath(import.meta.url))
export const CSS_FILE = join(here, 'mobile.css')
export const BOOT_ID = 'kbmob-boot'
export const BOOT_FILE = join(here, 'boot.css')
// The licences of what the phone app ships: kybernos-host/payload/build-payload.mjs writes THIRD-PARTY-NOTICES.txt into the payload and the bootstrap names the unpacked folder KB_RUNTIME.
export const NOTICES_ROUTE = '/kybernos-mobile/notices'
export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt'
const NOTICES_MAX = 8 * 1024 * 1024

const logError = (what, e) => { try { if (e === undefined) console.error('[kybernos-mobile] ' + what); else console.error('[kybernos-mobile] ' + what, e) } catch (e2) { /* console unavailable */ } }

// The stylesheet, kept in memory and re-read when the file changes on disk (a style edit reaches the next page load
// without restarting DSH); `null` = not read yet, `''` = unreadable (nothing is injected then).
const cache = new Map()
export const resetCache = () => { cache.clear() }
const readCached = (file, label) => {
  let at = 0
  try { at = statSync(file).mtimeMs } catch (e) { at = -1 }
  const hit = cache.get(file)
  if (hit !== undefined && (at === hit.at || at === -1)) return hit.css
  try { cache.set(file, { css: readFileSync(file, 'utf8'), at }); return cache.get(file).css } catch (e) { if (hit !== undefined) return hit.css; logError(label + ' unreadable', e); cache.set(file, { css: '', at }); return '' }
}
export function sheetCss (file = CSS_FILE) { return readCached(file, 'mobile.css') }
/** One head row per index render. `</style` inside the file would close the element early: refused. */
export function sheetRows (file = CSS_FILE) {
  const css = sheetCss(file)
  if (css === '' || /<\/style/i.test(css)) return []
  return [{ kind: 'html', placement: 'head', html: '<style id="' + SHEET_ID + '">' + css + '</style>' }]
}
/** The engine's loading card (boot.css), at every width: a row of its own, so the phone sheet stays "a phone" and one failing never costs the other. */
export function bootRows (file = BOOT_FILE) {
  const css = readCached(file, 'boot.css')
  if (css === '' || /<\/style/i.test(css)) return []
  return [{ kind: 'html', placement: 'head', html: '<style id="' + BOOT_ID + '">' + css + '</style>' }]
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

/** What the host reads and writes for the mode store: the real disk. Replaced by the tests. */
export const MODE_FS = {
  readFile: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, text, mode) => writeFileSync(p, text, { mode }),
  rename: (a, b) => renameSync(a, b),
  mkdir: (d) => mkdirSync(d, { recursive: true, mode: 0o700 }),
}
const sendJson = (res, status, body) => { try { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)) } catch (e) { /* socket closed */ } }
const readBody = (req, max, done) => {
  let raw = ''
  let over = false
  req.on('data', (c) => { if (over) return; raw += c; if (raw.length > max) { over = true; done(null) } })
  req.on('end', () => { if (!over) done(raw) })
  req.on('error', () => { if (!over) { over = true; done(null) } })
}

/**
 * The person's display choice (Auto, Simple, Complete), kept per account in the DSH folder. A read is behind the Host fence and a same-origin page; a write needs a strict same-origin request
 * AND DSH's signed browser session (`writeGuard`, like every write route of the repo), and a write that came through the phone link is refused. Never throws; the page keeps its own copy when this fails.
 */
export function serveMode (req, res, options = {}) {
  try {
    const fs = options.fs || MODE_FS
    const home = options.home !== undefined ? options.home : dshHome()
    if (hostOK(req) !== true) return sendJson(res, 403, { ok: false, error: 'origin-refused' })
    const path = modePath(home, (...parts) => parts.join('/'))
    if (req.method === 'GET') {
      if (sameOriginLax(req) !== true) return sendJson(res, 403, { ok: false, error: 'origin-refused' })
      return sendJson(res, 200, { ok: true, ...readMode(path, fs) })
    }
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
    if (sameOriginStrict(req) !== true) return sendJson(res, 403, { ok: false, error: 'origin-refused' })
    // The write is the account's, so it carries the pair the repo's rule asks for (docs/dev/route-origin-rule.md): the page's own Origin AND DSH's signed browser session. A write that came through the
    // phone link is refused like the link's own writes; that page keeps its choice on its own device and nothing else is lost.
    const refused = writeGuard(req)
    if (refused !== null) return sendJson(res, refused.status, { ok: false, error: refused.error })
    readBody(req, MAX_BODY, (raw) => {
      try {
        const body = raw === null ? null : parseBody(raw)
        if (body === null) return sendJson(res, 400, { ok: false, error: 'bad-body' })
        const r = writeMode(path, body, fs)
        sendJson(res, r.ok ? 200 : (r.error === 'bad-pref' ? 400 : 500), r.ok ? { ok: true, applied: r.applied, ...r.doc } : { ok: false, error: r.error, ...r.doc })
      } catch (e) { sendJson(res, 500, { ok: false, error: 'internal' }) }
    })
    return undefined
  } catch (e) { return sendJson(res, 500, { ok: false, error: 'internal' }) }
}

/** Kaby mode's stylesheet (generated from kaby-mode.mjs), for the browser half to link when the head row did not reach the page. Same fences as mobile.css; it changes nothing without the class the shell's user agent asks for. */
export function serveKaby (req, res) {
  try {
    if (hostOK(req) !== true || sameOriginLax(req) !== true) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('origin refused'); return }
    if (req.method !== 'GET') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' }); res.end('GET expected'); return }
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' })
    res.end(kabyCss())
  } catch (e) { try { res.writeHead(500); res.end('') } catch (e2) { /* socket closed */ } }
}

// The web-app layer (manifest, icons, iOS tags) is on unless KYBERNOS_MOBILE_PWA=0; its routes use the stylesheet's fences.
export const pwaEnabled = () => process.env.KYBERNOS_MOBILE_PWA !== '0'
const pwaFence = (req) => hostOK(req) === true && sameOriginLax(req) === true

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

/** The list of open-source components, as plain text. Only inside the phone app (the engine there has KB_RUNTIME); anywhere else it is not found. A read, behind the Host fence. */
export function serveNotices (req, res, dir = process.env.KB_RUNTIME) {
  try {
    if (hostOK(req) !== true || sameOriginLax(req) !== true) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('origin refused'); return }
    if (req.method !== 'GET') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' }); res.end('GET expected'); return }
    let text = ''
    try { const f = join(typeof dir === 'string' ? dir : '', NOTICES_FILE); if (typeof dir === 'string' && dir !== '' && statSync(f).size <= NOTICES_MAX) text = readFileSync(f, 'utf8') } catch (e) { text = '' }
    if (text === '') { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('notices not found'); return }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' })
    res.end(text)
  } catch (e) { try { res.writeHead(500); res.end('') } catch (e2) { /* socket closed */ } }
}

// ── The remote half: QR pairing and the relay link ───────────────────────────────────────────────────────────────────
// Its routes are the person's gestures (the « Phone and channels » screen: the account menu's window and Settings › Phone and channels). They are registered here,
// synchronously and behind the Host and Origin fences, but their answers come from `remote-mount.mjs`, loaded lazily
// and inside its own try/catch: a failure there can never reach the phone layout above or stop DSH from starting.
export const REMOTE_PREFIX = '/kybernos-mobile/remote/'
export const REMOTE_ROUTES = Object.freeze({
  status: 'GET', enable: 'POST', pair: 'POST', 'pair/approve': 'POST', 'pair/deny': 'POST', 'pair/cancel': 'POST', 'devices/revoke': 'POST', 'devices/revoke-all': 'POST',
})
export const TUNNEL_HEADER = 'x-kybernos-tunnel'

/** A request that arrived through the phone link carries this marker (set by the remote half, never by a phone): a phone
 *  never manages phones, so these routes refuse it. */
export const tunnelled = (req) => { try { return req.headers !== null && req.headers !== undefined && req.headers[TUNNEL_HEADER] !== undefined } catch (e) { return true } }

// Every route here shows or changes who can reach this computer: an Origin or a Referer is required and must be this page's. The routes that CHANGE it (the POSTs: enable, pair,
// approve, deny, cancel, revoke) also need DSH's signed session (`writeGuard`): an Origin is forgeable by any local program, and `pair` then `pair/approve` would link a stranger's phone.
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
    if (want !== 'GET') {
      const refused = writeGuard(req)
      if (refused !== null) return refuse(res, refused.status, refused.error)
    }
    loadRemote().then((m) => m.route(name, req, res)).catch((e) => { logError('remote half unavailable', e); refuse(res, 503, 'remote-unavailable') })
  } catch (e) { refuse(res, 500, 'internal') }
}

/** True where this engine runs inside the Kybernos phone app (the embedded Node reports `ios` or `android`): the phone IS the device, so there is no computer to link a phone to. */
export const onPhoneHost = (platform = process.platform) => platform === 'ios' || platform === 'android'

/** System-prompt runtime context injected for every chat on the phone engine (ios/android only), via `systemPrompt.context`. */
export const PHONE_PROMPT_NAME = 'kybernos:phone-runtime'
export const PHONE_PROMPT_ORDER = 115
export const PHONE_RUNTIME_PROMPT = [
  '[PHONE RUNTIME]',
  'You are running inside the Kybernos app on a phone (iOS or Android).',
  'This phone environment cannot start external programs, subprocesses, or standalone CLIs (such as Node, Python, Git, Docker, or other external binaries); only the built-in in-process tools are available here.',
  'Do not propose, attempt, or retry external CLI commands that require spawning a program on this device.',
  'When a task requires Node, a CLI, or external programs, explain plainly in the person’s language that this phone cannot run external programs and that they need to connect or choose a remote or cloud Kybernos computer.',
  'Never claim or promise that a command or task will be routed to a computer automatically.',
  '[/PHONE RUNTIME]',
].join('\n')

export function apply (ctx, options = {}) {
  // Inside the phone app only the layout is wanted: no link routes, no relay (the browser half shows the app's own settings page instead).
  const phone = onPhoneHost(options.platform)
  // On the phone engine (ios/android only), tell every chat about the phone runtime limits via `systemPrompt.context`. Fail-open: never stop DSH from starting.
  if (phone) {
    try {
      const mountPrompt = (sp) => {
        if (sp === undefined || sp === null || typeof sp.context !== 'function') return
        ctx.effect(() => sp.context({ name: PHONE_PROMPT_NAME, order: PHONE_PROMPT_ORDER, text: () => PHONE_RUNTIME_PROMPT }), 'kybernos-mobile: phone runtime prompt')
      }
      const sp = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined
      if (sp !== undefined && sp !== null) mountPrompt(sp)
      else if (typeof ctx.inject === 'function') ctx.inject(['systemPrompt'], (scope) => { try { mountPrompt(scope && scope.systemPrompt) } catch (e) { logError('phone runtime prompt not mounted', e) } })
    } catch (e) { logError('phone runtime prompt not mounted', e) }
  }
  // A failure here must never stop DSH from starting: log it and let the rest go on.
  try {
    ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
      // Two rows from two sources: one failing never costs the other. The tags go first (they are small).
      if (pwaEnabled()) { try { table.push(...pwaRows()) } catch (e) { logError('web-app tags not injected', e) } }
      try { table.push(...sheetRows()) } catch (e) { logError('stylesheet not injected', e) }
      try { table.push(...bootRows()) } catch (e) { logError('loading card not injected', e) }
      // The display mode (Auto, Simple, Complete), resolved before the first paint: the technical view's rules (below) follow its class. The account's choice is read from the store here, at every render.
      try { table.push(...modeRows(readMode(modePath(dshHome(), (...parts) => parts.join('/')), MODE_FS))) } catch (e) { logError('display mode not injected', e) }
      // Kaby mode: the rules and the early class, inert unless the shell's user agent asks for it. Last, so that its rules come after the layout's.
      try { table.push(...kabyRows()) } catch (e) { logError('kaby mode not injected', e) }
    }), 'kybernos-mobile: stylesheet')
  } catch (e) { logError('index injection not mounted', e) }
  try {
    const mount = (svc) => {
      try { ctx.effect(() => svc.register({ kind: 'exact', path: ROUTE, handler: (req, res) => serveSheet(req, res) }), 'kybernos-mobile: route stylesheet') } catch (e) { logError('route not mounted', e) }
      try { ctx.effect(() => svc.register({ kind: 'exact', path: KABY_ROUTE, handler: (req, res) => serveKaby(req, res) }), 'kybernos-mobile: route kaby mode stylesheet') } catch (e) { logError('kaby route not mounted', e) }
      // The display choice, on every engine (the phone's own included): it is the account's, not the layout's.
      try { ctx.effect(() => svc.register({ kind: 'exact', path: MODE_ROUTE, handler: (req, res) => serveMode(req, res) }), 'kybernos-mobile: route display mode') } catch (e) { logError('display mode route not mounted', e) }
      // The list of open-source components: only inside the phone app, and apart from the stylesheet so neither can take the other down.
      if (phone) {
        try { ctx.effect(() => svc.register({ kind: 'exact', path: NOTICES_ROUTE, handler: (req, res) => serveNotices(req, res) }), 'kybernos-mobile: route notices') } catch (e) { logError('notices route not mounted', e) }
        return
      }
      // The manifest and the icons of an installed copy: the same fences as the stylesheet (Host, and Origin when there is one).
      if (pwaEnabled()) {
        for (const file of PWA_FILES) {
          try { ctx.effect(() => svc.register({ kind: 'exact', path: PWA_PREFIX + file, handler: (req, res) => servePwa(file, req, res, pwaFence) }), 'kybernos-mobile: route pwa ' + file) } catch (e) { logError('pwa route not mounted', e) }
        }
      }
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
  if (process.env.KYBERNOS_MOBILE_REMOTE === '0' || phone) return
  try {
    ctx.effect(() => {
      let live = true
      let mod = null
      loadRemote().then((m) => { if (live !== true) return undefined; mod = m; return m.start(ctx) }).catch((e) => logError('remote link not started', e))
      return () => { live = false; try { if (mod !== null) mod.stop() } catch (e) { /* closing */ } }
    }, 'kybernos-mobile: remote link')
  } catch (e) { logError('remote link not mounted', e) }
}
