// The routes of this bundle that WRITE or SPEND (the E2B key, starting, running and writing in a sandbox, stopping, pausing, resuming, the
// environment switch) need DSH's signed session as well as the right Origin. DSH serves plugin routes before its own login and an Origin header
// is forgeable by any local program: before this rule `curl -X POST http://127.0.0.1:<port>/kybernos-computers/sandboxes/exec` ran a command in the
// person's E2B sandbox, on the person's key and bill, with no header at all.
//
// A fake SDK counts every call it receives: a refused request must never reach it, and must leave the state file and the key store as they were.
// For each write, in this order: no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no cookie (what a
// local program sends) · the right Origin and a forged cookie · the right Origin and the real cookie (the Code sandbox page).
//
//   node packages/kybernos-computers/test-write-guard.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

// The state lives under DSH_HOME, read when the module loads: point it at a throw-away folder first.
const dir = mkdtempSync(join(tmpdir(), 'kbc-guard-'))
process.env.DSH_HOME = dir
delete process.env.E2B_API_KEY
sessionSource.secret = () => SESSION_SECRET

const mod = await import('./index.js')
const { ROUTES, apply, testHooks } = mod

let passed = 0
const ok = (label) => { passed += 1; console.log('  ✓ ' + label) }

const creds = { store: new Map([['E2B_API_KEY', 'e2b_' + 'a'.repeat(40)]]) }
creds.resolve = async (k) => (creds.store.has(k) ? { value: creds.store.get(k), source: 'file' } : undefined)
creds.set = async (k, v) => { creds.store.set(k, v) }
creds.unset = async (k) => { creds.store.delete(k) }
testHooks.setCredentialsForTests(creds)

let sdkCalls = 0
const sandboxes = new Map()
const fakeSandbox = (id) => ({
  sandboxId: id,
  commands: { run: async () => { sdkCalls += 1; return { exitCode: 0, stdout: 'ran', stderr: '' } } },
  files: { write: async () => { sdkCalls += 1 }, read: async () => { sdkCalls += 1; return 'x' } },
  kill: async () => { sdkCalls += 1; sandboxes.delete(id) },
})
testHooks.setSdkForTests({ Sandbox: {
  create: async () => { sdkCalls += 1; const id = 'sbx-1'; const sb = fakeSandbox(id); sandboxes.set(id, sb); return sb },
  connect: async (id) => { sdkCalls += 1; if (!sandboxes.has(id)) throw new Error('not found'); return sandboxes.get(id) },
  kill: async (id) => { sdkCalls += 1; sandboxes.delete(id) },
  betaPause: async () => { sdkCalls += 1; return true },
} })

const registered = {}
apply({
  get: (n) => (n === 'webServer' ? { register: ({ path, handler }) => { registered[path] = handler; return () => {} } } : undefined),
  inject: () => {}, effect: (fn) => { void fn() }, on: () => {},
})

const hit = async (path, method, headers, body) => {
  const raw = body === undefined ? '' : JSON.stringify(body)
  const req = { method, url: path, headers: { host: '127.0.0.1:3080', 'content-type': 'application/json', ...headers }, socket: { localPort: 3080 }, destroy () {}, on (ev, cb) { if (ev === 'data' && raw !== '') cb(Buffer.from(raw)); if (ev === 'end') cb() } }
  const out = { status: 0, json: null }
  await registered[path](req, { writeHead (s) { out.status = s }, end (b) { try { out.json = JSON.parse(b) } catch (e) { out.json = null } } })
  return out
}
const stateText = () => { try { return readFileSync(join(dir, 'kybernos-computers', 'state.json'), 'utf8') } catch (e) { return '' } }

const WRITES = ROUTES.filter((r) => r.method === 'POST')
assert.equal(WRITES.length, 9, 'the nine writes of this bundle')
assert.ok(WRITES.every((r) => r.session === true), 'every POST route is marked session: true')
assert.ok(ROUTES.filter((r) => r.method === 'GET').every((r) => r.session !== true), 'the reads are not')
ok('ROUTES: the nine POST routes need the session, the GET routes do not')

// A sandbox to act on (started the legitimate way), then every write attempted without the right pair.
let r = await hit('/kybernos-computers/sandboxes/start', 'POST', browserHeaders(), { label: 'guard' })
assert.equal(r.status, 200); assert.equal(r.json.ok, true, JSON.stringify(r.json))
const id = r.json.sandbox.sandboxId
sdkCalls = 0
const BODIES = {
  '/kybernos-computers/key/set': { key: 'e2b_' + 'b'.repeat(40) },
  '/kybernos-computers/key/clear': {},
  '/kybernos-computers/sandboxes/start': { label: 'intruder' },
  '/kybernos-computers/sandboxes/exec': { sandboxId: id, command: 'id' },
  '/kybernos-computers/sandboxes/write': { sandboxId: id, path: '/tmp/x', content: 'x' },
  '/kybernos-computers/sandboxes/stop': { sandboxId: id, confirm: true },
  '/kybernos-computers/sandboxes/pause': { sandboxId: id },
  '/kybernos-computers/sandboxes/resume': { sandboxId: id },
  '/kybernos-computers/env/set': { env: 'e2b' },
}
for (const w of WRITES) {
  const body = BODIES[w.path]
  assert.ok(body !== undefined, w.path + ' has a body in this test')
  const before = { state: stateText(), keys: JSON.stringify([...creds.store]) }
  const refusals = [
    [{}, 403, 'no Origin and no cookie'],
    [{ ...browserHeaders(), origin: 'http://evil.example' }, 403, 'a foreign Origin, even with the real cookie'],
    [{ origin: 'http://127.0.0.1:3080' }, 401, 'the right Origin and no cookie'],
    [{ origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }, 401, 'the right Origin and a forged cookie'],
  ]
  for (const [headers, want, label] of refusals) assert.equal((await hit(w.path, 'POST', headers, body)).status, want, w.path + ': ' + label)
  assert.equal(sdkCalls, 0, w.path + ': a refused request never reached the SDK')
  assert.equal(stateText(), before.state, w.path + ': the state file is as it was')
  assert.equal(JSON.stringify([...creds.store]), before.keys, w.path + ': the key store is as it was')
  ok(w.path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · the SDK, the state and the key untouched')
}

// The real pair does the work, route by route (the person's own page).
const real = (path, body) => hit(path, 'POST', browserHeaders(), body)
assert.equal((await real('/kybernos-computers/sandboxes/exec', { sandboxId: id, command: 'id' })).json.ok, true)
assert.equal((await real('/kybernos-computers/sandboxes/write', { sandboxId: id, path: '/tmp/x', content: 'x' })).json.ok, true)
assert.equal((await real('/kybernos-computers/sandboxes/pause', { sandboxId: id })).json.ok, true)
assert.equal((await real('/kybernos-computers/sandboxes/resume', { sandboxId: id })).json.ok, true)
assert.equal((await real('/kybernos-computers/env/set', { env: 'e2b' })).json.env, 'e2b')
assert.equal((await real('/kybernos-computers/sandboxes/stop', { sandboxId: id, confirm: true })).json.ok, true)
assert.equal((await real('/kybernos-computers/key/set', { key: 'e2b_' + 'c'.repeat(40) })).json.ok, true)
assert.equal((await real('/kybernos-computers/key/clear', {})).json.ok, true)
assert.ok(sdkCalls > 0, 'the real pair reaches the SDK')
ok('the right Origin and the real cookie: exec, write, pause, resume, env, stop, key set and clear all answer ok')

// The reads keep their rule.
assert.equal((await hit('/kybernos-computers/status', 'GET', {})).status, 200)
assert.equal((await hit('/kybernos-computers/status', 'GET', { origin: 'http://evil.example' })).status, 403)
ok('the reads keep their rule: answered with no header, refused from a foreign Origin')

rmSync(dir, { recursive: true, force: true })
console.log('\n' + passed + ' verifications OK')
process.exit(0)
