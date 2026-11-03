// The web layer of the maquette editor: the routes DSH serves for it, over the host in maquette-host.mjs.
//
// DSH serves plugin routes BEFORE its own login (docs/dev/route-origin-rule.md), so:
//  - every route first refuses a Host that is not this listener's (DNS rebinding, scripts/test-route-hosts.mjs);
//  - every route that writes or hands out a token takes the signed session cookie on top of a strict same-origin request
//    (`writeGuard` of session-guard.mjs, the terminal's own code); the editor in the page reaches them only through the DSH page
//    around it (postMessage), because the page of a maquette runs in a sandbox with no cookie and no origin;
//  - the one route that is not guarded that way, `GET <ROUTE>/v/<token>/…`, serves files of a registered folder to the sandboxed page: the
//    token (128 random bits, minted by `open`, kept in memory) is its key, and it sends `Content-Security-Policy: sandbox`, so whatever a
//    maquette's script does, it does it with no access to DSH.
import { writeGuard } from './session-guard.mjs'

export const ROUTE = '/kybernos-maquettes'
const SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox'
export const API_OPS = ['hash', 'find', 'apply', 'undo', 'reset', 'unupload', 'blocks']

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

export function mountRoutes (webServer, host, { editorScript, log = () => {} }) {
  const read = (suffix, run) => webServer.register({ kind: 'exact', path: ROUTE + suffix, handler: async (req, res) => {
    try {
      if (hostOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
      if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      if (originOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
      return await run(req, res)
    } catch (e) { log(`${suffix}: ${e?.message ?? e}`); return send(res, 500, { ok: false, error: 'host-error' }) }
  } })
  const write = (suffix, limit, run) => webServer.register({ kind: 'exact', path: ROUTE + suffix, handler: async (req, res) => {
    try {
      if (hostOk(req) === false) return send(res, 403, { ok: false, error: 'origin-refused' })
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      const refus = writeGuard(req)
      if (refus !== null) return send(res, refus.status, { ok: false, error: refus.error })
      return await run(req, res, limit)
    } catch (e) { log(`${suffix}: ${e?.message ?? e}`); return send(res, 500, { ok: false, error: 'host-error' }) }
  } })
  const json = (suffix, limit, run) => write(suffix, limit, async (req, res) => {
    if (isJson(req) === false) return send(res, 415, { ok: false, error: 'json-required' })
    let body
    try { body = await readJson(req, limit) } catch (e) { return send(res, e && e.code === 'TOO_LARGE' ? 413 : 400, { ok: false, error: e && e.code === 'TOO_LARGE' ? 'too-large' : 'bad-body' }) }
    return await run(body, req, res)
  })

  read('/folders', async (req, res) => send(res, 200, await host.list()))
  read('/stats', async (req, res) => send(res, 200, { ok: true, stats: await host.stats() }))

  json('/folders/add', 4000, async (b, req, res) => {
    const r = await host.add(b.path)
    return r.ok ? send(res, 200, r) : refusal(res, r)
  })
  json('/folders/remove', 4000, async (b, req, res) => {
    const r = await host.remove(str(b.id))
    return r.ok ? send(res, 200, r) : refusal(res, r)
  })
  // `open` mints the token the sandboxed page is addressed by; the url is relative to this listener, the DSH page puts it in an iframe.
  json('/open', 4000, async (b, req, res) => {
    const r = await host.open(str(b.id), str(b.file), b.lang)
    if (!r.ok) return refusal(res, r)
    return send(res, 200, { ok: true, token: r.token, id: r.id, name: r.name, page: r.page, pages: r.pages, url: `${ROUTE}/v/${r.token}/${r.page}` })
  })

  // The editor's calls, one route, a short list of operations. `token` says which folder; nothing here takes a path from the page but a page name.
  json('/api', 6_000_000, async (b, req, res) => {
    const op = str(b.op)
    if (op === null || API_OPS.includes(op) === false) return send(res, 400, { ok: false, error: 'unknown-op' })
    const token = str(b.token)
    let r
    if (op === 'hash') r = await host.hash(token, b.file)
    else if (op === 'find') r = await host.find(token, b.file, b.text)
    else if (op === 'apply') r = await host.apply(token, b.file, b.body)
    else if (op === 'undo') r = await host.undo(token)
    else if (op === 'reset') r = await host.resetOriginal(token, { force: b.force === true })
    else if (op === 'unupload') r = await host.unupload(token, b.srcs)
    else r = host.blocks(b.lang)
    return r.ok ? send(res, 200, r) : refusal(res, r)
  })

  // A picture for the maquette: the bytes as the body, the name and the token in the query.
  write('/upload', 0, async (req, res) => {
    const q = new URL(req.url, 'http://127.0.0.1').searchParams
    let buf
    try { buf = await readBody(req, 8 * 1024 * 1024 + 1) } catch (e) { return send(res, 413, { ok: false, error: 'too-big', why: 'The picture is larger than 8 MB.' }) }
    const r = await host.upload(str(q.get('token')), buf, q.get('filename') || 'image')
    return r.ok ? send(res, 200, r) : refusal(res, r)
  })

  // The files of a registered folder, to the sandboxed page. Everything the page may touch is behind the token.
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
      const headers = { 'Cache-Control': 'no-store', 'Content-Security-Policy': SANDBOX, 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' }
      if (rel === '__ky/edit.js') {
        if (host.who(token) === null) return send(res, 404, { ok: false, error: 'not-found' })
        res.writeHead(200, { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' })
        return res.end(req.method === 'HEAD' ? undefined : editorScript())
      }
      const r = await host.serve(token, rel, { raw: url.searchParams.get('raw') === '1', base: `${ROUTE}/v/${token}` })
      if (!r.ok) return send(res, r.status || 404, { ok: false, error: r.code || 'not-found' }, headers)
      res.writeHead(200, { ...headers, 'Content-Type': r.type, 'Content-Length': r.body.length })
      return res.end(req.method === 'HEAD' ? undefined : r.body)
    } catch (e) { log(`view: ${e?.message ?? e}`); return send(res, 500, { ok: false, error: 'host-error' }) }
  } })
  log('routes mounted')
}
