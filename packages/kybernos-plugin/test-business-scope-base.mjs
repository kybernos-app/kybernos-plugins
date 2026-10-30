// One template at a time, in the shared base (business-base.mjs, schema 2): every row carries the scope of the template it belongs to, a question is about
// the ACTIVE template's rows, a new row takes the active scope, the sample rows of a base written before the scope existed go back to the theme that
// seeded them, and nothing of it throws into DSH.
//
// The old base is built here as the schema-1 code left it (the DDL below is the shipped one, word for word), so the migration is played on a real shape:
// two seeds, rows the person made between them, a clear-demo before the last seed, a base that does not add up, a column already there.
//
// Hermetic: temp folders only. The migration of a COPY of the owner's real base is played by hand (docs/dev/business-visuals.md), never from here.
//
//   node packages/kybernos-plugin/test-business-scope-base.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_VERSION, createBusinessBase } from './business-base.mjs'
import { BUSINESS_POINTS, activeFileFor, writeActive } from './business-scope.mjs'

const MODULE = fileURLToPath(new URL('./business-base.mjs', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'kb-scope-base-'))
let count = 0
let no = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
const SHOP = 'kybernos-themes/ecommerce'
const HOUSE = 'kybernos-themes/real-estate'

/** The schema-1 DDL, as it shipped. */
const SQL_V1 = `
CREATE TABLE IF NOT EXISTS contact (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'company')),
  type TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  email TEXT NOT NULL DEFAULT '' CHECK (length(email) <= 254),
  company_id INTEGER REFERENCES contact(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(fields) AND json_type(fields) = 'object'),
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS note (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  actor TEXT NOT NULL DEFAULT 'person' CHECK (actor IN ('person', 'agent', 'theme', 'seed')),
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS item (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  subtitle TEXT NOT NULL DEFAULT '' CHECK (length(subtitle) <= 200),
  status TEXT NOT NULL DEFAULT '',
  price_text TEXT NOT NULL DEFAULT '' CHECK (length(price_text) <= 60),
  price_num REAL,
  fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(fields) AND json_type(fields) = 'object'),
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS flow_card (
  id INTEGER PRIMARY KEY,
  flow TEXT NOT NULL,
  stage TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  subtitle TEXT NOT NULL DEFAULT '' CHECK (length(subtitle) <= 200),
  value_num REAL,
  contact_id INTEGER REFERENCES contact(id) ON DELETE SET NULL,
  item_id INTEGER REFERENCES item(id) ON DELETE SET NULL,
  fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(fields) AND json_type(fields) = 'object'),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  entered_stage_at TEXT NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('person', 'agent', 'theme', 'seed')),
  tbl TEXT NOT NULL,
  row_id INTEGER,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'move', 'archive', 'restore', 'seed', 'clear-demo', 'export', 'purge')),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 300)
);
CREATE TABLE IF NOT EXISTS pack (id INTEGER PRIMARY KEY, contenu TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS contact_type ON contact(type);
CREATE INDEX IF NOT EXISTS contact_company ON contact(company_id);
CREATE INDEX IF NOT EXISTS note_contact ON note(contact_id);
CREATE INDEX IF NOT EXISTS item_type_status ON item(type, status);
CREATE INDEX IF NOT EXISTS flow_card_stage ON flow_card(flow, stage, position);
CREATE INDEX IF NOT EXISTS flow_card_contact ON flow_card(contact_id);
CREATE INDEX IF NOT EXISTS flow_card_item ON flow_card(item_id);
CREATE INDEX IF NOT EXISTS changes_ts ON changes(ts);
`
const peek = (file, fn) => { const db = new DatabaseSync(file, { readOnly: true }); try { return fn(db) } finally { db.close() } }
const NOW = '2026-10-29T10:00:00.000Z'

/** A base file as the schema-1 code left it, then `fill(old)` puts rows in it the way the old seed, create and clear-demo did. */
const oldBase = (fill) => {
  const file = join(root, 'old-' + (++no), 'business', 'donnees.sqlite')
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('BEGIN IMMEDIATE')
  db.exec(SQL_V1)
  db.prepare('INSERT INTO pack (contenu) VALUES (?)').run('{"version":1}')
  db.prepare("INSERT INTO meta (key, value) VALUES ('created_at', ?), ('seeded', '[]'), ('schema_version', '1')").run(NOW)
  db.exec('PRAGMA user_version = 1')
  db.exec('COMMIT')
  const old = {
    db,
    /** What the old seed did: its rows in one transaction, `demo = 1`, one journal line, the theme in `seeded`. */
    seed (theme, n) {
      db.exec('BEGIN IMMEDIATE')
      const contact = db.prepare("INSERT INTO contact (name, demo, created_at, updated_at) VALUES (?, 1, ?, ?)")
      const item = db.prepare("INSERT INTO item (title, demo, created_at, updated_at) VALUES (?, 1, ?, ?)")
      const card = db.prepare("INSERT INTO flow_card (flow, stage, title, demo, entered_stage_at) VALUES ('f', 's', ?, 1, ?)")
      const note = db.prepare("INSERT INTO note (contact_id, body, actor, demo, created_at) VALUES (?, ?, 'seed', 1, ?)")
      const firstContact = Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM contact').get().m) + 1
      for (let i = 0; i < n.contacts; i += 1) contact.run(theme + ' contact ' + i, NOW, NOW)
      for (let i = 0; i < n.items; i += 1) item.run(theme + ' item ' + i, NOW, NOW)
      for (let i = 0; i < n.cards; i += 1) card.run(theme + ' card ' + i, NOW)
      for (let i = 0; i < n.notes; i += 1) note.run(firstContact, theme + ' note ' + i, NOW)
      const seeded = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get().value)
      db.prepare("UPDATE meta SET value = ? WHERE key = 'seeded'").run(JSON.stringify(seeded.concat([theme])))
      db.prepare("INSERT INTO changes (ts, actor, tbl, action, summary) VALUES (?, 'theme', 'meta', 'seed', ?)").run(NOW, theme + ': ' + n.contacts + ' contacts, ' + n.items + ' items, ' + n.cards + ' cards, ' + n.notes + ' notes')
      db.exec('COMMIT')
    },
    /** A row the person made. */
    person (table, title) {
      if (table === 'contact') db.prepare('INSERT INTO contact (name, created_at, updated_at) VALUES (?, ?, ?)').run(title, NOW, NOW)
      else if (table === 'item') db.prepare('INSERT INTO item (title, created_at, updated_at) VALUES (?, ?, ?)').run(title, NOW, NOW)
      else db.prepare("INSERT INTO flow_card (flow, stage, title, entered_stage_at) VALUES ('f', 's', ?, ?)").run(title, NOW)
    },
    /** What the old clear-demo did: every sample row, everywhere. */
    clear () {
      db.exec('BEGIN IMMEDIATE')
      const removed = []
      for (const t of ['note', 'flow_card', 'item', 'contact']) removed.push(db.prepare('DELETE FROM ' + t + ' WHERE demo = 1').run().changes + ' ' + t)
      db.prepare("UPDATE meta SET value = '[]' WHERE key = 'seeded'").run()
      db.prepare("INSERT INTO changes (ts, actor, tbl, action, summary) VALUES (?, 'person', 'meta', 'clear-demo', ?)").run(NOW, removed.join(', '))
      db.exec('COMMIT')
    },
  }
  fill(old)
  db.close()
  return file
}
const A = { contacts: 3, items: 2, cards: 2, notes: 1 }
const B = { contacts: 2, items: 3, cards: 1, notes: 2 }
const tally = (file, table) => peek(file, (db) => Object.fromEntries(db.prepare('SELECT scope, COUNT(*) AS n FROM ' + table + ' GROUP BY scope').all().map((r) => [r.scope, Number(r.n)])))
const journal = (file) => peek(file, (db) => db.prepare('SELECT action, summary FROM changes ORDER BY id').all().map((r) => [r.action, r.summary]))
const scopeNames = (file) => peek(file, (db) => ['contact', 'note', 'item', 'flow_card'].map((t) => db.prepare('PRAGMA table_info(' + t + ')').all().filter((c) => c.name === 'scope').length))

try {
  // ── the migration ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  await ok('a fresh base is at schema 2 with a scope column and an index on each of the four tables, and nothing written about a migration', () => {
    const file = join(root, 'fresh', 'business', 'donnees.sqlite')
    const base = createBusinessBase({ file, scope: () => null })
    assert.equal(base.open().version, SCHEMA_VERSION)
    assert.equal(SCHEMA_VERSION, 2)
    base.close()
    assert.deepEqual(scopeNames(file), [1, 1, 1, 1])
    peek(file, (db) => {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%_scope' ORDER BY name").all().map((r) => r.name)
      assert.deepEqual(idx, ['contact_scope', 'flow_card_scope', 'item_scope', 'note_scope'])
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key = 'scope_migration'").get().n, 0)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM changes').get().n, 0)
    })
  })

  await ok('a schema-1 base: the sample rows go back to the theme that seeded them (by the journal, person rows interleaved), the rest stays unscoped; run again, nothing moves', () => {
    const file = oldBase((old) => {
      old.seed(HOUSE, A)
      old.person('contact', 'Ada, made by hand')
      old.person('item', 'A mug, made by hand')
      old.seed(SHOP, B)
      old.person('contact', 'Grace, made by hand')
    })
    const base = createBusinessBase({ file, scope: () => null })
    assert.equal(base.open().version, 2)
    base.close()
    assert.deepEqual(tally(file, 'contact'), { '': 2, [HOUSE]: 3, [SHOP]: 2 })
    assert.deepEqual(tally(file, 'item'), { '': 1, [HOUSE]: 2, [SHOP]: 3 })
    assert.deepEqual(tally(file, 'flow_card'), { [HOUSE]: 2, [SHOP]: 1 })
    assert.deepEqual(tally(file, 'note'), { [HOUSE]: 1, [SHOP]: 2 })
    peek(file, (db) => {
      const names = db.prepare("SELECT name FROM contact WHERE scope = ? ORDER BY id").all(SHOP).map((r) => r.name)
      assert.deepEqual(names, [SHOP + ' contact 0', SHOP + ' contact 1'], 'the right rows, not only the right number')
      assert.deepEqual(db.prepare('SELECT n.body FROM note n WHERE n.scope = ? ORDER BY n.id').all(HOUSE).map((r) => r.body), [HOUSE + ' note 0'])
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2)
      assert.equal(JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'scope_migration'").get().value).attributed.contact, 5)
    })
    const lines = journal(file).filter(([a]) => a === 'update')
    assert.equal(lines.length, 1)
    assert.match(lines[0][1], /^scope: 16 sample rows given to the theme that seeded them$/)
    // again: a second open, and a second base object, change nothing
    const before = JSON.stringify([tally(file, 'contact'), tally(file, 'item'), journal(file)])
    for (let i = 0; i < 2; i += 1) { const again = createBusinessBase({ file, scope: () => null }); assert.equal(again.open().ok, true); again.close() }
    assert.equal(JSON.stringify([tally(file, 'contact'), tally(file, 'item'), journal(file)]), before)
  })

  await ok('only the seeds after the last clear-demo count: a theme seeded, cleared and another seeded leaves the second one\'s rows to the second', () => {
    const file = oldBase((old) => { old.seed(HOUSE, A); old.clear(); old.seed(SHOP, B) })
    const base = createBusinessBase({ file, scope: () => null }); base.open(); base.close()
    assert.deepEqual(tally(file, 'contact'), { [SHOP]: 2 })
    assert.deepEqual(tally(file, 'item'), { [SHOP]: 3 })
  })

  await ok('a table whose sample rows do not add up to the journal is left unscoped, and the active template adopts them at the next question (with a journal line, once)', () => {
    const file = oldBase((old) => { old.seed(HOUSE, A); old.seed(SHOP, B); old.db.prepare("DELETE FROM item WHERE title = ?").run(HOUSE + ' item 1') })
    let scope = null
    const base = createBusinessBase({ file, scope: () => scope })
    assert.equal(base.open().ok, true)
    assert.deepEqual(tally(file, 'contact'), { [HOUSE]: 3, [SHOP]: 2 }, 'the table that adds up is attributed')
    assert.deepEqual(tally(file, 'item'), { '': 4 }, 'the one that does not is left alone')
    scope = SHOP
    assert.equal(base.list('item').total, 4, 'the active template owns what belonged to none')
    assert.deepEqual(tally(file, 'item'), { [SHOP]: 4 })
    assert.equal(journal(file).filter(([a, s]) => a === 'update' && /adopted by/.test(s)).length, 1)
    assert.match(journal(file).at(-1)[1], /^scope: 4 item adopted by kybernos-themes\/ecommerce$/)
    base.list('item'); base.counts()
    assert.equal(journal(file).filter(([a, s]) => a === 'update' && /adopted by/.test(s)).length, 1, 'once')
    base.close()
  })

  await ok('a column that is already there (a migration that stopped half way) is not added again, and the rest is finished', () => {
    const file = oldBase((old) => {
      old.seed(HOUSE, A)
      old.db.exec("ALTER TABLE contact ADD COLUMN scope TEXT NOT NULL DEFAULT '' CHECK (length(scope) <= 61)")
    })
    const base = createBusinessBase({ file, scope: () => null })
    assert.equal(base.open().ok, true)
    base.close()
    assert.deepEqual(scopeNames(file), [1, 1, 1, 1])
    assert.deepEqual(tally(file, 'contact'), { [HOUSE]: 3 })
  })

  await ok('two processes open the same schema-1 file at once: both succeed, the column is added once, the rows are attributed once', async () => {
    const file = oldBase((old) => { old.seed(HOUSE, A); old.seed(SHOP, B) })
    const code = `import { createBusinessBase } from ${JSON.stringify('file://' + MODULE)}
      const b = createBusinessBase({ file: ${JSON.stringify(file)}, scope: () => null })
      const r = b.open()
      console.log(r.ok === true ? 'OPEN' : 'FAIL ' + JSON.stringify(r))
      b.close()`
    const run = () => new Promise((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { out += d })
      child.on('close', (c) => resolve({ code: c, out }))
    })
    const [one, two] = await Promise.all([run(), run()])
    assert.deepEqual([one.code, two.code], [0, 0], one.out + two.out)
    assert.match(one.out + two.out, /OPEN[\s\S]*OPEN/)
    assert.deepEqual(scopeNames(file), [1, 1, 1, 1])
    assert.deepEqual(tally(file, 'contact'), { [HOUSE]: 3, [SHOP]: 2 })
    assert.equal(journal(file).filter(([a]) => a === 'update').length, 1)
  })

  // ── the questions ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const seeded = () => {
    let scope = null
    const file = join(root, 'q-' + (++no), 'business', 'donnees.sqlite')
    const base = createBusinessBase({ file, scope: () => scope })
    const data = (t, n) => ({
      contacts: Array.from({ length: n }, (_, i) => ({ ref: 'c' + i, name: t + ' person ' + i })),
      items: Array.from({ length: n }, (_, i) => ({ ref: 'i' + i, title: t + ' item ' + i, type: 'kind-' + t.slice(-4) })),
      cards: Array.from({ length: n }, (_, i) => ({ flow: 'board-' + t.slice(-4), stage: 'new', title: t + ' card ' + i, contact_ref: 'c' + i, item_ref: 'i' + i })),
      notes: [{ contact_ref: 'c0', body: t + ' note' }],
    })
    assert.equal(base.seed(data(SHOP, 3), { theme: SHOP }).ok, true)
    assert.equal(base.seed(data(HOUSE, 2), { theme: HOUSE }).ok, true)
    return { file, base, set: (s) => { scope = s } }
  }

  await ok('a question is about the active template\'s rows: list, counts and the filters follow it; none active means every row, as before', () => {
    const { base, set } = seeded()
    assert.equal(base.list('item').total, 5, 'no template: everything')
    set(SHOP)
    assert.equal(base.list('item').total, 3)
    assert.equal(base.list('contact').total, 3)
    assert.equal(base.list('flow_card').total, 3)
    assert.equal(base.list('note').total, 1)
    assert.deepEqual(base.list('item').rows.map((r) => r.scope), [SHOP, SHOP, SHOP])
    assert.equal(base.list('item', { type: 'kind-e-co' }).total, 0, 'a filter AND the scope')
    assert.equal(base.list('item', { q: 'person' }).total, 0)
    assert.equal(base.list('contact', { q: 'person' }).total, 3)
    set(HOUSE)
    assert.deepEqual([base.list('item').total, base.list('contact').total, base.list('flow_card').total, base.list('note').total], [2, 2, 2, 1])
    assert.deepEqual(base.list('contact', { demo: true }).rows.map((r) => r.name).sort(), [HOUSE + ' person 0', HOUSE + ' person 1'])
    const c = base.counts()
    assert.deepEqual([c.ok, c.scope, c.tables, c.demo], [true, HOUSE, { contact: 2, note: 1, item: 2, flow_card: 2 }, { contact: 2, note: 1, item: 2, flow_card: 2 }])
    set(null)
    assert.deepEqual(base.counts().tables, { contact: 5, note: 2, item: 5, flow_card: 5 })
    assert.equal(base.counts().scope, null)
  })

  await ok('a question can name its scope: a template id, "*" for every one, "" for the rows of none; anything else is refused', () => {
    const { base, set } = seeded()
    set(SHOP)
    assert.equal(base.list('item', { scope: HOUSE }).total, 2)
    assert.equal(base.list('item', { scope: '*' }).total, 5)
    assert.equal(base.list('item', { scope: '' }).total, 0)
    assert.equal(base.counts({ scope: '*' }).tables.item, 5)
    assert.equal(base.counts({ scope: HOUSE }).tables.item, 2)
    for (const bad of ['../x', 'UPPER', 5, null, {}]) {
      const r = base.list('item', { scope: bad })
      assert.deepEqual([r.ok, r.error], [false, 'bad_field'], JSON.stringify(bad))
    }
  })

  await ok('a new row takes the active scope; a note takes its contact\'s; the scope is not a field anyone can write', () => {
    const { base, set } = seeded()
    set(HOUSE)
    const c = base.create('contact', { name: 'Made in the agency' })
    assert.equal(c.row.scope, HOUSE)
    const i = base.create('item', { title: 'A flat' })
    const k = base.create('flow_card', { flow: 'sales', stage: 'new', title: 'A deal' })
    assert.deepEqual([i.row.scope, k.row.scope], [HOUSE, HOUSE])
    set(SHOP)
    const shopContact = base.list('contact').rows[0]
    set(HOUSE) // the person is looking at the agency, an agent writes a note on a shop customer by id: the note stays with the customer
    const n = base.create('note', { contact_id: shopContact.id, body: 'called back' })
    assert.equal(n.row.scope, SHOP)
    assert.equal(base.create('contact', { name: 'X', scope: SHOP }).error, 'unknown_field', 'not a column anyone writes')
    assert.equal(base.update('contact', c.row.id, { scope: SHOP }).error, 'unknown_field')
    assert.equal(base.update('contact', c.row.id, { name: 'Renamed' }).row.scope, HOUSE, 'an update keeps the scope')
    assert.equal(base.create('item', { title: 'Explicit' }, { scope: SHOP }).row.scope, SHOP, 'the host can name the scope of a write')
    assert.equal(base.create('item', { title: 'None' }, { scope: '' }).row.scope, '')
    assert.equal(base.get('contact', shopContact.id).row.scope, SHOP, 'a row of another template can still be read by its id')
    set(null)
    assert.equal(base.create('contact', { name: 'No template yet' }).row.scope, '')
  })

  await ok('rows made while no template was active join the first one that is, at the next question', () => {
    const { file, base, set } = seeded()
    base.create('contact', { name: 'Before any template' })
    assert.equal(base.list('contact', { scope: '' }).total, 1)
    set(HOUSE)
    assert.equal(base.list('contact').total, 3, 'the two samples and the one made by hand')
    assert.deepEqual(tally(file, 'contact'), { [SHOP]: 3, [HOUSE]: 3 })
    set(SHOP)
    assert.equal(base.list('contact').total, 3, 'and not the other template\'s')
  })

  await ok('clearing the sample data clears the active template\'s only, lets that theme seed again, and keeps what the person made', () => {
    const { file, base, set } = seeded()
    set(SHOP)
    base.create('contact', { name: 'My own customer' })
    const r = base.clearDemo()
    assert.deepEqual([r.ok, r.scope, r.removed], [true, SHOP, { note: 1, flow_card: 3, item: 3, contact: 3 }])
    assert.equal(base.list('contact').total, 1, 'the person\'s customer stays')
    set(HOUSE)
    assert.deepEqual([base.list('contact').total, base.list('item').total], [2, 2], 'the agency\'s samples are untouched')
    peek(file, (db) => assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get().value, JSON.stringify([HOUSE])))
    assert.match(journal(file).at(-1)[1], /\(kybernos-themes\/ecommerce\)$/)
    assert.equal(base.seed({ contacts: [{ name: 'Again' }] }, { theme: SHOP }).skipped, false, 'the cleared theme can seed again')
    assert.equal(base.seed({ contacts: [{ name: 'Again' }] }, { theme: HOUSE }).skipped, true, 'the other one is still there')
    set(null)
    assert.equal(base.clearDemo().scope, null)
    assert.deepEqual(base.counts().demo, { contact: 0, note: 0, item: 0, flow_card: 0 }, 'no template active: every sample goes, as before')
  })

  await ok('"*" clears every template\'s samples; a template id clears that one\'s, whatever is active', () => {
    const { base, set } = seeded()
    set(SHOP)
    assert.equal(base.clearDemo({ scope: HOUSE }).removed.item, 2)
    assert.equal(base.counts({ scope: '*' }).tables.item, 3)
    assert.equal(base.clearDemo({ scope: '*' }).removed.item, 3)
    assert.equal(base.counts({ scope: '*' }).tables.item, 0)
  })

  await ok('export carries the scope of every row; { scope } limits it to one template; deleting everything still deletes everything', () => {
    const { base, set } = seeded()
    set(SHOP)
    const all = base.exportAll()
    assert.equal(all.tables.item.length, 5)
    assert.deepEqual([...new Set(all.tables.item.map((r) => r.scope))].sort(), [SHOP, HOUSE])
    const one = base.exportAll({ scope: HOUSE })
    assert.deepEqual([one.tables.item.length, one.tables.contact.length], [2, 2])
    assert.equal(base.deleteAll({ confirm: true }).ok, true)
    assert.equal(base.counts({ scope: '*' }).tables.item, 0)
  })

  await ok('the seam says which template the pages follow without opening the base; a port that throws or answers garbage means none', () => {
    const file = join(root, 'q-closed', 'business', 'donnees.sqlite')
    const live = createBusinessBase({ file, scope: () => HOUSE })
    assert.deepEqual(live.scope(), { ok: true, scope: HOUSE })
    assert.equal(existsSync(dirname(file)), false, 'asking which template is active creates neither the file nor its folder')
    for (const port of [() => { throw new Error('boom') }, () => 42, () => '../x', () => undefined, () => '']) {
      assert.deepEqual(createBusinessBase({ file, scope: port }).scope(), { ok: true, scope: null })
    }
  })

  await ok('without a port the base reads the choice stored beside it through the registry seam, as DSH does', () => {
    const file = join(root, 'q-live', 'business', 'donnees.sqlite')
    const KEY = Symbol.for('kybernos.registry')
    const was = globalThis[KEY]
    try {
      const base = createBusinessBase({ file })
      assert.equal(base.scope().scope, null, 'nothing stored, no registry')
      writeActive(activeFileFor(file), HOUSE)
      assert.equal(base.scope().scope, HOUSE, 'the registry is not there yet: the stored choice stands')
      globalThis[KEY] = { version: 1, plugins: () => [], contributions: (ref) => (ref === BUSINESS_POINTS.catalog ? [{ plugin: SHOP, value: {} }] : []) }
      assert.equal(base.scope().scope, SHOP, 'the stored template is not installed any more: the installed one')
      globalThis[KEY] = { version: 1, plugins: () => [], contributions: () => [] }
      assert.equal(base.scope().scope, null, 'the registry knows no template')
      writeFileSync(join(dirname(file), 'themes.json'), JSON.stringify({ v: 1, active: HOUSE, records: [{ id: HOUSE }, { id: SHOP }] }))
      globalThis[KEY] = { version: 1, plugins: () => [], contributions: (ref) => (ref === BUSINESS_POINTS.catalog ? [{ plugin: SHOP, value: {} }, { plugin: 'x/other', value: {} }] : []) }
      writeActive(activeFileFor(file), 'x/gone')
      assert.equal(base.scope().scope, SHOP, 'two installed, the stored one gone: the latest installed one, from themes.json beside the business folder')
    } finally { if (was === undefined) delete globalThis[KEY]; else globalThis[KEY] = was }
  })
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('\n' + count + ' checks passed')
