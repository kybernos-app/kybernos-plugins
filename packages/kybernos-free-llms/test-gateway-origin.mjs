// The free-models gateway is called by DSH's ENGINE (no Origin, no cookie, no browser headers), so its four open routes cannot ask for a session like a
// page's routes do. What they must refuse is a BROWSER page of another site (A6-04): before this, a page the person merely visited could POST text/plain to
// /free-llms/v1/chat/completions (no preflight) and have the person's machine call opencode.ai, or load /free-llms/health (a real chat probe upstream) with a
// no-cors GET, burning the free-tier quota and the IP's reputation.
//
// A fake fetch stands for opencode.ai and counts what reaches it: a refused request must never call it.
//   no Origin and no Sec-Fetch-* (the engine) -> answered · a foreign Origin -> 403 · Sec-Fetch-Site cross-site or same-site -> 403 ·
//   the right Origin / Sec-Fetch-Site same-origin (the page) -> answered · none (an address typed in a tab) -> answered.
//
//   node packages/kybernos-free-llms/test-gateway-origin.mjs
import assert from 'node:assert/strict'
import { apply } from './index.js'

const upstream = []
globalThis.fetch = async (url) => {
  upstream.push(String(url))
  const sse = 'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
  if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'mimo-v2.6-flash-free' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const scope = { get: (name) => (name === 'webServer' ? webServer : undefined), effect: (fn) => { fn() } }
apply({ inject: (_names, cb) => cb(scope), get: () => undefined })

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const hit = async (method, path, headers, body) => {
  const raw = body === undefined ? '' : JSON.stringify(body)
  const req = { method, url: path, headers: { host: '127.0.0.1:3080', ...headers }, socket: { localPort: 3080 }, on (ev, cb) { if (ev === 'data' && raw !== '') cb(raw); if (ev === 'end') cb() } }
  const out = { status: 0 }
  await new Promise((resolve) => {
    const res = { writeHead (s) { out.status = s }, setHeader () {}, write () { return true }, end () { resolve() }, on () {}, once () {}, flushHeaders () {} }
    Promise.resolve(routes.get(path.split('?')[0])(req, res)).then(() => resolve(), () => resolve())
  })
  return out.status
}

const ROUTES = [
  ['POST', '/free-llms/v1/chat/completions', { model: 'mimo-v2.6-flash-free', messages: [{ role: 'user', content: 'hi' }] }],
  ['GET', '/free-llms/v1/models', undefined],
  ['GET', '/free-llms/status', undefined],
  ['GET', '/free-llms/health?model=mimo-v2.6-flash-free', undefined],
]
const refusals = [
  ['a foreign Origin (a page posting text/plain)', { origin: 'http://evil.example', 'content-type': 'text/plain' }],
  ['a foreign Origin on a neighbouring port', { origin: 'http://127.0.0.1:3081' }],
  ['Sec-Fetch-Site: cross-site (a no-cors request of another site)', { 'sec-fetch-site': 'cross-site' }],
  ['Sec-Fetch-Site: same-site (another port of localhost)', { 'sec-fetch-site': 'same-site' }],
  ['a lookalike Origin', { origin: 'http://127.0.0.1.evil.example:3080' }],
]
const allowed = [
  ['no header at all (DSH\'s engine)', {}],
  ['the right Origin', { origin: 'http://127.0.0.1:3080' }],
  ['Sec-Fetch-Site: same-origin (the page)', { 'sec-fetch-site': 'same-origin' }],
  ['Sec-Fetch-Site: none (an address typed in a tab)', { 'sec-fetch-site': 'none' }],
]

for (const [method, path, body] of ROUTES) {
  assert.equal(typeof routes.get(path.split('?')[0]), 'function', path + ' is mounted')
  const before = upstream.length
  for (const [label, headers] of refusals) assert.equal(await hit(method, path, headers, body), 403, path + ': ' + label)
  assert.equal(upstream.length, before, path + ': a refused request never reached opencode.ai')
  for (const [label, headers] of allowed) {
    const status = await hit(method, path, headers, body)
    assert.ok(status !== 403 && status !== 401 && status !== 0, path + ': ' + label + ' -> ' + status)
  }
  assert.ok(upstream.length > before, path + ': the allowed callers do reach it')
  ok(method + ' ' + path + ': ' + refusals.length + ' browser shapes refused with nothing sent upstream, ' + allowed.length + ' allowed (the engine, the page, a typed address)')
}

// The routes of the Settings page keep their own, stricter rule.
assert.equal(await hit('POST', '/free-llms/enable', {}, { acknowledged: true }), 403, 'enable needs an Origin')
assert.equal(await hit('POST', '/free-llms/disable', {}, {}), 403, 'disable needs an Origin')
ok('enable and disable still refuse a request with no Origin')

console.log('\n' + pass + ' verifications OK')
process.exit(0)
