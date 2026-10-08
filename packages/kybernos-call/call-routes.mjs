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
  speech: '/kybernos-call/speech',
  settings: '/kybernos-call/settings',
  keys: '/kybernos-call/keys',
  test: '/kybernos-call/test',
  clone: '/kybernos-call/clone',
  preset: '/kybernos-call/preset',
  avatars: '/kybernos-call/avatars',
  health: '/kybernos-call/health',
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
export function mountCallRoutes (webServer, call, pluginDir, effect, feed = null, admin = null) {
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

  // The settings page. Reading says what is set (never a secret); everything that changes something needs the same origin.
  if (admin !== null) {
    const post = (path, label, run) => reg(path, async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST expected' })
      if (sameOriginStrict(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
      let body = null
      try { body = await readJsonBody(req, 32768) } catch (e) { return sendJson(res, 400, { ok: false, error: errText(e) }) }
      try { const out = await run(body !== null && typeof body === 'object' ? body : {}); return sendJson(res, out.ok === true ? 200 : 400, out) } catch (e) { return sendJson(res, 500, { ok: false, error: errText(e) }) }
    }, label)
    reg(ROUTES.settings, async (req, res) => {
      if (req.method === 'GET') { try { return sendJson(res, 200, await admin.everything()) } catch (e) { return sendJson(res, 500, { ok: false, error: errText(e) }) } }
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'GET or POST expected' })
      if (sameOriginStrict(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
      let body = null
      try { body = await readJsonBody(req, 32768) } catch (e) { return sendJson(res, 400, { ok: false, error: errText(e) }) }
      try { const out = await admin.patchSettings(body !== null && typeof body === 'object' ? body.patch : null); return sendJson(res, out.ok === true ? 200 : 400, out) } catch (e) { return sendJson(res, 500, { ok: false, error: errText(e) }) }
    }, 'settings')
    post(ROUTES.keys, 'keys', (b) => admin.setKeys(b.patch))
    post(ROUTES.test, 'test', (b) => admin.test(b.service))
    post(ROUTES.preset, 'preset', (b) => admin.applyPreset(b.id))
    post(ROUTES.avatars, 'avatars', () => admin.avatars())
    // The health check asks this DSH's own voice engine, so it needs the address the request came in on (the socket's, never a header).
    reg(ROUTES.health, async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST expected' })
      if (sameOriginStrict(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
      const port = req.socket && typeof req.socket.localPort === 'number' ? req.socket.localPort : null
      if (port === null) return sendJson(res, 500, { ok: false, error: 'no local port' })
      try { return sendJson(res, 200, await admin.runHealth('http://127.0.0.1:' + String(port))) } catch (e) { return sendJson(res, 500, { ok: false, error: errText(e) }) }
    }, 'health')
    post(ROUTES.clone, 'clone', (b) => (b.action === 'delete' ? admin.deleteClone(b.voiceId) : admin.cloneSample({ rootId: b.rootId, voiceId: b.voiceId, name: b.name })))
  }

  // What the session's assistant wrote for this call, for the worker to speak: a long poll. It is the
  // session's own text, so it is only given to the same origin (the worker declares it, like for utterance).
  if (feed !== null) {
    reg(ROUTES.speech, async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET expected' })
      if (sameOriginStrict(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
      let q = null
      try { q = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams } catch (e) { return sendJson(res, 400, { ok: false, error: 'bad url' }) }
      const room = q.get('room') ?? ''
      if (/^[A-Za-z0-9_-]{3,64}$/.test(room) === false) return sendJson(res, 400, { ok: false, error: 'room required' })
      const after = Math.max(0, Number.parseInt(q.get('after') ?? '0', 10) || 0)
      const wait = Math.max(0, Number.parseInt(q.get('wait') ?? '0', 10) || 0)
      try { return sendJson(res, 200, await feed.poll(room, after, wait)) } catch (e) { return sendJson(res, 500, { ok: false, error: errText(e) }) }
    }, 'speech')
  }

  // LiveKit client 2.22.3 (Apache-2.0): the browser's room join. A UMD build, not ESM: the ESM
  // build imports bare specifiers (@livekit/protocol…) a browser without a bundler cannot resolve.
  // Loaded on demand, at the first call.
  reg(ROUTES.vendor, serveVendor(pluginDir, 'livekit-client.js', 'text/javascript; charset=utf-8'), 'vendor livekit-client')
}
