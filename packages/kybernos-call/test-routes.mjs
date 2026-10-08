// kybernos-call: the HTTP routes and the host entry (index.js) with a fake web server.
//
//   node packages/kybernos-call/test-routes.mjs
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mountCallRoutes, ROUTES, sameOriginStrict, readJsonBody } from './call-routes.mjs'
import { createSpeechFeed } from './speech-feed.mjs'
import { apply, name } from './index.js'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))

// A request: method, headers, socket port, and a JSON body.
const makeReq = (method, { origin, referer, port = 3080, body } = {}) => {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
  const req = Readable.from(chunks)
  req.method = method
  req.headers = {}
  if (origin !== undefined) req.headers.origin = origin
  if (referer !== undefined) req.headers.referer = referer
  req.socket = { localPort: port }
  return req
}
const makeRes = () => {
  const res = { status: null, headers: null, body: '' }
  res.writeHead = (s, h) => { res.status = s; res.headers = h }
  res.end = (b) => { res.body = b === undefined ? '' : b; res.done = true }
  return res
}
const json = (res) => JSON.parse(res.body)

console.log('kybernos-call: origin check')
assert.equal(sameOriginStrict(makeReq('POST', { origin: 'http://127.0.0.1:3080' })), true)
assert.equal(sameOriginStrict(makeReq('POST', { origin: 'http://localhost:3080' })), true)
assert.equal(sameOriginStrict(makeReq('POST', { origin: 'http://[::1]:3080' })), true)
assert.equal(sameOriginStrict(makeReq('POST', { referer: 'http://127.0.0.1:3080/some/page' })), true)
ok('the page\'s own origin (Origin, or Referer as a fallback) passes')
assert.equal(sameOriginStrict(makeReq('POST')), false)
assert.equal(sameOriginStrict(makeReq('POST', { origin: 'https://evil.example' })), false)
assert.equal(sameOriginStrict(makeReq('POST', { origin: 'http://127.0.0.1:9999' })), false)
assert.equal(sameOriginStrict(makeReq('POST', { origin: 'file:///etc/passwd' })), false)
assert.equal(sameOriginStrict(makeReq('POST', { origin: 'not a url' })), false)
ok('no Origin, another host, another port, a non-http scheme and garbage are all refused')
const forged = makeReq('POST', { origin: 'http://attacker.example:3080' })
forged.headers.host = '127.0.0.1:3080'
assert.equal(sameOriginStrict(forged), false)
ok('a forged Host header does not help: the origin is compared to the socket\'s real port')

console.log('kybernos-call: body reader')
assert.deepEqual(await readJsonBody(makeReq('POST', { body: { a: 1 } })), { a: 1 })
assert.deepEqual(await readJsonBody(makeReq('POST')), {})
assert.deepEqual(await readJsonBody(makeReq('POST', { body: 'not json' })), {})
await assert.rejects(readJsonBody(makeReq('POST', { body: 'x'.repeat(70000) })), /too large/)
ok('a body is parsed, an empty or invalid one is {}, an over-large one is refused (64 KB)')

console.log('kybernos-call: routes')
const registered = new Map()
const effects = []
const webServer = { register: (r) => { registered.set(r.path, r); return () => registered.delete(r.path) } }
const fakeCall = {
  statusCalls: 0,
  status: async () => { fakeCall.statusCalls += 1; return { ok: true, secrets: 'posee' } },
  mint: async (b) => (b && b.fail ? { ok: false, error: 'LiveKit secrets missing' } : { ok: true, room: 'r', body: b }),
  agentStart: async (b) => ({ ok: true, started: true, body: b }),
  agentStop: async () => ({ ok: true, stopped: 1 }),
  agentState: async () => ({ ok: true, running: false }),
  utterance: async (b) => (b && b.text === 'bad' ? { ok: false, error: 'unknown session' } : { ok: true, accepted: true })
}
const feed = createSpeechFeed()
mountCallRoutes(webServer, fakeCall, here, (fn, label) => { effects.push(label); return fn() }, feed)
assert.deepEqual([...registered.keys()].sort(), Object.values(ROUTES).sort())
assert.equal(effects.length, 6)
for (const path of registered.keys()) assert.match(path, /^\/kybernos-call\//)
ok('six routes, all under /kybernos-call/, each registered through the plugin\'s effect')
const bare = new Map()
mountCallRoutes({ register: (r) => { bare.set(r.path, r); return () => {} } }, fakeCall, here, (fn) => fn())
assert.equal(bare.size, 5)
assert.equal(bare.has(ROUTES.speech), false)
ok('without a session event source there is no speech route (a call keeps the worker\'s own voice model)')
const run = async (path, req) => { const res = makeRes(); await registered.get(path).handler(req, res); return res }

let res = await run(ROUTES.status, makeReq('GET'))
assert.equal(res.status, 200)
assert.deepEqual(json(res), { ok: true, secrets: 'posee' })
res = await run(ROUTES.status, makeReq('POST'))
assert.equal(res.status, 405)
ok('status: GET answers, other methods get 405, and it needs no origin (it holds no secret)')

for (const path of [ROUTES.token, ROUTES.agent, ROUTES.utterance]) {
  res = await run(path, makeReq('GET'))
  assert.equal(res.status, 405, path)
  res = await run(path, makeReq('POST', { body: {} }))
  assert.equal(res.status, 403, path)
  assert.equal(json(res).error, 'origin refused')
  res = await run(path, makeReq('POST', { origin: 'https://evil.example', body: {} }))
  assert.equal(res.status, 403, path)
}
ok('token, agent, utterance: GET → 405, no or foreign origin → 403 (before anything is read or done)')

const same = { origin: 'http://127.0.0.1:3080' }
res = await run(ROUTES.token, makeReq('POST', { ...same, body: { sessionId: 'session-aaaaaaaa' } }))
assert.equal(res.status, 200)
assert.equal(json(res).body.sessionId, 'session-aaaaaaaa')
res = await run(ROUTES.token, makeReq('POST', { ...same, body: { fail: true } }))
assert.equal(res.status, 503)
res = await run(ROUTES.token, makeReq('POST', { ...same, body: 'x'.repeat(70000) }))
assert.equal(res.status, 400)
ok('token: 200 with the minted answer, 503 when it cannot mint, 400 on an over-large body')

for (const [action, expected] of [['start', 'started'], ['stop', 'stopped'], ['status', 'running']]) {
  res = await run(ROUTES.agent, makeReq('POST', { ...same, body: { action } }))
  assert.equal(res.status, 200)
  assert.ok(expected in json(res), action)
}
res = await run(ROUTES.agent, makeReq('POST', { ...same, body: {} }))
assert.equal(res.status, 200)
assert.ok('running' in json(res))
res = await run(ROUTES.agent, makeReq('POST', { ...same, body: { action: 'format-disk' } }))
assert.equal(res.status, 400)
ok('agent: start / stop / status, "status" by default, an unknown action is 400')

res = await run(ROUTES.utterance, makeReq('POST', { ...same, body: { sessionId: 'session-aaaaaaaa', text: 'hi' } }))
assert.equal(res.status, 200)
res = await run(ROUTES.utterance, makeReq('POST', { ...same, body: { text: 'bad' } }))
assert.equal(res.status, 400)
ok('utterance: 200 when accepted, 400 when the host refuses it')

console.log('kybernos-call: the speech route')
feed.register('room-speak', 'session-aaaaaaaa')
feed.ingest('session-aaaaaaaa', { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Hello from the session.' }] } } })
const withUrl = (path, query, req) => { req.url = path + '?' + query; return req }
res = await run(ROUTES.speech, makeReq('POST'))
assert.equal(res.status, 405)
res = await run(ROUTES.speech, withUrl(ROUTES.speech, 'room=room-speak', makeReq('GET')))
assert.equal(res.status, 403)
res = await run(ROUTES.speech, withUrl(ROUTES.speech, 'room=room-speak', makeReq('GET', { origin: 'https://evil.example' })))
assert.equal(res.status, 403)
ok('speech: it is the session\'s own text, so GET needs the same origin too (no origin or a foreign one is 403)')
res = await run(ROUTES.speech, withUrl(ROUTES.speech, 'room=room-speak&after=0&wait=0', makeReq('GET', same)))
assert.equal(res.status, 200)
assert.deepEqual(json(res).items, [{ seq: 1, kind: 'text', text: 'Hello from the session.' }])
res = await run(ROUTES.speech, withUrl(ROUTES.speech, 'room=room-speak&after=1&wait=0', makeReq('GET', same)))
assert.deepEqual(json(res).items, [])
res = await run(ROUTES.speech, withUrl(ROUTES.speech, 'room=unknown-room&wait=0', makeReq('GET', same)))
assert.equal(json(res).known, false)
ok('speech: the items after "after", an empty list when nothing is new, known:false for a room the host does not follow')
for (const bad of ['', 'room=a', 'room=has space!', 'room=' + 'x'.repeat(65)]) {
  res = await run(ROUTES.speech, withUrl(ROUTES.speech, bad, makeReq('GET', same)))
  assert.equal(res.status, 400, bad)
}
ok('speech: a missing or malformed room is 400')
const longPoll = run(ROUTES.speech, withUrl(ROUTES.speech, 'room=room-speak&after=1&wait=5000', makeReq('GET', same)))
await new Promise((resolve) => setTimeout(resolve, 40))
feed.ingest('session-aaaaaaaa', { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'And more.' }] } } })
res = await longPoll
assert.deepEqual(json(res).items.map((i) => i.text), ['And more.'])
ok('speech: a long poll answers as soon as the assistant writes')

res = await run(ROUTES.vendor, makeReq('GET'))
assert.equal(res.status, 200)
assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8')
assert.ok(Buffer.isBuffer(res.body) && res.body.length > 100000)
assert.ok(String(res.body.subarray(0, 4000)).length > 0)
res = await run(ROUTES.vendor, makeReq('HEAD'))
assert.equal(res.status, 200)
assert.equal(res.body, '')
res = await run(ROUTES.vendor, makeReq('POST'))
assert.equal(res.status, 405)
ok('vendor: the SDK is served on GET (a real, large file), HEAD has no body, POST is 405')

console.log('kybernos-call: host entry')
assert.equal(name, 'kybernos-call')
const logs = []
const origLog = console.log
console.log = (...a) => { logs.push(a.join(' ')) }
try {
  // webServer already there
  const effects1 = []
  const reg1 = new Map()
  apply({ get: (n) => (n === 'webServer' ? { register: (r) => { reg1.set(r.path, r); return () => {} } } : undefined), inject: () => { throw new Error('should not inject') }, effect: (fn, l) => { effects1.push(l); return fn() } })
  // webServer arrives later
  const reg2 = new Map()
  let injected = null
  apply({ get: () => undefined, inject: (list, cb) => { injected = list; cb({ webServer: { register: (r) => { reg2.set(r.path, r); return () => {} } } }) }, effect: (fn) => fn() })
  // with the session event source: the speech route, fed by the events
  const handlers = new Map()
  const reg3 = new Map()
  apply({ get: (n) => (n === 'webServer' ? { register: (r) => { reg3.set(r.path, r); return () => {} } } : undefined), inject: () => {}, effect: (fn) => fn(), on: (event, fn) => { handlers.set(event, fn); return () => {} } })
  assert.equal(reg3.size, 6)
  assert.equal(typeof handlers.get('session/event'), 'function')
  // a broken event source must not stop it
  const reg4 = new Map()
  apply({ get: (n) => (n === 'webServer' ? { register: (r) => { reg4.set(r.path, r); return () => {} } } : undefined), inject: () => {}, effect: (fn) => fn(), on: () => { throw new Error('no events here') } })
  assert.equal(reg4.size, 5)
  // a broken context must not throw
  apply(undefined)
  apply({ get: () => { throw new Error('boom') } })
  console.log = origLog
  assert.equal(reg1.size, 5)
  assert.equal(reg1.has(ROUTES.speech), false)
  assert.deepEqual(injected, ['webServer'])
  assert.equal(reg2.size, 5)
  ok('apply mounts the five routes when the web server is there, or as soon as it is injected')
  ok('with the session event source apply also mounts the speech route and listens to session/event; if listening fails it still mounts the rest')
  ok('apply never throws, even with a missing or broken context (a bundle must never stop DSH from starting)')
  assert.ok(logs.some((l) => /disabled/.test(l)))
  ok('and it says it is disabled instead of staying silent')
} finally {
  console.log = origLog
}
console.log('\nkybernos-call routes: ' + pass + ' checks')
