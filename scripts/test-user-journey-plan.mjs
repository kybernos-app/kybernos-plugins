#!/usr/bin/env node
// The user-journey plan (docs/tests/user-journey/) says what it can prove: every case has what its runner needs, every script it names exists (or is marked to build), every soft-takeoff case
// it re-uses exists, every known gap it expects is written down, no agent is asked to type a card number, and the numbers the README quotes are the numbers of the files.
// No browser, no network, no git. Set KB_SERVER_DIR to a checkout of the server repo to also check the server test files the cases name.
//
//   node scripts/test-user-journey-plan.mjs
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLAN = 'docs/tests/user-journey'
const RUNNERS = ['script', 'agent', 'vision', 'owner']
const STATUSES = ['ready', 'to-verify', 'needs-build', 'blocked', 'gap']
const ENVS = ['none', 'sandbox', 'full', 'replica', 'staging', 'machine', 'device', 'site']
const PRIOS = ['P0', 'P1', 'P2']
const PERSONAS = ['A', 'B', 'C']
const PATH_IN_CMD = /\b(?:scripts|packages|services)\/[\w./-]+\.(?:mjs|sh|js)\b/g
const SERVER_TEST = /\btest\/[\w./-]+\.test\.ts\b/g
const CARD_NUMBER = /\b\d{4} \d{4} \d{4} \d{4}\b/

/** Everything wrong with the plan, as a list of sentences. `input`: { cases, takeoff, gaps, readme, exists(rel), serverExists(rel) | null }. */
export function checkPlan ({ cases, takeoff, gaps, readme, exists, serverExists }) {
  const bad = []
  const seen = new Set()
  const journeys = Object.keys(cases.journeys || {})
  const takeoffIds = new Set((takeoff.cases || []).map((c) => c.id))
  const gapIds = new Set([...gaps.matchAll(/^## (KG-\d{2})\b/gm)].map((m) => m[1]))
  for (const j of journeys) {
    const d = cases.journeys[j]
    if (!/^J\d{2}$/.test(j)) bad.push(`${j}: the journey id is not Jnn`)
    if (!d.title || !d.surface || !ENVS.includes(d.env)) bad.push(`${j}: a journey needs a title, a surface and a valid env`)
    if (!(cases.cases || []).some((c) => c.id.startsWith(`${j}-`))) bad.push(`${j}: the journey has no case`)
  }
  for (const c of cases.cases || []) {
    const at = c.id || '(no id)'
    if (!/^J\d{2}-\d{2}$/.test(c.id || '')) bad.push(`${at}: the id is not Jnn-nn`)
    if (seen.has(c.id)) bad.push(`${at}: duplicate id`)
    seen.add(c.id)
    const j = String(c.id).slice(0, 3)
    if (!journeys.includes(j)) bad.push(`${at}: journey ${j} is not in the list of journeys`)
    const status = c.status || 'ready'
    const env = c.env || (cases.journeys[j] || {}).env
    const personas = c.personas || ['A']
    if (!RUNNERS.includes(c.runner)) bad.push(`${at}: runner ${c.runner}`)
    if (!STATUSES.includes(status)) bad.push(`${at}: status ${status}`)
    if (!ENVS.includes(env)) bad.push(`${at}: env ${env}`)
    if (!PRIOS.includes(c.prio)) bad.push(`${at}: prio ${c.prio}`)
    if (!c.title) bad.push(`${at}: no title`)
    if (!c.how || c.how.length < 12) bad.push(`${at}: « how » is missing or too short to run`)
    if (!Array.isArray(personas) || personas.length === 0 || personas.some((p) => !PERSONAS.includes(p))) bad.push(`${at}: personas must be A, B and/or C`)
    for (const w of c.covers || []) if (!takeoffIds.has(w)) bad.push(`${at}: covers ${w}, which is not a soft-takeoff case`)
    for (const k of c.known || []) if (!gapIds.has(k)) bad.push(`${at}: known ${k} is not written in known-gaps.md`)
    if (status === 'gap' && !(c.known || []).length) bad.push(`${at}: a gap case must name the known gap it records`)
    if (status === 'gap' && c.runner === 'script') bad.push(`${at}: a gap case is read by an agent, not scripted`)
    if (c.runner === 'script' && c.how) {
      const toBuild = c.how.startsWith('(to build)')
      if (toBuild !== (status === 'needs-build')) bad.push(`${at}: a script marked « (to build) » must be needs-build, and the reverse`)
      const otherRepo = c.how.startsWith('(')
      if (!toBuild && !otherRepo) for (const p of c.how.match(PATH_IN_CMD) || []) if (!exists(p)) bad.push(`${at}: ${p} does not exist`)
      if (!toBuild && serverExists && c.how.startsWith('(server repo)')) for (const p of c.how.match(SERVER_TEST) || []) if (!serverExists(p)) bad.push(`${at}: the server repo has no ${p}`)
    }
    // agents never type a card number: the owner pays on Stripe's page
    if (CARD_NUMBER.test(`${c.title} ${c.how}`) && c.runner !== 'owner') bad.push(`${at}: a card number appears in a case that is not the owner's`)
    if (/\/Users\/[A-Za-z]/.test(`${c.title} ${c.how}`)) bad.push(`${at}: a personal path`)
    if (c.prio === 'P0' && env === 'staging' && c.runner === 'script' && !(c.how || '').startsWith('(server repo)')) bad.push(`${at}: a P0 case on the staging server must be the owner's, an agent's, or the server repo's tests`)
  }
  const list = cases.cases || []
  if (!readme.includes(`${list.length} cases in ${journeys.length} journeys`)) bad.push(`README: the total is not ${list.length} cases in ${journeys.length} journeys`)
  const by = (r) => list.filter((c) => c.runner === r).length
  if (!readme.includes(`${by('script')} scripted, ${by('agent')} agent, ${by('vision')} vision and ${by('owner')} owner cases`)) bad.push(`README: the split should read ${by('script')} scripted, ${by('agent')} agent, ${by('vision')} vision and ${by('owner')} owner cases`)
  for (const k of gapIds) if (!list.some((c) => (c.known || []).includes(k)) && !readme.includes(k)) bad.push(`known-gaps.md: ${k} is not expected by any case and not named in the README`)
  return bad
}

const load = (rel) => readFileSync(join(REPO, rel), 'utf8')
const loadReal = () => {
  const server = process.env.KB_SERVER_DIR
  return {
    cases: JSON.parse(load(`${PLAN}/cases.json`)),
    takeoff: JSON.parse(load('docs/tests/soft-takeoff/cases.json')),
    gaps: load(`${PLAN}/known-gaps.md`),
    readme: load(`${PLAN}/README.md`),
    exists: (rel) => existsSync(join(REPO, rel)),
    serverExists: server ? (rel) => existsSync(join(server, rel)) : null
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + detail)) } }

  const real = loadReal()
  const problems = checkPlan(real)
  check('the plan files agree with each other and with the repository', problems.length === 0, problems.slice(0, 8).join('; '))
  const all = ['README.md', 'cases.json', 'journeys.md', 'known-gaps.md', 'vision-protocol.md'].map((f) => load(`${PLAN}/${f}`)).join('\n')
  check('no personal path in the plan', !/\/Users\/[A-Za-z]/.test(all))
  check('every journey is described in journeys.md', Object.keys(real.cases.journeys).every((j) => load(`${PLAN}/journeys.md`).includes(`## ${j} `)))
  check('the journeys cover the surfaces the owner named', ['site', 'desktop', 'phone-app', 'phone-remote', 'server-pages', 'shell'].every((s) => Object.values(real.cases.journeys).some((d) => d.surface === s)))
  check('money moves only on the staging server, the replica, or in the owner\'s hands', real.cases.cases.filter((c) => /top-up|renewal|refund|dispute|checkout/i.test(c.title) && c.runner === 'agent').every((c) => ['staging', 'replica'].includes(c.env || real.cases.journeys[c.id.slice(0, 3)].env)))

  // the checker must fail on a plan that is wrong (otherwise it proves nothing)
  const clone = () => JSON.parse(JSON.stringify({ cases: real.cases }))
  const withReal = (o) => ({ ...real, ...o })
  let t = clone(); t.cases.cases[1].id = t.cases.cases[0].id
  check('mutation: a duplicate id is caught', checkPlan(withReal(t)).some((p) => /duplicate id/.test(p)))
  t = clone(); t.cases.cases.find((c) => c.runner === 'script' && c.status !== 'needs-build' && /scripts\//.test(c.how)).how = 'node scripts/does-not-exist.mjs'
  check('mutation: a script that does not exist is caught', checkPlan(withReal(t)).some((p) => /does not exist/.test(p)))
  t = clone(); t.cases.cases.find((c) => c.covers && c.covers.length).covers = ['W9-99']
  check('mutation: a soft-takeoff case that does not exist is caught', checkPlan(withReal(t)).some((p) => /not a soft-takeoff case/.test(p)))
  t = clone(); t.cases.cases.find((c) => c.known && c.known.length).known = ['KG-99']
  check('mutation: an unknown gap is caught', checkPlan(withReal(t)).some((p) => /not written in known-gaps/.test(p)))
  t = clone(); t.cases.cases.find((c) => c.runner === 'agent').how = 'Pay with 4242 4242 4242 4242 on the checkout page.'
  check('mutation: an agent asked to type a card number is caught', checkPlan(withReal(t)).some((p) => /card number/.test(p)))
  t = clone(); t.cases.cases.find((c) => c.runner === 'script' && c.status === 'needs-build').status = 'ready'
  check('mutation: a script to build that is marked ready is caught', checkPlan(withReal(t)).some((p) => /to build/.test(p)))
  check('mutation: a README that quotes the wrong total is caught', checkPlan(withReal({ readme: real.readme.replace(/\d+ cases in \d+ journeys/, '1 cases in 1 journeys') })).some((p) => /total/.test(p)))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
