// Request guards, the same rules as the other bundles (each bundle reads on its own, with no cross import).
// DSH serves plugin routes BEFORE its own authentication, and the content of a person's chats is exactly what a drive-by page would
// want: every route here refuses a Host that is not this listener's, and answers a request only when it comes from the page itself.

// Hosted instance: also accept the authorities declared to DSH with --trusted-host (the core bundle publishes the predicate).
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }

const localHosts = (req) => {
  const port = typeof req?.socket?.localPort === 'number' ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}

/** The Host header is this listener's (a DNS-rebinding page reaches the routes with its own name as Host). A request with no socket
 *  (a test) is not judged. */
export const hostOK = (req) => {
  try {
    const host = typeof req?.headers?.host === 'string' ? req.headers.host : null
    const sock = req?.socket ?? null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    return localHosts(req).indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}

const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null)

/** Strict: an Origin (or a Referer) from this machine is REQUIRED. A browser always sends an Origin on a POST. */
export const sameOriginStrict = (req) => {
  try {
    const source = str(req?.headers?.origin) ?? str(req?.headers?.referer)
    if (source === null) return false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return localHosts(req).includes(u.host) || kbTrusted(u.host)
  } catch (e) { return false }
}

/** Lax (reads of counts only): no Origin is fine (direct navigation), a foreign one is not. */
export const sameOriginLax = (req) => {
  try {
    const source = str(req?.headers?.origin) ?? str(req?.headers?.referer)
    if (source === null) return true
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return localHosts(req).includes(u.host) || kbTrusted(u.host)
  } catch (e) { return false }
}

/** Wraps the web server service so every route gets the host fence before its own guard. */
export const fenced = (service) => {
  if (service === null || service === undefined || typeof service.register !== 'function') return service
  const fence = (route) => (route !== null && typeof route === 'object' && typeof route.handler === 'function'
    ? Object.assign({}, route, {
      handler: (req, res, ...rest) => {
        if (hostOK(req) !== true) {
          try { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"ok":false,"error":"origin refused"}') } catch (e) { /* closed */ }
          return undefined
        }
        return route.handler(req, res, ...rest)
      }
    })
    : route)
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => target.register(fence(route)) : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

export const send = (res, status, payload) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  } catch (e) { /* socket closed */ }
}

export const readBody = async (req, limit = 4096) => {
  let size = 0
  const chunks = []
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('too-large'); chunks.push(c) }
  return chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
