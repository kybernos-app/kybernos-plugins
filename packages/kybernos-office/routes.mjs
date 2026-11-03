// The web layer of the Office editors: the routes DSH serves for them, over the host in office-host.mjs.
//
// DSH serves plugin routes BEFORE its own login (docs/dev/route-origin-rule.md), so:
//  - every route first refuses a Host that is not this listener's (DNS rebinding, scripts/test-route-hosts.mjs);
//  - every route that opens, writes or restores a file takes the signed session cookie on top of a strict same-origin request
//    (`writeGuard` of session-guard.mjs, the terminal's own code). The editor itself runs in a sandboxed frame with no cookie and no
//    origin: it can only show the bytes it was given and hand back the bytes of what it made, through postMessage to the DSH page around
//    it, and it is the DSH page that saves;
//  - the one route that is not guarded that way, `GET <ROUTE>/v/<token>/…`, serves the editor's own files and the bytes of the file that
//    token was minted for: the token (128 random bits, minted by `open`, kept in memory) is its key, and it sends a Content-Security-Policy
//    that sandboxes the page and lets it talk to nobody but this listener.
import { writeGuard } from './session-guard.mjs'

export const ROUTE = '/kybernos-office'
// `connect-src 'self'`: an editor cannot send a document anywhere but back here. `wasm-unsafe-eval`: the spreadsheet engine is WebAssembly.
const CSP = "sandbox allow-scripts; default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'"
export const MAX_BODY = 64 * 1024 * 1024

// Hosted instance: also accept the authorities declared to DSH with --trusted-host (published by the core bundle).
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
const localHosts = (req) => {
  const port = req.socket && typeof req.socket.localPort === 'number' ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}
/** Host fence: a Host that is not this listener's is refused. */
export const hostOk = (req) => {
  try {
    const host = typeof (req.headers && req.headers.host) === 'string' ? req.headers.host : null
    const sock = req.socket
    if (host === null || sock === null || sock === undefined || typeof sock.localPort !== 'number') return true
    return localHosts(req).includes(host) || kbTrusted(host)
  } catch (e) { return false }
}
/** Not strict: when an Origin or Referer is present it must be this page's own (the reads). */
export const originOk = (req) => {
  try {
    const src = (typeof req.headers.origin === 'string' && req.headers.origin !== '' ? req.headers.origin : null) || (typeof req.headers.referer === 'string' && req.headers.referer !== '' ? req.headers.referer : null)
    if (src === null) return true
    const u = new URL(src)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return localHosts(req).includes(u.host) || kbTrusted(u.host)
  } catch (e) { return false }
}

const send = (res, code, obj, extra) => {
  try {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
    res.end(JSON.stringify(obj))
  } catch (e) { /* socket closed */ }
}
const refusal = (res, r) => send(res, r.status || 400, { ok: false, error: r.code || 'refused', why: r.why })

/** The body of a request, or an error with `code: 'TOO_LARGE'`. A body over the limit is read to its end without being kept (so the answer can be sent on a healthy connection), up to 16 MB past it. */
async function readBody (req, limit) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit + 16 * 1024 * 1024) { req.destroy(); break }
    if (size <= limit) chunks.push(c)
  }
  if (size > limit) { const e = new Error('too large'); e.code = 'TOO_LARGE'; throw e }
  return Buffer.concat(chunks)
}
async function readJson (req, limit) {
  const text = (await readBody(req, limit)).toString('utf8')
  if (text.trim() === '') return {}
  const body = JSON.parse(text)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
  return body
}
const isJson = (req) => String((req.headers && req.headers['content-type']) || '').toLowerCase().startsWith('application/json')
const str = (v) => (typeof v === 'string' && v !== '' ? v : null)

export function mountRoutes (webServer, host, { log = () => {} }) {
  const read = (suffix, run) => webServer.register({ kind: 'exact', path: ROUTE + suffix, handler: async (req, res) => {
    try {
      if (hostOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
      if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      if (originOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
      return await run(req, res)
    } catch (e) { log(`${suffix}: ${e?.message ?? e}`); return send(res, 500, { ok: false, error: 'host-error' }) }
  } })
  const write = (suffix, run) => webServer.register({ kind: 'exact', path: ROUTE + suffix, handler: async (req, res) => {
    try {
      if (hostOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      const refus = writeGuard(req)
      if (refus !== null) return send(res, refus.status, { ok: false, error: refus.error })
      return await run(req, res)
    } catch (e) { log(`${suffix}: ${e?.message ?? e}`); return send(res, 500, { ok: false, error: 'host-error' }) }
  } })
  const json = (suffix, limit, run) => write(suffix, async (req, res) => {
    if (isJson(req) === false) return send(res, 415, { ok: false, error: 'json-required' })
    let body
    try { body = await readJson(req, limit) } catch (e) { return send(res, e && e.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: e && e.code === 'TOO_LARGE' ? 'too-large' : 'bad-body' }) }
    return await run(body, req, res)
  })

  // Which editors are installed, and how often each format was used. Nothing secret: the reads follow the same-origin rule only.
  read('/status', async (req, res) => send(res, 200, { ok: true, ...(await host.status()) }))
  read('/stats', async (req, res) => send(res, 200, { ok: true, stats: await host.stats() }))

  // `open` mints the token the sandboxed page is addressed by; the url is relative to this listener, the DSH page puts it in an iframe.
  json('/open', 4000, async (b, req, res) => {
    const r = await host.open(b.path)
    if (!r.ok) return refusal(res, r)
    return send(res, 200, { ok: true, token: r.token, name: r.name, format: r.format, editor: r.editor, size: r.size, hash: r.hash, losses: r.losses, block: r.block, installed: r.installed, undo: r.undo, url: `${ROUTE}/v/${r.token}/${r.editor}/index.html` })
  })
  json('/undo', 4000, async (b, req, res) => {
    const r = await host.undo(str(b.token), { force: b.force === true })
    return r.ok ? send(res, 200, r) : refusal(res, r)
  })
  // What the editor made, as the body (a .xlsx or .docx is binary: no base64 round trip); the token, the hash it was opened on and the mode go in the query.
  write('/save', async (req, res) => {
    const q = new URL(req.url, 'http://127.0.0.1').searchParams
    let buf
    try { buf = await readBody(req, MAX_BODY) } catch (e) { return send(res, 413, { ok: false, error: 'too-big', why: 'The file is larger than 64 MB.' }) }
    const mode = q.get('mode') === 'copy' ? 'copy' : 'overwrite'
    const r = await host.save(str(q.get('token')), buf, { base: str(q.get('base')), mode })
    return r.ok ? send(res, 200, r) : refusal(res, r)
  })

  // The editor's own files and the file's bytes, to the sandboxed page. Everything the page may touch is behind the token.
  webServer.register({ kind: 'prefix', path: ROUTE + '/v', handler: async (req, res) => {
    try {
      if (hostOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      const url = new URL(req.url, 'http://127.0.0.1')
      const rest = url.pathname.slice((ROUTE + '/v').length).replace(/^\//, '')
      const slash = rest.indexOf('/')
      const token = slash < 0 ? rest : rest.slice(0, slash)
      let rel
      try { rel = slash < 0 ? '' : rest.slice(slash + 1).split('/').map(decodeURIComponent).join('/') } catch (e) { return send(res, 404, { ok: false, error: 'not-found' }) }
      const headers = { 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Office-Hash' }
      if (rel === '__file') {
        const f = await host.bytes(token)
        if (!f.ok) return send(res, f.status || 404, { ok: false, error: f.code || 'not-found' }, headers)
        res.writeHead(200, { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': f.bytes.length, 'X-Office-Hash': f.hash })
        return res.end(req.method === 'HEAD' ? undefined : f.bytes)
      }
      const r = await host.serve(token, rel)
      if (!r.ok) return send(res, r.status || 404, { ok: false, error: r.code || 'not-found' }, headers)
      res.writeHead(200, { ...headers, 'Content-Type': r.type, 'Content-Length': r.body.length })
      return res.end(req.method === 'HEAD' ? undefined : r.body)
    } catch (e) { log(`view: ${e?.message ?? e}`); return send(res, 500, { ok: false, error: 'host-error' }) }
  } })
  log('routes mounted')
}
