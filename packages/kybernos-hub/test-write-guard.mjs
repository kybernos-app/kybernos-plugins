// The Suite panel's POST routes change the machine (a module installed, the DSH engine replaced, DSH restarted, the signed catalogue fetched), so they need DSH's
// signed session as well as the right Origin (recette 2026-10-25, L3-14). DSH serves plugin routes before its own login and an Origin header is forgeable by any
// local program: before this, `curl -X POST -H 'Origin: http://127.0.0.1:<port>' .../kybernos-hub/relaunch -d '{"confirm":true}'` restarted DSH.
//
// The table is not a list of names to remember: the test mounts the routes through the real mount functions, asks every registered path whether it answers a
// POST, and fails on a POST route that is neither in GUARDED (cookie required) nor in EXCEPTIONS (with the reason it stays at the Origin alone). A route added
// tomorrow cannot be forgotten.
//
// For each guarded route, in this order: no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no cookie (what a local
// program sends) · the right Origin and a forged cookie · the right Origin, the real cookie and the phone-link marker (a paired phone) · the real pair (the Suite
// panel, Maintenance). The bodies are chosen so that even the real pair starts nothing here, and a refused request is checked to have moved nothing.
//
//   node packages/kybernos-hub/test-write-guard.mjs
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { creerHub, monterRoutes, monterSuite } from './hub-host.mjs'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

/** The POST routes that need the session, with a body that cannot start anything even when the guard lets it through. */
const GUARDED = {
  '/kybernos-hub/module': { id: 'nope', action: 'activer' },
  '/kybernos-hub/relaunch': {},
  '/kybernos-hub/engine': {},
  '/kybernos-hub/update': {},
  '/kybernos-hub/catalogue/refresh': {},
}
/** The POST routes that stay at the strict Origin, and why. Nothing else may. */
const EXCEPTIONS = {
  '/kybernos-hub/beacon': 'the boot crash detector: it must keep working when the session cannot be judged, and a forged verdict only shows a « safe mode recommended » banner',
}

const ICI = dirname(fileURLToPath(import.meta.url))
const catalogue = JSON.parse(readFileSync(join(ICI, 'catalog.json'), 'utf8'))
const moved = { activation: 0, robot: 0, relaunch: 0, download: 0, cache: 0, boot: 0 }
const hub = creerHub({ lire: () => null, ecrire: () => { moved.boot += 1 }, maintenant: () => '2026-10-25T00:00:00Z', nouvelId: () => 'boot-1' })
hub.demarrer()
moved.boot = 0
const deps = {
  catalogue,
  hub,
  lireActivation: () => null,
  ecrireActivation: () => { moved.activation += 1 },
  executer: async () => { moved.robot += 1; return { code: 0, sortie: '' } },
  relancer: async () => { moved.relaunch += 1; return { ok: true } },
  telecharger: async () => { moved.download += 1; return null },
  ecrireCache: () => { moved.cache += 1 },
}

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => {} } }
monterRoutes(webServer, hub)
monterSuite(webServer, deps)

const server = createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = 'http://127.0.0.1:' + port
const authority = '127.0.0.1:' + port
const cookie = (opts) => sessionCookie(authority, opts)
const send = async (path, method, headers, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  return { status: r.status, text: await r.text().catch(() => '') }
}
const REAL = { origin: base, cookie: cookie() }
const stillness = () => JSON.stringify(moved)

try {
  // ── the family: every registered POST route is classified ───────────────────────────────────────────────────
  const answeringPost = []
  for (const path of routes.keys()) if ((await send(path, 'POST', REAL, {})).status !== 405) answeringPost.push(path)
  check('the Suite and boot routes are mounted (' + routes.size + ' paths, ' + answeringPost.length + ' answer a POST)', routes.size >= 9 && answeringPost.length >= 6)
  const unclassified = answeringPost.filter((p) => GUARDED[p] === undefined && EXCEPTIONS[p] === undefined)
  check('every route that answers a POST is in GUARDED or in EXCEPTIONS (a new write route cannot be forgotten)', unclassified.length === 0, unclassified.join(', '))
  check('...and the tables name no route that is not mounted', [...Object.keys(GUARDED), ...Object.keys(EXCEPTIONS)].every((p) => routes.has(p)))
  check('every exception says why', Object.values(EXCEPTIONS).every((why) => why.length > 20))
  moved.activation = moved.robot = moved.relaunch = moved.download = moved.cache = 0

  // ── what the guard decides, route by route ──────────────────────────────────────────────────────────────────
  for (const [path, body] of Object.entries(GUARDED)) {
    check(path + ': no Origin and no cookie -> 403', (await send(path, 'POST', {}, body)).status === 403)
    check(path + ': a foreign Origin -> 403, even with the real cookie', (await send(path, 'POST', { origin: 'http://evil.example', cookie: cookie() }, body)).status === 403)
    check(path + ': the right Origin and no cookie -> 401', (await send(path, 'POST', { origin: base }, body)).status === 401)
    check(path + ': the right Origin and a forged cookie -> 401', (await send(path, 'POST', { origin: base, cookie: cookie({ secret: OTHER_SECRET }) }, body)).status === 401)
    check(path + ': the right Origin and an expired cookie -> 401', (await send(path, 'POST', { origin: base, cookie: cookie({ expiresAt: Date.now() - 1000 }) }, body)).status === 401)
    const phone = await send(path, 'POST', { ...REAL, 'x-kybernos-tunnel': '1' }, body)
    check(path + ': the real pair through the phone link -> 403 refused_on_phone', phone.status === 403 && /refused_on_phone/.test(phone.text), phone.status + ' ' + phone.text)
    const real = await send(path, 'POST', REAL, body)
    check(path + ': the right Origin and the real cookie -> the route answers (' + real.status + ')', real.status !== 401 && real.status !== 403 && real.status !== 503, real.status + ' ' + real.text.slice(0, 80))
    check(path + ': GET stays "method not allowed" (405), whatever the headers', (await send(path, 'GET', REAL)).status === 405)
  }
  check('a refused request moved nothing: no module switched, no robot run, no restart, no download, no cache write', stillness() === JSON.stringify({ activation: 0, robot: 0, relaunch: 0, download: 0, cache: 0, boot: 0 }), stillness())

  // ── the exception keeps its rule: strict Origin, no cookie asked ─────────────────────────────────────────────
  check('/kybernos-hub/beacon: no Origin -> 403', (await send('/kybernos-hub/beacon', 'POST', {}, { type: 'loading' })).status === 403)
  check('/kybernos-hub/beacon: a foreign Origin -> 403', (await send('/kybernos-hub/beacon', 'POST', { origin: 'http://evil.example' }, { type: 'loading' })).status === 403)
  check('/kybernos-hub/beacon: the right Origin and no cookie -> 200 (the detector must not depend on the session)', (await send('/kybernos-hub/beacon', 'POST', { origin: base }, { type: 'loading' })).status === 200)
} finally {
  server.close()
}

console.log(failed === 0 ? '\nall green' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
