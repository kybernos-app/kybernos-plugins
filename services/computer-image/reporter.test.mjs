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
const { scheduleOf, endedRuns, cleanLabel, sessionState } = await import('./reporter.mjs')

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
