// The four POST routes of the web search Settings page need DSH's signed session as well as the right Origin (recette 2026-10-25, L3-20):
//   /key       stores or clears a search key in DSH's credentials store;
//   /settings  names the search address (a SearXNG, a custom engine) every search of the agent will be sent to, with the key as a bearer token for the custom one;
//   /test      makes this computer call the engine it names, and answers the start of what came back (an internal service's page, for one that is not a 2xx);
//   /seam      runs one search through DSH's web seam.
// DSH serves plugin routes before its own login and an Origin header is forgeable by any local program: before this, `curl -X POST -H 'Origin: http://127.0.0.1:<port>' .../kybernos-websearch/key
// -d '{"clear":true,"ref":"BRAVE_API_KEY"}'` cleared the person's key and `/settings` sent every search to the caller's address.
//
// The table is enumerated from what the real mount function registers: a POST route that is neither in GUARDED nor in EXCEPTIONS (with its reason) fails the test. Per guarded route: no header ·
// a foreign Origin (even with the real cookie) · the right Origin and no cookie · a forged cookie · an expired one · the real pair through the phone link, each with an ARMED body (it really does
// the work when let through) and a check that nothing moved (no key stored or cleared, no setting written, no call out); then the real pair with the armed body, which does the work.
//
//   node packages/kybernos-websearch/test-write-guard.mjs
import { createServer } from 'node:http'
import { createWebSearch, mountRoutes } from './host.mjs'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

/** The POST routes that need the session: an armed body, and the counter of `moved` it must raise. */
const GUARDED = {
  '/kybernos-websearch/key': { armed: { ref: 'BRAVE_API_KEY', value: 'brave-key-123456789' }, moves: 'key' },
  '/kybernos-websearch/settings': { armed: { searxngUrl: 'http://127.0.0.1:9/' }, moves: 'setting' },
  '/kybernos-websearch/test': { armed: { id: 'searxng', query: 'probe' }, moves: 'call' },
  '/kybernos-websearch/seam': { armed: { query: 'probe' }, moves: 'seam' },
}
/** The POST routes that stay at the strict Origin, and why. None here. */
const EXCEPTIONS = {}
const HARMLESS = { id: 'no-such-engine' } // /key says unknown-key... (see below), /settings ignores it, /test and /seam need nothing from the network for it

const moved = { key: 0, setting: 0, call: 0, seam: 0 }
let doc = null
const io = {
  read: () => doc,
  write: (d) => { moved.setting += 1; doc = JSON.parse(JSON.stringify(d)) },
  resolveKey: async () => null,
  describeKey: async () => ({ configured: false, source: null }),
  setKey: async () => { moved.key += 1 },
  unsetKey: async () => { moved.key += 1 },
  http: async () => { moved.call += 1; return { status: 200, ok: true, text: '<html></html>' } },
  seamSearch: async () => { moved.seam += 1; return { sources: [], truncated: false } },
  seam: () => ({ registered: true, pinned: 'kybernos-search' }),
}
const routes = new Map()
mountRoutes({ register: (r) => { routes.set(r.path, r.handler); return () => {} } }, createWebSearch(io))

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
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  return { status: r.status, text: await r.text().catch(() => '') }
}
const REAL = { origin: base, cookie: cookie() }
const nothingMoved = () => Object.values(moved).every((n) => n === 0)

try {
  // ── the family: every registered POST route is classified ───────────────────────────────────────────────────
  const answeringPost = []
  for (const path of routes.keys()) if ((await send(path, 'POST', {}, {})).status !== 405) answeringPost.push(path)
  check('the web search routes are mounted (' + routes.size + ' paths, ' + answeringPost.length + ' answer a POST)', routes.size === 5 && answeringPost.length === 4)
  const unclassified = answeringPost.filter((p) => GUARDED[p] === undefined && EXCEPTIONS[p] === undefined)
  check('every route that answers a POST is in GUARDED or in EXCEPTIONS (a new write route cannot be forgotten)', unclassified.length === 0, unclassified.join(', '))
  check('...and the tables name no route that is not mounted', [...Object.keys(GUARDED), ...Object.keys(EXCEPTIONS)].every((p) => routes.has(p)))
  check('the probes so far moved nothing', nothingMoved(), JSON.stringify(moved))

  // ── what the guard decides, route by route, with the body that would do the work ─────────────────────────────
  for (const [path, { armed }] of Object.entries(GUARDED)) {
    check(path + ': no Origin and no cookie -> 403', (await send(path, 'POST', {}, armed)).status === 403)
    check(path + ': a foreign Origin -> 403, even with the real cookie', (await send(path, 'POST', { origin: 'http://evil.example', cookie: cookie() }, armed)).status === 403)
    check(path + ': the right Origin and no cookie -> 401', (await send(path, 'POST', { origin: base }, armed)).status === 401)
    check(path + ': the right Origin and a forged cookie -> 401', (await send(path, 'POST', { origin: base, cookie: cookie({ secret: OTHER_SECRET }) }, armed)).status === 401)
    check(path + ': the right Origin and an expired cookie -> 401', (await send(path, 'POST', { origin: base, cookie: cookie({ expiresAt: Date.now() - 1000 }) }, armed)).status === 401)
    const phone = await send(path, 'POST', { ...REAL, 'x-kybernos-tunnel': '1' }, armed)
    check(path + ': the real pair through the phone link -> 403 refused_on_phone', phone.status === 403 && /refused_on_phone/.test(phone.text), phone.status + ' ' + phone.text.slice(0, 80))
    check(path + ': nothing moved for any of those (no key stored or cleared, no setting written, no call out)', nothingMoved(), JSON.stringify(moved))
    const real = await send(path, 'POST', REAL, HARMLESS)
    check(path + ': the right Origin and the real cookie -> the route answers (' + real.status + ')', real.status !== 401 && real.status !== 403 && real.status !== 503 && real.text.startsWith('{'), real.status + ' ' + real.text.slice(0, 80))
    Object.keys(moved).forEach((k) => { moved[k] = 0 }) // /settings stores whatever it is given, even a body it ignores: the next route starts from nothing
  }
  check('/kybernos-websearch/state: the read of the state stays open to a page with no cookie', (await send('/kybernos-websearch/state', 'GET', { origin: base })).status === 200)

  // ── the armed bodies are armed: with the real pair each one does its work ────────────────────────────────────
  Object.keys(moved).forEach((k) => { moved[k] = 0 })
  for (const [path, { armed, moves }] of Object.entries(GUARDED)) {
    const before = moved[moves]
    const real = await send(path, 'POST', REAL, armed)
    check(path + ': the real pair with the armed body does the work (' + real.status + ', ' + moves + ' ' + before + ' -> ' + moved[moves] + ')', real.status === 200 && moved[moves] > before, real.status + ' ' + real.text.slice(0, 100))
  }
} finally {
  server.close()
}

console.log(failed === 0 ? '\nall green' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
