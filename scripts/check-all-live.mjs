#!/usr/bin/env node
// Guarded runner for the `check-*-live.mjs` battery — the recette's single entry point.
//
// WHY THIS EXISTS (revue adverse Opus 5.5, 20/10/2026): `scripts/live-page.mjs` targets
// 127.0.0.1:3080 by default (`KB_HOST`), and several checks issue their own `fetch` without
// going through that helper. A naive « run all checks » therefore writes to the user's own DSH.
// This runner refuses to start unless KB_HOST names an isolated instance, and it can stop
// between two checks (STOP file) so a campaign never becomes a runaway.
//
// USAGE
//   source scripts/sandbox/env.sh                 # sets KB_HOST=127.0.0.1:3098 (sandbox)
//   node scripts/check-all-live.mjs --list
//   node scripts/check-all-live.mjs               # whole battery, serial, 180 s per check
//   node scripts/check-all-live.mjs --only connectors,language --timeout 120
//   node scripts/check-all-live.mjs --out /tmp/recette-checks --fail-fast
//
// RULES
//   · KB_HOST is mandatory and must NOT be the user's DSH (127.0.0.1:3080).
//   · Each check gets a timeout; a killed check is reported `timeout`, never silently skipped.
//   · A file named STOP in the output folder (or $RECETTE_STOP_FILE) stops the run between checks.
//   · Exit 0 when every check passed, 1 when one failed/timed out, 2 on a guard refusal.
import { spawn } from 'node:child_process'
import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)
const REAL_HOST = '127.0.0.1:3080'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const host = process.env.KB_HOST || ''
if (flag('--list')) {
  for (const f of discover()) console.log(f)
  process.exit(0)
}
if (!host) {
  console.error('check-all-live: KB_HOST is required (source scripts/sandbox/env.sh). Refusing to guess.')
  process.exit(2)
}
if (host === REAL_HOST) {
  console.error(`check-all-live: refusing to run against the user's own DSH (${REAL_HOST}).`)
  console.error('  Use the isolated instance: source scripts/sandbox/env.sh')
  process.exit(2)
}

const out = value('--out', join('/tmp', 'recette-checks'))
const perCheck = Number(value('--timeout', '180')) * 1000
const failFast = flag('--fail-fast')
const only = (value('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean)
const stopFile = process.env.RECETTE_STOP_FILE || join(out, 'STOP')
mkdirSync(out, { recursive: true })

function discover() {
  return readdirSync(HERE)
    .filter((f) => /^check-.*-live\.mjs$/.test(f) && f !== 'check-all-live.mjs')
    .sort()
}

// Some checks are driven by arguments rather than by KB_HOST: without them they exit 2 on `usage:` and look
// like a broken check. Pass what the runner already knows (the sandbox port and its DSH home).
function extraArgs(file) {
  if (file === 'check-gate-live.mjs') {
    const port = String(host).includes(':') ? String(host).split(':').pop() : '3080'
    const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(process.env.HOME || '', '.dsh')
    return ['--dsh-port', port, '--dsh-home', home]
  }
  return []
}

function runOne(file) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, [join(HERE, file), ...extraArgs(file)], {
      cwd: REPO,
      env: { ...process.env, KB_HOST: host },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group: a check that leaves a Chrome behind is killed whole, not just its node parent.
      detached: true,
    })
    let buf = ''
    const keep = (d) => { buf = (buf + d.toString()).slice(-4000) }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } }, 5000)
    }, perCheck)
    // 'exit', not 'close': a grandchild (Chrome) can hold the pipes open after the check died.
    child.on('exit', (code) => {
      clearTimeout(timer)
      const ms = Date.now() - started
      // The checks answer in three ways, not two: exit 3 means « I could not measure » (the sandbox already has
      // servers, no session to open, no model). Counting that as a failure is what turned environment gaps into
      // phantom defects in the October campaign.
      const status = timedOut ? 'timeout' : code === 0 ? 'pass' : code === 3 ? 'inconclusive' : 'fail'
      writeFileSync(join(out, file.replace(/\.mjs$/, '.log')), `# ${file}\n# host=${host} status=${status} code=${code} ms=${ms}\n\n${buf}\n`)
      resolve({ file, status, code, ms, tail: buf.trim().split('\n').slice(-4).join('\n') })
    })
  })
}

const all = discover()
const list = only.length ? all.filter((f) => only.some((o) => f.includes(o))) : all
if (!list.length) {
  console.error(`check-all-live: no check matched ${JSON.stringify(only)} (${all.length} available)`)
  process.exit(2)
}

console.log(`check-all-live: ${list.length} checks on KB_HOST=${host}, ${perCheck / 1000}s each → ${out}`)
const results = []
for (const file of list) {
  if (existsSync(stopFile)) {
    console.log(`STOP file found (${stopFile}) — stopping after ${results.length}/${list.length}`)
    break
  }
  process.stdout.write(`  ${file} … `)
  const r = await runOne(file)
  results.push(r)
  console.log(`${r.status} (${r.ms} ms)${r.status === 'pass' ? '' : '\n    ' + r.tail.replace(/\n/g, '\n    ')}`)
  if (failFast && r.status !== 'pass') break
}

const counts = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a }, {})
writeFileSync(join(out, 'results.json'), JSON.stringify({ at: new Date().toISOString(), host, perCheck, counts, results }, null, 2))
console.log(`\nsummary: ${JSON.stringify(counts)} → ${join(out, 'results.json')}`)
process.exit(results.some((r) => r.status !== 'pass') ? 1 : 0)
