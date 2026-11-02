// kybernos-usage — host: the store and the three routes.
//
// Routes (all under /kybernos-usage/, served BEFORE DSH's own authentication, so each one fences the origin):
//   GET  summary?days=N   the ledger in tokens (page and chip price it themselves)
//   POST observe          { sessionId, provider, model, title?, usage } cumulative counters of one session
//   POST budget           { usd: number|null, alert: boolean }
//
// `createStore` holds the ledger and takes its I/O as arguments, so the whole thing runs in a test without DSH or a disk.
import { applyObservation, normalise, setBudget, summarize, emptyLedger } from './usage-ledger.mjs'

export function createStore ({ read, write, now = () => new Date() }) {
  let ledger = null
  const load = () => {
    if (ledger !== null) return ledger
    try { ledger = normalise(read()) } catch (e) { ledger = emptyLedger() }
    return ledger
  }
  const save = () => { try { write(ledger) } catch (e) { /* disk full or read-only: tracking is best effort, never fatal */ } }
  return {
    observe (obs) {
      const l = load()
      const r = applyObservation(l, obs, now())
      if (r.ok === true && r.changed === true) save()
      return r
    },
    budget (body) {
      const l = load()
      const r = setBudget(l, body)
      if (r.ok === true) save()
      return r
    },
    summary (days) { return summarize(load(), { days, now: now() }) },
  }
}

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
/** strict: an Origin or Referer MUST be present and be this page's own. Not strict: when present it must match. */
export const originOk = (req, strict) => {
  try {
    const source = str(req && req.headers && req.headers.origin) || str(req && req.headers && req.headers.referer)
    if (source === null) return strict === false
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
const readBody = async (req, max = 4096) => {
  let size = 0
  const chunks = []
  for await (const c of req) { size += c.length; if (size > max) throw new Error('too-large'); chunks.push(c) }
  return chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
const isJson = (req) => String((req.headers && req.headers['content-type']) || '').toLowerCase().startsWith('application/json')

export function mountRoutes (webServer, store) {
  const post = (path, run) => webServer.register({ kind: 'exact', path, handler: async (req, res) => {
    if (hostOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method-not-allowed' })
    if (originOk(req, true) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
    if (isJson(req) === false) return send(res, 415, { ok: false, error: 'json-required' })
    let body
    try { body = await readBody(req) } catch (e) { return send(res, 400, { ok: false, error: 'bad-body' }) }
    const r = run(body)
    return send(res, r.ok === true ? 200 : 400, r.ok === true ? { ok: true, ...(r.budget ? { budget: r.budget } : {}) } : { ok: false, error: r.reason || 'invalid' })
  } })
  post('/kybernos-usage/observe', (b) => store.observe(b))
  post('/kybernos-usage/budget', (b) => store.budget(b))
  webServer.register({ kind: 'exact', path: '/kybernos-usage/summary', handler: (req, res) => {
    if (hostOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
    if (originOk(req, false) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
    let days = 30
    try { days = Number(new URL('http://x' + (req.url || '/')).searchParams.get('days')) || 30 } catch (e) { days = 30 }
    return send(res, 200, { ok: true, ...store.summary(days) })
  } })
}
