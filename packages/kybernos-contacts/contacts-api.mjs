// kybernos-contacts — what the routes and the agent tools do, with the base and the theme's words passed in as ports.
//
//   base()    the business base seam, looked up when the question comes (`globalThis[Symbol.for('kybernos.business')]`), or null
//   schema()  the merged words of the active themes (contacts-words.mjs), looked up the same way
//
// Pure of I/O but for those two ports: no disk, no network, nothing sent. Every answer is `{ ok: true, … }` or `{ ok: false, error, detail? }`;
// nothing throws, and a base that is not there answers `base_missing`. The actor of a write is never read from a body: the routes say `person`, the
// agent tools say `agent` (the journal of the base keeps who).
import { checkContact, checkNote, mergeFields, KINDS } from './contacts-input.mjs'
import { vocabulary } from './contacts-words.mjs'

export const LIST_MAX = 500
export const LIST_DEFAULT = 100
const SCAN_PAGES = 20 // a tag filter reads the base 500 rows at a time, up to this many pages (10,000 contacts), then says it stopped
const TYPE_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/

const fail = (error, detail) => (detail === undefined ? { ok: false, error } : { ok: false, error, detail })
const wholeNumber = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : (typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : undefined))
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true'

export function createApi ({ base, schema }) {
  const run = (fn) => {
    let b = null
    try { b = base() } catch (e) { b = null }
    if (b === null || b === undefined || b.version !== 1 || typeof b.list !== 'function') return fail('base_missing')
    try { return fn(b) } catch (e) { return fail('failed', String(e && e.message ? e.message : e).slice(0, 200)) }
  }
  const words = () => { try { return schema() } catch (e) { return { themed: false, themes: [], types: [], fields: [], tags: [] } } }

  /** Each row with the name of its company, one lookup per company (an archived company still has its name). */
  const withCompanies = (b, rows) => {
    const names = new Map()
    return rows.map((row) => {
      if (row.company_id === null || row.company_id === undefined) return Object.assign({}, row, { company: null })
      if (!names.has(row.company_id)) { const c = b.get('contact', row.company_id); names.set(row.company_id, c.ok ? { id: c.row.id, name: c.row.name } : null) }
      return Object.assign({}, row, { company: names.get(row.company_id) })
    })
  }

  const demoCount = (b) => { const r = b.list('contact', { demo: true, includeArchived: true, limit: 1 }); return r.ok ? r.total : 0 }

  /** The filters of a list, checked: `{ opts }` for the base, `{ tag }` for the host, or `{ error }`. */
  const filters = (q) => {
    const opts = {}
    if (q.q !== undefined && q.q !== null && q.q !== '') { if (typeof q.q !== 'string' || q.q.length > 200) return { error: fail('bad_field', 'q: at most 200 characters') }; opts.q = q.q }
    if (q.kind !== undefined && q.kind !== null && q.kind !== '') { if (KINDS.indexOf(q.kind) < 0) return { error: fail('bad_field', 'kind: person or company') }; opts.kind = q.kind }
    if (q.type !== undefined && q.type !== null && q.type !== '') { if (typeof q.type !== 'string' || !TYPE_KEY.test(q.type)) return { error: fail('bad_field', 'type: a key from the list of types') }; opts.type = q.type }
    if (q.company_id !== undefined && q.company_id !== null && q.company_id !== '') { const id = wholeNumber(q.company_id); if (id === undefined || id < 1) return { error: fail('bad_field', 'company_id: a company id') }; opts.company_id = id }
    if (truthy(q.archived)) opts.includeArchived = true
    if (q.demo !== undefined && q.demo !== null && q.demo !== '') opts.demo = truthy(q.demo)
    let tag = null
    if (q.tag !== undefined && q.tag !== null && q.tag !== '') { if (typeof q.tag !== 'string' || q.tag.length > 40) return { error: fail('bad_field', 'tag: at most 40 characters') }; tag = q.tag }
    const limit = q.limit === undefined || q.limit === '' ? LIST_DEFAULT : wholeNumber(q.limit)
    const offset = q.offset === undefined || q.offset === '' ? 0 : wholeNumber(q.offset)
    if (limit === undefined || limit < 1) return { error: fail('bad_field', 'limit: 1 to ' + LIST_MAX) }
    if (offset === undefined) return { error: fail('bad_field', 'offset: a whole number from 0') }
    return { opts, tag, limit: Math.min(limit, LIST_MAX), offset }
  }

  /** The base cannot filter on a tag (a JSON column): read the matching rows page by page, keep those that carry it. */
  const scanTag = (b, opts, tag) => {
    const kept = []
    let at = 0
    for (let page = 0; page < SCAN_PAGES; page += 1) {
      const r = b.list('contact', Object.assign({}, opts, { limit: LIST_MAX, offset: at }))
      if (!r.ok) return r
      for (const row of r.rows) if (row.tags.indexOf(tag) >= 0) kept.push(row)
      at += r.rows.length
      if (r.rows.length === 0 || at >= r.total) return { ok: true, rows: kept, truncated: false }
    }
    return { ok: true, rows: kept, truncated: true }
  }

  const list = (q = {}) => run((b) => {
    const f = filters(q || {})
    if (f.error !== undefined) return f.error
    let rows
    let total
    let truncated = false
    if (f.tag === null) {
      const r = b.list('contact', Object.assign({}, f.opts, { limit: f.limit, offset: f.offset }))
      if (!r.ok) return r
      rows = r.rows; total = r.total
    } else {
      const r = scanTag(b, f.opts, f.tag)
      if (!r.ok) return r
      total = r.rows.length; truncated = r.truncated
      rows = r.rows.slice(f.offset, f.offset + f.limit)
    }
    return { ok: true, rows: withCompanies(b, rows), total, limit: f.limit, offset: f.offset, truncated, demo: demoCount(b) }
  })

  const get = (id) => run((b) => {
    const n = wholeNumber(id)
    if (n === undefined || n < 1) return fail('bad_id', 'id: a contact id')
    const r = b.get('contact', n)
    if (!r.ok) return r
    const row = r.row
    const notes = b.list('note', { contact_id: row.id, limit: 200 })
    // the cards of a board that point at this contact (read only: the boards belong to the Pipeline plugin, the base is shared)
    const cards = b.list('flow_card', { contact_id: row.id, limit: 20 })
    const out = { ok: true, contact: row, notes: notes.ok ? notes.rows : [], company: null, people: [], cards: cards.ok ? cards.rows.map((c) => ({ id: c.id, flow: c.flow, stage: c.stage, title: c.title })) : [] }
    if (row.company_id !== null) { const c = b.get('contact', row.company_id); if (c.ok) out.company = { id: c.row.id, name: c.row.name, type: c.row.type, archived: c.row.archived_at !== null } }
    if (row.kind === 'company') {
      const p = b.list('contact', { company_id: row.id, limit: 100 })
      if (p.ok) out.people = p.rows.map((x) => ({ id: x.id, name: x.name, type: x.type, email: x.email }))
    }
    return out
  })

  const create = (body, opts) => run((b) => {
    const actor = opts !== undefined && opts !== null && opts.actor !== undefined ? opts.actor : 'person'
    const checked = checkContact(words(), body, { creating: true })
    if (!checked.ok) return checked
    const values = Object.assign({}, checked.values)
    if (values.fields !== undefined) values.fields = mergeFields({}, values.fields)
    const r = b.create('contact', values, { actor })
    return r.ok ? { ok: true, contact: withCompanies(b, [r.row])[0] } : r
  })

  const update = (id, body, opts) => run((b) => {
    const actor = opts !== undefined && opts !== null && opts.actor !== undefined ? opts.actor : 'person'
    const n = wholeNumber(id)
    if (n === undefined || n < 1) return fail('bad_id', 'id: a contact id')
    const had = b.get('contact', n)
    if (!had.ok) return had
    const checked = checkContact(words(), body, { creating: false, current: had.row })
    if (!checked.ok) return checked
    const values = Object.assign({}, checked.values)
    if (values.fields !== undefined) values.fields = mergeFields(had.row.fields, values.fields)
    const r = b.update('contact', n, values, { actor })
    return r.ok ? { ok: true, contact: withCompanies(b, [r.row])[0] } : r
  })

  const archiveOrRestore = (id, restoring, opts) => run((b) => {
    const actor = opts !== undefined && opts !== null && opts.actor !== undefined ? opts.actor : 'person'
    const n = wholeNumber(id)
    if (n === undefined || n < 1) return fail('bad_id', 'id: a contact id')
    const r = restoring ? b.restore('contact', n, { actor }) : b.archive('contact', n, { actor })
    return r.ok ? { ok: true, contact: withCompanies(b, [r.row])[0] } : r
  })

  /** A note is added, never edited: it is the history of the contact. */
  const addNote = (id, text, opts) => run((b) => {
    const actor = opts !== undefined && opts !== null && opts.actor !== undefined ? opts.actor : 'person'
    const n = wholeNumber(id)
    if (n === undefined || n < 1) return fail('bad_id', 'id: a contact id')
    const body = checkNote(text)
    if (!body.ok) return body
    const had = b.get('contact', n)
    if (!had.ok) return had
    const r = b.create('note', { contact_id: n, body: body.value }, { actor })
    return r.ok ? { ok: true, note: r.row } : r
  })

  /** Removes the sample rows of every business plugin (the base keeps one set of them); what the person made stays. */
  const clearDemo = (opts) => run((b) => {
    const actor = opts !== undefined && opts !== null && opts.actor !== undefined ? opts.actor : 'person'
    return b.clearDemo({ actor })
  })

  /** Contacts with exactly this email (case aside), for an agent that is about to create one. */
  const byEmail = (email) => run((b) => {
    if (typeof email !== 'string' || email.trim() === '') return { ok: true, rows: [] }
    const r = b.list('contact', { q: email.trim(), limit: 20 })
    return r.ok ? { ok: true, rows: r.rows.filter((x) => x.email.toLowerCase() === email.trim().toLowerCase()) } : r
  })

  /** A company named by an agent: exactly one match (case aside), or why not. */
  const companyByName = (name) => run((b) => {
    if (typeof name !== 'string' || name.trim() === '') return fail('bad_field', 'company: a company name')
    const r = b.list('contact', { kind: 'company', q: name.trim(), limit: 20 })
    if (!r.ok) return r
    const exact = r.rows.filter((x) => x.name.toLowerCase() === name.trim().toLowerCase())
    if (exact.length === 1) return { ok: true, company: exact[0] }
    if (exact.length > 1) return fail('company_ambiguous', exact.length + ' companies are called "' + name.trim() + '": give company_id (' + exact.map((x) => x.id).join(', ') + ')')
    return fail('company_not_found', 'no company is called "' + name.trim() + '": create it first with kind "company"')
  })

  const schemaOut = () => { const s = words(); return { ok: true, schema: { themed: s.themed, themes: s.themes, types: s.types, fields: s.fields, tags: s.tags } } }

  return Object.freeze({ list, get, create, update, archive: (id, opts) => archiveOrRestore(id, false, opts), restore: (id, opts) => archiveOrRestore(id, true, opts), addNote, clearDemo, byEmail, companyByName, schema: schemaOut, vocabulary: () => vocabulary(words()) })
}
