#!/usr/bin/env node
// The runner of the whole suite (scripts/run-all-tests.mjs) finds what CI finds and tells a red file from a flaky one, a timeout from a failure.
// Played on a throw-away tree: no real test is run.
//
//   node scripts/test-run-all-tests.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discover, runAll } from './run-all-tests.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 400)))
  if (!ok) failed += 1
}
const here = dirname(fileURLToPath(import.meta.url))

console.log('what it runs is what CI runs')
{
  const real = discover(resolve(here, '..')).map((j) => j.rel)
  const ci = readFileSync(join(here, '..', '.github', 'workflows', 'ci.yml'), 'utf8')
  check('CI still loops over scripts/test-*.mjs and packages/*/test*.mjs (this runner mirrors them)', ci.includes('scripts/test-*.mjs') && ci.includes('packages/*/test*.mjs'))
  check('it finds the repo-level tests and the plugin tests', real.some((r) => r === 'scripts/test-layout.mjs') && real.some((r) => r === 'packages/kybernos-skills/test-ui.mjs') && real.length > 200, real.length)
  check('it does not run itself (its name is not test-*, or the CI loop would start the whole suite inside the suite)', !real.includes('scripts/run-all-tests.mjs') && !/^test-/.test('run-all-tests.mjs'))
  check('a package\'s plain tests kept in test/ are run (the db viewer\'s read-only check)', real.includes('packages/dsh-db-viewer/test/test-host.mjs') && real.includes('packages/dsh-db-viewer/test/test-client.mjs'), real.filter((r) => r.includes('dsh-db-viewer')))
  check('and CI runs them, and no CI loop stops at the first red file (the files after it would never run)', ci.includes('packages/*/test/test*.mjs') && !/\|\| exit 1/.test(ci))
  check('the two standalone daemons are run by the node test runner, as CI does', real.some((r) => /^packages\/(messaging|kybernos-gate)\/test\/\*\.test\.mjs$/.test(r)), real.filter((r) => r.includes('/test/')))
  // T2-14 (2026-10-24): the six `services/computer-image/*.test.mjs` (42 tests) were in no gate, neither here nor in CI.
  check('the services\' own tests are run too (the cloud computer image has tests beside its code)', real.includes('services/computer-image/*.test.mjs'), real.filter((r) => r.startsWith('services/')))
  check('and CI runs them in a step of its own', /services\/\*\//.test(ci) && ci.includes('*.test.mjs'))
}

console.log('on a tree where one file is red, one flaky, one hangs, one says SKIPPED')
{
  const root = mkdtempSync(join(tmpdir(), 'kb-runall-'))
  try {
    const put = (rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body) }
    put('scripts/test-green.mjs', "console.log('ok')\n")
    put('scripts/helper.mjs', "throw new Error('not a test: never run')\n")
    put('packages/a/test-red.mjs', "console.log('  ✗ the thing is broken'); process.exit(1)\n")
    put('packages/a/notatest.mjs', "process.exit(1)\n")
    put('packages/b/test-flaky.mjs', "import { existsSync, writeFileSync } from 'node:fs'\nconst m = process.argv[1] + '.seen'\nif (existsSync(m)) process.exit(0)\nwriteFileSync(m, '1'); console.error('the first run said: the thing was late'); process.exit(1)\n")
    put('packages/c/test-hang.mjs', 'setInterval(() => {}, 1000)\n')
    put('packages/d/test-skip.mjs', "console.log('SKIPPED: no chrome — nothing to drive')\n")
    put('packages/e/test/test-plain.mjs', "console.log('ok')\n")
    put('packages/e/test/fixture.mjs', "throw new Error('not a test: never run')\n")
    put('packages/messaging/test/x.test.mjs', "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('x', () => assert.equal(1, 1))\n")
    put('services/svc/a.test.mjs', "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('a', () => assert.equal(1, 1))\n")
    put('services/svc/helper.mjs', "throw new Error('not a test: never run')\n")
    put('services/svc/b.test.mjs', "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('b', () => assert.equal(1, 2))\n")
    const listed = discover(root).map((j) => j.rel)
    check('it lists test files only (not a helper, not a file whose name does not start with test)', listed.includes('scripts/test-green.mjs') && listed.includes('packages/a/test-red.mjs') && !listed.some((r) => r.includes('helper') || r.includes('notatest')), listed)
    check('and the node-test folder of a daemon as one job', listed.includes('packages/messaging/test/*.test.mjs'), listed)
    check('and a plain test kept in a package\'s test/ folder, not its fixtures', listed.includes('packages/e/test/test-plain.mjs') && !listed.some((r) => r.includes('fixture')), listed)
    check('and the tests of a service as one job per service folder (not its helpers)', listed.includes('services/svc/*.test.mjs') && !listed.some((r) => r.includes('services/svc/helper')), listed)
    const seen = []
    const res = await runAll({ root, jobs: 3, timeoutMs: 1500, onDone: (job) => seen.push(job.rel) })
    check('every listed file was run', res.total === listed.length && seen.length === listed.length, [res.total, seen.length])
    check('a failing file is RED, with its last lines', res.red.some((r) => r.rel === 'packages/a/test-red.mjs' && r.tail.some((l) => l.includes('the thing is broken'))), res.red)
    check('a file that fails once and passes alone is flaky, not red', res.flaky.includes('packages/b/test-flaky.mjs') && !res.red.some((r) => r.rel.includes('flaky')), { flaky: res.flaky, red: res.red.map((r) => r.rel) })
    check('a flaky file keeps what its first run said (the only trace of a flake)', (res.flakyTails['packages/b/test-flaky.mjs'] || []).some((l) => l.includes('the thing was late')), res.flakyTails)
    check('a file that never ends is killed and is red (timeout)', res.red.some((r) => r.rel === 'packages/c/test-hang.mjs' && r.code === 'timeout'), res.red.map((r) => [r.rel, r.code]))
    check('a green file and the node-test folder are green', !res.red.some((r) => r.rel.includes('test-green') || r.rel.includes('messaging')))
    check('a service whose test fails is RED', res.red.some((r) => r.rel === 'services/svc/*.test.mjs'), res.red.map((r) => r.rel))
    check('what a test says it skipped is counted, not hidden', [...res.skips.keys()].some((s) => s.startsWith('SKIPPED: no chrome')), [...res.skips.keys()])
    check('so exactly three files are red', res.red.length === 3, res.red.map((r) => r.rel))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n' + (failed === 0 ? 'all good' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)
