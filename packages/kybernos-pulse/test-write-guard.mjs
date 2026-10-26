// The routes of this bundle that WRITE (the settings, the inbox) need DSH's signed session as well as the right Origin.
// DSH serves plugin routes before its own login and an Origin header is forgeable by any local program: without this rule
// `curl -X POST http://127.0.0.1:<port>/kybernos-pulse/settings -d '{"level":"never"}'` would silence every banner, with no header at all.
//
// For each write, in this order: no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no cookie
// (what a local program sends) · the right Origin and a forged cookie · the right Origin and the real cookie (the Settings page).
// The read (GET state) keeps its own rule.
//
//   node packages/kybernos-pulse/test-write-guard.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

const root = mkdtempSync(join(tmpdir(), 'kybernos-pulse-guard-'))
process.env.DSH_HOME = root
sessionSource.secret = () => SESSION_SECRET

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
/** What a refused write must leave exactly as it was: every file of the test folder, with its content. */
const snapshot = (dir = root) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? snapshot(join(dir, e.name)) : [e.name + '=' + readFileSync(join(dir, e.name), 'utf8')])).sort().join('\n')

const mod = await import('./index.js')
const registered = new Map()
mod.apply({
  get: (n) => (n === 'webServer' ? { register: ({ path, handler }) => { registered.set(path, handler); return () => {} } } : undefined),
  inject: () => {},
  effect: (fn) => { void fn() }
})
const hit = async (path, method, headers, body) => {
  const r = { status: 0, writeHead (s) { this.status = s }, end () {} }
  const req = { method, url: path, headers: { host: '127.0.0.1:3080', 'content-type': 'application/json', ...headers }, socket: { localPort: 3080 }, async * [Symbol.asyncIterator] () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) } }
  await registered.get(path.split('?')[0])(req, r)
  return r.status
}

const WRITES = { '/kybernos-pulse/settings': { level: 'every' }, '/kybernos-pulse/inbox': { action: 'read-all' } }
assert.deepEqual([...registered.keys()].filter((p) => p !== '/kybernos-pulse/state').sort(), Object.keys(WRITES).sort(), 'every route but the read is a write covered here')
ok('the routes: one read and two writes, all covered by this test')

for (const [path, body] of Object.entries(WRITES)) {
  // a first good write creates the file, so the refused ones below have something to leave untouched
  assert.equal(await hit('/kybernos-pulse/settings', 'POST', browserHeaders(), { badge: true }), 200)
  const before = snapshot()
  const send = (headers) => hit(path, 'POST', headers, body)
  assert.equal(await send({}), 403, path + ': no Origin and no cookie')
  assert.equal(await send({ ...browserHeaders(), origin: 'http://evil.example' }), 403, path + ': a foreign Origin, even with the real cookie')
  assert.equal(await send({ origin: 'http://127.0.0.1:3080' }), 401, path + ': the right Origin and no cookie')
  assert.equal(await send({ origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }), 401, path + ': the right Origin and a forged cookie')
  assert.equal(snapshot(), before, path + ': nothing was written by the refused requests')
  assert.equal(await send(browserHeaders()), 200, path + ': the right Origin and the real cookie')
  ok(path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · nothing written · the real pair 200')
}

assert.equal(await hit('/kybernos-pulse/state', 'GET', {}), 200, 'a read needs no header')
assert.equal(await hit('/kybernos-pulse/state', 'GET', { origin: 'http://evil.example' }), 403, 'a read from a foreign Origin is still refused')
ok('the read keeps its rule: answered with no header, refused from a foreign Origin')

rmSync(root, { recursive: true, force: true })
console.log('\n' + pass + ' verifications OK')
process.exit(0)
