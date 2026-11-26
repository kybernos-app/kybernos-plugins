// scripts/mutation-check.mjs on a small fixture git repo made in a temp folder: a mutation the test catches (killed, exit 0), one it does not (survived,
// exit 1), a package test run from its own folder, the refusals (--from not exactly once, a test red before the mutation, a temp folder inside the repo),
// and the real repo left as it was with no temp copy left behind.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanRel, howToRun, occurrences } from './mutation-check.mjs'

let passed = 0
const ok = (name, fn) => { fn(); passed += 1; console.log('  ok ' + name) }
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'mutation-check.mjs')

ok('paths stay in the repo, occurrences are counted, a test runs where CI runs it', () => {
  assert.equal(cleanRel('scripts/./a.mjs'), 'scripts/a.mjs')
  assert.equal(cleanRel('../a.mjs'), null)
  assert.equal(cleanRel('/etc/passwd'), null)
  assert.equal(cleanRel('.git/config'), null)
  assert.equal(cleanRel('packages/p/node_modules/x.js'), null)
  assert.equal(occurrences('a + b; a + b', 'a + b'), 2)
  assert.equal(occurrences('abc', ''), 0)
  assert.deepEqual(howToRun('scripts/test-x.mjs'), { cwd: '', args: ['scripts/test-x.mjs'] })
  assert.deepEqual(howToRun('packages/p/test-y.mjs'), { cwd: 'packages/p', args: ['test-y.mjs'] })
  assert.deepEqual(howToRun('packages/m/test/a.test.mjs'), { cwd: 'packages/m', args: ['--test', 'test/a.test.mjs'] })
})

const work = realpathSync(mkdtempSync(join(tmpdir(), 'kb-mutcheck-')))
const repo = join(work, 'repo')
const temps = join(work, 'tmp') // TMPDIR of the runs: whatever the script leaves behind shows up here
try {
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  mkdirSync(join(repo, 'packages', 'p'), { recursive: true })
  mkdirSync(join(repo, 'node_modules', 'dep'), { recursive: true })
  mkdirSync(temps)
  writeFileSync(join(repo, 'lib.mjs'), "export const add = (a, b) => a + b\nexport const label = 'sum'\n")
  writeFileSync(join(repo, 'scripts', 'test-lib.mjs'), "import assert from 'node:assert/strict'\nimport { add } from '../lib.mjs'\nassert.equal(add(2, 3), 5)\nconsole.log('lib ok')\n")
  // Run from its own folder: it reads a file relative to the package.
  writeFileSync(join(repo, 'packages', 'p', 'data.txt'), 'ready\n')
  writeFileSync(join(repo, 'packages', 'p', 'test-p.mjs'), "import assert from 'node:assert/strict'\nimport { readFileSync } from 'node:fs'\nassert.equal(readFileSync('data.txt', 'utf8').trim(), 'ready')\nconsole.log('p ok')\n")
  writeFileSync(join(repo, 'scripts', 'test-red.mjs'), "process.exit(3)\n")
  writeFileSync(join(repo, 'node_modules', 'dep', 'index.js'), 'never copied\n')
  // node_modules is tracked here on purpose (not ignored): the script must still leave it, and .git, out of the copy.
  writeFileSync(join(repo, '.gitignore'), '*.log\n')
  writeFileSync(join(repo, 'scripts', 'test-bare.mjs'), "import { existsSync } from 'node:fs'\nfor (const d of ['../node_modules', '../.git']) if (existsSync(new URL(d, import.meta.url))) { console.log('copied: ' + d); process.exit(1) }\n")
  const git = (args) => assert.equal(spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).status, 0, 'git ' + args.join(' '))
  git(['-c', 'init.defaultBranch=main', 'init', '-q'])
  git(['add', '-A'])
  // Untracked but not ignored: a test written before its commit is copied too.
  writeFileSync(join(repo, 'scripts', 'test-new.mjs'), "import { label } from '../lib.mjs'\nif (label !== 'sum') process.exit(1)\n")
  const before = readFileSync(join(repo, 'lib.mjs'), 'utf8')
  const status = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' }).stdout
  const statusBefore = status()
  const run = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: join(repo, 'packages'), encoding: 'utf8', timeout: 60000, env: { ...process.env, TMPDIR: temps, ...env } })
  const m = (from, to, test, extra = []) => run(['--file', 'lib.mjs', '--from', from, '--to', to, '--test', test, ...extra])

  ok('a mutation the test catches is killed (exit 0), with the last lines of the red run', () => {
    const r = m('a + b', 'a - b', 'scripts/test-lib.mjs')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^killed: scripts\/test-lib\.mjs/)
    assert.match(r.stdout, /expected: 5/)
  })

  ok('a mutation the test does not see survives (exit 1)', () => {
    const r = m("label = 'sum'", "label = 'total'", 'scripts/test-lib.mjs')
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^survived: /)
    assert.match(r.stdout, /lib ok/)
  })

  ok('an untracked test is copied; a package test runs from its folder', () => {
    assert.equal(m("label = 'sum'", "label = 'total'", 'scripts/test-new.mjs').status, 0, 'the new test kills the mutant the old one missed')
    const r = run(['--file', 'packages/p/data.txt', '--from', 'ready', '--to', 'gone', '--test', 'packages/p/test-p.mjs'])
    assert.equal(r.status, 0, r.stdout + r.stderr)
  })

  ok('the copy holds neither .git nor node_modules', () => {
    const r = m("label = 'sum'", "label = 'total'", 'scripts/test-bare.mjs')
    assert.equal(r.status, 1, 'green before and after (survived), so neither folder was there: ' + r.stdout)
  })

  ok('refused with exit 2: --from not exactly once (the count is said), a test red before, a path out of the repo, node_modules', () => {
    const zero = m('a * b', 'a / b', 'scripts/test-lib.mjs')
    assert.equal(zero.status, 2)
    assert.match(zero.stdout, /occurs 0 times/)
    const twice = m('a', 'z', 'scripts/test-lib.mjs')
    assert.equal(twice.status, 2)
    assert.match(twice.stdout, /occurs \d+ times/)
    const red = m('a + b', 'a - b', 'scripts/test-red.mjs')
    assert.equal(red.status, 2)
    assert.match(red.stdout, /red before the mutation/)
    assert.equal(run(['--file', '../x.mjs', '--from', 'a', '--to', 'b', '--test', 'scripts/test-lib.mjs']).status, 2)
    assert.equal(run(['--file', 'node_modules/dep/index.js', '--from', 'never', '--to', 'x', '--test', 'scripts/test-lib.mjs']).status, 2)
    assert.equal(run(['--file', 'lib.mjs']).status, 2, 'usage')
  })

  ok('a temp folder inside the repo is refused before anything is written', () => {
    const inRepo = join(repo, 'scratch-tmp')
    mkdirSync(inRepo)
    const refused = run(['--file', 'lib.mjs', '--from', 'a + b', '--to', 'a - b', '--test', 'scripts/test-lib.mjs'], { TMPDIR: inRepo })
    assert.equal(refused.status, 2)
    assert.match(refused.stdout, /inside the repo/)
    assert.deepEqual(readdirSync(inRepo), [], 'nothing written there')
    rmSync(inRepo, { recursive: true })
  })

  ok('the real repo is as it was and no temp copy is left', () => {
    assert.equal(readFileSync(join(repo, 'lib.mjs'), 'utf8'), before)
    assert.deepEqual(readdirSync(temps), [], 'every copy removed')
    assert.equal(status(), statusBefore, 'no file added or changed in the repo')
  })
} finally { rmSync(work, { recursive: true, force: true }) }

console.log('\nmutation-check: ' + passed + ' groups OK')
