// A db: one SQLite file (`dbs/<id>/db.sqlite`) with its attachments next to it (`blobs/<sha256>`).
//
// The file is the source of truth and is meant to be readable by anything: one table per object, one column per field (see schema.mjs). The engine writes through
// the core's operations, so every change is a record row AND a journal row in one transaction. Raw SQL from another connection is welcome too: triggers journal it
// (source « sql ») and keep `rev` and the stamps true. `verify()` replays the journal and says whether the tables still agree with it.
//
// Failures a caller can cause come back as `{ ok: false, code, message, errors? }` (the core's shape); only a broken environment throws.
// A link written through `create` or `update` must point at a record that exists and is not deleted (`invalid`, code `link`); an operation replayed with `apply` is not
// judged, because another device's operations can arrive before the record they point at. A deleted record keeps the links that point at it (a restore brings them back).
// An attachment is stored with `attach(bytes, { name, type }, cap)` (the cap of the field, at most the core's) and the record then holds `{ name, size, type, hash }`; `gc()` removes
// the files no record holds (deleted records still hold theirs) once they are older than `GC_GRACE_MS`, and storing the same bytes again renews a file's age.
// An object, or the whole db, is put away before it can go: `archiveObject`/`restoreObject` and `archive`/`unarchive` hide it and refuse every write until it is restored;
// only an archived object can be deleted for good (`deleteObject`: its table, records, history, views and files go, the links that pointed at it are cut from the objects
// that held them, and the journal is rewritten so that `verify()` stays true). Deleting the whole db is the registry's (store/root.mjs).
// Not here yet: removing or renaming single fields, changing a field's type, rights (core/rights.mjs is asked by the caller), the sync with the server.

import { chmodSync, closeSync, existsSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { MAX_ATTACHMENT_BYTES, applyOp, buildCreate, buildUpdate, checkView, isPlain, isUlid, normalizeField, normalizeProfiles, normalizeValue, normalizeView, repairView, sameJson } from '../core/index.mjs'
import { MAX_FIELDS, MAX_OBJECTS, changeField, changeObject, findObject, normalizeObject } from './catalog.mjs'
import { fromColumn, toColumn } from './columns.mjs'
import { hashOf, openBlobs } from './blobs.mjs'
import { APPLICATION_ID, BASE_DDL, FORMAT, addColumnSql, createTableSql, dropTriggersSql, q, tableName, triggersSql } from './schema.mjs'
import { BUSY_MS, enterWal, sqliteOf } from './sqlite.mjs'
import { makeUlid } from './ulid.mjs'

/** How long a file that no record holds is kept before the garbage collector may take it. */
export const GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000

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
    if (cat === null || cat.version !== version) {
      const json = JSON.parse(prepare('SELECT json FROM catalog WHERE version = ?').get(version).json)
      cat = { version, objects: json.objects, profiles: Array.isArray(json.profiles) ? json.profiles : [] }
    }
    return cat
  }
  const objOf = (key) => findObject(catalog().objects, key)
  const need = (key) => { const obj = objOf(key); if (!obj) throw new RangeError('no such object: ' + key); return obj }
  const archivedAt = () => { const r = prepare("SELECT v FROM meta WHERE k = 'archived_at'").get(); return r === undefined ? null : r.v }
  /** The refusal for a write on a db or an object that is put away, or null. */
  const sealed = (obj) => (archivedAt() !== null ? refuse('archived', 'the app is archived: restore it first') : obj !== undefined && obj.archived !== undefined ? refuse('archived', 'the table is archived: restore it first') : null)

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

  /** The links of `values` that point at nothing: `[{ path, code: 'link', message }]`. A link the record already had is not asked again (its target may have been deleted since). */
  const brokenLinks = (obj, values, before) => {
    const errors = []
    for (const f of obj.fields) {
      if (f.type !== 'relation' || !Object.prototype.hasOwnProperty.call(values, f.key)) continue
      const target = objOf(f.to)
      const given = values[f.key]
      const ids = Array.isArray(given) ? given : [given]
      const had = before === null ? [] : [].concat(before.values[f.key] === null || before.values[f.key] === undefined ? [] : before.values[f.key])
      for (const id of ids) {
        if (!isUlid(id) || had.includes(id)) continue
        const there = target !== undefined && prepare(`SELECT 1 AS x FROM ${q(tableName(target.key))} WHERE id = ? AND deleted_at IS NULL`).get(id) !== undefined
        if (!there) errors.push({ path: f.key, code: 'link', message: 'no such ' + (target === undefined ? f.to : target.label) + ' record' })
      }
    }
    return errors
  }

  const create = (objectKey, values, by) => write(() => {
    const obj = objOf(objectKey)
    if (!obj) return refuse('unknown-object', 'no such object')
    if (sealed(obj)) return sealed(obj)
    const { t, at } = stamp()
    const built = buildCreate(obj, values, { id: nextId(t), record: nextId(t), by, at })
    if (!built.ok) return invalid(built.errors)
    const broken = brokenLinks(obj, built.op.set, null)
    return broken.length ? invalid(broken) : apply(built.op)
  })

  const update = (objectKey, id, changes, by) => write(() => {
    const obj = objOf(objectKey)
    if (!obj) return refuse('unknown-object', 'no such object')
    if (sealed(obj)) return sealed(obj)
    const before = isUlid(id) ? readRecord(obj, id) : null
    if (!before) return refuse('missing', 'no such record')
    if (before.deleted) return refuse('deleted', 'the record is deleted')
    const { t, at } = stamp()
    const built = buildUpdate(obj, before, changes, { id: nextId(t), by, at })
    if (!built.ok) return invalid(built.errors)
    if (built.op === null) return { ok: true, record: before, applied: false }
    const broken = brokenLinks(obj, built.op.set, before)
    return broken.length ? invalid(broken) : apply(built.op)
  })

  const mark = (kind) => (objectKey, id, by) => write(() => {
    const obj = objOf(objectKey)
    if (!obj) return refuse('unknown-object', 'no such object')
    if (sealed(obj)) return sealed(obj)
    const before = isUlid(id) ? readRecord(obj, id) : null
    if (!before) return refuse('missing', 'no such record')
    if ((kind === 'delete') === (before.deleted !== null)) return { ok: true, record: before, applied: false }
    const { t, at } = stamp()
    return apply({ id: nextId(t), kind, object: obj.key, record: id, by, at })
  })

  const get = (objectKey, id) => { live(); return isUlid(id) ? readRecord(need(objectKey), id) : null }

  /**
   * What points at a record, from every other side: one group per link field (of any object) that points at `objectKey`, in the order of the structure,
   * `[{ object, field, count, ids }]`. Only live records count; `ids` are the first `limit` (50 by default, 200 at most), oldest first. A group is there even when it is empty.
   */
  const backlinks = (objectKey, id, opts = {}) => {
    live()
    const target = need(objectKey)
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 200) : 50
    const out = []
    for (const obj of catalog().objects) {
      for (const f of obj.fields) {
        if (f.type !== 'relation' || f.to !== target.key) continue
        if (!isUlid(id)) { out.push({ object: obj.key, field: f.key, count: 0, ids: [] }); continue }
        const t = q(tableName(obj.key))
        const c = q(f.key)
        const from = `FROM ${t} WHERE deleted_at IS NULL AND ` + (f.many ? `EXISTS (SELECT 1 FROM json_each(${t}.${c}) WHERE value = ?)` : `${c} = ?`)
        out.push({
          object: obj.key, field: f.key,
          count: Number(prepare(`SELECT count(*) AS n ${from}`).get(id).n),
          ids: prepare(`SELECT id ${from} ORDER BY id LIMIT ${limit}`).all(id).map((r) => r.id),
        })
      }
    }
    return out
  }
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

  /** The profiles with every grant on a table or a field that is gone taken out, so a profile never names what the app no longer has. */
  const pruneProfiles = (profiles, objects) => profiles.map((p) => ({
    ...p,
    grants: p.grants.filter((g) => findObject(objects, g.object) !== undefined).map((g) => {
      if (g.fields === undefined) return g
      const keys = new Set(findObject(objects, g.object).fields.map((f) => f.key))
      const fields = Object.fromEntries(Object.entries(g.fields).filter(([k]) => keys.has(k)))
      return Object.keys(fields).length === 0 ? { object: g.object, do: g.do } : { ...g, fields }
    }),
  }))

  /** A new version of the catalog: the objects given and, unless `profiles` says otherwise, the profiles it already had (pruned to what is left). */
  const commitCatalog = (change, by, objects, profiles) => {
    const current = catalog()
    const version = current.version + 1
    const kept = pruneProfiles(profiles === undefined ? current.profiles : profiles, objects)
    prepare('INSERT INTO catalog (version, change, actor, at, json) VALUES (?, ?, ?, ?, ?)').run(version, change, by, stamp().at, JSON.stringify(kept.length === 0 ? { objects } : { objects, profiles: kept }))
    cat = { version, objects, profiles: kept }
    return version
  }

  /** Replaces the app's profiles (profiles.mjs): who may see and do what, as data. A refusal changes nothing; the same profiles again change nothing. */
  const setProfiles = (list, by) => {
    live()
    if (!validBy(by)) return invalid([{ path: 'by', code: 'by', message: 'who did it: 1 to 64 characters' }])
    return write(() => {
      const { objects, profiles } = catalog()
      if (sealed()) return sealed()
      const n = normalizeProfiles(list, objects)
      if (!n.ok) return invalid(n.errors)
      if (sameJson(n.profiles, profiles)) return { ok: true, applied: false, version: catalog().version, profiles: structuredClone(profiles) }
      return { ok: true, applied: true, version: commitCatalog('set-profiles', by, objects, n.profiles), profiles: structuredClone(n.profiles) }
    })
  }

  const addObject = (def, by) => {
    live()
    const n = normalizeObject(def)
    if (!n.ok) return invalid(n.errors)
    if (!validBy(by)) return invalid([{ path: 'by', code: 'by', message: 'who did it: 1 to 64 characters' }])
    return write(() => {
      const { objects } = catalog()
      if (sealed()) return sealed()
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
      if (sealed(obj)) return sealed(obj)
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
      if (sealed(obj)) return sealed(obj)
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
      if (sealed(obj)) return sealed(obj)
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
    if (sealed(obj)) return sealed(obj)
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

  // Putting away: an archived object or db keeps everything and takes no write; it is the step before a deletion for good.
  const setArchived = (objectKey, by, on) => {
    live()
    if (!validBy(by)) return invalid([{ path: 'by', code: 'by', message: 'who did it: 1 to 64 characters' }])
    return write(() => {
      const { objects } = catalog()
      const obj = findObject(objects, objectKey)
      if (!obj) return refuse('unknown-object', 'no such object')
      if (archivedAt() !== null) return refuse('archived', 'the app is archived: restore it first')
      if (on === (obj.archived !== undefined)) return { ok: true, applied: false, object: structuredClone(obj) }
      const { archived, ...rest } = obj
      const next = on ? { ...rest, archived: { by, at: stamp().at } } : rest
      return { ok: true, applied: true, version: commitCatalog((on ? 'archive-object:' : 'restore-object:') + obj.key, by, objects.map((o) => (o === obj ? next : o))), object: structuredClone(next) }
    })
  }

  /** The replayed envelope of every record of an object, written back to its table (after a journal rewrite: an update that changed nothing any more is gone, so `rev` and the stamps follow). */
  const resync = (obj) => {
    const replayed = new Map()
    const broken = new Set()
    for (const row of prepare('SELECT * FROM ops WHERE object = ? ORDER BY seq').all(obj.key)) {
      const op = toOp(row)
      if (broken.has(op.record)) continue
      const r = applyOp(replayed.get(op.record) || null, op, obj)
      if (!r.ok) { broken.add(op.record); continue }
      replayed.set(op.record, r.record)
    }
    const set = prepare(`UPDATE ${q(tableName(obj.key))} SET rev = ?, modified_by = ?, modified_at = ? WHERE id = ?`)
    for (const [id, rec] of replayed) {
      const row = prepare(`SELECT rev, modified_by, modified_at FROM ${q(tableName(obj.key))} WHERE id = ?`).get(id)
      if (row !== undefined && (Number(row.rev) !== rec.rev || row.modified_by !== rec.modified.by || row.modified_at !== rec.modified.at)) set.run(rec.rev, rec.modified.by, rec.modified.at, id)
    }
  }

  /**
   * Deletes an archived object for good: `{ ok: true, version, records, files }`. Its table, its records with their history, its views and the files only it held go; the link
   * fields that pointed at it are cut from the objects that had them (their column, their place in the views, their values in the journal), so the rest of the db stays sound.
   * Codes: unknown-object, not-archived (put it away first), archived (the whole app is).
   */
  const deleteObject = (objectKey, by) => {
    live()
    if (!validBy(by)) return invalid([{ path: 'by', code: 'by', message: 'who did it: 1 to 64 characters' }])
    let dropped = []
    const out = write(() => {
      const { objects } = catalog()
      const obj = findObject(objects, objectKey)
      if (!obj) return refuse('unknown-object', 'no such object')
      if (archivedAt() !== null) return refuse('archived', 'the app is archived: restore it first')
      if (obj.archived === undefined) return refuse('not-archived', 'archive the table first: only an archived table can be deleted')
      dropped = [...heldBy(obj, new Set())]
      const records = Number(prepare(`SELECT count(*) AS n FROM ${q(tableName(obj.key))}`).get().n)
      const { at } = stamp()
      const next = []
      for (const o of objects) {
        if (o === obj) continue
        const gone = o.fields.filter((f) => f.type === 'relation' && f.to === obj.key)
        if (gone.length === 0) { next.push(o); continue }
        const kept = { ...o, fields: o.fields.filter((f) => !gone.includes(f)) }
        for (const sql of dropTriggersSql(o)) handle.exec(sql)
        for (const f of gone) handle.exec(`ALTER TABLE ${q(tableName(o.key))} DROP COLUMN ${q(f.key)}`)
        for (const sql of triggersSql(kept)) handle.exec(sql)
        for (const f of gone) prepare('UPDATE ops SET set_json = json_remove(set_json, ?), prev_json = CASE WHEN prev_json IS NULL THEN NULL ELSE json_remove(prev_json, ?) END WHERE object = ? AND set_json IS NOT NULL').run('$."' + f.key + '"', '$."' + f.key + '"', o.key)
        prepare("DELETE FROM ops WHERE object = ? AND kind = 'update' AND set_json = '{}'").run(o.key)
        resync(kept)
        for (const row of prepare('SELECT id, json FROM views WHERE object = ?').all(o.key)) {
          const view = repairView(JSON.parse(row.json), kept.fields, kept.title)
          if (!sameJson(view, JSON.parse(row.json))) prepare('UPDATE views SET json = ?, rev = rev + 1, modified_by = ?, modified_at = ? WHERE id = ?').run(JSON.stringify(view), by, at, row.id)
        }
        next.push(kept)
      }
      prepare('DELETE FROM ops WHERE object = ?').run(obj.key)
      prepare('DELETE FROM views WHERE object = ?').run(obj.key)
      for (const sql of dropTriggersSql(obj)) handle.exec(sql)
      handle.exec(`DROP TABLE ${q(tableName(obj.key))}`)
      return { ok: true, version: commitCatalog('delete-object:' + obj.key, by, next), records, files: 0 }
    })
    if (out.ok && dropped.length) {
      const held = referenced()
      out.files = dropped.filter((hash) => !held.has(hash) && blobs.remove(hash)).length
    }
    return out
  }

  /** Puts the whole db away (or brings it back): it is hidden from the lists and takes no write meanwhile. */
  const archive = (by) => {
    live()
    if (!validBy(by)) return invalid([{ path: 'by', code: 'by', message: 'who did it: 1 to 64 characters' }])
    return write(() => {
      if (archivedAt() !== null) return { ok: true, applied: false }
      const { at } = stamp()
      const put = prepare('INSERT INTO meta (k, v) VALUES (?, ?)')
      put.run('archived_by', by)
      put.run('archived_at', at)
      return { ok: true, applied: true }
    })
  }
  const unarchive = () => {
    live()
    return write(() => ({ ok: true, applied: Number(prepare("DELETE FROM meta WHERE k IN ('archived_by', 'archived_at')").run().changes) > 0 }))
  }

  const info = () => {
    live()
    const meta = Object.fromEntries(prepare('SELECT k, v FROM meta').all().map((r) => [r.k, r.v]))
    return { id: meta.id, name: meta.name, format: FORMAT, version: catalog().version, created: { by: meta.created_by, at: meta.created_at }, archived: meta.archived_at === undefined ? null : { by: meta.archived_by, at: meta.archived_at } }
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

  /** Stores a file next to the db and gives the value to put in an attachment field: `{ ok: true, file: { name, size, type, hash } }`. `maxBytes` is the field's own cap. */
  const attach = (bytes, meta, maxBytes) => {
    live()
    if (!(bytes instanceof Uint8Array)) return refuse('type', 'a file is bytes (a Buffer or a Uint8Array)')
    const given = isPlain(meta) ? meta : {}
    const cap = Number.isInteger(maxBytes) && maxBytes >= 1 && maxBytes <= MAX_ATTACHMENT_BYTES ? maxBytes : MAX_ATTACHMENT_BYTES
    if (bytes.length > cap) return refuse('too-big', 'a file is at most ' + cap + ' bytes')
    const r = normalizeValue({ type: 'attachment', maxBytes: cap }, [{ name: given.name, size: bytes.length, type: given.type, hash: hashOf(bytes) }])
    if (!r.ok) return refuse(r.code, r.message)
    const put = blobs.put(bytes, cap)
    return put.ok ? { ok: true, file: r.value[0] } : put
  }

  /** The hash of every file a record still holds, deleted records included (a deleted row can be restored, and its files with it). */
  const heldBy = (obj, hashes) => {
    for (const f of obj.fields) {
      if (f.type !== 'attachment') continue
      for (const row of prepare(`SELECT ${q(f.key)} AS v FROM ${q(tableName(obj.key))} WHERE ${q(f.key)} IS NOT NULL`).all()) {
        let list = []
        try { list = JSON.parse(row.v) } catch (e) { list = [] }
        for (const file of Array.isArray(list) ? list : []) if (isPlain(file) && typeof file.hash === 'string') hashes.add(file.hash)
      }
    }
    return hashes
  }
  const referenced = () => {
    live()
    const hashes = new Set()
    for (const obj of catalog().objects) heldBy(obj, hashes)
    return hashes
  }

  /**
   * A consistent copy of the whole db in one new file (SQLite's own `VACUUM INTO`): everything committed so far and nothing half-written, taken while the db stays in use (a reader
   * of the WAL, writers are not held up). The file must not exist yet. The copy is a plain SQLite file in rollback-journal mode, with the same application id and format.
   */
  const backup = (dest) => {
    live()
    if (typeof dest !== 'string' || dest === '' || dest.includes('\0')) throw new RangeError('backup: a file path')
    if (depth > 0) throw new Error('backup: not inside a write')
    prepare('VACUUM INTO ?').run(dest)
  }

  /**
   * Takes the files no record holds any more: `{ removed, kept, bytes }`. A file younger than `graceMs` (a week by default) is kept even when nothing holds it: it may be
   * waiting for the write that attaches it, or be the one an Undo is about to put back. Never runs inside a write.
   */
  const gc = (opts) => {
    live()
    const o = isPlain(opts) ? opts : {}
    const grace = Number.isFinite(o.graceMs) && o.graceMs >= 0 ? o.graceMs : GC_GRACE_MS
    const now = Number.isFinite(o.now) ? o.now : Date.now()
    const held = referenced()
    let removed = 0
    let kept = 0
    let bytes = 0
    for (const hash of blobs.list()) {
      const st = blobs.stat(hash)
      if (held.has(hash) || st === null || now - st.mtimeMs < grace) { kept += 1; continue }
      if (blobs.remove(hash)) { removed += 1; bytes += st.size } else kept += 1
    }
    return { removed, kept, bytes }
  }

  return {
    file,
    blobs,
    info,
    fingerprint,
    backup,
    /** The hash of every file a record still holds (deleted records included), as a Set. */
    referenced,
    /** The live objects; `{ all: true }` adds the archived ones (they carry `archived: { by, at }`). */
    objects: (opts) => { live(); return structuredClone(isPlain(opts) && opts.all === true ? catalog().objects : catalog().objects.filter((o) => o.archived === undefined)) },
    /** The profiles of this app, `[]` when it has none (only the owner then): `{ id, label, grants }`, see core/profiles.mjs. */
    profiles: () => { live(); return structuredClone(catalog().profiles) },
    setProfiles,
    addObject,
    archiveObject: (key, by) => setArchived(key, by, true),
    restoreObject: (key, by) => setArchived(key, by, false),
    deleteObject,
    archive,
    unarchive,
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
    backlinks,
    list,
    count,
    journal,
    seal,
    verify,
    attach,
    gc,
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
