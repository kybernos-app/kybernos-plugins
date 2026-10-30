// A query over the records of one object: search, then filter, then sort. What a view shows and what the agent's `records_list` returns. Pure.

import { blankFilter, matches, prepareFilter } from './filter.mjs'
import { prepareSorts, sortRecords } from './sort.mjs'
import { textOf } from './types.mjs'
import { fold } from './text.mjs'

/**
 * The text a search looks in: every value of a record as plain text, folded. A `secret` field is never searched, so a search cannot be used to guess it.
 */
export function searchText (fields, record, ctx) {
  return fields.filter((f) => f.protection !== 'secret').map((f) => fold(textOf(f, record.values[f.key], ctx))).filter(Boolean).join(' ')
}

/**
 * The records of an object that a view shows: `{ fields, q?, flt?, sorts? }`, the filter and the sorts being a view's. Deleted records never show.
 * The filter and the sorts are prepared first (what cannot apply is dropped), so a half-edited view still shows something. Returns a new array.
 */
export function queryRecords (records, { fields, q, flt, sorts }, ctx) {
  const needle = fold(String(q || '').trim())
  const filter = prepareFilter(flt || blankFilter(), fields)
  let rows = records.filter((r) => !r.deleted)
  if (needle) rows = rows.filter((r) => searchText(fields, r, ctx).includes(needle))
  rows = rows.filter((r) => matches(filter, r, fields, ctx))
  return sortRecords(rows, prepareSorts(sorts, fields), fields, ctx)
}
