#!/usr/bin/env node
/** The rules of an automation that asks first on a cloud computer (automation-approvals.mjs): what the gate does with a call, what stays on the volume, what the run is told.
 *  test-computer-approvals.mjs (scripts/) plays the same rules end to end on the real plugins. Usage: node packages/kybernos-cloud/test-automation-approvals.mjs */
import assert from 'node:assert/strict'
import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { actionKey, readItems, writeItems, verdict, denyReason, continuationText, ofRun, toContinue, MAX_ASKS, KEEP_MS, MAX_ITEMS } from './automation-approvals.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const rec = (o) => Object.assign({ id: randomUUID(), sessionId: 'sess-1', taskId: 'st-1', ref: 'task-a', kind: 'shell', summary: 'ls -la', key: actionKey('shell', 'ls -la'), askedAt: new Date().toISOString(), state: 'pending' }, o)

// 1. the key
assert.equal(actionKey('shell', 'ls  -la'), actionKey('shell', ' ls -la\n'), 'spaces collapsed: the same command')
assert.notEqual(actionKey('shell', 'ls -la'), actionKey('shell', 'ls -l'))
assert.notEqual(actionKey('shell', 'x'), actionKey('write', 'x'), 'the kind is part of it')
assert.match(actionKey('shell', 'x'), /^[0-9a-f]{32}$/u)
ok('key: the kind and the text with the spaces collapsed, hashed')

// 2. the verdict
const K = actionKey('shell', 'ls -la')
assert.deepEqual(verdict([], K), { kind: 'ask' })
assert.deepEqual(verdict([rec({ state: 'pending' })], K), { kind: 'deny', why: 'waiting' }, 'a question is waiting: nothing else is asked')
assert.deepEqual(verdict([rec({ state: 'pending', key: 'other' })], 'another'), { kind: 'deny', why: 'waiting' })
const once = rec({ state: 'allowed' })
assert.deepEqual(verdict([once], K), { kind: 'pass', use: once.id }, 'that very action once')
assert.deepEqual(verdict([once], actionKey('shell', 'rm -rf /')), { kind: 'ask' }, 'not another one')
assert.deepEqual(verdict([{ ...once, used: true }], K), { kind: 'ask' }, 'once is once')
assert.deepEqual(verdict([rec({ state: 'allowed_turn', key: 'x' })], 'anything'), { kind: 'pass' }, 'the rest of the run')
assert.deepEqual(verdict([rec({ state: 'denied' })], K), { kind: 'deny', why: 'refused' }, 'a refusal is not asked again')
assert.deepEqual(verdict([rec({ state: 'expired' })], K), { kind: 'deny', why: 'refused' })
assert.deepEqual(verdict([rec({ state: 'denied', key: 'x' })], K), { kind: 'ask' }, 'another action is asked')
assert.deepEqual(verdict(Array.from({ length: MAX_ASKS }, (_, i) => rec({ state: 'denied', key: 'k' + i })), K), { kind: 'deny', why: 'many' }, 'the limit')
assert.deepEqual(verdict([rec({ state: 'allowed_turn' }), ...Array.from({ length: 5 }, (_, i) => rec({ state: 'denied', key: 'k' + i }))], 'x'), { kind: 'pass' }, 'allowed for the run wins over the limit: nothing more is asked')
ok('verdict: pass, ask, wait, refused, the limit; once is once, the run is the run')

// 3. what the run is told
for (const why of ['waiting', 'refused', 'many', 'nobody', 'failed']) assert.ok(denyReason(why).length > 20, why)
assert.match(denyReason('waiting'), /must allow this first/u)
assert.match(denyReason('waiting'), /stop/u)
assert.doesNotMatch(denyReason('waiting'), /try again|another way/u, 'no invitation to go round it')
assert.match(denyReason('many'), new RegExp('asked the person ' + String(MAX_ASKS) + ' times', 'u'))
assert.match(continuationText('allowed', 'ls -la'), /allowed this action: « ls -la »/u)
assert.match(continuationText('allowed_turn', 'ls -la'), /rest of this task/u)
assert.match(continuationText('denied', 'rm -rf x'), /refused this action: « rm -rf x »/u)
assert.match(continuationText('expired', 'rm -rf x'), /did not answer in time/u)
for (const state of ['denied', 'expired']) assert.match(continuationText(state, 'x'), /Do not try it again/u)
assert.ok(continuationText('allowed', 'a\n\n b'.repeat(200)).length < 1000, 'the action is one line, clipped')
assert.equal(continuationText('allowed', 'a\nb').indexOf('\n'), -1, 'the action keeps no line break')
ok('words: the refusal makes the run stop, the answer says what was allowed or refused, the action is quoted on one line')

// 4. the volume
const dir = mkdtempSync(join(tmpdir(), 'kb-approvals-'))
const file = join(dir, 'kybernos', 'approvals.json')
const a = rec()
const b = rec({ sessionId: 'sess-2', state: 'allowed', used: true })
assert.equal(writeItems(file, [a, b]).length, 2)
assert.equal((statSync(file).mode & 0o777).toString(8), '600', 'readable by its owner only')
assert.deepEqual(readItems(file).map((r) => r.id), [a.id, b.id])
assert.equal(readItems(join(dir, 'nothing.json')).length, 0)
writeFileSync(join(dir, 'broken.json'), '{ not json')
assert.equal(readItems(join(dir, 'broken.json')).length, 0, 'a damaged file is no records, not a crash')
writeFileSync(join(dir, 'odd.json'), JSON.stringify({ items: [null, 'x', { id: 'nope', sessionId: 's', state: 'pending', key: 'k' }, { ...a, state: 'maybe' }, { ...a, sessionId: 'bad id' }, a] }))
assert.deepEqual(readItems(join(dir, 'odd.json')).map((r) => r.id), [a.id], 'only well-formed records are read')
const old = rec({ askedAt: new Date(Date.now() - KEEP_MS - 1000).toISOString() })
assert.deepEqual(writeItems(file, [old, a]).map((r) => r.id), [a.id], 'stale records go')
assert.equal(writeItems(file, Array.from({ length: MAX_ITEMS + 30 }, () => rec())).length, MAX_ITEMS, 'bounded')
ok('volume: 0600, atomic, damaged or odd content is ignored, stale and extra records go')

// 5. runs and answers
const items = [rec({ sessionId: 'sess-1', askedAt: '2026-10-23T10:00:02.000Z' }), rec({ sessionId: 'sess-2' }), rec({ sessionId: 'sess-1', askedAt: '2026-10-23T10:00:01.000Z' })]
assert.deepEqual(ofRun(items, 'sess-1').map((r) => r.askedAt), ['2026-10-23T10:00:01.000Z', '2026-10-23T10:00:02.000Z'], 'one run\'s records, in the order asked')
const todo = toContinue(items, [{ id: items[0].id, state: 'allowed' }, { id: items[0].id, state: 'allowed' }, { id: randomUUID(), state: 'denied' }, { id: 'nope', state: 'allowed' }, { id: items[1].id, state: 'weird' }, null, 'x'])
assert.equal(todo.length, 2, 'each id once; an id that is not one and a state that is not one are left out')
assert.deepEqual([todo[0].id === items[0].id, todo[0].record === items[0], todo[1].record], [true, true, null], 'a record to continue, and an answer for nothing here')
assert.equal(toContinue([{ ...items[0], continued: true }], [{ id: items[0].id, state: 'allowed' }])[0].record, null, 'already continued: only taken off the list')
assert.deepEqual(toContinue(items, 'x'), [])
ok('answers: each id once, matched to the record still to continue, anything else only taken off the list')

console.log('\n' + pass + ' checks passed')
