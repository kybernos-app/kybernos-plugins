// Operations: the one shape in which a record changes, written to the journal, sent to the server and replayed on another device. Pure.
//
//   { id, kind, object, record, set?, prev?, by, at }
//     id      ULID of the operation          kind   create | update | delete | restore      object  the object's key        record  ULID of the record
//     set     the values written, by field   (create, update)   only the fields that change, each in its canonical form
//     prev    the values they replaced       (update)            for the journal and for Undo; applying an operation never reads it
//     by, at  who (a member or agent id) and when (« 2026-10-30T09:15:00.000Z »)
//
// A record is `{ id, values, rev, created: { by, at }, modified: { by, at }, deleted: null | { by, at } }`. A delete only marks the record (so it can be restored,
// and so a device that was offline hears about it). Operations are field-level: two people changing two fields of one record both win; the server's order decides
// when they change the same one. Applying the same sequence in the same order gives the same records everywhere.

import { dayNumber } from './dates.mjs'
import { defaultValue, isUlid, normalizeValue } from './types.mjs'
import { isPlain, sameJson } from './text.mjs'

export const OP_KINDS = ['create', 'update', 'delete', 'restore']

const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/
const err = (path, code, message) => ({ path, code, message })

/** Whether a text is a UTC timestamp « YYYY-MM-DDTHH:MM:SS.mmmZ » of a real day and time. */
export const isTimestamp = (s) => {
  const m = typeof s === 'string' ? STAMP.exec(s) : null
  return m !== null && dayNumber(m[1]) !== null && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4]) < 60
}

const tidyBy = (s) => typeof s === 'string' && s.length >= 1 && s.length <= 64

/** Every problem of an operation for an object `{ key, fields }`, `[{ path, code, message }]`. Values must already be in their canonical form (see `normalizeValue`). */
export function checkOp (op, obj) {
  if (!isPlain(op)) return [err('', 'shape', 'an operation is an object')]
  const errors = []
  for (const k of Object.keys(op)) if (!['id', 'kind', 'object', 'record', 'set', 'prev', 'by', 'at'].includes(k)) errors.push(err(k, 'unknown-key', 'not an operation property'))
  if (!isUlid(op.id)) errors.push(err('id', 'id', 'an operation id is a ULID'))
  if (!OP_KINDS.includes(op.kind)) errors.push(err('kind', 'kind', 'one of ' + OP_KINDS.join(', ')))
  if (op.object !== obj.key) errors.push(err('object', 'object', 'the operation is for another object'))
  if (!isUlid(op.record)) errors.push(err('record', 'id', 'a record id is a ULID'))
  if (!tidyBy(op.by)) errors.push(err('by', 'by', 'who did it: 1 to 64 characters'))
  if (!isTimestamp(op.at)) errors.push(err('at', 'at', 'a UTC timestamp like 2026-10-30T09:15:00.000Z'))
  const writes = op.kind === 'create' || op.kind === 'update'
  if (!writes) {
    if (op.set !== undefined) errors.push(err('set', 'not-for-kind', op.kind + ' writes no values'))
    if (op.prev !== undefined) errors.push(err('prev', 'not-for-kind', op.kind + ' replaces no values'))
    return errors
  }
  if (op.kind === 'create' && op.prev !== undefined) errors.push(err('prev', 'not-for-kind', 'a new record replaces nothing'))
  if (!isPlain(op.set)) { errors.push(err('set', 'shape', 'set is an object of field values')); return errors }
  if (op.kind === 'update' && Object.keys(op.set).length === 0) errors.push(err('set', 'empty', 'an update changes at least one field'))
  for (const key of Object.keys(op.set)) {
    const field = obj.fields.find((f) => f.key === key)
    if (!field) { errors.push(err('set.' + key, 'unknown-field', 'no such field')); continue }
    const r = normalizeValue(field, op.set[key])
    if (!r.ok) errors.push(err('set.' + key, r.code, r.message))
    else if (!sameJson(r.value, op.set[key])) errors.push(err('set.' + key, 'not-canonical', 'the value is not in its canonical form'))
    else if (field.required && field.type !== 'checkbox' && r.value === null) errors.push(err('set.' + key, 'required', 'a required field cannot be empty'))
  }
  if (op.kind === 'create') {
    for (const field of obj.fields) {
      if (field.required && field.type !== 'checkbox' && op.set[field.key] === undefined) errors.push(err('set.' + field.key, 'required', 'a required field needs a value'))
    }
  } else if (op.prev !== undefined) {
    if (!isPlain(op.prev)) errors.push(err('prev', 'shape', 'prev is an object of field values'))
    else for (const key of Object.keys(op.prev)) if (!(key in op.set)) errors.push(err('prev.' + key, 'unknown-field', 'prev holds a field the operation does not set'))
  }
  return errors
}

const done = (record) => ({ ok: true, record })
const refuse = (code, message) => ({ ok: false, code, message })

/**
 * Applies one operation to a record (`null` when there is none yet), giving `{ ok: true, record }` or `{ ok: false, code, message }`; neither argument is changed.
 * Deleting a deleted record and restoring a live one change nothing, so a replayed operation is harmless. Codes: invalid, exists, missing, wrong-record, deleted.
 */
export function applyOp (record, op, obj) {
  const errors = checkOp(op, obj)
  if (errors.length) return { ok: false, code: 'invalid', message: errors[0].path + ': ' + errors[0].message, errors }
  const stamp = { by: op.by, at: op.at }
  if (op.kind === 'create') {
    if (record) return refuse('exists', 'the record already exists')
    const values = {}
    for (const field of obj.fields) values[field.key] = op.set[field.key] === undefined ? defaultValue(field) : op.set[field.key]
    return done({ id: op.record, values, rev: 1, created: stamp, modified: stamp, deleted: null })
  }
  if (!record) return refuse('missing', 'no such record')
  if (record.id !== op.record) return refuse('wrong-record', 'the operation is for another record')
  if (op.kind === 'update') {
    if (record.deleted) return refuse('deleted', 'the record is deleted')
    return done({ ...record, values: { ...record.values, ...op.set }, rev: record.rev + 1, modified: stamp })
  }
  if (op.kind === 'delete') return record.deleted ? done(record) : done({ ...record, rev: record.rev + 1, modified: stamp, deleted: stamp })
  return record.deleted ? done({ ...record, rev: record.rev + 1, modified: stamp, deleted: null }) : done(record)
}

/**
 * Builds a `create` operation from raw values: each is put in its canonical form. `{ ok: true, op }`, or `{ ok: false, errors }` when a value is refused.
 * `meta` is `{ id, record, by, at }`: the ids come from the caller, who owns the clock and the randomness.
 */
export function buildCreate (obj, values, meta) {
  const set = {}
  const errors = []
  for (const key of Object.keys(values || {})) {
    const field = obj.fields.find((f) => f.key === key)
    if (!field) { errors.push(err('set.' + key, 'unknown-field', 'no such field')); continue }
    const r = normalizeValue(field, values[key])
    if (r.ok) set[key] = r.value
    else errors.push(err('set.' + key, r.code, r.message))
  }
  if (errors.length) return { ok: false, errors }
  const op = { id: meta.id, kind: 'create', object: obj.key, record: meta.record, set, by: meta.by, at: meta.at }
  const bad = checkOp(op, obj)
  return bad.length ? { ok: false, errors: bad } : { ok: true, op }
}

/**
 * Builds an `update` operation from the new values of some fields: only what really differs from the record is kept, and `prev` records what it replaced.
 * `{ ok: true, op }` where `op` is `null` when nothing changes, or `{ ok: false, errors }`. `meta` is `{ id, by, at }`.
 */
export function buildUpdate (obj, record, changes, meta) {
  const set = {}
  const prev = {}
  const errors = []
  for (const key of Object.keys(changes || {})) {
    const field = obj.fields.find((f) => f.key === key)
    if (!field) { errors.push(err('set.' + key, 'unknown-field', 'no such field')); continue }
    const r = normalizeValue(field, changes[key])
    if (!r.ok) { errors.push(err('set.' + key, r.code, r.message)); continue }
    const before = record.values[key] === undefined ? defaultValue(field) : record.values[key]
    if (!sameJson(before, r.value)) { set[key] = r.value; prev[key] = before }
  }
  if (errors.length) return { ok: false, errors }
  if (Object.keys(set).length === 0) return { ok: true, op: null }
  const op = { id: meta.id, kind: 'update', object: obj.key, record: record.id, set, prev, by: meta.by, at: meta.at }
  const bad = checkOp(op, obj)
  return bad.length ? { ok: false, errors: bad } : { ok: true, op }
}
