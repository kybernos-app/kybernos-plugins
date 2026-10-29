#!/usr/bin/env node
// PROBE — Ground 5 of docs/tests/revue-adversariale.md (F-27): the marketplace is fed the shapes the ROUTE really emits, not
// fixtures written to match its own readers.
//
//   node docs/tests/probes/probe-market-contract.mjs
//
// The recipe is the reviewer's: run A6's own route (`handleThemes`, GET) against a really signed catalogue, then feed ITS
// ANSWER to A7's own `marketCards`; and run A6's own applier (`kbThApply`, KB-TH-CORE) against fake ports, then feed its
// answer — wrapped exactly as the published seam wraps it (client.js:26197 `{ ok, id, version, report }`) — to A7's own
// `marketReport`, through the page's own call convention (client.js:30660,30664). No fixture invents a shape: both halves are
// cut out of the two packages and run as they run in the product.
//
// Fails today (measured): every card field but the id and version is empty (marketCards reads `entry.manifest.*`, the route
// sends flat `name`/`author`/`licence` and no description), and the install report draws ZERO rows (marketReport reads
// `result.added`, the seam nests it under `report`).
import { generateKeyPairSync, createHash, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleThemes, planTheme } from '../../../packages/kybernos-plugin/theme-installer.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const clientPath = join(here, '..', '..', '..', 'packages', 'kybernos-plugin', 'client.js')
const client = readFileSync(clientPath, 'utf8')

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (title) => console.log('\n' + title)

/* ── the two blocks the product runs, cut out as the shipped suites already do (test-theme-market.mjs:10-18) ───────────────── */
const block = (begin, end, names) => {
  const m = new RegExp('// ' + begin + '([\\s\\S]*?)// ' + end).exec(client)
  if (m === null) { console.error('BLOCK ' + begin + ' NOT FOUND in client.js'); process.exit(1) }
  return m[1] + '\nexport { ' + names + ' }'
}
const market = await import('data:text/javascript,' + encodeURIComponent(block('KB-MARKET-PURE-BEGIN', 'KB-MARKET-PURE-END', 'marketCards, marketReport, marketInstallable')))
const core = await import('data:text/javascript,' + encodeURIComponent(block('KB-TH-CORE-BEGIN', 'KB-TH-CORE-END', 'kbThApply')))

/* ── a really signed catalogue, so the route answers what it answers in production ──────────────────────────────────────────── */
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const archiveBytes = Buffer.from('the archive bytes of the medical theme')
const archiveHash = sha(archiveBytes)
const entry = {
  version: '1.0.0',
  manifest: {
    id: 'kybernos/medecin',
    name: { en: 'Medical practice', fr: 'Cabinet médical' },
    description: { en: 'A practice that keeps its own records', fr: 'Un cabinet qui tient ses dossiers' },
    author: { id: 'kybernos', name: 'Kybernos' },
    license: 'Apache-2.0',
  },
  archive: { url: 'https://example.invalid/medecin-1.0.0.tgz', sha256: archiveHash, size: archiveBytes.length },
  authorSig: sign(null, Buffer.from('kybernos-plugin-v1\nkybernos/medecin\n1.0.0\n' + archiveHash), privateKey).toString('base64'),
}
const doc = {
  schema: 1,
  kind: 'kybernos-plugin-catalogue',
  catalogue: { id: 'off-1', name: 'The official catalogue', seq: 1, publishedAt: '2026-10-28T00:00:00.000Z' },
  authors: { kybernos: { keys: [{ keyId: 'off-1', pem }] } },
  reviewers: [{ keyId: 'rev-1', pem }],
  plugins: [{ id: 'kybernos/medecin', versions: [entry] }],
  revoked: [],
  revokedKeys: [],
}
const docBytes = Buffer.from(JSON.stringify(doc))
const docSignature = sign(null, docBytes, privateKey).toString('base64')
const SOURCE = 'https://example.invalid/catalogue.json'

/* ── 1. A6's route, for real: its own store on a temp folder, its own guards, then its own GET answer ───────────────────────── */
section('the cards: A6\'s own GET answer through A7\'s own marketCards')
const dir = mkdtempSync(join(tmpdir(), 'kb-probe-market-'))
const store = { dir }
const sameOrigin = () => true
const added = handleThemes(store, { method: 'POST', body: { action: 'source-add', url: SOURCE, key: { keyId: 'off-1', pem } } }, { sameOrigin, session: () => true })
check('the source was accepted by the route (its own POST, signed session)', added.status === 200 && added.body.ok === true, added)
const view = handleThemes(store, { method: 'GET' }, { sameOrigin, catalogues: [{ source: SOURCE, bytes: docBytes, signature: docSignature }] })
check('the GET answers one verified theme, and no refusal', view.status === 200 && view.body.ok === true && view.body.themes.length === 1 && view.body.refused.length === 0,
  { themes: view.body.themes, refused: view.body.refused })
const routeTheme = view.body.themes.length === 1 ? view.body.themes[0] : null
check('the route\'s theme carries the catalogue\'s words flat (name object, author, licence) and its archive',
  routeTheme !== null && typeof routeTheme.name === 'object' && routeTheme.author !== null && routeTheme.licence === 'Apache-2.0' && routeTheme.archive.sha256 === archiveHash,
  routeTheme)
const cards = market.marketCards(view.body, 'en')
check('exactly one card comes out of the real answer', cards.length === 1, cards)
const card = cards.length === 1 ? cards[0] : {}
check('the card carries the theme\'s name, as the route sent it', card.name === 'Medical practice', { card, routeName: routeTheme === null ? null : routeTheme.name })
check('the card carries a description', typeof card.description === 'string' && card.description !== '', card)
check('the card carries the author', card.author === 'Kybernos', card)
check('the card carries the licence', card.license === 'Apache-2.0', card)
check('the card carries the version, the archive hash and its size', card.version === '1.0.0' && card.sha256 === archiveHash && card.size === archiveBytes.length, card)
check('the card carries the level the verifier computed (author only: community)', card.level === 'community', card)
check('the card is installable (an id, a version, an archive hash)', market.marketInstallable(card).ok === true, card)
rmSync(dir, { recursive: true, force: true })

/* ── 2. A6's own applier, for real: a real planTheme plan, fake ports, then the seam's own answer through marketReport ──────── */
section('the report: A6\'s own apply answer, wrapped as the seam wraps it, through A7\'s own marketReport')
const preview = [
  { point: 'kybernos/core#domain-pack', files: [{ file: 'domains/clinic.json', value: { id: 'acme/clinic', name: { en: 'Clinic', fr: 'Cabinet' }, goals: [{ id: 'patients', name: { en: 'Patients' }, skills: [{ name: 'patient-notes', source: 'kybernos' }], teams: ['care-team'], automations: [] }] } }] },
  { point: 'kybernos/theme#theme', files: [{ file: 'themes/clinic.json', value: { id: 'clinic-style', name: { en: 'Clinic style', fr: 'Style cabinet' }, settings: { acc: '#1B7F76' } } }] },
]
const plan = planTheme(preview)
check('the plan is A6\'s own (its style, its kit, its goals)', plan.ok === true && plan.style.id === 'clinic-style' && plan.kit.skills.length === 1 && plan.kit.teams.length === 1, plan)
const ticks = { style: true, goals: ['patients'], skills: ['patient-notes'], teams: ['care-team'], automations: [] }
const ports = {
  get: async (path) => (path === '/kybernos-skills/skills' ? { ok: true, skills: [] } : path === '/kybernos/load' ? { ok: true, roots: [] } : path === '/kybernos/onboarding' ? { ok: true, profil: null, goals: [] } : null),
  post: async (path, body) => (path === '/kybernos/tasks' && body.action === 'list' ? { ok: true, tasks: [] } : { ok: true }),
  team: async (item) => ({ name: item.id, id: item.id }),
  style: async () => ({ ok: true }),
}
const report = await core.kbThApply(plan, ticks, ports)
check('the applier really applied the shell and the kit (its own counters)', report.ok === true && report.added === 4 && report.failed === 0 && report.style === 'applied' && report.domain === 'applied', report)
// client.js:26197 — what the published seam answers a click with. No fixture shape added here.
const seamAnswer = { ok: true, id: plan.id, version: '1.0.0', report }
// client.js:30660,30664 — the page's own call convention.
const planOf = (answer) => (answer !== null && typeof answer === 'object' && answer.plan !== null && typeof answer.plan === 'object' ? answer.plan : null)
const bare = market.marketReport(seamAnswer, planOf(seamAnswer), 'en').rows
check('the answered counters are drawn even when the answer carries no plan (today: zero rows)', bare.some((r) => r.kind === 'added' && r.count === report.added), bare)
const withPlan = Object.assign({}, seamAnswer, { plan })
const rows = market.marketReport(withPlan, planOf(withPlan), 'en').rows
const kinds = rows.map((r) => r.kind)
check('the report draws A6\'s plan: the style and its accent, the kit, then what was added',
  kinds.indexOf('style') >= 0 && kinds.indexOf('kit') >= 0 && rows.some((r) => r.kind === 'added' && r.count === report.added),
  rows)
const styleRow = rows.filter((r) => r.kind === 'style')[0]
check('the style row cites the plan\'s own id and accent', styleRow !== undefined && styleRow.id === 'clinic-style' && styleRow.acc === '#1B7F76', styleRow)

console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — ground 5, market contract (' + (pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)
