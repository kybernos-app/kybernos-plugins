#!/usr/bin/env node
/** The tab « Where it runs » of an automation (client.js): its pure rules, its words, and the order of what it does (never two copies of an automation running).
 *  Usage: node packages/kybernos-plugin/test-where-it-runs.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const cli = readFileSync(join(here, 'client.js'), 'utf8')

// 1. the pure rules, run as they are in the page
const from = cli.indexOf('// <kbwr-core>')
const to = cli.indexOf('// </kbwr-core>')
assert.ok(from > 0 && to > from, 'the rules are where the test looks for them')
const mod = await import('data:text/javascript,' + encodeURIComponent(cli.slice(from, to) + '\nexport { kbwDirty, kbwCount, kbwBlock, kbwPhase, kbwDefaultPick, kbwDefinition, kbwLinkedIds, kbwRunsFor, kbwRunLast, kbwRunBad, kbwRunningNow, kbwSpan, kbwHistoryOf, kbwCanAsk, kbwPending, kbwAnswered }'))
const HOME = '3f2a1c10-0000-4000-8000-000000000001'
const PROS = '3f2a1c10-0000-4000-8000-000000000002'
const linkedTask = (o) => ({ id: 'st-1', name: 'Collecteur', prompt: 'Collect', schedule: { mode: 'cron', cron: '0 3 * * *', tz: 'UTC' }, approvals: 'auto', active: false, updatedAt: '2026-10-23T10:00:00.000Z', cloud: { computerId: HOME, name: 'Home', at: '2026-10-23T10:00:00.000Z', wasActive: true }, ...(o || {}) })

assert.equal(mod.kbwDirty(linkedTask()), false, 'the link and the task share a moment: nothing is edited')
assert.equal(mod.kbwDirty(linkedTask({ updatedAt: '2026-10-23T10:00:00.900Z' })), false, 'under a second of slack')
assert.equal(mod.kbwDirty(linkedTask({ updatedAt: '2026-10-23T10:05:00.000Z' })), true, 'edited after it was sent')
for (const odd of [null, undefined, {}, { id: 'x', updatedAt: 'now' }, linkedTask({ updatedAt: 'never' }), linkedTask({ cloud: { at: 'never' } }), linkedTask({ cloud: null })]) assert.equal(mod.kbwDirty(odd), false, JSON.stringify(odd))
assert.equal(mod.kbwCount([linkedTask(), linkedTask({ id: 'st-2' }), linkedTask({ id: 'st-3', cloud: { computerId: PROS, name: 'P', at: 'x' } }), { id: 'st-4' }, null, 'x'], HOME), 2)
assert.equal(mod.kbwCount(null, HOME), 0)
const computers = [{ id: PROS, name: 'Prospection', isHome: false, state: 'asleep' }, { id: HOME, name: 'Home', isHome: true, state: 'awake' }]
const canAsk = (c) => ({ ...c, capabilities: ['ask_approvals'] })
assert.equal(mod.kbwBlock(linkedTask({ approvals: 'auto' }), computers, true), null)
assert.equal(mod.kbwBlock(linkedTask({ approvals: 'ask' }), computers, true), 'old', 'an automation that asks first cannot go to computers that cannot ask (an image from before)')
assert.equal(mod.kbwBlock(linkedTask({ approvals: undefined }), computers, true), 'old', 'anything that is not auto asks first')
assert.equal(mod.kbwBlock(linkedTask({ approvals: 'ask' }), [computers[0], canAsk(computers[1])], true), null, 'one computer that can ask is enough')
assert.equal(mod.kbwBlock(linkedTask({ approvals: 'ask' }), [{ ...computers[0], capabilities: ['something_else'] }], true), 'old')
assert.equal(mod.kbwBlock(linkedTask({ schedule: { mode: 'webhook', tz: 'UTC' } }), computers, true), 'webhook', 'a webhook automation cannot go to a cloud computer: it has no door for webhooks yet, so it would be paused here and never start there')
assert.equal(mod.kbwBlock(linkedTask({ schedule: { mode: 'webhook', tz: 'UTC' } }), [], false), 'webhook', 'and that is said first, not after « connect » and « create a computer »')
assert.equal(mod.kbwBlock(linkedTask({ schedule: { mode: 'cron', cron: '0 3 * * *', tz: 'UTC' } }), computers, true), null, 'a scheduled automation is not affected')
assert.equal(mod.kbwBlock(linkedTask(), computers, false), 'off')
assert.equal(mod.kbwBlock(linkedTask(), [], true), 'none')
assert.equal(mod.kbwBlock(linkedTask({ approvals: 'ask' }), [], false), 'off', 'not connected is said first, then no computer, then a computer that must be updated')
assert.deepEqual([mod.kbwCanAsk(canAsk(computers[0])), mod.kbwCanAsk(computers[0]), mod.kbwCanAsk(null), mod.kbwCanAsk({ capabilities: 'ask_approvals' })], [true, false, false, false])
for (const odd of [null, undefined, 'x']) assert.equal(mod.kbwBlock(odd, computers, true), 'none')
assert.equal(mod.kbwPhase(null, true), 'sending')
assert.equal(mod.kbwPhase(null, false), 'pending', 'not listed yet: waiting for the computer')
assert.equal(mod.kbwPhase({ state: 'pending', schedule: null }, false), 'pending')
assert.equal(mod.kbwPhase({ state: 'error', code: 'too_frequent', schedule: null }, false), 'error')
assert.equal(mod.kbwPhase({ state: 'applied', schedule: null }, false), 'checking', 'applied, but the computer has not reported its schedule yet')
assert.equal(mod.kbwPhase({ state: 'applied', schedule: { enabled: true } }, false), 'running')
assert.equal(mod.kbwPhase({ state: 'applied', schedule: { enabled: true } }, true), 'sending', 'while the page is sending, it is sending')
assert.equal(mod.kbwDefaultPick(computers), HOME, 'Home first')
assert.equal(mod.kbwDefaultPick(computers, true), null, 'for an automation that asks first, among the computers that can ask: none here')
assert.equal(mod.kbwDefaultPick([computers[0], canAsk(computers[1])], true), HOME)
assert.equal(mod.kbwDefaultPick([canAsk(computers[0]), computers[1]], true), PROS, 'Home cannot ask, so the one that can')
assert.equal(mod.kbwDefaultPick([{ id: PROS, isHome: false }]), PROS)
assert.equal(mod.kbwDefaultPick([]), null)
assert.equal(mod.kbwDefaultPick(null), null)
assert.deepEqual(mod.kbwDefinition(linkedTask({ workspaceHint: 'ws', homeSessionId: 's', notify: ['email'], needs: ['gmail'], id: 'st-1' }), true), { name: 'Collecteur', prompt: 'Collect', schedule: { mode: 'cron', cron: '0 3 * * *', tz: 'UTC' }, active: true, approvals: 'auto', needs: ['gmail'] }, 'six fields, and active is what it was before it was linked')
assert.equal(mod.kbwDefinition(linkedTask(), false).active, false)
assert.equal('needs' in mod.kbwDefinition(linkedTask({ needs: [] }), true), false)
// the runs a computer reported
const runOf = (o) => Object.assign({ key: 'r1', ref: 'st-1', via: 'cron', outcome: 'completed', reason: null, startedAt: '2026-10-23T03:00:00.000Z', endedAt: '2026-10-23T03:04:10.000Z' }, o)
assert.equal(mod.kbwLinkedIds([linkedTask(), linkedTask({ id: 'st-2' }), linkedTask({ id: 'st-3', cloud: { computerId: PROS, name: 'P', at: 'x' } }), { id: 'st-4' }, null, 'x', linkedTask({ id: 'st-5', cloud: { computerId: '', name: 'P', at: 'x' } })]), [HOME, PROS].sort().join(','), 'each computer once, sorted: a stable key')
for (const none of [null, undefined, [], 'x', [{ id: 'a' }]]) assert.equal(mod.kbwLinkedIds(none), '')
const runs = [runOf({ key: 'old', endedAt: '2026-10-22T03:04:10.000Z' }), runOf({ key: 'new', endedAt: '2026-10-23T03:04:10.000Z' }), runOf({ key: 'other', ref: 'st-2' }), runOf({ key: 'odd', endedAt: 'never' }), null, 'x']
assert.deepEqual(mod.kbwRunsFor(runs, 'st-1').map((r) => r.key), ['new', 'old'], 'one automation\'s runs, newest first whatever the order they came in')
assert.equal(mod.kbwRunLast(runs, 'st-1').key, 'new')
assert.equal(mod.kbwRunLast(runs, 'st-9'), null)
assert.equal(mod.kbwRunLast(null, 'st-1'), null)
assert.deepEqual(mod.kbwRunsFor('x', 'st-1'), [])
for (const [outcome, bad] of [['completed', false], ['waiting_approval', false], ['error', true], ['timeout', true], ['capped', true]]) assert.equal(mod.kbwRunBad(runOf({ outcome })), bad, outcome)
for (const odd of [null, undefined, 'x', {}]) assert.equal(mod.kbwRunBad(odd), false)
const awake = { id: HOME, load: { runningTasks: [{ taskRef: 'st-1', startedAt: '2026-10-23T03:00:00.000Z' }, { taskRef: 'st-2', startedAt: 'never' }] } }
assert.equal(mod.kbwRunningNow(awake, 'st-1').taskRef, 'st-1', 'the beat says it is running now')
assert.equal(mod.kbwRunningNow(awake, 'st-2'), null, 'a start that is not a time is not a run')
assert.equal(mod.kbwRunningNow(awake, 'st-3'), null)
for (const none of [null, undefined, {}, { load: null }, { load: {} }, { load: { runningTasks: 'x' } }]) assert.equal(mod.kbwRunningNow(none, 'st-1'), null)
for (const [sec, want] of [[0, '0 s'], [45, '45 s'], [59.6, '1 min'], [60, '1 min'], [70, '1 min 10 s'], [240, '4 min'], [605, '10 min'], [3600, '1 h'], [3900, '1 h 05 min'], [7260, '2 h 01 min'], [-5, '0 s'], [NaN, '0 s'], [undefined, '0 s']]) assert.equal(mod.kbwSpan(sec), want, String(sec))
assert.deepEqual(mod.kbwHistoryOf([runOf({ key: 'a', endedAt: '2026-10-22T03:00:00.000Z', outcome: 'error' }), runOf({ key: 'b', endedAt: '2026-10-23T03:00:00.000Z', via: null }), runOf({ ref: 'st-2' })], 'st-1'), [{ at: '2026-10-23T03:00:00.000Z', status: 'ok', via: '' }, { at: '2026-10-22T03:00:00.000Z', status: 'error', via: 'cron' }], 'the list reads the cloud runs as a history: newest first, a bad end is an error')
const askOf = (o) => Object.assign({ id: 'a1', ref: 'st-1', runKey: 'sess-1', kind: 'shell', summary: 'ls', state: 'pending', createdAt: '2026-10-23T10:00:00.000Z', expiresAt: '2026-10-24T10:00:00.000Z', decidedAt: null, via: null, notified: false }, o)
assert.deepEqual(mod.kbwPending([askOf({ id: 'a1' }), askOf({ id: 'a2', createdAt: '2026-10-23T11:00:00.000Z' }), askOf({ id: 'a3', state: 'allowed' }), askOf({ id: 'a4', ref: 'st-2' }), null, 'x'], 'st-1').map((a) => a.id), ['a2', 'a1'], 'what waits for this automation, newest first')
assert.deepEqual(mod.kbwPending(null, 'st-1'), [])
const done = [askOf({ id: 'b1', state: 'allowed', decidedAt: '2026-10-23T12:00:00.000Z' }), askOf({ id: 'b2', state: 'denied', decidedAt: '2026-10-23T13:00:00.000Z' }), askOf({ id: 'b3', state: 'expired', decidedAt: null, expiresAt: '2026-10-23T14:00:00.000Z' }), askOf({ id: 'b4' }), askOf({ id: 'b5', ref: 'st-2', state: 'denied' })]
assert.deepEqual(mod.kbwAnswered(done, 'st-1').map((a) => a.id), ['b3', 'b2', 'b1'], 'answered or ran out, newest first, the pending ones and other automations\' left out')
assert.equal(mod.kbwAnswered(Array.from({ length: 9 }, (_, i) => askOf({ id: 'c' + i, state: 'denied', decidedAt: '2026-10-23T1' + i + ':00:00.000Z' })), 'st-1').length, 5)
assert.deepEqual(mod.kbwAnswered('x', 'st-1'), [])
ok('rules: dirty, count, why it cannot go, the phase of what was sent, the default computer, the six fields, the runs that came back')

// 2. the words: both languages, no key defined twice anywhere, every key used is defined
const keys = Array.from(cli.matchAll(/^      '([A-Za-z0-9_.\-]+)': \{ kybernos: '((?:[^'\\]|\\.)*)', en: '((?:[^'\\]|\\.)*)' \},?$/gm)).map((m) => m[1])
const seen = new Map()
for (const k of keys) seen.set(k, (seen.get(k) || 0) + 1)
assert.deepEqual(Array.from(seen).filter(([, n]) => n > 1).map(([k]) => k), [], 'a key defined twice: the later one wins and hides the earlier (this is how « kbw.back » hid a button label)')
const mine = Array.from(seen.keys()).filter((k) => k.indexOf('kbwr.') === 0)
assert.ok(mine.length >= 55, 'my keys: ' + mine.length)
const used = new Set(Array.from(cli.matchAll(/'(kbwr\.[A-Za-z0-9_.]+)'/g)).map((m) => m[1]).filter((k) => !k.endsWith('.')))
for (const k of used) assert.ok(seen.has(k), 'used but not defined: ' + k)
for (const code of ['approval_path_missing', 'run_hours_exhausted', 'owner_left', 'budget', 'failed_runs', 'owner_locked', 'computer_deleting', 'too_many_pending', 'rate_limited', 'tasks_unavailable', 'not_allowed', 'no_computer', 'unreachable', 'not_connected', 'invalid_definition', 'too_frequent', 'never_runs', 'expired', 'late', 'unknown']) assert.ok(seen.has('kbwr.err.' + code), 'a refusal with no words: ' + code)
for (const reason of ['old', 'none', 'off', 'webhook']) assert.ok(seen.has('kbwr.block.' + reason), reason)
assert.equal(seen.has('kbwr.block.ask'), false, 'no automation is refused for asking any more: only for a computer that cannot')
for (const k of ['shell', 'write', 'edit', 'connector', 'other']) assert.ok(seen.has('kbwr.ap.kind.' + k), 'kind ' + k)
for (const k of ['allowed', 'allowed_turn', 'denied', 'expired']) assert.ok(seen.has('kbwr.ap.st.' + k), 'state ' + k)
for (const k of ['completed', 'error', 'capped', 'timeout', 'waiting_approval']) assert.ok(seen.has('kbwr.runs.out.' + k), 'outcome ' + k)
for (const k of ['cron', 'once', 'webhook', 'run_now']) assert.ok(seen.has('kbwr.runs.via.' + k), 'via ' + k)
assert.ok(/'tasks\.tab\.where': \{ kybernos: 'Où ça tourne', en: 'Where it runs' \}/.test(cli))
ok('words: both languages, nothing defined twice, every key used is defined, every refusal has words')

// 3. the order of what the tab does: never two copies of an automation running
const comp = cli.slice(cli.indexOf('const KbWhereTab = '), cli.indexOf('// What a row of the List says about a run'))
const body = (name) => { const i = comp.indexOf('const ' + name + ' = async'); assert.ok(i > 0, name); return comp.slice(i, comp.indexOf('\n  }\n', i)) }
const before = (src, a, b, label) => { const x = src.indexOf(a); const y = src.indexOf(b); assert.ok(x > 0 && y > 0 && x < y, label) }
const publish = body('publish')
before(publish, "props.link({ computerId: to.id", "kbwPost(to.id, [{ op: 'put'", 'publish: the copy here is paused BEFORE the definition is sent')
assert.ok(/if \(r\.ok !== true\) \{ await props\.link\(null\); fail\(r\.error\) \}/.test(publish), 'publish: a refusal brings the copy here back')
const back = body('back')
before(back, "kbwPost(linked.computerId, [{ op: 'delete'", 'await props.link(null)', 'back: taken away from the computer BEFORE the copy here comes back')
assert.ok(/if \(d\.ok !== true && d\.error !== 'no_computer'\) \{ fail\(d\.error\); return finish\(\) \}/.test(back), 'back: if it cannot be taken away, nothing changes')
const move = body('move')
before(move, "kbwPost(to.id, [{ op: 'put'", 'await props.link({ computerId: to.id', 'move: put on the new one, then link')
before(move, 'await props.link({ computerId: to.id', "kbwPost(from.computerId, [{ op: 'delete'", 'move: the old copy is removed last')
assert.ok(/if \(r\.ok !== true\) \{ fail\(r\.error\); return finish\(\) \}/.test(move), 'move: if the new one refuses, the old one stays')
const update = body('update')
before(update, "kbwPost(linked.computerId, [{ op: 'put'", 'props.link({ computerId: linked.computerId', 'update: send, then date the link')
ok('order: pause before sending, take away before bringing back, put on the new before removing from the old')

// 4. the tab is on the page
assert.ok(/h\(KbWhereTab, \{ key: t\.id, task: t, computers: computersPair\[0\]\.list, connected: computersPair\[0\]\.connected === true, tasks: tasks,/.test(cli), 'the tab gets the computers and the tasks')
assert.ok(/action: 'cloud-link', id: t\.id, cloud/.test(cli), 'the link goes through the task store')
assert.ok(/'data-kb': 'tab-where', onClick: \(\) => setTab\('where'\) \}, kbt\('tasks\.tab\.where'\)/.test(cli), 'a tab next to Workflow and Sessions')
assert.ok(/kbt\('kbwr\.runson'\)\.replace\('\{name\}', \(\) => String\(t\.cloud\.name\)\)/.test(cli), 'the header says where it runs')
assert.ok(/fetch\('\/kybernos-cloud\/computers\/publish', \{ method: 'POST', credentials: 'same-origin'/.test(cli), 'publishing goes through the cloud plugin, with the browser session')
assert.ok(!/className: '[^']*\bkbw-/.test(comp) && !/'kbw\.[a-z]/.test(comp), 'the tab uses no class and no string key under the name another page already uses (kbw)')
assert.ok(/\.kbwr-seg\{/.test(cli) && /\.kbwr-opt\{/.test(cli), 'its styles are under kbwr-')
assert.ok(/else if \(cloudLinked === true\) \{ lastLabel = kbt\(cloudWait === true \? 'kbwr\.row\.cloudWait' : kbwDirty\(t\) === true \? 'kbwr\.row\.cloudDirty' : cloudBad === true \? 'kbwr\.row\.cloudFailed' : 'kbwr\.row\.cloud'\)\.replace\('\{name\}', \(\) => String\(t\.cloud\.name\)\); lastCls = cloudWait === true \|\| kbwDirty\(t\) === true \? 'cloudwarn' : cloudBad === true \? 'fail' : 'cloud' \}\s+else if \(t\.active === false\) \{ lastLabel = kbt\('tasks\.paused'\)/.test(cli), 'in the list, an automation that lives in the cloud is not « Paused »: it says that it waits for your OK, that it was changed since, that its last run failed, or where it is')
assert.ok(/'data-kb': 'row-cloud'/.test(cli) && /kbt\('kbwr\.row\.sub'\)/.test(cli), 'the list marks it with a cloud and « Cloud · Home » under the name')
ok('page: a tab, the computers and tasks handed over, the link through the task store, the header, the session on the write')

// 5. the runs are on the page
assert.ok(/fetch\('\/kybernos-cloud\/computers\/runs\?computerId=' \+ encodeURIComponent\(computerId\) \+ '&ref=' \+ encodeURIComponent\(t\.id\)/.test(cli), 'the tab asks for the runs of one automation')
assert.ok(/fetch\('\/kybernos-cloud\/computers\/runs\?computerId=' \+ encodeURIComponent\(id\), \{ cache: 'no-store'/.test(cli), 'the page asks once per computer for the list and the count')
assert.ok(/h\(KbCloudSessions, \{ key: t\.id, task: t, computers: computersPair\[0\]\.list, localCount: kbRunsOf\(t\.history\)\.length, local: localPane \}\)\s+: localPane/.test(cli), 'the tab Sessions of a linked automation shows the cloud runs, and the sessions from here when it ran here before')
assert.ok(/kbwRunsFor\(cloudRunsPair\[0\]\[t\.cloud\.computerId\], t\.id\)\.length : kbRunsOf\(t\.history\)\.length/.test(cli), 'the tab counts the runs it shows')
assert.ok(/sessions: cloudHist !== null \? cloudHist\.length : hist\.length, succ: kbRunBars\(cloudHist !== null \? cloudHist : t\.history\)/.test(cli), 'the list counts and draws the cloud runs for an automation that runs there, not the sessions from before it was sent')
const cloudRuns = cli.slice(cli.indexOf('const KbCloudRuns = '), cli.indexOf('const KbCloudSessions = '))
assert.ok(cloudRuns.indexOf('prompt') < 0 && cloudRuns.indexOf('result') < 0, 'the runs pane knows no prompt and no result: only the time and how it ended')
assert.ok(/\.kbwr-run\{/.test(cli) && /\.kbwr-rout\.err\{/.test(cli), 'its styles are under kbwr-')
assert.ok(/fetch\('\/kybernos-cloud\/computers\/approvals\?computerId=' \+ encodeURIComponent\(computerId\), \{ cache: 'no-store'/.test(cli) && /fetch\('\/kybernos-cloud\/computers\/approvals\?computerId=' \+ encodeURIComponent\(id\), \{ cache: 'no-store'/.test(cli), 'the pane and the page ask what waits to be allowed')
assert.ok(/fetch\('\/kybernos-cloud\/computers\/approvals\/decide', \{ method: 'POST', credentials: 'same-origin'/.test(cli), 'an answer goes through the cloud plugin with the browser session')
for (const d of ['allowed', 'allowed_turn', 'denied']) assert.ok(cloudRuns.indexOf("decide(a, '" + d + "')") >= 0, 'a button for ' + d)
assert.ok(cloudRuns.indexOf('always') < 0 && cloudRuns.indexOf('Always') < 0, 'no « always allow » in this round: it is a rule kept on the computer, for the next one')
assert.ok(/disabled: stale/.test(cli) && /kbwDefaultPick\(computers, needAsk\)/.test(cli), 'the picker leaves out a computer that cannot ask, for an automation that asks')
ok('runs on the page: the tab, the count and the list label read what the computer reported; no prompt, no result')

console.log('\n' + pass + ' checks passed')
