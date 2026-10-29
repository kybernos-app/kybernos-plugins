#!/usr/bin/env node
// The listing's unit (A7-theme-marketplace): the pure block of packages/kybernos-plugin/client.js run as-is — the client is one bundle
// with no relative imports, hence the extraction, the same idiom as scripts/test-onboarding.mjs:14-18 — and the UI block read as text.
// The logic is proven here, without a browser; the drawing is proven by the captures of the vision pass. No port, no clock, no network,
// no <DSH home>: the route's answer is A6's OWN, produced by running A6's route against a really signed catalogue (F-27: a fixture
// that bakes a shape the route never emits proves the fixture), and A6's installer is the real applier run over fake ports.
//
// Usage: node packages/kybernos-plugin/test-theme-market.mjs   (exit 0 = everything passes)
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleThemes, planTheme } from './theme-installer.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const src = readFileSync(here + 'client.js', 'utf8')
const pure = /\/\/ KB-MARKET-PURE-BEGIN([\s\S]*?)\/\/ KB-MARKET-PURE-END/.exec(src)
const ui = /\/\/ KB-MARKET-UI-BEGIN([\s\S]*?)\/\/ KB-MARKET-UI-END/.exec(src)
if (pure === null || ui === null) { console.error('BLOCKS KB-MARKET-PURE / KB-MARKET-UI NOT FOUND in packages/kybernos-plugin/client.js'); process.exit(1) }
const names = 'marketCards, marketSay, marketField, marketLevelLabel, marketLevelHelp, marketLeftOut, marketRefusals, marketNameOf, LEVELS, LEVEL_LABEL, LEVEL_HELP, kitLine, marketState, marketInstallable, marketInstall, marketReport, marketCount, marketSources, marketSourceUrlOk, marketSourceAdd, marketSourceRemove, marketSourceError, MARKET_SOURCES_MAX'
const mod = await import('data:text/javascript,' + encodeURIComponent(pure[1] + '\nexport { ' + names + ' }'))
// A6's own applier, cut out of the shipped page the way the probe cuts it: the report is fed the answer the PRODUCT produces.
const core = /\/\/ KB-TH-CORE-BEGIN([\s\S]*?)\/\/ KB-TH-CORE-END/.exec(src)
if (core === null) { console.error('BLOCK KB-TH-CORE NOT FOUND in packages/kybernos-plugin/client.js'); process.exit(1) }
const coreMod = await import('data:text/javascript,' + encodeURIComponent(core[1] + '\nexport { kbThApply }'))

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want })

/* ── A really signed catalogue, and A6's OWN route run over it: no fixture invents the wire ────────────────────────────────── */
const keypair = () => { const { publicKey, privateKey } = generateKeyPairSync('ed25519'); return { pem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey } }
const MINE = keypair()      // the key the person pinned for the source
const KYB = keypair()       // the catalogue's declared author `kybernos`
const ACME = keypair()      // the catalogue's declared author `acme`
const REVIEWER = keypair()  // the catalogue's reviewer
const OTHER = keypair()     // nobody
const sigOf = (k, message) => sign(null, Buffer.from(message), k.privateKey).toString('base64')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const ARC_MED = Buffer.from('the archive bytes of the medical theme')
const ARC_VET = Buffer.from('the archive bytes of the veterinary theme')
const authorMsg = (id, version, hash) => 'kybernos-plugin-v1\n' + id + '\n' + version + '\n' + hash
const reviewMsg = (id, version, hash) => 'kybernos-plugin-review-v1\n' + id + '\n' + version + '\n' + hash + '\nverified'
const entryOf = (id, hash, size, manifest, signer, rev = null) => ({
  version: '1.0.0',
  manifest: Object.assign({ id }, manifest),
  archive: { url: 'https://example.invalid/' + id.replace('/', '-') + '.tgz', sha256: hash, size },
  authorSig: sigOf(signer, authorMsg(id, '1.0.0', hash)),
  ...(rev === null ? {} : { review: sigOf(rev, reviewMsg(id, '1.0.0', hash)) }),
})
const catalogue = (plugins) => ({
  schema: 1,
  kind: 'kybernos-plugin-catalogue',
  catalogue: { id: 'cat-1', name: 'The catalogue', seq: 1, publishedAt: '2026-10-28T00:00:00.000Z' },
  authors: { kybernos: { keys: [{ keyId: 'k-kyb', pem: KYB.pem }] }, acme: { keys: [{ keyId: 'k-acme', pem: ACME.pem }] } },
  reviewers: [{ keyId: 'r-1', pem: REVIEWER.pem }],
  plugins,
  revoked: [],
  revokedKeys: [],
})
const SOURCE = 'https://example.invalid/catalogue.json'
/** A6's route on its own temp folder: POST source-add, then the GET whose ANSWER is the product's — never a hand-built view. */
const routeGet = (doc) => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-market-'))
  try {
    const store = { dir }
    const ports = { sameOrigin: () => true, session: () => true }
    const added = handleThemes(store, { method: 'POST', body: { action: 'source-add', url: SOURCE, key: { keyId: 'cat-1', pem: MINE.pem } } }, ports)
    if (added.status !== 200 || added.body.ok !== true) throw new Error('source-add refused: ' + JSON.stringify(added))
    const bytes = Buffer.from(JSON.stringify(doc))
    const answer = handleThemes(store, { method: 'GET' }, Object.assign({}, ports, { catalogues: [{ source: SOURCE, bytes, signature: sigOf(MINE, bytes) }] }))
    return answer.body
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
/** The route can only refuse: an empty listing, no source, a source the verifier refuses. Each is a REAL answer too. */
const emptyRouteGet = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-market-empty-'))
  try {
    const answer = handleThemes({ dir }, { method: 'GET' }, { sameOrigin: () => true })
    return answer.body
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const DOC = catalogue([
  { id: 'kybernos/medecin', versions: [entryOf('kybernos/medecin', sha(ARC_MED), ARC_MED.length, { name: { en: 'Medical practice', fr: 'Cabinet médical' }, description: { en: 'A practice that keeps its own records', fr: 'Un cabinet qui tient ses dossiers' }, author: { id: 'kybernos', name: 'Kybernos' }, license: 'Apache-2.0' }, KYB)] },
  { id: 'acme/vet', versions: [entryOf('acme/vet', sha(ARC_VET), ARC_VET.length, { name: { en: 'Vet clinic', fr: 'Clinique vétérinaire' }, description: { en: 'Care for pets', fr: 'Soins des animaux' }, author: { id: 'acme', name: 'Acme' }, license: 'MIT', level: 'official', trust: 'official', official: true }, ACME, REVIEWER)] },
  { id: 'acme/broken', versions: [entryOf('acme/broken', sha(ARC_VET), ARC_VET.length, { name: { en: 'Broken', fr: 'Cassé' }, author: { id: 'acme', name: 'Acme' } }, OTHER)] },
])
const VIEW = routeGet(DOC)
const cards = mod.marketCards(VIEW, 'en')

/* ── 1. The card: A6's real answer, read as it is (flat fields, the computed level) ───────────────────────────────────────── */
{
  check('the route answers two verified entries and refuses the one whose author signature does not verify',
    VIEW.themes.length === 2 && VIEW.refused.length === 1 && VIEW.refused[0].error === 'signature', { themes: VIEW.themes.length, refused: VIEW.refused })
  const ok = Array.isArray(cards) && cards.length === 2 &&
    cards.map((c) => c.id).join() === 'kybernos/medecin,acme/vet' &&
    cards[0].version === '1.0.0' && cards[0].name === 'Medical practice' &&
    cards[0].description === 'A practice that keeps its own records' &&
    cards[0].author === 'Kybernos' && cards[0].license === 'Apache-2.0' &&
    cards[0].source === SOURCE && cards[0].sha256 === sha(ARC_MED) && cards[0].size === ARC_MED.length
  check('a card carries the route\'s flat words, its version, its archive and its source', ok, cards)
  check('the level is the verifier\'s, never the document\'s: author only is community, countersigned is verified, and a manifest that writes its own trust changes nothing',
    cards[0].level === 'community' && cards[1].level === 'verified' && cards.map((c) => c.level).join() === 'community,verified', cards.map((c) => c.level))
  check('a card carries the author by name and the licence as the route sent them', cards[1].name === 'Vet clinic' && cards[1].description === 'Care for pets' && cards[1].author === 'Acme' && cards[1].license === 'MIT', cards[1])
  // The old fixture shape — a `manifest` the route never sends — is NOT read: that is what F-27 was.
  const ghost = mod.marketCards({ ok: true, themes: [{ id: 'acme/ghost', version: '1.0.0', level: 'community', manifest: { name: { en: 'Ghost' }, description: { en: 'x' }, author: { name: 'Ghost' }, license: 'MIT' }, archive: { url: 'https://example.invalid/g.tgz', sha256: 'a'.repeat(64), size: 1 } }] }, 'en')
  check('a `manifest` object the route does not emit makes no name, description, author or licence', ghost.length === 1 && ghost[0].name === '' && ghost[0].description === '' && ghost[0].author === '' && ghost[0].license === '', ghost)
  const local = mod.marketCards(Object.assign({}, VIEW, { themes: [Object.assign({}, VIEW.themes[0], { id: 'local/clinic', level: 'local' })] }), 'en')
  check('the registry\'s own `local` level passes through untouched', local.length === 1 && local[0].level === 'local', local)
  const dropped = mod.marketCards({ ok: true, themes: [
    Object.assign({}, VIEW.themes[0], { level: 'yanked' }),
    Object.assign({}, VIEW.themes[0], { level: 'revoked' }),
    Object.assign({}, VIEW.themes[0], { level: 'unlisted' }),
    Object.assign({}, VIEW.themes[0], { id: '' }),
    Object.assign({}, VIEW.themes[0], { version: '' }),
    null,
  ] }, 'en')
  check('a yanked, revoked or unlisted entry, or one without an id or a version, makes no card', dropped.length === 0, dropped)
  check('an answer that failed, or one with no `themes`, makes no card', mod.marketCards({ ok: false, themes: VIEW.themes }, 'en').length === 0 && mod.marketCards({ ok: true }, 'en').length === 0 && mod.marketCards(null, 'en').length === 0)
}

/* ── 2. The levels: the contract's four, displayed never computed ────────────────────────────────────────────────────────────── */
{
  eq('the four levels are the contract\'s, in its order', mod.LEVELS, ['official', 'verified', 'community', 'local'])
  eq('the labels are Official / Verified / Community / Local development in English', mod.LEVELS.map((l) => mod.marketLevelLabel(l, 'en')), ['Official', 'Verified', 'Community', 'Local development'])
  eq('the labels are French in French', mod.LEVELS.map((l) => mod.marketLevelLabel(l, 'fr')), ['Officiel', 'Vérifié', 'Communauté', 'Développement local'])
  check('every label and every help line holds both languages, and the help stays short', mod.LEVELS.every((l) => Array.isArray(mod.LEVEL_LABEL[l]) && mod.LEVEL_LABEL[l].every((t) => typeof t === 'string' && t !== '') && Array.isArray(mod.LEVEL_HELP[l]) && mod.LEVEL_HELP[l].every((t) => typeof t === 'string' && t !== '' && t.length < 90)))
  check('an unknown level is displayed as its raw string, labelled, never mapped to a nicer one', mod.marketLevelLabel('partner', 'en') === 'partner' && mod.marketLevelLabel('partner', 'fr') === 'partner' && mod.marketLevelHelp('partner', 'en').length > 0)
  check('Unlisted is not one of the marketplace levels', mod.LEVELS.indexOf('unlisted') < 0 && mod.LEVEL_LABEL.unlisted === undefined)
}

/* ── 3. The three honest states, each a REAL route answer ───────────────────────────────────────────────────────────────────── */
{
  const noSource = mod.marketState(emptyRouteGet(), 'en')
  const empty = mod.marketState(routeGet(catalogue([])), 'en')
  const refused = mod.marketState(routeGet(catalogue([{ id: 'acme/broken', versions: [entryOf('acme/broken', sha(ARC_VET), ARC_VET.length, { name: { en: 'Broken' }, author: { id: 'acme', name: 'Acme' } }, OTHER)] }])), 'en')
  const distinct = noSource !== null && empty !== null && refused !== null &&
    noSource.state !== empty.state && empty.state !== refused.state && noSource.state !== refused.state &&
    noSource.text !== empty.text && empty.text !== refused.text && noSource.text !== refused.text
  check('no source, an empty catalogue and a source the verifier refuses say three different things', distinct && noSource.state === 'no-source' && empty.state === 'empty' && refused.state === 'refused', { noSource, empty, refused })
  check('a refused entry is named with the verifier\'s own code, never invented', refused.leftOut !== null && refused.leftOut.indexOf('1') >= 0 && JSON.stringify(mod.marketRefusals({ refused: [{ id: 'acme/broken', code: 'signature' }, { id: 'acme/old', error: 'yanked' }, { code: '' }] })) === JSON.stringify([{ id: 'acme/broken', code: 'signature' }, { id: 'acme/old', code: 'yanked' }]), refused)
  check('a state never shows a card and a card never shows a state', mod.marketState(VIEW, 'en') === null && mod.marketCards(emptyRouteGet(), 'en').length === 0)
  check('the three sentences exist in both languages, and French is French', noSource.text !== mod.marketState(emptyRouteGet(), 'fr').text && mod.marketState(emptyRouteGet(), 'fr').text.indexOf('Aucune') === 0)
  check('a failed read is not one of the three states (the page owns its own line)', mod.marketState(null, 'en') === null && mod.marketState({ ok: false, sources: [] }, 'en') === null)
}

/* ── 4. Both languages from one answer ──────────────────────────────────────────────────────────────────────────────────────── */
{
  const fr = mod.marketCards(VIEW, 'fr')
  const en = mod.marketCards(VIEW, 'en')
  const sameShape = fr.length === en.length && fr.every((c, i) => c.id === en[i].id && c.version === en[i].version && c.level === en[i].level && c.sha256 === en[i].sha256)
  check('both languages come from one answer', sameShape && fr[0].name === 'Cabinet médical' && en[0].name === 'Medical practice' && fr[1].description === 'Soins des animaux' && en[1].description === 'Care for pets', { fr: fr[0], en: en[0] })
  check('a language that is neither French nor English reads English (the kt rule)', mod.marketCards(VIEW, 'es')[0].name === 'Medical practice' && mod.marketCards(VIEW, 'ar')[0].name === 'Medical practice' && mod.kitLine({ skills: 2 }, 'ar') === 'Adds 2 skills')
  const noFrench = routeGet(catalogue([{ id: 'kybernos/medecin', versions: [entryOf('kybernos/medecin', sha(ARC_MED), ARC_MED.length, { name: { en: 'Medical practice' }, description: { en: 'Only English' }, author: { id: 'kybernos', name: 'Kybernos' }, license: 'Apache-2.0' }, KYB)] }]))
  check('a manifest text missing in French falls back to English, never to a hole', mod.marketCards(noFrench, 'fr')[0].name === 'Medical practice', noFrench.themes)
}

/* ── 5. The kit sentence (A6's plan counts, INT5) ────────────────────────────────────────────────────────────────────────────── */
{
  eq('the kit sentence pluralises, in English', mod.kitLine({ skills: 4, teams: 1, automations: 2 }, 'en'), 'Adds 4 skills, 1 team and 2 automations')
  eq('the kit sentence pluralises, in French', mod.kitLine({ skills: 4, teams: 1, automations: 2 }, 'fr'), 'Ajoute 4 compétences, 1 équipe et 2 automatisations')
  eq('a single item reads in the singular', mod.kitLine({ skills: 1 }, 'en') + ' | ' + mod.kitLine({ skills: 1 }, 'fr'), 'Adds 1 skill | Ajoute 1 compétence')
  eq('a zero count is omitted, never written as « 0 skills »', mod.kitLine({ skills: 0, teams: 3, automations: 0 }, 'en'), 'Adds 3 teams')
  eq('an all-zero kit says so, in both languages', mod.kitLine({ skills: 0, teams: 0, automations: 0 }, 'en') + ' | ' + mod.kitLine({}, 'fr'), 'Adds no kit yet | N’ajoute encore rien au kit')
  eq('an empty kit is the same sentence as an absent one', mod.kitLine(null, 'en'), 'Adds no kit yet')
}

/* ── 6. The install gate and the one click (M3, M7) ──────────────────────────────────────────────────────────────────────────── */
{
  const seam = (answer) => {
    const calls = []
    const install = (arg) => { calls.push(arg); return answer }
    return { calls, install }
  }
  const card = cards[1]
  eq('an entry with an id, a version and an archive hash is installable', mod.marketInstallable(card), { ok: true })
  eq('an entry without a hash is not', mod.marketInstallable(Object.assign({}, card, { archive: { url: 'x' } })), { ok: false, reason: 'incomplete' })
  eq('an entry the verifier refused is refused', mod.marketInstallable(Object.assign({}, card, { level: 'yanked' })), { ok: false, reason: 'refused' })

  const fake = seam({ ok: true })
  check('no click, no call: nothing hands an entry to the installer at mount', fake.calls.length === 0)
  const answer = mod.marketInstall(card, fake.install)
  const single = fake.calls.length === 1 && JSON.stringify(fake.calls[0]) === JSON.stringify({ source: 'catalogue', id: 'acme/vet', version: '1.0.0' }) && Object.keys(fake.calls[0]).length === 3
  check('one click hands the entry to the installer once, never at mount', single && JSON.stringify(answer) === JSON.stringify({ ok: true, id: 'acme/vet', version: '1.0.0' }), { calls: fake.calls, answer })

  const none = mod.marketInstall(card, null)
  check('without the installer the action is explained, not a dead button', JSON.stringify(none) === JSON.stringify({ ok: false, error: 'no-installer' }) && /kb-market-why/.test(ui[1]) && /disabled:/.test(ui[1]) && /No installer is loaded on this page\./.test(ui[1]), none)

  const refusedFake = seam({ ok: true })
  const yanked = mod.marketInstall(Object.assign({}, card, { level: 'yanked' }), refusedFake.install)
  const revoked = mod.marketInstall(Object.assign({}, card, { level: 'revoked' }), refusedFake.install)
  check('an entry the verifier refused or revoked never reaches the installer', refusedFake.calls.length === 0 && yanked.error === 'refused' && revoked.error === 'refused', { calls: refusedFake.calls, yanked, revoked })

  const throwing = mod.marketInstall(card, () => { throw new Error('boom') })
  check('a seam that throws is a reason, never an exception', JSON.stringify(throwing) === JSON.stringify({ ok: false, error: 'installer-failed' }), throwing)
}

/* ── 7. The report: A6's OWN apply answer, wrapped as the published seam wraps it, through marketReport ─────────────────────── */
const PREVIEW = [
  { point: 'kybernos/core#domain-pack', files: [{ file: 'domains/clinic.json', value: { id: 'acme/clinic', name: { en: 'Clinic', fr: 'Cabinet' }, goals: [{ id: 'patients', name: { en: 'Patients' }, skills: [{ name: 'patient-notes', source: 'kybernos' }], teams: ['care-team'], automations: [] }] } }] },
  { point: 'kybernos/theme#theme', files: [{ file: 'themes/clinic.json', value: { id: 'clinic-style', name: { en: 'Clinic style', fr: 'Style cabinet' }, settings: { acc: '#1B7F76' } } }] },
]
const PLAN = planTheme(PREVIEW)
const TICKS = { style: true, goals: ['patients'], skills: ['patient-notes'], teams: ['care-team'], automations: [] }
const fakePorts = {
  get: async (path) => (path === '/kybernos-skills/skills' ? { ok: true, skills: [] } : path === '/kybernos/load' ? { ok: true, roots: [] } : path === '/kybernos/onboarding' ? { ok: true, profil: null, goals: [] } : null),
  post: async (path, body) => (path === '/kybernos/tasks' && body.action === 'list' ? { ok: true, tasks: [] } : { ok: true }),
  team: async (item) => ({ name: item.id, id: item.id }),
  style: async () => ({ ok: true }),
}
{
  check('the plan is A6\'s own (its style, its kit, its goals)', PLAN.ok === true && PLAN.style.id === 'clinic-style' && PLAN.kit.skills.length === 1 && PLAN.kit.teams.length === 1, PLAN)
  const report = await coreMod.kbThApply(PLAN, TICKS, fakePorts)
  check('A6\'s applier really applied the shell and the kit (its own counters)', report.ok === true && report.added === 4 && report.failed === 0 && report.style === 'applied' && report.domain === 'applied', report)
  // client.js:26192 — what the published seam answers a click with. No fixture shape added here.
  const seamAnswer = { ok: true, id: PLAN.id, version: '1.0.0', report }
  // client.js:30660,30664 — the page's own call convention.
  const planOf = (answer) => (answer !== null && typeof answer === 'object' && answer.plan !== null && typeof answer.plan === 'object' ? answer.plan : null)
  const bare = mod.marketReport(seamAnswer, planOf(seamAnswer), 'en').rows
  check('the answered counters are drawn from the seam\'s own `report`, even when the answer carries no plan', bare.some((r) => r.kind === 'added' && r.count === report.added), bare)
  const withPlan = Object.assign({}, seamAnswer, { plan: PLAN })
  const rows = mod.marketReport(withPlan, planOf(withPlan), 'en').rows
  const kinds = rows.map((r) => r.kind)
  check('the report draws A6\'s plan: the style, the kit, then what was added', kinds.join() === 'style,kit,added', rows)
  const styleRow = rows.filter((r) => r.kind === 'style')[0]
  check('the style row cites the plan\'s own id and accent', styleRow !== undefined && styleRow.id === 'clinic-style' && styleRow.acc === '#1B7F76', styleRow)
  const listed = mod.marketReport({ report: { added: [{ name: 'Clinic style' }, { name: { fr: 'Cabinet', en: 'Practice' } }, { file: 'themes/x.json' }, 'Field'] } }, null, 'en')
  check('an item without a name is dropped from the report, never invented', listed.rows.map((r) => r.text).join(' | ') === 'Clinic style | Practice | Field', listed.rows)
  const nothing = mod.marketReport(null, null, 'en')
  check('a report with nothing to say says nothing', Array.isArray(nothing.rows) && nothing.rows.length === 0, nothing)
  const french = mod.marketReport({ report: { added: 1 } }, null, 'fr')
  check('the report speaks French in French', french.rows[0].text === '1 élément ajouté', french.rows)
  // W1 (the adversarial re-review measured this proof had been deleted): the skipped and failed rows are drawn from the product's
  // OWN answer too — an un-ticked kit item is skipped, refused writes are counted — and the counter shape the seam also takes keeps
  // its proof (a second case, never a weaker first one). client.js:30593-30599.
  const postAs = (post) => Object.assign({}, fakePorts, { post })
  const unTicked = { style: true, goals: ['patients'], skills: [], teams: ['care-team'], automations: [] }
  const angry = await coreMod.kbThApply(PLAN, unTicked, postAs(async () => ({ ok: false })))
  const angryRows = mod.marketReport({ ok: true, id: PLAN.id, version: '1.0.0', report: angry, plan: PLAN }, PLAN, 'en').rows
  check('a real answer whose item was un-ticked draws its skipped row, named by the applier itself',
    Array.isArray(angry.skipped) && angry.skipped.length === 1 && angryRows.some((r) => r.kind === 'skipped' && r.text === 'patient-notes'), { skipped: angry.skipped, rows: angryRows })
  check('a real answer whose writes were refused draws the failed line, plural',
    angry.failed === 3 && angryRows.some((r) => r.kind === 'failed' && r.count === 3 && r.text === '3 steps failed'), { failed: angry.failed, rows: angryRows })
  const single = await coreMod.kbThApply(PLAN, { style: true, goals: ['patients'], skills: ['patient-notes'], teams: ['care-team'], automations: [] }, postAs(async (path) => (path === '/kybernos/create' ? { ok: false } : { ok: true })))
  check('one failed step is the singular line', single.failed === 1 && mod.marketReport({ ok: true, report: single, plan: PLAN }, PLAN, 'en').rows.some((r) => r.kind === 'failed' && r.text === '1 step failed'), single)
  const counters = { ok: true, id: PLAN.id, version: '1.0.0', report: { added: 5, skipped: 2, failed: 1 }, plan: PLAN }
  eq('the counter answer draws style, kit, added, skipped and failed', mod.marketReport(counters, PLAN, 'en').rows.map((r) => r.kind), ['style', 'kit', 'added', 'skipped', 'failed'])
  eq('the counters read 5 / 2 / 1 in English', mod.marketReport(counters, PLAN, 'en').rows.slice(2).map((r) => r.text), ['5 items added', '2 items skipped', '1 step failed'])
  eq('and in French', mod.marketReport(counters, PLAN, 'fr').rows.slice(2).map((r) => r.text), ['5 éléments ajoutés', '2 éléments ignorés', '1 étape en échec'])
}

/* ── 8. The blocks themselves: pure, guarded, and where they must be ─────────────────────────────────────────────────────────── */
{
  check('the pure block holds no React, no fetch, no window, no document', !/React\.|fetch\(|window\.|document\.|addEventListener/.test(pure[1]))
  // D2 of the strategy owns the full forbidden list for this block; the two ways to hash are named here too, and no literal of a
  // verifier's name sits in this file either — the tree keeps ONE catalogue verifier, and a suite is not one.
  check('the pure block names no way to hash and imports nothing (it displays the route\'s level)', !/createHash|createPublicKey|require\(|^import /m.test(pure[1]))
  check('the UI block calls no manager, applies no style and writes no file of its own', !/installBundle|removeBundle|setBundleEnabled|__KB_THEME_APPLY__|localStorage|writeFile/.test(ui[1]))
  const marketCalls = (ui[1].match(/marketInstall\(/g) || []).length
  check('the UI block calls marketInstall from the click, and only there', marketCalls === 1 && /onClick: \(\) => installer\(card\)/.test(ui[1]) && !/React\.useEffect\(\(\) => \{[^}]*marketInstall/.test(ui[1]), marketCalls)
  const reads = (ui[1].match(/fetch\('\/kybernos\/themes'/g) || []).length
  check('the listing reads A6\'s route through one call, re-read after a click and never cached', reads === 1 && /cache: 'no-store'/.test(ui[1]) && (ui[1].match(/relire\(\)/g) || []).length >= 2)
  check('both blocks sit outside the first-run wizard\'s KB-OB block (A1-kit-wizard\'s perimeter)', src.indexOf('// KB-MARKET-PURE-BEGIN') < src.indexOf('// KB-OB-CORE-BEGIN') && src.indexOf('// KB-MARKET-UI-END') < src.indexOf('// KB-OB-CORE-BEGIN'))
}

/* ── 9. One component, registered as a Settings section, never a second page (INT1, M2) ──────────────────────────────────────── */
{
  const registrations = (src.match(/name: 'settings\.section', id: 'kybernos-themes-market'/g) || []).length
  const defs = (src.match(/const KbThemesMarket = /g) || []).length
  const pageBranch = /\bview: 'themes'|\bview === 'themes'|kbOpenPage/.test(ui[1])
  check('the listing is one component registered as a Settings section, never a second page', registrations === 1 && defs === 1 && pageBranch === false && /order: 30/.test(ui[1]) && /label: marketSay\(\['Thèmes', 'Themes'\]/.test(ui[1]) && /marketCards\(view, lang\)/.test(ui[1]) && /marketState\(view, lang\)/.test(ui[1]), { registrations, defs, pageBranch })
  check('the Settings menu knows the section: a nav key, an icon and the Interface group\'s word', /'kybernos-themes-market': 'themes'/.test(src) && /'themes': '<path/.test(src) && /id: 'look'[^}]*mots: \['theme', 'themes', 'langue', 'language'\]/.test(src))
  check('the registration is guarded, so a broken listing never stops the bundle from starting', /ctx\.effect\(\(\) => \{\s*try \{/.test(ui[1]) && /catch \(e\) \{ return undefined \}/.test(ui[1]))
  check('the listing uses the host\'s shell classes and its own prefix only', !/(^|[^a-z-])kb[0-9a-z]*-[a-z]+\{/.test(ui[1].replace(/\.kbtm-[^{]*\{/g, '')))
}

/* ── 10. The Settings row of the sources (A6:41, INT5, A6:289): bounded fields, A6's own route, the pinned key shown ──────────── */
{
  const listed = mod.marketSources(VIEW)
  check('the row lists the route\'s own sources, with the pinned key id',
    listed.length === 1 && listed[0].url === SOURCE && listed[0].keyId === 'cat-1' && listed[0].pinned === true, listed)
  check('a source the route lists without a key is shown as not pinned', mod.marketSources({ ok: true, sources: [{ url: SOURCE, keyId: null, pinned: false }] })[0].pinned === false)
  check('an entry without an address makes no row (a row never invents an address)', mod.marketSources({ ok: true, sources: [{ keyId: 'k' }, null, 'https://x.invalid/c.json', { url: '  ' }] }).length === 0)
  check('https only, the route\'s own rule, and the address is bounded',
    mod.marketSourceUrlOk('https://example.invalid/c.json') === true && mod.marketSourceUrlOk('http://example.invalid/c.json') === false &&
    mod.marketSourceUrlOk('') === false && mod.marketSourceUrlOk('https://' + 'x'.repeat(2001)) === false)
  eq('the add body is the route\'s own shape, its key optional', mod.marketSourceAdd(' https://example.invalid/c.json ', null), { action: 'source-add', url: 'https://example.invalid/c.json' })
  eq('with the key the person pinned, its edges trimmed', mod.marketSourceAdd(SOURCE, { keyId: ' cat-1 ', pem: ' ' + MINE.pem + ' ' }), { action: 'source-add', url: SOURCE, key: { keyId: 'cat-1', pem: MINE.pem.trim() } })
  check('an address that is not https sends nothing', mod.marketSourceAdd('http://x.invalid/c.json', { keyId: 'k', pem: MINE.pem }) === null)
  check('an oversized key field is not sent (the fields are bounded)', mod.marketSourceAdd(SOURCE, { keyId: 'k', pem: 'x'.repeat(4001) }).key === undefined)
  eq('the remove body is the route\'s own shape', mod.marketSourceRemove(SOURCE), { action: 'source-remove', url: SOURCE })
  check('the route\'s own refusals are said in the person\'s words, an unknown code passes through',
    mod.marketSourceError({ error: 'too-many-sources' }, 'en') === 'Three sources at most.' &&
    mod.marketSourceError({ error: 'an https address is expected' }, 'fr') === 'Une adresse https est attendue.' &&
    mod.marketSourceError({ error: 'odd' }, 'en') === 'odd' && mod.marketSourceError(null, 'en') === 'The source was not saved.')
  // The real route accepts the row's own bodies, and answers back exactly what the row draws: the caller is a caller, not text.
  const dir = mkdtempSync(join(tmpdir(), 'kb-market-src-'))
  try {
    const store = { dir }
    const ports = { sameOrigin: () => true, session: () => true }
    const added = handleThemes(store, { method: 'POST', body: mod.marketSourceAdd(SOURCE, { keyId: 'cat-1', pem: MINE.pem }) }, ports)
    check('A6\'s route accepts the row\'s add body', added.status === 200 && added.body.ok === true, added)
    const afterAdd = mod.marketSources(handleThemes(store, { method: 'GET' }, ports).body)
    check('the route answers back what the row draws: the address, its key id, pinned', afterAdd.length === 1 && afterAdd[0].url === SOURCE && afterAdd[0].keyId === 'cat-1' && afterAdd[0].pinned === true, afterAdd)
    const removed = handleThemes(store, { method: 'POST', body: mod.marketSourceRemove(SOURCE) }, ports)
    check('A6\'s route accepts the row\'s remove body, and the list reads empty again',
      removed.status === 200 && removed.body.removed === true && mod.marketSources(handleThemes(store, { method: 'GET' }, ports).body).length === 0, removed)
  } finally { rmSync(dir, { recursive: true, force: true }) }
  // The caller proof at the block level: the row hands A6's door the two actions and opens no door of its own.
  check('the row calls source-add and source-remove through A6\'s route door, and adds no second one',
    /marketSourceAdd\(/.test(ui[1]) && /marketSourceRemove\(/.test(ui[1]) && /kbThApi\(body\)/.test(ui[1]) &&
    !/fetch\(/.test(ui[1].replace(/fetch\('\/kybernos\/themes'[^)]*\)/, '')))
  check('the row is a Settings surface: drawn by the section, with its warning and its bound of three',
    /h\(KbMarketSources, \{ lang, view, reload: relire \}\)/.test(ui[1]) && /'data-kb': 'kb-market-sources'/.test(ui[1]) &&
    /Community level/.test(ui[1]) && /'\{n\} sur 3'/.test(ui[1]) && /MARKET_SOURCES_MAX/.test(ui[1]))

  // The row really RENDERS, and its clicks reach A6's route: the UI block is evaluated with a three-line React stub (the block's
  // registration effects are stubbed too), the tree is walked like a person would, and the handler is called.
  const stub = [
    'const calls = []',
    'const hooks = []',
    'let hookAt = 0',
    "const React = { useState: (init) => { const i = hookAt++; if (!(i in hooks)) hooks[i] = init; return [hooks[i], (v) => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v }] }, createElement: (t, p, ...c) => ({ t, p, c }) }",
    'const h = React.createElement',
    'const ctx = { effect: () => undefined }',
    'const slots = { inject: () => undefined, register: () => ({}) }',
    'const styles = { insert: () => undefined }',
    "const kbLangResolve = () => 'en'",
    'const kbThApi = (body) => { calls.push(body); return Promise.resolve({ ok: true }) }',
  ].join('\n') + '\n'
  // A real file rather than a data: URL: a bad extraction then fails with a line in the block, not a 15 KB encoded message.
  const uiDir = mkdtempSync(join(tmpdir(), 'kb-market-ui-'))
  const uiFile = join(uiDir, 'block.mjs')
  // The pure block comes with it: the row reads its bodies from there, the way the real factory does. The stub owns the hooks and
  // the recorded calls (a temp module does not share this file's scope), and exports `renderRow` to render it.
  writeFileSync(uiFile, pure[1] + '\n' + stub + ui[1] +
    "\nconst renderRow = (props) => { hookAt = 0; return KbMarketSources(props) }\nexport { KbMarketSources, renderRow, calls }\n")
  const uiMod = await import('file://' + uiFile)
  const render = uiMod.renderRow
  const calls = uiMod.calls
  const walk = (node, out) => {
    if (node === null || typeof node !== 'object') return out
    if (Array.isArray(node)) { for (const n of node) walk(n, out); return out }
    out.push(node)
    walk(node.c, out)
    return out
  }
  const by = (tree, kb, tag) => walk(tree, []).filter((n) => n.p !== null && typeof n.p === 'object' && n.p['data-kb'] === kb && (tag === undefined || n.t === tag))[0]
  const rowTree = render({ lang: 'en', view: { ok: true, sources: [{ url: SOURCE, keyId: 'cat-1', pinned: true }] }, reload: null })
  check('the row renders the route\'s source, its pinned key and the warning, inside the Settings block',
    by(rowTree, 'kb-market-source') !== undefined && JSON.stringify(rowTree).indexOf(SOURCE) >= 0 &&
    JSON.stringify(rowTree).indexOf('Key pinned · cat-1') >= 0 && JSON.stringify(rowTree).indexOf('Community level') >= 0)
  const removeBtn = by(rowTree, 'kb-market-source-remove', 'button')
  check('the row offers a Remove per source', removeBtn !== undefined)
  if (removeBtn !== undefined) {
    calls.length = 0
    await removeBtn.p.onClick()
    check('the Remove click sends A6\'s own remove body to A6\'s own door', JSON.stringify(calls) === JSON.stringify([{ action: 'source-remove', url: SOURCE }]), calls)
  }
  const emptyTree = render({ lang: 'en', view: { ok: true, sources: [] }, reload: null })
  const urlField = by(emptyTree, 'kb-market-source-url', 'input')
  check('the add fields are bounded and https-only (the button stays disabled until a valid address)', urlField !== undefined && urlField.p.maxLength === 2000 && by(emptyTree, 'kb-market-source-add', 'button').p.disabled === true)
  if (urlField !== undefined) urlField.p.onChange({ target: { value: 'https://self.invalid/catalogue.json' } })
  const typed = render({ lang: 'en', view: { ok: true, sources: [] }, reload: null })
  const addBtn = by(typed, 'kb-market-source-add', 'button')
  check('a valid https address enables the add, which sends A6\'s own add body', addBtn.p.disabled === false)
  calls.length = 0
  await addBtn.p.onClick()
  check('the Add click sends A6\'s own add body to A6\'s own door', JSON.stringify(calls) === JSON.stringify([{ action: 'source-add', url: 'https://self.invalid/catalogue.json' }]), calls)
  const frenchRow = render({ lang: 'fr', view: { ok: true, sources: [{ url: SOURCE, keyId: 'cat-1', pinned: true }] }, reload: null })
  check('the row speaks French in French', JSON.stringify(frenchRow).indexOf('Sources du catalogue') >= 0 && JSON.stringify(frenchRow).indexOf('Clé épinglée · cat-1') >= 0)
  rmSync(uiDir, { recursive: true, force: true })
}

console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
