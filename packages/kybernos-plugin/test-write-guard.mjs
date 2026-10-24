// ── The socle's write routes need DSH's signed session, not only a strict Origin ──────────────────────────────────────
//
// L6-02 (audit 2026-10-20): the bundle IMPORTED `writeGuard` but applied it to the three feedback routes only. Every other socle
// write — /kybernos/save (rewrites kyber.yml), /create, /workspace-ui-save, /workspace-delete (deletes a workspace and purges its
// UI store), /pins, /share, /active-set, /avatar-save — settled for `sameOriginStrict`, which any local program passes by sending an
// Origin header. The rule of the repo (docs/dev/route-origin-rule.md) wants the pair on a write a page drives: same origin AND the
// signed browser-session cookie. Their caller is the person's page (client.js `fetch`/`host.call`, same origin, so the browser sends
// the cookie itself); the GET routes keep `sameOriginStrict` alone.
//
// 2026-10-24 (interfaces audit): seven Agent Team writes were still on `sameOriginStrict` alone — /kybernos/yml-appliquer (rewrites the
// file the Lead obeys), /ui-save, /menu-save, /insight-save, /team-portraits and /member-portrait (spend image credits) and
// /voice-sample (stores a voice sample); then /art-action (delete, rename and duplicate of a Creations file). They carry the pair too; the GET of /voice-sample (the list) stays a plain read.
//
//   node packages/kybernos-plugin/test-write-guard.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'kb-plugin-write-guard-'))
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

const server = http.createServer((req, res) => {
  const route = routeOf(new URL(req.url, 'http://x').pathname)
  if (route === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(route.handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const own = '127.0.0.1:' + port
const origin = 'http://' + own
const cookie = (opts) => sessionCookie(own, opts)

const send = (path, headers, body, method = 'POST') => new Promise((resolve) => {
  const payload = JSON.stringify(body)
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { host: own, ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => resolve({ status: res.statusCode, text }))
  })
  req.on('error', () => resolve({ status: 0, text: '' }))
  req.write(payload)
  req.end()
})

// One body per socle write, small and harmless (the temp home has no workspace, no kyber file to rewrite).
const WRITES = [
  ['/kybernos/save', { path: 'save-test/kyber.yml', text: 'name: save-test\n' }],
  ['/kybernos/create', { id: 'write-guard-test', name: 'Write guard test' }],
  ['/kybernos/workspace-ui-save', { workspaceId: 'w-write-guard', name: 'Write guard' }],
  ['/kybernos/workspace-delete', { workspaceId: 'w-write-guard' }],
  ['/kybernos/pins', { kind: 'workspace', op: 'add', id: 'w-write-guard' }],
  ['/kybernos/share', { kind: 'artifact', id: 'a-write-guard', access: 'link', role: 'view' }],
  ['/kybernos/active-set', { kyberId: 'write-guard-test' }],
  ['/kybernos/avatar-save', { rootId: 'root', kyberId: 'write-guard-test', dataUrl: 'data:image/png;base64,' }],
  // Agent Team writes (audit 2026-10-24). Every body names a root that does not exist or an id the route refuses, so the real pair reaches the handler and
  // the handler stops at once: nothing is written, no model is asked, no image credit is spent.
  ['/kybernos/yml-appliquer', { kyberId: 'x', yml: 'topology: pool\n' }],
  ['/kybernos/ui-save', { rootId: 'no-such-root', kyberId: 'write-guard-test', name: 'Write guard' }],
  ['/kybernos/menu-save', { lastTeamId: 'write-guard-test' }],
  ['/kybernos/insight-save', { rootId: 'no-such-root', kyberId: 'write-guard-test', insight: {} }],
  ['/kybernos/team-portraits', { rootId: 'no-such-root', kyberId: 'write-guard-test' }],
  ['/kybernos/member-portrait', { rootId: 'no-such-root', kyberId: 'write-guard-test', memberId: 'lead' }],
  ['/kybernos/voice-sample', { rootId: 'no-such-root', kyberId: 'write-guard-test', name: 'My voice', consent: true, sample: 'data:audio/webm;base64,AAAA' }],
  // Creations file actions (delete = rm -f, rename = mv, duplicate = cp): the path is outside every known workspace, so the real pair reaches the handler and it refuses at once.
  ['/kybernos/art-action', { action: 'delete', path: '/no/such/workspace/file.md' }],
]

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  console.log('Kybernos plugin: the socle writes need the signed session')
  const forged = cookie({ secret: OTHER_SECRET })
  for (const [path, body] of WRITES) {
    for (const [headers, want, label] of [
      [{}, 403, 'no Origin and no cookie'],
      [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
      [{ origin }, 401, 'the right Origin and no cookie'],
      [{ origin, cookie: forged }, 401, 'the right Origin and a forged cookie'],
    ]) {
      const r = await send(path, headers, body)
      assert.equal(r.status, want, path + ': ' + label + ' -> ' + r.status + ' ' + r.text.slice(0, 80))
    }
    // The person's own page: the right Origin AND the signed cookie. The route answers; the handler's own verdict on an
    // empty store is its business (a 200 with { ok: false } is a normal answer), never an auth refusal.
    const real = await send(path, { origin, cookie: cookie() }, body)
    assert.notEqual(real.status, 401, path + ': the real pair is not refused as unsigned')
    assert.notEqual(real.status, 403, path + ': the real pair is not refused as foreign')
    ok(path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · the real pair answers')
  }
  // /voice-sample also answers GET (the list: a plain read) and DELETE (a write: it needs the pair too).
  for (const [headers, want, label] of [
    [{}, 403, 'no Origin and no cookie'],
    [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
    [{ origin }, 401, 'the right Origin and no cookie'],
    [{ origin, cookie: forged }, 401, 'the right Origin and a forged cookie'],
  ]) {
    const r = await send('/kybernos/voice-sample?rootId=no-such-root&kyberId=write-guard-test&id=x', headers, {}, 'DELETE')
    assert.equal(r.status, want, 'DELETE /kybernos/voice-sample: ' + label + ' -> ' + r.status)
  }
  const del = await send('/kybernos/voice-sample?rootId=no-such-root&kyberId=write-guard-test&id=x', { origin, cookie: cookie() }, {}, 'DELETE')
  assert.ok(del.status !== 401 && del.status !== 403, 'DELETE with the real pair is not refused as unsigned or foreign: ' + del.status)
  const list = await send('/kybernos/voice-sample?rootId=no-such-root&kyberId=write-guard-test', {}, {}, 'GET')
  assert.ok(list.status !== 401 && list.status !== 403, 'GET (the list) stays a plain read: ' + list.status)
  ok('/kybernos/voice-sample DELETE: the same four refusals, the real pair answers; GET stays open')
  console.log('\nPLUGIN WRITE GUARD — ' + pass + ' route(s), 0 échec')
} catch (e) {
  console.error('  ✗ ' + String(e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  server.close()
  // The bundle boots timers and watchers of its own (the host keeps them alive): this test ends when its checks do.
  process.exit(process.exitCode === undefined ? 0 : process.exitCode)
}
