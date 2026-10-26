// kybernos-pulse — the pure rules: settings, the reading of a journal, the watcher's pass, the banners.
//   node packages/kybernos-pulse/test-core.mjs
import assert from 'node:assert/strict'
import {
  HORIZON_MS, INBOX_MAX, LEVELS, MUTED_MAX, READS_PER_PASS, applySettings, bannersDue, candidates, cleanItem, defaults, inboxAction, inboxPut,
  isQuiet, normalizeSettings, normalizeState, publicView, readRun, unreadCount, wantsBanner, watchStep
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

console.log('\n' + pass + ' checks passed')
