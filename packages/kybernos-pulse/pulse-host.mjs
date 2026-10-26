// kybernos-pulse — host: the store, the watcher and the three routes. Nothing here may stop DSH from starting.
//
// Routes (all under /kybernos-pulse/, served BEFORE DSH's own authentication, so each one fences the origin):
//   GET  state      the settings, the inbox, the runs being followed, the unread count and which items deserve a banner
//   POST settings   a patch of the settings (level, banners, badge, muted, mute, unmute)         — write: strict origin AND the session cookie
//   POST inbox      { action: read | read-all | dismiss | banner-shown, id?, ids? }               — write: strict origin AND the session cookie
//
// `createPulse` holds the file's content and takes its I/O as arguments, so the whole thing runs in a test without DSH or a disk.
import { applySettings, emptyState, inboxAction, normalizeSettings, normalizeState, publicView, SETTINGS_VERSION, watchStep } from './pulse-core.mjs'

const normalizeData = (raw) => {
  const r = raw !== null && typeof raw === 'object' ? raw : {}
  return { version: SETTINGS_VERSION, settings: normalizeSettings(r.settings), state: normalizeState(r.state) }
}

export function createPulse ({ read, write, now = () => Date.now() }) {
  let data = null
  let running = []
  const load = () => {
    if (data !== null) return data
    let raw = null
    try { raw = read() } catch (e) { raw = null }
    data = normalizeData(raw)
    return data
  }
  const save = () => { try { write(data) } catch (e) { /* disk full or read-only: the inbox is best effort, never fatal */ } }
  return {
    view () { const d = load(); return publicView({ settings: d.settings, state: d.state, running, now: now() }) },
    patchSettings (patch) {
      const d = load()
      const r = applySettings(d.settings, patch)
      if (r.ok !== true) return r
      d.settings = r.settings
      save()
      return { ok: true, settings: d.settings }
    },
    inbox (body) {
      const d = load()
      const next = inboxAction(d.state.inbox, body)
      if (next === null) return { ok: false, error: 'a known action and an id are expected' }
      d.state.inbox = next
      save()
      return { ok: true }
    },
    /** The watcher's input and its way to hand the result back. */
    snapshot () { const d = load(); return { state: d.state, settings: d.settings } },
    absorb (result) {
      const d = load()
      running = result.running
      // Written only when something moved: a pass every few seconds must not rewrite the file for nothing.
      const before = JSON.stringify(d.state)
      d.state = result.state
      if (JSON.stringify(d.state) !== before) save()
    },
    empty () { return emptyState() }
  }
}

/**
 * The watcher. `readTasks()` gives tasks.json's list, `readRunOf(sessionId)` the readRun() verdict of one session (null when unreadable).
 * A pass never throws: a failure is logged and the next pass tries again.
 */
export function createWatcher ({ pulse, readTasks, readRunOf, now = () => Date.now(), log = () => {} }) {
  let busy = false
  return {
    async tick () {
      if (busy) return false
      busy = true
      try {
        const { state } = pulse.snapshot()
        const tasks = await readTasks()
        const result = await watchStep({ tasks, state, readRunOf, now: now() })
        pulse.absorb(result)
        return true
      } catch (e) {
        try { log('watch pass failed: ' + String(e && e.message ? e.message : e)) } catch (e2) { /* logging is a courtesy */ }
        return false
      } finally { busy = false }
    }
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null)
// DNS rebinding: a page on another name whose DNS answer was switched to 127.0.0.1 reaches this route with its own name as `Host`.
// Plugin routes are served before DSH's authentication, so the Host header must be this machine's own authority, on every route.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
const localHosts = (req) => {
  const port = typeof (req && req.socket && req.socket.localPort) === 'number' ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}
export const hostOk = (req) => {
  try {
    const host = str(req && req.headers && req.headers.host)
    const port = req && req.socket && typeof req.socket.localPort === 'number' ? req.socket.localPort : null
    if (host === null || port === null) return true
    return localHosts(req).includes(host) || kbTrusted(host)
  } catch (e) { return false }
}
/** A read: when an Origin or Referer is present it must be this page's own. */
export const originOk = (req) => {
  try {
    const source = str(req && req.headers && req.headers.origin) || str(req && req.headers && req.headers.referer)
    if (source === null) return true
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return localHosts(req).includes(u.host) || kbTrusted(u.host)
  } catch (e) { return false }
}

const send = (res, status, body) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  } catch (e) { /* socket closed */ }
}
const readBody = async (req, max = 8192) => {
  let size = 0
  const chunks = []
  for await (const c of req) { size += c.length; if (size > max) throw new Error('too-large'); chunks.push(c) }
  return chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
const isJson = (req) => String((req.headers && req.headers['content-type']) || '').toLowerCase().startsWith('application/json')

/** The Mac menu-bar app (helper/) says who it is on each read: `X-Kybernos-Helper: v1; banners=ok|off`. A page cannot send a custom header to
 *  this route without a preflight, which the route never answers, so only a local program can. It is heard for HELPER_FRESH_MS after its last read. */
export const HELPER_HEADER_RE = /^v1; banners=(ok|off)$/
export const HELPER_FRESH_MS = 45000

/** `guard(req)` answers null when the write may go on, or `{ status, error }` (session-guard.mjs's writeGuard). `opts.now` is the clock. */
export function mountRoutes (webServer, pulse, guard, opts = {}) {
  const clock = typeof opts.now === 'function' ? opts.now : Date.now
  let helper = { at: 0, banners: false }
  webServer.register({ kind: 'exact', path: '/kybernos-pulse/state', handler: (req, res) => {
    if (hostOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
    if (originOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
    const said = HELPER_HEADER_RE.exec(str(req.headers && req.headers['x-kybernos-helper']) || '')
    const now = clock()
    if (said !== null) helper = { at: now, banners: said[1] === 'ok' }
    const seen = helper.at > 0 && now - helper.at < HELPER_FRESH_MS
    return send(res, 200, { ok: true, ...pulse.view(), helper: { seen, banners: seen && helper.banners } })
  } })
  const post = (path, run) => webServer.register({ kind: 'exact', path, handler: async (req, res) => {
    if (hostOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method-not-allowed' })
    const refused = guard(req)
    if (refused !== null && refused !== undefined) return send(res, refused.status, { ok: false, error: refused.error })
    if (isJson(req) === false) return send(res, 415, { ok: false, error: 'json-required' })
    let body
    try { body = await readBody(req) } catch (e) { return send(res, 400, { ok: false, error: 'bad-body' }) }
    const r = run(body)
    return send(res, r.ok === true ? 200 : 400, r.ok === true ? { ok: true, ...(r.settings ? { settings: r.settings } : {}) } : { ok: false, error: r.error || 'invalid' })
  } })
  post('/kybernos-pulse/settings', (b) => pulse.patchSettings(b))
  post('/kybernos-pulse/inbox', (b) => pulse.inbox(b))
}
