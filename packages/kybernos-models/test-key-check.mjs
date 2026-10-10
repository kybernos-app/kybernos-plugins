// The wizard's key check: where a key may go, what comes back, what is refused.
//
//   node packages/kybernos-models/test-key-check.mjs
import assert from 'node:assert/strict'
import { checkKey, KEY_PROVIDERS } from './key-check.mjs'
import { kbKeyMount } from './index.js'

let n = 0
const ok = (label, fn) => Promise.resolve(fn()).then(() => { n += 1; console.log('  ✓ ' + label) })
const KEY = 'sk-test-0123456789abcdef'

// A fetch that records the request and answers with a status (or throws).
const fakeFetch = (answer) => {
  const seen = []
  const f = async (url, init) => {
    seen.push({ url, init })
    if (answer instanceof Error) throw answer
    return { status: answer, body: { cancel: async () => {} } }
  }
  return { f, seen }
}

await ok('only the four providers of the wizard exist', () => assert.deepEqual(KEY_PROVIDERS.slice().sort(), ['anthropic', 'deepseek', 'google', 'openai']))

await ok('each key goes to its own provider\'s address, with the right header, as a GET', async () => {
  const want = {
    anthropic: ['https://api.anthropic.com/v1/models', 'x-api-key'],
    openai: ['https://api.openai.com/v1/models', 'authorization'],
    deepseek: ['https://api.deepseek.com/models', 'authorization'],
    google: ['https://generativelanguage.googleapis.com/v1beta/openai/models', 'authorization'],
  }
  for (const p of KEY_PROVIDERS) {
    const { f, seen } = fakeFetch(200)
    const r = await checkKey(p, KEY, { fetch: f })
    assert.equal(r.result, 'ok', p)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].url, want[p][0])
    assert.equal(seen[0].init.method, 'GET')
    assert.ok(seen[0].init.headers[want[p][1]].includes(KEY), p + ' header carries the key')
  }
})

await ok('a redirect is refused and a timeout is set', async () => {
  const { f, seen } = fakeFetch(200)
  await checkKey('openai', KEY, { fetch: f })
  assert.equal(seen[0].init.redirect, 'error')
  assert.ok(seen[0].init.signal !== undefined)
})

await ok('the verdict is one word', async () => {
  const table = [[200, 'ok'], [204, 'ok'], [401, 'invalid'], [403, 'denied'], [429, 'rate_limited'], [500, 'unexpected'], [404, 'unexpected']]
  for (const [status, word] of table) assert.equal((await checkKey('openai', KEY, { fetch: fakeFetch(status).f })).result, word, String(status))
})

await ok('Google answers 400 for a key that is not valid', async () => {
  assert.equal((await checkKey('google', KEY, { fetch: fakeFetch(400).f })).result, 'invalid')
  assert.equal((await checkKey('openai', KEY, { fetch: fakeFetch(400).f })).result, 'unexpected')
})

await ok('a network failure or a redirect error is « unreachable », not a crash', async () => {
  assert.equal((await checkKey('anthropic', KEY, { fetch: fakeFetch(new Error('ECONNREFUSED')).f })).result, 'unreachable')
  assert.equal((await checkKey('anthropic', KEY, { fetch: fakeFetch(new TypeError('redirect mode is set to error')).f })).result, 'unreachable')
})

await ok('nothing of the key or of the answer comes back', async () => {
  const r = await checkKey('openai', KEY, { fetch: fakeFetch(401).f })
  assert.ok(!JSON.stringify(r).includes(KEY))
  assert.deepEqual(Object.keys(r).sort(), ['http', 'ok', 'result'])
})

await ok('an unknown provider and a malformed key are refused before any request', async () => {
  const { f, seen } = fakeFetch(200)
  assert.deepEqual(await checkKey('mistral', KEY, { fetch: f }), { ok: false, error: 'unknown-provider' })
  assert.deepEqual(await checkKey('__proto__', KEY, { fetch: f }), { ok: false, error: 'unknown-provider' })
  assert.deepEqual(await checkKey('constructor', KEY, { fetch: f }), { ok: false, error: 'unknown-provider' })
  for (const bad of ['', 'short', 'has space in it 12345678', 'tab\tkey-0123456789', 'new\nline-0123456789', 'é-0123456789abc', 'x'.repeat(401), 12345, null, undefined, {}]) {
    assert.deepEqual(await checkKey('openai', bad, { fetch: f }), { ok: false, error: 'bad-key' }, JSON.stringify(bad))
  }
  assert.equal(seen.length, 0)
})

await ok('the surrounding whitespace of a paste is trimmed, not sent', async () => {
  const { f, seen } = fakeFetch(200)
  await checkKey('openai', '  ' + KEY + '\n', { fetch: f })
  assert.equal(seen[0].init.headers.authorization, 'Bearer ' + KEY)
})

// ── the route ──
const mount = (options) => {
  const routes = new Map()
  kbKeyMount((r) => routes.set(r.path, r.handler), options)
  return routes.get('/kybernos-models/key/check')
}
const call = async (handler, { method = 'POST', origin = 'http://127.0.0.1:3080', body = {} } = {}) => {
  const req = {
    method,
    headers: origin === null ? {} : { origin },
    socket: { localPort: 3080 },
    on(ev, cb) { if (ev === 'data') setTimeout(() => cb(JSON.stringify(body)), 0); if (ev === 'end') setTimeout(cb, 1) },
  }
  let status = 0
  let text = ''
  const res = { writeHead(s) { status = s }, end(t) { text = t } }
  await handler(req, res)
  return { status, json: text === '' ? null : JSON.parse(text) }
}

await ok('the route answers one word to a same-origin POST', async () => {
  const handler = mount({ fetch: fakeFetch(200).f })
  const r = await call(handler, { body: { provider: 'openai', key: KEY } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, { ok: true, result: 'ok' })
})

await ok('the route refuses a foreign origin, a missing origin and any other method', async () => {
  const { f, seen } = fakeFetch(200)
  const handler = mount({ fetch: f })
  assert.equal((await call(handler, { origin: 'https://evil.example', body: { provider: 'openai', key: KEY } })).status, 403)
  assert.equal((await call(handler, { origin: null, body: { provider: 'openai', key: KEY } })).status, 403)
  assert.equal((await call(handler, { method: 'GET' })).status, 405)
  assert.equal(seen.length, 0, 'no request left the machine')
})

await ok('the route says why an unknown provider or a malformed key is refused', async () => {
  const handler = mount({ fetch: fakeFetch(200).f })
  assert.deepEqual((await call(handler, { body: { provider: 'nope', key: KEY } })).json, { ok: false, error: 'unknown-provider' })
  const bad = await call(handler, { body: { provider: 'openai', key: 'x' } })
  assert.equal(bad.status, 400)
  assert.deepEqual(bad.json, { ok: false, error: 'bad-key' })
})

console.log(n + ' checks passed')
