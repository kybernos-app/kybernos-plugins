#!/usr/bin/env node
// Unit and integration tests for kybernos-usage Context Insight (context-insight.mjs + /kybernos-usage/context).
// Runs in a temporary directory: no network, no external zstd binary.
//
//   node packages/kybernos-usage/test-context-insight.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { analyzeJournal, createContextReader, findSessionJournal, safeSessionId, zstdFrames } from './context-insight.mjs'
import { createStore, mountRoutes } from './usage-host.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const root = mkdtempSync(join(tmpdir(), 'kb-ctx-insight-'))

try {
  console.log('\n── safeSessionId and zstdFrames ──')
  check('safeSessionId strips prefix and blocks traversal', safeSessionId('session-abc_12') === 'abc_12' && safeSessionId('../x') === '' && safeSessionId('a/b') === '')

  const frame1 = zstdCompressSync(Buffer.from('{"type":"turn/start"}\n'))
  const frame2 = zstdCompressSync(Buffer.from('{"type":"user/message","data":{"content":"hi"}}\n'))
  const joined = zstdFrames(Buffer.concat([frame1, frame2]))
  check('zstdFrames decodes concatenated zstd frames', joined.includes('"turn/start"') && joined.includes('"user/message"'))

  console.log('\n── analyzeJournal: breakdown, compaction reset, topTools, privacy ──')
  const lines = [
    // Events BEFORE compaction (must be excluded from active window, kept in usage/compactions)
    JSON.stringify({ type: 'request/header', data: { header: { config: { provider: 'deepseek', model: 'v4', contextWindow: 200000 }, systemPrompt: 's'.repeat(400), tools: [{ name: 'bash' }, { name: 'read' }] } } }),
    JSON.stringify({ type: 'user/message', data: { source: { kind: 'user' }, content: 'old message before compaction '.repeat(20) } }),
    JSON.stringify({ type: 'tool/call', data: { callId: 'c-old', name: 'read' } }),
    JSON.stringify({ type: 'tool/result', data: { message: { source: { callId: 'c-old' }, content: [{ type: 'text', text: 'o'.repeat(4000) }] } } }),
    JSON.stringify({ type: 'assistant/message', data: { message: { content: 'old reply' }, usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 9000, cacheWriteTokens: 0 } } }),
    JSON.stringify({ type: 'compaction/summary', time: 1700000001000, data: { summary: 'c'.repeat(800) } }),
    JSON.stringify({ type: 'compaction/end', data: { ok: false } }),
    // Events AFTER compaction (the active window)
    JSON.stringify({ type: 'turn/start' }),
    JSON.stringify({ type: 'user/message', data: { source: { kind: 'user' }, content: 'SECRET_USER_TEXT_' + 'u'.repeat(383) } }),
    JSON.stringify({ type: 'user/message', data: { source: { kind: 'runtime' }, content: 'i'.repeat(400) } }),
    JSON.stringify({ type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: { command: 'npm test' } } }),
    JSON.stringify({ type: 'tool/result', data: { message: { source: { callId: 'c1' }, content: [{ type: 'text', text: 'b'.repeat(3900) + '\n[kybernos: shell output compressed 20000 -> 3900 chars (80% saved)]' }] } } }),
    JSON.stringify({ type: 'tool/call', data: { callId: 'c2', name: 'grep', arguments: { q: 'x' } } }),
    JSON.stringify({ type: 'tool/result', data: { message: { source: { callId: 'c2' }, content: [{ type: 'text', text: 'g'.repeat(800) }] } } }),
    JSON.stringify({ type: 'assistant/message', data: { message: { content: 'a'.repeat(400) }, usage: { inputTokens: 500, outputTokens: 100, cacheReadTokens: 4500, cacheWriteTokens: 0 } } }),
    '{broken-json-line'
  ].join('\n')

  const analyzed = analyzeJournal(lines)
  check('active window resets at compaction/summary and counts post-compaction tool outputs only',
    analyzed.active.toolCount === 2 && analyzed.active.topTools[0].name === 'bash' && analyzed.active.topTools[1].name === 'grep' &&
    analyzed.active.topTools[0].tokens > analyzed.active.topTools[1].tokens, analyzed.active)
  check('active window separates user, assistant, injected (including summary) and system tokens',
    analyzed.active.userTokens === 100 && analyzed.active.injectedTokens === 300 && analyzed.active.systemTokens === 100 && analyzed.active.toolDefsCount === 2, analyzed.active)
  check('compactions count, failure count and lastAt are recorded',
    analyzed.compactions.count === 1 && analyzed.compactions.failures === 1 && analyzed.compactions.lastAt === 1700000001000)
  check('real usage cacheHitRate is computed across session',
    analyzed.usage.cacheRead === 13500 && analyzed.usage.input === 1500 && analyzed.usage.cacheHitRate === 0.9, analyzed.usage)
  check('shell compression marker is counted', analyzed.compression.compressedCount === 1)
  check('privacy: output never leaks raw user or tool text', !JSON.stringify(analyzed).includes('SECRET_USER_TEXT'))

  console.log('\n── createContextReader and HTTP route /kybernos-usage/context ──')
  const sessionsHome = join(root, 'sessions')
  const sdir = join(sessionsHome, '--tmp-proj--', 'session-s42')
  mkdirSync(sdir, { recursive: true })
  const zfile = join(sdir, 'session.v4.jsonl.zstd')
  writeFileSync(zfile, zstdCompressSync(Buffer.from(lines)))

  check('findSessionJournal locates v4 zstd file', findSessionJournal(sessionsHome, 's42')?.file === zfile)

  const reader = createContextReader({ sessionsHome })
  const first = reader.read('s42')
  check('reader reads and analyzes compressed session journal', first.ok === true && first.session === 's42' && first.active.toolCount === 2)
  // Cache hit when mtime unchanged
  const cached = reader.read('s42')
  check('second read hits cache cleanly', cached.ok === true && cached.active.toolCount === 2)
  // Update journal & advance mtime -> cache refreshes
  writeFileSync(zfile, zstdCompressSync(Buffer.from(lines + '\n' + JSON.stringify({ type: 'tool/result', data: { message: { source: { toolName: 'read' }, content: [{ type: 'text', text: 'r'.repeat(1200) }] } } }))))
  const future = new Date(Date.now() + 5000)
  utimesSync(zfile, future, future)
  const refreshed = reader.read('s42')
  check('updated journal mtime refreshes cached breakdown', refreshed.ok === true && refreshed.active.toolCount === 3)

  const routes = {}
  const store = createStore({ read: () => null, write: () => {} })
  mountRoutes({ register: (r) => { routes[r.path] = r.handler } }, store, { contextReader: reader })
  const call = async (path, { method = 'GET', headers = {}, url } = {}) => {
    const req = { method, url: url || path, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', ...headers }, socket: { localPort: 3080 } }
    let status = 0; let out = ''
    const res = { writeHead: (s) => { status = s }, end: (b) => { out = b } }
    await routes[path](req, res)
    return { status, json: out === '' ? null : JSON.parse(out) }
  }

  const okRes = await call('/kybernos-usage/context', { url: '/kybernos-usage/context?session=s42' })
  check('GET /kybernos-usage/context returns 200 with breakdown', okRes.status === 200 && okRes.json.ok === true && okRes.json.active.toolCount === 3)
  check('GET /kybernos-usage/context with missing session returns 400', (await call('/kybernos-usage/context')).status === 400)
  check('GET /kybernos-usage/context with unknown session returns 404', (await call('/kybernos-usage/context', { url: '/kybernos-usage/context?session=nope' })).status === 404)
  check('POST /kybernos-usage/context returns 405', (await call('/kybernos-usage/context', { method: 'POST' })).status === 405)
  check('GET /kybernos-usage/context refuses foreign Origin (403)', (await call('/kybernos-usage/context', { url: '/kybernos-usage/context?session=s42', headers: { origin: 'https://evil.example' } })).status === 403)
  check('GET /kybernos-usage/context refuses foreign Host (403 DNS rebinding)', (await call('/kybernos-usage/context', { url: '/kybernos-usage/context?session=s42', headers: { host: 'attacker.example:3080', origin: '' } })).status === 403)
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
assert.equal(fail, 0, fail + ' check(s) failed')
process.exit(0)
