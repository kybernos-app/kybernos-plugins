// kybernos-db — the tools an agent has: it reads and writes records, and it changes the structure of a database, always through the engine and never with raw SQL.
//
//   db_list                 the databases, their objects, fields and views              (read)
//   db_create               a new empty database                                         (the person approves, with a card)
//   object_define           a new object with its fields                                 (card: before and after)
//   field_add               one more field on an object                                  (card)
//   relation_add            a field that links an object to another                      (card)
//   field_update            relabel a field, raise its protection, add choices           (card; the agent can raise a protection, never lower it)
//   view_save               create or change a saved view (filter, sorts, hidden fields) (free: a view is a way of looking, not data)
//   records_list|get        read records; a protected field comes back masked, a secret one not at all
//   records_create|update   write records                                                (free, unless a protected field is written: the person approves)
//   records_delete|restore  mark records deleted, or bring them back                     (free: nothing is lost, the journal keeps it)
//
// Built by hand, like the other plugins that cannot import `defineTool`: `tools.register` only needs { name, description, parameters, output, execute }.
// The approval is the engine's own: `approvalGate` answers the `tools/pre-execute` waterfall with `{ kind: 'ask' }` for the calls above that ask, so the person sees
// the card before anything is written (a session that never asks refuses the call: a structure change is never silent). What asks and what does not is
// `can()` in core/rights.mjs, the one function every door of the engine asks.

import { COLORS, FIELD_TYPES, PROTECTION, can, checkFilter, checkSorts, prepareFilter, queryRecords } from '../core/index.mjs'
import { findObject } from '../store/catalog.mjs'
import { cardFor, protectedCard } from './cards.mjs'
import { fieldLine, short } from './words.mjs'

export const NAMES = ['db_list', 'db_create', 'object_define', 'field_add', 'relation_add', 'field_update', 'view_save', 'records_list', 'records_get', 'records_create', 'records_update', 'records_delete', 'records_restore']
export const LIST_DEFAULT = 20
export const LIST_MAX = 100
export const BATCH_MAX = 50

const AGENT = Object.freeze({ kind: 'agent', role: 'owner' })
const BY = 'agent'
const TEXT = (text) => [{ type: 'text', text }]
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const failure = (r) => ({ ok: false, error: r.code || 'failed', detail: r.message, ...(Array.isArray(r.errors) ? { errors: r.errors.slice(0, 6) } : {}) })
const problem = (error, detail) => ({ ok: false, error, detail })
const localDay = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

// ── what the agent may see of a field ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** `clear`, `masked` or `hidden`: a normal field is clear; a protected one is masked unless the person approved revealing it; a secret one is never read back. */
const visibility = (field, revealed) => {
  if (can(AGENT, 'field.read', { field }).effect === 'allow') return 'clear'
  if (field.protection === 'secret') return 'hidden'
  return revealed.has(field.key) ? 'clear' : 'masked'
}
const mask = (value) => (value === null ? null : typeof value === 'string' && value.length >= 8 ? '•••• ' + value.slice(-4) : '••••')
const revealedOf = (obj, a) => new Set(Array.isArray(a.reveal) ? a.reveal.filter((k) => typeof k === 'string' && obj.fields.some((f) => f.key === k && f.protection !== 'normal' && f.protection !== 'secret')) : [])

/** A record the way an agent reads it. */
function shape (obj, rec, revealed) {
  const values = {}
  for (const f of obj.fields) {
    const v = visibility(f, revealed)
    if (v === 'clear') values[f.key] = rec.values[f.key]
    else if (v === 'masked') values[f.key] = mask(rec.values[f.key])
  }
  const out = { id: rec.id, values, rev: rec.rev, modified: rec.modified }
  if (rec.deleted) out.deleted = rec.deleted
  return out
}
const withheld = (obj, revealed) => ({
  masked: obj.fields.filter((f) => visibility(f, revealed) === 'masked').map((f) => f.key),
  hidden: obj.fields.filter((f) => visibility(f, revealed) === 'hidden').map((f) => f.key),
})

/** The protected fields a set of written values touches. */
const protectedWritten = (obj, valuesList) => {
  const keys = new Set()
  for (const values of valuesList) if (plain(values)) for (const k of Object.keys(values)) keys.add(k)
  return obj.fields.filter((f) => keys.has(f.key) && can(AGENT, 'field.write', { field: f }).effect === 'ask')
}

// ── schemas ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DB = { type: 'string', description: 'The id of the database (see db_list). Leave it out when there is only one.' }
const OBJECT = { type: 'string', description: 'The key of an object (see db_list), for example "task".' }
const OPTION = {
  type: 'object',
  additionalProperties: false,
  properties: { key: { type: 'string', description: 'Lower-case letters, digits, - and _. It never changes.' }, label: { type: 'string' }, color: { type: 'string', enum: COLORS } },
  required: ['key', 'label'],
}
const FIELD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string', description: 'Lower-case letters, digits and _, starting with a letter, 40 at most (for example "due"). It never changes.' },
    type: { type: 'string', enum: FIELD_TYPES },
    label: { type: 'string', description: 'What the person reads, in their language.' },
    required: { type: 'boolean', description: 'A record cannot be saved without it. Not possible on a table that already has records.' },
    protection: { type: 'string', enum: PROTECTION, description: 'Default "normal". Use "personal" for names, emails and phones of people, "sensitive" for money details, "secret" for keys and passwords.' },
    options: { type: 'array', items: OPTION, description: 'The choices of a "choice" or "multichoice" field.' },
    currency: { type: 'string', description: 'A "money" field: EUR, USD…' },
    precision: { type: 'integer', description: 'A "money" field: decimals, 0 to 4 (default 2).' },
    to: { type: 'string', description: 'A "relation" field: the key of the object it points to.' },
    many: { type: 'boolean', description: 'A "relation" field: several linked records instead of one.' },
    maxBytes: { type: 'integer', description: 'An "attachment" field: the largest file, in bytes.' },
  },
  required: ['key', 'type', 'label'],
}
const FILTER_HELP = 'A filter: { "conj": "and"|"or", "items": [ { "k": <field key>, "op": <operator>, "v": <value> }, or a group { "conj", "items" } ] }. Operators: text contains, ncontains, is, isnot, empty, nempty; number or money eq, ne, lt, gt, le, ge, empty, nempty; '
  + 'date is, before, after (v is { "d": "2026-10-30" } or { "n": days from today }), within (v is next7, next30, past7 or past30), empty, nempty; checkbox checked, unchecked; choice, person, one-record relation is, isnot, empty, nempty and in, nin (v is a list of keys or ids); '
  + 'multichoice or many-record relation in, nin, all (v is a list), empty, nempty. empty, nempty, checked and unchecked take no v.'
const SORTS_HELP = 'Up to three sorts: [ { "k": <field key>, "dir": "asc"|"desc" } ]. Empty values go last.'

// ── the tools ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `service` is agent/service.mjs; `ports.today()` gives « today » as YYYY-MM-DD (a test fixes it). */
export function tools (service, ports = {}) {
  const today = typeof ports.today === 'function' ? ports.today : localDay

  /** The db and the object a call means, or `{ err }` with the answer to give. */
  const aim = (a, needObject = true) => {
    const r = service.resolve(a.db)
    if (!r.ok) return { err: failure(r) }
    if (!needObject) return { db: r.db }
    const obj = findObject(r.db.objects(), a.object)
    if (!obj) return { err: problem('unknown_object', 'no object "' + String(a.object) + '" in this database: db_list shows the objects') }
    return { db: r.db, obj }
  }

  const listTool = {
    name: 'db_list',
    description: 'Lists the databases of this computer with their objects (tables), fields and saved views. Read it first: it shows the exact keys every other db tool needs. A field marked protected has a protection level: personal, sensitive or secret.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, dbs: { type: 'array' }, unreadable: { type: 'array' } }, required: ['ok'] },
      render: (args, value) => TEXT(value.ok !== true ? 'Databases: ' + String(value.error) : (value.dbs.length === 0 && value.unreadable.length === 0 ? 'No database yet.' : value.dbs.map((d) => d.name + ' (' + d.id + '): '
        + (d.objects.length === 0 ? 'no object yet' : d.objects.map((o) => o.key + ' [' + o.fields.length + ' fields]').join(', '))).concat(value.unreadable.map((u) => u.name + ': ' + u.error)).join('\n'))),
    },
    async execute () {
      const dbs = []
      const unreadable = []
      for (const d of service.list()) {
        const r = service.byId(d.id)
        if (!r.ok) { unreadable.push({ id: d.id, name: d.name, error: r.code, detail: r.message }); continue }
        const objects = r.db.objects().map((o) => ({
          key: o.key, label: o.label, title: o.title,
          fields: o.fields.map((f) => ({ key: f.key, type: f.type, label: f.label, required: f.required, protection: f.protection, ...(f.options ? { options: f.options.map((x) => ({ key: x.key, label: x.label })) } : {}), ...(f.to ? { to: f.to, many: f.many } : {}), ...(f.currency ? { currency: f.currency } : {}) })),
          views: r.db.listViews(o.key).map((v) => ({ id: v.id, name: v.name, kind: v.kind })),
        }))
        dbs.push({ id: d.id, name: d.name, objects })
      }
      return { ok: true, dbs, unreadable }
    },
  }

  const createDbTool = {
    name: 'db_create',
    description: 'Creates a new, empty database (a file on this computer). The person approves it. Then add objects with object_define.',
    parameters: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', description: 'What the person calls it, for example "Home" or "My shop".' } }, required: ['name'] },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, db: { type: 'object' } }, required: ['ok'] },
      render: (args, value) => TEXT(value.ok === true ? 'Database created: ' + value.db.name + ' (' + value.db.id + ')' : 'Database not created: ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail))),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const r = service.create({ name: a.name, by: BY })
      return r.ok ? { ok: true, db: { id: r.db.info().id, name: r.db.info().name } } : failure(r)
    },
  }

  const objectTool = {
    name: 'object_define',
    description: 'Adds a new object (a table: Tasks, Customers, Orders…) with its fields to a database. The person approves a card that lists the fields. `key` is a lower-case word, `label` what the person reads, `title` the text field that names a record (default: the first field). '
      + 'Think about every field first: its type, whether it is required, and its protection (give personal data "personal", money details "sensitive", keys and passwords "secret"). Link objects afterwards with relation_add. Fields can be added later but never removed or retyped.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { db: DB, key: { type: 'string', description: 'Lower-case letters, digits and _, for example "task". It never changes.' }, label: { type: 'string', description: 'The plural name the person reads, for example "Tasks".' }, title: { type: 'string', description: 'The key of the text field that names a record.' }, fields: { type: 'array', items: FIELD, description: 'At least one field.' } },
      required: ['key', 'label', 'fields'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, object: { type: 'object' } }, required: ['ok'] },
      render: (args, value) => TEXT(value.ok === true ? 'Object defined: ' + value.object.label + ' (' + value.object.key + '), ' + value.object.fields.length + ' fields' : 'Object not defined: ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail))),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const t = aim(a, false)
      if (t.err) return t.err
      const r = t.db.addObject({ key: a.key, label: a.label, title: a.title, fields: a.fields }, BY)
      return r.ok ? { ok: true, object: r.object } : failure(r)
    },
  }

  const fieldTool = {
    name: 'field_add',
    description: 'Adds one field to an object. The person approves a card. Existing records stay empty on the new field, so a field cannot be `required` on an object that already has records. A field is never removed or retyped later, so choose its type with care.',
    parameters: { type: 'object', additionalProperties: false, properties: { db: DB, object: OBJECT, field: FIELD }, required: ['object', 'field'] },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, field: { type: 'object' } }, required: ['ok'] },
      render: (args, value) => TEXT(value.ok === true ? 'Field added: ' + fieldLine(value.field, 'en') : 'Field not added: ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail))),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const t = aim(a)
      if (t.err) return t.err
      const r = t.db.addField(t.obj.key, a.field, BY)
      return r.ok ? { ok: true, field: r.field } : failure(r)
    },
  }

  const relationTool = {
    name: 'relation_add',
    description: 'Links an object to another one: adds a relation field on `object` that points at `to` (a task has one project; an order has many products with `many`). Both objects must already exist. The person approves a card.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { db: DB, object: OBJECT, key: { type: 'string', description: 'The key of the new field, for example "project".' }, label: { type: 'string' }, to: { type: 'string', description: 'The key of the object it points to.' }, many: { type: 'boolean', description: 'Several linked records instead of one.' }, protection: { type: 'string', enum: PROTECTION } },
      required: ['object', 'key', 'label', 'to'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, field: { type: 'object' } }, required: ['ok'] },
      render: (args, value) => TEXT(value.ok === true ? 'Link added: ' + fieldLine(value.field, 'en') : 'Link not added: ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail))),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const t = aim(a)
      if (t.err) return t.err
      if (!findObject(t.db.objects(), a.to)) return problem('unknown_object', 'no object "' + String(a.to) + '" to link to: define it first with object_define')
      const r = t.db.addField(t.obj.key, { key: a.key, type: 'relation', label: a.label, to: a.to, many: a.many === true, ...(a.protection === undefined ? {} : { protection: a.protection }) }, BY)
      return r.ok ? { ok: true, field: r.field } : failure(r)
    },
  }

  const updateTool = {
    name: 'field_update',
    description: 'Changes a field: its label, its protection, or adds choices to a choice field (a choice is never removed: keep it and relabel it). You can raise a protection (normal → personal → sensitive → secret), never lower it: only the person lowers one, in the field settings. The person approves a card.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { db: DB, object: OBJECT, key: { type: 'string', description: 'The key of the field to change.' }, label: { type: 'string' }, protection: { type: 'string', enum: PROTECTION }, options: { type: 'array', items: OPTION, description: 'The whole list of choices: the existing ones (same keys) and the new ones.' } },
      required: ['object', 'key'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, field: { type: 'object' }, applied: { type: 'boolean' } }, required: ['ok'] },
      render: (args, value) => TEXT(value.ok === true ? (value.applied ? 'Field changed: ' : 'Nothing to change: ') + fieldLine(value.field, 'en') : 'Field not changed: ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail))),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const t = aim(a)
      if (t.err) return t.err
      const field = t.obj.fields.find((f) => f.key === a.key)
      if (!field) return problem('unknown_field', 'no field "' + String(a.key) + '" in ' + t.obj.key)
      if (a.protection !== undefined && can(AGENT, 'field.protect', { field, to: a.protection }).effect === 'deny') {
        return problem('agent_cannot_lower', 'the protection of "' + field.key + '" is ' + field.protection + ': you can raise it, only the person can lower it')
      }
      const changes = {}
      for (const k of ['label', 'protection', 'options']) if (a[k] !== undefined) changes[k] = a[k]
      const r = t.db.updateField(t.obj.key, field.key, changes, BY)
      return r.ok ? { ok: true, applied: r.applied, field: r.field } : failure(r)
    },
  }

  const viewTool = {
    name: 'view_save',
    description: 'Creates or changes a saved view of an object: how its records are shown (table, board with the columns of a choice field, calendar on a date field, cards), which are shown (`state.flt`), in what order (`state.sorts`) and which fields are hidden (`state.hidden`). '
      + 'Give `id` to change an existing view (db_list shows them), nothing to create one. The person sees the result at once and can change it. ' + FILTER_HELP + ' ' + SORTS_HELP,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        db: DB,
        object: OBJECT,
        view: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: 'An existing view to change.' },
            name: { type: 'string' },
            kind: { type: 'string', enum: ['table', 'board', 'cards', 'calendar'] },
            by: { type: 'string', description: 'A board: the key of the choice field that makes its columns (default: the first one).' },
            date: { type: 'string', description: 'A calendar: the key of the date field that places a record (default: the first one).' },
            fav: { type: 'boolean' },
            state: { type: 'object', description: '{ "flt": <filter>, "sorts": [...], "hidden": [field keys] }; leave out what you do not change.' },
          },
          required: ['name', 'kind'],
        },
      },
      required: ['object', 'view'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, view: { type: 'object' } }, required: ['ok'] },
      render: (args, value) => TEXT(value.ok === true ? (value.created ? 'View created: ' : (value.applied ? 'View changed: ' : 'View unchanged: ')) + value.view.name + ' (' + value.view.kind + ')' : 'View not saved: ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail))),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const t = aim(a)
      if (t.err) return t.err
      if (can(AGENT, 'view.edit', {}).effect !== 'allow') return problem('refused', 'the agent may not edit views here')
      let view = a.view
      if (plain(view)) {
        // A change keeps what it does not name (and who made the view first); a new view is Kaby's.
        const before = typeof view.id === 'string' ? t.db.getView(t.obj.key, view.id) : null
        view = before === null
          ? { owner: 'kaby', ...view }
          : { ...before, ...view, owner: before.owner, state: { ...before.state, ...(plain(view.state) ? view.state : {}) } }
      }
      const r = t.db.saveView(t.obj.key, view, BY)
      return r.ok ? { ok: true, created: r.created, applied: r.applied, view: r.view } : failure(r)
    },
  }

  const listRecords = {
    name: 'records_list',
    description: 'Lists the records of an object, newest last. Give `q` to search the text, `filter` and `sorts` (or `view`, the id of a saved view, to use its filter and sorts). A protected field comes back masked (“•••• 1234”) and a secret one is left out; to read a protected one in clear, name it in `reveal` and the person is asked. '
      + FILTER_HELP + ' ' + SORTS_HELP + ' A filter or a sort on a protected field is refused.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        db: DB,
        object: OBJECT,
        q: { type: 'string', description: 'Words to look for in the records.' },
        filter: { type: 'object', description: 'A filter, see above.' },
        sorts: { type: 'array', items: { type: 'object' }, description: 'Up to three sorts, see above.' },
        view: { type: 'string', description: 'The id of a saved view: its filter and sorts apply unless you give your own.' },
        deleted: { type: 'boolean', description: 'List the deleted records instead.' },
        limit: { type: 'integer', description: 'At most this many (default ' + LIST_DEFAULT + ', at most ' + LIST_MAX + ').' },
        offset: { type: 'integer', description: 'Skip this many (to read the next page).' },
        reveal: { type: 'array', items: { type: 'string' }, description: 'Keys of protected fields to read in clear (the person is asked).' },
      },
      required: ['object'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, total: { type: 'integer' }, count: { type: 'integer' }, records: { type: 'array' } }, required: ['ok'] },
      render: (args, value) => TEXT(value.ok !== true ? 'Records: ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail))
        : (value.count === 0 ? 'No record found.' : value.count + (value.total > value.count ? ' of ' + value.total : '') + ' record(s):\n' + value.records.map((r) => '#' + r.id + ' ' + short(JSON.stringify(r.values), 200)).join('\n'))),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const t = aim(a)
      if (t.err) return t.err
      const revealed = revealedOf(t.obj, a)
      const clear = t.obj.fields.filter((f) => visibility(f, revealed) === 'clear')
      let flt = a.filter
      let sorts = a.sorts
      if (a.view !== undefined) {
        const view = t.db.getView(t.obj.key, a.view)
        if (!view) return problem('unknown_view', 'no view "' + String(a.view) + '": db_list shows the views')
        if (flt === undefined) flt = prepareFilter(view.state.flt, clear)
        if (sorts === undefined) sorts = view.state.sorts.filter((s) => clear.some((f) => f.key === s.k))
      }
      if (flt !== undefined) { const e = checkFilter(flt, clear); if (e.length) return { ok: false, error: 'invalid_filter', detail: (e[0].path ? e[0].path + ': ' : '') + e[0].message + ' (only the fields you may read in clear can be filtered)', errors: e.slice(0, 6) } }
      if (sorts !== undefined) { const e = checkSorts(sorts, clear); if (e.length) return { ok: false, error: 'invalid_sorts', detail: (e[0].path ? e[0].path + ': ' : '') + e[0].message, errors: e.slice(0, 6) } }
      const limit = Number.isInteger(a.limit) ? Math.min(Math.max(a.limit, 1), LIST_MAX) : LIST_DEFAULT
      const offset = Number.isInteger(a.offset) && a.offset > 0 ? a.offset : 0
      const rows = a.deleted === true
        ? t.db.list(t.obj.key, { deleted: true })
        : queryRecords(t.db.list(t.obj.key), { fields: clear, q: a.q, flt, sorts }, { today: today(), me: 'me' })
      const page = rows.slice(offset, offset + limit).map((r) => shape(t.obj, r, revealed))
      return { ok: true, object: t.obj.key, total: rows.length, count: page.length, offset, records: page, ...withheld(t.obj, revealed) }
    },
  }

  const getRecord = {
    name: 'records_get',
    description: 'Reads one record by id. A protected field comes back masked and a secret one is left out; name a protected field in `reveal` to read it in clear (the person is asked).',
    parameters: { type: 'object', additionalProperties: false, properties: { db: DB, object: OBJECT, id: { type: 'string', description: 'The id of the record.' }, reveal: { type: 'array', items: { type: 'string' } } }, required: ['object', 'id'] },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, record: { type: 'object' } }, required: ['ok'] },
      render: (args, value) => TEXT(value.ok === true ? '#' + value.record.id + ' ' + short(JSON.stringify(value.record.values), 300) : 'Record: ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail))),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const t = aim(a)
      if (t.err) return t.err
      const rec = t.db.get(t.obj.key, a.id)
      if (!rec) return problem('missing', 'no record with this id in ' + t.obj.key)
      const revealed = revealedOf(t.obj, a)
      return { ok: true, record: shape(t.obj, rec, revealed), ...withheld(t.obj, revealed) }
    },
  }

  const batch = (a, key) => (Array.isArray(a[key]) && a[key].length >= 1 && a[key].length <= BATCH_MAX ? a[key] : null)
  const tooMany = (key) => problem('invalid', '`' + key + '` is a list of 1 to ' + BATCH_MAX + ' items')

  const createRecords = {
    name: 'records_create',
    description: 'Creates records: `records` is a list (up to ' + BATCH_MAX + ') of { field key: value } maps. Values: text as a string, number or money as a number, date as "YYYY-MM-DD", checkbox as true/false, choice as the option key, multichoice as a list of option keys, person as a member id, relation as the id of the linked record (a list when `many`). '
      + 'Nothing is coerced: "12" is not a number. Empty is null. The answer lists what was created and what was refused, with the reason. Writing a protected field asks the person.',
    parameters: { type: 'object', additionalProperties: false, properties: { db: DB, object: OBJECT, records: { type: 'array', items: { type: 'object' } } }, required: ['object', 'records'] },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, created: { type: 'array' }, failed: { type: 'array' } }, required: ['ok'] },
      render: (args, value) => TEXT(value.created === undefined ? 'Records not created: ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail))
        : value.created.length + ' record(s) created' + (value.failed.length ? ', ' + value.failed.length + ' refused: ' + value.failed.map((f) => '#' + f.index + ' ' + f.error + (f.detail ? ' (' + f.detail + ')' : '')).join('; ') : '')),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const t = aim(a)
      if (t.err) return t.err
      const list = batch(a, 'records')
      if (list === null) return tooMany('records')
      const created = []
      const failed = []
      list.forEach((values, index) => {
        const r = t.db.create(t.obj.key, values, BY)
        if (r.ok) created.push(shape(t.obj, r.record, new Set()))
        else failed.push({ index, error: r.code, detail: r.message })
      })
      return { ok: failed.length === 0, created, failed }
    },
  }

  const updateRecords = {
    name: 'records_update',
    description: 'Changes records: `updates` is a list (up to ' + BATCH_MAX + ') of { "id": <record id>, "values": { field key: new value } }. Only the fields you name change; null empties one. A deleted record cannot be changed (restore it first). Writing a protected field asks the person.',
    parameters: { type: 'object', additionalProperties: false, properties: { db: DB, object: OBJECT, updates: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, values: { type: 'object' } }, required: ['id', 'values'] } } }, required: ['object', 'updates'] },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, updated: { type: 'array' }, failed: { type: 'array' } }, required: ['ok'] },
      render: (args, value) => TEXT(value.updated === undefined ? 'Records not changed: ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail))
        : value.updated.length + ' record(s) changed' + (value.failed.length ? ', ' + value.failed.length + ' refused: ' + value.failed.map((f) => '#' + f.index + ' ' + f.error + (f.detail ? ' (' + f.detail + ')' : '')).join('; ') : '')),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const t = aim(a)
      if (t.err) return t.err
      const list = batch(a, 'updates')
      if (list === null) return tooMany('updates')
      const updated = []
      const failed = []
      list.forEach((u, index) => {
        if (!plain(u)) { failed.push({ index, error: 'invalid', detail: 'an update is { id, values }' }); return }
        const r = t.db.update(t.obj.key, u.id, u.values, BY)
        if (r.ok) updated.push(shape(t.obj, r.record, new Set()))
        else failed.push({ index, id: u.id, error: r.code, detail: r.message })
      })
      return { ok: failed.length === 0, updated, failed }
    },
  }

  const mark = (name, method, done, description) => ({
    name,
    description,
    parameters: { type: 'object', additionalProperties: false, properties: { db: DB, object: OBJECT, ids: { type: 'array', items: { type: 'string' }, description: 'Record ids, up to ' + BATCH_MAX + '.' } }, required: ['object', 'ids'] },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, done: { type: 'integer' }, failed: { type: 'array' } }, required: ['ok'] },
      render: (args, value) => TEXT(value.failed === undefined ? name + ': ' + String(value.error) + (value.detail === undefined ? '' : ' — ' + String(value.detail)) : value.done + ' record(s) ' + done + (value.failed.length ? ', ' + value.failed.length + ' refused' : '')),
    },
    async execute (args) {
      const a = plain(args) ? args : {}
      const t = aim(a)
      if (t.err) return t.err
      const ids = batch(a, 'ids')
      if (ids === null) return tooMany('ids')
      let n = 0
      const failed = []
      ids.forEach((id, index) => {
        const r = t.db[method](t.obj.key, id, BY)
        if (r.ok) { if (r.applied) n += 1 } else failed.push({ index, id, error: r.code, detail: r.message })
      })
      return { ok: failed.length === 0, done: n, failed }
    },
  })

  // A render is shown to the person after the call: it must never throw, whatever it is handed.
  const guarded = (tool) => ({
    ...tool,
    output: { ...tool.output, render: (args, value) => { try { return tool.output.render(args, value) } catch (e) { return TEXT(short(JSON.stringify(value), 300)) } } },
  })

  return [
    listTool, createDbTool, objectTool, fieldTool, relationTool, updateTool, viewTool, listRecords, getRecord, createRecords, updateRecords,
    mark('records_delete', 'remove', 'deleted', 'Deletes records: they are marked deleted, hidden from lists, and can be brought back with records_restore (nothing is lost). `ids` is a list of record ids.'),
    mark('records_restore', 'restore', 'restored', 'Brings deleted records back. `ids` is a list of record ids.'),
  ].map(guarded)
}

// ── the approval ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const STRUCTURE = ['db_create', 'object_define', 'field_add', 'relation_add', 'field_update']

/**
 * The `tools/pre-execute` answer for a call: `{ kind: 'ask', reason, displayReason }` when the person must approve it, else `null`, so the next handler decides.
 * What asks: a change of structure (a card, before and after), writing a protected field, reading one in clear. A call the engine would refuse anyway asks nothing.
 */
export function approvalGate (service, exec) {
  if (!plain(exec) || !NAMES.includes(exec.name)) return null
  const a = plain(exec.arguments) ? exec.arguments : {}
  let card = null
  if (STRUCTURE.includes(exec.name)) {
    const r = exec.name === 'db_create' ? { ok: true } : service.resolve(a.db)
    if (!r.ok) return null
    const info = r.db ? r.db.info() : { name: '' }
    const objects = r.db ? r.db.objects() : []
    const field = exec.name === 'field_update' ? (findObject(objects, a.object) || { fields: [] }).fields.find((f) => f.key === a.key) : undefined
    // A call the engine will refuse (the agent lowering a protection) is never put to the person: they get the refusal, not a question.
    if (field !== undefined && a.protection !== undefined && can(AGENT, 'field.protect', { field, to: a.protection }).effect === 'deny') return null
    card = cardFor(exec.name, a, objects, info.name)
  } else if (exec.name === 'records_create' || exec.name === 'records_update' || exec.name === 'records_list' || exec.name === 'records_get') {
    const r = service.resolve(a.db)
    if (!r.ok) return null
    const obj = findObject(r.db.objects(), a.object)
    if (!obj) return null
    if (exec.name === 'records_create' && Array.isArray(a.records)) {
      const fields = protectedWritten(obj, a.records)
      if (fields.length) card = protectedCard('write', fields, obj)
    } else if (exec.name === 'records_update' && Array.isArray(a.updates)) {
      const fields = protectedWritten(obj, a.updates.map((u) => (plain(u) ? u.values : null)))
      if (fields.length) card = protectedCard('write', fields, obj)
    } else if (Array.isArray(a.reveal)) {
      const keys = revealedOf(obj, a)
      if (keys.size) card = protectedCard('reveal', obj.fields.filter((f) => keys.has(f.key)), obj)
    }
  }
  if (card === null) return null
  return { kind: 'ask', reason: card.en, displayReason: { en: card.en, fr: card.fr } }
}
