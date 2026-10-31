// model.mjs — what the client knows about an app, with no DOM and no network: formatting, who may do what, the board, the forms, the way the door's errors are read, the
// relations drawing. Pure, so test-tables-front.mjs runs it under node as it is.
//
// The shapes come from the door (kybernos-db api.mjs), through GET /api/apps:
//   app    { slug, id, name, objects: [object] }
//   object { key, label, title (a field key, or null when the actor may not see it), count, fields: [field], can?: { create, update } }   (`can` is the member's; the owner has none)
//   field  { key, type, label, required?, options?: [{ key, label, color }], currency?, precision?, to?, many?, maxBytes?, access?: 'read' | 'write' }   (`access` is the member's)
//   record { id, values: { <field key>: value }, rev, created: { by, at }, modified: { by, at } }

export const OWNER = 'owner'
/** The shortest password the server takes (app.mjs MIN_PASSWORD; test-tables-front.mjs checks the two agree). */
export const MIN_PASSWORD = 10
export const isOwner = (me) => me !== null && typeof me === 'object' && me.role === OWNER

// ── who may do what: the door decides, this only decides what to draw ──

export const canCreate = (me, object) => isOwner(me) || (object.can !== undefined && object.can.create === true)
export const canArchive = (me) => isOwner(me)
/** A field the actor may change on an existing row (a choice select in the detail, a card dropped in another column). */
export const canUpdateField = (me, object, field) => isOwner(me) || (object.can !== undefined && object.can.update === true && field.access === 'write')
/** A field the actor may fill when adding a row. A person field is left out: the page has no member list to pick from. */
export const canWriteField = (me, object, field) => field.type !== 'person' && (isOwner(me) || (canCreate(me, object) && field.access === 'write'))

// ── words ──

const lower = (s) => String(s).toLowerCase()
export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many)
/** « Customers » as « customer » for « Add customer »: the table's label is its plural, and a name that is not a plural is left as it is. */
export function singular (label) {
  const w = lower(label).trim()
  if (/(^|[^a-z])(mov|cook|pi|ti|zomb|self|calor|rook|smooth|gen|hood|prair)ies$/.test(w)) return w.slice(0, -1)
  if (/[^aeiou]ies$/.test(w)) return w.slice(0, -3) + 'y'
  if (/(ss|us|is)$/.test(w) || !w.endsWith('s')) return w
  return w.slice(0, -1)
}
/** « £ » for GBP, or '' when the code is missing or unknown. */
export function currencySymbol (currency) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency').value } catch (e) { return '' }
}
export const initials = (s) => String(s).split(/[\s&@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
const tail = (id) => String(id).slice(-4)

/** The title of a record: its title field, else a short mark of its id (a member may not see the title field). */
export function titleOf (object, record) {
  const v = object.title === null || object.title === undefined ? null : record.values[object.title]
  if (typeof v === 'string' && v.trim() !== '') return v
  if (typeof v === 'number') return String(v)
  return 'Untitled ' + tail(record.id)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
/** « 2026-10-29 » as « Oct 29, 2026 », with no time zone in the way. */
export function fmtDay (s) {
  const m = DAY.exec(String(s))
  if (m === null) return String(s)
  return MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1]
}
/** A time stamp from the door (ISO, UTC) as « Oct 29, 2026, 14:05 UTC ». */
export function fmtStamp (iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear() + ', ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' UTC'
}
export function fmtNumber (n, precision) {
  const opts = precision === undefined ? { maximumFractionDigits: 6 } : { minimumFractionDigits: precision, maximumFractionDigits: precision }
  return new Intl.NumberFormat('en', opts).format(n)
}
export function fmtMoney (n, currency, precision = 2) {
  if (typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)) {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: precision, maximumFractionDigits: precision }).format(n) } catch (e) { /* an unknown code: plain number below */ }
  }
  return fmtNumber(n, precision)
}
export function fmtSize (bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
/** Who made a change, in words, from the door's « by »: only what is known, never a guess. */
export function byWords (by) {
  if (by === 'person') return 'the owner'
  if (typeof by === 'string' && by.startsWith('member:')) return 'a team member'
  if (by === 'agent') return 'Kaby'
  if (by === 'template') return 'the template'
  return ''
}

export const optionOf = (field, key) => (Array.isArray(field.options) ? field.options.find((o) => o.key === key) : undefined)
const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

/**
 * What to draw for a value, as plain data: `{ kind: 'empty' }`, `text`, `link` (a url), `pill`, `pills`, `refs` (records of another table), `files`, `bool`.
 * `resolve(objectKey, id)` gives the title of a linked record, or null when this actor cannot read it.
 */
export function describe (field, value, resolve) {
  if (field.type === 'checkbox') return { kind: 'bool', value: value === true }
  if (isEmpty(value)) return { kind: 'empty' }
  switch (field.type) {
    case 'number': return { kind: 'text', text: fmtNumber(value, field.precision) }
    case 'money': return { kind: 'text', text: fmtMoney(value, field.currency, field.precision === undefined ? 2 : field.precision) }
    case 'date': return { kind: 'text', text: fmtDay(value) }
    case 'url': return /^https?:\/\//.test(value) ? { kind: 'link', text: value, href: value } : { kind: 'text', text: String(value) }
    case 'choice': { const o = optionOf(field, value); return { kind: 'pill', label: o === undefined ? String(value) : o.label, color: o === undefined ? 'gray' : (o.color || 'gray') } }
    case 'multichoice': return { kind: 'pills', items: value.map((k) => { const o = optionOf(field, k); return { label: o === undefined ? String(k) : o.label, color: o === undefined ? 'gray' : (o.color || 'gray') } }) }
    case 'relation': { const ids = Array.isArray(value) ? value : [value]; return { kind: 'refs', object: field.to, items: ids.map((id) => ({ id, title: resolve === undefined ? null : resolve(field.to, id) })) } }
    case 'attachment': return { kind: 'files', files: value }
    case 'person': return { kind: 'text', text: 'Team member' }
    default: return { kind: 'text', text: String(value) }
  }
}

/** The text of a value for the search box. */
function plain (field, value, resolve) {
  const d = describe(field, value, resolve)
  switch (d.kind) {
    case 'text': case 'link': return d.text
    case 'pill': return d.label
    case 'pills': return d.items.map((i) => i.label).join(' ')
    case 'refs': return d.items.map((i) => (i.title === null ? '' : i.title)).join(' ')
    case 'files': return d.files.map((f) => f.name).join(' ')
    default: return ''
  }
}
export function searchText (object, record, resolve) {
  const parts = [titleOf(object, record)]
  for (const f of object.fields) parts.push(plain(f, record.values[f.key], resolve))
  return parts.join(' ').toLowerCase()
}

// ── the table ──

const TEXTY = ['text', 'email', 'phone', 'url']
/**
 * Which field plays which part in a narrow list: `t` the title, `b` a badge (the first choice), `m` a second line (the first link, else a text), `a` a figure (money, number, date),
 * `o` anything else (hidden in the list, there in the table and the detail).
 */
export function slotsFor (object) {
  const slots = {}
  const fields = object.fields
  const title = fields.find((f) => f.key === object.title) ?? fields[0]
  if (title !== undefined) slots[title.key] = 't'
  const free = () => fields.filter((f) => slots[f.key] === undefined)
  const badge = free().find((f) => f.type === 'choice')
  if (badge !== undefined) slots[badge.key] = 'b'
  const meta = free().find((f) => f.type === 'relation') ?? free().find((f) => TEXTY.includes(f.type))
  if (meta !== undefined) slots[meta.key] = 'm'
  const figure = free().find((f) => f.type === 'money') ?? free().find((f) => f.type === 'number') ?? free().find((f) => f.type === 'date')
  if (figure !== undefined) slots[figure.key] = 'a'
  for (const f of fields) if (slots[f.key] === undefined) slots[f.key] = 'o'
  return slots
}

export const MAX_COLUMNS = 8
/** The columns of the table: the fields that read well in a cell, the title first, at most MAX_COLUMNS (the detail shows all of them). */
export function columnsOf (object) {
  const slots = slotsFor(object)
  const fit = object.fields.filter((f) => f.type !== 'longtext' && f.type !== 'attachment')
  const first = fit.filter((f) => slots[f.key] === 't')
  return [...first, ...fit.filter((f) => slots[f.key] !== 't')].slice(0, MAX_COLUMNS)
}

export const SORTS = [{ key: 'new', label: 'Newest first' }, { key: 'az', label: 'A to Z' }]
export function sortRecords (object, records, mode) {
  const out = records.slice()
  if (mode === 'az') return out.sort((a, b) => titleOf(object, a).localeCompare(titleOf(object, b), 'en', { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1))
  return out.sort((a, b) => (a.created.at < b.created.at ? 1 : a.created.at > b.created.at ? -1 : (a.id < b.id ? 1 : -1)))
}

/** The records that match the search and, when given, the value of a choice field. */
export function filterRecords (object, records, { q = '', field = null, value = '' }, resolve) {
  const needle = String(q).trim().toLowerCase()
  return records.filter((r) => (value === '' || field === null || r.values[field.key] === value) && (needle === '' || searchText(object, r, resolve).includes(needle)))
}

// ── the board ──

export const choiceFields = (object) => object.fields.filter((f) => f.type === 'choice')
/** The columns of a board over a choice field: one per option, in order, and « No <field> » (last) only when some record has none. */
export function groupBoard (field, records) {
  const cols = field.options.map((o) => ({ key: o.key, label: o.label, color: o.color || 'gray', records: [] }))
  const by = new Map(cols.map((c) => [c.key, c]))
  const none = { key: '', label: 'No ' + lower(field.label), color: 'gray', records: [] }
  for (const r of records) (by.get(r.values[field.key]) ?? none).records.push(r)
  return none.records.length > 0 ? [...cols, none] : cols
}

// ── forms ──

/** The control a field is edited with. */
export function controlOf (field) {
  switch (field.type) {
    case 'longtext': return 'textarea'
    case 'number': return 'number'
    case 'money': return 'money'
    case 'date': return 'date'
    case 'checkbox': return 'checkbox'
    case 'email': return 'email'
    case 'url': return 'url'
    case 'phone': return 'tel'
    case 'choice': return Array.isArray(field.options) && field.options.length <= 6 ? 'choice' : 'select'
    case 'multichoice': return 'multichoice'
    case 'relation': return field.many ? 'links' : 'link'
    case 'attachment': return 'file'
    default: return 'text'
  }
}

/** The fields offered when adding a row, in the table's order. */
export const formFields = (me, object) => object.fields.filter((f) => canWriteField(me, object, f))

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_TEXT = /^https?:\/\/[^\s/]+\S*$/
const PHONE = /^[+0-9 ().-]{3,64}$/
const NUMBER = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/

/** « 24,50 », « 24.5 » or « 1 200.00 » as a number, or null when it is not one. */
export function parseNumber (text) {
  const t = String(text).trim().replace(/[\s ']/g, '')
  if (!NUMBER.test(t)) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const needs = (field) => {
  if (field.type === 'attachment') return 'Add at least one file.'
  if (field.type === 'money') return 'Enter an amount, for example 24.50.'
  if (field.type === 'number') return 'Enter a number.'
  if (['choice', 'multichoice', 'relation', 'date'].includes(field.type)) return 'Choose a ' + lower(field.label) + '.'
  return field.label + ' is required.'
}

/**
 * Reads what was typed into the values to send. `raw` maps a field key to a string (text-like, number, money, date, choice, select, one link), a boolean (checkbox), a list of
 * strings (several links, multichoice) or a list of files already uploaded (attachment). Nothing empty is sent. `{ values, errors: { <key>: message } }`.
 */
export function readForm (fields, raw) {
  const values = {}
  const errors = {}
  for (const f of fields) {
    const r = raw[f.key]
    if (f.type === 'checkbox') { values[f.key] = r === true; continue }
    const list = Array.isArray(r) ? r : null
    const text = list === null ? (r === undefined || r === null ? '' : String(r).trim()) : ''
    const empty = list !== null ? list.length === 0 : text === ''
    if (empty) { if (f.required) errors[f.key] = needs(f); continue }
    if (f.type === 'number' || f.type === 'money') {
      const n = parseNumber(text)
      if (n === null) errors[f.key] = f.type === 'money' ? 'Enter an amount, for example 24.50.' : 'Enter a number.'
      else values[f.key] = n
    } else if (f.type === 'email') {
      if (EMAIL.test(text)) values[f.key] = text; else errors[f.key] = 'Enter a full email address, like name@company.com.'
    } else if (f.type === 'url') {
      if (URL_TEXT.test(text)) values[f.key] = text; else errors[f.key] = 'Start with http:// or https://.'
    } else if (f.type === 'phone') {
      if (PHONE.test(text)) values[f.key] = text; else errors[f.key] = 'Enter a phone number, like +44 20 7946 0000.'
    } else if (f.type === 'choice') {
      if (optionOf(f, text) !== undefined) values[f.key] = text; else errors[f.key] = 'Choose one of the options.'
    } else if (f.type === 'multichoice') values[f.key] = list ?? [text]
    else if (f.type === 'relation') values[f.key] = f.many ? (list ?? [text]) : text
    else if (f.type === 'attachment') values[f.key] = list
    else values[f.key] = text
  }
  return { values, errors }
}

const REASONS = {
  'owner-only': 'Only the owner can do that.',
  'no-profile': 'Your role does not give you access to this app.',
  'not-allowed': 'You do not have access to that.',
}
/**
 * What the door (or the edge) answered, as words for a person: `{ fields: { <key>: message }, message }`. Field errors come from the door's `errors` (`set.<key>`), the general
 * message from its own text, or from what a status says.
 */
export function readAnswer (status, body) {
  const out = { fields: {}, message: '' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (Array.isArray(b.errors)) {
    for (const e of b.errors) {
      if (e !== null && typeof e === 'object' && typeof e.path === 'string' && e.path.startsWith('set.') && typeof e.message === 'string') {
        const key = e.path.slice(4)
        if (out.fields[key] === undefined) out.fields[key] = e.message.charAt(0).toUpperCase() + e.message.slice(1) + (/[.!?]$/.test(e.message) ? '' : '.')
      }
    }
  }
  if (Object.keys(out.fields).length > 0) { out.message = 'Some fields need a look.'; return out }
  if (status === 0) out.message = 'The server cannot be reached. Check your connection and try again.'
  else if (status === 401 || b.error === 'unauthenticated') out.message = 'Your session ended. Sign in again.'
  else if (status === 429 || b.error === 'rate-limited') {
    const s = Number(b.retryAfterSec)
    out.message = 'Too many tries. ' + (Number.isFinite(s) && s > 0 ? 'Try again in ' + (s > 90 ? Math.ceil(s / 60) + ' minutes' : s + ' seconds') + '.' : 'Try again in a little while.')
  } else if (status === 403 || b.error === 'forbidden') out.message = REASONS[b.reason] ?? 'You do not have access to that.'
  else if (status === 413 || b.error === 'too-large') out.message = 'That file is too large.'
  else if (status === 404) out.message = 'That was not found. It may have been removed.'
  else if (typeof b.message === 'string' && b.message !== '') out.message = b.message.charAt(0).toUpperCase() + b.message.slice(1) + (/[.!?]$/.test(b.message) ? '' : '.')
  else out.message = 'That did not work. Try again.'
  return out
}

// ── the relations tab ──

/** The relation fields of an object, with the table each points at. */
export const relationsOf = (object) => object.fields.filter((f) => f.type === 'relation')

/**
 * The tables of an app and how they link, for the drawing: `{ nodes: [{ key, label, count, links: [field labels] }], edges: [{ a, b, aEnd, bEnd, fields }] }`. One edge per pair of
 * tables (a field and its inverse are one line); `aEnd` / `bEnd` read « 1 » where each row of the other table links to one row of this one, else « many ». A link to a table this
 * actor cannot see, and a table linked to itself, are not drawn (the list under the drawing says everything).
 */
export function relationGraph (objects) {
  const keys = new Set(objects.map((o) => o.key))
  const nodes = objects.map((o) => ({ key: o.key, label: o.label, count: o.count, links: relationsOf(o).filter((f) => keys.has(f.to)).map((f) => f.label) }))
  const pairs = new Map()
  for (const o of objects) {
    for (const f of relationsOf(o)) {
      if (!keys.has(f.to) || f.to === o.key) continue
      const [a, b] = o.key < f.to ? [o.key, f.to] : [f.to, o.key]
      const id = a + '\n' + b
      if (!pairs.has(id)) pairs.set(id, { a, b, aEnd: 'many', bEnd: 'many', fields: [] })
      const e = pairs.get(id)
      e.fields.push(f.label)
      e[f.to === e.a ? 'aEnd' : 'bEnd'] = f.many === true ? 'many' : '1'
    }
  }
  return { nodes, edges: [...pairs.values()] }
}

/** Every link in the app, as a sentence, for the list under the drawing: `{ from, to, field, text }`, the ones that start at `key` first. */
export function linksOf (objects, key) {
  const label = new Map(objects.map((o) => [o.key, o.label]))
  const all = []
  for (const o of objects) {
    for (const f of relationsOf(o)) {
      if (label.has(f.to)) all.push({ from: o.key, to: f.to, field: f.label, text: 'Each row in ' + o.label + (f.many ? ' can link to several rows in ' : ' links to one row in ') + label.get(f.to) + '.' })
    }
  }
  return [...all.filter((l) => l.from === key), ...all.filter((l) => l.from !== key && l.to === key)]
}

export const NODE_W = 190
const LINE_H = 24
export const nodeHeight = (node) => (node.links.length === 0 ? 40 : 44 + Math.min(3, node.links.length) * LINE_H)
export const MAX_DRAWN = 10

/** The tables in the order to put them round the drawing: each one next to the one it is most linked with, so the lines cross as little as can be had cheaply. */
export function ringOrder (nodes, edges) {
  const weight = (a, b) => edges.filter((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a)).length
  const left = nodes.slice()
  const out = []
  while (left.length > 0) {
    const last = out[out.length - 1]
    let best = 0
    if (last !== undefined) for (let i = 1; i < left.length; i++) if (weight(last.key, left[i].key) > weight(last.key, left[best].key)) best = i
    out.push(left.splice(best, 1)[0])
  }
  return out
}

/**
 * Puts the tables on an ellipse (one in the middle, two side by side) and gives the drawing's size: `{ width, height, nodes: [{ key, x, y, w, h }] }`. More than MAX_DRAWN tables
 * are not drawn (the list under it says everything).
 */
export function layoutGraph (nodes) {
  const n = nodes.length
  if (n === 0 || n > MAX_DRAWN) return { width: 0, height: 0, nodes: [] }
  const hs = nodes.map(nodeHeight)
  const hMax = Math.max(...hs)
  const width = 760
  const height = n <= 2 ? hMax + 40 : n <= 4 ? 2 * hMax + 120 : 3 * hMax + 160
  const placed = nodes.map((node, i) => {
    let cx = width / 2
    let cy = height / 2
    if (n === 2) cx = i === 0 ? NODE_W / 2 + 10 : width - NODE_W / 2 - 10
    else if (n > 2) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n
      cx = width / 2 + ((width - NODE_W) / 2 - 10) * Math.cos(a)
      cy = height / 2 + ((height - hMax) / 2 - 10) * Math.sin(a)
    }
    return { key: node.key, x: Math.round(cx - NODE_W / 2), y: Math.round(cy - hs[i] / 2), w: NODE_W, h: hs[i] }
  })
  return { width, height, nodes: placed }
}

/** Where the line between two boxes leaves the first and enters the second: the points of their borders on the line between their centres. */
export function edgePoints (a, b) {
  const edge = (r, tx, ty) => {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const dx = tx - cx
    const dy = ty - cy
    if (dx === 0 && dy === 0) return { x: cx, y: cy }
    const k = Math.min(dx === 0 ? Infinity : (r.w / 2) / Math.abs(dx), dy === 0 ? Infinity : (r.h / 2) / Math.abs(dy))
    return { x: cx + dx * k, y: cy + dy * k }
  }
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  return { from: edge(a, bc.x, bc.y), to: edge(b, ac.x, ac.y) }
}

/**
 * A point on the line from `p` towards `q`, `d` along it and `off` to one side: where a label sits at the end of an edge. The side is the one away from `away` (the centre of the
 * box the end belongs to, so the label is never under its own box), else the lower one (the right one when the line is vertical).
 */
export function along (p, q, d, off, away) {
  const dx = q.x - p.x
  const dy = q.y - p.y
  const len = Math.hypot(dx, dy) || 1
  let nx = -dy / len
  let ny = dx / len
  const x = p.x + (dx / len) * d
  const y = p.y + (dy / len) * d
  const flip = away === undefined ? ny < 0 || (ny === 0 && nx < 0) : (x + nx - away.x) ** 2 + (y + ny - away.y) ** 2 < (x - nx - away.x) ** 2 + (y - ny - away.y) ** 2
  if (flip) { nx = -nx; ny = -ny }
  return { x: Math.round(x + nx * off), y: Math.round(y + ny * off) }
}

// ── the hash route: #/<app slug>/<table key>/<view> ──

export const VIEWS = ['table', 'board', 'relations']
export function parseRoute (hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').map((p) => { try { return decodeURIComponent(p) } catch (e) { return '' } })
  const view = VIEWS.includes(parts[2]) ? parts[2] : 'table'
  return { slug: parts[0] || '', object: parts[1] || '', view }
}
export const routeHash = (r) => '#/' + [r.slug, r.object, r.view === 'table' ? '' : r.view].filter((p) => p !== '').map(encodeURIComponent).join('/')
/** The route to land on: the one asked for when it exists among what this actor sees, else the first table of the first app. */
export function settleRoute (apps, asked) {
  const app = apps.find((a) => a.slug === asked.slug) ?? apps[0]
  if (app === undefined) return null
  const object = app.objects.find((o) => o.key === asked.object) ?? app.objects[0]
  if (object === undefined) return { slug: app.slug, object: '', view: 'table' }
  const view = asked.view === 'board' && choiceFields(object).length === 0 ? 'table' : asked.view
  return { slug: app.slug, object: object.key, view }
}
