// The catalog: which objects a db has and which fields each one has. Pure.
//
// Every change to the structure writes a new version of the whole catalog (`{ objects: [...] }`) to the `catalog` table, so the file says what its structure was and
// who changed it. An object is `{ key, label, title, fields }`; `title` is the key of the text field that names a record in lists and links.

import { isPlain, normalizeField } from '../core/index.mjs'

export const OBJECT_KEY = /^[a-z][a-z0-9_]{0,39}$/
export const MAX_OBJECTS = 100
export const MAX_FIELDS = 60

const OBJECT_KEYS = ['key', 'label', 'title', 'fields']
const CONTROL = /[\u0000-\u001f\u007f]/

/** The object with that key, or undefined. */
export const findObject = (objects, key) => (typeof key === 'string' ? objects.find((o) => o.key === key) : undefined)

/** Checks an object definition and fills its defaults: `{ ok: true, object }` or `{ ok: false, errors: [{ path, code, message }] }`. */
export function normalizeObject (def) {
  const errors = []
  const fail = (path, code, message) => errors.push({ path, code, message })
  if (!isPlain(def)) return { ok: false, errors: [{ path: '', code: 'shape', message: 'an object is { key, label, fields }' }] }
  for (const k of Object.keys(def)) if (!OBJECT_KEYS.includes(k)) fail(k, 'unknown-key', 'not an object property')
  if (typeof def.key !== 'string' || !OBJECT_KEY.test(def.key)) fail('key', 'key', 'a key is lower-case letters, digits and _, starting with a letter, 40 at most')
  const label = typeof def.label === 'string' ? def.label.trim() : ''
  if (label.length < 1 || label.length > 80 || CONTROL.test(label)) fail('label', 'label', 'a label is 1 to 80 characters')

  const fields = []
  if (!Array.isArray(def.fields) || def.fields.length < 1) fail('fields', 'fields', 'an object has at least one field')
  else if (def.fields.length > MAX_FIELDS) fail('fields', 'too-many', 'an object has at most ' + MAX_FIELDS + ' fields')
  else {
    const seen = new Set()
    def.fields.forEach((raw, i) => {
      const r = normalizeField(raw)
      if (!r.ok) { for (const e of r.errors) fail('fields.' + i + (e.path ? '.' + e.path : ''), e.code, e.message); return }
      if (seen.has(r.field.key)) { fail('fields.' + i + '.key', 'duplicate', 'two fields share this key'); return }
      seen.add(r.field.key)
      fields.push(r.field)
    })
  }

  if (errors.length === 0) {
    const title = def.title === undefined ? fields[0].key : def.title
    const f = fields.find((x) => x.key === title)
    if (!f) fail('title', 'title', 'the title is the key of one of the fields')
    else if (f.type !== 'text') fail('title', 'title', 'the title field is a text')
    else return { ok: true, object: { key: def.key, label, title, fields } }
  }
  return { ok: false, errors }
}

const CHANGEABLE_FIELD = ['label', 'protection', 'options']

/**
 * A field after a change: `{ ok: true, field }` or `{ ok: false, errors }`. Only the label, the protection and the options of a choice can change: a field
 * never changes type or key, and an option is never removed (a record may use it), so a structure under sync only ever grows.
 */
export function changeField (field, changes) {
  if (!isPlain(changes) || Object.keys(changes).length === 0) return { ok: false, errors: [{ path: '', code: 'empty', message: 'say what changes' }] }
  const errors = Object.keys(changes).filter((k) => !CHANGEABLE_FIELD.includes(k)).map((k) => ({ path: k, code: 'not-changeable', message: k + ' cannot change once the field exists' }))
  if (errors.length) return { ok: false, errors }
  const n = normalizeField({ ...field, ...changes })
  if (!n.ok) return n
  if (changes.options !== undefined) {
    const kept = new Set(n.field.options.map((o) => o.key))
    const lost = field.options.find((o) => !kept.has(o.key))
    if (lost) return { ok: false, errors: [{ path: 'options', code: 'option-removed', message: 'the option "' + lost.key + '" cannot be removed: keep it and change its label' }] }
  }
  return { ok: true, field: n.field }
}

/** An object after a change of its label or its title field: `{ ok: true, object }` or `{ ok: false, errors }`. */
export function changeObject (obj, changes) {
  if (!isPlain(changes) || Object.keys(changes).length === 0) return { ok: false, errors: [{ path: '', code: 'empty', message: 'say what changes' }] }
  const errors = Object.keys(changes).filter((k) => !['label', 'title'].includes(k)).map((k) => ({ path: k, code: 'not-changeable', message: k + ' cannot change once the object exists' }))
  if (errors.length) return { ok: false, errors }
  return normalizeObject({ ...obj, ...changes })
}
