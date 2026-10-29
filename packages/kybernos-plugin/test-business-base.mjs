// The shared SQLite base of the business plugins (business-base.mjs): created on the first question and never at start-up, the contract of the
// small bases (foreign keys, CHECKs, idempotent migrations), a journal line per write, the sample rows, export and delete, a base that never
// throws into DSH, and two processes writing at once.
//
// Hermetic: every file lives in a temp folder, nothing reads or writes a real DSH home. No server, no GUI.
//
//   node packages/kybernos-plugin/test-business-base.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { ACTORS, SCHEMA_VERSION, SEAM, TABLES, businessFile, createBusinessBase, ensureBusiness } from './business-base.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const MODULE = fileURLToPath(new URL('./business-base.mjs', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'kb-business-'))
let count = 0
let folderNo = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
/** A fresh base on its own folder. */
const fresh = (extra = {}) => {
  const dir = join(root, 'case-' + (++folderNo))
  const file = join(dir, 'business', 'donnees.sqlite')
  return { dir, file, base: createBusinessBase({ file, ...extra }) }
}
const peek = (file, fn) => { const db = new DatabaseSync(file, { readOnly: true }); try { return fn(db) } finally { db.close() } }
const names = (file) => peek(file, (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name))
const changes = (file) => peek(file, (db) => db.prepare('SELECT * FROM changes ORDER BY id').all())
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

try {
  // ── start-up: nothing is created ────────────────────────────────────────────────────────────────────────────────────────────
  await ok('the seam is frozen, version 1, published once, and the same object the second time; no file, no folder yet', () => {
    const { dir, file } = fresh()
    delete globalThis[SEAM]
    const seam = ensureBusiness({ file })
    assert.equal(seam.version, 1)
    assert.equal(Object.isFrozen(seam), true)
    assert.equal(globalThis[SEAM], seam)
    assert.equal(ensureBusiness({ file: join(dir, 'other.sqlite') }), seam, 'a second call returns the published seam')
    assert.equal(existsSync(file), false)
    assert.equal(existsSync(dir), false, 'not even the folder')
    const st = seam.status()
    assert.deepEqual([st.ok, st.exists, st.available, st.schema], [true, false, true, SCHEMA_VERSION])
    assert.equal(existsSync(dir), false, 'status() creates nothing either')
    delete globalThis[SEAM]
  })

  await ok('the default file is <DSH home>/kybernos/business/donnees.sqlite and follows DSH_HOME at each use', () => {
    const was = process.env.DSH_HOME
    try {
      process.env.DSH_HOME = join(root, 'home-a')
      assert.equal(businessFile(), join(root, 'home-a', 'kybernos', 'business', 'donnees.sqlite'))
      process.env.DSH_HOME = join(root, 'home-b')
      assert.equal(businessFile(), join(root, 'home-b', 'kybernos', 'business', 'donnees.sqlite'))
    } finally { if (was === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = was }
  })

  // ── the first question creates the file ────────────────────────────────────────────────────────────────────────────────────────
  await ok('the first question creates the file, in WAL, at the current schema, with the seven tables, a pack row and the markers', () => {
    const { file, base } = fresh()
    const r = base.open()
    assert.equal(r.ok, true)
    assert.equal(r.version, SCHEMA_VERSION)
    assert.equal(existsSync(file), true)
    assert.deepEqual(names(file), ['changes', 'contact', 'flow_card', 'item', 'meta', 'note', 'pack'])
    peek(file, (db) => {
      assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION)
      const pack = db.prepare('SELECT contenu FROM pack').all()
      assert.equal(pack.length, 1, 'exactly one manifest row')
      assert.deepEqual(JSON.parse(pack[0].contenu).entites.map((e) => e.table), ['contact', 'item', 'flow_card'])
      const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((m) => [m.key, m.value]))
      assert.equal(meta.schema_version, String(SCHEMA_VERSION))
      assert.equal(meta.seeded, '[]')
      assert.match(meta.created_at, /^\d{4}-\d\d-\d\dT/)
    })
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o077, 0, 'private to the owner')
    base.close()
  })

  await ok('the same base is reopened by another process and by a second call: nothing is migrated twice', () => {
    const { file, base } = fresh()
    base.open()
    const created = peek(file, (db) => db.prepare("SELECT value FROM meta WHERE key = 'created_at'").get().value)
    base.close()
    const again = createBusinessBase({ file })
    assert.equal(again.open().ok, true)
    assert.equal(again.open().ok, true)
    peek(file, (db) => {
      assert.equal(db.prepare('SELECT COUNT(*) n FROM pack').get().n, 1)
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'created_at'").get().value, created)
    })
    again.close()
  })

  await ok('a base written by a NEWER Kybernos is refused and left untouched', () => {
    const { dir, file } = fresh()
    mkdirSync(join(dir, 'business'), { recursive: true })
    const raw = new DatabaseSync(file)
    raw.exec('PRAGMA user_version = 99')
    raw.close()
    const r = createBusinessBase({ file }).open()
    assert.deepEqual([r.ok, r.error], [false, 'schema_newer'])
    assert.deepEqual(names(file), [], 'no table was created')
    assert.equal(peek(file, (db) => db.prepare('PRAGMA user_version').get().user_version), 99)
  })

  await ok('an empty file that is not at the current schema yet (a crash before the first migration) migrates in place', () => {
    const { dir, file } = fresh()
    mkdirSync(join(dir, 'business'), { recursive: true })
    new DatabaseSync(file).close()
    const base = createBusinessBase({ file })
    assert.equal(base.open().ok, true)
    assert.equal(names(file).length, 7)
    base.close()
  })

  // ── the contract: foreign keys on, CHECKs in the schema ────────────────────────────────────────────────────────────────────────
  await ok('the schema itself refuses what the code would let through: closed lists and JSON shapes', () => {
    const { file, base } = fresh()
    base.open(); base.close()
    const raw = new DatabaseSync(file)
    const t = '2026-01-01T00:00:00.000Z'
    const run = (sql) => raw.prepare(sql).run()
    assert.throws(() => run(`INSERT INTO contact (kind, name, created_at, updated_at) VALUES ('robot', 'x', '${t}', '${t}')`), /constraint/i)
    assert.throws(() => run(`INSERT INTO contact (name, created_at, updated_at) VALUES ('', '${t}', '${t}')`), /constraint/i)
    assert.throws(() => run(`INSERT INTO contact (name, tags, created_at, updated_at) VALUES ('x', '{"a":1}', '${t}', '${t}')`), /constraint/i)
    assert.throws(() => run(`INSERT INTO contact (name, fields, created_at, updated_at) VALUES ('x', 'not json', '${t}', '${t}')`), /constraint|malformed/i)
    assert.throws(() => run(`INSERT INTO changes (ts, actor, tbl, action) VALUES ('${t}', 'ghost', 'contact', 'create')`), /constraint/i)
    assert.throws(() => run(`INSERT INTO changes (ts, actor, tbl, action) VALUES ('${t}', 'person', 'contact', 'explode')`), /constraint/i)
    raw.close()
  })

  await ok('foreign keys are on: a note on a missing contact is bad_ref, and nothing is written, not even the journal', () => {
    const { file, base } = fresh()
    const r = base.create('note', { contact_id: 42, body: 'hello' })
    assert.deepEqual([r.ok, r.error], [false, 'bad_ref'])
    base.close()
    assert.equal(peek(file, (db) => db.prepare('SELECT COUNT(*) n FROM note').get().n), 0)
    assert.equal(changes(file).length, 0, 'the failed write rolled its journal line back with it')
  })

  // ── rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('contacts: create, get, update, search, archive, restore; every write leaves one journal line with who did it', () => {
    const { file, base } = fresh()
    const acme = base.create('contact', { kind: 'company', name: 'Acme', type: 'client' }).row
    const ada = base.create('contact', { name: '  Ada Lovelace ', type: 'customer', email: 'ada@example.test', company_id: acme.id, tags: ['vip', 'vip', ' repeat '], fields: { city: 'Lyon' } }, { actor: 'agent' }).row
    assert.equal(ada.name, 'Ada Lovelace', 'trimmed')
    assert.deepEqual(ada.tags, ['vip', 'repeat'], 'trimmed and de-duplicated')
    assert.deepEqual(ada.fields, { city: 'Lyon' })
    assert.equal(ada.demo, false)
    assert.deepEqual(base.get('contact', ada.id).row, ada)
    const up = base.update('contact', ada.id, { email: 'ada@acme.test', tags: [] }, { actor: 'person' })
    assert.equal(up.row.email, 'ada@acme.test')
    assert.ok(up.row.updated_at >= ada.updated_at)
    assert.equal(base.list('contact', { q: 'lovelace' }).total, 1)
    assert.equal(base.list('contact', { type: 'customer' }).rows[0].id, ada.id)
    assert.equal(base.list('contact', { company_id: acme.id }).total, 1)
    assert.equal(base.archive('contact', ada.id).row.archived_at !== null, true)
    assert.equal(base.list('contact').total, 1, 'an archived contact is out of the list')
    assert.equal(base.list('contact', { includeArchived: true }).total, 2)
    assert.equal(base.restore('contact', ada.id).row.archived_at, null)
    base.close()
    const j = changes(file)
    assert.deepEqual(j.map((c) => c.action), ['create', 'create', 'update', 'archive', 'restore'])
    assert.deepEqual(j.map((c) => c.actor), ['person', 'agent', 'person', 'person', 'person'])
    assert.ok(j.every((c) => c.tbl === 'contact' && c.ts.startsWith('20')))
  })

  await ok('a search treats % and _ as plain characters', () => {
    const { base } = fresh()
    base.create('contact', { name: '100% real' })
    base.create('contact', { name: 'plain' })
    base.create('contact', { name: 'a_b' })
    assert.equal(base.list('contact', { q: '100%' }).total, 1)
    assert.equal(base.list('contact', { q: 'a_b' }).total, 1)
    assert.equal(base.list('contact', { q: '%' }).total, 1)
    base.close()
  })

  await ok('bad input is refused with a code, never thrown', () => {
    const { base } = fresh()
    const code = (r) => [r.ok, r.error]
    assert.deepEqual(code(base.create('contact', {})), [false, 'missing_field'])
    assert.deepEqual(code(base.create('contact', { name: '' })), [false, 'bad_field'])
    assert.deepEqual(code(base.create('contact', { name: 'x', kind: 'robot' })), [false, 'bad_field'])
    assert.deepEqual(code(base.create('contact', { name: 'x', colour: 'red' })), [false, 'unknown_field'])
    assert.deepEqual(code(base.create('contact', { name: 'x', demo: true })), [false, 'unknown_field'], 'demo is set by the seed, never by a caller')
    assert.deepEqual(code(base.create('contact', { name: 'x', tags: new Array(21).fill('t') })), [false, 'bad_field'])
    assert.deepEqual(code(base.create('contact', { name: 'x', fields: { big: 'x'.repeat(17000) } })), [false, 'bad_field'])
    assert.deepEqual(code(base.create('contact', { name: 'x', type: 'Not A Key' })), [false, 'bad_field'])
    assert.deepEqual(code(base.create('contact', 'text')), [false, 'bad_field'])
    assert.deepEqual(code(base.create('nope', { name: 'x' })), [false, 'unknown_table'])
    assert.deepEqual(code(base.create('contact', { name: 'x' }, { actor: 'robot' })), [false, 'bad_actor'])
    assert.deepEqual(code(base.update('contact', 999, { name: 'y' })), [false, 'not_found'])
    assert.deepEqual(code(base.update('contact', 1.5, { name: 'y' })), [false, 'bad_id'])
    assert.deepEqual(code(base.get('contact', 999)), [false, 'not_found'])
    assert.deepEqual(code(base.update('contact', 1, {})), [false, 'missing_field'])
    assert.deepEqual(code(base.list('contact', { type: { $ne: 1 } })), [false, 'bad_field'])
    base.close()
  })

  await ok('a person belongs to a company; a company belongs to nothing; nobody is their own company', () => {
    const { base } = fresh()
    const co = base.create('contact', { kind: 'company', name: 'Acme' }).row
    const p = base.create('contact', { name: 'Ada' }).row
    const q = base.create('contact', { name: 'Bob' }).row
    assert.equal(base.create('contact', { name: 'Cy', company_id: co.id }).ok, true)
    assert.equal(base.create('contact', { name: 'Di', company_id: p.id }).error, 'bad_field', 'a person is not a company')
    assert.equal(base.create('contact', { name: 'Ed', company_id: 999 }).error, 'bad_ref')
    assert.equal(base.create('contact', { kind: 'company', name: 'Sub', company_id: co.id }).error, 'bad_field')
    assert.equal(base.update('contact', co.id, { company_id: co.id }).error, 'bad_field')
    assert.equal(base.update('contact', q.id, { kind: 'company' }).ok, true, 'a person without company can become a company')
    base.close()
  })

  await ok('notes hang on a contact, go with it, and are never edited', () => {
    const { base } = fresh()
    const p = base.create('contact', { name: 'Ada' }).row
    const n = base.create('note', { contact_id: p.id, body: 'Call back Friday' }, { actor: 'agent' }).row
    assert.equal(n.actor, 'agent')
    assert.equal(base.list('note', { contact_id: p.id }).total, 1)
    assert.equal(base.update('note', n.id, { body: 'x' }).error, 'not_allowed')
    assert.equal(base.archive('note', n.id).error, 'not_allowed')
    assert.equal(base.create('note', { contact_id: p.id, body: '' }).error, 'bad_field')
    base.close()
    const raw = createBusinessBase({ file: base.file() })
    assert.equal(raw.list('note').total, 1)
    raw.close()
  })

  await ok('items and cards: positions follow, a move is journalled and stamps the stage entry, links survive their targets', () => {
    const { file, base } = fresh()
    const it = base.create('item', { type: 'product', title: 'Mug', status: 'live', price_text: '€28', price_num: 28, fields: { sku: 'FC-1' } }).row
    const ada = base.create('contact', { name: 'Ada' }).row
    const a = base.create('flow_card', { flow: 'orders', stage: 'new', title: '#1 Ada', value_num: 28, contact_id: ada.id, item_id: it.id }).row
    const b = base.create('flow_card', { flow: 'orders', stage: 'new', title: '#2 Bob' }).row
    assert.deepEqual([a.position, b.position], [0, 1])
    assert.equal(base.create('flow_card', { flow: 'orders', stage: 'paid', title: '#3' }).row.position, 0, 'a position counts per column')
    const moved = base.update('flow_card', a.id, { stage: 'paid' }).row
    assert.equal(moved.stage, 'paid')
    assert.ok(moved.entered_stage_at >= a.entered_stage_at)
    assert.equal(base.update('flow_card', a.id, { title: '#1 Ada B.' }).row.entered_stage_at, moved.entered_stage_at, 'a rename is not a move')
    assert.deepEqual(base.list('flow_card', { flow: 'orders', stage: 'paid' }).rows.map((c) => c.title), ['#3', '#1 Ada B.'])
    assert.equal(base.list('flow_card', { contact_id: ada.id }).total, 1)
    assert.equal(base.list('item', { status: 'live', q: 'mug' }).total, 1)
    assert.equal(base.update('item', it.id, { price_num: 1e13 }).error, 'bad_field')
    base.close()
    assert.ok(changes(file).some((c) => c.action === 'move' && /new → paid/.test(c.summary)))
    peek(file, (db) => db.exec('PRAGMA foreign_keys = ON'))
    const raw = new DatabaseSync(file)
    raw.exec('PRAGMA foreign_keys = ON')
    raw.prepare('DELETE FROM item WHERE id = ?').run(it.id)
    assert.equal(raw.prepare('SELECT item_id FROM flow_card WHERE id = ?').get(a.id).item_id, null, 'a card keeps living when its item goes')
    raw.close()
  })

  // ── the sample rows ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const DEMO = () => ({
    contacts: [
      { ref: 'acme', kind: 'company', name: 'Cafe Bleu', type: 'customer' },
      { ref: 'lea', name: 'Lea Moreau', type: 'customer', company_ref: 'acme', email: 'lea@example.test' },
    ],
    items: [{ ref: 'mug', type: 'product', title: 'Stoneware mug', status: 'live', price_text: '€28', price_num: 28 }],
    cards: [{ flow: 'orders', stage: 'new', title: '#1046 Lea', value_num: 28, contact_ref: 'lea', item_ref: 'mug' }, { flow: 'orders', stage: 'new', title: '#1047' }],
    notes: [{ contact_ref: 'lea', body: 'Wants wholesale prices.' }],
  })

  await ok('the sample rows are all marked demo, point at one another, and the same theme seeds once', () => {
    const { file, base } = fresh()
    const r = base.seed(DEMO(), { theme: 'ecommerce' })
    assert.deepEqual([r.ok, r.skipped, r.counts], [true, false, { contacts: 2, items: 1, cards: 2, notes: 1 }])
    const lea = base.list('contact', { q: 'lea' }).rows[0]
    assert.equal(lea.demo, true)
    assert.equal(base.get('contact', lea.company_id).row.name, 'Cafe Bleu')
    const card = base.list('flow_card', { q: '1046' }).rows[0]
    assert.deepEqual([card.contact_id, card.demo], [lea.id, true])
    assert.deepEqual(base.list('flow_card', { stage: 'new' }).rows.map((c) => c.position), [0, 1])
    assert.deepEqual(base.counts().demo, { contact: 2, note: 1, item: 1, flow_card: 2 })
    assert.deepEqual(base.seed(DEMO(), { theme: 'ecommerce' }), { ok: true, skipped: true, theme: 'ecommerce' }, 'the second call adds nothing')
    assert.equal(base.counts().tables.contact, 2)
    assert.equal(base.seed({ contacts: [{ name: 'Tom' }] }, { theme: 'realestate' }).skipped, false, 'another theme seeds its own rows')
    assert.deepEqual(JSON.parse(peek(file, (db) => db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get().value)), ['ecommerce', 'realestate'])
    base.close()
    assert.deepEqual(changes(file).filter((c) => c.action === 'seed').map((c) => [c.actor, c.summary.split(':')[0]]), [['seed', 'ecommerce'], ['seed', 'realestate']])
  })

  await ok('a bad sample row leaves nothing behind, and the theme is not marked as seeded', () => {
    const { file, base } = fresh()
    const data = DEMO()
    data.cards[1].contact_ref = 'nobody'
    const r = base.seed(data, { theme: 'ecommerce' })
    assert.deepEqual([r.ok, r.error], [false, 'bad_ref'])
    assert.equal(base.seed({ contacts: [{ name: 'x', colour: 'red' }] }, { theme: 'ecommerce' }).error, 'unknown_field')
    assert.equal(base.seed({ notes: [{ body: 'x' }] }, { theme: 'ecommerce' }).error, 'missing_field')
    assert.equal(base.seed({}, { theme: 'Not A Theme!' }).error, 'bad_field')
    assert.equal(base.seed({ contacts: new Array(501).fill({ name: 'x' }) }, { theme: 'ecommerce' }).error, 'bad_field')
    assert.deepEqual(base.counts().tables, { contact: 0, note: 0, item: 0, flow_card: 0 })
    assert.equal(base.seed(DEMO(), { theme: 'ecommerce' }).ok, true, 'the fixed data now seeds')
    base.close()
    assert.equal(changes(file).filter((c) => c.action === 'seed').length, 1)
  })

  await ok('clearing the sample rows keeps what the person made, and lets the theme seed again', () => {
    const { base } = fresh()
    base.seed(DEMO(), { theme: 'ecommerce' })
    const mine = base.create('contact', { name: 'My own client' }).row
    base.create('note', { contact_id: mine.id, body: 'real note' })
    const r = base.clearDemo()
    assert.deepEqual(r, { ok: true, removed: { note: 1, flow_card: 2, item: 1, contact: 2 }, scope: null }, 'no template is active: every sample goes')
    assert.deepEqual(base.counts().tables, { contact: 1, note: 1, item: 0, flow_card: 0 })
    assert.equal(base.seed(DEMO(), { theme: 'ecommerce' }).skipped, false)
    base.close()
  })

  // ── export and delete ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('export gives everything as plain data, journal and markers included, and says that it happened', () => {
    const { file, base } = fresh()
    base.seed(DEMO(), { theme: 'ecommerce' })
    base.create('contact', { name: 'Ada', tags: ['a'] })
    const e = base.exportAll({ actor: 'person' })
    assert.deepEqual([e.ok, e.format, e.schema_version], [true, 1, SCHEMA_VERSION])
    assert.deepEqual(Object.keys(e.tables).sort(), ['changes', 'contact', 'flow_card', 'item', 'meta', 'note'])
    assert.equal(e.tables.contact.length, 3)
    assert.deepEqual(e.tables.contact.find((c) => c.name === 'Ada').tags, ['a'], 'JSON columns come out as data')
    assert.ok(e.tables.changes.length >= 2)
    JSON.stringify(e)
    base.close()
    assert.equal(changes(file).at(-1).action, 'export', 'the export is in the journal, after the data it exported')
  })

  await ok('delete-all needs a confirmation, empties every table, keeps the schema, and leaves one trace', () => {
    const { file, base } = fresh()
    base.seed(DEMO(), { theme: 'ecommerce' })
    base.create('contact', { name: 'Ada' })
    assert.equal(base.deleteAll().error, 'confirm_required')
    assert.equal(base.deleteAll({ confirm: 'yes' }).error, 'confirm_required')
    assert.equal(base.counts().tables.contact, 3, 'nothing was deleted without the confirmation')
    const r = base.deleteAll({ confirm: true, actor: 'person' })
    assert.equal(r.ok, true)
    assert.deepEqual(r.removed, { note: 1, flow_card: 2, item: 1, contact: 3, changes: r.removed.changes })
    assert.deepEqual(base.counts().tables, { contact: 0, note: 0, item: 0, flow_card: 0 })
    base.close()
    assert.deepEqual(names(file), ['changes', 'contact', 'flow_card', 'item', 'meta', 'note', 'pack'])
    peek(file, (db) => {
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION)
      assert.equal(db.prepare('SELECT COUNT(*) n FROM pack').get().n, 1)
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get().value, '[]')
    })
    assert.deepEqual(changes(file).map((c) => [c.action, c.actor]), [['purge', 'person']])
    const wal = file + '-wal'
    assert.ok(!existsSync(wal) || statSync(wal).size === 0, 'nothing is left in the write-ahead log')
    const bytes = readFileSync(file)
    assert.equal(bytes.includes(Buffer.from('Ada')), false, 'the name is gone from the file itself')
    assert.equal(bytes.includes(Buffer.from('lea@example.test')), false)
  })

  // ── a base that never throws into DSH ──────────────────────────────────────────────────────────────────────────────────────────
  await ok('a Node without node:sqlite: every question answers, nothing throws, nothing is created', () => {
    const { dir, file } = fresh()
    const base = createBusinessBase({ file, sqlite: null })
    assert.deepEqual([base.status().ok, base.status().available], [true, false])
    for (const r of [base.open(), base.create('contact', { name: 'x' }), base.list('contact'), base.counts(), base.exportAll(), base.seed({}, { theme: 'x' })]) {
      assert.deepEqual([r.ok, r.error], [false, 'sqlite_unavailable'])
    }
    assert.equal(existsSync(dir), false)
  })

  await ok('a folder that cannot be written, a file that cannot be read, a file that is not a database: answers, never throws', () => {
    if (!isRoot) {
      const { dir, file, base } = fresh()
      mkdirSync(dir, { recursive: true })
      chmodSync(dir, 0o500)
      const r = base.open()
      assert.deepEqual([r.ok, r.error], [false, 'cannot_open'])
      assert.equal(base.create('contact', { name: 'x' }).error, 'cannot_open')
      assert.equal(existsSync(file), false)
      chmodSync(dir, 0o700)

      const two = fresh()
      assert.equal(two.base.open().ok, true)
      two.base.close()
      chmodSync(two.file, 0o000)
      const base2 = createBusinessBase({ file: two.file })
      assert.equal(base2.open().ok, false, 'unreadable')
      assert.equal(base2.list('contact').ok, false)
      chmodSync(two.file, 0o600)
    }
    const junk = fresh()
    mkdirSync(join(junk.dir, 'business'), { recursive: true })
    writeFileSync(junk.file, 'this is not a database, it is a text file '.repeat(200))
    const j = junk.base.open()
    assert.deepEqual([j.ok, j.error], [false, 'not_a_database'])
    assert.equal(readFileSync(junk.file, 'utf8').startsWith('this is not'), true, 'the file was not overwritten')
    const notADir = fresh()
    mkdirSync(notADir.dir, { recursive: true })
    writeFileSync(join(notADir.dir, 'business'), 'a file where the folder should be')
    assert.equal(notADir.base.open().error, 'cannot_open')
  })

  await ok('a file deleted while the process runs is created again, never written into a ghost', () => {
    const { file, base } = fresh()
    base.create('contact', { name: 'Before' })
    rmSync(file); rmSync(file + '-wal', { force: true }); rmSync(file + '-shm', { force: true })
    assert.equal(base.create('contact', { name: 'After' }).ok, true)
    assert.deepEqual(base.list('contact').rows.map((c) => c.name), ['After'])
    assert.equal(existsSync(file), true)
    base.close()
  })

  await ok('the actors are the four the journal knows', () => {
    assert.deepEqual([...ACTORS], ['person', 'agent', 'theme', 'seed'])
    assert.deepEqual([...TABLES], ['contact', 'note', 'item', 'flow_card'])
  })

  // ── two processes, one file ────────────────────────────────────────────────────────────────────────────────────────────────────
  const child = (script, env = {}) => new Promise((resolve) => {
    const p = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const waiters = []
    p.stdout.on('data', (d) => { out += d; for (const w of waiters.splice(0)) w() })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => resolve({ code, out, err, kill: () => p.kill() }))
    child.last = { get out () { return out }, waitFor: (re) => new Promise((res) => { const check = () => (re.test(out) ? res() : waiters.push(check)); check() }) }
  })

  await ok('two processes migrate and write the same new file at once: no error, no row lost', async () => {
    const { file } = fresh()
    const writer = (tag) => `
      import { createBusinessBase } from ${JSON.stringify(pathToFileURL(MODULE).href)}
      const base = createBusinessBase({ file: ${JSON.stringify(file)} })
      let errors = 0
      const c = base.create('contact', { name: 'owner of ${tag}' })
      if (!c.ok) { errors += 1; console.log(JSON.stringify(c)) }
      for (let i = 0; i < 150; i += 1) { const r = base.create('note', { contact_id: c.row ? c.row.id : 1, body: '${tag} ' + i }); if (!r.ok) { errors += 1; console.log(JSON.stringify(r)) } }
      console.log('DONE ' + errors)
      base.close()`
    const [a, b] = await Promise.all([child(writer('A')), child(writer('B'))])
    assert.deepEqual([a.code, b.code], [0, 0], a.err + b.err)
    assert.match(a.out, /DONE 0\s*$/, a.out)
    assert.match(b.out, /DONE 0\s*$/, b.out)
    peek(file, (db) => {
      assert.equal(db.prepare('SELECT COUNT(*) n FROM note').get().n, 300)
      assert.equal(db.prepare('SELECT COUNT(*) n FROM contact').get().n, 2)
      assert.equal(db.prepare('SELECT COUNT(*) n FROM changes').get().n, 302, 'one journal line per write, none lost')
      assert.equal(db.prepare('SELECT COUNT(*) n FROM pack').get().n, 1)
    })
  })

  await ok('a write waits for another process holding the lock (busy_timeout), it does not fail', async () => {
    const { file, base } = fresh()
    base.open()
    const holder = child(`
      import { DatabaseSync } from 'node:sqlite'
      const db = new DatabaseSync(${JSON.stringify(file)})
      db.exec('BEGIN IMMEDIATE')
      console.log('LOCKED')
      await new Promise((r) => setTimeout(r, 700))
      db.exec('COMMIT')
      db.close()`)
    await child.last.waitFor(/LOCKED/)
    const t0 = Date.now()
    const r = base.create('contact', { name: 'Waited' })
    const waited = Date.now() - t0
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.ok(waited >= 300, 'it really waited for the other writer (' + waited + ' ms)')
    assert.equal((await holder).code, 0)
    base.close()
  })

  // ── what DSH loads ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('the core mounts the seam inside its own try/catch, and no module of the core imports node:sqlite at load time', () => {
    const index = readFileSync(join(here, 'index.js'), 'utf8')
    assert.match(index, /import \{[^}]*\bensureBusiness\b[^}]*\} from '\.\/business-base\.mjs'/)
    assert.match(index, /try \{\s*ensureBusiness\(\)\s*\} catch \(e\) \{/, 'published inside a try/catch')
    const mod = readFileSync(MODULE, 'utf8')
    assert.doesNotMatch(mod, /from 'node:sqlite'/, 'loaded lazily: a Node without it must not stop the core from loading')
    assert.doesNotMatch(mod, /\/Users\//, 'no personal path')
  })
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('\n' + count + ' checks passed')
