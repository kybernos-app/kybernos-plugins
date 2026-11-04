#!/usr/bin/env node
// The coverage figure of the user-journey plan counts the LATEST verdict of each case, ignores files that are not verdicts, and lists what has none.
//
//   node scripts/test-user-journey-coverage.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { coverage, latestVerdicts, readEvidence, verdictsIn } from './user-journey-coverage.mjs'

let pass = 0
const ok = (name) => { pass += 1; console.log('  ✓ ' + name) }

{
  assert.equal(verdictsIn({ case: 'J01-01', verdict: 'pass' }).length, 1)
  assert.equal(verdictsIn([{ case: 'J01-01', verdict: 'fail' }, { case: 'J01-02', verdict: 'blocked' }]).length, 2)
  assert.equal(verdictsIn({ case: 'J01-01', verdict: 'maybe' }).length, 0, 'a verdict outside pass/fail/blocked is not one')
  assert.equal(verdictsIn({ case: 'not-an-id', verdict: 'pass' }).length, 0)
  assert.equal(verdictsIn(null).length, 0)
  assert.equal(verdictsIn({ cases: [], verdict: 'pass' }).length, 0, 'a plan file is not a verdict')
  ok('a verdict is an object with a case id and pass, fail or blocked (alone or in a list)')
}

{
  const latest = latestVerdicts([
    { mtime: 100, verdicts: [{ case: 'J01-01', verdict: 'fail' }] },
    { mtime: 300, verdicts: [{ case: 'J01-01', verdict: 'pass' }] },
    { mtime: 200, verdicts: [{ case: 'J01-01', verdict: 'blocked' }, { case: 'J01-02', verdict: 'fail' }] },
  ])
  assert.equal(latest.get('J01-01').verdict, 'pass', 'the replay after the fix is the last word')
  assert.equal(latest.get('J01-02').verdict, 'fail')
  ok('the latest file wins, whatever the order it was read in')
}

{
  const cases = [
    { id: 'J01-01', runner: 'script' }, { id: 'J01-02', runner: 'script' }, { id: 'J02-01', runner: 'agent' }, { id: 'J02-02', runner: 'owner' },
  ]
  const latest = new Map([['J01-01', { verdict: 'pass' }], ['J02-01', { verdict: 'blocked' }], ['J09-99', { verdict: 'pass' }]])
  const cov = coverage(cases, latest)
  assert.deepEqual(cov.by.script, { total: 2, pass: 1, fail: 0, blocked: 0, none: 1 })
  assert.deepEqual(cov.by.agent, { total: 1, pass: 0, fail: 0, blocked: 1, none: 0 })
  assert.deepEqual(cov.by.owner, { total: 1, pass: 0, fail: 0, blocked: 0, none: 1 })
  assert.deepEqual(cov.none.map((c) => c.id), ['J01-02', 'J02-02'])
  assert.deepEqual(cov.unknown, ['J09-99'], 'a verdict for a case the plan does not have is reported')
  ok('totals by runner, the cases without a verdict, and verdicts for unknown ids')
}

{
  const dir = mkdtempSync(join(tmpdir(), 'kb-coverage-'))
  try {
    mkdirSync(join(dir, 'a'))
    writeFileSync(join(dir, 'a', 'J01-01.json'), JSON.stringify({ case: 'J01-01', verdict: 'pass' }))
    writeFileSync(join(dir, 'a', 'plan.json'), JSON.stringify({ cases: [{ id: 'J01-01' }] }))
    writeFileSync(join(dir, 'a', 'broken.json'), '{ not json')
    writeFileSync(join(dir, 'a', 'notes.txt'), 'J01-02 pass')
    writeFileSync(join(dir, 'b.json'), JSON.stringify([{ case: 'J01-01', verdict: 'fail' }]))
    utimesSync(join(dir, 'a', 'J01-01.json'), new Date(1_000_000), new Date(1_000_000))
    utimesSync(join(dir, 'b.json'), new Date(2_000_000), new Date(2_000_000))
    const latest = latestVerdicts(readEvidence([dir, join(dir, 'missing')]))
    assert.equal(latest.size, 1)
    assert.equal(latest.get('J01-01').verdict, 'fail', 'the newer file in another folder wins; plan, broken and non-json files are skipped')
    ok('the folders are walked, a missing folder, a broken file and a plan file are skipped')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

console.log('\n' + pass + ' verifications OK')
