// kybernos/contacts#schema — what a theme tells the Contacts plugin about its people and companies.
//
// A theme ships `contacts/<id>.json` (data only, never code):
//   { "id": "ecommerce",
//     "types":  [{ "key": "customer", "kind": "person", "label": { "en": "Customer", "fr": "Client" } }],
//     "fields": [{ "key": "city", "type": "text", "label": { "en": "City" } }],
//     "tags":   ["repeat", "wholesale"] }
// `types` are the kinds of contact the theme speaks of (a kind is a person or a company), `fields` the extra columns it wants, `tags` the labels it
// proposes. The check is pure and bounded: known keys only, every text and list has a limit, no code and no URL. The registry calls it with the
// file's name (without `.json`) as `fileId`; `scripts/plugin-check.mjs` calls it on a theme's folder before anything is installed.
//
// A row of the base keeps only the KEY of its type: a theme that goes away leaves its rows, shown as plain contacts.

// ── shared checks: the SAME text in the three business points (scripts/test-business-points.mjs fails when the copies drift) ──────────────────
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/
const LANGS = ['en', 'fr', 'es', 'ar']
const clean = (s) => { for (const ch of s) { const c = ch.charCodeAt(0); if (c < 32 || c === 127 || ch === '<' || ch === '>') return false } return true }
const only = (v, allowed, where, errors) => { for (const k of Object.keys(v)) if (allowed.indexOf(k) < 0) errors.push(where + ': unknown key "' + String(k).slice(0, 40) + '"') }
const idOf = (v, where, errors) => { if (typeof v !== 'string' || !ID.test(v)) { errors.push(where + ': lower-case letters, digits, "-" or "_", 1 to 40'); return null } return v }
const listOf = (v, where, min, max, errors) => { if (!Array.isArray(v) || v.length < min || v.length > max) { errors.push(where + ': a list of ' + (min > 0 ? min + ' to ' : 'at most ') + max); return [] } return v }
const noDuplicate = (keys, where, errors) => { const seen = new Set(); for (const k of keys) { if (k === null || k === undefined) continue; if (seen.has(k)) errors.push(where + ': "' + k + '" appears twice'); seen.add(k) } }
/** `{ en: "…", fr: "…" }`: `en` is required, the other languages are optional; every text is 1 to `max` characters, with no control character and no angle bracket. */
const labelOf = (v, where, errors, max = 60) => {
  if (!plain(v)) { errors.push(where + ': an object { en: text, fr?: text }'); return null }
  const out = {}
  for (const k of Object.keys(v)) {
    if (LANGS.indexOf(k) < 0) { errors.push(where + ': unknown language "' + String(k).slice(0, 12) + '"'); continue }
    if (typeof v[k] !== 'string' || v[k].trim().length < 1 || v[k].trim().length > max || !clean(v[k])) { errors.push(where + '.' + k + ': a text of 1 to ' + max + ' characters, no < >'); continue }
    out[k] = v[k].trim()
  }
  if (!Object.prototype.hasOwnProperty.call(v, 'en')) errors.push(where + '.en: required')
  return out
}
// ── end of the shared checks ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// ── shared checks for fields: the SAME text in the contacts and catalog points (scripts/test-business-points.mjs) ───────────────────────────
const FIELD_TYPES = ['text', 'number', 'money', 'date', 'choice', 'email', 'url']
const FIELD_KEY = /^[a-z][a-z0-9_]{0,31}$/
/** The fields a theme adds to a row: `{ key, type, label?, options? (choice), currency? (money) }`. `reserved` are the names the row already has. */
const fieldsOf = (v, where, max, reserved, errors) => {
  const out = []
  listOf(v, where, 0, max, errors).forEach((f, i) => {
    const at = where + '[' + i + ']'
    if (!plain(f)) { errors.push(at + ': an object'); return }
    only(f, ['key', 'type', 'label', 'options', 'currency'], at, errors)
    let key = null
    if (typeof f.key !== 'string' || !FIELD_KEY.test(f.key)) errors.push(at + '.key: lower-case letters, digits or "_", starting with a letter, 1 to 32')
    else if (reserved.indexOf(f.key) >= 0) errors.push(at + '.key: "' + f.key + '" is already a column of the row')
    else key = f.key
    const type = FIELD_TYPES.indexOf(f.type) >= 0 ? f.type : null
    if (type === null) errors.push(at + '.type: one of ' + FIELD_TYPES.join(', '))
    const field = { key, type }
    if (f.label !== undefined) field.label = labelOf(f.label, at + '.label', errors)
    if (type === 'choice') {
      const options = listOf(f.options, at + '.options', 1, 12, errors)
      field.options = options.map((o, j) => (typeof o === 'string' && o.trim().length >= 1 && o.trim().length <= 40 && clean(o) ? o.trim() : (errors.push(at + '.options[' + j + ']: a text of 1 to 40 characters, no < >'), null)))
      noDuplicate(field.options, at + '.options', errors)
    } else if (f.options !== undefined) errors.push(at + '.options: only a "choice" field has options')
    if (type === 'money' && f.currency !== undefined) { if (typeof f.currency === 'string' && /^[A-Z]{3}$/.test(f.currency)) field.currency = f.currency; else errors.push(at + '.currency: three capital letters, like EUR') }
    else if (f.currency !== undefined) errors.push(at + '.currency: only a "money" field has a currency')
    out.push(field)
  })
  noDuplicate(out.map((f) => f.key), where, errors)
  return out
}
// ── end of the shared checks for fields ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const OWNER = 'kybernos/contacts'
export const OWNER_VERSION = '1.0.0'
export const LIMITS = Object.freeze({ types: 12, fields: 20, tags: 20, files: 4 })
/** The names a contact already has: a theme's own field cannot take them. */
export const RESERVED = Object.freeze(['id', 'kind', 'type', 'name', 'email', 'company_id', 'tags', 'fields', 'demo', 'created_at', 'updated_at', 'archived_at'])
const KINDS = ['person', 'company']

/** `{ ok: true, value }` (the schema, defaults filled) or `{ ok: false, errors }`. Never throws. */
export function validateContactsSchema (raw, fileId) {
  const errors = []
  if (!plain(raw)) return { ok: false, errors: ['a contacts schema is a JSON object'] }
  only(raw, ['id', 'types', 'fields', 'tags'], 'schema', errors)
  const id = idOf(raw.id, 'id', errors)
  if (id !== null && typeof fileId === 'string' && fileId !== id) errors.push('id "' + id + '" must be the name of its file (' + fileId + '.json)')
  const types = listOf(raw.types, 'types', 1, LIMITS.types, errors).map((t, i) => {
    const at = 'types[' + i + ']'
    if (!plain(t)) { errors.push(at + ': an object'); return null }
    only(t, ['key', 'kind', 'label'], at, errors)
    const kind = KINDS.indexOf(t.kind) >= 0 ? t.kind : null
    if (kind === null) errors.push(at + '.kind: person or company')
    return { key: idOf(t.key, at + '.key', errors), kind, label: labelOf(t.label, at + '.label', errors) }
  })
  noDuplicate(types.map((t) => (t === null ? null : t.key)), 'types', errors)
  const fields = fieldsOf(raw.fields === undefined ? [] : raw.fields, 'fields', LIMITS.fields, RESERVED, errors)
  const tags = listOf(raw.tags === undefined ? [] : raw.tags, 'tags', 0, LIMITS.tags, errors).map((t, i) => {
    if (typeof t === 'string' && t.trim().length >= 1 && t.trim().length <= 40 && clean(t)) return t.trim()
    errors.push('tags[' + i + ']: a text of 1 to 40 characters, no < >')
    return null
  })
  noDuplicate(tags, 'tags', errors)
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 20) }
  return { ok: true, value: { id, types, fields, tags } }
}

export const CONTACTS_POINT_REF = OWNER + '#schema'
/** What the registry is told (`registry.definePoint`): data, inert (nothing in it is an instruction an agent follows). */
export const CONTACTS_POINT = Object.freeze({ owner: OWNER, ownerVersion: OWNER_VERSION, name: 'schema', version: '1.0', kind: 'data', class: 'inert', validate: validateContactsSchema, max: LIMITS.files })
