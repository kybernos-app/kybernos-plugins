// A view: a saved way of looking at an object. Pure.
//
//   { id, name, kind: 'table' | 'board' | 'cards' | 'calendar', owner: 'kaby' | 'me', fav,
//     by?    (board: the choice field that makes the columns),
//     date?  (calendar: the date field that places a record),
//     cover? (cards: true draws the first picture of a row as a banner over the card; absent or false, as a small avatar),
//     state: { flt, sorts, hidden } }     flt is the JSON filter, sorts up to three, hidden the field keys left out of the view
//
// Every view belongs to the person to change, and a change is saved on the spot. `owner` only says who made it first (Kaby or the person):
// it grants no right. The object's title field is always shown.

import { blankFilter, checkFilter, prepareFilter } from './filter.mjs'
import { checkSorts, prepareSorts } from './sort.mjs'
import { isPlain } from './text.mjs'

export const VIEW_KINDS = ['table', 'board', 'cards', 'calendar']
export const OWNERS = ['kaby', 'me']

const VIEW_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const err = (path, code, message) => ({ path, code, message })

export const blankState = () => ({ flt: blankFilter(), sorts: [], hidden: [] })

/** Whether an object can be drawn as a kind: a board needs a choice field, a calendar a date field. */
export const kindAvailable = (fields, kind) => kind === 'table' || kind === 'cards' || (kind === 'board' && fields.some((f) => f.type === 'choice')) || (kind === 'calendar' && fields.some((f) => f.type === 'date'))

/** Every problem of a view for an object `{ fields, title }`, `[{ path, code, message }]`. */
export function checkView (view, obj) {
  const errors = []
  if (!isPlain(view)) return [err('', 'shape', 'a view is an object')]
  for (const k of Object.keys(view)) if (!['id', 'name', 'kind', 'owner', 'fav', 'by', 'date', 'cover', 'state'].includes(k)) errors.push(err(k, 'unknown-key', 'not a view property'))
  if (typeof view.id !== 'string' || !VIEW_ID.test(view.id)) errors.push(err('id', 'id', 'an id is letters, digits, - and _, 64 at most'))
  if (typeof view.name !== 'string' || view.name.trim().length < 1 || view.name.trim().length > 60) errors.push(err('name', 'name', 'a name is 1 to 60 characters'))
  if (!VIEW_KINDS.includes(view.kind)) errors.push(err('kind', 'kind', 'one of ' + VIEW_KINDS.join(', ')))
  if (!OWNERS.includes(view.owner)) errors.push(err('owner', 'owner', 'kaby or me'))
  if (typeof view.fav !== 'boolean') errors.push(err('fav', 'type', 'true or false'))
  const field = (key) => obj.fields.find((f) => f.key === key)
  if (view.kind === 'board') {
    if (!field(view.by) || field(view.by).type !== 'choice') errors.push(err('by', 'by', 'a board is made of the columns of a choice field'))
  } else if (view.by !== undefined) errors.push(err('by', 'not-for-kind', 'only a board has columns'))
  if (view.kind === 'calendar') {
    if (!field(view.date) || field(view.date).type !== 'date') errors.push(err('date', 'date', 'a calendar places records by a date field'))
  } else if (view.date !== undefined) errors.push(err('date', 'not-for-kind', 'only a calendar has a date field'))
  if (view.kind === 'cards') {
    if (view.cover !== undefined && typeof view.cover !== 'boolean') errors.push(err('cover', 'type', 'true or false'))
  } else if (view.cover !== undefined) errors.push(err('cover', 'not-for-kind', 'only a cards view has a cover'))
  if (!isPlain(view.state)) errors.push(err('state', 'shape', 'state is { flt, sorts, hidden }'))
  else {
    for (const e of checkFilter(view.state.flt, obj.fields)) errors.push({ ...e, path: 'state.flt' + (e.path === '' ? '' : '.' + e.path) })
    for (const e of checkSorts(view.state.sorts, obj.fields)) errors.push({ ...e, path: 'state.sorts' + (e.path === '' ? '' : '.' + e.path) })
    if (!Array.isArray(view.state.hidden)) errors.push(err('state.hidden', 'shape', 'hidden is a list of field keys'))
    else {
      view.state.hidden.forEach((key, i) => {
        if (!field(key)) errors.push(err('state.hidden.' + i, 'unknown-field', 'no such field'))
        else if (key === obj.title) errors.push(err('state.hidden.' + i, 'title', 'the title field is always shown'))
      })
      if (new Set(view.state.hidden).size !== view.state.hidden.length) errors.push(err('state.hidden', 'duplicate', 'a field is hidden once'))
    }
  }
  return errors
}

/**
 * A view in its canonical form with the defaults filled (`owner` me, `fav` false, a blank state, the first choice field for a board's columns, the first date field
 * for a calendar): `{ ok: true, view }`, or `{ ok: false, errors }` when it is not sound for the object.
 */
export function normalizeView (view, obj) {
  if (!isPlain(view)) return { ok: false, errors: [err('', 'shape', 'a view is an object')] }
  const state = isPlain(view.state) ? view.state : {}
  const out = {
    id: view.id,
    name: typeof view.name === 'string' ? view.name.trim() : view.name,
    kind: view.kind,
    owner: view.owner === undefined ? 'me' : view.owner,
    fav: view.fav === undefined ? false : view.fav,
  }
  if (view.kind === 'board') out.by = view.by === undefined ? (obj.fields.find((f) => f.type === 'choice') || {}).key : view.by
  else if (view.by !== undefined) out.by = view.by
  if (view.kind === 'calendar') out.date = view.date === undefined ? (obj.fields.find((f) => f.type === 'date') || {}).key : view.date
  else if (view.date !== undefined) out.date = view.date
  // only `true` is stored: a cards view saved before the cover existed stays exactly as it was
  if (view.kind === 'cards' && view.cover === true) out.cover = true
  else if (view.kind !== 'cards' && view.cover !== undefined) out.cover = view.cover
  out.state = { flt: state.flt === undefined ? blankFilter() : state.flt, sorts: state.sorts === undefined ? [] : state.sorts, hidden: state.hidden === undefined ? [] : state.hidden }
  if (isPlain(view.state)) for (const k of Object.keys(view.state)) if (!(k in out.state)) out.state[k] = view.state[k]
  const errors = checkView(out, obj)
  return errors.length ? { ok: false, errors } : { ok: true, view: out }
}

/**
 * The view made sound again after the fields changed (`fields` are the ones left, `title` the title field's key): what points at a removed field is cut,
 * and a board or a calendar that lost its field takes another one of the right type or becomes a table. Never throws; the view is not changed.
 */
export function repairView (view, fields, title) {
  const has = (key) => fields.some((f) => f.key === key)
  const state = isPlain(view.state) ? view.state : {}
  const out = {
    id: view.id,
    name: view.name,
    kind: view.kind,
    owner: view.owner,
    fav: view.fav === true,
    state: {
      flt: prepareFilter(state.flt, fields),
      sorts: prepareSorts(state.sorts, fields),
      hidden: (Array.isArray(state.hidden) ? state.hidden : []).filter((k, i, all) => has(k) && k !== title && all.indexOf(k) === i),
    },
  }
  if (view.kind === 'board') {
    const by = fields.find((f) => f.key === view.by && f.type === 'choice') || fields.find((f) => f.type === 'choice')
    if (by) out.by = by.key
    else out.kind = 'table'
  }
  if (view.kind === 'cards' && view.cover === true) out.cover = true
  if (view.kind === 'calendar') {
    const date = fields.find((f) => f.key === view.date && f.type === 'date') || fields.find((f) => f.type === 'date')
    if (date) out.date = date.key
    else out.kind = 'table'
  }
  return out
}
