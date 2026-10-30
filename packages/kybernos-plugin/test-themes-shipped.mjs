// The themes the product ships (themes-shipped.mjs) and how the Themes route uses them: the list the page reads, and `stage` by id.
// Hermetic: temp folders only.   node packages/kybernos-plugin/test-themes-shipped.mjs
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleThemes } from './theme-installer.mjs'
import { BUSINESS_PLUGINS, COVER_MAX, FILE_MAX, NEXT_MAX, PHOTO_MAX, SAMPLE_MAX, SHIPPED_MAX, STAGED_OWNER, coverFile, photoFile, previewFolder, publicView, readDbTemplate, readNext, readSample, readShipped, readTheme } from './themes-shipped.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const json = (file, v) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(v, null, 2)) }

const root = mkdtempSync(join(tmpdir(), 'kb-shipped-'))
try {
  // a business theme written by hand: pack with words, a style, three kinds of kit, three business points
  const shop = join(root, 'shop')
  json(join(shop, 'plugin.json'), {
    contract: 1, id: 'kybernos-themes/shop', kind: 'data', version: '1.0.0', name: { en: 'E-commerce shop', fr: 'Boutique en ligne' }, description: { en: 'Answer customers faster.', fr: 'Réponds plus vite.' },
    keywords: ['commerce', 'shop'],
    requires: { kybernos: '^0.1', plugins: { 'kybernos/core': '^1.0', 'kybernos/pipeline': '^1.0', 'kybernos/contacts': '^1.0', 'kybernos/catalog': '^1.0', 'kybernos/skills': '^1.0', 'acme/inbox': '^1.0' } },
  })
  json(join(shop, 'domains', 'shop.json'), {
    id: 'shop', name: { en: 'E-commerce', fr: 'E-commerce' }, tagline: { en: 'Sell online', fr: 'Vendre en ligne' }, accent: '#c35e08', icon: 'bag',
    menu: { labels: { contacts: { en: 'Customers', fr: 'Clients' }, catalog: { en: 'Products', fr: 'Produits' }, pipeline: 'Orders', dashboards: { en: 'Numbers' } } },
    goals: [{ id: 'g1', connectors: ['shopify', 'stripe'] }, { id: 'g2', connectors: ['stripe', 'gmail'] }, 'junk'],
  })
  json(join(shop, 'themes', 'shop.json'), { id: 'shop', name: { en: 'Warm light', fr: 'Lumière chaude' }, settings: { acc: '#c25e0a' } })
  json(join(shop, 'teams', 'desk.json'), { id: 'desk' })
  json(join(shop, 'automations', 'a.json'), { id: 'a' }); json(join(shop, 'automations', 'b.json'), { id: 'b' })
  json(join(shop, 'skills', 'order-replies', 'skill.json'), {}); json(join(shop, 'skills', 'stock-check', 'skill.json'), {})
  json(join(shop, 'contacts', 'shop.json'), {}); json(join(shop, 'pipeline', 'orders.json'), {}); json(join(shop, 'pipeline', 'returns.json'), {})
  // a cover picture (the three bytes of a JPEG, then padding), one line per needed plugin, and the « next trades »
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)])
  writeFileSync(join(shop, 'cover.jpg'), JPEG)
  json(join(shop, 'why.json'), { 'kybernos/contacts': { en: 'Your customers.', fr: 'Tes clients.' }, 'kybernos/pipeline': 'Orders, new to delivered.', 'kybernos/skills': { en: 'not a business plugin' }, 'acme/inbox': { fr: 'no English: left out' } })
  json(join(root, '_next', 'next.json'), [{ id: 'consulting', name: { en: 'Consulting', fr: 'Conseil' } }, { id: 'law-firm', name: 'Law firm' }, { id: 'Bad Id', name: 'x' }, { id: 'nameless' }, { id: 'consulting', name: 'twice' }, 'junk'])
  writeFileSync(join(root, '_next', 'consulting.jpg'), JPEG)
  json(join(shop, 'demo', 'sample.json'), { contacts: [{ ref: 'a', kind: 'person', type: 'customer', name: 'Ann' }, { ref: 'b', kind: 'company', type: 'customer', name: 'Bco' }], items: [{ ref: 'i', type: 'product', title: 'Mug', status: 'live' }], cards: [] })
  // folders that must be skipped, each for its own reason
  mkdirSync(join(root, 'empty'))
  json(join(root, 'code', 'plugin.json'), { id: 'acme/code', kind: 'code', name: 'Code' })
  json(join(root, 'noid', 'plugin.json'), { id: 'NOT AN ID', name: 'x' })
  json(join(root, 'noname', 'plugin.json'), { id: 'acme/noname' })
  mkdirSync(join(root, 'Bad Name'))
  writeFileSync(join(root, 'file.txt'), 'not a folder')

  ok('a theme folder is summarised for a card: name, line, colour, words of the Business rows, what it needs and adds', () => {
    const r = readTheme(root, 'shop')
    assert.equal(r.ok, true, JSON.stringify(r))
    const t = r.theme
    assert.equal(t.id, 'kybernos-themes/shop')
    assert.deepEqual(t.name, { en: 'E-commerce shop', fr: 'Boutique en ligne' })
    assert.deepEqual(t.description, { en: 'Answer customers faster.', fr: 'Réponds plus vite.' })
    assert.equal(t.accent, '#c35e08', 'the pack\'s colour first')
    assert.equal(t.icon, 'bag')
    assert.deepEqual(t.field, { en: 'E-commerce', fr: 'E-commerce' })
    assert.deepEqual(t.words, { contacts: { en: 'Customers', fr: 'Clients' }, catalog: { en: 'Products', fr: 'Produits' }, pipeline: { en: 'Orders', fr: 'Orders' } }, 'only the three business rows; a text word is kept for both languages; dashboards is not a business row')
    assert.deepEqual(t.style, { id: 'shop', name: { en: 'Warm light', fr: 'Lumière chaude' }, accent: '#c25e0a' })
    assert.deepEqual(t.needs, ['kybernos/contacts', 'kybernos/catalog', 'kybernos/pipeline', 'acme/inbox'], 'the business plugins first in their order, then the others; never core/theme/skills')
    assert.deepEqual(t.points, { contacts: 1, pipeline: 2 })
    assert.deepEqual(t.adds, { skills: 2, teams: 1, automations: 2, connectors: 3 }, 'connectors counted once each across goals')
    assert.equal(t.dir, 'shop')
    assert.equal(r.folder, join(root, 'shop'))
  })

  ok('the other folders are left out with their reason, the good one stays, and the list is sorted', () => {
    const r = readShipped(root)
    assert.deepEqual(r.themes.map((t) => t.dir), ['shop'])
    const why = Object.fromEntries(r.skipped.map((s) => [s.dir, s.reason]))
    assert.match(why.empty, /no readable plugin\.json/)
    assert.match(why.code, /data, not code/)
    assert.match(why.noid, /no author\/name id/)
    assert.match(why.noname, /no name/)
    assert.match(why['Bad Name'], /not an id/)
    assert.equal(why['file.txt'], undefined, 'a file is not a folder')
  })

  ok('a missing folder is an empty list, and an oversized or garbled plugin.json is a skip, never a throw', () => {
    assert.deepEqual(readShipped(join(root, 'nowhere')), { themes: [], skipped: [] })
    writeFileSync(join(root, 'noname', 'plugin.json'), '{ broken')
    assert.match(readTheme(root, 'noname').reason, /no readable plugin\.json/)
    writeFileSync(join(root, 'noname', 'plugin.json'), JSON.stringify({ id: 'acme/noname', name: 'x', pad: 'x'.repeat(FILE_MAX) }))
    assert.match(readTheme(root, 'noname').reason, /no readable plugin\.json/)
    assert.equal(readTheme(root, 42).ok, false)
    assert.equal(readTheme(root, '../etc').ok, false)
  })

  ok('at most SHIPPED_MAX themes are read, and the public view never carries the folder', () => {
    const many = mkdtempSync(join(tmpdir(), 'kb-shipped-many-'))
    try {
      for (let i = 0; i < SHIPPED_MAX + 3; i++) json(join(many, 't' + String(i).padStart(2, '0'), 'plugin.json'), { id: 'acme/t' + i, name: 'T' + i })
      const r = readShipped(many)
      assert.equal(r.themes.length, SHIPPED_MAX)
      assert.ok(r.themes.every((t) => typeof t.folder === 'string'))
      assert.ok(publicView(r.themes).every((t) => t.folder === undefined && typeof t.id === 'string'))
      assert.deepEqual(publicView(null), [])
    } finally { rmSync(many, { recursive: true, force: true }) }
  })

  ok('the chip, the cover and the lines per plugin come with the theme; a folder that starts with an underscore is not a theme', () => {
    const t = readTheme(root, 'shop').theme
    assert.equal(t.tag, 'Commerce', 'the first keyword, with a capital')
    assert.equal(t.cover, true)
    assert.deepEqual(t.why, { 'kybernos/contacts': { en: 'Your customers.', fr: 'Tes clients.' }, 'kybernos/pipeline': { en: 'Orders, new to delivered.', fr: 'Orders, new to delivered.' } }, 'only plugins the theme needs, only with English; a text stands for both languages')
    assert.ok(readShipped(root).themes.every((x) => x.dir !== '_next'))
    assert.ok(readShipped(root).skipped.every((x) => x.dir !== '_next'))
  })

  ok('the next trades: a list with a name each, a flag when a picture is there, bad entries and doubles left out, at most NEXT_MAX', () => {
    assert.deepEqual(readNext(root), [{ id: 'consulting', name: { en: 'Consulting', fr: 'Conseil' }, cover: true }, { id: 'law-firm', name: { en: 'Law firm', fr: 'Law firm' }, cover: false }])
    assert.deepEqual(readNext(join(root, 'nowhere')), [])
    const many = mkdtempSync(join(tmpdir(), 'kb-next-'))
    try {
      json(join(many, '_next', 'next.json'), Array.from({ length: NEXT_MAX + 4 }, (_, i) => ({ id: 't' + String.fromCharCode(97 + i) + 'x', name: 'T' + i })))
      assert.equal(readNext(many).length, NEXT_MAX)
      writeFileSync(join(many, '_next', 'next.json'), '{ broken')
      assert.deepEqual(readNext(many), [])
    } finally { rmSync(many, { recursive: true, force: true }) }
  })

  ok('a cover is served by id: a theme\'s own picture or a next trade\'s, only a real JPEG of a sane size, never a path', () => {
    assert.equal(coverFile(root, { id: 'kybernos-themes/shop' }), join(root, 'shop', 'cover.jpg'))
    assert.equal(coverFile(root, { next: 'consulting' }), join(root, '_next', 'consulting.jpg'))
    assert.equal(coverFile(root, { next: 'law-firm' }), null, 'no picture for that one')
    assert.equal(coverFile(root, { id: 'acme/vet-clinic' }), null, 'a theme without a cover')
    for (const bad of [{}, null, 'x', { id: '../shop' }, { next: '../shop/cover' }, { next: 'Bad Id' }, { id: 42 }, { next: 'nothing' }]) assert.equal(coverFile(root, bad), null, JSON.stringify(bad))
    writeFileSync(join(root, 'shop', 'cover.jpg'), Buffer.from('GIF89a' + 'x'.repeat(40)))
    assert.equal(coverFile(root, { id: 'kybernos-themes/shop' }), null, 'a GIF named .jpg is not served')
    writeFileSync(join(root, 'shop', 'cover.jpg'), Buffer.concat([JPEG, Buffer.alloc(COVER_MAX, 1)]))
    assert.equal(coverFile(root, { id: 'kybernos-themes/shop' }), null, 'too big')
    writeFileSync(join(root, 'shop', 'cover.jpg'), JPEG)
  })

  ok('the sample rows a theme carries are counted for its card and read whole for the seed; a broken or oversized file is no sample', () => {
    assert.deepEqual(readTheme(root, 'shop').theme.sample, { contacts: 2, items: 1, cards: 0, notes: 0 })
    assert.equal(readSample(join(root, 'shop')).contacts.length, 2)
    assert.equal(readSample(join(root, 'nowhere')), null)
    writeFileSync(join(root, 'shop', 'demo', 'sample.json'), '[1,2]')
    assert.equal(readSample(join(root, 'shop')), null, 'a list is not a sample')
    assert.equal(readTheme(root, 'shop').theme.sample, null)
    writeFileSync(join(root, 'shop', 'demo', 'sample.json'), '{ broken')
    assert.equal(readSample(join(root, 'shop')), null)
    writeFileSync(join(root, 'shop', 'demo', 'sample.json'), JSON.stringify({ contacts: [], pad: 'x'.repeat(SAMPLE_MAX) }))
    assert.equal(readSample(join(root, 'shop')), null, 'too big')
    json(join(shop, 'demo', 'sample.json'), { contacts: [{ ref: 'a', kind: 'person', type: 'customer', name: 'Ann' }, { ref: 'b', kind: 'company', type: 'customer', name: 'Bco' }], items: [{ ref: 'i', type: 'product', title: 'Mug', status: 'live' }], cards: [] })
    assert.equal(readTheme(root, 'shop').theme.sample.contacts, 2)
  })

  ok('BUSINESS_PLUGINS are the three plugins of the Business group, in the menu\'s order', () => {
    assert.deepEqual(BUSINESS_PLUGINS, ['kybernos/contacts', 'kybernos/catalog', 'kybernos/pipeline'])
  })

  // the Themes route: the read lists them, `stage` takes the id
  const starter = join(root, 'starter')
  cpSync(join(REPO, 'docs', 'dev', 'templates', 'acme-vet-clinic'), starter, { recursive: true })
  rmSync(join(starter, 'broken'), { recursive: true, force: true })
  const shipped = readShipped(root).themes
  const store = { dir: join(root, 'state') }
  const ports = { sameOrigin: () => true, session: () => true, shipped }
  const post = (body, over) => handleThemes(store, { method: 'POST', body }, Object.assign({}, ports, over || {}))

  ok('the GET lists the shipped themes without their folder', () => {
    const r = handleThemes(store, { method: 'GET' }, ports)
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.shipped.map((t) => t.id), ['kybernos-themes/shop', 'acme/vet-clinic'])
    assert.deepEqual(r.body.shipped.map((t) => t.cover), [true, false], 'the page is told whether a picture is there')
    assert.deepEqual(handleThemes(store, { method: 'GET' }, Object.assign({}, ports, { next: readNext(root) })).body.next, [{ id: 'consulting', name: { en: 'Consulting', fr: 'Conseil' }, cover: true }, { id: 'law-firm', name: { en: 'Law firm', fr: 'Law firm' }, cover: false }])
    assert.ok(r.body.shipped.every((t) => t.folder === undefined), JSON.stringify(r.body.shipped).includes(root) ? 'the folder leaked' : '')
    assert.equal(JSON.stringify(r.body).includes(root), false)
    assert.deepEqual(handleThemes(store, { method: 'GET' }, { sameOrigin: () => true }).body.shipped, [], 'no shipped list: an empty one, nothing breaks')
  })

  ok('stage by id: the host knows the folder, the level says « included », and the page sends no path', () => {
    const r = post({ action: 'stage', shipped: 'acme/vet-clinic' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual([r.body.ok, r.body.stage.id, r.body.stage.level, r.body.stage.path], [true, 'acme/vet-clinic', 'included', starter])
  })

  ok('stage by id: a path the page also sends is ignored; an unknown id is refused; the checks of a folder still apply', () => {
    assert.equal(post({ action: 'stage', shipped: 'acme/vet-clinic', folder: '/etc' }).body.stage.path, starter)
    const unknown = post({ action: 'stage', shipped: 'acme/other' })
    assert.deepEqual([unknown.status, unknown.body.error], [400, 'not-shipped'])
    assert.equal(post({ action: 'stage', shipped: { id: 'acme/vet-clinic' } }).body.error, 'not-shipped')
    // the shop theme has no package.json: the installer's own checks refuse it, as for any folder
    const bad = post({ action: 'stage', shipped: 'kybernos-themes/shop' })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error, 'package')
  })

  ok('stage by id keeps the guards in front: origin, then the signed session', () => {
    assert.equal(post({ action: 'stage', shipped: 'acme/vet-clinic' }, { sameOrigin: () => false }).status, 403)
    assert.equal(post({ action: 'stage', shipped: 'acme/vet-clinic' }, { session: () => ({ status: 401, error: 'sign-in required' }) }).status, 401)
  })

  ok('seed: the sample rows go into the business base through its seam, with the theme id; the second time the base says skipped', () => {
    const calls = []
    let skip = false
    const business = { seed: (data, opts) => { calls.push([data, opts]); return skip ? { ok: true, skipped: true, theme: opts.theme } : { ok: true, theme: opts.theme, counts: { contacts: data.contacts.length, items: data.items.length, cards: 0, notes: 0 } } } }
    const r = post({ action: 'seed', id: 'kybernos-themes/shop' }, { business })
    assert.deepEqual([r.status, r.body.ok, r.body.skipped, r.body.counts], [200, true, false, { contacts: 2, items: 1, cards: 0, notes: 0 }])
    assert.equal(calls.length, 1)
    assert.equal(calls[0][1].theme, 'kybernos-themes/shop')
    assert.equal(calls[0][1].actor, 'theme')
    assert.equal(calls[0][0].contacts[0].name, 'Ann', 'the rows are the theme\'s own file, not the page\'s')
    skip = true
    assert.deepEqual(post({ action: 'seed', id: 'kybernos-themes/shop' }, { business }).body, { ok: true, skipped: true, counts: null })
  })

  ok('seed: no seam, a seam that throws or refuses, a theme with no sample, an unknown theme, a bad id and the guards all answer plainly', () => {
    assert.deepEqual(post({ action: 'seed', id: 'kybernos-themes/shop' }).body, { ok: false, error: 'base_missing' })
    assert.deepEqual(post({ action: 'seed', id: 'kybernos-themes/shop' }, { business: { seed: () => { throw new Error('boom') } } }).body, { ok: false, error: 'failed' })
    assert.deepEqual(post({ action: 'seed', id: 'kybernos-themes/shop' }, { business: { seed: () => ({ ok: false, error: 'bad_ref', detail: 'company_ref: no such row' }) } }).body, { ok: false, error: 'bad_ref', detail: 'company_ref: no such row' })
    assert.deepEqual(post({ action: 'seed', id: 'kybernos-themes/shop' }, { business: { seed: () => 'nonsense' } }).body, { ok: false, error: 'failed' })
    assert.equal(post({ action: 'seed', id: 'acme/vet-clinic' }, { business: { seed: () => assert.fail('no sample: the base is not asked') } }).body.error, 'no-sample')
    assert.equal(post({ action: 'seed', id: 'acme/other' }, { business: { seed: () => assert.fail('unknown theme') } }).body.error, 'no-sample')
    assert.equal(post({ action: 'seed', id: '../etc' }).status, 400)
    assert.equal(post({ action: 'seed', id: 'kybernos-themes/shop' }, { sameOrigin: () => false }).status, 403)
    assert.equal(post({ action: 'seed', id: 'kybernos-themes/shop' }, { session: () => ({ status: 401, error: 'sign-in required' }) }).status, 401)
  })

  ok('the owner of the databases a theme ships is not named as a need yet: no card lists it, no install would switch it on', () => {
    const manifest = JSON.parse(readFileSync(join(shop, 'plugin.json'), 'utf8'))
    const before = readTheme(root, 'shop').theme.needs
    json(join(shop, 'plugin.json'), { ...manifest, extends: [...(manifest.extends || []), { point: 'kybernos/db#template', range: '^1.0', dir: 'db', optional: true }, { point: 'acme/inbox#rule', range: '^1.0', dir: 'rules', optional: true }] })
    try {
      assert.equal(STAGED_OWNER, 'kybernos/db')
      assert.deepEqual(readTheme(root, 'shop').theme.needs, before, 'the owner of an optional extension is named, except this one')
    } finally { json(join(shop, 'plugin.json'), manifest) }
  })

  ok('readDbTemplate: the database a theme ships is read whole with its sample; a template that does not carry its file name, a broken or an oversized file is none', () => {
    const dir = join(shop, 'db')
    assert.equal(readDbTemplate(shop), null, 'no db folder: no template')
    json(join(dir, 'shop.json'), { id: 'shop', name: { en: 'Shop' }, objects: [] })
    assert.deepEqual(readDbTemplate(shop), { template: { id: 'shop', name: { en: 'Shop' }, objects: [] }, sample: null })
    json(join(shop, 'demo', 'db-sample.json'), { rows: { thing: [] } })
    assert.deepEqual(readDbTemplate(shop).sample, { rows: { thing: [] } })
    writeFileSync(join(shop, 'demo', 'db-sample.json'), '{ broken')
    assert.equal(readDbTemplate(shop).sample, null, 'a broken sample leaves the template, without rows')
    writeFileSync(join(shop, 'demo', 'db-sample.json'), JSON.stringify({ rows: {}, pad: 'x'.repeat(SAMPLE_MAX) }))
    assert.equal(readDbTemplate(shop).sample, null, 'too big')
    json(join(dir, 'shop.json'), { id: 'other', objects: [] })
    assert.equal(readDbTemplate(shop), null, 'the id is the name of the file')
    writeFileSync(join(dir, 'shop.json'), JSON.stringify({ id: 'shop', pad: 'x'.repeat(SAMPLE_MAX) }))
    assert.equal(readDbTemplate(shop), null, 'too big')
    writeFileSync(join(dir, 'shop.json'), '[1]')
    assert.equal(readDbTemplate(shop), null, 'a list is not a template')
    assert.equal(readDbTemplate(join(root, 'nowhere')), null)
    rmSync(dir, { recursive: true, force: true })
    rmSync(join(shop, 'demo', 'db-sample.json'), { force: true })
  })

  ok('seed: a theme that ships a database has it made through the db seam, in the page’s language, with the theme’s pictures; the answer carries it beside the old seed', () => {
    json(join(shop, 'db', 'shop.json'), { id: 'shop', name: { en: 'Shop' }, objects: [] })
    json(join(shop, 'demo', 'db-sample.json'), { rows: {} })
    const business = { seed: (data, opts) => ({ ok: true, theme: opts.theme, counts: { contacts: data.contacts.length, items: 1, cards: 0, notes: 0 } }) }
    const calls = []
    const db = { install: (args) => { calls.push(args); return { ok: true, db: 'D1', counts: { objects: 2, views: 3, rows: 4, photos: 1 } } } }
    const photo = (spec) => spec
    const r = post({ action: 'seed', id: 'kybernos-themes/shop', lang: 'fr' }, { business, db, photo })
    assert.deepEqual(r.body, { ok: true, skipped: false, counts: { contacts: 2, items: 1, cards: 0, notes: 0 }, db: { ok: true, skipped: false, db: 'D1', counts: { objects: 2, views: 3, rows: 4, photos: 1 } } })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].lang, 'fr')
    assert.equal(calls[0].photo, photo)
    assert.deepEqual(calls[0].template, { id: 'shop', name: { en: 'Shop' }, objects: [] }, 'the theme’s own file, not the page’s')
    assert.deepEqual(calls[0].sample, { rows: {} })
    for (const lang of [undefined, 'xx', 42, { en: 1 }]) { post({ action: 'seed', id: 'kybernos-themes/shop', lang }, { business, db }); assert.equal(calls[calls.length - 1].lang, 'en', JSON.stringify(lang)) }
    assert.equal(post({ action: 'seed', id: 'kybernos-themes/shop' }, { business, db: { install: () => ({ ok: true, skipped: true, db: 'D1' }) } }).body.db.skipped, true)
  })

  ok('seed: a db seam that refuses, throws or is absent never blocks the old seed; a theme with only a database is seeded through it; a page cannot ask for a db the theme does not ship', () => {
    const business = { seed: () => ({ ok: true, counts: { contacts: 2, items: 1, cards: 0, notes: 0 } }) }
    const refused = post({ action: 'seed', id: 'kybernos-themes/shop' }, { business, db: { install: () => ({ ok: false, error: 'rows', detail: 'a field' }) } }).body
    assert.deepEqual([refused.ok, refused.db], [true, { ok: false, error: 'rows', detail: 'a field' }])
    assert.deepEqual(post({ action: 'seed', id: 'kybernos-themes/shop' }, { business, db: { install: () => { throw new Error('boom') } } }).body.db, { ok: false, error: 'failed', detail: undefined })
    assert.deepEqual(post({ action: 'seed', id: 'kybernos-themes/shop' }, { business, db: { install: () => 'nonsense' } }).body.db, { ok: false, error: 'failed', detail: undefined })
    assert.equal('db' in post({ action: 'seed', id: 'kybernos-themes/shop' }, { business }).body, false, 'no seam: the old answer, unchanged')
    assert.equal('db' in post({ action: 'seed', id: 'kybernos-themes/shop' }, { business, db: {} }).body, false, 'a seam without install is no seam')
    // a theme with no sample.json but with a database: the old base is not asked
    rmSync(join(shop, 'demo', 'sample.json'))
    const only = post({ action: 'seed', id: 'kybernos-themes/shop' }, { business: { seed: () => assert.fail('no sample: the base is not asked') }, db: { install: () => ({ ok: true, db: 'D2', counts: null }) } }).body
    assert.deepEqual(only, { ok: true, skipped: true, counts: null, db: { ok: true, skipped: false, db: 'D2', counts: null } })
    assert.equal(post({ action: 'seed', id: 'kybernos-themes/shop' }, { business }).body.error, 'no-sample', 'neither a sample nor a seam')
    // a theme that ships no database is never offered to the seam
    assert.equal(post({ action: 'seed', id: 'acme/vet-clinic' }, { business, db: { install: () => assert.fail('no database in that theme') } }).body.error, 'no-sample')
    rmSync(join(shop, 'db'), { recursive: true, force: true })
    rmSync(join(shop, 'demo', 'db-sample.json'), { force: true })
  })

  ok('skill: the host copies a skill the shipped theme carries, by name, through its own port; nothing else is asked of it', () => {
    const calls = []
    const skill = (folder, name) => { calls.push([folder, name]); return { ok: name === 'order-replies', action: 'created' } }
    const r = post({ action: 'skill', id: 'kybernos-themes/shop', name: 'order-replies' }, { skill })
    assert.deepEqual([r.status, r.body], [200, { ok: true, action: 'created' }])
    assert.deepEqual(calls, [[join(root, 'shop'), 'order-replies']], 'the folder is the host\'s, never the page\'s')
    assert.deepEqual(post({ action: 'skill', id: 'kybernos-themes/shop', name: 'other' }, { skill }).body, { ok: false, error: 'no-skill' })
    assert.deepEqual(post({ action: 'skill', id: 'kybernos-themes/shop', name: 'order-replies' }).body, { ok: false, error: 'no-skill' }, 'no port: no skill')
    assert.deepEqual(post({ action: 'skill', id: 'acme/other', name: 'order-replies' }, { skill }).body, { ok: false, error: 'no-skill' })
    assert.deepEqual(post({ action: 'skill', id: 'kybernos-themes/shop', name: 'order-replies' }, { skill: () => { throw new Error('boom') } }).body, { ok: false, error: 'no-skill' })
    for (const name of ['../x', 'A b', '', 'x'.repeat(70), 'a/b']) assert.equal(post({ action: 'skill', id: 'kybernos-themes/shop', name }, { skill }).status, 400, name)
    assert.equal(post({ action: 'skill', id: 'kybernos-themes/shop', name: 'order-replies' }, { skill, sameOrigin: () => false }).status, 403)
    assert.equal(calls.length, 2, 'only the two requests that named a shipped theme and a good name reached the port')
  })

  ok('a shipped folder that is a symbolic link is refused like any other', () => {
    const link = join(root, 'linked')
    symlinkSync(starter, link)
    const r = handleThemes(store, { method: 'POST', body: { action: 'stage', shipped: 'acme/vet-clinic' } }, { sameOrigin: () => true, session: () => true, shipped: [Object.assign({}, shipped[1], { folder: link })] })
    assert.equal(r.status, 400)
    assert.match(r.body.reason, /symbolic link/)
  })

  ok('photoFile serves a plain JPEG of a shipped theme by its id, never a path, a link, a lookalike or a file that is not a JPEG', () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)])
    mkdirSync(join(root, 'shop', 'demo', 'photos'), { recursive: true })
    writeFileSync(join(root, 'shop', 'demo', 'photos', 'mug-1.jpg'), jpeg)
    writeFileSync(join(root, 'shop', 'demo', 'photos', 'not-a-jpeg.jpg'), Buffer.from('GIF89a......'))
    writeFileSync(join(root, 'shop', 'demo', 'photos', 'huge.jpg'), Buffer.concat([jpeg, Buffer.alloc(PHOTO_MAX)]))
    symlinkSync(join(root, 'shop', 'demo', 'photos', 'mug-1.jpg'), join(root, 'shop', 'demo', 'photos', 'linked.jpg'))
    assert.equal(photoFile(root, 'shop/mug-1'), join(root, 'shop', 'demo', 'photos', 'mug-1.jpg'))
    for (const bad of ['shop/not-a-jpeg', 'shop/huge', 'shop/linked', 'shop/missing', 'nowhere/mug-1', '../shop/mug-1', 'shop/../mug-1', 'shop/mug-1.jpg', 'shop/Mug-1', 'shop', '', undefined, null, 7, { id: 'shop/mug-1' }, '_next/consulting']) assert.equal(photoFile(root, bad), null, String(bad))
  })
  // a folder the person points at: any name, read for a preview before anything is installed
  ok('previewFolder reads a folder whatever it is called, and answers null for what is not a theme', () => {
    const odd = join(root, 'My Odd Folder')
    cpSync(starter, odd, { recursive: true })
    const v = previewFolder(odd)
    assert.equal(v.id, 'acme/vet-clinic')
    assert.equal(v.folder, undefined, 'the preview never names the folder')
    assert.ok(v.name.en && v.adds && Array.isArray(v.needs))
    assert.equal(previewFolder(join(root, 'nothing-here')), null)
    assert.equal(previewFolder(''), null)
    assert.equal(previewFolder(42), null)
  })
  ok('stage answers the preview of the folder through its port, and null without one', () => {
    const withPort = post({ action: 'stage', folder: starter }, { preview: previewFolder })
    assert.equal(withPort.status, 200, JSON.stringify(withPort.body))
    assert.equal(withPort.body.preview.id, 'acme/vet-clinic')
    assert.equal(withPort.body.preview.folder, undefined)
    assert.equal(post({ action: 'stage', folder: starter }).body.preview, null)
    assert.equal(post({ action: 'stage', folder: starter }, { preview: () => { throw new Error('boom') } }).body.preview, null)
  })
  ok('stage reads « ~/… » as the home folder, and refuses a tilde path that climbs', () => {
    const home = mkdtempSync(join(tmpdir(), 'kb-home-'))
    const was = process.env.HOME
    try {
      process.env.HOME = home
      cpSync(starter, join(home, 'templates', 'vet'), { recursive: true })
      const r = post({ action: 'stage', folder: '~/templates/vet' })
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.equal(r.body.stage.path, join(home, 'templates', 'vet'))
      assert.equal(post({ action: 'stage', folder: '~/../vet' }).status, 400)
      assert.equal(post({ action: 'stage', folder: '~' }).status, 400)
      assert.equal(post({ action: 'stage', folder: '~other/x' }).status, 400)
    } finally { process.env.HOME = was; rmSync(home, { recursive: true, force: true }) }
  })
} finally { rmSync(root, { recursive: true, force: true }) }

console.log('\n' + count + ' checks passed')
