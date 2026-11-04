#!/usr/bin/env node
// Runs the SCRIPT cases of docs/tests/user-journey/cases.json through the soft-takeoff runner (one verdict file per case, same format as tester-brief.md).
// It only translates the plan: the runner wants `cmd`, `env` and `wave`, this plan has `how`, an env per journey and a repository prefix in front of some commands.
//
//   node scripts/user-journey-run.mjs --out <folder outside the repo> [--journeys J05,J06] [--cases J05-01] [--env none,replica] [--list] [-- <any soft-takeoff-run option>]
//
//   (server repo)  cd $KB_SERVER_DIR   (website repo) cd $KB_WEBSITE_DIR   (mobile repo) cd $KB_MOBILE_DIR   (desktop repo) cd $KB_DESKTOP_DIR
//   `--frozen` is dropped from a command whose env is « full » (the bundles that check skips when frozen are on there).
// Cases that are not ready, not scripted or marked « (to build) » are left out; the runner refuses a KB_HOST that is the real DSH and an output folder inside the repository.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PREFIXES = { '(server repo)': 'KB_SERVER_DIR', '(website repo)': 'KB_WEBSITE_DIR', '(mobile repo)': 'KB_MOBILE_DIR', '(desktop repo)': 'KB_DESKTOP_DIR' }

/** The derived soft-takeoff plan: `{ comment, waves, cases }` for the script cases that can run now. Pure. */
/** The shell command of a `how`: the text before a trailing « (note in words) », which the plan keeps for the person who reads it (the note may hold parentheses of its own). */
export function commandOf (how) {
  const t = String(how).trimEnd()
  if (!t.endsWith(')')) return t
  let depth = 0
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === ')') depth += 1
    else if (t[i] === '(') {
      depth -= 1
      if (depth === 0) {
        const before = t.slice(0, i)
        return /\s$/.test(before) && /^\([A-Za-z]/.test(t.slice(i)) && !/[$\\]\s*$/.test(before) ? before.trimEnd() : t
      }
    }
  }
  return t
}

export function derive (plan, { journeys = null, cases = null, envs = null } = {}) {
  const out = []
  for (const c of plan.cases) {
    const status = c.status || 'ready'
    const env = c.env || plan.journeys[c.id.slice(0, 3)].env
    if (c.runner !== 'script' || status !== 'ready' || c.how.startsWith('(to build)')) continue
    if (journeys && !journeys.includes(c.id.slice(0, 3))) continue
    if (cases && !cases.includes(c.id)) continue
    if (envs && !envs.includes(env)) continue
    let cmd = commandOf(c.how)
    for (const [prefix, variable] of Object.entries(PREFIXES)) {
      if (cmd.startsWith(prefix)) cmd = `cd "$${variable}" && ${cmd.slice(prefix.length).trim()}`
    }
    if (env === 'full') cmd = cmd.replace(/ --frozen\b/g, '')
    out.push({ id: c.id, wave: c.id.slice(0, 3), prio: c.prio, area: c.id.slice(0, 3), title: c.title, runner: 'script', cmd, env, personas: c.personas || ['A'], status: 'ready' })
  }
  const waves = {}
  for (const c of out) waves[c.wave] = plan.journeys[c.wave].title
  return { comment: 'derived from docs/tests/user-journey/cases.json by scripts/user-journey-run.mjs', waves, cases: out }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const argv = process.argv.slice(2)
  const cut = argv.indexOf('--')
  const mine = cut >= 0 ? argv.slice(0, cut) : argv
  const pass = cut >= 0 ? argv.slice(cut + 1) : []
  const opt = (n) => { const i = mine.indexOf(n); return i >= 0 && mine[i + 1] && !mine[i + 1].startsWith('--') ? mine[i + 1].split(',').map((s) => s.trim()) : null }
  const outDir = (opt('--out') || [''])[0]
  if (!outDir) { console.error('user-journey-run: --out <folder outside the repository> is required'); process.exit(2) }
  const plan = JSON.parse(readFileSync(join(REPO, 'docs/tests/user-journey/cases.json'), 'utf8'))
  const derived = derive(plan, { journeys: opt('--journeys'), cases: opt('--cases'), envs: opt('--env') })
  mkdirSync(resolve(outDir), { recursive: true })
  const planFile = join(resolve(outDir), 'plan.json')
  writeFileSync(planFile, JSON.stringify(derived, null, 2))
  const args = [join(REPO, 'scripts/soft-takeoff-run.mjs'), '--plan', planFile, '--out', resolve(outDir)].concat(mine.includes('--list') ? ['--list'] : [], pass)
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: REPO })
  process.exit(r.status === null ? 1 : r.status)
}
