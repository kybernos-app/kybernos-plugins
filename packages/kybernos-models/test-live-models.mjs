// « Fetch available models » asks the provider's own endpoint, from the host: where the key may go, what comes back, what is refused.
//
//   node packages/kybernos-models/test-live-models.mjs
import assert from 'node:assert/strict'
import { endpointOk, fetchLive, keyFor, liveModels, listingUrl, pickApi, profileOf, readListing, requestHeaders, resolveTarget, MAX_RESPONSE_BYTES } from './live-models.mjs'
import { kbLiveMount } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, browserHeaders } from './lib-session-test.mjs'
sessionSource.secret = () => SESSION_SECRET // the machine secret the write routes check the session cookie against

let n = 0
const ok = (label, fn) => Promise.resolve(fn()).then(() => { n += 1; console.log('  ✓ ' + label) })
const KEY = 'sk-test-0123456789abcdef'

// A fetch that records the request and answers with a status and a JSON body (or throws).
const fakeFetch = (status, body) => {
  const seen = []
  const f = async (url, init) => {
    seen.push({ url, init })
    if (status instanceof Error) throw status
    const text = typeof body === 'string' ? body : JSON.stringify(body === undefined ? {} : body)
    return new Response(text, { status, headers: { 'content-type': 'application/json' } })
  }
  return { f, seen }
}

// ── pure parts ──
await ok('the list address is the engine\'s own reading: a prefix for OpenAI protocols, the root + /v1 for Anthropic', () => {
  assert.equal(listingUrl('https://opencode.ai/zen/go/v1', 'openai-completions'), 'https://opencode.ai/zen/go/v1/models')
  assert.equal(listingUrl('https://gateway.example/openai/v1/', 'openai-responses'), 'https://gateway.example/openai/v1/models')
  assert.equal(listingUrl('https://api.anthropic.com/v1', 'anthropic-messages'), 'https://api.anthropic.com/v1/models?limit=1000')
  assert.equal(listingUrl('https://api.anthropic.com', 'anthropic-messages'), 'https://api.anthropic.com/v1/models?limit=1000')
})

await ok('the protocol is the one named, else Anthropic\'s for Anthropic\'s host, else OpenAI-compatible', () => {
  assert.equal(pickApi('openai-responses', 'https://x.example/v1'), 'openai-responses')
  assert.equal(pickApi(undefined, 'https://api.anthropic.com/v1'), 'anthropic-messages')
  assert.equal(pickApi('', 'https://opencode.ai/zen/go/v1'), 'openai-completions')
})

await ok('an address must be https, or http on this machine, with no credentials in it', () => {
  for (const good of ['https://opencode.ai/zen/go/v1', 'http://127.0.0.1:11434/v1', 'http://localhost:8080', 'http://[::1]:9000/v1']) assert.equal(endpointOk(good), true, good)
  for (const bad of ['http://opencode.ai/v1', 'http://192.168.1.4:8000', 'https://user:pw@host.example/v1', 'ftp://host.example', 'file:///etc/passwd', 'javascript:alert(1)', '', 'not a url', 'https://host.example/v1#frag']) assert.equal(endpointOk(bad), false, bad)
})

await ok('a listing is read as the `data` array or the `models` map; a bad entry is skipped; a duplicate keeps its first', () => {
  const a = readListing({ data: [{ id: 'm1', name: 'One', context_length: 128000, max_output_tokens: 8000 }, { id: 'm1', name: 'Dup' }, { name: 'no id' }, 7, { id: 'm2' }] })
  assert.deepEqual(a, [{ id: 'm1', name: 'One', contextWindow: 128000, maxTokens: 8000 }, { id: 'm2', name: 'm2' }])
  const b = readListing({ models: { 'k-1': { id: 'canonical', display_name: 'Key one', limit: { context: 1000000, output: 64000 } }, junk: 'x', 'k-2': { top_provider: { max_completion_tokens: 4096 } } } })
  assert.deepEqual(b, [{ id: 'k-1', name: 'Key one', contextWindow: 1000000, maxTokens: 64000 }, { id: 'k-2', name: 'k-2', maxTokens: 4096 }])
  assert.deepEqual(readListing({ data: [{ id: 'v', architecture: { input_modalities: ['text', 'image', 'audio', 'text'] } }] }), [{ id: 'v', name: 'v', inputModalities: ['text', 'image'] }])
  assert.deepEqual(readListing({ data: [] }), [])
  for (const bad of [null, [], 'x', 3, {}, { data: 'nope' }, { models: [] }]) assert.equal(readListing(bad), null, JSON.stringify(bad))
})

await ok('the headers: Bearer for OpenAI protocols, x-api-key + version for Anthropic, and a profile header never replaces the key', () => {
  assert.deepEqual(requestHeaders('openai-completions', KEY, null), { accept: 'application/json', authorization: 'Bearer ' + KEY })
  assert.deepEqual(requestHeaders('anthropic-messages', KEY, null), { accept: 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': KEY })
  assert.equal(requestHeaders('openai-completions', KEY, { Authorization: 'Bearer other', 'X-Team': 'a' }).authorization, 'Bearer ' + KEY)
  assert.equal(requestHeaders('openai-completions', KEY, { 'X-Team': 'a' })['x-team'], 'a')
  assert.deepEqual(requestHeaders('openai-completions', '', null), { accept: 'application/json' })
  assert.equal(requestHeaders('openai-completions', KEY, { 'bad name': 'x', n: 5 })['bad name'], undefined)
})

// ── where to ask ──
const OPENCODE_ENTRY = { id: 'opencode-go', env: 'OPENCODE_API_KEY', url: 'https://opencode.ai/zen/go/v1' }
const OPENCODE_PROFILE = { apiKeyEnv: 'OPENCODE_GO_API_KEY', models: [{ id: 'hy3' }] } // as saved by the page: a key reference and models, no address

await ok('a catalog route saved with no address is asked at the catalogue\'s address, with the key its profile names', () => {
  const t = resolveTarget({ route: 'opencode-go' }, OPENCODE_PROFILE, OPENCODE_ENTRY)
  assert.deepEqual(t, { ok: true, baseURL: 'https://opencode.ai/zen/go/v1', api: 'openai-completions', keyRef: 'OPENCODE_GO_API_KEY', typedKey: null, headers: null })
})

await ok('the profile\'s address, protocol and key reference win over the catalogue\'s', () => {
  const t = resolveTarget({ route: 'x' }, { baseURL: 'https://gw.example/v1', api: 'openai-responses', apiKeyEnv: 'GW_KEY', headers: { 'x-team': 'a' } }, OPENCODE_ENTRY)
  assert.deepEqual(t, { ok: true, baseURL: 'https://gw.example/v1', api: 'openai-responses', keyRef: 'GW_KEY', typedKey: null, headers: { 'x-team': 'a' } })
})

await ok('with no profile the catalogue\'s own key reference is used; a name that is not a reference is dropped', () => {
  assert.equal(resolveTarget({ route: 'opencode-go' }, null, OPENCODE_ENTRY).keyRef, 'OPENCODE_API_KEY')
  assert.equal(resolveTarget({ route: 'x' }, { baseURL: 'https://gw.example/v1', apiKeyEnv: 'has space; rm -rf' }, null).keyRef, null)
})

await ok('an address typed by the page is followed only with a key typed beside it; alone, it is not (the saved key must not follow it)', () => {
  const both = resolveTarget({ route: 'opencode-go', baseURL: 'https://other.example/v1', key: KEY, api: 'openai-responses' }, OPENCODE_PROFILE, OPENCODE_ENTRY)
  assert.deepEqual([both.ok, both.baseURL, both.api, both.typedKey], [true, 'https://other.example/v1', 'openai-responses', KEY])
  assert.deepEqual(resolveTarget({ route: 'opencode-go', baseURL: 'https://other.example/v1' }, OPENCODE_PROFILE, OPENCODE_ENTRY), { ok: false, error: 'foreign-endpoint' })
  // the saved address, retyped as it is, is the saved address
  assert.equal(resolveTarget({ route: 'opencode-go', baseURL: 'https://opencode.ai/zen/go/v1/' }, OPENCODE_PROFILE, OPENCODE_ENTRY).baseURL, 'https://opencode.ai/zen/go/v1')
  // a typed key alone goes to the saved address
  assert.equal(resolveTarget({ route: 'opencode-go', key: KEY }, OPENCODE_PROFILE, OPENCODE_ENTRY).baseURL, 'https://opencode.ai/zen/go/v1')
})

await ok('no address known, a refused address, an unreadable protocol, a malformed key: each is said before any request', () => {
  assert.deepEqual(resolveTarget({ route: 'mine' }, { apiKeyEnv: 'K' }, null), { ok: false, error: 'no-endpoint' })
  assert.deepEqual(resolveTarget({ route: 'mine' }, { baseURL: 'http://evil.example/v1' }, null), { ok: false, error: 'bad-endpoint' })
  assert.deepEqual(resolveTarget({ route: 'mine' }, { baseURL: 'https://gw.example/v1', api: 'google-generative-ai' }, null), { ok: false, error: 'unsupported-protocol' })
  assert.deepEqual(resolveTarget({ route: 'mine', key: 'short' }, { baseURL: 'https://gw.example/v1' }, null), { ok: false, error: 'bad-key' })
})

await ok('the profile is read through the settings service whichever way it words its answer; a broken service reads as no profile', async () => {
  const ns = { ns: 'llm-pi-ai', value: { providers: { a: { apiKeyEnv: 'A_KEY' } } } }
  assert.deepEqual(await profileOf({ describe: async () => [ns, { ns: 'other', value: {} }] }, 'a'), { apiKeyEnv: 'A_KEY' })
  assert.deepEqual(await profileOf({ describe: async () => ({ ok: true, value: { namespaces: [ns] } }) }, 'a'), { apiKeyEnv: 'A_KEY' })
  assert.equal(await profileOf({ describe: async () => [ns] }, 'b'), null)
  assert.equal(await profileOf({ describe: async () => { throw new Error('down') } }, 'a'), null)
  assert.equal(await profileOf(undefined, 'a'), null)
})

await ok('the key is the credentials service\'s value for a reference; nothing usable reads as no key', async () => {
  assert.equal(await keyFor({ resolve: async (r) => (r === 'A_KEY' ? { value: ' ' + KEY + ' ', source: 'env' } : undefined) }, 'A_KEY'), KEY)
  assert.equal(await keyFor({ resolve: async () => undefined }, 'A_KEY'), null)
  assert.equal(await keyFor({ resolve: async () => ({ value: 'has space in it' }) }, 'A_KEY'), null)
  assert.equal(await keyFor({ resolve: async () => { throw new Error('locked') } }, 'A_KEY'), null)
  assert.equal(await keyFor({ resolve: async () => ({ value: KEY }) }, null), null)
  assert.equal(await keyFor(undefined, 'A_KEY'), null)
})

// ── the request itself ──
await ok('the request is one GET, with no redirect followed and a timeout', async () => {
  const { f, seen } = fakeFetch(200, { data: [{ id: 'm1' }] })
  const r = await fetchLive({ baseURL: 'https://opencode.ai/zen/go/v1', api: 'openai-completions', key: KEY, fetch: f })
  assert.deepEqual(r, { ok: true, models: [{ id: 'm1', name: 'm1' }], url: 'https://opencode.ai/zen/go/v1/models' })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].init.method, 'GET')
  assert.equal(seen[0].init.redirect, 'error')
  assert.ok(seen[0].init.signal !== undefined)
})

await ok('a refusal is said with the provider\'s own words and its status; a network failure and a redirect are « unreachable »', async () => {
  const a = await fetchLive({ baseURL: 'https://api.anthropic.com/v1', api: 'anthropic-messages', key: KEY, fetch: fakeFetch(400, { type: 'error', error: { type: 'invalid_request_error', message: 'This API key is not scoped to a workspace.' } }).f })
  assert.deepEqual(a, { ok: false, error: 'refused', status: 400, detail: 'This API key is not scoped to a workspace.' })
  const b = await fetchLive({ baseURL: 'https://x.example/v1', api: 'openai-completions', key: KEY, fetch: fakeFetch(401, 'plain text').f })
  assert.deepEqual(b, { ok: false, error: 'refused', status: 401, detail: '' })
  assert.deepEqual(await fetchLive({ baseURL: 'https://x.example/v1', api: 'openai-completions', key: KEY, fetch: fakeFetch(new Error('ECONNREFUSED')).f }), { ok: false, error: 'unreachable' })
  assert.deepEqual(await fetchLive({ baseURL: 'https://x.example/v1', api: 'openai-completions', key: KEY, fetch: fakeFetch(new TypeError('redirect mode is set to error')).f }), { ok: false, error: 'unreachable' })
})

await ok('a reply that is not JSON, not a model list, or larger than the ceiling is refused, not parsed', async () => {
  assert.deepEqual(await fetchLive({ baseURL: 'https://x.example/v1', api: 'openai-completions', key: KEY, fetch: fakeFetch(200, '<html>login</html>').f }), { ok: false, error: 'bad-reply' })
  assert.deepEqual(await fetchLive({ baseURL: 'https://x.example/v1', api: 'openai-completions', key: KEY, fetch: fakeFetch(200, { hello: 'world' }).f }), { ok: false, error: 'bad-reply' })
  const huge = '{"data":[' + '{"id":"a"},'.repeat(Math.ceil(MAX_RESPONSE_BYTES / 10) + 10) + '{"id":"z"}]}'
  assert.deepEqual(await fetchLive({ baseURL: 'https://x.example/v1', api: 'openai-completions', key: KEY, fetch: fakeFetch(200, huge).f }), { ok: false, error: 'too-big' })
})

// ── the whole answer: the two providers of the report ──
const opencodeGo = Array.from({ length: 29 }, (_, i) => ({ id: 'model-' + String(i + 1), name: 'Model ' + String(i + 1) }))
const services = (extra = {}) => ({
  settings: { describe: async () => [{ ns: 'llm-pi-ai', value: { providers: { 'opencode-go': OPENCODE_PROFILE, anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY', models: [{ id: 'claude-opus-5-5' }] } } } }] },
  credentials: { resolve: async (ref) => ({ ref, value: KEY, source: 'store' }) },
  ...extra,
})

await ok('opencode-go: the whole live list (29, not the 18 of one protocol) is asked at the catalogue\'s address with the stored key', async () => {
  const { f, seen } = fakeFetch(200, { object: 'list', data: opencodeGo })
  const r = await liveModels({ route: 'opencode-go' }, { ...services(), entry: OPENCODE_ENTRY, fetch: f })
  assert.equal(r.ok, true)
  assert.equal(r.models.length, 29)
  assert.equal(seen[0].url, 'https://opencode.ai/zen/go/v1/models')
  assert.equal(seen[0].init.headers.authorization, 'Bearer ' + KEY)
})

await ok('anthropic: asked at its own root with x-api-key and the version, and its refusal comes back in its own words', async () => {
  const { f, seen } = fakeFetch(400, { error: { message: 'This API key is not scoped to a workspace' } })
  const r = await liveModels({ route: 'anthropic' }, { ...services(), entry: { id: 'anthropic', env: 'ANTHROPIC_API_KEY', url: 'https://api.anthropic.com/v1' }, fetch: f })
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/models?limit=1000')
  assert.equal(seen[0].init.headers['x-api-key'], KEY)
  assert.equal(seen[0].init.headers['anthropic-version'], '2023-06-01')
  assert.deepEqual(r, { ok: false, error: 'refused', status: 400, detail: 'This API key is not scoped to a workspace' })
})

await ok('a key typed in the form is the one used; with no key anywhere the list is still asked, with no auth header', async () => {
  const typed = 'sk-typed-9999999999'
  const a = fakeFetch(200, { data: [] })
  await liveModels({ route: 'opencode-go', key: typed }, { ...services(), entry: OPENCODE_ENTRY, fetch: a.f })
  assert.equal(a.seen[0].init.headers.authorization, 'Bearer ' + typed)
  const b = fakeFetch(401, {})
  const r = await liveModels({ route: 'opencode-go' }, { settings: services().settings, entry: OPENCODE_ENTRY, fetch: b.f })
  assert.equal(b.seen[0].init.headers.authorization, undefined)
  assert.equal(r.status, 401)
})

await ok('the answer never carries the key', async () => {
  const body = JSON.stringify(await liveModels({ route: 'opencode-go', key: KEY }, { ...services(), entry: OPENCODE_ENTRY, fetch: fakeFetch(200, { data: opencodeGo }).f }))
  assert.ok(!body.includes(KEY))
  const refused = JSON.stringify(await liveModels({ route: 'opencode-go' }, { ...services(), entry: OPENCODE_ENTRY, fetch: fakeFetch(401, { error: { message: 'bad' } }).f }))
  assert.ok(!refused.includes(KEY))
})

await ok('a route that is not a slug is refused before anything is read', async () => {
  const { f, seen } = fakeFetch(200, {})
  for (const bad of ['', '../x', 'a b', '__proto__/x', 'x'.repeat(80), 12, null, undefined]) assert.deepEqual(await liveModels({ route: bad }, { ...services(), fetch: f }), { ok: false, error: 'bad-route' }, JSON.stringify(bad))
  assert.equal(seen.length, 0)
})

// ── the route ──
const mount = (svc, options) => {
  const routes = new Map()
  kbLiveMount((r) => routes.set(r.path, r.handler), () => svc, options)
  return routes.get('/kybernos-models/models/live')
}
const call = async (handler, { method = 'POST', origin = 'http://127.0.0.1:3080', body = {}, headers } = {}) => {
  const req = {
    method,
    headers: headers !== undefined ? headers : (origin === null ? {} : (origin === 'http://127.0.0.1:3080' ? browserHeaders() : { origin, cookie: browserHeaders().cookie })),
    socket: { localPort: 3080 },
    on(ev, cb) { if (ev === 'data') setTimeout(() => cb(JSON.stringify(body)), 0); if (ev === 'end') setTimeout(cb, 1) },
  }
  let status = 0
  let text = ''
  const res = { writeHead(s) { status = s }, end(t) { text = t } }
  await handler(req, res)
  return { status, json: text === '' ? null : JSON.parse(text) }
}

await ok('the route answers the list to a same-origin POST, with its source and no key', async () => {
  const { f } = fakeFetch(200, { data: opencodeGo })
  const r = await call(mount(services(), { fetch: f }), { body: { route: 'opencode-go' } })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.source, 'live')
  assert.equal(r.json.url, 'https://opencode.ai/zen/go/v1/models')
  assert.equal(r.json.models.length, 29)
  assert.ok(!JSON.stringify(r.json).includes(KEY))
})

await ok('the route refuses a foreign origin, a missing origin, a missing session and any other method: no request leaves the machine', async () => {
  const { f, seen } = fakeFetch(200, { data: [] })
  const h = mount(services(), { fetch: f })
  assert.equal((await call(h, { origin: 'https://evil.example', body: { route: 'opencode-go' } })).status, 403)
  assert.equal((await call(h, { origin: null, body: { route: 'opencode-go' } })).status, 403)
  assert.equal((await call(h, { headers: { origin: 'http://127.0.0.1:3080' }, body: { route: 'opencode-go' } })).status, 401, 'the right Origin and no session cookie')
  assert.equal((await call(h, { method: 'GET' })).status, 405)
  assert.equal(seen.length, 0)
})

await ok('the route says why there is no live list: a refusal is a 200 the page reads, a caller mistake is a 400', async () => {
  const h = mount(services(), { fetch: fakeFetch(401, {}).f })
  const refused = await call(h, { body: { route: 'opencode-go' } })
  assert.equal(refused.status, 200)
  assert.deepEqual([refused.json.ok, refused.json.error, refused.json.status], [false, 'refused', 401])
  assert.equal((await call(h, { body: { route: '../x' } })).status, 400)
  assert.equal((await call(h, { body: { route: 'opencode-go', key: 'x' } })).status, 400)
  const none = await call(mount({}, { fetch: fakeFetch(200, {}).f }), { body: { route: 'unknown-route' } })
  assert.deepEqual([none.status, none.json.error], [200, 'no-endpoint'])
})

await ok('a host with no settings or credentials service still answers (the route is read, the key is simply absent)', async () => {
  const r = await call(mount({}, { fetch: fakeFetch(200, { data: [{ id: 'm1' }] }).f }), { body: { route: 'opencode-go' } })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
})

console.log(n + ' checks passed')
