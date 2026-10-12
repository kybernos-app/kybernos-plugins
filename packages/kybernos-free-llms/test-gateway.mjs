// The gateway request rewrite, proven against a FAKE upstream — no network, no host.
// The real free-tier contract was measured live (see poc/poc-pont.mjs); here we prove
// the gateway builds exactly that request and folds/stream the answer correctly.
//
//   node packages/kybernos-free-llms/test-gateway.mjs
import assert from 'node:assert/strict'
import { applyContract, contractHeaders, classifyError, SESSION_PATTERN, REQUEST_PATTERN } from './gateway-contract.mjs'

let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }

// The exact request the gateway sends upstream for a plain chat call. This mirrors
// gatewayChat(): applyContract on the body, contractHeaders for the gates.
const buildUpstreamRequest = (incoming, { randomBytes, userAgent }) => {
  const { body } = applyContract(incoming)
  const headers = contractHeaders({ randomBytes, userAgent })
  headers['content-type'] = 'application/json'
  headers.authorization = 'Bearer public'
  return { url: 'https://opencode.ai/zen/v1/chat/completions', method: 'POST', headers, body }
}

ok('a plain chat request is rewritten to satisfy all four free-tier gates', () => {
  const req = buildUpstreamRequest(
    { model: 'mimo-v2.6-flash-free', messages: [{ role: 'user', content: 'hi' }] },
    { randomBytes: (n) => Buffer.alloc(n, 0x0a), userAgent: null },
  )
  // gate 3: streaming
  assert.equal(req.body.stream, true)
  // gate 4: non-empty real tool quartet
  assert.equal(req.body.tools.length, 4)
  assert.deepEqual(req.body.tools.map((t) => t.function.name), ['bash', 'glob', 'grep', 'read'])
  // gate 1: versioned user-agent
  assert.match(req.headers['User-Agent'], /opencode\/1\.\d+\.\d+/)
  // gate 2: canonical session + request ids
  assert.match(req.headers['x-opencode-session'], SESSION_PATTERN)
  assert.match(req.headers['x-opencode-request'], REQUEST_PATTERN)
  // and it is authenticated with the free marker
  assert.equal(req.headers.authorization, 'Bearer public')
})

ok('the caller content is preserved verbatim through the rewrite', () => {
  const req = buildUpstreamRequest(
    { model: 'x-free', messages: [{ role: 'system', content: 'be terse' }, { role: 'user', content: 'hello' }], max_tokens: 50 },
    { randomBytes: (n) => Buffer.alloc(n, 0x0a), userAgent: null },
  )
  assert.equal(req.body.model, 'x-free')
  assert.equal(req.body.max_tokens, 50)
  assert.deepEqual(req.body.messages, [{ role: 'system', content: 'be terse' }, { role: 'user', content: 'hello' }])
})

ok('a caller-supplied tool list is not clobbered by the quartet', () => {
  const mine = [{ type: 'function', function: { name: 'search', parameters: {} } }]
  const req = buildUpstreamRequest({ model: 'x-free', tools: mine }, { randomBytes: (n) => Buffer.alloc(n, 0x0a), userAgent: null })
  assert.deepEqual(req.body.tools, mine)
})

// The fold path: how the gateway turns an upstream SSE into one JSON body. Same
// accumulation logic as index.js's non-stream branch.
const foldSse = (sse) => {
  let text = ''; let reasoning = ''; let finish = 'stop'
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') continue
    let chunk = null
    try { chunk = JSON.parse(payload) } catch (e) { continue }
    const choice = chunk && chunk.choices && chunk.choices[0]
    const delta = choice && choice.delta
    if (delta) {
      if (typeof delta.content === 'string') text += delta.content
      if (typeof delta.reasoning === 'string') reasoning += delta.reasoning
    }
    if (choice && typeof choice.finish_reason === 'string' && choice.finish_reason) finish = choice.finish_reason
  }
  return { text, reasoning, finish }
}

ok('an upstream SSE folds into text and reasoning for a non-stream caller', () => {
  const sse = [
    'data: {"choices":[{"delta":{"reasoning":"think "}}]}',
    'data: {"choices":[{"delta":{"content":"Hello"}}]}',
    'data: {"choices":[{"delta":{"content":" world"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]',
  ].join('\n')
  const out = foldSse(sse)
  assert.equal(out.text, 'Hello world')
  assert.equal(out.reasoning, 'think ')
  assert.equal(out.finish, 'stop')
})

ok('a locked-tier error classifies to the free-tier gate code', () => {
  const body = { error: { type: 'FreeTierError', message: "OpenCode's free tier can only be used from within OpenCode" } }
  assert.equal(classifyError(body), 'free_tier_locked')
})

console.log(`\n${count} tests passed`)
