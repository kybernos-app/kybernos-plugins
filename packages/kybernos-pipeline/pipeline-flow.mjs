// kybernos/pipeline#flow — what a theme tells the Pipeline plugin about a board: its stages, its value, what a card may point at.
//
// A theme ships `pipeline/<id>.json` (data only, never code), one file per board:
//   { "id": "orders", "label": { "en": "Orders" }, "newLabel": { "en": "New order" },
//     "stages": [{ "key": "new", "label": { "en": "New" } }, { "key": "paid", "label": { "en": "Paid" } }, { "key": "shipped", "label": { "en": "Shipped" } }],
//     "value": { "format": "money", "currency": "EUR" },
//     "links": { "contact": true, "item": true } }
// A card keeps only the keys of its flow and its stage in the base; the labels, the order of the columns and the value format come from here.
// The check is pure and bounded: known keys only, every text and list has a limit, no code and no URL.

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

export const OWNER = 'kybernos/pipeline'
export const OWNER_VERSION = '1.0.0'
export const LIMITS = Object.freeze({ stages: 8, files: 12 })
export const FORMATS = Object.freeze(['money', 'number'])

/** `{ ok: true, value }` (the flow, defaults filled) or `{ ok: false, errors }`. Never throws. */
export function validatePipelineFlow (raw, fileId) {
  const errors = []
  if (!plain(raw)) return { ok: false, errors: ['a pipeline flow is a JSON object'] }
  only(raw, ['id', 'label', 'newLabel', 'stages', 'value', 'links'], 'flow', errors)
  const id = idOf(raw.id, 'id', errors)
  if (id !== null && typeof fileId === 'string' && fileId !== id) errors.push('id "' + id + '" must be the name of its file (' + fileId + '.json)')
  const label = labelOf(raw.label, 'label', errors)
  const newLabel = raw.newLabel === undefined ? null : labelOf(raw.newLabel, 'newLabel', errors, 40)
  const stages = listOf(raw.stages, 'stages', 2, LIMITS.stages, errors).map((s, i) => {
    const at = 'stages[' + i + ']'
    if (!plain(s)) { errors.push(at + ': an object'); return null }
    only(s, ['key', 'label'], at, errors)
    return { key: idOf(s.key, at + '.key', errors), label: labelOf(s.label, at + '.label', errors, 40) }
  })
  noDuplicate(stages.map((s) => (s === null ? null : s.key)), 'stages', errors)
  let value = null
  if (raw.value !== undefined) {
    if (!plain(raw.value)) errors.push('value: an object')
    else {
      only(raw.value, ['format', 'currency'], 'value', errors)
      if (FORMATS.indexOf(raw.value.format) < 0) errors.push('value.format: one of ' + FORMATS.join(', '))
      else {
        value = { format: raw.value.format }
        if (raw.value.currency !== undefined) {
          if (raw.value.format === 'money' && typeof raw.value.currency === 'string' && /^[A-Z]{3}$/.test(raw.value.currency)) value.currency = raw.value.currency
          else errors.push('value.currency: three capital letters, and only for the "money" format')
        }
      }
    }
  }
  const links = { contact: false, item: false }
  if (raw.links !== undefined) {
    if (!plain(raw.links)) errors.push('links: an object')
    else {
      only(raw.links, ['contact', 'item'], 'links', errors)
      for (const k of ['contact', 'item']) {
        if (raw.links[k] === undefined) continue
        if (typeof raw.links[k] === 'boolean') links[k] = raw.links[k]
        else errors.push('links.' + k + ': true or false')
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 20) }
  return { ok: true, value: { id, label, newLabel, stages, value, links } }
}

export const PIPELINE_POINT_REF = OWNER + '#flow'
/** What the registry is told (`registry.definePoint`): data, inert. */
export const PIPELINE_POINT = Object.freeze({ owner: OWNER, ownerVersion: OWNER_VERSION, name: 'flow', version: '1.0', kind: 'data', class: 'inert', validate: validatePipelineFlow, max: LIMITS.files })
