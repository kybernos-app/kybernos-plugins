// Choosing the model right after a way to one is connected: who is switched, who is left alone, and which model.
// The engine's services are faked: what is tested is the rule, not the engine.
//
//   node packages/kybernos-plugin/test-default-model.mjs
import assert from 'node:assert/strict'
import { pickModel, defaultWorks, selectAfterConnect } from './default-model.mjs'

let n = 0
const ok = async (label, fn) => { await fn(); n += 1; console.log('  ✓ ' + label) }

// A fake engine. `keys` = the credential references that are set; `profileKeys` = provider → its apiKeyEnv.
const engine = ({ routes, current, keys = [], profileKeys = {}, configurable = Object.keys(profileKeys), selectModel = undefined, saveFails = false } = {}) => {
  const saved = []
  const selected = []
  const deps = {
    llm: {
      listProviders: () => Object.keys(routes).map((id) => ({ id, name: id })),
      listModels: async (id) => (routes[id] || []).map((m) => ({ id: m, name: m })),
      listConfigurableProviders: () => configurable.map((p) => ({ provider: p, settingsNs: 'llm-pi-ai', settingsPath: ['providers', p] })),
      resolveCallConfig: async ({ provider, model }) => ({ provider, model }),
    },
    agentDefaultModel: {
      currentSelection: () => ({ ...current }),
      saveSelection: async (s) => { if (saveFails) throw new Error('disk'); saved.push(s); Object.assign(current, s) },
    },
    settings: {
      describe: () => [{ ns: 'llm-pi-ai', value: { providers: Object.fromEntries(Object.entries(profileKeys).map(([p, ref]) => [p, { apiKeyEnv: ref }])) } }],
    },
    credentials: { describe: async (ref) => ({ configured: keys.indexOf(ref) >= 0 }) },
  }
  if (selectModel !== undefined) deps.sessionController = { selectModel: async (r) => { selected.push(r); return selectModel(r) } }
  return { deps, saved, selected, current }
}

await ok('a general-purpose model is picked: newest of the preferred kind, never an embedding or a voice', () => {
  assert.equal(pickModel('anthropic', ['claude-haiku-4-5', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20250514']), 'claude-sonnet-4-5-20250929')
  assert.equal(pickModel('openai', ['text-embedding-3-large', 'gpt-4o-mini', 'gpt-4o', 'whisper-1']), 'gpt-4o')
  assert.equal(pickModel('google', ['gemini-2.5-pro', 'gemini-2.5-flash', 'text-embedding-004']), 'gemini-2.5-flash')
  assert.equal(pickModel('kybernos', ['kybernos/doer', 'kybernos/auto', 'kybernos/free']), 'kybernos/auto')
})

await ok('a route we have no preference for gets its first general-purpose model', () => {
  assert.equal(pickModel('mistral', ['mistral-embed', 'mistral-large', 'mistral-small']), 'mistral-large')
  assert.equal(pickModel('ollama-local', ['qwen3.5:9b']), 'qwen3.5:9b')
})

await ok('only specialised models: the first one is better than none', () => {
  assert.equal(pickModel('x', ['embed-a', 'embed-b']), 'embed-a')
})

await ok('a model the caller asked for is kept when the route offers it, ignored when not', () => {
  assert.equal(pickModel('ollama-local', ['qwen3.5:9b', 'qwen3.5:4b'], 'qwen3.5:4b'), 'qwen3.5:4b')
  assert.equal(pickModel('ollama-local', ['qwen3.5:9b'], 'nope'), 'qwen3.5:9b')
})

await ok('nothing to pick: null', () => {
  assert.equal(pickModel('x', []), null)
  assert.equal(pickModel('x', null), null)
  assert.equal(pickModel('x', [7, '', null]), null)
})

await ok('a default whose key is not set cannot work; one whose key is set can', async () => {
  const none = engine({ routes: { xiaomi: ['mimo'] }, current: { provider: 'xiaomi', model: 'mimo' }, profileKeys: { xiaomi: 'XIAOMI_API_KEY' } })
  assert.equal(await defaultWorks(none.deps), false)
  const set = engine({ routes: { xiaomi: ['mimo'] }, current: { provider: 'xiaomi', model: 'mimo' }, profileKeys: { xiaomi: 'XIAOMI_API_KEY' }, keys: ['XIAOMI_API_KEY'] })
  assert.equal(await defaultWorks(set.deps), true)
})

await ok('a default that is not a routable provider cannot work', async () => {
  const e = engine({ routes: { other: ['m'] }, current: { provider: 'gone', model: 'x' } })
  assert.equal(await defaultWorks(e.deps), false)
})

await ok('a route with no API key reference (an account, a local engine) is taken as working', async () => {
  const e = engine({ routes: { acct: ['m'] }, current: { provider: 'acct', model: 'm' }, configurable: [] })
  assert.equal(await defaultWorks(e.deps), true)
})

await ok('the default is switched to the connected provider when it could not answer', async () => {
  const e = engine({ routes: { xiaomi: ['mimo'], kybernos: ['kybernos/doer', 'kybernos/auto'] }, current: { provider: 'xiaomi', model: 'mimo' }, profileKeys: { xiaomi: 'XIAOMI_API_KEY' } })
  const r = await selectAfterConnect(e.deps, { provider: 'kybernos' })
  assert.deepEqual(r, { ok: true, switched: true, provider: 'kybernos', model: 'kybernos/auto', scope: 'default' })
  assert.deepEqual(e.saved, [{ provider: 'kybernos', model: 'kybernos/auto' }])
})

await ok('a default that works is left alone', async () => {
  const e = engine({ routes: { xiaomi: ['mimo'], kybernos: ['kybernos/auto'] }, current: { provider: 'xiaomi', model: 'mimo' }, profileKeys: { xiaomi: 'XIAOMI_API_KEY' }, keys: ['XIAOMI_API_KEY'] })
  const r = await selectAfterConnect(e.deps, { provider: 'kybernos' })
  assert.deepEqual(r, { ok: true, switched: false, reason: 'default-works' })
  assert.deepEqual(e.saved, [])
})

await ok('from a chat, that chat is switched through the engine\'s own selection, which saves the default', async () => {
  const e = engine({ routes: { xiaomi: ['mimo'], 'ollama-local': ['qwen3.5:9b'] }, current: { provider: 'xiaomi', model: 'mimo' }, profileKeys: { xiaomi: 'K' }, selectModel: () => ({ ok: true }) })
  const r = await selectAfterConnect(e.deps, { provider: 'ollama-local', model: 'qwen3.5:9b', sessionId: 'session-1' })
  assert.deepEqual(r, { ok: true, switched: true, provider: 'ollama-local', model: 'qwen3.5:9b', scope: 'session' })
  assert.deepEqual(e.selected, [{ sessionId: 'session-1', provider: 'ollama-local', model: 'qwen3.5:9b' }])
  assert.deepEqual(e.saved, [], 'the default is saved by the engine\'s selection, not twice')
})

await ok('a chat that refuses the selection still gets the default saved', async () => {
  const e = engine({ routes: { xiaomi: ['mimo'], kybernos: ['kybernos/auto'] }, current: { provider: 'xiaomi', model: 'mimo' }, profileKeys: { xiaomi: 'K' }, selectModel: () => ({ ok: false, error: { message: 'busy' } }) })
  const r = await selectAfterConnect(e.deps, { provider: 'kybernos', sessionId: 'session-1' })
  assert.equal(r.scope, 'default')
  assert.deepEqual(e.saved, [{ provider: 'kybernos', model: 'kybernos/auto' }])
})

await ok('a chat that throws on the selection still gets the default saved', async () => {
  const e = engine({ routes: { xiaomi: ['mimo'], kybernos: ['kybernos/auto'] }, current: { provider: 'xiaomi', model: 'mimo' }, profileKeys: { xiaomi: 'K' }, selectModel: () => { throw new Error('not resumed') } })
  const r = await selectAfterConnect(e.deps, { provider: 'kybernos', sessionId: 'session-1' })
  assert.equal(r.scope, 'default')
})

await ok('from a chat that just failed, the model is taken even if the default would have worked (force)', async () => {
  const e = engine({ routes: { xiaomi: ['mimo'], kybernos: ['kybernos/auto'] }, current: { provider: 'xiaomi', model: 'mimo' }, profileKeys: { xiaomi: 'K' }, keys: ['K'], selectModel: () => ({ ok: true }) })
  const without = await selectAfterConnect(e.deps, { provider: 'kybernos', sessionId: 's' })
  assert.equal(without.switched, false)
  const withForce = await selectAfterConnect(e.deps, { provider: 'kybernos', sessionId: 's', force: true })
  assert.equal(withForce.switched, true)
  const noSession = await selectAfterConnect(e.deps, { provider: 'kybernos', force: true })
  assert.equal(noSession.switched, false, 'force means nothing without a chat')
})

await ok('a provider that is not routable, or has no model, switches nothing', async () => {
  const e = engine({ routes: { xiaomi: ['mimo'], empty: [] }, current: { provider: 'xiaomi', model: 'mimo' }, profileKeys: { xiaomi: 'K' } })
  assert.deepEqual(await selectAfterConnect(e.deps, { provider: 'nowhere' }), { ok: true, switched: false, reason: 'provider-not-routable' })
  assert.deepEqual(await selectAfterConnect(e.deps, { provider: 'empty' }), { ok: true, switched: false, reason: 'no-model' })
  assert.deepEqual(e.saved, [])
})

await ok('bad input and missing services answer a code, never throw', async () => {
  const e = engine({ routes: { a: ['m'] }, current: { provider: 'a', model: 'm' } })
  for (const bad of [null, undefined, {}, { provider: '' }, { provider: '../x' }, { provider: 'a b' }, { provider: 'x'.repeat(100) }, { provider: 7 }]) {
    assert.deepEqual(await selectAfterConnect(e.deps, bad), { ok: false, error: 'bad-provider' }, JSON.stringify(bad))
  }
  assert.deepEqual(await selectAfterConnect({}, { provider: 'a' }), { ok: false, error: 'services-unavailable' })
  assert.deepEqual(await selectAfterConnect(null, { provider: 'a' }), { ok: false, error: 'services-unavailable' })
})

await ok('a failing save is reported as a failure, not swallowed', async () => {
  const e = engine({ routes: { xiaomi: ['mimo'], kybernos: ['kybernos/auto'] }, current: { provider: 'xiaomi', model: 'mimo' }, profileKeys: { xiaomi: 'K' }, saveFails: true })
  assert.deepEqual(await selectAfterConnect(e.deps, { provider: 'kybernos' }), { ok: false, error: 'selection-failed' })
})

console.log(n + ' checks passed')
