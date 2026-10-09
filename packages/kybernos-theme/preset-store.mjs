// On-disk copy of the user's theme library ("My themes" in Settings > Theme > Sharing).
//
//   <dsh home>/kybernos/theme-presets.json     { v, updatedAt, presets: [ preset, ... ] }
//
// The browser keeps its own copy (first paint must stay synchronous); this file is the copy
// that survives clearing site data, another browser, or DSH Desktop picking another port.
// The library is ONE document: the newer `updatedAt` wins as a whole, so a deletion on one
// side cannot come back from the other.
//
// A preset is DATA: a name and a bag of known settings (colours, font, corners...). Nothing
// in here is ever executed, and nothing here fetches anything. What crosses this boundary is
// still untrusted (an imported file, a hand-edited JSON), so a preset is checked on the way in
// AND on the way out: known keys only, plain values, bounded sizes. The browser re-checks the
// values against its own tables (fonts, wallpapers) before applying anything: this module
// cannot know them without duplicating them, so it checks the shape and leaves the meaning to
// the browser.
//
// Pure node:fs, no DSH service: unit-testable on a temp folder (see test-preset-store.mjs).
// `dir` is the `<dsh home>/kybernos` folder. A damaged file is set aside (`.bad-<time>`) and
// counts as absent, so it can never become a 5xx; every write is tmp + rename.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const LIB_VERSION = 1
export const FILE_NAME = 'theme-presets.json'
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
export const SOURCES = ['me', 'file', 'gallery']
export const LIMITS = {
  presets: 100,
  name: 40,
  author: 60,
  string: 40, // an id or a hex colour inside a preset's settings
  keys: 48, // settings keys in one preset
  ov: 40, // colour overrides in one preset
  fileBytes: 512 * 1024,
}
export const MAX_BODY_BYTES = 640 * 1024
/**
 * The settings a preset may carry. Mirrors PRESET_GROUPS in client.js (test-preset-store.mjs
 * fails when the two lists drift): colours always, then font, corners, glass and wallpaper,
 * accessibility.
 */
export const SETTINGS_KEYS = Object.freeze([
  'mode', 'acc', 'ov',
  'fontText', 'ligatures',
  'radius',
  'wp', 'wpVis', 'wpBlur', 'tint', 'glassEffect', 'glassBlur', 'sidebarLinked', 'sidebarOpacity', 'fieldOpacity', 'floatOpacity',
  'bgBrightness', 'bgContrast', 'bgSaturation', 'bgDarken', 'bgFit', 'bgMirror',
  'contrastMode', 'cbSafe', 'reduceMotion', 'focusRing', 'largeTargets', 'underlineLinks',
])

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const errText = (e) => (e && e.message ? e.message : String(e))
const fail = (error) => ({ ok: false, error })
// Control characters and line separators become a space; runs of spaces collapse.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g
/** Control characters become spaces, runs of spaces collapse, the ends are trimmed. */
export const tidyText = (s) => s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
const clean = tidyText
const HEX6 = /^#[0-9a-fA-F]{6}$/
const OV_KEY = /^(?:light|dark):[a-z0-9]{1,12}$/
const TOKEN = /^[A-Za-z0-9_-]{1,40}$/

/** One settings value: a boolean, a finite number, a short token or a hex colour, or null (accent: "the theme's own"). */
const settingValue = (key, v) => {
  if (key === 'ov') {
    if (!plain(v)) return undefined
    const out = {}
    const keys = Object.keys(v)
    if (keys.length > LIMITS.ov) return undefined
    for (const k of keys) {
      if (!OV_KEY.test(k) || typeof v[k] !== 'string' || !HEX6.test(v[k])) return undefined
      out[k] = v[k]
    }
    return out
  }
  if (key === 'acc') return v === null ? null : (typeof v === 'string' && HEX6.test(v) ? v : undefined)
  if (typeof v === 'boolean') return v
  if (isNum(v)) return v
  if (typeof v === 'string' && v.length <= LIMITS.string && TOKEN.test(v)) return v
  return undefined
}

/** Shape check of one preset. Returns { ok, preset } with a clean copy, or { ok:false, error }. */
export function sanitizePreset(raw, now = () => Date.now()) {
  if (!plain(raw)) return fail('not an object')
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return fail('invalid id')
  if (typeof raw.name !== 'string') return fail('invalid name')
  const name = clean(raw.name)
  if (name === '' || name.length > LIMITS.name) return fail('invalid name')
  const source = SOURCES.indexOf(raw.source) >= 0 ? raw.source : 'file'
  if (!plain(raw.settings)) return fail('settings missing')
  const keys = Object.keys(raw.settings)
  if (keys.length > LIMITS.keys) return fail('too many settings')
  const settings = {}
  for (const k of keys) {
    if (SETTINGS_KEYS.indexOf(k) < 0) continue // an unknown key is dropped, not trusted
    const v = settingValue(k, raw.settings[k])
    if (v === undefined) return fail('invalid value for ' + k)
    settings[k] = v
  }
  if (Object.keys(settings).length === 0) return fail('no known settings')
  const out = { id: raw.id, name, source, at: isNum(raw.at) ? Math.max(0, Math.round(raw.at)) : now(), settings }
  if (typeof raw.author === 'string' && clean(raw.author) !== '') out.author = clean(raw.author).slice(0, LIMITS.author)
  if (typeof raw.gid === 'string' && ID_RE.test(raw.gid)) out.gid = raw.gid
  if (Number.isInteger(raw.v) && raw.v >= 0 && raw.v <= 1000000) out.v = raw.v
  return { ok: true, preset: out }
}

/** Shape check of the whole library. Presets that fail are dropped and counted. */
export function sanitizeLibrary(raw, now = () => Date.now()) {
  if (!plain(raw) || !Array.isArray(raw.presets)) return fail('invalid library')
  const seen = new Set()
  const presets = []
  let dropped = 0
  for (const p of raw.presets) {
    if (presets.length >= LIMITS.presets) { dropped += 1; continue }
    const v = sanitizePreset(p, now)
    if (v.ok !== true || seen.has(v.preset.id)) { dropped += 1; continue }
    seen.add(v.preset.id)
    presets.push(v.preset)
  }
  // A clock that jumped far ahead must not make this copy win for ever.
  const ceiling = now() + 24 * 60 * 60 * 1000
  const updatedAt = isNum(raw.updatedAt) ? Math.max(0, Math.min(Math.round(raw.updatedAt), ceiling)) : 0
  return { ok: true, library: { v: LIB_VERSION, updatedAt, presets }, dropped }
}

export function createPresetStore(opts) {
  const file = join(opts.dir, FILE_NAME)
  const now = opts.now || (() => Date.now())

  const writeText = (text) => {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = file + '.tmp'
    try {
      writeFileSync(tmp, text, 'utf8')
      renameSync(tmp, file) // atomic: a reader never sees half a file
    } catch (e) {
      try { rmSync(tmp, { force: true }) } catch (e2) { /* nothing to clean */ }
      throw e
    }
  }
  const setAside = () => { try { renameSync(file, file + '.bad-' + now()) } catch (e) { /* already gone */ } }

  /** { ok:true, library } where library is null when there is no usable file; never throws on a bad file. */
  const read = () => {
    if (!existsSync(file)) return { ok: true, library: null }
    try { if (statSync(file).size > LIMITS.fileBytes) { setAside(); return { ok: true, library: null, setAside: 'too large' } } } catch (e) { return fail('unreadable: ' + errText(e)) }
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch (e) { return fail('unreadable: ' + errText(e)) }
    let parsed = null
    try { parsed = JSON.parse(text) } catch (e) { setAside(); return { ok: true, library: null, setAside: 'damaged JSON' } }
    const v = sanitizeLibrary(parsed, now)
    if (v.ok !== true) { setAside(); return { ok: true, library: null, setAside: v.error } }
    return { ok: true, library: v.library, dropped: v.dropped }
  }

  const write = (raw) => {
    const v = sanitizeLibrary(raw, now)
    if (v.ok !== true) return v
    // 100 presets of at most 48 settings each stay far under LIMITS.fileBytes: no size check is needed on the way out.
    const text = JSON.stringify(v.library, null, 2) + '\n'
    try { writeText(text) } catch (e) { return fail('could not write: ' + errText(e)) }
    return { ok: true, library: v.library, dropped: v.dropped }
  }
  return { read, write, file }
}

/** Pure request handler: GET gives the library, POST { library } replaces it. */
export function handlePresetStore(store, req) {
  if (req.method === 'GET') return { status: 200, body: store.read() }
  if (req.method === 'POST') {
    if (!plain(req.body) || !plain(req.body.library)) return { status: 400, body: fail('invalid body') }
    const out = store.write(req.body.library)
    return { status: out.ok === true ? 200 : 400, body: out }
  }
  return { status: 405, body: fail('GET or POST expected') }
}

/**
 * The route: origin guard (strict for writes, lax for reads, like the other Kybernos routes), the
 * DSH home, the bounded body, then handlePresetStore.
 * io = { home: () => Promise<string|null>, sameOriginStrict(req), sameOriginLax(req),
 *        readJson(req, maxBytes), send(res, status, body) }
 */
export async function servePresetStore(req, res, io) {
  if (req.method !== 'GET' && req.method !== 'POST') return io.send(res, 405, fail('GET or POST expected'))
  if ((req.method === 'POST' ? io.sameOriginStrict(req) : io.sameOriginLax(req)) === false) return io.send(res, 403, fail('origin refused'))
  try {
    const home = await io.home()
    if (home === null || home === undefined || home === '') return io.send(res, 200, fail('DSH home not found'))
    let body = null
    if (req.method === 'POST') {
      try { body = await io.readJson(req, MAX_BODY_BYTES) } catch (e) { return io.send(res, 413, fail('request body too large')) }
    }
    const out = handlePresetStore(createPresetStore({ dir: join(home, 'kybernos') }), { method: req.method, body })
    return io.send(res, out.status, out.body)
  } catch (e) {
    // The page treats any non-ok answer as "no disk copy": never let a host fault escape the route.
    return io.send(res, 500, fail('preset store failed: ' + errText(e)))
  }
}
