// ── The call routes that WRITE a secret, install the engine or spend a provider call need the signed session ───────────
//
// L1-01 (audit 2026-10-20): `keys`, `engine`, `clone`, `test` and `preset` were guarded by `sameOriginStrict` alone. An Origin
// header is forgeable by any local program or another account on the machine, and the repo's written rule says such a route
// « cannot rely on an Origin check »: it needs the strict same-origin request AND DSH's signed browser-session cookie
// (`writeGuard`, session-guard.mjs — the terminal's code, copied here like kybernos-auto does). Before this, a local program
// could replace the LiveKit / ElevenLabs keys or start the call engine's install. The page of the settings tab sends both.
//
//   node packages/kybernos-call/test-write-guard.mjs
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mountCallRoutes, ROUTES } from './call-routes.mjs'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

const here = dirname(fileURLToPath(import.meta.url))
sessionSource.secret = () => SESSION_SECRET

const PORT = 3080
const OWN = '127.0.0.1:' + PORT
const ORIGIN = 'http://' + OWN
const cookie = (opts) => sessionCookie(OWN, opts)

// Nothing may be written, installed or called before the pair is proven: the admin's methods are counters.
const done = { keys: 0, test: 0, clone: 0, preset: 0, avatars: 0, engine: 0 }
const admin = {
  everything: async () => ({ ok: true }),
  patchSettings: async () => ({ ok: true }),
  setKeys: async () => { done.keys += 1; return { ok: true, status: {} } },
  test: async (service) => { done.test += 1; return { ok: service === 'groq', service } },
  cloneSample: async () => { done.clone += 1; return { ok: true } },
  deleteClone: async () => { done.clone += 1; return { ok: true } },
  applyPreset: async () => { done.preset += 1; return { ok: true, settings: {} } },
  avatars: async () => { done.avatars += 1; return { ok: true, avatars: [] } },
  runHealth: async () => ({ ok: true, checks: [] }),
  engine: async () => { done.engine += 1; return { ok: true, state: 'idle' } },
}
const call = {
  status: async () => ({ ok: true, secrets: 'posee' }),
  mint: async () => ({ ok: false, error: 'not used' }),
  agentStart: async () => ({ ok: true }), agentStop: async () => ({ ok: true }), agentState: async () => ({ ok: true }),
  utterance: async () => ({ ok: true }),
}
const routes = new Map()
mountCallRoutes({ register: (r) => { routes.set(r.path, r); return () => {} } }, call, here, (fn) => fn(), null, admin)

const makeReq = (method, headers, body) => {
  const req = Readable.from([Buffer.from(JSON.stringify(body === undefined ? {} : body))])
  req.method = method
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
const run = async (path, headers, body) => {
  const res = makeRes()
  await routes.get(path).handler(makeReq('POST', headers, body), res)
  return { status: res.status, text: res.body }
}

const CASES = [
  [ROUTES.keys, { patch: { LIVEKIT_URL: 'ws://x', ELEVENLABS_API_KEY: 'sk-live' } }],
  [ROUTES.test, { service: 'groq' }],
  [ROUTES.clone, { rootId: 'r', voiceId: 'v', name: 'Claire' }],
  [ROUTES.preset, { id: 'live' }],
  [ROUTES.avatars, {}],
  [ROUTES.engine, { action: 'install' }],
]

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const total = () => Object.values(done).reduce((a, b) => a + b, 0)

console.log('Kybernos call: the writes need the signed session')
for (const [path, body] of CASES) {
  // Nothing is done on a refusal (a key patch, an install, a provider call): the counters must not move.
  const before = total()
  for (const [headers, want, label] of [
    [{}, 403, 'no Origin and no cookie'],
    [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
    [{ origin: ORIGIN }, 401, 'the right Origin and no cookie (what a local program sends)'],
    [{ origin: ORIGIN, cookie: cookie({ secret: OTHER_SECRET }) }, 401, 'the right Origin and a forged cookie'],
  ]) {
    const r = await run(path, headers, body)
    assert.equal(r.status, want, path + ': ' + label + ' -> ' + r.status + ' ' + r.text.slice(0, 90))
  }
  assert.equal(total(), before, path + ': a refused request did nothing (no key written, no install, no provider call)')
  // The person's page: the page's Origin AND the signed cookie.
  const real = await run(path, { origin: ORIGIN, cookie: cookie() }, body)
  assert.notEqual(real.status, 401, path + ': the real pair is not refused as unsigned')
  assert.notEqual(real.status, 403, path + ': the real pair is not refused as foreign')
  ok(path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · nothing done · the real pair answers')
}

// The routes that already had the strict-only rule and were not named by L1-01 keep it (only their writes were in scope).
const token = await run(ROUTES.token, { origin: ORIGIN }, { sessionId: 'session-aaaaaaaa' })
assert.notEqual(token.status, 401, 'token: unchanged (the page asks for the room token; its URL is the secret)')
ok('token keeps the strict same-origin rule it had: the audit only named the routes that write secrets or install')

console.log('\nCALL WRITE GUARD — ' + pass + ' vérification(s), 0 échec')
