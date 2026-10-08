// kybernos-call: the HTTP routes of a call, testable with a fake web server.
//
// DSH serves plugin routes BEFORE its own authentication, so every route that acts (a token, the
// agent, a turn in a session) checks that the request comes from the page's own origin.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const errText = (e) => (e && e.message ? String(e.message) : String(e))
const str = (v) => (typeof v === 'string' ? v : null)

export const ROUTES = {
  status: '/kybernos-call/status',
  token: '/kybernos-call/token',
  agent: '/kybernos-call/agent',
  utterance: '/kybernos-call/utterance',
  vendor: '/kybernos-call/vendor/livekit-client.js'
}

export const sendJson = (res, status, payload) => {
  try {
    const body = JSON.stringify(payload === undefined ? null : payload)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  } catch (e) { try { res.writeHead(500); res.end('{}') } catch (e2) { /* socket closed */ } }
}

/**
 * Strict origin check, for the routes that act. A request WITHOUT an Origin is refused (any local
 * process could otherwise act); a browser always sends Origin on a same-origin POST, Referer is
 * the fallback. The origin is compared to the socket's REAL listening address, never to the Host
 * header (the client controls it).
 */
export const sameOriginStrict = (req) => {
  try {
    const headers = (req !== null && req !== undefined && req.headers !== null && req.headers !== undefined) ? req.headers : {}
    const source = str(headers.origin) ?? str(headers.referer)
    if (source === null) return false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const sock = (req !== null && req.socket !== null && req.socket !== undefined) ? req.socket : null
    const port = (sock !== null && typeof sock.localPort === 'number') ? ':' + sock.localPort : ''
    const hosts = ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
    return hosts.indexOf(u.host) >= 0
  } catch (e) { return false }
}

export const readJsonBody = async (req, maxBytes) => {
  const cap = typeof maxBytes === 'number' ? maxBytes : 65536
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > cap) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try { return JSON.parse(text) } catch (e) { return {} }
}

/** Serves a file of vendor/ as is (GET and HEAD only). */
export const serveVendor = (pluginDir, file, mime) => (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false, error: 'GET expected' })
  try {
    const bytes = readFileSync(join(pluginDir, 'vendor', file))
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store', 'content-length': String(bytes.length) })
    res.end(req.method === 'HEAD' ? '' : bytes)
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found: ' + file)
  }
}

/**
 * Registers the routes. `effect(fn, label)` wraps each registration so it is undone when the
 * plugin stops (ctx.effect in DSH, a plain call in tests).
 */
export function mountCallRoutes (webServer, call, pluginDir, effect) {
  const reg = (path, handler, label) => effect(() => webServer.register({ kind: 'exact', path: path, handler: handler }), 'kybernos-call: route ' + label)

  // First what is true of the chain (never a secret)…
  reg(ROUTES.status, async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET expected' })
    try { return sendJson(res, 200, await call.status()) } catch (e) { return sendJson(res, 500, { ok: false, error: errText(e) }) }
  }, 'status')

  // …then the room token, which is only handed to the same origin.
  reg(ROUTES.token, async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST expected' })
    if (sameOriginStrict(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
    let body = null
    try { body = await readJsonBody(req) } catch (e) { return sendJson(res, 400, { ok: false, error: errText(e) }) }
    const out = await call.mint(body)
    return sendJson(res, (out.ok === true ? 200 : 503), out)
  }, 'token')

  // The call agent: started by the host, never by the client blindly.
  reg(ROUTES.agent, async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST expected' })
    if (sameOriginStrict(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
    let body = null
    try { body = await readJsonBody(req) } catch (e) { return sendJson(res, 400, { ok: false, error: errText(e) }) }
    const action = (body !== null && typeof body === 'object' && typeof body.action === 'string') ? body.action : 'status'
    try {
      if (action === 'start') return sendJson(res, 200, await call.agentStart(body))
      if (action === 'stop') return sendJson(res, 200, await call.agentStop())
      if (action === 'status') return sendJson(res, 200, await call.agentState())
      return sendJson(res, 400, { ok: false, error: 'unknown action (start, stop, status)' })
    } catch (e) { return sendJson(res, 500, { ok: false, error: errText(e) }) }
  }, 'agent')

  // What is heard on the call enters the session: a real DSH turn.
  reg(ROUTES.utterance, async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST expected' })
    if (sameOriginStrict(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
    let body = null
    try { body = await readJsonBody(req) } catch (e) { return sendJson(res, 400, { ok: false, error: errText(e) }) }
    const out = await call.utterance(body)
    return sendJson(res, (out.ok === true ? 200 : 400), out)
  }, 'utterance')

  // LiveKit client 2.22.3 (Apache-2.0): the browser's room join. A UMD build, not ESM: the ESM
  // build imports bare specifiers (@livekit/protocol…) a browser without a bundler cannot resolve.
  // Loaded on demand, at the first call.
  reg(ROUTES.vendor, serveVendor(pluginDir, 'livekit-client.js', 'text/javascript; charset=utf-8'), 'vendor livekit-client')
}
