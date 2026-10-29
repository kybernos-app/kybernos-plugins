// kybernos-catalog: what the host does with the shared base, pure over its ports.
//
// `createCatalog({ base, registry })` returns the operations the routes and the two agent tools share. Both ports are FUNCTIONS read at each question
// (never at boot): `base()` gives the business seam (`globalThis[Symbol.for('kybernos.business')]`) and `registry()` the registry seam
// (`Symbol.for('kybernos.registry')`), or null. Absent base: every operation answers `{ ok: false, error: 'base_missing' }`. Absent registry: the one plain
// default type. Nothing here throws, touches the disk or the network: the I/O is in the base, the HTTP in index.js.
//
// A row keeps only the KEY of its type and of its status (docs/dev/business-base.md): what they mean is read from the types of the active theme at each
// question. A key that no theme defines any more is not an error, the page draws a generic row; what the person or an agent WRITES must name a known one.
import { CATALOG_POINT_REF, LIMITS, validateCatalogType } from './catalog-type.mjs'

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The type used while no template brings one. English words are required by the point, French is for the page. */
export const DEFAULT_TYPE = Object.freeze({
  id: 'item',
  label: Object.freeze({ en: 'Item', fr: 'Élément' }),
  plural: Object.freeze({ en: 'Items', fr: 'Éléments' }),
  icon: 'package',
  statuses: Object.freeze([
    Object.freeze({ key: 'draft', tone: 'warn', label: Object.freeze({ en: 'Draft', fr: 'Brouillon' }) }),
    Object.freeze({ key: 'live', tone: 'ok', label: Object.freeze({ en: 'Live', fr: 'En ligne' }) }),
    Object.freeze({ key: 'archived', tone: 'neutral', label: Object.freeze({ en: 'Archived', fr: 'Archivé' }) }),
  ]),
  fields: Object.freeze([]),
  card: Object.freeze({}),
  views: Object.freeze(['cards', 'list']),
})

export const LIST_MAX = 500
export const FIND_MAX = 50
const TEXT_MAX = 300
const DATE = /^\d{4}-\d{2}-\d{2}$/
const URL_OK = /^https?:\/\/[^\s<>]{1,280}$/
const EMAIL = /^[^\s@<>]{1,120}@[^\s@<>]{1,120}$/

/** `{ ok: false, error, detail }`: a code the caller switches on, a sentence for a log. */
const refuse = (error, detail) => ({ ok: false, error, detail })

const clean = (s) => { for (const ch of s) { const c = ch.charCodeAt(0); if (c < 32 || c === 127 || ch === '<' || ch === '>') return false } return true }

/**
 * Checks the `fields` an item is given against its type and returns them cleaned (empty values dropped). `{ ok: true, fields }` or a refusal naming the field.
 * A key the type does not define is refused: a field that no sheet would ever show is a typo, not data.
 */
export function checkFields (type, input) {
  if (!plain(input)) return refuse('bad_field', 'fields: an object')
  const defs = new Map(type.fields.map((f) => [f.key, f]))
  const out = {}
  for (const [key, value] of Object.entries(input)) {
    const def = defs.get(key)
    if (def === undefined) return refuse('unknown_field', 'fields.' + key + ': the type "' + type.id + '" has no such field')
    if (value === null || value === '') { out[key] = null; continue }
    const at = 'fields.' + key
    switch (def.type) {
      case 'number': case 'money':
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) return refuse('bad_field', at + ': a finite number')
        out[key] = value
        break
      case 'date':
        if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(value))) return refuse('bad_field', at + ': a date like 2026-12-31')
        out[key] = value
        break
      case 'choice':
        if (def.options.indexOf(value) < 0) return refuse('bad_field', at + ': one of ' + def.options.join(', '))
        out[key] = value
        break
      case 'email':
        if (typeof value !== 'string' || !EMAIL.test(value.trim())) return refuse('bad_field', at + ': an email address')
        out[key] = value.trim()
        break
      case 'url':
        if (typeof value !== 'string' || !URL_OK.test(value.trim())) return refuse('bad_field', at + ': a web address starting with http:// or https://')
        out[key] = value.trim()
        break
      default:
        if (typeof value !== 'string' || value.trim().length > TEXT_MAX || !clean(value)) return refuse('bad_field', at + ': a text of at most ' + TEXT_MAX + ' characters, no < >')
        out[key] = value.trim()
    }
  }
  return { ok: true, fields: out }
}

/** The stored fields with a patch laid over them; a null drops the key. Keys the type no longer defines are kept: removing a template loses nothing. */
const mergeFields = (current, patch) => {
  const out = Object.assign({}, plain(current) ? current : {})
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete out[k]; else out[k] = v }
  return out
}

/** The row an agent reads: what a person sees on the sheet, nothing about the storage. */
export const shortRow = (row) => ({
  id: row.id, type: row.type, title: row.title, subtitle: row.subtitle, status: row.status,
  price_text: row.price_text, price_num: row.price_num, fields: row.fields, demo: row.demo === true, archived: row.archived_at !== null && row.archived_at !== undefined,
})

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const intOr = (v, fallback, min, max) => { const n = typeof v === 'number' ? v : Number(v); return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fallback }

export function createCatalog (ports = {}) {
  const baseOf = () => { try { const b = typeof ports.base === 'function' ? ports.base() : null; return b !== null && b !== undefined && b.version === 1 && typeof b.list === 'function' ? b : null } catch (e) { return null } }
  const registryOf = () => { try { const r = typeof ports.registry === 'function' ? ports.registry() : null; return r !== null && r !== undefined && r.version === 1 && typeof r.contributions === 'function' ? r : null } catch (e) { return null } }

  /** The types the active templates bring (the first of an id wins), or the one default type. Never throws. */
  const types = () => {
    const out = []
    try {
      const registry = registryOf()
      if (registry !== null) {
        const seen = new Set()
        for (const c of registry.contributions(CATALOG_POINT_REF)) {
          const checked = c !== null && typeof c === 'object' ? validateCatalogType(c.value) : { ok: false }
          if (checked.ok !== true || seen.has(checked.value.id)) continue
          seen.add(checked.value.id)
          out.push(checked.value)
          if (out.length >= LIMITS.files) break
        }
      }
    } catch (e) { out.length = 0 }
    return out.length > 0 ? { ok: true, source: 'theme', types: out } : { ok: true, source: 'default', types: [DEFAULT_TYPE] }
  }
  const typeByKey = (list, key) => list.find((t) => t.id === key) || null

  /** Wraps an operation: the base must be there, and nothing thrown gets out. */
  const guarded = (fn) => {
    try {
      const base = baseOf()
      if (base === null) return refuse('base_missing', 'the shared business base is not available')
      return fn(base)
    } catch (e) { return refuse('failed', String(e && e.message ? e.message : e).slice(0, 200)) }
  }

  const tally = (rows) => {
    const counts = {}
    for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1
    return counts
  }

  /** The rows for the page. Filters: `q`, `type`, `status`, `archived` (`'only'` shows the archived rows instead), `limit` (at most 500), `offset`. */
  const list = (query = {}) => guarded((base) => {
    const q = text(query.q, 100)
    const limit = intOr(query.limit, 100, 1, LIST_MAX)
    const offset = intOr(query.offset, 0, 0, 1e6)
    const filters = {}
    if (q !== '') filters.q = q
    if (typeof query.type === 'string' && query.type !== '') filters.type = query.type
    const archivedOnly = query.archived === 'only'
    let result
    let counts
    let countsPartial = false
    if (archivedOnly) {
      // The base lists the live rows or all of them, never only the archived: read all (at most 500) and keep the archived. Past 500 the page says so.
      const all = base.list('item', Object.assign({ includeArchived: true, limit: LIST_MAX }, filters))
      if (all.ok !== true) return all
      const kept = all.rows.filter((r) => r.archived_at !== null && r.archived_at !== undefined)
      result = { ok: true, total: kept.length, rows: kept.slice(offset, offset + limit) }
      counts = tally(kept)
      countsPartial = all.total > LIST_MAX
    } else {
      const wanted = Object.assign({}, filters, { limit, offset })
      if (typeof query.status === 'string' && query.status !== '') wanted.status = query.status
      result = base.list('item', wanted)
      if (result.ok !== true) return result
      // The status chips count the rows of the same search and type, whatever status is chosen.
      if (wanted.status === undefined && offset === 0 && result.rows.length === result.total) counts = tally(result.rows)
      else {
        const everything = base.list('item', Object.assign({ limit: LIST_MAX }, filters))
        if (everything.ok !== true) return everything
        counts = tally(everything.rows)
        countsPartial = everything.total > LIST_MAX
      }
    }
    const counted = base.counts()
    const demo = counted.ok === true ? { items: counted.demo.item, all: counted.demo.item + counted.demo.contact + counted.demo.flow_card } : { items: 0, all: 0 }
    return { ok: true, rows: result.rows, total: result.total, limit, offset, counts, countsPartial, demo }
  })

  const get = (id) => guarded((base) => {
    if (!Number.isInteger(id)) return refuse('bad_id', 'id: a row id')
    return base.get('item', id)
  })

  /** What a write may say, checked against the active types. `current` is the stored row on an update. Returns `{ ok, values }`. */
  const prepare = (input, current) => {
    if (!plain(input)) return refuse('bad_field', 'an item is an object')
    const list = types().types
    const values = {}
    for (const k of ['title', 'subtitle', 'price_text', 'price_num']) if (input[k] !== undefined) values[k] = input[k]
    for (const k of Object.keys(input)) if (['title', 'subtitle', 'price_text', 'price_num', 'type', 'status', 'fields'].indexOf(k) < 0) return refuse('unknown_field', 'item: no column "' + String(k).slice(0, 40) + '"')
    const typeKey = input.type !== undefined ? input.type : (current === null ? list[0].id : current.type)
    if (input.type !== undefined || current === null) {
      if (typeof typeKey !== 'string' || typeByKey(list, typeKey) === null) return refuse('unknown_type', 'type: one of ' + list.map((t) => t.id).join(', '))
      values.type = typeKey
    }
    const type = typeByKey(list, typeKey)
    if (input.status !== undefined) {
      if (type === null) return refuse('unknown_type', 'status: the type of this item is not defined by any active template, set a type first')
      if (typeof input.status !== 'string' || type.statuses.every((s) => s.key !== input.status)) return refuse('unknown_status', 'status: one of ' + type.statuses.map((s) => s.key).join(', '))
      values.status = input.status
    } else if (current === null && type !== null) values.status = type.statuses[0].key
    if (input.fields !== undefined) {
      if (type === null) return refuse('unknown_type', 'fields: the type of this item is not defined by any active template, set a type first')
      const checked = checkFields(type, input.fields)
      if (checked.ok !== true) return checked
      values.fields = mergeFields(current === null ? {} : current.fields, checked.fields)
    }
    return { ok: true, values }
  }

  const create = (input, actor = 'person') => guarded((base) => {
    const made = prepare(input, null)
    if (made.ok !== true) return made
    if (made.values.title === undefined) return refuse('missing_field', 'title: required')
    return base.create('item', made.values, { actor })
  })

  const update = (id, patch, actor = 'person') => guarded((base) => {
    if (!Number.isInteger(id)) return refuse('bad_id', 'id: a row id')
    const current = base.get('item', id)
    if (current.ok !== true) return current
    const made = prepare(patch, current.row)
    if (made.ok !== true) return made
    return base.update('item', id, made.values, { actor })
  })

  const archive = (id, actor = 'person') => guarded((base) => (Number.isInteger(id) ? base.archive('item', id, { actor }) : refuse('bad_id', 'id: a row id')))
  const restore = (id, actor = 'person') => guarded((base) => (Number.isInteger(id) ? base.restore('item', id, { actor }) : refuse('bad_id', 'id: a row id')))

  /** Removes the sample rows. The seam clears them for the three business tables at once; `removed` says how many of each went. */
  const clearDemo = (actor = 'person') => guarded((base) => base.clearDemo({ actor }))

  // ── the two agent tools ─────────────────────────────────────────────────────────────────────────────────
  /** `catalog_find`: read-only, at most 50 rows. */
  const find = (args = {}) => {
    const a = plain(args) ? args : {}
    const filters = { limit: intOr(a.limit, 20, 1, FIND_MAX) }
    if (text(a.q, 100) !== '') filters.q = text(a.q, 100)
    if (typeof a.type === 'string' && a.type !== '') filters.type = a.type
    if (typeof a.status === 'string' && a.status !== '') filters.status = a.status
    if (a.include_archived === true) filters.includeArchived = true
    return guarded((base) => {
      const res = base.list('item', filters)
      if (res.ok !== true) return res
      return { ok: true, total: res.total, count: res.rows.length, items: res.rows.map(shortRow) }
    })
  }

  /** `catalog_upsert`: creates an item (no `id`, a `title` is needed) or changes one (`id`). The journal says `agent`. */
  const upsert = (args = {}) => {
    const a = plain(args) ? args : {}
    const { id, ...rest } = a
    if (id === undefined || id === null) {
      const res = create(rest, 'agent')
      return res.ok === true ? { ok: true, created: true, item: shortRow(res.row) } : res
    }
    if (!Number.isInteger(id)) return refuse('bad_id', 'id: a row id')
    if (Object.keys(rest).length === 0) return refuse('missing_field', 'nothing to change')
    const res = update(id, rest, 'agent')
    return res.ok === true ? { ok: true, created: false, item: shortRow(res.row) } : res
  }

  return Object.freeze({ types, list, get, create, update, archive, restore, clearDemo, find, upsert })
}
