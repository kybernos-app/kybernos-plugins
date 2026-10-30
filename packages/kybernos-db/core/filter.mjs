// The JSON filter: the one shape that views, the agent's `records_list`, row rights and sync all share. Pure.
//
//   { conj: 'and' | 'or', items: [ condition | { conj, items: [condition…] } ] }      one level of groups, as in Airtable
//   condition = { k: <field key>, op: <operator>, v: <value> }
//
//   family       operators                                          value
//   text         contains ncontains is isnot empty nempty           a text
//   number       eq ne lt gt le ge empty nempty                     a number
//   date         is before after  ·  within  ·  empty nempty        { n: days from today } or { d: 'YYYY-MM-DD' }  ·  next7 next30 past7 past30
//   checkbox     checked unchecked                                  none
//   one          is isnot  ·  in nin  ·  empty nempty               a key or id  ·  a list of them
//   many         in nin all  ·  empty nempty                        a list of keys or ids (in = any of, nin = none of, all = every one of)
//   files        empty nempty                                       none
//
// Three ways to read a filter, because a screen and a right do not fail the same way:
//   checkFilter    strict: every problem, with its path. For a filter being saved.
//   prepareFilter  forgiving: drops what cannot filter yet (a condition without a value, on a removed field). For a view being edited.
//   matches        fail-closed: a condition that cannot be evaluated is false, so a damaged right never lets a row through by accident.
// A group with no condition is ignored by its parent; a filter with none matches everything.
//
// « Today » and « me » come from the caller (`ctx.today`, `ctx.me`), never from a clock: a person field holding '@me' means `ctx.me`.

import { dayNumber, isDate } from './dates.mjs'
import { familyOf, opsFor } from './types.mjs'
import { fold, isPlain } from './text.mjs'

export const MAX_DEPTH = 2
export const MAX_CONDITIONS = 50
export const WITHIN = ['next7', 'next30', 'past7', 'past30']
export const NO_VALUE_OPS = ['empty', 'nempty', 'checked', 'unchecked']
export const ME = '@me'

export const blankFilter = () => ({ conj: 'and', items: [] })
export const isGroup = (item) => isPlain(item) && Array.isArray(item.items)

const fieldMap = (fields) => {
  const out = Object.create(null)
  for (const f of fields) out[f.key] = f
  return out
}
const blank = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
const err = (path, code, message) => ({ path, code, message })
const strings = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x !== '')

/** Why a condition cannot filter, as `{ code, message }`, or `null` when it can. `field` is the definition of the field it names (or undefined). */
function problem (field, c) {
  if (!field) return { code: 'unknown-field', message: 'no such field' }
  if (typeof c.op !== 'string' || !opsFor(field).includes(c.op)) return { code: 'bad-op', message: 'a ' + field.type + ' field has no operator "' + String(c.op) + '"' }
  if (NO_VALUE_OPS.includes(c.op)) return c.v === null || c.v === undefined ? null : { code: 'bad-value', message: c.op + ' takes no value' }
  const v = c.v
  if (blank(v)) return { code: 'incomplete', message: 'the condition has no value yet' }
  const family = familyOf(field)
  const wrong = { code: 'bad-value', message: 'not a value ' + c.op + ' can compare with' }
  if (family === 'text') return typeof v === 'string' ? null : wrong
  if (family === 'number') return typeof v === 'number' && Number.isFinite(v) ? null : wrong
  if (family === 'date') {
    if (c.op === 'within') return WITHIN.includes(v) ? null : wrong
    if (!isPlain(v)) return wrong
    const keys = Object.keys(v)
    if (keys.length === 1 && keys[0] === 'n') return Number.isInteger(v.n) && Math.abs(v.n) <= 36500 ? null : wrong
    if (keys.length === 1 && keys[0] === 'd') return isDate(v.d) ? null : wrong
    return wrong
  }
  if (family === 'one') return c.op === 'in' || c.op === 'nin' ? (strings(v) ? null : wrong) : typeof v === 'string' ? null : wrong
  if (family === 'many') return strings(v) ? null : wrong
  return wrong
}

/** Every problem of a filter, `[{ path, code, message }]` (empty when it is sound). `path` is the dotted position of the item, « 1.0 » for the first condition of the second item. */
export function checkFilter (flt, fields) {
  const errors = []
  const byKey = fieldMap(fields)
  let count = 0
  const walk = (group, path, depth) => {
    if (!isGroup(group)) { errors.push(err(path, 'shape', 'a filter is { conj, items }')); return }
    for (const k of Object.keys(group)) if (k !== 'conj' && k !== 'items') errors.push(err(path, 'unknown-key', '"' + k + '" is not part of a filter'))
    if (group.conj !== 'and' && group.conj !== 'or') errors.push(err(path, 'conj', 'conj is "and" or "or"'))
    group.items.forEach((item, i) => {
      const at = path === '' ? String(i) : path + '.' + i
      if (isGroup(item)) {
        if (depth >= MAX_DEPTH) errors.push(err(at, 'depth', 'groups go one level deep'))
        else walk(item, at, depth + 1)
        return
      }
      if (!isPlain(item) || Object.keys(item).some((k) => k !== 'k' && k !== 'op' && k !== 'v') || typeof item.k !== 'string') { errors.push(err(at, 'shape', 'a condition is { k, op, v }')); return }
      count += 1
      if (count === MAX_CONDITIONS + 1) errors.push(err(at, 'too-many', 'a filter has at most ' + MAX_CONDITIONS + ' conditions'))
      const why = problem(byKey[item.k], item)
      if (why) errors.push(err(at, why.code, why.message))
    })
  }
  walk(flt, '', 1)
  return errors
}

/** The filter as it can be applied now: conditions that cannot filter yet are dropped, then the groups left empty. Always a sound filter, never throws. */
export function prepareFilter (flt, fields) {
  const byKey = fieldMap(fields)
  let count = 0
  const keep = (group, depth) => {
    const items = []
    for (const item of group.items) {
      if (isGroup(item)) {
        if (depth >= MAX_DEPTH) continue
        const sub = keep(item, depth + 1)
        if (sub.items.length) items.push(sub)
      } else if (isPlain(item) && typeof item.k === 'string' && count < MAX_CONDITIONS && !problem(byKey[item.k], item)) {
        count += 1
        items.push({ k: item.k, op: item.op, v: NO_VALUE_OPS.includes(item.op) ? null : item.v })
      }
    }
    return { conj: group.conj === 'or' ? 'or' : 'and', items }
  }
  return isGroup(flt) ? keep(flt, 1) : blankFilter()
}

/** Every condition of a filter, groups flattened. */
export const flatConditions = (flt) => (isGroup(flt) ? flt.items.flatMap(flatConditions) : [flt])

/** The filter without any condition on `key`, and without the groups that leaves empty. */
export function dropField (flt, key) {
  const cut = (group) => {
    const items = []
    for (const item of group.items) {
      if (isGroup(item)) {
        const sub = cut(item)
        if (sub.items.length) items.push(sub)
      } else if (item.k !== key) items.push(item)
    }
    return { conj: group.conj, items }
  }
  return isGroup(flt) ? cut(flt) : blankFilter()
}

function holds (c, field, value, ctx) {
  if (problem(field, c)) return false
  const empty = blank(value)
  switch (c.op) {
    case 'empty': return empty
    case 'nempty': return !empty
    case 'checked': return value === true
    case 'unchecked': return value !== true
  }
  const family = familyOf(field)
  if (family === 'text') {
    const cell = fold(value === null || value === undefined ? '' : value)
    const word = fold(c.v)
    if (c.op === 'contains') return cell.includes(word)
    if (c.op === 'ncontains') return !cell.includes(word)
    if (c.op === 'is') return cell === word
    return cell !== word
  }
  if (family === 'number') {
    const num = !empty && typeof value === 'number'
    switch (c.op) {
      case 'eq': return num && value === c.v
      case 'ne': return !num || value !== c.v
      case 'lt': return num && value < c.v
      case 'gt': return num && value > c.v
      case 'le': return num && value <= c.v
      default: return num && value >= c.v
    }
  }
  if (family === 'date') {
    const today = ctx && typeof ctx.today === 'string' ? dayNumber(ctx.today) : null
    // a relative date needs « today » whatever the row holds, so a missing one fails the same way on every row
    if ((c.op === 'within' || c.v.n !== undefined) && today === null) throw new TypeError('ctx.today is needed to evaluate a relative date')
    const cell = dayNumber(value)
    if (cell === null) return false
    if (c.op === 'within') {
      const away = cell - today
      return c.v === 'next7' ? away >= 0 && away <= 7 : c.v === 'next30' ? away >= 0 && away <= 30 : c.v === 'past7' ? away <= 0 && away >= -7 : away <= 0 && away >= -30
    }
    const target = c.v.d !== undefined ? dayNumber(c.v.d) : today + c.v.n
    return c.op === 'is' ? cell === target : c.op === 'before' ? cell < target : cell > target
  }
  const me = (v) => (field.type === 'person' && v === ME ? (ctx && ctx.me) : v)
  if (family === 'one') {
    if (c.op === 'is') return !empty && value === me(c.v)
    if (c.op === 'isnot') return value !== me(c.v)
    const hit = !empty && c.v.map(me).includes(value)
    return c.op === 'in' ? hit : !hit
  }
  if (family === 'many') {
    const cell = Array.isArray(value) ? value : []
    if (c.op === 'in') return cell.some((x) => c.v.includes(x))
    if (c.op === 'nin') return !cell.some((x) => c.v.includes(x))
    return c.v.every((x) => cell.includes(x))
  }
  return false
}

/** Whether a record passes a filter. `record.values` maps field keys to values. See the head of this file for the three ways to read a filter. */
export function matches (flt, record, fields, ctx) {
  if (!isGroup(flt)) return false
  const byKey = fieldMap(fields)
  const test = (group) => {
    const live = group.items.filter((item) => !isGroup(item) || item.items.length > 0)
    if (live.length === 0) return true
    const run = (item) => (isGroup(item) ? test(item) : isPlain(item) && typeof item.k === 'string' && holds(item, byKey[item.k], record.values[item.k], ctx))
    return group.conj === 'or' ? live.some(run) : live.every(run)
  }
  return test(flt)
}
