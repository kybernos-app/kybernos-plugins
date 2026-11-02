#!/usr/bin/env node
/** The record of who decided a handover (journal-decisions.mjs): one line per decision, in a small file of its own, owner-only.
 *  Usage: node packages/kybernos-plugin/test-journal-decisions.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecorder, decisionKey, decisionsFile, readDecisions } from './journal-decisions.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const root = mkdtempSync(join(tmpdir(), 'kb-journal-decisions-'))
const dir = join(root, 'decisions')
const T0 = 1_800_000_000_000
const call = (callId, name) => ({ type: 'tool/call', time: T0, data: { callId: callId, name: name, arguments: '{}' } })
const result = (callId) => ({ type: 'tool/result', time: T0 + 5000, data: { message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: 'A' }] } } })
const decided = (id, extra) => ({ type: 'approval/decided', time: T0 + 2000, data: Object.assign({ id: id, outcome: 'allowed-once' }, extra) })

try {
  let person = { by: 'Amira Benali', device: 'MacBook Pro' }
  const rec = createRecorder({ dir: dir, who: () => person })

  // A permission decided: one line, joined on the approval id.
  assert.equal(rec.ingest('session-s1', decided('a1')), true)
  let got = readDecisions(dir, 's1')
  assert.deepEqual(got[decisionKey('permission', 'a1')], { by: 'Amira Benali', device: 'MacBook Pro', at: T0 + 2000 })
  assert.deepEqual(readDecisions(dir, 'session-s1'), got)
  ok('a permission decided is recorded with the person signed in and the computer; `session-<id>` and `<id>` are the same chat')

  // The same decision seen twice is one line.
  assert.equal(rec.ingest('session-s1', decided('a1')), false)
  assert.equal(readFileSync(decisionsFile(dir, 's1'), 'utf8').trim().split('\n').length, 1)
  ok('a decision seen twice is written once')

  // A question: only the tool results of a handover tool count, and only once.
  assert.equal(rec.ingest('s1', call('c1', 'bash')), false)
  assert.equal(rec.ingest('s1', result('c1')), false)
  assert.equal(rec.ingest('s1', call('q1', 'ask_user_question')), false)
  assert.equal(rec.ingest('s1', result('q1')), true)
  assert.equal(rec.ingest('s1', result('q1')), false)
  got = readDecisions(dir, 's1')
  assert.equal(got[decisionKey('question', 'q1')].by, 'Amira Benali')
  assert.equal(got[decisionKey('question', 'c1')], undefined)
  ok('the answer to a question put to the person is recorded; the result of an ordinary tool is not')

  // The engine names the decider itself: nothing to add.
  assert.equal(rec.ingest('s2', decided('a9', { by: 'Engine Name' })), false)
  assert.deepEqual(readDecisions(dir, 's2'), {})
  ok('a decision the engine already names is left alone')

  // Signed out (nobody, no computer): nothing is written; a later decision is.
  person = { by: null, device: null }
  assert.equal(rec.ingest('s3', decided('a2')), false)
  assert.equal(existsSync(decisionsFile(dir, 's3')), false)
  person = { by: null, device: 'Mac mini' }
  assert.equal(rec.ingest('s3', decided('a3')), true)
  assert.deepEqual(readDecisions(dir, 's3')[decisionKey('permission', 'a3')], { by: null, device: 'Mac mini', at: T0 + 2000 })
  ok('with nobody signed in and no computer name nothing is written; the computer alone is kept')

  // The person seam throwing or answering rubbish never breaks the caller.
  const broken = createRecorder({ dir: dir, who: () => { throw new Error('boom') } })
  assert.equal(broken.ingest('s4', decided('a1')), false)
  const rubbish = createRecorder({ dir: dir, who: () => ({ by: 42, device: { x: 1 } }) })
  assert.equal(rubbish.ingest('s4', decided('a2')), false)
  const hostile = createRecorder({ dir: dir, who: () => ({ by: 'A'.repeat(500), device: '  line\nbreak  ' }) })
  assert.equal(hostile.ingest('s5', decided('a1')), true)
  const cutRec = readDecisions(dir, 's5')[decisionKey('permission', 'a1')]
  assert.equal(cutRec.by.length, 80)
  for (const bad of [null, undefined, 7, 'x', [], {}, { type: 5 }, { type: 'approval/decided' }, { type: 'approval/decided', data: null }, { type: 'tool/result', data: { message: 3 } }]) assert.equal(rec.ingest('s6', bad), false)
  assert.equal(rec.ingest(null, decided('a1')), false)
  ok('a failing or rubbish person, long text, and malformed events never throw and never write a bad line')

  // Ids that are not safe file names are never written under.
  for (const bad of ['../evil', 'a/b', '', '.', '..', 'x'.repeat(200), null, 4]) {
    assert.equal(decisionsFile(dir, bad), null)
    assert.equal(rec.ingest(bad, decided('a1')), false)
  }
  assert.deepEqual(readdirSync(dir).sort(), ['s1.jsonl', 's3.jsonl', 's5.jsonl'].sort())
  ok('a chat id that is not a plain file name is never written under')

  // Owner-only files; a damaged file reads as what can be read.
  assert.equal(statSync(decisionsFile(dir, 's1')).mode & 0o077, 0)
  writeFileSync(decisionsFile(dir, 's7'), 'not json\n{"key":"a:z","by":"Zed","device":"Pi","at":5}\n[1]\n{"key":7}\n')
  assert.deepEqual(readDecisions(dir, 's7'), { 'a:z': { by: 'Zed', device: 'Pi', at: 5 } })
  assert.deepEqual(readDecisions(dir, 'never-seen'), {})
  assert.deepEqual(readDecisions(join(root, 'no-such-dir'), 's1'), {})
  ok('the files are private to the owner; a damaged line is skipped; no file is no decision')

  // An unwritable folder is silent.
  const blocked = createRecorder({ dir: join(root, 'decisions', 's1.jsonl', 'under-a-file'), who: () => person })
  assert.equal(blocked.ingest('s8', decided('a1')), false)
  ok('a folder that cannot be written is silent')
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('\n' + pass + ' groups passed')
