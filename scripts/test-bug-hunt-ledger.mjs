// The ledger of a plugin bug hunt (scripts/bug-hunt-ledger.mjs): what it refuses, what it merges, the order, JSON Lines lane files, the command on a
// fixture hunt folder, and --verify on fixture repro scripts (exit 0, exit 1, a hang, a path outside the folder).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lastLine, ledger, locateScript, merge, parseLane, placeOf, problemsOf, readHunt, scriptOf, sorted, verifyHunt } from './bug-hunt-ledger.mjs'

let passed = 0
const ok = (name, fn) => { fn(); passed += 1; console.log('  ok ' + name) }
const F = (o) => ({ id: 'x-01', where: 'packages/a/b.mjs:10', severity: 'P2', verdict: 'bug', title: 't', repro: '', ...o })

ok('a finding needs its id, place, severity, verdict and title; a P0/P1 bug needs its repro', () => {
  assert.deepEqual(problemsOf(F({})), [])
  assert.deepEqual(problemsOf(F({ severity: 'P1', repro: 'repro/a.mjs' })), [])
  assert.ok(problemsOf(F({ severity: 'P1' })).some((p) => /needs a repro/.test(p)), 'a P1 bug without proof is refused')
  assert.deepEqual(problemsOf(F({ severity: 'P0', verdict: 'suspect' })), [], 'a suspect needs no repro')
  assert.ok(problemsOf(F({ severity: 'P3' })).some((p) => /severity/.test(p)))
  assert.ok(problemsOf(F({ verdict: 'maybe' })).some((p) => /verdict/.test(p)))
  assert.ok(problemsOf(F({ title: '' })).includes('no title'))
  assert.deepEqual(problemsOf(null), ['not an object'])
  assert.deepEqual(problemsOf([]), ['not an object'])
})

ok('the place is the first path:line named', () => {
  assert.deepEqual(placeOf('packages/kybernos-cloud/index.js:5586-5596 (session/event hook)'), { file: 'packages/kybernos-cloud/index.js', line: 5586 })
  assert.deepEqual(placeOf('scripts/run-all-tests.mjs'), { file: 'scripts/run-all-tests.mjs', line: null })
})

ok('two findings on the same file within five lines are one: worse severity, bug over suspect, both ids', () => {
  const m = merge([F({ id: 'a-1', severity: 'P2', verdict: 'suspect' }), F({ id: 'b-1', where: 'packages/a/b.mjs:14', severity: 'P1', verdict: 'bug', repro: 'r.mjs' }), F({ id: 'c-1', where: 'packages/a/b.mjs:40' })])
  assert.equal(m.length, 2)
  assert.deepEqual(m[0].ids, ['a-1', 'b-1'])
  assert.equal(m[0].severity, 'P1')
  assert.equal(m[0].verdict, 'bug')
  assert.equal(m[0].repro, 'r.mjs', 'the proof of the twin is kept')
  assert.deepEqual(m[1].ids, ['c-1'], 'thirty lines away is another finding')
  assert.equal(merge([F({ where: 'a.mjs' }), F({ id: 'y', where: 'a.mjs:3' })]).length, 2, 'a file without a line only merges with another without a line')
})

ok('worst first: severity, then bug before suspect, the fixed ones last', () => {
  const order = sorted([F({ id: 'p2' }), F({ id: 'fixed', severity: 'P0', status: 'fixed in abc' }), F({ id: 'sus', severity: 'P1', verdict: 'suspect' }), F({ id: 'p1', severity: 'P1', repro: 'r' })]).map((f) => f.id)
  assert.deepEqual(order, ['p1', 'sus', 'p2', 'fixed'])
})

ok('a hunt folder: the lane files are read, a bad file or finding is refused by name, the ledger counts and lists', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-hunt-'))
  try {
    mkdirSync(join(root, 'constats'))
    writeFileSync(join(root, 'constats', 'cloud.json'), JSON.stringify([F({ id: 'cloud-01', severity: 'P0', repro: 'repro/cloud/a.mjs', title: 'hole' }), F({ id: 'cloud-02', severity: 'P1', title: 'no proof' })]))
    writeFileSync(join(root, 'constats', 'host.json'), JSON.stringify([F({ id: 'host-01', where: 'packages/a/b.mjs:12', title: 'same place' })]))
    writeFileSync(join(root, 'constats', 'broken.json'), '{ not json')
    writeFileSync(join(root, 'constats', 'notes.md'), 'not read')
    const hunt = readHunt(root)
    assert.equal(hunt.files.length, 3)
    assert.deepEqual(hunt.findings.map((f) => f.id), ['cloud-01', 'host-01'])
    assert.deepEqual(hunt.refused.map((r) => r.file + ' ' + r.id), ['broken.json line 1', 'cloud.json cloud-02'], 'a file that is not an array is read as JSON Lines')
    const text = ledger(hunt)
    assert.match(text, /1 findings after merging 2 \(3 lane files\): P0 1 \(1 bug\)/)
    assert.match(text, /\*\*P0 bug\*\* hole .*cloud-01, host-01/)
    assert.match(text, /## Refused/)
    const here = dirname(fileURLToPath(import.meta.url))
    const run = spawnSync(process.execPath, [join(here, 'bug-hunt-ledger.mjs'), root, '--out', join(root, 'ledger.md')], { encoding: 'utf8' })
    assert.equal(run.status, 1, 'refused findings make the command exit 1')
    assert.match(run.stdout, /# Bug hunt ledger/)
    assert.equal(spawnSync(process.execPath, [join(here, 'bug-hunt-ledger.mjs'), join(root, 'nope')], { encoding: 'utf8' }).status, 2, 'no folder: exit 2')
    assert.equal(readHunt(join(root, 'nope')), null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

ok('a lane file in JSON Lines: one finding per line, a broken line refused by its number, the others kept', () => {
  const jl = [JSON.stringify(F({ id: 'l-1' })), '', '{"id": "l-2", "where": ', JSON.stringify(F({ id: 'l-3', severity: 'P1' })), JSON.stringify(F({ id: 'l-4', where: 'z.mjs:1' }))].join('\n') + '\n'
  const parsed = parseLane(jl)
  assert.deepEqual(parsed.items.map((i) => i.finding.id + '@' + i.line), ['l-1@1', 'l-3@4', 'l-4@5'])
  assert.deepEqual(parsed.broken.map((b) => b.line), [3])
  assert.match(parsed.broken[0].message, /line 3/)
  assert.deepEqual(parseLane('[' + JSON.stringify(F({})) + ']').items.map((i) => i.line), [null], 'an array is still read whole')
  assert.match(parseLane('[{"id": "cut').broken[0].message, /unreadable JSON/, 'a cut array is refused as a whole')
  const root = mkdtempSync(join(tmpdir(), 'kb-hunt-jl-'))
  try {
    mkdirSync(join(root, 'constats'))
    writeFileSync(join(root, 'constats', 'host.jsonl'), jl)
    writeFileSync(join(root, 'constats', 'cloud.json'), JSON.stringify([F({ id: 'c-1', where: 'q.mjs:1' })]))
    const hunt = readHunt(root)
    assert.deepEqual(hunt.files, ['cloud.json', 'host.jsonl'])
    assert.deepEqual(hunt.findings.map((f) => f.id + ':' + f.lane), ['c-1:cloud', 'l-1:host', 'l-4:host'])
    assert.deepEqual(hunt.refused.map((r) => r.file + ' ' + r.id), ['host.jsonl line 3', 'host.jsonl l-3'], 'the broken line by number, the P1 without proof by id')
    assert.match(ledger(hunt), /host\.jsonl line 3: unreadable JSON on line 3/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

ok('the repro script: the first .mjs named, located inside the hunt folder or refused, its last line clipped', () => {
  assert.equal(scriptOf('node repro/cloud/a.mjs then look'), 'repro/cloud/a.mjs')
  assert.equal(scriptOf('`repro/x/b.mjs` (exit 1 = bug)'), 'repro/x/b.mjs')
  assert.equal(scriptOf('open the page and press Save'), null)
  assert.equal(lastLine('a\n\nlast one  \n\n'), 'last one')
  assert.equal(lastLine('Error: boom\n    at x\n\nNode.js v26.7.0\n'), 'at x', 'the node version line after a crash says nothing')
  assert.equal(lastLine('x'.repeat(300)).length, 160)
  assert.equal(lastLine(''), '')
  const root = mkdtempSync(join(tmpdir(), 'kb-hunt-loc-'))
  const outside = mkdtempSync(join(tmpdir(), 'kb-hunt-out-'))
  try {
    mkdirSync(join(root, 'repro'))
    writeFileSync(join(root, 'repro', 'a.mjs'), '')
    writeFileSync(join(outside, 'evil.mjs'), '')
    symlinkSync(join(outside, 'evil.mjs'), join(root, 'repro', 'link.mjs'))
    assert.equal(locateScript(root, 'repro/a.mjs').file, join(root, 'repro', 'a.mjs'))
    assert.equal(locateScript(root, join(root, 'repro', 'a.mjs')).file, join(root, 'repro', 'a.mjs'), 'an absolute path inside is fine')
    assert.ok(locateScript(root, '../' + outside.split('/').pop() + '/evil.mjs').refused, 'a relative path that climbs out is refused')
    assert.ok(locateScript(root, join(outside, 'evil.mjs')).refused, 'an absolute path outside is refused')
    assert.match(locateScript(root, 'repro/link.mjs').refused, /link/, 'a link that points outside is refused')
    assert.deepEqual(locateScript(root, 'repro/none.mjs'), { missing: true })
    assert.ok(locateScript(root, '../nowhere/none.mjs').refused, 'outside is refused before asking whether it exists')
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) }
})

const here = dirname(fileURLToPath(import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'kb-hunt-verify-'))
const outside = mkdtempSync(join(tmpdir(), 'kb-hunt-verify-out-'))
try {
  mkdirSync(join(root, 'constats'))
  mkdirSync(join(root, 'repro', 'lane'), { recursive: true })
  const marker = join(outside, 'ran')
  // Each script writes nothing outside; cwd.mjs proves it runs from its own folder.
  writeFileSync(join(root, 'repro', 'lane', 'green.mjs'), "console.log('first')\nconsole.log('fixed: ' + process.cwd().endsWith('lane'))\n")
  writeFileSync(join(root, 'repro', 'lane', 'red.mjs'), "console.log('BUG: two calls lost one write ' + 'x'.repeat(300))\nprocess.exit(1)\n")
  writeFileSync(join(root, 'repro', 'lane', 'hang.mjs'), "console.log('waiting')\nsetInterval(() => {}, 1000)\n")
  writeFileSync(join(outside, 'evil.mjs'), "import { writeFileSync } from 'node:fs'\nwriteFileSync(" + JSON.stringify(marker) + ", 'x')\n")
  writeFileSync(join(root, 'constats', 'lane.jsonl'), [
    F({ id: 'v-green', where: 'a.mjs:1', severity: 'P0', repro: 'node repro/lane/green.mjs' }),
    F({ id: 'v-red', where: 'b.mjs:1', severity: 'P1', repro: 'repro/lane/red.mjs (exit 1 = bug)' }),
    F({ id: 'v-hang', where: 'c.mjs:1', severity: 'P1', repro: 'repro/lane/hang.mjs' }),
    F({ id: 'v-out', where: 'd.mjs:1', severity: 'P1', repro: '../' + outside.split('/').pop() + '/evil.mjs' }),
    F({ id: 'v-missing', where: 'e.mjs:1', severity: 'P1', repro: 'repro/lane/gone.mjs' }),
    F({ id: 'v-p2', where: 'f.mjs:1', severity: 'P2', repro: 'repro/lane/red.mjs' }),
    F({ id: 'v-scenario', where: 'g.mjs:1', severity: 'P1', repro: 'open the page, press Save twice' })
  ].map((f) => JSON.stringify(f)).join('\n'))
  const hunt = readHunt(root)
  const rows = await verifyHunt(root, hunt.findings, 1500)
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  assert.deepEqual(Object.keys(byId).sort(), ['v-green', 'v-hang', 'v-missing', 'v-out', 'v-red'], 'only the P0/P1 findings that name a .mjs')
  assert.equal(byId['v-green'].code, 0)
  assert.equal(byId['v-green'].last, 'fixed: true', 'run from its own folder, last line kept')
  assert.equal(byId['v-red'].code, 1)
  assert.equal(byId['v-red'].last.length, 160)
  assert.equal(byId['v-hang'].code, 'timeout')
  assert.equal(byId['v-hang'].last, 'waiting')
  assert.ok(byId['v-out'].refused)
  assert.ok(byId['v-missing'].missing)
  assert.equal(rows[0].id, 'v-green', 'worst first')
  const run = spawnSync(process.execPath, [join(here, 'bug-hunt-ledger.mjs'), root, '--verify', '--verify-timeout', '1500', '--out', join(root, 'ledger.md')], { encoding: 'utf8', timeout: 60000 })
  assert.equal(run.status, 0, 'a red or hanging repro does not change the exit code: it is about well-formed findings')
  assert.match(run.stdout, /## Verify/)
  assert.match(run.stdout, /v-green \(P0\) `repro\/lane\/green\.mjs`: exit 0 \| fixed: true/)
  assert.match(run.stdout, /v-red \(P1\) `repro\/lane\/red\.mjs`: exit 1 \| BUG: two calls lost one write/)
  assert.match(run.stdout, /v-hang \(P1\) `repro\/lane\/hang\.mjs`: timeout \| waiting/)
  assert.match(run.stdout, /v-out \(P1\) .*not run, outside the hunt folder/)
  assert.match(run.stdout, /v-missing \(P1\) .*not run, no such file/)
  assert.doesNotMatch(run.stdout.split('## Verify')[1], /v-p2|v-scenario/, 'a P2 and a scenario without a script are not run')
  assert.equal(existsSync(marker), false, 'the script outside the folder never ran')
  const plain = spawnSync(process.execPath, [join(here, 'bug-hunt-ledger.mjs'), root], { encoding: 'utf8' })
  assert.doesNotMatch(plain.stdout, /## Verify/, 'without --verify nothing runs')
  assert.equal(spawnSync(process.execPath, [join(here, 'bug-hunt-ledger.mjs'), root, '--verify', '--verify-timeout', 'x'], { encoding: 'utf8' }).status, 2, 'a bad timeout is a usage error')
  passed += 1
  console.log('  ok --verify runs the P0/P1 repro scripts from their folder: exit 0, exit 1, a hang killed, a path outside never run')
} finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) }

console.log('\nbug-hunt-ledger: ' + passed + ' groups OK')
