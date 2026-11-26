// Loaded into every Node process of a test engine with `NODE_OPTIONS=--import <this file>` (scripts/check-phone-model-chat.mjs).
//
// It REFUSES every connection that does not stay on this machine and writes one JSON line for each refusal to the file named by
// KB_EGRESS_LOG: what kind of call it was (fetch, http, plain socket), where it went, and the start of its body when the call
// shows one (fetch and http carry their body in clear before it is encrypted; a bare socket shows only where it goes).
// A test that gives the engine a cloud key can then say what the engine tried to send away, with nothing leaving the machine:
// the key is a canary, and the refused call carries no secret and reaches nobody.
//
// Loopback only passes: 127.0.0.0/8, ::1, localhost. Unix sockets pass (they never leave the machine).
import { appendFileSync } from 'node:fs'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'

const LOG = process.env.KB_EGRESS_LOG
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost|\[::1\]|::ffff:127\.\d+\.\d+\.\d+)$/i
const BODY_HEAD = Math.max(1000, Math.min(2000000, Number(process.env.KB_EGRESS_BODY_MAX) || 6000)) // how much of a body is written down (KB_EGRESS_BODY_MAX raises it to read a whole request)

const note = (entry) => { try { if (LOG) appendFileSync(LOG, JSON.stringify({ t: Date.now(), pid: process.pid, ...entry }) + '\n') } catch (e) { /* the spy never breaks the engine */ } }
const stays = (host) => host === undefined || host === null || host === '' || LOOPBACK.test(String(host))
const head = (body) => {
  try {
    if (body === undefined || body === null) return null
    if (typeof body === 'string') return body.slice(0, BODY_HEAD)
    if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8', 0, BODY_HEAD)
    if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8', 0, BODY_HEAD)
    return '[' + Object.prototype.toString.call(body) + ']'
  } catch (e) { return null }
}
const denied = () => Object.assign(new Error('egress refused by the check'), { code: 'ECONNREFUSED' })

// plain sockets: every other layer (undici, http, https, tls) ends here with the host NAME, before any lookup
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  // `net.connect(options)` hands the socket its arguments already normalised, as an array `[options, callback]`
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const options = first !== null && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : undefined }
  if (options.path !== undefined) return connect.apply(this, args)
  const host = options.host === undefined ? 'localhost' : options.host
  if (stays(host)) return connect.apply(this, args)
  note({ kind: 'socket', host: String(host), port: options.port })
  process.nextTick(() => { try { this.destroy(denied()) } catch (e) { /* gone */ } })
  return this
}

const original = globalThis.fetch
if (typeof original === 'function') {
  globalThis.fetch = async function (input, init) {
    let url = ''
    try { url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url) || '') } catch (e) { url = '' }
    let host = ''
    try { host = new URL(url).hostname } catch (e) { host = '' }
    if (stays(host)) return original.call(this, input, init)
    let body = head(init && init.body)
    if (body === null && input && typeof input.clone === 'function') { try { body = head(await input.clone().text()) } catch (e) { body = null } }
    note({ kind: 'fetch', host, url: url.slice(0, 200), method: (init && init.method) || (input && input.method) || 'GET', body })
    throw new TypeError('fetch failed (egress refused by the check)', { cause: denied() })
  }
}

for (const lib of [http, https]) {
  const request = lib.request
  lib.request = function (...args) {
    const req = request.apply(this, args)
    try {
      const options = args.find((a) => a !== null && typeof a === 'object' && !(a instanceof URL)) || {}
      const url = args[0] instanceof URL ? args[0] : (typeof args[0] === 'string' ? new URL(args[0]) : null)
      const host = (url !== null ? url.hostname : (options.hostname || options.host || 'localhost'))
      if (!stays(host)) {
        const chunks = []
        let size = 0
        const take = (c) => { try { if (c !== undefined && c !== null && typeof c !== 'function' && size < BODY_HEAD) { const s = Buffer.isBuffer(c) ? c.toString('utf8') : String(c); chunks.push(s); size += s.length } } catch (e) { /* not a chunk */ } }
        const write = req.write
        const end = req.end
        req.write = function (c, ...rest) { take(c); return write.call(this, c, ...rest) }
        req.end = function (c, ...rest) {
          take(c)
          note({ kind: lib === https ? 'https' : 'http', host: String(host), path: String(options.path || (url !== null ? url.pathname : '')).slice(0, 200), method: options.method || 'GET', body: chunks.join('').slice(0, BODY_HEAD) || null })
          return end.call(this, c, ...rest)
        }
      }
    } catch (e) { /* the request still goes through the socket guard */ }
    return req
  }
}
