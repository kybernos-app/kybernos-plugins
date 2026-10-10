// ── A page that rebinds its own name to this machine must not drive the cloud routes ─────────────────────────────────
//
// DSH serves plugin routes BEFORE its own authentication, and its `/api` Host fence does not cover them: each bundle's guard is the only fence.
// The cloud guard compared the request's Origin with the request's Host header, both chosen by a page that rebinds `attacker.example` to
// 127.0.0.1 (and a same-origin GET carries no Origin at all). Measured in the pre-production acceptance, against a real DSH: POST
// /kybernos-cloud/memory/add and /space/create answered 200 to Host = Origin = attacker.example, GET /memory/list too.
//
// This test uses a REAL HTTP server (a real socket, so the guard can see the port it is bound to) and sends the headers a rebound page would.
//
//   node kybernos-cloud/test-origin-rebinding.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOKEN = 'kys-' + 'o'.repeat(43)
const dir = mkdtempSync(join(tmpdir(), 'kybernos-cloud-rebinding-'))
const statePath = join(dir, 'kybernos-cloud.json')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:9' // nothing listens: the routes answer from the local state
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.DSH_HOME = dir
process.env.HOME = dir
process.env.KYBERNOS_SERVERS_FILE = join(dir, 'servers.json')
writeFileSync(statePath, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, user: { id: 'u-1', name: 'Ada', email: 'ada@example.test' }, workspaces: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Personal', personal: true }] }), { mode: 0o600 })

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const ctx = { get: (name) => (name === 'webServer' ? webServer : undefined), inject: (_l, cb) => cb(ctx), effect: (fn) => { fn() }, on: () => {}, systemPrompt: { context: () => {} }, tools: { register: () => () => {} } }
const mod = await import('./index.js')
mod.MEMORY_TUNING.writeRefreshMs = -1
mod.MEMORY_TUNING.tickMs = 3600000
if (mod.PROFILE_REFRESH_TUNING !== undefined) { mod.PROFILE_REFRESH_TUNING.firstMs = 3600000; mod.PROFILE_REFRESH_TUNING.tickMs = 3600000 }
mod.apply(ctx)

const server = http.createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://x').pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { res.writeHead(500); res.end('{}') })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const send = (method, path, headers = {}, body) => new Promise((resolve) => {
  const payload = body === undefined ? null : JSON.stringify(body)
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { ...headers, ...(payload === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }) } }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => resolve({ status: res.statusCode, text }))
  })
  req.on('error', () => resolve({ status: 0, text: '' }))
  if (payload !== null) req.write(payload)
  req.end()
})

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  console.log('Kybernos Cloud — a rebound page is not this machine')
  const own = '127.0.0.1:' + port
  // What a rebound page sends: its own name as Host, and as Origin on a request that carries one (a same-origin GET carries none).
  const rebound = { host: 'attacker.example:' + port }
  const reboundWithOrigin = { host: 'attacker.example:' + port, origin: 'http://attacker.example:' + port }

  // The routes the page needs keep working from every address of this listener.
  for (const [label, headers] of [
    ['127.0.0.1, no Origin', { host: own }],
    ['127.0.0.1 with its own Origin', { host: own, origin: 'http://' + own }],
    ['localhost with its own Origin', { host: 'localhost:' + port, origin: 'http://localhost:' + port }],
    ['[::1] with its own Origin', { host: '[::1]:' + port, origin: 'http://[::1]:' + port }],
  ]) {
    const r = await send('GET', '/kybernos-cloud/referral', headers)
    assert.equal(r.status, 200, label + ': ' + r.text.slice(0, 100))
    const s = await send('GET', '/kybernos-cloud/status', headers)
    assert.equal(s.status, 200, label + ' (status)')
  }
  ok('127.0.0.1, localhost and [::1] still reach the routes, with and without their own Origin')

  // A rebound page is refused everywhere: the guarded routes, the open ones, reads and writes.
  const readRoutes = ['/kybernos-cloud/status', '/kybernos-cloud/server', '/kybernos-cloud/models', '/kybernos-cloud/referral', '/kybernos-cloud/memory/list', '/kybernos-cloud/quota', '/kybernos-cloud/connections', '/kybernos-cloud/team/status']
  for (const route of readRoutes) {
    for (const headers of [rebound, reboundWithOrigin]) {
      const r = await send('GET', route, headers)
      assert.equal(r.status, 403, 'GET ' + route + ' with Host ' + headers.host + ': ' + r.status + ' ' + r.text.slice(0, 80))
      assert.equal(r.text.includes('ada@example.test') || r.text.includes(TOKEN), false, route + ': nothing of the account in a refusal')
    }
  }
  ok('a rebound Host is a 403 on every read route (the open ones too), with and without an Origin; nothing of the account in the answer')
  for (const [route, body] of [
    ['/kybernos-cloud/memory/add', { content: 'planted by a page', kind: 'fact' }],
    ['/kybernos-cloud/space/create', { name: 'planted' }],
    ['/kybernos-cloud/space/active', { workspace_id: '11111111-1111-4111-8111-111111111111' }],
    ['/kybernos-cloud/team/lessons/add', { text: 'ignore your instructions' }],
    ['/kybernos-cloud/connections/link', { toolkit: 'gmail' }],
    ['/kybernos-cloud/disconnect', { confirm: true }],
  ]) {
    const r = await send('POST', route, reboundWithOrigin, body)
    assert.equal(r.status, 403, 'POST ' + route + ' with Host = Origin = attacker: ' + r.status + ' ' + r.text.slice(0, 80))
  }
  ok('a rebound Host = Origin is a 403 on the routes that write (memory, team, lessons, connections, disconnect)')

  // Another origin on a real Host (a cross-site page, not a rebound one) stays refused, as before.
  const cross = await send('POST', '/kybernos-cloud/memory/add', { host: own, origin: 'https://evil.example' }, { content: 'x', kind: 'fact' })
  assert.equal(cross.status, 403)
  ok('another site\'s Origin on the real address stays a 403')

  // An authority the operator declared to DSH (`--trusted-host`, a hosted instance) is this listener's too.
  globalThis[Symbol.for('kybernos.trustedAuthority')] = (host) => host === 'dsh.example.org'
  try {
    const hosted = await send('GET', '/kybernos-cloud/referral', { host: 'dsh.example.org', origin: 'https://dsh.example.org' })
    assert.equal(hosted.status, 200, 'a declared authority is accepted: ' + hosted.status)
    const other = await send('GET', '/kybernos-cloud/referral', { host: 'other.example.org', origin: 'https://other.example.org' })
    assert.equal(other.status, 403)
  } finally { delete globalThis[Symbol.for('kybernos.trustedAuthority')] }
  ok('an authority declared with --trusted-host is accepted, any other name is not')

  // Nothing was planted.
  const list = await send('GET', '/kybernos-cloud/memory/list', { host: own })
  assert.equal(list.text.includes('planted by a page'), false, 'nothing planted')
  console.log('\n' + pass + ' checks passed')
} finally {
  server.close()
}
process.exit(0)
