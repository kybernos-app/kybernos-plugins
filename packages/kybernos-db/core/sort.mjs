// Sorting: up to three fields, each ascending or descending. Pure, and the same order everywhere (Node, browser, server).
//
//   sorts = [{ k: <field key>, dir: 'asc' | 'desc' }]
//
// Empty values go last whichever way the field is ordered. A choice sorts in the order of its options (not alphabetically), a multichoice by its
// first option in that order, a date by day, a checkbox with unchecked first, a person or a relation by the name `ctx.label(field, value)` gives (else the id).
// When two records tie on every sort, the older one (the smaller id: ids are time-ordered) comes first, so an unstable engine cannot reorder them.

import { dayNumber } from './dates.mjs'
import { familyOf, isSortable } from './types.mjs'
import { compareText, isPlain } from './text.mjs'

export const SORT_MAX = 3

const err = (path, code, message) => ({ path, code, message })

/** Every problem of a list of sorts, `[{ path, code, message }]`. */
export function checkSorts (sorts, fields) {
  if (!Array.isArray(sorts)) return [err('', 'shape', 'sorts is a list')]
  const errors = []
  const seen = new Set()
  if (sorts.length > SORT_MAX) errors.push(err('', 'too-many', 'at most ' + SORT_MAX + ' sorts'))
  sorts.forEach((s, i) => {
    const at = String(i)
    if (!isPlain(s) || Object.keys(s).some((k) => k !== 'k' && k !== 'dir') || typeof s.k !== 'string') { errors.push(err(at, 'shape', 'a sort is { k, dir }')); return }
    if (s.dir !== 'asc' && s.dir !== 'desc') errors.push(err(at, 'dir', 'dir is "asc" or "desc"'))
    const field = fields.find((f) => f.key === s.k)
    if (!field) errors.push(err(at, 'unknown-field', 'no such field'))
    else if (!isSortable(field)) errors.push(err(at, 'not-sortable', 'a ' + field.type + ' field cannot be sorted'))
    if (seen.has(s.k)) errors.push(err(at, 'duplicate', 'a field is sorted once'))
    seen.add(s.k)
  })
  return errors
}

/** The sorts that can apply: a removed or unsortable field, a repeat and anything past the third are dropped. */
export function prepareSorts (sorts, fields) {
  const out = []
  for (const s of Array.isArray(sorts) ? sorts : []) {
    if (!isPlain(s) || typeof s.k !== 'string' || out.some((x) => x.k === s.k)) continue
    const field = fields.find((f) => f.key === s.k)
    if (field && isSortable(field) && out.length < SORT_MAX) out.push({ k: s.k, dir: s.dir === 'desc' ? 'desc' : 'asc' })
  }
  return out
}

/** The sort key of a value, `{ n }` for a number or `{ s }` for a text, or `null` when the value is empty. */
function keyOf (field, value, ctx) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return null
  const name = (v) => String((ctx && typeof ctx.label === 'function' && ctx.label(field, v)) || v)
  const index = (v) => (field.options || []).findIndex((o) => o.key === v)
  switch (field.type) {
    case 'number': case 'money': return { n: value }
    case 'checkbox': return { n: value ? 1 : 0 }
    case 'date': { const d = dayNumber(value); return d === null ? null : { n: d } }
    case 'choice': { const i = index(value); return i < 0 ? null : { n: i } }
    case 'multichoice': { const ix = value.map(index).filter((i) => i >= 0); return ix.length ? { n: Math.min(...ix) } : null }
    case 'person': return { s: name(value) }
    case 'relation': return { s: field.many ? name(value[0]) : name(value) }
    default: return familyOf(field) === 'text' ? { s: value } : null
  }
}

const cmpKeys = (x, y) => (x.n !== undefined ? x.n - y.n : compareText(x.s, y.s))

/** A new array of the records in the order of `sorts` (already prepared or checked). The records are not changed. */
export function sortRecords (records, sorts, fields, ctx) {
  const plan = sorts.map((s) => ({ field: fields.find((f) => f.key === s.k), sign: s.dir === 'desc' ? -1 : 1 })).filter((p) => p.field)
  const keys = new Map(records.map((r) => [r, plan.map((p) => keyOf(p.field, r.values[p.field.key], ctx))]))
  return records.slice().sort((a, b) => {
    const ka = keys.get(a)
    const kb = keys.get(b)
    for (let i = 0; i < plan.length; i++) {
      const x = ka[i]
      const y = kb[i]
      if (x === null || y === null) { if (x === y) continue; return x === null ? 1 : -1 }
      const c = cmpKeys(x, y) * plan[i].sign
      if (c !== 0) return c
    }
    return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
  })
}
