// kybernos-theme: host half.
//
// The browser half does the theming itself (design tokens, wallpaper, font, thinking
// loader), and keeps its settings in localStorage. This half exists because
// localStorage is not durable enough for what the user builds there (DSH Desktop
// uses random ports, so every launch can be a new origin) and because three things
// need the host:
//
//   GET|POST /kybernos-theme/loader-store   the user's loaders, loader settings and
//        loading words, on disk under <dsh home>/kybernos (see loader-store.mjs)
//   GET|POST /kybernos-theme/preset-store   the user's theme library ("My themes"), one
//        JSON document under <dsh home>/kybernos (see preset-store.mjs)
//   GET|POST /kybernos-theme/gallery   the theme gallery: the shipped catalogue (gallery.json) or the
//        signed online one, verified and cached under <dsh home>/kybernos (see themes-gallery.mjs)
//   POST     /kybernos-theme/boot   what the browser half applies (token layer, font), kept under
//        <dsh home>/kybernos and put into every index render through DSH's `webserver/index-inject`
//        seam as a `<style id="kbth-boot">`, so a themed page paints its own colours on the first
//        frame instead of flashing DSH's default (see boot-store.mjs)
//   GET      /kybernos-theme/vendor/lottie.js   the vendored Lottie runtime
//        (vendor/lottie_light.min.js, MIT, see vendor/NOTICES.md), served locally so
//        nothing is fetched from a CDN
//   (at start) the `loader` and `loading-text` skills are copied into
//        <dsh home>/skills (see seed-skills.mjs)
//
// Rules this file keeps: it only touches the plugin seams (ctx.inject, ctx.effect),
// patches nothing in the engine, and no failure escapes apply(): a missing service, a
// route that cannot be registered or a skill that cannot be copied is logged and the
// rest still starts. Not yet built: the wallpaper in the boot sheet (it is a div the browser
// half adds, so it still appears with the bundle).
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveLoaderStore } from './loader-store.mjs'
import { servePresetStore } from './preset-store.mjs'
import { loadKeys, loadShipped, serveGallery } from './themes-gallery.mjs'
import { seedSkills } from './seed-skills.mjs'
import { BOOT_ID, readBoot, renderBootCss, serveBoot } from './boot-store.mjs'
// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs). DSH serves plugin routes BEFORE its own authentication, and a page that rebinds its own name to this machine
// (DNS rebinding) reaches them with its own name as Host, no cookie and, on a same-origin GET, no Origin (a browser sends none): a guard that looks at the
// Origin alone lets every read through. Every route of this bundle refuses a Host that is not this listener's (the port the socket is bound to, on
// 127.0.0.1 / localhost / [::1], or an authority declared with --trusted-host) before its own guard runs. A request with no socket (a test) is not judged.
const kbHostOK = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}
const kbFenced = (service) => {
  if (service === null || service === undefined || typeof service.register !== 'function') return service
  const fence = (route) => (route !== null && typeof route === 'object' && typeof route.handler === 'function'
    ? Object.assign({}, route, {
      handler: (req, res, ...rest) => {
        if (kbHostOK(req) !== true) {
          try { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"ok":false,"error":"origin refused"}') } catch (e) { /* closed */ }
          return undefined
        }
        return route.handler(req, res, ...rest)
      },
    })
    : route)
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => target.register(fence(route)) : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

const here = dirname(fileURLToPath(import.meta.url))
export const LOTTIE_FILE = join(here, 'vendor', 'lottie_light.min.js')
export const SKILLS_DIR = join(here, 'skills')
export const GALLERY_FILE = join(here, 'gallery.json')
export const THEMES_KEYS_FILE = join(here, 'themes-pubkey.json')
export const SEEDED_SKILLS = ['loader', 'loading-text']
export const ROUTES = { store: '/kybernos-theme/loader-store', presets: '/kybernos-theme/preset-store', gallery: '/kybernos-theme/gallery', boot: '/kybernos-theme/boot', lottie: '/kybernos-theme/vendor/lottie.js' }

const logError = (what, e) => { try { if (e === undefined) console.error('[kybernos-theme] ' + what); else console.error('[kybernos-theme] ' + what, e) } catch (e2) { /* console unavailable */ } }
const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null)

/**
 * The DSH home, the way DSH resolves it (dsh-home-paths) and kybernos-plugin does:
 * DSH_HOME when set (`~` expanded), else <home of the OS user>/.dsh. null only when
 * even that is unknown.
 */
export function resolveDshHome(env = process.env, osHome = homedir) {
  try {
    const fromEnv = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
    if (fromEnv !== '') {
      if (fromEnv === '~') return osHome()
      return resolve(fromEnv.startsWith('~/') ? join(osHome(), fromEnv.slice(2)) : fromEnv)
    }
    const base = str(env.HOME) ?? str(osHome())
    return base === null ? null : join(base, '.dsh')
  } catch (e) { return null }
}
export const dshHomeOrNull = async () => resolveDshHome()

// ── local copies of the helpers the other Kybernos plugins use ──────────────────
const sendJson = (res, status, payload) => {
  try {
    const body = JSON.stringify(payload === undefined ? null : payload)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  } catch (e) { try { res.writeHead(500); res.end('{}') } catch (e2) { /* socket closed */ } }
}
// A plugin route is served BEFORE DSH's own authentication, so each route guards itself.
// Strict (writes): an Origin or Referer is required and must be this server's own address.
// Lax (reads): no Origin/Referer is fine (direct navigation, <script src>); a foreign one is not.
const hostsOf = (req) => {
  const port = req.socket && typeof req.socket.localPort === 'number' ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}
const sourceOf = (req) => {
  const h = req && req.headers ? req.headers : {}
  return str(h.origin) ?? str(h.referer)
}
export const sameOriginStrict = (req) => {
  try {
    const source = sourceOf(req)
    if (source === null) return false
    const u = new URL(source)
    return (u.protocol === 'http:' || u.protocol === 'https:') && (hostsOf(req).indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch (e) { return false }
}
export const sameOriginLax = (req) => {
  try {
    const source = sourceOf(req)
    if (source === null) return true
    const u = new URL(source)
    return (u.protocol === 'http:' || u.protocol === 'https:') && (hostsOf(req).indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch (e) { return true }
}
const readJsonBody = async (req, maxBytes) => {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (e) { return {} }
}

// ── the Lottie runtime ───────────────────────────────────────────────────────────
let lottieCache = { key: '', body: null, etag: '' }
const etagMatches = (header, etag) => typeof header === 'string' && header.split(',').some((t) => {
  const v = t.trim().replace(/^W\//, '')
  return v === '*' || v === etag
})
export function serveLottie(req, res, file = LOTTIE_FILE) {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET expected' })
  if (sameOriginLax(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
  let cached = null
  try {
    const st = statSync(file)
    const key = file + ':' + st.mtimeMs + ':' + st.size
    if (lottieCache.key !== key) {
      const body = readFileSync(file)
      lottieCache = { key, body, etag: '"' + createHash('sha256').update(body).digest('hex').slice(0, 32) + '"' }
    }
    cached = lottieCache
  } catch (e) { return sendJson(res, 404, { ok: false, error: 'lottie runtime not found' }) }
  // Revalidated by ETag after a week: the URL carries no version, so an immutable year would pin an old runtime.
  const headers = { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=604800', etag: cached.etag, 'x-content-type-options': 'nosniff' }
  try {
    if (etagMatches(req.headers && req.headers['if-none-match'], cached.etag)) {
      res.writeHead(304, headers)
      res.end()
      return
    }
    res.writeHead(200, Object.assign({ 'content-length': String(cached.body.length) }, headers))
    res.end(cached.body)
  } catch (e) { /* socket closed */ }
}

// ── the boot sheet ─────────────────────────────────────────────────────────────
// The CSS text of the last snapshot the browser half posted (read from disk on the first index render, then kept).
// `null` = not read yet; `''` = nothing to paint early.
let bootCss = null
export const resetBootSheet = () => { bootCss = null }
const loadBootCss = () => {
  const home = resolveDshHome()
  if (home === null) return ''
  const snapshot = readBoot(join(home, 'kybernos'))
  return snapshot === null ? '' : renderBootCss(snapshot)
}
/** One row per index render, straight after `<head>`: DSH's own theme bootstrap uses the same seam. */
export function bootSheetRows() {
  if (bootCss === null) bootCss = loadBootCss()
  return bootCss === '' ? [] : [{ kind: 'html', placement: 'head', html: '<style id="' + BOOT_ID + '">' + bootCss + '</style>' }]
}
function mountBootSheet(ctx) {
  ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
    // The page must still be served when the sheet cannot be read or built.
    try { table.push(...bootSheetRows()) } catch (e) { logError('boot sheet not injected', e) }
  }), 'kybernos-theme: boot sheet')
}

// ── wiring ───────────────────────────────────────────────────────────────────────
function mountRoutes(ctx, webServerSvc) {
  webServerSvc = kbFenced(webServerSvc)
  if (webServerSvc === undefined || webServerSvc === null || typeof webServerSvc.register !== 'function') {
    logError('webServer service missing: routes /kybernos-theme/* not mounted')
    return
  }
  // The exact-route table is keyed by path alone, so GET and POST share one handler.
  const mount = (path, handler, label) => {
    try {
      ctx.effect(() => webServerSvc.register({ kind: 'exact', path, handler }), label)
    } catch (e) { logError('route ' + path + ' not mounted', e) }
  }
  mount(ROUTES.store, (req, res) => serveLoaderStore(req, res, {
    home: dshHomeOrNull, sameOriginStrict, sameOriginLax, readJson: readJsonBody, send: sendJson,
  }), 'kybernos-theme: route loader-store')
  mount(ROUTES.presets, (req, res) => servePresetStore(req, res, {
    home: dshHomeOrNull, sameOriginStrict, sameOriginLax, readJson: readJsonBody, send: sendJson,
  }), 'kybernos-theme: route preset-store')
  mount(ROUTES.gallery, (req, res) => serveGallery(req, res, {
    home: dshHomeOrNull, sameOriginStrict, sameOriginLax, readJson: readJsonBody, send: sendJson,
    shipped: () => loadShipped(GALLERY_FILE), keys: () => loadKeys(THEMES_KEYS_FILE),
  }), 'kybernos-theme: route gallery')
  mount(ROUTES.boot, (req, res) => serveBoot(req, res, {
    home: dshHomeOrNull, sameOriginStrict, readJson: readJsonBody, send: sendJson, changed: (css) => { bootCss = css },
  }), 'kybernos-theme: route boot')
  mount(ROUTES.lottie, (req, res) => serveLottie(req, res), 'kybernos-theme: route vendor lottie')
}

function seedOwnSkills() {
  const home = resolveDshHome()
  if (home === null) return
  for (const r of seedSkills({ home, sourceDir: SKILLS_DIR, names: SEEDED_SKILLS })) {
    if (r.action === 'created' || r.action === 'updated') console.log('[kybernos-theme] skill ' + r.name + ' ' + r.action)
    else if (r.action === 'error' || r.action === 'no-source' || r.action === 'invalid-name') logError('skill ' + r.name + ' not installed: ' + (r.error ?? r.action))
  }
}

export function apply(ctx) {
  // A failure here must never stop DSH from starting: log it and let the rest go on.
  try {
    ctx.inject(['webServer'], (hostCtx) => {
      try {
        mountRoutes(hostCtx, hostCtx.get('webServer'))
      } catch (e) { logError('route mounting failed', e) }
    })
  } catch (e) { logError('start failed: routes /kybernos-theme/* not mounted', e) }
  try {
    mountBootSheet(ctx)
  } catch (e) { logError('boot sheet not mounted', e) }
  try {
    seedOwnSkills()
  } catch (e) { logError('skills not installed', e) }
}
