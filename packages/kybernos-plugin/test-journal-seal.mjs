#!/usr/bin/env node
/** The seal on each decision of the chat Journal (journal-seal.mjs + the recorder + the join in the story): made at the moment, checked against the log, broken by any later edit.
 *  Usage: node packages/kybernos-plugin/test-journal-seal.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecorder, decisionKey, decisionsFile, readDecisions } from './journal-decisions.mjs'
import { createDecisionTracker, loadSealKey, sealPayload, subjectOf, verifyDecisions, verifySeal } from './journal-seal.mjs'
import { deriveStory } from './journal-story.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const root = mkdtempSync(join(tmpdir(), 'kb-journal-seal-'))
const T0 = 1_800_000_000_000
let seq = 0
const ev = (type, at, data) => { seq += 1; return { type: type, seq: seq, time: T0 + at, data: data } }
const asked = (at, id, tool, reason) => ev('approval/asked', at, { id: id, toolName: tool, callId: 'k-' + id, reason: reason })
const decided = (at, id, outcome, extra) => ev('approval/decided', at, Object.assign({ id: id, outcome: outcome }, extra))
const qcall = (at, callId, question, labels) => ev('tool/call', at, { callId: callId, name: 'ask_user_question', arguments: JSON.stringify({ questions: [{ question: question, options: labels.map((l) => ({ label: l })) }] }) })
const qresult = (at, callId, text) => ev('tool/result', at, { message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: text }] } })

try {
  // ── the key: made once, private to the owner, never overwritten ───────────────────────
  const keyFile = join(root, 'dir', 'seal-key.json')
  assert.equal(loadSealKey(keyFile, null), null)
  assert.equal(existsSync(keyFile), false)
  const key = loadSealKey(keyFile, { create: true })
  assert.match(key.keyId, /^[0-9a-f]{16}$/)
  assert.equal(statSync(keyFile).mode & 0o077, 0)
  assert.equal(loadSealKey(keyFile, null).keyId, key.keyId)
  assert.equal(loadSealKey(keyFile, { create: true }).keyId, key.keyId)
  writeFileSync(join(root, 'damaged.json'), '{not json')
  assert.equal(loadSealKey(join(root, 'damaged.json'), { create: true }), null)
  assert.equal(readFileSync(join(root, 'damaged.json'), 'utf8'), '{not json')
  assert.equal(loadSealKey('', { create: true }), null)
  ok('the key is made once on the first decision, kept private to the owner, found again; a damaged key file is never overwritten')

  // ── a signature checks only the facts it was made over ──────────────────────────────
  const facts = { session: 'session-s1', key: 'a:a1', subject: subjectOf('permission', 'bash', 'Delete the draft folder'), outcome: 'allowed-once', by: 'Amira Benali', device: 'MacBook Pro', at: T0 + 2000 }
  const sig = key.sign(sealPayload(facts))
  assert.equal(verifySeal(key.publicKey, sealPayload(facts), sig), true)
  assert.equal(verifySeal(key.publicKey, sealPayload(Object.assign({}, facts, { session: 's1' })), sig), true)
  for (const change of [{ by: 'Someone Else' }, { device: 'Mac mini' }, { at: T0 + 2001 }, { outcome: 'denied' }, { key: 'a:a2' }, { subject: subjectOf('permission', 'bash', 'Delete everything') }, { session: 's2' }]) {
    assert.equal(verifySeal(key.publicKey, sealPayload(Object.assign({}, facts, change)), sig), false, JSON.stringify(change))
  }
  const other = loadSealKey(join(root, 'other.json'), { create: true })
  assert.equal(verifySeal(other.publicKey, sealPayload(facts), sig), false)
  assert.equal(verifySeal('not a key', sealPayload(facts), sig), false)
  assert.equal(verifySeal(key.publicKey, sealPayload(facts), 'not a signature'), false)
  ok('a seal holds only for the very chat, decision, question, answer, person, computer and time it was made over')

  // ── the recorder seals what it records, from a log it reads as it goes ──────────────
  const dir = join(root, 'decisions')
  const rec = createRecorder({ dir: dir, who: () => ({ by: 'Amira Benali', device: 'MacBook Pro' }), seal: () => key })
  const events = [
    asked(1000, 'a1', 'bash', 'Delete the draft folder offers/old'),
    decided(2000, 'a1', 'allowed-once'),
    asked(3000, 'a2', 'bash', 'Send a bulk mail to 4,000 people'),
    decided(4000, 'a2', 'denied'),
    qcall(5000, 'q1', 'Send the offer to the five recruiters?', ['Send', 'Wait']),
    qresult(6000, 'q1', 'Send'),
    decided(7000, 'a9', 'allowed-once'), // asked before this reading began: nothing to seal over
  ]
  for (const e of events) rec.ingest('session-s1', e)
  const written = readDecisions(dir, 's1')
  assert.equal(written['a:a1'].kid, key.keyId)
  assert.equal(typeof written['a:a1'].sig, 'string')
  assert.equal(typeof written['q:q1'].sig, 'string')
  assert.equal(written['a:a9'].sig, null)
  assert.equal(written['a:a9'].by, 'Amira Benali')
  const states = verifyDecisions(events, written, 's1', key)
  assert.deepEqual(states, { 'a:a1': 'valid', 'a:a2': 'valid', 'q:q1': 'valid' })
  ok('each decision is sealed at its moment (permission and question); one whose question was not seen is named but not sealed; the checker finds them all valid')

  // ── any edit afterwards breaks the seal ──────────────────────────────────────────────
  const edited = (fn) => { const copy = JSON.parse(JSON.stringify(events)); fn(copy); return verifyDecisions(copy, written, 's1', key) }
  assert.equal(edited((e) => { e[3].data.outcome = 'allowed-once' })['a:a2'], 'broken') // a refusal turned into an approval in the log
  assert.equal(edited((e) => { e[2].data.reason = 'Send a mail to 4 people' })['a:a2'], 'broken') // what was asked changed
  assert.equal(edited((e) => { e[5].data.message.content[0].text = 'Wait' })['q:q1'], 'broken') // the answer changed
  assert.equal(edited((e) => { e[4].data.arguments = e[4].data.arguments.replace('five', 'fifty') })['q:q1'], 'broken') // the question changed
  assert.equal(edited((e) => { e[1].time += 1 })['a:a1'], 'broken') // the time changed
  assert.equal(edited((e) => { e.splice(0, 2) })['a:a1'], 'broken') // the decision vanished from the log
  const forged = JSON.parse(JSON.stringify(written))
  forged['a:a1'].by = 'Someone Else'
  assert.equal(verifyDecisions(events, forged, 's1', key)['a:a1'], 'broken') // the record's name changed
  forged['a:a1'].by = written['a:a1'].by
  forged['a:a1'].device = 'Mac mini'
  assert.equal(verifyDecisions(events, forged, 's1', key)['a:a1'], 'broken') // the record's computer changed
  assert.equal(verifyDecisions(events, written, 's1', other)['a:a1'], 'foreign') // another key
  assert.equal(verifyDecisions(events, written, 's1', null)['a:a1'], 'foreign') // no key here
  assert.deepEqual(verifyDecisions(events, { 'a:a9': written['a:a9'] }, 's1', key), {}) // no seal: not in the answer
  assert.deepEqual(verifyDecisions(null, null, 's1', key), {})
  assert.deepEqual(verifyDecisions(events, { 'a:a1': 'nope', 'a:a2': { sig: 7 } }, 's1', key), {})
  ok('a log or a record edited afterwards breaks the seal (outcome, question, answer, time, a vanished decision, the name, the computer); another key or no key is « foreign »; no seal is not an answer')

  // ── the story shows the seal on the approver ─────────────────────────────────────────
  const story = deriveStory(events, { sessionId: 's1', runs: [], decisions: written, seals: states })
  const ho = story.moments.filter((m) => m.kind === 'handover')
  assert.deepEqual(ho.map((m) => m.approvers[0].seal), ['valid', 'valid', 'valid'])
  assert.deepEqual(ho.map((m) => m.approvers[0].signed), [true, true, true])
  const tampered = deriveStory(events, { sessionId: 's1', runs: [], decisions: written, seals: { 'a:a1': 'broken', 'a:a2': 'foreign', 'q:q1': 'whatever' } }).moments.filter((m) => m.kind === 'handover')
  assert.deepEqual(tampered.map((m) => m.approvers[0].seal), ['broken', 'foreign', null])
  assert.deepEqual(tampered.map((m) => m.approvers[0].signed), [false, false, false])
  const plain = deriveStory(events, { sessionId: 's1', runs: [], decisions: written }).moments.filter((m) => m.kind === 'handover')
  assert.deepEqual(plain.map((m) => m.approvers[0].seal), [null, null, null])
  ok('the story marks each approver sealed, broken or sealed elsewhere; an unknown word is no seal; with nothing checked nothing is claimed')

  // ── the tracker alone: what a decision was about ─────────────────────────────────────
  const t = createDecisionTracker()
  assert.equal(t.ingest(asked(0, 'x', 'bash', 'r')), null)
  const f = t.ingest(decided(5, 'x', 'allowed-once', { by: 'Engine Name' }))
  assert.equal(f.named, true)
  assert.equal(f.subject, subjectOf('permission', 'bash', 'r'))
  assert.equal(t.ingest(qresult(9, 'never-asked', 'x')), null)
  for (const bad of [null, undefined, 3, 'x', [], {}, { type: 'tool/call' }, { type: 'tool/call', data: { callId: 'c', name: 'bash' } }, { type: 'tool/result', data: null }]) assert.equal(t.ingest(bad), null)
  assert.equal(decisionKey('permission', 'x'), 'a:x')
  assert.equal(decisionsFile(dir, 'session-s1'), join(dir, 's1.jsonl'))
  ok('the tracker reads each decision with what it was about and never throws on rubbish')

  // ── a key that cannot sign never stops a decision from being recorded ────────────────
  const dir2 = join(root, 'decisions2')
  const noSign = createRecorder({ dir: dir2, who: () => ({ by: 'Amira Benali', device: 'MacBook Pro' }), seal: () => { throw new Error('no key') } })
  for (const e of events.slice(0, 2)) noSign.ingest('s2', e)
  assert.equal(readDecisions(dir2, 's2')['a:a1'].sig, null)
  assert.equal(readDecisions(dir2, 's2')['a:a1'].by, 'Amira Benali')
  const brokenKey = createRecorder({ dir: dir2, who: () => ({ by: 'Amira Benali', device: null }), seal: () => ({ keyId: 'k', sign: () => { throw new Error('boom') } }) })
  for (const e of events.slice(0, 2)) brokenKey.ingest('s3', e)
  assert.equal(readDecisions(dir2, 's3')['a:a1'].sig, null)
  ok('a key that cannot be had or cannot sign leaves the decision named and unsealed, never lost')
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('\n' + pass + ' groups passed')
