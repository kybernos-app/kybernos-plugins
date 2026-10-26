#!/usr/bin/env node
// Vets the skills Kybernos proposes (packages/kybernos-skills/featured-picks.json), one pass at a time, analysing only what is new or changed.
//
//   node scripts/vet-skills.mjs                       the pass: code rules + facts that move (archived, audits); writes the ledger
//   node scripts/vet-skills.mjs --judge               also asks the LLM judge about the skills whose text has no verdict yet
//   node scripts/vet-skills.mjs --calibrate           runs the 4 golden cases through the judge's models (needs the key; ~8 calls)
//   node scripts/vet-skills.mjs --candidate owner/repo:name   vets one skill that is not a pick; writes nothing
//
//   --all           analyse every skill again          --only a,b      only these picks
//   --no-audits     do not call the audit relay        --dry-run       write nothing
//   --verbose       print every skill and finding      --json          print the results as JSON
//   --strict        exit 1 when a skill is rejected    --help
//
// Settings: scripts/vet-skills/config.json. The judge's key is read from the variable it names (AI_GATEWAY_API_KEY by default), never from a
// file. GITHUB_TOKEN (or `gh auth token`) lifts GitHub's anonymous limit. Method, cost and frequency: docs/dev/skills-vetting.md.
// Exit 0 done, 1 --strict and a skill is rejected (or a calibration failed), 2 the run could not be done (settings, key, rate limit).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPicks } from '../packages/kybernos-skills/featured-picks.mjs'
import { loadConfig } from './vet-skills/config.mjs'
import { RULES_VERSION, formatReport } from './vet-skills/core.mjs'
import { createJudge, loadGolden } from './vet-skills/judge.mjs'
import { emptyLedger, runPass } from './vet-skills/pass.mjs'
import { RateLimited, SOURCE_RE, makeGithub, makeRelay } from './vet-skills/sources.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILES = join(HERE, 'vet-skills')
const LEDGER = process.env.VET_LEDGER || join(FILES, 'ledger.json') // the variable is for the tests
const PICKS = resolve(HERE, '..', 'packages', 'kybernos-skills', 'featured-picks.json')
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const value = (f) => { const i = argv.indexOf(f); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null }
const die = (message) => { console.error(message); process.exit(2) }

if (has('--help') || has('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
  process.exit(0)
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))
const loadLedger = () => {
  if (!existsSync(LEDGER)) return emptyLedger()
  const l = JSON.parse(readFileSync(LEDGER, 'utf8'))
  return { ...emptyLedger(), ...l, skills: l.skills || {}, waivers: l.waivers || {}, calibration: l.calibration || {} }
}
const saveLedger = (l) => writeFileSync(LEDGER, JSON.stringify({ ...l, skills: sorted(l.skills), waivers: sorted(l.waivers), calibration: sorted(l.calibration) }, null, 2) + '\n')

const githubToken = () => {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (env) return env
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch (e) { return '' }
}

let config
try { config = loadConfig(join(FILES, 'config.json')) } catch (e) { die('settings: ' + e.message) }
const ledger = loadLedger()
const dryRun = has('--dry-run')
const today = new Date().toISOString().slice(0, 10)

const wantsJudge = has('--judge') || has('--calibrate')
let judge = null
if (wantsJudge) {
  const apiKey = process.env[config.judge.keyEnv]
  if (!apiKey) die(`the judge needs its key in ${config.judge.keyEnv} (a dedicated Vercel AI Gateway key with a spending cap); it is never read from a file`)
  judge = createJudge({ cfg: config.judge, apiKey, calibration: ledger.calibration })
}

if (has('--calibrate')) {
  const records = await judge.calibrate(loadGolden(join(FILES, 'golden')))
  let allPassed = true
  for (const [key, r] of Object.entries(records)) {
    allPassed = allPassed && r.passed
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${key}`)
    for (const x of r.results) console.log(`  ${x.ok ? '✓' : '✗'} ${x.id}: ${x.got}${x.ok ? '' : ' — ' + x.why}`)
  }
  if (!dryRun) { saveLedger({ ...ledger, calibration: { ...ledger.calibration, ...records } }); console.log('calibration recorded in scripts/vet-skills/ledger.json') }
  console.log(`${judge.calls} call(s)`)
  process.exit(allPassed ? 0 : 1)
}

if (has('--judge') && judge.usable().length === 0) die('no judge model has passed the calibration yet: run `node scripts/vet-skills.mjs --calibrate` first')

let picks
let base = ledger
const candidate = value('--candidate')
if (candidate !== null) {
  const [source, name] = candidate.split(':')
  if (!SOURCE_RE.test(source || '') || !NAME_RE.test(name || '')) die('--candidate takes owner/repo:skill-name')
  picks = [{ id: name, source, title: { en: name }, outcome: { en: '' } }]
  base = { ...emptyLedger(), calibration: ledger.calibration }
} else {
  picks = readPicks(PICKS).items
  if (picks.length === 0) die('featured-picks.json has no valid pick')
}

const github = makeGithub({ token: githubToken(), gapMs: config.githubGapMs })
const relay = has('--no-audits') ? null : makeRelay({ base: config.relayBase, gapMs: config.relayGapMs })
let run
try {
  run = await runPass({ picks, ledger: base, config, github, relay, judge, opts: { all: has('--all'), only: (value('--only') || '').split(',').filter(Boolean), judge: has('--judge'), noAudits: has('--no-audits') } })
} catch (e) {
  if (e instanceof RateLimited) die(e.message + ' — nothing was written')
  throw e
}

if (candidate === null && !dryRun) saveLedger(run.ledger)
if (has('--json')) console.log(JSON.stringify({ results: run.results, removed: run.removed, notes: run.notes }, null, 2))
else console.log(formatReport({ results: run.results, removed: run.removed, notes: run.notes, verbose: has('--verbose') || candidate !== null, rulesVersion: RULES_VERSION, today }))
if (has('--strict') && run.results.some((r) => r.verdict === 'reject')) process.exitCode = 1
