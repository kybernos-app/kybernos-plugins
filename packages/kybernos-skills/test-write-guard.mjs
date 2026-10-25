// Every POST route of the Skills page needs DSH's signed session as well as the right Origin (recette 2026-10-25, L3-17). The routes spend the person's DeepInfra key
// (covers/make: up to sixteen images a day), download and write a skill from any GitHub repository (install, team/install), point the Discover index at another relay
// (index-source/set), create, switch, copy and delete skills on disk, and change what Kaby may learn on its own. DSH serves plugin routes before its own login and an Origin
// header is forgeable by any local program: before this, `curl -X POST -H 'Origin: http://127.0.0.1:<port>' .../kybernos-skills/covers/make` reached the key.
//
// The table is not a list of names to remember: the test mounts the routes through the real `apply`, asks every registered path whether it answers a POST (a POST with no header
// is a 403 on a POST route and a 405 on a read), and fails on a POST route that is neither in GUARDED nor in EXCEPTIONS. Per guarded route: no header · a foreign Origin (even
// with the real cookie) · the right Origin and no cookie · a forged cookie · an expired one · the real pair through the phone link · the real pair (the Skills page). Everything runs
// on a throw-away DSH home and HOME with the network replaced by a counter: a refused request is checked to have written no file and made no call, and three armed bodies (a skill
// created, the index relay changed, a skill installed) prove that the same probe does see the work when the real pair is sent.
//
//   node packages/kybernos-skills/test-write-guard.mjs
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'kb-skills-guard-'))
process.env.HOME = join(base, 'home')
process.env.DSH_HOME = join(base, 'dsh')
delete process.env.KYBERNOS_SKILLS_INDEX_URL
mkdirSync(process.env.HOME, { recursive: true })
mkdirSync(process.env.DSH_HOME, { recursive: true })
const SKILLS_ROOT = join(process.env.DSH_HOME, 'skills')

// The network is a counter: nothing leaves this test, and a request that reaches it was made by a handler that the guard let through.
const outbound = []
globalThis.fetch = async (url) => { outbound.push(String(url)); throw new Error('offline (test)') }

const { apply } = await import('./index.js')
const { sessionSource } = await import('./session-guard.mjs')
const { OTHER_SECRET, SESSION_SECRET, sessionCookie } = await import('./lib-session-test.mjs')
sessionSource.secret = () => SESSION_SECRET

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

/** The POST routes that need the session. `phone: true` is for a POST that only reads and says so (`phoneMayRead`): a paired phone may make it. */
const GUARDED = {
  'skill/read': { phone: true }, // it returns the SKILL.md of a listed skill and writes nothing: the Skills page of a paired phone opens a skill with it
  'skill/reveal': {}, 'skill/duplicate': {}, 'skill/delete': {},
  'toggle': {}, 'create': {}, 'install': {}, 'team/pack': {}, 'team/install': {}, 'index-source/set': {}, 'featured/toggle': {},
  'covers/make': {}, 'covers/auto': {},
  'scout/run': {}, 'scout/dismiss': {},
  'learned/from-lessons': {}, 'learned/accept': {}, 'learned/edit': {}, 'learned/discard': {}, 'learned/restore': {}, 'learned/undo': {},
  'learned/settings/set': {}, 'learned/keep': {}, 'learned/notice/answer': {}, 'learned/notice/forget': {}, 'learned/week/hide': {}, 'learned/shared': {}, 'learned/stop': {},
}
/** The POST routes that stay at the strict Origin, and why. None here. */
const EXCEPTIONS = {}
const PREFIX = '/kybernos-skills/'

// ── mount through the real apply, on a fake context ─────────────────────────────────────────────────────────────
const routes = {}
const webServer = { register: (r) => { routes[r.path] = { kind: r.kind, handler: r.handler }; return () => {} } }
const log = console.log
const error = console.error
console.log = () => {}
console.error = () => {}
try { apply({ inject (deps, fn) { fn({ get: (n) => (n === 'webServer' ? webServer : undefined), effect: (f) => f() }) } }) } finally { console.log = log; console.error = error }

const PORT = 3080
const AUTHORITY = '127.0.0.1:' + PORT
const cookie = (opts) => sessionCookie(AUTHORITY, opts)
const request = (method, headers, body) => ({ method, headers: headers || {}, socket: { localPort: PORT }, async * [Symbol.asyncIterator] () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) } })
const send = async (path, method, headers, body) => {
  const res = { code: null, text: '', writeHead (c) { this.code = c }, end (s) { this.text = s === undefined ? '' : String(s) } }
  await routes[path].handler(request(method, headers, body), res)
  return { status: res.code, text: res.text }
}
const REAL = { origin: 'http://' + AUTHORITY, cookie: cookie() }

// What the disk looks like: every file under the throw-away homes, hashed.
const snapshot = () => {
  const out = {}
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { out[full + '/'] = ''; walk(full) } else out[full] = createHash('sha256').update(readFileSync(full)).update(String(statSync(full).size)).digest('hex')
    }
  }
  walk(base)
  return JSON.stringify(out)
}
const quiet = () => ({ disk: snapshot(), calls: outbound.length })
const unchanged = (before) => snapshot() === before.disk && outbound.length === before.calls

// Bodies that really do the work when they are let through.
const ARMED = {
  create: { root: SKILLS_ROOT, name: 'guard-probe', description: 'a skill that a stranger must not be able to write' },
  'index-source/set': { url: 'https://relay.example/v1' },
  install: { source: 'acme/skills', name: 'installed-probe' },
}
const bodyOf = (route) => ARMED[route] ?? { root: SKILLS_ROOT, name: 'guard-probe' }

// ── the family: every registered POST route is classified ───────────────────────────────────────────────────────
const exact = Object.keys(routes).filter((p) => routes[p].kind === 'exact')
const answeringPost = []
for (const path of exact) if ((await send(path, 'POST', {}, {})).status !== 405) answeringPost.push(path)
const short = (p) => p.slice(PREFIX.length)
check('the Skills routes are mounted (' + exact.length + ' exact paths, ' + answeringPost.length + ' answer a POST)', exact.length >= 40 && answeringPost.length === Object.keys(GUARDED).length + Object.keys(EXCEPTIONS).length, answeringPost.length)
const unclassified = answeringPost.map(short).filter((p) => GUARDED[p] === undefined && EXCEPTIONS[p] === undefined)
check('every route that answers a POST is in GUARDED or in EXCEPTIONS (a new write route cannot be forgotten)', unclassified.length === 0, unclassified.join(', '))
check('...and the tables name no route that is not mounted', [...Object.keys(GUARDED), ...Object.keys(EXCEPTIONS)].every((p) => routes[PREFIX + p] !== undefined))
check('every exception says why', Object.values(EXCEPTIONS).every((why) => why.length > 20))

// ── what the guard decides, route by route ──────────────────────────────────────────────────────────────────────
const start = quiet()
for (const [short1, { phone }] of Object.entries(GUARDED)) {
  const path = PREFIX + short1
  const body = bodyOf(short1)
  check(short1 + ': no Origin and no cookie -> 403', (await send(path, 'POST', {}, body)).status === 403)
  check(short1 + ': a foreign Origin -> 403, even with the real cookie', (await send(path, 'POST', { origin: 'http://evil.example', cookie: cookie() }, body)).status === 403)
  check(short1 + ': the right Origin and no cookie -> 401', (await send(path, 'POST', { origin: REAL.origin }, body)).status === 401)
  check(short1 + ': the right Origin and a forged cookie -> 401', (await send(path, 'POST', { origin: REAL.origin, cookie: cookie({ secret: OTHER_SECRET }) }, body)).status === 401)
  check(short1 + ': the right Origin and an expired cookie -> 401', (await send(path, 'POST', { origin: REAL.origin, cookie: cookie({ expiresAt: Date.now() - 1000 }) }, body)).status === 401)
  const viaPhone = await send(path, 'POST', { ...REAL, 'x-kybernos-tunnel': '1' }, phone === true ? {} : body)
  if (phone === true) check(short1 + ': through the phone link it is allowed (a POST that only reads)', viaPhone.status === 200 && !/refused_on_phone/.test(viaPhone.text), viaPhone.status + ' ' + viaPhone.text.slice(0, 80))
  else check(short1 + ': the real pair through the phone link -> 403 refused_on_phone', viaPhone.status === 403 && /refused_on_phone/.test(viaPhone.text), viaPhone.status + ' ' + viaPhone.text.slice(0, 80))
}
check('no refused request wrote a file or made a call (the armed bodies of create, index-source/set and install were among them)', unchanged(start), 'disk changed: ' + (snapshot() !== start.disk) + ', calls: ' + (outbound.length - start.calls))

// ── the real pair gets through every guard, on a body that stays harmless ───────────────────────────────────────
for (const short1 of Object.keys(GUARDED)) {
  const real = await send(PREFIX + short1, 'POST', REAL, {})
  check(short1 + ': the right Origin and the real cookie -> the route answers (' + real.status + ')', real.status === 200 && real.text.startsWith('{'), real.status + ' ' + real.text.slice(0, 80))
}
check('a GET on a POST route is still 405, whatever the headers', (await send(PREFIX + 'toggle', 'GET', REAL)).status === 405)

// ── the armed bodies are armed: with the real pair the probe does see the work ──────────────────────────────────
{
  const before = quiet()
  const made = await send(PREFIX + 'create', 'POST', REAL, ARMED.create)
  check('create: the real pair with the armed body writes the skill (' + made.status + ')', made.status === 200 && /"ok":true/.test(made.text) && snapshot() !== before.disk, made.text.slice(0, 120))
  const mid = quiet()
  const relay = await send(PREFIX + 'index-source/set', 'POST', REAL, ARMED['index-source/set'])
  check('index-source/set: the real pair with the armed body saves the relay (' + relay.status + ')', relay.status === 200 && /"ok":true/.test(relay.text) && snapshot() !== mid.disk, relay.text.slice(0, 120))
  const calls = outbound.length
  const install = await send(PREFIX + 'install', 'POST', REAL, ARMED.install)
  check('install: the real pair with the armed body calls out to download the skill (' + install.status + ')', install.status === 200 && outbound.length > calls, install.text.slice(0, 120))
}

console.log(failed === 0 ? '\nall green' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
