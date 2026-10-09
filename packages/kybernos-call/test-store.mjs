// kybernos-call: what a call remembers on disk (call-store.mjs): the settings, the secrets, the clone registry.
// A temporary DSH_HOME; no DSH, no network.
//
//   node packages/kybernos-call/test-store.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, KEY_SPECS, createStore } from './call-store.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const home = mkdtempSync(join(tmpdir(), 'kybernos-call-store-'))
const put = (rel, text) => { const f = join(home, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); return f }
const store = createStore({ dshHome: async () => home, now: () => '2026-10-08T12:00:00.000Z' })
const SECRET = 's'.repeat(40)

try {
  console.log('kybernos-call store: settings')
  assert.deepEqual(await store.readSettings(), DEFAULT_SETTINGS)
  ok('with nothing on disk the settings are the defaults (auto language, voice, 5 min of silence, 60 min, nothing sent to a clone provider)')

  let r = await store.writeSettings({ language: 'es', silenceMinutes: 10, cloneUpload: true })
  assert.equal(r.ok, true)
  assert.deepEqual(r.settings, Object.assign({}, DEFAULT_SETTINGS, { language: 'es', silenceMinutes: 10, cloneUpload: true }))
  assert.deepEqual(await store.readSettings(), r.settings)
  ok('a patch changes only what it names and survives a re-read')
  assert.equal((statSync(join(home, 'kybernos/kybernos-call/settings.json')).mode & 0o777), 0o600)
  assert.deepEqual(readdirSync(join(home, 'kybernos/kybernos-call')).filter((f) => f.includes('.tmp-')), [])
  ok('the file is private (0600) and no temporary file is left behind')

  r = await store.writeSettings({ defaultVoice: { engine: 'say', voice: 'Eddy (English (UK))', lang: 'EN-gb' } })
  assert.deepEqual(r.settings.defaultVoice, { engine: 'say', voice: 'Eddy (English (UK))', lang: 'en' })
  r = await store.writeSettings({ defaultVoice: { engine: 'say', voice: 'Amélie', lang: 'fr' } })
  assert.deepEqual(r.settings.defaultVoice, { engine: 'say', voice: 'Amélie', lang: 'fr' }) // an accented name is a voice too
  r = await store.writeSettings({ defaultVoice: null })
  assert.equal(r.settings.defaultVoice, null)
  ok('the default voice of a call without a member is an engine voice (language cut to two letters), or none')

  const before = await store.readSettings()
  const bad = await store.writeSettings({ language: 'Klingon!', mode: 'hologram', silenceMinutes: 0, maxMinutes: 9999, defaultVoice: { engine: 'x', voice: '../etc' }, cloneUpload: 'yes', other: 1 })
  assert.equal(bad.ok, false)
  assert.deepEqual(Object.keys(bad.refused).sort(), ['cloneUpload', 'defaultVoice', 'language', 'maxMinutes', 'mode', 'other', 'silenceMinutes'])
  assert.deepEqual(await store.readSettings(), before)
  ok('every bad value is named and refused, and nothing at all is written (all or nothing)')
  assert.equal((await store.writeSettings({ language: 'auto', mode: 'video', silenceMinutes: 1, maxMinutes: 240 })).ok, true)
  assert.equal((await store.writeSettings({ silenceMinutes: 61 })).ok, false)
  assert.equal((await store.writeSettings({ silenceMinutes: 1.5 })).ok, false)
  assert.equal((await store.writeSettings({ maxMinutes: 4 })).ok, false)
  ok('the bounds are inclusive and whole numbers only')

  put('kybernos/kybernos-call/settings.json', JSON.stringify({ language: 'fr', mode: 'rubbish', silenceMinutes: -3, cloneUpload: 1, extra: true }))
  assert.deepEqual(await store.readSettings(), Object.assign({}, DEFAULT_SETTINGS, { language: 'fr' }))
  put('kybernos/kybernos-call/settings.json', 'not json at all')
  assert.deepEqual(await store.readSettings(), DEFAULT_SETTINGS)
  ok('a hand-edited or broken file is read through the same rules: bad values fall back, never an error')

  console.log('kybernos-call store: secrets')
  assert.equal((await store.keysStatus()).LIVEKIT_URL.set, false)
  put('kybernos/livekit.env', '# my call setup\nLIVEKIT_URL="wss://my-app.livekit.cloud"\nLIVEKIT_API_KEY=APIkey123\nLIVEKIT_API_SECRET=' + SECRET + '\nGROQ_API_KEY=gsk_realvalue\nKYBER_TTS=say\nKYBER_LLM=openai/gpt-oss-20b\n')
  let status = await store.keysStatus()
  assert.equal(status.LIVEKIT_URL.set, true)
  assert.equal(status.LIVEKIT_URL.host, 'my-app.livekit.cloud')
  assert.equal(status.GROQ_API_KEY.set, true)
  assert.equal(status.ELEVENLABS_API_KEY.set, false)
  assert.equal(JSON.stringify(status).includes(SECRET), false)
  assert.equal(JSON.stringify(status).includes('gsk_realvalue'), false)
  assert.equal(JSON.stringify(status).includes('APIkey123'), false)
  ok('the status says what is set (and the LiveKit host, to recognise it): never a key, a secret or a token')
  assert.deepEqual(Object.keys(status).sort(), Object.keys(KEY_SPECS).sort())
  ok('and it covers exactly the secrets a call knows')

  r = await store.writeKeys({ ELEVENLABS_API_KEY: 'xi-newkey-123456', GROQ_API_KEY: 'gsk_replaced_value' })
  assert.equal(r.ok, true)
  const file = readFileSync(join(home, 'kybernos/livekit.env'), 'utf8')
  assert.match(file, /^# my call setup$/m)
  assert.match(file, /^KYBER_TTS=say$/m)
  assert.match(file, /^KYBER_LLM=openai\/gpt-oss-20b$/m)
  assert.match(file, /^LIVEKIT_URL="wss:\/\/my-app\.livekit\.cloud"$/m)
  assert.match(file, /^GROQ_API_KEY=gsk_replaced_value$/m)
  assert.match(file, /^ELEVENLABS_API_KEY=xi-newkey-123456$/m)
  assert.equal(file.includes('gsk_realvalue'), false)
  assert.equal(file.endsWith('\n') && !file.endsWith('\n\n'), true)
  assert.equal((statSync(join(home, 'kybernos/livekit.env')).mode & 0o777), 0o600)
  assert.equal(JSON.stringify(r).includes('xi-newkey'), false)
  ok('a secret is replaced or added in place; comments, the worker\'s own KYBER_* lines and the others stay exactly as they were; the file is 0600; the answer repeats nothing')

  r = await store.writeKeys({ ELEVENLABS_API_KEY: '', LIVEAVATAR_API_KEY: null })
  assert.equal(r.ok, true)
  assert.equal(r.status.ELEVENLABS_API_KEY.set, false)
  assert.equal(readFileSync(join(home, 'kybernos/livekit.env'), 'utf8').includes('ELEVENLABS'), false)
  ok('an empty value removes the secret')

  const snapshot = readFileSync(join(home, 'kybernos/livekit.env'), 'utf8')
  r = await store.writeKeys({ GROQ_API_KEY: 'gsk_should_not_land', LIVEKIT_URL: 'ftp://nope', LIVEKIT_API_SECRET: 'short', EVIL: 'x', LIVEAVATAR_SANDBOX: '2' })
  assert.equal(r.ok, false)
  assert.deepEqual(Object.keys(r.refused).sort(), ['EVIL', 'LIVEAVATAR_SANDBOX', 'LIVEKIT_API_SECRET', 'LIVEKIT_URL'])
  assert.equal(readFileSync(join(home, 'kybernos/livekit.env'), 'utf8'), snapshot)
  ok('a bad value, an unknown name or a bad shape refuses the whole patch: the file is untouched')
  for (const injection of ['abc\nKYBER_TTS=groq', 'abc def', 'x'.repeat(400)]) {
    assert.equal((await store.writeKeys({ GROQ_API_KEY: injection })).ok, false, JSON.stringify(injection))
  }
  assert.equal(readFileSync(join(home, 'kybernos/livekit.env'), 'utf8'), snapshot)
  ok('a value with a line break (an attempt to add another setting), a space or an excessive length is refused')

  rmSync(join(home, 'kybernos/livekit.env'))
  r = await store.writeKeys({ LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: SECRET })
  assert.equal(r.ok, true)
  assert.equal(readFileSync(join(home, 'kybernos/livekit.env'), 'utf8'), 'LIVEKIT_URL=ws://127.0.0.1:7880\nLIVEKIT_API_KEY=devkey\nLIVEKIT_API_SECRET=' + SECRET + '\n')
  ok('with no file yet, setting secrets creates it')

  console.log('kybernos-call store: clones')
  assert.deepEqual(await store.readClones(), {})
  const made = await store.setClone('v-1abc-def', { remoteId: 'RemoteVoice123', name: 'Claire' })
  assert.deepEqual(made, { provider: 'elevenlabs', remoteId: 'RemoteVoice123', name: 'Claire', createdAt: '2026-10-08T12:00:00.000Z' })
  assert.deepEqual(Object.keys(await store.readClones()), ['v-1abc-def'])
  assert.equal(JSON.stringify(await store.readClones()).includes('xi-'), false)
  ok('a clone is remembered by its recording id: provider, remote id, name, date, and no key')
  put('kybernos/kybernos-call/clones.json', JSON.stringify({ 'good-id': { provider: 'elevenlabs', remoteId: 'AbCdEf123456' }, '../bad': { provider: 'elevenlabs', remoteId: 'AbCdEf123456' }, 'other': { provider: 'unknown', remoteId: 'AbCdEf123456' }, 'short': { provider: 'elevenlabs', remoteId: 'x' }, 'path': { provider: 'elevenlabs', remoteId: 'a/b/c/d/e/f' } }))
  assert.deepEqual(Object.keys(await store.readClones()), ['good-id'])
  ok('what is read back is checked again: a bad id, an unknown provider or a malformed remote id is dropped')
  await store.setClone('another', { remoteId: 'ZzYyXx987654', name: 'B' })
  assert.deepEqual((await store.deleteClone('good-id')).remoteId, 'AbCdEf123456')
  assert.deepEqual(Object.keys(await store.readClones()), ['another'])
  assert.equal(await store.deleteClone('nope'), null)
  ok('a clone can be forgotten; forgetting an unknown one is harmless')
  assert.equal(existsSync(join(home, 'kybernos/kybernos-call/clones.json')), true)
} finally {
  rmSync(home, { recursive: true, force: true })
}
console.log('\nkybernos-call store: ' + pass + ' checks')
