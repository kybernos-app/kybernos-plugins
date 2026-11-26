// The texts of the core's pages, one JSON file per language: ./i18n/fr.json and ./i18n/en.json, each a flat { "key": "text" }.
// client.js used to carry them as a 2,330-line table (`KB_T`); it now asks this route once, while its factory starts (see `kbDictLoad`).
//
// Pure functions, no DSH: the route in index.js only wires them to the web server, and a test drives them alone (test-i18n-files.mjs).
//
// A file that is missing, unreadable or not a flat map of strings is LEFT OUT of the answer, never turned into an error: the page then shows the
// other language for its keys instead of nothing, and DSH goes on (AGENTS rule 2).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The languages that have a file. `fr` is the Kybernos locale the page calls « kybernos ». Nothing else is read: the id is never a path. */
export const I18N_LANGS = Object.freeze(['fr', 'en'])

/** The map of one language, or null when its file is missing, unreadable or not an object. A value that is not a string is dropped. */
export const readI18nLanguage = (dir, id) => {
  if (I18N_LANGS.indexOf(id) < 0) return null
  let parsed
  try { parsed = JSON.parse(readFileSync(join(dir, id + '.json'), 'utf8')) } catch (e) { return null }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) === true) return null
  const out = Object.create(null)
  for (const key of Object.keys(parsed)) if (typeof parsed[key] === 'string') out[key] = parsed[key]
  return out
}

/** The ids asked for in `?lang=fr,en`: known ones only, each once, in the order asked; nothing asked (or nothing known) means all of them. */
export const wantedI18nLanguages = (raw) => {
  const asked = typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter((s) => I18N_LANGS.indexOf(s) >= 0) : []
  const unique = asked.filter((id, i) => asked.indexOf(id) === i)
  return unique.length > 0 ? unique : I18N_LANGS.slice()
}

/**
 * The answer to GET /kybernos/i18n?lang=fr,en : { status, headers, body }.
 *   200 { ok: true, langs: { fr: {…}, en: {…} }, missing: [ids that could not be read] }, with an ETag; 304 when the caller already has it.
 * `no-cache` (not `no-store`): the browser keeps a copy but asks again each time, so an edited file is seen at the next boot and an unchanged one costs a 304.
 */
export const i18nAnswer = (dir, rawLang, ifNoneMatch) => {
  const langs = Object.create(null)
  const missing = []
  for (const id of wantedI18nLanguages(rawLang)) {
    const map = readI18nLanguage(dir, id)
    if (map === null) missing.push(id)
    else langs[id] = map
  }
  const body = JSON.stringify({ ok: Object.keys(langs).length > 0, langs, missing })
  const etag = '"' + createHash('sha1').update(body).digest('hex').slice(0, 20) + '"'
  const headers = { 'cache-control': 'no-cache', etag, 'x-content-type-options': 'nosniff' }
  if (typeof ifNoneMatch === 'string' && ifNoneMatch === etag) return { status: 304, headers, body: '' }
  return { status: 200, headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(body)) }, body }
}
