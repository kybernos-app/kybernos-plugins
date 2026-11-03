#!/usr/bin/env node
// The walk driver of the soft-takeoff recette (scripts/takeoff-walk.mjs): its step list is validated, its page script is well formed, and it refuses what it must.
// No browser, no network.
//
//   node scripts/test-takeoff-walk.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOOK_SCRIPT, checkSteps, findScript } from './takeoff-walk.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + detail)) } }

check('a good list is accepted', checkSteps([{ open: '/' }, { click: 'Settings' }, { settings: 'Language' }, { type: 'hello' }, { key: 'Escape' }, { wait: 500 }, { look: 'home' }, { shot: 'home' }]).length === 0)
check('an empty list is refused', checkSteps([]).length === 1 && checkSteps('x').length === 1)
check('a step with two kinds, or none, is refused', checkSteps([{ open: '/', click: 'x' }]).length === 1 && checkSteps([{ go: '/' }]).length === 1)
check('open takes a path on the sandbox only', checkSteps([{ open: 'http://example.com' }]).length === 1 && checkSteps([{ open: '//example.com' }]).length === 1)
check('wait is bounded', checkSteps([{ wait: 31000 }]).length === 1 && checkSteps([{ wait: -1 }]).length === 1)
check('an unknown key is refused', checkSteps([{ key: 'F5' }]).length === 1)
check('a shot name cannot climb out of the folder', checkSteps([{ shot: '../x' }]).length === 1)
check('a walk of more than 200 steps is refused', checkSteps(Array.from({ length: 201 }, () => ({ wait: 1 }))).length === 1)

let parses = true
try { new Function('return ' + LOOK_SCRIPT) } catch (e) { parses = false }
check('the page script of a look is well formed', parses)
let finds = true
try { new Function('return ' + findScript('it\'s « Continue »')) } catch (e) { finds = false }
check('the page script of a click is well formed, whatever the text', finds)

const dir = mkdtempSync(join(tmpdir(), 'walk-test-'))
try {
  const steps = join(dir, 'steps.json')
  writeFileSync(steps, JSON.stringify([{ open: '/' }]))
  const run = (env, args) => spawnSync('node', [join(REPO, 'scripts/takeoff-walk.mjs'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } })
  check('it refuses to run without KB_HOST', run({}, ['--steps', steps, '--out', dir]).status === 2)
  check('it refuses the owner\'s own DSH', run({ KB_HOST: '127.0.0.1:3080' }, ['--steps', steps, '--out', dir]).status === 2)
  check('it refuses an output folder inside the repository', run({ KB_HOST: '127.0.0.1:3098' }, ['--steps', steps, '--out', join(REPO, 'docs/tests/walk')]).status === 2)
  writeFileSync(steps, JSON.stringify([{ open: 'http://example.com' }]))
  check('it refuses a bad step list before opening a browser', run({ KB_HOST: '127.0.0.1:3098' }, ['--steps', steps, '--out', dir]).status === 2)
} finally { rmSync(dir, { recursive: true, force: true }) }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
