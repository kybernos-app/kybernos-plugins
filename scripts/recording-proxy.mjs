#!/usr/bin/env node
// A small recording reverse proxy for end-to-end runs against a LOCAL server (a replica), so a test can SEE what DSH really sends:
// the headers and bodies of the model requests (x-kybernos-workspace, the system prompt text), the invitation calls, the timing.
//
//   node scripts/recording-proxy.mjs --listen 8820 --to http://127.0.0.1:8821 --log /path/to/proxy.jsonl
//
// One JSON line per request, written when the response has ended:
//   { t0, t1, method, path, status, auth, workspace, headers, body, bodyBytes, bodyTruncated }
// - `auth` is a short hash of the Authorization header (enough to tell two accounts apart), never the header itself; cookies are dropped.
// - Bodies of sign-in and sign-up calls (/api/auth/*) are not recorded: they carry passwords. Every other body is kept up to 400 kB.
// - GET /__proxy/mark?label=x writes a marker line (so a script can bracket a step); GET /__proxy/ping answers ok;
//   POST /__proxy/script scripts the next model turn (see below).
// Loopback only on both sides: it refuses a target that is not loopback and listens on 127.0.0.1.
import { createServer, request as httpRequest } from 'node:http'
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, closeSync, openSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const args = process.argv.slice(2)
const arg = (name, fallback) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : fallback)
const listen = Number(arg('--listen', '0'))
const target = new URL(arg('--to', ''))
const logFile = arg('--log', '')
const MAX_BODY = 400 * 1024
if (!Number.isInteger(listen) || listen <= 0 || logFile === '' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
  console.error('usage: --listen <port> --to http://127.0.0.1:<port> --log <file>  (the target must be a loopback address)')
  process.exit(2)
}
closeSync(openSync(logFile, 'a')); chmodSync(logFile, 0o600)
const write = (row) => appendFileSync(logFile, JSON.stringify(row) + '\n')
const short = (text) => createHash('sha256').update(String(text)).digest('hex').slice(0, 8)
const SKIP_BODY = /^\/api\/auth\//

// A scripted model turn: POST /__proxy/script {"tool_calls":[{"name":"memory_search","arguments":{"q":"x"}}],"delay_ms":0} makes the NEXT main chat request (one that carries
// tools, so not a title or a classification call) answer with those tool calls instead of reaching the replica; the request that follows (it carries the tool's
// result) is forwarded as usual. It lets a run make the model call a tool and read, in the next recorded body, what the tool answered.
const scripts = []
const sseToolCalls = (calls) => {
  const base = { id: 'chatcmpl-script', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'script' }
  const frames = [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: calls.map((c, i) => ({ index: i, id: 'call_script_' + i, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } })) }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    { ...base, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ]
  return [...frames.map((f) => 'data: ' + JSON.stringify(f) + '\n\n'), 'data: [DONE]\n\n'].join('')
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/__proxy/ping') { res.end('ok'); return }
  if (url.pathname === '/__proxy/mark') { write({ t0: Date.now(), mark: url.searchParams.get('label') || '' }); res.end('ok'); return }
  const t0 = Date.now()
  const chunks = []
  let size = 0
  req.on('data', (c) => { size += c.length; chunks.push(c) })
  req.on('end', () => {
    const whole = Buffer.concat(chunks)
    if (url.pathname === '/__proxy/script') {
      try { scripts.push(JSON.parse(whole.toString('utf8'))); res.end('queued ' + scripts.length) } catch (e) { res.writeHead(400); res.end('bad json') }
      return
    }
    let text = whole.toString('utf8')
    if (req.headers['content-encoding'] === 'gzip') { try { text = gunzipSync(whole).toString('utf8') } catch (e) { /* keep raw */ } }
    const record = (status, extra = {}) => {
      const kept = { ...req.headers }
      delete kept.cookie; delete kept.authorization
      write({
        t0, t1: Date.now(), method: req.method, path: req.url, status,
        auth: req.headers.authorization ? short(req.headers.authorization) : null,
        workspace: req.headers['x-kybernos-workspace'] ?? null,
        headers: kept, body: SKIP_BODY.test(url.pathname) || size === 0 ? null : text.slice(0, MAX_BODY), bodyBytes: size, bodyTruncated: size > MAX_BODY, ...extra,
      })
    }
    if (scripts.length > 0 && req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      let b = null
      try { b = JSON.parse(text) } catch (e) { /* not JSON */ }
      if (b && Array.isArray(b.tools) && b.tools.length > 0) {
        const next = scripts.shift()
        // `delay_ms`: the scripted answer comes that late (a turn that is still waiting for its model while the person does something else)
        setTimeout(() => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(sseToolCalls(next.tool_calls || [])); record(200, { scripted: true }) }, Math.max(0, Number(next.delay_ms) || 0))
        return
      }
    }
    const headers = { ...req.headers, host: target.host, 'content-length': String(whole.length) }
    const up = httpRequest({ hostname: target.hostname === 'localhost' ? '127.0.0.1' : target.hostname, port: target.port, method: req.method, path: req.url, headers }, (back) => {
      res.writeHead(back.statusCode, back.headers)
      back.pipe(res)
      back.on('end', () => record(back.statusCode))
    })
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    up.end(whole)
  })
}).listen(listen, '127.0.0.1', () => console.log('recording proxy on 127.0.0.1:' + listen + ' -> ' + target.origin))
