// kybernos/db#template — a ready database a template ships: its objects, fields, links and saved views, in the words of each language.
//
// A template (a trade's theme) ships `db/<id>.json` (data only, never code):
//   { "id": "real-estate",
//     "name":    { "en": "Real estate agency", "fr": "Agence immobilière" },
//     "objects": [{ "key": "property", "label": { "en": "Property", "fr": "Bien" }, "title": "name",
//                   "fields": [{ "key": "name", "type": "text", "label": { "en": "Name", "fr": "Nom" } },
//                              { "key": "status", "type": "choice", "label": {…}, "options": [{ "key": "sold", "label": {…}, "color": "gray" }] },
//                              { "key": "owner", "type": "relation", "to": "contact", "label": {…}, "inverse": { "en": "Properties" } }] }],
//     "views":   [{ "object": "property", "id": "by-status", "name": { "en": "By status" }, "kind": "board", "by": "status" }] }
// It is the same structure the Tables page and the agents build by hand (store/catalog.mjs, core/view.mjs), with every label a `{ en, fr? }` pair: the person's
// language is picked when the database is made (`resolveTemplate`), and a database keeps plain strings from then on.
//
// The sample rows a template carries live apart, in `demo/db-sample.json` (`validateSample`): the point stays inert data that an agent can read.
//   { "rows": { "contact": [{ "ref": "ana", "values": { "name": "Ana", "company": { "ref": "acme" }, "photo": [{ "photo": "real-estate/portrait-01" }] } }] } }
// `ref` names a row inside the sample so another row can link to it; `{ ref }` is a link, `{ photo }` a picture of the theme (the host reads the file).
//
// The check is pure and bounded: known keys only, every text and list has a limit, no code and no URL. The registry calls it with the file's name (without
// `.json`) as `fileId`; `scripts/plugin-check.mjs` calls it on a theme's folder before anything is installed.
import { isPlain, normalizeView } from './core/index.mjs'
import { normalizeObject } from './store/catalog.mjs'

export const OWNER = 'kybernos/db'
export const OWNER_VERSION = '0.1.0'
export const LIMITS = Object.freeze({ objects: 12, fields: 40, options: 24, views: 24, files: 4, rows: 600, rowsPerObject: 300 })
const LANGS = ['en', 'fr', 'es', 'ar']
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/
const REF = /^[a-z0-9][a-z0-9_-]{0,63}$/
const PHOTO = /^[a-z0-9][a-z0-9-]{0,39}\/[a-z0-9][a-z0-9_-]{0,63}$/
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/
const clean = (s) => { for (const ch of s) { const c = ch.charCodeAt(0); if (c < 32 || c === 127 || ch === '<' || ch === '>') return false } return true }

const onlyKeys = (v, allowed, where, errors) => { for (const k of Object.keys(v)) if (!allowed.includes(k)) errors.push(where + ': unknown key "' + String(k).slice(0, 40) + '"') }

/** `{ en, fr? … }`: `en` is required, the other languages optional; every text is 1 to `max` characters, no control character, no angle bracket. */
function checkPair (v, where, max, errors) {
  if (!isPlain(v)) { errors.push(where + ': an object { en: text, fr?: text }'); return false }
  let good = true
  for (const k of Object.keys(v)) {
    if (!LANGS.includes(k)) { errors.push(where + ': unknown language "' + String(k).slice(0, 12) + '"'); good = false; continue }
    if (typeof v[k] !== 'string' || v[k].trim().length < 1 || v[k].trim().length > max || !clean(v[k])) { errors.push(where + '.' + k + ': a text of 1 to ' + max + ' characters, no < >'); good = false }
  }
  if (!Object.prototype.hasOwnProperty.call(v, 'en')) { errors.push(where + '.en: required'); good = false }
  return good
}

/** The text of a pair in a language, English when that language is not there. */
export const pick = (pair, lang) => (isPlain(pair) && typeof pair[lang] === 'string' ? pair[lang].trim() : isPlain(pair) && typeof pair.en === 'string' ? pair.en.trim() : '')

/** The languages a template speaks: English and each other one that any of its labels carries. */
export function languagesOf (template) {
  const found = new Set(['en'])
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (isPlain(v)) {
      const ks = Object.keys(v)
      if (ks.length > 0 && ks.every((k) => LANGS.includes(k)) && typeof v[ks[0]] === 'string') ks.forEach((k) => found.add(k))
      else Object.values(v).forEach(walk)
    }
  }
  walk(template)
  return [...found]
}

/**
 * The template in one language, as the store wants it: `{ name, objects, views }` with plain-string labels, options and inverse names.
 * Pure; a pair that lacks `lang` gives its English text.
 */
export function resolveTemplate (template, lang) {
  const objects = template.objects.map((o) => ({
    key: o.key,
    label: pick(o.label, lang),
    ...(o.title !== undefined ? { title: o.title } : {}),
    fields: o.fields.map((f) => {
      const out = { ...f, label: pick(f.label, lang) }
      if (Array.isArray(f.options)) out.options = f.options.map((op) => ({ ...op, label: pick(op.label, lang) }))
      if (f.inverse !== undefined) out.inverse = pick(f.inverse, lang)
      return out
    }),
  }))
  const views = (template.views || []).map((v) => ({ ...v, name: pick(v.name, lang) }))
  return { name: pick(template.name, lang), objects, views }
}

/**
 * The template in one language as the store checks it: `{ name, objects, views, errors }` with `objects` normalized (defaults filled), `views` as given and
 * `errors` every problem found (`[ 'where: what' ]`): a field the store refuses, a link to an object the template lacks, a view the store refuses.
 */
export function buildStructure (template, lang) {
  const errors = []
  const { name, objects, views } = resolveTemplate(template, lang)
  const normal = []
  objects.forEach((raw, i) => {
    const r = normalizeObject(raw)
    if (!r.ok) { for (const e of r.errors) errors.push('objects[' + i + ']' + (e.path ? '.' + e.path : '') + ': ' + e.message); return }
    if (normal.some((x) => x.key === r.object.key)) { errors.push('objects[' + i + '].key: two objects share this key'); return }
    normal.push(r.object)
  })
  for (const o of normal) {
    for (const f of o.fields) {
      if (f.type === 'relation') {
        if (!normal.some((x) => x.key === f.to)) errors.push('object "' + o.key + '", field "' + f.key + '": links to "' + f.to + '", which is not an object of the template')
        if (f.required) errors.push('object "' + o.key + '", field "' + f.key + '": a link cannot be required in a template (a sample row is made before the row it points to)')
      }
    }
  }
  const seen = new Set()
  views.forEach((v, i) => {
    const at = 'views[' + i + ']'
    const { object: objectKey, ...view } = v
    const obj = normal.find((o) => o.key === objectKey)
    if (obj === undefined) { errors.push(at + '.object: not an object of the template'); return }
    if (seen.has(view.id)) errors.push(at + '.id: "' + view.id + '" appears twice')
    seen.add(view.id)
    const n = normalizeView(view, obj)
    if (!n.ok) for (const e of n.errors) errors.push(at + (e.path ? '.' + e.path : '') + ': ' + e.message)
  })
  return { name, objects: normal, views, errors }
}

/** `{ ok: true, value }` (a copy of the template) or `{ ok: false, errors }`. Never throws. */
export function validateTemplate (raw, fileId) {
  const errors = []
  if (!isPlain(raw)) return { ok: false, errors: ['a database template is a JSON object'] }
  onlyKeys(raw, ['id', 'name', 'objects', 'views'], 'template', errors)
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) errors.push('id: lower-case letters, digits, "-" or "_", 1 to 40')
  else if (typeof fileId === 'string' && fileId !== raw.id) errors.push('id "' + raw.id + '" must be the name of its file (' + fileId + '.json)')
  checkPair(raw.name, 'name', 80, errors)

  if (!Array.isArray(raw.objects) || raw.objects.length < 1 || raw.objects.length > LIMITS.objects) errors.push('objects: a list of 1 to ' + LIMITS.objects)
  else {
    raw.objects.forEach((o, i) => {
      const at = 'objects[' + i + ']'
      if (!isPlain(o)) { errors.push(at + ': an object'); return }
      onlyKeys(o, ['key', 'label', 'title', 'fields'], at, errors)
      checkPair(o.label, at + '.label', 80, errors)
      if (!Array.isArray(o.fields) || o.fields.length < 1 || o.fields.length > LIMITS.fields) { errors.push(at + '.fields: a list of 1 to ' + LIMITS.fields); return }
      o.fields.forEach((f, j) => {
        const fat = at + '.fields[' + j + ']'
        if (!isPlain(f)) { errors.push(fat + ': an object'); return }
        if (typeof f.key !== 'string' || !FIELD_KEY.test(f.key)) errors.push(fat + '.key: lower-case letters, digits or "_", starting with a letter')
        checkPair(f.label, fat + '.label', 80, errors)
        if (f.inverse !== undefined) checkPair(f.inverse, fat + '.inverse', 80, errors)
        if (f.options !== undefined) {
          if (!Array.isArray(f.options) || f.options.length < 1 || f.options.length > LIMITS.options) errors.push(fat + '.options: a list of 1 to ' + LIMITS.options)
          else f.options.forEach((op, k) => { if (!isPlain(op)) errors.push(fat + '.options[' + k + ']: an object'); else checkPair(op.label, fat + '.options[' + k + '].label', 60, errors) })
        }
      })
    })
  }
  if (raw.views !== undefined) {
    if (!Array.isArray(raw.views) || raw.views.length > LIMITS.views) errors.push('views: a list of at most ' + LIMITS.views)
    else raw.views.forEach((v, i) => { if (!isPlain(v)) errors.push('views[' + i + ']: an object'); else checkPair(v.name, 'views[' + i + '].name', 60, errors) })
  }
  // The pairs are sound (or reported): the structure itself is checked as the store checks it, in each language the template speaks.
  if (errors.length === 0) {
    for (const lang of languagesOf(raw)) {
      for (const e of buildStructure(raw, lang).errors) {
        const text = lang === 'en' ? e : '[' + lang + '] ' + e
        if (!errors.includes(text)) errors.push(text)
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 20) }
  return { ok: true, value: structuredClone(raw) }
}

/** `{ ref: "x" }`, the link to another sample row. */
export const isRefValue = (v) => isPlain(v) && Object.keys(v).length === 1 && typeof v.ref === 'string'
/** `{ photo: "<theme dir>/<name>" }`, a picture the host reads from the theme's `demo/photos`. */
export const isPhotoValue = (v) => isPlain(v) && Object.keys(v).length === 1 && typeof v.photo === 'string'

/**
 * The sample rows of a template, checked against its structure (the values themselves are checked by the store when the rows are made):
 * `{ ok: true, value: sample }` or `{ ok: false, errors }`. `rows` maps an object key to its rows `{ ref?, values }`.
 */
export function validateSample (sample, template) {
  const errors = []
  if (!isPlain(sample)) return { ok: false, errors: ['a sample is a JSON object'] }
  onlyKeys(sample, ['rows'], 'sample', errors)
  if (!isPlain(sample.rows)) return { ok: false, errors: [...errors, 'rows: an object that maps an object key to its rows'] }
  const objects = Array.isArray(template && template.objects) ? template.objects : []
  const refs = {}
  let total = 0
  for (const [key, list] of Object.entries(sample.rows)) {
    const obj = objects.find((o) => o.key === key)
    if (obj === undefined) { errors.push('rows.' + key + ': not an object of the template'); continue }
    if (!Array.isArray(list) || list.length > LIMITS.rowsPerObject) { errors.push('rows.' + key + ': a list of at most ' + LIMITS.rowsPerObject); continue }
    total += list.length
    refs[key] = new Set()
    list.forEach((row, i) => {
      const at = 'rows.' + key + '[' + i + ']'
      if (!isPlain(row)) { errors.push(at + ': an object { ref?, values }'); return }
      onlyKeys(row, ['ref', 'values'], at, errors)
      if (row.ref !== undefined) {
        if (typeof row.ref !== 'string' || !REF.test(row.ref)) errors.push(at + '.ref: lower-case letters, digits, "-" or "_"')
        else if (refs[key].has(row.ref)) errors.push(at + '.ref: "' + row.ref + '" appears twice')
        else refs[key].add(row.ref)
      }
      if (!isPlain(row.values)) { errors.push(at + '.values: an object of field values'); return }
      for (const [fk, v] of Object.entries(row.values)) {
        const f = obj.fields.find((x) => x.key === fk)
        if (f === undefined) { errors.push(at + '.values.' + fk + ': no such field'); continue }
        const isLink = f.type === 'relation'
        const isFile = f.type === 'attachment'
        const parts = Array.isArray(v) ? v : [v]
        for (const p of parts) {
          if (isRefValue(p) && !isLink) errors.push(at + '.values.' + fk + ': a { ref } goes in a link field')
          if (isPhotoValue(p)) {
            if (!isFile) errors.push(at + '.values.' + fk + ': a { photo } goes in an attachment field')
            else if (!PHOTO.test(p.photo)) errors.push(at + '.values.' + fk + ': a photo is "<theme folder>/<name>"')
          }
        }
        if (isFile && v !== null && !(Array.isArray(v) && v.every(isPhotoValue))) errors.push(at + '.values.' + fk + ': an attachment holds a list of { photo }')
      }
    })
  }
  if (total > LIMITS.rows) errors.push('rows: at most ' + LIMITS.rows + ' rows in all')
  // every link names a row of its target object
  if (errors.length === 0) {
    for (const [key, list] of Object.entries(sample.rows)) {
      const obj = objects.find((o) => o.key === key)
      list.forEach((row, i) => {
        for (const f of obj.fields) {
          if (f.type !== 'relation' || row.values[f.key] === undefined || row.values[f.key] === null) continue
          for (const p of Array.isArray(row.values[f.key]) ? row.values[f.key] : [row.values[f.key]]) {
            if (!isRefValue(p)) errors.push('rows.' + key + '[' + i + '].values.' + f.key + ': a link is { ref }')
            else if (!(refs[f.to] && refs[f.to].has(p.ref))) errors.push('rows.' + key + '[' + i + '].values.' + f.key + ': no "' + p.ref + '" among the ' + f.to + ' rows')
          }
        }
      })
    }
  }
  return errors.length > 0 ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, value: sample }
}

export const TEMPLATE_POINT_REF = OWNER + '#template'
/** What the registry is told (`registry.definePoint`): data, inert (nothing in it is an instruction an agent follows). */
export const DB_TEMPLATE_POINT = Object.freeze({ owner: OWNER, ownerVersion: OWNER_VERSION, name: 'template', version: '1.0', kind: 'data', class: 'inert', validate: validateTemplate, max: LIMITS.files })
