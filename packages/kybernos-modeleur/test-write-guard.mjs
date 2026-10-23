// ── The modeleur's writes need the signed session, not only an Origin ────────────────────────────────────────────────────
//
// A-16 (audit 2026-10-20): `/kybernos-modeleur/push` (it writes the model a panel replays) and `/kybernos-modeleur/annote` (it writes the
// strokes the person drew over it) were behind `origineOK` alone, which accepts a request with no Origin at all: any local program wrote
// them. Their caller is the panel in the person's page, which fetches same-origin (the browser sends its cookie); the agent's `modeliser`
// tool writes the store in-process and never goes through these routes, so no non-browser caller is left open.
//
//   node packages/kybernos-modeleur/test-write-guard.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { creerMagasin, monterRoutes } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

const routes = new Map()
monterRoutes({ register: (r) => { routes.set(r.path, r.handler); return () => {} } }, creerMagasin())
const server = createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const base = 'http://127.0.0.1:' + port
const origin = base
const cookie = (opts) => sessionCookie('127.0.0.1:' + port, opts)

const send = (path, headers, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, text: await r.text().catch(() => '') }))

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  console.log('Kybernos modeleur: the writes need the signed session')
  const CASES = [
    ['/kybernos-modeleur/push', { sessionId: 's', ops: [{ op: 'box', x: 0, y: 0, z: 0, w: 1, d: 1, h: 1 }] }],
    ['/kybernos-modeleur/annote', { sessionId: 's', strokes: [{ coul: '#2A6FD6', pts: [[0.1, 0.2], [0.4, 0.5]] }] }],
  ]
  for (const [path, body] of CASES) {
    const before = await fetch(base + '/kybernos-modeleur/state?session=s').then((r) => r.json())
    for (const [headers, want, label] of [
      [{}, 403, 'no Origin and no cookie'],
      [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
      [{ origin }, 401, 'the right Origin and no cookie'],
      [{ origin, cookie: cookie({ secret: OTHER_SECRET }) }, 401, 'the right Origin and a forged cookie'],
    ]) {
      const r = await send(path, headers, body)
      assert.equal(r.status, want, path + ': ' + label + ' -> ' + r.status + ' ' + r.text.slice(0, 90))
    }
    const after = await fetch(base + '/kybernos-modeleur/state?session=s').then((r) => r.json())
    assert.equal(after.version, before.version === undefined ? undefined : before.version, path + ': a refused request wrote nothing')
    const real = await send(path, { origin, cookie: cookie() }, body)
    assert.notEqual(real.status, 401, path + ': the real pair is not refused as unsigned')
    assert.notEqual(real.status, 403, path + ': the real pair is not refused as foreign')
    ok(path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · nothing written · the real pair answers')
  }
  const state = await fetch(base + '/kybernos-modeleur/state').then((r) => r.json())
  assert.equal(state.ok !== false, true, 'the read still answers with no header (a GET carries no Origin)')
  ok('the read (/state) keeps answering with no header')
  console.log('\nMODELEUR WRITE GUARD — ' + pass + ' vérification(s), 0 échec')
} catch (e) {
  console.error('  ✗ ' + String(e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  server.close()
}
