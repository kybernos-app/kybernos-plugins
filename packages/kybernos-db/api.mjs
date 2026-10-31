// kybernos-db — what the page asks the host, over the service of dbs (agent/service.mjs). Pure: no http, no clock but the one injected.
//
// The page is the person: its writes are journalled as « person », never as what the request says, and it sees every field in clear (`can()` allows a person
// everything). It reads whole tables and does its search, filter and sort in the browser with the same core the agent uses, so the two always agree.
//
//   state()                              the dbs with their objects, fields and views, a fingerprint to poll, and « today »
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
      const unreadable = []
      const made = templates()
      for (const d of service.list()) {
        if (d.archived !== null) continue // put away: the page lists it from the Apps page, not here
        const r = service.byId(d.id)
        if (!r.ok) { unreadable.push({ id: d.id, name: d.name, error: r.code, message: r.message }); continue }
        let fingerprint = ''
        try { fingerprint = r.db.fingerprint() } catch (e) { unreadable.push({ id: d.id, name: d.name, error: 'failed', message: 'the database could not be read' }); continue }
        dbs.push({ id: d.id, name: d.name, template: made.has(d.id) ? made.get(d.id) : null, version: r.db.info().version, fingerprint, objects: r.db.objects().map((o) => ({ ...o, views: r.db.listViews(o.key), stamps: r.db.viewStamps(o.key) })) })
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
