// L2-02: the activation marker (~/.dsh/kybernos/free-llms.json) must never be reported as saved when it is not.
//
// Before: writeState swallowed its failure and its callers threw the result away, so /free-llms/enable wrote the `opencode-free` route into
// the settings, failed to persist the marker, and answered { ok: true, state: { wired: true } }. After a restart the page said « not
// connected » and the person had to tick the prompt-retention warning again. Now a marker that cannot be written is a 500
// `state-not-saved`, the route stays written and the answer says so; a marker that can be written is replaced atomically.
//
//   node packages/kybernos-free-llms/test-state-saved.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'kb-free-llms-state-'))
// A DSH_HOME that sits under a regular FILE: mkdir fails whoever runs the test (a read-only folder would not stop root).
writeFileSync(join(sandbox, 'not-a-folder'), 'x')
const BROKEN_HOME = join(sandbox, 'not-a-folder', 'dsh')
const GOOD_HOME = join(sandbox, 'good-dsh')

globalThis.fetch = async (url) => {
  if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'mimo-v2.6-flash-free' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  return new Response('{}', { status: 404 })
}

const { apply } = await import('./index.js')

const routes = new Map()
const mutations = []
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const settings = { mutate: async (...args) => { mutations.push(args) } }
const scope = { get: (name) => (name === 'webServer' ? webServer : undefined), effect: (fn) => { fn() } }
apply({ inject: (_names, cb) => cb(scope), get: (name) => (name === 'settings' ? settings : undefined) })

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const post = async (path, body) => {
  const raw = JSON.stringify(body)
  const req = {
    method: 'POST', url: path, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, socket: { localPort: 3080 },
    on (ev, cb) { if (ev === 'data') cb(raw); if (ev === 'end') cb() },
  }
  const out = { status: 0, body: null }
  await new Promise((resolve) => {
    const res = { writeHead (s) { out.status = s }, setHeader () {}, end (b) { try { out.body = JSON.parse(b) } catch (e) { out.body = b } resolve() }, on () {}, once () {} }
    Promise.resolve(routes.get(path)(req, res)).then(() => {}, () => resolve())
  })
  return out
}

// ── the marker cannot be written ────────────────────────────────────────────
process.env.DSH_HOME = BROKEN_HOME
const failed = await post('/free-llms/enable', { acknowledged: true })
assert.equal(mutations.length, 1, 'the route was written into the settings before the marker was tried')
assert.notEqual(failed.body.ok, true, 'enable must not answer ok:true when the marker is not on disk')
assert.equal(failed.status, 500)
assert.equal(failed.body.error, 'state-not-saved')
assert.equal(failed.body.routeWritten, true, 'the answer says the route itself is in place')
ok('enable: an unwritable marker is a 500 state-not-saved, not ok:true')

const failedAuto = await post('/free-llms/auto-enable', { hasOwnModel: false, acknowledged: true })
assert.notEqual(failedAuto.body.ok, true)
assert.equal(failedAuto.body.error, 'state-not-saved')
ok('auto-enable: same')

const failedOff = await post('/free-llms/disable', {})
assert.notEqual(failedOff.body.ok, true)
assert.equal(failedOff.body.error, 'state-not-saved')
ok('disable: same')

// ── the marker can be written ───────────────────────────────────────────────
process.env.DSH_HOME = GOOD_HOME
const good = await post('/free-llms/enable', { acknowledged: true })
assert.equal(good.status, 200)
assert.equal(good.body.ok, true)
assert.equal(good.body.state.wired, true)
const marker = join(GOOD_HOME, 'kybernos', 'free-llms.json')
const saved = JSON.parse(readFileSync(marker, 'utf8'))
assert.equal(saved.wired, true)
assert.equal(saved.acknowledged, true)
ok('enable: a writable marker is saved and the answer is ok')

assert.deepEqual(readdirSync(join(GOOD_HOME, 'kybernos')), ['free-llms.json'], 'no temporary file is left behind')
ok('the write goes through a temporary file that is renamed away (nothing left behind)')

const off = await post('/free-llms/disable', {})
assert.equal(off.status, 200)
assert.equal(JSON.parse(readFileSync(marker, 'utf8')).wired, false)
assert.equal(JSON.parse(readFileSync(marker, 'utf8')).acknowledged, true, 'disable keeps the acknowledgement')
assert.equal(existsSync(marker + '.tmp-' + process.pid), false)
ok('disable: saved, the acknowledgement is kept')

// Two writes that overlap (a double click, the boot repair meeting a press) each get their own temporary name: they used to share `.tmp-<pid>`, so the second
// rename found the file gone and answered « not saved » for a marker that was.
const both = await Promise.all([post('/free-llms/disable', {}), post('/free-llms/disable', {}), post('/free-llms/disable', {})])
assert.deepEqual(both.map((r) => r.status), [200, 200, 200], 'overlapping writes all succeed: ' + JSON.stringify(both.map((r) => r.status)))
assert.deepEqual(readdirSync(join(GOOD_HOME, 'kybernos')), ['free-llms.json'], 'and no temporary file is left behind')
ok('overlapping writes do not share a temporary file: all answer ok')

console.log('\n' + pass + ' verifications OK')
process.exit(0)
