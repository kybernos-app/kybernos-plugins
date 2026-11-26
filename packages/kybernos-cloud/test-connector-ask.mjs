// The questions of a connected app in a chat set to never ask (connector-ask.mjs): held until the person taps, stopped with the turn, bounded.
import assert from 'node:assert/strict'
import { createConnectorAsks } from './connector-ask.mjs'

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
const text = { en: 'Connected app: github: create an issue', fr: 'Application connectée : github: create an issue' }
// The module's timers are unref'd (a pending question must not keep a process alive): the test holds the loop open itself.
const keepAlive = setInterval(() => {}, 1000)
let passed = 0
const ok = (name) => { passed += 1; console.log('  ✓ ' + name) }

// Allow, reject, and what a chat sees.
{
  const asks = createConnectorAsks()
  const a = asks.ask({ sessionId: 'chat-1', text })
  const b = asks.ask({ sessionId: 'chat-2', text })
  const anywhere = asks.ask({ sessionId: '', text })
  await tick()
  assert.equal(asks.size(), 3)
  assert.equal(asks.list('chat-1').length, 2, 'a chat sees its own questions and those of a call whose chat is not known')
  assert.equal(asks.list('chat-2').length, 2)
  assert.equal(asks.list('chat-3').length, 1, 'a chat with none of its own sees only the unknown-chat one')
  assert.deepEqual(Object.keys(asks.list('chat-1')[0]).sort(), ['at', 'id', 'text'], 'the page gets an id, the words and the time: no session, no function')
  assert.ok(asks.list('chat-1')[0].at <= asks.list('chat-1')[1].at, 'the oldest first')
  const first = asks.list('chat-1').find((q) => q.id !== undefined)
  assert.deepEqual(asks.answer(first.id, 'allow'), { ok: true })
  assert.equal(await a, 'allowed')
  assert.deepEqual(asks.answer(first.id, 'allow'), { ok: false, error: 'unknown' }, 'a question is answered once')
  assert.deepEqual(asks.answer(asks.list('chat-2')[0].id, 'reject'), { ok: true })
  assert.equal(await b, 'rejected')
  assert.deepEqual(asks.answer('x', 'perhaps'), { ok: false, error: 'bad_answer' })
  assert.deepEqual(asks.answer(undefined, 'allow'), { ok: false, error: 'unknown' })
  asks.answer(asks.list('')[0].id, 'allow')
  assert.equal(await anywhere, 'allowed')
  assert.equal(asks.size(), 0)
  ok('a question waits for the tap, a chat sees its own, an answer settles it once')
}

// The turn is stopped: the question goes with it.
{
  const asks = createConnectorAsks()
  const stop = new AbortController()
  const held = asks.ask({ sessionId: 'c', text, signal: stop.signal })
  await tick()
  assert.equal(asks.size(), 1)
  stop.abort()
  assert.equal(await held, 'cancelled')
  assert.equal(asks.size(), 0)
  const done = new AbortController(); done.abort()
  assert.equal(await asks.ask({ sessionId: 'c', text, signal: done.signal }), 'cancelled', 'a turn already stopped asks nothing')
  assert.equal(asks.size(), 0)
  ok('a stopped turn takes its question with it')
}

// Too long unanswered, too many at once.
{
  process.env.KYBERNOS_CONNECTOR_ASK_WAIT_MS = '60'
  const asks = createConnectorAsks()
  assert.equal(await asks.ask({ sessionId: 'c', text }), 'timeout', 'no answer in time: the call is refused, nothing piles up')
  assert.equal(asks.size(), 0)
  delete process.env.KYBERNOS_CONNECTOR_ASK_WAIT_MS
  const many = createConnectorAsks()
  const held = Array.from({ length: 50 }, () => many.ask({ sessionId: 'c', text }))
  assert.equal(await many.ask({ sessionId: 'c', text }), 'overflow', 'the fifty-first is refused')
  for (const q of many.list('c')) many.answer(q.id, 'reject')
  assert.deepEqual(new Set(await Promise.all(held)), new Set(['rejected']))
  ok('a question that is not answered times out, at most fifty are held')
}

clearInterval(keepAlive)
console.log('\nconnector-ask — ' + passed + ' groups OK')
