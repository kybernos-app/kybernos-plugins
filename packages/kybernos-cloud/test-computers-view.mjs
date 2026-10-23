#!/usr/bin/env node
/** The person's cloud computers as the laptop's page shows them (computers-view.mjs) and the route that serves them (index.js).
 *  Usage: node packages/kybernos-cloud/test-computers-view.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stateOf, loadOf, computerOf, computersOf, LOAD_FRESH_MS } from './computers-view.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const NOW = Date.parse('2026-10-23T12:00:00Z')
const UUID_A = '3f2a1c10-0000-4000-8000-000000000001'
const UUID_B = '3f2a1c10-0000-4000-8000-000000000002'
const load = (extra = {}) => ({ level: 'busy', pressure: 71, cpu_per_core: 1.12345, mem_avail_mb: 310, mem_total_mb: 980, running: 1, waiting: 1, allowed: 1, running_tasks: [{ task_ref: 'st-1', started_at: '2026-10-23T11:58:30Z' }], ...extra })
const row = (extra = {}) => ({ id: UUID_A, name: 'Home', kind: 'cloud', state: 'running', shape: '1x1g', mode: 'sleep', paused_reason: null, load: load(), ...extra })

// 1. the server's states, in the page's words
for (const [state, word] of [['running', 'awake'], ['suspended', 'asleep'], ['creating', 'waking'], ['resuming', 'waking'], ['suspending', 'winding_down'], ['stopped', 'off'], ['failed', 'off'], ['deleting', 'off']]) assert.equal(stateOf({ state }), word, state)
for (const odd of [null, undefined, {}, { state: 'weird' }, { state: 3 }, 'running']) assert.equal(stateOf(odd), 'off', JSON.stringify(odd))
ok('states: awake, asleep, waking, winding down, off; anything else is off')
// what the computer said it can do
assert.deepEqual(computerOf(row({ capabilities: ['ask_approvals', 'ask_approvals', 'Bad Cap', 7, 'x'.repeat(40), 'other_thing'] }), NOW).capabilities, ['ask_approvals', 'other_thing'], 'a closed list of short words, once each')
assert.deepEqual(computerOf(row(), NOW).capabilities, [], 'a computer that said nothing can do nothing more')
assert.deepEqual(computerOf(row({ capabilities: 'ask_approvals' }), NOW).capabilities, [])
assert.equal(computerOf(row({ capabilities: Array.from({ length: 20 }, (_, i) => 'cap_' + String.fromCharCode(97 + i)) }), NOW).capabilities.length, 8)
ok('capabilities: a closed list of short words, at most eight')

// 2. the load: numbers from a closed list, a running task is an id and a moment
assert.deepEqual(loadOf(row(), NOW), { level: 'busy', pressure: 71, cpuPerCore: 1.12, memAvailMb: 310, memTotalMb: 980, running: 1, waiting: 1, allowed: 1, runningTasks: [{ taskRef: 'st-1', startedAt: '2026-10-23T11:58:30.000Z' }] })
assert.deepEqual(loadOf(row({ load: load({ running_tasks: undefined }), running_tasks: [{ task_ref: 'st-2', started_at: '2026-10-23T11:59:00Z' }] }), NOW).runningTasks, [{ taskRef: 'st-2', startedAt: '2026-10-23T11:59:00.000Z' }], 'a server that puts the tasks beside the load is read too')
for (const bad of [null, undefined, 'x', {}, row({ load: null }), row({ load: 'busy' }), row({ load: load({ level: 'weird' }) }), row({ load: load({ level: 'ok\nrm' }) }), row({ load: load({ pressure: null }) }), row({ load: load({ pressure: 'high' }) })]) assert.equal(loadOf(bad, NOW), null, JSON.stringify(bad))
const wild = loadOf(row({ load: load({ pressure: 900, cpu_per_core: 500, mem_avail_mb: -5, mem_total_mb: 0, running: 9999, waiting: -3, allowed: 'x', running_tasks: [...Array(12).keys()].map((i) => ({ task_ref: 'st-' + i, started_at: '2026-10-23T11:59:00Z' })).concat([{ task_ref: 'bad id', started_at: '2026-10-23T11:59:00Z' }, { task_ref: 'st-x', started_at: 'never' }, null]) }) }), NOW)
assert.deepEqual({ ...wild, runningTasks: wild.runningTasks.length }, { level: 'busy', pressure: 100, cpuPerCore: 64, memAvailMb: 0, memTotalMb: 1, running: 64, waiting: 0, allowed: 0, runningTasks: 8 }, 'everything is clamped, at most eight running tasks, a bad id or date is left out')
assert.equal(loadOf(row({ load_at: '2026-10-23T11:58:00Z' }), NOW) === null, false, '2 minutes old is shown')
assert.equal(loadOf(row({ load_at: new Date(NOW - LOAD_FRESH_MS - 1000).toISOString() }), NOW), null, 'older than 150 s is not shown')
assert.equal(loadOf(row({ load_at: 'yesterday' }), NOW), null, 'an unreadable date is not trusted')
assert.equal(loadOf(row({ heartbeat_at: new Date(NOW - 60_000).toISOString() }), NOW) === null, false, 'the server names the beat\'s date: a minute old is shown')
assert.equal(loadOf(row({ heartbeat_at: new Date(NOW - LOAD_FRESH_MS - 1000).toISOString() }), NOW), null, 'a beat older than 150 s, whatever `load` says, is not shown')
assert.equal(loadOf(row({ heartbeat_at: null }), NOW) === null, false, 'no date at all: the server\'s own 2-minute rule is trusted')
ok('load: closed levels, clamped numbers, running tasks by id, stale or odd readings not shown')

// 3. one computer
const home = computerOf(row(), NOW)
assert.deepEqual({ ...home, load: home.load === null ? null : 'load' }, { id: UUID_A, name: 'Home', isHome: true, state: 'awake', memoryMb: 1024, mode: 'sleep', paused: null, capabilities: [], load: 'load' })
assert.equal(computerOf(row({ shape: '1x2g' }), NOW).memoryMb, 2048)
assert.equal(computerOf(row({ shape: '2x4g' }), NOW).memoryMb, null, 'a size the page does not know is not guessed')
assert.equal(computerOf(row({ state: 'suspended' }), NOW).load, null, 'an asleep computer has no live reading')
assert.equal(computerOf(row({ state: 'creating' }), NOW).load, null)
assert.equal(computerOf(row({ name: '  <b>Pros\u0000pection</b>\n ' + 'x'.repeat(100) }), NOW).name.length <= 60, true)
assert.ok(!/[<>\u0000]/u.test(computerOf(row({ name: '<b>A\u0000B</b>' }), NOW).name), 'no markup and no control character in a name')
assert.equal(computerOf(row({ name: '   ' }), NOW).name, 'Computer')
assert.equal(computerOf(row({ mode: 'always' }), NOW).mode, 'always')
assert.equal(computerOf(row({ paused_reason: 'hours' }), NOW).paused, 'hours')
assert.equal(computerOf(row({ paused_reason: 'x'.repeat(80) }), NOW).paused, null)
assert.deepEqual(Object.keys(home).sort(), ['capabilities', 'id', 'isHome', 'load', 'memoryMb', 'mode', 'name', 'paused', 'state'], 'a closed set of fields')
const text = JSON.stringify(computerOf(row({ origin_host: 'home-3f2a.computers.kybernos.app', image_ref: 'secret-image', schedule: [{ id: 'st-1', label: 'My private label' }], network: { allow: ['x.test'] } }), NOW))
for (const never of ['computers.kybernos.app', 'secret-image', 'My private label', 'x.test', 'owner', 'workspace']) assert.ok(!text.includes(never), never)
ok('one computer: a closed set of fields, a clipped clean name, a size only when known, no host, image or schedule')

// 4. the list
const list = computersOf([row({ id: UUID_B, name: 'Prospection' }), row(), row({ id: 'bad id', name: 'Nope' }), row({ id: 'z-1', name: 'Alpha', kind: 'local' }), row({ id: 'z-2', name: 'Beta' }), null, 'x', { name: 'no id' }], NOW)
assert.deepEqual(list.map((c) => c.name), ['Home', 'Beta', 'Prospection'], 'Home first, the others by name; a bad id, a local row and junk are left out')
assert.equal(computersOf([...Array(30).keys()].map((i) => row({ id: 'c-' + i, name: 'C' + String(i).padStart(2, '0') })), NOW).length, 12, 'at most twelve')
for (const none of [null, undefined, 'x', {}, []]) assert.deepEqual(computersOf(none, NOW), [])
ok('list: Home first, kind cloud only, valid ids only, at most twelve')

// 5. the route: read-only, same origin, in the table, behind the connection
{
  const idx = readFileSync(join(here, 'index.js'), 'utf8')
  assert.ok(/import \{ computersOf \} from '\.\/computers-view\.mjs'/.test(idx), 'index.js imports the view')
  assert.ok(/\{ path: '\/kybernos-cloud\/computers', method: 'GET', guarded: true, run: computersRoute \}/.test(idx), 'a guarded GET in the route table, never a write')
  assert.ok(!/path: '\/kybernos-cloud\/computers', method: '(POST|PUT|DELETE)'/.test(idx), 'no write on the list')
  const fn = /const computersRoute = async \(\) => \{[\s\S]{0,2200}?\n\}\n/.exec(idx)
  assert.ok(fn !== null, 'the route function is where the test looks for it')
  assert.ok(/if \(!isConnected\(state\)\) return \{ ok: true, connected: false, computers: \[\] \}/.test(fn[0]), 'not connected: an empty list, no call')
  assert.ok(/Date\.now\(\) - computersAnswer\.at < 8000/.test(fn[0]) && /computersAnswer\.token === state\.token/.test(fn[0]), 'one answer shared for 8 s, per account token')
  assert.ok(/error: 'unavailable'/.test(fn[0]) && !/res\.body|c\.body\.error|String\(c\.body/.test(fn[0]), 'a failure is a short code, never the server\'s words')
  assert.ok(/computersOf\(c\.body\.computers, Date\.now\(\)\)/.test(fn[0]), 'the rows go through the closed view')
  ok('route: a guarded GET, an empty list when not connected, shared for 8 s, a short code on failure, rows through the closed view')
}

console.log('\n' + pass + ' checks passed')
