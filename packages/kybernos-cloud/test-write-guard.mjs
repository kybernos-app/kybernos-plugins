// ── The routes that DELETE need DSH's signed session as well as the right Origin ───────────────────────────────────────
//
// DSH serves plugin routes BEFORE its own authentication and an Origin header is forgeable by any local program: before this rule
// `curl -X POST http://127.0.0.1:<port>/kybernos-cloud/memory/delete -d '{"id":"..."}'` deleted a memory of the account, with no header at
// all (the same for a team lesson, a team skill, a connection and a member). Those five routes are the ones the origin-rule audit names.
//
// This test uses a REAL HTTP server and a fake API that keeps the DELETEs it receives: a refused request must never send one to the account's server. For each
// delete, in this order: no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no cookie (what a local
// program sends) · the right Origin and a forged cookie · the right Origin and the real cookie (the person's own page).
//
//   node packages/kybernos-cloud/test-write-guard.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

// The account's server: keeps every DELETE it receives (what a delete route sends; the bundle's own background reads are not counted), answers 200.
const api = { deletes: [] }
const apiServer = http.createServer((req, res) => { if (req.method === 'DELETE') api.deletes.push(req.url); req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}') })
await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve))

const TOKEN = 'kys-' + 'w'.repeat(43)
const WS = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const dir = mkdtempSync(join(tmpdir(), 'kybernos-cloud-write-guard-'))
const statePath = join(dir, 'kybernos-cloud.json')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + apiServer.address().port
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.DSH_HOME = dir
process.env.HOME = dir
process.env.KYBERNOS_SERVERS_FILE = join(dir, 'servers.json')
writeFileSync(statePath, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, user: { id: 'u-1', name: 'Ada', email: 'ada@example.test' }, workspaces: [{ id: WS, name: 'Personal', personal: true }] }), { mode: 0o600 })
sessionSource.secret = () => SESSION_SECRET

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
const own = '127.0.0.1:' + port
const origin = 'http://' + own
const cookie = (opts) => sessionCookie(own, opts)

const send = (path, headers, body) => new Promise((resolve) => {
  const payload = JSON.stringify(body)
  const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { host: own, ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => resolve({ status: res.statusCode, text }))
  })
  req.on('error', () => resolve({ status: 0, text: '' }))
  req.write(payload)
  req.end()
})

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const DELETES = [
  ['/kybernos-cloud/memory/delete', { id: '33333333-3333-4333-8333-333333333333' }],
  ['/kybernos-cloud/members/remove', { workspace_id: WS, user_id: USER }],
  ['/kybernos-cloud/team/lessons/delete', { id: 4 }],
  ['/kybernos-cloud/team/skills/delete', { id: '44444444-4444-4444-8444-444444444444' }],
  ['/kybernos-cloud/connections/delete', { id: '55555555-5555-4555-8555-555555555555' }],
]

try {
  console.log('Kybernos Cloud: the deletes need the signed session')
  for (const [path, body] of DELETES) {
    const before = api.deletes.length
    const forged = cookie({ secret: OTHER_SECRET })
    for (const [headers, want, label] of [
      [{}, 403, 'no Origin and no cookie'],
      [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
      [{ origin }, 401, 'the right Origin and no cookie'],
      [{ origin, cookie: forged }, 401, 'the right Origin and a forged cookie'],
    ]) {
      const r = await send(path, headers, body)
      assert.equal(r.status, want, path + ': ' + label + ' -> ' + r.status + ' ' + r.text.slice(0, 80))
      assert.equal(r.text.includes(TOKEN), false, path + ': the token never leaves in a refusal')
    }
    assert.equal(api.deletes.length, before, path + ': a refused request never sent a DELETE to the account\'s server')
    const real = await send(path, { origin, cookie: cookie() }, body)
    assert.equal(real.status, 200, path + ': the right Origin and the real cookie -> the route answers: ' + real.status + ' ' + real.text.slice(0, 80))
    ok(path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · no DELETE sent · the real pair 200')
  }
  assert.ok(api.deletes.length >= 2, 'the real pair does reach the account\'s server: ' + JSON.stringify(api.deletes))

  // The reads keep their rule.
  const get = (path, headers) => new Promise((resolve) => http.get({ host: '127.0.0.1', port, path, headers: { host: own, ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) }).on('error', () => resolve(0)))
  assert.equal(await get('/kybernos-cloud/status', {}), 200, 'a read needs no header')
  assert.equal(await get('/kybernos-cloud/memory/list', { origin: 'http://evil.example' }), 403, 'a read from a foreign Origin is still refused')
  ok('the reads keep their rule: answered with no header, refused from a foreign Origin')
} finally {
  server.close()
  apiServer.close()
  rmSync(dir, { recursive: true, force: true })
}
console.log('\n' + pass + ' verifications OK')
process.exit(0)
