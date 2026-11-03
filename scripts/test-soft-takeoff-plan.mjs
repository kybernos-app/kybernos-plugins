#!/usr/bin/env node
// The soft-takeoff plan (docs/tests/soft-takeoff/) says what it can prove: every case has what its runner needs, every script it names exists, every package is classified
// once, and the numbers the README quotes are the numbers of the files. No browser, no network, no git.
//
//   node scripts/test-soft-takeoff-plan.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLAN = 'docs/tests/soft-takeoff'
const RUNNERS = ['script', 'agent', 'owner']
const STATUSES = ['ready', 'to-verify', 'needs-build', 'blocked']
const ENVS = ['none', 'sandbox', 'replica', 'staging', 'machine']
const PRIOS = ['P0', 'P1', 'P2']
const STATES = ['on', 'off', 'service']
const CALLS = ['recommended', 'owner']
const WATCHES = ['cloud-budget', 'slides']
const PATH_IN_CMD = /\b(?:scripts|packages|services)\/[\w./-]+\.(?:mjs|sh|js)\b/g

/** Everything wrong with a plan, as a list of sentences. `input`: { cases, plugins, readme, packages: [{ dir, hasManifest }], exists(rel) }. */
export function checkPlan ({ cases, plugins, readme, packages, exists }) {
  const bad = []
  const seen = new Set()
  const waves = Object.keys(cases.waves || {})
  for (const c of cases.cases || []) {
    const at = c.id || '(no id)'
    if (!/^W\d-\d{2}$/.test(c.id || '')) bad.push(`${at}: the id is not Wn-nn`)
    if (seen.has(c.id)) bad.push(`${at}: duplicate id`)
    seen.add(c.id)
    if (c.wave !== String(c.id).slice(0, 2) || !waves.includes(c.wave)) bad.push(`${at}: wave ${c.wave} does not match the id or the list of waves`)
    if (!RUNNERS.includes(c.runner)) bad.push(`${at}: runner ${c.runner}`)
    if (!STATUSES.includes(c.status)) bad.push(`${at}: status ${c.status}`)
    if (!ENVS.includes(c.env)) bad.push(`${at}: env ${c.env}`)
    if (!PRIOS.includes(c.prio)) bad.push(`${at}: prio ${c.prio}`)
    if (!c.title) bad.push(`${at}: no title`)
    if (!Array.isArray(c.personas) || c.personas.length === 0 || c.personas.some((p) => p !== 'A' && p !== 'B' && p !== 'C')) bad.push(`${at}: personas must be A, B and/or C`)
    if (c.light !== undefined && (c.light !== true || c.runner !== 'script' || c.status !== 'ready')) bad.push(`${at}: a light case must be a ready script case`)
    if (c.expect !== undefined && (!['pass', 'fail'].includes(c.expect) || c.runner !== 'script')) bad.push(`${at}: expect must be pass or fail on a script case`)
    if (c.watch !== undefined && (!Array.isArray(c.watch) || c.watch.some((w) => !WATCHES.includes(w)))) bad.push(`${at}: unknown watch tag`)
    if (c.timeout !== undefined && !(c.timeout > 0)) bad.push(`${at}: timeout must be a positive number of seconds`)
    if (c.runner === 'script' && !c.cmd) bad.push(`${at}: a script case needs a cmd`)
    if (c.runner === 'agent' && !c.brief) bad.push(`${at}: an agent case needs a brief`)
    if (c.runner === 'owner' && !c.note) bad.push(`${at}: an owner case needs a note saying what is needed`)
    if (['to-verify', 'needs-build'].includes(c.status) && !c.note) bad.push(`${at}: status ${c.status} needs a note saying what to confirm or build`)
    if (c.runner === 'script' && c.cmd && !c.cmd.startsWith('(server repo)')) {
      for (const p of c.cmd.match(PATH_IN_CMD) || []) if (!exists(p)) bad.push(`${at}: ${p} does not exist`)
      for (const m of c.cmd.matchAll(/e2e-teams-run\.sh run ((?:j\d+\s?)+)/g)) {
        for (const j of m[1].trim().split(/\s+/)) if (!exists(`scripts/e2e-teams/${j}`, true)) bad.push(`${at}: no journey ${j}`)
      }
    }
  }
  const exp = (cases.cases || []).filter((c) => c.expect)
  if (!exp.some((c) => c.expect === 'pass') || !exp.some((c) => c.expect === 'fail')) bad.push('the plan needs one canary that must pass and one that must fail')
  for (const w of waves) if (!(cases.cases || []).some((c) => c.wave === w)) bad.push(`wave ${w} has no case`)

  const dirs = packages.map((p) => p.dir)
  for (const p of packages) {
    const e = (plugins.bundles || {})[p.dir]
    if (!e) { bad.push(`package ${p.dir} is not classified`); continue }
    if (!STATES.includes(e.state)) bad.push(`${p.dir}: state ${e.state}`)
    if (!CALLS.includes(e.call)) bad.push(`${p.dir}: call ${e.call}`)
    if (!e.why) bad.push(`${p.dir}: no reason`)
    if ((e.state === 'service') !== !p.hasManifest) bad.push(`${p.dir}: « service » must be exactly the packages that have no plugin.json`)
  }
  for (const k of Object.keys(plugins.bundles || {})) if (!dirs.includes(k)) bad.push(`${k} is classified but is not a package`)
  for (const core of ['kybernos-plugin', 'kybernos-hub']) if (((plugins.bundles || {})[core] || {}).state !== 'on') bad.push(`${core} cannot be off`)

  // the numbers the README quotes
  const list = cases.cases || []
  if (!readme.includes(`${list.length} cases in six waves`)) bad.push(`README: the total is not ${list.length} cases in six waves`)
  for (const w of waves) {
    const mine = list.filter((c) => c.wave === w)
    const row = readme.split('\n').find((l) => l.startsWith(`| ${w} |`))
    const want = `| ${mine.length} (${mine.filter((c) => c.status === 'ready').length}) |`
    if (!row || !row.includes(want)) bad.push(`README: the ${w} row should carry ${want}`)
  }
  const entries = Object.values(plugins.bundles || {})
  const count = (s) => entries.filter((e) => e.state === s).length
  const owner = entries.filter((e) => e.call === 'owner').length
  if (!readme.includes(`**${count('on')} on, ${count('off')} off, ${count('service')} services**`)) bad.push(`README: the freeze should read ${count('on')} on, ${count('off')} off, ${count('service')} services`)
  if (!readme.includes(`of which ${owner} are judgement calls`)) bad.push(`README: ${owner} judgement calls expected`)
  if (!readme.includes(`the ${packages.length} packages`)) bad.push(`README: the table of files should say « the ${packages.length} packages »`)
  const lightN = list.filter((c) => c.light).length
  if (!readme.includes(`marks ${lightN} cheap cases`)) bad.push(`README: the light wave should read « marks ${lightN} cheap cases »`)
  const by = (r) => list.filter((c) => c.runner === r).length
  if (!readme.includes(`${by('script')} scripted cases`) || !readme.includes(`${by('agent')} agent cases`) || !readme.includes(`The other ${by('owner')} cases are the owner's`)) bad.push('README: the cost paragraph does not match the runners of the matrix')
  return bad
}

const load = (rel) => readFileSync(join(REPO, rel), 'utf8')
const loadReal = () => {
  const packages = readdirSync(join(REPO, 'packages'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ dir: d.name, hasManifest: existsSync(join(REPO, 'packages', d.name, 'plugin.json')) }))
  const exists = (rel, prefix = false) => (prefix ? readdirSync(join(REPO, dirname(rel))).some((f) => f.startsWith(rel.split('/').pop() + '-')) : existsSync(join(REPO, rel)))
  return { cases: JSON.parse(load(`${PLAN}/cases.json`)), plugins: JSON.parse(load(`${PLAN}/plugins.json`)), readme: load(`${PLAN}/README.md`), packages, exists }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + detail)) } }

  const real = loadReal()
  const problems = checkPlan(real)
  check('the plan files agree with each other and with the repository', problems.length === 0, problems.slice(0, 6).join('; '))

  const agent = load('.claude/agents/takeoff-tester.md')
  check('the tester agent is a Haiku, read-only, and points at the brief', /^model: haiku$/m.test(agent) && /^disallowedTools:.*Write/m.test(agent) && agent.includes(`${PLAN}/tester-brief.md`) && existsSync(join(REPO, PLAN, 'tester-brief.md')))
  check('the ledger exists, with its table of defects and the baseline of the unit suite', /\| Defect \| Case \| Sev \|/.test(load(`${PLAN}/ledger.md`)) && /Baseline of the unit suite/.test(load(`${PLAN}/ledger.md`)))
  const all = ['README.md', 'cases.json', 'plugins.json', 'tester-brief.md', 'ledger.md'].map((f) => load(`${PLAN}/${f}`)).join('\n')
  check('no personal path in the plan', !/\/Users\/[A-Za-z]/.test(all))
  check('the matrix leads with what is visible: W1 holds the walkthroughs and W0 the gates', real.cases.cases.filter((c) => c.wave === 'W1' && c.runner === 'agent').length >= 3 && real.cases.cases.filter((c) => c.wave === 'W0').length >= 4)

  // the checker must fail on a plan that is wrong (otherwise it proves nothing)
  const clone = () => JSON.parse(JSON.stringify({ cases: real.cases, plugins: real.plugins }))
  const withReal = (o) => ({ ...real, ...o })
  let t = clone(); t.cases.cases[1].id = t.cases.cases[0].id
  check('mutation: a duplicate id is caught', checkPlan(withReal(t)).some((p) => /duplicate id/.test(p)))
  t = clone(); t.cases.cases.find((c) => c.runner === 'script').cmd = 'node scripts/does-not-exist.mjs'
  check('mutation: a script that does not exist is caught', checkPlan(withReal(t)).some((p) => /does not exist/.test(p)))
  t = clone(); delete t.plugins.bundles['kybernos-theme']
  check('mutation: an unclassified package is caught', checkPlan(withReal(t)).some((p) => /not classified/.test(p)))
  t = clone(); t.plugins.bundles['kybernos-hub'].state = 'off'
  check('mutation: switching the hub off is caught', checkPlan(withReal(t)).some((p) => /cannot be off/.test(p)))
  t = clone(); t.cases.cases.find((c) => c.runner === 'agent').brief = ''
  check('mutation: an agent case with no brief is caught', checkPlan(withReal(t)).some((p) => /needs a brief/.test(p)))
  t = clone(); t.cases.cases.find((c) => c.light).runner = 'owner'
  check('mutation: a light case that is not a script is caught', checkPlan(withReal(t)).some((p) => /light case/.test(p)))
  t = clone(); for (const c of t.cases.cases) delete c.expect
  check('mutation: a plan with no canary is caught', checkPlan(withReal(t)).some((p) => /canary/.test(p)))
  check('mutation: a README that quotes the wrong total is caught', checkPlan(withReal({ readme: real.readme.replace(/\d+ cases in six waves/, '1 cases in six waves') })).some((p) => /total/.test(p)))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
