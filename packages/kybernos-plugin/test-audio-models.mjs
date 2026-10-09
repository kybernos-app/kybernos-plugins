// The models of the user's providers that can listen, speak or hold a realtime voice conversation (audio-models.mjs).
import assert from 'node:assert/strict'
import { audioKindOf, audioModelsOf } from './audio-models.mjs'

let n = 0
const ok = (label) => { n += 1; console.log('  ✓ ' + label) }
console.log('kybernos audio-models')
for (const [id, kind] of [
  ['qwen-audio-3.0-asr-flash', 'listen'], ['qwen-audio-3.0-tts-plus', 'speak'], ['qwen-audio-3.0-realtime-plus', 'realtime'],
  ['whisper-large-v3-turbo', 'listen'], ['paraformer-realtime-v2', 'listen'], ['gpt-4o-realtime-preview', 'realtime'], ['qwen-tts-realtime', 'speak'], ['cosyvoice-v2', 'speak'], ['gpt-4o-mini-tts', 'speak'], ['gpt-4o-transcribe', 'listen'],
  ['qwen3.8-flash', null], ['qwen3.8-max', null], ['deepseek-v4.1-flash', null], ['qwen-image-3.0-pro', null], ['wan2.7-image', null], ['happyhorse-1.1-r2v', null], ['glm-5.3', null], ['', null]
]) assert.equal(audioKindOf(id), kind, id)
assert.equal(audioKindOf(null), null)
ok('model ids are sorted by what their names say: listen, speak, realtime, or none (text and image models are left out)')

const found = audioModelsOf({
  'qwen-token-plan': { apiKeyEnv: 'SECRET_ENV', baseURL: 'https://internal.example/v1', models: [{ id: 'qwen3.8-flash' }, { id: 'qwen-audio-3.0-asr-flash' }, { id: 'qwen-audio-3.0-tts-plus' }, { id: 'qwen-audio-3.0-realtime-plus' }, { id: 'wan2.7-image' }] },
  'vercel-ai-gateway': { models: [{ id: 'minimax/minimax-m2.7-free' }] },
  broken: null,
  odd: { models: 'x' }
})
assert.deepEqual(found, [{ provider: 'qwen-token-plan', models: [{ id: 'qwen-audio-3.0-asr-flash', kind: 'listen' }, { id: 'qwen-audio-3.0-tts-plus', kind: 'speak' }, { id: 'qwen-audio-3.0-realtime-plus', kind: 'realtime' }] }])
assert.equal(JSON.stringify(found).includes('SECRET_ENV'), false)
assert.equal(JSON.stringify(found).includes('internal.example'), false)
ok('only providers with an audio model are listed, with their model ids and kinds, and never a key name or an address')
assert.deepEqual(audioModelsOf(undefined), [])
assert.deepEqual(audioModelsOf('x'), [])
assert.deepEqual(audioModelsOf({}), [])
ok('a missing or odd configuration gives an empty list, never an error')
console.log('\nkybernos audio-models: ' + n + ' checks')
