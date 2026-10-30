// The themes the product ships (packages/kybernos-plugin/themes/<dir>/, docs/dev/shipped-themes.md): each folder is well-formed data, installable alone,
// readable by the Themes page, and its sample rows seed a business base without one dangling reference.
//
// Hermetic: temp folders only (a base file in a temp folder, never a DSH home), nothing started, nothing fetched.
//
//   node scripts/test-shipped-themes.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createBusinessBase } from '../packages/kybernos-plugin/business-base.mjs'
import { BUSINESS_ROW_IDS } from '../packages/kybernos-plugin/domain-pack.mjs'
import { bundleProblem, dataPluginProblems, planTheme } from '../packages/kybernos-plugin/theme-installer.mjs'
import { photoFile } from '../packages/kybernos-plugin/themes-shipped.mjs'
import { PHOTO_MAX, PHOTO_WIDTH_MAX, PHOTOS_PER_THEME, jpegSize } from './garde-depot.mjs'
import { validateContactsSchema } from '../packages/kybernos-contacts/contacts-schema.mjs'
import { validateCatalogType } from '../packages/kybernos-catalog/catalog-type.mjs'
import { validatePipelineFlow } from '../packages/kybernos-pipeline/pipeline-flow.mjs'
import { OWNER_VALIDATORS, checkFolder } from './plugin-check.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(REPO, 'packages', 'kybernos-plugin', 'themes')
const BUSINESS = ['kybernos/contacts', 'kybernos/catalog', 'kybernos/pipeline']
// what the Templates page lists a theme as needing: the three business pages, then the Dashboards (the theme ships a dashboard, kybernos/dashboards#preset)
const NEEDS = [...BUSINESS, 'kybernos/dashboards']
const POINTS = ['domains', 'themes', 'skills', 'teams', 'automations', 'contacts', 'catalog', 'pipeline', 'dashboards']
// What each shipped theme must hold: the folder, and the number of sample rows its demo/sample.json seeds (a sample stays modest and readable).
const EXPECT = {
  ecommerce: { contacts: 22, items: 16, cards: 18, notes: 8, flows: 1 },
  'real-estate': { contacts: 27, items: 16, cards: 19, notes: 11, flows: 2 },
  recruitment: { contacts: 22, items: 14, cards: 19, notes: 8, flows: 2 },
}
const WORDS = ['contacts', 'catalog', 'pipeline']
// The themes whose sample is rich (22 contacts, a photograph per item, cards that follow the board convention); a theme joins the list when its sample does.
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
    contacts: names(join(root, 'contacts'), '.json').map((f) => validateContactsSchema(readJson(join(root, 'contacts', f)), f.replace(/\.json$/, ''))),
    catalog: names(join(root, 'catalog'), '.json').map((f) => validateCatalogType(readJson(join(root, 'catalog', f)), f.replace(/\.json$/, ''))),
    pipeline: names(join(root, 'pipeline'), '.json').map((f) => validatePipelineFlow(readJson(join(root, 'pipeline', f)), f.replace(/\.json$/, ''))),
    sample: readJson(join(root, 'demo', 'sample.json')),
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
  const want = EXPECT[dir]

  ok(dir + ': plugin-check exits 0 and every point line passes', () => {
    const r = checkFolder(join(ROOT, dir))
    assert.equal(r.exitCode, 0, r.lines.filter((l) => l.status === 'FAIL').map((l) => l.id + ' ' + l.message).join('; '))
    const points = r.lines.filter((l) => l.id.startsWith('point.'))
    assert.equal(points.length, 9, 'one line per extended point: ' + points.map((l) => l.id).join(', '))
    for (const l of points) assert.equal(l.status, 'PASS', l.id + ': ' + l.message)
  })

  ok(dir + ': the installer would take it alone (a data package, a bundle with an empty patch, the pack, the manifest)', () => {
    assert.deepEqual(dataPluginProblems(t.pkg, t.root), [])
    assert.equal(bundleProblem(t.pkg), null)
    assert.equal(t.manifest.id, 'kybernos-themes/' + dir)
    assert.deepEqual(t.manifest.author, { id: 'kybernos-themes', name: 'Kybernos' })
    assert.equal(t.manifest.kind, 'data')
    assert.equal(t.manifest.license, 'Apache-2.0')
    assert.deepEqual(Object.keys(t.manifest.requires.plugins).sort(), ['kybernos/catalog', 'kybernos/contacts', 'kybernos/core', 'kybernos/dashboards', 'kybernos/pipeline', 'kybernos/skills', 'kybernos/theme'])
    for (const range of Object.values(t.manifest.requires.plugins)) assert.equal(range, '^1.0')
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

  ok(dir + ': a card has what the Themes page reads (name, line, colour, icon, the three words, the style, the kit names)', () => {
    for (const k of ['name', 'description']) assert.ok(t.manifest[k].en && t.manifest[k].fr, 'manifest.' + k)
    assert.ok(t.manifest.description.en.length <= 300 && t.manifest.description.fr.length <= 300, 'the page keeps 300 characters of the description')
    assert.ok(t.manifest.name.en.length <= 80)
    assert.match(t.pack.accent, /^#[0-9a-fA-F]{6}$/)
    assert.ok(t.pack.icon && t.pack.name.en && t.pack.tagline.en && t.pack.tagline.fr)
    assert.ok(t.pack.tagline.en.length <= 200 && t.pack.tagline.fr.length <= 200)
    for (const row of WORDS) {
      assert.ok(BUSINESS_ROW_IDS.includes(row))
      const w = t.pack.menu.labels[row]
      assert.ok(w && w.en && w.fr, 'menu.labels.' + row)
      assert.ok(w.en.length <= 40 && w.fr.length <= 40, 'the page keeps 40 characters of a word')
    }
    assert.equal(t.pack.theme, t.style.id, 'the pack starts from the theme\'s own style')
    assert.equal(t.style.settings.acc.toLowerCase(), t.pack.accent.toLowerCase(), 'the style and the pack share one accent')
    assert.ok(typeof t.style.name === 'string' && t.style.name.length >= 3 && t.style.name.length <= 40)
    assert.ok(t.skills.length >= 1 && t.teams.length >= 1 && t.automations.length >= 1)
  })

  ok(dir + ': the gallery has its chip and one line per business plugin, in this theme\'s words (en and fr, 160 characters)', () => {
    const kw = t.manifest.keywords
    assert.ok(Array.isArray(kw) && kw.length >= 1 && kw.length <= 8, 'keywords')
    for (const k of kw) assert.match(k, /^[a-z0-9][a-z0-9 -]{1,23}$/, 'keyword ' + k)
    assert.equal(new Set(kw).size, kw.length)
    assert.deepEqual(Object.keys(t.why).sort(), [...NEEDS].sort(), 'why.json: one line per needed plugin (the three business plugins and the dashboards), nothing else')
    for (const id of NEEDS) {
      const w = t.why[id]
      assert.deepEqual(Object.keys(w).sort(), ['en', 'fr'], id)
      for (const l of ['en', 'fr']) assert.ok(typeof w[l] === 'string' && w[l].trim() !== '' && w[l].length <= 160 && !/[<>]/.test(w[l]), id + '.' + l)
    }
    assert.equal(new Set(NEEDS.map((id) => t.why[id].en)).size, 4, 'four different lines')
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

  ok(dir + ': the sample pictures are plain JPEGs (a photograph per item at 1280 px, a portrait per person), at most 24, and every `photo:` a row names is one of them', () => {
    const folder = join(t.root, 'demo', 'photos')
    const files = existsSync(folder) ? readdirSync(folder) : []
    assert.ok(files.length <= PHOTOS_PER_THEME, files.length + ' pictures')
    const refsOf = (rows) => rows.map((r) => (r.fields !== undefined ? r.fields.image : undefined)).filter((v) => typeof v === 'string' && v.startsWith('photo:')).map((v) => v.slice(6))
    const people = sample.contacts.filter((c) => c.kind === 'person')
    const itemRefs = refsOf(sample.items)
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
      for (const c of sample.contacts.filter((x) => x.kind === 'company')) assert.equal(c.fields.image, undefined, c.name + ': a company\'s logo is drawn, never a file')
    }
  })

  ok(dir + ': the three business points read back as valid data', () => {
    for (const r of [...t.contacts, ...t.catalog, ...t.pipeline]) assert.equal(r.ok, true, JSON.stringify(r.errors))
    assert.equal(t.contacts.length, 1)
    assert.ok(t.catalog.length >= 1)
    assert.equal(t.pipeline.length, want.flows)
  })

  ok(dir + ': the sample rows use only what the theme\'s own points define', () => {
    assert.deepEqual(Object.keys(sample).sort(), ['cards', 'contacts', 'items', 'notes'], 'exactly the data argument of seed()')
    assert.equal(sample.contacts.length, want.contacts)
    assert.equal(sample.items.length, want.items)
    assert.equal(sample.cards.length, want.cards)
    assert.equal(sample.notes.length, want.notes)
    assert.ok(sample.contacts.filter((c) => c.kind === 'person').length >= 8 && sample.contacts.filter((c) => c.kind === 'company').length >= 4, 'about 8 people and 4 companies')
    if (RICH.includes(dir)) assert.ok(sample.contacts.length >= 16 && sample.contacts.length <= 27 && sample.notes.length >= 5 && sample.notes.length <= 11, 'a sample the pages can show: 16 to 27 contacts, 5 to 11 notes')
    assert.ok(sample.items.length >= 8 && sample.items.length <= 20 && sample.cards.length >= 10 && sample.cards.length <= 24)
    const schema = t.contacts[0].value
    const types = new Map(t.catalog.map((r) => [r.value.id, r.value]))
    const flows = new Map(t.pipeline.map((r) => [r.value.id, r.value]))
    const once = (rows, what) => { const refs = rows.map((r) => r.ref).filter((x) => x !== undefined); assert.equal(new Set(refs).size, refs.length, what + ' refs are unique') }
    const only = (row, keys, what) => { for (const k of Object.keys(row)) assert.ok(keys.includes(k), what + ' has an unknown key ' + k) }
    // a value as its field says it is
    const typed = (field, v, what) => {
      switch (field.type) {
        case 'text': assert.ok(typeof v === 'string' && v.trim() !== '' && v.length <= 200, what); break
        case 'number': case 'money': assert.ok(typeof v === 'number' && Number.isFinite(v), what); break
        case 'date': assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), what + ' is a date'); break
        case 'choice': assert.ok(field.options.includes(v), what + ' is one of ' + field.options.join(', ')); break
        case 'email': assert.ok(/^[^@\s]+@[^@\s]+$/.test(v), what); break
        case 'url': assert.match(v, /^https:\/\//, what); break
        default: assert.fail(what + ': unknown field type')
      }
    }
    const fieldsOf = (row, defs, what) => {
      const byKey = new Map(defs.map((f) => [f.key, f]))
      for (const [k, v] of Object.entries(row.fields || {})) { assert.ok(byKey.has(k), what + ' uses the field ' + k + ', which its type does not define'); typed(byKey.get(k), v, what + '.' + k) }
    }

    once(sample.contacts, 'contact'); once(sample.items, 'item')
    const contacts = new Map(sample.contacts.map((c) => [c.ref, c]))
    for (const c of sample.contacts) {
      const what = 'contact ' + c.ref
      only(c, ['ref', 'kind', 'type', 'name', 'email', 'company_ref', 'tags', 'fields'], what)
      const type = schema.types.find((x) => x.key === c.type)
      assert.ok(type, what + ' has the type ' + c.type + ', which the theme does not define')
      assert.equal(c.kind, type.kind, what + ': its kind is not the kind of its type')
      for (const tag of c.tags) assert.ok(schema.tags.includes(tag), what + ' has the tag ' + tag + ', which the theme does not propose')
      fieldsOf(c, schema.fields, what)
      if (c.company_ref !== undefined) { assert.equal(c.kind, 'person', what + ': only a person works for a company'); assert.equal((contacts.get(c.company_ref) || {}).kind, 'company', what + ': company_ref points at no company') }
    }
    for (const type of schema.types) assert.ok(sample.contacts.some((c) => c.type === type.key), 'no sample contact of the type ' + type.key)

    for (const i of sample.items) {
      const what = 'item ' + i.ref
      only(i, ['ref', 'type', 'title', 'subtitle', 'status', 'price_text', 'price_num', 'fields'], what)
      const type = types.get(i.type)
      assert.ok(type, what + ' has the type ' + i.type + ', which the theme does not define')
      assert.ok(type.statuses.some((s) => s.key === i.status), what + ' has the status ' + i.status + ', which its type does not define')
      fieldsOf(i, type.fields, what)
      const price = type.fields.find((f) => f.key === 'price' && f.type === 'money')
      if (price !== undefined && i.price_num !== null) assert.equal(i.fields.price, i.price_num, what + ': price_num and the price field disagree')
      assert.ok(i.price_text === '' || i.price_text.length <= 60)
    }
    for (const type of types.values()) for (const s of type.statuses) assert.ok(sample.items.some((i) => i.type === type.id && i.status === s.key), 'no sample item is ' + s.key + ' in ' + type.id)

    const perStage = new Map()
    for (const c of sample.cards) {
      const what = 'card "' + c.title + '"'
      only(c, ['flow', 'stage', 'title', 'subtitle', 'value_num', 'contact_ref', 'item_ref', 'fields'], what)
      const flow = flows.get(c.flow)
      assert.ok(flow, what + ' is on the board ' + c.flow + ', which the theme does not define')
      assert.ok(flow.stages.some((s) => s.key === c.stage), what + ' is in the stage ' + c.stage + ', which the board ' + c.flow + ' does not have')
      assert.ok(typeof c.value_num === 'number' && c.value_num >= 0, what)
      if (c.contact_ref !== undefined) { assert.ok(flow.links.contact, what + ' links a contact on a board that does not'); assert.ok(contacts.has(c.contact_ref), what + ': contact_ref points at no contact') }
      if (c.item_ref !== undefined) { assert.ok(flow.links.item, what + ' links an item on a board that does not'); assert.ok(sample.items.some((i) => i.ref === c.item_ref), what + ': item_ref points at no item') }
      perStage.set(c.flow + '/' + c.stage, (perStage.get(c.flow + '/' + c.stage) || 0) + 1)
    }
    for (const flow of flows.values()) for (const s of flow.stages) assert.ok(perStage.get(flow.id + '/' + s.key) >= 1, 'the stage ' + s.key + ' of ' + flow.id + ' has no sample card')
    for (const n of sample.notes) { only(n, ['contact_ref', 'body'], 'note'); assert.ok(contacts.has(n.contact_ref) && n.body.length <= 4000, 'a note points at no contact') }
  })

  if (RICH.includes(dir)) ok(dir + ': the sample is rich: tags that recur, a picture for every item (two items at most share one), cards that follow the board convention', () => {
    const schema = t.contacts[0].value
    const types = new Map(t.catalog.map((r) => [r.value.id, r.value]))
    // 2 to 3 tags a contact, and every tag the theme proposes is worn by at least two contacts (a filter with a count worth showing)
    const worn = new Map()
    for (const c of sample.contacts) {
      assert.ok(c.tags.length >= 2 && c.tags.length <= 3, c.ref + ': 2 to 3 tags')
      for (const x of c.tags) worn.set(x, (worn.get(x) || 0) + 1)
    }
    for (const tag of schema.tags) assert.ok((worn.get(tag) || 0) >= 2, 'the tag ' + tag + ' is worn by fewer than two contacts')
    // the cards of the catalog show a picture and 1 to 4 coloured chips, and the picture is a photograph the theme ships, used once
    const photoDir = join(t.root, 'demo', 'photos')
    const files = existsSync(photoDir) ? readdirSync(photoDir).map((f) => f.replace(/\.jpg$/, '')).sort() : []
    const named = []
    for (const type of types.values()) assert.ok(type.card.image && type.card.chips && type.card.chips.length >= 1 && type.card.chips.length <= 6, type.id + ': the card shows a picture and chips')
    for (const i of sample.items) {
      const card = types.get(i.type).card
      const m = /^photo:([a-z][a-z0-9-]+)\/([a-z0-9][a-z0-9-]+)$/.exec(i.fields[card.image])
      assert.ok(m !== null && m[1] === dir, 'item ' + i.ref + ' has no photograph of this theme')
      named.push(m[2])
      assert.ok(card.chips.filter((k) => i.fields[k] !== undefined).length >= 2, 'item ' + i.ref + ' shows fewer than two chips')
    }
    // the photographs are the pictures that are not portraits; a photograph serves two items at most (the 24-picture budget of a theme is shared with its portraits: two related items may show the same one)
    assert.deepEqual([...new Set(named)].sort(), files.filter((f) => !/^portrait-\d\d$/.test(f)), 'every item has its photograph and every photograph is used')
    for (const f of new Set(named)) assert.ok(named.filter((n) => n === f).length <= 2, f + ' serves more than two items')
    // two items that show one photograph never sit on the same board (a column of twins would be the first thing seen): their cards are on different boards
    const boardsOf = (ref) => new Set(sample.cards.filter((c) => c.item_ref === ref).map((c) => c.flow))
    for (const f of new Set(named)) {
      const twins = sample.items.filter((i) => i.fields.image === 'photo:' + dir + '/' + f).map((i) => i.ref)
      if (twins.length === 2) assert.ok([...boardsOf(twins[0])].every((b) => !boardsOf(twins[1]).has(b)), twins.join(' and ') + ' share ' + f + ' and appear on the same board')
    }
    // a card of a board: where it comes from, how urgent, when, a few words, and the person and the product or job it is about
    for (const c of sample.cards) {
      const what = 'card "' + c.title + '"'
      assert.deepEqual(Object.keys(c.fields).sort(), ['due', 'priority', 'source', 'tags'], what + ': source, priority, due, tags')
      assert.ok(typeof c.fields.source === 'string' && c.fields.source.length >= 3 && c.fields.source.length <= 30, what + ' source')
      assert.ok(['high', 'normal', 'low'].includes(c.fields.priority), what + ' priority')
      assert.ok(/^2026-(11-(0[1-9]|[12]\d|30)|12-(0[1-9]|1\d|20))$/.test(c.fields.due), what + ' is due between 2026-11-01 and 2026-12-20')
      assert.ok(Array.isArray(c.fields.tags) && c.fields.tags.length >= 1 && c.fields.tags.length <= 3 && c.fields.tags.every((x) => typeof x === 'string' && x.length >= 2 && x.length <= 20), what + ' tags')
      assert.ok(c.contact_ref !== undefined && c.item_ref !== undefined, what + ' links a person and a product or job')
    }
    // the Catalog page shows the mix: every status of a type is worn, and the board is not empty in any stage (checked above); at least three of each money or number the page sorts on
    assert.ok(new Set(sample.items.map((i) => i.status)).size >= 3, 'a catalog with at least three different statuses')
  })

  ok(dir + ': the sample seeds a temporary base, every row is marked demo, a second seed is skipped, and clearing leaves nothing', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'shipped-theme-'))
    const base = createBusinessBase({ file: join(tmp, 'donnees.sqlite') })
    try {
      const opened = base.open()
      if (opened.ok !== true && opened.error === 'sqlite_unavailable') { console.log('SKIPPED: this Node has no node:sqlite, the seed of ' + dir + ' is not played'); return }
      assert.equal(opened.ok, true, JSON.stringify(opened))
      const theme = t.manifest.id
      const seeded = base.seed(sample, { theme })
      assert.equal(seeded.ok, true, JSON.stringify(seeded))
      assert.equal(seeded.skipped, false)
      assert.deepEqual(seeded.counts, { contacts: want.contacts, items: want.items, cards: want.cards, notes: want.notes })
      const counts = base.counts()
      assert.deepEqual(counts.tables, { contact: want.contacts, note: want.notes, item: want.items, flow_card: want.cards })
      assert.deepEqual(counts.demo, counts.tables, 'every row is demo')
      const links = base.list('flow_card', { limit: 500 }).rows
      assert.equal(links.filter((r) => r.contact_id !== null).length, sample.cards.filter((c) => c.contact_ref !== undefined).length, 'every contact link landed')
      assert.equal(links.filter((r) => r.item_id !== null).length, sample.cards.filter((c) => c.item_ref !== undefined).length, 'every item link landed')
      const staff = base.list('contact', { kind: 'person', limit: 500 }).rows
      assert.equal(staff.filter((r) => r.company_id !== null).length, sample.contacts.filter((c) => c.company_ref !== undefined).length, 'every company link landed')
      const again = base.seed(sample, { theme })
      assert.equal(again.ok, true)
      assert.equal(again.skipped, true, 'the same theme seeds once')
      assert.deepEqual(base.counts().tables, counts.tables, 'a second seed adds nothing')
      const cleared = base.clearDemo()
      assert.equal(cleared.ok, true)
      assert.deepEqual(cleared.removed, { note: want.notes, flow_card: want.cards, item: want.items, contact: want.contacts })
      assert.deepEqual(base.counts().tables, { contact: 0, note: 0, item: 0, flow_card: 0 })
      assert.equal(base.seed(sample, { theme }).skipped, false, 'a theme can seed again after the sample rows are cleared')
    } finally { base.close(); rmSync(tmp, { recursive: true, force: true }) }
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
    'contacts schema': (t) => t.contacts.map((r) => r.value.id),
    'catalog type': (t) => t.catalog.map((r) => r.value.id),
    'pipeline board': (t) => t.pipeline.map((r) => r.value.id),
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
  ok('readShipped lists the three themes, each with a name, an accent, the three words and the three business plugins it needs', () => {
    const { themes, skipped } = readShipped(ROOT)
    assert.deepEqual(skipped, [], 'nothing is left out: ' + JSON.stringify(skipped))
    assert.deepEqual(themes.map((x) => x.dir).sort(), dirs)
    for (const x of themes) {
      const t = loadTheme(x.dir)
      assert.equal(x.id, 'kybernos-themes/' + x.dir)
      assert.ok(x.name.en && x.name.fr && x.description.en && x.description.fr)
      assert.match(x.accent, /^#[0-9a-fA-F]{6}$/)
      assert.deepEqual(Object.keys(x.words).sort(), [...WORDS].sort())
      for (const row of WORDS) assert.deepEqual(x.words[row], t.pack.menu.labels[row])
      assert.deepEqual(x.needs, NEEDS, 'needs = the three business plugins in the order of the Business group, then the dashboards')
      assert.equal(x.tag, t.manifest.keywords[0][0].toUpperCase() + t.manifest.keywords[0].slice(1), 'the chip is the first keyword, capitalised')
      assert.deepEqual(x.why, t.why, 'the lines of why.json, one per plugin')
      assert.equal(x.cover, true, 'each theme ships its cover picture (the one media exception of AGENTS.md rule 4)')
      assert.equal(x.style.name.en, t.style.name)
      assert.deepEqual(x.lists.skills, t.skills)
      assert.deepEqual(x.lists.teams, t.teams.map((y) => y.id))
      assert.deepEqual(x.lists.automations, t.automations.map((y) => y.id).sort())
      assert.deepEqual(x.adds, { skills: t.skills.length, teams: t.teams.length, automations: t.automations.length, connectors: x.adds.connectors })
      assert.deepEqual(x.points, { contacts: 1, catalog: t.catalog.length, pipeline: t.pipeline.length })
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
