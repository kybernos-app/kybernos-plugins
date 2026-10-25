// ── The routes that DELETE need DSH's signed session as well as the right Origin ───────────────────────────────────────
//
// DSH serves plugin routes BEFORE its own authentication and an Origin header is forgeable by any local program: before this rule
// `curl -X POST http://127.0.0.1:<port>/kybernos-cloud/memory/delete -d '{"id":"..."}'` deleted a memory of the account, with no header at
// all (the same for a team lesson, a team skill, a connection and a member). Those five routes are the ones the origin-rule audit names.
// The same rule covers six more, because the model has a shell: writing or editing a memory, pushing the lessons, choosing the active space (which decides whether the
// personal memory is cut), proposing to the team, making a session Kaby's and accepting an invitation to a team. A bare curl against them reaches nothing.
//
// L3-04 and L3-05 (recette 2026-10-25): fifteen more writes had stayed at the strict Origin alone, and a local program (or another account of the machine) that
// sent the right Origin could rewrite <DSH home>/AGENTS.md (read by every agent), ask for the Telegram or WhatsApp pairing link of the account, unlink a channel,
// move Kaby to another computer, wake or put the Home computer to sleep, mint a console link and open the payment pages. They carry the pair now, and the last
// block of this file is the table of the whole POST surface of ROUTES: a row is `session: true`, or it says in `noSession` which caller that is not a browser
// keeps it at the Origin alone. A new route that is neither fails here.
//
// This test uses a REAL HTTP server and a fake API that keeps the DELETEs it receives: a refused request must never send one to the account's server. For each
// delete, in this order: no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no cookie (what a local
// program sends) · the right Origin and a forged cookie · the right Origin and the real cookie (the person's own page).
//
//   node packages/kybernos-cloud/test-write-guard.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'
import { SESSION_WRITE_PATHS, STRICT_ONLY_EXCEPTIONS } from './lib-session-routes-test.mjs'

// The account's server: keeps every DELETE it receives (what a delete route sends; the bundle's own background reads are not counted), answers 200.
// `sent` is every request that is not a read, whatever its method: a refused request must leave it as it was.
const api = { deletes: [], writes: [], sent: [] }
const apiServer = http.createServer((req, res) => { if (req.method !== 'GET') api.sent.push(req.method + ' ' + req.url); if (req.method === 'DELETE') api.deletes.push(req.url); if (req.method === 'POST' || req.method === 'PATCH') api.writes.push(req.method + ' ' + req.url); req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}') })
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
  ['/kybernos-cloud/team/automations/delete', { id: 12 }],
  ['/kybernos-cloud/connections/delete', { id: '55555555-5555-4555-8555-555555555555' }],
]

// What a model with a shell could otherwise do with a bare request: none of these may send anything to the account's server, or change the state, without the pair.
const WRITES = [
  ['/kybernos-cloud/memory/add', { content: 'A memory a shell tried to add.', kind: 'fact' }],
  ['/kybernos-cloud/memory/update', { id: '77', content: 'An edit a shell tried.' }],
  ['/kybernos-cloud/team/lessons/add', { text: 'A lesson a shell tried to propose to the team.' }],
  // The Team's automations: a bare request could propose one, decide on one, or take one off the catalogue (the delete is in the list above).
  ['/kybernos-cloud/team/automations/add', { key: 'shell-proposal', name: 'A proposal', description: 'A shell tried to propose it.', prompt: 'Say hi.', schedule: { mode: 'webhook' }, needs: [] }],
  ['/kybernos-cloud/team/automations/check', { key: 'shell-proposal', name: 'A proposal', description: 'A shell tried to check it.', prompt: 'Say hi.', schedule: { mode: 'webhook' }, needs: [] }],
  ['/kybernos-cloud/team/automations/review', { id: 12, decision: 'approve' }],
  ['/kybernos-cloud/team/automations/retire', { id: 12 }],
  ['/kybernos-cloud/space/active', { workspace_id: WS }],
  ['/kybernos-cloud/kyby/native/set', { sessionId: null }],
  // A team's working folder is made on the person's disk (test-team-folder-host.mjs holds its rules).
  ['/kybernos-cloud/space/folder', { workspace_id: WS }],
  // Joining a team: the invitation's token makes the person a member (test-join-host.mjs plays the answers of the server).
  ['/kybernos-cloud/invitation/accept', { token: 'k3Zp9-Qw_7Lm2XvB0cR8sTnYh4JdUeA6oGfIiNaPqMc' }],
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

  for (const [path, body] of WRITES) {
    const before = api.writes.length
    const forged = cookie({ secret: OTHER_SECRET })
    for (const [headers, want, label] of [
      [{}, 403, 'no Origin and no cookie'],
      [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
      [{ origin }, 401, 'the right Origin and no cookie'],
      [{ origin, cookie: forged }, 401, 'the right Origin and a forged cookie'],
    ]) {
      const r = await send(path, headers, body)
      assert.equal(r.status, want, path + ': ' + label + ' -> ' + r.status + ' ' + r.text.slice(0, 80))
    }
    assert.equal(api.writes.length, before, path + ': a refused request never sent a write to the account\'s server')
    const real = await send(path, { origin, cookie: cookie() }, body)
    assert.equal(real.status, 200, path + ': the right Origin and the real cookie -> the route answers: ' + real.status + ' ' + real.text.slice(0, 80))
    ok(path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · nothing sent · the real pair 200')
  }

  // L3-04 / L3-05: the fifteen writes that sat at the Origin alone. Each body is harmless against the fake account server (it answers `{}` to everything). A refused
  // request must not reach that server and must not write the instructions file; the real pair reaches the handler, which answers in its own words (a 200 with
  // `ok: false` is a normal answer from an account that is not what the route wants, never an auth refusal).
  const AGENTS = join(dir, 'AGENTS.md')
  const CONVERTED = [
    // <DSH home>/AGENTS.md is read by every agent, and the agent has a shell: a line written here runs.
    ['/kybernos-cloud/instructions/save', { text: 'A line a shell tried to put in the file every agent reads.' }],
    // A pairing link, once opened in Telegram or WhatsApp and confirmed there, connects that chat to the account's Kaby.
    ['/kybernos-cloud/telegram/pairing', {}],
    ['/kybernos-cloud/telegram/pairing/cancel', { id: 'pair-1' }],
    ['/kybernos-cloud/telegram/unlink', {}],
    ['/kybernos-cloud/whatsapp/pairing', {}],
    ['/kybernos-cloud/whatsapp/pairing/cancel', { id: 'pair-1' }],
    ['/kybernos-cloud/whatsapp/unlink', {}],
    ['/kybernos-cloud/kyby/computer', { computer_id: null }],
    // The Home computer: wake, put to sleep, and the link that opens it.
    ['/kybernos-cloud/computer/open', {}],
    ['/kybernos-cloud/computer/resume', {}],
    ['/kybernos-cloud/computer/suspend', {}],
    // A single-use link that opens the account's console, and the two payment pages.
    ['/kybernos-cloud/console/link', {}],
    ['/kybernos-cloud/billing/checkout', { workspace_id: WS, plan: 'team' }],
    ['/kybernos-cloud/billing/portal', { workspace_id: WS }],
    // Reads one invitation at the server with the token the caller holds: nothing is written, but a page is the only caller, so it joins the family.
    ['/kybernos-cloud/invitation/preview', { token: 'k3Zp9-Qw_7Lm2XvB0cR8sTnYh4JdUeA6oGfIiNaPqMc' }],
  ]
  for (const [path, body] of CONVERTED) {
    const before = api.sent.length
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
    assert.equal(api.sent.length, before, path + ': a refused request never sent anything to the account\'s server')
    assert.equal(existsSync(AGENTS), false, path + ': a refused request wrote no instructions file')
    const real = await send(path, { origin, cookie: cookie() }, body)
    assert.equal(real.status, 200, path + ': the right Origin and the real cookie -> the route answers: ' + real.status + ' ' + real.text.slice(0, 80))
    assert.equal(typeof JSON.parse(real.text), 'object', path + ': the route answers in JSON')
    if (path === '/kybernos-cloud/instructions/save') {
      assert.equal(existsSync(AGENTS), true, 'the real pair does write the instructions')
      rmSync(AGENTS, { force: true })
    }
    ok(path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · nothing sent · the real pair 200')
  }

  // The whole POST surface of the table, so that a route added tomorrow cannot be forgotten: a row is `session: true`, or it is one of the documented exceptions,
  // strict, with the caller that is not a browser written in `noSession`. The test lists of lib-session-routes-test.mjs must say the same.
  const posts = mod.ROUTES.filter((r) => r.method !== 'GET')
  assert.ok(posts.length >= 60, 'the table has its POST rows: ' + posts.length)
  const atOrigin = posts.filter((r) => r.session !== true)
  assert.deepEqual(atOrigin.map((r) => r.path).sort(), [...STRICT_ONLY_EXCEPTIONS.keys()].sort(),
    'the POST routes without `session: true` are exactly the documented exceptions (add `session: true`, or write `noSession` and name the exception in lib-session-routes-test.mjs)')
  for (const r of atOrigin) {
    assert.equal(r.strict, true, r.path + ': an exception keeps at least the strict Origin')
    assert.ok(typeof r.noSession === 'string' && r.noSession.length >= 30, r.path + ': an exception says in `noSession` which caller is not a browser')
  }
  for (const r of posts.filter((x) => x.session === true)) assert.equal(r.noSession, undefined, r.path + ': a route under the cookie rule needs no exception')
  assert.deepEqual(posts.filter((r) => r.session === true).map((r) => r.path).sort(), [...SESSION_WRITE_PATHS].sort(), 'lib-session-routes-test.mjs lists the routes under the cookie rule')
  for (const path of STRICT_ONLY_EXCEPTIONS.keys()) {
    // What stays open is still not open to a program that sends no Origin, nor to a foreign page (nothing is read, so nothing is done).
    for (const [headers, label] of [[{}, 'no Origin'], [{ origin: 'http://evil.example', cookie: cookie() }, 'a foreign Origin']]) {
      const r = await send(path, headers, {})
      assert.equal(r.status, 403, path + ': ' + label + ' -> ' + r.status)
    }
  }
  // The caller that keeps `computer/claimed` at the Origin alone is the claimer of the cloud computer's image (services/computer-image/claimer.mjs): it posts to
  // loopback with the Origin and no cookie, so the route must still answer it. A conversion would leave every pooled computer unclaimed.
  const claimed = await send('/kybernos-cloud/computer/claimed', { origin }, {})
  assert.equal(claimed.status, 200, 'computer/claimed answers the claimer (the right Origin, no cookie): ' + claimed.status + ' ' + claimed.text.slice(0, 80))
  ok('the POST table: ' + (posts.length - atOrigin.length) + ' rows under the cookie rule, ' + atOrigin.length + ' documented exceptions with their reason, and no other')

  // The reads keep their rule.
  const get =(path, headers) => new Promise((resolve) => http.get({ host: '127.0.0.1', port, path, headers: { host: own, ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) }).on('error', () => resolve(0)))
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
