// test-automation-gate-routes.mjs — B3 host-gate-and-queue-routes.
//
// What this file proves, and why it can prove it: the six new actions of POST /kybernos/tasks (gate-check,
// trial-start, trial-report, approve, queue list, queue act), the gate store on disk, the five fire paths the gate closes
// (toggle, run-now, consume-fire, the webhook and the scheduler's own tick through kbFireTask), the three re-activation
// paths (update's default `active: true`, cloud-link's `wasActive`, a code-issued toggle), the `list` projection, and the
// runtime write guard of a trial (with its `tools/pre-execute` fallback).
//
// Three harnesses, all already green on this tree, are reused rather than invented:
//   - scripts/test-tasks-route.mjs — the real index.js booted with a fake context in a temporary DSH_HOME;
//   - test-write-guard.mjs + lib-session-test.mjs — a real loopback listener in front of the registered handler, and
//     DSH's signed cookie computed from the documented scheme, not with the code under test;
//   - test-automation-occurrences.mjs — the pure block extracted from index.js and imported through a `data:` URL, so the
//     unit cases run against the code the host runs and not a copy.
//
// Usage: node packages/kybernos-plugin/test-automation-gate-routes.mjs            (exit 0 = everything passes)
//        node packages/kybernos-plugin/test-automation-gate-routes.mjs --dump     (also prints the wire contract)
//        node packages/kybernos-plugin/test-automation-gate-routes.mjs --prove-refusals   (18 refusals or exit 1)

import http from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { GATE_STATUSES, checkDraft } from './automation-gate.mjs'
import { TRIAL_DENY_REASON, mayActivate, trialFromEvents } from './automation-trial.mjs'
import { stableStreak } from './automation-skills.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'kb-gate-routes-'))
process.env.HOME = home
process.env.DSH_HOME = home
process.env.USERPROFILE = home
process.env.KYBERNOS_AUTOMATION_LOAD_GUARD = 'off' // the box running this test must not decide what the tick does
mkdirSync(join(home, 'kybernos'), { recursive: true })

// DSH signs its browser cookie with a machine secret kept in <dsh home>/.credentials.yaml.
const { installSession, sessionCookie, OTHER_SECRET } = await import('./lib-session-test.mjs')
installSession(home)

// The scheduler must never tick by itself here: its 5 s and 30 s timers are captured, and the fixed 750 ms wait of the
// fire path is shrunk to 1 ms.
const realSetTimeout = globalThis.setTimeout
const captured = []
globalThis.setTimeout = (fn, ms, ...rest) => {
  if (ms === 5000 || ms === 30000) { captured.push({ fn, ms }); return { unref () {}, ref () {} } }
  if (ms === 750) return realSetTimeout(fn, 1, ...rest)
  return realSetTimeout(fn, ms, ...rest)
}

let n = 0
let fails = 0
const ok = (label, cond, detail) => {
  n += 1
  if (cond === true) { console.log('ok   ' + label); return }
  fails += 1
  console.log('FAIL ' + label + (detail === undefined ? '' : ' | ' + detail))
}
const eq = (label, got, want) => {
  n += 1
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  if (a === b) { console.log('ok   ' + label); return }
  fails += 1
  console.log('FAIL ' + label + ' | got ' + a + ' | want ' + b)
}
// ── The pure block, extracted the way the host runs it ────────────────────────────────────────────────────────────────
const source = readFileSync(join(here, 'index.js'), 'utf8')
const blockMatch = source.match(/\/\/ KB-GATE-STORE-BEGIN([\s\S]*?)\/\/ KB-GATE-STORE-END/)
if (blockMatch === null) { console.error('KB-GATE-STORE block not found in index.js'); process.exit(1) }
const blockSource = blockMatch[1]
const NAMES = ['KB_GATE_MAX', 'HUMAN_ONLY', 'kbHumanOnly', 'kbGateIdOf', 'kbGateValidRecord', 'kbGateEmptyRecord', 'kbGateNext',
  'kbGateCanApprove', 'kbGateActivationRefusal', 'kbGateTrialRefusal', 'kbGateBoundedRecord', 'kbGateAttach',
  'kbGateDemoteAfterEdit', 'kbGateInsert', 'kbGateRemoveOf', 'kbGateParse', 'kbMakeGateStore']
const block = await import('data:text/javascript,' + encodeURIComponent(blockSource + '\nexport { ' + NAMES.join(', ') + ' }'))

const ISO = '2026-10-28T08:00:00.000Z'

// The proof of a real journal run, sealed by B2 exactly as `trial-report` seals one. A proof typed out by hand is no
// longer a pass (finding P1 #4), so the fixture is built the way the host builds it: from events, never from a literal.
const sealedProof = (() => {
  const t0 = Date.parse(ISO)
  const events = [
    { type: 'turn/start', time: t0, data: {} },
    { type: 'tool/call', time: t0 + 10, data: { callId: 'c1', name: 'gmail_list', arguments: '{}' } },
    { type: 'tool/result', time: t0 + 20, data: { message: { toolCallId: 'c1', isError: false, content: 'two messages' } } },
    { type: 'turn/end', time: t0 + 30, data: { reason: { kind: 'completed' } } },
  ]
  const built = trialFromEvents({
    trial: { id: 'trial:st-1:1', gateId: 'gate:st-1', automationId: 'st-1', state: 'done', requestedAt: ISO, startedAt: ISO, endedAt: ISO, sessionId: 'sess-1', supervised: true, approvals: 'ask', mask: 'deny-writes', refusal: null },
    events,
    at: ISO,
  })
  if (built === null || built.proof === null) { console.error('the sealed proof fixture could not be built'); process.exit(1) }
  return built.proof
})()

const plainRecord = (over) => Object.assign({
  id: 'gate:st-1',
  automationId: 'st-1',
  status: 'awaiting-approval',
  staticChecks: { ranAt: ISO, verdict: 'pass', findings: [{ code: 'prompt.send.word', severity: 'warn', field: 'prompt', message: 'x' }] },
  trial: Object.assign({}, sealedProof),
  approval: { state: 'asked', at: ISO },
  updatedAt: ISO,
  rev: 3,
}, over || {})

// ── 1. kbHumanOnly: the human seam, exhaustively ─────────────────────────────────────────────────────────────────────
eq('HUMAN_ONLY is the four actions, toggle last', block.HUMAN_ONLY, ['trial-start', 'approve', 'queue act', 'toggle'])
for (const action of ['list', 'create', 'suggest', 'update', 'run-now', 'gate-check', 'queue list', 'accept', 'delete']) {
  ok('kbHumanOnly(' + action + ') is null whatever the request is', block.kbHumanOnly(action, {}, false) === null && block.kbHumanOnly(action, {}, true) === null)
}
for (const body of [null, undefined, {}, { active: false }, { active: 'true' }, { active: 1 }]) {
  ok('kbHumanOnly(toggle, ' + JSON.stringify(body) + ') is null (only `active: true` is an activation)', block.kbHumanOnly('toggle', body, false) === null)
}
for (const human of [false, undefined, 'true', 1]) {
  for (const action of ['trial-start', 'approve', 'queue act']) ok('kbHumanOnly(' + action + ', human=' + String(human) + ') refuses', block.kbHumanOnly(action, {}, human) === 'not a human request')
  ok('kbHumanOnly(toggle active:true, human=' + String(human) + ') refuses', block.kbHumanOnly('toggle', { active: true }, human) === 'not a human request')
}
ok('kbHumanOnly accepts only human === true', block.kbHumanOnly('approve', {}, true) === null && block.kbHumanOnly('toggle', { active: true }, true) === null)

// ── 2. Record identity, validity, empty record ───────────────────────────────────────────────────────────────────────
eq('kbGateIdOf makes the frozen id', block.kbGateIdOf('st-42'), 'gate:st-42')
eq('kbGateIdOf on a non-string is the bare prefix', block.kbGateIdOf(42), 'gate:')
ok('kbGateValidRecord accepts a cadrage-shaped record', block.kbGateValidRecord(plainRecord(), GATE_STATUSES) === true)
for (const [label, over] of [
  ['no id', { id: null }],
  ['wrong id prefix', { id: 'gate:other' }],
  ['no automationId', { automationId: '' }],
  ['unknown status', { status: 'not-a-status' }],
  ['no updatedAt', { updatedAt: null }],
  ['rev 0', { rev: 0 }],
  ['approval missing', { approval: null }],
  ['staticChecks of an unknown verdict', { staticChecks: { verdict: 'maybe' } }],
  ['trial of the wrong type', { trial: 'x' }],
]) ok('kbGateValidRecord refuses a record with ' + label, block.kbGateValidRecord(plainRecord(over), GATE_STATUSES) === false)
ok('kbGateValidRecord refuses an unknown status when the vocabulary is injected empty', block.kbGateValidRecord(plainRecord(), []) === false)
const empty = block.kbGateEmptyRecord('st-9', ISO)
eq('kbGateEmptyRecord is draft rev 1, nothing checked, nothing tried, nothing granted', [empty.status, empty.rev, empty.staticChecks, empty.trial, empty.approval.state, empty.approval.at, empty.updatedAt], ['draft', 1, null, null, 'none', null, ISO])

// ── 3. kbGateNext and the demotion ───────────────────────────────────────────────────────────────────────────────────
const stepped = block.kbGateNext(plainRecord(), { status: 'approved', approval: { state: 'granted', at: ISO }, at: ISO }, GATE_STATUSES)
ok('kbGateNext moves the status and raises rev by exactly one', stepped.status === 'approved' && stepped.rev === 4)
ok('kbGateNext keeps the frozen keys only', JSON.stringify(Object.keys(stepped)) === JSON.stringify(['id', 'automationId', 'status', 'staticChecks', 'trial', 'approval', 'updatedAt', 'rev']))
ok('kbGateNext without a change is the same record (no write)', block.kbGateNext(plainRecord(), {}, GATE_STATUSES).rev === 3)
ok('kbGateNext refuses a status the injected vocabulary does not carry', block.kbGateNext(plainRecord(), { status: 'activated' }, GATE_STATUSES.filter((s) => s !== 'activated')) === null)
const demoted = block.kbGateDemoteAfterEdit(plainRecord(), '2026-10-28T09:00:00.000Z')
eq('kbGateDemoteAfterEdit clears the evidence and raises rev', [demoted.status, demoted.staticChecks, demoted.trial, demoted.approval.state, demoted.rev, demoted.updatedAt, demoted.automationId], ['draft', null, null, 'none', 4, '2026-10-28T09:00:00.000Z', 'st-1'])

// ── 4. kbGateCanApprove: invariant #1, the only way to `approved` ───────────────────────────────────────────────────
eq('a clean completed trial with the right rev may be approved', block.kbGateCanApprove(plainRecord(), { rev: 3 }), { ok: true })
eq('already granted is refused', block.kbGateCanApprove(plainRecord({ status: 'approved', approval: { state: 'granted', at: ISO } }), { rev: 3 }), { ok: false, error: 'approval not possible: already granted' })
eq('activated is refused', block.kbGateCanApprove(plainRecord({ status: 'activated', approval: { state: 'granted', at: ISO } }), { rev: 3 }), { ok: false, error: 'approval not possible: already granted' })
eq('a refused record stays refused', block.kbGateCanApprove(plainRecord({ status: 'refused', approval: { state: 'refused', at: ISO } }), { rev: 3 }), { ok: false, error: 'approval not possible: already refused' })
eq('trial-done with no proof report is refused', block.kbGateCanApprove(plainRecord({ status: 'trial-done', trial: null }), { rev: 3 }), { ok: false, error: 'approval not possible: no proof report' })
eq('a trial with outside effects is refused', block.kbGateCanApprove(plainRecord({ trial: Object.assign({}, plainRecord().trial, { sideEffectFree: false, externalEffects: ['write-succeeded:gmail_send'] }) }), { rev: 3 }), { ok: false, error: 'approval not possible: the trial had outside effects' })
eq('a failed trial is refused', block.kbGateCanApprove(plainRecord({ trial: Object.assign({}, plainRecord().trial, { outcome: { state: 'failed' } }) }), { rev: 3 }), { ok: false, error: 'approval not possible: the trial did not complete' })
eq('an open trial is refused', block.kbGateCanApprove(plainRecord({ trial: Object.assign({}, plainRecord().trial, { outcome: { state: 'open' }, endedAt: null }) }), { rev: 3 }), { ok: false, error: 'approval not possible: the trial did not complete' })
eq('a trial with no end instant is refused', block.kbGateCanApprove(plainRecord({ trial: Object.assign({}, plainRecord().trial, { endedAt: null }) }), { rev: 3 }), { ok: false, error: 'approval not possible: the trial did not complete' })
eq('a shifted rev is stale', block.kbGateCanApprove(plainRecord(), { rev: 2 }), { ok: false, code: 'stale', error: 'stale' })
eq('a missing rev is stale', block.kbGateCanApprove(plainRecord(), {}), { ok: false, code: 'stale', error: 'stale' })
eq('a clean trial still on trial-done is not approvable yet', block.kbGateCanApprove(plainRecord({ status: 'trial-done' }), { rev: 3 }), { ok: false, error: 'approval not possible: no proof report' })
eq('no record is not approvable', block.kbGateCanApprove(null, { rev: 1 }), { ok: false, error: 'approval not possible: no gate record' })

// ── 5. The activation adapter: one line, no ladder, B2's predicate injected ──────────────────────────────────────────
const granted = plainRecord({ status: 'approved', approval: { state: 'granted', at: ISO } })
ok('no record is no gate: the adapter answers null (today\'s store)', block.kbGateActivationRefusal(null, mayActivate) === null && block.kbGateActivationRefusal(undefined, null) === null)
ok('a gated record is refused unless the predicate says yes', block.kbGateActivationRefusal(plainRecord(), mayActivate) === 'approval required')
ok('B2 mayActivate accepts a granted, passing record', block.kbGateActivationRefusal(granted, mayActivate) === null)
ok('the same record without the grant is refused', block.kbGateActivationRefusal(plainRecord({ status: 'approved' }), mayActivate) === 'approval required')
ok('a stub answering true is believed (the adapter holds no rule of its own)', block.kbGateActivationRefusal(plainRecord(), () => true) === null)
ok('a missing predicate fails closed on a record', block.kbGateActivationRefusal(plainRecord(), null) === 'approval required' && block.kbGateActivationRefusal(plainRecord(), undefined) === 'approval required')
const activationText = (blockSource.match(/const kbGateActivationRefusal = [\s\S]*?\n\}/) || [''])[0]
ok('the adapter names no rung of the ladder', activationText.indexOf('staticChecks') < 0 && activationText.indexOf('approval.state') < 0 && activationText.indexOf("=== 'approved'") < 0 && activationText.indexOf('kbTrialFn') < 0, activationText)
ok('the adapter carries `approval required` exactly once', (activationText.match(/'approval required'/g) || []).length === 1)

// ── 6. B2's refusal codes never reach the wire ───────────────────────────────────────────────────────────────────────
eq('kbGateTrialRefusal maps the five codes', ['not-supervised', 'gate-not-ready', 'already-open', 'machine-busy', 'no-timestamp'].map(block.kbGateTrialRefusal), ['not a human request', 'static checks failed', 'a trial is already running', 'machine busy', 'no timestamp'])
eq('an unknown code answers a readable string', block.kbGateTrialRefusal('something-new'), 'trial unavailable')
eq('an undefined code answers a readable string', block.kbGateTrialRefusal(undefined), 'trial unavailable')
ok('no answer echoes B2\'s spelling', ['not-supervised', 'gate-not-ready', 'already-open', 'machine-busy', 'no-timestamp', 'x'].every((c) => String(block.kbGateTrialRefusal(c)).indexOf(c) < 0))

// ── 7. The bounded projection ───────────────────────────────────────────────────────────────────────────────────────
const big = plainRecord({
  staticChecks: { ranAt: ISO, verdict: 'fail', findings: Array.from({ length: 120 }, (_, i) => ({ code: 'c' + i, severity: 'warn', field: 'prompt', message: 'm'.repeat(5000) })) },
  trial: {
    runId: 'sess-9', gateId: 'gate:st-1', startedAt: ISO, endedAt: ISO, supervised: true, sideEffectFree: false,
    toolCalls: Array.from({ length: 900 }, () => ({ toolName: 'read', access: 'read', outcome: 'ok' })),
    outcome: { state: 'failed', message: 'x'.repeat(5000) },
    externalEffects: Array.from({ length: 40 }, (_, i) => 'effect-' + i),
    errors: Array.from({ length: 40 }, () => ({ at: ISO, where: 'read', message: 'y'.repeat(5000) })),
  },
})
const bounded = block.kbGateBoundedRecord(big)
ok('findings are capped at 40', bounded.staticChecks.findings.length === 40)
ok('one finding message is at most 300 characters', bounded.staticChecks.findings.every((f) => Array.from(f.message).length <= 300))
ok('tool calls are capped at 200', bounded.trial.toolCalls.length === 200)
ok('external effects are capped at 20', bounded.trial.externalEffects.length === 20)
ok('errors are capped at 20', bounded.trial.errors.length === 20)
ok('the outcome message is at most 300 characters', Array.from(bounded.trial.outcome.message).length <= 300)
ok('the projection keeps the frozen keys', JSON.stringify(Object.keys(bounded)) === JSON.stringify(['id', 'automationId', 'status', 'staticChecks', 'trial', 'approval', 'updatedAt', 'rev']))
for (const [label, raw] of [['null', null], ['{}', {}], ['a findings string', { findings: 'x' }], ['a record with findings: "x"', plainRecord({ staticChecks: { ranAt: ISO, verdict: 'pass', findings: 'x' } })]]) {
  const p = block.kbGateBoundedRecord(raw)
  const shaped = p !== null && typeof p === 'object' &&
    JSON.stringify(Object.keys(p)) === JSON.stringify(['id', 'automationId', 'status', 'staticChecks', 'trial', 'approval', 'updatedAt', 'rev']) &&
    typeof p.status === 'string' && p.approval !== null && typeof p.approval === 'object' && typeof p.approval.state === 'string' &&
    (p.trial === null || (Array.isArray(p.trial.toolCalls) === true && Array.isArray(p.trial.externalEffects) === true && Array.isArray(p.trial.errors) === true && p.trial.outcome !== null && typeof p.trial.outcome === 'object'))
  ok('kbGateBoundedRecord is total and shaped for ' + label, shaped)
}
eq('a missing optional finding field stays absent', Object.prototype.hasOwnProperty.call(block.kbGateBoundedRecord(plainRecord({ staticChecks: { ranAt: ISO, verdict: 'pass', findings: [{ code: 'c', severity: 'warn', message: 'm' }] } })).staticChecks.findings[0], 'field'), false)

// ── 8. The list projection ──────────────────────────────────────────────────────────────────────────────────────────
const tasksIn = [{ id: 'st-1', name: 'A', active: true }, { id: 'st-2', name: 'B', active: false }]
const attached = block.kbGateAttach(tasksIn, [plainRecord()])
eq('every task carries `gate`, present and null when it never went through the gate', [typeof attached.tasks[0].gate, attached.tasks[1].gate], ['object', null])
ok('a task keeps its own fields', attached.tasks[0].name === 'A' && attached.tasks[0].active === true)
ok('the record is projected, never raw', attached.tasks[0].gate.rev === 3 && typeof attached.tasks[0].gate.approval.state === 'string')
ok('the input array is not mutated', Object.prototype.hasOwnProperty.call(tasksIn[0], 'gate') === false)
eq('an unreadable store answers gate: null everywhere plus gateStore', block.kbGateAttach(tasksIn, [], true), { tasks: [{ id: 'st-1', name: 'A', active: true, gate: null }, { id: 'st-2', name: 'B', active: false, gate: null }], gateStore: 'unreadable' })

// ── 9. Insert, cap, remove ───────────────────────────────────────────────────────────────────────────────────────────
const recordsWith = (count, status) => Array.from({ length: count }, (_, i) => plainRecord({ id: 'gate:st-' + i, automationId: 'st-' + i, status, updatedAt: '2026-10-0' + (1 + Math.floor(i / 28)) + 'T00:00:' + String(i % 60).padStart(2, '0') + '.000Z' }))
const replaced = block.kbGateInsert([plainRecord()], plainRecord({ rev: 9 }), 200)
ok('kbGateInsert replaces by automation id (no duplicate gate id)', replaced.ok === true && replaced.records.length === 1 && replaced.records[0].rev === 9)
const appended = block.kbGateInsert([plainRecord()], plainRecord({ id: 'gate:st-2', automationId: 'st-2' }), 200)
ok('kbGateInsert appends a new record', appended.ok === true && appended.records.length === 2)
const twoHundred = recordsWith(200, 'trial-done')
const overflow = block.kbGateInsert(twoHundred, plainRecord({ id: 'gate:new', automationId: 'new', status: 'static-passed' }), 200)
ok('at the cap the oldest unprotected record leaves', overflow.ok === true && overflow.records.length === 200 && overflow.records.some((r) => r.automationId === 'new') && overflow.records.some((r) => r.automationId === 'st-0') === false)
const allProtected = recordsWith(200, 'approved')
const full = block.kbGateInsert(allProtected, plainRecord({ id: 'gate:new', automationId: 'new', status: 'static-passed' }), 200)
eq('with every record protected the write is refused', [full.ok, full.error], [false, 'gate store full'])
eq('...and the returned list is the input list', full.records, allProtected)
eq('kbGateRemoveOf removes by automation id', block.kbGateRemoveOf([plainRecord(), plainRecord({ id: 'gate:st-2', automationId: 'st-2' })], 'st-1').map((r) => r.automationId), ['st-2'])
eq('removing an absent id is a no-op list', block.kbGateRemoveOf([plainRecord()], 'nope').length, 1)

// ── 10. The file envelope ───────────────────────────────────────────────────────────────────────────────────────────
eq('an absent file is an empty, healthy store', block.kbGateParse(null), { records: [], corrupt: false })
eq('an empty file is an empty, healthy store', block.kbGateParse(''), { records: [], corrupt: false })
ok('a valid envelope gives its records', block.kbGateParse(JSON.stringify({ version: 1, records: [plainRecord()] })).records.length === 1)
for (const text of ['{', '[]', '{"records":{}}']) {
  const parsed = block.kbGateParse(text)
  ok('kbGateParse marks ' + JSON.stringify(text) + ' corrupt and hands the text back', parsed.corrupt === true && parsed.text === text)
}

// ── 11. The store: serialized, silent when nothing changed, corrupt fail-closed ──────────────────────────────────────
{
  let text = null
  let writes = 0
  const copies = new Set()
  const io = {
    read: async () => text,
    write: async (next) => { writes += 1; text = next },
    // The real io dedupes by content (one copy per distinct corrupt text, at most five); this one says so explicitly.
    keepCopy: async (raw) => { copies.add(raw) },
    normalize: (raw) => raw,
  }
  const store = block.kbMakeGateStore(io)
  const first = await store.mutate(async (records) => { records.push(plainRecord({ rev: 1 })) })
  const second = await store.mutate(async (records) => {
    const rev = records[0].rev
    records[0] = plainRecord({ rev: rev + 1 })
    return rev
  })
  ok('two mutations are serialized: the second sees the first\'s rev', first.ok === true && second.ok === true && second.result === 1)
  eq('each real change wrote the file once', writes, 2)
  await store.mutate(async () => null)
  eq('a mutation that changes nothing does not write', writes, 2)
  const readBack = await store.read()
  ok('a read sees the written records', readBack.ok === true && readBack.records[0].rev === 2)
  text = '{'
  const refused = await store.mutate(async (records) => { records.push(plainRecord()) })
  eq('a corrupt read refuses the write with its code', [refused.ok, refused.code], [false, 'gate-corrupt'])
  eq('...after keeping one private copy', copies.size, 1)
  eq('...and never touching the file', writes, 2)
  ok('a second corrupt mutation keeps no second copy of the same content', (await store.mutate(async () => null)).ok === false && copies.size === 1)
}
ok('the block holds no import, no fs and no clock', /require\(|from 'node:|\bDate\.now\b/.test(blockSource) === false)

// ── 12. Source assertions: boot safety, the seam, the closed paths ───────────────────────────────────────────────────
const countOf = (text, needle) => text.split(needle).length - 1
ok('index.js imports the three batches as namespaces', ["import * as kbGateMod from './automation-gate.mjs'", "import * as kbTrialMod from './automation-trial.mjs'", "import * as kbQueueMod from './initiative-queue.mjs'"].every((line) => source.indexOf(line) >= 0))
ok('no named import of a possibly absent export', /import\s*\{[^}]*\b(checkDraft|trialFromEvents|makeInitiativeQueue)\b/.test(source) === false)
for (const action of ['gate-check', 'trial-start', 'trial-report', 'approve', 'queue list', 'queue act']) ok('the dispatcher carries `action === \'' + action + '\'`', source.indexOf("action === '" + action + "'") >= 0)
ok('HUMAN_ONLY is declared exactly once and carries toggle', countOf(source, 'const HUMAN_ONLY =') === 1 && source.indexOf("const HUMAN_ONLY = ['trial-start', 'approve', 'queue act', 'toggle']") >= 0)
ok('the four auth helpers are untouched', ['kbTasksAuthorized', 'kbTasksRefused', 'kbTunnelledWrite', "body.action !== 'list'"].every((t) => source.indexOf(t) >= 0))
ok('the initiative deps key is singular and never plural', countOf(source, 'initiatives:') === 0 && countOf(source, 'initiative:') === 1)
ok('the old tooth name is gone', countOf(source, 'kbGateRunRefusal(') === 0)
ok('B2 is adopted, not mirrored', ["kbTrialFn('mayActivate')", "kbTrialFn('startTrial')", "kbTrialFn('toStoredGate')"].every((t) => source.indexOf(t) >= 0))
ok('exactly one `human: true`, on the route line', countOf(source, 'human: true') === 1 && source.indexOf("kbTasksHandle(body, { human: true, via: 'http' })") >= 0)
ok('the tool layer never claims a human request', countOf(readFileSync(join(here, 'automation-tools.mjs'), 'utf8'), 'human: true') === 0)
{
  const a = source.indexOf('const kbFireTask = async')
  const b = source.indexOf('const kbTasksTrigger = kbMakeTrigger(', a)
  const body = source.slice(a, b)
  ok('kbFireTask carries the gate tooth', body.indexOf('kbGateRunRefusalTask(') >= 0)
  ok('kbFireTask installs the trial guard through `.guard(`', body.indexOf('.guard(') >= 0)
  ok('the tooth comes before the session is looked up', body.indexOf('kbGateRunRefusalTask(') < body.indexOf('sessionController'))
}
ok('the tick records a skipped fire with no session id', /status: 'skipped', error: r\.skipped/.test(source) || source.indexOf("status: 'skipped'") >= 0)
ok('...and leaves lastRun alone for it', source.indexOf('if (skipped !== true) t.lastRun = at') >= 0)

// ── The harness: one boot, one loopback listener ─────────────────────────────────────────────────────────────────────
const mod = await import(pathToFileURL(join(here, 'index.js')).href)

const boot = async (options) => {
  const o = options || {}
  const ctl = { routes: [], tools: [], guards: [], sessions: [], prompts: [], journals: new Map(), handlers: {}, disposed: 0, wire: [], quiet: [] }
  const presets = { table: { 'workspace-write': { sandbox: 'workspace-write', approval: 'ask' } } }
  const services = {
    fs: {},
    webServer: { register: (route) => { ctl.routes.push(route); return () => {} } },
    workspaceRegistry: { list: () => [{ id: 'ws1' }] },
    permissionPresets: {
      names: ['workspace-write'],
      resolve: (name) => { if (presets.table[name] === undefined) throw new Error('unknown preset'); return presets.table[name] },
      set: () => {},
    },
    sessions: { get: (id) => (ctl.sessions.indexOf(id) >= 0 ? { id } : undefined) },
    sessionController: {
      async create () { const id = 'session-6c1f0f43-8f63-4b8e-9d1b-' + String(ctl.sessions.length + 1).padStart(12, '0'); ctl.sessions.push(id); return { ok: true, value: { sessionId: id } } },
      async prompt (a) { ctl.prompts.push(a); return { ok: true } },
      async selectModel () { return { ok: true } },
    },
    sessionPersistence: { open: async (id) => ({ read: async () => ({ events: ctl.journals.get(id) || [] }), close: async () => {} }) },
    tools: {
      register: (def) => { ctl.tools.push(def) },
      guard: (fn) => { const rec = { fn, disposed: 0 }; ctl.guards.push(rec); return () => { rec.disposed += 1; ctl.disposed += 1 } },
    },
  }
  if (o.tools !== undefined) services.tools = o.tools
  if (o.noJournal === true) services.sessionPersistence = undefined
  ctl.services = services
  ctl.presets = presets
  const ctx = {
    get: (name) => services[name],
    inject: (list, fn) => {
      try {
        if (Array.isArray(list) !== true) return
        if (list[0] === 'systemPrompt') fn({ systemPrompt: { context: () => {} } })
        else if (list[0] === 'tools') fn({ tools: services.tools })
      } catch (e) { /* not that seam */ }
    },
    effect: (fn) => { try { return fn() } catch (e) { return undefined } },
    on: o.noOn === true ? undefined : (name, fn) => { (ctl.handlers[name] = ctl.handlers[name] || []).push(fn); return () => { const i = (ctl.handlers[name] || []).indexOf(fn); if (i >= 0) ctl.handlers[name].splice(i, 1) } },
    scope: {},
  }
  const realErr = console.error
  const realLog = console.log
  console.error = (...a) => ctl.quiet.push(a.join(' '))
  console.log = (...a) => ctl.quiet.push(a.join(' '))
  try { await Promise.race([Promise.resolve(mod.apply(ctx)), new Promise((r) => realSetTimeout(r, 5000))]) } finally { console.error = realErr; console.log = realLog }
  const server = http.createServer((req, res) => {
    const route = ctl.routes.find((r) => r.path === new URL(req.url, 'http://x').pathname && typeof r.handler === 'function')
    if (route === undefined) { res.writeHead(404); res.end('{}'); return }
    Promise.resolve(route.handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  ctl.server = server
  ctl.port = server.address().port
  ctl.own = '127.0.0.1:' + ctl.port
  ctl.origin = 'http://' + ctl.own
  ctl.send = (path, headers, body) => new Promise((resolve) => {
    const payload = JSON.stringify(body)
    const req = http.request({ host: '127.0.0.1', port: ctl.port, path, method: 'POST', headers: Object.assign({ host: ctl.own, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }, headers) }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { text += c })
      res.on('end', () => {
        let answer = null
        try { answer = JSON.parse(text) } catch (e) { answer = null }
        // No cookie (it lives in the headers, never logged) and no query string: a webhook's secret is in the URL.
        ctl.wire.push({ path: String(path).split('?')[0], body, status: res.statusCode, answer })
        resolve({ status: res.statusCode, json: answer, text })
      })
    })
    req.on('error', () => resolve({ status: 0, json: null, text: '' }))
    req.end(payload)
  })
  ctl.api = (body, headers) => ctl.send('/kybernos/tasks', Object.assign({ origin: ctl.origin, cookie: sessionCookie(ctl.own) }, headers || {}), body)
  return ctl
}

const observed = new Map()
const note = (label, value) => { if (observed.has(label) === false) observed.set(label, value) }

const main = await boot()
const api = main.api
const tasksFile = join(home, 'kybernos', 'tasks.json')
const gatesFile = join(home, 'kybernos', 'gates.json')
const initiativesFile = join(home, 'kybernos', 'initiatives.json')
const onDisk = (path) => JSON.parse(readFileSync(path, 'utf8'))
const gateOnDisk = (id) => {
  if (existsSync(gatesFile) === false) return null
  const file = onDisk(gatesFile)
  return file.records.find((r) => r.automationId === id) || null
}
const taskOnDisk = (id) => onDisk(tasksFile).find((t) => t.id === id) || null

// ── 13. The fences, six actions over ─────────────────────────────────────────────────────────────────────────────────
const bodies = {
  'gate-check': { id: 'st-none' },
  'trial-start': { id: 'st-none' },
  'trial-report': { id: 'st-none' },
  approve: { id: 'st-none', decision: 'grant', rev: 1 },
  'queue list': {},
  'queue act': { id: 'i_none', status: 'asked' },
}
for (const action of Object.keys(bodies)) {
  const body = Object.assign({ action }, bodies[action])
  const noOrigin = await api(body, { origin: '' })
  ok('[' + action + '] no Origin → 403', noOrigin.status === 403 && noOrigin.json.error === 'origin refused')
  const foreign = await api(body, { origin: 'http://evil.example' })
  ok('[' + action + '] foreign Origin → 403', foreign.status === 403)
  const noCookie = await api(body, { cookie: '' })
  ok('[' + action + '] no cookie → 401', noCookie.status === 401 && noCookie.json.error === 'sign-in required')
  const forged = await api(body, { cookie: sessionCookie(main.own, { secret: OTHER_SECRET }) })
  ok('[' + action + '] cookie signed with another secret → 401', forged.status === 401)
  const expired = await api(body, { cookie: sessionCookie(main.own, { expiresAt: Date.now() - 1000 }) })
  ok('[' + action + '] expired cookie → 401', expired.status === 401)
  const before = existsSync(gatesFile) ? readFileSync(gatesFile, 'utf8') : null
  const phone = await api(body, { 'x-kybernos-tunnel': 1 })
  ok('[' + action + '] a phone is refused and writes nothing', phone.status === 403 && phone.json.error === 'refused_on_phone' && (existsSync(gatesFile) ? readFileSync(gatesFile, 'utf8') : null) === before)
  if (action === 'gate-check') note('phone-gate-check', '403 ' + phone.json.error)
  const own = await api(body)
  ok('[' + action + '] a person gets the action\'s own answer, never a 401/403', own.status === 200 && own.json !== null && (own.json.ok === true || typeof own.json.error === 'string'), JSON.stringify(own.json))
}
{
  const listed = await api({ action: 'list' }, { 'x-kybernos-tunnel': 1 })
  ok('the only action a phone may make is `list`, and it is told no webhook secret', listed.status === 200 && Array.isArray(listed.json.tasks) === true)
  note('phone-list', String(listed.status))
}

// ── 14. The certified journey, one script, one temp home ─────────────────────────────────────────────────────────────
const dirtyDraft = { name: 'Invoice follow-up', prompt: 'Send the invoice by e-mail to the client every Monday.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, approvals: 'auto' }
const seeded = (await api({ action: 'suggest', task: dirtyDraft })).json
ok('step 1 — a suggestion is stored switched off', seeded.ok === true && seeded.task.suggested === true && seeded.task.active === false)
const idA = seeded.task.id
ok('...tasks.json holds it', taskOnDisk(idA) !== null)

{
  // A trial follows a stored automation, not a waiting suggestion: Add keeps it switched off.
  const accepted = (await api({ action: 'accept', id: idA })).json
  ok('step 1b — Add keeps the automation switched off', accepted.ok === true && accepted.task.active === false)
}
const dirtyCheck = (await api({ action: 'gate-check', id: idA })).json
ok('step 2 — a draft that says "send" with approvals auto fails the static gate', dirtyCheck.ok === true && dirtyCheck.gate.status === 'static-failed')
ok('...with at least one blocker', dirtyCheck.gate.staticChecks.findings.some((f) => f.severity === 'blocker') === true)
eq('...and gates.json holds one record, rev 1', [gateOnDisk(idA).rev, onDisk(gatesFile).version], [1, 1])

const earlyTrial = (await api({ action: 'trial-start', id: idA })).json
eq('step 3 — a trial on a failed draft is refused', [earlyTrial.ok, earlyTrial.error], [false, 'static checks failed'])
eq('...and nothing fired', main.sessions.length, 0)

const fixedDraft = { name: 'Weekly report', prompt: 'Compile the weekly report and save it as a draft.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, active: false }
const fixed = (await api({ action: 'update', id: idA, task: fixedDraft })).json
ok('step 4 — the draft is fixed', fixed.ok === true)
ok('...and the edit voids the certification: draft, no approval, no proof, rev + 1', gateOnDisk(idA) !== null && gateOnDisk(idA).status === 'draft' && gateOnDisk(idA).approval.state === 'none' && gateOnDisk(idA).trial === null && gateOnDisk(idA).rev === 2)

const cleanCheck = (await api({ action: 'gate-check', id: idA })).json
ok('step 5 — a clean draft passes the static gate', cleanCheck.ok === true && cleanCheck.gate.status === 'static-passed')
eq('...rev + 1', cleanCheck.gate.rev, 3)

{
  const listed = (await api({ action: 'list' })).json
  const row = listed.tasks.find((t) => t.id === idA)
  ok('step 5b — the list carries the gate on every task', Object.prototype.hasOwnProperty.call(row, 'gate') === true && row.gate.id === 'gate:' + idA && row.gate.status === 'static-passed')
  ok('...and `gate: null` on a task that never went through it', listed.tasks.every((t) => Object.prototype.hasOwnProperty.call(t, 'gate') === true))
}
eq('step 5c — the load refusal is B2\'s code, mapped by the block', block.kbGateTrialRefusal('machine-busy'), 'machine busy')
note('trial-busy', block.kbGateTrialRefusal('machine-busy'))

// step 6: the human trial
const started = (await api({ action: 'trial-start', id: idA, human: true })).json
ok('step 6 — a person starts the trial, and the `human` flag in the body is inert', started.ok === true && typeof started.runId === 'string', JSON.stringify(started))
const runIdA = started.runId
ok('...the gate carries an open, supervised trial', started.gate.trial.outcome.state === 'open' && started.gate.trial.supervised === true && started.gate.trial.sideEffectFree === false)
ok('...and the history records the trial as its own kind of run', (taskOnDisk(idA).history || []).some((h) => h.status === 'trial' && h.gateId === 'gate:' + idA && h.sessionId === null) === true)
eq('...exactly one guard was installed for the trial session', main.guards.length, 1)
{
  const guard = main.guards[0]
  ok('step 6g — the guard denies a write word in the trial\'s own session', guard.fn({ name: 'gmail_send', agent: { session: { id: runIdA } } }) === TRIAL_DENY_REASON)
  ok('...and lets a read word of that session through', guard.fn({ name: 'gmail_list', agent: { session: { id: runIdA } } }) === undefined)
  ok('...and touches no other session', guard.fn({ name: 'gmail_send', agent: { session: { id: 'sess-someone-else' } } }) === undefined)
  // P1: a write-capable tool whose name carries no word of the write table used to run for real in a trial.
  for (const name of ['bash', 'bash_local', 'subagent', 'subagent_fork', 'workflow', 'terminal_open', 'terminal_send', 'terminal_signal',
    'terminal_close', 'plugin_manager', 'relancer_dsh', 'enregistrer_entree']) {
    ok('...`' + name + '` carries no write word yet is a write: denied', guard.fn({ name, agent: { session: { id: runIdA } } }) === TRIAL_DENY_REASON)
  }
  ok('...an agent-spawning name the table does not know is denied by its category word', guard.fn({ name: 'spawn_agent_team', agent: { session: { id: runIdA } } }) === TRIAL_DENY_REASON)
  // P1: a session spawned BY the trial answered `session.id !== runId` and was exempt; its lineage names the trial.
  ok('...a session spawned by the trial is under the same mask', guard.fn({ name: 'gmail_send', agent: { session: { id: 'child-1', header: { parentSession: runIdA } } } }) === TRIAL_DENY_REASON)
  ok('...including a write that carries no word', guard.fn({ name: 'bash', agent: { session: { id: 'child-1', header: { parentSession: runIdA } } } }) === TRIAL_DENY_REASON)
  ok('...while a read of that child still passes', guard.fn({ name: 'gmail_list', agent: { session: { id: 'child-1', header: { parentSession: runIdA } } } }) === undefined)
  ok('...and a child of another chat is untouched', guard.fn({ name: 'bash', agent: { session: { id: 'sess-other-child', header: { parentSession: 'sess-someone-else' } } } }) === undefined)
  note('trial-guard', 'denied')
}
const secondStart = (await api({ action: 'trial-start', id: idA })).json
eq('step 6h — a second trial while one runs is refused', [secondStart.ok, secondStart.error], [false, 'a trial is already running'])
eq('...and starts no session', main.sessions.length, 1)

// step 8: the proof
const T0 = Date.parse('2026-10-28T08:00:00.000Z')
const cleanEvents = [
  { type: 'turn/start', time: T0, data: {} },
  { type: 'step/start', time: T0 + 10, data: {} },
  { type: 'tool/call', time: T0 + 20, data: { callId: 'c1', name: 'gmail_list', arguments: '{}' } },
  { type: 'tool/result', time: T0 + 30, data: { message: { toolCallId: 'c1', isError: false, content: 'two messages' } } },
  { type: 'step/end', time: T0 + 40, data: {} },
  { type: 'turn/end', time: T0 + 100, data: { reason: { kind: 'completed' } } },
]
const dirtyEvents = [
  { type: 'turn/start', time: T0, data: {} },
  { type: 'step/start', time: T0 + 10, data: {} },
  { type: 'tool/call', time: T0 + 20, data: { callId: 'c1', name: 'gmail_send', arguments: '{}' } },
  { type: 'tool/result', time: T0 + 30, data: { message: { toolCallId: 'c1', isError: false, content: 'sent' } } },
  { type: 'step/end', time: T0 + 40, data: {} },
  { type: 'turn/end', time: T0 + 100, data: { reason: { kind: 'completed' } } },
]
main.journals.set(runIdA, cleanEvents)

const reported = (await api({ action: 'trial-report', id: idA })).json
ok('step 8 — the real journal gives a clean proof', reported.ok === true && reported.report.sideEffectFree === true && reported.report.outcome.state === 'completed', JSON.stringify(reported))
eq('...and the gate asks for the approval', reported.gate.status, 'awaiting-approval')
eq('...disposing the trial guard as soon as the proof is terminal', main.guards[0].disposed, 1)
note('trial-guard-disposed', String(main.guards[0].disposed))
const reportedAgain = (await api({ action: 'trial-report', id: idA })).json
ok('step 8b — reporting again is idempotent and keeps the decision in front of the person', reportedAgain.ok === true && reportedAgain.gate.approval.state === 'asked')

// steps 9-11: approve
const noRev = (await api({ action: 'approve', id: idA, decision: 'grant' })).json
eq('step 9 — approve without rev is refused', [noRev.ok, noRev.error], [false, 'rev required'])
const staleRev = (await api({ action: 'approve', id: idA, decision: 'grant', rev: 1 })).json
ok('step 10 — approve with a stale rev is stale, and says which record it saw', staleRev.ok === false && staleRev.code === 'stale' && staleRev.error === 'stale' && staleRev.gate.id === 'gate:' + idA)
note('stale-rev', staleRev.code)
const currentRev = (await api({ action: 'list' })).json.tasks.find((t) => t.id === idA).gate.rev
const grantedAnswer = (await api({ action: 'approve', id: idA, decision: 'grant', rev: currentRev })).json
ok('step 11 — the person grants it, and that is the only way to `approved`', grantedAnswer.ok === true && grantedAnswer.gate.status === 'approved' && grantedAnswer.gate.approval.state === 'granted' && typeof grantedAnswer.gate.approval.at === 'string')
eq('...gates.json agrees', gateOnDisk(idA).status, 'approved')
const twiceMore = (await api({ action: 'approve', id: idA, decision: 'grant', rev: currentRev })).json
eq('...and a second grant with the same rev is "already granted"', [twiceMore.ok, twiceMore.error], [false, 'approval not possible: already granted'])

// step 12-13: activation
const on = (await api({ action: 'toggle', id: idA, active: true })).json
ok('step 12 — the person\'s toggle switches it on', on.ok === true && on.task.active === true)
eq('...and only then is the gate marked activated', gateOnDisk(idA).status, 'activated')
const off = (await api({ action: 'toggle', id: idA, active: false })).json
const onAgain = (await api({ action: 'toggle', id: idA, active: true })).json
ok('step 13 — off then on again needs no new approval', off.ok === true && onAgain.ok === true && gateOnDisk(idA).status === 'activated')

// ── 15. The bypass suite: every path that could run or re-activate a gated draft ────────────────────────────────────
const cleanTask = { name: 'Daily brief', prompt: 'Compile the daily brief and save it as a draft.', schedule: { mode: 'cron', cron: '0 9 * * *', tz: 'Europe/Paris' }, active: false }
const gatedTask = (await api({ action: 'create', task: cleanTask })).json
ok('a plain automation is created paused', gatedTask.ok === true && gatedTask.task.active === false)
const idB = gatedTask.task.id
const bCheck = (await api({ action: 'gate-check', id: idB })).json
ok('...and certified at the static rung only', bCheck.ok === true && bCheck.gate.status === 'static-passed')

{
  // A gated automation that the scheduler would consider due: the point of the next block is that the gate, not the
  // scheduler, decides, so the task is made due by hand (its history keeps one real run, for the streak below).
  const file = onDisk(tasksFile)
  const row = file.find((t) => t.id === idB)
  row.active = true
  row.nextRun = new Date(Date.now() - 60000).toISOString()
  row.history = [{ at: new Date(Date.now() - 86400000).toISOString(), sessionId: 'sess-old', status: 'fired' }]
  writeFileSync(tasksFile, JSON.stringify(file, null, 2))
}
const sessionsBefore = main.sessions.length
const toggleRefused = (await api({ action: 'toggle', id: idB, active: true })).json
eq('the gate closes the person\'s toggle on an unapproved record', [toggleRefused.ok, toggleRefused.error], [false, 'approval required'])
const runRefused = (await api({ action: 'run-now', id: idB })).json
eq('...and run-now', [runRefused.ok, runRefused.error], [false, 'approval required'])
{
  const file = onDisk(tasksFile)
  const row = file.find((t) => t.id === idB)
  row.pendingFire = true
  row.pendingFires = ['an event from before the gate']
  writeFileSync(tasksFile, JSON.stringify(file, null, 2))
}
const consumeRefused = (await api({ action: 'consume-fire', id: idB })).json
eq('...and consume-fire, which loses nothing', [consumeRefused.ok, consumeRefused.error], [false, 'approval required'])
ok('...the queued event is still there', taskOnDisk(idB).pendingFire === true && taskOnDisk(idB).pendingFires.length === 1)
const hook = (await api({ action: 'hook-generate', id: idB })).json
ok('a webhook can still be minted for a gated automation', hook.ok === true && typeof hook.hookId === 'string')
const historyBeforeWebhook = taskOnDisk(idB).history.length
const hooked = await main.send('/kybernos/hooks?hook=' + hook.hookId + '&secret=' + hook.secret, {}, { hello: 'world' })
ok('...but the webhook answers 403 approval required', hooked.status === 403 && hooked.json.error === 'approval required', hooked.status + ' ' + hooked.text)
eq('...and records nothing', taskOnDisk(idB).history.length, historyBeforeWebhook)
eq('none of those five fire paths started a session', main.sessions.length, sessionsBefore)
ok('the toggle refusal came before the human check failed: a code-issued toggle is a refusal too', block.kbHumanOnly('toggle', { active: true }, false) === 'not a human request')
note('toggle-project', block.kbHumanOnly('toggle', { active: true }, false))

// the scheduler's own fire: the due, gated, unapproved automation
const streakBefore = stableStreak(taskOnDisk(idB).history)
const lastRunBefore = taskOnDisk(idB).lastRun
const sessionsBeforeTick = main.sessions.length
{
  const timer = captured.filter((t) => t.ms === 30000).pop()
  const before = captured.length
  timer.fn()
  const startedAt = Date.now()
  while (captured.length === before && Date.now() - startedAt < 5000) await new Promise((r) => realSetTimeout(r, 5))
}
ok('the scheduler\'s own fire is skipped, not failed', taskOnDisk(idB).history.length === 2 && taskOnDisk(idB).history[1].status === 'skipped', JSON.stringify(taskOnDisk(idB).history))
eq('...with sessionId null and the gate\'s own reason', [taskOnDisk(idB).history[1].sessionId, taskOnDisk(idB).history[1].error], [null, 'approval required'])
eq('...lastRun untouched', taskOnDisk(idB).lastRun, lastRunBefore)
eq('...and the stable streak neither counts it nor breaks', stableStreak(taskOnDisk(idB).history), streakBefore)
eq('...no session was created', main.sessions.length, sessionsBeforeTick)
note('scheduler-fire', taskOnDisk(idB).history[1].status)
note('scheduler-history', 'skipped')

// the re-activation trio
{
  // Pausing is never a risk, so it is always allowed — and it is what makes the hole below reachable: the sanitizer
  // defaults `active` to true, so an edit body that omits it switches a PAUSED automation back on.
  const paused = (await api({ action: 'toggle', id: idB, active: false })).json
  ok('pausing a gated automation is always allowed', paused.ok === true && paused.task.active === false)
  const before = readFileSync(tasksFile, 'utf8')
  // The body OMITS `active` on purpose: that is the hole (kbSanitizeTaskInput defaults it to true).
  const { active, ...withoutActive } = cleanTask
  void active
  const reactivate = (await api({ action: 'update', id: idB, task: withoutActive })).json
  eq('an edit that omits `active` (the sanitizer defaults it to true) is refused', [reactivate.ok, reactivate.error], [false, 'approval required'])
  eq('...and tasks.json is byte-identical', readFileSync(tasksFile, 'utf8'), before)
  note('update-reactivate', reactivate.error)
}
{
  // Publishing hands the automation to a computer that runs it, so a record it carries decides (finding P2 #4). idB is
  // certified at the static rung only: it may not run here, and it may not be made runnable elsewhere either.
  const before = readFileSync(tasksFile, 'utf8')
  const link = (await api({ action: 'cloud-link', id: idB, cloud: { computerId: '0f0e0d0c-0b0a-4908-8706-050403020100', name: 'the studio Mac' } })).json
  eq('publishing a gated automation that may not activate is refused', [link.ok, link.error], [false, 'approval required'])
  eq('...and tasks.json is byte-identical (no link was written)', readFileSync(tasksFile, 'utf8'), before)
  note('cloud-publish', link.error)
  // A link that already exists — made before the gate, or by hand — is what the return path meets: the record decides.
  const file = onDisk(tasksFile)
  const row = file.find((t) => t.id === idB)
  row.cloud = { computerId: '0f0e0d0c-0b0a-4908-8706-050403020100', name: 'the studio Mac', at: new Date().toISOString(), wasActive: true }
  writeFileSync(tasksFile, JSON.stringify(file, null, 2))
  const beforeBack = readFileSync(tasksFile, 'utf8')
  const back = (await api({ action: 'cloud-link', id: idB, cloud: null })).json
  eq('bringing it back active is refused', [back.ok, back.error], [false, 'approval required'])
  eq('...and the link stays exactly as it is', readFileSync(tasksFile, 'utf8'), beforeBack)
  note('cloud-return', back.error)
}
{
  // The exact finding: a static-failed draft made runnable through cloud-link. The gate now answers before the link.
  const dirtyCloud = { name: 'Invoice chase', prompt: 'Send the invoice by e-mail to the client every Monday.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, approvals: 'auto', active: false }
  const made = (await api({ action: 'create', task: dirtyCloud })).json
  const idS = made.task.id
  const checked = (await api({ action: 'gate-check', id: idS })).json
  eq('a draft that fails the static gate...', checked.gate.status, 'static-failed')
  const published = (await api({ action: 'cloud-link', id: idS, cloud: { computerId: '0f0e0d0c-0b0a-4908-8706-050403020100', name: 'the studio Mac' } })).json
  eq('...cannot be made runnable through cloud-link', [published.ok, published.error], [false, 'approval required'])
  eq('...and keeps no cloud link at all', Object.prototype.hasOwnProperty.call(taskOnDisk(idS), 'cloud'), false)
}
{
  // Finding P2 #3: a NEW automation enters the gate at draft, and every activation path answers for it from then on.
  const made = (await api({ action: 'create', task: cleanTask })).json
  const idC = made.task.id
  const seeded = gateOnDisk(idC)
  ok('a new automation is seeded at draft, rev 1, nothing checked or granted', seeded !== null && seeded.status === 'draft' && seeded.rev === 1 && seeded.staticChecks === null && seeded.trial === null && seeded.approval.state === 'none')
  const listed = (await api({ action: 'list' })).json
  eq('...and the list carries that record', listed.tasks.find((t) => t.id === idC).gate.status, 'draft')
  const on = (await api({ action: 'toggle', id: idC, active: true })).json
  eq('...the toggle it never certified is refused', [on.ok, on.error], [false, 'approval required'])
  const run = (await api({ action: 'run-now', id: idC })).json
  eq('...run-now too', [run.ok, run.error], [false, 'approval required'])
  const published = (await api({ action: 'cloud-link', id: idC, cloud: { computerId: '0f0e0d0c-0b0a-4908-8706-050403020100', name: 'the studio Mac' } })).json
  eq('...and cloud-link', [published.ok, published.error], [false, 'approval required'])
  eq('...while tasks.json still holds it paused', taskOnDisk(idC).active, false)
  note('create-seed', 'draft rev 1')
}
{
  // The regression that matters most: today's whole store is ungated, and an automation that predates the gate keeps
  // working. `create` now seeds a record, so the fixture is a row written straight into tasks.json — that IS the legacy
  // store, and "no record is no gate" is exactly what it exercises.
  const file = onDisk(tasksFile)
  const template = file.find((t) => t.id === idB)
  const legacy = Object.assign({}, template, { id: 'st-legacy-1', name: 'Legacy brief', active: false, nextRun: null, history: [], lastRun: null, pendingFire: false, pendingFires: [] })
  delete legacy.cloud
  file.push(legacy)
  writeFileSync(tasksFile, JSON.stringify(file, null, 2))
  const idD = 'st-legacy-1'
  const listed = (await api({ action: 'list' })).json
  eq('an automation with no gate record lists as gate: null', listed.tasks.find((t) => t.id === idD).gate, null)
  const plainOn = (await api({ action: 'toggle', id: idD, active: true })).json
  ok('...switches on exactly as before', plainOn.ok === true && plainOn.task.active === true)
  const sessionsBeforePlain = main.sessions.length
  const plainRun = (await api({ action: 'run-now', id: idD })).json
  ok('...runs exactly as before', plainRun.ok === true && typeof plainRun.sessionId === 'string', JSON.stringify(plainRun))
  eq('...starting a real session', main.sessions.length, sessionsBeforePlain + 1)
  const plainLink = (await api({ action: 'cloud-link', id: idD, cloud: { computerId: '0f0e0d0c-0b0a-4908-8706-050403020100', name: 'the studio Mac' } })).json
  ok('...and is published to the cloud exactly as before', plainLink.ok === true && taskOnDisk(idD).cloud !== undefined)
  note('ungated-run-now', 'ok')
}
{
  // Finding P1 #4, on the real store: a hand-edited gates.json may claim `activated` with a granted approval and a
  // pasted clean-looking proof; what the host reads back is a draft, and nothing it claims moves the automation.
  const made = (await api({ action: 'create', task: cleanTask })).json
  const idForge = made.task.id
  const forgedAt = new Date().toISOString()
  const file = onDisk(gatesFile)
  const record = file.records.find((r) => r.automationId === idForge)
  record.status = 'activated'
  record.staticChecks = { ranAt: forgedAt, verdict: 'pass', findings: [] }
  record.approval = { state: 'granted', at: forgedAt }
  record.trial = {
    runId: 'sess-forged', gateId: 'gate:' + idForge, startedAt: forgedAt, endedAt: forgedAt, supervised: true, sideEffectFree: true,
    toolCalls: [], outcome: { state: 'completed' }, externalEffects: [], errors: [],
  }
  writeFileSync(gatesFile, JSON.stringify(file, null, 2))
  const listed = (await api({ action: 'list' })).json
  eq('a hand-edited `activated` record reads back as draft', listed.tasks.find((t) => t.id === idForge).gate.status, 'draft')
  const on = (await api({ action: 'toggle', id: idForge, active: true })).json
  eq('...and the toggle it never earned stays refused', [on.ok, on.error], [false, 'approval required'])
  const run = (await api({ action: 'run-now', id: idForge })).json
  eq('...as does run-now', [run.ok, run.error], [false, 'approval required'])
  note('gate-forged', 'draft')
  // ...and a genuine record whose grant is dated in the future is not an approval either.
  const futureAt = '2099-01-01T00:00:00.000Z'
  const file2 = onDisk(gatesFile)
  const genuine = file2.records.find((r) => r.automationId === idA)
  const keptGrant = genuine.approval.at
  genuine.approval = { state: 'granted', at: futureAt }
  writeFileSync(gatesFile, JSON.stringify(file2, null, 2))
  const afterFuture = (await api({ action: 'list' })).json
  eq('a grant dated in the future reads back as draft too', afterFuture.tasks.find((t) => t.id === idA).gate.status, 'draft')
  const futureToggle = (await api({ action: 'toggle', id: idA, active: true })).json
  eq('...and it activates nothing', [futureToggle.ok, futureToggle.error], [false, 'approval required'])
  note('gate-future-grant', 'draft')
  // Put the person's real decision back: the rest of the file must not inherit a forged record.
  genuine.approval = { state: 'granted', at: keptGrant }
  writeFileSync(gatesFile, JSON.stringify(file2, null, 2))
  const restored = (await api({ action: 'list' })).json
  eq('...and the untouched record still reads activated', restored.tasks.find((t) => t.id === idA).gate.status, 'activated')
  // The check is about evidence, not about the cloud: the one automation a person really approved may still be published
  // there, and brought back, because its record allows activation.
  const linkA = (await api({ action: 'cloud-link', id: idA, cloud: { computerId: '0f0e0d0c-0b0a-4908-8706-050403020100', name: 'the studio Mac' } })).json
  ok('an approved automation can still be published', linkA.ok === true && taskOnDisk(idA).cloud !== undefined && taskOnDisk(idA).active === false)
  const backA = (await api({ action: 'cloud-link', id: idA, cloud: null })).json
  ok('...and brought back, its record allowing the activation', backA.ok === true && taskOnDisk(idA).active === true && Object.prototype.hasOwnProperty.call(taskOnDisk(idA), 'cloud') === false)
}

// ── 16. A second trial, a dirty trial, and the mask that could not be applied ──────────────────────────────────────
const fresh = (await api({ action: 'create', task: cleanTask })).json
const idE = fresh.task.id
await api({ action: 'gate-check', id: idE })
const guardsBefore = main.guards.length
const trialE = (await api({ action: 'trial-start', id: idE })).json
ok('a second trial installs a fresh guard', trialE.ok === true && main.guards.length === guardsBefore + 1)
main.journals.set(trialE.runId, dirtyEvents)
const dirtyReport = (await api({ action: 'trial-report', id: idE })).json
ok('a trial that wrote outside stays trial-done, with its effects listed', dirtyReport.ok === true && dirtyReport.report.sideEffectFree === false && dirtyReport.gate.status === 'trial-done' && dirtyReport.report.externalEffects.length > 0)
const dirtyApprove = (await api({ action: 'approve', id: idE, decision: 'grant', rev: dirtyReport.gate.rev })).json
eq('...and there is no path from it to approved', [dirtyApprove.ok, dirtyApprove.error], [false, 'approval not possible: the trial had outside effects'])
note('dirty-trial', dirtyApprove.error)

const maskTask = (await api({ action: 'create', task: cleanTask })).json
const idG = maskTask.task.id
await api({ action: 'gate-check', id: idG })
const revBeforeMask = gateOnDisk(idG).rev
const sessionsBeforeMask = main.sessions.length
const presets = main.presets
const table = presets.table
main.services.permissionPresets = undefined
const maskRefused = (await api({ action: 'trial-start', id: idG })).json
main.services.permissionPresets = { names: Object.keys(table), resolve: (name) => { if (table[name] === undefined) throw new Error('unknown preset'); return table[name] }, set: () => {} }
eq('a trial never starts unmasked', [maskRefused.ok, maskRefused.error], [false, 'mask unavailable'])
note('mask-missing', maskRefused.error)
eq('...no gate record moved', gateOnDisk(idG).rev, revBeforeMask)
ok('...and the stored automation is untouched', taskOnDisk(idG).approvals === 'ask' && taskOnDisk(idG).active === false)

// a refused decision is recorded and terminal
const refusedDecision = (await api({ action: 'approve', id: idE, decision: 'refuse', rev: 1 })).json
ok('a refusal is recorded at any rung and is final', refusedDecision.ok === true && refusedDecision.gate.status === 'refused' && refusedDecision.gate.approval.state === 'refused')
const afterRefusal = (await api({ action: 'approve', id: idE, decision: 'grant', rev: refusedDecision.gate.rev })).json
eq('...nothing grants it afterwards', [afterRefusal.ok, afterRefusal.error], [false, 'approval not possible: already refused'])

// ── 16b. A home-mode automation's trial never borrows the person's chat ─────────────────────────────────────────────
{
  // A live chat the fire path knows about: `sessions.get` answers for it, so a copy that kept `sessionMode: 'home'` would
  // post the trial into that very session — and `trialFromEvents` reads the FIRST turn of it, the person's earliest
  // conversation. A clean old turn would then certify unrelated work.
  const homeChat = main.sessions[0]
  const created = (await api({ action: 'create', task: Object.assign({}, cleanTask, { sessionMode: 'home', homeSessionId: homeChat }) })).json
  ok('a home-mode automation stores its home', created.ok === true && created.task.sessionMode === 'home' && created.task.homeSessionId === homeChat, JSON.stringify(created))
  const idH = created.task.id
  await api({ action: 'gate-check', id: idH })
  const sessionsBeforeHome = main.sessions.length
  const homeTrial = (await api({ action: 'trial-start', id: idH })).json
  ok('a home-mode trial starts', homeTrial.ok === true && typeof homeTrial.runId === 'string', JSON.stringify(homeTrial))
  ok('...in a session of its own, never the home one', homeTrial.runId !== homeChat)
  eq('...so exactly one fresh session is opened', main.sessions.length, sessionsBeforeHome + 1)
  eq('...and the stored automation still points at its own home', taskOnDisk(idH).homeSessionId, homeChat)
  ok('...because the masked copy is stripped of both home fields', /delete masked\.sessionMode/.test(source) === true && /delete masked\.homeSessionId/.test(source) === true)
  // The proof is then built from the trial's own journal: a shared home session never gives one.
  main.journals.set(homeTrial.runId, cleanEvents.map((e) => Object.assign({}, e)))
  const homeReport = (await api({ action: 'trial-report', id: idH })).json
  ok('...and the proof comes from the trial run itself', homeReport.ok === true && homeReport.report.sideEffectFree === true, JSON.stringify(homeReport))
  note('home-mode-trial', 'own session')
}

// ── 16c. gate-check hands the static checks a clock and the record ──────────────────────────────────────────────────
{
  // `schedule.at.past` is the one check that needs a clock and `gate.unapproved-activation` the one that needs the
  // record: with a bare `checkDraft(draft)` at the call site, neither could ever fire through this route.
  const past = (await api({ action: 'create', task: Object.assign({}, cleanTask, { schedule: { mode: 'once', at: '2020-01-01T09:00' } }) })).json
  ok('a paused one-off dated in the past is storable', past.ok === true)
  const pastCheck = (await api({ action: 'gate-check', id: past.task.id })).json
  ok('a one-off date in the past fails the static gate through the route', pastCheck.ok === true && pastCheck.gate.status === 'static-failed', JSON.stringify(pastCheck))
  ok('...with the finding only a clock can produce', pastCheck.gate.staticChecks.findings.some((f) => f.code === 'schedule.at.past') === true, JSON.stringify(pastCheck.gate.staticChecks.findings))
  // The record reaches B1 as the record it read: an approved rung with no grant is a blocker there.
  const withRecord = checkDraft({ name: 'Weekly report', prompt: 'Compile the weekly report and save it as a draft.', schedule: { mode: 'cron', cron: '0 8 * * 1' }, approvals: 'ask' }, { nowMs: Date.now(), gate: { status: 'approved', approval: { state: 'none' } } })
  ok('B1 flags an approved record with no grant when it is handed the record', withRecord.verdict === 'fail' && withRecord.findings.some((f) => f.code === 'gate.unapproved-activation') === true, JSON.stringify(withRecord))
  ok('...and the route passes both options at its single call site', source.indexOf('checkDraft(kbGateDraftOf(t), { nowMs: Date.now(), gate: currentGate })') >= 0)
  note('gate-check-options', 'nowMs + gate')
}

// ── 17. The initiative queue: the two route actions and the two agent tools ─────────────────────────────────────────
const initiativeRecord = main.tools.find((t) => t.name === 'initiative_record')
const initiativeList = main.tools.find((t) => t.name === 'initiative_list')
ok('the two initiative tools are mounted, so deps.initiative is wired', initiativeRecord !== undefined && initiativeList !== undefined)
const recorded = await initiativeRecord.execute({ title: 'Weekly reporting takes an hour', n: 4, span: '60 days', where: 'Gmail › Sent', risk: 'low', reversibility: 'easy', summary: 'Prepare the weekly report draft' }, { agent: { session: { id: 'sess-chat' } } })
ok('the agent records an initiative in process', recorded.ok === true && typeof recorded.item.id === 'string')
ok('...initiatives.json is created beside tasks.json', existsSync(initiativesFile) === true)
const queueListed = (await api({ action: 'queue list' })).json
ok('queue list answers the pending items and its own cap', queueListed.ok === true && queueListed.items.length === 1 && queueListed.cap === 8)
const acted = (await api({ action: 'queue act', id: recorded.item.id, status: 'added' })).json
ok('queue act records the person\'s answer', acted.ok === true && acted.item.status === 'added')
eq('...and the pending list is empty again', (await api({ action: 'queue list' })).json.items.length, 0)
const actedAgain = (await api({ action: 'queue act', id: recorded.item.id, status: 'asked' })).json
ok('...while the entry itself is kept', actedAgain.ok === true && actedAgain.item.status === 'asked')
eq('`proposed` is the creation state, never an answer', (await api({ action: 'queue act', id: recorded.item.id, status: 'proposed' })).json.error, 'unknown status')
eq('an unknown id is not found', (await api({ action: 'queue act', id: 'i_nope', status: 'dropped' })).json.error, 'not found')
eq('an id is required', (await api({ action: 'queue act', status: 'dropped' })).json.error, 'id required')
{
  const listedByTool = await initiativeList.execute({}, {})
  ok('the agent reads the queue through the same ledger', listedByTool.ok === true && Array.isArray(listedByTool.items) === true)
}

// ── 18. A damaged gate file never fails the list, and fails the run paths closed ───────────────────────────────────
let healthyGateText = null
{
  healthyGateText = readFileSync(gatesFile, 'utf8')
  const healthy = JSON.parse(healthyGateText)
  ok('gates.json is written atomically with mode 0600', (statSync(gatesFile).mode & 0o777).toString(8) === '600')
  ok('...as one envelope with a version and records', healthy.version === 1 && Array.isArray(healthy.records) === true)
  writeFileSync(gatesFile, '{')
  const listed = (await api({ action: 'list' })).json
  ok('a corrupt store still answers the list, with every gate null and gateStore', listed.ok === true && listed.gateStore === 'unreadable' && listed.tasks.every((t) => t.gate === null))
  const checked = (await api({ action: 'gate-check', id: idA })).json
  eq('a gate action answers the machine-readable code', [checked.ok, checked.code, checked.error], [false, 'gate-corrupt', 'gate store unreadable'])
  const ran = (await api({ action: 'run-now', id: idB })).json
  eq('a run path answers the readable string, with no code', [ran.ok, ran.error, ran.code], [false, 'gate store unreadable', undefined])
  ok('the file is left untouched', readFileSync(gatesFile, 'utf8') === '{')
  const copies = readdirSync(join(home, 'kybernos')).filter((f) => f.startsWith('gates.json.corrupt-'))
  ok('a private copy of the corrupt gate file is kept, once', copies.length === 1, JSON.stringify(copies))
  // The repair the documentation gives is `mv gates.json gates.json.broken`; here the test puts the healthy file back, so
  // the two remaining boots start from a readable gate store.
  writeFileSync(gatesFile, healthyGateText)
}

// ── 19. The two guard seams: the accepted fallback, and the refusal when neither exists ────────────────────────────
{
  // (a) no `tools.guard`, but a `tools/pre-execute` seam: the trial starts and the hook denies the write.
  const fallback = await boot({ tools: { register: () => {} } })
  const apiF = fallback.api
  const created = (await apiF({ action: 'create', task: cleanTask })).json
  const idF = created.task.id
  await apiF({ action: 'gate-check', id: idF })
  const handlersBefore = (fallback.handlers['tools/pre-execute'] || []).length
  const tried = (await apiF({ action: 'trial-start', id: idF })).json
  ok('without tools.guard the trial starts on the pre-execute fallback', tried.ok === true, JSON.stringify(tried))
  const handlers = (fallback.handlers['tools/pre-execute'] || []).slice(handlersBefore)
  const trialHook = handlers[handlers.length - 1]
  ok('...the hook was registered for the trial', typeof trialHook === 'function')
  const denial = await trialHook({ name: 'gmail_send', agent: { session: { id: tried.runId } } }, async () => 'next')
  ok('...and denies a write of the trial\'s session with the same reason', denial !== null && denial.kind === 'deny' && denial.reason === TRIAL_DENY_REASON)
  const allowed = await trialHook({ name: 'gmail_list', agent: { session: { id: tried.runId } } }, async () => 'next')
  ok('...while a read still goes through', allowed === 'next')
  const other = await trialHook({ name: 'gmail_send', agent: { session: { id: 'sess-elsewhere' } } }, async () => 'next')
  ok('...and another session is untouched', other === 'next')
  note('trial-guard-fallback', 'pre-execute denied')
  fallback.server.close()
}
{
  // (b) neither seam: no session is started and nothing is written.
  const naked = await boot({ tools: { register: () => {} }, noOn: true })
  const apiN = naked.api
  const created = (await apiN({ action: 'create', task: cleanTask })).json
  const idN = created.task.id
  await apiN({ action: 'gate-check', id: idN })
  const revBefore = gateOnDisk(idN).rev
  const tried = (await apiN({ action: 'trial-start', id: idN })).json
  eq('with no seam that can deny, the trial is refused', [tried.ok, tried.error], [false, 'write guard unavailable'])
  eq('...no session is created', naked.sessions.length, 0)
  eq('...and no gate record is written', gateOnDisk(idN).rev, revBefore)
  naked.server.close()
}

// ── 20. The plan/answer shapes the page depends on ─────────────────────────────────────────────────────────────────
eq('an unknown action still answers as it always did', (await api({ action: 'nope' })).json.error, 'unknown action: nope')
eq('a non-string id is refused on every new action', (await api({ action: 'gate-check', id: 42 })).json.error, 'id required')
eq('approve refuses a decision it does not know', (await api({ action: 'approve', id: idA, decision: 'maybe', rev: 1 })).json.error, 'decision must be grant or refuse')
eq('approve on an automation with no record says so', (await api({ action: 'approve', id: 'st-none', decision: 'grant', rev: 1 })).json.error, 'gate not found')
eq('trial-report on an automation that never trialled says so', (await api({ action: 'trial-report', id: 'st-none' })).json.ok, false)

// ── 21. Captures and the negative control ───────────────────────────────────────────────────────────────────────────
const need = ['human-marker', 'phone-gate-check', 'phone-list', 'stale-rev', 'mask-missing', 'dirty-trial', 'scheduler-fire',
  'scheduler-history', 'trial-busy', 'trial-guard', 'trial-guard-disposed', 'trial-guard-fallback', 'update-reactivate',
  'cloud-return', 'cloud-publish', 'create-seed', 'gate-forged', 'gate-future-grant', 'toggle-project', 'ungated-run-now',
  'home-mode-trial', 'gate-check-options']
observed.set('human-marker', countOf(source, 'human: true') + ' site in index.js, ' + countOf(readFileSync(join(here, 'automation-tools.mjs'), 'utf8'), 'human: true') + ' in automation-tools.mjs')

const wantDump = process.argv.includes('--dump')
if (wantDump === true) {
  // The capture of the wire contract: replayable, and it carries neither a cookie (never logged) nor a webhook secret.
  const noSecret = (key, value) => (key === 'secret' ? '•••' : value)
  for (const entry of main.wire) console.log(JSON.stringify(entry, noSecret))
}
if (process.argv.includes('--prove-refusals') === true) {
  const missing = need.filter((label) => observed.has(label) === false)
  for (const label of need) console.log((observed.has(label) === true ? 'seen ' : 'MISS ') + label + ': ' + (observed.get(label) || ''))
  if (missing.length === 0) console.log('all ' + need.length + ' refusals observed')
  else { console.log('missing ' + missing.length + ': ' + missing.join(', ')); fails += 1 }
}

main.server.close()
console.log('')
console.log(n + ' assertions, ' + fails + ' failure(s)')
process.exit(fails === 0 ? 0 : 1)
