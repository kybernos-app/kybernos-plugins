// Using the audio models of the user's providers (models-audio.mjs): speak, listen, check, with the way remembered. Fakes only.
import assert from 'node:assert/strict'
import { createModelsAudio } from './models-audio.mjs'

let n = 0
const ok = (label) => { n += 1; console.log('  ✓ ' + label) }
const KEY = 'k'.repeat(24)
const providers = { 'xiaomi-token-plan-ams': { apiKeyEnv: 'X_KEY', models: [{ id: 'mimo-v2.5' }, { id: 'mimo-v2.5-asr' }, { id: 'mimo-v2.5-tts' }, { id: 'mimo-v2.5-tts-voiceclone' }] }, mine: { apiKeyEnv: 'M_KEY', models: [{ id: 'tts-1' }] } }
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(60)])
const mk = (apiOver = {}, credential = async (ref) => (ref === 'X_KEY' ? KEY : null)) => {
  const calls = []
  const api = Object.assign({
    run: async (a) => { calls.push(['run', a.kind, a.model]); return { ok: true, family: a.kind === 'speak' ? 'chat-assistant-text' : 'chat-input-audio-base64', tried: [] } },
    speakWith: async (a) => { calls.push(['speakWith', a.family, a.text]); return { ok: true, audio: wav } },
    listenWith: async (a) => { calls.push(['listenWith', a.family]); return { ok: true, text: 'hello' } }
  }, apiOver)
  return { calls, audio: createModelsAudio({ providers: () => providers, credential, api }) }
}

console.log('kybernos models-audio')
{
  const t = mk()
  const r = await t.audio.speak({ provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.5-tts', text: 'Bonjour.' })
  assert.equal(r.ok, true)
  assert.equal(r.family, 'chat-assistant-text')
  assert.deepEqual(t.calls.map((c) => c[0]), ['run', 'speakWith'])
  await t.audio.speak({ provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.5-tts', text: 'Encore.' })
  assert.deepEqual(t.calls.map((c) => c[0]), ['run', 'speakWith', 'speakWith'])
  ok('the first use finds the way, the next ones use it without looking again')
  const l = await t.audio.listen({ provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.5-asr', wav })
  assert.deepEqual(l, { ok: true, text: 'hello', family: 'chat-input-audio-base64' })
  ok('listening works the same way')
}
{
  const t = mk()
  assert.equal(t.audio.known('xiaomi-token-plan-ams', 'mimo-v2.5-tts'), null)
  await t.audio.speak({ provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.5-tts', text: 'a' })
  assert.equal(t.audio.known('xiaomi-token-plan-ams', 'mimo-v2.5-tts'), 'chat-assistant-text')
  t.audio.forget()
  assert.equal(t.audio.known('xiaomi-token-plan-ams', 'mimo-v2.5-tts'), null)
  ok('the way that was found is remembered, and can be forgotten')
}
{
  const mkRemembered = () => {
    const calls = []
    let working = true
    const api = { run: async (a) => { calls.push('run'); return { ok: true, family: working ? 'a' : 'b', tried: [] } }, speakWith: async (a) => { calls.push('speak:' + a.family); return a.family === 'b' ? { ok: true, audio: wav } : (working ? { ok: true, audio: wav } : { ok: false, error: 'changed' }) }, listenWith: async () => ({ ok: true, text: '' }) }
    return { calls, setWorking: (v) => { working = v }, audio: createModelsAudio({ providers: () => providers, credential: async () => KEY, api }) }
  }
  const t = mkRemembered()
  await t.audio.speak({ provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.5-tts', text: '1' })
  t.setWorking(false)
  const r = await t.audio.speak({ provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.5-tts', text: '2' })
  assert.equal(r.ok, true)
  assert.deepEqual(t.calls, ['run', 'speak:a', 'speak:a', 'run', 'speak:b'])
  ok('when a remembered way stops working it is looked for again, once, and the new one is used')
}
{
  const t = mk()
  const reasons = []
  for (const [provider, model, kind] of [['nobody', 'x', 'speak'], ['xiaomi-token-plan-ams', 'not-a-model', 'speak'], ['xiaomi-token-plan-ams', 'mimo-v2.5', 'speak'], ['xiaomi-token-plan-ams', 'mimo-v2.5-asr', 'speak'], ['mine', 'tts-1', 'speak']]) {
    const r = await t.audio[kind === 'speak' ? 'speak' : 'listen']({ provider, model, text: 'a', wav })
    assert.equal(r.ok, false)
    reasons.push(r.code)
  }
  assert.deepEqual(reasons, ['unknown-model', 'unknown-model', 'wrong-kind', 'wrong-kind', 'no-address'])
  assert.equal(t.calls.length, 0)
  const noKey = mk({}, async () => null)
  assert.equal((await noKey.audio.speak({ provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.5-tts', text: 'a' })).code, 'no-key')
  assert.equal(noKey.calls.length, 0)
  ok('an unknown model, a model of another kind, a provider with no known address, no key: refused with the reason, before anything is sent')
}
{
  const t = mk({ run: async () => ({ ok: false, family: null, tried: [{ shape: 'x', status: 404, ok: false, note: 'n' }] }) })
  const r = await t.audio.speak({ provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.5-tts', text: 'a' })
  assert.equal(r.code, 'no-way')
  ok('no way works: it says so')
}
{
  const calls = []
  const api = { run: async (a) => { calls.push([a.kind, a.model, a.sample ? 'sample' : 'no sample', a.keepAudio ? 'keep' : '']); return a.kind === 'speak' ? Object.defineProperty({ ok: true, family: 'chat-assistant-text', tried: [] }, 'audio', { value: wav, enumerable: false }) : { ok: true, family: 'chat-input-audio-base64', tried: [{ ok: true, note: 'recognised "test"' }] } } }
  const audio = createModelsAudio({ providers: () => providers, credential: async () => KEY, api })
  const r = await audio.check({ provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.5-asr' })
  assert.deepEqual(calls, [['speak', 'mimo-v2.5-tts', 'no sample', 'keep'], ['listen', 'mimo-v2.5-asr', 'sample', '']])
  assert.equal(r.family, 'chat-input-audio-base64')
  assert.equal(r.sampleFrom, 'chat-assistant-text')
  assert.equal(audio.known('xiaomi-token-plan-ams', 'mimo-v2.5-asr'), 'chat-input-audio-base64')
  assert.equal(JSON.stringify(r).includes(KEY), false)
  ok('checking a listening model feeds it real speech made by a speaking model of the same provider (never one that needs a reference voice), and remembers the way')
}
console.log('\nkybernos models-audio: ' + n + ' checks')
