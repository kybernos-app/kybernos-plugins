// The themes the product ships (packages/kybernos-plugin/themes/<dir>/, docs/dev/shipped-themes.md): each folder is well-formed data, installable alone,
// readable by the Themes page, and its database (db/<id>.json) and sample rows (demo/db-sample.json) make a Tables database without one dangling reference.
//
// Hermetic: temp folders only (a Tables service in a temp folder, never a DSH home), nothing started, nothing fetched.
//
//   node scripts/test-shipped-themes.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BUSINESS_ROW_IDS } from '../packages/kybernos-plugin/domain-pack.mjs'
import { bundleProblem, dataPluginProblems, planTheme } from '../packages/kybernos-plugin/theme-installer.mjs'
import { photoFile } from '../packages/kybernos-plugin/themes-shipped.mjs'
import { PHOTO_MAX, PHOTO_WIDTH_MAX, PHOTOS_PER_THEME, jpegSize } from './garde-depot.mjs'
import { makeService } from '../packages/kybernos-db/agent/service.mjs'
import { MARKER_FILE, installTemplate } from '../packages/kybernos-db/instantiate.mjs'
import { buildStructure, languagesOf, validateSample, validateTemplate } from '../packages/kybernos-db/template.mjs'
import { OWNER_VALIDATORS, checkFolder } from './plugin-check.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(REPO, 'packages', 'kybernos-plugin', 'themes')
// what the Templates page lists a theme as needing: Tables (its database), then the Dashboards (the theme ships a dashboard, kybernos/dashboards#preset)
const NEEDS = ['kybernos/db', 'kybernos/dashboards']
const POINTS = ['domains', 'themes', 'skills', 'teams', 'automations', 'dashboards', 'db']
// What each shipped theme must hold: the tables its database makes, and the number of sample rows of each (demo/db-sample.json; a sample stays modest and readable).
const EXPECT = {
  ecommerce: { rows: { contact: 22, product: 16, orders: 18, note: 8 } },
  'real-estate': { rows: { contact: 27, property: 16, lettings: 8, sales: 11, note: 11 } },
  recruitment: { rows: { contact: 22, job: 14, candidates: 10, missions: 9, note: 8 } },
}
// The themes whose sample is rich (22 contacts, a photograph per item); a theme joins the list when its sample does.
const RICH = ['ecommerce', 'real-estate', 'recruitment']
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const names = (dir, ext) => readdirSync(dir).filter((f) => f.endsWith(ext)).sort()
const walk = (base) => readdirSync(base, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(base, e.name)) : [join(base, e.name)]))
// a folder that starts with `_` or `.` is not a theme (the gallery's own fixtures live in `_next/`)
const dirs = readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^[._]/.test(e.name)).map((e) => e.name).sort()
const loadTheme = (dir) => {
  const root = join(ROOT, dir)
  const one = (sub) => readJson(join(root, sub, names(join(root, sub), '.json')[0]))
  return {
    dir, root,
    manifest: readJson(join(root, 'plugin.json')),
    pkg: readJson(join(root, 'package.json')),
    pack: one('domains'),
    style: one('themes'),
    skills: readdirSync(join(root, 'skills')).sort(),
    teams: names(join(root, 'teams'), '.json').map((f) => readJson(join(root, 'teams', f))),
    automations: names(join(root, 'automations'), '.json').map((f) => readJson(join(root, 'automations', f))),
    db: readJson(join(root, 'db', dir + '.json')),
    sample: readJson(join(root, 'demo', 'db-sample.json')),
    why: readJson(join(root, 'why.json')),
  }
}

ok('the three themes are there, and nothing else is in the folder', () => {
  assert.deepEqual(dirs, Object.keys(EXPECT).sort())
  for (const f of readdirSync(ROOT).filter((x) => !/^[._]/.test(x))) assert.ok(statSync(join(ROOT, f)).isDirectory(), f + ' is a theme folder')
})

for (const dir of dirs) {
  const t = loadTheme(dir)
  const sample = t.sample

  ok(dir + ': plugin-check exits 0 and every point line passes', () => {
    const r = checkFolder(join(ROOT, dir))
    assert.equal(r.exitCode, 0, r.lines.filter((l) => l.status === 'FAIL').map((l) => l.id + ' ' + l.message).join('; '))
    const points = r.lines.filter((l) => l.id.startsWith('point.'))
    assert.equal(points.length, POINTS.length, 'one line per extended point: ' + points.map((l) => l.id).join(', '))
    for (const l of points) assert.equal(l.status, 'PASS', l.id + ': ' + l.message)
  })

  ok(dir + ': the installer would take it alone (a data package, a bundle with an empty patch, the pack, the manifest)', () => {
    assert.deepEqual(dataPluginProblems(t.pkg, t.root), [])
    assert.equal(bundleProblem(t.pkg), null)
    assert.equal(t.manifest.id, 'kybernos-themes/' + dir)
    assert.deepEqual(t.manifest.author, { id: 'kybernos-themes', name: 'Kybernos' })
    assert.equal(t.manifest.kind, 'data')
    assert.equal(t.manifest.license, 'Apache-2.0')
    // the Dashboards are NOT required: a template whose dashboard cannot be read must stay a working template (the extension is optional)
    assert.deepEqual(Object.keys(t.manifest.requires.plugins).sort(), ['kybernos/core', 'kybernos/db', 'kybernos/skills', 'kybernos/theme'])
    assert.equal(t.manifest.extends.find((e) => e.point === 'kybernos/dashboards#preset').optional, true)
    // the database is the template's tables: Tables is required, and the extension is not optional (the point is 1.0, the owner's own version 0.1)
    assert.equal(t.manifest.extends.find((e) => e.point === 'kybernos/db#template').optional, undefined)
    for (const [id, range] of Object.entries(t.manifest.requires.plugins)) assert.equal(range, id === 'kybernos/db' ? '^0.1' : '^1.0', id)
    assert.deepEqual(t.manifest.extends.map((e) => e.dir), POINTS)
    assert.equal(readFileSync(join(t.root, 'cordis.patch.yml'), 'utf8').replace(/#[^\n]*/g, '').trim(), '[]')
  })

  ok(dir + ': the install plan accepts it (one pack, one style, nothing rejected)', () => {
    // what the registry would hand the plan: every file of the data points, read through the owner's own validator
    const preview = t.manifest.extends.filter((e) => e.dir !== 'skills').map((e) => {
      const files = names(join(t.root, e.dir), '.json').map((f) => {
        const r = OWNER_VALIDATORS[e.point](readJson(join(t.root, e.dir, f)), f.replace(/\.json$/, ''))
        assert.equal(r.ok, true, e.dir + '/' + f + ': ' + JSON.stringify(r.errors))
        return { file: e.dir + '/' + f, value: r.value }
      })
      return { point: e.point, files, rejected: [] }
    })
    const plan = planTheme(preview, t.manifest.id)
    assert.equal(plan.ok, true, JSON.stringify(plan))
    assert.equal(plan.id, t.manifest.id)
    assert.equal(plan.pack.id, t.pack.id)
    assert.equal(plan.style.id, t.style.id)
    assert.deepEqual(plan.rejected, [])
    assert.equal(plan.pack.goals.length, t.pack.goals.length)
    for (const a of t.automations) assert.ok(plan.kit.automations.some((x) => x.id === a.id), 'the plan offers the automation ' + a.id)
    for (const x of t.teams) assert.ok(plan.kit.teams.some((y) => y.id === x.id), 'the plan offers the team ' + x.id)
  })

  ok(dir + ': the database it ships is sound in each language, holds the tables it should, and finds every picture of its sample', () => {
    const files = names(join(t.root, 'db'), '.json')
    assert.deepEqual(files, [dir + '.json'], 'one template, named like its folder')
    const raw = readJson(join(t.root, 'db', files[0]))
    const checked = validateTemplate(raw, dir)
    assert.equal(checked.ok, true, JSON.stringify(checked.errors))
    assert.deepEqual(languagesOf(raw).sort(), ['en', 'fr'], 'English and French, every label')
    for (const lang of ['en', 'fr']) assert.deepEqual(buildStructure(raw, lang).errors, [], lang)
    assert.deepEqual(raw.name, { en: t.manifest.name.en, fr: t.manifest.name.fr }, 'the database is named like the template')
    const want = EXPECT[dir]
    assert.deepEqual(raw.objects.map((o) => o.key), Object.keys(want.rows), 'the tables of the trade, in the order of the menu')
    const rows = validateSample(sample, raw)
    assert.equal(rows.ok, true, JSON.stringify(rows.errors))
    for (const [key, n] of Object.entries(want.rows)) assert.equal(sample.rows[key].length, n, key)
    assert.ok(sample.rows.contact.filter((c) => c.values.kind === 'person').length >= 8 && sample.rows.contact.filter((c) => c.values.kind === 'company').length >= 4, 'about 8 people and 4 companies')
    // a picture is a file of the theme, read through the core's own reader
    const photos = Object.values(sample.rows).flat().flatMap((r) => Object.values(r.values)).filter(Array.isArray).flat().filter((v) => v && typeof v.photo === 'string').map((v) => v.photo)
    assert.ok(photos.length > 0)
    for (const spec of photos) assert.notEqual(photoFile(ROOT, spec), null, spec)
  })

  ok(dir + ': a card has what the Themes page reads (name, line, colour, icon, the three words, the style, the kit names)', () => {
    for (const k of ['name', 'description']) assert.ok(t.manifest[k].en && t.manifest[k].fr, 'manifest.' + k)
    assert.ok(t.manifest.description.en.length <= 300 && t.manifest.description.fr.length <= 300, 'the page keeps 300 characters of the description')
    assert.ok(t.manifest.name.en.length <= 80)
    assert.match(t.pack.accent, /^#[0-9a-fA-F]{6}$/)
    assert.ok(t.pack.icon && t.pack.name.en && t.pack.tagline.en && t.pack.tagline.fr)
    assert.ok(t.pack.tagline.en.length <= 200 && t.pack.tagline.fr.length <= 200)
    // the rows of the Business group are the Tables page and the Overview: a trade's words live in its tables, so a pack may rename the row but a shipped one need not
    for (const [row, w] of Object.entries(t.pack.menu.labels)) {
      if (!BUSINESS_ROW_IDS.includes(row)) continue
      assert.ok(w.en && w.fr && w.en.length <= 40 && w.fr.length <= 40, 'the page keeps 40 characters of a word: ' + row)
    }
    for (const gone of ['contacts', 'catalog', 'pipeline']) assert.equal(t.pack.menu.labels[gone], undefined, gone + ' is not a menu row any more')
    assert.equal(t.pack.theme, t.style.id, 'the pack starts from the theme\'s own style')
    assert.equal(t.style.settings.acc.toLowerCase(), t.pack.accent.toLowerCase(), 'the style and the pack share one accent')
    assert.ok(typeof t.style.name === 'string' && t.style.name.length >= 3 && t.style.name.length <= 40)
    assert.ok(t.skills.length >= 1 && t.teams.length >= 1 && t.automations.length >= 1)
  })

  ok(dir + ': the gallery has its chip and one line per plugin it needs, in this theme\'s words (en and fr, 160 characters)', () => {
    const kw = t.manifest.keywords
    assert.ok(Array.isArray(kw) && kw.length >= 1 && kw.length <= 8, 'keywords')
    for (const k of kw) assert.match(k, /^[a-z0-9][a-z0-9 -]{1,23}$/, 'keyword ' + k)
    assert.equal(new Set(kw).size, kw.length)
    assert.deepEqual(Object.keys(t.why).sort(), [...NEEDS].sort(), 'why.json: one line per needed plugin (Tables and the dashboards), nothing else')
    for (const id of NEEDS) {
      const w = t.why[id]
      assert.deepEqual(Object.keys(w).sort(), ['en', 'fr'], id)
      for (const l of ['en', 'fr']) assert.ok(typeof w[l] === 'string' && w[l].trim() !== '' && w[l].length <= 160 && !/[<>]/.test(w[l]), id + '.' + l)
    }
    assert.equal(new Set(NEEDS.map((id) => t.why[id].en)).size, NEEDS.length, 'different lines')
  })

  ok(dir + ': the kit hangs together (the automations and the team named by the goals, the skills the team names, nothing copied from another pack)', () => {
    const goalAutos = t.pack.goals.flatMap((g) => (g.automations || []).map((a) => a.id)).sort()
    assert.deepEqual(t.automations.map((a) => a.id).sort(), goalAutos, 'every automation template is named by a goal, and the other way round')
    const goalTeams = new Set(t.pack.goals.flatMap((g) => g.teams || []))
    for (const team of t.teams) assert.ok(goalTeams.has(team.id), 'a goal names the team ' + team.id)
    for (const team of t.teams) for (const s of team.skills) assert.ok(t.skills.includes(s), team.id + ' names a skill the theme ships: ' + s)
    for (const a of t.automations) assert.ok(a.cron && a.guard.length >= 1 && a.steps.length >= 2, a.id)
    // a goal may name only a skill the app can fetch: a GitHub owner/repo, or one the core bundles (the route that seeds `kybernos` skills reads the core's own folder)
    const bundled = readdirSync(join(REPO, 'packages', 'kybernos-plugin', 'domains', 'skills'))
    for (const g of t.pack.goals) for (const s of g.skills || []) if (s.source === 'kybernos') assert.ok(bundled.includes(s.name), g.id + ': the core does not bundle the skill ' + s.name)
    for (const s of t.skills) assert.ok(!bundled.includes(s), 'the theme ships ' + s + ', which the core already bundles')
  })

  ok(dir + ': every text is there in English and in French, and French is not a copy of the English', () => {
    const LANGS = ['en', 'fr', 'es', 'ar']
    const texts = []
    const visit = (v, where) => {
      if (Array.isArray(v)) return v.forEach((x, i) => visit(x, where + '[' + i + ']'))
      if (v === null || typeof v !== 'object') return
      const keys = Object.keys(v)
      if (keys.length > 0 && keys.every((k) => LANGS.includes(k))) { texts.push([where, v]); return }
      for (const k of keys) visit(v[k], where + '.' + k)
    }
    const rels = walk(t.root).map((f) => f.slice(t.root.length + 1)).filter((r) => r.endsWith('.json') && !r.startsWith('demo/') && r !== 'package.json' && !r.startsWith('themes/'))
    for (const r of rels) visit(readJson(join(t.root, r)), r)
    assert.ok(texts.length > 60, 'a theme is mostly words: ' + texts.length)
    for (const [where, v] of texts) {
      assert.ok(typeof v.en === 'string' && v.en.trim() !== '', where + ' has no English')
      assert.ok(typeof v.fr === 'string' && v.fr.trim() !== '', where + ' has no French')
      if (v.en.length > 24) assert.notEqual(v.fr, v.en, where + ': the French is the English')
    }
  })

  ok(dir + ': no media but its cover and its sample photographs, no personal path, no code, no address outside example.com', () => {
    let photos = 0
    for (const f of walk(t.root)) {
      const rel = f.slice(t.root.length + 1)
      if (rel === 'cover.jpg') continue // the cover picture of a theme (AGENTS.md rule 4); its size and bytes are checked below
      if (/^demo\/photos\/[a-z0-9][a-z0-9-]{1,59}\.jpg$/.test(rel)) { // the sample pictures (AGENTS.md rule 4, second exception): a JPEG of at most 220 KB and 1280 px wide, 24 a theme
        const bytes = readFileSync(f)
        assert.ok(bytes.length <= PHOTO_MAX && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, rel + ' is a JPEG of at most ' + PHOTO_MAX / 1024 + ' KB')
        photos++
        continue
      }
      assert.match(f, /\.(json|md|yml)$/, rel + ' is text')
      const body = readFileSync(f, 'utf8')
      assert.doesNotMatch(body, /\/Users\//, rel)
      assert.doesNotMatch(body, /data:[a-z]+\/[a-z0-9.+-]+;base64/i, rel + ' embeds media')
      for (const m of body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []) assert.match(m, /@([a-z0-9-]+\.)*example\.com$/, rel + ': ' + m)
    }
    assert.ok(photos <= PHOTOS_PER_THEME, 'at most ' + PHOTOS_PER_THEME + ' sample pictures')
    assert.ok(walk(t.root).length - photos <= 24, 'a theme stays small')
  })

  ok(dir + ': the sample pictures are plain JPEGs (a photograph per item at 1280 px, a portrait per person), at most 24, and every `photo` a row names is one of them', () => {
    const folder = join(t.root, 'demo', 'photos')
    const files = existsSync(folder) ? readdirSync(folder) : []
    assert.ok(files.length <= PHOTOS_PER_THEME, files.length + ' pictures')
    const refsOf = (rows) => rows.flatMap((r) => (Array.isArray(r.values.photo) ? r.values.photo : [])).filter((v) => v && typeof v.photo === 'string').map((v) => v.photo)
    const contacts = sample.rows.contact
    const people = contacts.filter((c) => c.values.kind === 'person')
    const itemRefs = refsOf(Object.entries(sample.rows).filter(([k]) => k !== 'contact').flatMap(([, v]) => v))
    const personRefs = refsOf(people)
    for (const ref of itemRefs.concat(personRefs)) { assert.ok(ref.startsWith(dir + '/'), ref + ' belongs to another theme'); assert.ok(photoFile(ROOT, ref) !== null, ref + ' is not a picture of this theme') }
    for (const f of files) {
      assert.match(f, /^[a-z0-9][a-z0-9-]{1,59}\.jpg$/, f)
      const bytes = readFileSync(join(folder, f))
      assert.ok(bytes.length <= PHOTO_MAX && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, dir + '/' + f)
      const px = jpegSize(bytes)
      assert.ok(px !== null && px.width <= PHOTO_WIDTH_MAX, f + ' is at most ' + PHOTO_WIDTH_MAX + ' px wide')
      const name = dir + '/' + f.replace(/\.jpg$/, '')
      // a picture an item names is a photograph at the full width, never a small one; one a person names is a portrait, near square and at least 512 px
      if (itemRefs.includes(name)) assert.equal(px.width, PHOTO_WIDTH_MAX, f + ' is a card photograph: ' + PHOTO_WIDTH_MAX + ' px wide, not enlarged from less')
      else if (personRefs.includes(name)) assert.ok(px.width >= 512 && px.height >= 512 && px.width / px.height > 0.8 && px.width / px.height < 1.25, f + ' is a portrait: near square and at least 512 px')
      else assert.fail(f + ' is named by no item and no person: a dead picture')
    }
    // every person of a rich sample has a portrait (a portrait serves two people at most, so a face is not seen three times) and no company is given a file: its logo is drawn
    if (RICH.includes(dir)) {
      assert.equal(personRefs.length, people.length, 'every sample person names a portrait')
      for (const ref of new Set(personRefs)) assert.ok(personRefs.filter((r) => r === ref).length <= 2, ref + ' serves more than two people')
      for (const c of contacts.filter((x) => x.values.kind === 'company')) assert.equal(c.values.photo, undefined, c.values.name + ': a company\'s logo is drawn, never a file')
    }
  })

  ok(dir + ': the database is made in a temporary Tables service with its sample rows, a second install is skipped, and without the sample only the structure is there', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'shipped-theme-'))
    const service = makeService({ dir: join(tmp, 'dbs') })
    try {
      const markerFile = join(tmp, MARKER_FILE)
      const made = installTemplate({ service, template: t.db, sample, lang: 'en', markerFile })
      assert.equal(made.ok, true, JSON.stringify(made))
      assert.ok(made.skipped !== true)
      assert.equal(service.byId(made.db).ok, true)
      const want = EXPECT[dir].rows
      assert.deepEqual([made.counts.objects, made.counts.views, made.counts.rows], [Object.keys(want).length, t.db.views.length, Object.values(want).reduce((a, b) => a + b, 0)], 'the structure, the views and every sample row')
      const again = installTemplate({ service, template: t.db, sample, lang: 'en', markerFile })
      assert.equal(again.ok, true)
      assert.equal(again.skipped, true, 'the same template installs once while its database exists')
      assert.equal(again.db, made.db)
      const bare = installTemplate({ service, template: Object.assign({}, t.db, { id: dir + '-bare' }), sample: null, lang: 'fr', markerFile })
      assert.equal(bare.ok, true, JSON.stringify(bare))
      assert.notEqual(bare.db, made.db)
      assert.deepEqual([bare.counts.objects, bare.counts.views, bare.counts.rows], [Object.keys(want).length, t.db.views.length, 0], 'the structure and the views, no row')
    } finally { try { service.close() } catch (e) { /* closed */ } rmSync(tmp, { recursive: true, force: true }) }
  })
}

ok('the three themes can be installed together: no id is shared, and none is taken by the core', () => {
  const all = dirs.map(loadTheme)
  const core = readdirSync(join(REPO, 'packages', 'kybernos-plugin', 'domains')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
  const kinds = {
    'manifest id': (t) => [t.manifest.id],
    'pack id': (t) => [t.pack.id],
    'style id': (t) => [t.style.id],
    'skill': (t) => t.skills,
    'team': (t) => t.teams.map((x) => x.id),
    'automation': (t) => t.automations.map((x) => x.id),
    'database': (t) => [t.db.id],
  }
  for (const [kind, of] of Object.entries(kinds)) {
    const ids = all.flatMap(of)
    assert.equal(new Set(ids).size, ids.length, 'two themes share a ' + kind + ': ' + ids.join(', '))
  }
  const chips = all.map((t) => t.manifest.keywords[0])
  assert.equal(new Set(chips).size, chips.length, 'two themes carry the same chip: ' + chips.join(', '))
  for (const t of all) assert.ok(!core.includes(t.pack.id), t.pack.id + ' is a pack of the core')
  const orders = all.map((t) => t.pack.order)
  assert.equal(new Set(orders).size, orders.length, 'two packs ask for the same place')
})

// The reader of the Themes page lives in the core's `themes-shipped.mjs`; it is checked here the day it is in the tree (it is written by the Themes page's own batch).
const reader = join(REPO, 'packages', 'kybernos-plugin', 'themes-shipped.mjs')
if (existsSync(reader)) {
  const { COVER_MAX, coverFile, readNext, readShipped } = await import(pathToFileURL(reader).href)
  ok('readShipped lists the three themes, each with a name, an accent, the database it ships and the plugins it needs', () => {
    const { themes, skipped } = readShipped(ROOT)
    assert.deepEqual(skipped, [], 'nothing is left out: ' + JSON.stringify(skipped))
    assert.deepEqual(themes.map((x) => x.dir).sort(), dirs)
    for (const x of themes) {
      const t = loadTheme(x.dir)
      assert.equal(x.id, 'kybernos-themes/' + x.dir)
      assert.ok(x.name.en && x.name.fr && x.description.en && x.description.fr)
      assert.match(x.accent, /^#[0-9a-fA-F]{6}$/)
      assert.deepEqual(x.words, {}, 'a shipped pack renames no row of the Business group')
      assert.deepEqual(x.needs, NEEDS, 'needs = Tables, then the dashboards')
      assert.deepEqual(x.db.objects, t.db.objects.map((o) => o.label), 'the tables of its database, named')
      assert.equal(x.sample.total, Object.values(EXPECT[x.dir].rows).reduce((a, b) => a + b, 0), 'the sample rows, counted')
      assert.deepEqual(x.sample.by.map((b) => b.n), Object.values(EXPECT[x.dir].rows), 'and counted table by table')
      assert.equal(x.tag, t.manifest.keywords[0][0].toUpperCase() + t.manifest.keywords[0].slice(1), 'the chip is the first keyword, capitalised')
      assert.deepEqual(x.why, t.why, 'the lines of why.json, one per plugin')
      assert.equal(x.cover, true, 'each theme ships its cover picture (the one media exception of AGENTS.md rule 4)')
      assert.equal(x.style.name.en, t.style.name)
      assert.deepEqual(x.lists.skills, t.skills)
      assert.deepEqual(x.lists.teams, t.teams.map((y) => y.id))
      assert.deepEqual(x.lists.automations, t.automations.map((y) => y.id).sort())
      assert.deepEqual(x.adds, { skills: t.skills.length, teams: t.teams.length, automations: t.automations.length, connectors: x.adds.connectors })
      assert.deepEqual(x.points, { db: 1 })
      assert.ok(x.adds.connectors >= 1, 'a card names the apps it suggests')
    }
  })
  ok('the covers are real JPEGs under the cap, served by id, and the next trades have theirs', () => {
    for (const d of dirs) {
      const f = coverFile(ROOT, { id: 'kybernos-themes/' + d })
      assert.equal(f, join(ROOT, d, 'cover.jpg'))
      const bytes = readFileSync(f)
      assert.ok(bytes.length <= COVER_MAX && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, d)
    }
    const next = readNext(ROOT)
    assert.deepEqual(next.map((n) => n.id), ['consulting', 'it-services', 'accounting', 'law-firm', 'restaurant', 'architecture', 'construction', 'medical-cabinet', 'student'])
    for (const n of next) { assert.ok(n.name.en && n.name.fr, n.id); assert.equal(n.cover, true, n.id); assert.ok(coverFile(ROOT, { next: n.id }) !== null, n.id) }
    const folders = readdirSync(join(ROOT, '_next')).filter((f) => f.endsWith('.jpg')).map((f) => f.replace(/\.jpg$/, '')).sort()
    assert.deepEqual(folders, next.map((n) => n.id).sort(), 'no picture without an entry, no entry without a picture')
  })
} else console.log('SKIPPED: readShipped is not played, packages/kybernos-plugin/themes-shipped.mjs is not in this tree yet (the Themes page batch adds it)')

console.log('\n' + count + ' checks passed')
