// kybernos-db store: the SQLite file, its journal, the raw-SQL triggers, the attachments and the folder of dbs. Hermetic: every file lives in a temp folder.
//
//   node packages/kybernos-db/test-store.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { isUlid } from './core/index.mjs'
import { APPLICATION_ID, FORMAT, createDb, encodeUlid, hashOf, makeUlid, openBlobs, openDb, openRegistry, ulidTime } from './store/index.mjs'
import { columnSql, createTableSql, triggersSql } from './store/schema.mjs'
import { fromColumn, toColumn } from './store/columns.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const fx = JSON.parse(readFileSync(here + 'vectors/fixtures.json', 'utf8'))
const TASK = fx.objects.task
const NOTE = fx.objects.note
// the shared fixture's `task.project` points at a « project » object the pure fixtures do not define; the store, which checks links, needs it
const PROJECT = { key: 'project', label: 'Projects', title: 'name', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }] }
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }

const root = mkdtempSync(join(tmpdir(), 'kb-db-store-'))
let n = 0
const fresh = () => join(root, 'f' + (n++))
const clock = (start = Date.UTC(2026, 9, 30, 9, 0, 0)) => { let t = start; return { now: () => (t += 1), set: (v) => { t = v } } }
const sequence = () => { let i = 0; return (len) => { i += 1; return Uint8Array.from({ length: len }, (_, k) => (i * 31 + k * 7 + 1) & 255) } }
const open = (dir, ports = {}) => { const r = openDb(join(dir, 'db.sqlite'), ports); assert.ok(r.ok, r.message); return r.db }
const make = (extra = {}) => {
  const dir = fresh()
  const r = createDb(join(dir, 'db.sqlite'), { name: 'Test', by: 'noor', objects: [TASK, NOTE], ...extra }, { now: clock().now })
  assert.ok(r.ok, r.message)
  return { dir, db: r.db, file: join(dir, 'db.sqlite') }
}
const raw = (file) => { const h = new DatabaseSync(file); h.exec('PRAGMA busy_timeout = 3000'); return h }
const fails = (fn, re) => assert.throws(fn, (e) => re.test(String(e.message)))

// ---------------------------------------------------------------- ULID
ok('a ULID is the standard encoding of a time and ten bytes', () => {
  assert.equal(encodeUlid(1469918176385, new Uint8Array(10)), '01ARYZ6S410000000000000000')
  assert.equal(encodeUlid(2 ** 48 - 1, new Uint8Array(10).fill(255)), '7' + 'Z'.repeat(25))
  assert.equal(encodeUlid(0, new Uint8Array(10)), '0'.repeat(26))
  assert.equal(ulidTime('01ARYZ6S410000000000000000'), 1469918176385)
  assert.ok(isUlid(encodeUlid(2 ** 48 - 1, new Uint8Array(10).fill(255))))
  assert.throws(() => encodeUlid(2 ** 48, new Uint8Array(10)), RangeError)
  assert.throws(() => encodeUlid(-1, new Uint8Array(10)), RangeError)
  assert.throws(() => encodeUlid(1.5, new Uint8Array(10)), RangeError)
  assert.throws(() => encodeUlid(1, new Uint8Array(9)), RangeError)
})

ok('the generator never repeats and never goes backwards, whatever the clock does', () => {
  let t = 1000
  const next = makeUlid({ now: () => t, random: sequence() })
  const ids = []
  for (let i = 0; i < 200; i++) ids.push(next())
  t = 500 // the clock is set back
  for (let i = 0; i < 200; i++) ids.push(next())
  t = 5000
  ids.push(next())
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual([...ids].sort(), ids)
  assert.ok(ids.every(isUlid))
  assert.equal(ulidTime(ids[ids.length - 1]), 5000)
})

ok('the generator rolls over to the next millisecond when the random part is full', () => {
  const next = makeUlid({ now: () => 7, random: () => new Uint8Array(10).fill(255) })
  const a = next()
  const b = next()
  assert.equal(a, encodeUlid(7, new Uint8Array(10).fill(255)))
  assert.equal(ulidTime(b), 8)
  assert.ok(a < b)
})

ok('an older moment can be stamped, and still sorts after what came before', () => {
  const next = makeUlid({ now: () => 9000, random: sequence() })
  const first = next()
  const old = next(1234)
  assert.ok(first < old)
})

// ---------------------------------------------------------------- columns and schema
ok('every field type comes back from its column as the value that went in', () => {
  const cases = {
    title: 'Café', status: 'doing', assignee: 'noor', due: '2026-10-30', estimate: 1.5, budget: 12.35, urgent: true, tags: ['ui', 'bug'],
    project: '01ARYZ6S410000000000000001', depends: ['01ARYZ6S410000000000000002'], files: [{ name: 'a.pdf', size: 3, type: 'application/pdf', hash: 'a'.repeat(64) }],
    site: 'https://example.com', contact: 'a@b.co', phone: '+33 1 23', notes: 'line\nbreak',
  }
  for (const f of TASK.fields) {
    assert.deepEqual(fromColumn(f, toColumn(f, cases[f.key])), cases[f.key], f.key)
    assert.equal(fromColumn(f, toColumn(f, null)), f.type === 'checkbox' ? false : null, f.key)
  }
  assert.equal(toColumn(TASK.fields.find((f) => f.key === 'urgent'), false), 0)
})

ok('the SQL of every object is valid, and the triggers build for every field type', () => {
  const h = new DatabaseSync(':memory:')
  h.exec('CREATE TABLE ctl (k TEXT PRIMARY KEY, v INTEGER); INSERT INTO ctl VALUES (\'quiet\', 0)')
  h.exec("CREATE TABLE ops (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT, kind TEXT, object TEXT, record TEXT, set_json TEXT, prev_json TEXT, actor TEXT, at TEXT, source TEXT)")
  for (const obj of [TASK, NOTE]) {
    h.exec(createTableSql(obj))
    for (const sql of triggersSql(obj)) h.exec(sql)
  }
  assert.match(columnSql({ key: 'a"b', type: 'text' }), /"a""b"/)
  h.close()
})

// ---------------------------------------------------------------- the done criteria
ok('a db is created, filled, reopened; a change adds an operation; a db newer than the code is refused', () => {
  const { dir, db, file } = make()
  const info = db.info()
  assert.ok(isUlid(info.id))
  assert.deepEqual([info.name, info.format, info.created.by], ['Test', FORMAT, 'noor'])

  const a = db.create('task', { title: 'Write the post', status: 'doing', estimate: 3 }, 'noor')
  const b = db.create('task', { title: 'Fix rounding', urgent: true }, 'ines')
  assert.ok(a.ok && b.ok)
  assert.ok(isUlid(a.record.id) && a.record.id < b.record.id)
  assert.equal(db.journal().length, 2)

  const u = db.update('task', a.record.id, { status: 'done' }, 'noor')
  assert.ok(u.ok && u.applied)
  assert.deepEqual([u.record.rev, u.record.values.status, u.record.modified.by], [2, 'done', 'noor'])
  const ops = db.journal()
  assert.equal(ops.length, 3)
  assert.deepEqual(ops[2], { seq: 3, source: 'engine', id: ops[2].id, kind: 'update', object: 'task', record: a.record.id, set: { status: 'done' }, prev: { status: 'doing' }, by: 'noor', at: ops[2].at })
  db.close()

  const again = open(dir)
  assert.deepEqual(again.list('task').map((r) => r.values.title), ['Write the post', 'Fix rounding'])
  assert.equal(again.get('task', a.record.id).values.status, 'done')
  assert.equal(again.journal().length, 3)
  assert.equal(again.info().id, info.id)
  again.close()

  const h = raw(file)
  h.exec('PRAGMA user_version = ' + (FORMAT + 1))
  h.close()
  const newer = openDb(file)
  assert.equal(newer.ok, false)
  assert.equal(newer.code, 'db_newer')
  assert.match(newer.message, /newer Kybernos/)
})

ok('the db file is private to its owner', () => {
  if (process.platform === 'win32') return
  const { file } = make()
  assert.equal(statSync(file).mode & 0o777, 0o600)
})

// ---------------------------------------------------------------- records through the engine
ok('values are stored in their canonical form and every field type survives a reopen', () => {
  const { dir, db } = make()
  const hash = 'b'.repeat(64)
  assert.ok(db.addObject(PROJECT, 'noor').ok)
  const project = db.create('project', { name: 'Launch' }, 'noor').record.id
  const first = db.create('task', { title: 'First' }, 'noor').record.id
  const second = db.create('task', { title: 'Second' }, 'noor').record.id
  const r = db.create('task', {
    title: 'All fields', status: 'todo', assignee: 'noor', due: '2026-12-31', estimate: 0.1, budget: 1.005, urgent: true, tags: ['api', 'ui', 'api'],
    project, depends: [first, second],
    files: [{ name: 'brief.pdf', size: 12, type: 'application/pdf', hash }], site: 'https://example.com/x', contact: 'a@b.co', phone: '+33 1 23 45', notes: 'ligne\nsuivante',
  }, 'noor')
  assert.ok(r.ok, r.message)
  assert.equal(r.record.values.budget, 1.01)
  assert.deepEqual(r.record.values.tags, ['api', 'ui'])
  db.close()
  const back = open(dir).get('task', r.record.id)
  assert.deepEqual(back, r.record)
})

ok('an empty value is null, a checkbox is false, and clearing a field journals the change', () => {
  const { db } = make()
  const r = db.create('task', { title: 'T', notes: '', tags: [], estimate: null }, 'noor')
  assert.deepEqual([r.record.values.notes, r.record.values.tags, r.record.values.estimate, r.record.values.urgent], [null, null, null, false])
  const set = db.update('task', r.record.id, { estimate: 5, urgent: true, tags: ['bug'] }, 'noor')
  const cleared = db.update('task', r.record.id, { estimate: null, urgent: false, tags: [] }, 'noor')
  assert.deepEqual([cleared.record.values.estimate, cleared.record.values.urgent, cleared.record.values.tags], [null, false, null])
  const last = db.journal().pop()
  assert.deepEqual(last.set, { estimate: null, urgent: false, tags: null })
  assert.deepEqual(last.prev, { estimate: 5, urgent: true, tags: ['bug'] })
  assert.ok(set.ok)
})

ok('a refused write leaves nothing behind: no row, no operation', () => {
  const { db } = make()
  const before = db.journal().length
  for (const [values, code] of [[{}, 'required'], [{ title: 'x', status: 'nope' }, 'option'], [{ title: 'x', ghost: 1 }, 'unknown-field'], [{ title: 'x', due: '2026-02-30' }, 'format']]) {
    const r = db.create('task', values, 'noor')
    assert.equal(r.ok, false, JSON.stringify(values))
    assert.equal(r.code, 'invalid')
    assert.ok(r.errors.some((e) => e.code === code), JSON.stringify(r.errors))
  }
  assert.equal(db.create('task', { title: 'x' }, '').code, 'invalid')
  assert.equal(db.create('ghost', { title: 'x' }, 'noor').code, 'unknown-object')
  assert.equal(db.count('task'), 0)
  assert.equal(db.journal().length, before)
})

ok('an update that changes nothing writes nothing', () => {
  const { db } = make()
  const r = db.create('task', { title: 'Same', estimate: 2 }, 'noor')
  const u = db.update('task', r.record.id, { title: 'Same', estimate: 2 }, 'noor')
  assert.deepEqual([u.ok, u.applied, u.record.rev], [true, false, 1])
  assert.equal(db.journal().length, 1)
})

ok('update, delete and restore answer for a missing, a deleted and a live record', () => {
  const { db } = make()
  const r = db.create('task', { title: 'Mortal' }, 'noor')
  const id = r.record.id
  assert.equal(db.update('task', '01ARYZ6S410000000000000009', { title: 'x' }, 'noor').code, 'missing')
  assert.equal(db.update('task', 'not an id', { title: 'x' }, 'noor').code, 'missing')
  assert.equal(db.remove('task', '01ARYZ6S410000000000000009', 'noor').code, 'missing')

  const gone = db.remove('task', id, 'ines')
  assert.deepEqual([gone.ok, gone.applied, gone.record.rev, gone.record.deleted.by], [true, true, 2, 'ines'])
  assert.deepEqual(db.list('task'), [])
  assert.equal(db.list('task', { deleted: true }).length, 1)
  assert.equal(db.list('task', { deleted: 'all' }).length, 1)
  assert.equal(db.count('task'), 0)
  assert.equal(db.get('task', id).deleted.by, 'ines')
  assert.equal(db.update('task', id, { title: 'Zombie' }, 'noor').code, 'deleted')
  assert.equal(db.remove('task', id, 'noor').applied, false)

  const back = db.restore('task', id, 'noor')
  assert.deepEqual([back.ok, back.applied, back.record.rev, back.record.deleted], [true, true, 3, null])
  assert.equal(db.restore('task', id, 'noor').applied, false)
  assert.equal(db.count('task'), 1)
  assert.deepEqual(db.journal().map((o) => o.kind), ['create', 'delete', 'restore'])
})

ok('an operation applied twice is applied once, and a replay on a second db gives the same records', () => {
  const a = make()
  const x = a.db.create('task', { title: 'One', tags: ['ui'] }, 'noor').record
  a.db.update('task', x.id, { status: 'done' }, 'ines')
  a.db.remove('task', x.id, 'noor')
  const ops = a.db.journal()

  const b = make()
  for (const op of ops) {
    const { seq, source, ...plain } = op
    assert.ok(b.db.apply(plain).applied, op.kind)
    assert.equal(b.db.apply(plain).applied, false, 'replayed ' + op.kind)
  }
  assert.deepEqual(b.db.get('task', x.id), a.db.get('task', x.id))
  assert.equal(b.db.journal().length, 3)
  const { seq, source, ...stray } = ops[1]
  assert.equal(b.db.apply({ ...stray, id: undefined }).code, 'invalid')
  assert.equal(b.db.apply(null).code, 'unknown-object')
})

ok('the engine journals its own writes once (the triggers stay quiet), and leaves them switched on', () => {
  const { db, file } = make()
  db.create('task', { title: 'Once' }, 'noor')
  const h = raw(file)
  assert.equal(h.prepare('SELECT count(*) AS n FROM ops').get().n, 1)
  assert.equal(h.prepare("SELECT v FROM ctl WHERE k = 'quiet'").get().v, 0)
  assert.equal(h.prepare('SELECT source FROM ops').get().source, 'engine')
  h.close()
})

ok('with a clock set back, ids and operations still come in order', () => {
  const c = clock()
  const dir = fresh()
  const { db } = createDb(join(dir, 'db.sqlite'), { name: 'Clock', by: 'noor', objects: [NOTE] }, { now: c.now })
  const a = db.create('note', { name: 'a' }, 'noor').record
  c.set(Date.UTC(2020, 0, 1))
  const b = db.create('note', { name: 'b' }, 'noor').record
  assert.ok(a.id < b.id)
  const ids = db.journal().map((o) => o.id)
  assert.deepEqual([...ids].sort(), ids)
})

// ---------------------------------------------------------------- raw SQL
ok('raw SQL from another connection is journaled, stamped and read back by the engine', () => {
  const { db, file } = make()
  const h = raw(file)
  const id = '01ARYZ6S410000000000000001'
  h.exec(`INSERT INTO r_task (id, title, tags, urgent, estimate, notes) VALUES ('${id}', 'From SQL', '["bug","ui"]', 1, 2.5, 'x')`)
  let rec = db.get('task', id)
  assert.deepEqual([rec.values.title, rec.values.tags, rec.values.urgent, rec.values.estimate, rec.rev, rec.created.by], ['From SQL', ['bug', 'ui'], true, 2.5, 1, 'sql'])
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(rec.created.at))

  h.exec(`UPDATE r_task SET title = 'Renamed', estimate = NULL, tags = NULL WHERE id = '${id}'`)
  h.exec(`UPDATE r_task SET title = 'Renamed' WHERE id = '${id}'`) // no real change: nothing happens
  rec = db.get('task', id)
  assert.deepEqual([rec.values.title, rec.values.estimate, rec.values.tags, rec.rev], ['Renamed', null, null, 2])

  h.exec(`UPDATE r_task SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = '${id}'`)
  assert.deepEqual([db.get('task', id).rev, db.list('task').length], [3, 0])
  h.exec(`UPDATE r_task SET deleted_at = NULL WHERE id = '${id}'`)
  assert.deepEqual([db.get('task', id).rev, db.get('task', id).deleted, db.list('task').length], [4, null, 1])

  const ops = db.journal()
  assert.deepEqual(ops.map((o) => o.kind), ['create', 'update', 'delete', 'restore'])
  assert.ok(ops.every((o) => o.source === 'sql' && isUlid(o.id) && o.by === 'sql'))
  assert.deepEqual(ops[0].set, { title: 'From SQL', urgent: true, tags: ['bug', 'ui'], estimate: 2.5, notes: 'x' })
  assert.deepEqual(ops[1].set, { title: 'Renamed', estimate: null, tags: null })
  assert.deepEqual(ops[1].prev, { title: 'From SQL', estimate: 2.5, tags: ['bug', 'ui'] })
  assert.deepEqual([...ops.map((o) => o.id)].sort(), ops.map((o) => o.id))
  assert.equal(db.journal().length, 4, 'sealing is done once')
  assert.equal(db.verify().ok, true, JSON.stringify(db.verify()))
  h.close()
})

ok('raw SQL can name its author, and cannot rewrite an id or remove a row', () => {
  const { db, file } = make()
  const h = raw(file)
  const id = '01ARYZ6S410000000000000001'
  h.exec(`INSERT INTO r_task (id, title, created_by, modified_by) VALUES ('${id}', 'By hand', 'ines', 'ines')`)
  h.exec(`UPDATE r_task SET title = 'By hand 2', modified_by = 'noor' WHERE id = '${id}'`)
  assert.deepEqual([db.get('task', id).created.by, db.get('task', id).modified.by], ['ines', 'noor'])
  assert.deepEqual(db.journal().map((o) => o.by), ['ines', 'noor'])
  fails(() => h.exec(`UPDATE r_task SET id = '01ARYZ6S410000000000000002' WHERE id = '${id}'`), /never changes/)
  fails(() => h.exec('DELETE FROM r_task'), /deleted_at/)
  h.exec(`UPDATE r_task SET deleted_at = '2026-10-30T10:00:00.000Z' WHERE id = '${id}'`)
  fails(() => h.exec(`UPDATE r_task SET title = 'Zombie' WHERE id = '${id}'`), /cannot change while a record is deleted/)
  fails(() => h.exec(`UPDATE r_task SET title = 'Last words', deleted_at = NULL WHERE id = '${id}'`), /in the statement that deletes or restores/)
  h.exec(`UPDATE r_task SET deleted_at = NULL WHERE id = '${id}'`)
  fails(() => h.exec(`UPDATE r_task SET title = 'Last words', deleted_at = '2026-10-30T11:00:00.000Z' WHERE id = '${id}'`), /in the statement that deletes or restores/)
  assert.deepEqual(db.journal().map((o) => o.kind), ['create', 'update', 'delete', 'restore'])
  assert.equal(db.get('task', id).rev, 4)
  assert.equal(db.verify().ok, true, JSON.stringify(db.verify()))
  h.close()
})

ok('raw SQL cannot make a revision of its own', () => {
  const { db, file } = make()
  const h = raw(file)
  const id = '01ARYZ6S410000000000000001'
  h.exec(`INSERT INTO r_task (id, title, rev) VALUES ('${id}', 'Rev', 40)`)
  h.exec(`UPDATE r_task SET title = 'Rev 2', rev = 99 WHERE id = '${id}'`)
  assert.equal(db.get('task', id).rev, 41, 'an update counts one revision from where the row was')
  assert.equal(db.verify().ok, false, 'an insert that starts at 40 is told apart from the journal')
  h.close()
})

ok('a failure in the middle of a write leaves nothing: no row change, no operation, the triggers still on', () => {
  const { db, file } = make()
  const r = db.create('task', { title: 'Safe' }, 'noor').record
  const h = raw(file)
  h.exec("CREATE TRIGGER boom BEFORE INSERT ON ops WHEN NEW.kind = 'delete' BEGIN SELECT RAISE(ABORT, 'boom'); END")
  assert.throws(() => db.remove('task', r.id, 'noor'), /boom/)
  assert.equal(db.get('task', r.id).deleted, null)
  assert.equal(db.journal().length, 1)
  h.exec('DROP TRIGGER boom')
  assert.equal(h.prepare("SELECT v FROM ctl WHERE k = 'quiet'").get().v, 0)
  assert.equal(db.remove('task', r.id, 'noor').applied, true, 'the db is usable after the failure')
  assert.equal(db.verify().ok, true)
  h.close()
})

ok('raw SQL cannot store a shape the engine could not read back', () => {
  const { file } = make()
  const h = raw(file)
  const id = (k) => '01ARYZ6S4100000000000000' + String(k).padStart(2, '0')
  let k = 0
  const bad = (sql) => fails(() => h.exec(sql.replace('$ID', id(++k))), /constraint/i)
  bad(`INSERT INTO r_task (id, title) VALUES ('$ID', '')`)
  bad(`INSERT INTO r_task (id, title) VALUES ('short', 'x')`)
  bad(`INSERT INTO r_task (id, title, urgent) VALUES ('$ID', 'x', 2)`)
  bad(`INSERT INTO r_task (id, title, urgent) VALUES ('$ID', 'x', NULL)`)
  bad(`INSERT INTO r_task (id, title, tags) VALUES ('$ID', 'x', 'not json')`)
  bad(`INSERT INTO r_task (id, title, tags) VALUES ('$ID', 'x', '[]')`)
  bad(`INSERT INTO r_task (id, title, tags) VALUES ('$ID', 'x', '{"a":1}')`)
  bad(`INSERT INTO r_task (id, title, estimate) VALUES ('$ID', 'x', 'many')`)
  bad(`INSERT INTO r_task (id, title, due) VALUES ('$ID', 'x', 'tomorrow')`)
  bad(`INSERT INTO r_task (id, title, project) VALUES ('$ID', 'x', 'abc')`)
  bad(`INSERT INTO r_task (id, title, created_at) VALUES ('$ID', 'x', 'yesterday')`)
  assert.equal(h.prepare('SELECT count(*) AS n FROM r_task').get().n, 0)
  assert.equal(h.prepare('SELECT count(*) AS n FROM ops').get().n, 0)
  h.close()
})

ok('verify() names a value the engine would have refused, and a table the journal does not explain', () => {
  const { db, file } = make()
  const mine = db.create('task', { title: 'Mine', status: 'todo' }, 'noor').record
  assert.deepEqual(db.verify(), { ok: true, problems: [] })

  const h = raw(file)
  h.exec(`INSERT INTO r_task (id, title, status) VALUES ('01ARYZ6S410000000000000001', 'Odd', 'nope')`)
  h.exec(`INSERT INTO r_task (id, title) VALUES ('01ARYZ6S410000000000000002', 'Fine')`)
  h.exec(`UPDATE r_task SET title = NULL WHERE id = '01ARYZ6S410000000000000002'`)
  let v = db.verify()
  assert.equal(v.ok, false)
  assert.ok(v.problems.some((p) => p.code === 'value' && p.field === 'status' && p.record === '01ARYZ6S410000000000000001'), JSON.stringify(v))
  assert.ok(v.problems.some((p) => p.code === 'required' && p.field === 'title'), JSON.stringify(v))

  for (const t of h.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()) h.exec(`DROP TRIGGER "${t.name}"`)
  h.exec(`UPDATE r_task SET title = 'Silent' WHERE id = '${mine.id}'`)
  h.exec(`INSERT INTO r_task (id, title) VALUES ('01ARYZ6S410000000000000003', 'Unseen')`)
  v = db.verify()
  assert.ok(v.problems.some((p) => p.code === 'mismatch' && p.record === mine.id), JSON.stringify(v))
  assert.ok(v.problems.some((p) => p.code === 'no-journal' && p.record === '01ARYZ6S410000000000000003'), JSON.stringify(v))
  h.close()
})

// ---------------------------------------------------------------- structure
ok('adding an object and a field writes a new version of the catalog and keeps the old ones', () => {
  const { dir, db, file } = make()
  const v0 = db.info().version
  const rec = db.create('note', { name: 'Before' }, 'noor').record
  const f = db.addField('note', { key: 'pinned', type: 'checkbox', label: 'Pinned' }, 'noor')
  assert.ok(f.ok, f.message)
  assert.equal(f.version, v0 + 1)
  assert.equal(db.get('note', rec.id).values.pinned, false)
  const o = db.addObject({ key: 'project', label: 'Projects', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }] }, 'noor')
  assert.ok(o.ok, o.message)
  assert.equal(o.object.title, 'name')
  assert.deepEqual(db.objects().map((x) => x.key), ['task', 'note', 'project'])
  assert.deepEqual(db.objects().find((x) => x.key === 'note').fields.map((x) => x.key), ['name', 'body', 'pinned'])

  const mix = db.create('note', { name: 'After', pinned: true }, 'ines')
  assert.equal(mix.record.values.pinned, true)
  db.close()

  const h = raw(file)
  const rows = h.prepare('SELECT version, change, actor FROM catalog ORDER BY version').all()
  assert.deepEqual(rows.map((r) => r.change).slice(-2), ['add-field:note.pinned', 'add-object:project'])
  assert.ok(rows.every((r, i) => r.version === i + 1))
  assert.deepEqual(JSON.parse(h.prepare('SELECT json FROM catalog WHERE version = ?').get(v0).json).objects.find((x) => x.key === 'note').fields.map((x) => x.key), ['name', 'body'])
  h.close()
  assert.equal(open(dir).objects().length, 3)
})

ok('the triggers follow a new column: raw SQL on it is journaled too', () => {
  const { db, file } = make()
  db.addField('task', { key: 'points', type: 'number', label: 'Points' }, 'noor')
  const h = raw(file)
  h.exec(`INSERT INTO r_task (id, title, points) VALUES ('01ARYZ6S410000000000000001', 'P', 8)`)
  h.exec(`UPDATE r_task SET points = 13 WHERE id = '01ARYZ6S410000000000000001'`)
  const ops = db.journal()
  assert.deepEqual(ops.map((o) => o.set), [{ title: 'P', points: 8 }, { points: 13 }])
  assert.deepEqual(ops[1].prev, { points: 8 })
  assert.equal(db.verify().ok, true, JSON.stringify(db.verify()))
  h.close()
})

ok('structure changes are refused with a reason, and leave the file as it was', () => {
  const { db } = make()
  db.create('task', { title: 'Existing' }, 'noor')
  const v = db.info().version
  const cases = [
    [() => db.addObject({ key: 'task', label: 'Again', fields: [{ key: 'a', type: 'text', label: 'A' }] }, 'noor'), 'exists'],
    [() => db.addObject({ key: 'Bad Key', label: 'X', fields: [{ key: 'a', type: 'text', label: 'A' }] }, 'noor'), 'invalid'],
    [() => db.addObject({ key: 'empty', label: 'X', fields: [] }, 'noor'), 'invalid'],
    [() => db.addObject({ key: 'dup', label: 'X', fields: [{ key: 'a', type: 'text', label: 'A' }, { key: 'a', type: 'text', label: 'B' }] }, 'noor'), 'invalid'],
    [() => db.addObject({ key: 'tt', label: 'X', title: 'n', fields: [{ key: 'n', type: 'number', label: 'N' }] }, 'noor'), 'invalid'],
    [() => db.addObject({ key: 'ok', label: 'X', fields: [{ key: 'a', type: 'text', label: 'A' }] }, ''), 'invalid'],
    [() => db.addField('task', { key: 'title', type: 'text', label: 'Again' }, 'noor'), 'exists'],
    [() => db.addField('task', { key: 'id', type: 'text', label: 'Id' }, 'noor'), 'invalid'],
    [() => db.addField('task', { key: 'must', type: 'text', label: 'Must', required: true }, 'noor'), 'needs-default'],
    [() => db.addField('ghost', { key: 'a', type: 'text', label: 'A' }, 'noor'), 'unknown-object'],
  ]
  for (const [run, code] of cases) assert.equal(run().code, code)
  assert.equal(db.info().version, v)
  assert.equal(db.create('task', { title: 'Still works' }, 'noor').ok, true)
  assert.equal(db.addField('note', { key: 'must', type: 'text', label: 'Must', required: true }, 'noor').ok, true, 'an empty object may take a required field')
  assert.equal(db.create('note', { name: 'x' }, 'noor').code, 'invalid')
})

ok('a field can be relabelled, protected and given more options; nothing else changes and nothing is removed', () => {
  const { dir, db, file } = make()
  const v = db.info().version
  const r = db.updateField('task', 'status', { label: 'State', protection: 'personal', options: [...TASK.fields.find((f) => f.key === 'status').options, { key: 'blocked', label: 'Blocked', color: 'red' }] }, 'noor')
  assert.ok(r.ok && r.applied, r.message)
  assert.equal(r.version, v + 1)
  const f = db.objects().find((o) => o.key === 'task').fields.find((x) => x.key === 'status')
  assert.deepEqual([f.label, f.protection, f.options.map((o) => o.key)], ['State', 'personal', ['todo', 'doing', 'done', 'blocked']])
  assert.equal(db.create('task', { title: 'x', status: 'blocked' }, 'noor').ok, true)
  assert.equal(db.updateField('task', 'status', { label: 'State' }, 'noor').applied, false, 'the same change twice writes nothing')
  assert.equal(db.info().version, v + 1)
  for (const [changes, code] of [[{ type: 'text' }, 'not-changeable'], [{ key: 'other' }, 'not-changeable'], [{ required: true }, 'not-changeable'], [{}, 'empty'], [{ protection: 'secrect' }, 'protection'],
    [{ options: [{ key: 'todo', label: 'To do' }] }, 'option-removed'], [{ label: '' }, 'label']]) {
    const bad = db.updateField('task', 'status', changes, 'noor')
    assert.equal(bad.code, 'invalid', JSON.stringify(changes))
    assert.ok(bad.errors.some((e) => e.code === code), JSON.stringify([changes, bad.errors]))
  }
  assert.equal(db.updateField('task', 'title', { options: [{ key: 'a', label: 'A' }] }, 'noor').code, 'invalid')
  assert.equal(db.updateField('task', 'ghost', { label: 'x' }, 'noor').code, 'unknown-field')
  assert.equal(db.updateField('ghost', 'title', { label: 'x' }, 'noor').code, 'unknown-object')
  assert.equal(db.updateField('task', 'title', { label: 'x' }, '').code, 'invalid')
  assert.equal(db.info().version, v + 1)
  db.close()
  const h = raw(file)
  assert.equal(h.prepare("SELECT change FROM catalog WHERE version = ?").get(v + 1).change, 'update-field:task.status')
  h.close()
  assert.equal(open(dir).objects()[0].fields.find((x) => x.key === 'status').label, 'State')
})

ok('an object can be relabelled and can change its title field, nothing else', () => {
  const { db } = make()
  const r = db.updateObject('note', { label: 'Memos' }, 'noor')
  assert.ok(r.ok && r.applied)
  assert.equal(db.objects().find((o) => o.key === 'note').label, 'Memos')
  db.addField('note', { key: 'subject', type: 'text', label: 'Subject' }, 'noor')
  assert.equal(db.updateObject('note', { title: 'subject' }, 'noor').ok, true)
  assert.equal(db.objects().find((o) => o.key === 'note').title, 'subject')
  assert.equal(db.updateObject('note', { title: 'body' }, 'noor').code, 'invalid', 'a long text cannot be a title')
  assert.equal(db.updateObject('note', { title: 'ghost' }, 'noor').code, 'invalid')
  assert.equal(db.updateObject('note', { key: 'memo' }, 'noor').code, 'invalid')
  assert.equal(db.updateObject('note', { label: 'Memos' }, 'noor').applied, false)
  assert.equal(db.updateObject('ghost', { label: 'x' }, 'noor').code, 'unknown-object')
})

ok('a view is saved in place, listed in order, and a save that changes nothing writes nothing', () => {
  const { dir, db } = make()
  const flt = { conj: 'and', items: [{ k: 'status', op: 'is', v: 'doing' }] }
  const a = db.saveView('task', { name: 'Doing', kind: 'table', state: { flt, sorts: [{ k: 'due', dir: 'asc' }], hidden: ['notes'] } }, 'noor')
  assert.ok(a.ok && a.created && a.applied, a.message)
  assert.ok(a.view.id.length === 26 && a.view.owner === 'me' && a.view.fav === false)
  const board = db.saveView('task', { name: 'Board', kind: 'board', owner: 'kaby' }, 'agent')
  assert.equal(board.view.by, 'status', 'a board takes the first choice field')
  const cal = db.saveView('task', { id: 'by-date', name: 'Calendar', kind: 'calendar', fav: true }, 'noor')
  assert.equal(cal.view.date, 'due')
  assert.deepEqual(db.listViews('task').map((v) => v.name), ['Doing', 'Board', 'Calendar'])
  assert.deepEqual(db.listViews('note'), [])
  assert.deepEqual(db.getView('task', a.view.id), a.view)
  assert.equal(db.getView('task', 'nope'), null)

  const again = db.saveView('task', a.view, 'noor')
  assert.deepEqual([again.ok, again.applied, again.created], [true, false, false])
  const renamed = db.saveView('task', { ...a.view, name: 'In progress' }, 'ines')
  assert.deepEqual([renamed.applied, renamed.created], [true, false])
  assert.equal(db.listViews('task')[0].name, 'In progress')
  assert.equal(db.listViews('task').length, 3, 'saving an existing id edits it')
  db.close()

  const h = raw(dir + '/db.sqlite')
  const row = h.prepare('SELECT rev, created_by, modified_by FROM views WHERE id = ?').get(a.view.id)
  assert.deepEqual({ ...row }, { rev: 2, created_by: 'noor', modified_by: 'ines' })
  h.close()
  const back = open(dir)
  assert.equal(back.listViews('task').length, 3)
  assert.equal(back.verify().ok, true, JSON.stringify(back.verify()))
  back.close()
})

ok('a view is refused when it does not fit the object, and another object\'s view id is not taken over', () => {
  const { db } = make()
  const cases = [
    [{ name: 'x', kind: 'board', by: 'title' }, 'by'], [{ name: 'x', kind: 'calendar', date: 'estimate' }, 'date'], [{ name: '', kind: 'table' }, 'name'], [{ name: 'x', kind: 'map' }, 'kind'],
    [{ name: 'x', kind: 'table', state: { flt: { conj: 'and', items: [{ k: 'ghost', op: 'is', v: 1 }] } } }, 'unknown-field'], [{ name: 'x', kind: 'table', state: { hidden: ['title'] } }, 'title'],
    [{ id: 'bad id', name: 'x', kind: 'table' }, 'id'],
  ]
  for (const [view, code] of cases) {
    const r = db.saveView('task', view, 'noor')
    assert.equal(r.code, 'invalid', JSON.stringify(view))
    assert.ok(r.errors.some((e) => e.code === code), JSON.stringify([view, r.errors]))
  }
  assert.equal(db.saveView('note', { name: 'x', kind: 'board' }, 'noor').code, 'invalid', 'a note has no choice field for columns')
  assert.equal('extra' in db.saveView('task', { name: 'Tidy', kind: 'table', extra: 1 }, 'noor').view, false, 'a property a view does not have is not stored')
  assert.equal(db.saveView('task', { name: 'x', kind: 'table' }, '').code, 'invalid')
  assert.equal(db.saveView('ghost', { name: 'x', kind: 'table' }, 'noor').code, 'unknown-object')
  const mine = db.saveView('task', { id: 'shared-id', name: 'Mine', kind: 'table' }, 'noor')
  assert.ok(mine.ok)
  assert.equal(db.saveView('note', { id: 'shared-id', name: 'Theirs', kind: 'table' }, 'noor').code, 'exists')
  assert.deepEqual(db.listViews('task').map((v) => v.name), ['Tidy', 'Mine'])
  assert.deepEqual(db.removeView('note', 'shared-id'), { ok: true, removed: false })
  assert.deepEqual(db.removeView('task', 'shared-id'), { ok: true, removed: true })
  assert.deepEqual(db.listViews('task').map((v) => v.name), ['Tidy'])
  assert.equal(db.removeView('ghost', 'x').code, 'unknown-object')
})

ok('viewStamps says who last saved each view, and counts the saves', () => {
  const { db } = make()
  const a = db.saveView('task', { name: 'Open', kind: 'table' }, 'kaby-agent')
  assert.deepEqual(Object.keys(db.viewStamps('task')), [a.view.id])
  const s1 = db.viewStamps('task')[a.view.id]
  assert.equal(s1.rev, 1)
  assert.equal(s1.by, 'kaby-agent')
  assert.match(s1.at, /^\d{4}-\d\d-\d\dT/)
  db.saveView('task', { ...a.view, fav: true }, 'person')
  const s2 = db.viewStamps('task')[a.view.id]
  assert.deepEqual([s2.rev, s2.by], [2, 'person'])
  db.saveView('task', { ...a.view, fav: true }, 'kaby-agent')
  assert.equal(db.viewStamps('task')[a.view.id].by, 'person', 'a save that changes nothing leaves the stamp alone')
  assert.deepEqual(db.viewStamps('note'), {})
  db.removeView('task', a.view.id)
  assert.deepEqual(db.viewStamps('task'), {})
  assert.throws(() => db.viewStamps('ghost'))
})

ok('verify() reports a view that no longer fits its object', () => {
  const { db, file } = make()
  db.saveView('task', { id: 'v1', name: 'Doing', kind: 'table', state: { flt: { conj: 'and', items: [{ k: 'status', op: 'is', v: 'doing' }] } } }, 'noor')
  assert.equal(db.verify().ok, true)
  const h = raw(file)
  h.exec(`UPDATE views SET json = replace(json, '"status"', '"ghost"') WHERE id = 'v1'`)
  h.exec(`INSERT INTO views (id, object, json, created_by, created_at, modified_by, modified_at) VALUES ('v2', 'ghost', '{}', 'x', 'x', 'x', 'x')`)
  const v = db.verify()
  assert.deepEqual(v.problems.map((p) => [p.code, p.view]).sort(), [['view', 'v1'], ['view', 'v2']])
  h.close()
})

ok('two connections to one db see each other\'s structure', () => {
  const { dir, db: a } = make()
  const b = open(dir)
  assert.ok(a.addField('note', { key: 'stars', type: 'number', label: 'Stars' }, 'noor').ok)
  const r = b.create('note', { name: 'Seen', stars: 5 }, 'ines')
  assert.ok(r.ok, r.message)
  assert.equal(a.get('note', r.record.id).values.stars, 5)
  assert.ok(b.addObject({ key: 'tag', label: 'Tags', fields: [{ key: 'name', type: 'text', label: 'Name' }] }, 'ines').ok)
  assert.ok(a.create('tag', { name: 'x' }, 'noor').ok)
  assert.equal(a.verify().ok, true)
  a.close(); b.close()
})

// ---------------------------------------------------------------- refusals when opening and creating
ok('opening and creating refuse what they should, and say why', () => {
  const dir = fresh()
  const file = join(dir, 'db.sqlite')
  assert.equal(openDb(file).code, 'missing')
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, 'this is not a database, it is a note to self')
  assert.equal(openDb(file).code, 'not_a_db')
  assert.equal(createDb(file, { name: 'X', by: 'noor' }).code, 'exists')
  assert.equal(readFileSync(file, 'utf8'), 'this is not a database, it is a note to self', 'a taken path is never touched')

  const other = join(dir, 'other.sqlite')
  const h = new DatabaseSync(other)
  h.exec('CREATE TABLE meta (k TEXT, v TEXT); PRAGMA user_version = 1')
  h.close()
  assert.equal(openDb(other).code, 'not_a_db')
  const empty = join(dir, 'empty.sqlite')
  writeFileSync(empty, '')
  assert.equal(openDb(empty).code, 'not_a_db')

  for (const [def, path] of [[null, ''], [{ by: 'noor' }, 'name'], [{ name: '', by: 'noor' }, 'name'], [{ name: 'X' }, 'by'], [{ name: 'X', by: 'noor', id: 'nope' }, 'id'],
    [{ name: 'X', by: 'noor', objects: 'task' }, 'objects'], [{ name: 'X', by: 'noor', objects: [{ key: 'a' }] }, 'objects.0.label'],
    [{ name: 'X', by: 'noor', objects: [TASK, TASK] }, 'objects.1.key']]) {
    const r = createDb(join(dir, 'new.sqlite'), def)
    assert.equal(r.code, 'invalid', JSON.stringify(def))
    if (path) assert.ok(r.errors.some((e) => e.path === path), JSON.stringify(r.errors))
    assert.equal(existsSync(join(dir, 'new.sqlite')), false, 'an invalid request creates no file')
  }
})

ok('a Node without node:sqlite is reported, not thrown', () => {
  const dir = fresh()
  assert.equal(createDb(join(dir, 'db.sqlite'), { name: 'X', by: 'noor' }, { sqlite: null }).code, 'sqlite_unavailable')
  assert.equal(openDb(join(dir, 'db.sqlite'), { sqlite: () => ({}) }).code, 'sqlite_unavailable')
  assert.deepEqual(openRegistry(dir, { sqlite: null }).list(), [])
})

ok('a closed db refuses to be used', () => {
  const { db } = make()
  db.close()
  db.close()
  assert.throws(() => db.create('note', { name: 'x' }, 'noor'), /closed/)
  assert.throws(() => db.list('note'), /closed/)
})

ok('reads of an unknown object are a programming error', () => {
  const { db } = make()
  assert.throws(() => db.list('ghost'), /no such object/)
  assert.throws(() => db.count('ghost'), /no such object/)
})

ok('the journal reads by cursor, by object and by record', () => {
  const { db } = make()
  const a = db.create('task', { title: 'a' }, 'noor').record
  db.create('note', { name: 'n' }, 'noor')
  db.update('task', a.id, { title: 'a2' }, 'noor')
  const all = db.journal()
  assert.equal(all.length, 3)
  assert.deepEqual(db.journal({ after: 1 }).map((o) => o.seq), [2, 3])
  assert.deepEqual(db.journal({ object: 'note' }).map((o) => o.kind), ['create'])
  assert.deepEqual(db.journal({ record: a.id }).map((o) => o.kind), ['create', 'update'])
  assert.equal(db.journal({ limit: 2 }).length, 2)
  assert.equal(db.journal({ after: 99 }).length, 0)
})

// ---------------------------------------------------------------- attachments
ok('an attachment is a file in blobs/<sha256>, named by what it holds', () => {
  const { dir, db } = make()
  const bytes = Buffer.from('%PDF-1.4 hello')
  const a = db.attach(bytes, { name: 'brief.pdf', type: 'application/pdf' })
  assert.ok(a.ok, a.message)
  assert.deepEqual(a.file, { name: 'brief.pdf', size: bytes.length, type: 'application/pdf', hash: hashOf(bytes) })
  assert.ok(existsSync(join(dir, 'blobs', a.file.hash)))
  assert.deepEqual(db.blobs.get(a.file.hash), bytes)
  assert.equal(db.blobs.has(a.file.hash), true)

  const twice = db.attach(bytes, { name: 'copy.pdf', type: 'application/pdf' })
  assert.deepEqual(readdirSync(join(dir, 'blobs')), [a.file.hash])
  const r = db.create('task', { title: 'With files', files: [a.file, twice.file] }, 'noor')
  assert.ok(r.ok, r.message)
  assert.deepEqual(db.get('task', r.record.id).values.files.map((f) => f.name), ['brief.pdf', 'copy.pdf'])
  assert.deepEqual(db.blobs.list(), [a.file.hash])
})

ok('an attachment is refused when it is not bytes, too big or badly described', () => {
  const { dir, db } = make()
  assert.equal(db.attach('text', { name: 'a.txt', type: 'text/plain' }).code, 'type')
  assert.equal(db.attach(Buffer.from('x'), { name: 'a/b.txt', type: 'text/plain' }).code, 'format')
  assert.equal(db.attach(Buffer.from('x'), { name: 'a.txt', type: 'plain' }).code, 'format')
  assert.equal(db.attach(Buffer.from('x'), null).ok, false)
  assert.equal(db.attach(Buffer.alloc(25 * 1024 * 1024 + 1), { name: 'big.bin', type: 'application/octet-stream' }).code, 'too-big')
  assert.equal(db.attach(Buffer.alloc(25 * 1024 * 1024), { name: 'edge.bin', type: 'application/octet-stream' }).ok, true)
  assert.equal(existsSync(join(dir, 'blobs', hashOf(Buffer.alloc(25 * 1024 * 1024 + 1)))), false)
})

ok('a blob that was changed on disk is not served, and a name that is not a hash reads nothing', () => {
  const dir = fresh()
  const blobs = openBlobs(join(dir, 'blobs'))
  assert.deepEqual(blobs.list(), [])
  assert.equal(existsSync(join(dir, 'blobs')), false, 'nothing is created before the first file')
  const put = blobs.put(Buffer.from('original'))
  writeFileSync(join(dir, 'blobs', put.hash), 'tampered')
  assert.equal(blobs.get(put.hash), null)
  assert.equal(blobs.get('../../etc/passwd'), null)
  assert.equal(blobs.get('A'.repeat(64)), null)
  assert.equal(blobs.has('../x'), false)
  assert.equal(blobs.get('0'.repeat(64)), null)
  assert.equal(blobs.put('not bytes').code, 'type')
  assert.equal(blobs.put(Buffer.from('abcd'), 3).code, 'too-big')
  assert.deepEqual(readdirSync(join(dir, 'blobs')).filter((f) => f.endsWith('.tmp')), [])
})

// ---------------------------------------------------------------- the folder of dbs
ok('the fingerprint moves with any change of structure, record or view, and with nothing else', () => {
  const { db } = make()
  let last = db.fingerprint()
  const moved = (label) => { const s = db.fingerprint(); assert.notEqual(s, last, label + ' moves the fingerprint'); last = s; assert.equal(db.fingerprint(), s, 'reading does not') }
  const made = db.create('task', { title: 'a' }, 'noor')
  moved('a record created')
  db.update('task', made.record.id, { title: 'b' }, 'noor')
  moved('a record changed')
  db.remove('task', made.record.id, 'noor')
  moved('a record deleted')
  db.restore('task', made.record.id, 'noor')
  moved('a record restored')
  db.addField('task', { key: 'extra', type: 'text', label: 'Extra' }, 'noor')
  moved('a field added')
  const v = db.saveView('task', { name: 'V', kind: 'table' }, 'noor')
  moved('a view created')
  db.saveView('task', { ...v.view, name: 'W' }, 'noor')
  moved('a view renamed')
  db.removeView('task', v.view.id)
  moved('a view removed')
  const before = db.fingerprint()
  db.update('task', made.record.id, { title: 'b' }, 'noor')
  assert.equal(db.fingerprint(), before, 'a change that changes nothing leaves it')
})

ok('a folder of dbs lists them by their own meta and opens them by id', () => {
  const dir = fresh()
  const reg = openRegistry(dir, { now: clock().now, random: sequence() })
  assert.deepEqual(reg.list(), [])
  const a = reg.create({ name: 'Home', by: 'noor', objects: [NOTE] })
  const b = reg.create({ name: 'Work', by: 'noor', objects: [TASK] })
  assert.ok(a.ok && b.ok, a.message)
  const ia = a.db.info()
  assert.ok(existsSync(join(dir, ia.id, 'db.sqlite')))
  a.db.attach(Buffer.from('x'), { name: 'a.txt', type: 'text/plain' })
  assert.ok(existsSync(join(dir, ia.id, 'blobs')))
  a.db.close(); b.db.close()

  mkdirSync(join(dir, '01ARYZ6S410000000000000001')) // a folder with no db in it
  mkdirSync(join(dir, 'notes')) // not an id
  const listed = reg.list()
  assert.deepEqual(listed.map((d) => d.name), ['Home', 'Work'])
  assert.deepEqual(listed[0], { id: ia.id, name: 'Home', format: FORMAT, created: ia.created, file: join(dir, ia.id, 'db.sqlite') })

  const back = reg.open(ia.id)
  assert.ok(back.ok)
  assert.equal(back.db.objects()[0].key, 'note')
  back.db.close()
  assert.equal(reg.open('01ARYZ6S410000000000000001').code, 'missing')
})

ok('an id from outside never leaves the folder', () => {
  const dir = fresh()
  const reg = openRegistry(dir)
  for (const bad of ['../x', '..', '', 'a/b', '/etc', '01ARYZ6S41000000000000000/', 5, null, undefined]) {
    assert.equal(reg.open(bad).code, 'invalid', String(bad))
  }
  assert.equal(reg.create({ name: 'X', by: 'noor', id: '../escape' }).code, 'invalid')
  assert.equal(existsSync(join(dir, '..', 'escape')), false)
  const made = reg.create({ name: 'X', by: 'noor', id: '01ARYZ6S410000000000000001' })
  assert.equal(made.ok, true)
  made.db.close()
  assert.equal(reg.create({ name: 'Y', by: 'noor', id: '01ARYZ6S410000000000000001' }).code, 'exists')
})

ok('a db file says what it is', () => {
  const { db, file } = make()
  db.close()
  assert.equal(readFileSync(file).subarray(0, 16).toString(), 'SQLite format 3\0')
  const h = raw(file)
  assert.equal(h.prepare('PRAGMA application_id').get().application_id, APPLICATION_ID)
  assert.equal(h.prepare('PRAGMA user_version').get().user_version, FORMAT)
  assert.equal(h.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
  h.close()
})

// ---------------------------------------------------------------- links
const SHOP = () => {
  const { dir, db, file } = make({ objects: [] })
  const def = (key, label, fields) => assert.ok(db.addObject({ key, label, title: 'name', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }, ...fields] }, 'noor').ok)
  def('customer', 'Customers', [])
  def('product', 'Products', [])
  def('order', 'Orders', [{ key: 'customer', type: 'relation', label: 'Customer', to: 'customer', inverse: 'Orders' }, { key: 'items', type: 'relation', label: 'Products', to: 'product', many: true }])
  def('invoice', 'Invoices', [{ key: 'customer', type: 'relation', label: 'Customer', to: 'customer' }])
  const mk = (object, values) => { const r = db.create(object, values, 'noor'); assert.ok(r.ok, r.message); return r.record.id }
  return { dir, db, file, mk }
}

ok('a link must point at a record that exists: a made-up id, an id of nothing, a deleted record are refused with the field named', () => {
  const { db, mk } = SHOP()
  const ada = mk('customer', { name: 'Ada' })
  const pen = mk('product', { name: 'Pen' })
  assert.ok(db.create('order', { name: 'O-1', customer: ada, items: [pen] }, 'noor').ok)
  const ghost = '01ARYZ6S410000000000000009'
  for (const values of [{ customer: ghost }, { items: [pen, ghost] }, { customer: pen }]) {
    const r = db.create('order', { name: 'O-x', ...values }, 'noor')
    assert.equal(r.ok, false)
    assert.equal(r.code, 'invalid')
    assert.equal(r.errors[0].code, 'link')
    assert.equal(r.errors[0].path, Object.keys(values)[0])
  }
  assert.equal(db.count('order'), 1, 'a refused write leaves nothing behind')
  db.remove('customer', ada, 'noor')
  const gone = db.create('order', { name: 'O-2', customer: ada }, 'noor')
  assert.equal(gone.errors[0].code, 'link', 'a deleted record is not a target')
  assert.equal(db.journal().filter((o) => o.kind === 'create' && o.object === 'order').length, 1)
})

ok('an update is judged only on the links it adds: a link whose target was deleted since can stay while something else changes', () => {
  const { db, mk } = SHOP()
  const ada = mk('customer', { name: 'Ada' })
  const bob = mk('customer', { name: 'Bob' })
  const pen = mk('product', { name: 'Pen' })
  const ink = mk('product', { name: 'Ink' })
  const order = mk('order', { name: 'O-1', customer: ada, items: [pen] })
  db.remove('customer', ada, 'noor')
  db.remove('product', pen, 'noor')
  assert.ok(db.update('order', order, { name: 'O-1 (paid)' }, 'noor').ok)
  assert.ok(db.update('order', order, { customer: ada }, 'noor').ok, 'writing the same link again changes nothing and is not asked')
  assert.ok(db.update('order', order, { items: [pen, ink] }, 'noor').ok, 'the link it already had stays, the one it adds exists')
  const bad = db.update('order', order, { items: [pen, '01ARYZ6S410000000000000009'] }, 'noor')
  assert.equal(bad.errors[0].code, 'link')
  assert.ok(db.update('order', order, { customer: bob }, 'noor').ok)
  assert.deepEqual(db.get('order', order).values.items, [pen, ink])
  db.restore('customer', ada, 'noor')
})

ok('an operation replayed with apply() is not judged: another device\'s operations can arrive before the record they point at', () => {
  const { db, mk } = SHOP()
  const ada = mk('customer', { name: 'Ada' })
  const op = { id: '01ARYZ6S4100000000000000AA', kind: 'create', object: 'order', record: '01ARYZ6S4100000000000000AB', by: 'noor', at: '2026-10-30T10:00:00.000Z', set: { name: 'Later', customer: '01ARYZ6S410000000000000009' } }
  const r = db.apply(op)
  assert.equal(r.ok, true, r.message)
  assert.ok(ada)
})

ok('what points at a record is found from every side: one group per link field, counted, the live records only', () => {
  const { db, mk } = SHOP()
  const ada = mk('customer', { name: 'Ada' })
  const bob = mk('customer', { name: 'Bob' })
  const pen = mk('product', { name: 'Pen' })
  const ink = mk('product', { name: 'Ink' })
  const o1 = mk('order', { name: 'O-1', customer: ada, items: [pen, ink] })
  const o2 = mk('order', { name: 'O-2', customer: ada, items: [pen] })
  const o3 = mk('order', { name: 'O-3', customer: bob })
  const inv = mk('invoice', { name: 'F-1', customer: ada })
  assert.deepEqual(db.backlinks('customer', ada), [{ object: 'order', field: 'customer', count: 2, ids: [o1, o2] }, { object: 'invoice', field: 'customer', count: 1, ids: [inv] }])
  assert.deepEqual(db.backlinks('customer', bob), [{ object: 'order', field: 'customer', count: 1, ids: [o3] }, { object: 'invoice', field: 'customer', count: 0, ids: [] }])
  assert.deepEqual(db.backlinks('product', pen), [{ object: 'order', field: 'items', count: 2, ids: [o1, o2] }])
  assert.deepEqual(db.backlinks('product', ink), [{ object: 'order', field: 'items', count: 1, ids: [o1] }])
  assert.deepEqual(db.backlinks('order', o1), [], 'nothing points at an order')
  db.remove('order', o1, 'noor')
  assert.deepEqual(db.backlinks('product', ink), [{ object: 'order', field: 'items', count: 0, ids: [] }], 'a deleted record no longer counts')
  db.restore('order', o1, 'noor')
  assert.equal(db.backlinks('product', ink)[0].count, 1, 'and counts again once restored')
  assert.deepEqual(db.backlinks('customer', 'not-an-id').map((g) => g.count), [0, 0])
  assert.throws(() => db.backlinks('ghost', ada), /no such object/)
})

ok('the first records of a group are listed up to the limit, and the count is the whole', () => {
  const { db, mk } = SHOP()
  const ada = mk('customer', { name: 'Ada' })
  const ids = []
  for (let i = 0; i < 7; i++) ids.push(mk('order', { name: 'O-' + i, customer: ada }))
  const g = db.backlinks('customer', ada, { limit: 3 })[0]
  assert.equal(g.count, 7)
  assert.deepEqual(g.ids, ids.slice(0, 3))
  assert.equal(db.backlinks('customer', ada, { limit: 5000 })[0].ids.length, 7, 'the limit is capped, not trusted')
})

ok('a link field keeps the name it shows under on the other side, and that name can change later', () => {
  const { db, dir } = SHOP()
  const f = db.objects().find((o) => o.key === 'order').fields.find((x) => x.key === 'customer')
  assert.equal(f.inverse, 'Orders')
  assert.equal(db.objects().find((o) => o.key === 'order').fields.find((x) => x.key === 'items').inverse, undefined)
  const r = db.updateField('order', 'customer', { inverse: 'Purchases' }, 'noor')
  assert.ok(r.ok && r.applied, r.message)
  assert.equal(open(dir).objects().find((o) => o.key === 'order').fields.find((x) => x.key === 'customer').inverse, 'Purchases')
  assert.equal(db.updateField('order', 'name', { inverse: 'x' }, 'noor').ok, false, 'only a link has one')
  assert.equal(db.updateField('order', 'customer', { to: 'product' }, 'noor').code, 'invalid', 'the target never changes')
})

rmSync(root, { recursive: true, force: true })
console.log('\n' + count + ' checks passed')
