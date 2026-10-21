// ═══════════════════════════════════════════════════════════════════════════
// Tests of kybernos-miniapps — HOST half (hostile cases M-03/M-04).
//
//   node kybernos-miniapps/test-host.mjs
//
// M-03: install/uninstall are POSTs that write and launch a native app —
// EXACT origin + the session cookie + a JSON Content-Type required, app name confined.
// ═══════════════════════════════════════════════════════════════════════════

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, browserHeaders } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET // the machine secret the guard checks the session cookie against (test-write-guard.mjs reads the file)

// A temp HOME BEFORE the module is imported: DEST_ROOT derives from homedir() at load, so the failure paths (a disk that refuses to
// create the install folder) are exercised without touching the real ~/Applications.
const home = mkdtempSync(join(tmpdir(), 'kb-miniapps-'))
const vraiHome = process.env.HOME
process.env.HOME = home
const { apply } = await import('./index.js')

let echecs = 0
const ok = (label, cond, detail) => {
  if (cond) console.log(`✓ ${label}${detail === undefined ? '' : ` (${detail})`}`)
  else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
}

// Mount the routes through a fake ctx
const routes = {}
const ctx = {
  get: (nom) => (nom === 'webServer' ? { register: (r) => { routes[r.path] = r.handler } } : undefined),
  effect: (fn) => fn(),
  inject: (_noms, fn) => fn(),
}
apply(ctx)

ok('install/uninstall/list routes mounted', routes['/kybernos-miniapps/install'] && routes['/kybernos-miniapps/uninstall'] && routes['/kybernos-miniapps/list'])

// Fake request
const requete = (extra, corps) => {
  const body = JSON.stringify(corps ?? {})
  return {
    method: 'POST',
    // the page itself: its own origin and DSH's session cookie, unless the test says otherwise
    headers: Object.assign({ 'content-type': 'application/json' }, browserHeaders(), extra.headers || {}),
    socket: { localPort: 3080 },
    on: (ev, fn) => {
      if (ev === 'data') fn(body)
      if (ev === 'end') setTimeout(() => fn(), 0)
    },
  }
}
const reponse = () => {
  const r = { code: null, corps: '' }
  r.setHeader = () => {}
  r.writeHead = (c) => { r.code = c }
  r.end = (b) => { r.corps = String(b) }
  return r
}
const jouer = async (handler, req) => { const res = reponse(); await handler(req, res); return res }

// ── M-03: hostile origin refused ──────────────────────────────────────────
{
  const res = await jouer(routes['/kybernos-miniapps/install'], requete({ headers: { origin: 'http://evil.example' } }, { id: 'test', html: '<html><body>ok</body></html>' }))
  ok('M-03: install from a hostile origin → 403', res.code === 403, `code=${res.code}`)
}
{
  const res = await jouer(routes['/kybernos-miniapps/uninstall'], requete({ headers: { origin: 'http://localhost.evil.example:3080' } }, { id: 'test' }))
  ok('M-03: uninstall from a look-alike origin prefix → 403', res.code === 403, `code=${res.code}`)
}
// ── M-03: non-JSON Content-Type refused (simple cross-site form) ──────────
{
  const res = await jouer(routes['/kybernos-miniapps/install'], requete({ headers: { 'content-type': 'text/plain' } }, { id: 'test', html: '<html><body>ok</body></html>' }))
  ok('M-03: install as text/plain → 415', res.code === 415, `code=${res.code}`)
}
// ── M-03: local origin accepted (legitimate behaviour) ─────────────────────
// NB: the install is NOT run for real — macOS only and real side effects;
// we only check that it passes the guards (code ≠ 401/403/415).
if (process.platform === 'darwin') {
  // An HTML too short: the route answers « HTML trop court » BEFORE writing anything (this test no longer installs an app in ~/Applications).
  const res = await jouer(routes['/kybernos-miniapps/install'], requete({ headers: { origin: 'http://127.0.0.1:3080' } }, { id: 'garde-test', html: '<b>x</b>' }))
  const j = (() => { try { return JSON.parse(res.corps) } catch { return {} } })()
  ok('M-03: install from the local origin passes the guards (not 401/403/415)', res.code !== 401 && res.code !== 403 && res.code !== 415 && j.ok === false, JSON.stringify(j).slice(0, 60))
} else {
  console.log('ℹ macOS required for the real install — 403/415 guards tested above')
}

// ── L3-01: a disk failure answers 500 {ok:false,error}, not a bodyless 400 ───
// The install folder is a FILE here, so mkdirSync throws: the handler used to reject and the engine answered with a bodyless 400.
// No app is installed, and the whole test runs under a temp HOME.
{
  const destRoot = join(home, 'Applications', 'Kybernos')
  mkdirSync(join(home, 'Applications'), { recursive: true })
  writeFileSync(destRoot, 'not a folder')
  const res = await jouer(routes['/kybernos-miniapps/list'], { headers: {}, socket: { localPort: 3080 }, on: () => {} })
  let j = {}
  try { j = JSON.parse(res.corps) } catch { /* not JSON */ }
  ok('L3-01: a disk failure on /list → 500 JSON {ok:false,error}', res.code === 500 && j.ok === false && typeof j.error === 'string' && j.error !== '', `${res.code} ${String(res.corps).slice(0, 80)}`)
  if (process.platform === 'darwin') {
    const inst = await jouer(routes['/kybernos-miniapps/install'], requete({ headers: { origin: 'http://127.0.0.1:3080' } }, { id: 'echec-disque', titre: 'Echec', html: '<html><body>ok</body></html>' }))
    let ji = {}
    try { ji = JSON.parse(inst.corps) } catch { /* not JSON */ }
    ok('L3-01: ...and on /install (mkdir/codesign path) → 500 JSON', inst.code === 500 && ji.ok === false && typeof ji.error === 'string' && ji.error !== '', `${inst.code} ${String(inst.corps).slice(0, 80)}`)
  }
}

process.env.HOME = vraiHome
rmSync(home, { recursive: true, force: true })

console.log(echecs === 0 ? '\nHost: all green.' : `\n✗ ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)
