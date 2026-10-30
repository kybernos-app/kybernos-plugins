// The field types of a database object: what each one holds, how a value is checked and put in its one canonical form, and which filter
// operators it understands. Pure: no disk, no network, no clock.
//
// A value is JSON. An empty value is always `null` (an empty text, an empty list), except for a checkbox, which is `true` or `false`.
//
//   text · longtext · url · email · phone   a string
//   number · money                          a finite number (money is rounded to the field's `precision`, 2 by default)
//   date                                    « YYYY-MM-DD »
//   checkbox                                true | false
//   choice · person                         one option key · one member id
//   multichoice                             a list of option keys
//   relation                                one record id, or a list of them when the field is `many`
//   attachment                              a list of { name, size, type, hash }: the file itself lives in blobs/<sha256>, never in the row

import { isDate } from './dates.mjs'
import { isPlain } from './text.mjs'

export const FIELD_TYPES = ['text', 'longtext', 'number', 'money', 'date', 'checkbox', 'choice', 'multichoice', 'person', 'url', 'email', 'phone', 'relation', 'attachment']
/** From the least to the most guarded: the position is the rank (an agent can raise a field's protection, never lower it). */
export const PROTECTION = ['normal', 'personal', 'sensitive', 'secret']
export const COLORS = ['gray', 'red', 'amber', 'green', 'teal', 'blue', 'purple', 'pink']
/** The default cap of one attached file; a field can set a lower `maxBytes`. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_ATTACHMENTS = 20
export const MAX_LINKS = 1000
export const MAX_OPTIONS = 50

const LIMITS = { text: 1000, longtext: 100000, url: 2048, email: 320, phone: 64 }
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_TEXT = /^https?:\/\/[^\s/]+\S*$/
const PHONE = /^[+0-9 ().-]{3,64}$/
const HASH = /^[0-9a-f]{64}$/
const MIME = /^[A-Za-z0-9][\w.+-]*\/[A-Za-z0-9][\w.+-]*$/
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/
const OPTION_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/
const CURRENCY = /^[A-Z]{3}$/
const RESERVED = ['id', 'rev', 'created', 'modified', 'deleted', 'created_by', 'created_at', 'modified_by', 'modified_at', 'deleted_by', 'deleted_at']
const CONTROL = /[\u0000-\u001f\u007f]/

/** A record id or an operation id: 26 characters of Crockford base32, the first one 0-7 (a 48-bit timestamp). */
export const isUlid = (s) => typeof s === 'string' && ULID.test(s)

/** The family decides the operators and the way a value is compared: text, number, date, checkbox, one (a single key or id), many (a list) or files. */
export const familyOf = (field) => {
  switch (field && field.type) {
    case 'text': case 'longtext': case 'url': case 'email': case 'phone': return 'text'
    case 'number': case 'money': return 'number'
    case 'date': return 'date'
    case 'checkbox': return 'checkbox'
    case 'choice': case 'person': return 'one'
    case 'relation': return field.many ? 'many' : 'one'
    case 'multichoice': return 'many'
    case 'attachment': return 'files'
    default: return null
  }
}

const OPS = {
  text: ['contains', 'ncontains', 'is', 'isnot', 'empty', 'nempty'],
  number: ['eq', 'ne', 'lt', 'gt', 'le', 'ge', 'empty', 'nempty'],
  date: ['is', 'before', 'after', 'within', 'empty', 'nempty'],
  checkbox: ['checked', 'unchecked'],
  one: ['is', 'isnot', 'in', 'nin', 'empty', 'nempty'],
  many: ['in', 'nin', 'all', 'empty', 'nempty'],
  files: ['empty', 'nempty'],
}
/** The filter operators a field understands. */
export const opsFor = (field) => OPS[familyOf(field)] || []

/** Whether a field can be sorted on (a list of files cannot). */
export const isSortable = (field) => familyOf(field) !== null && familyOf(field) !== 'files'

export const optionKeys = (field) => (Array.isArray(field.options) ? field.options.map((o) => o.key) : [])

const good = (value) => ({ ok: true, value })
const bad = (code, message) => ({ ok: false, code, message })

/** Rounds half away from zero to `places` decimals through the number's decimal text, so 1.005 gives 1.01 (multiplying the binary value would give 1). */
const roundTo = (x, places) => {
  const abs = Math.abs(x)
  const text = String(abs)
  if (text.includes('e')) return Math.sign(x) * Math.round(abs * 10 ** places) / 10 ** places
  return Math.sign(x) * Number(Math.round(Number(text + 'e' + places)) + 'e-' + places)
}

const listOf = (raw, check, max, what) => {
  if (!Array.isArray(raw)) return bad('type', what + ' is a list')
  if (raw.length > max) return bad('too-many', what + ' holds at most ' + max)
  const out = []
  for (const item of raw) {
    const r = check(item)
    if (!r.ok) return r
    if (!out.includes(r.value)) out.push(r.value)
  }
  return good(out.length ? out : null)
}

/**
 * Puts a value in the canonical form of a field: `{ ok: true, value }`, or `{ ok: false, code, message }` when it cannot be that field's value.
 * The same value always gives the same answer, so a client and a server agree on what is stored. Nothing is coerced: « 12 » is not a number.
 */
export function normalizeValue (field, raw) {
  const value = raw === undefined ? null : raw
  const type = field.type
  if (type === 'checkbox') return value === null || value === false ? good(false) : value === true ? good(true) : bad('type', 'a checkbox is true or false')
  if (value === null) return good(null)
  switch (type) {
    case 'text': case 'longtext': case 'url': case 'email': case 'phone': {
      if (typeof value !== 'string') return bad('type', type + ' is a text')
      if (value === '') return good(null)
      if (value.length > LIMITS[type]) return bad('too-long', type + ' is at most ' + LIMITS[type] + ' characters')
      if (type === 'email' && !EMAIL.test(value)) return bad('format', 'not an email address')
      if (type === 'url' && !URL_TEXT.test(value)) return bad('format', 'not an http(s) address')
      if (type === 'phone' && !PHONE.test(value)) return bad('format', 'not a phone number')
      return good(value)
    }
    case 'number': case 'money': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return bad('type', type + ' is a finite number')
      if (Math.abs(value) > 1e15) return bad('range', type + ' is at most 1e15')
      if (type === 'number') return good(value === 0 ? 0 : value)
      const rounded = roundTo(value, field.precision === undefined ? 2 : field.precision)
      return good(rounded === 0 ? 0 : rounded)
    }
    case 'date': return isDate(value) ? good(value) : bad('format', 'a date is YYYY-MM-DD')
    case 'choice': return typeof value === 'string' && optionKeys(field).includes(value) ? good(value) : bad('option', 'not one of the options')
    case 'multichoice': return listOf(value, (v) => (typeof v === 'string' && optionKeys(field).includes(v) ? good(v) : bad('option', 'not one of the options')), MAX_OPTIONS, 'multichoice')
    case 'person': return typeof value === 'string' && value.length >= 1 && value.length <= 64 && !CONTROL.test(value) ? good(value) : bad('type', 'a person is a member id')
    case 'relation':
      if (!field.many) return isUlid(value) ? good(value) : bad('type', 'a relation holds a record id')
      return listOf(value, (v) => (isUlid(v) ? good(v) : bad('type', 'a relation holds record ids')), MAX_LINKS, 'a relation')
    case 'attachment': {
      const cap = field.maxBytes === undefined ? MAX_ATTACHMENT_BYTES : field.maxBytes
      if (!Array.isArray(value)) return bad('type', 'an attachment is a list of files')
      if (value.length > MAX_ATTACHMENTS) return bad('too-many', 'at most ' + MAX_ATTACHMENTS + ' files')
      if (value.length === 0) return good(null)
      for (const f of value) {
        if (!isPlain(f) || Object.keys(f).sort().join() !== 'hash,name,size,type') return bad('shape', 'a file is { name, size, type, hash }')
        if (typeof f.name !== 'string' || f.name.length < 1 || f.name.length > 255 || CONTROL.test(f.name) || /[/\\]/.test(f.name)) return bad('format', 'a file name is 1 to 255 characters, no slash')
        if (!Number.isInteger(f.size) || f.size < 0) return bad('format', 'a file size is a whole number of bytes')
        if (f.size > cap) return bad('too-big', 'a file is at most ' + cap + ' bytes')
        if (typeof f.type !== 'string' || !MIME.test(f.type) || f.type.length > 127) return bad('format', 'a file type is a media type')
        if (typeof f.hash !== 'string' || !HASH.test(f.hash)) return bad('format', 'a file hash is 64 lower-case hex digits (sha256)')
      }
      return good(value.map((f) => ({ name: f.name, size: f.size, type: f.type, hash: f.hash })))
    }
    default: return bad('type', 'unknown field type')
  }
}

/** The value a new record gets for a field. */
export const defaultValue = (field) => (field.type === 'checkbox' ? false : null)

/** The text of a value, for the search. A person or a relation shows what `ctx.label(field, value)` says (their name, their title), else the raw id. */
export function textOf (field, value, ctx) {
  if (value === null || value === undefined) return ''
  const label = (v) => String((ctx && typeof ctx.label === 'function' && ctx.label(field, v)) || v)
  switch (field.type) {
    case 'number': case 'money': return String(value)
    case 'checkbox': return ''
    case 'choice': return ((field.options || []).find((o) => o.key === value) || {}).label || ''
    case 'multichoice': return value.map((v) => ((field.options || []).find((o) => o.key === v) || {}).label || '').join(' ')
    case 'person': return label(value)
    case 'relation': return field.many ? value.map(label).join(' ') : label(value)
    case 'attachment': return value.map((f) => f.name).join(' ')
    default: return String(value)
  }
}

const tidy = (s, max) => typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= max && !CONTROL.test(s)
const FIELD_KEYS = ['key', 'type', 'label', 'required', 'protection', 'options', 'currency', 'precision', 'to', 'many', 'maxBytes']
const ONLY_FOR = { options: ['choice', 'multichoice'], currency: ['money'], precision: ['money'], to: ['relation'], many: ['relation'], maxBytes: ['attachment'] }

/**
 * Checks a field definition and fills its defaults: `{ ok: true, field }`, or `{ ok: false, errors: [{ path, code, message }] }`.
 *   { key, type, label, required?, protection?, options? (choice, multichoice), currency + precision? (money), to + many? (relation), maxBytes? (attachment) }
 */
export function normalizeField (def) {
  const errors = []
  const fail = (path, code, message) => errors.push({ path, code, message })
  if (!isPlain(def)) return { ok: false, errors: [{ path: '', code: 'shape', message: 'a field is an object' }] }
  for (const k of Object.keys(def)) {
    if (!FIELD_KEYS.includes(k)) fail(k, 'unknown-key', 'not a field property')
    else if (ONLY_FOR[k] && !ONLY_FOR[k].includes(def.type)) fail(k, 'not-for-type', k + ' does not apply to a ' + def.type)
  }
  if (typeof def.key !== 'string' || !FIELD_KEY.test(def.key)) fail('key', 'key', 'a key is lower-case letters, digits and _, starting with a letter, 40 at most')
  else if (RESERVED.includes(def.key)) fail('key', 'reserved', '"' + def.key + '" is reserved')
  if (!FIELD_TYPES.includes(def.type)) fail('type', 'type', 'unknown field type')
  if (!tidy(def.label, 80)) fail('label', 'label', 'a label is 1 to 80 characters')
  if (def.required !== undefined && typeof def.required !== 'boolean') fail('required', 'type', 'true or false')
  if (def.protection !== undefined && !PROTECTION.includes(def.protection)) fail('protection', 'protection', 'one of ' + PROTECTION.join(', '))

  const field = { key: def.key, type: def.type, label: typeof def.label === 'string' ? def.label.trim() : def.label, required: def.required === true, protection: def.protection || 'normal' }
  if (def.type === 'choice' || def.type === 'multichoice') {
    if (!Array.isArray(def.options) || def.options.length < 1 || def.options.length > MAX_OPTIONS) fail('options', 'options', 'a list of 1 to ' + MAX_OPTIONS + ' options')
    else {
      const seen = new Set()
      field.options = def.options.map((o, i) => {
        const at = 'options.' + i
        if (!isPlain(o) || Object.keys(o).some((k) => !['key', 'label', 'color'].includes(k))) { fail(at, 'shape', 'an option is { key, label, color? }'); return o }
        if (typeof o.key !== 'string' || !OPTION_KEY.test(o.key)) fail(at + '.key', 'key', 'an option key is lower-case letters, digits, - and _')
        else if (seen.has(o.key)) fail(at + '.key', 'duplicate', 'two options share this key')
        else seen.add(o.key)
        if (!tidy(o.label, 60)) fail(at + '.label', 'label', 'an option label is 1 to 60 characters')
        if (o.color !== undefined && !COLORS.includes(o.color)) fail(at + '.color', 'color', 'one of ' + COLORS.join(', '))
        const out = { key: o.key, label: typeof o.label === 'string' ? o.label.trim() : o.label }
        if (o.color !== undefined) out.color = o.color
        return out
      })
    }
  }
  if (def.type === 'money') {
    if (typeof def.currency !== 'string' || !CURRENCY.test(def.currency)) fail('currency', 'currency', 'a money field names its currency (EUR, USD…)')
    if (def.precision !== undefined && !(Number.isInteger(def.precision) && def.precision >= 0 && def.precision <= 4)) fail('precision', 'precision', 'a whole number from 0 to 4')
    field.currency = def.currency
    field.precision = def.precision === undefined ? 2 : def.precision
  }
  if (def.type === 'relation') {
    if (typeof def.to !== 'string' || !FIELD_KEY.test(def.to)) fail('to', 'to', 'a relation names the object it points to')
    if (def.many !== undefined && typeof def.many !== 'boolean') fail('many', 'type', 'true or false')
    field.to = def.to
    field.many = def.many === true
  }
  if (def.type === 'attachment') {
    if (def.maxBytes !== undefined && !(Number.isInteger(def.maxBytes) && def.maxBytes >= 1 && def.maxBytes <= MAX_ATTACHMENT_BYTES)) fail('maxBytes', 'maxBytes', 'a whole number of bytes, at most ' + MAX_ATTACHMENT_BYTES)
    field.maxBytes = def.maxBytes === undefined ? MAX_ATTACHMENT_BYTES : def.maxBytes
  }
  return errors.length ? { ok: false, errors } : { ok: true, field }
}
