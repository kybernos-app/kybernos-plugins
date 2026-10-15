// The free-tier request contract, the profile builder and the activation rules —
// all pure, so every rule is proven here without a network call or a host.
//
//   node packages/kybernos-free-llms/test-contract.mjs
import assert from 'node:assert/strict'
import {
  OPENCODE_USER_AGENT, SESSION_PATTERN, REQUEST_PATTERN,
  userAgentOk, canonicalId, applyContract, contractHeaders, classifyError,
} from './gateway-contract.mjs'
import { PROVIDER_ID, BASE_URL, buildProfile, profileSummary } from './profile.mjs'
import {
  defaultFreeLlmState, shouldAutoEnable, recordEnable, recordDisable, publicView,
} from './free-llm-state.mjs'

let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }

// Deterministic bytes so canonicalId is reproducible in tests.
const bytes = (fill) => Buffer.alloc(20, fill)

// ── gateway contract ──────────────────────────────────────────────────────
ok('a versioned opencode user-agent passes, bare or cli forms do not', () => {
  assert.equal(userAgentOk(OPENCODE_USER_AGENT), true)
  assert.equal(userAgentOk('opencode/1.17.0'), true)
  assert.equal(userAgentOk('opencode/1.16.0'), false) // upstream answers 426 below 1.17
  assert.equal(userAgentOk('opencode-cli/1.0.0'), false) // no parsable version
  assert.equal(userAgentOk('curl/8.5.0'), false)
  assert.equal(userAgentOk(undefined), false)
})

ok('canonical ids match the exact shape the upstream validates', () => {
  assert.match(canonicalId('ses_', bytes(0x0a)), SESSION_PATTERN)
  assert.match(canonicalId('msg_', bytes(0x0a)), REQUEST_PATTERN)
  assert.equal(canonicalId('ses_', bytes(0x0a)), canonicalId('ses_', bytes(0x0a)), 'same bytes, same id')
  assert.notEqual(canonicalId('ses_', bytes(0x0a)), canonicalId('ses_', bytes(0x0b)))
})

ok('the contract forces streaming and adds the tool quartet when none are sent', () => {
  const { body, addedTools } = applyContract({ model: 'm', messages: [] })
  assert.equal(body.stream, true)
  assert.equal(addedTools, true)
  assert.equal(body.tools.length, 4)
  assert.deepEqual(body.tools.map((t) => t.function.name), ['bash', 'glob', 'grep', 'read'])
  assert.equal(body.tool_choice, 'none')
})

ok('a caller own tools are kept verbatim and no tool_choice is imposed', () => {
  const mine = [{ type: 'function', function: { name: 'search', parameters: {} } }]
  const { body, addedTools } = applyContract({ model: 'm', tools: mine })
  assert.equal(addedTools, false)
  assert.deepEqual(body.tools, mine)
  assert.equal('tool_choice' in body, false)
  assert.equal(body.stream, true)
})

ok('applying the contract twice does not duplicate the quartet', () => {
  const once = applyContract({ model: 'm' }).body
  const twice = applyContract(once).body
  assert.equal(twice.tools.length, 4)
})

ok('contract headers always mint session and request ids and repair a bad UA', () => {
  const h = contractHeaders({ randomBytes: (n) => bytes(0x0a), userAgent: 'curl/8.5.0' })
  assert.equal(h['User-Agent'], OPENCODE_USER_AGENT)
  assert.match(h['x-opencode-session'], SESSION_PATTERN)
  assert.match(h['x-opencode-request'], REQUEST_PATTERN)
  assert.equal(h['x-opencode-client'], 'cli')
})

ok('a good caller UA is preserved in the headers', () => {
  const h = contractHeaders({ randomBytes: (n) => bytes(0x0a), userAgent: 'opencode/1.18.31' })
  assert.equal(h['User-Agent'], 'opencode/1.18.31')
})

ok('upstream errors classify to stable codes', () => {
  assert.equal(classifyError({ error: { type: 'FreeTierError', message: 'x' } }), 'free_tier_locked')
  assert.equal(classifyError({ error: { type: 'ModelProtocolUnsupported', message: 'x' } }), 'model_protocol_unsupported')
  assert.equal(classifyError({ error: { type: 'ModelNotFound', message: 'x' } }), 'model_unknown')
  assert.equal(classifyError({ error: { type: 'E', message: 'Rate limit hit' } }), 'rate_limited')
  assert.equal(classifyError({ error: { type: 'E', message: 'boom' } }), 'upstream_error')
  assert.equal(classifyError(null), null)
})

// ── profile builder ───────────────────────────────────────────────────────
ok('the profile points at the local gateway and exposes only the given models', () => {
  const p = buildProfile({ models: ['a-free', 'b-free'] })
  assert.equal(p.api, 'openai-completions')
  assert.equal(p.baseURL, BASE_URL)
  assert.equal(p.models.length, 2)
  assert.deepEqual(p.models.map((m) => m.id), ['a-free', 'b-free'])
  assert.equal(p.models[0].input[0], 'text')
})

ok('empty or bad model ids are dropped and a base override is honoured', () => {
  const p = buildProfile({ models: ['ok', '', null, 42], baseURL: 'http://127.0.0.1:9999/v1' })
  assert.deepEqual(p.models.map((m) => m.id), ['ok'])
  assert.equal(p.baseURL, 'http://127.0.0.1:9999/v1')
})

ok('an existing profile keeps its non-model fields on rebuild', () => {
  const p = buildProfile({ models: ['x-free'], existing: { displayName: 'Custom', retryPolicy: { mode: 'normal' } } })
  assert.equal(p.displayName, 'Free LLMs', 'display name is ours')
  assert.deepEqual(p.retryPolicy, { mode: 'normal' }, 'unrelated field survives')
})

ok('profile summary reports only what the panel shows', () => {
  const s = profileSummary(buildProfile({ models: ['a-free'] }))
  assert.equal(s.baseURL, BASE_URL)
  assert.deepEqual(s.models, ['a-free'])
  assert.deepEqual(profileSummary(null), { baseURL: null, models: [] })
})

ok('the provider id and namespace are the ones settings.mutate uses', () => {
  assert.equal(PROVIDER_ID, 'opencode-free')
})

// ── activation rules ──────────────────────────────────────────────────────
const NOW = new Date('2026-10-12T00:00:00.000Z')

ok('a fresh install is unwired and unacknowledged', () => {
  const s = defaultFreeLlmState(NOW)
  assert.equal(s.wired, false)
  assert.equal(s.acknowledged, false)
  assert.equal(s.enabledAt, null)
  assert.equal(publicView(s).wired, false)
})

ok('auto-enable only fires with no own model AND an acknowledgement', () => {
  const s = defaultFreeLlmState(NOW)
  assert.equal(shouldAutoEnable(s, { hasOwnModel: false, acknowledged: true }), true)
  assert.equal(shouldAutoEnable(s, { hasOwnModel: false, acknowledged: false }), false, 'silent-on is refused')
  assert.equal(shouldAutoEnable(s, { hasOwnModel: true, acknowledged: true }), false, 'never overrides a user model')
})

ok('auto-enable is a no-op once already wired', () => {
  const s = recordEnable(defaultFreeLlmState(NOW), { acknowledged: true, auto: true }, NOW)
  assert.equal(shouldAutoEnable(s, { hasOwnModel: false, acknowledged: true }), false)
})

ok('enabling records the acknowledgement and stamps the date', () => {
  const s = recordEnable(defaultFreeLlmState(NOW), { acknowledged: true, auto: true }, NOW)
  assert.equal(s.wired, true)
  assert.equal(s.acknowledged, true)
  assert.equal(s.autoEnabled, true)
  assert.equal(s.enabledAt, NOW.toISOString())
  assert.equal(publicView(s).autoEnabled, true)
})

ok('disabling unwires but keeps the acknowledgement', () => {
  const on = recordEnable(defaultFreeLlmState(NOW), { acknowledged: true }, NOW)
  const off = recordDisable(on)
  assert.equal(off.wired, false)
  assert.equal(off.autoEnabled, false)
  assert.equal(off.acknowledged, true, 'the notice is not re-asked on every toggle')
})

console.log(`\n${count} tests passed`)
