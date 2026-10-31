// kybernos-db — what the page asks the host, over the service of dbs (agent/service.mjs). Pure: no http, no clock but the one injected.
//
// The page is the person: its writes are journalled as « person », never as what the request says, and it sees every field in clear (`can()` allows a person
// everything). It reads whole tables and does its search, filter and sort in the browser with the same core the agent uses, so the two always agree.
//
//   state()                              the dbs (apps) with their objects, fields and views, a fingerprint to poll, the archived apps, and « today »
//   app({ db, object?, op, confirm? })   op: archive | restore | delete, for an app or (with `object`) one of its tables; delete only what is archived, and asks the name back
//   impact({ db, object? })              what deleting an app or a table would take: tables, rows, links cut, files
//   records({ db, object, deleted? })    the records of one object (5,000 at most)
//   links({ db, object, id })            what points at a record, from the other tables: one group per link field, with the first records of each
//   write({ db, object, op, id?, values? })   op: create | update | delete | restore
//   upload({ db, object, field, name, type, bytes })   stores a file for an attachment field and gives the value to write (the file waits, unheld, until a row holds it)
//   file({ db, object, id, field, hash })     one file a row holds, with its bytes
//   view({ db, object, op, view?, id? })      op: save | remove

import { findObject } from './store/catalog.mjs'

export const RECORDS_MAX = 5000
export const LINKS_MAX = 50
const BY = 'person'
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (error, message, extra) => ({ ok: false, error, message, ...(extra || {}) })
const fromStore = (r) => fail(r.code || 'failed', r.message || 'the engine refused it', Array.isArray(r.errors) ? { errors: r.errors.slice(0, 8) } : undefined)
const localDay = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

/** Every row of every table of a db, deleted ones included: what an app weighs. */
const sumRows = (db) => db.objects({ all: true }).reduce((n, o) => n + db.list(o.key, { deleted: 'all' }).length, 0)

/** A record the way the page reads it. */
const shape = (rec) => ({ id: rec.id, values: rec.values, rev: rec.rev, created: rec.created, modified: rec.modified, deleted: rec.deleted })

/** `service` is agent/service.mjs; `ports.today()` gives « today » as YYYY-MM-DD, `ports.markers()` `{ <template id>: <db id> }` (which template made which database). */
export function makeApi ({ service, ports = {} }) {
  const today = typeof ports.today === 'function' ? ports.today : localDay
  /** `Map<db id, template id>`; empty when the markers cannot be read. */
  const templates = () => {
    const out = new Map()
    try { const m = typeof ports.markers === 'function' ? ports.markers() : {}; if (plain(m)) for (const [t, id] of Object.entries(m)) if (typeof id === 'string') out.set(id, t) } catch (e) { /* no markers: no template names */ }
    return out
  }

  /** The db and object a request means, or `{ err }`. */
  const aim = (q) => {
    const a = plain(q) ? q : {}
    const r = service.resolve(typeof a.db === 'string' && a.db !== '' ? a.db : undefined)
    if (!r.ok) return { err: fail(r.code, r.message) }
    const obj = findObject(r.db.objects(), a.object)
    if (!obj) return { err: fail('unknown_object', 'no such table in this database') }
    return { db: r.db, obj, a }
  }

  return {
    state () {
      const dbs = []
      const archived = []
      const unreadable = []
      const made = templates()
      for (const d of service.list()) {
        const r = service.byId(d.id)
        if (d.archived !== null) {
          if (r.ok) { try { archived.push({ id: d.id, name: d.name, archived: d.archived, tables: r.db.objects({ all: true }).length, rows: sumRows(r.db) }) } catch (e) { /* a db that fails here is not listed */ } }
          continue
        }
        if (!r.ok) { unreadable.push({ id: d.id, name: d.name, error: r.code, message: r.message }); continue }
        let fingerprint = ''
        try { fingerprint = r.db.fingerprint() } catch (e) { unreadable.push({ id: d.id, name: d.name, error: 'failed', message: 'the database could not be read' }); continue }
        dbs.push({
          id: d.id, name: d.name, template: made.has(d.id) ? made.get(d.id) : null, version: r.db.info().version, fingerprint,
          objects: r.db.objects().map((o) => ({ ...o, count: r.db.count(o.key), views: r.db.listViews(o.key), stamps: r.db.viewStamps(o.key) })),
          archivedObjects: r.db.objects({ all: true }).filter((o) => o.archived !== undefined).map((o) => ({ key: o.key, label: o.label, archived: o.archived, count: r.db.count(o.key) })),
        })
      }
      return { ok: true, dbs, archived, unreadable, today: today() }
    },

    app (body) {
      const a = plain(body) ? body : {}
      if (!['archive', 'restore', 'delete'].includes(a.op)) return fail('invalid', 'op is archive, restore or delete')
      const found = typeof a.db === 'string' ? service.list().find((d) => d.id === a.db) : undefined
      if (found === undefined) return fail('unknown_db', 'no such app')
      if (a.object === undefined) {
        if (a.op === 'delete' && a.confirm !== found.name) return fail('confirm', 'type the name of the app to confirm')
        const r = a.op === 'archive' ? service.archive(a.db, BY) : a.op === 'restore' ? service.unarchive(a.db) : service.remove(a.db)
        return r.ok ? { ok: true, applied: r.applied !== false } : fromStore(r)
      }
      const t = service.byId(a.db)
      if (!t.ok) return fromStore(t)
      const obj = findObject(t.db.objects({ all: true }), a.object)
      if (!obj) return fail('unknown_object', 'no such table in this app')
      if (a.op === 'delete' && a.confirm !== obj.label) return fail('confirm', 'type the name of the table to confirm')
      const r = a.op === 'archive' ? t.db.archiveObject(obj.key, BY) : a.op === 'restore' ? t.db.restoreObject(obj.key, BY) : t.db.deleteObject(obj.key, BY)
      return r.ok ? { ok: true, applied: r.applied !== false } : fromStore(r)
    },

    impact (q) {
      const a = plain(q) ? q : {}
      const t = service.byId(typeof a.db === 'string' ? a.db : '')
      if (!t.ok) return fromStore(t)
      const objects = t.db.objects({ all: true })
      const rowsOf = (o, only) => t.db.list(o.key, { deleted: 'all' }).filter(only || (() => true))
      const filesOf = (o, rows) => rows.reduce((n, r) => n + o.fields.filter((f) => f.type === 'attachment').reduce((m, f) => m + (Array.isArray(r.values[f.key]) ? r.values[f.key].length : 0), 0), 0)
      if (a.object === undefined) {
        let rows = 0, files = 0, links = 0, views = 0
        for (const o of objects) {
          const list = rowsOf(o)
          rows += list.length
          files += filesOf(o, list)
          links += list.reduce((n, r) => n + o.fields.filter((f) => f.type === 'relation').reduce((m, f) => m + (Array.isArray(r.values[f.key]) ? r.values[f.key].length : (r.values[f.key] ? 1 : 0)), 0), 0)
          views += t.db.listViews(o.key).length
        }
        return { ok: true, tables: objects.length, rows, links, files, views, cut: [] }
      }
      const obj = findObject(objects, a.object)
      if (!obj) return fail('unknown_object', 'no such table in this app')
      const own = rowsOf(obj)
      const cut = []
      let links = 0
      for (const o of objects) {
        if (o.key === obj.key) continue
        for (const f of o.fields) {
          if (f.type !== 'relation' || f.to !== obj.key) continue
          const n = rowsOf(o).reduce((m, r) => m + (Array.isArray(r.values[f.key]) ? r.values[f.key].length : (r.values[f.key] ? 1 : 0)), 0)
          links += n
          cut.push({ object: o.key, objectLabel: o.label, field: f.key, fieldLabel: f.label, links: n })
        }
      }
      return { ok: true, tables: 1, rows: own.length, fields: obj.fields.length, links, files: filesOf(obj, own), views: t.db.listViews(obj.key).length, cut }
    },

    records (q) {
      const t = aim(q)
      if (t.err) return t.err
      const rows = t.db.list(t.obj.key, t.a.deleted === true || t.a.deleted === '1' ? { deleted: true } : {})
      return { ok: true, object: t.obj.key, total: rows.length, truncated: rows.length > RECORDS_MAX, records: rows.slice(0, RECORDS_MAX).map(shape), fingerprint: t.db.fingerprint() }
    },

    links (q) {
      const t = aim(q)
      if (t.err) return t.err
      const id = typeof t.a.id === 'string' ? t.a.id : ''
      if (t.db.get(t.obj.key, id) === null) return fail('missing', 'no such record')
      const objects = t.db.objects()
      const groups = t.db.backlinks(t.obj.key, id, { limit: LINKS_MAX }).map((g) => {
        const from = findObject(objects, g.object)
        const field = from.fields.find((f) => f.key === g.field)
        const titled = g.ids.map((rid) => t.db.get(g.object, rid)).filter((r) => r !== null).map((r) => ({ id: r.id, title: r.values[from.title] === null || r.values[from.title] === undefined ? '' : String(r.values[from.title]) }))
        return { object: g.object, objectLabel: from.label, field: g.field, fieldLabel: field.label, inverse: field.inverse === undefined ? null : field.inverse, many: field.many === true, count: g.count, records: titled }
      })
      return { ok: true, object: t.obj.key, id, groups }
    },

    upload (q) {
      const t = aim(q)
      if (t.err) return t.err
      const field = t.obj.fields.find((f) => f.key === t.a.field)
      if (!field || field.type !== 'attachment') return fail('invalid', 'there is no attachment field of that name in this table')
      if (!(t.a.bytes instanceof Uint8Array)) return fail('invalid', 'a file is bytes')
      const r = t.db.attach(t.a.bytes, { name: t.a.name, type: t.a.type }, field.maxBytes)
      return r.ok ? { ok: true, file: r.file } : fromStore(r)
    },

    file (q) {
      const t = aim(q)
      if (t.err) return t.err
      const rec = typeof t.a.id === 'string' ? t.db.get(t.obj.key, t.a.id) : null
      if (rec === null) return fail('missing', 'no such row')
      const held = rec.values[t.a.field]
      const file = Array.isArray(held) && typeof t.a.hash === 'string' ? held.find((f) => f.hash === t.a.hash) : undefined
      if (file === undefined) return fail('missing', 'that row holds no such file')
      const bytes = t.db.blobs.get(file.hash)
      if (bytes === null) return fail('missing', 'the file is not on this computer any more')
      return { ok: true, file, bytes }
    },

    write (body) {
      const t = aim(body)
      if (t.err) return t.err
      const { db, obj, a } = t
      switch (a.op) {
        case 'create': { const r = db.create(obj.key, plain(a.values) ? a.values : {}, BY); return r.ok ? { ok: true, record: shape(r.record) } : fromStore(r) }
        case 'update': { const r = db.update(obj.key, a.id, plain(a.values) ? a.values : {}, BY); return r.ok ? { ok: true, record: shape(r.record), applied: r.applied !== false } : fromStore(r) }
        case 'delete': case 'restore': { const r = db[a.op === 'delete' ? 'remove' : 'restore'](obj.key, a.id, BY); return r.ok ? { ok: true, record: shape(r.record), applied: r.applied !== false } : fromStore(r) }
        default: return fail('invalid', 'op is create, update, delete or restore')
      }
    },

    view (body) {
      const t = aim(body)
      if (t.err) return t.err
      const { db, obj, a } = t
      if (a.op === 'save') { const r = db.saveView(obj.key, a.view, BY); return r.ok ? { ok: true, view: r.view, created: r.created, applied: r.applied } : fromStore(r) }
      if (a.op === 'remove') { const r = db.removeView(obj.key, a.id); return r.ok ? { ok: true, removed: r.removed } : fromStore(r) }
      return fail('invalid', 'op is save or remove')
    },
  }
}
