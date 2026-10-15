// What the first-run wizard asks of this bundle: the recommendation, and the profile that connects a
// pulled model. Both are shared with the panel's own « Connect » button, so one test covers the two.
// The client is one bundle with no relative imports: the parts under test are cut out of it as-is.
//
//   node packages/kybernos-modeles-locaux/test-seam.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  assert.ok(a >= 0 && b > a, 'cannot find ' + from + ' … ' + to)
  return src.slice(a, b)
}
const code = cut("const KB_NS = ", '// ── i18n minimal') + '\n' + cut('const kbBuildProfile = ', '// ── accès services') +
  '\nexport { CATALOGUE, ROUTE_LOCALE, BASE_LOCALE, kbBuildProfile, kbRecommend }'
const mod = await import('data:text/javascript,' + encodeURIComponent(code))

let n = 0
const ok = (label, fn) => { fn(); n += 1; console.log('  ✓ ' + label) }

ok('the recommendation is the first entry of the catalogue (ordered by preference) that fits the memory measured', () => {
  assert.equal(mod.kbRecommend(32).id, 'qwen3.5:9b')
  assert.equal(mod.kbRecommend(16).id, 'qwen3.5:9b')
  assert.equal(mod.kbRecommend(8).id, 'qwen3.5:4b')
  assert.equal(mod.kbRecommend(4).id, 'gemma3:1b') // the 2B Qwen is 2.7 GB: it needs 8 GB; a 4 GB machine gets the 1B
})

ok('an unmeasured machine gets the first entry, and one too small for anything gets none', () => {
  assert.equal(mod.kbRecommend(null).id, mod.CATALOGUE[0].id)
  assert.equal(mod.kbRecommend(undefined).id, mod.CATALOGUE[0].id)
  assert.equal(mod.kbRecommend(1), null)
})

ok('a first connection builds the whole route: protocol, address, a key reference and the model', () => {
  const mod9 = mod.CATALOGUE.find((m) => m.id === 'qwen3.5:9b')
  const prof = mod.kbBuildProfile(null, mod9)
  assert.equal(prof.api, 'openai-completions')
  assert.equal(prof.baseURL, mod.BASE_LOCALE)
  assert.equal(prof.apiKeyEnv, 'OLLAMA_LOCAL_API_KEY')
  assert.equal(prof.models.length, 1)
  assert.equal(prof.models[0].id, 'qwen3.5:9b')
  assert.equal(prof.models[0].contextWindow, 32768)
  assert.deepEqual(prof.models[0].reasoningEfforts, { off: 'none', low: 'low', medium: 'medium', high: 'high' })
  assert.deepEqual(prof.models[0].compat, { supportsReasoningEffort: true })
})

ok('a model that does not « think » gets no reasoning levels', () => {
  const gemma = mod.CATALOGUE.find((m) => m.id === 'gemma4:e4b')
  const entry = mod.kbBuildProfile(null, gemma).models[0]
  assert.equal(entry.reasoningEfforts, undefined)
  assert.equal(entry.compat, undefined)
  assert.deepEqual(entry.input, ['text', 'image', 'audio'])
})

ok('connecting a second model keeps the first, and the user\'s own settings', () => {
  const first = mod.kbBuildProfile(null, mod.CATALOGUE.find((m) => m.id === 'qwen3.5:4b'))
  first.baseURL = 'http://192.168.1.20:11434/v1'
  first.models[0].contextWindow = 8192
  const next = mod.kbBuildProfile(first, mod.CATALOGUE.find((m) => m.id === 'qwen3.5:9b'))
  assert.equal(next.baseURL, 'http://192.168.1.20:11434/v1')
  assert.deepEqual(next.models.map((m) => m.id), ['qwen3.5:4b', 'qwen3.5:9b'])
  assert.equal(next.models[0].contextWindow, 8192)
})

ok('connecting the same model twice does not duplicate it', () => {
  const m9 = mod.CATALOGUE.find((m) => m.id === 'qwen3.5:9b')
  const once = mod.kbBuildProfile(null, m9)
  const twice = mod.kbBuildProfile(once, m9)
  assert.deepEqual(twice.models.map((m) => m.id), ['qwen3.5:9b'])
})

ok('the profile passed in is never modified', () => {
  const existing = { api: 'openai-completions', baseURL: mod.BASE_LOCALE, apiKeyEnv: 'K', models: [{ id: 'x' }] }
  const frozen = JSON.stringify(existing)
  mod.kbBuildProfile(existing, mod.CATALOGUE[0])
  assert.equal(JSON.stringify(existing), frozen)
})

console.log(n + ' checks passed')
