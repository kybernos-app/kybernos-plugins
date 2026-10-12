// A stand-in for the Kybernos relay and for the server's `/v1/remote/*` routes, for the tests and the live checks of the
// phone link. It lives in the bundle folder because the bundle's tests ship with it and may not import `scripts/`.
// Contract: docs/dev/mobile-remote.md. No dependency: the WebSocket server is a minimal RFC 6455 implementation
// (text, binary, ping, close; no extensions).
//
//   const relay = await startFakeRelay({ entitled: true, maxDevices: 3 })
//   relay.api.call('/v1/remote/pairings', { method: 'POST', body: { label } })   // what the cloud seam would do
//   relay.url, relay.wsUrl                                                          // http://127.0.0.1:<port>
//   relay.state                                                                     // pairings, devices, counters
//   await relay.close()
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MOBILE = dirname(fileURLToPath(import.meta.url))
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const token = (n = 16) => randomBytes(n).toString('base64url')

function frame (opcode, payload) {
  const len = payload.length
  const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b })()
  return Buffer.concat([head, payload])
}

class Peer {
  constructor (socket) {
    this.socket = socket
    this.buf = Buffer.alloc(0)
    this.frag = null
    this.open = true
    this.onmessage = () => {}
    this.onclose = () => {}
    socket.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump() })
    socket.on('close', () => { if (this.open) { this.open = false; this.onclose() } })
    socket.on('error', () => {})
  }

  pump () {
    for (;;) {
      const b = this.buf
      if (b.length < 2) return
      const fin = (b[0] & 0x80) !== 0
      const opcode = b[0] & 15
      const masked = (b[1] & 0x80) !== 0
      let len = b[1] & 127
      let o = 2
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); o = 4 } else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); o = 10 }
      const need = o + (masked ? 4 : 0) + len
      if (b.length < need) return
      let payload = b.subarray(o + (masked ? 4 : 0), need)
      if (masked) { const m = b.subarray(o, o + 4); payload = Buffer.from(payload.map((x, i) => x ^ m[i % 4])) }
      this.buf = b.subarray(need)
      if (opcode === 8) { this.close(); return }
      if (opcode === 9) { this.socket.write(frame(10, payload)); continue }
      if (opcode === 10) continue
      if (opcode === 0 && this.frag !== null) { this.frag.parts.push(payload); if (fin) { const full = Buffer.concat(this.frag.parts); const isBin = this.frag.binary; this.frag = null; this.onmessage(full, isBin) } continue }
      if (!fin) { this.frag = { parts: [payload], binary: opcode === 2 }; continue }
      this.onmessage(payload, opcode === 2)
    }
  }

  send (data, binary) {
    if (!this.open) return
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data)
    this.socket.write(frame(binary ? 2 : 1, payload))
  }

  close () {
    if (!this.open) return
    this.open = false
    try { this.socket.write(frame(8, Buffer.alloc(0))); this.socket.end() } catch (e) { /* gone */ }
    this.onclose()
  }
}

/** Completes the WebSocket handshake of an `upgrade` event and returns the peer (also used by the tests' stand-in DSH). */
export function acceptWebSocket (req, socket) {
  if (typeof req.headers['sec-websocket-key'] !== 'string') { socket.destroy(); return null }
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64')
  const proto = typeof req.headers['sec-websocket-protocol'] === 'string' ? req.headers['sec-websocket-protocol'].split(',')[0].trim() : null
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + (proto ? '\r\nSec-WebSocket-Protocol: ' + proto : '') + '\r\n\r\n')
  return new Peer(socket)
}

export async function startFakeRelay (options = {}) {
  const state = {
    entitled: options.entitled !== false,
    maxDevices: options.maxDevices || 8,
    pairings: new Map(), // pairing_id -> { sid, label, expires, device_id|null }
    devices: new Map(), // device_id -> { device_id, sid, label, created_at, last_seen_at }
    tickets: new Map(), // sid -> ticket
    authCalls: [],
    rooms: new Map(), // sid -> { host, phone }
    framesBinary: 0,
    framesText: 0,
    samples: [],
    httpMisses: [],
    ttlMs: options.pairingTtlMs || 5 * 60 * 1000,
  }
  let origin = ''

  // ── the server's /v1/remote routes, as the cloud seam would reach them ──
  const api = {
    async call (path, o = {}) {
      const method = (o.method || 'GET').toUpperCase()
      const body = o.body || null
      state.authCalls.push(method + ' ' + path)
      let m
      if (method === 'POST' && path === '/v1/remote/pairings') {
        if (!state.entitled) return { status: 403, body: { error: 'remote_not_in_plan', message: 'not in plan' } }
        if (state.devices.size >= state.maxDevices) return { status: 429, body: { error: 'remote_device_limit' } }
        const pairing_id = 'p_' + token(8)
        const sid = token(16)
        const host_ticket = token(24)
        const expires = Date.now() + state.ttlMs
        state.pairings.set(pairing_id, { sid, label: body && body.label, expires, device_id: null })
        state.tickets.set(sid, host_ticket)
        return { status: 201, body: { pairing_id, sid, phone_url: origin + '/__kb/', relay_ws: origin.replace(/^http/u, 'ws') + '/ws', host_ticket, expires_at: new Date(expires).toISOString() } }
      }
      if ((m = /^\/v1\/remote\/pairings\/([^/]+)\/confirm$/u.exec(path)) !== null && method === 'POST') {
        const p = state.pairings.get(decodeURIComponent(m[1]))
        if (p === undefined) return { status: 404, body: { error: 'not_found' } }
        if (!state.entitled) return { status: 403, body: { error: 'remote_not_in_plan' } }
        const device_id = 'd_' + token(8)
        p.device_id = device_id
        state.devices.set(device_id, { device_id, sid: p.sid, label: String((body && body.label) || 'Phone'), created_at: new Date().toISOString(), last_seen_at: null })
        return { status: 200, body: { device_id } }
      }
      if ((m = /^\/v1\/remote\/pairings\/([^/]+)$/u.exec(path)) !== null && method === 'DELETE') {
        const p = state.pairings.get(decodeURIComponent(m[1]))
        if (p !== undefined && p.device_id === null) { state.pairings.delete(decodeURIComponent(m[1])); state.tickets.delete(p.sid) }
        return { status: 204, body: null }
      }
      if (method === 'GET' && path === '/v1/remote/devices') {
        return {
          status: 200,
          body: {
            configured: true,
            entitled: state.entitled,
            max_devices: state.entitled ? state.maxDevices : 0,
            devices: [...state.devices.values()].map((d) => ({ device_id: d.device_id, label: d.label, computer_label: null, created_at: d.created_at, last_seen_at: d.last_seen_at })),
          },
        }
      }
      if ((m = /^\/v1\/remote\/devices\/([^/]+)\/ticket$/u.exec(path)) !== null && method === 'POST') {
        if (!state.entitled) return { status: 403, body: { error: 'remote_not_in_plan' } }
        const d = state.devices.get(decodeURIComponent(m[1]))
        // The server keeps a digest of the address: the computer names it, and a body that is not the phone's is the same 404.
        if (d === undefined || !body || body.sid !== d.sid) return { status: 404, body: { error: 'not_found' } }
        const host_ticket = token(24)
        state.tickets.set(d.sid, host_ticket)
        return { status: 200, body: { relay_ws: origin.replace(/^http/u, 'ws') + '/ws', host_ticket, expires_at: new Date(Date.now() + 3600000).toISOString() } }
      }
      if ((m = /^\/v1\/remote\/devices\/([^/]+)$/u.exec(path)) !== null && method === 'DELETE') {
        const d = state.devices.get(decodeURIComponent(m[1]))
        if (d === undefined) return { status: 404, body: { error: 'not_found' } }
        state.devices.delete(d.device_id)
        state.tickets.delete(d.sid)
        for (const [pid, p] of state.pairings) { if (p.device_id === d.device_id) state.pairings.delete(pid) }
        const room = state.rooms.get(d.sid)
        if (room) for (const p of [room.host, room.phone]) { if (p) { p.send(JSON.stringify({ t: 'error', code: 'revoked' }), false); p.close() } }
        return { status: 204, body: null }
      }
      return { status: 404, body: { error: 'not_found' } }
    },
  }

  // ── the relay ──
  const known = (sid) => {
    for (const p of state.pairings.values()) if (p.sid === sid && (p.device_id !== null || p.expires > Date.now())) return true
    for (const d of state.devices.values()) if (d.sid === sid) return true
    return false
  }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    const files = {
      '/__kb/': ['phone/index.html', 'text/html; charset=utf-8'],
      '/__kb/phone.mjs': ['phone/phone.mjs', 'text/javascript'],
      '/__kb/remote-e2e.mjs': ['remote-e2e.mjs', 'text/javascript'],
      '/__kb/manifest.webmanifest': ['phone/manifest.webmanifest', 'application/manifest+json'],
      '/__kb/icon.svg': ['phone/icon.svg', 'image/svg+xml'],
      '/sw.js': ['phone/sw.js', 'text/javascript'],
    }
    const hit = files[u.pathname]
    if (hit !== undefined) {
      try {
        res.writeHead(200, { 'content-type': hit[1], 'cache-control': 'no-store', ...(u.pathname === '/sw.js' ? { 'service-worker-allowed': '/' } : {}) })
        return res.end(readFileSync(join(MOBILE, hit[0])))
      } catch (e) { res.writeHead(500); return res.end('missing ' + hit[0]) }
    }
    if (u.pathname === '/v1/me' || u.pathname === '/v1/workspaces') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(u.pathname === '/v1/me' ? { id: 'u1', name: 'Live Tester', plan: 'solo' } : { workspaces: [] }))
    }
    if (u.pathname.startsWith('/v1/remote/')) {
      // HTTP face of the same routes, for a real kybernos-cloud pointed at this stand-in (live checks)
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', async () => {
        let body = null
        try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null } catch (e) { body = null }
        const r = await api.call(u.pathname, { method: req.method, body })
        res.writeHead(r.status, { 'content-type': 'application/json' })
        res.end(r.body === null ? '' : JSON.stringify(r.body))
      })
      return
    }
    state.httpMisses.push(req.method + ' ' + u.pathname)
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('fake relay: nothing here')
  })

  server.on('upgrade', (req, socket) => {
    const u = new URL(req.url, 'http://x')
    if (u.pathname !== '/ws') { socket.destroy(); return }
    const peer = acceptWebSocket(req, socket)
    if (peer === null) return
    let role = null
    let sid = null
    peer.onmessage = (data, binary) => {
      if (role === null) {
        // the first frame must be the auth text frame
        let m = null
        try { m = JSON.parse(data.toString('utf8')) } catch (e) { m = null }
        const fail = (code) => { peer.send(JSON.stringify({ t: 'error', code }), false); peer.close() }
        if (m === null || m.t !== 'auth' || typeof m.sid !== 'string' || (m.role !== 'host' && m.role !== 'phone')) return fail('bad_auth')
        if (!known(m.sid)) return fail('unknown_sid')
        if (m.role === 'host') {
          if (!state.entitled) return fail('not_in_plan')
          if (state.tickets.get(m.sid) !== m.ticket) return fail('bad_ticket')
        }
        role = m.role
        sid = m.sid
        const room = state.rooms.get(sid) || { host: null, phone: null }
        state.rooms.set(sid, room)
        const old = room[role]
        room[role] = peer
        if (old && old !== peer) old.close()
        peer.send(JSON.stringify({ t: 'auth-ok' }), false)
        const other = room[role === 'host' ? 'phone' : 'host']
        if (other) { other.send(JSON.stringify({ t: 'peer', state: 'up' }), false); peer.send(JSON.stringify({ t: 'peer', state: 'up' }), false) }
        if (m.role === 'phone') for (const d of state.devices.values()) if (d.sid === sid) d.last_seen_at = new Date().toISOString()
        return
      }
      if (!binary) { state.framesText += 1; return } // text frames from a peer are never forwarded
      state.framesBinary += 1
      if (state.samples.length < 400) state.samples.push(Buffer.from(data).subarray(0, 64).toString('latin1'))
      const room = state.rooms.get(sid)
      const other = room && room[role === 'host' ? 'phone' : 'host']
      if (other) other.send(data, true)
    }
    peer.onclose = () => {
      if (sid === null) return
      const room = state.rooms.get(sid)
      if (!room || room[role] !== peer) return
      room[role] = null
      const other = room[role === 'host' ? 'phone' : 'host']
      if (other) other.send(JSON.stringify({ t: 'peer', state: 'down' }), false)
    }
  })

  await new Promise((resolve) => server.listen(options.port || 0, '127.0.0.1', resolve))
  origin = 'http://127.0.0.1:' + server.address().port
  return {
    api,
    state,
    url: origin,
    wsUrl: origin.replace(/^http/u, 'ws') + '/ws',
    port: server.address().port,
    async close () {
      for (const room of state.rooms.values()) for (const p of [room.host, room.phone]) if (p) p.close()
      await new Promise((resolve) => server.close(resolve))
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    },
  }
}
