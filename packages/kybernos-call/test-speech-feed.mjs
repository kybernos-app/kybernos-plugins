// kybernos-call: the feed that keeps, for each call, what the session's assistant writes (speech-feed.mjs).
// Pure: no DSH, no network.
//
//   node packages/kybernos-call/test-speech-feed.mjs
import assert from 'node:assert/strict'
import { assistantText, createSpeechFeed } from './speech-feed.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const said = (text, extra = []) => ({ type: 'assistant/message', time: '2026-10-08T10:00:00Z', data: { turn: 1, message: { id: 'm1', content: [...extra, { type: 'text', text }] } } })

console.log('what an assistant message says')
assert.equal(assistantText(said('  Hello there.  ')), 'Hello there.')
assert.equal(assistantText(said('B', [{ type: 'text', text: 'A' }])), 'A\nB')
assert.equal(assistantText(said('Visible', [{ type: 'thinking', text: 'secret reasoning' }, { type: 'tool-use', name: 'bash', text: 'rm' }])), 'Visible')
for (const bad of [null, undefined, {}, { data: null }, { data: { message: null } }, { data: { message: { content: 'x' } } }, said('   ')]) assert.equal(assistantText(bad), '')
ok('only the text blocks are kept (no thinking, no tool use), trimmed and joined; anything else is empty, never an error')

console.log('a call and its session')
const feed = createSpeechFeed()
assert.equal(feed.register('room-1', 'session-aaaaaaaa'), true)
assert.equal(feed.register('', 'session-aaaaaaaa'), false)
assert.equal(feed.register('room-x', ''), false)
assert.equal(feed.size(), 1)
assert.equal(feed.sessionOf('room-1'), 'session-aaaaaaaa')
ok('a room is registered against its session; empty ids are refused')

feed.ingest('session-aaaaaaaa', said('First answer.'))
feed.ingest('session-bbbbbbbb', said('Another session, not ours.'))
feed.ingest('session-aaaaaaaa', { type: 'tool/call', data: { name: 'read_file' } })
feed.ingest('session-aaaaaaaa', said('Second answer.'))
feed.ingest('session-aaaaaaaa', { type: 'turn/end', data: { reason: { kind: 'end-turn' } } })
feed.ingest('session-aaaaaaaa', { type: 'turn/start' })
feed.ingest('session-aaaaaaaa', null)
feed.ingest(undefined, said('nobody'))
let r = await feed.poll('room-1', 0, 0)
assert.deepEqual(r.items, [
  { seq: 1, kind: 'text', text: 'First answer.' },
  { seq: 2, kind: 'tool', name: 'read_file' },
  { seq: 3, kind: 'text', text: 'Second answer.' },
  { seq: 4, kind: 'end', reason: 'end-turn' }
])
assert.equal(r.known, true)
assert.equal(r.next, 4)
ok('only the call\'s own session is followed; text, tool starts and the end of the turn come out in order, with a rising seq')

r = await feed.poll('room-1', 2, 0)
assert.deepEqual(r.items.map((i) => i.seq), [3, 4])
r = await feed.poll('room-1', 4, 0)
assert.deepEqual(r, { ok: true, known: true, items: [], next: 4 })
ok('"after" skips what the worker already has; nothing new is an empty answer with the same next')

console.log('the long poll')
const t0 = Date.now()
const waiting = feed.poll('room-1', 4, 5000)
await sleep(50)
feed.ingest('session-aaaaaaaa', said('Late news.'))
r = await waiting
assert.deepEqual(r.items, [{ seq: 5, kind: 'text', text: 'Late news.' }])
assert.ok(Date.now() - t0 < 1500)
ok('a poll that finds nothing waits, and answers as soon as the assistant writes')

const t1 = Date.now()
r = await feed.poll('room-1', 5, 120)
assert.deepEqual(r.items, [])
assert.ok(Date.now() - t1 >= 100 && Date.now() - t1 < 1000)
ok('and gives up after the wait it was given, with an empty answer')

const pending = feed.poll('room-1', 5, 5000)
await sleep(30)
feed.unregister('room-1')
r = await pending
assert.equal(r.known, false)
assert.equal(feed.size(), 0)
ok('hanging up releases a waiting poll at once (known: false)')

r = await feed.poll('room-1', 0, 0)
assert.deepEqual(r, { ok: true, known: false, items: [], next: 0 })
r = await feed.poll('never-registered', 3, 0)
assert.deepEqual(r, { ok: true, known: false, items: [], next: 3 })
feed.ingest('session-aaaaaaaa', said('Nobody is listening.'))
assert.equal(feed.size(), 0)
ok('an unknown or released room is "known: false": the worker stops asking; the feed keeps nothing for it')

console.log('limits')
const small = createSpeechFeed()
small.register('room-2', 'session-cccccccc')
for (let i = 1; i <= 250; i += 1) small.ingest('session-cccccccc', said('msg ' + i))
r = await small.poll('room-2', 0, 0)
assert.equal(r.items.length, 100)
assert.equal(r.items[0].seq, 151)
assert.equal(r.next, 250)
ok('a room keeps the last 100 items only: a worker that stops polling cannot make the host grow')

let clock = 1000
const aging = createSpeechFeed({ now: () => clock })
aging.register('room-old', 'session-dddddddd')
aging.register('room-new', 'session-eeeeeeee')
clock += 5 * 3600 * 1000
aging.register('room-newer', 'session-ffffffff')
clock += 2 * 3600 * 1000
r = await aging.poll('room-old', 0, 0)
assert.equal(r.known, false)
assert.equal(aging.size(), 1)
ok('a room older than a room token\'s life (6 h) is forgotten')

const twice = createSpeechFeed()
twice.register('room-3', 'session-gggggggg')
twice.ingest('session-gggggggg', said('one'))
twice.register('room-3', 'session-hhhhhhhh')
assert.equal((await twice.poll('room-3', 0, 0)).items.length, 0)
twice.ingest('session-gggggggg', said('old session'))
assert.equal((await twice.poll('room-3', 0, 0)).items.length, 0)
ok('registering a room again starts it over, on its new session (the old session is no longer followed)')

const two = createSpeechFeed()
two.register('room-a', 'session-iiiiiiii')
two.register('room-b', 'session-iiiiiiii')
two.ingest('session-iiiiiiii', said('shared'))
assert.equal((await two.poll('room-a', 0, 0)).items.length, 1)
assert.equal((await two.poll('room-b', 0, 0)).items.length, 1)
two.unregister('room-a')
two.ingest('session-iiiiiiii', said('only b'))
assert.equal((await two.poll('room-b', 0, 0)).items.length, 2)
ok('two calls on one session each get the replies; hanging up one leaves the other')

console.log('\nkybernos-call speech feed: ' + pass + ' checks')
