#!/usr/bin/env node
// Runs the SCRIPT cases of docs/tests/soft-takeoff/cases.json and writes one verdict file per case, in the format of tester-brief.md.
// A script decides; this runner only reports what it printed. No model is involved, which makes it the reference a cheap tester is compared with.
//
//   node scripts/soft-takeoff-run.mjs --out <folder outside the repo> [--light] [--wave W1] [--cases W0-01,W0-02] [--force] [--timeout 240] [--retry 1] [--list]
//
//   --light    only the cases marked "light": true (the first, cheap wave)
//   --force    also run cases whose status is not « ready » (to-verify, needs-build): they usually come back « blocked »
//   --retry N  a case that fails is run N more times; if one of them passes it is « flaky » (listed, not counted red: the rule of run-all-tests.mjs)
//   --before C a command run before every case and before every retry (e.g. one that starts the sandbox again if something stopped it); when it exits non-zero the case is « blocked »
// Exit 0 when nothing failed or timed out, 1 otherwise, 2 on a refusal. Verdicts: pass | fail | flaky | blocked (exit 3 of a check = wrong environment) | timeout.
// Refuses: a KB_HOST that is the real DSH (port 3080), an output folder inside the repository (evidence never goes to git).
// A file named STOP in the output folder ends the run between two cases.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const refuse = (m) => { console.error('soft-takeoff-run: ' + m); process.exit(2) }

const planPath = resolve(opt('--plan', join(REPO, 'docs/tests/soft-takeoff/cases.json')))
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const wanted = opt('--cases', '') ? opt('--cases', '').split(',').map((s) => s.trim()) : null
const wave = opt('--wave', '')
const pick = plan.cases.filter((c) => c.runner === 'script' && (flag('--force') || c.status === 'ready') && (!flag('--light') || c.light === true) && (!wave || c.wave === wave) && (!wanted || wanted.includes(c.id)))

if (flag('--list')) {
  for (const c of pick) console.log(`${c.id}  ${c.prio}  ${c.env.padEnd(8)} ${c.title}`)
  console.log(`${pick.length} cases`)
  process.exit(0)
}

const out = opt('--out', '')
if (!out) refuse('--out <folder> is required')
const outDir = resolve(out)
const inside = relative(REPO, outDir)
if (inside === '' || (!inside.startsWith('..') && !inside.startsWith('/'))) refuse('the output folder is inside the repository: evidence never goes to git')
if (/:3080$/.test(process.env.KB_HOST || '')) refuse('KB_HOST is the real DSH (port 3080)')
mkdirSync(outDir, { recursive: true })

const timeoutMs = Number(opt('--timeout', '240')) * 1000
const retries = Number(opt('--retry', '1'))
const before = opt('--before', '')
const git = () => spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).stdout

const runOnce = (cmd, limit = timeoutMs) => new Promise((done) => {
  const t0 = Date.now()
  let text = ''
  const child = spawn('bash', ['-c', cmd], { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } })
  const keep = (b) => { text += b.toString('utf8'); if (text.length > 600000) text = text.slice(-300000) }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL') } catch (e) { /* gone */ } }, limit)
  child.on('close', (code) => { clearTimeout(timer); done({ code: timedOut ? 'timeout' : code, ms: Date.now() - t0, text }) })
  child.on('error', (e) => { clearTimeout(timer); done({ code: 'spawn: ' + e.message, ms: Date.now() - t0, text }) })
})

const verdictOf = (code) => (code === 0 ? 'pass' : code === 3 ? 'blocked' : code === 'timeout' ? 'timeout' : 'fail')
const tail = (text) => text.split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean).slice(-20).map((l) => (l.length > 300 ? l.slice(0, 300) + '…' : l))

const rows = []
for (const c of pick) {
  if (existsSync(join(outDir, 'STOP'))) { console.log('STOP file found: ending the run'); break }
  const treeBefore = git()
  const limit = c.timeout ? c.timeout * 1000 : timeoutMs
  const ready = async () => (before === '' ? { code: 0, text: '' } : runOnce(before, 120000))
  const prep = await ready()
  let r = prep.code === 0 ? await runOnce(c.cmd, limit) : { code: 3, ms: prep.ms, text: 'the --before command failed (exit ' + prep.code + '):\n' + prep.text }
  let v = verdictOf(r.code)
  let attempts = 1
  for (let i = 0; i < retries && (v === 'fail' || v === 'timeout') && c.expect !== 'fail'; i++) {
    await ready()
    const again = await runOnce(c.cmd, limit)
    attempts += 1
    if (verdictOf(again.code) === 'pass') { v = 'flaky'; r = { ...again, ms: r.ms + again.ms }; break }
    r = { ...again, ms: r.ms + again.ms }
  }
  writeFileSync(join(outDir, c.id + '.log'), r.text)
  const verdict = {
    case: c.id, verdict: v, host: null, exit_code: typeof r.code === 'number' ? r.code : null, ms: r.ms, attempts,
    steps: [{ n: 1, did: 'ran: ' + c.cmd, saw: 'exit code ' + r.code, ok: v === 'pass' || v === 'flaky' }],
    findings: [], needs_visual_review: [], last_lines: tail(r.text), repo_clean: git() === treeBefore,
  }
  if (c.expect) verdict.canary = { expect: c.expect, ok: v === c.expect }
  writeFileSync(join(outDir, c.id + '.json'), JSON.stringify(verdict, null, 2) + '\n')
  rows.push(verdict)
  console.log(`${verdict.case.padEnd(6)} ${(verdict.canary ? (verdict.canary.ok ? 'canary-ok' : 'CANARY-WRONG') : v).padEnd(12)} ${String(Math.round(r.ms / 1000)).padStart(4)} s  ${c.title}`)
}

const red = rows.filter((x) => (x.canary ? !x.canary.ok : x.verdict === 'fail' || x.verdict === 'timeout'))
const summary = {
  plan: relative(REPO, planPath), at: new Date().toISOString(), counts: rows.reduce((a, x) => { const k = x.canary ? (x.canary.ok ? 'canary-ok' : 'canary-wrong') : x.verdict; a[k] = (a[k] || 0) + 1; return a }, {}),
  red: red.map((x) => x.case), repo_dirty_by: rows.filter((x) => !x.repo_clean).map((x) => x.case),
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`\n${rows.length} run: ${Object.entries(summary.counts).map(([k, n]) => `${n} ${k}`).join(', ')}${summary.repo_dirty_by.length ? `; the repository changed during ${summary.repo_dirty_by.join(', ')}` : ''}`)
process.exit(red.length === 0 ? 0 : 1)
