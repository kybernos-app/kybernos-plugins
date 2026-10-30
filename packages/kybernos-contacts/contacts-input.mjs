// kybernos-contacts — what a person (or an agent) may say about a contact, checked against the words of the active theme.
//
// The base checks the columns (bounded text, JSON size, links); this checks what the base cannot see: the type belongs to the kind, and every custom
// field is one the theme defines, with a value of its kind. Pure; answers `{ ok: true, … }` or `{ ok: false, error, detail }`, the codes of the base.
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const refuse = (error, detail) => ({ ok: false, error, detail })

export const KINDS = Object.freeze(['person', 'company'])
const CONTACT_KEYS = ['kind', 'type', 'name', 'email', 'company_id', 'tags', 'fields']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/
const NUMBER_MAX = 1e12

const numberOf = (v) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= NUMBER_MAX ? n : null
}
const dateOk = (s) => { if (!DATE.test(s)) return false; const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s }
const urlOk = (s) => { try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' } catch (e) { return false } }

/** One custom field's value, or `{ error }`. `null` clears the field. */
function fieldValue (field, v) {
  if (v === null) return { value: null }
  const at = 'fields.' + field.key
  if (field.type === 'number' || field.type === 'money') {
    const n = numberOf(v)
    return n === null ? { error: at + ': a number' } : { value: n }
  }
  if (typeof v !== 'string') return { error: at + ': a text' }
  const s = v.trim()
  if (s.length > 500) return { error: at + ': at most 500 characters' }
  if (s === '') return { value: null }
  if (field.type === 'email') return EMAIL.test(s) && s.length <= 254 ? { value: s } : { error: at + ': an email address' }
  if (field.type === 'url') return urlOk(s) ? { value: s } : { error: at + ': an http or https address' }
  if (field.type === 'date') return dateOk(s) ? { value: s } : { error: at + ': a date like 2026-10-29' }
  if (field.type === 'choice') return Array.isArray(field.options) && field.options.indexOf(s) >= 0 ? { value: s } : { error: at + ': one of ' + (Array.isArray(field.options) ? field.options.join(', ') : '(none)') }
  return { value: s }
}

/** The custom fields a body carries, checked against the theme's. A key the theme does not define is refused (it names the keys that exist). */
export function checkFields (schema, input) {
  if (!plain(input)) return refuse('bad_field', 'fields: an object')
  const out = {}
  for (const k of Object.keys(input)) {
    const field = schema.fields.find((f) => f.key === k)
    if (field === undefined) return refuse('unknown_field', 'fields.' + k + ': not a field of this theme' + (schema.fields.length > 0 ? ' (known: ' + schema.fields.map((f) => f.key).join(', ') + ')' : ' (no theme adds fields)'))
    const r = fieldValue(field, input[k])
    if (r.error !== undefined) return refuse('bad_field', r.error)
    out[k] = r.value
  }
  return { ok: true, value: out }
}

/** Tags as a list: an array, or one text with commas. Trimmed, no empty one, no duplicate. The base bounds their number and length. */
export function checkTags (input) {
  const raw = typeof input === 'string' ? input.split(',') : input
  if (!Array.isArray(raw)) return refuse('bad_field', 'tags: a list of texts')
  const out = []
  for (const t of raw) {
    if (typeof t !== 'string') return refuse('bad_field', 'tags: a list of texts')
    const s = t.trim()
    if (s !== '' && out.indexOf(s) < 0) out.push(s)
  }
  return { ok: true, value: out }
}

/**
 * The values of a create (`creating`) or of the patch of an update (`current` = the row now). Only the keys the body carries come back; a custom field
 * set to `null` is dropped from the row. Merging the fields over the row's own is done by the caller (it holds the row).
 */
export function checkContact (schema, body, { creating, current } = {}) {
  if (!plain(body)) return refuse('bad_field', 'a contact is an object')
  for (const k of Object.keys(body)) if (CONTACT_KEYS.indexOf(k) < 0) return refuse('unknown_field', 'contact: no column "' + k + '"')
  const out = {}
  if (body.kind !== undefined) {
    if (KINDS.indexOf(body.kind) < 0) return refuse('bad_field', 'kind: person or company')
    if (creating !== true && current !== undefined && body.kind !== current.kind) return refuse('not_allowed', 'kind: a contact does not change from person to company; create a new one')
    out.kind = body.kind
  }
  const kind = out.kind !== undefined ? out.kind : (current !== undefined ? current.kind : 'person')
  if (creating === true && body.name === undefined) return refuse('missing_field', 'name: required')
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim() === '' || body.name.trim().length > 200) return refuse('bad_field', 'name: 1 to 200 characters')
    out.name = body.name.trim()
  }
  if (body.type !== undefined) {
    if (typeof body.type !== 'string') return refuse('bad_field', 'type: text expected')
    const t = body.type.trim()
    if (t !== '') {
      if (!KEY.test(t)) return refuse('bad_field', 'type: a key from the list of types')
      const own = schema.types.filter((x) => x.kind === kind)
      if (!own.some((x) => x.key === t) && !(current !== undefined && current.type === t)) return refuse('bad_field', 'type: one of ' + own.map((x) => x.key).join(', '))
    }
    out.type = t
  }
  if (body.email !== undefined) {
    if (typeof body.email !== 'string') return refuse('bad_field', 'email: text expected')
    const e = body.email.trim()
    if (e !== '' && (e.length > 254 || !EMAIL.test(e))) return refuse('bad_field', 'email: an email address')
    out.email = e
  }
  if (body.company_id !== undefined) {
    const id = body.company_id === '' ? null : body.company_id
    if (id !== null && (!Number.isInteger(id) || id < 1)) return refuse('bad_field', 'company_id: a company id or null')
    out.company_id = id
  }
  if (body.tags !== undefined) {
    const r = checkTags(body.tags)
    if (!r.ok) return r
    out.tags = r.value
  }
  if (body.fields !== undefined) {
    const r = checkFields(schema, body.fields)
    if (!r.ok) return r
    out.fields = r.value
  }
  return { ok: true, values: out }
}

/** The fields of a row after a patch: the patch laid over what the row had, a `null` removing the key. */
export function mergeFields (had, patch) {
  const out = Object.assign({}, plain(had) ? had : {})
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete out[k]; else out[k] = v }
  return out
}

/** A note's text: 1 to 4000 characters. */
export function checkNote (body) {
  if (typeof body !== 'string' || body.trim() === '' || body.trim().length > 4000) return refuse('bad_field', 'note: 1 to 4000 characters')
  return { ok: true, value: body.trim() }
}
