// ── KB-AUTOTRIAL-TEST-HEADER ───────────────────────────────────────────────
// The certified trial and its proof: the state machine, the proof report read from a real journal, the gate record
// ladder that caps a stored status at what its evidence allows, and the one activation predicate of the lot.
//
//   node packages/kybernos-plugin/test-automation-trial.mjs    (exit 0 = everything passes)
//
// Every case mirrors one row of the strategy (docs/tests/gate-trial-proof-strategy.md, §unit) and one row of the spec
// (docs/dev/kaby-proactive/specs/gate-trial-proof.md, §5). No GUI and no store: the module is pure, so the proof of the
// rules is a function of arguments.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as gateModule from './automation-gate.mjs'
import * as m from './automation-trial.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── the engine's own journal, and a gate record as B1 leaves it ────────────────────────────────────────────────────
const T0 = 1_790_000_000_000
const at = new Date(T0).toISOString()
const later = new Date(T0 + 60_000).toISOString()
let seq = 0
const ev = (type, dt, data) => ({ type, seq: (seq += 1), time: T0 + dt, data })

/**
 * A journal of ONE turn. `calls`: { name, args?, text?, error?, approval? } — `approval` writes the engine's
 * `approval/asked` + `approval/decided` pair before the call, exactly as the engine does. `open` leaves the turn
 * unclosed, `failed` closes it with an error reason.
 */
const journalOf = (calls, opts) => {
  const o = opts === undefined ? {} : opts
  const out = [ev('session', 0, {}), ev('turn/start', 100, { turn: 1 })]
  calls.forEach((c, i) => {
    const callId = 'c' + i
    if (c.approval !== undefined) {
      out.push(ev('approval/asked', 150 + i, { id: 'a' + i, callId, toolName: c.name }))
      out.push(ev('approval/decided', 160 + i, { id: 'a' + i, outcome: c.approval }))
    }
    out.push(ev('tool/call', 200 + i, { turn: 1, step: 1, callId, name: c.name, arguments: JSON.stringify(c.args === undefined ? {} : c.args) }))
    out.push(ev('tool/result', 300 + i, {
      turn: 1,
      step: 1,
      message: Object.assign({ role: 'tool', toolCallId: callId, content: c.text === undefined ? 'ok' : c.text }, c.error === true ? { isError: true } : {}),
    }))
  })
  if (o.open !== true) {
    out.push(ev('turn/end', 400 + calls.length, {
      turn: 1,
      reason: o.failed === true ? { kind: 'error', error: { code: 'no-credential', message: o.message === undefined ? 'the provider refused' : o.message } } : { kind: 'completed' },
    }))
  }
  return out
}

/** A gate record as B1 hands it over: static checks passed, nothing else done. */
const gate = (extra) => Object.assign({
  id: 'gate:a1',
  automationId: 'a1',
  status: 'static-passed',
  staticChecks: { ranAt: at, verdict: 'pass', findings: [] },
  trial: null,
  approval: { state: 'none', at: null },
  updatedAt: at,
  rev: 1,
}, extra === undefined ? {} : extra)

const start = () => {
  const r = m.startTrial({ gate: gate(), by: 'person', at })
  assert.equal(r.ok, true)
  return r.trial
}

const clean = m.trialFromEvents({ trial: start(), events: journalOf([{ name: 'read', args: { path: '/tmp/x' } }, { name: 'web_search', args: { q: 'x' } }]), at })
const dirty = m.trialFromEvents({ trial: start(), events: journalOf([{ name: 'bash', args: { command: 'ls' } }]), at })
const passingGate = m.applyTrial(gate(), { trial: clean.trial, proof: clean.proof, at })

// ── 1. no turn at all: no proof is claimed (row 1) ──────────────────────────────────────────────────────────────────
{
  const t = start()
  assert.deepEqual(m.trialFromEvents({ trial: t, events: [], at }), { trial: t, proof: null })
  assert.equal(m.trialFromEvents({ trial: t, events: [ev('session', 0, {})], at }).proof, null)
  assert.equal(m.trialFromEvents({ trial: t, events: null, at }).proof, null)
  ok('empty or turn-less journal: proof null, trial still requested, no state invented')
}

// ── 2. an open turn: running, never done (row 2) ───────────────────────────────────────────────────────────────────
{
  const r = m.trialFromEvents({ trial: start(), events: journalOf([{ name: 'read' }], { open: true }), at })
  assert.deepEqual(r.proof.outcome, { state: 'open' })
  assert.equal(r.proof.endedAt, null)
  assert.equal(r.trial.state, 'running')
  assert.equal(r.proof.sideEffectFree, true)
  assert.equal(m.trialPassed(r.proof), false, 'a run that is still open does not pass')
  ok('open turn: outcome open, endedAt null, trial running, and a pass needs the run to complete')
}

// ── 3. a write call that ran: an outside effect (row 3) ────────────────────────────────────────────────────────────
{
  const r = m.trialFromEvents({ trial: start(), events: journalOf([{ name: 'mcp__gmail__send_email', args: { to: 'x@example.com' } }]), at })
  assert.equal(r.proof.toolCalls[0].access, 'write')
  assert.equal(r.proof.toolCalls[0].outcome, 'ok')
  assert.equal(r.proof.sideEffectFree, false)
  assert.deepEqual(r.proof.externalEffects, ['write-succeeded:mcp__gmail__send_email'])
  assert.equal(m.trialPassed(r.proof), false)
  assert.equal(m.gateStatusAfterTrial(r.trial, r.proof), 'trial-done')
  ok('a write call that ran: access write, outcome ok, sideEffectFree false, one write-succeeded effect')
}

// ── 4/5/6. a refusal is the mask working, never an outside effect (rows 4, 5, 6) ──────────────────────────────────
{
  for (const decision of ['rejected', 'cancelled', 'unavailable']) {
    const r = m.trialFromEvents({ trial: start(), events: journalOf([{ name: 'mcp__gmail__send_email', approval: decision, error: true, text: 'not sent' }]), at })
    assert.equal(r.proof.toolCalls[0].outcome, 'refused-as-write', decision)
    assert.deepEqual(r.proof.externalEffects, [], decision)
    assert.equal(r.proof.sideEffectFree, true, decision)
    assert.equal(m.trialPassed(r.proof), true, decision)
  }
  const masked = m.trialFromEvents({ trial: start(), events: journalOf([{ name: 'mcp__gmail__send_email', error: true, text: m.TRIAL_DENY_REASON }]), at })
  assert.equal(masked.proof.toolCalls[0].outcome, 'refused-as-write')
  assert.deepEqual(masked.proof.externalEffects, [])
  assert.equal(masked.proof.sideEffectFree, true)
  assert.equal(m.trialPassed(masked.proof), true)
  const errored = m.trialFromEvents({ trial: start(), events: journalOf([{ name: 'mcp__gmail__send_email', error: true, text: 'the provider timed out' }]), at })
  assert.equal(errored.proof.toolCalls[0].outcome, 'error')
  assert.deepEqual(errored.proof.externalEffects, ['write-unverified:mcp__gmail__send_email'])
  assert.equal(errored.proof.sideEffectFree, false, 'a write that errored with no refusal evidence may have run')
  assert.equal(m.trialPassed(errored.proof), false)
  ok('a refused write passes the proof; one that errored without refusal evidence does not (conservative)')
}

// ── 7. the classifier (rows 8, 9, 10) ─────────────────────────────────────────────────────────────────────────────
{
  assert.equal(m.accessOf('mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'GMAIL_SEND_EMAIL' }, { tool_slug: 'GMAIL_FETCH_EMAILS' }] }), 'write')
  assert.equal(m.accessOf('mcp__composio__COMPOSIO_SEARCH_TOOLS', { query: 'x' }), 'read')
  assert.equal(m.accessOf('mcp__composio__COMPOSIO_EXECUTE_TOOL', { tool_slug: 'GMAIL_FETCH_EMAILS' }), 'read')
  assert.equal(m.accessOf('mcp__composio__COMPOSIO_EXECUTE_TOOL', {}), 'write', 'actions that cannot be read are writes')
  assert.equal(m.accessOf('mcp__notion__list_pages', {}), 'read')
  for (const name of ['read', 'glob', 'grep', 'web_search', 'web_fetch', 'skill']) assert.equal(m.accessOf(name, {}), 'read', name)
  for (const name of ['bash', 'write', 'edit', 'spawn_teammate', 'subagent', 'mcp__x__foo', 'no_such_tool', '', null]) assert.equal(m.accessOf(name, {}), 'write', String(name))
  assert.equal(m.accessOf(undefined, {}), 'write')
  ok('accessOf: a known read word reads, one write word writes, an unknown name is never a read')
}

// ── 8. the verdict runs over every call, the lists are bounded (row 11) ───────────────────────────────────────────
{
  const calls = []
  for (let i = 0; i < 280; i += 1) calls.push({ name: 'read', args: { path: '/tmp/x' } })
  for (let i = 0; i < 20; i += 1) calls.push({ name: 'mcp__app' + i + '__send_email', args: { to: 'x@example.com' } })
  const r = m.trialFromEvents({ trial: start(), events: journalOf(calls), at })
  assert.equal(r.proof.toolCalls.length, m.PROOF_TOOL_CALLS_MAX)
  assert.equal(r.proof.toolCalls.every((c) => c.access === 'read'), true)
  assert.equal(r.proof.externalEffects.length, m.PROOF_EFFECTS_MAX)
  assert.equal(r.proof.externalEffects[0], 'write-succeeded:mcp__app0__send_email')
  assert.equal(r.proof.sideEffectFree, false, 'the writes past the output bound still count')
  assert.equal(m.trialPassed(r.proof), false)
  // The same effect twice is one entry: a proof names what reached the outside, not how often.
  const repeated = m.trialFromEvents({ trial: start(), events: journalOf([{ name: 'bash' }, { name: 'bash' }, { name: 'bash' }]), at })
  assert.deepEqual(repeated.proof.externalEffects, ['write-succeeded:bash'])
  ok('300 calls: lists capped at 20 and 10, verdict computed over all 300 calls, effects deduplicated')
}

// ── 9. only the first turn is read (row 12) ───────────────────────────────────────────────────────────────────────
{
  const first = journalOf([{ name: 'read' }, { name: 'web_search' }])
  const twoTurns = first.concat([
    ev('turn/start', 500, { turn: 2 }),
    ev('tool/call', 510, { turn: 2, step: 1, callId: 'x1', name: 'bash', arguments: '{"command":"ls"}' }),
    ev('turn/end', 520, { turn: 2, reason: { kind: 'completed' } }),
  ])
  const r = m.trialFromEvents({ trial: start(), events: twoTurns, at })
  assert.equal(r.proof.toolCalls.length, 2)
  assert.equal(r.proof.sideEffectFree, true, 'what the person says in that chat afterwards is theirs')
  ok('a second turn later in the journal is ignored: the run is the first turn')
}

// ── 10/11/12/13. the refusals of startTrial (rows 13, 14, 15, 16) ────────────────────────────────────────────────
{
  for (const by of ['model', 'cron', 'webhook', undefined, 'person ']) {
    const r = m.startTrial({ gate: gate(), by, at })
    assert.equal(r.ok, false)
    assert.equal(r.code, 'not-supervised', String(by))
    assert.equal(r.trial, undefined)
    assert.equal(typeof r.error, 'string')
  }
  for (const status of ['draft', 'static-failed', 'awaiting-approval', 'nonsense']) assert.equal(m.startTrial({ gate: gate({ status }), by: 'person', at }).code, 'gate-not-ready', status)
  assert.equal(m.startTrial({ gate: { id: 'gate:', automationId: '..' }, by: 'person', at }).code, 'gate-not-ready')
  const open = m.startTrial({ gate: gate({ trial: { outcome: { state: 'open' } } }), by: 'person', at })
  assert.equal(open.code, 'already-open')
  assert.equal(m.startTrial({ gate: gate(), by: 'person', at, capacity: { level: 'high' } }).code, 'machine-busy')
  const busy = m.startTrial({ gate: gate(), by: 'person', at, capacity: { level: 'busy' } })
  assert.equal(busy.ok, true, 'busy allows one run, so a trial fits')
  assert.equal(m.startTrial({ gate: gate(), by: 'person', at, capacity: { level: 'ok', maxParallel: 1 } }).ok, true)
  ok('startTrial: a person only, a ready gate, no open trial, and a machine slot asked of the load rules')
}

// ── 14. the edges (row 17) ────────────────────────────────────────────────────────────────────────────────────────
{
  const t = start()
  assert.deepEqual(Object.keys(t).sort(), ['approvals', 'automationId', 'endedAt', 'gateId', 'id', 'mask', 'refusal', 'requestedAt', 'sessionId', 'startedAt', 'state', 'supervised'].sort())
  assert.equal(t.approvals, 'ask')
  assert.equal(t.mask, 'deny-writes')
  assert.equal(t.supervised, true)
  const r1 = m.advanceTrial(t, { type: 'run-started', at: later, sessionId: 's1' })
  assert.equal(r1.changed, true)
  assert.equal(r1.trial.state, 'running')
  assert.equal(r1.trial.startedAt, later)
  assert.equal(r1.trial.sessionId, 's1')
  const r2 = m.advanceTrial(r1.trial, { type: 'run-ended', at: later })
  assert.equal(r2.trial.state, 'done')
  assert.equal(r2.trial.endedAt, later)
  const r3 = m.advanceTrial(r2.trial, { type: 'run-started', at: later })
  assert.equal(r3.changed, false)
  assert.equal(r3.code, 'illegal-transition')
  const failed = m.advanceTrial(t, { type: 'run-failed', at: later })
  assert.equal(failed.trial.state, 'failed')
  assert.equal(m.advanceTrial(failed.trial, { type: 'run-ended', at: later }).changed, false, 'a retry is a new trial, not an edge')
  assert.equal(m.advanceTrial(t, { type: 'bogus' }).changed, false)
  assert.equal(m.advanceTrial(null, { type: 'run-started' }).changed, false)
  ok('advanceTrial: requested→running→done, running→failed, and three illegal signals refused')
}

// ── 15. the frozen vocabularies, and the seam with B1 (spec §3.3, cadrage unions) ─────────────────────────────────
{
  assert.deepEqual(m.TRIAL_STATES, ['requested', 'running', 'done', 'failed'])
  assert.deepEqual(m.TRIAL_TRANSITIONS, { requested: ['running', 'failed'], running: ['done', 'failed'], done: [], failed: [] })
  assert.deepEqual(Object.keys(m.TRIAL_TRANSITIONS), ['requested', 'running', 'done', 'failed'])
  assert.equal(m.TRIAL_APPROVALS, 'ask')
  assert.equal(m.TRIAL_MASK, 'deny-writes')
  assert.equal(m.TRIAL_DENY_REASON.includes('supervised trial'), true)
  assert.equal(m.PROOF_TEXT_MAX, 420)
  assert.equal(m.GATE_ID_MAX, 120)
  assert.equal(m.GATE_STATUSES, gateModule.GATE_STATUSES, 'the re-export is B1\'s own list, not a copy')
  assert.equal(m.GATE_APPROVAL_STATES, gateModule.GATE_APPROVAL_STATES)
  assert.equal(m.GATE_RECORD_KEYS, gateModule.GATE_RECORD_KEYS)
  assert.equal(m.GATE_FINDINGS_MAX, gateModule.GATE_FINDINGS_MAX)
  assert.deepEqual([...m.GATE_STATUSES], ['draft', 'static-failed', 'static-passed', 'trial-done', 'awaiting-approval', 'approved', 'refused', 'activated'])
  assert.deepEqual([...m.GATE_APPROVAL_STATES], ['none', 'asked', 'granted', 'refused'])
  assert.deepEqual([...m.GATE_RECORD_KEYS], ['id', 'automationId', 'status', 'staticChecks', 'trial', 'approval', 'updatedAt', 'rev'])
  assert.equal(m.GATE_FINDINGS_MAX, 33)
  ok('the vocabularies are the frozen ones and the gate seam is B1\'s own objects')
}

// ── 16. the ladder: an anti-forgery rung, and mayActivate (rows 18, 19, 20) ───────────────────────────────────────
{
  const forged = m.normalizeGateRecord(Object.assign(gate(), { staticChecks: null, status: 'activated', approval: { state: 'none', at: null } }))
  assert.equal(forged.status, 'draft')
  assert.equal(m.mayActivate(forged), false)
  const grantedFailing = m.normalizeGateRecord(gate({ status: 'activated', trial: dirty.proof, approval: { state: 'granted', at } }))
  assert.equal(grantedFailing.status, 'trial-done')
  assert.equal(m.mayActivate(grantedFailing), false)
  const approved = m.normalizeGateRecord(gate({ status: 'approved', trial: clean.proof, approval: { state: 'granted', at } }))
  assert.equal(approved.status, 'approved')
  assert.equal(m.mayActivate(approved), true)
  const activated = m.normalizeGateRecord(gate({ status: 'activated', trial: clean.proof, approval: { state: 'granted', at } }))
  assert.equal(activated.status, 'activated')
  assert.equal(m.mayActivate({ status: 'activated', trial: clean.proof, approval: { state: 'none', at: null } }), false)
  assert.equal(m.mayActivate({ status: 'approved', trial: clean.proof, approval: { state: 'granted', at: null } }), false, 'a grant with no timestamp is not a grant')
  assert.equal(m.mayActivate({ status: 'trial-done', trial: clean.proof, approval: { state: 'granted', at } }), false)
  assert.equal(m.mayActivate(null), false)
  assert.equal(m.mayActivate('x'), false)
  ok('the ladder caps a forged activated to draft; approved + granted + passing proof is the only activation')
}

// ── 17. the static rung is derived from the verdict (row 21) ──────────────────────────────────────────────────────
{
  const derived = m.normalizeGateRecord(gate({ status: 'static-passed', staticChecks: { ranAt: at, verdict: 'fail', findings: [{ code: 'name.missing', severity: 'blocker', message: 'name is empty.' }] } }))
  assert.equal(derived.status, 'static-failed')
  const passing = m.normalizeGateRecord(gate({ status: 'static-failed', staticChecks: { ranAt: at, verdict: 'pass', findings: [] } }))
  assert.equal(passing.status, 'static-failed', 'normalization never raises a status')
  ok('static-passed with a failing verdict reads static-failed, derived and never trusted')
}

// ── 18. rev is floored and never raised by normalization (row 22) ─────────────────────────────────────────────────
{
  for (const rev of [0, -3, '7', 3.5, undefined, null, NaN]) assert.equal(m.normalizeGateRecord(gate({ rev })).rev, 1, String(rev))
  assert.equal(m.normalizeGateRecord(gate({ rev: 9 })).rev, 9)
  assert.equal(m.normalizeGateRecord(gate({ rev: 1 })).rev, 1)
  ok('rev: floored at 1, kept when it is a whole number, never raised by normalization')
}

// ── 19. hostile text is scrubbed (row 23) ─────────────────────────────────────────────────────────────────────────
{
  const hostile = 'boom user@example.com ' + 'A'.repeat(500) + ' \u0007 end\u2028line'
  const r = m.trialFromEvents({ trial: start(), events: journalOf([{ name: 'read', error: true, text: hostile }]), at })
  const message = r.proof.errors[0].message
  assert.equal(message.indexOf('@') >= 0 && /[\w.+-]+@[\w-]+\.[\w.]+/.test(message), false, 'no e-mail address')
  assert.equal(/[A-Za-z0-9_-]{28,}/.test(message), false, 'no long token')
  assert.equal(/[\u0000-\u001f\u007f]/.test(message), false, 'no control character')
  assert.ok(message.length <= m.PROOF_TEXT_MAX)
  assert.equal(r.proof.errors[0].where, 'read')
  assert.equal(r.proof.errors[0].at, new Date(T0 + 300).toISOString(), 'a journal time, formatted by arithmetic')
  const pathy = m.trialFromEvents({ trial: start(), events: journalOf([{ name: 'read', error: true, text: 'cannot read "/tmp/notes/a.md" as text' }]), at })
  assert.equal(pathy.proof.errors[0].message.includes('/tmp/notes/a.md'), false, 'a proof carries no absolute path')
  assert.equal(pathy.proof.errors[0].message.includes('cannot read'), true, 'and keeps the reason')
  ok('a result body with an e-mail, a 500-char token and control characters is scrubbed and bounded')
}

// ── 20. hostile records (row 24) ──────────────────────────────────────────────────────────────────────────────────
{
  for (const raw of [null, [], 'x', {}, { automationId: '../x' }, { automationId: 'a'.repeat(200) }, 42]) {
    assert.equal(m.normalizeGateRecord(raw, { at }), null, JSON.stringify(raw))
    assert.equal(m.normalizeProof(raw), null, JSON.stringify(raw))
    assert.equal(m.toStoredGate(raw), null)
    assert.equal(m.applyTrial(raw, { at }), null)
    assert.equal(m.refuseApproval(raw, { at }), null)
    assert.equal(m.askApproval(raw, { at }).ok, false)
    assert.equal(m.mayActivate(raw), false)
  }
  ok('null, [], a string, {} and a path-like id are unusable: null, never an invented record')
}

// ── 21. applying the same proof twice is a no-op (row 25) ─────────────────────────────────────────────────────────
{
  const once = m.applyTrial(gate(), { trial: clean.trial, proof: clean.proof, at })
  const twice = m.applyTrial(once, { trial: clean.trial, proof: clean.proof, at })
  assert.deepEqual(twice, once)
  assert.equal(twice.rev, once.rev, 'an equal record means no write is needed')
  assert.equal(once.rev, 2)
  assert.equal(once.status, 'awaiting-approval')
  const withProof = m.applyTrial(gate(), { trial: dirty.trial, proof: dirty.proof, at })
  assert.equal(withProof.status, 'trial-done')
  assert.equal(m.applyTrial(gate(), { at }).status, 'static-passed', 'no proof, no rung')
  ok('applyTrial: rev rises by exactly 1, and applying the same proof again changes nothing')
}

// ── 22. the writer shape (row 26) ─────────────────────────────────────────────────────────────────────────────────
{
  const stored = m.toStoredGate(passingGate)
  assert.deepEqual(Object.keys(stored), [...m.GATE_RECORD_KEYS], 'exactly the frozen keys, in their order')
  assert.equal(Object.values(stored).some((v) => v === undefined), false, 'no undefined reaches the store')
  assert.deepEqual(m.normalizeGateRecord(stored), m.normalizeGateRecord(passingGate), 'the round trip is stable')
  assert.deepEqual(m.toStoredGate(m.normalizeGateRecord(stored)), stored)
  assert.equal(JSON.parse(JSON.stringify(stored)).rev, stored.rev)
  assert.equal(typeof stored.trial.sideEffectFree, 'boolean')
  assert.deepEqual(Object.keys(stored.trial), ['runId', 'gateId', 'startedAt', 'endedAt', 'supervised', 'sideEffectFree', 'toolCalls', 'outcome', 'externalEffects', 'errors', 'proofHash'])
  assert.match(stored.trial.proofHash, /^fnv1a:[0-9a-f]{8}$/, 'the proof carries the fingerprint of its own content')
  ok('toStoredGate emits the frozen keys only, and normalization round-trips it unchanged')
}

// ── 22b. the integrity rung: a claim of approval is evidence, never text (finding P1 #4) ─────────────────────────
{
  // A proof as a hand-editor would write it: every field `trialPassed` reads, and nothing this module sealed.
  const handWritten = {
    runId: 'trial:a1:1', gateId: 'gate:a1', startedAt: at, endedAt: at, supervised: true, sideEffectFree: true,
    toolCalls: [], outcome: { state: 'completed' }, externalEffects: [], errors: [],
  }
  const claimed = (over) => gate(Object.assign({ status: 'activated', staticChecks: { ranAt: at, verdict: 'pass', findings: [] }, approval: { state: 'granted', at } }, over === undefined ? {} : over))

  // 1. no trial at all: `activated` + `granted` is a claim with nothing behind it.
  const noTrial = m.normalizeGateRecord(claimed({ trial: null }))
  assert.equal(noTrial.status, 'draft')
  assert.equal(m.mayActivate(noTrial), false)
  // 2. a trial with no run id reports no run.
  const noRun = m.normalizeGateRecord(claimed({ trial: Object.assign({}, handWritten, { runId: '' }) }))
  assert.equal(noRun.status, 'draft')
  assert.equal(noRun.trial, null, 'a proof with no run id is not a proof')
  // 3. a whole hand-written proof (clean-looking, passes every runtime clause) still has no fingerprint.
  assert.equal(m.normalizeProof(handWritten).proofHash, undefined, 'normalization never invents a fingerprint')
  assert.equal(m.trialPassed(handWritten), false, 'an unsealed proof is not a pass, it is a claim')
  const forgedProof = m.normalizeGateRecord(claimed({ trial: handWritten }))
  assert.equal(forgedProof.status, 'draft')
  assert.equal(m.mayActivate(forgedProof), false)
  assert.equal(m.mayActivate(claimed({ trial: handWritten })), false, 'the raw object is refused too, not only the normalized one')
  // 4. a fingerprint that does not match its own content is dropped, so the proof reads as unsealed.
  const badHash = m.normalizeProof(Object.assign({}, handWritten, { proofHash: 'fnv1a:deadbeef' }))
  assert.equal(badHash.proofHash, undefined)
  assert.equal(m.normalizeGateRecord(claimed({ trial: Object.assign({}, handWritten, { proofHash: 'fnv1a:deadbeef' }) })).status, 'draft')
  // 5. a genuine proof edited afterwards breaks its own fingerprint.
  const tampered = Object.assign({}, clean.proof, { externalEffects: ['write-succeeded:gmail_send'] })
  assert.equal(m.normalizeProof(tampered).proofHash, undefined, 'the hash no longer matches the content it describes')
  assert.equal(m.trialPassed(clean.proof), true, 'the untouched proof still passes')
  // 6. a grant with no timestamp is not a grant.
  const undated = m.normalizeGateRecord(gate({ status: 'approved', trial: clean.proof, approval: { state: 'granted', at: null } }))
  assert.equal(undated.status, 'draft')
  assert.equal(m.mayActivate(undated), false)
  // 7. a grant dated in the future is not a decision anybody has made yet — against the caller's instant...
  const futureCaller = m.normalizeGateRecord(
    gate({ status: 'approved', trial: clean.proof, approval: { state: 'granted', at: later }, updatedAt: later }),
    { at },
  )
  assert.equal(futureCaller.status, 'draft')
  // ...and against the record's own last write when the caller gives no instant.
  const futureOwn = m.normalizeGateRecord(gate({ status: 'approved', trial: clean.proof, approval: { state: 'granted', at: later } }))
  assert.equal(futureOwn.status, 'draft')
  // 8. the genuine article survives every one of those checks, and reads the same twice.
  const genuine = m.normalizeGateRecord(gate({ status: 'activated', trial: clean.proof, approval: { state: 'granted', at } }), { at: later })
  assert.equal(genuine.status, 'activated')
  assert.equal(m.mayActivate(genuine), true)
  assert.deepEqual(m.normalizeGateRecord(genuine, { at: later }), genuine)
  // 9. a refused record stays refused whatever the evidence says: the refusal is orthogonal and terminal.
  const refusedForged = m.normalizeGateRecord(gate({ status: 'refused', trial: null, approval: { state: 'refused', at } }))
  assert.equal(refusedForged.status, 'refused')
  ok('a forged approved/activated record is capped to draft; only a sealed proof with a dated grant activates')
}

// ── 23. findings are bounded and normalized (row 23 of the spec, strategy case 23) ───────────────────────────────
{
  const many = []
  for (let i = 0; i < 40; i += 1) many.push({ code: 'code.' + i, severity: i === 0 ? 'weird' : 'warn', message: 'message ' + i })
  many.push({ code: 'code.1', severity: 'blocker', message: 'a duplicate of a code already listed' })
  const rec = m.normalizeGateRecord(gate({ staticChecks: { ranAt: at, verdict: 'pass', findings: many } }))
  assert.equal(rec.staticChecks.findings.length, m.GATE_FINDINGS_MAX)
  assert.equal(rec.staticChecks.findings[0].severity, 'info', 'an unknown severity is an info')
  assert.deepEqual(Object.keys(rec.staticChecks.findings[1]), ['code', 'severity', 'message'])
  assert.equal(rec.staticChecks.findings.filter((f) => f.code === 'code.1').length, 1, 'one finding per code')
  const noStamp = m.normalizeGateRecord(gate({ staticChecks: { ranAt: 'yesterday', verdict: 'pass', findings: [] } }))
  assert.equal(noStamp.staticChecks.ranAt, at, 'a check block with no usable instant takes the record\'s own stamp')
  ok('findings capped at B1\'s 33, one per code, an unknown severity is info, no non-ISO instant emitted')
}

// ── 24. the export surface (spec §3.2.1) ─────────────────────────────────────────────────────────────────────────
{
  const expected = [
    'accessOf', 'startTrial', 'advanceTrial', 'trialFromEvents', 'trialPassed', 'gateStatusAfterTrial', 'applyTrial',
    'askApproval', 'refuseApproval', 'mayActivate', 'normalizeProof', 'normalizeGateRecord', 'toStoredGate',
    'TRIAL_STATES', 'TRIAL_TRANSITIONS', 'TRIAL_APPROVALS', 'TRIAL_MASK', 'TRIAL_DENY_REASON',
    'PROOF_TOOL_CALLS_MAX', 'PROOF_ERRORS_MAX', 'PROOF_EFFECTS_MAX', 'PROOF_TEXT_MAX', 'GATE_ID_MAX',
    'GATE_STATUSES', 'GATE_APPROVAL_STATES', 'GATE_RECORD_KEYS', 'GATE_FINDINGS_MAX',
  ]
  assert.equal(expected.length, 27)
  assert.deepEqual(Object.keys(m).sort(), expected.sort(), 'a name added, renamed or dropped fails here')
  assert.equal(Object.keys(m).filter((k) => /^(grant|activate|approve)/.test(k)).length, 0, 'no grant and no activate transition exists')
  for (const name of ['startTrial', 'toStoredGate', 'mayActivate']) assert.equal(typeof m[name], 'function', name + ' is the export B3 adopts')
  assert.equal(m.default, undefined)
  ok('the module exports exactly the 27 names of the spec and no grant/activate transition')
}

// ── 25. the module is pure at the file level ─────────────────────────────────────────────────────────────────────
{
  const src = readFileSync(new URL('./automation-trial.mjs', import.meta.url), 'utf8')
  const fromLines = src.split('\n').filter((line) => /\bfrom\s+'/.test(line))
  assert.equal(fromLines.length, 3, 'three imports, no more')
  for (const line of fromLines) assert.match(line, /from '\.\/(automation-runs|automation-load|automation-gate)\.mjs'$/)
  assert.equal(/Date\.now\(|new Date\(/.test(src), false, 'no clock')
  assert.equal(/from '(node:)?(fs|http|https|net|child_process)'/.test(src), false, 'no filesystem and no network')
  assert.equal(/fetch\(|require\(/.test(src), false)
  ok('three local imports, no clock, no filesystem, no network: B3 can import it without a boot risk')
}

// ── 26. the builder is a pure function of its arguments ──────────────────────────────────────────────────────────
{
  const events = journalOf([{ name: 'read' }, { name: 'mcp__gmail__send_email', approval: 'rejected', error: true, text: 'not sent' }])
  const before = JSON.stringify(events)
  const a = m.trialFromEvents({ trial: start(), events, at })
  const b = m.trialFromEvents({ trial: start(), events, at })
  assert.deepEqual(a, b)
  assert.deepEqual(m.trialFromEvents({ trial: start(), events, at }), b, 'a third run gives the same bytes')
  assert.equal(JSON.stringify(events), before, 'the builder never mutates the journal it was given')
  assert.equal(m.PROOF_TOOL_CALLS_MAX, 20)
  ok('two runs of the same events give the same proof, and the journal is left untouched')
}

// ── 27. no invented time (row 27) ───────────────────────────────────────────────────────────────────────────────
{
  for (const bad of [undefined, '', 'yesterday', '2026-13-45T99:99:99Z', 42]) {
    assert.equal(m.startTrial({ gate: gate(), by: 'person', at: bad }).code, 'no-timestamp', String(bad))
    assert.equal(m.askApproval(passingGate, { at: bad }).code, 'no-timestamp', String(bad))
  }
  assert.equal(m.normalizeGateRecord({ automationId: 'a1', status: 'static-passed', updatedAt: 'yesterday' }), null)
  const noOwnStamp = m.normalizeGateRecord({ automationId: 'a1', status: 'static-passed', updatedAt: 'yesterday' }, { at })
  assert.equal(noOwnStamp.updatedAt, at, 'the caller\'s instant stands in for a missing stored one')
  assert.equal(noOwnStamp.status, 'draft', 'and the status still follows the evidence: no checks, no static rung')
  assert.equal(m.normalizeGateRecord({ automationId: 'a1', status: 'static-passed' }, { at: '' }), null)
  const kept = m.applyTrial(gate(), { trial: clean.trial, proof: clean.proof, at: 'yesterday' })
  assert.equal(kept.updatedAt, at, 'an unusable at keeps the previous stamp')
  assert.notEqual(kept.updatedAt, '')
  assert.equal(m.refuseApproval(gate({ updatedAt: 'x' }), { at: 'yesterday' }), null, 'nothing to stamp and nothing stored: unusable')
  ok('a missing, empty or non-ISO at is refused, never replaced by an invented time, and no empty string is emitted')
}

// ── the person's decision (ask, refuse) ─────────────────────────────────────────────────────────────────────────
{
  const asked = m.askApproval(passingGate, { at: later })
  assert.equal(asked.ok, true)
  assert.equal(asked.gate.status, 'awaiting-approval')
  assert.deepEqual(asked.gate.approval, { state: 'asked', at: later })
  assert.equal(asked.gate.updatedAt, later)
  assert.equal(asked.gate.rev, passingGate.rev + 1)
  const again = m.askApproval(asked.gate, { at: later })
  assert.deepEqual(again.gate, asked.gate, 'asking the same thing twice is one write')
  assert.equal(m.askApproval(m.applyTrial(gate(), { trial: dirty.trial, proof: dirty.proof, at }), { at: later }).code, 'gate-not-ready')
  const refused = m.refuseApproval(asked.gate, { at: later })
  assert.equal(refused.status, 'refused')
  assert.deepEqual(refused.approval, { state: 'refused', at: later })
  assert.equal(m.mayActivate(refused), false)
  assert.equal(m.askApproval(refused, { at: later }).code, 'gate-not-ready', 'a refusal is terminal')
  assert.equal(m.normalizeGateRecord(refused).status, 'refused')
  assert.equal(m.gateStatusAfterTrial(clean.trial, clean.proof), 'awaiting-approval')
  assert.equal(m.gateStatusAfterTrial(dirty.trial, dirty.proof), 'trial-done')
  ok('ask sets awaiting-approval/asked and refuses a failing proof; refuse is terminal and never activates')
}

// ── a trial driven by events alone reaches done, never requested (spec §3.3) ────────────────────────────────────
{
  const r = m.trialFromEvents({ trial: start(), events: journalOf([{ name: 'read' }]), at })
  assert.equal(r.trial.state, 'done')
  assert.equal(r.trial.startedAt, new Date(T0 + 100).toISOString())
  assert.equal(r.trial.endedAt, new Date(T0 + 401).toISOString())
  const failed = m.trialFromEvents({ trial: start(), events: journalOf([{ name: 'read' }], { failed: true, message: 'no credential' }), at })
  assert.equal(failed.trial.state, 'failed')
  assert.equal(failed.proof.outcome.state, 'failed')
  assert.equal(failed.proof.outcome.code, 'no-credential')
  assert.equal(failed.proof.errors.some((e) => e.where === 'turn/end'), true)
  assert.equal(m.trialPassed(failed.proof), false)
  ok('a completed run reads done and a failed turn reads failed, from the events alone')
}

// ── 28. a stored proof is judged over EVERY call, not over the twenty it displays (P2) ─────────────────────────────
{
  const proofOf = (calls) => m.normalizeProof({
    runId: 'sess-1', gateId: 'gate:a1', startedAt: at, endedAt: later, supervised: true,
    sideEffectFree: true, toolCalls: calls, outcome: { state: 'completed' }, externalEffects: [], errors: [],
  })
  const read = () => ({ toolName: 'read', access: 'read', outcome: 'ok' })
  const send = (outcome) => ({ toolName: 'mcp__gmail__send_email', access: 'write', outcome })
  const reads = (n) => Array.from({ length: n }, () => read())
  // 20 reads, then a write at position 21: past the display cap, so the truncated list hid it from the verdict.
  const hidden = proofOf(reads(m.PROOF_TOOL_CALLS_MAX).concat([send('ok')]))
  assert.equal(hidden.toolCalls.length, m.PROOF_TOOL_CALLS_MAX, 'the display keeps its 20')
  assert.equal(hidden.toolCalls.some((c) => c.access === 'write'), false, 'the write is past the display cap')
  assert.equal(hidden.sideEffectFree, false, 'and still voids the verdict')
  assert.equal(m.trialPassed(hidden), false)
  // The same call refused at position 21 is the mask working: both clauses survive.
  const refused = proofOf(reads(m.PROOF_TOOL_CALLS_MAX).concat([send('refused-as-write')]))
  assert.equal(refused.sideEffectFree, true)
  // A proof assembled by hand is never a pass, even when it reads clean: the seal is what makes it evidence. A pasted
  // fingerprint does not help either — it has to be the one this content produces.
  assert.equal(m.trialPassed(refused), false, 'no fingerprint, no pass')
  assert.equal(m.trialPassed(Object.assign({}, refused, { proofHash: 'fnv1a:00000000' })), false, 'a pasted fingerprint is dropped')
  assert.equal(m.trialPassed(clean.proof), true, 'and the proof a real journal produced still passes')
  // Far past the cap as well: 279 reads then a write, judged whole.
  const long = proofOf(reads(279).concat([{ toolName: 'bash', access: 'write', outcome: 'ok' }]))
  assert.equal(long.toolCalls.length, m.PROOF_TOOL_CALLS_MAX)
  assert.equal(long.sideEffectFree, false)
  // A call the projection cannot read is a write that may have run, never a silent omission.
  const junk = proofOf([read(), 'nope'])
  assert.equal(junk.toolCalls.length, 2, 'the unreadable call is shown, not dropped')
  assert.deepEqual([junk.toolCalls[1].access, junk.toolCalls[1].outcome], ['write', 'error'])
  assert.equal(junk.sideEffectFree, false)
  // A proof longer than the scan bound is refused rather than half-read (the bound is the only place a call can vanish).
  const huge = proofOf(reads(1001))
  assert.equal(huge.toolCalls.length, m.PROOF_TOOL_CALLS_MAX)
  assert.equal(huge.sideEffectFree, false, 'a proof past the scan bound is refused, not believed')
  // And a clean 21-call proof with one refused write keeps passing, so the fix does not refuse everything long.
  const cleanLong = proofOf(reads(20).concat([send('refused-as-write'), read()]))
  assert.equal(cleanLong.toolCalls.length, m.PROOF_TOOL_CALLS_MAX)
  assert.equal(cleanLong.sideEffectFree, true)
  ok('normalizeProof judges every stored call before truncating: a write at position 21 voids the verdict')
}

console.log('\n' + pass + ' verifications OK')
process.exit(0)
