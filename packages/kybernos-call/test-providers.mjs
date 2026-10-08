// kybernos-call: the five slots and their providers: the catalogue, what the settings keep of it, the presets, the
// LiveAvatar calls and the health check. Fake servers and fake dependencies only; no real account is ever contacted.
//
//   node packages/kybernos-call/test-providers.mjs
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdmin } from './call-admin.mjs'
import { createHealth } from './call-health.mjs'
import { createServices } from './call-services.mjs'
import { KEY_SPECS, createStore } from './call-store.mjs'
import { PRESETS, PROVIDERS, SLOTS, availableIds, checkProviderConfig, configOf, isConfigured, providerById } from './providers.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const home = mkdtempSync(join(tmpdir(), 'kybernos-call-providers-'))
const json = (status, body) => ({ status, json: async () => body, text: async () => JSON.stringify(body) })

console.log('kybernos-call: the catalogue')
{
  assert.deepEqual(SLOTS.map((s) => s.id), ['listen', 'think', 'speak', 'face', 'line'])
  for (const s of SLOTS) { assert.ok(s.name.fr && s.name.en && s.sub.fr && s.sub.en && s.help.fr && s.help.en, s.id) }
  ok('five slots, each with a name, a one-line role and a help in both languages')

  const ids = new Set()
  for (const p of PROVIDERS) {
    assert.ok(!ids.has(p.id), 'duplicate id ' + p.id)
    ids.add(p.id)
    assert.ok(SLOTS.some((s) => s.id === p.slot), p.id + ': unknown slot')
    assert.ok(p.name.fr && p.name.en && p.price.fr && p.price.en && p.note.fr && p.note.en, p.id + ': text in both languages')
    assert.ok(['key', 'models', 'local', 'none'].includes(p.source), p.id + ': source')
    for (const f of p.fields) {
      assert.ok(['secret', 'env', 'switch', 'setting', 'models'].includes(f.kind), p.id + ': field kind')
      assert.ok(f.label.fr && f.label.en, p.id + ': field label')
      if (f.kind === 'models') assert.ok(['listen', 'speak'].includes(f.want), p.id + ': a models field says what it wants')
      else if (f.kind !== 'setting') assert.ok(Object.prototype.hasOwnProperty.call(KEY_SPECS, f.name), p.id + ': ' + f.name + ' is not a stored value')
      else { assert.ok(f.options.length > 0 && f.options.some((o) => o.value === f.default), p.id + ': default is one of the options') }
    }
    if (p.url !== undefined) assert.match(p.url, /^https:\/\//)
    if (p.available !== true) assert.equal(p.fields.length, 0, p.id + ': a provider that is not wired has no form yet')
  }
  ok('every provider names a real slot, has text in both languages, and only uses values the store knows')

  for (const slot of ['listen', 'speak', 'face', 'line']) assert.ok(availableIds(slot).length >= 1, slot)
  assert.deepEqual(availableIds('think'), ['session'])
  for (const id of ['models-asr', 'models-tts', 'app-dictation']) assert.ok(providerById(id).available === true && providerById(id).source === 'models', id)
  assert.equal(providerById('models-tts').engine, 'models')
  assert.equal(providerById('qwen-asr'), null)
  ok('every slot has something to use today; the models of the user\'s own providers are a provider of the Listen and Speak slots, whichever provider they come from')

  assert.deepEqual(configOf('groq', undefined), { model: 'whisper-large-v3-turbo' })
  assert.deepEqual(configOf('groq', { model: 'whisper-large-v3' }), { model: 'whisper-large-v3' })
  assert.deepEqual(configOf('groq', { model: 'not-a-model' }), { model: 'whisper-large-v3-turbo' })
  assert.deepEqual(configOf('nobody', {}), {})
  const bad = checkProviderConfig({ groq: { model: 'x', nope: 'y' }, ghost: { a: 'b' } })
  assert.deepEqual(bad.kept, {})
  assert.deepEqual(Object.keys(bad.refused).sort(), ['providers.ghost', 'providers.groq.model', 'providers.groq.nope'])
  assert.deepEqual(checkProviderConfig({ elevenlabs: { model: 'eleven_flash_v2_5' } }).kept, { elevenlabs: { model: 'eleven_flash_v2_5' } })
  assert.deepEqual(configOf('models-asr', { model: 'xiaomi-token-plan-ams:mimo-v2.5-asr' }), { model: 'xiaomi-token-plan-ams:mimo-v2.5-asr' })
  assert.deepEqual(configOf('models-asr', { model: 'not a model' }), { model: '' })
  assert.deepEqual(checkProviderConfig({ 'models-asr': { model: 'qwen-token-plan:qwen-audio-3.0-asr-flash' } }).kept, { 'models-asr': { model: 'qwen-token-plan:qwen-audio-3.0-asr-flash' } })
  assert.deepEqual(checkProviderConfig({ 'models-asr': { model: '' } }).kept, { 'models-asr': { model: '' } })
  for (const bad of ['nope', '../x:y', 'a:b c', 'x'.repeat(200) + ':m', 3]) assert.ok(Object.keys(checkProviderConfig({ 'models-asr': { model: bad } }).refused).length > 0, String(bad))
  ok('a provider\'s own settings are read with defaults, and only a listed option is accepted; a model of the user\'s Models is a "<provider>:<model>" of a safe shape')

  assert.equal(isConfigured(providerById('groq'), {}), false)
  assert.equal(isConfigured(providerById('groq'), { GROQ_API_KEY: { set: true } }), true)
  assert.equal(isConfigured(providerById('liveavatar'), { LIVEAVATAR_API_KEY: { set: true } }), false)
  assert.equal(isConfigured(providerById('liveavatar'), { LIVEAVATAR_API_KEY: { set: true }, LIVEAVATAR_AVATAR_ID: { set: true } }), true)
  assert.equal(isConfigured(providerById('edge'), {}), true)
  ok('a provider is set up when its secrets and its required values are set; one with no key always is')
}

console.log('kybernos-call: what the settings keep')
const store = createStore({ dshHome: async () => home, env: {} })
{
  const first = await store.readSettings()
  assert.deepEqual(first.use, { listen: 'groq', face: 'liveavatar' })
  assert.deepEqual(first.providers, {})
  assert.equal(first.setupDone, false)
  ok('the defaults: listen with Groq, a face when one is set, setup not done')

  let r = await store.writeSettings({ use: { face: 'none' } })
  assert.deepEqual(r.settings.use, { listen: 'groq', face: 'none' })
  r = await store.writeSettings({ providers: { groq: { model: 'whisper-large-v3' } }, setupDone: true })
  assert.deepEqual(r.settings.providers, { groq: { model: 'whisper-large-v3' } })
  r = await store.writeSettings({ providers: { elevenlabs: { model: 'eleven_flash_v2_5' } } })
  assert.deepEqual(r.settings.providers, { groq: { model: 'whisper-large-v3' }, elevenlabs: { model: 'eleven_flash_v2_5' } })
  assert.equal((await store.readSettings()).setupDone, true)
  ok('a choice is merged into what is there (one slot, one provider), never replaces it, and survives a re-read')

  r = await store.writeSettings({ use: { listen: 'models-asr' }, providers: { 'models-asr': { model: 'xiaomi-token-plan-ams:mimo-v2.5-asr' } } })
  assert.equal(r.ok, true)
  assert.equal(r.settings.use.listen, 'models-asr')
  r = await store.writeSettings({ use: { listen: 'groq' } })
  for (const patch of [{ use: { listen: 'deepgram' } }, { use: { speak: 'edge' } }, { use: { face: 'anam' } }, { use: 'groq' }, { providers: { groq: { model: 'x' } } }, { providers: [] }, { setupDone: 'yes' }]) {
    const out = await store.writeSettings(patch)
    assert.equal(out.ok, false, JSON.stringify(patch))
  }
  const after = await store.readSettings()
  assert.equal(after.use.listen, 'groq')
  ok('a provider that is not wired, a slot with no choice, a model that is not listed: refused, and nothing is changed')
}

console.log('kybernos-call: the admin side')
const calls = { avatars: [], tested: [] }
const services = {
  testGroq: async () => ({ ok: true, service: 'Groq' }),
  testEleven: async () => ({ ok: true, service: 'ElevenLabs' }),
  testLiveAvatar: async (key) => { calls.tested.push(key); return { ok: true, service: 'LiveAvatar', detail: '8.5' } },
  listAvatars: async (key) => { calls.avatars.push(key); return { ok: true, avatars: [{ id: 'a1', name: 'Wayne', type: 'VIDEO', source: 'public' }] } }
}
const fakeCall = { testLiveKit: async () => ({ ok: true, service: 'LiveKit' }), engineCheck: async () => ({ ok: true, code: 'installed' }) }
const admin = createAdmin({ store, services, call: fakeCall })
{
  await store.writeKeys({ GROQ_API_KEY: 'gsk_testkey1', LIVEAVATAR_API_KEY: 'la_key_12345', LIVEKIT_URL: 'wss://x.livekit.cloud' })
  const all = await admin.everything()
  assert.equal(all.slots.length, 5)
  const groq = all.providers.find((p) => p.id === 'groq')
  assert.equal(groq.configured, true)
  assert.equal(groq.ready, true)
  assert.deepEqual(groq.config, { model: 'whisper-large-v3' })
  const eleven = all.providers.find((p) => p.id === 'elevenlabs')
  assert.equal(eleven.configured, false)
  assert.equal(eleven.ready, false)
  assert.equal(all.providers.find((p) => p.id === 'edge').ready, true)
  assert.equal(all.providers.find((p) => p.id === 'liveavatar').ready, false) // the key is set, the avatar id is not
  assert.equal(all.providers.find((p) => p.id === 'models-tts').ready, true)
  assert.deepEqual(all.providers.find((p) => p.id === 'models-asr').config, { model: 'xiaomi-token-plan-ams:mimo-v2.5-asr' })
  assert.equal(all.keys.LIVEKIT_URL.value, 'wss://x.livekit.cloud')
  assert.equal(JSON.stringify(all).includes('gsk_testkey1'), false)
  assert.equal(JSON.stringify(all).includes('la_key_12345'), false)
  ok('the page gets the catalogue with each provider\'s state and settings, the LiveKit address, and never a key')

  assert.deepEqual(all.presets.map((p) => [p.id, p.available]), [['simple', false], ['live', true], ['best', true]])
  let out = await admin.applyPreset('best')
  assert.equal(out.ok, true)
  assert.deepEqual(out.settings.use, { listen: 'groq', face: 'liveavatar' })
  assert.equal(out.settings.defaultVoice.voice, 'fr-FR-VivienneMultilingualNeural')
  out = await admin.applyPreset('live')
  assert.deepEqual(out.settings.use, { listen: 'groq', face: 'none' })
  assert.equal(out.settings.defaultVoice.engine, 'edge')
  assert.deepEqual((await admin.everything()).presets.map((p) => [p.id, p.active]), [['simple', false], ['live', true], ['best', false]])
  assert.equal((await admin.applyPreset('simple')).ok, false)
  assert.equal((await admin.applyPreset('nope')).ok, false)
  assert.equal(PRESETS.length, 3)
  ok('a preset fills the slots at once; one that is not available yet, or unknown, is refused')

  assert.deepEqual(await admin.test('liveavatar'), { ok: true, service: 'LiveAvatar', detail: '8.5' })
  assert.deepEqual(calls.tested, ['la_key_12345'])
  await store.writeKeys({ LIVEAVATAR_API_KEY: '' })
  assert.match((await admin.test('liveavatar')).error, /no LiveAvatar key/)
  ok('the face provider can be tested; without a key it says so')

  assert.equal((await admin.avatars()).ok, true)
  assert.deepEqual(calls.avatars, [null])
  await store.writeKeys({ LIVEAVATAR_API_KEY: 'la_key_12345' })
  await admin.avatars()
  assert.equal(calls.avatars[1], 'la_key_12345')
  ok('the avatar list is asked with the key when there is one, without it otherwise (the public faces)')
}

console.log('kybernos-call: LiveAvatar')
{
  const seen = []
  const make = (table) => createServices({ fetch: async (url, init) => { seen.push({ url: String(url), init }); const h = table(String(url)); if (h instanceof Error) throw h; return h } })
  let s = make(() => json(200, { code: 100, data: { credits_left: '8.5' } }))
  assert.deepEqual(await s.testLiveAvatar('la_k'), { ok: true, service: 'LiveAvatar', detail: '8.5' })
  assert.equal(seen[0].url, 'https://api.liveavatar.com/v1/users/credits')
  assert.equal(seen[0].init.headers['x-api-key'], 'la_k')
  s = make(() => json(401, {}))
  assert.match((await s.testLiveAvatar('k')).error, /refused the key/)
  s = make(() => json(500, {}))
  assert.match((await s.testLiveAvatar('k')).error, /HTTP 500/)
  s = make(() => new Error('ENOTFOUND'))
  assert.match((await s.testLiveAvatar('k')).error, /unreachable: ENOTFOUND/)
  ok('the key is tested with the account balance (read only), and a refusal, a server error and an unreachable host each say so')

  seen.length = 0
  s = make((url) => (url.includes('/avatars/public')
    ? json(200, { data: { results: [{ id: 'pub-1', name: 'Wayne', type: 'VIDEO', status: 'ACTIVE' }, { id: 'pub-2', name: 'Gone', type: 'VIDEO', status: 'DELETED' }] } })
    : json(200, { data: { results: [{ id: 'mine-1', name: 'My photo', type: 'IMAGE', status: 'ACTIVE' }, { id: '../bad', name: 'x', status: 'ACTIVE' }] } })))
  const list = await s.listAvatars('la_k')
  assert.deepEqual(list.avatars, [{ id: 'mine-1', name: 'My photo', type: 'IMAGE', source: 'yours' }, { id: 'pub-1', name: 'Wayne', type: 'VIDEO', source: 'public' }])
  assert.equal(seen.find((c) => c.url.endsWith('/avatars?page_size=100')).init.headers['x-api-key'], 'la_k')
  assert.equal(seen.find((c) => c.url.includes('/avatars/public')).init.headers['x-api-key'], undefined)
  ok('the account\'s own faces come first, then the public ones; deleted faces and odd ids are left out; the key is not sent for the public list')
  assert.equal((await make((url) => (url.includes('public') ? json(200, { data: { results: [] } }) : json(401, {}))).listAvatars('bad')).ok, false)
  ok('a refused key is reported instead of an empty list')
}

console.log('kybernos-call: the health check')
{
  const freshHome = mkdtempSync(join(tmpdir(), 'kybernos-call-health-'))
  const fresh = createStore({ dshHome: async () => freshHome, env: {} })
  const asked = []
  const speakFetch = (answer) => async (url, init) => { asked.push({ url: String(url), body: JSON.parse(init.body), origin: init.headers.origin }); return { status: 200, json: async () => answer } }
  const health = (over = {}) => createHealth(Object.assign({ store: fresh, services, call: fakeCall, fetch: speakFetch({ ok: true, engine: 'say', ms: 500 }), budgetMs: 2000 }, over))

  let r = await health().run({ base: 'http://127.0.0.1:3080' })
  const by = (res) => Object.fromEntries(res.checks.map((c) => [c.id, c]))
  assert.deepEqual(r.checks.map((c) => c.id), ['listen', 'speak', 'face', 'line', 'engine'])
  assert.equal(by(r).listen.code, 'no-key')
  assert.equal(by(r).listen.status, 'bad')
  assert.equal(by(r).face.code, 'no-key')
  assert.equal(by(r).face.status, 'warn')
  assert.equal(by(r).speak.status, 'ok')
  assert.equal(asked[0].url, 'http://127.0.0.1:3080/kybernos/tts/speak')
  assert.equal(asked[0].origin, 'http://127.0.0.1:3080')
  assert.equal(asked[0].body.engine, undefined)
  ok('with nothing set up the keyed providers say which key is missing, and the voice is asked through this DSH\'s own engine')

  await fresh.writeKeys({ GROQ_API_KEY: 'gsk_testkey1', LIVEAVATAR_API_KEY: 'la_key_12345', LIVEAVATAR_AVATAR_ID: 'wayne' })
  await fresh.writeSettings({ defaultVoice: { engine: 'edge', voice: 'fr-FR-DeniseNeural', lang: 'fr' } })
  r = await health({ fetch: speakFetch({ ok: true, engine: 'edge', ms: 700 }) }).run({ base: 'http://127.0.0.1:3080' })
  assert.deepEqual(r.checks.map((c) => c.status), ['ok', 'ok', 'ok', 'ok', 'ok'])
  assert.deepEqual(asked[asked.length - 1].body, { text: 'Test.', lang: 'fr', engine: 'edge', voice: 'fr-FR-DeniseNeural' })
  assert.equal(by(r).face.detail, '8.5')
  ok('with everything set, every slot is ok; the chosen voice is the one tested')

  r = await health({ fetch: speakFetch({ ok: true, engine: 'say', ms: 500, attempts: [{ engine: 'edge', error: 'No module named edge_tts' }] }) }).run({ base: 'http://127.0.0.1:3080' })
  assert.equal(by(r).speak.status, 'warn')
  assert.equal(by(r).speak.code, 'fell-back')
  assert.match(by(r).speak.detail, /edge_tts/)
  ok('a voice that fell back to another engine is a warning with the engine\'s own reason, not a green tick')

  await fresh.writeSettings({ use: { face: 'none' } })
  const down = { testLiveKit: async () => ({ ok: false, error: 'LiveKit refused the key or the secret' }), engineCheck: async () => ({ ok: false, code: 'not-installed' }) }
  const refused = { ...services, testGroq: async () => ({ ok: false, error: 'Groq refused the key' }) }
  r = await health({ call: down, services: refused }).run({ base: 'http://127.0.0.1:3080' })
  assert.equal(by(r).face.code, 'voice-only')
  assert.equal(by(r).face.status, 'ok')
  assert.equal(by(r).listen.code, 'refused')
  assert.equal(by(r).line.code, 'refused')
  assert.equal(by(r).engine.code, 'not-installed')
  ok('no face chosen is fine; a refused key, a refused line and a missing call engine are each named')

  // listening with a model of the user's Models, or with the app's dictation
  await fresh.writeSettings({ use: { listen: 'models-asr' } })
  const noModel = await health({ fetch: speakFetch({ ok: true, engine: 'edge' }) }).run({ base: 'http://127.0.0.1:3080' })
  assert.equal(by(noModel).listen.code, 'no-model')
  await fresh.writeSettings({ providers: { 'models-asr': { model: 'xiaomi-token-plan-ams:mimo-v2.5-asr' } } })
  const probed = []
  const probeFetch = (answer) => async (url, init) => { if (String(url).includes('/models/audio/probe')) { probed.push(JSON.parse(init.body)); return { status: 200, json: async () => answer } } return { status: 200, json: async () => ({ ok: true, engine: 'edge', ms: 5 }) } }
  const good = await health({ fetch: probeFetch({ ok: true, family: 'chat-input-audio-base64' }) }).run({ base: 'http://127.0.0.1:3080' })
  assert.equal(by(good).listen.status, 'ok')
  assert.deepEqual(probed[0], { provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.5-asr' })
  const bad2 = await health({ fetch: probeFetch({ ok: false, code: 'no-key', error: 'no key is set for this provider' }) }).run({ base: 'http://127.0.0.1:3080' })
  assert.equal(by(bad2).listen.status, 'bad')
  assert.equal(by(bad2).listen.code, 'no-key')
  const none = await health({ fetch: probeFetch({ ok: false, family: null, tried: [] }) }).run({ base: 'http://127.0.0.1:3080' })
  assert.equal(by(none).listen.code, 'failed')
  await fresh.writeSettings({ use: { listen: 'app-dictation' } })
  const dictFetch = (asr) => async (url) => (String(url).includes('/voice/config') ? { status: 200, json: async () => ({ ok: true, asr }) } : { status: 200, json: async () => ({ ok: true, engine: 'edge', ms: 5 }) })
  assert.equal(by(await health({ fetch: dictFetch({ ready: true }) }).run({ base: 'http://127.0.0.1:3080' })).listen.status, 'ok')
  const notReady = by(await health({ fetch: dictFetch({ ready: false, reason: 'référence X non configurée' }) }).run({ base: 'http://127.0.0.1:3080' })).listen
  assert.equal(notReady.status, 'bad')
  assert.match(notReady.detail, /non configurée/)
  await fresh.writeSettings({ use: { listen: 'groq' } })
  ok('listening with a model of the user\'s Models is checked by the app itself, on real speech; the app\'s dictation by its own readiness; each says what is missing')

  const hang = { testLiveKit: () => new Promise(() => {}), engineCheck: async () => { throw new Error('python exploded') } }
  const t0 = Date.now()
  r = await health({ call: hang, budgetMs: 150, fetch: speakFetch({ ok: true, engine: 'edge', ms: 100 }) }).run({ base: 'http://127.0.0.1:3080' })
  assert.ok(Date.now() - t0 < 1500)
  assert.equal(by(r).line.code, 'timeout')
  assert.equal(by(r).engine.code, 'failed')
  assert.equal(by(r).speak.status, 'ok')
  ok('a check that hangs or throws is cut off and reported, and the others still answer')

  assert.equal(JSON.stringify(r).includes('gsk_testkey1'), false)
  ok('the answer never contains a key')
}

console.log('\nkybernos-call providers: ' + pass + ' checks')
