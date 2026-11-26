// kybernos-db import — reads a prepared file of raw rows and puts each cell in the form its field wants. Pure: the file is read by the caller's `readFileSync`, nothing is written here.
//
// The file is made by the `data-feed` skill (skills/data-feed/scripts/feed.mjs), which reads a CSV, an Excel sheet, a text table or the JSON of an API into one JSON line per row:
//
//   {"kind":"kybernos-import","version":1,"id":"…","source":"sales.csv","format":"csv","sheet":null,"columns":["Date","Amount"],"rows":2,"created":"…"}
//   {"r":2,"c":["05/01/2026","1 234,50"]}
//   {"r":3,"c":["06/01/2026","99,00"]}
//
// A cell is raw: a string as the file had it, or a number or a boolean when the format typed it (JSON, Excel). Here, and only here, it becomes the value of a field. The engine stays the
// judge: whatever this returns still goes through `normalizeValue` and `db.create`, so a value this module lets through and the engine refuses is reported, never stored.
//
// What is understood (nothing else is guessed; a cell that fits none of it is refused with the reason):
//   number · money   1234.5   1,234.50   1 234,50   1.234,50   $12.50   12,50 €   (1 200)   12%   -3
//   date             2026-01-05   2026-01-05T10:30:00   05/01/2026 (dmy or mdy, told or deduced, never guessed)   5 Jan 2026   5 janvier 2026   January 5, 2026
//   checkbox         true false yes no oui non si 1 0 x ✓ (an empty cell is unchecked)
//   choice           the option's key or its label, any case, any accent
//   multichoice      several of them, split on ; , or |
//   text · email…    trimmed
// person, relation and attachment cannot come from a cell: the column is refused when it is mapped to one.
import { isDate, normalizeValue } from '../core/index.mjs'

export const IMPORT_KIND = 'kybernos-import'
export const IMPORT_ID = /^[a-z0-9][a-z0-9-]{5,47}$/
export const MAX_IMPORT_ROWS = 50000
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024
export const UNSUPPORTED = ['person', 'relation', 'attachment']

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const good = (value) => ({ ok: true, value })
const bad = (code, message) => ({ ok: false, code, message })
/** Lower case without accents or marks, spaces folded: how a label and a cell are compared. */
export const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s  ]+/g, ' ').trim()
const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

// ── the file ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Reads the text of a prepared file: `{ ok: true, head, rows }` (rows = [{ r, c }]) or `{ ok: false, code, message }`. */
export function parseImport (text) {
  if (typeof text !== 'string' || text === '') return bad('empty', 'the import file is empty')
  const lines = text.split('\n')
  let head
  try { head = JSON.parse(lines[0]) } catch (e) { return bad('format', 'the first line of the import file is not JSON') }
  if (!plain(head) || head.kind !== IMPORT_KIND || head.version !== 1 || !Array.isArray(head.columns) || head.columns.some((c) => typeof c !== 'string')) return bad('format', 'not a kybernos import file (prepare it with the data-feed skill)')
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') continue
    let row
    try { row = JSON.parse(lines[i]) } catch (e) { return bad('format', 'line ' + (i + 1) + ' of the import file is not JSON') }
    if (!plain(row) || !Array.isArray(row.c) || !Number.isInteger(row.r)) return bad('format', 'line ' + (i + 1) + ' of the import file is not a row')
    rows.push(row)
  }
  if (rows.length > MAX_IMPORT_ROWS) return bad('too-many', 'an import holds at most ' + MAX_IMPORT_ROWS + ' rows')
  return { ok: true, head, rows }
}

// ── numbers ──────────────────────────────────────────────────────────────────────────────────────────────────
/** A decimal mark seen in a column: '.' or ',' when the values settle it, null when they do not (« 1,234 » alone is a thousand in English and a fraction in French). */
export function decimalOf (cells) {
  let dot = 0
  let comma = 0
  for (const raw of cells) {
    if (typeof raw !== 'string') continue
    const s = raw.replace(/[^\d.,]/g, '')
    const d = s.lastIndexOf('.')
    const c = s.lastIndexOf(',')
    if (d >= 0 && c >= 0) { if (d > c) dot++; else comma++; continue }
    const mark = d >= 0 ? '.' : c >= 0 ? ',' : ''
    if (mark === '') continue
    const parts = s.split(mark)
    if (parts.length > 2) { if (mark === '.') comma++; else dot++; continue } // 1,234,567 : the mark repeats, so it groups
    if (parts[1].length !== 3) { if (mark === '.') dot++; else comma++ }
  }
  if (dot > 0 && comma === 0) return '.'
  if (comma > 0 && dot === 0) return ','
  return null
}

const CODES = 'EUR|USD|GBP|CHF|CAD|AUD|NZD|JPY|CNY|INR|BRL|MXN|MAD|TND|DZD|XOF|XAF|SEK|NOK|DKK|PLN|CZK|HUF|RON|TRY|AED|SAR|ZAR'
const CODE_BEFORE = new RegExp('^(?:' + CODES + ')(?=[-+\\d.,])', 'i')
const CODE_AFTER = new RegExp('(?<=[\\d.,])(?:' + CODES + ')$', 'i')

/** « 1 234,50 » → 1234.5. `decimal` is '.' or ',' when told, else deduced from the cell alone. */
export function parseNumber (raw, decimal) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? good(raw) : bad('type', 'not a finite number')
  if (typeof raw !== 'string') return bad('type', 'not a number')
  let s = raw.replace(/[\s  ']/g, '')
  let negative = false
  const paren = /^\((.*)\)$/.exec(s)
  if (paren) { negative = true; s = paren[1] }
  s = s.replace(CODE_BEFORE, '').replace(CODE_AFTER, '').replace(/[$€£¥%]/g, '')
  if (/^[-−–]/.test(s)) { negative = !negative; s = s.slice(1) }
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1) }
  s = s.replace(/^\+/, '')
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return bad('type', 'not a number')
  const d = s.lastIndexOf('.')
  const c = s.lastIndexOf(',')
  let mark = decimal === '.' || decimal === ',' ? decimal : null
  if (mark === null) {
    if (d >= 0 && c >= 0) mark = d > c ? '.' : ','
    else if (d >= 0 || c >= 0) {
      const m = d >= 0 ? '.' : ','
      const parts = s.split(m)
      if (parts.length > 2) mark = ''
      else if (m === ',' && parts[1].length === 3 && parts[0].length >= 1 && parts[0].length <= 3) mark = '' // 1,234 : English thousands
      else mark = m
    } else mark = ''
  }
  // what stands before the decimal mark may only be groups of three digits, all split by the same character: « 1.2.3,4 » is not a number
  const at = mark ? s.lastIndexOf(mark) : -1
  const whole = at >= 0 ? s.slice(0, at) : s
  const fraction = at >= 0 ? s.slice(at + 1) : ''
  const seps = whole.match(/[.,]/g) || []
  if (!/^\d*$/.test(fraction) || new Set(seps).size > 1) return bad('type', 'not a number')
  if (seps.length > 0) {
    const groups = whole.split(/[.,]/)
    if (groups[0].length < 1 || groups[0].length > 3 || groups.slice(1).some((g) => g.length !== 3)) return bad('type', 'not a number')
  }
  const t = (whole.replace(/[.,]/g, '') || '0') + (fraction === '' ? '' : '.' + fraction)
  if (!/^\d+(\.\d+)?$/.test(t)) return bad('type', 'not a number')
  const n = Number(t)
  return Number.isFinite(n) ? good(negative ? -n : n) : bad('type', 'not a number')
}

// ── dates ────────────────────────────────────────────────────────────────────────────────────────────────────
const MONTHS = {
  jan: 1, january: 1, janv: 1, janvier: 1, enero: 1, ene: 1,
  feb: 2, february: 2, fev: 2, fevr: 2, fevrier: 2, febrero: 2,
  mar: 3, march: 3, mars: 3, marzo: 3,
  apr: 4, april: 4, avr: 4, avril: 4, abr: 4, abril: 4,
  may: 5, mai: 5, mayo: 5,
  jun: 6, june: 6, juin: 6, junio: 6,
  jul: 7, july: 7, juil: 7, juillet: 7, julio: 7,
  aug: 8, august: 8, aout: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septembre: 9, septiembre: 9,
  oct: 10, october: 10, octobre: 10, octubre: 10,
  nov: 11, november: 11, novembre: 11, noviembre: 11,
  dec: 12, december: 12, decembre: 12, dic: 12, diciembre: 12,
}
const pad = (n, w) => String(n).padStart(w, '0')
const day = (y, m, d) => { const t = pad(y, 4) + '-' + pad(m, 2) + '-' + pad(d, 2); return isDate(t) ? good(t) : bad('format', 'not a real date') }
const year4 = (y) => (y.length === 4 ? Number(y) : Number(y) < 70 ? 2000 + Number(y) : 1900 + Number(y))

/** The order (« dmy » or « mdy ») the numeric dates of a column follow, when its values settle it, else null. */
export function dateOrderOf (cells) {
  let dmy = 0
  let mdy = 0
  for (const raw of cells) {
    const m = typeof raw === 'string' ? /^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:\D.*)?$/.exec(raw) : null
    if (!m) continue
    if (Number(m[1]) > 12) dmy++
    else if (Number(m[2]) > 12) mdy++
  }
  if (dmy > 0 && mdy === 0) return 'dmy'
  if (mdy > 0 && dmy === 0) return 'mdy'
  return null
}

/** A date in any of the shapes above → « YYYY-MM-DD ». A time of day is dropped (a date field holds days). */
export function parseDate (raw, order) {
  if (typeof raw !== 'string') return bad('type', 'not a date')
  const s = raw.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s)
  if (m) return day(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(s)
  if (m) return day(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:[T ,]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)?$/.exec(s)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const o = order === 'dmy' || order === 'mdy' ? order : a > 12 ? 'dmy' : b > 12 ? 'mdy' : null
    if (o === null) return bad('ambiguous', 'ambiguous date: say whether the order is dmy or mdy')
    return o === 'dmy' ? day(year4(m[3]), b, a) : day(year4(m[3]), a, b)
  }
  m = /^(\d{1,2})(?:st|nd|rd|th|er)?[\s.\-/]+([A-Za-zÀ-ÿ]+)\.?,?[\s.\-/]+(\d{4})$/.exec(s)
  if (m && MONTHS[fold(m[2])] !== undefined) return day(Number(m[3]), MONTHS[fold(m[2])], Number(m[1]))
  m = /^([A-Za-zÀ-ÿ]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s)
  if (m && MONTHS[fold(m[1])] !== undefined) return day(Number(m[3]), MONTHS[fold(m[1])], Number(m[2]))
  return bad('format', 'not a date I know (YYYY-MM-DD, DD/MM/YYYY, 5 Jan 2026…)')
}

// ── the other cells ──────────────────────────────────────────────────────────────────────────────────────────
const YES = new Set(['true', 'yes', 'y', 'oui', 'o', 'si', 'vrai', 'on', '1', 'x', '✓', '✔', 'checked', 'ja'])
const NO = new Set(['false', 'no', 'n', 'non', 'faux', 'off', '0', 'unchecked', 'nein', ''])

const optionOf = (field, text) => {
  const f = fold(text)
  const options = Array.isArray(field.options) ? field.options : []
  const byKey = options.find((o) => o.key === text) || options.find((o) => o.key === slug(text))
  if (byKey) return byKey.key
  const byLabel = options.find((o) => fold(o.label) === f)
  return byLabel ? byLabel.key : null
}

const empty = (raw) => raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')

/**
 * One cell → the value of `field`: `{ ok: true, value }` or `{ ok: false, code, message }`. `o` is { decimal, dateOrder }.
 * `unknown` (a Map) collects the choice values that are not an option, so the person can be offered to add them.
 */
export function coerceCell (field, raw, o = {}, unknown = null) {
  if (UNSUPPORTED.includes(field.type)) return bad('unsupported', 'a ' + field.type + ' cannot be filled from a column')
  if (field.type === 'checkbox') {
    if (typeof raw === 'boolean') return good(raw)
    if (typeof raw === 'number') return raw === 1 ? good(true) : raw === 0 ? good(false) : bad('type', 'not a yes or a no')
    const k = empty(raw) ? '' : fold(raw)
    return YES.has(k) ? good(true) : NO.has(k) ? good(false) : bad('type', 'not a yes or a no')
  }
  if (empty(raw)) return good(null)
  switch (field.type) {
    case 'number': case 'money': return parseNumber(raw, o.decimal)
    case 'date': return parseDate(raw, o.dateOrder)
    case 'choice': {
      const text = String(raw).trim()
      const key = optionOf(field, text)
      if (key !== null) return good(key)
      if (unknown !== null) unknown.set(text, (unknown.get(text) || 0) + 1)
      return bad('option', '"' + text.slice(0, 40) + '" is not one of the options')
    }
    case 'multichoice': {
      const keys = []
      for (const part of String(raw).split(/[;,|]/)) {
        const text = part.trim()
        if (text === '') continue
        const key = optionOf(field, text)
        if (key === null) {
          if (unknown !== null) unknown.set(text, (unknown.get(text) || 0) + 1)
          return bad('option', '"' + text.slice(0, 40) + '" is not one of the options')
        }
        if (!keys.includes(key)) keys.push(key)
      }
      return good(keys.length ? keys : null)
    }
    default: {
      // text, longtext, url, email, phone
      const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : null
      return text === null ? bad('type', 'not a text') : good(text === '' ? null : text)
    }
  }
}

// ── the mapping ──────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Checks `columns` (a map { column title: field key | { field, decimal?, dateOrder? } }) against the file and the object.
 * Returns `{ ok: true, plan }` — plan = [{ index, column, field, decimal, dateOrder }] — or `{ ok: false, code, message }`.
 */
export function planColumns (head, obj, columns, defaults = {}) {
  if (!plain(columns) || Object.keys(columns).length === 0) return bad('invalid', '`columns` maps each column title of the file to a field key: { "Amount": "amount" }')
  const plan = []
  const seen = new Set()
  for (const [title, spec] of Object.entries(columns)) {
    const index = head.columns.indexOf(title)
    if (index < 0) return bad('unknown_column', 'no column "' + title + '" in the file; its columns are: ' + head.columns.map((c) => '"' + c + '"').join(', '))
    const fieldKey = typeof spec === 'string' ? spec : plain(spec) ? spec.field : undefined
    const field = obj.fields.find((f) => f.key === fieldKey)
    if (!field) return bad('unknown_field', 'no field "' + String(fieldKey) + '" in ' + obj.key + ' (db_list shows the keys)')
    if (UNSUPPORTED.includes(field.type)) return bad('unsupported', 'the field "' + field.key + '" is a ' + field.type + ': a column cannot fill it (leave this column out, or load the text into a text field)')
    if (field.protection === 'secret') return bad('secret', 'the field "' + field.key + '" is secret: an import never fills it')
    if (seen.has(field.key)) return bad('duplicate', 'two columns fill the field "' + field.key + '"')
    seen.add(field.key)
    const own = plain(spec) ? spec : {}
    const pick = (v) => (v === '.' || v === ',' ? v : undefined)
    plan.push({
      index,
      column: title,
      field,
      decimal: pick(own.decimal) || pick(defaults.decimal),
      dateOrder: own.dateOrder === 'dmy' || own.dateOrder === 'mdy' ? own.dateOrder : (defaults.dateOrder === 'dmy' || defaults.dateOrder === 'mdy' ? defaults.dateOrder : undefined),
    })
  }
  return { ok: true, plan }
}

/**
 * Every row → `{ values }` or `{ error }`. `refusals` aggregates the reasons; `unknown` the choice values that are not options (by field key).
 * Each value also goes through the engine's own `normalizeValue`, so a too-long text or a bad e-mail is refused here, before anything is written.
 */
export function coerceRows (rows, plan) {
  const out = []
  const reasons = new Map()
  const unknown = new Map()
  for (const row of rows) {
    const values = {}
    let error = null
    for (const p of plan) {
      const raw = row.c[p.index]
      let bag = null
      if (p.field.type === 'choice' || p.field.type === 'multichoice') { bag = unknown.get(p.field.key); if (!bag) { bag = new Map(); unknown.set(p.field.key, bag) } }
      let r = coerceCell(p.field, raw, p, bag)
      if (r.ok) r = normalizeValue(p.field, r.value)
      if (r.ok && r.value === null && p.field.required && p.field.type !== 'checkbox') r = bad('required', 'a required field cannot be empty')
      if (!r.ok) {
        const why = p.column + ': ' + r.message
        if (error === null) error = { row: row.r, column: p.column, field: p.field.key, code: r.code, message: r.message, value: typeof raw === 'string' ? raw.slice(0, 40) : raw }
        reasons.set(why, (reasons.get(why) || 0) + 1)
        continue
      }
      values[p.field.key] = r.value
    }
    out.push(error === null ? { r: row.r, values } : { r: row.r, error })
  }
  const unknownChoices = {}
  for (const [key, bag] of unknown) if (bag.size) unknownChoices[key] = [...bag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([value, n]) => ({ value, rows: n }))
  return { rows: out, reasons: Object.fromEntries([...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)), unknownChoices }
}
