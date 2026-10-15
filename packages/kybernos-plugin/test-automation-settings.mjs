#!/usr/bin/env node
/** Rules of the Automations settings (automation-settings.mjs) and their wiring in index.js and client.js.
 *  Usage: node packages/kybernos-plugin/test-automation-settings.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaults, normalize, publicView, apply, isPaused, KEYS } from './automation-settings.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))

// 1. defaults and normalisation
assert.deepEqual(defaults(), { version: 1, showNativeTasks: false, paused: false })
for (const bad of [null, undefined, 'x', 7, [], [true]]) assert.deepEqual(normalize(bad), defaults(), 'a non-object reads as the defaults')
assert.deepEqual(normalize({ showNativeTasks: 'yes', paused: 1 }), defaults(), 'a wrong type reads as the default')
assert.equal(normalize({ paused: true }).paused, true)
assert.equal(normalize({ paused: true }).showNativeTasks, false, 'a missing key reads as its default')
ok('defaults, and what a damaged file reads as')

// 2. the public view carries the two switches and nothing else
assert.deepEqual(Object.keys(publicView({ showNativeTasks: true, paused: false, secret: 'x', version: 9 })).sort(), KEYS.slice().sort())
ok('the public view has only the two switches')

// 3. apply: booleans, known keys, all or nothing
{
  const a = apply(defaults(), { paused: true })
  assert.equal(a.ok, true); assert.equal(a.state.paused, true); assert.equal(a.state.showNativeTasks, false)
  const b = apply(a.state, { showNativeTasks: true, paused: false })
  assert.equal(b.ok, true); assert.equal(b.state.showNativeTasks, true); assert.equal(b.state.paused, false)
  for (const bad of [null, [], 'x', {}, { paused: 'true' }, { paused: true, other: 1 }, { version: 2 }]) assert.equal(apply(defaults(), bad).ok, false)
  assert.equal(apply(defaults(), { paused: true, other: 1 }).ok, false, 'a patch with one bad key changes nothing')
  ok('apply accepts known booleans and refuses the rest whole')
}

// 4. isPaused is fail-open
assert.equal(isPaused({ paused: true }), true)
for (const v of [null, undefined, {}, { paused: 'true' }, 'oops']) assert.equal(isPaused(v), false, 'an unreadable state never holds the scheduler')
ok('a damaged file never holds the scheduler')

// 5. wiring: the host holds the tick when paused, the route is guarded like /kybernos/tasks, the page exists
{
  const idx = readFileSync(join(here, 'index.js'), 'utf8')
  assert.ok(/from '\.\/automation-settings\.mjs'/.test(idx), 'index.js imports the rules')
  assert.ok(/const kbTasksTick = async \(\) => \{[\s\S]{0,400}autoSettingsPaused\(/.test(idx), 'the tick is held while paused')
  const route = /path: '\/kybernos\/automation-settings'[\s\S]{0,1800}/.exec(idx)
  assert.ok(route !== null, 'the route exists')
  assert.ok(/sameOriginStrict\(req\)/.test(route[0]), 'the route checks the origin')
  assert.ok(/kbTasksAuthorized\(req\)/.test(route[0]), 'a change needs the signed session, like /kybernos/tasks')
  ok('host wiring: tick held when paused, route guarded like the tasks route')
}

console.log('\n' + pass + ' checks passed')
