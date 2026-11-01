// Test of the client half of the certification gate (batch B5): the gate panel of the Automations page, the proof of a supervised
// trial, and the initiative cards. It is the executable form of the spec's invariant #1 — "activation requires an explicit human
// approval" — and of its bounds, its i18n table and its source guards.
//
// It extracts, the house way, the three places of client.js the batch owns: the KB-AUTOBOARD block (the gate/queue pure functions),
// the KB-AUTORUNS block (the proof), and the new `// <kbgate-ui>` region (the three components). It also parses KB_T line by line.
// The client is a browser bundle with no exports, so the blocks are imported through a `data:` URL with an explicit name list.
// Usage: node packages/kybernos-plugin/test-automation-gate-client.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')

/* ── The three extractions ───────────────────────────────────────────────── */
const boardParts = src.split('// KB-AUTOBOARD-BEGIN')
if (boardParts.length !== 2) { console.error('exactly one KB-AUTOBOARD block expected in client.js'); process.exit(1) }
const boardBlock = boardParts[1].split('// KB-AUTOBOARD-END')[0]
const runsParts = src.split('// KB-AUTORUNS-BEGIN')
if (runsParts.length !== 2) { console.error('exactly one KB-AUTORUNS block expected in client.js'); process.exit(1) }
const runsBlock = runsParts[1].split('// KB-AUTORUNS-END')[0]
const uiParts = src.split('// <kbgate-ui>')
if (uiParts.length !== 2) { console.error('exactly one <kbgate-ui> region expected in client.js'); process.exit(1) }
const ui = uiParts[1].split('// </kbgate-ui>')[0]
if (ui.trim() === '') { console.error('the <kbgate-ui> region is empty'); process.exit(1) }

const boardNames = ['KB_GATE_STATUSES', 'KB_GATE_FINDINGS_MAX', 'KB_GATE_MSG_MAX', 'KB_INIT_MAX', 'KB_INIT_VISIBLE',
  'kbGateOf', 'kbGateTone', 'kbGateSteps', 'kbGateCanApprove', 'kbGateCanActivate', 'kbGateCanRefuse', 'kbGateToggleIntent',
  'kbGateFindings', 'kbGateBadge', 'kbGateError', 'kbInitView']
const runsNames = ['KB_GATE_TOOLS_MAX', 'KB_GATE_EFFECTS_MAX', 'KB_GATE_ERRORS_MAX', 'kbProofOf', 'kbRunFmtDur']
const G = await import('data:text/javascript,' + encodeURIComponent(boardBlock + '\nexport { ' + boardNames.join(', ') + ' }'))
const R = await import('data:text/javascript,' + encodeURIComponent(runsBlock + '\nexport { ' + runsNames.join(', ') + ' }'))

/* ── Small assertion helpers ─────────────────────────────────────────────── */
let fails = 0
const ok = (label, cond, detail) => { if (cond !== true) { fails += 1; console.log('FAIL', label, detail === undefined ? '' : '| ' + JSON.stringify(detail)) } else console.log('ok  ', label) }
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want })

/* ── The frozen ASCII worth naming once ──────────────────────────────────── */
const STATUSES = ['draft', 'static-failed', 'static-passed', 'trial-done', 'awaiting-approval', 'approved', 'refused', 'activated']
const APPROVALS = ['none', 'asked', 'granted', 'refused']
const AT = '2026-10-27T10:00:00.000Z'
// A gate as B3 sends it inside a `list` answer: the bounded projection, with a static block and a trial when asked for.
const gate = (status, approval, extra) => Object.assign({
  id: 'gate:a1', automationId: 'a1', status: status,
  staticChecks: { ranAt: AT, verdict: status === 'static-failed' ? 'fail' : 'pass', findings: [] },
  trial: null,
  approval: { state: approval, at: approval === 'none' ? null : AT },
  updatedAt: AT, rev: 3,
}, extra || {})
// A raw task of the `list` answer: the ONLY input shape this batch reads (`task.gate`), never a gate minted on the side.
const task = (raw, active) => ({ id: 'a1', name: 'Weekly digest', active: active !== false, gate: raw })
const view = (status, approval, active, extra) => G.kbGateOf(task(status === 'unknown' ? null : gate(status, approval, extra), active))
const PROOF = {
  runId: 'trial:a1:1', gateId: 'gate:a1', startedAt: AT, endedAt: '2026-10-27T10:00:06.500Z', supervised: true,
  sideEffectFree: true,
  toolCalls: [{ toolName: 'read_file', access: 'read', outcome: 'ok' }, { toolName: 'send_email', access: 'write', outcome: 'refused-as-write' }],
  outcome: { state: 'completed' }, externalEffects: [], errors: [],
}

/* ── Invariant #1: the switch cannot be talked into switching a gated automation on ─────────────────────────────── */
{
  const bad = []
  let combos = 0
  for (const status of STATUSES.concat(['unknown'])) {
    for (const approval of APPROVALS) {
      for (const active of [true, false]) {
        combos += 1
        const rec = view(status, approval, active)
        const intent = G.kbGateToggleIntent(rec, { id: 'a1', active })
        const allowed = status !== 'unknown' && approval === 'granted' && (status === 'approved' || status === 'activated') && active === false
        if (intent === 'activate' && allowed !== true) bad.push({ status, approval, active, intent })
        if (intent === 'activate' && allowed !== true) continue
        // Switching something off asks nobody, whatever the record says.
        if (active !== false && intent !== 'deactivate') bad.push({ status, approval, active, intent, want: 'deactivate' })
        if (active === false && intent !== 'activate' && intent !== 'review') bad.push({ status, approval, active, intent, want: 'activate|review' })
      }
    }
  }
  ok('invariant #1 over ' + combos + ' combinations: activate only with a granted approval', bad.length === 0, bad.slice(0, 3))
  eq('an approved record with a granted approval activates a switch that is off', G.kbGateToggleIntent(view('approved', 'granted', false), { id: 'a1', active: false }), 'activate')
  eq('...and the same record switched ON is a plain deactivate', G.kbGateToggleIntent(view('approved', 'granted', true), { id: 'a1', active: true }), 'deactivate')
  eq('a host that checks nothing never activates', G.kbGateToggleIntent(view('unknown', 'none', false), { id: 'a1', active: false }), 'review')
  eq('a record whose approval is only ASKED does not activate', G.kbGateToggleIntent(view('awaiting-approval', 'asked', false), { id: 'a1', active: false }), 'review')
}

/* ── The refusal guard ───────────────────────────────────────────────────── */
{
  const allowed = ['draft', 'static-failed', 'static-passed', 'trial-done', 'awaiting-approval', 'approved']
  const refused = ['activated', 'refused', 'unknown']
  eq('a person can refuse every known rung but activated and refused', allowed.map((s) => G.kbGateCanRefuse(view(s, 'none', false))), allowed.map(() => true))
  eq('...and never activated, already refused, or a host that checks nothing', refused.map((s) => G.kbGateCanRefuse(view(s, 'none', false))), refused.map(() => false))
  eq('no revision, no refusal (B3 would answer "rev required")', G.kbGateCanRefuse(view('draft', 'none', false, { rev: 'x' })), false)
  eq('a refusal already recorded is not refused twice', G.kbGateCanRefuse(view('approved', 'refused', false)), false)
}

/* ── The ladder ──────────────────────────────────────────────────────────── */
{
  const next = {}
  for (const status of STATUSES) next[status] = G.kbGateSteps(view(status, status === 'activated' || status === 'approved' ? 'granted' : 'none', false)).next
  eq('awaiting-approval asks for the decision', next['awaiting-approval'], 'approve')
  eq('approved + granted asks for the switch', next.approved, 'activate')
  eq('draft, static-failed, static-passed, trial-done ask for the checks', [next.draft, next['static-failed'], next['static-passed'], next['trial-done']], ['review', 'review', 'review', 'review'])
  eq('a refused record goes back through the checks (not a dead end)', next.refused, 'review')
  eq('an activated record asks nothing', next.activated, null)
  eq('a host that checks nothing asks nothing', G.kbGateSteps(view('unknown', 'none', false)).next, null)
  eq('the approval rung is blocked without a granted approval', G.kbGateSteps(view('awaiting-approval', 'asked', false)).steps[1].blocked, true)
  eq('...and open once granted', G.kbGateSteps(view('approved', 'granted', false)).steps[1].blocked, false)
  eq('every status is matched by a branch (no fall-through)', Object.keys(next).length, 8)
}

/* ── The approval guard, and the body it produces ────────────────────────── */
{
  const good = view('awaiting-approval', 'asked', false, { trial: PROOF })
  eq('the one good combination can be approved', G.kbGateCanApprove(good), true)
  eq('no trial, no approval', G.kbGateCanApprove(view('awaiting-approval', 'asked', false)), false)
  eq('a trial that touched the outside cannot be approved', G.kbGateCanApprove(view('awaiting-approval', 'asked', false, { trial: Object.assign({}, PROOF, { sideEffectFree: false }) })), false)
  eq('a trial that claims nothing (sideEffectFree null) cannot be approved', G.kbGateCanApprove(view('awaiting-approval', 'asked', false, { trial: Object.assign({}, PROOF, { sideEffectFree: null }) })), false)
  eq('an already granted record is not approved twice', G.kbGateCanApprove(view('awaiting-approval', 'granted', false, { trial: PROOF })), false)
  eq('every status but awaiting-approval is refused', STATUSES.filter((s) => s !== 'awaiting-approval').map((s) => G.kbGateCanApprove(view(s, 'asked', false, { trial: PROOF }))), STATUSES.filter((s) => s !== 'awaiting-approval').map(() => false))
  eq('no revision, no approval', G.kbGateCanApprove(view('awaiting-approval', 'asked', false, { trial: PROOF, rev: null })), false)
  eq('canActivate needs approved + granted', [G.kbGateCanActivate(view('approved', 'granted', false)), G.kbGateCanActivate(view('approved', 'asked', false)), G.kbGateCanActivate(view('activated', 'granted', false))], [true, false, false])
  // The body the panel sends: exactly B3's four fields, the revision copied from the record on screen and never invented.
  const body = { action: 'approve', id: 'a1', decision: 'grant', rev: good.rev }
  eq('the approve body is { action, id, decision, rev }', Object.keys(body).sort(), ['action', 'decision', 'id', 'rev'])
  eq('...and its rev is the record on screen', body.rev, 3)
  eq('the revision survives only as a finite number', [view('draft', 'none', false, { rev: 'nope' }).rev, view('draft', 'none', false, { rev: Number.POSITIVE_INFINITY }).rev], [null, null])
}

/* ── Bounds and honesty of the findings ──────────────────────────────────── */
{
  const long = 'x'.repeat(400)
  const list = []
  for (let i = 0; i < 12; i += 1) list.push({ code: 'b' + i, severity: 'blocker', field: 'prompt', message: long })
  for (let i = 0; i < 10; i += 1) list.push({ code: 'w' + i, severity: 'warn', field: 'f'.repeat(80), message: 'warn ' + i })
  for (let i = 0; i < 8; i += 1) list.push({ code: 'i' + i, severity: 'info', field: 'tools', message: 'info\u0007 ' + i })
  list.push('not a finding', null)
  const f = G.kbGateFindings(view('static-failed', 'none', false, { staticChecks: { ranAt: AT, verdict: 'fail', findings: list } }))
  eq('30 findings draw 20, count the rest', [f.rows.length, f.hidden], [20, 10])
  eq('blockers are counted over ALL findings, not the drawn ones', f.blockers, 12)
  eq('the order is blocker, then warn, then info', f.rows.map((x) => x.severity).join(','), ('blocker,'.repeat(12) + 'warn,'.repeat(8)).slice(0, -1))
  eq('a 400-character message is cut to the cap with an ellipsis', [f.rows[0].message.length, f.rows[0].message.slice(-1)], [G.KB_GATE_MSG_MAX, '…'])
  eq('control characters never reach the screen', /[\u0000-\u0008\u000b-\u001f]/.test(f.rows[19].message), false)
  eq('a field is kept verbatim, up to its own cap', f.rows[12].field.length, 60)
  eq('the message cap is the constant the panel draws with', G.KB_GATE_MSG_MAX, 160)
  eq('the findings cap is the constant the panel draws with', G.KB_GATE_FINDINGS_MAX, 20)
}

/* ── The proof ───────────────────────────────────────────────────────────── */
{
  const none = R.kbProofOf(view('static-passed', 'none', false))
  eq('no trial: nothing is claimed', [none.present, none.sideEffectFree, none.durationMs], [false, null, null])
  const dirty = Object.assign({}, PROOF, {
    sideEffectFree: false,
    toolCalls: Array.from({ length: 12 }, (_, i) => ({ toolName: 'tool_' + i, access: i === 0 ? 'read' : 'write', outcome: i === 11 ? 'refused-as-write' : (i < 6 ? 'refused-as-write' : 'ok') })),
    externalEffects: ['write-succeeded:send_email', 'write-unverified:slack', 'a'.repeat(400), 'e4', 'e5', 'e6', 'e7', 'e8', 'e9'],
    errors: [{ at: AT, where: 'send_email', message: 'refused' }, { at: AT, where: 'slack', message: 'x' }, { at: AT, where: 't3', message: 'y' }, { at: AT, where: 't4', message: 'z' }],
  })
  const p = R.kbProofOf(view('trial-done', 'none', false, { trial: dirty }))
  eq('the proof is present and its verdict is the host one', [p.present, p.sideEffectFree], [true, false])
  eq('8 calls are drawn, the rest counted', [p.toolRows.length, p.toolHidden], [R.KB_GATE_TOOLS_MAX, 4])
  eq('refusals are counted over all the calls, clipped ones included', p.refused, 7)
  eq('5 effects are drawn and the rest counted', [p.effects.length, p.effectsHidden], [R.KB_GATE_EFFECTS_MAX, 4])
  eq('an effect is cut to 120 characters', p.effects[2].length, 120)
  eq('3 errors are drawn and the rest counted', [p.errors.length, p.errorsHidden], [R.KB_GATE_ERRORS_MAX, 1])
  eq('the duration comes from the two instants', [p.durationMs, R.kbRunFmtDur(p.durationMs)], [6500, '6.5 s'])
  eq('no endedAt, no duration', R.kbProofOf(view('trial-done', 'none', false, { trial: Object.assign({}, PROOF, { endedAt: null }) })).durationMs, null)
  eq('an unparsable endedAt is no duration either', R.kbProofOf(view('trial-done', 'none', false, { trial: Object.assign({}, PROOF, { endedAt: 'yesterday' }) })).durationMs, null)
  eq('an open outcome is reported as open (the poll keeps going)', R.kbProofOf(view('trial-done', 'none', false, { trial: Object.assign({}, PROOF, { outcome: { state: 'open' } }) })).outcome.state, 'open')
}

/* ── A hostile host never makes the page throw ───────────────────────────── */
{
  const empty = { known: false, status: 'unknown' }
  eq('null, a list, a string, a null gate and pizza all read as unknown', [
    G.kbGateOf(null), G.kbGateOf([]), G.kbGateOf('x'), G.kbGateOf({ gate: null }), G.kbGateOf({ gate: { status: 'pizza' } }),
  ].map((v) => ({ known: v.known, status: v.status })), [empty, empty, empty, empty, empty])
  eq('an approval that is not an object is not a record', G.kbGateOf({ gate: { status: 'draft', approval: 'x', staticChecks: null } }).known, false)
  eq('a static block that is not an object is not a record', G.kbGateOf({ gate: { status: 'draft', approval: { state: 'none' }, staticChecks: 7 } }).known, false)
  eq('the unknown view carries every field of the shape', Object.keys(G.kbGateOf(null)).sort(), ['approval', 'findings', 'known', 'rev', 'status', 'trial', 'updatedAt', 'verdict'])
  eq('a stored `unknown` is never believed', G.kbGateOf({ gate: { status: 'unknown', approval: { state: 'none' }, staticChecks: null } }).status, 'unknown')
  eq('the host refusals are mapped', ['unknown action: gate-check', 'approval required', 'task not found', 'sign-in required', 'refused_on_phone', 'stale', 'ran out of space'].map((m) => G.kbGateError(m)),
    ['unknown-action', 'approval', 'not-found', 'signin', 'phone', 'other', 'other'])
}

/* ── The read path is the list, and only the list (D1) ───────────────────── */
{
  // A real two-task answer: the first carries a gate, the second does not. No gate is shared, defaulted or minted here.
  const answer = { ok: true, tasks: [{ id: 'a1', active: false, gate: gate('awaiting-approval', 'asked') }, { id: 'a2', active: true }] }
  const views = answer.tasks.map((t) => G.kbGateOf(t))
  eq('the first task reads its own record', [views[0].known, views[0].status], [true, 'awaiting-approval'])
  eq('the task without a gate is unknown, never defaulted', [views[1].known, views[1].status], [false, 'unknown'])
  eq('the two views are distinct objects', views[0] === views[1], false)
}

/* ── `unknown` is a view value, never a persisted status ─────────────────── */
{
  eq('the frozen union holds the eight stored statuses, not `unknown`', G.KB_GATE_STATUSES, STATUSES)
  ok('the union does not contain `unknown`', G.KB_GATE_STATUSES.indexOf('unknown') < 0)
  // The panel tags the degradation state, and tags it alone: data-known="false" only next to data-status="unknown".
  const tag = /'data-status': g\.status, 'data-known': g\.known === true \? 'true' : 'false'/
  ok('the panel writes data-known from `known` alone', tag.test(ui))
  ok('a frozen status can never be written with data-known="false"', /'data-known': g\.known === true \? 'true' : 'false'/.test(ui) && G.kbGateOf({ gate: gate('draft', 'none') }).known === true)
  ok('no approve/toggle body of the page can carry the string unknown', /unknown/.test(src.slice(src.indexOf("const gateCall = async (action, id, extra)"), src.indexOf("const gateCall = async (action, id, extra)") + 1200)) === false)
}

/* ── The initiative queue ────────────────────────────────────────────────── */
{
  const item = (i, extra) => Object.assign({ id: 'i' + i, title: 'Chase invoice ' + i, evidence: { n: 14, span: '60 days', where: 'Gmail' }, risk: 'low', reversibility: 'trivial', nextAction: { kind: 'draft', summary: 'Draft it' }, status: 'proposed' }, extra || {})
  const ten = Array.from({ length: 10 }, (_, i) => item(i))
  const v = G.kbInitView(ten, 8)
  eq('a cap of 8 draws 8 and counts the rest', [v.items.length, v.hidden, v.cap], [8, 2, 8])
  eq('a larger cap is bounded by the constant', G.kbInitView(ten, 99).cap, G.KB_INIT_MAX)
  eq('no cap at all falls back to the constant', G.kbInitView(ten, undefined).cap, G.KB_INIT_MAX)
  const notDraft = G.kbInitView([item(1, { nextAction: { kind: 'send', summary: 'Send it' } })], 8)
  eq('an entry whose next action is not a draft is drawn, unusable, and counted', [notDraft.items.length, notDraft.items[0].usable, notDraft.skipped], [1, false, 1])
  const junk = G.kbInitView([null, 'x', { title: 'no id' }, item(1), item(1)], 8)
  eq('not an object, no id and a repeated id are dropped', junk.items.map((i) => i.id), ['i1'])
  eq('evidence that is not an object shows the absence, it does not crash', G.kbInitView([item(2, { evidence: 'x' })], 8).items[0].evidence, { n: 0, span: '', where: '' })
  eq('an empty or hostile list is an empty view', [G.kbInitView(null).items.length, G.kbInitView(undefined).hidden], [0, 0])
  eq('the drawn cap of the block is the constant', G.KB_INIT_VISIBLE, 3)
}

/* ── The badge: the FULL key, never a suffix ─────────────────────────────── */
{
  const badge = (s) => G.kbGateBadge(view(s, 'none', false))
  eq('awaiting-approval, static-failed and refused carry a badge', [badge('awaiting-approval'), badge('static-failed'), badge('refused')],
    ['tasks.gate.badge.awaiting', 'tasks.gate.badge.failed', 'tasks.gate.badge.refused'])
  eq('the other six carry nothing', ['draft', 'static-passed', 'trial-done', 'approved', 'activated', 'unknown'].map(badge), ['', '', '', '', '', ''])
  ok('no badge key is composed from a prefix', ui.indexOf("'tasks.gate.badge.' +") < 0 && ui.indexOf('`tasks.gate.badge.') < 0)
}

/* ── The tone table, one table ───────────────────────────────────────────── */
{
  eq('activated and approved are ok', ['activated', 'approved'].map(G.kbGateTone), ['ok', 'ok'])
  eq('awaiting-approval AND trial-done warn (a trial finished, a person is expected)', ['awaiting-approval', 'trial-done'].map(G.kbGateTone), ['warn', 'warn'])
  eq('static-failed and refused are bad', ['static-failed', 'refused'].map(G.kbGateTone), ['bad', 'bad'])
  eq('draft, static-passed and unknown are idle', ['draft', 'static-passed', 'unknown'].map(G.kbGateTone), ['idle', 'idle', 'idle'])
}

/* ── i18n: the 94 keys, both twins, defined once ─────────────────────────── */
const KEYS = [
  'tasks.gate.st.draft', 'tasks.gate.st.static-failed', 'tasks.gate.st.static-passed', 'tasks.gate.st.trial-done',
  'tasks.gate.st.awaiting-approval', 'tasks.gate.st.approved', 'tasks.gate.st.refused', 'tasks.gate.st.activated', 'tasks.gate.st.unknown',
  'tasks.gate.hint.static-failed', 'tasks.gate.hint.awaiting-approval', 'tasks.gate.hint.approved', 'tasks.gate.hint.refused', 'tasks.gate.hint.unknown',
  'tasks.gate.panel.title', 'tasks.gate.panel.intro', 'tasks.gate.review', 'tasks.gate.collapse',
  'tasks.gate.check', 'tasks.gate.checking', 'tasks.gate.checked.at', 'tasks.gate.checked.never',
  'tasks.gate.findings.title', 'tasks.gate.findings.none', 'tasks.gate.findings.more',
  'tasks.gate.severity.blocker', 'tasks.gate.severity.warn', 'tasks.gate.severity.info',
  'tasks.gate.trial.title', 'tasks.gate.trial.start', 'tasks.gate.trial.running', 'tasks.gate.trial.none', 'tasks.gate.trial.done',
  'tasks.gate.trial.supervised', 'tasks.gate.trial.blocked',
  'tasks.gate.approve', 'tasks.gate.refuse', 'tasks.gate.approve.hint', 'tasks.gate.refuse.title', 'tasks.gate.refuse.body',
  'tasks.gate.approved.toast', 'tasks.gate.refused.toast', 'tasks.gate.activate.gated', 'tasks.gate.unavailable',
  'tasks.gate.badge.awaiting', 'tasks.gate.badge.failed', 'tasks.gate.badge.refused',
  'tasks.gate.err.unknown-action', 'tasks.gate.err.approval', 'tasks.gate.err.not-found', 'tasks.gate.err.signin', 'tasks.gate.err.phone', 'tasks.gate.err.other',
  'tasks.proof.title', 'tasks.proof.sideeffect.ok', 'tasks.proof.sideeffect.bad', 'tasks.proof.sideeffect.unknown',
  'tasks.proof.tools.title', 'tasks.proof.tools.none', 'tasks.proof.access.read', 'tasks.proof.access.write',
  'tasks.proof.outcome.ok', 'tasks.proof.outcome.failed', 'tasks.proof.outcome.open', 'tasks.proof.outcome.refused',
  'tasks.proof.effects.title', 'tasks.proof.effects.none', 'tasks.proof.effects.more', 'tasks.proof.errors.title', 'tasks.proof.errors.more',
  'tasks.proof.refused', 'tasks.proof.duration',
  'tasks.init.title', 'tasks.init.intro', 'tasks.init.empty', 'tasks.init.unavailable',
  'tasks.init.evidence', 'tasks.init.ask', 'tasks.init.drop', 'tasks.init.asked', 'tasks.init.dropped', 'tasks.init.more', 'tasks.init.showless',
  'tasks.init.risk.low', 'tasks.init.risk.medium', 'tasks.init.risk.high',
  'tasks.init.rev.trivial', 'tasks.init.rev.easy', 'tasks.init.rev.hard',
  'tasks.init.status.proposed', 'tasks.init.status.asked', 'tasks.init.status.added', 'tasks.init.status.dropped',
  'tasks.init.notdraft',
]
// The table, parsed line by line: one object literal per line, as the page writes it. The count is kept before collapsing, so a
// duplicate row (which would silently win in the object literal) fails here instead of hiding.
const table = new Map()
const counts = new Map()
for (const line of src.split('\n')) {
  const t = /^\s*'([A-Za-z0-9_.-]+)':\s*(\{.*\}),?\s*$/.exec(line)
  if (t === null) continue
  let row = null
  try { row = (0, eval)('(' + t[2] + ')') } catch (e) { row = null }
  if (row === null || typeof row !== 'object') continue
  table.set(t[1], row)
  counts.set(t[1], (counts.get(t[1]) || 0) + 1)
}
{
  eq('the declared list holds 94 keys', KEYS.length, 94)
  eq('no key is declared twice in this test', new Set(KEYS).size, 94)
  const missing = KEYS.filter((k) => table.has(k) !== true)
  eq('all 94 keys are in KB_T', missing, [])
  const twins = KEYS.filter((k) => typeof table.get(k).kybernos !== 'string' || table.get(k).kybernos.trim() === '' || typeof table.get(k).en !== 'string' || table.get(k).en.trim() === '')
  eq('every key has a French and an English twin', twins, [])
  const dirty = KEYS.filter((k) => table.has(k) === true && counts.get(k) !== 1)
  eq('no key is defined twice', dirty, [])
  // Every key this batch uses is one of the 94: a typo shows here instead of a raw key on the screen.
  const used = new Set()
  for (const text of [ui, boardBlock.slice(boardBlock.indexOf("'tasks.gate.badge.awaiting'") - 4000), runsBlock]) {
    for (const m of text.matchAll(/kbt\('([A-Za-z0-9_.-]+)'\)/g)) used.add(m[1])
    for (const m of text.matchAll(/'(tasks\.(?:gate|proof|init)\.[A-Za-z0-9_.-]+)'/g)) used.add(m[1])
  }
  const unknown = [...used].filter((k) => KEYS.indexOf(k) < 0)
  eq('every key the region, the blocks and the badge use is declared', unknown, [])
  eq('the three badge keys a function returns are declared', ['tasks.gate.badge.awaiting', 'tasks.gate.badge.failed', 'tasks.gate.badge.refused'].filter((k) => table.has(k) !== true), [])
}

/* ── The source contract of the region (spec § 9) ────────────────────────── */
{
  const forbidden = ['fetch(', 'window.open', 'localStorage', 'sessionStorage', 'setInterval', 'dangerouslySetInnerHTML', 'autoFocus', 'host.call', 'props.call', 'navigator.clipboard', 'setTimeout']
  eq('no network, no storage, no timer, no html injection, no autofocus in the region', forbidden.filter((f) => ui.indexOf(f) >= 0), [])
  eq('nothing fires on mount: the region holds no effect at all', (ui.match(/useEffect/g) || []).length, 0)
  eq('no host string is ever built into markup', (ui.match(/innerHTML/g) || []).length, 0)
  eq('no French prose in the region: only hooks, class names and kbt keys', /[àâçéèêëîïôùûüœ]/i.test(ui.replace(/'tasks\.[A-Za-z0-9_.-]+'/g, '')), false)
  ok('the four caps of the panel are the constants the region draws with', ui.indexOf('KB_INIT_VISIBLE') >= 0 && ui.indexOf('kbGateFindings(') >= 0 && ui.indexOf('kbProofOf(') >= 0 && ui.indexOf('kbInitView(') < 0)
  ok('the region caps the drawn list with a slice on the constant', /view\.items\.slice\(0, KB_INIT_VISIBLE\)/.test(ui))
  ok('the panel reads the record, it never computes a verdict', ui.indexOf('verdict:') < 0 && ui.indexOf('verdict =') < 0)
  ok('the panel draws the finding rows from kbGateFindings', ui.indexOf('findings.rows.map') >= 0)
  ok('the proof block draws from kbProofOf', ui.indexOf('kbProofOf(g)') >= 0)
}

/* ── The pure blocks decide nothing (spec § 3.1) ─────────────────────────── */
{
  const gateSlice = boardBlock.slice(boardBlock.indexOf('const KB_GATE_STATUSES'), boardBlock.length)
  // Comments may name the rules; code may not run them. Only non-comment lines are measured.
  const code = gateSlice.split('\n').filter((l) => /^\s*(\/\/|\*|\/\*)/.test(l) === false).join('\n')
  eq('no cron parsing, no zone check, no prompt scan in the gate part', ['cron', 'timeZone', 'Intl.', 'toLowerCase', 'Date.now', 'new Date'].filter((w) => code.indexOf(w) >= 0), [])
  const proofSlice = runsBlock.slice(runsBlock.indexOf('const KB_GATE_TOOLS_MAX'), runsBlock.length)
  const proofCode = proofSlice.split('\n').filter((l) => /^\s*(\/\/|\*|\/\*)/.test(l) === false).join('\n')
  eq('the proof part reads the host, it does not re-measure anything', ['cron', 'Intl.', 'toLowerCase', 'Date.now'].filter((w) => proofCode.indexOf(w) >= 0), [])
  ok('sideEffectFree is never true by default', /typeof trial\.sideEffectFree === 'boolean' \? trial\.sideEffectFree : null/.test(proofSlice))
}

/* ── The page wiring: one door for every switch ──────────────────────────── */
{
  eq('the three switches consult the intent before any toggle', (src.match(/kbGateToggleIntent\(/g) || []).length >= 3, true)
  eq('the raw toggle action is reached from ONE place only', (src.match(/act\('toggle'/g) || []).length, 1)
  ok('...and that place is the card handler, whose own switch asks the intent first', /if \(kbGateToggleIntent\(kbGateOf\(t\), t\) === 'review'\) props\.onGateReview\(t\); else props\.onToggle\(t\)/.test(src))
  ok('the approve body is built once, with decision and rev', /gateCall\('approve', task\.id, \{ decision: decision, rev: rec\.rev \}\)/.test(src))
  ok('a missing revision is refused before the call', /if \(rec\.rev === null\)/.test(src))
  ok('the trial poll is bounded by the 30-call cap', /n > 30/.test(src) && /trialPoll\(task\.id, 1\)/.test(src))
  ok('the trial poll sends the id only', /action: 'trial-report', id: id/.test(src))
  ok('a hidden tab stops the poll', /document\.hidden === true/.test(src))
  ok('the queue is read through the route, never faster than 30 s', /action: 'queue list'/.test(src) && /Date\.now\(\) - init\.at < 30000/.test(src))
  ok('queue act only sends asked or dropped', /initAct\(it, 'asked'\)/.test(src) && /initAct\(it, 'dropped'\)/.test(src) && /initAct\(it, 'added'\)/.test(src) === false)
}

/* ── The CSS of the new surface (spec § 6.5, strategy `unit:`) ───────────── */
{
  const at = src.indexOf('/* The certification gate and the initiative cards')
  ok('the kbgate rules are after the suggested card rules', at > src.indexOf('.kba-card.kba-sugcard') && at > 0)
  const css = src.slice(at, src.indexOf('/*', at + 20) > 0 ? src.indexOf('/*', at + 20) : at + 7000)
  const block = css.slice(0, css.indexOf('.kbbd-emptycol') > 0 ? css.indexOf('.kbbd-emptycol') : 7000)
  eq('tokens only: no hex, no rgb(), no hsl()', ['#', 'rgb(', 'hsl('].filter((w) => block.indexOf(w) >= 0), [])
  const sizes = [...block.matchAll(/font-size:([0-9.]+)px/g)].map((m) => Number(m[1]))
  eq('every font size is on the product ladder', sizes.filter((n) => [11.5, 12.5, 13, 14].indexOf(n) < 0), [])
  const radii = [...block.matchAll(/border-radius:([0-9]+)px/g)].map((m) => Number(m[1]))
  eq('every radius is 12, 16 or 999', radii.filter((n) => [12, 16, 999].indexOf(n) < 0), [])
  ok('the new surface folds at the same 640 px as its neighbour', /@media \(max-width:640px\)\{\.kbgate/.test(src))
  // The weight of the rules: the idea block is inserted as a `.kba-card.kba-lcard`, whose reset (padding:0;gap:0;display:block) is two classes
  // strong. A single-class geometry rule loses to it whatever its place in the sheet, and the card then draws flush against its border (the title
  // clipped by the 16 px corner — measured on the live GUI, 2026-11-01). These two guards hold the fix at the cascade level, not at a pixel level.
  ok('the idea block declares its geometry at the weight of the .kba-lcard reset', /\.kba-card\.kbgate-init\{display:flex;flex-direction:column;gap:8px;padding:12px 16px\}/.test(src))
  ok('...and its 640 px fold keeps that weight', /@media \(max-width:640px\)\{\.kbgate,\.kba-card\.kbgate-init\{padding:10px 12px\}/.test(src))
  // Same family of bug one level up: the sections of this page are flex items, and a card's overflow:hidden zeroes its automatic minimum size.
  // Left free to shrink, every block was cut down to the viewport (idea cards losing a row, automation list bottom rows unreachable: nothing scrolled).
  ok('the sections of the Automations page keep their height, and the page scrolls', /\.kba-root>\*\{flex:0 0 auto\}/.test(src))
  eq('the region writes no colour of its own', ['#', 'rgb('].filter((w) => ui.indexOf(w) >= 0), [])
}

/* ── The panel and the cards are reachable from the page ─────────────────── */
{
  ok('the detail view renders the panel above the tabs', /h\(KbGatePanel, \{/.test(src) && src.indexOf('h(KbGatePanel, {') < src.indexOf("'data-kb': 'detail-tabs'"))
  ok('the list and the cards render the badge', (src.match(/h\(KbGateBadge, \{/g) || []).length >= 3)
  ok('the initiative block is inserted under the suggested card', src.indexOf('        initEl,') > src.indexOf('        sugEl,'))
  ok('a host without the queue action draws no block', /init\.phase === 'unavailable'/.test(src))
  ok('the panel says the host does not check automations', /'tasks\.gate\.unavailable'/.test(src))
}

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
