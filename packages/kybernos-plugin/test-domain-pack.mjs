// Domain packs: the format check, the loader, and the packs this repository ships (docs/dev/domain-packs.md).
//
//   node packages/kybernos-plugin/test-domain-pack.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOG } from '../kybernos-composio/catalog.js'
import { FORMAT, ROW_IDS, BUSINESS_ROW_IDS, HIDEABLE, ICONS, HOME_IDS, MODES, PRESETS, TOPOLOGIES, BUNDLED_SOURCE, LIMITS, validatePack, checkSet, loadPacks, domainOfProfil, OWNER_VERSION, DOMAIN_POINT, DOMAIN_POINT_REF, CONTRIBUTED_ORDER, validateContribution, mergePackSets, validateTeamTemplate, validateAutomationTemplate, TEAM_POINT, TEAM_POINT_REF, AUTOMATION_POINT, AUTOMATION_POINT_REF, CORE_POINTS, KIT_POINTS, packsOf } from './domain-pack.mjs'
import { createRegistry } from '../kybernos-registry/registry.mjs' // a test may reach across bundles; the code never does

const here = fileURLToPath(new URL('.', import.meta.url))
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const T = (en, fr) => ({ en, fr })
const good = () => ({
  v: 1, id: 'demo', order: 40, theme: 'sante-teal', accent: '#1B7F76', icon: 'heart', name: T('Demo', 'Démo'), tagline: T('A demo', 'Une démo'), keywords: ['demo', 'test case'], home: ['doc', 'sheet'], legacyJobs: ['old'],
  menu: { labels: { dashboards: T('Numbers', 'Chiffres') }, hide: ['documents'] }, mode: 'code', agents: { preset: 'prudent', why: T('Careful here', 'Prudent ici') },
  goals: [{ id: 'one', search: ['one thing', 'do one'], name: T('One', 'Un'), title: T('Do one', 'Faire un'), desc: T('One thing', 'Une chose'), skills: [{ source: 'anthropics/skills', name: 'pdf', d: T('Read PDFs', 'Lit des PDF') }], teams: ['studencik'], connectors: ['gmail', 'googlecalendar'], automations: [{ id: 'weekly', name: T('Weekly', 'Hebdo'), prompt: T('Every Friday: summarise the week.\nOne page.', 'Chaque vendredi : résume la semaine.'), cron: '0 17 * * 5' }], soon: [T('Later', 'Plus tard')], starter: T('Start', 'Commence') }]
})
const bad = (mutate, fileId = 'demo') => { const p = good(); mutate(p); return validatePack(p, fileId) }

/* ── the format ──────────────────────────────────────────────────────────── */
ok('a well-formed pack is accepted and comes back as it went in', () => {
  const r = validatePack(good(), 'demo')
  assert.equal(r.ok, true)
  assert.deepEqual(r.pack, good())
})
ok('the format version is 1 and the menu rows are the sidebar\'s', () => {
  assert.equal(FORMAT, 1)
  assert.deepEqual(ROW_IDS, ['kyber', 'dashboards', 'aiteams', 'projects', 'deliverables', 'tasks', 'skills', 'connectors', 'documents'])
  assert.deepEqual(HIDEABLE, ['documents'])
})
ok('a pack may also rename the three rows the business plugins declare, and still nothing that is not a row', () => {
  assert.deepEqual(BUSINESS_ROW_IDS, ['contacts', 'catalog', 'pipeline'])
  assert.equal(BUSINESS_ROW_IDS.filter((x) => ROW_IDS.indexOf(x) >= 0).length, 0, 'no id is both a core row and a business row')
  const r = bad((p) => { p.menu.labels = { contacts: T('Clients', 'Clients'), catalog: T('Properties', 'Biens'), pipeline: T('Deals', 'Dossiers') } })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.deepEqual(Object.keys(r.pack.menu.labels), ['contacts', 'catalog', 'pipeline'])
  const no = bad((p) => { p.menu.labels = { contacts: T('Clients', 'Clients'), inbox: T('Inbox', 'Boîte') } })
  assert.equal(no.ok, false)
  assert.ok(no.errors.some((e) => /menu\.labels: "inbox" is not a menu row/.test(e)), JSON.stringify(no.errors))
  assert.deepEqual(HIDEABLE.filter((x) => BUSINESS_ROW_IDS.indexOf(x) >= 0), [], 'a business row is renamed, never hidden by a pack: its plugin is the switch')
})
ok('the order is an integer from 1 to 99, 50 when absent, and the loader lists by it', () => {
  assert.equal(bad((p) => { p.order = 0 }).ok, false)
  assert.equal(bad((p) => { p.order = 100 }).ok, false)
  assert.equal(bad((p) => { p.order = 2.5 }).ok, false)
  assert.equal(bad((p) => { p.order = '3' }).ok, false)
  assert.equal(bad((p) => { delete p.order }).pack.order, 50)
  const dir = mkdtempSync(join(tmpdir(), 'kb-packs-'))
  try {
    for (const [id, order] of [['aaa', 30], ['bbb', 10], ['ccc', 10]]) writeFileSync(join(dir, id + '.json'), JSON.stringify({ ...good(), id, order, legacyJobs: [] }))
    assert.deepEqual(loadPacks(dir).packs.map((p) => p.id), ['bbb', 'ccc', 'aaa'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('the colour, the icon, the keywords and the home order are checked', () => {
  assert.deepEqual(ICONS.slice(0, 3), ['cap', 'heart', 'house'])
  assert.equal(HOME_IDS.length, 13)
  assert.equal(bad((p) => { delete p.accent }).ok, false)
  for (const c of ['red', '#fff', '#12345', '#GGGGGG', 123]) assert.equal(bad((p) => { p.accent = c }).ok, false)
  assert.equal(bad((p) => { p.icon = 'skull' }).ok, false)
  assert.equal(bad((p) => { delete p.icon }).ok, false)
  assert.equal(bad((p) => { p.keywords = ['Has Capitals'] }).ok, false)
  assert.equal(bad((p) => { p.keywords = ['x'.repeat(LIMITS.keyword + 1)] }).ok, false)
  assert.equal(bad((p) => { p.keywords = Array.from({ length: LIMITS.keywords + 1 }, (_, i) => 'k' + i) }).ok, false)
  assert.deepEqual(bad((p) => { p.keywords = ['a b', 'a b', "o'k"] }).pack.keywords, ['a b', "o'k"], 'a keyword listed twice is kept once')
  assert.equal(bad((p) => { p.home = ['nope'] }).ok, false)
  assert.equal(bad((p) => { p.home = HOME_IDS.slice(0, LIMITS.home + 1) }).ok, false)
  assert.equal(bad((p) => { delete p.keywords; delete p.home }).ok, true)
})
ok('an automation has an id, a name, a prompt and a schedule', () => {
  const a = (f) => bad((p) => f(p.goals[0].automations[0]))
  assert.equal(a((x) => { x.cron = '* * *' }).ok, false)
  assert.equal(a((x) => { x.cron = '0 17 * * 5; rm' }).ok, false)
  assert.equal(a((x) => { x.id = 'Bad Id' }).ok, false)
  assert.equal(a((x) => { delete x.prompt }).ok, false)
  assert.equal(a((x) => { x.extra = 1 }).ok, false)
  assert.equal(a((x) => { x.prompt.en = 'x'.repeat(LIMITS.prompt + 1) }).ok, false)
  assert.equal(a((x) => { x.prompt.en = 'a <script>' }).ok, false)
  assert.equal(a((x) => { x.name.en = 'two\nlines' }).ok, false, 'a name is one line')
  assert.equal(a((x) => { x.prompt.en = 'one\ntwo' }).ok, true, 'a prompt may have line breaks')
  assert.equal(bad((p) => { p.goals[0].automations.push({ ...p.goals[0].automations[0] }) }).ok, false, 'the same automation twice in a goal')
  assert.equal(bad((p) => { p.goals[0].automations = Array.from({ length: LIMITS.automations + 1 }, (_, i) => ({ ...good().goals[0].automations[0], id: 'a' + i })) }).ok, false)
  assert.equal(bad((p) => { p.goals[0].skills = []; p.goals[0].teams = []; p.goals[0].soon = [] }).ok, true, 'a goal with only an automation is a goal')
})
ok('a skill the plugin ships is named by the source "kybernos", nothing else is accepted for it', () => {
  assert.equal(BUNDLED_SOURCE, 'kybernos')
  assert.equal(bad((p) => { p.goals[0].skills[0].source = 'kybernos' }).ok, true)
  assert.equal(bad((p) => { p.goals[0].skills[0].source = 'Kybernos' }).ok, false)
  assert.equal(bad((p) => { p.goals[0].skills[0].source = 'kybernos/x/y' }).ok, false)
})
ok('what is not a pack is refused', () => {
  for (const v of [null, undefined, 3, 'x', [], true]) assert.equal(validatePack(v, 'demo').ok, false)
})
ok('an unknown key is refused at every level', () => {
  assert.equal(bad((p) => { p.extra = 1 }).ok, false)
  assert.equal(bad((p) => { p.menu.extra = 1 }).ok, false)
  assert.equal(bad((p) => { p.goals[0].extra = 1 }).ok, false)
  assert.equal(bad((p) => { p.goals[0].skills[0].extra = 1 }).ok, false)
  assert.equal(bad((p) => { p.name.de = 'Demo' }).ok, false)
})
ok('the id is a valid id and the file name', () => {
  assert.equal(bad((p) => { p.id = 'Demo' }, 'Demo').ok, false)
  assert.equal(bad((p) => { p.id = 'x' }, 'x').ok, false)
  assert.equal(bad((p) => { p.id = 'other' }).ok, false, 'a pack whose id is not its file name')
  assert.equal(bad((p) => { p.v = 2 }).ok, false)
})
ok('a text needs English, stays short and plain', () => {
  assert.equal(bad((p) => { p.name = { fr: 'Démo' } }).ok, false)
  assert.equal(bad((p) => { p.name = 'Demo' }).ok, false)
  assert.equal(bad((p) => { p.name.en = '' }).ok, false)
  assert.equal(bad((p) => { p.name.en = 'x'.repeat(LIMITS.text + 1) }).ok, false)
  assert.equal(bad((p) => { p.name.en = '<b>Demo</b>' }).ok, false)
  assert.equal(bad((p) => { p.name.en = 'Dem\u0001o' }).ok, false)
  assert.equal(bad((p) => { p.name = { en: 'Demo' } }).ok, true, 'English alone is enough')
})
ok('the menu may rename the rows of the sidebar and hide only what is hideable', () => {
  assert.equal(bad((p) => { p.menu.labels = { nope: T('X', 'X') } }).ok, false)
  assert.equal(bad((p) => { p.menu.hide = ['skills'] }).ok, false, 'a row that is the only door to a page stays')
  assert.equal(bad((p) => { p.menu.hide = ['documents', 'documents'] }).ok, false, 'a row listed twice is a typo')
  assert.equal(bad((p) => { delete p.menu }).ok, true)
  assert.deepEqual(bad((p) => { delete p.menu }).pack.menu, { labels: {}, hide: [] })
})
ok('a skill is a skill name from a GitHub owner/repo, once per goal', () => {
  assert.equal(bad((p) => { p.goals[0].skills[0].name = 'Not A Skill' }).ok, false)
  assert.equal(bad((p) => { p.goals[0].skills[0].name = '../pdf' }).ok, false)
  assert.equal(bad((p) => { p.goals[0].skills[0].source = 'https://evil.example/x' }).ok, false)
  assert.equal(bad((p) => { p.goals[0].skills[0].source = 'noslash' }).ok, false)
  assert.equal(bad((p) => { p.goals[0].skills.push({ ...p.goals[0].skills[0] }) }).ok, false)
  assert.equal(bad((p) => { delete p.goals[0].skills[0].d }).ok, false)
  assert.equal(bad((p) => { p.goals[0].skills = Array.from({ length: LIMITS.skills + 1 }, (_, i) => ({ source: 'a/b', name: 's' + i, d: T('x', 'x') })) }).ok, false)
})
ok('a team is an id, a goal asks for something, goal ids are unique, the list is bounded', () => {
  assert.equal(bad((p) => { p.goals[0].teams = ['Not An Id'] }).ok, false)
  assert.equal(bad((p) => { p.goals[0].skills = []; p.goals[0].teams = []; p.goals[0].soon = []; p.goals[0].automations = [] }).ok, false)
  assert.equal(bad((p) => { p.goals.push({ ...p.goals[0] }) }).ok, false, 'two goals of one id')
  assert.equal(bad((p) => { p.goals = [] }).ok, false)
  assert.equal(bad((p) => { delete p.goals }).ok, false)
  assert.equal(bad((p) => { p.goals = Array.from({ length: LIMITS.goals + 1 }, (_, i) => ({ ...good().goals[0], id: 'g' + i })) }).ok, false)
  assert.equal(bad((p) => { p.goals[0].teams = ['a', 'b', 'c', 'd'] }).ok, false)
})
ok('a refused pack says why, never throws', () => {
  const r = bad((p) => { p.id = 'other'; p.goals = [] })
  assert.equal(r.ok, false)
  assert.ok(r.errors.length >= 2 && r.errors.every((e) => typeof e === 'string' && e.length > 0))
})

ok('a pack may name one style preset, and names none when it does not', () => {
  const withTheme = bad((p) => { p.theme = 'sante-teal' })
  assert.equal(withTheme.ok, true, JSON.stringify(withTheme.errors))
  assert.equal(withTheme.pack.theme, 'sante-teal')
  assert.equal(bad((p) => { delete p.theme }).pack.theme, null, 'absent reads as null, like order and mode')
  for (const t of ['Sante Teal', '-x', 'x'.repeat(41), '', 7, {}, ['a']]) {
    const r = bad((p) => { p.theme = t })
    assert.equal(r.ok, false, JSON.stringify(t))
    assert.ok(r.errors.some((e) => /^theme: /.test(e)), JSON.stringify(t) + ' -> ' + JSON.stringify(r.errors))
    assert.ok(!r.errors.some((e) => /unknown key/.test(e)), 'theme is a known key: the refusal is its own, not the old unknown-key one')
  }
})
ok('the theme key opened no other door: a second colour, CSS or an accessibility block is still unknown', () => {
  const withTheme = (extra) => bad((p) => { p.theme = 'sante-teal'; Object.assign(p, extra) })
  assert.equal(withTheme({}).ok, true)
  for (const k of ['css', 'accent2', 'a11y']) {
    const r = withTheme({ [k]: '#000000' })
    assert.equal(r.ok, false, k)
    assert.ok(r.errors.some((e) => /unknown key/.test(e) && e.indexOf(k) >= 0), k + ' -> ' + JSON.stringify(r.errors))
  }
  assert.equal(bad((p) => { p.theme = 'sante-teal'; p.accent = '#1B7F76'; p.accent2 = '#ffffff' }).ok, false, 'one accent, never two')
})

/* ── the loader ──────────────────────────────────────────────────────────── */
ok('the loader keeps the good files, reports the bad ones and never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-packs-'))
  try {
    const put = (name, v) => writeFileSync(join(dir, name), typeof v === 'string' ? v : JSON.stringify(v))
    put('demo.json', good())
    put('broken.json', '{ not json')
    put('wrong.json', { ...good(), id: 'other' })
    put('zclash.json', { ...good(), id: 'zclash' })
    put('notes.txt', 'ignored')
    const r = loadPacks(dir)
    assert.deepEqual(r.packs.map((p) => p.id), ['demo'])
    assert.deepEqual(r.rejected.map((x) => x.file).sort(), ['broken.json', 'wrong.json', 'zclash.json'])
    assert.match(r.rejected.find((x) => x.file === 'zclash.json').errors[0], /legacy job "old"/)
    assert.equal(loadPacks(join(dir, 'missing')).packs.length, 0)
    assert.equal(loadPacks(join(dir, 'missing')).rejected.length, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('a legacy job claimed by two packs is reported', () => {
  const a = validatePack(good(), 'demo').pack
  const b = { ...a, id: 'other' }
  assert.equal(checkSet([a, b]).length, 1)
  assert.equal(checkSet([a]).length, 0)
})
ok('a saved profession reads as its domain', () => {
  const packs = [validatePack(good(), 'demo').pack]
  assert.equal(domainOfProfil(packs, 'demo'), 'demo')
  assert.equal(domainOfProfil(packs, 'old'), 'demo')
  for (const v of ['nope', '', null, undefined, 4]) assert.equal(domainOfProfil(packs, v), null)
})

/* ── the search phrases of a goal (what the skill scout asks the index) ───── */
ok('a goal may carry up to two search phrases: lower case English words, 2 to 32 characters, each once', () => {
  assert.equal(LIMITS.search, 2)
  assert.equal(bad((p) => { p.goals[0].search = ['one thing', 'one thing'] }).pack.goals[0].search.length, 1)
  assert.equal(bad((p) => { delete p.goals[0].search }).pack.goals[0].search.length, 0)
  for (const x of ['Upper Case', 'a', 'x'.repeat(33), '', 12, 'semi;colon', '<b>']) assert.equal(bad((p) => { p.goals[0].search = [x] }).ok, false, String(x))
  assert.equal(bad((p) => { p.goals[0].search = ['one', 'two', 'three'] }).ok, false)
  assert.equal(bad((p) => { p.goals[0].search = 'one thing' }).ok, false)
})

/* ── the packs this repository ships ─────────────────────────────────────── */
const shipped = loadPacks(join(here, 'domains'))
ok('every goal of every shipped pack gives the scout one or two search phrases, none twice inside a pack', () => {
  for (const pk of shipped.packs) {
    const seen = new Set()
    for (const g of pk.goals) {
      assert.ok(g.search.length >= 1 && g.search.length <= 2, pk.id + '/' + g.id + ' has ' + g.search.length + ' search phrases')
      for (const x of g.search) { assert.ok(!seen.has(x), pk.id + ': « ' + x + ' » is asked twice'); seen.add(x) }
    }
  }
})
// The skill pairs the starter kits verified on 2026-10-14: each exists exactly once in its GitHub repository, which is what the install
// route needs. Add a pair here only after checking it the same way.
const VERIFIED = [
  'anthropics/claude-for-legal study-plan', 'anthropics/claude-for-legal flashcards',
  'anthropics/skills pdf', 'anthropics/skills docx', 'anthropics/skills xlsx', 'anthropics/skills pptx', 'anthropics/skills webapp-testing', 'anthropics/skills frontend-design',
  'anthropics/knowledge-work-plugins code-review', 'anthropics/knowledge-work-plugins testing-strategy', 'anthropics/knowledge-work-plugins sql-queries',
  'anthropics/knowledge-work-plugins statistical-analysis', 'anthropics/knowledge-work-plugins draft-outreach', 'anthropics/knowledge-work-plugins campaign-plan',
  'anthropics/knowledge-work-plugins incident-response', 'anthropics/knowledge-work-plugins write-spec', 'anthropics/knowledge-work-plugins roadmap-update',
  'anthropics/knowledge-work-plugins sprint-planning', 'anthropics/knowledge-work-plugins user-research', 'anthropics/knowledge-work-plugins design-critique',
  'anthropics/knowledge-work-plugins ux-copy', 'anthropics/knowledge-work-plugins financial-statements', 'anthropics/knowledge-work-plugins reconciliation',
  'anthropics/knowledge-work-plugins variance-analysis', 'anthropics/knowledge-work-plugins content-creation', 'anthropics/knowledge-work-plugins brand-voice-enforcement',
  'anthropics/knowledge-work-plugins ticket-triage', 'anthropics/knowledge-work-plugins seo-audit', 'anthropics/knowledge-work-plugins review-contract',
  'anthropics/knowledge-work-plugins compliance-check'
]
const client = readFileSync(join(here, 'client.js'), 'utf8')
const marketIds = [...client.slice(client.indexOf('const KB_MARKET_TEAMS = ['), client.indexOf('// Manifest read-only')).matchAll(/^        id: '([a-z0-9-]+)', name:/gm)].map((m) => m[1]).sort()
const OLD_JOBS = ['soft', 'entre', 'qa', 'produit', 'design', 'etudes', 'finance', 'medias', 'commerce', 'marketing', 'legal', 'autres']

const bundledNames = shipped.packs.flatMap((p) => p.goals.flatMap((g) => g.skills.filter((s) => s.source === BUNDLED_SOURCE).map((s) => s.name)))
ok('every skill the packs say the plugin ships is a folder with a SKILL.md that names it', () => {
  assert.ok(bundledNames.length >= 10)
  for (const name of new Set(bundledNames)) {
    const text = readFileSync(join(here, 'domains', 'skills', name, 'SKILL.md'), 'utf8')
    const m = /^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/.exec(text)
    assert.ok(m !== null, name + ': frontmatter')
    assert.equal(m[1], name, name + ': the folder and the skill name are the same')
    assert.ok(m[2].length > 40 && m[2].length <= 1024, name + ': a description DSH accepts')
    assert.ok(/Use when|Use this/i.test(m[2]), name + ': the description says when to use it')
    assert.ok(!/[\u0000]/.test(text) && text.length < 12000 && text.length > 800, name + ': a plain text of a sensible size')
  }
})
ok('no skill folder is left unused', () => {
  const folders = readdirSync(join(here, 'domains', 'skills'))
  assert.deepEqual(folders.filter((f) => !bundledNames.includes(f)), [])
})
ok('every automation is complete in both languages, never sends, and names only skills that exist', () => {
  const all = shipped.packs.flatMap((p) => p.goals.flatMap((g) => g.automations.map((a) => ({ pack: p.id, goal: g.id, ...a }))))
  assert.ok(all.length >= 20)
  const skillNames = new Set(shipped.packs.flatMap((p) => p.goals.flatMap((g) => g.skills.map((s) => s.name))))
  const ids = all.map((a) => a.pack + '/' + a.id)
  assert.equal(new Set(ids).size, ids.length, 'automation ids are unique in a pack')
  for (const a of all) {
    for (const lang of ['en', 'fr']) assert.ok(typeof a.prompt[lang] === 'string' && a.prompt[lang].length > 60 && typeof a.name[lang] === 'string', a.pack + '/' + a.id + ': ' + lang)
    // an automation that writes to people drafts only: it says so, in both languages
    if (/draft|reminder|repl(y|ies)|confirmation/i.test(a.prompt.en)) {
      assert.ok(/never send|do not send|never order|drafts only/i.test(a.prompt.en), a.pack + '/' + a.id + ': it drafts, so it must say it never sends')
      assert.ok(/n’envoie|ne les envoie|ne l’envoie|n'envoie|ne commande|brouillons seulement/i.test(a.prompt.fr), a.pack + '/' + a.id + ': the French prompt says it too')
    }
    for (const m of (a.prompt.en + ' ').matchAll(/\b([a-z]+(?:-[a-z]+)+) skill\b/g)) assert.ok(skillNames.has(m[1]) || ['dsh', 'a'].includes(m[1]), a.pack + '/' + a.id + ' names the skill ' + m[1] + ' which no pack carries')
  }
})
ok('the keywords find each field in a sentence, the catch-all has none', () => {
  const kw = (id) => shipped.packs.find((p) => p.id === id).keywords
  assert.ok(kw('sante').includes('kine') && kw('droit').includes('avocat') && kw('immo').includes('agence') && kw('general').length === 0)
  const owner = {}
  for (const p of shipped.packs) for (const k of p.keywords) (owner[k] = owner[k] || []).push(p.id)
  assert.deepEqual(Object.entries(owner).filter(([, v]) => v.length > 1).map(([k, v]) => k + ':' + v.join('+')), [], 'a keyword belongs to one field')
})
ok('every pack has a colour, an icon and a home order of real new-chat templates', () => {
  for (const p of shipped.packs) {
    assert.ok(/^#[0-9a-f]{6}$/i.test(p.accent) && ICONS.includes(p.icon) && p.home.length >= 2 && p.home.every((h) => HOME_IDS.includes(h)), p.id)
  }
  assert.equal(new Set(shipped.packs.map((p) => p.accent)).size, shipped.packs.length, 'one colour per field')
})
// The nine fields of work this repository ships: a later campaign may add a tenth, anywhere, without reddening this file (D10).
const SHIPPED_IDS = ['edu', 'sante', 'immo', 'droit', 'fin', 'com', 'mkt', 'dev', 'general']
const SHIPPED_PRESETS = { edu: 'balanced', sante: 'prudent', immo: 'balanced', droit: 'prudent', fin: 'prudent', com: 'balanced', mkt: 'balanced', dev: 'auto', general: 'balanced' }
ok('every shipped pack loads, and the nine fields of work keep their order, the catch-all last', () => {
  assert.deepEqual(shipped.rejected, [])
  const ids = shipped.packs.map((p) => p.id)
  assert.deepEqual(ids.filter((id) => SHIPPED_IDS.includes(id)), SHIPPED_IDS, 'listed in the pack\'s own order, the catch-all last')
  assert.equal(ids[ids.length - 1], 'general', 'the catch-all is last even when a tenth pack is ordered before it')
})
ok('every pack has English and French everywhere and between 4 and 6 goals', () => {
  const texts = []
  const walk = (v) => { if (v !== null && typeof v === 'object') { if (typeof v.en === 'string') texts.push(v); else Object.values(v).forEach(walk) } }
  for (const p of shipped.packs) {
    assert.ok(p.goals.length >= 4 && p.goals.length <= 6, p.id + ': ' + p.goals.length + ' goals')
    walk(p)
  }
  assert.ok(texts.length > 300)
  assert.deepEqual(texts.filter((t) => typeof t.fr !== 'string'), [])
})
ok('every skill is one the starter kits verified', () => {
  const used = shipped.packs.flatMap((p) => p.goals.flatMap((g) => g.skills.filter((s) => s.source !== BUNDLED_SOURCE).map((s) => s.source + ' ' + s.name)))
  assert.deepEqual([...new Set(used)].filter((x) => VERIFIED.indexOf(x) < 0), [])
})
ok('nothing the old kits offered is lost', () => {
  const used = new Set(shipped.packs.flatMap((p) => p.goals.flatMap((g) => g.skills.filter((s) => s.source !== BUNDLED_SOURCE).map((s) => s.source + ' ' + s.name))))
  assert.deepEqual(VERIFIED.filter((x) => !used.has(x)), [])
})
ok('the display mode and the agents\' starting point are checked, and absent means « bureau » and « balanced »', () => {
  assert.deepEqual([MODES, PRESETS], [['bureau', 'code'], ['prudent', 'balanced', 'auto']])
  const bare = bad((p) => { delete p.mode; delete p.agents }).pack
  assert.deepEqual([bare.mode, bare.agents], ['bureau', { preset: 'balanced', why: null }])
  for (const m of ['Code', 'text', 3, null]) assert.equal(bad((p) => { p.mode = m }).ok, false, String(m))
  assert.equal(bad((p) => { p.agents = { preset: 'wild' } }).ok, false)
  assert.equal(bad((p) => { p.agents = { preset: 'auto', extra: 1 } }).ok, false)
  assert.equal(bad((p) => { p.agents = { preset: 'auto', why: { fr: 'x' } } }).ok, false)
  assert.equal(bad((p) => { p.agents = 'auto' }).ok, false)
})
ok('every shipped pack says how much its agents may do alone and why, and only Development starts in code mode', () => {
  for (const p of shipped.packs) assert.ok(p.agents.why !== null && typeof p.agents.why.fr === 'string', p.id)
  assert.deepEqual(shipped.packs.filter((p) => p.mode === 'code').map((p) => p.id), ['dev'])
  const presets = Object.fromEntries(shipped.packs.map((p) => [p.id, p.agents.preset]))
  assert.deepEqual(Object.fromEntries(Object.entries(presets).filter(([id]) => SHIPPED_PRESETS[id] !== undefined)), SHIPPED_PRESETS)
  assert.deepEqual(Object.entries(presets).filter(([id, preset]) => SHIPPED_PRESETS[id] === undefined && !PRESETS.includes(preset)), [], 'a tenth pack picks one of the three presets')
})
ok('a goal names at most four apps, each a plain slug, each once; anything else is refused', () => {
  assert.equal(LIMITS.connectors, 4)
  assert.deepEqual(bad((p) => { p.goals[0].connectors = ['gmail', 'gmail', 'notion'] }).pack.goals[0].connectors, ['gmail', 'notion'])
  assert.deepEqual(bad((p) => { delete p.goals[0].connectors }).pack.goals[0].connectors, [])
  for (const v of [['Gmail'], ['g'], ['a b'], [1], ['https://x.test'], ['a', 'b', 'c', 'd', 'e'], 'gmail']) assert.equal(bad((p) => { p.goals[0].connectors = v }).ok, false, JSON.stringify(v))
})
ok('every app a pack puts forward is in the Connectors catalogue, and every field has some', () => {
  const slugs = new Set(CATALOG.map((a) => a.s))
  const used = shipped.packs.flatMap((p) => p.goals.flatMap((g) => g.connectors))
  assert.deepEqual([...new Set(used)].filter((s) => !slugs.has(s)), [])
  assert.deepEqual(shipped.packs.filter((p) => p.goals.every((g) => g.connectors.length === 0)).map((p) => p.id), [])
})
ok('every team exists in the marketplace of the bundle', () => {
  assert.deepEqual(marketIds, ['inbound-closer', 'research-desk', 'studencik'])
  assert.deepEqual([...new Set(shipped.packs.flatMap((p) => p.goals.flatMap((g) => g.teams)))].filter((t) => marketIds.indexOf(t) < 0), [])
})
ok('the students are offered the team the product ships for them', () => {
  assert.ok(shipped.packs.find((p) => p.id === 'edu').goals.some((g) => g.teams.indexOf('studencik') >= 0))
})
ok('each of the twelve professions the previous wizard stored reads as exactly one domain', () => {
  assert.deepEqual(OLD_JOBS.map((j) => domainOfProfil(shipped.packs, j)),
    ['dev', 'com', 'dev', 'dev', 'dev', 'edu', 'fin', 'mkt', 'com', 'mkt', 'droit', 'general'])
})
ok('a pack renames only rows that exist and keeps the ones that are a door', () => {
  for (const p of shipped.packs) {
    assert.deepEqual(Object.keys(p.menu.labels).filter((k) => ROW_IDS.indexOf(k) < 0), [])
    assert.deepEqual(p.menu.hide.filter((k) => HIDEABLE.indexOf(k) < 0), [])
    assert.deepEqual(Object.keys(p.menu.labels).filter((k) => ['kyber', 'skills', 'connectors', 'projects'].indexOf(k) >= 0), [], p.id + ' renames a row the first wiring leaves alone')
  }
})
ok('the files carry no path of the machine and no markup', () => {
  for (const p of shipped.packs) {
    const text = readFileSync(join(here, 'domains', p.id + '.json'), 'utf8')
    assert.equal(/\/Users\/|\\Users\\|<\/?[a-z]/i.test(text), false, p.id)
  }
})

/* ── the point other plugins contribute to (docs/dev/plugin-contract.md): kybernos/core#domain-pack ── */
const manifestOfCore = JSON.parse(readFileSync(join(here, 'plugin.json'), 'utf8'))
const pkgOfCore = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
ok('every point the code defines is declared in the manifest, and the owner version is the package\'s', () => {
  assert.deepEqual(manifestOfCore.provides.map((p) => p.name), ['domain-pack', 'team-template', 'automation-template'], 'a fourth point cannot be added without its manifest line')
  for (const { ref, def } of CORE_POINTS) {
    const declared = manifestOfCore.provides.find((p) => p.name === ref.split('#')[1])
    assert.ok(declared !== undefined, ref + ' is not declared in plugin.json provides')
    assert.equal(ref, manifestOfCore.id + '#' + declared.name)
    assert.deepEqual([def.version, def.class, def.kind, declared.validator], [declared.version, declared.class, declared.kind, 'builtin'], ref)
    assert.equal(def.owner, manifestOfCore.id)
  }
  assert.equal(OWNER_VERSION.split('.')[0], pkgOfCore.version.split('.')[0], 'a major bump of the plugin is a change of OWNER_VERSION')
})
ok('validateContribution is the shipped check in the registry\'s shape', () => {
  assert.deepEqual(validateContribution(good(), 'demo'), { ok: true, value: good() })
  const refused = validateContribution({ ...good(), cron: '* * * * *' }, 'demo')
  assert.equal(refused.ok, false)
  assert.ok(refused.errors.some((e) => /cron/.test(e)))
  assert.equal(validateContribution(good(), 'other').ok, false, 'the id is the file name')
})
const teamTemplate = () => ({
  id: 'clinic-assist', name: T('Clinic desk', 'Accueil du cabinet'), desc: T('Answers the phone', 'Repond au telephone'), mission: T('Sorts the requests', 'Trie les demandes'),
  topology: 'pipeline', tags: ['clinic', 'inbound'], color: '#1B7F76', icon: 'heart', category: 'sante', skills: ['ticket-triage'],
  roles: [
    { id: 'greeter', kind: 'scout', prompt: T('Take the call and note the reason.', 'Prends l\'appel et note le motif.'), provider: 'anthropic', model: 'claude-sonnet-4.6' },
    { id: 'verifier', kind: 'checker', prompt: T('Check the answer against the diary.', 'Verifie la reponse avec l\'agenda.') },
  ],
  stages: [
    { id: 'sort', roles: ['greeter'], mode: 'once', cap: 1, gate: false, inputs: [] },
    { id: 'verify', roles: ['verifier'], mode: 'forEach', cap: 4, gate: true, inputs: ['sort'] },
  ],
})
const autoTemplate = () => ({
  id: 'daily-recall', cat: 'prospecting', icon: 'calendar', title: T('Daily recall', 'Rappel quotidien'), cadence: T('Every weekday at 8', 'Chaque jour ouvre a 8 h'),
  cron: '0 8 * * 1-5', desc: T('Prepares the list and queues the drafts', 'Prepare la liste et met les brouillons en file'), tags: ['recall', 'clinic'], apps: ['gmail', 'googlecalendar'],
  steps: [{ kind: 'ai', text: T('Read the list and pick who to call today.', 'Lis la liste et choisis qui appeler.') }, { kind: 'act', text: T('Queue the drafts', 'Mets les brouillons en file') }],
  needs: [T('A list of people to call', 'Une liste de personnes a appeler')],
  guard: [T('Never writes to anyone: the drafts wait for you.', 'N\'ecrit jamais a personne : les brouillons t\'attendent.')],
  ask: [
    { q: T('Where is the list?', 'Ou est la liste ?'), o: [T('In a sheet', 'Dans un tableur'), T('In a file', 'Dans un fichier')] },
    { q: T('Who may it write to?', 'A qui peut-il ecrire ?'), o: [T('Nobody', 'Personne'), T('The team only', 'Seulement l\'equipe')] },
  ],
})
const badTeam = (mutate, fileId = 'clinic-assist') => { const t = teamTemplate(); mutate(t); return validateTeamTemplate(t, fileId) }
const badAuto = (mutate, fileId = 'daily-recall') => { const a = autoTemplate(); mutate(a); return validateAutomationTemplate(a, fileId) }
ok('a team template is a bounded Agent Team the client can draw', () => {
  assert.deepEqual(TOPOLOGIES, ['pool', 'pipeline', 'adversarial', 'mapreduce', 'loop'])
  const r = validateTeamTemplate(teamTemplate(), 'clinic-assist')
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.value.id, 'clinic-assist')
  assert.deepEqual(r.value.stages.map((s) => [s.id, s.roles, s.mode, s.cap, s.gate, s.inputs]), [['sort', ['greeter'], 'once', 1, false, []], ['verify', ['verifier'], 'forEach', 4, true, ['sort']]])
  for (const topology of TOPOLOGIES) assert.equal(badTeam((t) => { t.topology = topology }).ok, true, topology)
  const bare = { id: 'clinic-assist', name: T('Clinic desk', 'Accueil'), topology: 'pool', roles: [{ id: 'greeter', kind: 'doer', prompt: T('Take the call.', 'Prends l\'appel.') }], stages: [{ id: 'sort', roles: ['greeter'], mode: 'once', cap: 1, gate: false, inputs: [] }] }
  assert.equal(validateTeamTemplate(bare, 'clinic-assist').ok, true, 'only the name, the topology, the roles and the stages are required')
  assert.equal(validateTeamTemplate(bare, 'clinic-assist').value.color, null)
})
ok('a team template is refused when the client could not draw it', () => {
  assert.equal(validateTeamTemplate(teamTemplate(), 'other').ok, false, 'the id is the file name')
  const refusals = [
    (t) => { t.css = 'body{}' }, (t) => { t.topology = 'hive' }, (t) => { t.roles = [] }, (t) => { t.stages = [] },
    (t) => { t.name = {} }, (t) => { t.name = 'Clinic desk' }, (t) => { t.name = { en: 'Clinic <b>desk</b>' } },
    (t) => { t.roles = [{ id: 'greeter', kind: 'doer', prompt: T('x'.repeat(LIMITS.prompt + 1), 'x') }] },
    (t) => { t.roles = [{ id: 'greeter', kind: 'doer', prompt: T('   ', 'x') }] },
    (t) => { t.roles = [{ id: 'greeter', kind: 'boss', prompt: T('Take the call.', 'x') }] },
    (t) => { t.roles = [{ id: 'greeter', kind: 'doer', prompt: T('Take the call.', 'x') }, { id: 'greeter', kind: 'checker', prompt: T('Check.', 'x') }] },
    (t) => { t.roles = [{ id: 'greeter', kind: 'doer', prompt: T('Take the call.', 'x'), extra: 1 }] },
    (t) => { t.roles = Array.from({ length: 7 }, (_, i) => ({ id: 'r' + i, kind: 'doer', prompt: T('Take the call.', 'x') })) },
    (t) => { t.stages = [{ id: 'sort', roles: ['ghost'], mode: 'once', cap: 1, gate: false, inputs: [] }] },
    (t) => { t.stages = [{ id: 'sort', roles: [], mode: 'once', cap: 1, gate: false, inputs: [] }] },
    (t) => { t.stages = [{ id: 'sort', roles: ['greeter'], mode: 'once', cap: 0, gate: false, inputs: [] }] },
    (t) => { t.stages = [{ id: 'sort', roles: ['greeter'], mode: 'always', cap: 1, gate: false, inputs: [] }] },
    (t) => { t.stages = [{ id: 'sort', roles: ['greeter'], mode: 'once', cap: 1, gate: 'yes', inputs: [] }] },
    (t) => { t.stages = [{ id: 'sort', roles: ['greeter'], mode: 'once', cap: 1, gate: false, inputs: ['later'] }] },
    (t) => { t.tags = Array.from({ length: 7 }, (_, i) => 't' + i) }, (t) => { t.tags = ['Not a Word'] },
    (t) => { t.color = 'red' }, (t) => { t.icon = 'skull' }, (t) => { t.category = 'Sante' },
    (t) => { t.skills = ['Not A Skill'] },
  ]
  for (const mutate of refusals) assert.equal(badTeam(mutate).ok, false, mutate.toString().slice(0, 90))
})
ok('an automation template is a bounded automation, always created off', () => {
  const r = validateAutomationTemplate(autoTemplate(), 'daily-recall')
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.deepEqual([r.value.id, r.value.cron, r.value.steps.map((s) => s.kind)], ['daily-recall', '0 8 * * 1-5', ['ai', 'act']])
  const noCron = badAuto((a) => { delete a.cron })
  assert.equal(noCron.ok, true, 'no cron: the cadence carries the trigger')
  assert.equal(noCron.value.cron, null)
  const lean = badAuto((a) => { delete a.apps; a.ask = [a.ask[0]] })
  assert.equal(lean.ok, true, 'no app and one question are accepted: the fixture of this batch\'s DoD')
  assert.deepEqual([lean.value.apps, lean.value.ask.length], [[], 1])
})
ok('an automation template is refused when the client could not draw it', () => {
  assert.equal(validateAutomationTemplate(autoTemplate(), 'other').ok, false, 'the id is the file name')
  const refusals = [
    (a) => { a.guard = [] }, (a) => { a.needs = [] }, (a) => { a.tags = [] }, (a) => { a.apps = ['Not An App'] }, (a) => { a.apps = ['gmail', 'gmail', 'drive', 'notion', 'slack'] },
    (a) => { a.steps = [a.steps[0]] }, (a) => { a.steps = [{ kind: 'ai', text: T('only one', 'un seul') }] },
    (a) => { a.steps = [{ kind: 'ask', text: T('Read the list.', 'Lis la liste.') }, a.steps[1]] },
    (a) => { a.steps = [{ kind: 'ai', text: T('x'.repeat(LIMITS.prompt + 1), 'x') }, a.steps[1]] },
    (a) => { a.ask = [] },
    (a) => { a.ask = [{ q: T('Where?', 'Ou ?'), o: [T('One', 'Un')] }] },
    (a) => { a.ask = Array.from({ length: 5 }, () => ({ q: T('Where?', 'Ou ?'), o: [T('One', 'Un'), T('Two', 'Deux')] })) },
    (a) => { a.cron = '* * * *' }, (a) => { a.title = {} }, (a) => { delete a.desc }, (a) => { a.css = 'x' },
    (a) => { a.icon = 'not an icon!' },
  ]
  for (const mutate of refusals) assert.equal(badAuto(mutate).ok, false, mutate.toString().slice(0, 90))
})
ok('the kit table names the four contribution folders once each, and only two are checked here', () => {
  assert.deepEqual(KIT_POINTS.map((p) => [p.folder, p.ref, p.owner, p.slice, p.owned]), [
    ['themes', 'kybernos/theme#theme', 'kybernos/theme', 'themes', false],
    ['skills', 'kybernos/skills#skill', 'kybernos/skills', 'skills', false],
    ['teams', TEAM_POINT_REF, 'kybernos/core', 'teams', true],
    ['automations', AUTOMATION_POINT_REF, 'kybernos/core', 'automations', true],
  ])
  assert.deepEqual(CORE_POINTS.map((p) => p.ref).sort(), [AUTOMATION_POINT_REF, DOMAIN_POINT_REF, TEAM_POINT_REF])
  assert.deepEqual([TEAM_POINT.class, AUTOMATION_POINT.class], ['instruction', 'instruction'], 'a template carries prompts: the person consents first')
})

ok('merging: ours first and untouched, a plugin\'s pack after, saying where it came from', () => {
  const shipped = loadPacks(join(here, 'domains'))
  const mine = { ...good(), id: 'vet', order: 1 }
  const merged = mergePackSets(shipped, [{ plugin: 'local/vet', file: 'domains/vet.json', value: mine }])
  assert.equal(merged.rejected.length, shipped.rejected.length)
  const vet = merged.packs.find((p) => p.id === 'vet')
  assert.equal(vet.from, 'local/vet')
  assert.equal(vet.order, CONTRIBUTED_ORDER.min, 'a plugin cannot put itself before the shipped fields: its order is held at the minimum')
  assert.deepEqual(merged.packs.filter((p) => p.from === undefined).map((p) => p.id), shipped.packs.map((p) => p.id), 'the shipped packs keep their order')
  assert.equal(merged.packs[merged.packs.length - 1].id, 'general', 'the catch-all stays last')
  assert.equal(mergePackSets(shipped, [{ plugin: 'local/vet', file: 'f.json', value: { ...good(), id: 'late', order: 99 } }]).packs.find((p) => p.id === 'late').order, CONTRIBUTED_ORDER.max)
})
ok('merging refuses a pack whose id is taken or that claims a legacy job someone already claims, and says so', () => {
  const shipped = loadPacks(join(here, 'domains'))
  const taken = mergePackSets(shipped, [{ plugin: 'local/vet', file: 'domains/edu.json', value: { ...good(), id: 'edu' } }])
  assert.equal(taken.packs.length, shipped.packs.length)
  assert.match(taken.rejected[taken.rejected.length - 1].errors[0], /already taken/)
  const claimed = mergePackSets(shipped, [{ plugin: 'local/vet', file: 'domains/x.json', value: { ...good(), id: 'x', legacyJobs: ['soft'] } }])
  assert.equal(claimed.packs.length, shipped.packs.length)
  assert.match(claimed.rejected[claimed.rejected.length - 1].errors[0], /legacy job "soft"/)
  const twice = mergePackSets(shipped, [{ plugin: 'local/a', file: 'domains/z.json', value: { ...good(), id: 'z' } }, { plugin: 'local/b', file: 'domains/z.json', value: { ...good(), id: 'z' } }])
  assert.deepEqual(twice.packs.filter((p) => p.id === 'z').map((p) => p.from), ['local/a'], 'the first plugin keeps the id')
})
const contributedClinic = () => ({ plugin: 'acme/clinic', file: 'domains/clinic.json', value: validatePack({ ...good(), id: 'clinic', legacyJobs: [] }, 'clinic').pack })
const kitOf = (ref, entries) => ({ [ref]: entries.map(([file, value]) => ({ plugin: 'acme/clinic', file, value })) })
ok('a plugin\'s templates ride on its own pack, under kit, each saying where it came from', () => {
  const shippedSet = loadPacks(join(here, 'domains'))
  const team = validateTeamTemplate(teamTemplate(), 'clinic-assist').value
  const auto = validateAutomationTemplate(autoTemplate(), 'daily-recall').value
  const merged = mergePackSets(shippedSet, [contributedClinic()], {
    ...kitOf(TEAM_POINT_REF, [['teams/zeta.json', { ...team, id: 'zeta' }], ['teams/clinic-assist.json', team]]),
    ...kitOf(AUTOMATION_POINT_REF, [['automations/daily-recall.json', auto]]),
  })
  const clinic = merged.packs.find((p) => p.id === 'clinic')
  assert.deepEqual(Object.keys(clinic.kit), ['teams', 'automations'])
  assert.deepEqual(clinic.kit.teams.map((t) => t.file), ['teams/clinic-assist.json', 'teams/zeta.json'], 'sorted by (from, file)')
  assert.deepEqual([clinic.kit.teams[0].id, clinic.kit.teams[0].from, clinic.kit.teams[0].file], ['clinic-assist', 'acme/clinic', 'teams/clinic-assist.json'])
  assert.equal(clinic.kit.automations[0].id, 'daily-recall')
  assert.deepEqual(merged.packs.filter((p) => p.from === undefined && 'kit' in p), [], 'a shipped pack never receives a kit')
  assert.equal(clinic.theme, 'sante-teal', 'the kit adds a key, it changes none')
})
ok('a template whose plugin offers no pack is reported, and no contribution leaves the payload byte-identical', () => {
  const shippedSet = loadPacks(join(here, 'domains'))
  assert.deepEqual(mergePackSets(shippedSet, []).packs, shippedSet.packs)
  assert.deepEqual(mergePackSets(shippedSet, [], {}).packs, shippedSet.packs)
  const alone = mergePackSets(shippedSet, [contributedClinic()])
  assert.equal(alone.packs.find((p) => p.id === 'clinic').kit, undefined, 'no template, no kit key')
  const stray = mergePackSets(shippedSet, [contributedClinic()], { [TEAM_POINT_REF]: [{ plugin: 'acme/other', file: 'teams/x.json', value: { id: 'x' } }] })
  assert.deepEqual(stray.rejected[stray.rejected.length - 1], { file: 'acme/other:teams/x.json', errors: ['no pack of acme/other is offered: the template would go nowhere'] })
  assert.deepEqual(stray.packs.find((p) => p.id === 'clinic').kit, { teams: [] }, 'the slice is listed, empty: nothing of that plugin is offered')
})
ok('packsOf tells the three owned points and answers the shipped packs when the registry fails', () => {
  const shippedSet = loadPacks(join(here, 'domains'))
  const defined = []
  const seam = {
    version: 1,
    definePoint: (def) => defined.push(def),
    contributions: (ref) => (ref === TEAM_POINT_REF ? [{ plugin: 'acme/clinic', file: 'teams/clinic-assist.json', value: { id: 'clinic-assist' } }] : []),
  }
  const r = packsOf(shippedSet, seam)
  assert.deepEqual(defined, CORE_POINTS.map((point) => point.def), 'the three points, as the manifest declares them')
  assert.deepEqual(r.packs.map((p) => p.id), shippedSet.packs.map((p) => p.id), 'a template alone offers no pack: the order is untouched')
  const broken = { version: 1, definePoint: () => { throw new Error('boom') }, contributions: () => { throw new Error('boom') } }
  for (const registry of [broken, null, undefined]) assert.deepEqual(packsOf(shippedSet, registry).packs, shippedSet.packs)
  assert.deepEqual(packsOf(shippedSet, null), shippedSet, 'without a registry it is the shipped set itself')
})

ok('end to end with the real registry, on a profile as DSH\'s plugin manager leaves it: a data plugin is offered once the person accepts it, a bad file is left out with the pack check\'s reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-domain-plugin-'))
  const profileDir = join(dir, 'profile')
  const folder = join(profileDir, 'node_modules', 'kybernos-plugin-vet')
  const write = (path, data) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data)) }
  write(join(profileDir, 'package.json'), { dependencies: { 'kybernos-plugin-vet': '1.0.0' }, dsh: { profile: { bundles: ['kybernos-plugin-vet'] } } })
  write(join(folder, 'package.json'), { name: 'kybernos-plugin-vet', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } })
  write(join(folder, 'cordis.patch.yml'), '# a data plugin: DSH loads nothing\n[]\n')
  write(join(folder, 'plugin.json'), {
    contract: 1, id: 'acme/vet', kind: 'data', version: '0.1.0', name: { en: 'Vet' }, description: { en: 'A pack.' }, author: { id: 'acme', name: 'Acme' }, license: 'MIT', pricing: 'free',
    requires: { kybernos: '>=0.1.0', plugins: { 'kybernos/core': '^1.0' } },
    extends: [{ point: DOMAIN_POINT_REF, range: '^1.0', dir: 'domains' }, { point: TEAM_POINT_REF, range: '^1.0', dir: 'teams' }, { point: AUTOMATION_POINT_REF, range: '^1.0', dir: 'automations' }]
  })
  write(join(folder, 'domains', 'vet.json'), { ...good(), id: 'vet', legacyJobs: [] })
  write(join(folder, 'domains', 'bad.json'), { ...good(), id: 'bad', cron: '* * * * *' })
  write(join(folder, 'teams', 'clinic-assist.json'), teamTemplate())
  write(join(folder, 'teams', 'broken-team.json'), { ...teamTemplate(), id: 'broken-team', css: 'body{}' })
  write(join(folder, 'automations', 'daily-recall.json'), autoTemplate())
  const registry = createRegistry({ profileDir, stateFile: join(dir, 'state.json'), kybernosVersion: '0.1.1', ttlMs: 0 })
  for (const point of CORE_POINTS) registry.definePoint(point.def)
  for (const point of CORE_POINTS) registry.definePoint(point.def) // told again at each question: nothing changes
  const shipped = loadPacks(join(here, 'domains'))
  assert.equal(registry.plugins().find((p) => p.id === 'acme/vet').status, 'needs-consent', 'a pack carries prompts: the person accepts first')
  assert.equal(packsOf(shipped, registry).packs.length, shipped.packs.length, 'nothing is offered before')
  registry.setConsent('acme/vet', true)
  const merged = packsOf(shipped, registry)
  assert.equal(merged.packs.length, shipped.packs.length + 1)
  const vet = merged.packs.find((p) => p.id === 'vet')
  assert.equal(vet.from, 'acme/vet')
  assert.deepEqual(vet.kit.teams.map((t) => [t.id, t.from, t.file]), [['clinic-assist', 'acme/vet', 'teams/clinic-assist.json']], 'the template rides on the pack of the plugin that ships it')
  assert.deepEqual(vet.kit.automations.map((a) => [a.id, a.from]), [['daily-recall', 'acme/vet']])
  assert.deepEqual(merged.packs.filter((p) => p.from === undefined && 'kit' in p), [], 'the shipped packs carry no kit')
  const entry = registry.plugins().find((p) => p.id === 'acme/vet')
  assert.equal(entry.status, 'ok')
  const extendsOf = (ref) => entry.extends.find((e) => e.point === ref)
  assert.ok(extendsOf(DOMAIN_POINT_REF).rejected.some((r) => r.file === 'bad.json' && /cron/.test(r.errors.join())), JSON.stringify(extendsOf(DOMAIN_POINT_REF).rejected))
  assert.deepEqual([extendsOf(TEAM_POINT_REF).contributions, extendsOf(AUTOMATION_POINT_REF).contributions], [1, 1])
  assert.ok(extendsOf(TEAM_POINT_REF).rejected.some((r) => r.file === 'broken-team.json' && /unknown key/.test(r.errors.join())), JSON.stringify(extendsOf(TEAM_POINT_REF).rejected))
  rmSync(dir, { recursive: true, force: true })
})

console.log('\n' + count + ' checks passed')
