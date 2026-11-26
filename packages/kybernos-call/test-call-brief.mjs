// kybernos-call: what the session's assistant is told during a voice call (call-brief.mjs).
import assert from 'node:assert/strict'
import { CALL_BRIEF, renderCallBrief } from './call-brief.mjs'
import { createSpeechFeed } from './speech-feed.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const context = (id) => ({ agent: { session: { id } } })

console.log('kybernos-call: the voice brief')
{
  const feed = createSpeechFeed()
  assert.equal(renderCallBrief(feed, context('session-aaaaaaaa')), '')
  feed.register('room-1', 'session-aaaaaaaa')
  assert.equal(renderCallBrief(feed, context('session-aaaaaaaa')), CALL_BRIEF)
  assert.equal(renderCallBrief(feed, context('session-bbbbbbbb')), '')
  ok('the brief is in the prompt of the session that has a live call, and only of that one')
  feed.unregister('room-1')
  assert.equal(renderCallBrief(feed, context('session-aaaaaaaa')), '')
  ok('and it is gone as soon as the call is over')
}
{
  const feed = createSpeechFeed()
  feed.register('room-1', 'session-aaaaaaaa')
  for (const bad of [null, undefined, {}, { agent: null }, { agent: { session: null } }, { agent: { session: { id: 42 } } }, 'x']) assert.equal(renderCallBrief(feed, bad), '')
  assert.equal(renderCallBrief(null, context('session-aaaaaaaa')), '')
  assert.equal(renderCallBrief({}, context('session-aaaaaaaa')), '')
  assert.equal(renderCallBrief({ active: () => { throw new Error('boom') } }, context('session-aaaaaaaa')), '')
  ok('a context it does not understand, no feed, or a feed that throws: an empty chunk, never an error')
}
{
  assert.match(CALL_BRIEF, /one to three short sentences/)
  assert.match(CALL_BRIEF, /menus of options/)
  assert.match(CALL_BRIEF, /FIRST paragraph/)
  assert.ok(CALL_BRIEF.length < 900)
  ok('the brief asks for a short spoken answer with no menu, says only the first paragraph is spoken, and stays short')
}
console.log('\nkybernos-call brief: ' + pass + ' checks')
