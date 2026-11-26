// Reverse proxy to DSH: plain HTTP (streamed, so server-sent events work) and WebSocket upgrades.
// The gate's own cookie is removed before a request is forwarded: DSH must never see it.
import http from 'node:http'
import { SESSION_COOKIE, stripCookie } from './session.mjs'

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

/** Request headers to send upstream: no hop-by-hop headers, no gate cookie. `Host` is kept as the browser sent it. */
export function forwardHeaders (incoming, { websocket = false } = {}) {
  const out = {}
  for (const [name, value] of Object.entries(incoming)) {
    const key = name.toLowerCase()
    if (HOP_BY_HOP.has(key)) continue
    if (key === 'cookie') {
      const kept = stripCookie(Array.isArray(value) ? value.join('; ') : value, SESSION_COOKIE)
      if (kept !== undefined) out.cookie = kept
      continue
    }
    out[key] = value
  }
  if (websocket) { out.connection = 'Upgrade'; out.upgrade = 'websocket' }
  return out
}

const rawHead = (statusLine, rawHeaders) => {
  let text = statusLine + '\r\n'
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) text += `${rawHeaders[i]}: ${rawHeaders[i + 1]}\r\n`
  return text + '\r\n'
}

/**
 * @param {URL} upstream where DSH listens
 * @returns {{ web: Function, upgrade: Function, closeTunnels: Function }}
 */
export function createProxy (upstream) {
  const target = { hostname: upstream.hostname, port: upstream.port === '' ? 80 : Number(upstream.port) }
  // Upgraded sockets leave the HTTP server's own bookkeeping: keep them here so a shutdown can close them.
  const tunnels = new Set()

  /** Forward one HTTP request. `onUnavailable(err)` is called when DSH cannot be reached before any byte was sent back. */
  function web (req, res, onUnavailable) {
    const upstreamReq = http.request({ ...target, method: req.method, path: req.url, headers: forwardHeaders(req.headers) }, (upstreamRes) => {
      const headers = {}
      for (const [name, value] of Object.entries(upstreamRes.headers)) if (!HOP_BY_HOP.has(name)) headers[name] = value
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, headers)
      upstreamRes.pipe(res)
      upstreamRes.on('error', () => res.destroy())
    })
    upstreamReq.on('error', (err) => { if (res.headersSent) res.destroy(); else onUnavailable(err) })
    res.on('close', () => upstreamReq.destroy())
    req.pipe(upstreamReq)
  }

  /** Forward a WebSocket upgrade (the caller has already authenticated it). */
  function upgrade (req, socket, head) {
    socket.setNoDelay(true)
    socket.setTimeout(0)
    const upstreamReq = http.request({ ...target, method: req.method, path: req.url, headers: forwardHeaders(req.headers, { websocket: true }) })
    upstreamReq.on('response', (upstreamRes) => {
      // DSH answered with a plain response instead of switching protocols: relay it as is.
      if (!socket.writable) return
      socket.write(rawHead(`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}`, upstreamRes.rawHeaders))
      upstreamRes.pipe(socket)
    })
    upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      socket.write(rawHead('HTTP/1.1 101 Switching Protocols', upstreamRes.rawHeaders))
      if (upstreamHead.length > 0) socket.write(upstreamHead)
      if (head.length > 0) upstreamSocket.write(head)
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
      tunnels.add(socket); tunnels.add(upstreamSocket)
      const close = () => { upstreamSocket.destroy(); socket.destroy(); tunnels.delete(socket); tunnels.delete(upstreamSocket) }
      // A side that ends is passed on by pipe(); the other side gets a short grace period to flush, then both go.
      // Node's HTTP server keeps half-open sockets, so waiting for 'close' alone could leave a tunnel behind.
      const linger = () => setTimeout(close, 2000).unref()
      upstreamSocket.on('error', close); socket.on('error', close)
      upstreamSocket.on('close', close); socket.on('close', close)
      upstreamSocket.on('end', linger); socket.on('end', linger)
    })
    upstreamReq.on('error', () => { if (socket.writable) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); else socket.destroy() })
    upstreamReq.end()
  }

  /** Destroy every open tunnel (shutdown). */
  const closeTunnels = () => { for (const t of tunnels) t.destroy(); tunnels.clear() }

  return { web, upgrade, closeTunnels }
}
