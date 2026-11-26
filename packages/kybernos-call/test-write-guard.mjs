// ── Every call route that acts needs proof of who calls: the signed session (a page) or the worker's one-run secret ──────────
//
// L1-01 (audit 2026-10-20): `keys`, `engine`, `clone`, `test` and `preset` were guarded by `sameOriginStrict` alone. An Origin
// header is forgeable by any local program or another account on the machine, and the repo's written rule says such a route
// « cannot rely on an Origin check »: it needs the strict same-origin request AND DSH's signed browser-session cookie
// (`writeGuard`, session-guard.mjs — the terminal's code, copied here like kybernos-auto does). The page of the settings tab sends both.
//
// L3-03 (recette 2026-10-25): `token`, `agent`, `utterance` (and `speech`, `health`, the settings write) had stayed at the Origin alone, and
// `utterance` is worse than a write: the host builds the machine's signed cookie itself and runs a real turn of a real session with it, so a
// forged Origin made the host the confused deputy (played end to end: the text was in the session file, and the agent has its tools).
// The only caller that is not a page is the call worker (agent/agent.py, no cookie): the host gives each worker run a random secret
// (worker-token.mjs) and `utterance` and `speech` accept it OR the signed session. The page routes accept the session only: the worker's
// secret is not a login.
//
// The table below lists every route of the bundle with who may call it, so a route added later cannot be forgotten: the file fails on a
// route that is in neither the table nor the list of plain reads.
//
//   node packages/kybernos-call/test-write-guard.mjs
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mountCallRoutes, ROUTES } from './call-routes.mjs'
import { sessionSource } from './session-guard.mjs'
import { TOKEN_HEADER, createWorkerToken } from './worker-token.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

const here = dirname(fileURLToPath(import.meta.url))
sessionSource.secret = () => SESSION_SECRET

const PORT = 3080
const OWN = '127.0.0.1:' + PORT
const ORIGIN = 'http://' + OWN
const cookie = (opts) => sessionCookie(OWN, opts)

// The worker's credential is the real one; everything the routes call is a counter, so « nothing was done » is measured.
const tokens = createWorkerToken()
let secret = tokens.issue()
const done = {}
const count = (label, value) => async () => { done[label] = (done[label] ?? 0) + 1; return value }
const admin = {
  everything: async () => ({ ok: true }),
  patchSettings: count('settings', { ok: true }),
  setKeys: count('keys', { ok: true, status: {} }),
  test: count('test', { ok: true }),
  cloneSample: count('clone', { ok: true }),
  deleteClone: count('clone', { ok: true }),
  applyPreset: count('preset', { ok: true, settings: {} }),
  avatars: count('avatars', { ok: true, avatars: [] }),
  runHealth: count('health', { ok: true, checks: [] }),
  engine: count('engine', { ok: true, state: 'idle' }),
}
const call = {
  status: async () => ({ ok: true, secrets: 'posee' }),
  mint: count('token', { ok: true, room: 'r' }),
  agentStart: count('agent', { ok: true }), agentStop: count('agent', { ok: true }), agentState: count('agent', { ok: true }),
  utterance: count('utterance', { ok: true }),
  workerAccepts: (req) => tokens.accepts(req),
}
const feed = { poll: count('speech', { ok: true, known: true, items: [], next: 0 }) }
const routes = new Map()
mountCallRoutes({ register: (r) => { routes.set(r.path, r); return () => {} } }, call, here, (fn) => fn(), feed, admin)

const makeReq = (method, headers, body, url) => {
  const req = Readable.from([Buffer.from(JSON.stringify(body === undefined || body === null ? {} : body))])
  req.method = method
  req.url = url
  req.headers = { host: OWN, ...headers }
  req.socket = { localPort: PORT, remoteAddress: '127.0.0.1' }
  return req
}
const makeRes = () => {
  const res = { status: null, body: '' }
  res.writeHead = (s) => { res.status = s }
  res.end = (b) => { res.body = b === undefined ? '' : b }
  return res
}
const total = () => Object.values(done).reduce((a, b) => a + b, 0)

const PAGE = 'page' // the signed session only
const WORKER = 'worker' // the signed session, or the worker's one-run secret
// [path, method, who, body, query]
const FAMILY = [
  [ROUTES.token, 'POST', PAGE, { sessionId: 'session-aaaaaaaa' }],
  [ROUTES.agent, 'POST', PAGE, { action: 'start' }],
  [ROUTES.utterance, 'POST', WORKER, { sessionId: 'session-aaaaaaaa', text: 'hello' }],
  [ROUTES.speech, 'GET', WORKER, null, '?room=room-speak&after=0&wait=0'],
  [ROUTES.health, 'POST', PAGE, {}],
  [ROUTES.settings, 'POST', PAGE, { patch: { language: 'es' } }],
  [ROUTES.keys, 'POST', PAGE, { patch: { LIVEKIT_URL: 'ws://x', ELEVENLABS_API_KEY: 'sk-live' } }],
  [ROUTES.test, 'POST', PAGE, { service: 'groq' }],
  [ROUTES.clone, 'POST', PAGE, { rootId: 'r', voiceId: 'v', name: 'Claire' }],
  [ROUTES.preset, 'POST', PAGE, { id: 'live' }],
  [ROUTES.avatars, 'POST', PAGE, {}],
  [ROUTES.engine, 'POST', PAGE, { action: 'install' }],
]
// Reads that hold no secret (the settings tab's GET says what is set, never a key) and the SDK file.
const PLAIN_READS = [ROUTES.status, ROUTES.vendor]

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const run = async (row, headers) => {
  const [path, method, , body, query] = row
  const res = makeRes()
  await routes.get(path).handler(makeReq(method, headers, body, path + (query ?? '')), res)
  return { status: res.status, text: res.body }
}
const label = (row) => row[1] + ' ' + row[0]

console.log('Kybernos call: who may call each route')
const covered = new Set(FAMILY.map((row) => row[0]).concat(PLAIN_READS))
for (const path of Object.values(ROUTES)) assert.ok(covered.has(path), path + ' is mounted but neither in the table nor among the plain reads: decide who may call it')
for (const [path] of FAMILY) assert.ok(routes.has(path), path + ' is in the table but not mounted')
ok('every route of the bundle is in the table (who may call it) or is a plain read: ' + FAMILY.length + ' + ' + PLAIN_READS.length)

const H = TOKEN_HEADER
for (const row of FAMILY) {
  const [path, , who] = row
  const name = label(row)
  const before = total()
  // Refused for everyone: nothing is done, whatever is claimed.
  const refusals = [
    ['no Origin and nothing else', {}, 403],
    ['no Origin, the real cookie', { cookie: cookie() }, 403],
    ['a foreign Origin, even with the real cookie', { origin: 'http://evil.example', cookie: cookie() }, 403],
    ['a foreign Origin, even with the real secret', { origin: 'http://evil.example', [H]: secret }, 403],
    ['the right Origin alone (what a local program sends)', { origin: ORIGIN }, 401],
    ['the right Origin and a forged cookie', { origin: ORIGIN, cookie: cookie({ secret: OTHER_SECRET }) }, 401],
    ['the right Origin and a wrong secret', { origin: ORIGIN, [H]: 'f'.repeat(64) }, 401],
    ['the right Origin and an empty secret', { origin: ORIGIN, [H]: '' }, 401],
    ['the right Origin and the secret twice (a smuggled list)', { origin: ORIGIN, [H]: secret + ', ' + secret }, 401],
  ]
  if (who === PAGE) refusals.push(['the right Origin and the worker\'s real secret (not a login)', { origin: ORIGIN, [H]: secret }, 401])
  if (who === WORKER) {
    refusals.push(['the worker\'s real secret relayed by the phone tunnel', { origin: ORIGIN, [H]: secret, 'x-kybernos-tunnel': '1' }, [401, 403]])
    refusals.push(['the worker\'s real secret with no Origin', { [H]: secret }, 403])
  }
  for (const [what, headers, want] of refusals) {
    const r = await run(row, headers)
    assert.ok([].concat(want).includes(r.status), name + ': ' + what + ' -> ' + r.status + ' ' + r.text.slice(0, 90))
  }
  assert.equal(total(), before, name + ': a refused request did nothing')
  // The person's page: the right Origin AND the signed cookie.
  const page = await run(row, { origin: ORIGIN, cookie: cookie() })
  assert.ok(page.status !== 401 && page.status !== 403, name + ': the real pair is not refused: ' + page.status + ' ' + page.text.slice(0, 90))
  assert.equal(total(), before + 1, name + ': the real pair is served')
  if (who === WORKER) {
    // The worker: the right Origin AND this run's secret.
    const worker = await run(row, { origin: ORIGIN, [H]: secret })
    assert.ok(worker.status !== 401 && worker.status !== 403, name + ': the worker is not refused: ' + worker.status + ' ' + worker.text.slice(0, 90))
    assert.equal(total(), before + 2, name + ': the worker is served')
    // The same worker run, once its secret is gone (stopped, exited, restarted): refused.
    const old = secret
    tokens.revoke()
    const stopped = await run(row, { origin: ORIGIN, [H]: old })
    assert.equal(stopped.status, 401, name + ': the secret of a stopped worker is refused')
    secret = tokens.issue()
    const restarted = await run(row, { origin: ORIGIN, [H]: old })
    assert.equal(restarted.status, 401, name + ': the secret of the previous run is refused after a restart')
    assert.equal(total(), before + 2, name + ': and neither did anything')
    const fresh = await run(row, { origin: ORIGIN, [H]: secret })
    assert.ok(fresh.status !== 401 && fresh.status !== 403, name + ': the new run\'s secret is accepted')
    assert.equal(total(), before + 3)
  }
  ok(name + ' (' + who + '): ' + refusals.length + ' refusals do nothing · the signed session is served' + (who === WORKER ? ' · the worker\'s secret is served until its run ends, then refused' : ' · the worker\'s secret is not a login'))
}

// Without the check (a call object that offers none, an older host half) only the cookie works: fail closed.
{
  const bare = new Map()
  const without = Object.assign({}, call)
  delete without.workerAccepts
  mountCallRoutes({ register: (r) => { bare.set(r.path, r); return () => {} } }, without, here, (fn) => fn(), feed, admin)
  const before = total()
  const row = FAMILY.find((r) => r[0] === ROUTES.utterance)
  const send = async (headers) => { const res = makeRes(); await bare.get(row[0]).handler(makeReq(row[1], headers, row[3], row[0]), res); return res.status }
  assert.equal(await send({ origin: ORIGIN, [H]: secret }), 401)
  assert.equal(total(), before)
  assert.notEqual(await send({ origin: ORIGIN, cookie: cookie() }), 401)
  ok('a host half with no worker check refuses the secret and still serves the signed session (fail closed)')
}

console.log('\nCALL WRITE GUARD — ' + pass + ' vérification(s), 0 échec')
