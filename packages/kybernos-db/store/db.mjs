// A db: one SQLite file (`dbs/<id>/db.sqlite`) with its attachments next to it (`blobs/<sha256>`).
//
// The file is the source of truth and is meant to be readable by anything: one table per object, one column per field (see schema.mjs). The engine writes through
// the core's operations, so every change is a record row AND a journal row in one transaction. Raw SQL from another connection is welcome too: triggers journal it
// (source « sql ») and keep `rev` and the stamps true. `verify()` replays the journal and says whether the tables still agree with it.
//
// Failures a caller can cause come back as `{ ok: false, code, message, errors? }` (the core's shape); only a broken environment throws.
// Not here yet: removing or renaming objects and fields, changing a field's type, views, the check that a relation points at a real record, rights (core/rights.mjs
// is asked by the caller), the sync with the server.

import { chmodSync, closeSync, existsSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { applyOp, buildCreate, buildUpdate, checkView, isPlain, isUlid, normalizeField, normalizeValue, normalizeView, sameJson } from '../core/index.mjs'
import { MAX_FIELDS, MAX_OBJECTS, changeField, changeObject, findObject, normalizeObject } from './catalog.mjs'
import { fromColumn, toColumn } from './columns.mjs'
import { hashOf, openBlobs } from './blobs.mjs'
import { APPLICATION_ID, BASE_DDL, FORMAT, addColumnSql, createTableSql, dropTriggersSql, q, tableName, triggersSql } from './schema.mjs'
import { BUSY_MS, enterWal, sqliteOf } from './sqlite.mjs'
import { makeUlid } from './ulid.mjs'

const CONTROL = /[\u0000-\u001f\u007f]/
const refuse = (code, message, extra) => ({ ok: false, code, message, ...extra })
const invalid = (errors) => refuse('invalid', (errors[0].path ? errors[0].path + ': ' : '') + errors[0].message, { errors })
const validBy = (by) => typeof by === 'string' && by.length >= 1 && by.length <= 64
const validName = (name) => typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 80 && !CONTROL.test(name)

/** The ports: `now()` epoch milliseconds, `random(n)` n random bytes, `sqlite` the binding (see sqlite.mjs). All optional. */
function makeDb (handle, file, ports) {
  const now = typeof ports.now === 'function' ? ports.now : Date.now
  const random = typeof ports.random === 'function' ? ports.random : (n) => randomBytes(n)
  const nextId = makeUlid({ now, random })
  const blobs = openBlobs(join(dirname(file), 'blobs'))
  const prepare = (sql) => handle.prepare(sql)
  let closed = false
  let depth = 0
  let cat = null

  const live = () => { if (closed) throw new Error('the db is closed') }
  const stamp = () => { const t = now(); return { t, at: new Date(t).toISOString() } }

  // The structure, re-read whenever another connection has changed it (inside a write that is inside the lock, so it cannot change under the write).
  const catalog = () => {
    const version = prepare('SELECT max(version) AS v FROM catalog').get().v
    if (cat === null || cat.version !== version) cat = { version, objects: JSON.parse(prepare('SELECT json FROM catalog WHERE version = ?').get(version).json).objects }
    return cat
  }
  const objOf = (key) => findObject(catalog().objects, key)
  const need = (key) => { const obj = objOf(key); if (!obj) throw new RangeError('no such object: ' + key); return obj }

  const setQuiet = (on) => prepare("UPDATE ctl SET v = ? WHERE k = 'quiet'").run(on)
  /**
   * A write: one `BEGIN IMMEDIATE` … `COMMIT`, and a write started inside a write joins it. The triggers that journal raw SQL are switched off for the engine's own
   * writes (it journals them itself). A refusal is decided before the first write, so it commits nothing; a failure in the middle rolls everything back.
   */
  const write = (fn) => {
    live()
    if (depth > 0) return fn()
    handle.exec('BEGIN IMMEDIATE')
    depth = 1
    try {
      setQuiet(1)
      const out = fn()
      setQuiet(0)
      handle.exec('COMMIT')
      return out
    } catch (e) {
      try { handle.exec('ROLLBACK') } catch (e2) { /* the engine already rolled back */ }
      cat = null
      throw e
    } finally { depth = 0 }
  }

  const toRecord = (obj, row) => {
    const values = {}
    for (const f of obj.fields) values[f.key] = fromColumn(f, row[f.key])
    return {
      id: row.id,
      values,
      rev: Number(row.rev),
      created: { by: row.created_by, at: row.created_at },
      modified: { by: row.modified_by, at: row.modified_at },
      deleted: row.deleted_at === null ? null : { by: row.deleted_by === null ? 'sql' : row.deleted_by, at: row.deleted_at },
    }
  }
  const readRecord = (obj, id) => {
    const row = prepare(`SELECT * FROM ${q(tableName(obj.key))} WHERE id = ?`).get(id)
    return row === undefined ? null : toRecord(obj, row)
  }

  /** Writes the row an operation produced. */
  const persist = (obj, after, op) => {
    const t = q(tableName(obj.key))
    if (op.kind === 'create') {
      const cols = ['id', 'rev', 'created_by', 'created_at', 'modified_by', 'modified_at', ...obj.fields.map((f) => f.key)]
      const vals = [after.id, after.rev, after.created.by, after.created.at, after.modified.by, after.modified.at, ...obj.fields.map((f) => toColumn(f, after.values[f.key]))]
      prepare(`INSERT INTO ${t} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals)
      return
    }
    const sets = [['rev', after.rev], ['modified_by', after.modified.by], ['modified_at', after.modified.at]]
    if (op.kind === 'update') for (const key of Object.keys(op.set)) sets.push([key, toColumn(obj.fields.find((f) => f.key === key), op.set[key])])
    else sets.push(['deleted_by', after.deleted ? after.deleted.by : null], ['deleted_at', after.deleted ? after.deleted.at : null])
    prepare(`UPDATE ${t} SET ${sets.map(([c]) => q(c) + ' = ?').join(', ')} WHERE id = ?`).run(...sets.map((s) => s[1]), after.id)
  }

  /** Applies a finished operation (it has its id, author and time): the way to replay what another device did. Applying the same operation twice does nothing. */
  const apply = (op) => write(() => {
    const obj = objOf(isPlain(op) ? op.object : undefined)
    if (!obj) return refuse('unknown-object', 'no such object')
    if (typeof op.id === 'string' && prepare('SELECT 1 AS x FROM ops WHERE id = ?').get(op.id) !== undefined) return { ok: true, record: readRecord(obj, op.record), applied: false }
    const before = isUlid(op.record) ? readRecord(obj, op.record) : null
    const r = applyOp(before, op, obj)
    if (!r.ok) return r
    if (r.record !== before) persist(obj, r.record, op)
    prepare('INSERT INTO ops (id, kind, object, record, set_json, prev_json, actor, at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      op.id, op.kind, op.object, op.record, op.set === undefined ? null : JSON.stringify(op.set), op.prev === undefined ? null : JSON.stringify(op.prev), op.by, op.at, 'engine')
    return { ok: true, record: r.record, applied: true }
  })

  const create = (objectKey, values, by) => write(() => {
    const obj = objOf(objectKey)
    if (!obj) return refuse('unknown-object', 'no such object')
    const { t, at } = stamp()
    const built = buildCreate(obj, values, { id: nextId(t), record: nextId(t), by, at })
    return built.ok ? apply(built.op) : invalid(built.errors)
  })

  const update = (objectKey, id, changes, by) => write(() => {
    const obj = objOf(objectKey)
    if (!obj) return refuse('unknown-object', 'no such object')
    const before = isUlid(id) ? readRecord(obj, id) : null
    if (!before) return refuse('missing', 'no such record')
    if (before.deleted) return refuse('deleted', 'the record is deleted')
    const { t, at } = stamp()
    const built = buildUpdate(obj, before, changes, { id: nextId(t), by, at })
    if (!built.ok) return invalid(built.errors)
    return built.op === null ? { ok: true, record: before, applied: false } : apply(built.op)
  })

  const mark = (kind) => (objectKey, id, by) => write(() => {
    const obj = objOf(objectKey)
    if (!obj) return refuse('unknown-object', 'no such object')
    const before = isUlid(id) ? readRecord(obj, id) : null
    if (!before) return refuse('missing', 'no such record')
    if ((kind === 'delete') === (before.deleted !== null)) return { ok: true, record: before, applied: false }
    const { t, at } = stamp()
    return apply({ id: nextId(t), kind, object: obj.key, record: id, by, at })
  })

  const get = (objectKey, id) => { live(); return isUlid(id) ? readRecord(need(objectKey), id) : null }
  /** The records of an object, oldest first. By default the live ones; `{ deleted: true }` for the deleted ones, `{ deleted: 'all' }` for both. */
  const list = (objectKey, opts = {}) => {
    live()
    const obj = need(objectKey)
    const where = opts.deleted === 'all' ? '' : opts.deleted === true ? 'WHERE deleted_at IS NOT NULL' : 'WHERE deleted_at IS NULL'
    return prepare(`SELECT * FROM ${q(tableName(obj.key))} ${where} ORDER BY id`).all().map((row) => toRecord(obj, row))
  }
  const count = (objectKey) => { live(); return Number(prepare(`SELECT count(*) AS n FROM ${q(tableName(need(objectKey).key))} WHERE deleted_at IS NULL`).get().n) }

  /** Gives an id to the operations that raw SQL made (the triggers cannot make one). Returns how many it sealed. */
  const seal = () => {
    live()
    if (prepare('SELECT 1 AS x FROM ops WHERE id IS NULL LIMIT 1').get() === undefined) return 0
    return write(() => {
      const rows = prepare('SELECT seq, at FROM ops WHERE id IS NULL ORDER BY seq').all()
      const set = prepare('UPDATE ops SET id = ? WHERE seq = ?')
      for (const r of rows) set.run(nextId(Date.parse(r.at)), r.seq)
      return rows.length
    })
  }

  const toOp = (row) => {
    const op = { id: row.id, kind: row.kind, object: row.object, record: row.record, by: row.actor, at: row.at }
    if (row.set_json !== null) op.set = JSON.parse(row.set_json)
    if (row.prev_json !== null) op.prev = JSON.parse(row.prev_json)
    return op
  }
  /** The journal, in the order things happened: `[{ seq, source, id, kind, object, record, set?, prev?, by, at }]`. `after` is the last `seq` already seen. */
  const journal = (opts = {}) => {
    seal()
    const where = ['seq > ?']
    const args = [Number.isInteger(opts.after) ? opts.after : 0]
    if (opts.object !== undefined) { where.push('object = ?'); args.push(opts.object) }
    if (opts.record !== undefined) { where.push('record = ?'); args.push(opts.record) }
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 10000) : 1000
    return prepare(`SELECT * FROM ops WHERE ${where.join(' AND ')} ORDER BY seq LIMIT ${limit}`).all(...args).map((row) => ({ seq: Number(row.seq), source: row.source, ...toOp(row) }))
  }

  /** Is every cell of a canonical value, and do the tables still say what the journal says? `{ ok, problems: [{ code, message, object?, record?, field?, op? }] }`. */
  const verify = () => {
    seal()
    const problems = []
    const add = (code, message, extra) => problems.push({ code, message, ...extra })
    const stored = new Map()
    const { objects } = catalog()
    for (const obj of objects) {
      for (const row of prepare(`SELECT * FROM ${q(tableName(obj.key))} ORDER BY id`).all()) {
        const rec = toRecord(obj, row)
        stored.set(obj.key + '/' + rec.id, rec)
        for (const f of obj.fields) {
          const v = rec.values[f.key]
          const r = normalizeValue(f, v)
          if (!r.ok || !sameJson(r.value, v)) add('value', f.key + ': ' + (r.ok ? 'not in its canonical form' : r.message), { object: obj.key, record: rec.id, field: f.key })
          else if (f.required && f.type !== 'checkbox' && v === null) add('required', f.key + ' is required', { object: obj.key, record: rec.id, field: f.key })
        }
      }
    }
    for (const row of prepare('SELECT id, object, json FROM views ORDER BY id').all()) {
      const obj = findObject(objects, row.object)
      if (!obj) { add('view', 'the view belongs to an object that does not exist', { object: row.object, view: row.id }); continue }
      const errors = checkView(JSON.parse(row.json), obj)
      if (errors.length) add('view', (errors[0].path ? errors[0].path + ': ' : '') + errors[0].message, { object: row.object, view: row.id })
    }
    const replayed = new Map()
    const broken = new Set()
    for (const row of prepare('SELECT * FROM ops ORDER BY seq').iterate()) {
      const op = toOp(row)
      const obj = findObject(objects, op.object)
      const key = op.object + '/' + op.record
      if (broken.has(key)) continue
      const r = obj ? applyOp(replayed.get(key) || null, op, obj) : refuse('unknown-object', 'no such object')
      if (!r.ok) { broken.add(key); add('journal', r.code + ': ' + r.message, { object: op.object, record: op.record, op: op.id }); continue }
      replayed.set(key, r.record)
    }
    for (const [key, rec] of stored) {
      if (broken.has(key)) continue
      const again = replayed.get(key)
      const where = { object: key.slice(0, key.indexOf('/')), record: rec.id }
      if (!again) add('no-journal', 'the record is in the table but not in the journal', where)
      else if (!sameJson(rec, again)) add('mismatch', 'the table and the journal disagree about this record', where)
    }
    for (const key of replayed.keys()) if (!stored.has(key) && !broken.has(key)) add('missing-row', 'the journal has a record the table has not', { object: key.slice(0, key.indexOf('/')), record: key.slice(key.indexOf('/') + 1) })
    return { ok: problems.length === 0, problems }
  }

  const commitCatalog = (change, by, objects) => {
    const version = catalog().version + 1
    prepare('INSERT INTO catalog (version, change, actor, at, json) VALUES (?, ?, ?, ?, ?)').run(version, change, by, stamp().at, JSON.stringify({ objects }))
    cat = { version, objects }
    return version
  }

  const addObject = (def, by) => {
    live()
    const n = normalizeObject(def)
    if (!n.ok) return invalid(n.errors)
    if (!validBy(by)) return invalid([{ path: 'by', code: 'by', message: 'who did it: 1 to 64 characters' }])
    return write(() => {
      const { objects } = catalog()
      if (findObject(objects, n.object.key)) return refuse('exists', 'there is already an object with this key')
      if (objects.length >= MAX_OBJECTS) return refuse('too-many', 'a db has at most ' + MAX_OBJECTS + ' objects')
      handle.exec(createTableSql(n.object))
      for (const sql of triggersSql(n.object)) handle.exec(sql)
      return { ok: true, version: commitCatalog('add-object:' + n.object.key, by, [...objects, n.object]), object: structuredClone(n.object) }
    })
  }

  const addField = (objectKey, def, by) => {
    live()
    const n = normalizeField(def)
    if (!n.ok) return invalid(n.errors)
    if (!validBy(by)) return invalid([{ path: 'by', code: 'by', message: 'who did it: 1 to 64 characters' }])
    return write(() => {
      const { objects } = catalog()
      const obj = findObject(objects, objectKey)
      if (!obj) return refuse('unknown-object', 'no such object')
      const field = n.field
      if (obj.fields.some((f) => f.key === field.key)) return refuse('exists', 'the object already has a field with this key')
      if (obj.fields.length >= MAX_FIELDS) return refuse('too-many', 'an object has at most ' + MAX_FIELDS + ' fields')
      if (field.required && field.type !== 'checkbox' && prepare(`SELECT 1 AS x FROM ${q(tableName(obj.key))} LIMIT 1`).get() !== undefined) {
        return refuse('needs-default', 'the existing records would have no value: add the field as optional')
      }
      const next = { ...obj, fields: [...obj.fields, field] }
      handle.exec(addColumnSql(obj, field))
      for (const sql of dropTriggersSql(obj)) handle.exec(sql)
      for (const sql of triggersSql(next)) handle.exec(sql)
      return { ok: true, version: commitCatalog('add-field:' + obj.key + '.' + field.key, by, objects.map((o) => (o === obj ? next : o))), field: structuredClone(field) }
    })
  }

  const updateObject = (objectKey, changes, by) => {
    live()
    if (!validBy(by)) return invalid([{ path: 'by', code: 'by', message: 'who did it: 1 to 64 characters' }])
    return write(() => {
      const { objects } = catalog()
      const obj = findObject(objects, objectKey)
      if (!obj) return refuse('unknown-object', 'no such object')
      const n = changeObject(obj, changes)
      if (!n.ok) return invalid(n.errors)
      if (sameJson(n.object, obj)) return { ok: true, applied: false, object: structuredClone(obj) }
      return { ok: true, applied: true, version: commitCatalog('update-object:' + obj.key, by, objects.map((o) => (o === obj ? n.object : o))), object: structuredClone(n.object) }
    })
  }

  const updateField = (objectKey, fieldKey, changes, by) => {
    live()
    if (!validBy(by)) return invalid([{ path: 'by', code: 'by', message: 'who did it: 1 to 64 characters' }])
    return write(() => {
      const { objects } = catalog()
      const obj = findObject(objects, objectKey)
      if (!obj) return refuse('unknown-object', 'no such object')
      const field = obj.fields.find((f) => f.key === fieldKey)
      if (!field) return refuse('unknown-field', 'no such field')
      const n = changeField(field, changes)
      if (!n.ok) return invalid(n.errors)
      if (sameJson(n.field, field)) return { ok: true, applied: false, field: structuredClone(field) }
      const next = { ...obj, fields: obj.fields.map((f) => (f === field ? n.field : f)) }
      return { ok: true, applied: true, version: commitCatalog('update-field:' + obj.key + '.' + field.key, by, objects.map((o) => (o === obj ? next : o))), field: structuredClone(n.field) }
    })
  }

  // Views: edited in place, a save that changes nothing writes nothing (the toolbar saves on every click).
  const viewsOf = (obj) => prepare('SELECT id, json FROM views WHERE object = ? ORDER BY created_at, id').all(obj.key).map((r) => JSON.parse(r.json))
  const saveView = (objectKey, view, by) => write(() => {
    const obj = objOf(objectKey)
    if (!obj) return refuse('unknown-object', 'no such object')
    if (!validBy(by)) return invalid([{ path: 'by', code: 'by', message: 'who did it: 1 to 64 characters' }])
    const { t, at } = stamp()
    const given = isPlain(view) ? view : {}
    const n = normalizeView({ ...given, id: given.id === undefined ? nextId(t) : given.id }, obj)
    if (!n.ok) return invalid(n.errors)
    const row = prepare('SELECT object, json FROM views WHERE id = ?').get(n.view.id)
    if (row === undefined) {
      prepare('INSERT INTO views (id, object, json, rev, created_by, created_at, modified_by, modified_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)').run(n.view.id, obj.key, JSON.stringify(n.view), by, at, by, at)
      return { ok: true, view: n.view, applied: true, created: true }
    }
    if (row.object !== obj.key) return refuse('exists', 'a view with this id belongs to another object')
    if (sameJson(JSON.parse(row.json), n.view)) return { ok: true, view: n.view, applied: false, created: false }
    prepare('UPDATE views SET json = ?, rev = rev + 1, modified_by = ?, modified_at = ? WHERE id = ?').run(JSON.stringify(n.view), by, at, n.view.id)
    return { ok: true, view: n.view, applied: true, created: false }
  })
  const listViews = (objectKey) => { live(); return viewsOf(need(objectKey)) }
  const getView = (objectKey, id) => {
    live()
    const row = prepare('SELECT json FROM views WHERE object = ? AND id = ?').get(need(objectKey).key, String(id))
    return row === undefined ? null : JSON.parse(row.json)
  }
  /** Who last saved each view of an object and when: `{ [id]: { rev, by, at } }`, so a page can tell its own save from the agent's. */
  const viewStamps = (objectKey) => {
    live()
    const out = {}
    for (const r of prepare('SELECT id, rev, modified_by, modified_at FROM views WHERE object = ?').all(need(objectKey).key)) out[r.id] = { rev: Number(r.rev), by: r.modified_by, at: r.modified_at }
    return out
  }
  const removeView = (objectKey, id) => write(() => {
    const obj = objOf(objectKey)
    if (!obj) return refuse('unknown-object', 'no such object')
    return { ok: true, removed: Number(prepare('DELETE FROM views WHERE object = ? AND id = ?').run(obj.key, String(id)).changes) > 0 }
  })

  const info = () => {
    live()
    const meta = Object.fromEntries(prepare('SELECT k, v FROM meta').all().map((r) => [r.k, r.v]))
    return { id: meta.id, name: meta.name, format: FORMAT, version: catalog().version, created: { by: meta.created_by, at: meta.created_at } }
  }

  /**
   * A short text (the fingerprint) that changes whenever anything in the db does: the structure, a record (the journal moves, raw SQL included once the triggers write it) or a
   * view. A page polls it to know when to read again; two equal fingerprints mean nothing changed in between.
   */
  const fingerprint = () => {
    live()
    const ops = prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM ops').get().n
    const views = prepare('SELECT COUNT(*) AS n, COALESCE(SUM(rev), 0) AS r FROM views').get()
    return [catalog().version, Number(ops), Number(views.n), Number(views.r)].join('.')
  }

  /** Stores a file next to the db and gives the value to put in an attachment field: `{ ok: true, file: { name, size, type, hash } }`. */
  const attach = (bytes, meta) => {
    live()
    if (!(bytes instanceof Uint8Array)) return refuse('type', 'a file is bytes (a Buffer or a Uint8Array)')
    const given = isPlain(meta) ? meta : {}
    const r = normalizeValue({ type: 'attachment' }, [{ name: given.name, size: bytes.length, type: given.type, hash: hashOf(bytes) }])
    if (!r.ok) return refuse(r.code, r.message)
    const put = blobs.put(bytes)
    return put.ok ? { ok: true, file: r.value[0] } : put
  }

  return {
    file,
    blobs,
    info,
    fingerprint,
    objects: () => { live(); return structuredClone(catalog().objects) },
    addObject,
    addField,
    updateObject,
    updateField,
    saveView,
    listViews,
    getView,
    viewStamps,
    removeView,
    create,
    update,
    remove: mark('delete'),
    restore: mark('restore'),
    apply,
    get,
    list,
    count,
    journal,
    seal,
    verify,
    attach,
    close () { if (!closed) { closed = true; handle.close() } },
  }
}

/**
 * Creates a db file: `{ ok: true, db }`. `def` is `{ name, by, id?, objects? }`; `objects` are created with it (see catalog.mjs). A path that is taken is never touched.
 * Codes: invalid, exists, sqlite_unavailable.
 */
export function createDb (file, def, ports = {}) {
  const lib = sqliteOf(ports)
  if (lib === null) return refuse('sqlite_unavailable', 'node:sqlite is not available in this Node')
  if (!isPlain(def)) return invalid([{ path: '', code: 'shape', message: 'a db is { name, by, objects? }' }])
  const errors = []
  if (!validName(def.name)) errors.push({ path: 'name', code: 'name', message: 'a name is 1 to 80 characters' })
  if (!validBy(def.by)) errors.push({ path: 'by', code: 'by', message: 'who creates it: 1 to 64 characters' })
  if (def.id !== undefined && !isUlid(def.id)) errors.push({ path: 'id', code: 'id', message: 'a db id is a ULID' })
  const objects = []
  const given = def.objects === undefined ? [] : def.objects
  if (!Array.isArray(given) || given.length > MAX_OBJECTS) errors.push({ path: 'objects', code: 'objects', message: 'a list of at most ' + MAX_OBJECTS + ' objects' })
  else {
    given.forEach((raw, i) => {
      const r = normalizeObject(raw)
      if (!r.ok) for (const e of r.errors) errors.push({ ...e, path: 'objects.' + i + (e.path ? '.' + e.path : '') })
      else if (objects.some((o) => o.key === r.object.key)) errors.push({ path: 'objects.' + i + '.key', code: 'duplicate', message: 'two objects share this key' })
      else objects.push(r.object)
    })
  }
  if (errors.length) return invalid(errors)

  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  try { closeSync(openSync(file, 'wx', 0o600)) } catch (e) {
    if (e && e.code === 'EEXIST') return refuse('exists', 'there is already a file there')
    throw e
  }
  const now = typeof ports.now === 'function' ? ports.now : Date.now
  const random = typeof ports.random === 'function' ? ports.random : (n) => randomBytes(n)
  const handle = new lib.DatabaseSync(file)
  let db = null
  try {
    handle.exec('PRAGMA busy_timeout = ' + BUSY_MS)
    enterWal(handle)
    try { chmodSync(file, 0o600) } catch (e) { /* private to the owner where the platform allows it */ }
    handle.exec('PRAGMA synchronous = NORMAL')
    handle.exec('PRAGMA foreign_keys = ON')
    const at = new Date(now()).toISOString()
    handle.exec('BEGIN IMMEDIATE')
    for (const sql of BASE_DDL) handle.exec(sql)
    handle.exec('PRAGMA application_id = ' + APPLICATION_ID)
    handle.exec('PRAGMA user_version = ' + FORMAT)
    const meta = handle.prepare('INSERT INTO meta (k, v) VALUES (?, ?)')
    for (const [k, v] of [['id', def.id || makeUlid({ now, random })()], ['name', def.name.trim()], ['created_by', def.by], ['created_at', at]]) meta.run(k, v)
    handle.prepare('INSERT INTO catalog (version, change, actor, at, json) VALUES (1, ?, ?, ?, ?)').run('create', def.by, at, '{"objects":[]}')
    handle.exec('COMMIT')
    db = makeDb(handle, file, ports)
    for (const o of objects) {
      const r = db.addObject(o, def.by)
      if (!r.ok) throw new Error('could not create object ' + o.key + ': ' + r.message)
    }
    return { ok: true, db }
  } catch (e) {
    try { handle.close() } catch (e2) { /* already closed */ }
    for (const f of [file, file + '-wal', file + '-shm']) try { rmSync(f, { force: true }) } catch (e2) { /* nothing left to remove */ }
    throw e
  }
}

/** Opens an existing db file: `{ ok: true, db }`. Codes: missing, not_a_db, db_newer (written by a newer Kybernos: it is refused, never opened), sqlite_unavailable. */
export function openDb (file, ports = {}) {
  const lib = sqliteOf(ports)
  if (lib === null) return refuse('sqlite_unavailable', 'node:sqlite is not available in this Node')
  if (!existsSync(file)) return refuse('missing', 'no such db file')
  const handle = new lib.DatabaseSync(file)
  let opened = false
  try {
    handle.exec('PRAGMA busy_timeout = ' + BUSY_MS)
    const appId = Number(handle.prepare('PRAGMA application_id').get().application_id)
    const format = Number(handle.prepare('PRAGMA user_version').get().user_version)
    if (appId !== APPLICATION_ID || format < 1) return refuse('not_a_db', 'this file is not a Kybernos db')
    if (format > FORMAT) return refuse('db_newer', 'this db was written by a newer Kybernos (format ' + format + '): update Kybernos to open it')
    enterWal(handle)
    handle.exec('PRAGMA synchronous = NORMAL')
    handle.exec('PRAGMA foreign_keys = ON')
    const db = makeDb(handle, file, ports)
    db.info() // reads the db's own tables: a file that only looks like one fails here
    opened = true
    return { ok: true, db }
  } catch (e) {
    if (/not a database|malformed|no such table|no such column|disk image/i.test(String(e && e.message))) return refuse('not_a_db', 'this file is not a Kybernos db')
    throw e
  } finally {
    if (!opened) try { handle.close() } catch (e) { /* already closed */ }
  }
}
