#!/usr/bin/env node
/** Publishing an automation to a cloud computer, the host half (computers-publish.mjs) and its two routes (index.js).
 *  Usage: node packages/kybernos-cloud/test-computers-publish.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { definitionOf, opsOf, codeOf, statesOf, runsOf, createPublish, CODES, MAX_OPS } from './computers-publish.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const COMPUTER = '3f2a1c10-0000-4000-8000-000000000001'
const def = (o) => ({ name: 'Collecteur nocturne', prompt: 'Collect the prices', schedule: { mode: 'cron', cron: '0 3 * * *', tz: 'Europe/Paris' }, active: true, approvals: 'auto', ...(o || {}) })

// 1. a definition: six fields, an auto automation, nothing else
assert.deepEqual(definitionOf(def()), { ok: true, def: { name: 'Collecteur nocturne', prompt: 'Collect the prices', schedule: { mode: 'cron', tz: 'Europe/Paris', cron: '0 3 * * *' }, active: true, approvals: 'auto' } })
assert.deepEqual(definitionOf(def({ approvals: 'ask' })), { ok: false, error: 'approval_path_missing' }, 'an automation that asks first cannot go: it would run without asking')
assert.deepEqual(definitionOf(def({ approvals: undefined })), { ok: false, error: 'approval_path_missing' })
const rich = definitionOf(def({ workspace: 'ws-x', homeSessionId: 'sess-x', sessionMode: 'home', notify: ['email'], trigger: { secret: 'S' }, history: [{ at: 'x' }], id: 'st-1', secret: 'S', needs: ['gmail', 'Not A Slug', 'gmail', 'calendar'] }))
assert.deepEqual(Object.keys(rich.def).sort(), ['active', 'approvals', 'name', 'needs', 'prompt', 'schedule'], 'six fields, nothing else of the task goes up')
assert.deepEqual(rich.def.needs, ['gmail', 'calendar'], 'valid slugs, once each')
assert.equal(JSON.stringify(rich).includes('S"'), false)
assert.equal(definitionOf(def({ active: false })).def.active, false)
assert.equal(definitionOf(def({ active: undefined })).def.active, true, 'active unless it says otherwise, as the plugin reads it')
assert.deepEqual(definitionOf(def({ schedule: { mode: 'once', at: '2026-12-01T08:00', tz: 'UTC' } })).def.schedule, { mode: 'once', tz: 'UTC', at: '2026-12-01T08:00' })
assert.deepEqual(definitionOf(def({ schedule: { mode: 'webhook', tz: 'UTC' } })).def.schedule, { mode: 'webhook', tz: 'UTC' })
assert.equal(definitionOf(def({ name: 'x'.repeat(300) })).def.name.length, 120)
assert.equal(definitionOf(def({ prompt: 'p'.repeat(9000) })).def.prompt.length, 8000)
for (const bad of [null, undefined, 'x', [], {}, def({ name: '' }), def({ name: '  ​​ ' }), def({ name: 7 }), def({ prompt: '' }), def({ prompt: {} }), def({ schedule: null }), def({ schedule: { mode: 'weekly', tz: 'UTC' } }),
  def({ schedule: { mode: 'cron', tz: 'UTC' } }), def({ schedule: { mode: 'cron', cron: '', tz: 'UTC' } }), def({ schedule: { mode: 'cron', cron: '0 3 * * *' } }), def({ schedule: { mode: 'once', tz: 'UTC' } })]) {
  const d = definitionOf(bad)
  assert.equal(d.ok, false, JSON.stringify(bad))
  assert.ok(['invalid_definition', 'approval_path_missing'].indexOf(d.error) >= 0, JSON.stringify(bad))
}
ok('definition: six fields from a closed list, auto only, bounded, no secret or session of the task goes up')

// 2. the ops of a call
assert.deepEqual(opsOf([{ op: 'put', ref: 'task-a', task: def() }, { op: 'delete', ref: 'task-b' }]), { ok: true, ops: [{ op: 'put', task_ref: 'task-a', body: definitionOf(def()).def }, { op: 'delete', task_ref: 'task-b' }] })
for (const bad of [null, undefined, 'x', [], {}, Array(MAX_OPS + 1).fill({ op: 'delete', ref: 'a' }).map((o, i) => ({ ...o, ref: 'r' + i })), [{ op: 'run', ref: 'a' }], [{ op: 'put', ref: 'bad ref', task: def() }], [{ op: 'delete' }], [null],
  [{ op: 'delete', ref: 'a' }, { op: 'delete', ref: 'a' }]]) assert.equal(opsOf(bad).ok, false, JSON.stringify(bad))
assert.deepEqual(opsOf([{ op: 'delete', ref: 'a' }, { op: 'put', ref: 'b', task: def({ approvals: 'ask' }) }]), { ok: false, error: 'approval_path_missing', index: 1 }, 'the first that cannot go is named')
assert.equal(opsOf(Array.from({ length: MAX_OPS }, (_, i) => ({ op: 'delete', ref: 'r' + i }))).ok, true)
ok('ops: put or delete, a valid ref each, once each, at most ten, the first refusal names its place')

// 3. the codes of a refusal
for (const code of CODES.filter((c) => c !== 'refused' && c !== 'unreachable')) assert.equal(codeOf(409, { error: code }), code, code)
assert.equal(codeOf(409, { error: 'something_new' }), 'refused', 'a code that is not on the list is not passed on')
assert.equal(codeOf(409, { error: '<script>', message: 'words' }), 'refused')
assert.deepEqual([0, 400, 403, 404, 422, 429, 503, 500, 409].map((s) => codeOf(s, null)), ['unreachable', 'invalid_tasks', 'not_allowed', 'no_computer', 'approval_path_missing', 'rate_limited', 'tasks_unavailable', 'refused', 'refused'])
ok('codes: the platform\'s own when it is on the list, else one from the status, never its words')

// 4. the states
const row = { id: 'task-a', label: 'x', kind: 'cron', enabled: true, next_run_at: '2026-10-24T03:00:00Z', last_run_at: '2026-10-23T03:00:00Z', last_status: 'completed', last_reason: null, tool_profile: null }
assert.deepEqual(statesOf({ tasks: [{ task_ref: 'task-a', state: 'applied', error_code: null, schedule: row }, { task_ref: 'task-b', state: 'error', error_code: 'approval_path_missing', schedule: null }, { task_ref: 'task-c', state: 'pending', error_code: 'ignored', schedule: null }] }), [
  { ref: 'task-a', state: 'applied', code: null, schedule: { enabled: true, nextRunAt: '2026-10-24T03:00:00.000Z', lastRunAt: '2026-10-23T03:00:00.000Z', lastStatus: 'completed' } },
  { ref: 'task-b', state: 'error', code: 'approval_path_missing', schedule: null },
  { ref: 'task-c', state: 'pending', code: null, schedule: null }])
assert.equal(statesOf({ tasks: [{ task_ref: 'bad ref', state: 'applied' }, null, 'x', { state: 'applied' }, { task_ref: 'task-d', state: 'weird', error_code: 'Not A Code', schedule: { next_run_at: 'soon', last_status: 'weird' } }] }).map((t) => t.ref + ':' + t.state).join(','), 'task-d:pending', 'junk is left out, an unknown state is pending')
assert.deepEqual(statesOf({ tasks: [{ task_ref: 'task-d', state: 'error', error_code: 'Not A Code!', schedule: { next_run_at: 'soon', last_status: 'weird', enabled: false } }] })[0], { ref: 'task-d', state: 'error', code: null, schedule: { enabled: false, nextRunAt: null, lastRunAt: null, lastStatus: null } })
for (const none of [null, undefined, {}, { tasks: 'x' }]) assert.deepEqual(statesOf(none), [])
assert.equal(statesOf({ tasks: Array.from({ length: 80 }, (_, i) => ({ task_ref: 'r' + i, state: 'applied' })) }).length, 50)
assert.ok(!JSON.stringify(statesOf({ tasks: [{ task_ref: 'task-a', state: 'applied', schedule: { ...row, label: 'PRIVATE LABEL' } }] })).includes('PRIVATE'), 'the label of a schedule row is not passed on')
ok('states: pending, applied or error, a code only when it is one, the few plain fields of the schedule row')

// 4b. the runs
{
  const run = (o) => Object.assign({ run_key: 'sess-1', task_ref: 'task-a', via: 'cron', outcome: 'completed', reason: null, started_at: '2026-10-23T03:00:00.000Z', ended_at: '2026-10-23T03:04:10Z' }, o)
  assert.deepEqual(runsOf({ runs: [run()] }), [{ key: 'sess-1', ref: 'task-a', via: 'cron', outcome: 'completed', reason: null, startedAt: '2026-10-23T03:00:00.000Z', endedAt: '2026-10-23T03:04:10.000Z' }])
  assert.equal(runsOf({ runs: [run({ outcome: 'exploded' })] }).length, 0, 'an outcome that is not one of the five words is not a run')
  assert.equal(runsOf({ runs: [run({ ended_at: 'later' })] }).length, 0, 'a run with no end time is dropped')
  assert.equal(runsOf({ runs: [run({ task_ref: 'bad ref' }), null, 'x', run({ task_ref: 7 })] }).length, 0)
  const odd = runsOf({ runs: [run({ via: 'carrier-pigeon', reason: 'Run failed: <b>x</b>', started_at: 'x', run_key: 'a b' })] })[0]
  assert.deepEqual([odd.via, odd.reason, odd.startedAt, odd.key], [null, null, '2026-10-23T03:04:10.000Z', '2026-10-23T03:04:10.000Z:task-a'], 'a via that is not known, a reason that is not a code, a start that is not a time: kept out, the key made from the end')
  assert.equal(runsOf({ runs: [run({ reason: 'run_failed', outcome: 'error' })] })[0].reason, 'run_failed')
  assert.equal(runsOf({ runs: Array.from({ length: 150 }, (_, i) => run({ run_key: 'k' + i })) }).length, 100)
  for (const none of [null, undefined, {}, { runs: 'x' }]) assert.deepEqual(runsOf(none), [])
  assert.ok(!JSON.stringify(runsOf({ runs: [run({ prompt: 'secret', result: 'secret', body: { prompt: 'secret' } })] })).includes('secret'), 'nothing outside the closed list goes through')
}
ok('runs: five outcomes, four ways to start, a reason only as a code, the times, at most 100, nothing else')

// 5. the two calls, against a stand-in platform
const calls = []
const fakeApi = (answers) => async (path, options) => { calls.push({ path, method: options.method, token: options.token, body: options.body }); const a = answers.find((x) => x.when(path, options)); return a === undefined ? { status: 404, body: null } : a.then }
const connected = { token: 'tok' }
const WS = '3f2a1c10-0000-4000-8000-0000000000aa'
const wsAnswer = { when: (p) => p === '/v1/workspaces', then: { status: 200, body: { workspaces: [{ id: 'team', personal: false }, { id: WS, personal: true }] } } }
const tasksPath = '/v1/workspaces/' + WS + '/computers/' + COMPUTER + '/tasks'
{
  const api = createPublish({ readState: () => connected, isConnected: (s) => s !== null && typeof s.token === 'string', apiCall: fakeApi([wsAnswer, { when: (p, o) => p === tasksPath && o.method === 'PUT', then: { status: 202, body: { ops: [{ op_id: 'x', task_ref: 'task-a', state: 'pending' }, { op_id: 'y', task_ref: 'bad ref', state: 'pending' }] } } }]) })
  const sent = await api.publish({ computerId: COMPUTER, ops: [{ op: 'put', ref: 'task-a', task: def({ workspace: 'ws-x' }) }] })
  assert.deepEqual(sent, { ok: true, ops: [{ ref: 'task-a', state: 'pending' }] })
  const put = calls.find((c) => c.method === 'PUT')
  assert.equal(put.token, 'tok')
  assert.deepEqual(put.body, { ops: [{ op: 'put', task_ref: 'task-a', body: definitionOf(def()).def }] }, 'the platform gets the platform\'s shape and the six fields')
  assert.equal(calls.some((c) => c.path.includes('team')), false, 'the personal space is used, not a team\'s')
  calls.length = 0
  assert.deepEqual(await api.publish({ computerId: COMPUTER, ops: [{ op: 'put', ref: 'task-a', task: def({ approvals: 'ask' }) }] }), { ok: false, error: 'approval_path_missing', index: 0 })
  assert.deepEqual(calls, [], 'a definition that cannot go never reaches the platform')
  for (const bad of [null, {}, { computerId: 'nope', ops: [{ op: 'delete', ref: 'a' }] }, { computerId: COMPUTER }, { computerId: COMPUTER, ops: [] }, { computerId: COMPUTER + ' ', ops: [{ op: 'delete', ref: 'a' }] }]) assert.equal((await api.publish(bad)).error, 'invalid_request', JSON.stringify(bad))
  assert.deepEqual(calls, [])
}
for (const [status, body, want] of [[409, { error: 'run_hours_exhausted', message: 'words' }, 'run_hours_exhausted'], [409, { error: 'owner_left' }, 'owner_left'], [403, { error: 'forbidden' }, 'not_allowed'], [404, null, 'no_computer'], [422, { error: 'approval_path_missing' }, 'approval_path_missing'], [429, { error: 'too_many_pending' }, 'too_many_pending'], [429, { error: 'rate_limited' }, 'rate_limited'], [503, { error: 'tasks_unavailable' }, 'tasks_unavailable'], [0, null, 'unreachable'], [500, { error: 'boom' }, 'refused'], [400, { error: 'invalid_tasks' }, 'invalid_tasks']]) {
  const api = createPublish({ readState: () => connected, isConnected: () => true, apiCall: fakeApi([wsAnswer, { when: (p, o) => p === tasksPath && o.method === 'PUT', then: { status, body } }]) })
  const r = await api.publish({ computerId: COMPUTER, ops: [{ op: 'delete', ref: 'task-a' }] })
  assert.deepEqual([r.ok, r.error], [false, want], status + ' ' + JSON.stringify(body))
  assert.equal(JSON.stringify(r).includes('words'), false, 'the platform\'s words are not passed on')
}
{
  const off = createPublish({ readState: () => null, isConnected: () => false, apiCall: async () => { throw new Error('must not be called') } })
  assert.deepEqual(await off.publish({ computerId: COMPUTER, ops: [{ op: 'delete', ref: 'a' }] }), { ok: false, error: 'not_connected' })
  assert.deepEqual(await off.states(new URLSearchParams('computerId=' + COMPUTER)), { ok: false, error: 'not_connected' })
  const noWs = createPublish({ readState: () => connected, isConnected: () => true, apiCall: fakeApi([{ when: (p) => p === '/v1/workspaces', then: { status: 200, body: { workspaces: [{ id: 'team', personal: false }] } } }]) })
  assert.equal((await noWs.publish({ computerId: COMPUTER, ops: [{ op: 'delete', ref: 'a' }] })).error, 'no_computer')
  const api = createPublish({ readState: () => connected, isConnected: () => true, apiCall: fakeApi([wsAnswer, { when: (p, o) => p === tasksPath && o.method === 'GET', then: { status: 200, body: { tasks: [{ task_ref: 'task-a', state: 'applied', error_code: null, schedule: row }] } } }]) })
  const got = await api.states(new URLSearchParams('computerId=' + COMPUTER))
  assert.deepEqual([got.ok, got.tasks.length, got.tasks[0].state], [true, 1, 'applied'])
  assert.equal((await api.states(new URLSearchParams('computerId=nope'))).error, 'invalid_request')
  assert.equal((await api.states(new URLSearchParams(''))).error, 'invalid_request')
  assert.equal((await api.states(null)).error, 'invalid_request')
  const gone = createPublish({ readState: () => connected, isConnected: () => true, apiCall: fakeApi([wsAnswer, { when: (p) => p === tasksPath, then: { status: 404, body: null } }]) })
  assert.equal((await gone.states(new URLSearchParams('computerId=' + COMPUTER))).error, 'no_computer')
}
{
  const runsPath = '/v1/workspaces/' + WS + '/computers/' + COMPUTER + '/runs'
  const answer = { runs: [{ run_key: 'r1', task_ref: 'task-a', via: 'run_now', outcome: 'error', reason: 'run_failed', started_at: '2026-10-23T03:00:00Z', ended_at: '2026-10-23T03:01:00Z' }] }
  calls.length = 0
  const api = createPublish({ readState: () => connected, isConnected: () => true, apiCall: fakeApi([wsAnswer, { when: (p) => p.startsWith(runsPath + '?'), then: { status: 200, body: answer } }]) })
  const all = await api.runs(new URLSearchParams('computerId=' + COMPUTER))
  assert.deepEqual([all.ok, all.runs.length, all.runs[0].outcome, all.runs[0].via], [true, 1, 'error', 'run_now'])
  assert.equal(calls[calls.length - 1].path, runsPath + '?limit=100', 'every automation of the computer, at most a hundred')
  assert.equal(calls[calls.length - 1].token, 'tok')
  await api.runs(new URLSearchParams('computerId=' + COMPUTER + '&ref=task-a'))
  assert.equal(calls[calls.length - 1].path, runsPath + '?limit=50&task_ref=task-a', 'one automation: asked of the platform, not cut here')
  calls.length = 0
  for (const bad of [new URLSearchParams('computerId=nope'), new URLSearchParams(''), new URLSearchParams('computerId=' + COMPUTER + '&ref=a%20b'), new URLSearchParams('computerId=' + COMPUTER + '&ref=' + 'x'.repeat(65)), null]) assert.equal((await api.runs(bad)).error, 'invalid_request')
  assert.deepEqual(calls, [], 'a bad id never reaches the platform')
  const off = createPublish({ readState: () => null, isConnected: () => false, apiCall: async () => { throw new Error('must not be called') } })
  assert.deepEqual(await off.runs(new URLSearchParams('computerId=' + COMPUTER)), { ok: false, error: 'not_connected' })
  for (const [status, want] of [[404, 'no_computer'], [429, 'rate_limited'], [503, 'tasks_unavailable'], [0, 'unreachable']]) {
    const bad = createPublish({ readState: () => connected, isConnected: () => true, apiCall: fakeApi([wsAnswer, { when: (p) => p.startsWith(runsPath), then: { status, body: null } }]) })
    assert.equal((await bad.runs(new URLSearchParams('computerId=' + COMPUTER))).error, want, String(status))
  }
}
ok('runs call: the platform\'s route with a limit, one automation asked of the platform, bad ids stopped here, refusals as short codes')
ok('calls: the platform\'s shape and only the personal space, refusals as short codes, nothing called when it cannot go or nobody is connected')

// 6. the routes: a write is strict and signed-in, a read is a guarded GET
{
  const idx = readFileSync(join(here, 'index.js'), 'utf8')
  assert.ok(/import \{ createPublish \} from '\.\/computers-publish\.mjs'/.test(idx))
  assert.ok(/\{ path: '\/kybernos-cloud\/computers\/publish', method: 'POST', guarded: true, strict: true, session: true, body: true, cap: 100000, run: \(req, body\) => computersPublish\.publish\(body\) \}/.test(idx), 'publishing writes on the person\'s behalf: same origin strictly and the signed browser session')
  assert.ok(/\{ path: '\/kybernos-cloud\/computers\/tasks', method: 'GET', guarded: true, run: \(req\) => computersPublish\.states\(queryOf\(req\)\) \}/.test(idx), 'reading the states is a guarded GET')
  assert.ok(/\{ path: '\/kybernos-cloud\/computers\/runs', method: 'GET', guarded: true, run: \(req\) => computersPublish\.runs\(queryOf\(req\)\) \}/.test(idx), 'reading the runs is a guarded GET')
  assert.ok(/const computersPublish = createPublish\(\{ readState, isConnected, apiCall \}\)/.test(idx))
  ok('routes: publish is strict and needs the signed session, the states and the runs are a guarded GET')
}

console.log('\n' + pass + ' checks passed')
