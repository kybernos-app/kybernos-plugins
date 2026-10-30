// Makes a database from a template (template.mjs): the objects, the saved views and, when the template carries them, the sample rows with their pictures.
//
// It runs on the host, through the service (agent/service.mjs), and writes with the same store calls the tools use, so every rule of a database holds: a value is
// checked, a link needs its row, a picture is a blob next to the db. The rows are written by `template`, so the journal says where they came from.
//
// Once per template: `<dbs folder>/../templates.json` remembers which db a template made, and a second install answers `skipped` without touching anything. A
// database that fails half way is removed, so a retry starts from nothing.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isPlain, normalizeValue } from './core/index.mjs'
import { buildStructure, isPhotoValue, isRefValue, languagesOf, validateSample, validateTemplate } from './template.mjs'

export const MARKER_FILE = 'templates.json'
export const ACTOR = 'template'
const JPEG = { type: 'image/jpeg', ext: '.jpg' }

/** `{ <template id>: <db id> }`, empty when the file is missing or unreadable. */
export function readMarkers (file) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return isPlain(v) ? v : {}
  } catch (e) { return {} }
}
/** Writes the file whole or not at all (a temporary file, then a rename). */
function writeMarkers (file, markers) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = file + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(markers, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, file)
}

const failure = (error, detail, errors) => ({ ok: false, error, ...(detail !== undefined ? { detail } : {}), ...(errors !== undefined ? { errors } : {}) })
const listOf = (v) => (Array.isArray(v) ? v : [v])

/** What a sample row would be refused for before anything is written: a value its field does not accept, a required field with no value. `[ 'where: what' ]`. */
function rowErrors (objects, sample) {
  const errors = []
  for (const [key, rows] of Object.entries(sample.rows)) {
    const obj = objects.find((o) => o.key === key)
    rows.forEach((row, i) => {
      const at = 'rows.' + key + '[' + i + ']'
      for (const f of obj.fields) {
        const v = row.values[f.key]
        if (f.required && f.type !== 'checkbox' && (v === undefined || v === null)) { errors.push(at + '.values.' + f.key + ': required'); continue }
        if (v === undefined || f.type === 'relation' || f.type === 'attachment') continue
        const r = normalizeValue(f, v)
        if (!r.ok) errors.push(at + '.values.' + f.key + ': ' + r.message)
      }
    })
  }
  return errors.slice(0, 20)
}

/**
 * Installs a template. `{ service, template, sample?, lang?, photo?, by?, markerFile? }`:
 *   service  the dbs of the host (`create`, `byId`, `discard`, `dir`)
 *   lang     the person's language; English when the template does not speak it
 *   photo    `(spec) => Uint8Array | null`, the bytes of `<theme folder>/<name>` (null: the picture is left out)
 * Answers `{ ok: true, db, name, lang, counts: { objects, views, rows, photos } }`, or `{ ok: true, skipped: true, db }` when the template is already installed,
 * or `{ ok: false, error: 'template' | 'sample' | 'rows' | 'failed', errors? | detail? }`.
 */
export function installTemplate (o) {
  const service = o.service
  const by = typeof o.by === 'string' && o.by !== '' ? o.by : ACTOR
  const t = validateTemplate(o.template, isPlain(o.template) ? o.template.id : undefined)
  if (!t.ok) return failure('template', undefined, t.errors)
  const template = t.value
  const s = o.sample === undefined || o.sample === null ? { ok: true, value: { rows: {} } } : validateSample(o.sample, template)
  if (!s.ok) return failure('sample', undefined, s.errors)
  const sample = s.value
  const lang = languagesOf(template).includes(o.lang) ? o.lang : 'en'
  const markerFile = typeof o.markerFile === 'string' && o.markerFile !== '' ? o.markerFile : join(dirname(service.dir), MARKER_FILE)

  const markers = readMarkers(markerFile)
  if (typeof markers[template.id] === 'string') {
    const there = service.byId(markers[template.id])
    if (there.ok) return { ok: true, skipped: true, db: markers[template.id] }
  }

  const built = buildStructure(template, lang)
  const bad = rowErrors(built.objects, sample)
  if (bad.length > 0) return failure('rows', undefined, bad)

  const made = service.create({ name: built.name, by, objects: built.objects })
  if (!made.ok) return failure('failed', made.message || made.code)
  const db = made.db
  const dbId = db.info().id
  try {
    for (const v of built.views) {
      const { object: objectKey, ...view } = v
      const r = db.saveView(objectKey, view, by)
      if (!r.ok) throw new Error('view ' + view.id + ': ' + r.message)
    }

    const photos = new Map()
    const fileOf = (spec, field) => {
      const key = spec + '|' + field.maxBytes
      if (photos.has(key)) return photos.get(key)
      const bytes = typeof o.photo === 'function' ? o.photo(spec) : null
      let file = null
      if (bytes instanceof Uint8Array) {
        const r = db.attach(bytes, { name: spec.split('/').pop() + JPEG.ext, type: JPEG.type }, field.maxBytes)
        if (!r.ok) throw new Error('picture ' + spec + ': ' + r.message)
        file = r.file
      }
      photos.set(key, file)
      return file
    }

    const ids = new Map() // "<object>/<ref>" → record id
    const later = [] // links whose row was not there yet when their row was made
    let rows = 0
    let attached = 0
    for (const obj of built.objects) {
      const list = sample.rows[obj.key] || []
      for (const row of list) {
        const values = {}
        const pending = {}
        for (const f of obj.fields) {
          const v = row.values[f.key]
          if (v === undefined || v === null) continue
          if (f.type === 'relation') {
            const targets = listOf(v).filter(isRefValue)
            const found = targets.map((x) => ids.get(f.to + '/' + x.ref))
            if (found.every((x) => x !== undefined)) values[f.key] = f.many ? found : found[0]
            else pending[f.key] = targets.map((x) => f.to + '/' + x.ref)
          } else if (f.type === 'attachment') {
            const files = listOf(v).filter(isPhotoValue).map((x) => fileOf(x.photo, f)).filter((x) => x !== null)
            attached += files.length
            if (files.length > 0) values[f.key] = files
          } else values[f.key] = v
        }
        const r = db.create(obj.key, values, by)
        if (!r.ok) throw new Error('row ' + obj.key + (row.ref ? '/' + row.ref : '') + ': ' + (r.message || r.code))
        rows += 1
        if (row.ref !== undefined) ids.set(obj.key + '/' + row.ref, r.record.id)
        if (Object.keys(pending).length > 0) later.push({ obj, id: r.record.id, pending })
      }
    }
    for (const item of later) {
      const changes = {}
      for (const f of item.obj.fields) {
        if (item.pending[f.key] === undefined) continue
        const found = item.pending[f.key].map((k) => ids.get(k))
        if (found.some((x) => x === undefined)) throw new Error('link ' + item.obj.key + '.' + f.key + ': a row it points to was not made')
        changes[f.key] = f.many ? found : found[0]
      }
      const r = db.update(item.obj.key, item.id, changes, by)
      if (!r.ok) throw new Error('link ' + item.obj.key + ': ' + (r.message || r.code))
    }

    writeMarkers(markerFile, { ...readMarkers(markerFile), [template.id]: dbId })
    return { ok: true, db: dbId, name: built.name, lang, counts: { objects: built.objects.length, views: built.views.length, rows, photos: attached } }
  } catch (e) {
    try { service.discard(dbId) } catch (e2) { /* the half-made db stays where it is */ }
    return failure('failed', String((e && e.message) || e).slice(0, 300))
  }
}
