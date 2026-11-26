// The five POST routes of the Servers page decide where the person's account token and model traffic go, so they need DSH's signed session as well as the right Origin
// (recette 2026-10-25, L3-16). A server is an address: `add` reads that address's profile and, with `activate`, writes it into servers.json and applies it, so the messages of the
// person's chats are sent to the llm address the stranger's profile names; `check` makes this computer call any address it is given. DSH serves plugin routes before its own login
// and an Origin header is forgeable by any local program: before this, `curl -X POST -H 'Origin: http://127.0.0.1:<port>' .../kybernos-servers/add -d '{"address":"…","activate":true}'`
// reached the discovery and the registry.
//
// The table is enumerated from the real ROUTES: a POST row that is neither in GUARDED nor in EXCEPTIONS fails the test. Per guarded route: no header · a foreign Origin (even
// with the real cookie) · the right Origin and no cookie · a forged cookie · an expired one · the real pair through the phone link, each with an ARMED body (it really does the work
// when let through) and a check that nothing moved (no call to the address, servers.json untouched, nothing applied); then the real pair with a harmless body and with the armed body
// (the work does happen: so « nothing moved » above is not a pass about nothing).
//
//   node packages/kybernos-servers/test-write-guard.mjs
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROUTES, mount } from './host.mjs'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const home = mkdtempSync(join(tmpdir(), 'kb-servers-guard-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'kybernos'), { recursive: true })
const registryFile = join(home, 'kybernos', 'servers.json')
delete process.env.KYBERNOS_SERVERS_FILE
const seed = { active: 'kybernos-cloud', servers: [{ id: 'spare', name: 'Spare', api: 'http://127.0.0.1:1' }, { id: 'other', name: 'Other', api: 'http://127.0.0.1:2' }] }
writeFileSync(registryFile, JSON.stringify(seed, null, 2) + '\n')
const readRegistry = () => readFileSync(registryFile, 'utf8')

// The address a stranger would have the computer call: it publishes a profile and counts the visits.
const moved = { probe: 0, registry: 0, apply: 0 }
let lastRegistry = readRegistry()
const touch = () => { const now = readRegistry(); if (now !== lastRegistry) { moved.registry += 1; lastRegistry = now } }
const stranger = createServer((req, res) => {
  moved.probe += 1
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ schema: 1, name: 'Stranger', api: 'http://127.0.0.1:' + stranger.address().port }))
})
await new Promise((resolve) => stranger.listen(0, '127.0.0.1', resolve))
const STRANGER = 'http://127.0.0.1:' + stranger.address().port

/** The POST rows that need the session, each with an ARMED body and the counter of `moved` it must raise. */
const GUARDED = {
  '/kybernos-servers/check': { armed: { address: STRANGER }, moves: 'probe' },
  '/kybernos-servers/add': { armed: { address: STRANGER, activate: true }, moves: 'probe' },
  '/kybernos-servers/switch': { armed: { id: 'spare' }, moves: 'apply' },
  '/kybernos-servers/rename': { armed: { id: 'other', name: 'Renamed' }, moves: 'registry' },
  '/kybernos-servers/remove': { armed: { id: 'other' }, moves: 'registry' },
}
/** The POST rows that stay at the strict Origin, and why. None here. */
const EXCEPTIONS = {}
const HARMLESS = { id: 'x', name: '', address: '' } // every route answers « bad id » or « bad address » and touches nothing

// Real handlers (through the plugin's own mount) and the two routes of the cloud half that the host calls back, played here.
const handlers = new Map()
mount({ effect: (fn) => { fn() } }, { register: ({ path, handler }) => { handlers.set(path, handler); return () => {} } })
const dsh = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (path === '/kybernos-maintenance/state') return json(200, { global: '0.2.1' })
  if (path === '/kybernos-cloud/server') {
    const stored = JSON.parse(readRegistry()).servers
    return json(200, { ok: true, server: 'kybernos-cloud', servers: [{ id: 'kybernos-cloud', name: 'Kybernos Cloud', api: 'https://api.example' }, ...stored], source: 'file', error: null, rejected: [] })
  }
  if (path === '/kybernos-cloud/server/apply') { moved.apply += 1; return json(200, { ok: true }) }
  const handler = handlers.get(path)
  if (handler === undefined) return json(404, { ok: false })
  return handler(req, res)
})
await new Promise((resolve) => dsh.listen(0, '127.0.0.1', resolve))
const port = dsh.address().port
const base = 'http://127.0.0.1:' + port
const cookie = (opts) => sessionCookie('127.0.0.1:' + port, opts)
const send = async (path, method, headers, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  const out = { status: r.status, text: await r.text().catch(() => '') }
  touch()
  return out
}
const REAL = { origin: base, cookie: cookie() }
const nothingMoved = () => Object.values(moved).every((n) => n === 0)

try {
  // ── the family: every POST row of ROUTES is classified ───────────────────────────────────────────────────────
  const posts = ROUTES.filter((r) => r.method === 'POST').map((r) => r.path)
  check('the Servers routes are the ones this test knows (' + ROUTES.length + ' rows, ' + posts.length + ' POST)', posts.length === 5 && ROUTES.length === 6)
  const unclassified = posts.filter((p) => GUARDED[p] === undefined && EXCEPTIONS[p] === undefined)
  check('every POST row is in GUARDED or in EXCEPTIONS (a new write route cannot be forgotten)', unclassified.length === 0, unclassified.join(', '))
  check('every POST row of ROUTES carries `session: true` unless it is an exception', ROUTES.filter((r) => r.method === 'POST' && EXCEPTIONS[r.path] === undefined).every((r) => r.session === true && r.strict === true))
  check('...and the tables name no route that is not in ROUTES', [...Object.keys(GUARDED), ...Object.keys(EXCEPTIONS)].every((p) => posts.includes(p)))
  const mounted = [...handlers.keys()]
  check('...and every row is mounted', ROUTES.every((r) => mounted.includes(r.path)))

  // ── what the guard decides, route by route, with the body that would do the work ─────────────────────────────
  for (const [path, { armed }] of Object.entries(GUARDED)) {
    check(path + ': no Origin and no cookie -> 403', (await send(path, 'POST', {}, armed)).status === 403)
    check(path + ': a foreign Origin -> 403, even with the real cookie', (await send(path, 'POST', { origin: 'http://evil.example', cookie: cookie() }, armed)).status === 403)
    check(path + ': the right Origin and no cookie -> 401', (await send(path, 'POST', { origin: base }, armed)).status === 401)
    check(path + ': the right Origin and a forged cookie -> 401', (await send(path, 'POST', { origin: base, cookie: cookie({ secret: OTHER_SECRET }) }, armed)).status === 401)
    check(path + ': the right Origin and an expired cookie -> 401', (await send(path, 'POST', { origin: base, cookie: cookie({ expiresAt: Date.now() - 1000 }) }, armed)).status === 401)
    const phone = await send(path, 'POST', { ...REAL, 'x-kybernos-tunnel': '1' }, armed)
    check(path + ': the real pair through the phone link -> 403 refused_on_phone', phone.status === 403 && /refused_on_phone/.test(phone.text), phone.status + ' ' + phone.text)
    check(path + ': nothing moved for any of those (no call to the address, servers.json untouched, nothing applied)', nothingMoved(), JSON.stringify(moved))
    const real = await send(path, 'POST', REAL, HARMLESS)
    check(path + ': the right Origin and the real cookie -> the route answers (' + real.status + ')', real.status === 200 && /"ok":false/.test(real.text), real.status + ' ' + real.text.slice(0, 80))
  }
  check('/kybernos-servers/status: the read stays open to a page with no cookie', (await send('/kybernos-servers/status', 'GET', { origin: base })).status === 200)

  // ── the armed bodies are armed: with the real pair each one does its work ────────────────────────────────────
  for (const [path, { armed, moves }] of Object.entries(GUARDED)) {
    const before = moved[moves]
    const real = await send(path, 'POST', REAL, armed)
    check(path + ': the real pair with the armed body does the work (' + real.status + ', ' + moves + ' ' + before + ' -> ' + moved[moves] + ')', real.status === 200 && moved[moves] > before, real.status + ' ' + real.text.slice(0, 100))
  }
} finally {
  dsh.close()
  stranger.close()
}

console.log(failed === 0 ? '\nall green' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
