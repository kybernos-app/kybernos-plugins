// The themes the product ships (themes-shipped.mjs) and how the Themes route uses them: the list the page reads, and `stage` by id.
// Hermetic: temp folders only.   node packages/kybernos-plugin/test-themes-shipped.mjs
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleThemes } from './theme-installer.mjs'
import { BUSINESS_PLUGINS, COVER_MAX, FILE_MAX, NEXT_MAX, SHIPPED_MAX, coverFile, publicView, readNext, readShipped, readTheme } from './themes-shipped.mjs'

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

  ok('a shipped folder that is a symbolic link is refused like any other', () => {
    const link = join(root, 'linked')
    symlinkSync(starter, link)
    const r = handleThemes(store, { method: 'POST', body: { action: 'stage', shipped: 'acme/vet-clinic' } }, { sameOrigin: () => true, session: () => true, shipped: [Object.assign({}, shipped[1], { folder: link })] })
    assert.equal(r.status, 400)
    assert.match(r.body.reason, /symbolic link/)
  })
} finally { rmSync(root, { recursive: true, force: true }) }

console.log('\n' + count + ' checks passed')
