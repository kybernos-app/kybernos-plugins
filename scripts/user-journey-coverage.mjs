#!/usr/bin/env node
// What the user-journey plan has really been played: every case of docs/tests/user-journey/cases.json against the verdict files of the runs.
// A verdict file is any .json under the folders given that holds { case: "Jnn-nn", verdict: "pass" | "fail" | "blocked" } (the runner's per-case file, an agent's verdict)
// or an array of such objects. For each case the LATEST file (by modification time) counts, so a case replayed after a fix shows its last word, not its first.
//
//   node scripts/user-journey-coverage.mjs <evidence folder>... [--list] [--json]
//
// Prints the totals by runner, then (with --list) every case without a verdict, by runner. It never fails: it is the figure the report quotes, not a gate.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VERDICTS = ['pass', 'fail', 'blocked']
const ID = /^J\d{2}-\d{2}$/

/** The verdict objects inside one parsed JSON value. */
export function verdictsIn (value) {
  const list = Array.isArray(value) ? value : [value]
  return list.filter((v) => v !== null && typeof v === 'object' && ID.test(v.case || '') && VERDICTS.includes(v.verdict))
}

/** The latest verdict of each case. `files`: [{ mtime, verdicts: [...] }]. Returns Map id -> { verdict, mtime }. */
export function latestVerdicts (files) {
  const out = new Map()
  for (const f of files) {
    for (const v of f.verdicts) {
      const had = out.get(v.case)
      if (had === undefined || f.mtime >= had.mtime) out.set(v.case, { verdict: v.verdict, mtime: f.mtime })
    }
  }
  return out
}

/** Totals by runner and the cases without a verdict. */
export function coverage (cases, latest) {
  const by = {}
  const none = []
  const unknown = []
  for (const c of cases) {
    const r = by[c.runner] || (by[c.runner] = { total: 0, pass: 0, fail: 0, blocked: 0, none: 0 })
    r.total += 1
    const v = latest.get(c.id)
    if (v === undefined) { r.none += 1; none.push(c) } else r[v.verdict] += 1
  }
  const ids = new Set(cases.map((c) => c.id))
  for (const id of latest.keys()) if (!ids.has(id)) unknown.push(id)
  return { by, none, unknown }
}

function* walk (dir) {
  let names = []
  try { names = readdirSync(dir) } catch (e) { return }
  for (const n of names) {
    const p = join(dir, n)
    let s
    try { s = statSync(p) } catch (e) { continue }
    if (s.isDirectory()) yield* walk(p)
    else if (n.endsWith('.json') && s.size < 2_000_000) yield { path: p, mtime: s.mtimeMs }
  }
}

export function readEvidence (dirs) {
  const files = []
  for (const d of dirs) {
    for (const f of walk(d)) {
      let parsed
      try { parsed = JSON.parse(readFileSync(f.path, 'utf8')) } catch (e) { continue }
      const verdicts = verdictsIn(parsed)
      if (verdicts.length > 0) files.push({ mtime: f.mtime, verdicts })
    }
  }
  return files
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const dirs = args.filter((a) => !a.startsWith('--')).map((a) => resolve(a))
  if (dirs.length === 0) { console.error('usage: node scripts/user-journey-coverage.mjs <evidence folder>... [--list] [--json]'); process.exit(2) }
  const plan = JSON.parse(readFileSync(join(REPO, 'docs/tests/user-journey/cases.json'), 'utf8'))
  const latest = latestVerdicts(readEvidence(dirs))
  const cov = coverage(plan.cases, latest)
  if (args.includes('--json')) {
    console.log(JSON.stringify({ by: cov.by, none: cov.none.map((c) => c.id), unknown: cov.unknown, verdicts: Object.fromEntries(latest) }, null, 1))
    process.exit(0)
  }
  const sum = (k) => Object.values(cov.by).reduce((n, r) => n + r[k], 0)
  console.log(`${plan.cases.length} cases: ${sum('pass')} pass, ${sum('fail')} fail, ${sum('blocked')} blocked, ${sum('none')} without a verdict`)
  for (const [runner, r] of Object.entries(cov.by)) console.log(`  ${runner.padEnd(7)} ${String(r.total).padStart(3)}: ${r.pass} pass, ${r.fail} fail, ${r.blocked} blocked, ${r.none} none`)
  if (cov.unknown.length > 0) console.log(`  verdicts for ids the plan does not have: ${cov.unknown.join(', ')}`)
  if (args.includes('--list')) {
    for (const runner of Object.keys(cov.by)) {
      const ids = cov.none.filter((c) => c.runner === runner).map((c) => c.id)
      if (ids.length > 0) console.log(`\nno verdict, ${runner} (${ids.length}): ${ids.join(' ')}`)
    }
  }
}
