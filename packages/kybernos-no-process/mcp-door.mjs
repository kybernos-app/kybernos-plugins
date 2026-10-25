// kybernos-inproc-mcp-door: runs MCP servers written for stdio INSIDE the process (one worker thread each, same JSON-RPC lines on the worker's
// stdin/stdout) and serves them over Streamable HTTP on 127.0.0.1, which is the other transport the engine's MCP client speaks. A host that cannot
// create processes points `mcp-client` entries at http://127.0.0.1:<port>/mcp/<name>. Stateless, JSON responses only (a spec-conformant subset): no
// session id, GET answers 405 (no server-initiated stream). Every request needs `Authorization: Bearer <token>` and no browser `Origin`.
// Servers that wrap an external program (a language server, a CLI) cannot run here: they must be remote HTTP servers.
import { createServer } from 'node:http'
import { Worker } from 'node:worker_threads'
import { randomBytes, timingSafeEqual } from 'node:crypto'

export const name = 'kybernos-inproc-mcp-door'
const log = (...a) => { try { console.log('[inproc-mcp] ' + a.join(' ')) } catch { /* no console */ } }

/** One stdio-style MCP server in a worker thread; requests are matched to responses by a rewritten JSON-RPC id. */
export class StdioWorker {
  constructor(file, args = [], env = {}) { this.file = file; this.args = args; this.env = env; this.w = null; this.pending = new Map(); this.next = 1; this.buf = '' }
  start() {
    if (this.w !== null) return
    const w = new Worker(this.file, { argv: this.args, env: { ...process.env, ...this.env }, stdin: true, stdout: true, stderr: true })
    this.w = w
    w.stdout.setEncoding('utf8')
    w.stdout.on('data', (chunk) => {
      this.buf += chunk
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1)
        if (line === '') continue
        let msg
        try { msg = JSON.parse(line) } catch { log(this.file.split('/').pop() + ': non-JSON line ignored'); continue }
        const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined
        if (p !== undefined) { clearTimeout(p.timer); this.pending.delete(msg.id); p.resolve({ ...msg, id: p.outerId }) }
      }
    })
    w.stderr.setEncoding('utf8'); w.stderr.on('data', (s) => log(this.file.split('/').pop() + ' stderr: ' + s.trim().slice(0, 200)))
    const fail = (e) => { for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(e) } this.pending.clear(); this.w = null }
    w.on('error', (e) => { log('worker error: ' + e.message); fail(e) })
    w.on('exit', (code) => { if (this.w !== null) log('worker exited: ' + code); fail(new Error('MCP server exited (' + code + ')')) })
  }
  request(msg, timeoutMs = 120000) {
    this.start()
    const id = this.next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('MCP server timed out')) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer, outerId: msg.id })
      this.w.stdin.write(JSON.stringify({ ...msg, id }) + '\n')
    })
  }
  notify(msg) { this.start(); this.w.stdin.write(JSON.stringify(msg) + '\n') }
  stop() { const w = this.w; this.w = null; if (w !== null) w.terminate() }
}

const bearerOk = (header, token) => {
  const want = Buffer.from('Bearer ' + token)
  const got = Buffer.from(typeof header === 'string' ? header : '')
  return got.length === want.length && timingSafeEqual(got, want)
}

/** The HTTP door. servers: { <name>: { file, args?, env? } }. Resolves to { port, close() }. */
export const createDoor = ({ port = 0, token, servers }) => new Promise((resolve, reject) => {
  const workers = new Map(Object.entries(servers).map(([n, s]) => [n, new StdioWorker(s.file, s.args ?? [], s.env ?? {})]))
  const send = (res, status, body, headers = {}) => { res.writeHead(status, body === undefined ? headers : { 'content-type': 'application/json', ...headers }); res.end(body === undefined ? undefined : JSON.stringify(body)) }
  const http = createServer((req, res) => {
    if (req.headers.origin !== undefined) return send(res, 403, { error: 'browser origins are refused' })
    if (!bearerOk(req.headers.authorization, token)) return send(res, 401, { error: 'bearer token required' }, { 'www-authenticate': 'Bearer' })
    const m = /^\/mcp\/([A-Za-z0-9_-]{1,32})$/.exec((req.url ?? '').split('?')[0])
    const worker = m === null ? undefined : workers.get(m[1])
    if (worker === undefined) return send(res, 404, { error: 'unknown MCP server' })
    if (req.method !== 'POST') return send(res, 405, undefined, { allow: 'POST' })
    let body = ''
    req.on('data', (d) => { body += d; if (body.length > 8 * 1024 * 1024) req.destroy() })
    req.on('end', async () => {
      let parsed
      try { parsed = JSON.parse(body) } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) }
      const msgs = Array.isArray(parsed) ? parsed : [parsed]
      const out = []
      for (const msg of msgs) {
        if (msg !== null && typeof msg === 'object' && typeof msg.method === 'string' && msg.id !== undefined) {
          try { out.push(await worker.request(msg)) } catch (e) { out.push({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }) }
        } else worker.notify(msg)
      }
      if (out.length === 0) return send(res, 202, undefined)
      send(res, 200, Array.isArray(parsed) ? out : out[0])
    })
  })
  http.once('error', reject)
  http.listen(port, '127.0.0.1', () => resolve({ port: http.address().port, close: () => { http.close(); for (const w of workers.values()) w.stop() } }))
})

/** Cordis plugin: reads KYBERNOS_INPROC_MCP_SERVERS (JSON { name: { file, args?, env? } }), _PORT and _TOKEN; does nothing when no server is configured. */
export function apply(ctx) {
  let servers = {}
  try { servers = JSON.parse(process.env.KYBERNOS_INPROC_MCP_SERVERS ?? '{}') } catch { log('KYBERNOS_INPROC_MCP_SERVERS is not JSON: ignored') }
  if (Object.keys(servers).length === 0) return
  const token = process.env.KYBERNOS_INPROC_MCP_TOKEN || randomBytes(24).toString('hex')
  const port = Number(process.env.KYBERNOS_INPROC_MCP_PORT ?? 0)
  let door = null
  createDoor({ port, token, servers }).then((d) => { door = d; log('serving ' + Object.keys(servers).join(', ') + ' on 127.0.0.1:' + d.port) }, (e) => log('could not listen: ' + e.message))
  ctx.effect(() => () => { if (door !== null) door.close() }, 'kybernos-inproc-mcp-door')
}
