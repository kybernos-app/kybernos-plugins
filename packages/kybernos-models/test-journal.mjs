// The models journal on a fresh install (audit A3-02): ~/.dsh/kybernos-models/ does not exist yet, and the first
// provider save used to answer 500 ENOENT (with the absolute home path) because this file, unlike the others, was
// written without creating its folder.
//
//   node packages/kybernos-models/test-journal.mjs
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, browserHeaders } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET // the machine secret the write routes check the session cookie against
const home = mkdtempSync(join(tmpdir(), 'kbm-journal-'))
process.env.DSH_HOME = home
const { apply, STORE_DIR, JOURNAL_FILE } = await import('./index.js')

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const ctx = { get: (name) => (name === 'webServer' ? webServer : undefined), inject: (_list, cb) => cb(ctx), effect: (fn) => { fn() } }
apply(ctx)

const PORT = 3080
const call = async (method, body) => {
  const text = body === undefined ? '' : JSON.stringify(body)
  const req = { method, url: '/kybernos-models/journal', socket: { localPort: PORT }, headers: { ...browserHeaders(), host: '127.0.0.1:' + PORT },
    on (ev, cb) { if (ev === 'data' && text !== '') cb(text); if (ev === 'end') cb() } }
  const res = { status: 0, body: null, writeHead (s) { this.status = s }, end (s) { try { this.body = JSON.parse(s) } catch (e) { this.body = s } } }
  await routes.get('/kybernos-models/journal')(req, res)
  return res
}

let n = 0
const ok = (label) => { n += 1; console.log('  ✓ ' + label) }
try {
  assert.ok(routes.has('/kybernos-models/journal'), 'the journal route is mounted')
  assert.equal(existsSync(STORE_DIR), false, 'the scene: the store folder does not exist yet')
  const first = await call('POST', { niveau: 'settings', route: 'audit-test', op: 'set', ok: true })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal(first.body.ok, true)
  assert.equal(existsSync(JOURNAL_FILE), true)
  assert.match(readFileSync(JOURNAL_FILE, 'utf8'), /audit-test/)
  ok('the first journal line on a fresh install is written, and the store folder is created')

  const second = await call('POST', { niveau: 'settings', route: 'audit-test', op: 'unset', ok: true })
  const read = await call('GET')
  assert.equal(second.status, 200)
  assert.equal(read.body.count, 2, JSON.stringify(read.body))
  ok('the next lines are appended and read back')

  // A write that really fails answers 500 without the system message (it carries the absolute path of the home folder).
  rmSync(JOURNAL_FILE, { force: true })
  mkdirSync(JOURNAL_FILE) // a folder where the file should be: writeFileSync fails with EISDIR
  const bad = await call('POST', { niveau: 'settings', route: 'x', op: 'set', ok: true })
  assert.equal(bad.status, 500)
  assert.equal(bad.body.error, 'write-failed')
  assert.equal(JSON.stringify(bad.body).includes(home), false, 'the answer must not carry the home path')
  assert.equal(bad.body.detail, undefined)
  ok('a journal write that fails answers 500 write-failed without echoing the system message or the home path')
} finally {
  try { chmodSync(home, 0o700) } catch (e) { /* best effort */ }
  rmSync(home, { recursive: true, force: true })
}
console.log('\n' + n + ' verifications OK')
process.exit(0)
