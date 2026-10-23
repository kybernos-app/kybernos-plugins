// ── The motion's writes need the signed session, not only an Origin ──────────────────────────────────────────────────────
//
// A-16 (audit 2026-10-20): `/kybernos-motion/frame` (the panel POSTs the rendered PNG back for the waiting agent) and
// `/kybernos-motion/export` (it writes a video file next to the scene) were behind `sameOrigin` alone, which accepts a request with
// no Origin at all: any local program answered a frame the agent was waiting for, or wrote a video. Their caller is the Motion panel
// in the person's page — a same-origin fetch, so the browser sends its cookie. The agent's `creer_motion` tool asks the panel through
// the store (`pendingFrame`), it never POSTs to these routes.
//
//   node packages/kybernos-motion/test-write-guard.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mountRoutes } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

// Only what the two handlers reach once the guard has let the request through: a frame is "delivered", an export path is refused by
// the scene confinement (the real rules are proven by test-motion-host.mjs and test-host.mjs).
const host = {
  deliverFrame: async () => ({ ok: true, path: '/tmp/frame.png' }),
  panelScene: async () => null,
  pendingFrame: () => null,
  confineExisting: async () => ({ ok: false, error: 'scene-refused' }),
}
const routes = new Map()
mountRoutes({ register: (r) => { routes.set(r.path, r.handler); return () => {} } }, host)
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

const send = (path, headers, body, type) => fetch(base + path, { method: 'POST', headers: { 'content-type': type, ...headers }, body }).then(async (r) => ({ status: r.status, text: await r.text().catch(() => '') }))

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  console.log('Kybernos motion: frame and export need the signed session')
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9])
  const CASES = [
    ['/kybernos-motion/frame?session=s&id=f1', PNG, 'application/octet-stream'],
    ['/kybernos-motion/export?session=s&format=exe&path=x', PNG, 'video/mp4'],
  ]
  for (const [path, body, type] of CASES) {
    for (const [headers, want, label] of [
      [{}, 403, 'no Origin and no cookie'],
      [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
      [{ origin }, 401, 'the right Origin and no cookie'],
      [{ origin, cookie: cookie({ secret: OTHER_SECRET }) }, 401, 'the right Origin and a forged cookie'],
    ]) {
      const r = await send(path, headers, body, type)
      assert.equal(r.status, want, path + ': ' + label + ' -> ' + r.status + ' ' + r.text.slice(0, 90))
    }
    // The real pair goes past the guard: a frame is delivered (200), an unknown export format is 400, never an auth refusal.
    const real = await send(path, { origin, cookie: cookie() }, body, type)
    assert.notEqual(real.status, 401, path + ': the real pair is not refused as unsigned')
    assert.notEqual(real.status, 403, path + ': the real pair is not refused as foreign')
    ok(path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · the real pair answers (' + real.status + ')')
  }
  const state = await fetch(base + '/kybernos-motion/state').then((r) => r.status)
  assert.equal(state, 200, 'the read still answers with no header (a GET carries no Origin): ' + state)
  ok('the read (/state) keeps answering with no header')
  console.log('\nMOTION WRITE GUARD — ' + pass + ' vérification(s), 0 échec')
} catch (e) {
  console.error('  ✗ ' + String(e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  server.close()
}
