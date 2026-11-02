// A model that reads pictures whose route never says so: the entry gets `input: ['text', 'image']`, and nothing else is touched.
//
//   node packages/kybernos-models/test-image-heal.mjs
import assert from 'node:assert/strict'
import { bareId, visionOf, healPlan, healImages, llmView } from './image-heal.mjs'

let n = 0
const ok = (label, fn) => Promise.resolve(fn()).then(() => { n += 1; console.log('  ✓ ' + label) })

// What models.dev says (the shape of kbMdLoad's index: `vision` per entry, by "provider/id").
const index = () => ({
  byKey: {
    'requesty/kimi-k3.1-pro': { vision: true },
    'novita-ai/moonshotai/kimi-k3.1-pro': { vision: true },
    'zenmux/moonshotai/kimi-k3': { vision: true },
    'openai/gpt-5': { vision: true },
    'deepseek/deepseek-chat': { vision: false },
    'a/dual': { vision: true },
    'b/dual': { vision: false },
    'bfl/flux-klein': { vision: true, textOut: false, imageGen: true },
    'g/veo-fast': { vision: true, textOut: false, videoGen: true },
    'v/speaker': { vision: true, textOut: true, tts: true },
    'nvidia/llama-nemotron-embed-vl': { id: 'llama-nemotron-embed-vl', vision: true, textOut: true },
  },
})
const vision = (route, id) => visionOf(index(), route, id)

await ok('vendor spellings of one id meet', () => {
  assert.equal(bareId('k3.1-pro'), 'k3.1-pro')
  assert.equal(bareId('kimi-k3.1-pro'), 'k3.1-pro')
  assert.equal(bareId('moonshotai/Kimi-K3.1-Pro'), 'k3.1-pro')
  assert.equal(bareId(null), '')
})

await ok('models.dev answers by the exact key, then by the bare id when every entry agrees, else it does not know', () => {
  assert.equal(vision('openai', 'gpt-5'), true)
  assert.equal(vision('deepseek', 'deepseek-chat'), false)
  assert.equal(vision('kimi-code-plan-global', 'k3.1-pro'), true, 'a hand-added route spells the id its own way')
  assert.equal(vision('moonshot', 'kimi-k3'), true)
  assert.equal(vision('x', 'dual'), null, 'one provider says yes, another no: no guess')
  assert.equal(vision('x', 'unknown-model'), null)
  assert.equal(vision('deepinfra', 'black-forest-labs/FLUX-Klein'), false, 'a picture generator takes a picture in but is not a chat model')
  assert.equal(vision('deepinfra', 'veo-fast'), false)
  assert.equal(vision('x', 'speaker'), false)
  assert.equal(vision('deepinfra', 'nvidia/llama-nemotron-embed-vl'), false, 'an embedding model is not a chat model')
  assert.equal(visionOf(null, 'x', 'y'), null)
})

// The route as the person's settings hold it: a declared route with its own `models` list.
const declared = {
  value: { providers: { 'kimi-code-plan-global': { models: [{ id: 'k3.1-pro', name: 'K3.1 Pro', contextWindow: 1048576 }, { id: 'old-text', name: 'Old' }] } } },
  user: { providers: { 'kimi-code-plan-global': { api: 'openai-completions', models: [{ id: 'k3.1-pro', name: 'K3.1 Pro', contextWindow: 1048576 }, { id: 'old-text', name: 'Old' }] } } },
}

await ok('a declared route is rewritten whole from the user layer, only the model that sees gains its input', () => {
  const plan = healPlan(declared, vision)
  assert.equal(plan.length, 1)
  assert.deepEqual(plan[0].ids, ['k3.1-pro'])
  const [op] = plan[0].ops
  assert.deepEqual(op.path, ['providers', 'kimi-code-plan-global', 'models'])
  assert.deepEqual(op.value[0], { id: 'k3.1-pro', name: 'K3.1 Pro', contextWindow: 1048576, input: ['text', 'image'] })
  assert.deepEqual(op.value[1], { id: 'old-text', name: 'Old' }, 'a model models.dev does not know stays as it is')
  assert.equal(declared.user.providers['kimi-code-plan-global'].models[0].input, undefined, 'the settings read is not mutated')
})

await ok('an explicit input is never touched, text-only included, nor a route that has a defaultInput', () => {
  const explicit = structuredClone(declared)
  explicit.user.providers['kimi-code-plan-global'].models[0].input = ['text']
  assert.deepEqual(healPlan(explicit, vision), [])
  const routed = structuredClone(declared)
  routed.value.providers['kimi-code-plan-global'].defaultInput = ['text']
  assert.deepEqual(healPlan(routed, vision), [])
})

await ok('the route another feature rewrites on every sync is left alone', () => {
  const managed = { value: { providers: { kybernos: { models: [{ id: 'gpt-5' }] } } }, user: { providers: { kybernos: { models: [{ id: 'gpt-5' }] } } } }
  assert.deepEqual(healPlan(managed, vision), [])
})

await ok('a model that only the base layer lists cannot be rewritten from here and is left alone', () => {
  const inherited = { value: declared.value, user: { providers: {} } }
  assert.deepEqual(healPlan(inherited, vision), [])
})

await ok('a catalogue route completes only the overrides the person already has', () => {
  const view = {
    value: { providers: { moonshot: {} } },
    user: { providers: { moonshot: { modelOverrides: { 'kimi-k3': { contextWindow: 256000 }, 'kimi-k2': { input: ['text'] }, 'deepseek-chat': { name: 'x' } } } } },
  }
  const plan = healPlan(view, vision)
  assert.equal(plan.length, 1)
  assert.deepEqual(plan[0].ids, ['kimi-k3'])
  assert.deepEqual(plan[0].ops, [{ op: 'set', path: ['providers', 'moonshot', 'modelOverrides', 'kimi-k3', 'input'], value: ['text', 'image'] }])
})

await ok('the namespace is found however the service words its answer', () => {
  const entry = { ns: 'llm-pi-ai', value: {}, user: {} }
  assert.equal(llmView([entry]), entry)
  assert.equal(llmView({ value: { namespaces: [{ ns: 'x' }, entry] } }), entry)
  assert.equal(llmView({ value: { namespaces: [] } }), null)
  assert.equal(llmView(null), null)
})

const fakeSettings = (view, { failOn } = {}) => {
  const writes = []
  return {
    writes,
    describe: async () => ({ value: { namespaces: [{ ns: 'other' }, { ns: 'llm-pi-ai', ...view }] } }),
    mutate: async (ns, ops, revision) => {
      if (failOn !== undefined && ops[0].path[1] === failOn) throw new Error('refused')
      writes.push({ ns, ops, revision })
      return { ok: true }
    },
  }
}

await ok('a pass writes each route in its own mutation and journals it', async () => {
  const settings = fakeSettings(declared)
  const lines = []
  const out = await healImages({ settings, index: index(), journal: (l) => lines.push(l) })
  assert.deepEqual(out.healed, [{ route: 'kimi-code-plan-global', ids: ['k3.1-pro'] }])
  assert.equal(settings.writes.length, 1)
  assert.equal(settings.writes[0].ns, 'llm-pi-ai')
  assert.deepEqual(lines, [{ kind: 'image-heal', route: 'kimi-code-plan-global', ids: ['k3.1-pro'], ok: true }])
  // A second pass over what was written plans nothing: the entry now has its input.
  const after = structuredClone(declared)
  after.user.providers['kimi-code-plan-global'].models = settings.writes[0].ops[0].value
  assert.deepEqual(healPlan(after, vision), [])
})

await ok('a refused write is reported and does not stop the other routes', async () => {
  const view = { value: { providers: { ...declared.value.providers, other: { models: [{ id: 'gpt-5' }] } } }, user: { providers: { ...declared.user.providers, other: { models: [{ id: 'gpt-5' }] } } } }
  const settings = fakeSettings(view, { failOn: 'kimi-code-plan-global' })
  const out = await healImages({ settings, index: index() })
  assert.deepEqual(out.failed, [{ route: 'kimi-code-plan-global', error: 'refused' }])
  assert.deepEqual(out.healed, [{ route: 'other', ids: ['gpt-5'] }])
})

await ok('no settings service, no index, an unreadable namespace: nothing is written and nothing throws', async () => {
  assert.equal((await healImages({ settings: null, index: index() })).skipped, 'settings')
  assert.equal((await healImages({ settings: fakeSettings(declared), index: null })).skipped, 'index')
  assert.equal((await healImages({ settings: { describe: async () => { throw new Error('x') }, mutate: async () => {} }, index: index() })).skipped, 'describe')
  assert.equal((await healImages({ settings: { describe: async () => [], mutate: async () => {} }, index: index() })).skipped, 'namespace')
})

console.log(n + ' checks passed')
