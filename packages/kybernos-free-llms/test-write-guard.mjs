// The three POST routes of the free models panel and the first-run wizard (enable, disable, auto-enable) change where the person's model traffic goes: they write the `opencode-free`
// provider into DSH's settings, store its marker key, and what the person then types leaves for opencode.ai. They need DSH's signed session as well as the right Origin (recette
// 2026-10-25, L3-21): DSH serves plugin routes before its own login, an Origin header is forgeable by any local program, and the body's `acknowledged` flag attests nothing. Before this,
// `curl -X POST -H 'Origin: http://127.0.0.1:<port>' .../free-llms/enable -d '{"acknowledged":true,"auto":true}'` plugged the route in without the person having read the notice about
// prompt retention.
//
// The gateway itself (/v1/chat/completions, /v1/models, /status, /health) is called by DSH's ENGINE, which has no Origin and no cookie: it keeps the « not from another page » rule, tested
// in test-gateway-origin.mjs. The three tables below must cover every mounted path: a new route that is in none of them fails the test.
//
// Per guarded route: no header · a foreign Origin (even with the real cookie) · the right Origin and no cookie · a forged cookie · an expired one · the real pair through the phone link, each
// with an ARMED body (it really does the work when let through) and a check that nothing moved (no settings write, no key stored, no marker file, no call to opencode.ai); then the real pair
// with the armed body, which does the work.
//
//   node packages/kybernos-free-llms/test-write-guard.mjs
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'kb-freellms-guard-'))
process.env.DSH_HOME = home
const marker = join(home, 'kybernos', 'free-llms.json')

// opencode.ai is a counter: nothing leaves this test. The test talks to its own server with the real fetch, kept here before the swap.
const realFetch = globalThis.fetch
const upstream = []
globalThis.fetch = async (url) => {
  upstream.push(String(url))
  return new Response(JSON.stringify({ data: [{ id: 'mimo-v2.6-flash-free' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const { apply } = await import('./index.js')
const { sessionSource } = await import('./session-guard.mjs')
const { OTHER_SECRET, SESSION_SECRET, sessionCookie } = await import('./lib-session-test.mjs')
sessionSource.secret = () => SESSION_SECRET

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

/** The POST routes that need the session, each with an ARMED body. */
const GUARDED = {
  '/free-llms/enable': { acknowledged: true, auto: true },
  '/free-llms/disable': {},
  '/free-llms/auto-enable': { acknowledged: true, hasOwnModel: false },
}
/** The POST routes that stay at the strict Origin or below, and why. */
const EXCEPTIONS = {
  '/free-llms/v1/chat/completions': 'DSH\'s engine posts here with no Origin, no cookie and no browser header, so it cannot ask for a session; it refuses what a browser marks as another site (test-gateway-origin.mjs)',
}
/** The routes that read, and answer every method alike for the engine and the panel (no write behind them). */
const READS = ['/free-llms/v1/models', '/free-llms/status', '/free-llms/health']

const moved = { mutate: 0, key: 0 }
const settings = { mutate: async () => { moved.mutate += 1 } }
const credentials = { describe: async () => ({ configured: false, writable: true }), set: async () => { moved.key += 1 } }
const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const scope = { get: (name) => (name === 'webServer' ? webServer : undefined), effect: (fn) => { fn() } }
const log = console.log
console.log = () => {}
try { apply({ inject: (_names, cb) => cb(scope), get: (name) => (name === 'settings' ? settings : name === 'credentials' ? credentials : undefined) }) } finally { console.log = log }

const server = createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = 'http://127.0.0.1:' + port
const cookie = (opts) => sessionCookie('127.0.0.1:' + port, opts)
const send = async (path, method, headers, body) => {
  const r = await realFetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }).catch(() => null)
  return r === null ? { status: 0, text: '' } : { status: r.status, text: await r.text().catch(() => '') }
}
const REAL = { origin: base, cookie: cookie() }
const nothingMoved = () => moved.mutate === 0 && moved.key === 0 && existsSync(marker) === false && upstream.length === 0

try {
  // ── the family: every mounted path is classified ────────────────────────────────────────────────────────────
  const mounted = [...routes.keys()]
  const known = [...Object.keys(GUARDED), ...Object.keys(EXCEPTIONS), ...READS]
  check('the free models routes are mounted (' + mounted.length + ' paths)', mounted.length === 7)
  check('every mounted path is in GUARDED, EXCEPTIONS or READS (a new route cannot be forgotten)', mounted.every((p) => known.includes(p)), mounted.filter((p) => !known.includes(p)).join(', '))
  check('...and the tables name no route that is not mounted', known.every((p) => mounted.includes(p)))
  check('every exception says why', Object.values(EXCEPTIONS).every((why) => why.length > 20))

  // ── what the guard decides, route by route, with the body that would do the work ─────────────────────────────
  for (const [path, armed] of Object.entries(GUARDED)) {
    check(path + ': no Origin and no cookie -> 403', (await send(path, 'POST', {}, armed)).status === 403)
    check(path + ': a foreign Origin -> 403, even with the real cookie', (await send(path, 'POST', { origin: 'http://evil.example', cookie: cookie() }, armed)).status === 403)
    check(path + ': the right Origin and no cookie -> 401 (what a local program sends)', (await send(path, 'POST', { origin: base }, armed)).status === 401)
    check(path + ': the right Origin and a forged cookie -> 401', (await send(path, 'POST', { origin: base, cookie: cookie({ secret: OTHER_SECRET }) }, armed)).status === 401)
    check(path + ': the right Origin and an expired cookie -> 401', (await send(path, 'POST', { origin: base, cookie: cookie({ expiresAt: Date.now() - 1000 }) }, armed)).status === 401)
    const phone = await send(path, 'POST', { ...REAL, 'x-kybernos-tunnel': '1' }, armed)
    check(path + ': the real pair through the phone link -> 403 refused_on_phone', phone.status === 403 && /refused_on_phone/.test(phone.text), phone.status + ' ' + phone.text.slice(0, 80))
    check(path + ': GET is "method not allowed" (405), whatever the headers', (await send(path, 'GET', REAL)).status === 405)
  }
  check('nothing moved for any of those: no settings write, no key stored, no marker file, no call to opencode.ai', nothingMoved(), JSON.stringify({ ...moved, marker: existsSync(marker), upstream: upstream.length }))

  // ── the engine's gateway is untouched ───────────────────────────────────────────────────────────────────────
  const engine = await send('/free-llms/v1/chat/completions', 'POST', {}, { model: 'mimo-v2.6-flash-free', messages: [{ role: 'user', content: 'hi' }] })
  check('/free-llms/v1/chat/completions: the engine (no Origin, no cookie) is still answered (' + engine.status + ')', engine.status !== 401 && engine.status !== 403 && engine.status !== 0)

  // ── the armed bodies are armed: with the real pair each one does its work ────────────────────────────────────
  for (const [path, armed] of Object.entries(GUARDED)) {
    rmSync(marker, { force: true }) // each starts from a machine that has not been wired
    const before = moved.mutate
    const real = await send(path, 'POST', REAL, armed)
    check(path + ': the real pair with the armed body does the work (' + real.status + ', settings writes ' + before + ' -> ' + moved.mutate + ')', real.status === 200 && /"ok":true/.test(real.text) && moved.mutate > before, real.status + ' ' + real.text.slice(0, 100))
  }
} finally {
  server.close()
}

console.log(failed === 0 ? '\nall green' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
