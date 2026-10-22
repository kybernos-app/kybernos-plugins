// ── A body past its cap answers a JSON refusal, not the engine's bare 400 ───────────────────────────────────────────────
//
// L6-06 (audit 2026-10-20): 22 routes of the socle read their JSON body outside any `try`: `readJsonBody` throws past its cap (64 KB by
// default), the handler rejects, the engine logs it and answers a 400 with NO body — so the page had no `{ ok:false, error }` to show.
// /kybernos/ui-save already did the right thing (413 + a message). The route fence every route of the bundle passes through now
// answers for the rest: 413 `request body too large` for the cap, a plain 500 `request failed` for any other throw (the reason goes to the log).
//
//   node packages/kybernos-plugin/test-body-cap.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'kb-plugin-body-cap-'))
process.env.HOME = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.USERPROFILE = home
for (const key of ['KYBERNOS_CLOUD_STATE', 'KYBERNOS_SERVERS_FILE']) delete process.env[key]
mkdirSync(process.env.DSH_HOME, { recursive: true })
sessionSource.secret = () => SESSION_SECRET

// ── Mount the bundle's routes, as scripts/test-route-hosts.mjs does ──────────────────────────────────────────────────
const routes = []
const service = { register: (r) => { routes.push(r); return () => {} }, registerRoute: (r) => { routes.push(r); return () => {} } }
const ctx = new Proxy({
  get: (name) => (name === 'webServer' ? service : (name === 'fs' ? {} : undefined)),
  inject: (_list, cb) => { try { cb(ctx) } catch (e) { /* a service that is not here */ } },
  effect: (fn) => { try { return fn() } catch (e) { return undefined } },
  on: () => {}, systemPrompt: { context: () => {} }, tools: { register: () => () => {} }, config: {},
  log: { info: () => {}, warn: () => {}, error: () => {} }, webServer: service,
}, { get: (t, k) => (k in t ? t[k] : (() => undefined)) })
const mod = await import(pathToFileURL(join(here, 'index.js')).href)
await Promise.race([Promise.resolve(mod.apply(ctx)), new Promise((r) => setTimeout(r, 5000))])
const routeOf = (path) => routes.find((r) => r.path === path && typeof r.handler === 'function')

// The test server does what the engine does with a handler that rejects: a bare 400. Whatever the client reads beyond that is the
// bundle's own answer.
const server = http.createServer((req, res) => {
  const route = routeOf(new URL(req.url, 'http://x').pathname)
  if (route === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(route.handler(req, res)).catch(() => { try { res.writeHead(400); res.end() } catch (e) { /* closed */ } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const own = '127.0.0.1:' + port
const origin = 'http://' + own

const send = (path, body, raw) => new Promise((resolve) => {
  const payload = raw === undefined ? JSON.stringify(body) : raw
  const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { host: own, origin, cookie: sessionCookie(own), 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => resolve({ status: res.statusCode, text, type: String(res.headers['content-type'] || '') }))
  })
  req.on('error', () => resolve({ status: 0, text: '', type: '' }))
  req.write(payload)
  req.end()
})

// Every socle write that reads its body outside a `try` (the audit counted 22; these are the distinct paths it names and its neighbours).
const PATHS = [
  '/kybernos/save', '/kybernos/create', '/kybernos/art-previews', '/kybernos/art-reveal', '/kybernos/art-action', '/kybernos/art-progress',
  '/kybernos/art-load', '/kybernos/workspace-ui-save', '/kybernos/workspace-delete', '/kybernos/workspace-skills',
  '/kybernos/workspace-instructions', '/kybernos/pins', '/kybernos/share', '/kybernos/active-set', '/kybernos/project-data',
  '/kybernos/menu-save', '/kybernos/onboarding', '/kybernos/model/auto',
]
const big = { text: 'a'.repeat(100 * 1024) } // 100 KB: past the 64 KB default

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  console.log('Kybernos plugin: a body past its cap is refused in JSON')
  for (const path of PATHS) {
    if (routeOf(path) === undefined) { assert.fail(path + ' is not mounted — the list above is stale') }
    const r = await send(path, big)
    assert.equal(r.status, 413, path + ': a 100 KB body -> ' + r.status + ' ' + r.text.slice(0, 80))
    assert.match(r.type, /application\/json/, path + ': the refusal is JSON')
    assert.deepEqual(JSON.parse(r.text), { ok: false, error: 'request body too large' }, path + ': the refusal says why')
    ok(path + ': 100 KB -> 413 { ok:false, error:"request body too large" }')
  }
  // A body under the cap still goes through (the handler's own verdict on an empty store is its business, never the fence's).
  const small = await send('/kybernos/pins', { kind: 'workspace', op: 'add', id: 'w-body-cap' })
  assert.equal(small.status, 200, 'a small body is not refused: ' + small.status + ' ' + small.text.slice(0, 80))
  ok('a small body on /kybernos/pins still answers 200')
  // Any other throw is a plain 500 that does not give the reason away (an fs error carries an absolute path), and the fence logs it since the engine no longer sees it.
  // A body of `null` makes these handlers read a field of null: the TypeError message must not reach the page.
  const warned = []
  const realWarn = console.warn
  console.warn = (...a) => { warned.push(a.join(' ')) }
  try {
    for (const path of ['/kybernos/art-load', '/kybernos/art-progress', '/kybernos/onboarding', '/kybernos/model/auto']) {
      const r = await send(path, null, 'null')
      assert.equal(r.status, 500, path + ': a handler that throws -> ' + r.status + ' ' + r.text.slice(0, 80))
      assert.deepEqual(JSON.parse(r.text), { ok: false, error: 'request failed' }, path + ': the page gets a plain refusal, not the reason')
      assert.ok(warned.some((w) => w.includes(path) && w.includes('failed')), path + ': the failure is logged with its route')
    }
  } finally { console.warn = realWarn }
  ok('a handler that throws answers 500 { ok:false, error:"request failed" } (no reason leaked) and the route logs it')
  // /ui-save kept its own, larger cap (1 MB): 100 KB is under it.
  const ui = await send('/kybernos/ui-save', big)
  assert.notEqual(ui.status, 413, '/kybernos/ui-save keeps its 1 MB cap: ' + ui.status)
  ok('/kybernos/ui-save keeps its own 1 MB cap (100 KB is not refused)')
  console.log('\nPLUGIN BODY CAP — ' + pass + ' check(s), 0 échec')
} catch (e) {
  console.error('  ✗ ' + String(e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  server.close()
  // The bundle boots timers and watchers of its own (the host keeps them alive): this test ends when its checks do.
  process.exit(process.exitCode === undefined ? 0 : process.exitCode)
}
