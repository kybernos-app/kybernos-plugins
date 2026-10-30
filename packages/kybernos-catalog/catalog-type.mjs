// kybernos/catalog#type — what a theme tells the Catalog plugin about the things it lists: a product, a property, a job.
//
// A theme ships `catalog/<id>.json` (data only, never code), one file per kind of item:
//   { "id": "product",
//     "label": { "en": "Product" }, "plural": { "en": "Products" }, "icon": "package",
//     "statuses": [{ "key": "live", "tone": "ok", "label": { "en": "Live" } }],
//     "fields":   [{ "key": "sku", "type": "text" }, { "key": "stock", "type": "number" }, { "key": "price", "type": "money", "currency": "EUR" }],
//     "card":     { "title": "title", "subtitle": "sku", "price": "price", "image": "photo", "chips": ["category", "size"],
//                   "flag": { "field": "stock", "lte": 10, "label": { "en": "Low stock: {n} left" } } },
//     "map":      { "lat": "lat", "lng": "lng" },
//     "views":    ["cards", "list", "map"] }
// `card.image` names a text field that holds a picture reference (`art:<kind>/<seed>`, drawn by the page, or `photo:<template>/<name>`, a picture the template
// ships); `card.company` names a text field that holds the name of a company (the client of a job): the card leads that line with the company's drawn mark; `card.chips` names up to six fields drawn as coloured chips (the choices and texts) and stats (the numbers); `map` names the two number fields that place an item (latitude, longitude) and is what
// the « map » view needs.
// The card and the flag point at fields by key: a key that is not one of the type's fields is refused here, not drawn wrong later. The check is
// pure and bounded: known keys only, every text and list has a limit, no code and no URL. A row of the base keeps only the key of its type and
// of its status.

// ── shared checks: the SAME text in the three business points (scripts/test-business-points.mjs fails when the copies drift) ──────────────────
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/
const LANGS = ['en', 'fr', 'es', 'ar']
const clean = (s) => { for (const ch of s) { const c = ch.charCodeAt(0); if (c < 32 || c === 127 || ch === '<' || ch === '>') return false } return true }
const only = (v, allowed, where, errors) => { for (const k of Object.keys(v)) if (allowed.indexOf(k) < 0) errors.push(where + ': unknown key "' + String(k).slice(0, 40) + '"') }
const idOf = (v, where, errors) => { if (typeof v !== 'string' || !ID.test(v)) { errors.push(where + ': lower-case letters, digits, "-" or "_", 1 to 40'); return null } return v }
const listOf = (v, where, min, max, errors) => { if (!Array.isArray(v) || v.length < min || v.length > max) { errors.push(where + ': a list of ' + (min > 0 ? min + ' to ' : 'at most ') + max); return [] } return v }
const noDuplicate = (keys, where, errors) => { const seen = new Set(); for (const k of keys) { if (k === null || k === undefined) continue; if (seen.has(k)) errors.push(where + ': "' + k + '" appears twice'); seen.add(k) } }
/** `{ en: "…", fr: "…" }`: `en` is required, the other languages are optional; every text is 1 to `max` characters, with no control character and no angle bracket. */
const labelOf = (v, where, errors, max = 60) => {
  if (!plain(v)) { errors.push(where + ': an object { en: text, fr?: text }'); return null }
  const out = {}
  for (const k of Object.keys(v)) {
    if (LANGS.indexOf(k) < 0) { errors.push(where + ': unknown language "' + String(k).slice(0, 12) + '"'); continue }
    if (typeof v[k] !== 'string' || v[k].trim().length < 1 || v[k].trim().length > max || !clean(v[k])) { errors.push(where + '.' + k + ': a text of 1 to ' + max + ' characters, no < >'); continue }
    out[k] = v[k].trim()
  }
  if (!Object.prototype.hasOwnProperty.call(v, 'en')) errors.push(where + '.en: required')
  return out
}
// ── end of the shared checks ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// ── shared checks for fields: the SAME text in the contacts and catalog points (scripts/test-business-points.mjs) ───────────────────────────
const FIELD_TYPES = ['text', 'number', 'money', 'date', 'choice', 'email', 'url']
const FIELD_KEY = /^[a-z][a-z0-9_]{0,31}$/
/** The fields a theme adds to a row: `{ key, type, label?, options? (choice), currency? (money) }`. `reserved` are the names the row already has. */
const fieldsOf = (v, where, max, reserved, errors) => {
  const out = []
  listOf(v, where, 0, max, errors).forEach((f, i) => {
    const at = where + '[' + i + ']'
    if (!plain(f)) { errors.push(at + ': an object'); return }
    only(f, ['key', 'type', 'label', 'options', 'currency'], at, errors)
    let key = null
    if (typeof f.key !== 'string' || !FIELD_KEY.test(f.key)) errors.push(at + '.key: lower-case letters, digits or "_", starting with a letter, 1 to 32')
    else if (reserved.indexOf(f.key) >= 0) errors.push(at + '.key: "' + f.key + '" is already a column of the row')
    else key = f.key
    const type = FIELD_TYPES.indexOf(f.type) >= 0 ? f.type : null
    if (type === null) errors.push(at + '.type: one of ' + FIELD_TYPES.join(', '))
    const field = { key, type }
    if (f.label !== undefined) field.label = labelOf(f.label, at + '.label', errors)
    if (type === 'choice') {
      const options = listOf(f.options, at + '.options', 1, 12, errors)
      field.options = options.map((o, j) => (typeof o === 'string' && o.trim().length >= 1 && o.trim().length <= 40 && clean(o) ? o.trim() : (errors.push(at + '.options[' + j + ']: a text of 1 to 40 characters, no < >'), null)))
      noDuplicate(field.options, at + '.options', errors)
    } else if (f.options !== undefined) errors.push(at + '.options: only a "choice" field has options')
    if (type === 'money' && f.currency !== undefined) { if (typeof f.currency === 'string' && /^[A-Z]{3}$/.test(f.currency)) field.currency = f.currency; else errors.push(at + '.currency: three capital letters, like EUR') }
    else if (f.currency !== undefined) errors.push(at + '.currency: only a "money" field has a currency')
    out.push(field)
  })
  noDuplicate(out.map((f) => f.key), where, errors)
  return out
}
// ── end of the shared checks for fields ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const OWNER = 'kybernos/catalog'
export const OWNER_VERSION = '1.0.0'
export const LIMITS = Object.freeze({ statuses: 12, fields: 20, files: 12 })
/** The names an item already has: a theme's own field cannot take them. */
export const RESERVED = Object.freeze(['id', 'type', 'title', 'subtitle', 'status', 'price_text', 'price_num', 'fields', 'demo', 'created_at', 'updated_at', 'archived_at'])
/** The pictures the page can draw for a type; a map and more arrive with a later minor version of the point. */
export const ICONS = Object.freeze(['package', 'home', 'briefcase', 'tag', 'wrench', 'book'])
export const TONES = Object.freeze(['ok', 'warn', 'bad', 'neutral'])
export const VIEWS = Object.freeze(['cards', 'list', 'map'])
/** A picture reference a field may hold: a drawn one, or one the template ships (the page checks it again before it draws). */
export const PICTURE = /^(?:art:[a-z-]{2,16}(?:\/[A-Za-z0-9._-]{0,40})?(?:@\d{1,3})?|photo:[a-z0-9][a-z0-9-]{1,39}\/[a-z0-9][a-z0-9-]{1,59})$/

const number = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12

/** What a card shows: `title` and `subtitle` are the item's own, the others name one of the type's fields. */
const cardOf = (v, fields, errors) => {
  if (v === undefined) return {}
  if (!plain(v)) { errors.push('card: an object'); return {} }
  only(v, ['title', 'subtitle', 'price', 'image', 'company', 'chips', 'flag'], 'card', errors)
  const keys = ['title', 'subtitle'].concat(fields.map((f) => f.key).filter((k) => k !== null))
  const out = {}
  for (const slot of ['title', 'subtitle', 'price']) {
    if (v[slot] === undefined) continue
    if (typeof v[slot] === 'string' && keys.indexOf(v[slot]) >= 0) out[slot] = v[slot]
    else errors.push('card.' + slot + ': "title", "subtitle" or the key of one of the fields')
  }
  if (v.image !== undefined) {
    const target = fields.find((x) => x.key === v.image)
    if (target === undefined || target.type !== 'text') errors.push('card.image: the key of a text field (it holds the picture reference)')
    else out.image = v.image
  }
  if (v.company !== undefined) {
    const target = fields.find((x) => x.key === v.company)
    if (target === undefined || target.type !== 'text') errors.push('card.company: the key of a text field (it holds the name of a company)')
    else out.company = v.company
  }
  if (v.chips !== undefined) {
    const chips = listOf(v.chips, 'card.chips', 1, 6, errors)
    const known = fields.map((f) => f.key)
    const kept = chips.filter((k, i) => (typeof k === 'string' && known.indexOf(k) >= 0 ? true : (errors.push('card.chips[' + i + ']: the key of one of the fields'), false)))
    noDuplicate(kept, 'card.chips', errors)
    out.chips = kept
  }
  if (v.flag !== undefined) {
    const f = v.flag
    if (!plain(f)) errors.push('card.flag: an object')
    else {
      only(f, ['field', 'lte', 'gte', 'label'], 'card.flag', errors)
      const target = fields.find((x) => x.key === f.field)
      if (target === undefined || ['number', 'money'].indexOf(target.type) < 0) errors.push('card.flag.field: the key of a number or money field')
      if (f.lte === undefined && f.gte === undefined) errors.push('card.flag: lte or gte is needed')
      for (const side of ['lte', 'gte']) if (f[side] !== undefined && !number(f[side])) errors.push('card.flag.' + side + ': a finite number')
      const flag = { field: f.field, label: labelOf(f.label, 'card.flag.label', errors, 80) }
      if (number(f.lte)) flag.lte = f.lte
      if (number(f.gte)) flag.gte = f.gte
      out.flag = flag
    }
  }
  return out
}

/** `{ ok: true, value }` (the type, defaults filled) or `{ ok: false, errors }`. Never throws. */
export function validateCatalogType (raw, fileId) {
  const errors = []
  if (!plain(raw)) return { ok: false, errors: ['a catalog type is a JSON object'] }
  only(raw, ['id', 'label', 'plural', 'icon', 'statuses', 'fields', 'card', 'map', 'views'], 'type', errors)
  const id = idOf(raw.id, 'id', errors)
  if (id !== null && typeof fileId === 'string' && fileId !== id) errors.push('id "' + id + '" must be the name of its file (' + fileId + '.json)')
  const label = labelOf(raw.label, 'label', errors)
  const plural = labelOf(raw.plural, 'plural', errors)
  let icon = 'package'
  if (raw.icon !== undefined) { if (ICONS.indexOf(raw.icon) >= 0) icon = raw.icon; else errors.push('icon: one of ' + ICONS.join(', ')) }
  const statuses = listOf(raw.statuses, 'statuses', 1, LIMITS.statuses, errors).map((s, i) => {
    const at = 'statuses[' + i + ']'
    if (!plain(s)) { errors.push(at + ': an object'); return null }
    only(s, ['key', 'tone', 'label'], at, errors)
    let tone = 'neutral'
    if (s.tone !== undefined) { if (TONES.indexOf(s.tone) >= 0) tone = s.tone; else errors.push(at + '.tone: one of ' + TONES.join(', ')) }
    return { key: idOf(s.key, at + '.key', errors), tone, label: labelOf(s.label, at + '.label', errors) }
  })
  noDuplicate(statuses.map((s) => (s === null ? null : s.key)), 'statuses', errors)
  const fields = fieldsOf(raw.fields === undefined ? [] : raw.fields, 'fields', LIMITS.fields, RESERVED, errors)
  const card = cardOf(raw.card, fields, errors)
  // where an item sits on the map: two number fields, by key
  let map = null
  if (raw.map !== undefined) {
    if (!plain(raw.map)) errors.push('map: an object { lat, lng }')
    else {
      only(raw.map, ['lat', 'lng'], 'map', errors)
      const sides = {}
      for (const side of ['lat', 'lng']) {
        const target = fields.find((x) => x.key === raw.map[side])
        if (target === undefined || target.type !== 'number') errors.push('map.' + side + ': the key of a number field')
        else sides[side] = target.key
      }
      if (sides.lat !== undefined && sides.lat === sides.lng) errors.push('map: lat and lng are two different fields')
      if (sides.lat !== undefined && sides.lng !== undefined) map = sides
    }
  }
  // the default views follow what the type can do: the map only exists for a type that says where its items are
  let views = map === null ? ['cards', 'list'] : ['cards', 'list', 'map']
  if (raw.views !== undefined) {
    views = listOf(raw.views, 'views', 1, VIEWS.length, errors).filter((v, i) => (VIEWS.indexOf(v) >= 0 ? true : (errors.push('views[' + i + ']: one of ' + VIEWS.join(', ')), false)))
    noDuplicate(views, 'views', errors)
    if (views.indexOf('map') >= 0 && map === null) errors.push('views: "map" needs a map: { lat, lng } naming two number fields')
  }
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 20) }
  const value = { id, label, plural, icon, statuses, fields, card, views }
  if (map !== null) value.map = map
  return { ok: true, value }
}

export const CATALOG_POINT_REF = OWNER + '#type'
/** What the registry is told (`registry.definePoint`): data, inert. */
export const CATALOG_POINT = Object.freeze({ owner: OWNER, ownerVersion: OWNER_VERSION, name: 'type', version: '1.0', kind: 'data', class: 'inert', validate: validateCatalogType, max: LIMITS.files })
