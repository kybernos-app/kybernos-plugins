// kybernos-db, making a database from a template (instantiate.mjs): the objects, the views, the sample rows with their links and pictures, once per template, and nothing left
// behind when it fails. Hermetic: a temp folder, a real SQLite file, no network, no DSH.
//
//   node packages/kybernos-db/test-instantiate.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeService } from './agent/service.mjs'
import { ACTOR, MARKER_FILE, installTemplate, readMarkers } from './instantiate.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
const root = mkdtempSync(join(tmpdir(), 'kb-db-inst-'))
let n = 0
const freshService = () => { const home = join(root, 'h' + (n++)); return { home, service: makeService({ dir: join(home, 'dbs') }) } }
const L = (en, fr) => (fr === undefined ? { en } : { en, fr })

const TEMPLATE = {
  id: 'garden-shop',
  name: L('Garden shop', 'Jardinerie'),
  objects: [
    { key: 'contact', label: L('Contacts', 'Contacts'), title: 'name', fields: [
      { key: 'name', type: 'text', required: true, label: L('Name', 'Nom') },
      { key: 'boss', type: 'relation', to: 'contact', label: L('Boss', 'Chef'), inverse: L('Team', 'Équipe') },
      { key: 'photo', type: 'attachment', label: L('Photo'), maxBytes: 1000 },
    ] },
    { key: 'order', label: L('Orders', 'Commandes'), title: 'ref', fields: [
      { key: 'ref', type: 'text', label: L('Reference', 'Référence') },
      { key: 'stage', type: 'choice', label: L('Stage', 'Étape'), options: [{ key: 'new', label: L('New', 'Nouvelle'), color: 'blue' }, { key: 'sent', label: L('Sent') }] },
      { key: 'total', type: 'money', currency: 'EUR', label: L('Total') },
      { key: 'buyers', type: 'relation', to: 'contact', many: true, label: L('Buyers', 'Acheteurs') },
    ] },
  ],
  views: [
    { object: 'order', id: 'order-board', name: L('Pipeline'), kind: 'board', by: 'stage', fav: true },
    { object: 'contact', id: 'contact-list', name: L('All'), kind: 'table' },
    { object: 'contact', id: 'contact-gallery', name: L('Gallery', 'Galerie'), kind: 'cards', cover: true },
  ],
}
const SAMPLE = {
  rows: {
    // the boss comes AFTER the person who reports to them: the link is made once both rows exist
    contact: [
      { ref: 'bo', values: { name: 'Bo', boss: { ref: 'ana' }, photo: [{ photo: 'garden-shop/portrait-01' }] } },
      { ref: 'ana', values: { name: 'Ana', photo: [{ photo: 'garden-shop/portrait-01' }, { photo: 'garden-shop/missing' }] } },
    ],
    order: [
      { values: { ref: 'A-1', stage: 'new', total: 12.5, buyers: [{ ref: 'bo' }, { ref: 'ana' }] } },
      { values: { ref: 'A-2', stage: 'sent' } },
    ],
  },
}
const PIXEL = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const photo = (spec) => (spec === 'garden-shop/portrait-01' ? PIXEL : null)

await ok('a template is made into a database: objects, views, rows, links (also forward ones) and pictures', () => {
  const { service } = freshService()
  const r = installTemplate({ service, template: TEMPLATE, sample: SAMPLE, lang: 'en', photo })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.counts, { objects: 2, views: 3, rows: 4, photos: 2 })
  assert.equal(r.name, 'Garden shop')
  assert.equal(r.lang, 'en')
  const db = service.byId(r.db).db
  assert.deepEqual(db.objects().map((o) => o.key + '=' + o.label), ['contact=Contacts', 'order=Orders'])
  assert.deepEqual(db.listViews('order').map((v) => v.id + ':' + v.kind + ':' + v.by), ['order-board:board:stage'])
  assert.deepEqual(db.listViews('contact').map((v) => v.id + ':' + v.kind + ':' + v.cover), ['contact-gallery:cards:true', 'contact-list:table:undefined'], 'a gallery keeps its cover')
  const contacts = db.list('contact')
  const bo = contacts.find((c) => c.values.name === 'Bo')
  const ana = contacts.find((c) => c.values.name === 'Ana')
  assert.equal(bo.values.boss, ana.id, 'the forward link points at the real record')
  assert.equal(bo.values.photo.length, 1)
  assert.equal(bo.values.photo[0].type, 'image/jpeg')
  assert.equal(bo.values.photo[0].name, 'portrait-01.jpg')
  assert.equal(ana.values.photo.length, 1, 'a picture the host does not have is left out, not an error')
  const orders = db.list('order')
  assert.deepEqual(orders.find((o) => o.values.ref === 'A-1').values.buyers.sort(), [ana.id, bo.id].sort())
  assert.equal(orders.find((o) => o.values.ref === 'A-2').values.buyers, null)
  assert.deepEqual(db.verify().problems, [])
  assert.ok(db.journal().every((op) => op.by === ACTOR), 'every change says it came from the template')
  assert.equal(db.attach(PIXEL, { name: 'x.jpg', type: 'image/jpeg' }, 1000).file.hash, bo.values.photo[0].hash, 'the picture is a blob shared by hash')
})

await ok('the person’s language is used, English when the template does not speak it', () => {
  const fr = installTemplate({ ...freshService(), template: TEMPLATE, sample: SAMPLE, lang: 'fr', photo })
  assert.equal(fr.name, 'Jardinerie')
  assert.equal(fr.lang, 'fr')
  const es = installTemplate({ ...freshService(), template: TEMPLATE, lang: 'es' })
  assert.equal(es.name, 'Garden shop')
  assert.equal(es.lang, 'en')
  const none = installTemplate({ ...freshService(), template: TEMPLATE })
  assert.equal(none.lang, 'en')
  assert.deepEqual(none.counts, { objects: 2, views: 3, rows: 0, photos: 0 }, 'a template without a sample makes empty tables')
})

await ok('a template is installed once: the second time changes nothing, and survives a new service', () => {
  const { home, service } = freshService()
  const first = installTemplate({ service, template: TEMPLATE, sample: SAMPLE, lang: 'en', photo })
  const again = installTemplate({ service, template: TEMPLATE, sample: SAMPLE, lang: 'fr', photo })
  assert.deepEqual(again, { ok: true, skipped: true, db: first.db })
  assert.equal(service.list().length, 1)
  assert.deepEqual(readMarkers(join(home, MARKER_FILE)), { 'garden-shop': first.db })
  service.close()
  const reopened = makeService({ dir: join(home, 'dbs') })
  assert.equal(installTemplate({ service: reopened, template: TEMPLATE, sample: SAMPLE, photo }).skipped, true)
  reopened.close()
})

await ok('a database the person no longer has is made again', () => {
  const { home, service } = freshService()
  const first = installTemplate({ service, template: TEMPLATE, lang: 'en' })
  service.discard(first.db)
  const second = installTemplate({ service, template: TEMPLATE, lang: 'en' })
  assert.equal(second.ok, true)
  assert.notEqual(second.skipped, true)
  assert.notEqual(second.db, first.db)
  assert.equal(readMarkers(join(home, MARKER_FILE))['garden-shop'], second.db)
})

await ok('a template or a sample that is refused writes nothing', () => {
  const t = freshService()
  const noObjects = installTemplate({ ...t, template: { ...TEMPLATE, objects: [] } })
  assert.equal(noObjects.error, 'template')
  assert.ok(noObjects.errors.length > 0)
  assert.equal(installTemplate({ ...t, template: 'x' }).error, 'template')
  assert.equal(installTemplate({ ...t, template: TEMPLATE, sample: { rows: { ghost: [] } } }).error, 'sample')
  const badValue = installTemplate({ ...t, template: TEMPLATE, sample: { rows: { order: [{ values: { stage: 'nowhere' } }] } } })
  assert.equal(badValue.error, 'rows')
  assert.match(badValue.errors[0], /rows\.order\[0\]\.values\.stage/)
  const noName = installTemplate({ ...t, template: TEMPLATE, sample: { rows: { contact: [{ values: { boss: null } }] } } })
  assert.equal(noName.error, 'rows')
  assert.match(noName.errors[0], /values\.name: required/)
  assert.equal(t.service.list().length, 0)
  assert.equal(existsSync(join(t.home, MARKER_FILE)), false)
  assert.deepEqual(existsSync(join(t.home, 'dbs')) ? readdirSync(join(t.home, 'dbs')) : [], [])
})

await ok('a failure half way removes the half-made database, and a retry starts from nothing', () => {
  const { home, service } = freshService()
  const boom = installTemplate({ service, template: TEMPLATE, sample: SAMPLE, lang: 'en', photo: () => { throw new Error('disk gone') } })
  assert.equal(boom.ok, false)
  assert.equal(boom.error, 'failed')
  assert.match(boom.detail, /disk gone/)
  assert.deepEqual(readdirSync(join(home, 'dbs')), [], 'the folder of the half-made db is gone')
  assert.equal(service.list().length, 0)
  assert.equal(existsSync(join(home, MARKER_FILE)), false)
  const retry = installTemplate({ service, template: TEMPLATE, sample: SAMPLE, lang: 'en', photo })
  assert.equal(retry.ok, true)
  assert.equal(service.list().length, 1)
})

await ok('a picture over the field’s cap is a failure, not a truncated file', () => {
  const { service } = freshService()
  const big = Uint8Array.from({ length: 2000 }, () => 7)
  const r = installTemplate({ service, template: TEMPLATE, sample: SAMPLE, photo: () => big })
  assert.equal(r.ok, false)
  assert.match(r.detail, /picture garden-shop\/portrait-01/)
  assert.equal(service.list().length, 0)
})

await ok('the marker file lives beside the dbs folder, can be moved, and a broken one is read as empty', () => {
  const { home, service } = freshService()
  const markerFile = join(home, 'elsewhere', 'm.json')
  const r = installTemplate({ service, template: TEMPLATE, markerFile })
  assert.equal(r.ok, true)
  assert.equal(readMarkers(markerFile)['garden-shop'], r.db)
  assert.equal(existsSync(join(home, MARKER_FILE)), false)
  writeFileSync(markerFile, 'not json')
  assert.deepEqual(readMarkers(markerFile), {})
  assert.deepEqual(readMarkers(join(home, 'nowhere.json')), {})
})

await ok('discard only removes a db folder: a bad id touches nothing', () => {
  const { home, service } = freshService()
  const r = installTemplate({ service, template: TEMPLATE })
  service.discard('../..')
  service.discard(undefined)
  assert.equal(existsSync(join(home, 'dbs', r.db, 'db.sqlite')), true)
  service.discard(r.db)
  assert.equal(existsSync(join(home, 'dbs', r.db)), false)
})

await ok('the shipped themes are made into databases, in both languages, and verify clean', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const themes = join(here, '..', 'kybernos-plugin', 'themes')
  const expected = { 'real-estate': { rows: 73, photos: 39 }, ecommerce: { rows: 64, photos: 32 }, recruitment: { rows: 63, photos: 31 } }
  for (const [dir, want] of Object.entries(expected)) {
    for (const lang of ['en', 'fr']) {
      const { service } = freshService()
      const template = JSON.parse(readFileSync(join(themes, dir, 'db', dir + '.json'), 'utf8'))
      const sample = JSON.parse(readFileSync(join(themes, dir, 'demo', 'db-sample.json'), 'utf8'))
      const real = (spec) => { const file = join(themes, ...spec.split('/').flatMap((p, i) => (i === 0 ? [p, 'demo', 'photos'] : [p + '.jpg']))); return existsSync(file) ? readFileSync(file) : null }
      const r = installTemplate({ service, template, sample, lang, photo: real })
      assert.equal(r.ok, true, dir + ' ' + lang + ' ' + JSON.stringify(r))
      assert.equal(r.counts.rows, want.rows, dir)
      assert.equal(r.counts.photos, want.photos, dir + ': every picture of the sample is found')
      const db = service.byId(r.db).db
      assert.deepEqual(db.verify().problems, [], dir)
      for (const o of db.objects()) assert.ok(db.listViews(o.key).length >= 1, dir + '/' + o.key + ' has a view')
      service.close()
    }
  }
})

rmSync(root, { recursive: true, force: true })
console.log('\nkybernos-db instantiate: ' + count + ' checks passed')
