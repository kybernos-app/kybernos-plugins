// Test of the future occurrences the Automations calendar plans (automation-occurrences.mjs).
// The matcher it uses is the SCHEDULER's: this test takes the KB-TASKS-CORE block of index.js (the
// block the tick itself runs) and hands it in, so a calendar that disagreed with the scheduler fails here.
// Usage: node packages/kybernos-plugin/test-automation-occurrences.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  OCC_BUDGET_MS, OCC_MAX_RANGE_MS, OCC_PER_TASK, OCC_TOTAL, expandOccurrences, parseOccurrenceRange,
} from './automation-occurrences.mjs'

const src = readFileSync(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8')
const m = src.match(/\/\/ KB-TASKS-CORE-BEGIN([\s\S]*?)\/\/ KB-TASKS-CORE-END/)
if (m === null) { console.error('KB-TASKS-CORE block not found in index.js'); process.exit(1) }
const core = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { kbComputeNextRun, kbNeverRuns, kbNoNextRunError, kbIsValidTimeZone, kbNextCronAfter }'))

const deps = (extra) => Object.assign({
  computeNextRun: (t, after) => core.kbComputeNextRun(t, after),
  neverRuns: (t, next) => core.kbNeverRuns(t, next),
  noNextRunError: (t) => core.kbNoNextRunError(t),
  isValidTimeZone: (tz) => core.kbIsValidTimeZone(tz),
}, extra || {})

let fails = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}
const Z = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h || 0, mi || 0)
const iso = (ms) => new Date(ms).toISOString()
const task = (id, schedule, extra) => Object.assign({ id, name: id, active: true, schedule }, extra || {})
const cron = (expr, tz) => ({ mode: 'cron', cron: expr, tz: tz || 'UTC' })
const NOW = Z(2026, 10, 12, 9, 20) // Monday 12 October 2026, 09:20 UTC
const range = (days) => ({ fromMs: NOW, toMs: NOW + days * 86400000, nowMs: NOW })
const times = (r, id) => r.occurrences.filter((o) => o.id === id).map((o) => o.at)

/* ── The window ──────────────────────────────────────────────────────────── */
{
  const r = parseOccurrenceRange('2026-10-12T00:00:00Z', '2026-10-19T00:00:00Z', NOW)
  eq('a window is read', [r.ok, iso(r.toMs)], [true, '2026-10-19T00:00:00.000Z'])
  eq('the past is never expanded: from is lifted to now', iso(r.fromMs), iso(NOW))
  const d = parseOccurrenceRange(undefined, undefined, NOW)
  eq('no from, no to: now and a week', [d.ok, iso(d.fromMs), iso(d.toMs)], [true, iso(NOW), iso(NOW + 7 * 86400000)])
  eq('null and empty count as missing', parseOccurrenceRange(null, '', NOW).ok, true)
  eq('an unreadable date is refused', parseOccurrenceRange('tomorrow', undefined, NOW), { ok: false, error: 'from must be a date' })
  eq('...so is the end', parseOccurrenceRange('2026-10-13T00:00:00Z', 'soon', NOW), { ok: false, error: 'to must be a date' })
  eq('an end before the start is refused', parseOccurrenceRange('2026-10-14T00:00:00Z', '2026-10-13T00:00:00Z', NOW).error, 'to must be after from')
  eq('a window longer than a month grid is refused, not cut', parseOccurrenceRange('2026-10-12T00:00:00Z', '2026-12-30T00:00:00Z', NOW).error, 'range too long (45 days at most)')
  eq('exactly the maximum is fine', parseOccurrenceRange(iso(NOW), iso(NOW + OCC_MAX_RANGE_MS), NOW).ok, true)
  eq('a value that is not text is refused', parseOccurrenceRange({ a: 1 }, undefined, NOW).ok, false)
  eq('a huge string is refused', parseOccurrenceRange('x'.repeat(5000), undefined, NOW).ok, false)
}

/* ── It is the scheduler's matcher ───────────────────────────────────────── */
for (const [label, expr, tz] of [
  ['daily at 08:00 in Paris', '0 8 * * *', 'Europe/Paris'],
  ['weekdays at 09:30 in New York', '30 9 * * 1-5', 'America/New_York'],
  ['every 6 hours', '0 */6 * * *', 'UTC'],
  ['the 1st and the 15th', '0 7 1,15 * *', 'Asia/Kolkata'],
  ['Mondays or the 13th (Vixie OR)', '0 0 13 * 1', 'UTC'],
  ['02:30, a time the clocks skip on 25 October in Paris', '30 2 * * *', 'Europe/Paris'],
]) {
  const r = expandOccurrences([task('t', cron(expr, tz))], range(40), deps())
  const want = []
  let at = core.kbNextCronAfter(expr, NOW - 1, tz)
  while (at !== null && at <= NOW + 40 * 86400000 && want.length < OCC_PER_TASK) { want.push(iso(at)); at = core.kbNextCronAfter(expr, at, tz) }
  eq(label + ': the same instants as the scheduler walking its own matcher', times(r, 't'), want)
}
{
  const r = expandOccurrences([task('t', cron('0 8 * * *', 'Europe/Paris'))], range(3), deps())
  eq('daily 08:00 Paris (CEST, +2): three days', times(r, 't'), ['2026-10-13T06:00:00.000Z', '2026-10-14T06:00:00.000Z', '2026-10-15T06:00:00.000Z'])
}
{
  // 25 October 2026: Paris leaves summer time. 08:00 moves from 06:00Z to 07:00Z, like the tick.
  const r = expandOccurrences([task('t', cron('0 8 * * *', 'Europe/Paris'))], { fromMs: Z(2026, 10, 23), toMs: Z(2026, 10, 27), nowMs: Z(2026, 10, 23) }, deps())
  eq('across the clock change the local time holds', times(r, 't'), ['2026-10-23T06:00:00.000Z', '2026-10-24T06:00:00.000Z', '2026-10-25T07:00:00.000Z', '2026-10-26T07:00:00.000Z'])
}
{
  const r = expandOccurrences([task('t', cron('0 */6 * * *'))], range(2), deps())
  eq('every 6 hours for two days: the slots after 09:20 (12 and 18, then four a day, then 00 and 06)', times(r, 't').length, 8)
  eq('...starting at 12:00', times(r, 't')[0], '2026-10-12T12:00:00.000Z')
  eq('...and the answer is sorted', times(r, 't').slice().sort().join() === times(r, 't').join(), true)
}

/* ── Who is listed ───────────────────────────────────────────────────────── */
{
  const tasks = [
    task('daily', cron('0 8 * * *')),
    task('paused', cron('0 8 * * *'), { active: false }),
    task('hook', { mode: 'webhook', tz: 'UTC' }),
    task('once-in', { mode: 'once', at: '2026-10-14T10:00', tz: 'UTC' }),
    task('once-out', { mode: 'once', at: '2026-12-14T10:00', tz: 'UTC' }),
  ]
  const r = expandOccurrences(tasks, range(7), deps())
  eq('a paused automation has no occurrence', times(r, 'paused'), [])
  eq('a webhook-only automation has none either, and is not "unable to fire"', [times(r, 'hook'), r.cannotFire.map((c) => c.id)], [[], []])
  eq('a one-time automation is listed on its date', times(r, 'once-in'), ['2026-10-14T10:00:00.000Z'])
  eq('...and not outside the window', times(r, 'once-out'), [])
  eq('nothing is truncated, nothing is warned', [r.truncated, r.warnings], [[], []])
  eq('entries that are not automations are skipped', expandOccurrences([null, 'x', 5, [], { id: 3 }, { id: 'a' }, { id: 'b', active: true }, { id: 'c', active: true, schedule: null }], range(7), deps()).occurrences, [])
  eq('not an array: nothing', expandOccurrences(undefined, range(7), deps()).occurrences, [])
}

/* ── What cannot fire is said, in the scheduler's words ──────────────────── */
{
  const tasks = [
    task('never', cron('0 0 31 2 *')),
    task('passed', { mode: 'once', at: '2026-10-01T10:00', tz: 'UTC' }),
    task('fine', cron('0 8 * * *')),
  ]
  const r = expandOccurrences(tasks, range(7), deps())
  eq('a cron that never matches', r.cannotFire.find((c) => c.id === 'never'), { id: 'never', error: 'this schedule never fires' })
  eq('an active one-time date in the past', r.cannotFire.find((c) => c.id === 'passed'), { id: 'passed', error: 'that date is in the past' })
  eq('neither lists an occurrence', [times(r, 'never'), times(r, 'passed')], [[], []])
  eq('the others are unaffected', times(r, 'fine').length, 7)
  const z = expandOccurrences([task('mars', cron('0 8 * * *', 'Mars/Phobos'))], range(2), deps())
  eq('an unknown zone is warned about (the scheduler uses the machine zone)', z.warnings, [{ id: 'mars', warning: 'unknown time zone: the machine zone is used' }])
  eq('...and still planned', times(z, 'mars').length, 2)
}

/* ── Bounds ──────────────────────────────────────────────────────────────── */
{
  const r = expandOccurrences([task('minute', cron('* * * * *'))], range(2), deps())
  eq('a schedule denser than the cap is cut at the cap', times(r, 'minute').length, OCC_PER_TASK)
  eq('...and says until when it is known', r.truncated, [{ id: 'minute', until: times(r, 'minute')[OCC_PER_TASK - 1] }])
  const sparse = expandOccurrences([task('exact', cron('*/30 * * * *'))], { fromMs: Z(2026, 10, 13), toMs: Z(2026, 10, 13) + 30 * 60000 * (OCC_PER_TASK - 1), nowMs: NOW }, deps())
  eq('exactly the cap is not truncated', [times(sparse, 'exact').length, sparse.truncated], [OCC_PER_TASK, []])
}
{
  const many = []
  for (let i = 0; i < 30; i += 1) many.push(task('m' + i, cron('* * * * *')))
  const r = expandOccurrences(many, range(1), deps({ clock: (() => { let t = 0; return () => t })() }))
  eq('all automations together are capped', r.occurrences.length, OCC_TOTAL)
  eq('...and the ones cut are named', r.truncated.length > 0 && r.truncated.every((x) => /^m\d+$/.test(x.id)), true)
}
{
  // A slow matcher: the time budget stops the work and names every automation it did not reach.
  let t = 0
  const slow = deps({ clock: () => t, computeNextRun: (task2, after) => { t += 400; return core.kbComputeNextRun(task2, after) } })
  const r = expandOccurrences([task('a', cron('0 8 * * *')), task('b', cron('0 9 * * *')), task('c', cron('0 10 * * *'))], range(3), slow)
  eq('the budget is ' + OCC_BUDGET_MS + ' ms', OCC_BUDGET_MS, 800)
  eq('over budget: it stops and says what it did not reach', r.truncated.length >= 1, true)
  eq('...no automation is both listed whole and reported unreached', r.truncated.every((x) => typeof x.until === 'string'), true)
}

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
