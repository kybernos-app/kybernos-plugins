// The reporter's pure parts, against a profile made on disk: what it says of the automations and of the runs that ended. Nothing is sent.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'kb-reporter-'))
process.env.DSH_HOME = home
process.env.KYBERNOS_API = 'https://api.example.test'
process.env.KYBERNOS_COMPUTER_TOKEN = 'kyd_test'
const { scheduleOf, endedRuns, cleanLabel, sessionState, memoryOf, loadOf, runningTasksOf, beatOf, externalIdOf } = await import('./reporter.mjs')

const projection = (sid, { closed, at }) => {
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, sid + '.json')
  writeFileSync(file, JSON.stringify({ record: { rows: { turnBoundary: { val: { openTurnStartSeq: closed ? null : 7 } }, sessionStats: { val: { steps: 2 } } } } }))
  const t = new Date(at)
  utimesSync(file, t, t)
}

test('a label is one clean line with no markup and no invisible characters', () => {
  assert.equal(cleanLabel('  Morning\u0000 <b>digest</b>\n​now '), 'Morning b digest /b now')
  assert.equal(cleanLabel(''), 'Automation')
  assert.equal(cleanLabel('x'.repeat(200)).length, 80)
})

test('the schedule is ids, labels, kinds, times and outcome codes; an id that is not one is left out', () => {
  projection('session-aaaaaaaa-1', { closed: true, at: '2026-10-14T10:00:30Z' })
  const out = scheduleOf([
    { id: 'st-1', name: 'Digest', active: true, schedule: { mode: 'cron' }, nextRun: '2026-10-15T08:00:00Z', lastRun: '2026-10-14T10:00:00Z', history: [{ at: '2026-10-14T10:00:00Z', sessionId: 'session-aaaaaaaa-1', status: 'fired' }], prompt: 'SECRET PROMPT' },
    { id: 'st-2', name: 'Hook', active: false, schedule: { mode: 'webhook' }, trigger: { type: 'webhook', hookId: 'hk_x', secret: 'SECRET' }, history: [{ at: '2026-10-14T10:00:00Z', sessionId: null, status: 'error', error: 'a long error text' }] },
    { id: 'bad id with spaces', name: 'No' },
    { id: 'st-3', name: 'Odd', schedule: { mode: 'something' } }
  ])
  assert.deepEqual(out.map((t) => [t.id, t.kind, t.enabled, t.last_status, t.last_reason]), [
    ['st-1', 'cron', true, 'completed', null],
    ['st-2', 'webhook', false, 'error', 'run_failed'],
    ['st-3', 'manual', true, null, null]
  ])
  const text = JSON.stringify(out)
  for (const never of ['SECRET', 'a long error text', 'hk_x']) assert.ok(!text.includes(never), never)
})

test('a run is reported once its turn is closed, by its session id, with the door it came by', () => {
  projection('session-bbbbbbbb-2', { closed: false, at: '2026-10-14T11:00:10Z' })
  projection('session-cccccccc-3', { closed: true, at: '2026-10-14T12:00:20Z' })
  const tasks = [
    { id: 'st-1', schedule: { mode: 'cron' }, history: [
      { at: '2026-10-14T11:00:00Z', sessionId: 'session-bbbbbbbb-2', status: 'fired' },
      { at: '2026-10-14T12:00:00Z', sessionId: 'session-cccccccc-3', status: 'fired' },
      { at: '2026-10-14T13:00:00Z', sessionId: null, status: 'error' }
    ] },
    { id: 'st-2', schedule: { mode: 'webhook' }, history: [{ at: '2026-10-14T09:00:00Z', sessionId: 'session-aaaaaaaa-1', status: 'fired' }] }
  ]
  const runs = endedRuns(tasks, new Set())
  assert.deepEqual(runs.map((r) => [r.run_id, r.task_id, r.via, r.outcome]), [
    ['session-cccccccc-3', 'st-1', 'cron', 'completed'],
    ['st-1:2026-10-14T13:00:00.000Z', 'st-1', 'cron', 'error'],
    ['session-aaaaaaaa-1', 'st-2', 'webhook', 'completed']
  ])
  assert.ok(Date.parse(runs[0].ended_at) >= Date.parse(runs[0].started_at))
  // Already reported: not again.
  assert.deepEqual(endedRuns(tasks, new Set(['session-cccccccc-3', 'st-1:2026-10-14T13:00:00.000Z', 'session-aaaaaaaa-1'])), [])
  assert.equal(sessionState('session-bbbbbbbb-2').closed, false)
  assert.equal(sessionState('session-nope'), null)
})

// ── the load in the beat ──────────────────────────────────────────────────────────────────────────
// What the plugin answers on GET /kybernos/automation-load, trimmed to what the reporter reads.
const view = (extra = {}) => ({ ok: true, level: 'busy', pressure: 71, inFlight: 1, allowed: 1, waiting: 1, loadPerCpu: 1.12345, memAvailablePct: 31, runs: [{ taskId: 'st-1', sessions: 1, elapsedMs: 90_000, subagents: 1, lighter: true, activity: [1, 2] }], series: { total: [1] }, waitingIds: ['st-9'], ...extra })
const memory = { availMb: 310, totalMb: 980 }

test('memory is MemAvailable and MemTotal in MB, never MemFree', () => {
  const text = 'MemTotal:         1003520 kB\nMemFree:            25600 kB\nMemAvailable:      317440 kB\nBuffers:             100 kB\n'
  assert.deepEqual(memoryOf(text), { availMb: 310, totalMb: 980 })
  for (const none of ['', 'MemTotal: 1000 kB\nMemFree: 5 kB\n', 'MemAvailable: 5 kB\n', 'MemTotal: 0 kB\nMemAvailable: 0 kB\n', null, undefined]) assert.equal(memoryOf(none), null, String(none))
})

test('the load is numbers from a closed list; a figure that is not the machine\'s is not sent', () => {
  assert.deepEqual(loadOf(view(), memory), { level: 'busy', pressure: 71, cpu_per_core: 1.12, mem_avail_mb: 310, mem_total_mb: 980, running: 1, waiting: 1, allowed: 1 })
  for (const level of ['ok', 'high']) assert.equal(loadOf(view({ level }), memory).level, level)
  for (const bad of [null, undefined, 'x', {}, { ok: false }, view({ level: 'weird' }), view({ level: 'ok\nrm' }), view({ pressure: null }), view({ pressure: 'high' }), view({ pressure: NaN })]) assert.equal(loadOf(bad, memory), null, JSON.stringify(bad))
  assert.equal(loadOf(view(), null), null, 'no memory reading, no load')
  // everything is clamped to what the platform accepts
  const wild = loadOf(view({ pressure: 900, loadPerCpu: 500, inFlight: 9999, waiting: -3, allowed: 'x' }), { availMb: -5, totalMb: 0 })
  assert.deepEqual(wild, { level: 'busy', pressure: 100, cpu_per_core: 64, mem_avail_mb: 0, mem_total_mb: 1, running: 64, waiting: 0, allowed: 0 })
  assert.equal(loadOf(view({ loadPerCpu: null }), memory).cpu_per_core, 0, 'an unmeasured processor reads as free, as in the plugin')
  const text = JSON.stringify(loadOf(view(), memory))
  for (const never of ['st-1', 'st-9', 'activity', 'series']) assert.ok(!text.includes(never), never)
})

test('the runs going are the automations\' ids with the moment they started, at most eight', () => {
  const now = Date.parse('2026-10-23T12:00:00Z')
  assert.deepEqual(runningTasksOf(view(), now), [{ task_ref: 'st-1', started_at: '2026-10-23T11:58:30.000Z' }])
  const many = view({ runs: [...Array(12).keys()].map((i) => ({ taskId: 'st-' + i, elapsedMs: 1000 })).concat([{ taskId: 'bad id', elapsedMs: 1 }, { taskId: 'x'.repeat(65), elapsedMs: 1 }, null]) })
  assert.equal(runningTasksOf(many, now).length, 8)
  assert.ok(!runningTasksOf(many, now).some((r) => r.task_ref === 'bad id'))
  assert.deepEqual(runningTasksOf(view({ runs: [{ taskId: 'st-2', elapsedMs: 'soon' }] }), now), [{ task_ref: 'st-2', started_at: '2026-10-23T12:00:00.000Z' }])
  for (const none of [null, undefined, {}, { runs: 'x' }]) assert.deepEqual(runningTasksOf(none, now), [])
})

test('a beat keeps what it always said and adds the load only when there is one; an older platform loses nothing', () => {
  const now = Date.parse('2026-10-23T12:00:00Z')
  const full = beatOf(2, 388, view(), memory, now)
  assert.deepEqual(Object.keys(full), ['sessions', 'rss_mb', 'load', 'running_tasks'])
  assert.equal(full.sessions, 2)
  assert.equal(full.rss_mb, 388)
  assert.deepEqual(beatOf(0, 120, null, memory, now), { sessions: 0, rss_mb: 120 }, 'the plugin did not answer: the old beat')
  assert.deepEqual(beatOf(0, 120, view({ pressure: null }), memory, now), { sessions: 0, rss_mb: 120 }, 'a forced or switched-off reading is not sent')
  assert.ok(JSON.stringify(beatOf(1, 1, view({ runs: [...Array(8).keys()].map((i) => ({ taskId: 'x'.repeat(64), elapsedMs: 1 })) }), memory, now)).length < 2048, 'a full beat stays far under the platform\'s 2048-byte bound')
})

// ── a task published from the account is known by the laptop's id ──────────────────────────────────
test('a published task is reported, in the schedule, in its runs and in the beat, by the id the laptop gave it', () => {
  projection('session-dddddddd-4', { closed: true, at: '2026-10-23T03:00:40Z' })
  const tasks = [
    { id: 'st-local-1', name: 'Made here', active: true, schedule: { mode: 'cron' }, history: [] },
    { id: 'st-moon-2', name: 'Published', active: true, schedule: { mode: 'cron' }, published: { ref: 'task-laptop-9', at: '2026-10-23T02:00:00Z' }, nextRun: '2026-10-24T03:00:00Z', history: [{ at: '2026-10-23T03:00:00Z', sessionId: 'session-dddddddd-4', status: 'fired' }] },
    { id: 'st-moon-3', name: 'Odd ref', active: true, schedule: { mode: 'cron' }, published: { ref: 'a b', at: 'x' }, history: [] }
  ]
  assert.equal(externalIdOf(tasks[0]), 'st-local-1')
  assert.equal(externalIdOf(tasks[1]), 'task-laptop-9')
  assert.equal(externalIdOf(tasks[2]), 'st-moon-3', 'a ref that is not an id is not used')
  assert.deepEqual(scheduleOf(tasks).map((t) => t.id), ['st-local-1', 'task-laptop-9', 'st-moon-3'])
  const runs = endedRuns(tasks, new Set())
  assert.deepEqual(runs.map((r) => [r.run_id, r.task_id]), [['session-dddddddd-4', 'task-laptop-9']])
  const ids = new Map(tasks.map((t) => [String(t.id), externalIdOf(t)]))
  const now = Date.parse('2026-10-23T12:00:00Z')
  const v = { ok: true, level: 'ok', pressure: 10, inFlight: 2, allowed: 3, waiting: 0, loadPerCpu: 0.2, runs: [{ taskId: 'st-moon-2', elapsedMs: 1000 }, { taskId: 'st-local-1', elapsedMs: 2000 }] }
  assert.deepEqual(runningTasksOf(v, now, ids).map((r) => r.task_ref), ['task-laptop-9', 'st-local-1'])
  assert.deepEqual(beatOf(1, 100, v, { availMb: 500, totalMb: 1000 }, now, ids).running_tasks.map((r) => r.task_ref), ['task-laptop-9', 'st-local-1'])
  assert.deepEqual(runningTasksOf(v, now).map((r) => r.task_ref), ['st-moon-2', 'st-local-1'], 'without a map the plugin\'s ids are kept')
})
