// The turn runner's own parts: what DSH is told of a turn, and one turn from its claim to its acknowledgement, against a stand-in for the platform and for DSH's routes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'kb-runner-'))
process.env.DSH_HOME = home
process.env.KYBERNOS_API = 'https://api.example.test'
process.env.KYBERNOS_COMPUTER_TOKEN = 'kyd_test_token'
process.env.KYBERNOS_RUNNER_LEASE_SECONDS = '3000'
const { buildPrompt, runOne } = await import('./runner.mjs')

const closed = (sid) => {
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, sid + '.json'), JSON.stringify({ record: { rows: { turnBoundary: { val: { openTurnStartSeq: null } }, sessionStats: { val: { steps: 3 } } } } }))
}

const CONTEXT = {
  kyber: { name: 'Kyber', agents: [] },
  messages: [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'Hi, what can I do?' },
    { role: 'user', content: 'POST {"a":1} to https://hooks.example.test/x' }
  ]
}

/** A platform and a DSH that answer what the runner asks, and record it. */
const standIn = (options = {}) => {
  const calls = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url))
    const body = init.body === undefined ? null : JSON.parse(String(init.body))
    calls.push({ host: u.host, path: u.pathname, body, headers: init.headers ?? {} })
    const json = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
    if (u.host === '127.0.0.1:3081') {
      if (u.pathname === '/kybernos-cloud/turn') return json(200, options.start ?? { ok: true, sessionId: 's-1' })
      if (u.pathname === '/kybernos-cloud/turn/answer') return json(200, options.answer ?? { ok: true, text: 'Posted: HTTP 200.', tools: 1 })
    }
    if (u.pathname.endsWith('/context')) return options.context === null ? json(500, {}) : json(200, options.context ?? CONTEXT)
    if (u.pathname.endsWith('/events') || u.pathname.endsWith('/ack')) return json(200, {})
    return json(404, {})
  }
  return { calls, restore: () => { globalThis.fetch = real } }
}

test('the prompt is the person\'s last message, with the conversation before it as background', () => {
  const p = buildPrompt(CONTEXT)
  assert.match(p, /personal assistant, working on their own cloud computer/)
  assert.match(p, /\[person\]\nhello/)
  assert.match(p, /\[assistant\]\nHi, what can I do\?/)
  assert.match(p, /Their message:\n\nPOST \{"a":1\} to https:\/\/hooks\.example\.test\/x$/)
  assert.equal(buildPrompt({ kyber: { name: 'K' }, messages: [{ role: 'assistant', content: 'x' }] }), null)
  assert.equal(buildPrompt(null), null)
  // A very long message is clipped, never sent whole.
  const long = buildPrompt({ kyber: { name: 'K' }, messages: [{ role: 'user', content: 'x'.repeat(50_000) }] })
  assert.ok(long.length < 6000)
})

test('a turn: context, the session in DSH, its closed turn, the answer, and the acknowledgement with only the answer', async () => {
  closed('s-1')
  const s = standIn()
  try {
    const out = await runOne({ id: 'job-1', next_event_seq: 4 }, { pollMs: 5 })
    assert.equal(out, 'done')
    const post = s.calls.find((c) => c.path === '/kybernos-cloud/turn')
    assert.equal(post.headers.authorization, 'Bearer kyd_test_token')
    assert.equal(post.headers.origin, 'http://127.0.0.1:3081')
    assert.match(post.body.prompt, /POST \{"a":1\}/)
    const events = s.calls.filter((c) => c.path.endsWith('/events')).map((c) => c.body.events[0])
    assert.deepEqual(events.map((e) => [e.seq, e.type]), [[4, 'started'], [5, 'model-call'], [6, 'answered']])
    const ack = s.calls.find((c) => c.path.endsWith('/ack'))
    assert.deepEqual(ack.body, { status: 'done', result: { assistant_message: 'Posted: HTTP 200.' } })
  } finally { s.restore() }
})

test('a turn that cannot be run is acknowledged failed with a code, never with words', async () => {
  const noContext = standIn({ context: null })
  try {
    assert.equal(await runOne({ id: 'job-2' }, { pollMs: 5 }), 'context_unavailable')
    assert.deepEqual(noContext.calls.find((c) => c.path.endsWith('/ack')).body, { status: 'failed', error: 'context_unavailable' })
  } finally { noContext.restore() }

  const noSession = standIn({ start: { ok: false, error: 'unavailable' } })
  try {
    assert.equal(await runOne({ id: 'job-3' }, { pollMs: 5 }), 'dsh_failed')
    assert.deepEqual(noSession.calls.find((c) => c.path.endsWith('/ack')).body, { status: 'failed', error: 'dsh_failed' })
  } finally { noSession.restore() }

  closed('s-1')
  const empty = standIn({ answer: { ok: true, text: '  ', tools: 0 } })
  try {
    assert.equal(await runOne({ id: 'job-4' }, { pollMs: 5 }), 'empty_answer')
    assert.deepEqual(empty.calls.find((c) => c.path.endsWith('/ack')).body, { status: 'failed', error: 'empty_answer' })
  } finally { empty.restore() }

  // When DSH said what ended it, the code goes with the failure (and only a code).
  closed('s-1')
  const why = standIn({ answer: { ok: true, text: '', tools: 0, failure: 'turn_error.model_not_found' } })
  try {
    assert.equal(await runOne({ id: 'job-4b' }, { pollMs: 5 }), 'empty_answer.turn_error.model_not_found')
    assert.deepEqual(why.calls.find((c) => c.path.endsWith('/ack')).body, { status: 'failed', error: 'empty_answer.turn_error.model_not_found' })
  } finally { why.restore() }

  const slow = standIn({ start: { ok: true, sessionId: 's-open' } })
  try {
    assert.equal(await runOne({ id: 'job-5' }, { pollMs: 5, timeoutMs: 60 }), 'run_timeout')
    assert.deepEqual(slow.calls.find((c) => c.path.endsWith('/ack')).body, { status: 'failed', error: 'run_timeout' })
  } finally { slow.restore() }
})
