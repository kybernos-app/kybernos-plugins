// The routes of this bundle that WRITE (the lessons, the tidy-up, the switches) need DSH's signed session as well as the right Origin.
// DSH serves plugin routes before its own login and an Origin header is forgeable by any local program: before this rule
// `curl -X POST http://127.0.0.1:<port>/kybernos-memory/lessons/delete -d '{"id":"..."}'` deleted a lesson, with no header at all.
//
// For each write, in this order: no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no cookie
// (what a local program sends) · the right Origin and a forged cookie · the right Origin and the real cookie (the Memory page).
// The reads (GET) are left as they were.
//
//   node packages/kybernos-memory/test-write-guard.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

const root = mkdtempSync(join(tmpdir(), 'kybernos-memory-guard-'))
const kybers = join(root, 'kybers')
mkdirSync(join(kybers, 'default', 'memory'), { recursive: true })
process.env.KYBERNOS_MEMORY_KYBERS = kybers
process.env.KYBERNOS_MEMORY_SETTINGS = join(root, 'kybernos-memory.json')
sessionSource.secret = () => SESSION_SECRET

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const lessonsFile = join(kybers, 'default', 'memory', 'lessons.jsonl')
const seed = () => writeFileSync(lessonsFile, JSON.stringify({ id: 'les-1', ts: new Date().toISOString(), text: 'keep me', tags: [], uses: 0, lastUsed: null }) + '\n')
/** What a refused write must leave exactly as it was: every file of the test folder, with its content. */
const snapshot = (dir = root) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? snapshot(join(dir, e.name)) : [e.name + '=' + readFileSync(join(dir, e.name), 'utf8')])).sort().join('\n')

const mod = await import('./index.js')
const registered = new Map()
mod.apply({
  get: (n) => (n === 'webServer' ? { register: ({ path, handler }) => { registered.set(path, handler); return () => {} } } : undefined),
  inject: (_l, cb) => cb({ systemPrompt: { context: () => {} }, tools: { register: () => {} } }),
  effect: (fn) => { void fn() },
})
const hit = async (path, method, headers, body) => {
  const r = { status: 0, writeHead(s) { this.status = s }, end() {} }
  const req = { method, url: path, headers: { host: '127.0.0.1:3080', ...headers }, socket: { localPort: 3080 }, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) } }
  await registered.get(path.split('?')[0])(req, r)
  return r.status
}

const WRITES = mod.ROUTES.filter((r) => r.method === 'POST')
assert.equal(WRITES.length, 9, 'the nine writes of this bundle are all under the rule')
assert.ok(WRITES.every((r) => r.session === true), 'every POST route is marked session: true')
assert.ok(mod.ROUTES.filter((r) => r.method === 'GET').every((r) => r.session !== true), 'the reads are not')
ok('ROUTES: the nine POST routes need the session, the GET routes do not')

const bodies = { '/kybernos-memory/lessons/add': { text: 'a new lesson', kyber: 'default' }, '/kybernos-memory/lessons/update': { id: 'les-1', text: 'changed' }, '/kybernos-memory/lessons/delete': { id: 'les-1' }, '/kybernos-memory/tidy/apply': { confirm: true, groups: [] } }
for (const w of WRITES) {
  const body = bodies[w.path] ?? {}
  seed()
  const before = snapshot()
  const send = (headers) => hit(w.path, 'POST', headers, body)
  assert.equal(await send({}), 403, w.path + ': no Origin and no cookie')
  assert.equal(await send({ ...browserHeaders(), origin: 'http://evil.example' }), 403, w.path + ': a foreign Origin, even with the real cookie')
  assert.equal(await send({ origin: 'http://127.0.0.1:3080' }), 401, w.path + ': the right Origin and no cookie')
  assert.equal(await send({ origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }), 401, w.path + ': the right Origin and a forged cookie')
  assert.equal(snapshot(), before, w.path + ': nothing was written by the refused requests')
  assert.equal(await send(browserHeaders()), 200, w.path + ': the right Origin and the real cookie')
  ok(w.path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · nothing written · the real pair 200')
}

seed()
assert.equal(await hit('/kybernos-memory/lessons', 'GET', {}), 200, 'a read needs no header')
assert.equal(await hit('/kybernos-memory/lessons', 'GET', { origin: 'http://evil.example' }), 403, 'a read from a foreign Origin is still refused')
ok('the reads keep their rule: answered with no header, refused from a foreign Origin')

rmSync(root, { recursive: true, force: true })
console.log('\n' + pass + ' verifications OK')
process.exit(0)
