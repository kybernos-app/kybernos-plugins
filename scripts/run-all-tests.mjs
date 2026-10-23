#!/usr/bin/env node
// Every test of the repo, in one command: the gate to pass BEFORE a merge into `dev` (AGENTS.md).
//
//   node scripts/run-all-tests.mjs [--jobs 4] [--timeout 240] [--only <text>] [--list] [--verbose]
//
// CI runs the same files (scripts/test-*.mjs from the root, packages/*/test*.mjs from their folder, the two `node --test` folders), but only on a
// push to main or a pull request. `dev` is merged on this machine, so until this runner existed the full suite never ran before a merge and a red
// file stayed red for days (four of them on 2026-10-23). This runner is named « run-all », not « test-all », so that the CI loop over
// scripts/test-*.mjs does not start it inside itself.
//
// Files run a few at a time. A file that fails is run once more on its own (a port, a timer or a busy machine fail a parallel run for no product
// reason): it is « red » only if it fails again, « flaky » if it passes (listed, not counted). The output is a summary, never the logs: for each red
// file the last lines of its output; every `SKIPPED:` line a test printed is counted (a skip is not a pass).
// Exit 0 when nothing is red, 1 otherwise.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** What runs, in CI's order: `{ rel, cwd, args }` per file. `root` is the repo (a fixture tree in the test of this runner). */
export function discover (root) {
  const out = []
  const ls = (dir) => { try { return readdirSync(dir).sort() } catch (e) { return [] } }
  for (const f of ls(join(root, 'scripts'))) if (/^test-.*\.mjs$/.test(f)) out.push({ rel: 'scripts/' + f, cwd: root, args: [join('scripts', f)] })
  for (const d of ls(join(root, 'packages'))) {
    const dir = join(root, 'packages', d)
    for (const f of ls(dir)) if (/^test.*\.mjs$/.test(f)) out.push({ rel: 'packages/' + d + '/' + f, cwd: dir, args: [f] })
  }
  // The two standalone daemons keep their tests in a `test/` folder, run by the node test runner (as CI does).
  for (const d of ['messaging', 'kybernos-gate']) {
    const dir = join(root, 'packages', d)
    const files = ls(join(dir, 'test')).filter((f) => /\.test\.mjs$/.test(f))
    if (files.length > 0) out.push({ rel: 'packages/' + d + '/test/*.test.mjs', cwd: dir, args: ['--test'].concat(files.map((f) => join('test', f))) })
  }
  return out
}

/** Runs one file: `{ ok, code, ms, tail, skips }`. `timeoutMs` kills it (code 'timeout'). */
export function runOne (job, timeoutMs) {
  return new Promise((resolveRun) => {
    const started = Date.now()
    let text = ''
    const child = spawn(process.execPath, job.args, { cwd: job.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } })
    const keep = (b) => { text += b.toString('utf8'); if (text.length > 400000) text = text.slice(-200000) }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch (e) { /* gone */ } }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); resolveRun({ ok: false, code: 'spawn: ' + e.message, ms: Date.now() - started, tail: [], skips: [] }) })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const lines = text.split('\n')
      resolveRun({
        ok: code === 0,
        code: signal === 'SIGKILL' ? 'timeout' : code,
        ms: Date.now() - started,
        tail: lines.filter((l) => l.trim() !== '').slice(-10),
        skips: lines.filter((l) => /^SKIPPED: /.test(l) || /SAUTÉE \(pas verte\)/.test(l))
      })
    })
  })
}

/** The whole run: `{ total, red: [{ rel, code, tail }], flaky: [rel], skips: Map(line → n), seconds }`. */
export async function runAll ({ root = REPO, jobs = 4, timeoutMs = 240000, only = '', onDone = () => {} } = {}) {
  const started = Date.now()
  const list = discover(root).filter((j) => only === '' || j.rel.includes(only))
  const results = new Map()
  let next = 0
  const worker = async () => {
    while (next < list.length) {
      const job = list[next++]
      const r = await runOne(job, timeoutMs)
      results.set(job.rel, r)
      onDone(job, r)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker))
  const red = []
  const flaky = []
  for (const job of list) {
    const first = results.get(job.rel)
    if (first.ok) continue
    const again = await runOne(job, timeoutMs)   // alone, nothing else running
    if (again.ok) flaky.push(job.rel)
    else red.push({ rel: job.rel, code: again.code, tail: again.tail })
    results.set(job.rel, again)
  }
  const skips = new Map()
  for (const r of results.values()) for (const s of r.skips) skips.set(s, (skips.get(s) || 0) + 1)
  return { total: list.length, red, flaky, skips, seconds: Math.round((Date.now() - started) / 1000) }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt }
  const flag = (name) => process.argv.includes('--' + name)
  const only = arg('only', '')
  if (flag('list')) {
    for (const j of discover(REPO).filter((x) => only === '' || x.rel.includes(only))) console.log(j.rel)
    process.exit(0)
  }
  if (!existsSync(join(REPO, 'packages'))) { console.error('not run: no packages/ folder next to scripts/'); process.exit(3) }
  const verbose = flag('verbose')
  const res = await runAll({
    jobs: Number(arg('jobs', '4')), timeoutMs: Number(arg('timeout', '240')) * 1000, only,
    onDone: (job, r) => { if (verbose) console.log((r.ok ? '  ✓ ' : '  ✗ ') + job.rel + '  (' + (r.ms / 1000).toFixed(1) + ' s)') }
  })
  console.log('\n' + res.total + ' test files in ' + res.seconds + ' s: ' + (res.total - res.red.length) + ' green, ' + res.red.length + ' RED' + (res.flaky.length > 0 ? ', ' + res.flaky.length + ' flaky (red in the parallel run, green alone)' : ''))
  for (const rel of res.flaky) console.log('  flaky  ' + rel)
  for (const r of res.red) {
    console.log('  RED    ' + r.rel + '  (exit ' + r.code + ')')
    for (const l of r.tail.slice(-5)) console.log('           ' + l.slice(0, 200))
  }
  if (res.skips.size > 0) {
    console.log(res.skips.size + ' kind(s) of skip (a skip is not a pass):')
    for (const [s, n] of [...res.skips].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log('  ' + n + ' × ' + s.slice(0, 160))
  }
  process.exit(res.red.length === 0 ? 0 : 1)
}
