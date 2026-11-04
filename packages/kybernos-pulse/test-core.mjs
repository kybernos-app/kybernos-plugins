// kybernos-pulse — the pure rules: settings, the reading of a journal, the watcher's pass, the banners.
//   node packages/kybernos-pulse/test-core.mjs
import assert from 'node:assert/strict'
import {
  GATE_ITEMS_PER_PASS, HORIZON_MS, INBOX_MAX, LEVELS, MUTED_MAX, QUEUE_ITEMS_PER_PASS, READS_PER_PASS, SEEN_MAX, SOURCES, applySettings,
  bannersDue, candidates, cleanItem, defaults, gateItemFor, gateSignal, inboxAction, inboxPut, isQuiet, normalizeSettings, normalizeState,
  proactiveStep, publicView, queueItemFor, readRun, scrubText, taskNames, unreadCount, wantsBanner, watchStep
} from './pulse-core.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── settings ───────────────────────────────────────────────────────────────────────────────────────────────
console.log('settings')
assert.deepEqual(defaults(), { version: 1, level: 'need', banners: true, badge: true, muted: [] })
ok('the defaults: tell me when something needs me, banners and badge on, nobody quiet')
assert.deepEqual(normalizeSettings(null), defaults())
assert.deepEqual(normalizeSettings([1, 2]), defaults())
assert.equal(normalizeSettings({ level: 'loud' }).level, 'need')
assert.equal(normalizeSettings({ banners: 'yes' }).banners, true)
assert.deepEqual(normalizeSettings({ muted: ['  A  ', 'A', '', 3, 'B'] }).muted, ['A', 'B'])
assert.equal(normalizeSettings({ muted: Array.from({ length: 80 }, (_, i) => 'n' + i) }).muted.length, MUTED_MAX)
ok('a value of the wrong type reads as its default; the quiet list is trimmed, de-duplicated and bounded')

const a1 = applySettings(defaults(), { level: 'every', badge: false })
assert.equal(a1.ok, true); assert.equal(a1.settings.level, 'every'); assert.equal(a1.settings.badge, false); assert.equal(a1.settings.banners, true)
assert.equal(applySettings(defaults(), { mute: 'Morning digest' }).settings.muted[0], 'Morning digest')
assert.deepEqual(applySettings({ ...defaults(), muted: ['A', 'B'] }, { unmute: 'A' }).settings.muted, ['B'])
ok('a patch changes only what it names; mute and unmute edit the quiet list')
for (const bad of [null, [], {}, { level: 'x' }, { banners: 1 }, { muted: 'A' }, { mute: '' }, { nope: 1 }, { level: 'every', nope: 1 }]) assert.equal(applySettings(defaults(), bad).ok, false, JSON.stringify(bad))
ok('an unknown key, a wrong type or an empty patch is refused whole')
assert.deepEqual(LEVELS, ['need', 'every', 'never'])

// ── one run, from its journal ───────────────────────────────────────────────────────────────────────────────
console.log('reading a journal')
const ev = (type, data, time) => ({ type, data, time })
assert.equal(readRun(null).phase, 'running')
assert.equal(readRun([]).phase, 'running')
ok('no event at all: running, nothing is claimed')
const turn = [ev('turn/start', {}, 1000), ev('tool/call', { name: 'web_search' }, 1100), ev('tool/call', { name: 'bash' }, 1200)]
assert.deepEqual(readRun(turn), { phase: 'running', calls: 2, startedAt: 1000 })
ok('an open turn is running, with its calls and its start')
const asked = turn.concat([ev('approval/asked', { id: 'a1', callId: 'c1', toolName: 'send_email' }, 1300)])
assert.deepEqual(readRun(asked), { phase: 'waiting', calls: 2, startedAt: 1000, tool: 'send_email' })
ok('an approval asked and not decided is waiting, and names the tool')
const decided = asked.concat([ev('approval/decided', { id: 'a1', outcome: 'allowed' }, 1400)])
assert.equal(readRun(decided).phase, 'running')
ok('once the approval is decided the run is running again')
const done = decided.concat([ev('turn/end', { reason: { kind: 'stop' } }, 5000)])
assert.deepEqual(readRun(done), { phase: 'done', calls: 2, startedAt: 1000, endedAt: 5000 })
ok('a turn that ended without an error is done')
const stoppedRun = turn.concat([ev('turn/end', { reason: { kind: 'aborted', reason: { kind: 'user' } } }, 3000)])
assert.deepEqual(readRun(stoppedRun), { phase: 'stopped', calls: 2, startedAt: 1000, endedAt: 3000 })
ok('a turn the person stopped is stopped, not done (UJ-172)')
const failed = turn.concat([ev('turn/end', { reason: { kind: 'error', error: { code: 'NO_CREDENTIAL', message: 'No credit\nleft' } } }, 2000)])
const f = readRun(failed)
assert.equal(f.phase, 'failed'); assert.equal(f.code, 'NO_CREDENTIAL'); assert.equal(f.message, 'No credit left'); assert.equal(f.endedAt, 2000)
ok('an error reason is failed, with the engine\'s own code and message')
const again = done.concat([ev('turn/start', {}, 9000)])
assert.equal(readRun(again).phase, 'running')
ok('a new turn after an end is running again: only the last turn counts')
assert.equal(readRun([null, 7, 'x', ev('turn/start', {}, 1)]).phase, 'running')
ok('garbage in the journal is skipped')

// ── what the scheduler fired ────────────────────────────────────────────────────────────────────────────────
console.log('candidates')
const NOW = Date.parse('2026-10-26T14:30:00Z')
const at = (min) => new Date(NOW - min * 60000).toISOString()
const tasks = [
  { id: 't1', name: 'Night shop collector', history: [{ at: at(5), sessionId: 'session-a', status: 'fired' }, { at: at(500), sessionId: 'session-old', status: 'fired' }, { at: at(4), sessionId: null, status: 'error' }] },
  { id: 't2', name: 'Morning digest', history: [{ at: at(1), sessionId: 'session-b', status: 'queued' }, { at: at(2), sessionId: '../x', status: 'fired' }] },
  null, { id: 't3' }, { id: 't4', history: 'no' }
]
const c = candidates(tasks, NOW)
assert.deepEqual(c.map((x) => x.sessionId), ['session-b', 'session-a'])
assert.equal(c[1].name, 'Night shop collector')
ok('only fired or queued runs with a clean session id, inside the horizon, newest first')
assert.equal(HORIZON_MS, 21600000)

// ── the watcher's pass ──────────────────────────────────────────────────────────────────────────────────────
console.log('the watcher')
const journals = {}
const readRunOf = async (sid) => (Object.prototype.hasOwnProperty.call(journals, sid) ? journals[sid] : null)
const pass1 = async (state, when = NOW) => watchStep({ tasks, state, readRunOf, now: when })

journals['session-a'] = { phase: 'done', calls: 4, startedAt: NOW - 400000, endedAt: NOW - 300000 }
journals['session-b'] = { phase: 'running', calls: 1, startedAt: NOW - 50000 }
let r = await pass1(undefined)
assert.equal(r.added.length, 0); assert.equal(r.state.baselined, true); assert.equal(r.state.inbox.length, 0)
assert.equal(r.running.length, 1); assert.equal(r.running[0].task, 'Morning digest')
ok('the first pass only learns: a run already over makes no item, a run in flight is followed')

journals['session-b'] = { phase: 'done', calls: 6, startedAt: NOW - 50000, endedAt: NOW + 10000 }
r = await pass1(r.state, NOW + 20000)
assert.equal(r.added.length, 1); assert.equal(r.added[0].kind, 'done'); assert.equal(r.added[0].task, 'Morning digest'); assert.equal(r.added[0].durMs, 60000); assert.equal(r.added[0].calls, 6)
assert.equal(r.added[0].bannered, false); assert.equal(r.added[0].unread, true); assert.equal(r.state.inbox.length, 1); assert.equal(r.running.length, 0)
ok('a run that finishes after the first pass becomes a "done" item, with its duration and calls')
const again1 = await pass1(r.state, NOW + 40000)
assert.equal(again1.added.length, 0); assert.equal(again1.state.inbox.length, 1)
ok('a finished run is announced once')

// UJ-172: a run the person stopped is remembered (never read again) and says nothing: not « done », not « failed ».
const tStop = [{ id: 't-stop', name: 'Stopped by hand', history: [{ at: at(0), sessionId: 'session-stop', status: 'fired' }] }]
journals['session-stop'] = { phase: 'running', calls: 1, startedAt: NOW }
let stp = await watchStep({ tasks: tStop, state: r.state, readRunOf, now: NOW })
journals['session-stop'] = { phase: 'stopped', calls: 1, startedAt: NOW, endedAt: NOW + 5000 }
const inboxBefore = stp.state.inbox.length
stp = await watchStep({ tasks: tStop, state: stp.state, readRunOf, now: NOW + 20000 })
assert.equal(stp.added.length, 0); assert.equal(stp.state.inbox.length, inboxBefore); assert.equal(stp.running.length, 0)
assert.equal(stp.state.seen['session-stop'].phase, 'stopped')
journals['session-stop'] = { phase: 'running', calls: 9, startedAt: NOW }
const stp2 = await watchStep({ tasks: tStop, state: stp.state, readRunOf, now: NOW + 40000 })
assert.equal(stp2.running.length, 0, 'a stopped run is not read again')
assert.equal(normalizeState(stp2.state).seen['session-stop'].phase, 'stopped')
ok('a run the person stopped makes no item, is not read again, and survives a reload of the state')

journals['session-b'] = { phase: 'waiting', calls: 2, startedAt: NOW, tool: 'send_email' }
const t2 = [{ id: 't2', name: 'Morning digest', history: [{ at: at(0), sessionId: 'session-w', status: 'fired' }] }]
journals['session-w'] = { phase: 'running', calls: 0, startedAt: NOW }
let w = await watchStep({ tasks: t2, state: r.state, readRunOf, now: NOW })
assert.equal(w.added.length, 0)
journals['session-w'] = { phase: 'waiting', calls: 3, startedAt: NOW, tool: 'send_email' }
w = await watchStep({ tasks: t2, state: w.state, readRunOf, now: NOW + 20000 })
assert.equal(w.added.length, 1); assert.equal(w.added[0].kind, 'waiting'); assert.equal(w.added[0].tool, 'send_email'); assert.equal(w.added[0].todo, true); assert.equal(w.added[0].tone, 'ask')
assert.equal(w.running[0].phase, 'waiting')
ok('a run that asks for an approval becomes a "waiting" item naming the tool')
const w2 = await watchStep({ tasks: t2, state: w.state, readRunOf, now: NOW + 40000 })
assert.equal(w2.added.length, 0)
ok('waiting is announced once')
journals['session-w'] = { phase: 'running', calls: 4, startedAt: NOW }
const w3 = await watchStep({ tasks: t2, state: w2.state, readRunOf, now: NOW + 60000 })
assert.equal(w3.state.inbox.filter((x) => x.id === 'w:session-w').length, 0)
ok('once the approval is answered the "waiting" item goes away by itself')
journals['session-w'] = { phase: 'failed', calls: 4, startedAt: NOW, endedAt: NOW + 90000, code: 'NO_CREDENTIAL', message: 'No credit left' }
const w4 = await watchStep({ tasks: t2, state: w3.state, readRunOf, now: NOW + 100000 })
assert.equal(w4.added.length, 1); assert.equal(w4.added[0].kind, 'failed'); assert.equal(w4.added[0].code, 'NO_CREDENTIAL'); assert.equal(w4.added[0].message, 'No credit left'); assert.equal(w4.added[0].todo, true)
ok('a failure becomes a "failed" item with the engine\'s code and message')

let waitFirst = await watchStep({ tasks: t2, state: undefined, readRunOf: async () => ({ phase: 'waiting', calls: 1, startedAt: NOW, tool: 'bash' }), now: NOW })
assert.equal(waitFirst.added.length, 1); assert.equal(waitFirst.added[0].bannered, true)
ok('on the first pass a run still waiting for an approval does appear, but without a banner')

const unreadable = await watchStep({ tasks: t2, state: undefined, readRunOf: async () => null, now: NOW })
assert.equal(unreadable.added.length, 0); assert.deepEqual(unreadable.state.seen, {})
ok('a journal that cannot be read claims nothing and is looked at again')
const thrower = await watchStep({ tasks: t2, state: undefined, readRunOf: async () => { throw new Error('boom') }, now: NOW })
assert.equal(thrower.added.length, 0)
ok('a reader that throws does not break the pass')

const many = [{ id: 'm', name: 'Many', history: Array.from({ length: 40 }, (_, i) => ({ at: at(i), sessionId: 'session-m' + i, status: 'fired' })) }]
let reads = 0
await watchStep({ tasks: many, state: undefined, readRunOf: async () => { reads += 1; return { phase: 'running', calls: 0, startedAt: null } }, now: NOW })
assert.equal(reads, READS_PER_PASS)
ok('a pass reads at most ' + READS_PER_PASS + ' journals')

// ── the inbox, the banners ──────────────────────────────────────────────────────────────────────────────────
console.log('inbox and banners')
const item = (kind, task, extra = {}) => cleanItem({ id: kind + ':' + task, kind, task, at: 1, ...extra })
const inbox = [item('done', 'Morning digest'), item('failed', 'Price watch'), item('waiting', 'Invoice follow-ups', { tool: 'send_email' })]
const S = (o) => ({ ...defaults(), ...o })
assert.deepEqual(bannersDue(inbox, S({})).map((x) => x.kind), ['failed', 'waiting'])
ok('at "something needs me" a failure and an approval make a banner, a finished run does not')
assert.deepEqual(bannersDue(inbox, S({ level: 'every' })).map((x) => x.kind), ['done', 'failed', 'waiting'])
assert.deepEqual(bannersDue(inbox, S({ level: 'never' })), [])
assert.deepEqual(bannersDue(inbox, S({ banners: false })), [])
ok('every run makes all three; "never" and the banner switch make none')
assert.deepEqual(bannersDue(inbox, S({ level: 'every', muted: ['Morning digest', 'Price watch'] })).map((x) => x.kind), ['failed', 'waiting'])
assert.equal(isQuiet(inbox[1], S({ muted: ['Price watch'] })), false)
ok('a quiet automation keeps its finished runs silent; its failures and approvals are never quiet')
assert.equal(unreadCount(inbox, S({ muted: ['Morning digest'] })), 2)
ok('a quiet finished run is not counted on the badge')
assert.equal(wantsBanner({ ...inbox[0], bannered: true }, S({ level: 'every' })), true)
assert.equal(bannersDue([{ ...inbox[1], bannered: true }], S({})).length, 0)
ok('an item that was already shown is not due again')

let box = []
for (let i = 0; i < INBOX_MAX + 20; i += 1) box = inboxPut(box, item('done', 't' + i))
assert.equal(box.length, INBOX_MAX)
assert.equal(inboxPut(box, { ...box[5], unread: false }).length, INBOX_MAX)
ok('the inbox is bounded and an item with the same id replaces the old one')

assert.deepEqual(inboxAction(inbox, { action: 'read', id: inbox[0].id }).map((x) => x.unread), [false, true, true])
assert.deepEqual(inboxAction(inbox, { action: 'read-all' }).map((x) => x.unread), [false, false, false])
assert.equal(inboxAction(inbox, { action: 'dismiss', ids: [inbox[1].id] }).length, 2)
assert.equal(inboxAction(inbox, { action: 'banner-shown', ids: [inbox[1].id] })[1].bannered, true)
for (const bad of [null, [], { action: 'read' }, { action: 'boom', id: 'x' }, { action: 'dismiss' }]) assert.equal(inboxAction(inbox, bad), null, JSON.stringify(bad))
ok('the four inbox actions work and a bad body is refused')

assert.equal(cleanItem({ id: 'x', kind: 'bogus' }), null)
assert.equal(cleanItem({ kind: 'done' }), null)
assert.equal(cleanItem({ id: 'r:1', kind: 'done', task: 'T\u0007\u0007x', sessionId: '../nope', at: 'now', calls: -4, extra: 'drop me' }).sessionId, '')
const clean = cleanItem({ id: 'r:1', kind: 'done', task: 'T\u0007\u0007x', at: 5, calls: 3.6, durMs: 10, message: 'm', extra: 'drop me' })
assert.equal(clean.task, 'T x'); assert.equal(clean.calls, 4); assert.equal('extra' in clean, false)
ok('stored data is cleaned: known kinds only, bounded text, no foreign fields, a bad session id is dropped')

const st = normalizeState({ baselined: true, seen: { 'session-a': { phase: 'done', at: 1 }, '../x': { phase: 'done', at: 1 }, 's2': { phase: 'weird', at: 1 } }, inbox: [inbox[0], { id: 'bad' }] })
assert.deepEqual(Object.keys(st.seen), ['session-a']); assert.equal(st.inbox.length, 1)
ok('a stored state with bad entries is cleaned, not trusted')

const view = publicView({ settings: S({ muted: ['Morning digest'] }), state: { baselined: true, seen: {}, inbox }, running: [], now: 5 })
assert.equal(view.unread, 2); assert.deepEqual(view.banners.sort(), [inbox[1].id, inbox[2].id].sort()); assert.equal(view.inbox[0].quiet, true)
ok('the view carries the unread count, the items due for a banner and which ones are quiet')

// ── the gate and the queue: two feeds read beside tasks.json ────────────────────────────────────────────────
console.log('gate records')
const GATE_AT = Date.parse('2026-10-28T00:00:00Z')
const gIso = (ms) => new Date(ms).toISOString()
const proofOf = (extra = {}) => ({ runId: 'run-1', gateId: 'gate:a1', startedAt: gIso(GATE_AT), endedAt: gIso(GATE_AT), supervised: true, sideEffectFree: true, toolCalls: [{ toolName: 'bash', access: 'read', outcome: 'ok' }], outcome: { state: 'completed' }, externalEffects: [], errors: [], ...extra })
const recordOf = (status, extra = {}) => ({ id: 'gate:a1', automationId: 'a1', status, staticChecks: { ranAt: gIso(GATE_AT), verdict: 'pass', findings: [] }, trial: proofOf(), approval: { state: 'none', at: null }, updatedAt: gIso(GATE_AT), rev: 1, ...extra })
const TONE_OF = { done: 'ok', failed: 'bad', waiting: 'ask' }
const rows = [
  ['a failed static check', recordOf('static-failed', { staticChecks: { ranAt: gIso(GATE_AT), verdict: 'fail', findings: [{ code: 'schedule.too-frequent', severity: 'blocker', message: 'The schedule runs too often' }] } }), 'failed', 'gate.static.failed'],
  ['a failed trial', recordOf('trial-done', { trial: proofOf({ outcome: { state: 'failed', code: 'TRIAL_CRASH', message: 'The trial stopped early' } }) }), 'failed', 'gate.trial.failed'],
  ['a trial that reached outside', recordOf('awaiting-approval', { trial: proofOf({ sideEffectFree: false, externalEffects: ['composio:GMAIL_SEND_EMAIL'] }) }), 'failed', 'gate.trial.effects'],
  ['an approval due', recordOf('awaiting-approval'), 'waiting', 'gate.awaiting-approval'],
  ['an approval still to switch on', recordOf('approved'), 'waiting', 'gate.approved'],
  ['a passed trial', recordOf('trial-done'), 'done', 'gate.trial.passed'],
  ['a switched-on automation', recordOf('activated'), 'done', 'gate.activated']
]
for (const [label, record, kind, code] of rows) {
  const it = gateItemFor(record, GATE_AT, 'Weekly price digest')
  assert.notEqual(it, null, label)
  assert.equal(it.kind, kind, label)
  assert.equal(it.code, code, label)
  assert.equal(it.tone, TONE_OF[kind], label)
  assert.equal(it.todo, kind !== 'done', label)
  assert.equal(it.source, 'gate', label)
  assert.equal(it.id, 'g:a1', label)
  assert.equal(it.taskId, 'a1', label)
  assert.equal(it.task, 'Weekly price digest', label)
  assert.equal(it.unread, true, label)
  assert.equal(it.bannered, false, label)
}
ok('the seven rows of the gate table map to the three existing kinds, with their tone and their code')
assert.equal(gateItemFor(recordOf('static-failed', { staticChecks: { ranAt: gIso(GATE_AT), verdict: 'fail', findings: [{ code: 'c', severity: 'blocker', message: 'The schedule runs too often' }] } }), GATE_AT, 'x').message, 'The schedule runs too often')
assert.equal(gateItemFor(recordOf('trial-done', { trial: proofOf({ sideEffectFree: false, externalEffects: ['composio:GMAIL_SEND_EMAIL'] }) }), GATE_AT, 'x').message.includes('composio:GMAIL_SEND_EMAIL'), true)
assert.match(gateItemFor(recordOf('trial-done'), GATE_AT, 'x').message, /no external effect/i)
assert.match(gateItemFor(recordOf('trial-done'), GATE_AT, 'x').message, /\b1 calls\b/)
ok('a static failure names the first blocker, an unsafe proof names the effect, a passed trial says so and counts its calls')
for (const status of ['draft', 'static-passed', 'refused', 'a-status-we-do-not-know']) assert.equal(gateItemFor(recordOf(status), GATE_AT, 'x'), null, status)
assert.equal(gateItemFor(recordOf('awaiting-approval', { automationId: '' }), GATE_AT, 'x'), null)
assert.equal(gateItemFor(recordOf('awaiting-approval', { updatedAt: 'not a date' }), GATE_AT, 'x'), null)
assert.equal(gateItemFor(recordOf('awaiting-approval', { updatedAt: gIso(GATE_AT + 3600000) }), GATE_AT, 'x').at, GATE_AT)
assert.equal(gateItemFor(recordOf('awaiting-approval'), GATE_AT, '').task, 'Automation')
assert.equal(gateItemFor(null, GATE_AT, 'x'), null)
ok('a working state, an unknown status, no automationId or no time make no item; a future time is clamped; an unknown name is "Automation"')
const loud = gateItemFor(recordOf('static-failed', { staticChecks: { ranAt: gIso(GATE_AT), verdict: 'fail', findings: [{ code: 'c', severity: 'blocker', message: 'x'.repeat(2000) }] } }), GATE_AT, 'x')
assert.equal(loud.message.length <= 200, true)
ok('a 2000-character finding comes out bounded')
assert.deepEqual(gateSignal(recordOf('activated')), { kind: 'done', code: 'gate.activated', message: 'Switched on' })
assert.equal(gateSignal(recordOf('draft')), null)
assert.deepEqual(SOURCES, ['scheduler', 'gate', 'queue'])
ok('the signal of a record is pure and the three feed names are the only ones')

console.log('queue entries')
const entryOf = (extra = {}) => ({ id: 'i_demo1', title: 'Prepare a weekly price digest', evidence: { n: 3, span: '7 days', where: 'chat' }, risk: 'low', reversibility: 'easy', nextAction: { kind: 'draft', summary: 'A draft message, ready to review' }, status: 'proposed', at: gIso(GATE_AT), ...extra })
const proposed = queueItemFor(entryOf(), GATE_AT)
assert.equal(proposed.kind, 'waiting'); assert.equal(proposed.source, 'queue'); assert.equal(proposed.task, 'Prepare a weekly price digest'); assert.equal(proposed.taskId, 'i_demo1'); assert.equal(proposed.id, 'q:i_demo1'); assert.equal(proposed.code, 'queue.draft'); assert.equal(proposed.todo, true)
assert.match(proposed.message, /A draft message, ready to review/)
assert.match(proposed.message, /risk: low/)
assert.match(proposed.message, /undo: easy/)
ok('a proposal is a to-do titled by its entry, with the draft and what it costs to undo')
assert.equal(queueItemFor(entryOf({ status: 'asked' }), GATE_AT).kind, 'waiting')
assert.equal(queueItemFor(entryOf({ status: 'added' }), GATE_AT), null)
assert.equal(queueItemFor(entryOf({ status: 'dropped' }), GATE_AT), null)
assert.equal(queueItemFor(entryOf({ id: '' }), GATE_AT), null)
assert.equal(queueItemFor(entryOf({ at: 'never' }), GATE_AT), null)
ok('an asked entry waits too; added and dropped are no news; no id or no time makes no item')
const mailed = queueItemFor(entryOf({ title: 'Write to someone@example.com about it' }), GATE_AT)
assert.equal(/example\.com/.test(mailed.task), false)
assert.match(mailed.task, /\[mail\]/)
assert.equal(scrubText('ab '.repeat(100), 20).length, 20)
assert.equal(scrubText('a'.repeat(400), 50), '[token]')
ok('an address in a title is blanked before the card sees it, a long token too, and a long text is bounded')
assert.equal(queueItemFor(entryOf({ nextAction: { kind: 'send', summary: 'Sends the mail' } }), GATE_AT).kind, 'waiting')
ok('a next action that is not a draft still makes the card: the queue refuses it, not Pulse')

console.log('the muting rule')
const mutedSettings = { ...defaults(), muted: ['Weekly price digest'] }
const gateAsk = gateItemFor(recordOf('awaiting-approval'), GATE_AT, 'Weekly price digest')
const gateBad = gateItemFor(recordOf('trial-done', { trial: proofOf({ sideEffectFree: false, externalEffects: ['x'] }) }), GATE_AT, 'Weekly price digest')
const gateOk = gateItemFor(recordOf('trial-done'), GATE_AT, 'Weekly price digest')
assert.equal(isQuiet(gateAsk, mutedSettings), false)
assert.equal(isQuiet(gateBad, mutedSettings), false)
assert.equal(isQuiet(gateOk, mutedSettings), true)
assert.equal(wantsBanner(gateAsk, mutedSettings), true)
assert.equal(wantsBanner(gateOk, mutedSettings), false)
assert.equal(unreadCount([gateAsk, gateOk], mutedSettings), 1)
assert.deepEqual(bannersDue([gateAsk], mutedSettings).map((x) => x.id), ['g:a1'])
ok('a quiet automation keeps a passed trial silent, while an ask and a failure are never quiet')

console.log('the proactive pass')
const noRun = async () => null
const firstPass = await watchStep({ tasks: [], state: { baselined: false, seen: {}, inbox: [] }, readRunOf: noRun, now: GATE_AT, gates: [recordOf('activated'), recordOf('awaiting-approval', { automationId: 'a2' })] })
assert.equal(firstPass.added.length, 1)
assert.equal(firstPass.added[0].id, 'g:a2')
assert.equal(firstPass.added[0].bannered, true)
assert.deepEqual(Object.keys(firstPass.state.gates).sort(), ['a1', 'a2'])
assert.equal(firstPass.state.gates.a1.sig, 'done|gate.activated')
assert.equal(firstPass.state.gates.a2.sig, 'waiting|gate.awaiting-approval')
const secondPass = await watchStep({ tasks: [], state: firstPass.state, readRunOf: noRun, now: GATE_AT + 15000, gates: [recordOf('activated'), recordOf('awaiting-approval', { automationId: 'a2' })] })
assert.equal(secondPass.added.length, 0)
assert.equal(secondPass.state.inbox.length, 1)
ok('the first pass only remembers a result and shows the ask without a banner; the second pass adds nothing')
const moved = await watchStep({ tasks: [], state: secondPass.state, readRunOf: noRun, now: GATE_AT + 30000, gates: [recordOf('activated'), recordOf('approved', { automationId: 'a2', rev: 2 })] })
assert.equal(moved.state.inbox.filter((x) => x.id === 'g:a2').length, 1)
assert.equal(moved.state.inbox.find((x) => x.id === 'g:a2').code, 'gate.approved')
assert.equal(moved.removed.length, 0)
ok('awaiting-approval to approved keeps one card and follows the code')
const unsafe = await watchStep({ tasks: [], state: moved.state, readRunOf: noRun, now: GATE_AT + 45000, gates: [recordOf('draft'), recordOf('trial-done', { automationId: 'a2', rev: 3, trial: proofOf({ sideEffectFree: false, externalEffects: ['composio:GMAIL_SEND_EMAIL'] }) })] })
assert.equal(unsafe.state.inbox.filter((x) => x.id === 'g:a2').length, 1)
assert.equal(unsafe.state.inbox.find((x) => x.id === 'g:a2').kind, 'failed')
assert.equal(unsafe.state.gates.a1, undefined)
ok('an unsafe trial replaces the ask of the same automation (one card), and a record back to draft is forgotten')
const gone = await watchStep({ tasks: [], state: unsafe.state, readRunOf: noRun, now: GATE_AT + 50000, gates: [recordOf('draft', { automationId: 'a2' })] })
assert.equal(gone.state.inbox.filter((x) => x.id === 'g:a2').length, 0)
assert.deepEqual(gone.removed, ['g:a2'])
ok('a gate record that stops producing a signal takes its card away and says so')
const queued = await watchStep({ tasks: [], state: unsafe.state, readRunOf: noRun, now: GATE_AT + 60000, entries: [entryOf()] })
assert.equal(queued.added.length, 1); assert.equal(queued.added[0].id, 'q:i_demo1'); assert.equal(queued.added[0].bannered, false)
const stillQueued = await watchStep({ tasks: [], state: queued.state, readRunOf: noRun, now: GATE_AT + 75000, entries: [entryOf()] })
assert.equal(stillQueued.added.length, 0)
const dropped = await watchStep({ tasks: [], state: stillQueued.state, readRunOf: noRun, now: GATE_AT + 90000, entries: [entryOf({ status: 'dropped' })] })
assert.equal(dropped.state.inbox.filter((x) => x.id === 'q:i_demo1').length, 0)
assert.deepEqual(dropped.removed, ['q:i_demo1'])
ok('a proposal appears once, an unchanged one adds nothing, a dropped one takes its card away')
const back = proactiveStep({ state: { baselined: true, seen: {}, gates: {}, queue: { i_demo1: { sig: 'waiting|queue.draft', at: GATE_AT } }, inbox: [proposed] }, entries: [entryOf()], now: GATE_AT + 1000 })
assert.equal(back.added.length, 0)
assert.equal(back.state.inbox.length, 1)
ok('an entry bouncing back to the same signal is not announced twice')
const manyAsks = Array.from({ length: 200 }, (_, i) => recordOf('awaiting-approval', { automationId: 'm' + i }))
let stream = { baselined: true, seen: {}, gates: {}, queue: {}, inbox: [] }
for (let round = 0; round < 4; round += 1) {
  const pass = await watchStep({ tasks: [], state: stream, readRunOf: noRun, now: GATE_AT + round * 15000, gates: manyAsks })
  assert.equal(pass.added.length <= GATE_ITEMS_PER_PASS, true, 'a pass emits at most ' + GATE_ITEMS_PER_PASS + ' gate items')
  stream = pass.state
}
assert.equal(stream.inbox.length <= INBOX_MAX, true)
assert.equal(Object.keys(stream.gates).length <= SEEN_MAX, true)
ok('a pass turns at most ' + GATE_ITEMS_PER_PASS + ' records into items, the inbox stays bounded and the memory stays under ' + SEEN_MAX)
let crowd = { baselined: true, seen: {}, gates: {}, queue: {}, inbox: [] }
for (let round = 0; round < 10; round += 1) {
  const ids = Array.from({ length: 400 }, (_, i) => recordOf('awaiting-approval', { automationId: 's' + i }))
  const pass = await watchStep({ tasks: [], state: crowd, readRunOf: noRun, now: GATE_AT + round * 15000, gates: ids })
  crowd = pass.state
}
const remembered = Object.keys(crowd.seen).length + Object.keys(crowd.gates).length + Object.keys(crowd.queue).length
assert.equal(remembered <= SEEN_MAX, true)
ok('four hundred ids are remembered under one budget of ' + SEEN_MAX)
const noFeeds = await watchStep({ tasks: [], state: { baselined: false, seen: {}, inbox: [] }, readRunOf: noRun, now: GATE_AT })
assert.equal(noFeeds.added.length, 0)
assert.deepEqual(noFeeds.state.gates, {})
assert.deepEqual(noFeeds.state.queue, {})
assert.deepEqual(noFeeds.removed, [])
ok('a home with neither file behaves exactly as before this batch')

// The old four-key call: its return is compared as a PROJECTION, so the fixture carries no `removed` (a fixture
// written after the batch would only pass after it, which is the opposite of a regression check).
const FIX_NOW = Date.parse('2026-10-26T10:00:00Z')
const FIX_TASKS = [{ id: 't1', name: 'Digest', history: [{ at: new Date(FIX_NOW - 60000).toISOString(), sessionId: 'fix-run', status: 'fired' }] }]
const fixRun = async () => ({ phase: 'done', calls: 2, startedAt: FIX_NOW - 50000, endedAt: FIX_NOW - 10000 })
const fixed = await watchStep({ tasks: FIX_TASKS, state: { baselined: true, seen: {}, inbox: [] }, readRunOf: fixRun, now: FIX_NOW + 20000 })
const FIX_ITEM = { id: 'r:fix-run', kind: 'done', tone: 'ok', todo: false, task: 'Digest', taskId: 't1', sessionId: 'fix-run', at: FIX_NOW - 10000, unread: true, bannered: false, source: 'scheduler', calls: 2, durMs: 40000 }
const FIXTURE = { state: { baselined: true, seen: { 'fix-run': { phase: 'done', at: FIX_NOW + 20000 } }, gates: {}, queue: {}, inbox: [FIX_ITEM] }, running: [], added: [FIX_ITEM] }
const project = ({ state, running, added }) => ({ state, running, added })
assert.deepEqual(project(fixed), FIXTURE)
assert.deepEqual(Object.keys(fixed).sort(), ['added', 'removed', 'running', 'state'])
ok('the old four-key call returns exactly what it always did, plus one additive key')

console.log('the inbox door')
const door = [gateItemFor(recordOf('awaiting-approval'), GATE_AT, 'Weekly price digest')]
assert.equal(inboxAction(door, { action: 'approve', id: door[0].id }), null)
assert.equal(inboxAction(door, { action: 'activate', id: door[0].id }), null)
assert.equal(inboxAction(door, { action: 'trial-start', id: door[0].id }), null)
assert.deepEqual(inboxAction(door, { action: 'read', id: door[0].id }).map((x) => x.unread), [false])
assert.equal(inboxAction(door, { action: 'read-all' })[0].unread, false)
assert.equal(inboxAction(door, { action: 'dismiss', id: door[0].id }).length, 0)
assert.equal(inboxAction(door, { action: 'banner-shown', id: door[0].id })[0].bannered, true)
ok('the inbox reads, dismisses and marks banners, and refuses approve, activate and trial-start')
assert.equal(cleanItem({ id: 'r:1', kind: 'done', source: 'gate' }).source, 'gate')
assert.equal(cleanItem({ id: 'r:1', kind: 'done' }).source, 'scheduler')
assert.equal(cleanItem({ id: 'r:1', kind: 'done', source: 'invented' }).source, 'scheduler')
ok('an item keeps its feed, and an unknown or absent one reads as the scheduler')
const oldState = normalizeState({ baselined: true, seen: {}, inbox: [] })
assert.deepEqual(oldState.gates, {})
assert.deepEqual(oldState.queue, {})
const messy = normalizeState({
  gates: { a1: { sig: 'failed|gate.static.failed', at: 5 }, '../x': { sig: 'done|gate.activated', at: 5 }, a2: { sig: '', at: 5 }, a3: { sig: 'done|gate.activated', at: 'soon' }, a4: 'nope' },
  queue: { i1: { sig: 'waiting|queue.draft', at: 7 } }
})
assert.deepEqual(Object.keys(messy.gates), ['a1'])
assert.deepEqual(Object.keys(messy.queue), ['i1'])
const huge = { gates: {} }
for (let i = 0; i < 500; i += 1) huge.gates['k' + i] = { sig: 'done|gate.activated', at: i }
assert.equal(Object.keys(normalizeState(huge).gates).length, SEEN_MAX)
ok('the gate and the queue maps are cleaned and bounded, and a file written before them loads as two empty maps')
assert.equal(taskNames([{ id: 'a1', name: 'Weekly price digest' }, null, { id: '', name: 'x' }, { id: 'a2' }]).a1, 'Weekly price digest')
assert.equal(taskNames([{ id: 'a2' }]).a2, 'Automation')
ok('the display names come from the tasks the pass already reads, and no extra read is made')
assert.equal(QUEUE_ITEMS_PER_PASS, 8)

console.log('\n' + pass + ' checks passed')
