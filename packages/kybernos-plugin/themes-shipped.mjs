// The themes the product ships: one folder per theme under `themes/<dir>/` (data only, docs/dev/shipped-themes.md). This file reads them for the
// Themes page: what a card and a theme page show (name, line, colour, words of the menu, what the theme needs and adds) and where the folder is,
// so the page can ask for one by its id and never sends a path.
//
// Pure over node:fs, bounded (every file is small, every list has a limit) and never throwing: a folder that cannot be read is left out, with its
// reason, and the other themes are still listed. The reading is the same data the installer's plan reads later; here it is only a summary.
import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

/** How many themes are listed, and how large one file may be. */
export const SHIPPED_MAX = 12
export const FILE_MAX = 128 * 1024
/** How many names of a kind the page lists as tags. */
export const LIST_MAX = 12
/** A cover picture: `cover.jpg` in the theme's folder, at most this big (a card's picture, not a gallery). */
export const COVER_MAX = 160 * 1024
/** The sample rows of a theme (`demo/sample.json`, the argument of the base's `seed`) are read whole and never larger than this. */
export const SAMPLE_MAX = 512 * 1024
/** The « next trades » shown as « soon » cards: `_next/next.json` and one `_next/<id>.jpg` each. */
export const NEXT_MAX = 12
/** The plugin ids a business theme names in `requires.plugins`, in the order a page shows them. */
export const BUSINESS_PLUGINS = Object.freeze(['kybernos/contacts', 'kybernos/catalog', 'kybernos/pipeline'])

const ID = /^[a-z][a-z0-9-]{1,31}\/[a-z][a-z0-9-]{1,39}$/
const DIR = /^[a-z][a-z0-9-]{1,39}$/
const ACCENT = /^#[0-9a-fA-F]{6}$/
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v, max) => (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v : null)

/** `{ en, fr }` kept as given when each is a short text; `fr` falls back to `en`. `null` for anything else. */
const pair = (v, max = 200) => {
  if (typeof v === 'string') return text(v, max) === null ? null : { en: v, fr: v }
  if (!plain(v)) return null
  const en = text(v.en, max)
  if (en === null) return null
  const fr = text(v.fr, max)
  return { en, fr: fr === null ? en : fr }
}

const readJson = (file) => {
  try {
    if (statSync(file).size > FILE_MAX) return null
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return plain(v) ? v : null
  } catch (e) { return null }
}
/** Whether a cover picture is there, a plain file of a sane size (the route re-checks when it serves it). */
const hasCover = (file) => { try { const st = statSync(file); return st.isFile() && st.size > 0 && st.size <= COVER_MAX } catch (e) { return false } }
/** The sample rows a theme carries: the parsed `demo/sample.json` (a plain object), or `null` (none, too large, unreadable). The base checks every row. */
export const readSample = (folder) => {
  try {
    const file = join(folder, 'demo', 'sample.json')
    if (statSync(file).size > SAMPLE_MAX) return null
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return plain(v) ? v : null
  } catch (e) { return null }
}
const names = (dir, test) => { try { return readdirSync(dir).filter((f) => test(f) && !f.startsWith('.')).sort() } catch (e) { return [] } }
const jsonNames = (dir) => names(dir, (f) => f.endsWith('.json'))

/**
 * One theme folder as the page needs it, or `{ ok: false, dir, reason }`.
 * `{ ok: true, theme }`: `{ id, dir, version, name, description, accent, icon, field, tagline, words, style, needs, adds }`
 *   words  { contacts, catalog, pipeline }: the pack's `menu.labels` for the rows of the Business group, `{ en, fr }` each (or absent)
 *   style  { id, name, accent } of the first `themes/*.json`
 *   needs  the ids of `requires.plugins` that are not the core's own seams, in the order of `BUSINESS_PLUGINS` first
 *   sample { contacts, items, cards, notes }: how many sample rows `demo/sample.json` holds, or `null` when the theme carries none
 *   tag    the first of the manifest's `keywords` (they are lower case), with a capital: the chip over the cover; `cover` whether `cover.jpg` is there
 *   why    { <plugin id>: { en, fr } } from `why.json`: one line per needed plugin, in this theme's words
 *   adds   { skills, teams, automations, connectors } counts; `lists` their names (at most LIST_MAX each); `points` the business points the theme extends, with how many files each has
 */
export function readTheme (root, dir) {
  if (typeof dir !== 'string' || !DIR.test(dir)) return { ok: false, dir: String(dir), reason: 'the folder name is not an id' }
  return readThemeAt(join(root, dir), dir)
}

/** The same reading for a folder wherever it is, whatever it is called (a template the person points at, not one the product ships). */
function readThemeAt (folder, dir) {
  const manifest = readJson(join(folder, 'plugin.json'))
  if (manifest === null) return { ok: false, dir, reason: 'no readable plugin.json' }
  if (typeof manifest.id !== 'string' || !ID.test(manifest.id)) return { ok: false, dir, reason: 'plugin.json holds no author/name id' }
  if (manifest.kind === 'code') return { ok: false, dir, reason: 'a shipped theme is data, not code' }
  const name = pair(manifest.name, 80)
  if (name === null) return { ok: false, dir, reason: 'plugin.json holds no name' }
  const pack = jsonNames(join(folder, 'domains')).map((f) => readJson(join(folder, 'domains', f))).find((p) => p !== null) || null
  const style = jsonNames(join(folder, 'themes')).map((f) => readJson(join(folder, 'themes', f))).find((p) => p !== null) || null
  const accent = pack !== null && typeof pack.accent === 'string' && ACCENT.test(pack.accent) ? pack.accent : (style !== null && plain(style.settings) && typeof style.settings.acc === 'string' && ACCENT.test(style.settings.acc) ? style.settings.acc : null)
  const labels = pack !== null && plain(pack.menu) && plain(pack.menu.labels) ? pack.menu.labels : {}
  const words = {}
  for (const row of ['contacts', 'catalog', 'pipeline']) { const w = pair(labels[row], 40); if (w !== null) words[row] = w }
  const requires = plain(manifest.requires) && plain(manifest.requires.plugins) ? Object.keys(manifest.requires.plugins) : []
  const needs = BUSINESS_PLUGINS.filter((id) => requires.indexOf(id) >= 0).concat(requires.filter((id) => BUSINESS_PLUGINS.indexOf(id) < 0 && !/^kybernos\/(core|theme|skills)$/.test(id)).sort())
  const connectors = new Set()
  if (pack !== null && Array.isArray(pack.goals)) for (const g of pack.goals) if (plain(g) && Array.isArray(g.connectors)) for (const c of g.connectors) if (typeof c === 'string') connectors.add(c)
  const skillNames = names(join(folder, 'skills'), (f) => f !== 'README.md')
  const stem = (f) => f.replace(/\.json$/, '')
  const teamIds = jsonNames(join(folder, 'teams')).map(stem)
  const autoIds = jsonNames(join(folder, 'automations')).map(stem)
  const kw = Array.isArray(manifest.keywords) ? manifest.keywords.find((k) => text(k, 24) !== null) ?? null : null
  const tag = kw === null ? null : kw.charAt(0).toUpperCase() + kw.slice(1)
  const whyFile = readJson(join(folder, 'why.json'))
  const why = {}
  if (whyFile !== null) for (const id of needs) { const w = pair(whyFile[id], 160); if (w !== null) why[id] = w }
  const smp = readSample(folder)
  const many = (k) => (smp !== null && Array.isArray(smp[k]) ? smp[k].length : 0)
  const points = {}
  for (const [key, sub] of [['contacts', 'contacts'], ['catalog', 'catalog'], ['pipeline', 'pipeline']]) { const n = jsonNames(join(folder, sub)).length; if (n > 0) points[key] = n }
  return {
    ok: true,
    folder,
    theme: {
      id: manifest.id,
      dir,
      version: text(manifest.version, 40),
      name,
      description: pair(manifest.description, 300),
      accent,
      sample: smp === null ? null : { contacts: many('contacts'), items: many('items'), cards: many('cards'), notes: many('notes') },
      tag,
      cover: hasCover(join(folder, 'cover.jpg')),
      why,
      icon: pack !== null && typeof pack.icon === 'string' ? pack.icon : null,
      field: pack !== null ? pair(pack.name, 80) : null,
      tagline: pack !== null ? pair(pack.tagline, 200) : null,
      words,
      style: style === null ? null : { id: text(style.id, 64), name: pair(style.name, 80), accent: plain(style.settings) && typeof style.settings.acc === 'string' && ACCENT.test(style.settings.acc) ? style.settings.acc : null },
      needs,
      points,
      // what the theme adds, named: the page lists them as tags (at most LIST_MAX each); the counts are the real ones
      adds: {
        skills: skillNames.length,
        teams: teamIds.length,
        automations: autoIds.length,
        connectors: connectors.size,
      },
      lists: {
        skills: skillNames.slice(0, LIST_MAX),
        teams: teamIds.slice(0, LIST_MAX),
        automations: autoIds.slice(0, LIST_MAX),
        connectors: [...connectors].sort().slice(0, LIST_MAX),
      },
    },
  }
}

/**
 * What a folder holds, for the page to show before anything is installed: the theme as `publicView` gives it, or `null` when the folder is not
 * shaped like a data theme. Reads files only; the caller has already checked the path.
 */
export function previewFolder (folder) {
  if (typeof folder !== 'string' || folder === '') return null
  const r = readThemeAt(folder, basename(folder))
  return r.ok === true ? publicView([Object.assign({}, r.theme, { folder })])[0] : null
}

/**
 * Every theme under `root`: `{ themes: [{ …theme, folder }], skipped: [{ dir, reason }] }`. `folder` is for the host only (`publicView` strips it).
 * A missing `root` is an empty list, not an error: a checkout without shipped themes still starts.
 */
export function readShipped (root) {
  const themes = []
  const skipped = []
  let dirs = []
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_')).map((e) => e.name).sort() } catch (e) { dirs = [] }
  for (const dir of dirs.slice(0, SHIPPED_MAX)) {
    const r = readTheme(root, dir)
    if (r.ok === true) themes.push(Object.assign({}, r.theme, { folder: r.folder }))
    else skipped.push({ dir: r.dir, reason: r.reason })
  }
  return { themes, skipped }
}

/** What the page receives: the same themes, without the folder on this computer. */
export const publicView = (themes) => (Array.isArray(themes) ? themes : []).map((t) => { const { folder, ...rest } = t; return rest })

/**
 * The « next trades » of the gallery: `_next/next.json` = `[{ id, name: { en, fr } }]`, each with an optional `_next/<id>.jpg`. Never throws.
 * `[{ id, name, cover }]`, at most NEXT_MAX; an entry with a bad id or no name is left out.
 */
export function readNext (root) {
  const out = []
  let list = null
  try { list = JSON.parse(readFileSync(join(root, '_next', 'next.json'), 'utf8')) } catch (e) { list = null }
  if (!Array.isArray(list)) return out
  for (const x of list) {
    if (!plain(x) || typeof x.id !== 'string' || !DIR.test(x.id)) continue
    const name = pair(x.name, 60)
    if (name === null || out.some((o) => o.id === x.id)) continue
    out.push({ id: x.id, name, cover: hasCover(join(root, '_next', x.id + '.jpg')) })
    if (out.length >= NEXT_MAX) break
  }
  return out
}

/**
 * The picture file for a cover request, or `null`: `{ id }` is a shipped theme's plugin id, `{ next }` an id of `_next/next.json`. The page names an id,
 * never a path; a file that is not a plain JPEG of a sane size is not served.
 */
/** The most a sample picture (a photograph or a portrait) may weigh and still be served (the guard keeps the tracked ones under 220 KB, at most 1280 px wide). */
export const PHOTO_MAX = 240 * 1024
/**
 * The file of a sample picture, `<theme dir>/<name>` as a row of the sample writes it (`photo:real-estate/willow-lane`, `photo:real-estate/portrait-01`), or `null`. Only a plain JPEG of a
 * shipped theme, at `<dir>/demo/photos/<name>.jpg`: the page never names a path, a link or a folder above.
 */
export function photoFile (root, ref) {
  try {
    const m = typeof ref === 'string' ? /^([a-z][a-z0-9-]{1,39})\/([a-z0-9][a-z0-9-]{1,59})$/.exec(ref) : null
    if (m === null) return null
    if (!statSync(join(root, m[1], 'plugin.json')).isFile()) return null
    const file = join(root, m[1], 'demo', 'photos', m[2] + '.jpg')
    const st = lstatSync(file)
    if (!st.isFile() || st.isSymbolicLink() || st.size < 1 || st.size > PHOTO_MAX) return null
    const head = readFileSync(file).subarray(0, 3)
    return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff ? file : null
  } catch (e) { return null }
}

export function coverFile (root, query) {
  try {
    const q = plain(query) ? query : {}
    let file = null
    if (typeof q.next === 'string' && DIR.test(q.next)) {
      if (readNext(root).some((n) => n.id === q.next && n.cover === true)) file = join(root, '_next', q.next + '.jpg')
    } else if (typeof q.id === 'string' && ID.test(q.id)) {
      const t = readShipped(root).themes.find((x) => x.id === q.id && x.cover === true)
      if (t !== undefined) file = join(t.folder, 'cover.jpg')
    }
    if (file === null || !hasCover(file)) return null
    const head = readFileSync(file).subarray(0, 3)
    return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff ? file : null
  } catch (e) { return null }
}
