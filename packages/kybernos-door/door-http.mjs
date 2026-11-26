// The HTTP half of the local door: one route, `POST /kybernos-door/mcp`, a handler for DSH's web server.
//
// DSH serves plugin routes BEFORE its own sign-in, so this route is its own fence, and it has three locks that a page in a browser cannot all pick:
//   1. the Host header is this listener's own loopback address (a rebinding page reaches 127.0.0.1 under its own name, so its Host is not ours);
//   2. no `Origin` header at all (a browser sends one on every cross-site call; a command-line client such as Claude Code sends none);
//   3. `Authorization: Bearer <token>`, the secret in the profile that only the person's own programs can read (token.mjs), compared in constant time.
// With the door switched off (no token on disk) it answers 503 and nothing else. GET answers 405: there is no stream to open.
import { timingSafeEqual } from 'node:crypto'

export const MAX_BODY = 65536

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]']

/** The Host header names this listener's own loopback address and port (the same rule as the other bundles' kbHostOK). */
export function hostOk (req) {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const port = req.socket !== null && req.socket !== undefined ? req.socket.localPort : undefined
    if (host === null || typeof port !== 'number') return false
    return LOOPBACK.some((h) => host === h + ':' + port)
  } catch (e) { return false }
}

/** `Authorization: Bearer <token>` against the secret, in constant time. */
export function bearerOk (header, token) {
  if (typeof header !== 'string' || typeof token !== 'string' || token === '') return false
  const want = 'Bearer ' + token
  if (header.length !== want.length) return false
  try { return timingSafeEqual(Buffer.from(header), Buffer.from(want)) } catch (e) { return false }
}

const send = (res, status, body, headers = {}) => {
  try {
    res.writeHead(status, body === undefined ? headers : { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
    res.end(body === undefined ? undefined : JSON.stringify(body))
  } catch (e) { /* the client left */ }
}
const rpcError = (code, message) => ({ jsonrpc: '2.0', id: null, error: { code, message } })

/** The body, capped: `null` when it is bigger than the cap (the request is cut), a string otherwise. */
const readBody = (req, cap) => new Promise((resolve) => {
  let size = 0
  const parts = []
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > cap) { resolve(null); try { req.destroy() } catch (e) { /* gone */ } return }
    parts.push(chunk)
  })
  req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
  req.on('error', () => resolve(null))
})

/** @param deps `{ mcp, token: () => string | '', onCall?: () => void }` — `token()` is read at each request, so a rotated token counts at once and an absent one switches the door off; `onCall` is told of each request that carried the right token (the Settings page's « last call »). */
export function createHandler ({ mcp, token, onCall }) {
  return async (req, res) => {
    if (hostOk(req) !== true) return send(res, 403, { error: 'host refused' })
    if (req.headers.origin !== undefined) return send(res, 403, { error: 'browser origins are refused' })
    const secret = token()
    if (secret === '') return send(res, 503, { error: 'the door is off: no token' })
    if (bearerOk(req.headers.authorization, secret) !== true) return send(res, 401, { error: 'bearer token required' }, { 'www-authenticate': 'Bearer' })
    // `x-kaby-check` is what scripts/door-local.mjs --check and scripts/check-door-live.mjs send: a check of the door by its maintainer is not an assistant connecting, so the page must not say so.
    if (typeof onCall === 'function' && req.headers['x-kaby-check'] === undefined) { try { onCall() } catch (e) { /* a note of the call never stops the call */ } }
    if (req.method !== 'POST') return send(res, 405, undefined, { allow: 'POST' })
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return send(res, 415, { error: 'json required' })
    const raw = await readBody(req, MAX_BODY)
    if (raw === null) return send(res, 413, { error: 'body too large' })
    let message
    try { message = JSON.parse(raw) } catch (e) { return send(res, 400, rpcError(-32700, 'parse error')) }
    if (Array.isArray(message)) return send(res, 400, rpcError(-32600, 'batches are not supported'))
    const answer = await mcp.handle(message)
    if (answer === null) return send(res, 202, undefined)
    return send(res, 200, answer)
  }
}
