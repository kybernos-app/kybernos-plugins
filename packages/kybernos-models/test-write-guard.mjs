#!/usr/bin/env node
// The routes of this bundle that WRITE or ACT (save a note, append to the journal, park / take / forget a provider, check a pasted key against
// its provider, refresh the scores, force a models.dev download) need DSH's signed session as well as the right Origin. DSH serves plugin routes
// before its own login and an Origin header is forgeable by any local program: before this rule `curl -X POST -H 'Origin: http://127.0.0.1:<port>'
// http://127.0.0.1:<port>/kybernos-models/providers/park -d '{...}'` parked the person's provider (its profile, with its key variable) and
// rewrote their notes. The guard is session-guard.mjs (the terminal's rule, an identical copy in every bundle that carries it).
//
// For each guarded route, in this order: no Origin and no cookie (403) · a foreign Origin, even with the real cookie (403) · the right Origin and
// no cookie (401: what a local program sends) · the right Origin and a forged cookie (401) · the right Origin and the real cookie (the Models
// page: accepted). The refused requests leave the store exactly as it was and send nothing out. The reads keep their rule. Every caller is a page
// of this DSH (the Models page, the first-run wizard of kybernos-plugin): scripts/audit-routes.mjs finds none that is not.
//
//   node packages/kybernos-models/test-write-guard.mjs
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

const home = mkdtempSync(join(tmpdir(), 'kbm-guard-'))
process.env.DSH_HOME = home
sessionSource.secret = () => SESSION_SECRET

// Nothing leaves the machine: a stand-in for Node's fetch counts the calls and answers like a provider that accepts the key.
let outgoing = 0
globalThis.fetch = async () => { outgoing += 1; return new Response(JSON.stringify({ acme: { models: { 'a-1': { name: 'A one', limit: { context: 1000, output: 100 } } } } }), { status: 200, headers: { 'content-type': 'application/json' } }) }

const { apply, SCORES_FILE } = await import('./index.js')

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 200))) }
}

const routes = {}
const web = { register: (r) => { routes[r.path] = r.handler } }
const hostCtx = { get: (n) => (n === 'webServer' ? web : undefined), effect: (fn) => fn() }
apply({ inject: (_names, fn) => fn(hostCtx), get: () => undefined, effect: (fn) => fn() })

// A snapshot of the scores written by hand and still fresh, so that even the real pair on /scores/sync starts no download.
mkdirSync(dirname(SCORES_FILE), { recursive: true })
writeFileSync(SCORES_FILE, JSON.stringify({ version: 1, at: Date.now(), sources: {}, aa: {}, benchlm: {}, catalogue: {} }))

const PORT = 3080
const hit = async (path, method, headers, body) => {
  const [pathname, query] = path.split('?')
  const text = body === undefined ? '' : JSON.stringify(body)
  const req = {
    method, url: pathname + (query === undefined ? '' : '?' + query), headers: { host: '127.0.0.1:' + PORT, ...headers }, socket: { localPort: PORT },
    on (ev, cb) { if (ev === 'data' && text !== '') cb(Buffer.from(text)); if (ev === 'end') cb() },
    async *[Symbol.asyncIterator]() { if (text !== '') yield Buffer.from(text) },
  }
  const out = { status: 0, body: null }
  await routes[pathname](req, { writeHead (s) { out.status = s }, end (b) { try { out.body = JSON.parse(String(b)) } catch (e) { out.body = b } } })
  return out
}
/** Every file under the home, with its content: what a refused request must leave exactly as it was. */
const snapshot = (dir = home) => { try { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? snapshot(join(dir, e.name)) : [join(dir, e.name) + '=' + readFileSync(join(dir, e.name), 'utf8')])).sort().join('\n') } catch (e) { return '' } }

const PROFILE = { displayName: 'Acme', api: 'openai-completions', baseURL: 'https://api.acme.example/v1', apiKeyEnv: 'ACME_KEY', models: [{ id: 'a-1' }] }
// [method, path, a body for which the real pair gets an answer of its own]
const GUARDED = [
  ['POST', '/kybernos-models/annotations/save', { key: 'groq/llama-3.3-70b', fields: { family: 'guard' } }],
  ['POST', '/kybernos-models/journal', { niveau: 'annotation', champ: 'x' }],
  ['POST', '/kybernos-models/key/check', { provider: 'openai', key: 'sk-test-0123456789abcdef' }],
  ['POST', '/kybernos-models/models/live', { route: 'opencode-go' }],
  ['POST', '/kybernos-models/models/probe', { route: 'opencode-go', model: 'm-1' }],
  ['POST', '/kybernos-models/providers/park', { slug: 'acme', profile: PROFILE, models: ['a-1'] }],
  ['POST', '/kybernos-models/providers/take', { slug: 'acme' }],
  ['POST', '/kybernos-models/providers/forget', { slug: 'acme' }],
  ['POST', '/kybernos-models/scores/list', { models: [] }],
  ['POST', '/kybernos-models/scores/sync', {}],
  ['GET', '/kybernos-models/modelsdev?force=1', undefined],
]
const READS = ['/kybernos-models/status', '/kybernos-models/annotations', '/kybernos-models/modelsdev', '/kybernos-models/providers', '/kybernos-models/providers/parked', '/kybernos-models/logo', '/kybernos-models/scores', '/kybernos-models/scores/status']

const named = new Set([...GUARDED.map((g) => g[1].split('?')[0]), ...READS, '/kybernos-models/journal'])
check('every route of the bundle is classified here (a new route must be added to GUARDED or READS)', Object.keys(routes).every((p) => named.has(p)), Object.keys(routes).filter((p) => !named.has(p)))

for (const [method, path, body] of GUARDED) {
  const label = method + ' ' + path
  const before = snapshot()
  const calls = outgoing
  const send = (headers) => hit(path, method, headers, body)
  // A GET says nothing about its origin when a page asks (a browser sends none): the cookie is what refuses it (401); a POST must name its origin (403).
  check(label + ': no Origin and no cookie → ' + (method === 'GET' ? 401 : 403), (await send({})).status === (method === 'GET' ? 401 : 403))
  check(label + ': a foreign Origin, even with the real cookie → 403', (await send({ ...browserHeaders(), origin: 'http://evil.example' })).status === 403)
  check(label + ': the right Origin and no cookie → 401', (await send({ origin: 'http://127.0.0.1:' + PORT })).status === 401)
  check(label + ': the right Origin and a forged cookie → 401', (await send({ origin: 'http://127.0.0.1:' + PORT, cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) })).status === 401)
  check(label + ': nothing was written and nothing left the machine', snapshot() === before && outgoing === calls)
  const real = await send(browserHeaders())
  check(label + ': the right Origin and the real cookie → accepted (' + real.status + ')', real.status === 200, real.body)
}

// A write route that answered 405 to a wrong method before the guard still does: the method is judged first.
check('a GET on a POST route is a 405, whoever asks', (await hit('/kybernos-models/providers/park', 'GET', {})).status === 405)

// The reads keep their rule: no header passes (a page sends no Origin on a same-origin GET), a foreign Origin is refused where the route says so.
for (const path of READS.filter((p) => p !== '/kybernos-models/logo' && p !== '/kybernos-models/modelsdev' && p !== '/kybernos-models/providers')) {
  check('GET ' + path + ' with no header is answered', (await hit(path, 'GET', {})).status === 200, (await hit(path, 'GET', {})).status)
}
check('GET /kybernos-models/journal with no header is answered', (await hit('/kybernos-models/journal', 'GET', {})).status === 200)
check('GET /kybernos-models/providers/parked from a foreign Origin is still refused (403)', (await hit('/kybernos-models/providers/parked', 'GET', { origin: 'http://evil.example' })).status === 403)
check('GET /kybernos-models/modelsdev with no header (no force) is answered', (await hit('/kybernos-models/modelsdev', 'GET', {})).status === 200)

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
