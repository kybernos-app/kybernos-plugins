#!/usr/bin/env node
// W1 probe — the skipped/failed rows of the install report, drawn from A6's OWN applier answer, never from a fixture.
//
// The adversarial re-review (docs/tests/revues-adversariale-2.md, W1) measured that `marketReport`'s `skipped`/`failed` branches
// (client.js:30593-30599) lost their only proof when the old hand-built fixture `{ added: 5, skipped: 2, failed: 1 }` was replaced by
// the product's real answer, which has `failed: 0`. This probe runs the extraction the suite runs — the KB-MARKET-PURE block and the
// KB-TH-CORE block of packages/kybernos-plugin/client.js, plus A6's own `planTheme` — and asserts the rows on answers the product
// really produces: one kit item un-ticked (skipped), posts that refuse (failed), plus the counter shape the seam also accepts.
//
//   node docs/tests/probes/probe-market-report-rows.mjs
//
// Exit 0 = every row is drawn; exit 1 = one line names what is missing.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { planTheme } from '../../../packages/kybernos-plugin/theme-installer.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const src = readFileSync(here + '../../../packages/kybernos-plugin/client.js', 'utf8')
const pure = /\/\/ KB-MARKET-PURE-BEGIN([\s\S]*?)\/\/ KB-MARKET-PURE-END/.exec(src)
const core = /\/\/ KB-TH-CORE-BEGIN([\s\S]*?)\/\/ KB-TH-CORE-END/.exec(src)
if (pure === null || core === null) { console.error('FAIL: KB-MARKET-PURE / KB-TH-CORE not found'); process.exit(1) }
const names = 'marketReport, marketSay, marketField, marketNameOf, kitLine, marketCount'
const mod = await import('data:text/javascript,' + encodeURIComponent(pure[1] + '\nexport { ' + names + ' }'))
const coreMod = await import('data:text/javascript,' + encodeURIComponent(core[1] + '\nexport { kbThApply }'))

const PREVIEW = [
  { point: 'kybernos/core#domain-pack', files: [{ file: 'domains/clinic.json', value: { id: 'acme/clinic', name: { en: 'Clinic', fr: 'Cabinet' }, goals: [{ id: 'patients', name: { en: 'Patients' }, skills: [{ name: 'patient-notes', source: 'kybernos' }], teams: ['care-team'], automations: [] }] } }] },
  { point: 'kybernos/theme#theme', files: [{ file: 'themes/clinic.json', value: { id: 'clinic-style', name: { en: 'Clinic style', fr: 'Style cabinet' }, settings: { acc: '#1B7F76' } } }] },
]
const PLAN = planTheme(PREVIEW)
const ports = (post) => ({
  get: async (path) => (path === '/kybernos-skills/skills' ? { ok: true, skills: [] } : path === '/kybernos/load' ? { ok: true, roots: [] } : path === '/kybernos/onboarding' ? { ok: true, profil: null, goals: [] } : null),
  post,
  team: async (item) => ({ name: item.id, id: item.id }),
  style: async () => ({ ok: true }),
})
const planOf = (answer) => (answer !== null && typeof answer === 'object' && answer.plan !== null && typeof answer.plan === 'object' ? answer.plan : null)
const rowsOf = (result) => mod.marketReport(result, planOf(result), 'en').rows
const rowsFr = (result) => mod.marketReport(result, planOf(result), 'fr').rows

let fail = 0
const check = (name, ok, detail) => { if (ok === true) console.log('  ok   ' + name); else { fail += 1; console.log('  FAIL ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

// 1. The product's own answer, with one un-ticked kit item and every write refused: skipped row + a failed plural line.
const skips = { style: true, goals: ['patients'], skills: [], teams: ['care-team'], automations: [] }
const angry = await coreMod.kbThApply(PLAN, skips, ports(async () => ({ ok: false })))
check('A6\'s applier really skipped one item and failed more than one step', Array.isArray(angry.skipped) && angry.skipped.length === 1 && angry.failed === 3, { skipped: angry.skipped, failed: angry.failed })
const angryRows = rowsOf({ ok: true, id: PLAN.id, version: '1.0.0', report: angry, plan: PLAN })
check('the skipped item carries its own name, and the row is drawn from that real answer', angryRows.some((r) => r.kind === 'skipped' && r.text === 'patient-notes'), angryRows)
check('and the failed line is plural on it', angryRows.some((r) => r.kind === 'failed' && r.count === 3 && /3 steps failed/.test(r.text)), angryRows)

// 2. One step failing is the singular line, same shape.
const one = await coreMod.kbThApply(PLAN, { style: true, goals: ['patients'], skills: ['patient-notes'], teams: ['care-team'], automations: [] }, ports(async (path) => (path === '/kybernos/create' ? { ok: false } : { ok: true })))
check('A6\'s applier counts exactly one failure here', one.failed === 1, one)
check('the singular failed line is drawn', rowsOf({ ok: true, id: PLAN.id, version: '1.0.0', report: one, plan: PLAN }).some((r) => r.kind === 'failed' && r.count === 1 && /1 step failed/.test(r.text)), rowsOf({ report: one }))

// 3. The counter shape the seam also takes (`{ added, skipped, failed }` numbers): all three rows, both languages.
const counters = { ok: true, id: PLAN.id, version: '1.0.0', report: { added: 5, skipped: 2, failed: 1 }, plan: PLAN }
check('the counter answer draws style, kit, added, skipped and failed', rowsOf(counters).map((r) => r.kind).join() === 'style,kit,added,skipped,failed', rowsOf(counters))
check('the counters read 5 / 2 / 1 in English', rowsOf(counters).slice(2).map((r) => r.text).join(' | ') === '5 items added | 2 items skipped | 1 step failed', rowsOf(counters).slice(2))
check('and in French', rowsFr(counters).slice(2).map((r) => r.text).join(' | ') === '5 éléments ajoutés | 2 éléments ignorés | 1 étape en échec', rowsFr(counters).slice(2))

console.log('\n' + (fail === 0 ? 'W1 ok — the skipped and failed rows are drawn from the product\'s own answer and from the counter shape' : String(fail) + ' failure(s)'))
process.exit(fail === 0 ? 0 : 1)
