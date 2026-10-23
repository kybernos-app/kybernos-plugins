#!/usr/bin/env node
/** Rules of the automation load cap (automation-load.mjs) and their wiring in index.js and client.js.
 *  Usage: node packages/kybernos-plugin/test-automation-load.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_MAX_PARALLEL, MAX_PARALLEL_CEILING, HOLD_LIMIT_MS, START_GRACE_MS, RUN_MAX_MS, LEVELS,
  maxParallelFrom, guardOff, parseMeminfo, levelOf, pressureOf, allowedAt, admit, createInflight, publicView,
} from './automation-load.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))

// 1. the level: memory still available and load per core; unknown facts never raise it
assert.deepEqual(levelOf({ memAvailablePct: 77, memAvailableMb: 12000, loadPerCpu: 0.4 }), { level: 'ok', reasons: [] })
assert.deepEqual(levelOf({ memAvailablePct: 15, memAvailableMb: 2400 }), { level: 'busy', reasons: ['memory'] })
assert.deepEqual(levelOf({ memAvailablePct: 60, memAvailableMb: 350 }), { level: 'busy', reasons: ['memory'] }, 'a small machine is busy by its absolute room, not only by its share')
assert.deepEqual(levelOf({ memAvailablePct: 5, memAvailableMb: 800 }), { level: 'high', reasons: ['memory'] })
assert.deepEqual(levelOf({ memAvailablePct: 60, memAvailableMb: 150 }), { level: 'high', reasons: ['memory'] })
assert.deepEqual(levelOf({ loadPerCpu: 1.6 }), { level: 'busy', reasons: ['cpu'] })
assert.deepEqual(levelOf({ loadPerCpu: 3 }), { level: 'high', reasons: ['cpu'] })
assert.deepEqual(levelOf({ memAvailablePct: 15, loadPerCpu: 3 }), { level: 'high', reasons: ['memory', 'cpu'] }, 'the worse level wins and both reasons are kept')
for (const bad of [null, undefined, 'x', 7, [], {}, { memAvailablePct: null, loadPerCpu: null }, { memAvailablePct: 'low', loadPerCpu: NaN }]) assert.deepEqual(levelOf(bad), { level: 'ok', reasons: [] }, 'an unmeasured machine is treated as free')
ok('level: memory and cpu, the worse one wins, unknown is free')

// 1b. the gauge: 0 to 100, 50 at the busy thresholds, 100 at the high ones, and always in step with the level
assert.equal(pressureOf({ memAvailablePct: 100 }), 0)
assert.equal(pressureOf({ memAvailablePct: 20 }), 50)
assert.equal(pressureOf({ memAvailablePct: 10 }), 100)
assert.equal(pressureOf({ memAvailablePct: 60 }), 25)
assert.equal(pressureOf({ memAvailableMb: 400 }), 50)
assert.equal(pressureOf({ memAvailableMb: 200 }), 100)
assert.equal(pressureOf({ loadPerCpu: 1.5 }), 50)
assert.equal(pressureOf({ loadPerCpu: 2.5 }), 100)
assert.equal(pressureOf({ loadPerCpu: 0.75 }), 25)
assert.equal(pressureOf({ memAvailablePct: 77, memAvailableMb: 12000, loadPerCpu: 0.4 }), 14, 'a healthy 16 GB Mac reads low')
assert.equal(pressureOf({ memAvailablePct: 60, memAvailableMb: 150 }), 100, 'a small machine out of room is at the top whatever its share')
assert.equal(pressureOf({ memAvailablePct: 15, loadPerCpu: 3 }), 100, 'the worst signal wins')
for (const none of [null, undefined, 'x', {}, { memAvailablePct: null, loadPerCpu: NaN }]) assert.equal(pressureOf(none), null, 'nothing measured, nothing to draw')
{
  let checked = 0
  for (let pct = 0; pct <= 100; pct += 1.5) for (const mb of [null, 50, 150, 199, 200, 399, 400, 600, 799, 800, 4000]) for (const cpu of [null, 0, 0.7, 1.49, 1.5, 2, 2.49, 2.5, 6]) {
    const sample = { memAvailablePct: pct, memAvailableMb: mb, loadPerCpu: cpu }
    const level = levelOf(sample).level
    const g = pressureOf(sample)
    if (level === 'high') assert.equal(g, 100, JSON.stringify(sample))
    else if (level === 'busy') assert.ok(g >= 50 && g <= 99, JSON.stringify(sample) + ' -> ' + g)
    else assert.ok(g <= 50, JSON.stringify(sample) + ' -> ' + g)
    checked += 1
  }
  assert.ok(checked > 1500)
}
ok('gauge: 50 at busy, 100 at high, never out of step with the level (over a grid)')

// 2. the room at each level
assert.equal(allowedAt('ok', 3), 3)
assert.equal(allowedAt('busy', 3), 1)
assert.equal(allowedAt('busy', 1), 1)
assert.equal(allowedAt('high', 3), 0)
assert.equal(allowedAt('ok', undefined), DEFAULT_MAX_PARALLEL)
assert.equal(allowedAt('ok', 0), DEFAULT_MAX_PARALLEL, 'a nonsense maximum falls back to the default')
assert.deepEqual(LEVELS, ['ok', 'busy', 'high'])
ok('room: full when free, one when busy, none when high')

// 3. the maximum from the environment
assert.equal(maxParallelFrom({}), DEFAULT_MAX_PARALLEL)
assert.equal(maxParallelFrom({ KYBERNOS_AUTOMATION_MAX_PARALLEL: '2' }), 2)
assert.equal(maxParallelFrom({ KYBERNOS_AUTOMATION_MAX_PARALLEL: ' 5 ' }), 5)
assert.equal(maxParallelFrom({ KYBERNOS_AUTOMATION_MAX_PARALLEL: '999' }), MAX_PARALLEL_CEILING)
for (const bad of ['0', '-1', '2.5', 'many', '', '1e3']) assert.equal(maxParallelFrom({ KYBERNOS_AUTOMATION_MAX_PARALLEL: bad }), DEFAULT_MAX_PARALLEL, JSON.stringify(bad))
assert.equal(maxParallelFrom(null), DEFAULT_MAX_PARALLEL)
ok('maximum: a whole number from 1 to the ceiling, else the default')

assert.equal(guardOff({ KYBERNOS_AUTOMATION_LOAD_GUARD: 'off' }), true)
assert.equal(guardOff({ KYBERNOS_AUTOMATION_LOAD_GUARD: ' OFF ' }), true)
for (const v of [{}, null, undefined, { KYBERNOS_AUTOMATION_LOAD_GUARD: 'on' }, { KYBERNOS_AUTOMATION_LOAD_GUARD: '' }, { KYBERNOS_AUTOMATION_LOAD_GUARD: 0 }]) assert.equal(guardOff(v), false)
ok('guard: only an explicit "off" turns the machine reading off')

// 4. /proc/meminfo
assert.equal(parseMeminfo('MemTotal:       16384000 kB\nMemFree:          123456 kB\nMemAvailable:    8192000 kB\nBuffers: 1 kB\n'), 8000)
assert.equal(parseMeminfo('MemTotal: 1 kB\nMemFree: 2 kB\n'), null, 'no MemAvailable line (a very old kernel): unknown, not MemFree')
for (const bad of [null, undefined, 7, '']) assert.equal(parseMeminfo(bad), null)
ok('meminfo: MemAvailable in MB, never MemFree')

// 5. admit: oldest first, as many as there is room for
{
  const due = [{ id: 'c', dueMs: 300 }, { id: 'a', dueMs: 100 }, { id: 'b', dueMs: 200 }]
  assert.deepEqual(admit({ allowed: 2, inFlight: 0 }, due, 1000), ['a', 'b'])
  assert.deepEqual(admit({ allowed: 3, inFlight: 1 }, due, 1000), ['a', 'b'])
  assert.deepEqual(admit({ allowed: 9, inFlight: 0 }, due, 1000), ['a', 'b', 'c'])
  assert.deepEqual(admit({ allowed: 2, inFlight: 2 }, due, 1000), [], 'no room, and nothing has waited long')
  assert.deepEqual(admit({ allowed: 0, inFlight: 0 }, due, 1000), [])
  assert.deepEqual(admit(null, due, 1000), ['a', 'b', 'c'], 'no capacity figure: no limit')
  assert.deepEqual(admit({ allowed: 2, inFlight: 0 }, [], 1000), [])
  assert.deepEqual(admit({ allowed: 2, inFlight: 0 }, null, 1000), [])
  assert.deepEqual(admit({ allowed: 1, inFlight: 0 }, [{ id: 'x' }, { id: 'y', dueMs: 5 }], 10), ['x'], 'a run with no due time is treated as oldest')
  assert.equal(due[0].id, 'c', 'the caller\'s list is not reordered')
  ok('admit: oldest first, the room left after the runs going')
}

// 6. admit: a run is never held for ever
{
  const t0 = 1000000
  const waited = [{ id: 'old', dueMs: t0 - HOLD_LIMIT_MS - 1 }, { id: 'new', dueMs: t0 - 1000 }]
  assert.deepEqual(admit({ allowed: 0, inFlight: 0 }, waited, t0), ['old'], 'over the limit: one starts even when the machine is high')
  assert.deepEqual(admit({ allowed: 3, inFlight: 3 }, waited, t0), ['old'], 'over the limit: one starts even when every slot is taken')
  assert.deepEqual(admit({ allowed: 0, inFlight: 0 }, [{ id: 'edge', dueMs: t0 - HOLD_LIMIT_MS }], t0), [], 'exactly at the limit it still waits')
  ok('admit: a run held more than ten minutes starts anyway')
}

// 7. the runs going
{
  let t = 0
  const f = createInflight({ now: () => t })
  f.start('s1'); f.start('s2')
  assert.equal(f.count(), 2, 'counted from the moment the session exists')
  f.status('s1', true)
  f.status('s1', false)
  assert.equal(f.count(), 1, 'a run the engine reports idle after running is done')
  f.status('s2', false)
  assert.equal(f.count(), 1, 'idle before it ever ran is not an end (it has not started yet)')
  f.status('unknown', true); f.status('unknown', false)
  assert.equal(f.count(), 1, 'a session this host did not start is ignored')
  t += START_GRACE_MS + 1
  assert.equal(f.count(), 0, 'a run that never started stops being counted')
  f.start('s3'); f.status('s3', true)
  t += RUN_MAX_MS - 1000
  assert.equal(f.count(), 1, 'a long run is counted while it runs')
  t += 2000
  assert.equal(f.count(), 0, 'an end event that never came does not hold a slot for ever')
  f.start('s4'); f.end('s4')
  assert.equal(f.count(), 0, 'disposed')
  for (const bad of [null, undefined, '', 7, {}]) f.start(bad)
  assert.equal(f.count(), 0, 'a bad id is not counted')
  for (let i = 0; i < 600; i += 1) f.start('x' + i)
  assert.ok(f.count() <= 500, 'bounded')
  ok('in flight: counted from creation, ends on idle or disposed, every doubt resolves to not counted')
}

// 8. the page's view carries figures and nothing else
{
  const v = publicView({ level: 'busy', reasons: ['memory', 'cpu', '/Users/x/secret'], inFlight: 1, allowed: 1, maxParallel: 3 }, { memAvailablePct: 15.4, loadPerCpu: 1.2345, path: '/x' }, 4)
  assert.deepEqual(v, { level: 'busy', pressure: 73, reasons: ['memory', 'cpu'], inFlight: 1, allowed: 1, maxParallel: 3, waiting: 4, memAvailablePct: 15, loadPerCpu: 1.23 })
  assert.equal(publicView({ level: 'ok', guard: 'off' }, { memAvailablePct: 1, loadPerCpu: 9 }, 0).pressure, null, 'a switched-off reading draws no gauge that would contradict the level')
  assert.equal(publicView({ level: 'ok' }, {}, 0).pressure, null, 'nothing measured, no gauge')
  assert.equal(publicView({ level: 'weird' }, null, -3).level, 'ok')
  assert.equal(publicView({}, {}, undefined).waiting, 0)
  assert.equal(publicView({}, {}, 0).memAvailablePct, null)
  ok('public view: a level, reasons from a closed list, figures; no path')
}

// 9. wiring: the host asks before it fires, follows the engine's status, serves a read-only route; the page shows it
{
  const idx = readFileSync(join(here, 'index.js'), 'utf8')
  assert.ok(/from '\.\/automation-load\.mjs'/.test(idx), 'index.js imports the rules')
  assert.ok(/kbMakeTrigger\(\{[\s\S]{0,400}capacity: kbLoadCapacity,[\s\S]{0,60}admit: autoLoadAdmit/.test(idx), 'the trigger is given the capacity and the admission rule')
  assert.ok(/kbLoadInflight\.start\(sessionId\)/.test(idx), 'a run is counted when its session is created')
  assert.ok(/ctx\.on\('agent\/status'[\s\S]{0,300}kbLoadInflight\.status\(/.test(idx), 'the engine\'s status ends a run')
  assert.ok(/ctx\.on\('agent\/disposed'[\s\S]{0,300}kbLoadInflight\.end\(/.test(idx), 'a disposed session ends a run')
  assert.ok(/autoLoadGuardOff\(process\.env\)/.test(idx), 'the off switch is honoured')
  assert.ok(/kern\.memorystatus_level/.test(idx), 'macOS memory is the system\'s pressure figure')
  assert.ok(/plat === 'darwin'[\s\S]{0,700}resolve\(\{ pct: null, mb: null \}\)/.test(idx), 'macOS never falls back to os.freemem (it reads ~10 % on a healthy Mac)')
  const route = /path: '\/kybernos\/automation-load'[\s\S]{0,1600}/.exec(idx)
  assert.ok(route !== null, 'the route exists')
  assert.ok(/req\.method !== 'GET'/.test(route[0]) && /sameOriginStrict\(req\)/.test(route[0]), 'read-only and same origin')
  assert.ok(/autoLoadView\(/.test(route[0]), 'the answer goes through the public view')
  const cli = readFileSync(join(here, 'client.js'), 'utf8')
  assert.ok(/fetch\('\/kybernos\/automation-load'/.test(cli), 'the page reads the load')
  assert.ok(/const KbLoadGauge = [\s\S]{0,1400}role: 'meter'[\s\S]{0,400}aria-valuenow/.test(cli), 'the gauge is a meter with its value')
  assert.ok(/h\(KbLoadGauge, \{ load: ld \}\)/.test(cli) && /h\(KbLoadGauge, \{ load: ml \}\)/.test(cli), 'the gauge is on the settings row and in the board banner')
  assert.ok(/const heldByLoad = [\s\S]{0,260}ml\.inFlight >= ml\.allowed/.test(cli) && /heldByLoad === true \? 'tasks\.board\.st\.load' : 'tasks\.board\.st\.due'/.test(cli), 'a due card held by the cap says so, not "the scheduler starts it"')
  assert.ok(/if \(heldByLoad === true\) \{[\s\S]{0,260}tasks\.board\.load\.title/.test(cli), 'the banner says "waiting for the computer" when the cap holds the runs')
  ok('host wiring: asked before firing, followed through agent/status, read-only route; the page reads it')
}

console.log('\n' + pass + ' checks passed')
