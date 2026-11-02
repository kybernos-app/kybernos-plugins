// Forwards a request of the owner's browser to the front-desk service, adding the owner token the browser never sees.
//
// Only what the owner's pages and Kaby need goes through: `/atelier`, `/boite`, `/preview` and `/api/*`. The visitor's routes (`/c/...`) never do: visitors
// reach the service by its own public address, not through the owner's DSH. Nothing the browser sent is passed on except a short list of headers
// (no cookie, no Origin, no Authorization), and nothing the service answers comes back except a short list of headers (no Set-Cookie).
// The caller (fd-routes.mjs) has already decided the request may pass: this file only forwards.

import { request as httpRequest } from 'node:http'

const BODY_MAX = 16 * 1024
const TIMEOUT_MS = 75_000
const PAGES = new Set(['atelier', 'boite', 'preview'])
const API_PART = /^[A-Za-z0-9_./-]{1,160}$/

const FORWARD_REQUEST = ['content-type', 'accept', 'accept-language']
const FORWARD_RESPONSE = ['content-type', 'cache-control', 'content-security-policy', 'content-disposition', 'x-content-type-options', 'referrer-policy']

/** The path on the service for what comes after the plugin's prefix (`atelier`, `api/overview?x=1`), or null when it may not pass. */
export function servicePath (rest) {
  if (typeof rest !== 'string') return null
  const q = rest.indexOf('?')
  const path = q < 0 ? rest : rest.slice(0, q)
  const query = q < 0 ? '' : rest.slice(q)
  if (PAGES.has(path)) return '/' + path
  if (path.startsWith('api/')) {
    const part = path.slice(4)
    if (!API_PART.test(part) || part.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return null
    if (query.length > 512) return null
    return '/api/' + part + query
  }
  return null
}

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  req.on('data', (c) => {
    size += c.length
    if (size > BODY_MAX) { reject(Object.assign(new Error('too big'), { code: 413 })); req.removeAllListeners('data'); req.resume(); return }
    chunks.push(c)
  })
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', () => reject(Object.assign(new Error('read'), { code: 400 })))
})

const refuse = (res, status, error) => {
  if (res.headersSent) { try { res.end() } catch (e) { /* closed */ } return }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ ok: false, error }))
}

/** `getTarget()` -> `{ port, token }` or null; `request` is node:http's, replaceable by a test. */
export function createProxy ({ getTarget, request = httpRequest }) {
  return async function forward (req, res, rest) {
    const path = servicePath(rest)
    if (path === null) { refuse(res, 404, 'not_found'); return }
    const target = getTarget()
    if (target === null) { refuse(res, 503, 'service_stopped'); return }
    const method = String(req.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') { refuse(res, 405, 'method'); return }
    let body = null
    if (method !== 'GET') {
      try { body = await readBody(req) } catch (e) { refuse(res, e.code === 413 ? 413 : 400, e.code === 413 ? 'too_big' : 'bad_request'); return }
    }
    const headers = { authorization: `Bearer ${target.token}`, host: `127.0.0.1:${target.port}` }
    for (const h of FORWARD_REQUEST) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h]
    if (body !== null) headers['content-length'] = String(body.length)
    await new Promise((resolve) => {
      const up = request({ host: '127.0.0.1', port: target.port, path, method, headers, timeout: TIMEOUT_MS }, (r) => {
        const out = {}
        for (const h of FORWARD_RESPONSE) if (r.headers[h] !== undefined) out[h] = r.headers[h]
        out['cache-control'] = 'no-store'
        res.writeHead(r.statusCode || 502, out)
        r.pipe(res)
        r.on('end', resolve)
        r.on('error', () => { try { res.destroy() } catch (e) { /* closed */ } resolve() })
      })
      up.on('timeout', () => { up.destroy(new Error('timeout')) })
      up.on('error', () => { refuse(res, 502, 'service_unreachable'); resolve() })
      if (body !== null) up.write(body)
      up.end()
    })
  }
}
