#!/usr/bin/env node
/** The routes of this bundle that WRITE for the Auto page (/session, /settings, /probe: a probe spends tokens) need DSH's signed session as
 *  well as the right Origin. DSH serves plugin routes before its own login and an Origin header is forgeable by any local program: before
 *  this rule `curl -X POST http://127.0.0.1:<port>/kybernos-auto/settings -d '{"autoRouting":true}'` switched Auto on for every session.
 *
 *  /router and /report stay as they were ON PURPOSE: their caller is `cli/auto-router.mjs`, a Node program the agent runs, which sends no
 *  Origin and has no browser session (test-cli.mjs drives it over a real socket). A foreign Origin is still refused there.
 *
 *  For each guarded write, in this order: no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no
 *  cookie (what a local program sends) · the right Origin and a forged cookie · the right Origin and the real cookie (the Auto page).
 *
 *    node packages/kybernos-auto/test-write-guard.mjs */
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monterRoutes } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

let pass = 0
let fail = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { pass += 1; console.log('  ✓ ' + nom) } else { fail += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 220) : '')) }
}
sessionSource.secret = () => SESSION_SECRET

const home = mkdtempSync(join(tmpdir(), 'kauto-guard-'))
const routes = {}
monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { home, ollama: 'http://127.0.0.1:1', llm: { stream: undefined } })

const hit = async (path, method, headers, corps) => {
  const body = corps === undefined ? '' : JSON.stringify(corps)
  const req = { method, url: path, headers, socket: { localPort: 3080 }, on (ev, cb) { if (ev === 'data') cb(body); if (ev === 'end') cb() } }
  let status = 0
  await routes[path]({ ...req }, { writeHead (s) { status = s }, end () {} })
  return status
}
/** Every file under the home, with its content: what a refused write must leave exactly as it was. */
const snapshot = (dir = home) => { try { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? snapshot(join(dir, e.name)) : [join(dir, e.name) + '=' + readFileSync(join(dir, e.name), 'utf8')])).sort().join('\n') } catch (e) { return '' } }

const GUARDED = [
  ['/kybernos-auto/session', { sessionId: 's1', on: true }],
  ['/kybernos-auto/settings', { autoRouting: true, autoWhitelist: ['a/b'] }],
  ['/kybernos-auto/probe', {}],
]
for (const [path, body] of GUARDED) {
  const before = snapshot()
  ok(path + ': no Origin and no cookie -> 403', await hit(path, 'POST', {}, body) === 403)
  ok(path + ': a foreign Origin -> 403, even with the real cookie', await hit(path, 'POST', { ...browserHeaders(), origin: 'http://evil.example' }, body) === 403)
  ok(path + ': the right Origin and no cookie -> 401', await hit(path, 'POST', { origin: 'http://127.0.0.1:3080' }, body) === 401)
  ok(path + ': the right Origin and a forged cookie -> 401', await hit(path, 'POST', { origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }, body) === 401)
  ok(path + ': ...and nothing was written', snapshot() === before)
  const real = await hit(path, 'POST', browserHeaders(), body)
  ok(path + ': the right Origin and the real cookie -> the route answers (' + real + ')', real !== 401 && real !== 403 && real !== 0, real)
}

// Left open on purpose: the CLI's two routes. A request with no header is answered, a foreign Origin is still refused.
const OPEN = [['/kybernos-auto/router', { demande: 'fix the pagination bug' }], ['/kybernos-auto/report', { modele: 'a/b', erreur: false, latenceMs: 100 }]]
for (const [path, body] of OPEN) {
  const status = await hit(path, 'POST', {}, body)
  ok(path + ': no header at all is answered (the CLI sends none), ' + status, status === 200, status)
  ok(path + ': a foreign Origin is refused', await hit(path, 'POST', { origin: 'http://evil.example' }, body) === 403)
}
ok('the reads keep answering with no header', await hit('/kybernos-auto/state', 'GET', {}) === 200)
ok('/state from a foreign Origin is refused', await hit('/kybernos-auto/state', 'GET', { origin: 'http://evil.example' }) === 403)

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
