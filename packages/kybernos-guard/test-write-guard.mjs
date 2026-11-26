#!/usr/bin/env node
// Route guard, Host fence, signed session cookie, and body cap tests for @local/kybernos-guard.
//
//   node packages/kybernos-guard/test-write-guard.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGuardEngine, MAX_BODY_BYTES, mountRoutes } from './guard-host.mjs'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const root = mkdtempSync(join(tmpdir(), 'kb-guard-http-'))
const dir = join(root, 'guard')
const engine = createGuardEngine({ dir })
engine.record({ session: 's1', tool: 'bash', phase: 'pre', action: 'block', kind: 'destructive', ruleId: 'cmd-rm-root-home', enforced: true })

const routes = new Map()
const off = mountRoutes({ register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }, engine)

const server = createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch { /* closed */ } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base0 = 'http://127.0.0.1:' + port
const cookie = (opts) => sessionCookie('127.0.0.1:' + port, opts)
const REAL = { origin: base0, cookie: cookie() }

const send = async (path, method, headers, body) => {
  const r = await fetch(base0 + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  })
  return { status: r.status, text: await r.text().catch(() => '') }
}

try {
  check('three routes mounted', routes.size === 3 && routes.has('/kybernos-guard/status') && routes.has('/kybernos-guard/events') && routes.has('/kybernos-guard/settings'))

  // GET reads: allowed locally without cookie, refuse POST (405) and foreign Origin (403)
  const st = await send('/kybernos-guard/status', 'GET', {})
  check('GET /status returns settings and stats', st.status === 200 && JSON.parse(st.text).settings.mode === 'enforce' && JSON.parse(st.text).stats.blocked === 1)
  const ev = await send('/kybernos-guard/events?limit=10', 'GET', {})
  check('GET /events returns sanitised audit events', ev.status === 200 && JSON.parse(ev.text).events.length === 1)
  check('POST /status and POST /events return 405', (await send('/kybernos-guard/status', 'POST', REAL, {})).status === 405 && (await send('/kybernos-guard/events', 'POST', REAL, {})).status === 405)
  check('GET /status refuses foreign Origin (403)', (await send('/kybernos-guard/status', 'GET', { origin: 'https://evil.example' })).status === 403)

  // POST /settings: full write guard matrix
  check('POST /settings without Origin or cookie -> 403', (await send('/kybernos-guard/settings', 'POST', {}, { mode: 'audit' })).status === 403)
  check('POST /settings with foreign Origin + real cookie -> 403', (await send('/kybernos-guard/settings', 'POST', { origin: 'https://evil.example', cookie: cookie() }, { mode: 'audit' })).status === 403)
  check('POST /settings with right Origin and no cookie -> 401', (await send('/kybernos-guard/settings', 'POST', { origin: base0 }, { mode: 'audit' })).status === 401)
  check('POST /settings with forged cookie -> 401', (await send('/kybernos-guard/settings', 'POST', { origin: base0, cookie: cookie({ secret: OTHER_SECRET }) }, { mode: 'audit' })).status === 401)
  check('POST /settings with expired cookie -> 401', (await send('/kybernos-guard/settings', 'POST', { origin: base0, cookie: cookie({ expiresAt: Date.now() - 1000 }) }, { mode: 'audit' })).status === 401)
  const phone = await send('/kybernos-guard/settings', 'POST', { ...REAL, 'x-kybernos-tunnel': '1' }, { mode: 'audit' })
  check('POST /settings via phone link -> 403 refused_on_phone', phone.status === 403 && phone.text.includes('refused_on_phone'))
  check('none of the refused requests modified settings', engine.getSettings().mode === 'enforce')

  // Oversized body -> 413
  const big = await send('/kybernos-guard/settings', 'POST', REAL, JSON.stringify({ allowRules: ['x'.repeat(MAX_BODY_BYTES + 1024)] }))
  check('POST /settings oversized body -> 413', big.status === 413)

  // Valid pair updates settings atomically on disk
  const okPost = await send('/kybernos-guard/settings', 'POST', REAL, { mode: 'audit', allowRules: ['cmd-rm-rf'] })
  check('POST /settings with valid Origin + cookie updates settings on disk',
    okPost.status === 200 && engine.getSettings().mode === 'audit' &&
    JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).mode === 'audit')

  // Invalid mode -> 400
  check('POST /settings with invalid mode -> 400', (await send('/kybernos-guard/settings', 'POST', REAL, { mode: 'invalid' })).status === 400)

  // Disposer removes all 3 routes
  off()
  check('disposer removes all mounted routes', routes.size === 0)
} finally {
  server.close()
  try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
assert.equal(fail, 0, fail + ' check(s) failed')
process.exit(0)
