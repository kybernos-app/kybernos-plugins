// The probe of audio models (audio-probe.mjs): which way of asking a provider works. Fakes only: no provider is contacted.
import assert from 'node:assert/strict'
import { providerBase } from './audio-models.mjs'
import { createProbe, nativeBase, realtimeUrls, silentWav } from './audio-probe.mjs'

let n = 0
const ok = (label) => { n += 1; console.log('  ✓ ' + label) }
const KEY = 'sk-secret-key-do-not-leak'
const reply = (status, type, body) => ({ status, headers: { get: () => type }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), arrayBuffer: async () => new ArrayBuffer(8) })
const table = (rules) => { const seen = []; return { seen, fetch: async (url, init) => { seen.push({ url: String(url), init }); for (const [match, answer] of rules) if (String(url).includes(match)) return typeof answer === 'function' ? answer(init) : answer; return reply(404, 'application/json', { error: 'not found ' + KEY }) } } }

console.log('kybernos audio-probe')
assert.equal(nativeBase('https://h.example/compatible-mode/v1/'), 'https://h.example/api/v1')
assert.equal(nativeBase('https://h.example/v1'), 'https://h.example/v1')
assert.deepEqual(realtimeUrls('https://h.example/compatible-mode/v1', 'm 1').map((c) => c.url), ['wss://h.example/api-ws/v1/realtime?model=m%201', 'wss://h.example/v1/realtime?model=m%201'])
const wav = silentWav(500)
const wavB64 = silentWav(200).toString('base64')
assert.equal(wav.slice(0, 4).toString(), 'RIFF')
assert.equal(wav.length, 44 + 8000 * 2)
ok('the addresses of the other styles are derived from the OpenAI-compatible one, and a silent WAV is a real one')

{
  const t = table([['/audio/speech', reply(200, 'audio/mpeg', '')]])
  const r = await createProbe({ fetch: t.fetch }).run({ kind: 'speak', base: 'https://h.example/v1', key: KEY, model: 'tts-1' })
  assert.equal(r.ok, true)
  assert.equal(r.family, 'openai-speech')
  assert.equal(r.tried.length, 1)
  assert.equal(t.seen[0].init.headers.authorization, 'Bearer ' + KEY)
  assert.deepEqual(JSON.parse(t.seen[0].init.body), { model: 'tts-1', input: 'Test.', voice: 'alloy' })
  ok('a provider that speaks like OpenAI answers on the first shape, and the probe stops there')
}
{
  const t = table([['/chat/completions', (init) => (JSON.parse(init.body).messages[0].role === 'assistant' ? reply(200, 'application/json', { choices: [{ message: { audio: { data: wavB64 } } }] }) : reply(400, 'application/json', { error: { message: 'messages must contain an assistant role for TTS model' } }))]])
  const r = await createProbe({ fetch: t.fetch }).run({ kind: 'speak', base: 'https://h.example/v1', key: KEY, model: 'tts', keepAudio: true })
  assert.equal(r.family, 'chat-assistant-text')
  assert.deepEqual(r.tried.map((x) => [x.shape, x.ok]), [['openai-speech', false], ['chat-assistant-text', true]])
  assert.equal(r.audio.slice(0, 4).toString(), 'RIFF')
  assert.equal(JSON.stringify(r).includes('RIFF'), false)
  assert.equal(Object.keys(r).includes('audio'), false)
  ok('a TTS model of a chat gateway wants the text as an assistant message: that is the second shape, and the audio it returns is kept for the caller, never serialised')
  const t1 = table([['/chat/completions', (init) => (JSON.parse(init.body).modalities && !JSON.parse(init.body).stream ? reply(200, 'application/json', { choices: [{ message: { audio: { data: wavB64 } } }] }) : reply(400, 'application/json', {}))]])
  assert.equal((await createProbe({ fetch: t1.fetch }).run({ kind: 'speak', base: 'https://h.example/v1', key: KEY, model: 'tts' })).family, 'chat-audio')
  ok('chat completions that return audio on request are the third')
}
{
  const t = table([['/api/v1/services/aigc/multimodal-generation/generation', reply(200, 'application/json', { output: { audio: { url: 'https://cdn.example/a.wav' } } })]])
  const r = await createProbe({ fetch: t.fetch }).run({ kind: 'speak', base: 'https://h.example/compatible-mode/v1', key: KEY, model: 'qwen-tts' })
  assert.equal(r.family, 'dashscope-native')
  assert.equal(r.tried.length, 5)
  ok('DashScope\'s native endpoint is found at the address derived from the compatible one, after the OpenAI-style shapes')
}
{
  const t = table([])
  const r = await createProbe({ fetch: t.fetch }).run({ kind: 'speak', base: 'https://h.example/v1', key: KEY, model: 'x' })
  assert.equal(r.ok, false)
  assert.equal(r.family, null)
  assert.equal(r.tried.length, 6)
  assert.equal(JSON.stringify(r).includes(KEY), false)
  ok('when no shape works it says so with what each answered, and the key never appears in the answer, even when the provider echoes it')
}
{
  const t = table([['/audio/transcriptions', (init) => (init.body instanceof FormData && init.body.get('model') === 'asr' ? reply(200, 'application/json', { text: '' }) : reply(400, 'application/json', {}))]])
  const r = await createProbe({ fetch: t.fetch }).run({ kind: 'listen', base: 'https://h.example/v1', key: KEY, model: 'asr' })
  assert.equal(r.family, 'openai-transcriptions')
  const t2 = table([['/chat/completions', (init) => (JSON.stringify(JSON.parse(init.body).messages[0].content).includes('input_audio') ? reply(200, 'application/json', { choices: [{ message: { content: '' } }] }) : reply(400, 'application/json', {}))]])
  assert.equal((await createProbe({ fetch: t2.fetch }).run({ kind: 'listen', base: 'https://h.example/v1', key: KEY, model: 'asr' })).family, 'chat-input-audio-base64')
  ok('listening: OpenAI transcriptions with a silent WAV, then chat completions with the audio alone (some gateways refuse a text part)')
  const t3 = table([['/chat/completions', (init) => { const part = JSON.parse(init.body).messages[0].content; return part.length === 1 && part[0].input_audio.data.startsWith('data:') ? reply(200, 'application/json', { choices: [{ message: { content: 'This is a test.' } }] }) : reply(400, 'application/json', {}) }]])
  const heard = await createProbe({ fetch: t3.fetch }).run({ kind: 'listen', base: 'https://h.example/v1', key: KEY, model: 'asr', sample: silentWav(300) })
  assert.equal(heard.family, 'chat-input-audio-dataurl')
  assert.equal(heard.tried[heard.tried.length - 1].note, 'recognised "test"')
  ok('given real speech to recognise, a transcript with "test" in it is the proof, and a data URL is the other way of sending the audio')
}
{
  class FakeWS { constructor (url, opts) { FakeWS.urls.push([url, opts]); setTimeout(() => { if (url.includes('/api-ws/')) this.onerror({ message: 'handshake refused ' + KEY }); else { this.onopen(); this.onmessage({ data: JSON.stringify({ type: 'session.created' }) }) } }, 5) } close () {} }
  FakeWS.urls = []
  const r = await createProbe({ WebSocket: FakeWS, fetch: async () => { throw new Error('no http here') } }).run({ kind: 'realtime', base: 'https://h.example/v1', key: KEY, model: 'rt' })
  assert.equal(r.family, 'openai-realtime')
  assert.deepEqual(r.tried.map((x) => [x.shape, x.ok]), [['dashscope-realtime', false], ['openai-realtime', true]])
  assert.equal(r.tried[1].note, 'handshake accepted, first event: session.created')
  assert.equal(FakeWS.urls[0][1].headers.authorization, 'Bearer ' + KEY)
  assert.equal(JSON.stringify(r).includes(KEY), false)
  assert.equal((await createProbe({ WebSocket: undefined }).run({ kind: 'realtime', base: 'https://h.example/v1', key: KEY, model: 'rt' })).ok, false)
  assert.equal((await createProbe().run({ kind: 'nothing', base: 'https://h', key: KEY, model: 'm' })).ok, false)
  ok('realtime: the WebSocket handshake in the two usual styles, the key sent as a header and never returned; no WebSocket, or an unknown kind, is an answer too')
}
assert.equal(providerBase('qwen-token-plan', {}), 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1')
assert.equal(providerBase('xiaomi-token-plan-ams', { baseURL: '' }), 'https://token-plan-ams.xiaomimimo.com/v1')
assert.equal(providerBase('mine', { baseURL: 'https://my.example/v1/' }), 'https://my.example/v1')
assert.equal(providerBase('mine', { baseURL: 'http://insecure.example' }), null)
assert.equal(providerBase('unknown', {}), null)
ok('a provider\'s own address wins; built-in ones are known; an unknown or non-https one is null (the page asks, it does not guess)')
console.log('\nkybernos audio-probe: ' + n + ' checks')
