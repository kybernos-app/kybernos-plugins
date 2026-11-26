// How a field is kept in its column. One column per field, named by the field's key, so raw SQL reads and writes the same data the engine does.
//
//   text, longtext, url, email, phone, choice, person, date, relation (one)   TEXT
//   number, money                                                              REAL
//   checkbox                                                                   INTEGER 0 | 1, never NULL
//   multichoice, relation (many), attachment                                   TEXT holding a JSON list (never an empty one: an empty list is NULL)
//
// A value read back is exactly the canonical value that was written (see core/types.mjs).

import { familyOf } from '../core/index.mjs'

export const isJsonColumn = (field) => field.type === 'multichoice' || field.type === 'attachment' || (field.type === 'relation' && field.many === true)

export const sqlType = (field) => {
  if (field.type === 'checkbox') return 'INTEGER'
  return familyOf(field) === 'number' ? 'REAL' : 'TEXT'
}

/** The JS value to bind for a canonical value. */
export const toColumn = (field, value) => {
  if (field.type === 'checkbox') return value ? 1 : 0
  if (value === null || value === undefined) return null
  return isJsonColumn(field) ? JSON.stringify(value) : value
}

/** The canonical value of what a column holds. */
export const fromColumn = (field, raw) => {
  if (field.type === 'checkbox') return raw === 1 || raw === 1n
  if (raw === null || raw === undefined) return null
  return isJsonColumn(field) ? JSON.parse(raw) : raw
}
