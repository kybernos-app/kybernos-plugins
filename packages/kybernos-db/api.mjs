// kybernos-db — what the page asks the host, over the service of dbs (agent/service.mjs). Pure: no http, no clock but the one injected.
//
// The page is the person: its writes are journalled as « person », never as what the request says, and it sees every field in clear (`can()` allows a person
// everything). It reads whole tables and does its search, filter and sort in the browser with the same core the agent uses, so the two always agree.
//
// `api.as(actor)` is the same door for someone else. The owner (`{ kind: 'person', role: 'owner' }`) gets the door above. A team member (`{ kind: 'member', role: <profile id>, id }`)
// gets a door that asks `can()` before every answer, from the profile the app itself holds (core/profiles.mjs): a table without a grant is not listed, a hidden field is not in
// any answer, a write that touches a field the profile gives only to read is refused, a member never deletes, restores, changes a view or the structure, and their writes are
// journalled as « member:<id> ». Anyone else gets a door that refuses everything (`forbidden`). The decision is made here, on every call, never in the page.
//
//   state()                              the dbs (apps) with their objects, fields and views, a fingerprint to poll, the archived apps, and « today »; on a host that can publish, each db also says
//                                        `published` (null, or { slug, url, since, lastSync, syncError, host: { id, name, region } | null, hostGone }) and the state says `hosting` ({ available, name }): no secret
//   app({ db, object?, op, confirm? })   op: archive | restore | delete, for an app or (with `object`) one of its tables; delete only what is archived, and asks the name back
//   impact({ db, object? })              what deleting an app or a table would take: tables, rows, links cut, files
//   records({ db, object, deleted?, limit? })   the records of one object: up to `limit` (default and ceiling 50,000, the most an import loads; the Tables page asks for 5,000)
//   links({ db, object, id })            what points at a record, from the other tables: one group per link field, with the first records of each
//   write({ db, object, op, id?, values? })   op: create | update | delete | restore
//   upload({ db, object, field, name, type, bytes })   stores a file for an attachment field and gives the value to write (the file waits, unheld, until a row holds it)
//   file({ db, object, id, field, hash })     one file a row holds, with its bytes
//   view({ db, object, op, view?, id? })      op: save | remove

import { can, fieldAccess, grantOf, grantUpdates, profileOf } from './core/index.mjs'
import { findObject } from './store/catalog.mjs'

/** The most records one answer holds, and what it holds when the caller does not say (a dashboard reads a whole sales file: 50,000 is what an import may load). A caller may ask for fewer with `limit`. */
export const RECORDS_MAX = 50000
/** How many records a call asks for: `limit`, a whole number from 1 to RECORDS_MAX, else RECORDS_MAX. */
const limitOf = (a) => { const n = typeof a.limit === 'number' ? a.limit : (typeof a.limit === 'string' && /^\d{1,6}$/.test(a.limit) ? Number(a.limit) : NaN); return Number.isInteger(n) && n >= 1 ? Math.min(n, RECORDS_MAX) : RECORDS_MAX }
export const LINKS_MAX = 50
const OWNER_BY = 'person'
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (error, message, extra) => ({ ok: false, error, message, ...(extra || {}) })
const fromStore = (r) => fail(r.code || 'failed', r.message || 'the engine refused it', Array.isArray(r.errors) ? { errors: r.errors.slice(0, 8) } : undefined)
const localDay = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

/** Every row of every table of a db, deleted ones included: what an app weighs. */
const sumRows = (db) => db.objects({ all: true }).reduce((n, o) => n + db.list(o.key, { deleted: 'all' }).length, 0)

/** A record the way the page reads it. */
const shape = (rec) => ({ id: rec.id, values: rec.values, rev: rec.rev, created: rec.created, modified: rec.modified, deleted: rec.deleted })

const PUBLISHED_MESSAGE = 'This app is published: its rows are written through the web app. Unpublish it first to change its structure or its views.'

/**
 * `service` is agent/service.mjs; `ports.today()` gives « today » as YYYY-MM-DD, `ports.markers()` `{ <template id>: <db id> }` (which template made which database).
 * `ports.remote` (DSH only) is `{ info(dbId) → published | null, hosting() → { available, … } }`: the page learns from it which apps are published. A published app's rows are
 * written through the host's forwarding (routes.mjs), never by this door: if a write or an upload reaches it for a published db, it is refused.
 */
export function makeApi ({ service, ports = {} }) {
  const today = typeof ports.today === 'function' ? ports.today : localDay
  const remote = plain(ports.remote) ? ports.remote : null
  const publishedOf = (id) => { try { const p = remote.info(id); return plain(p) ? p : null } catch (e) { return null } }
  const hostingOf = () => { try { const h = remote.hosting(); return plain(h) ? h : { available: false } } catch (e) { return { available: false } } }
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

  /** The owner's door, writing as `by`. */
  const ownerDoor = (by) => ({
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
          id: d.id, name: d.name, template: made.has(d.id) ? made.get(d.id) : null, version: r.db.info().version, fingerprint, ...(remote === null ? {} : { published: publishedOf(d.id) }),
          objects: r.db.objects().map((o) => ({ ...o, count: r.db.count(o.key), views: r.db.listViews(o.key), stamps: r.db.viewStamps(o.key) })),
          archivedObjects: r.db.objects({ all: true }).filter((o) => o.archived !== undefined).map((o) => ({ key: o.key, label: o.label, archived: o.archived, count: r.db.count(o.key) })),
        })
      }
      return { ok: true, dbs, archived, unreadable, today: today(), ...(remote === null ? {} : { hosting: hostingOf() }) }
    },

    app (body) {
      const a = plain(body) ? body : {}
      if (!['archive', 'restore', 'delete'].includes(a.op)) return fail('invalid', 'op is archive, restore or delete')
      const found = typeof a.db === 'string' ? service.list().find((d) => d.id === a.db) : undefined
      if (found === undefined) return fail('unknown_db', 'no such app')
      if (a.object === undefined) {
        if (a.op === 'delete' && a.confirm !== found.name) return fail('confirm', 'type the name of the app to confirm')
        const r = a.op === 'archive' ? service.archive(a.db, by) : a.op === 'restore' ? service.unarchive(a.db) : service.remove(a.db)
        return r.ok ? { ok: true, applied: r.applied !== false } : fromStore(r)
      }
      const t = service.byId(a.db)
      if (!t.ok) return fromStore(t)
      const obj = findObject(t.db.objects({ all: true }), a.object)
      if (!obj) return fail('unknown_object', 'no such table in this app')
      if (a.op === 'delete' && a.confirm !== obj.label) return fail('confirm', 'type the name of the table to confirm')
      const r = a.op === 'archive' ? t.db.archiveObject(obj.key, by) : a.op === 'restore' ? t.db.restoreObject(obj.key, by) : t.db.deleteObject(obj.key, by)
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
      const limit = limitOf(t.a)
      return { ok: true, object: t.obj.key, total: rows.length, truncated: rows.length > limit, records: rows.slice(0, limit).map(shape), fingerprint: t.db.fingerprint() }
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
      if (t.db.published === true) return fail('published', PUBLISHED_MESSAGE)
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
      if (db.published === true) return fail('published', PUBLISHED_MESSAGE)
      switch (a.op) {
        case 'create': { const r = db.create(obj.key, plain(a.values) ? a.values : {}, by); return r.ok ? { ok: true, record: shape(r.record) } : fromStore(r) }
        case 'update': { const r = db.update(obj.key, a.id, plain(a.values) ? a.values : {}, by); return r.ok ? { ok: true, record: shape(r.record), applied: r.applied !== false } : fromStore(r) }
        case 'delete': case 'restore': { const r = db[a.op === 'delete' ? 'remove' : 'restore'](obj.key, a.id, by); return r.ok ? { ok: true, record: shape(r.record), applied: r.applied !== false } : fromStore(r) }
        default: return fail('invalid', 'op is create, update, delete or restore')
      }
    },

    view (body) {
      const t = aim(body)
      if (t.err) return t.err
      const { db, obj, a } = t
      if (a.op === 'save') { const r = db.saveView(obj.key, a.view, by); return r.ok ? { ok: true, view: r.view, created: r.created, applied: r.applied } : fromStore(r) }
      if (a.op === 'remove') { const r = db.removeView(obj.key, a.id); return r.ok ? { ok: true, removed: r.removed } : fromStore(r) }
      return fail('invalid', 'op is save or remove')
    },
  })

  const forbidden = (reason) => fail('forbidden', 'you may not do that here', { reason })
  /** A door that refuses everything: for an actor that is neither the owner nor a member. */
  const closedDoor = () => {
    const no = () => forbidden('not-allowed')
    return { state: no, app: no, impact: no, records: no, links: no, upload: no, file: no, write: no, view: no }
  }

  /** The door of a team member: every call is asked of `can()`, from the profile the app holds for their role. */
  const memberDoor = (actor) => {
    const by = ('member:' + String(actor.id === undefined ? '' : actor.id)).slice(0, 64)
    const owner = ownerDoor(by)
    const who = { kind: 'member', role: actor.role }
    /** `{ db, profile }` for the app a request means, or `{ err }`: no profile for this role in that app is a refusal, not a guess. */
    const within = (q) => {
      const t = aim(q)
      if (t.err) return t
      const profile = profileOf(t.db.profiles(), actor.role)
      if (profile === undefined) return { err: forbidden('no-profile') }
      return { ...t, who: { ...who, profile } }
    }
    const ask = (t, action, field) => can(t.who, action, { object: t.obj.key, ...(field === undefined ? {} : { field }) })
    const denied = (verdict) => forbidden(verdict.reason)
    /** The fields of an object this profile may see, with what each allows. */
    const seen = (profile, obj) => obj.fields.map((f) => ({ field: f, access: fieldAccess(profile, obj.key, f) })).filter((x) => x.access !== 'hidden')
    const values = (profile, obj, record) => { const out = {}; for (const { field } of seen(profile, obj)) out[field.key] = record.values[field.key]; return out }
    const shapeFor = (profile, obj, rec) => ({ ...shape(rec), values: values(profile, obj, rec) })

    return {
      state () {
        const dbs = []
        const made = templates()
        for (const d of service.list()) {
          if (d.archived !== null) continue
          const r = service.byId(d.id)
          if (!r.ok) continue
          const profile = profileOf(r.db.profiles(), actor.role)
          if (profile === undefined) continue
          const objects = r.db.objects().filter((o) => can({ ...who, profile }, 'record.read', { object: o.key }).effect === 'allow').map((o) => {
            const grant = grantOf(profile, o.key)
            return {
              key: o.key, label: o.label, title: seen(profile, o).some((x) => x.field.key === o.title) ? o.title : null, count: r.db.count(o.key),
              can: { create: grant.do.includes('create'), update: grantUpdates(grant) },
              fields: seen(profile, o).map((x) => ({ ...x.field, access: x.access })),
            }
          })
          dbs.push({ id: d.id, name: d.name, template: made.has(d.id) ? made.get(d.id) : null, fingerprint: r.db.fingerprint(), profile: { id: profile.id, label: profile.label }, objects })
        }
        return { ok: true, dbs, today: today() }
      },

      app: () => forbidden('owner-only'),
      impact: () => forbidden('owner-only'),
      view: () => forbidden('owner-only'),

      records (q) {
        const t = within(q)
        if (t.err) return t.err
        const v = ask(t, 'record.read')
        if (v.effect !== 'allow') return denied(v)
        const rows = t.db.list(t.obj.key, {})
        const limit = limitOf(plain(q) ? q : {})
        return { ok: true, object: t.obj.key, total: rows.length, truncated: rows.length > limit, records: rows.slice(0, limit).map((r) => shapeFor(t.who.profile, t.obj, r)), fingerprint: t.db.fingerprint() }
      },

      links (q) {
        const t = within(q)
        if (t.err) return t.err
        const v = ask(t, 'record.read')
        if (v.effect !== 'allow') return denied(v)
        const r = owner.links(q)
        if (!r.ok) return r
        const objects = t.db.objects()
        const groups = []
        for (const g of r.groups) {
          const from = findObject(objects, g.object)
          const field = from.fields.find((f) => f.key === g.field)
          if (can({ ...who, profile: t.who.profile }, 'record.read', { object: g.object }).effect !== 'allow' || fieldAccess(t.who.profile, g.object, field) === 'hidden') continue
          const titleSeen = fieldAccess(t.who.profile, g.object, from.fields.find((f) => f.key === from.title)) !== 'hidden'
          groups.push({ ...g, records: g.records.map((x) => (titleSeen ? x : { ...x, title: '' })) })
        }
        return { ...r, groups }
      },

      upload (q) {
        const t = within(q)
        if (t.err) return t.err
        const field = t.obj.fields.find((f) => f.key === t.a.field)
        if (field === undefined) return fail('invalid', 'there is no attachment field of that name in this table')
        const v = ask(t, 'field.write', field)
        if (v.effect !== 'allow') return denied(v)
        return owner.upload(q)
      },

      file (q) {
        const t = within(q)
        if (t.err) return t.err
        const field = t.obj.fields.find((f) => f.key === t.a.field)
        if (field === undefined) return fail('missing', 'that row holds no such file')
        const v = ask(t, 'field.read', field)
        if (v.effect !== 'allow') return denied(v)
        const row = ask(t, 'record.read')
        if (row.effect !== 'allow') return denied(row)
        return owner.file(q)
      },

      write (body) {
        const t = within(body)
        if (t.err) return t.err
        const op = t.a.op
        if (op !== 'create' && op !== 'update' && op !== 'delete' && op !== 'restore') return fail('invalid', 'op is create or update')
        const v = ask(t, op === 'create' ? 'record.create' : op === 'update' ? 'record.update' : 'record.delete')
        if (v.effect !== 'allow') return denied(v)
        if (op === 'create' || op === 'update') {
          const given = plain(t.a.values) ? t.a.values : {}
          for (const key of Object.keys(given)) {
            const field = t.obj.fields.find((f) => f.key === key)
            if (field === undefined) return fail('invalid', 'no such field in this table: ' + key)
            const f = ask(t, 'field.write', field)
            if (f.effect !== 'allow') return denied(f)
          }
        }
        const r = owner.write(body)
        return r.ok && r.record !== undefined ? { ...r, record: { ...r.record, values: values(t.who.profile, t.obj, r.record) } } : r
      },
    }
  }

  const owners = ownerDoor(OWNER_BY)
  /** The door for an actor: the owner's, a member's, or one that refuses everything. */
  owners.as = (actor) => {
    if (plain(actor) && actor.kind === 'person' && actor.role === 'owner') return owners
    if (plain(actor) && actor.kind === 'member' && typeof actor.role === 'string' && actor.role !== '') return memberDoor(actor)
    return closedDoor()
  }
  return owners
}
