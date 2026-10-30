// kybernos-db — what the page asks the host, over the service of dbs (agent/service.mjs). Pure: no http, no clock but the one injected.
//
// The page is the person: its writes are journalled as « person », never as what the request says, and it sees every field in clear (`can()` allows a person
// everything). It reads whole tables and does its search, filter and sort in the browser with the same core the agent uses, so the two always agree.
//
//   state()                              the dbs with their objects, fields and views, a fingerprint to poll, and « today »
//   records({ db, object, deleted? })    the records of one object (5,000 at most)
//   links({ db, object, id })            what points at a record, from the other tables: one group per link field, with the first records of each
//   write({ db, object, op, id?, values? })   op: create | update | delete | restore
//   view({ db, object, op, view?, id? })      op: save | remove

import { findObject } from './store/catalog.mjs'

export const RECORDS_MAX = 5000
export const LINKS_MAX = 50
const BY = 'person'
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (error, message, extra) => ({ ok: false, error, message, ...(extra || {}) })
const fromStore = (r) => fail(r.code || 'failed', r.message || 'the engine refused it', Array.isArray(r.errors) ? { errors: r.errors.slice(0, 8) } : undefined)
const localDay = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

/** A record the way the page reads it. */
const shape = (rec) => ({ id: rec.id, values: rec.values, rev: rec.rev, created: rec.created, modified: rec.modified, deleted: rec.deleted })

/** `service` is agent/service.mjs; `ports.today()` gives « today » as YYYY-MM-DD. */
export function makeApi ({ service, ports = {} }) {
  const today = typeof ports.today === 'function' ? ports.today : localDay

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
      const unreadable = []
      for (const d of service.list()) {
        const r = service.byId(d.id)
        if (!r.ok) { unreadable.push({ id: d.id, name: d.name, error: r.code, message: r.message }); continue }
        let fingerprint = ''
        try { fingerprint = r.db.fingerprint() } catch (e) { unreadable.push({ id: d.id, name: d.name, error: 'failed', message: 'the database could not be read' }); continue }
        dbs.push({ id: d.id, name: d.name, version: r.db.info().version, fingerprint, objects: r.db.objects().map((o) => ({ ...o, views: r.db.listViews(o.key), stamps: r.db.viewStamps(o.key) })) })
      }
      return { ok: true, dbs, unreadable, today: today() }
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
