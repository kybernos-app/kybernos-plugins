#!/usr/bin/env node
/** The person's rules over one automation run (automation-run-guard.mjs), against a fake session controller, and their wiring in index.js and client.js.
 *  Usage: node packages/kybernos-plugin/test-automation-run-guard.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasEntry } from './lib-i18n-test.mjs'
import { createRunGuard, RUN_REQUEST_PREFIX } from './automation-run-guard.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A fake engine: one session, a running flag, a queue, an open approval. `cancel` stops the turn a moment later, like the real one.
const makeEngine = (init) => {
  const e = Object.assign({ running: false, queue: [], pending: [], input: false, cancels: 0, updates: [], waits: 0 }, init)
  e.controller = {
    state: async () => ({ ok: true, value: { running: e.running, queue: e.queue.slice(), pendingInput: e.pending.slice() } }),
    wait: (o, signal) => new Promise((resolve, reject) => {
      e.waits += 1
      const t = setInterval(() => {
        if (signal !== undefined && signal.aborted === true) { clearInterval(t); reject(new Error('aborted')); return }
        if (e.input === true) { clearInterval(t); resolve({ ok: true, value: { reason: 'input-required' } }); return }
        if (e.running !== true) { clearInterval(t); resolve({ ok: true, value: { reason: 'idle' } }) }
      }, 3)
    }),
    cancel: async () => { e.cancels += 1; setTimeout(() => { e.running = false }, 15) },
    updateQueue: async (o) => { e.updates.push({ id: o.itemId, kind: o.action.kind }) },
  }
  return e
}
const fast = (e) => createRunGuard({ controller: () => e.controller, pollMs: 6, graceMs: 40, settleMs: 80 })
const REQ = RUN_REQUEST_PREFIX + 't1-abc'

// 1. a run that ends by itself is « done » and is never cancelled
{
  const e = makeEngine({ running: true })
  setTimeout(() => { e.running = false }, 40)
  assert.equal(await fast(e).begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 1, stopOnPerson: true }), 'done')
  assert.equal(e.cancels, 0)
  ok('a run that ends by itself is done, nothing is cancelled')
}
// 2. the time box cancels the turn
{
  const e = makeEngine({ running: true })
  const t0 = Date.now()
  assert.equal(await fast(e).begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 0.001, stopOnPerson: false }), 'time')
  assert.equal(e.cancels, 1)
  assert.ok(Date.now() - t0 >= 55, 'not before the box is spent')
  ok('the time box is spent: the turn is cancelled and the word is time')
}
// 3. the person's message cancels the turn and is steered; another run queued in the chat is left where it is (it fired: it must still run)
{
  const e = makeEngine({ running: true })
  setTimeout(() => { e.queue = [{ id: 'q-run', rpcId: RUN_REQUEST_PREFIX + 'other-1' }, { id: 'q-me', rpcId: 'rpc-9' }] }, 30)
  assert.equal(await fast(e).begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 0, stopOnPerson: true }), 'person')
  assert.equal(e.cancels, 1)
  assert.deepEqual(e.updates, [{ id: 'q-me', kind: 'steer' }])
  ok('the person writes: the turn is cancelled, their message is steered, another run\'s message stays queued')
}
// 4. « let it finish »: the person's message does not cancel
{
  const e = makeEngine({ running: true })
  setTimeout(() => { e.queue = [{ id: 'q-me', rpcId: 'rpc-9' }] }, 20)
  setTimeout(() => { e.running = false }, 90)
  assert.equal(await fast(e).begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 0, stopOnPerson: false }), 'done')
  assert.equal(e.cancels, 0)
  assert.deepEqual(e.updates, [])
  ok('let it finish: a message of the person does not touch the run')
}
// 5. another run's queued message is not the person
{
  const e = makeEngine({ running: true, queue: [{ id: 'q-run', rpcId: RUN_REQUEST_PREFIX + 'other-1' }] })
  setTimeout(() => { e.running = false }, 60)
  assert.equal(await fast(e).begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 0, stopOnPerson: true }), 'done')
  assert.equal(e.cancels, 0)
  ok('a message queued by another automation run is not taken for the person')
}
// 6. the Stop button, on a watched run and on a run nobody watches
{
  const e = makeEngine({ running: true })
  const g = fast(e)
  const watching = g.begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 10, stopOnPerson: true })
  await sleep(30)
  assert.equal(g.watching('s1'), true)
  assert.deepEqual(await g.stop('s1'), { ok: true, requestId: REQ })
  assert.equal(await watching, 'stopped')
  assert.equal(e.cancels, 1)
  assert.equal(g.watching('s1'), false)
  const bare = makeEngine({ running: true, queue: [{ id: 'a', rpcId: RUN_REQUEST_PREFIX + 'x-1' }, { id: 'b', rpcId: 'zzz' }] })
  assert.deepEqual(await fast(bare).stop('nobody-watches'), { ok: true, requestId: '' })
  assert.equal(bare.cancels, 1)
  assert.deepEqual(bare.updates, [{ id: 'b', kind: 'steer' }], 'the person goes first; the other run stays queued behind')
  const onlyRun = makeEngine({ running: true, queue: [{ id: 'a', rpcId: RUN_REQUEST_PREFIX + 'x-1' }, { id: 'c', rpcId: RUN_REQUEST_PREFIX + 'y-1' }] })
  await fast(onlyRun).stop('nobody-watches')
  assert.deepEqual(onlyRun.updates, [{ id: 'a', kind: 'steer' }], 'no message of the person: the next run is started, the rest follow it')
  ok('Stop cancels a watched run (stopped) and an unwatched one, keeping the person\'s messages')
}
// 7. the run's message waits behind a turn of the person's: the clock starts when it leaves the queue
{
  const e = makeEngine({ running: true, queue: [{ id: 'mine', rpcId: REQ }] })
  setTimeout(() => { e.queue = [] }, 90)
  const t0 = Date.now()
  assert.equal(await fast(e).begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 0.001, stopOnPerson: true }), 'time')
  assert.ok(Date.now() - t0 >= 140, 'the 60 ms box counts from the 90 ms mark, not from the start (' + (Date.now() - t0) + ' ms)')
  ok('the time box counts from the moment the run really starts')
}
// 8. an open approval is waited for, not cancelled
{
  const e = makeEngine({ running: true })
  setTimeout(() => { e.input = true }, 20)
  setTimeout(() => { e.input = false; e.running = false }, 100)
  assert.equal(await fast(e).begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 5, stopOnPerson: true }), 'done')
  assert.equal(e.cancels, 0)
  ok('a run that waits for an approval is not cancelled')
}
// 9. nothing to watch: no controller, a turn that never shows, a second watch of the same session
{
  assert.equal(await createRunGuard({ controller: () => undefined }).begin({ sessionId: 's1', taskId: 't1', requestId: REQ }), 'error')
  const idle = makeEngine({})
  assert.equal(await fast(idle).begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 1 }), 'done')
  ok('no controller and a turn that never shows end cleanly')
}

// A chat that holds several runs, like the real engine: a run posted while a turn goes waits in the queue; at the end of a turn the next queued message starts at once
// (the chat never goes idle in between); after a cancel nothing starts by itself until a message is steered.
const makeChat = (init) => {
  const c = Object.assign({ running: false, queue: [], cancels: 0, updates: [], noDrain: false }, init)
  const startNext = () => { const next = c.queue.shift(); c.running = next !== undefined }
  c.finish = () => { if (c.noDrain === true) { c.running = false; return } startNext() }
  c.post = (id, rpcId) => { if (c.running === true) c.queue.push({ id, rpcId }); else c.running = true }
  c.controller = {
    state: async () => ({ ok: true, value: { running: c.running, queue: c.queue.slice(), pendingInput: [] } }),
    wait: (o, signal) => new Promise((resolve, reject) => {
      const t = setInterval(() => {
        if (signal !== undefined && signal.aborted === true) { clearInterval(t); reject(new Error('aborted')); return }
        if (c.running !== true) { clearInterval(t); resolve({ ok: true, value: { reason: 'idle' } }) }
      }, 3)
    }),
    cancel: async () => { c.cancels += 1; c.noDrain = true; setTimeout(() => { c.running = false }, 15) },
    updateQueue: async (o) => {
      c.updates.push({ id: o.itemId, kind: o.action.kind })
      const i = c.queue.findIndex((q) => q.id === o.itemId)
      if (i < 0) return
      c.queue.splice(i, 1)
      if (o.action.kind === 'steer') setTimeout(() => { c.noDrain = false; c.running = true }, 20)
    },
  }
  return c
}
const within = (p, ms) => Promise.race([p, sleep(ms).then(() => 'still waiting')])
const REQ_B = RUN_REQUEST_PREFIX + 't2-def'

// 11. A second run queued in the same chat does not take the watch of the run still going: the first one's time box still cuts it, and the second then starts
{
  const c = makeChat({ running: true })
  const g = fast(c)
  const a = g.begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 0.002, stopOnPerson: false })
  await sleep(20)
  c.post('qb', REQ_B)
  const b = g.begin({ sessionId: 's1', taskId: 't2', requestId: REQ_B, maxMinutes: 10, stopOnPerson: false })
  assert.equal(await within(a, 2000), 'time', 'the first run keeps its time box')
  assert.equal(c.cancels, 1)
  assert.deepEqual(c.updates, [{ id: 'qb', kind: 'steer' }], 'the run queued behind is started, not dropped')
  await sleep(60)
  assert.equal(g.watching('s1'), true, 'the second run is watched')
  c.finish()
  assert.equal(await within(b, 2000), 'done')
  ok('two runs in one chat: each keeps its own watch; a time box cuts its own run only, and the next one starts')
}
// 12. The engine goes straight from one run to the next: the first watch ends done (no cancel), the second takes over
{
  const c = makeChat({ running: true })
  const g = fast(c)
  const a = g.begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 1, stopOnPerson: true })
  await sleep(15)
  c.post('qb', REQ_B)
  const b = g.begin({ sessionId: 's1', taskId: 't2', requestId: REQ_B, maxMinutes: 1, stopOnPerson: true })
  await sleep(40)
  c.finish()
  assert.equal(await within(a, 2000), 'done', 'the first run is over when the next one starts')
  assert.equal(c.cancels, 0, 'nothing cancelled')
  await sleep(30)
  c.finish()
  assert.equal(await within(b, 2000), 'done')
  ok('a handover from one run to the next ends the first watch without cancelling the second')
}
// 13. A run queued behind a long one is not given up after the queued wait: the earlier run's own box bounds that wait
{
  const c = makeChat({ running: true })
  const g = createRunGuard({ controller: () => c.controller, pollMs: 6, graceMs: 40, settleMs: 80, queuedMaxMs: 30 })
  const a = g.begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 0, stopOnPerson: true })
  await sleep(10)
  c.post('qb', REQ_B)
  const b = g.begin({ sessionId: 's1', taskId: 't2', requestId: REQ_B, maxMinutes: 0.003, stopOnPerson: false })
  await sleep(120)
  c.finish()
  assert.equal(await within(a, 2000), 'done')
  assert.equal(await within(b, 2000), 'time', 'the second run, started after 120 ms of queue, is still watched and boxed')
  ok('a run waiting behind a watched run keeps its watch past the queued limit')
}
// 14. Stop on a run still queued behind another automation's: its message goes, the turn going is not touched
{
  const c = makeChat({ running: true })
  const g = fast(c)
  const a = g.begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 1, stopOnPerson: false })
  await sleep(15)
  c.post('qb', REQ_B)
  const b = g.begin({ sessionId: 's1', taskId: 't2', requestId: REQ_B, maxMinutes: 1, stopOnPerson: false })
  await sleep(15)
  assert.deepEqual(await g.stop('s1', 't2'), { ok: true, requestId: REQ_B })
  assert.equal(await within(b, 2000), 'stopped')
  assert.equal(c.cancels, 0, 'the other automation\'s turn goes on')
  assert.deepEqual(c.updates, [{ id: 'qb', kind: 'remove' }])
  await sleep(30)
  c.finish()
  assert.equal(await within(a, 2000), 'done', 'and its watch is not mistaken for a handover')
  ok('Stop on a queued run removes its message only')
}

// 10. the wiring: the sanitizer, the fire path, the route and the page
{
  const host = readFileSync(join(here, 'index.js'), 'utf8')
  const cli = readFileSync(join(here, 'client.js'), 'utf8')
  assert.ok(host.includes("from './automation-run-guard.mjs'"), 'index.js imports the guard')
  assert.ok(/r\.maxMinutes !== undefined/.test(host) && /invalid duration/.test(host), 'the sanitizer takes and checks maxMinutes')
  assert.ok(/r\.onPersonWrites !== undefined/.test(host), 'the sanitizer takes onPersonWrites')
  assert.ok(/kbRunGuard\.begin\(/.test(host), 'kbFireTask starts a watch')
  assert.ok(/action === 'stop'/.test(host) && /kbRunGuard\.stop\(sid, id\)/.test(host), 'the tasks route has a stop action, for the run of that automation')
  assert.ok(/kbNoteRunStop\(String\(task\.id\), sessionId, why, requestId\)/.test(host) && /kbNoteRunStop\(id, sid, 'stopped', r\.requestId\)/.test(host), 'the stop is noted on the line of the run it cut, found by its request')
  assert.ok(/const requestId = RUN_REQUEST_PREFIX \+/.test(host), 'the request id carries the run prefix the guard tells runs apart by')
  assert.ok(/action: 'stop'|act\('stop'/.test(cli), 'the page calls stop')
  for (const k of ['tasks.stoprun', 'tasks.stop.asked', 'tasks.during', 'tasks.maxmin', 'tasks.maxmin.hint', 'tasks.maxmin.none', 'tasks.onwrite', 'tasks.onwrite.hint', 'tasks.onwrite.stop', 'tasks.onwrite.finish', 'tasks.hours.fixed', 'tasks.hours.every', 'tasks.hours.bad']) {
    assert.ok(hasEntry(k), 'both languages for ' + k)
  }
  ok('wiring: sanitizer, fire path, stop route, page strings in both languages')
}

console.log('\n' + pass + ' checks passed')
