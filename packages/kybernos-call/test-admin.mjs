// kybernos-call: the settings page's host side (call-admin.mjs over call-store.mjs), the outside services
// (call-services.mjs) and how a call uses the settings. Fake servers only; no real account is ever contacted.
//
//   node packages/kybernos-call/test-admin.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createAdmin } from './call-admin.mjs'
import { createCall } from './call-host.mjs'
import { createServices } from './call-services.mjs'
import { createStore } from './call-store.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const home = mkdtempSync(join(tmpdir(), 'kybernos-call-admin-'))
const put = (rel, text) => { const f = join(home, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); return f }
const SECRET = 'k'.repeat(40)
const reply = (status, body, headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), arrayBuffer: async () => (Buffer.isBuffer(body) ? body.buffer.slice(body.byteOffset, body.byteOffset + body.length) : new TextEncoder().encode(String(body)).buffer) })

try {
  console.log('kybernos-call services: the keys are tested with one read-only call each')
  const seen = []
  const fakeFetch = (table) => async (url, init) => { seen.push({ url: String(url), init }); const h = table(String(url), init); if (h instanceof Error) throw h; return h }
  let services = createServices({ fetch: fakeFetch(() => reply(200, {})) })
  assert.deepEqual(await services.testGroq('gsk_x'), { ok: true, service: 'Groq' })
  assert.equal(seen[0].url, 'https://api.groq.com/openai/v1/models')
  assert.equal(seen[0].init.headers.authorization, 'Bearer gsk_x')
  assert.deepEqual(await services.testEleven('xi_y'), { ok: true, service: 'ElevenLabs' })
  assert.equal(seen[1].url, 'https://api.elevenlabs.io/v1/models')
  assert.equal(seen[1].init.headers['xi-api-key'], 'xi_y')
  ok('Groq and ElevenLabs are asked for their list of models, with the key in the right header')
  services = createServices({ fetch: fakeFetch(() => reply(401, {})) })
  assert.match((await services.testGroq('k')).error, /refused the key/)
  services = createServices({ fetch: fakeFetch(() => reply(500, {})) })
  assert.match((await services.testEleven('k')).error, /HTTP 500/)
  services = createServices({ fetch: fakeFetch(() => new Error('getaddrinfo ENOTFOUND')) })
  assert.match((await services.testGroq('k')).error, /unreachable: getaddrinfo ENOTFOUND/)
  ok('a refused key, a server error and an unreachable host each say what happened')

  console.log('kybernos-call services: cloning')
  let formSeen = null
  services = createServices({ fetch: fakeFetch((url, init) => { formSeen = init; return reply(200, { voice_id: 'NewVoiceId12345', requires_verification: false }) }) })
  const made = await services.cloneVoice({ key: 'xi_y', name: 'Kybernos · Claire', sample: { bytes: Buffer.from('RIFFfakewav'), mime: 'audio/wav', filename: 'v-1.wav' } })
  assert.deepEqual(made, { ok: true, remoteId: 'NewVoiceId12345', requiresVerification: false })
  assert.equal(seen[seen.length - 1].url, 'https://api.elevenlabs.io/v1/voices/add')
  assert.equal(formSeen.method, 'POST')
  assert.equal(formSeen.headers['xi-api-key'], 'xi_y')
  assert.ok(formSeen.body instanceof FormData)
  assert.equal(formSeen.body.get('name'), 'Kybernos · Claire')
  const file = formSeen.body.get('files')
  assert.equal(file.name, 'v-1.wav')
  assert.equal(file.type, 'audio/wav')
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'RIFFfakewav')
  ok('a recording is sent as a multipart form (name + files) to /v1/voices/add and a voice id comes back')
  services = createServices({ fetch: fakeFetch(() => reply(401, { detail: { status: 'invalid_api_key' } })) })
  assert.match((await services.cloneVoice({ key: 'k', name: 'n', sample: { bytes: Buffer.from('x') } })).error, /refused the key or the plan/)
  services = createServices({ fetch: fakeFetch(() => reply(422, { detail: { message: 'The sample is too short' } })) })
  assert.match((await services.cloneVoice({ key: 'k', name: 'n', sample: { bytes: Buffer.from('x') } })).error, /HTTP 422 \(The sample is too short\)/)
  services = createServices({ fetch: fakeFetch(() => reply(200, { voice_id: '../etc' })) })
  assert.match((await services.cloneVoice({ key: 'k', name: 'n', sample: { bytes: Buffer.from('x') } })).error, /no voice id/)
  services = createServices({ fetch: fakeFetch(() => reply(200, { voice_id: 'GoodVoice12345', requires_verification: true })) })
  assert.equal((await services.cloneVoice({ key: 'k', name: 'n', sample: { bytes: Buffer.from('x') } })).requiresVerification, true)
  ok('a refused key or plan, a provider error with its reason, a malformed answer and a verification request are all reported as they are')
  services = createServices({ fetch: fakeFetch(() => reply(200, { status: 'ok' })) })
  assert.deepEqual(await services.deleteVoice({ key: 'k', remoteId: 'GoodVoice12345' }), { ok: true })
  assert.equal(seen[seen.length - 1].url, 'https://api.elevenlabs.io/v1/voices/GoodVoice12345')
  assert.equal(seen[seen.length - 1].init.method, 'DELETE')
  services = createServices({ fetch: fakeFetch(() => reply(404, {})) })
  assert.equal((await services.deleteVoice({ key: 'k', remoteId: 'GoodVoice12345' })).ok, true)
  services = createServices({ fetch: fakeFetch(() => reply(401, {})) })
  assert.equal((await services.deleteVoice({ key: 'k', remoteId: 'GoodVoice12345' })).ok, false)
  ok('deleting a clone: ok, ok when it is already gone, refused with a bad key')

  console.log('kybernos-call admin: what the settings page reads and changes')
  const store = createStore({ dshHome: async () => home, now: () => '2026-10-08T12:00:00.000Z' })
  const cloneCalls = []
  const sample = Buffer.from('RIFF....WAVEfmt fake audio')
  // the app's own route that serves a kept recording
  const core = createServer((req, res) => { cloneCalls.push(req.url); if (req.url.includes('voiceId=v-missing')) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(sample) })
  await new Promise((resolve) => core.listen(0, '127.0.0.1', resolve))
  const providerCalls = []
  const providerServices = {
    testGroq: async (k) => ({ ok: k === 'gsk_good', service: 'Groq' }),
    testEleven: async (k) => ({ ok: k === 'xi_good_key', service: 'ElevenLabs' }),
    cloneVoice: async (a) => { providerCalls.push(a); return a.name.includes('Bad') ? { ok: false, error: 'ElevenLabs answered HTTP 422' } : { ok: true, remoteId: 'RemoteVoice777', requiresVerification: false } },
    deleteVoice: async (a) => (a.remoteId === 'RemoteVoice777' ? { ok: true } : { ok: false, error: 'nope' })
  }
  const call = createCall({ dshHome: async () => home, env: { DSH_WEB_PORT: String(core.address().port) }, store })
  const admin = createAdmin({ store, services: providerServices, call, env: { DSH_WEB_PORT: String(core.address().port) } })

  let all = await admin.everything()
  assert.equal(all.ok, true)
  assert.equal(all.settings.language, 'auto')
  assert.deepEqual(all.clones, [])
  assert.equal(all.keys.GROQ_API_KEY.set, false)
  ok('the page first reads the settings, which secrets are set, and the clones')

  assert.equal((await admin.patchSettings({ language: 'de' })).settings.language, 'de')
  assert.equal((await admin.patchSettings({ mode: 'x' })).ok, false)
  assert.equal((await admin.setKeys({ GROQ_API_KEY: 'gsk_good', ELEVENLABS_API_KEY: 'xi_good_key' })).ok, true)
  all = await admin.everything()
  assert.equal(all.keys.GROQ_API_KEY.set, true)
  assert.equal(JSON.stringify(all).includes('gsk_good'), false)
  ok('it can change a setting and set keys, and what it reads back never holds a key')

  assert.deepEqual(await admin.test('groq'), { ok: true, service: 'Groq' })
  assert.deepEqual(await admin.test('elevenlabs'), { ok: true, service: 'ElevenLabs' })
  assert.equal((await admin.test('livekit')).ok, false)
  assert.match((await admin.test('livekit')).error, /not all set/)
  assert.match((await admin.test('nope')).error, /unknown service/)
  await admin.setKeys({ GROQ_API_KEY: '' })
  assert.match((await admin.test('groq')).error, /no Groq key/)
  ok('the keys are tested one by one with the stored key; a missing one says so instead of calling')

  // ── the LiveKit test against a fake server ──
  const lkCalls = []
  const lk = createServer((req, res) => { lkCalls.push({ url: req.url, auth: req.headers.authorization }); res.writeHead(req.headers.authorization === 'Bearer refuse' ? 401 : 200, { 'content-type': 'application/json' }); res.end('{}') })
  await new Promise((resolve) => lk.listen(0, '127.0.0.1', resolve))
  await admin.setKeys({ LIVEKIT_URL: 'ws://127.0.0.1:' + lk.address().port, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: SECRET })
  const lkOk = await createAdmin({ store, services: providerServices, call: createCall({ dshHome: async () => home, store }), env: {} }).test('livekit')
  assert.deepEqual(lkOk, { ok: true, service: 'LiveKit' })
  assert.equal(lkCalls[0].url, '/twirp/livekit.RoomService/ListRooms')
  assert.match(lkCalls[0].auth, /^Bearer eyJ/)
  ok('LiveKit is tested with a read-only call (list the rooms) signed with the stored key and secret')
  const lkDown = createCall({ dshHome: async () => home, store, fetch: async () => { throw new Error('ECONNREFUSED') } })
  assert.match((await lkDown.testLiveKit()).error, /unreachable/)
  const lkNo = createCall({ dshHome: async () => home, store, fetch: async () => reply(401, {}) })
  assert.match((await lkNo.testLiveKit()).error, /refused the key or the secret/)
  ok('an unreachable or refusing LiveKit says so')

  console.log('kybernos-call admin: cloning a recording')
  assert.equal((await admin.cloneSample({ rootId: 'root-1', voiceId: '../x' })).code, 'no-sample')
  let c = await admin.cloneSample({ rootId: 'root-1', voiceId: 'v-1abc' })
  assert.equal(c.code, 'upload-off')
  assert.equal(cloneCalls.length, 0)
  assert.equal(providerCalls.length, 0)
  ok('with the "send recordings" switch off (the default) nothing is read and nothing leaves the machine')
  await admin.patchSettings({ cloneUpload: true })
  await admin.setKeys({ ELEVENLABS_API_KEY: '' })
  assert.equal((await admin.cloneSample({ rootId: 'root-1', voiceId: 'v-1abc' })).code, 'no-key')
  await admin.setKeys({ ELEVENLABS_API_KEY: 'xi_good_key' })
  assert.equal((await admin.cloneSample({ rootId: 'bad root!', voiceId: 'v-1abc' })).code, 'no-sample')
  assert.equal((await admin.cloneSample({ rootId: 'root-1', voiceId: 'v-missing' })).code, 'no-sample')
  assert.equal(providerCalls.length, 0)
  ok('switch on but no key, a bad project, or a recording the app does not have: refused, still nothing sent')

  c = await admin.cloneSample({ rootId: 'root-1', voiceId: 'v-1abc', name: 'Claire' })
  assert.deepEqual(c, { ok: true, remote: { provider: 'elevenlabs', id: 'RemoteVoice777' }, requiresVerification: false })
  assert.match(cloneCalls[cloneCalls.length - 1], /^\/kybernos\/voice-sample-audio\?rootId=root-1&voiceId=v-1abc$/)
  assert.equal(providerCalls[0].key, 'xi_good_key')
  assert.equal(providerCalls[0].name, 'Kybernos · Claire')
  assert.equal(providerCalls[0].sample.mime, 'audio/wav')
  assert.equal(providerCalls[0].sample.filename, 'v-1abc.wav')
  assert.equal(Buffer.compare(providerCalls[0].sample.bytes, sample), 0)
  ok('with both on, the recording the app kept is read and sent once, as a named voice')
  c = await admin.cloneSample({ rootId: 'root-1', voiceId: 'v-1abc' })
  assert.equal(c.already, true)
  assert.equal(providerCalls.length, 1)
  assert.equal((await admin.everything()).clones[0].id, 'v-1abc')
  ok('asking again does not send it twice; the clone shows in the list')
  c = await admin.cloneSample({ rootId: 'root-1', voiceId: 'v-2bad', name: 'Bad one' })
  assert.deepEqual(c, { ok: false, code: 'provider', error: 'ElevenLabs answered HTTP 422' })
  ok('a refusal by the provider comes back with its reason (and nothing is remembered)')

  console.log('kybernos-call: a call uses the settings')
  put('kybernos/livekit.env', 'LIVEKIT_URL=ws://127.0.0.1:' + lk.address().port + '\nLIVEKIT_API_KEY=devkey\nLIVEKIT_API_SECRET=' + SECRET + '\n')
  await admin.patchSettings({ language: 'es', mode: 'video', silenceMinutes: 3, maxMinutes: 30, defaultVoice: { engine: 'say', voice: 'Monica', lang: 'es' } })
  const mint = (body) => createCall({ dshHome: async () => home, store, env: {} }).mint(Object.assign({ agent: false }, body))
  let m = await mint({ sessionId: 'session-aaaaaaaa' })
  assert.deepEqual(m.meta, { sessionId: 'session-aaaaaaaa', kyberId: null, roleId: null, name: null, mode: 'video', language: 'es', voice: { engine: 'say', voice: 'Monica', lang: 'es' }, brain: 'voice', limits: { silenceMs: 180000, maxMs: 1800000 } })
  ok('a call that says nothing gets the settings: language, mode, the default voice, and its limits')
  m = await mint({ sessionId: 'session-aaaaaaaa', language: 'fr', mode: 'voice', roleId: 'm1', name: 'Alice' })
  assert.equal(m.meta.language, 'fr')
  assert.equal(m.meta.mode, 'voice')
  assert.equal(m.meta.voice, null)
  ok('what the surface asked wins; a member without a voice does not borrow the assistant\'s default voice')
  m = await mint({ sessionId: 'session-aaaaaaaa', language: 'auto' })
  assert.equal(m.meta.language, 'es')
  ok('"auto" from a surface means "no preference": the setting decides')

  m = await mint({ sessionId: 'session-aaaaaaaa', roleId: 'm1', voice: { custom: true, id: 'v-1abc' } })
  assert.deepEqual(m.meta.voice, { custom: true, remote: { provider: 'elevenlabs', id: 'RemoteVoice777' } })
  m = await mint({ sessionId: 'session-aaaaaaaa', roleId: 'm1', voice: { custom: true, id: 'v-never-cloned' } })
  assert.deepEqual(m.meta.voice, { custom: true })
  m = await mint({ sessionId: 'session-aaaaaaaa', roleId: 'm1', voice: { custom: true, id: '../../x' } })
  assert.deepEqual(m.meta.voice, { custom: true })
  m = await mint({ sessionId: 'session-aaaaaaaa', roleId: 'm1', voice: { custom: true, remote: { provider: 'elevenlabs', id: 'Forged12345' } } })
  assert.deepEqual(m.meta.voice, { custom: true })
  ok('a recording is swapped for its clone only through the host\'s own record; a recording that was not cloned, a bad id or a remote id forged by the page get the default voice')

  await admin.setKeys({ ELEVENLABS_API_KEY: 'xi_good_key' }) // the env file was rewritten above
  assert.equal((await admin.deleteClone('v-1abc')).ok, true)
  assert.deepEqual((await admin.everything()).clones, [])
  m = await mint({ sessionId: 'session-aaaaaaaa', roleId: 'm1', voice: { custom: true, id: 'v-1abc' } })
  assert.deepEqual(m.meta.voice, { custom: true })
  assert.equal((await admin.deleteClone('v-unknown')).already, true)
  assert.equal((await admin.deleteClone('../x')).ok, false)
  ok('deleting a clone removes it at the provider and here; the member goes back to the default voice')
  lk.close()
  core.close()
} finally {
  rmSync(home, { recursive: true, force: true })
}
console.log('\nkybernos-call admin: ' + pass + ' checks')
