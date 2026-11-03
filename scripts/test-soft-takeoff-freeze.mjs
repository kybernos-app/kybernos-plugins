#!/usr/bin/env node
// The freeze applier (scripts/soft-takeoff-freeze.mjs): what it removes, what it keeps, that it can be undone, and that it refuses a profile that is not a sandbox's. No DSH.
//
//   node scripts/test-soft-takeoff-freeze.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freeze } from './soft-takeoff-freeze.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUN = join(REPO, 'scripts/soft-takeoff-freeze.mjs')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + detail)) } }

const names = { 'kybernos-plugin': '@local/kybernos', 'kybernos-pulse': '@local/kybernos-pulse', 'kybernos-theme': '@local/kybernos-theme', 'kybernos-kyber': '@local/kybernos-kyber' }
const plan = { bundles: { 'kybernos-plugin': { state: 'on' }, 'kybernos-pulse': { state: 'off' }, 'kybernos-kyber': { state: 'off' }, 'kybernos-theme': { state: 'on' }, messaging: { state: 'service' }, 'kybernos-nope': { state: 'off' } } }
const bundles = ['@deepseek-ai/dsh-base', '@local/kybernos', '@local/kybernos-pulse', '@local/kybernos-theme']

const r = freeze(bundles, plan, (d) => names[d])
check('a bundle marked off is taken out, the others and the engine\'s own stay', JSON.stringify(r.next) === JSON.stringify(['@deepseek-ai/dsh-base', '@local/kybernos', '@local/kybernos-theme']) && r.removed.join() === '@local/kybernos-pulse')
check('an off bundle the profile never had is reported absent, not an error; a service is left alone', r.absent.includes('@local/kybernos-kyber') && r.absent.includes('kybernos-nope') && !r.next.includes('messaging'))
check('applying it twice gives the same list', JSON.stringify(freeze(r.next, plan, (d) => names[d]).next) === JSON.stringify(r.next))

const root = mkdtempSync(join(tmpdir(), 'kb-freeze-'))
try {
  const prof = join(root, '.kybernos-sandbox', 'wt', 'home', '.dsh', 'profiles', 'web')
  mkdirSync(prof, { recursive: true })
  const file = join(prof, 'package.json')
  const original = JSON.stringify({ name: 'p', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@local/kybernos', '@local/kybernos-pulse', '@local/kybernos-theme'], patchReload: true } } }, null, 2) + '\n'
  writeFileSync(file, original)
  writeFileSync(join(root, 'plan.json'), JSON.stringify({ bundles: { 'kybernos-pulse': { state: 'off' }, 'kybernos-plugin': { state: 'on' } } }))
  const run = (args) => spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8' })
  check('--dry-run writes nothing', run(['--profile', prof, '--plan', join(root, 'plan.json'), '--dry-run']).status === 0 && readFileSync(file, 'utf8') === original)
  // the real packages/ folder gives the names: the plan above names real directories, so pulse really leaves
  const ran = run(['--profile', prof, '--plan', join(root, 'plan.json')])
  const after = JSON.parse(readFileSync(file, 'utf8'))
  check('a real run removes the bundle and keeps the rest of the file', ran.status === 0 && !after.dsh.profile.bundles.includes('@local/kybernos-pulse') && after.dsh.profile.bundles.includes('@local/kybernos') && after.dsh.profile.patchReload === true, ran.stdout + ran.stderr)
  check('the first run keeps the original beside the file', readFileSync(file + '.takeoff-orig', 'utf8') === original)
  run(['--profile', prof, '--plan', join(root, 'plan.json')])
  check('a second run does not overwrite that backup', readFileSync(file + '.takeoff-orig', 'utf8') === original)
  check('--undo puts the original back', run(['--profile', prof, '--undo']).status === 0 && readFileSync(file, 'utf8') === original)

  const outside = join(root, 'web')
  mkdirSync(outside)
  writeFileSync(join(outside, 'package.json'), original)
  check('refuses a profile that is not inside a .kybernos-sandbox folder', run(['--profile', outside]).status === 2 && readFileSync(join(outside, 'package.json'), 'utf8') === original)
  check('refuses the real DSH profile path even when it does not exist here', run(['--profile', join(root, '.dsh', 'profiles', 'web')]).status === 2)
  check('refuses with no --profile', run([]).status === 2)
  check('undoing twice is harmless', run(['--profile', join(root, '.kybernos-sandbox', 'wt', 'home', '.dsh', 'profiles', 'web'), '--undo']).status === 0 && existsSync(file + '.takeoff-orig'))
} finally {
  rmSync(root, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
