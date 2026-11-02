#!/usr/bin/env node
// The soft-takeoff runner (scripts/soft-takeoff-run.mjs) on a fixture plan: every verdict, the retry, the canaries, the refusals and the STOP file. No browser, no DSH.
//
//   node scripts/test-soft-takeoff-run.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUN = join(REPO, 'scripts/soft-takeoff-run.mjs')
const work = mkdtempSync(join(tmpdir(), 'kb-takeoff-run-'))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + detail)) } }

const mark = join(work, 'flaky-mark')
const c = (id, cmd, o = {}) => ({ id, wave: id.slice(0, 2), prio: 'P0', title: id, runner: 'script', cmd, env: 'none', personas: ['A'], status: 'ready', ...o })
const plan = { waves: { W9: 'fixture' }, cases: [
  c('W9-01', 'node -e "console.log(1)"', { light: true }),
  c('W9-02', 'node -e "console.log(\'broken\'); process.exit(1)"'),
  c('W9-03', 'node -e "process.exit(3)"'),
  c('W9-04', 'node -e "setTimeout(() => {}, 20000)"', { timeout: 1 }),
  c('W9-05', `test -f ${mark} || { touch ${mark}; exit 1; }`),
  c('W9-06', 'node -e "process.exit(0)"', { expect: 'pass' }),
  c('W9-07', 'node -e "process.exit(1)"', { expect: 'fail' }),
  c('W9-08', 'node -e "process.exit(0)"', { expect: 'fail' }),
  c('W9-09', 'node -e "process.exit(0)"', { status: 'needs-build' }),
] }
writeFileSync(join(work, 'cases.json'), JSON.stringify(plan))
const run = (args, env = {}) => spawnSync(process.execPath, [RUN, '--plan', join(work, 'cases.json'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
const verdict = (dir, id) => JSON.parse(readFileSync(join(dir, id + '.json'), 'utf8'))

try {
  const out = join(work, 'out')
  const r = run(['--out', out, '--retry', '1'])
  check('a failing case makes the run exit 1, a clean run does not', r.status === 1 && run(['--out', join(work, 'out-ok'), '--cases', 'W9-01']).status === 0)
  check('exit 0 is pass, exit 1 is fail with the printed line kept', verdict(out, 'W9-01').verdict === 'pass' && verdict(out, 'W9-02').verdict === 'fail' && verdict(out, 'W9-02').last_lines.includes('broken'))
  check('exit 3 is blocked, not fail', verdict(out, 'W9-03').verdict === 'blocked')
  check('a case past its own timeout is a timeout, killed', verdict(out, 'W9-04').verdict === 'timeout' && verdict(out, 'W9-04').ms < 10000)
  check('fail then pass on the single retry is flaky, with two attempts', verdict(out, 'W9-05').verdict === 'flaky' && verdict(out, 'W9-05').attempts === 2)
  check('a canary that gets the verdict it expects is ok, a wrong one is flagged', verdict(out, 'W9-06').canary.ok && verdict(out, 'W9-07').canary.ok && verdict(out, 'W9-08').canary.ok === false)
  const sum = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'))
  check('a wrong canary counts as red; flaky and blocked do not', sum.red.includes('W9-08') && sum.red.includes('W9-02') && !sum.red.includes('W9-05') && !sum.red.includes('W9-03'))
  check('a case that is not « ready » is skipped unless --force', !existsSync(join(out, 'W9-09.json')) && existsSync(join(work, 'out-force', 'W9-09.json')) === false && (run(['--out', join(work, 'out-force'), '--cases', 'W9-09', '--force']), existsSync(join(work, 'out-force', 'W9-09.json'))))
  check('--light runs only the light cases', (run(['--out', join(work, 'out-light'), '--light']), !existsSync(join(work, 'out-light', 'W9-02.json')) && existsSync(join(work, 'out-light', 'W9-01.json'))))
  check('the repository is reported untouched by a harmless case', verdict(out, 'W9-01').repo_clean === true)
  check('the log of a case is kept beside its verdict', existsSync(join(out, 'W9-02.log')))

  const stopDir = join(work, 'out-stop')
  mkdirSync(stopDir)
  writeFileSync(join(stopDir, 'STOP'), '')
  check('a STOP file ends the run before the first case', run(['--out', stopDir]).stdout.includes('STOP') && !existsSync(join(stopDir, 'W9-01.json')))

  check('refuses an output folder inside the repository', run(['--out', join(REPO, 'docs/tests/soft-takeoff/evidence')]).status === 2)
  check('refuses to run with no output folder', run([]).status === 2)
  check('refuses when KB_HOST is the real DSH', run(['--out', join(work, 'out-real')], { KB_HOST: '127.0.0.1:3080' }).status === 2 && !existsSync(join(work, 'out-real')))
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
