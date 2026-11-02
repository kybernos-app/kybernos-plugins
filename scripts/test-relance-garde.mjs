#!/usr/bin/env node
// The automatic resume of the relaunch script must not wake what nobody works on any more (a stale sample), must not wake a task
// forever (a loop guard), and the person must be able to stop one (a stop list). The pure rules are cut out of the script and run as
// they are; the commands that write the stop list run against a throw-away DSH home (no server is contacted).
//
//   node scripts/test-relance-garde.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, 'dsh-relance.mjs')
const source = readFileSync(SCRIPT, 'utf8')

const a = source.indexOf('// <garde:begin>')
const b = source.indexOf('// <garde:end>')
assert.ok(a >= 0 && b > a, 'the pure block of the guard was found')
const ctx = vm.createContext({})
vm.runInContext(source.slice(a, b) + '\n;Object.assign(globalThis, { freshSample, recentAuto, autoResumeVerdict, claimsAfter, AUTO_RESUME_MAX, AUTO_RESUME_WINDOW_MS })', ctx)
const { freshSample, recentAuto, claimsAfter, AUTO_RESUME_MAX, AUTO_RESUME_WINDOW_MS } = ctx
// Objects made inside the vm context have another Object prototype: compare them by value.
const autoResumeVerdict = (...args) => JSON.parse(JSON.stringify(ctx.autoResumeVerdict(...args)))

const NOW = Date.parse('2026-11-02T12:00:00Z')
const MIN = 60_000

// 1. the sample: the 28 Oct relaunch woke two chats that a sample of 23 Sep still listed.
{
  const sample = (at) => ({ at: new Date(at).toISOString(), running: [{ id: 's1' }] })
  assert.ok(freshSample(sample(NOW - 2 * MIN), NOW) !== undefined, 'a sample of two minutes ago is a resume list')
  assert.equal(freshSample(sample(NOW - 16 * MIN), NOW), undefined, 'one of sixteen minutes is not')
  assert.equal(freshSample(sample(Date.parse('2026-09-23T10:55:51Z')), NOW), undefined, 'the one of five weeks ago is not')
  assert.equal(freshSample({ at: 'not a date', running: [] }, NOW), undefined)
  assert.equal(freshSample({ at: new Date(NOW).toISOString(), running: 'x' }, NOW), undefined, 'a malformed list is none')
  assert.equal(freshSample(undefined, NOW), undefined)
  assert.equal(freshSample(null, NOW), undefined)
  ok('a supervision sample counts as a resume list for fifteen minutes only (the one of five weeks ago woke two idle chats)')
}

// 2. the guard: three wake-ups in half an hour, then the session is left alone.
{
  assert.equal(AUTO_RESUME_MAX, 3)
  assert.equal(AUTO_RESUME_WINDOW_MS, 30 * MIN)
  const row = (...agesMin) => ({ at: NOW, auto: agesMin.map((m) => NOW - m * MIN) })
  assert.deepEqual(autoResumeVerdict(undefined, {}, 's', NOW), { ok: true }, 'a session never woken')
  assert.deepEqual(autoResumeVerdict(row(5, 10), {}, 's', NOW), { ok: true }, 'twice lately: once more')
  assert.deepEqual(autoResumeVerdict(row(5, 10, 20), {}, 's', NOW), { ok: false, why: 'loop', count: 3 }, 'three times lately: no more')
  assert.deepEqual(autoResumeVerdict(row(40, 50, 60, 5), {}, 's', NOW), { ok: true }, 'old wake-ups fall out of the window')
  assert.deepEqual(autoResumeVerdict(row(1), { s: { at: 'x' } }, 's', NOW), { ok: false, why: 'stopped' }, 'the stop list wins')
  assert.deepEqual(autoResumeVerdict(row(1), { other: {} }, 's', NOW), { ok: true }, 'another session on the list changes nothing')
  assert.deepEqual(autoResumeVerdict({ at: NOW, auto: 'junk' }, null, 's', NOW), { ok: true }, 'a damaged row is a fresh one, never a throw')
  assert.equal(recentAuto({ auto: [NOW - MIN, 'x', null, NOW - 31 * MIN] }, NOW).length, 1)
  ok('a session woken three times in thirty minutes is left alone the fourth, the stop list wins, old wake-ups and damaged rows are harmless')
}

// 3. the reservations: an automatic wake-up is remembered, a manual one keeps the history, a day-old row goes.
{
  let c = {}
  for (const m of [25, 15, 5]) c = claimsAfter(c, 's', 'server back', true, NOW - m * MIN)
  assert.equal(c.s.auto.length, 3)
  assert.equal(autoResumeVerdict(c.s, {}, 's', NOW).why, 'loop', 'the three automatic wake-ups trip the guard')
  const manual = claimsAfter(c, 's', 'relance', false, NOW)
  assert.equal(manual.s.auto.length, 3, 'a deliberate relaunch does not erase the history')
  assert.equal(manual.s.reason, 'relance')
  const plain = claimsAfter({}, 't', 'relance', false, NOW)
  assert.equal('auto' in plain.t, false, 'a manual wake-up adds nothing to the guard')
  const old = claimsAfter({ gone: { at: NOW - 25 * 3_600_000 }, kept: { at: NOW - 3_600_000 } }, 'n', 'x', false, NOW)
  assert.deepEqual(Object.keys(old).sort(), ['kept', 'n'], 'rows older than a day are dropped (the file only ever grew)')
  ok('the reservations remember each automatic wake-up, keep it through a manual one, and drop what is a day old')
}

// 4. wired: only the supervisor's own wake-ups are guarded, the relaunch child still wakes what it journalled.
{
  assert.ok(/resumeActives\(\{ reason: why, targets: dernieres, auto: true \}\)/.test(source), 'the supervisor asks for the guarded resume')
  assert.ok(/const samples = freshSample\(readJson\(SUPERVISE_STATE, undefined\)\)/.test(source), 'the relaunch no longer trusts an old sample')
  assert.ok(/if \(!target\.primary\) \{/.test(source), 'the session that asked for the relaunch is never held back by the list')
  assert.ok(/claim\(id, reason \?\? 'resume', \{ auto \}\)/.test(source), 'a wake-up is recorded with its kind')
  ok('only the supervisor\'s own wake-ups are counted; the session that asked for a relaunch is always woken')
}

// 5. the commands, on a throw-away home.
{
  const home = mkdtempSync(join(tmpdir(), 'relance-garde-'))
  const run = (...argv) => execFileSync(process.execPath, [SCRIPT, ...argv], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, DSH_HOME: home }, timeout: 20_000 })
  try {
    assert.match(run('supervise', 'stop', 'session-loopy'), /will never be resumed on its own/)
    const file = join(home, 'logs', 'dsh-relance-stopped.json')
    assert.ok(existsSync(file), 'the stop list is a file next to the other relaunch files')
    assert.equal(JSON.parse(readFileSync(file, 'utf8'))['session-loopy'].why, 'stopped by hand')
    assert.match(run('supervise', 'status'), /session-loopy/, 'the status names the sessions that are left alone')
    assert.match(run('supervise', 'allow', 'session-loopy'), /given back/)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {}, 'allowed: off the list')
    assert.match(run('supervise', 'allow', 'session-loopy'), /was not on the stop list/, 'giving back twice is harmless')
    assert.throws(() => run('supervise', 'stop'), (e) => e.status === 2 && /usage: supervise stop/.test(String(e.stdout)), 'a missing id is refused with the usage')
    ok('supervise stop / allow / status work on the stop list and refuse a missing id')
  } finally { rmSync(home, { recursive: true, force: true }) }
}

console.log(pass + ' checks passed')
