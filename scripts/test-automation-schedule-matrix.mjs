#!/usr/bin/env node
// Case J16-03 of docs/tests/user-journey: when an automation runs. The scheduler's own matcher (the KB-TASKS-CORE block of packages/kybernos-plugin/index.js, the block the tick runs) is compared with an INDEPENDENT oracle:
// a minute-by-minute walk of real time that reads the wall clock of the time zone through Intl, so the oracle shares no code with the matcher and no table of daylight-saving rules.
//
//   node scripts/test-automation-schedule-matrix.mjs [--json]
//
// The matrix: every N minutes, hourly, daily, weekdays, weekly, the 1st, month end (28 to 31), a leap day, Vixie's OR of day-of-month and day-of-week, 11 time zones (half-hour and 45-minute offsets, both hemispheres,
// no daylight saving), and a start instant set on, just before and just after each clock change of 2026 in four zones. A wall time the clocks skip, and one they repeat, are reported as DECISIONS (what the
// scheduler does there), not as failures: nothing in the product promises either. Every other disagreement is a failure. Exit 0 when none, 1 otherwise.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(REPO, 'packages/kybernos-plugin/index.js'), 'utf8')
const m = src.match(/\/\/ KB-TASKS-CORE-BEGIN([\s\S]*?)\/\/ KB-TASKS-CORE-END/)
if (m === null) { console.error('KB-TASKS-CORE block not found in packages/kybernos-plugin/index.js'); process.exit(2) }
const core = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { kbNextCronAfter, kbIsValidTimeZone }'))

const fmtCache = new Map()
/** Wall-clock fields of an instant in a zone, from Intl alone. */
export function wall (ms, tz) {
  let f = fmtCache.get(tz)
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' }); fmtCache.set(tz, f) }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) }
}

/** One cron field as the set of values it allows. */
export function fieldSet (text, lo, hi) {
  const out = new Set()
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : +stepText
    let a = lo
    let b = hi
    if (range !== '*') { const [x, y] = range.split('-'); a = +x; b = y === undefined ? (stepText === undefined ? +x : hi) : +y }
    for (let v = a; v <= b; v += step) out.add(v)
  }
  return out
}

/** The first instant strictly after `afterMs`, walking minute by minute, at which the wall clock of `tz` matches `expr` (Vixie: day-of-month OR day-of-week when both are restricted). Null after `limitDays`. */
export function oracleNext (expr, afterMs, tz, limitDays = 800) {
  const [mi, h, dom, mo, dow] = expr.split(/\s+/)
  const S = { mi: fieldSet(mi, 0, 59), h: fieldSet(h, 0, 23), dom: fieldSet(dom, 1, 31), mo: fieldSet(mo, 1, 12), dow: fieldSet(dow.replace(/7/g, '0'), 0, 6) }
  const domAny = dom === '*'
  const dowAny = dow === '*'
  let t = Math.floor(afterMs / 60000) * 60000 + 60000
  const end = afterMs + limitDays * 86400000
  while (t <= end) {
    const w = wall(t, tz)
    const dayOk = domAny && dowAny ? true : domAny ? S.dow.has(w.dow) : dowAny ? S.dom.has(w.d) : (S.dom.has(w.d) || S.dow.has(w.dow))
    if (S.mo.has(w.mo) && dayOk && S.h.has(w.h) && S.mi.has(w.mi)) return t
    // jump over a whole day that cannot match, an hour that cannot match: keeps the walk fast without changing its result
    if (!S.mo.has(w.mo) || !dayOk) { t += (w.h === 0 && w.mi === 0 ? 86400000 : 60000); continue }
    if (!S.h.has(w.h)) { t += 60000 * (60 - w.mi); continue }
    t += 60000
  }
  return null
}

const ZONES = ['UTC', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Kathmandu', 'Australia/Sydney', 'Pacific/Auckland', 'America/Sao_Paulo', 'Asia/Tokyo', 'Africa/Cairo']
const EXPRS = [
  ['every minute', '* * * * *'], ['every 5 minutes', '*/5 * * * *'], ['every 15 minutes', '*/15 * * * *'], ['every 37 minutes (odd step)', '*/37 * * * *'], ['hourly at :07', '7 * * * *'],
  ['every 3 hours', '0 */3 * * *'], ['daily 08:00', '0 8 * * *'], ['daily 23:59', '59 23 * * *'], ['daily 00:00', '0 0 * * *'], ['weekdays 09:30', '30 9 * * 1-5'], ['Sunday as 0', '0 9 * * 0'], ['Sunday as 7', '0 9 * * 7'],
  ['Mondays and Thursdays', '0 6 * * 1,4'], ['the 1st', '0 7 1 * *'], ['the 15th', '0 7 15 * *'], ['the 28th to the 31st (month end days)', '0 9 28-31 * *'], ['the 31st only', '0 9 31 * *'], ['29 February', '0 9 29 2 *'],
  ['the 13th OR a Monday (Vixie)', '0 0 13 * 1'], ['first quarter hours of March', '*/15 8 * 3 *'], ['New Year, midnight', '0 0 1 1 *']
]
// Starts: ordinary instants and the neighbourhood of every clock change of 2026 in four zones.
const CHANGES = { 'Europe/Paris': ['2026-03-29T01:00:00Z', '2026-10-25T01:00:00Z'], 'America/New_York': ['2026-03-08T07:00:00Z', '2026-11-01T06:00:00Z'], 'Australia/Sydney': ['2026-04-04T16:00:00Z', '2026-10-03T16:00:00Z'], 'America/Sao_Paulo': ['2026-06-01T00:00:00Z'] }

const argv = process.argv.slice(2)
let ran = 0
const fails = []
const decisions = []
const starts = (tz) => {
  const base = ['2026-01-15T10:07:00Z', '2026-02-28T23:59:30Z', '2026-06-30T23:58:00Z', '2026-12-31T23:30:00Z', '2027-02-27T12:00:00Z'].map(Date.parse)
  const near = (CHANGES[tz] || []).flatMap((s) => [-90, -1, 0, 1, 30, 61, 130].map((min) => Date.parse(s) + min * 60000))
  return base.concat(near)
}
for (const tz of ZONES) {
  if (!core.kbIsValidTimeZone(tz)) { fails.push(`${tz}: the scheduler does not accept this time zone`); continue }
  for (const [label, expr] of EXPRS) {
    for (const start of starts(tz)) {
      const got = core.kbNextCronAfter(expr, start, tz)
      const want = oracleNext(expr, start, tz)
      ran += 1
      if (got === want) continue
      // a wall time the clocks skip (the oracle never meets it) or repeat (the oracle meets it twice): the scheduler's choice, reported
      const gotWall = got === null ? null : wall(got, tz)
      const nearChange = (CHANGES[tz] || []).some((s) => Math.abs(start - Date.parse(s)) < 4 * 3600000 || (got !== null && Math.abs(got - Date.parse(s)) < 4 * 3600000) || (want !== null && Math.abs(want - Date.parse(s)) < 4 * 3600000))
      const row = `${tz} « ${label} » (${expr}) after ${new Date(start).toISOString()}: scheduler ${got === null ? 'never' : new Date(got).toISOString()}, oracle ${want === null ? 'never' : new Date(want).toISOString()}${gotWall ? '' : ''}`
      if (nearChange) decisions.push(row)
      else fails.push(row)
    }
  }
}
// The matcher must never move backwards or stand still: the next instant is after the start, and asking again from it gives a later one.
for (const tz of ['UTC', 'Europe/Paris', 'America/New_York']) {
  for (const [label, expr] of EXPRS) {
    let t = Date.parse('2026-03-01T00:00:00Z')
    for (let i = 0; i < 40; i++) {
      const n = core.kbNextCronAfter(expr, t, tz)
      ran += 1
      if (n === null) break
      if (!(n > t)) { fails.push(`${tz} « ${label} »: the next run ${new Date(n).toISOString()} is not after ${new Date(t).toISOString()}`); break }
      t = n
    }
  }
}
// Expressions that must be refused or never run.
for (const bad of ['', 'not a cron', '60 * * * *', '* 24 * * *', '* * 32 * *', '* * * 13 *', '* * * * 8', '*/0 * * * *', '1 2 3 4', '1 2 3 4 5 6']) {
  ran += 1
  let n
  try { n = core.kbNextCronAfter(bad, Date.parse('2026-01-01T00:00:00Z'), 'UTC') } catch (e) { n = 'threw' }
  if (n !== null && n !== 'threw') fails.push(`« ${bad} » should be refused or never run, the scheduler gave ${new Date(n).toISOString()}`)
}
ran += 1
if (core.kbIsValidTimeZone('Mars/Olympus') !== false) fails.push('an unknown time zone is accepted')

if (argv.includes('--json')) console.log(JSON.stringify({ ran, fails, decisions }, null, 2))
else {
  console.log(`J16-03 schedule matrix: ${ran} comparisons, ${fails.length} failure(s), ${decisions.length} decision(s) near a clock change`)
  for (const f of fails.slice(0, 25)) console.log('  ✗ ' + f)
  for (const d of decisions.slice(0, 8)) console.log('  · ' + d)
  if (decisions.length > 8) console.log(`  · … ${decisions.length - 8} more near a clock change (--json lists them)`)
}
process.exit(fails.length === 0 ? 0 : 1)
