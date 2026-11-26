#!/usr/bin/env node
/** The person's rules over one automation run (automation-run-guard.mjs), against a fake session controller, and their wiring in index.js and client.js.
 *  Usage: node packages/kybernos-plugin/test-automation-run-guard.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
// 3. the person's message cancels the turn and is steered; the run's own unread message is removed
{
  const e = makeEngine({ running: true })
  setTimeout(() => { e.queue = [{ id: 'q-run', rpcId: RUN_REQUEST_PREFIX + 'other-1' }, { id: 'q-me', rpcId: 'rpc-9' }] }, 30)
  assert.equal(await fast(e).begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 0, stopOnPerson: true }), 'person')
  assert.equal(e.cancels, 1)
  assert.deepEqual(e.updates, [{ id: 'q-run', kind: 'remove' }, { id: 'q-me', kind: 'steer' }])
  ok('the person writes: the turn is cancelled, their message is steered, a run message is removed')
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
  assert.deepEqual(await g.stop('s1'), { ok: true })
  assert.equal(await watching, 'stopped')
  assert.equal(e.cancels, 1)
  assert.equal(g.watching('s1'), false)
  const bare = makeEngine({ running: true, queue: [{ id: 'a', rpcId: RUN_REQUEST_PREFIX + 'x-1' }, { id: 'b', rpcId: 'zzz' }] })
  assert.deepEqual(await fast(bare).stop('nobody-watches'), { ok: true })
  assert.equal(bare.cancels, 1)
  assert.deepEqual(bare.updates, [{ id: 'a', kind: 'remove' }, { id: 'b', kind: 'steer' }])
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
  const e = makeEngine({ running: true })
  const g = fast(e)
  const first = g.begin({ sessionId: 's1', taskId: 't1', requestId: REQ, maxMinutes: 10 })
  await sleep(30)
  const second = g.begin({ sessionId: 's1', taskId: 't1', requestId: REQ + '2', maxMinutes: 10 })
  assert.equal(await first, 'error')
  e.running = false
  assert.equal(await second, 'done')
  ok('no controller, a turn that never shows, and a second watch of one session end cleanly')
}

// 10. the wiring: the sanitizer, the fire path, the route and the page
{
  const host = readFileSync(join(here, 'index.js'), 'utf8')
  const cli = readFileSync(join(here, 'client.js'), 'utf8')
  assert.ok(host.includes("from './automation-run-guard.mjs'"), 'index.js imports the guard')
  assert.ok(/r\.maxMinutes !== undefined/.test(host) && /invalid duration/.test(host), 'the sanitizer takes and checks maxMinutes')
  assert.ok(/r\.onPersonWrites !== undefined/.test(host), 'the sanitizer takes onPersonWrites')
  assert.ok(/kbRunGuard\.begin\(/.test(host), 'kbFireTask starts a watch')
  assert.ok(/action === 'stop'/.test(host) && /kbRunGuard\.stop\(/.test(host), 'the tasks route has a stop action')
  assert.ok(/const requestId = RUN_REQUEST_PREFIX \+/.test(host), 'the request id carries the run prefix the guard tells runs apart by')
  assert.ok(/action: 'stop'|act\('stop'/.test(cli), 'the page calls stop')
  for (const k of ['tasks.stoprun', 'tasks.stop.asked', 'tasks.during', 'tasks.maxmin', 'tasks.maxmin.hint', 'tasks.maxmin.none', 'tasks.onwrite', 'tasks.onwrite.hint', 'tasks.onwrite.stop', 'tasks.onwrite.finish', 'tasks.hours.fixed', 'tasks.hours.every', 'tasks.hours.bad']) {
    assert.ok(new RegExp("'" + k.replace(/\./g, '\\.') + "': \\{ kybernos: '[^']+', en: '[^']+' \\}").test(cli), 'both languages for ' + k)
  }
  ok('wiring: sanitizer, fire path, stop route, page strings in both languages')
}

console.log('\n' + pass + ' checks passed')
