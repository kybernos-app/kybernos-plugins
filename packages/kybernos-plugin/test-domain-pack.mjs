// Domain packs: the format check, the loader, and the packs this repository ships (docs/dev/domain-packs.md).
//
//   node packages/kybernos-plugin/test-domain-pack.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FORMAT, ROW_IDS, HIDEABLE, LIMITS, validatePack, checkSet, loadPacks, domainOfProfil } from './domain-pack.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const T = (en, fr) => ({ en, fr })
const good = () => ({
  v: 1, id: 'demo', order: 40, name: T('Demo', 'Démo'), tagline: T('A demo', 'Une démo'), legacyJobs: ['old'],
  menu: { labels: { dashboards: T('Numbers', 'Chiffres') }, hide: ['documents'] },
  goals: [{ id: 'one', name: T('One', 'Un'), title: T('Do one', 'Faire un'), desc: T('One thing', 'Une chose'), skills: [{ source: 'anthropics/skills', name: 'pdf', d: T('Read PDFs', 'Lit des PDF') }], teams: ['studencik'], soon: [T('Later', 'Plus tard')], starter: T('Start', 'Commence') }]
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
  assert.equal(bad((p) => { p.goals[0].skills = []; p.goals[0].teams = []; p.goals[0].soon = [] }).ok, false)
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

/* ── the packs this repository ships ─────────────────────────────────────── */
const shipped = loadPacks(join(here, 'domains'))
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

ok('every shipped pack loads, and the nine fields of work are there', () => {
  assert.deepEqual(shipped.rejected, [])
  assert.deepEqual(shipped.packs.map((p) => p.id), ['edu', 'sante', 'immo', 'droit', 'fin', 'com', 'mkt', 'dev', 'general'], 'listed in the pack\'s own order, the catch-all last')
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
  const used = shipped.packs.flatMap((p) => p.goals.flatMap((g) => g.skills.map((s) => s.source + ' ' + s.name)))
  assert.deepEqual([...new Set(used)].filter((x) => VERIFIED.indexOf(x) < 0), [])
})
ok('nothing the old kits offered is lost', () => {
  const used = new Set(shipped.packs.flatMap((p) => p.goals.flatMap((g) => g.skills.map((s) => s.source + ' ' + s.name))))
  assert.deepEqual(VERIFIED.filter((x) => !used.has(x)), [])
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
  for (const f of ['com', 'dev', 'droit', 'edu', 'fin', 'general', 'immo', 'mkt', 'sante']) {
    const text = readFileSync(join(here, 'domains', f + '.json'), 'utf8')
    assert.equal(/\/Users\/|\\Users\\|<\/?[a-z]/i.test(text), false, f)
  }
})

console.log('\n' + count + ' checks passed')
