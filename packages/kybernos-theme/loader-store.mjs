// On-disk store for the Theme plugin's loading animations and loading words.
//
//   <dsh home>/kybernos/
//     loaders/<id>.json     one record per loader the user imported in Settings
//     loaders/<name>.svg    BARE svg files dropped there by the `loader` skill
//     loader-settings.json  the user's choices (which loaders, size, speed...)
//     loading-text.json     the user's own loading words ("my pack")
//
// The browser keeps a copy of all of it (first paint must stay synchronous); this
// store is the copy that survives clearing site data, a new browser profile or
// another browser, and the one the skills write into.
//
// Everything that crosses this boundary is untrusted: an imported file, a model's
// SVG, a hand-edited JSON. Records are re-validated on the way in AND on the way
// out. An SVG is REJECTED, never rewritten, when it could run code or fetch
// something; ids and file names are matched against a regex so that nothing else
// can become a path; a damaged file is set aside (`.bad-<time>`) and counts as
// absent, so it can never become a 5xx; every write is tmp + rename.
//
// Pure node:fs, no DSH service: unit-testable on a temp folder (see
// test-loader-store.mjs). `dir` is the `<dsh home>/kybernos` folder.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const STORE_VERSION = 1
/** Ids of imported loaders (and of the ids derived from bare files: `f-` + name). */
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
/** Name part of a bare `<name>.svg`; `f-` + name must still be a valid id. */
export const BARE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,60}$/
/** Text pack id ('dsh', 'perso', ...). */
export const PACK_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
export const TYPES = ['svg', 'lottie', 'img']
export const KINDS = ['mono', 'color']
export const SOURCES = ['file', 'skill']
export const LIMITS = {
  loaders: 30, // imported records; bare files have their own cap below
  bare: 60, // bare svg files taken into account per listing
  recordBytes: 600 * 1024, // a record file: 200 KB of data plus JSON escaping
  skipped: 50, // entries of the `skipped` debugging list
  dataBytes: 200 * 1024, // svg text / lottie json / decoded image
  name: 60,
  dur: 12,
  prompt: 160,
  sel: 4,
  word: 40,
  words: 40,
}
export const MAX_BODY_BYTES = 400 * 1024
export const DEFAULT_SETTINGS = Object.freeze({
  sel: [], mode: 'random', size: 'standard', tint: true, keep: true, speed: 1, avoid: true, delay: 300, pack: 'dsh', rot: 'fixed', dur: true,
})

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const errText = (e) => (e && e.message ? e.message : String(e))
// Control characters and line separators become a space; runs of spaces collapse.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g
const clean = (s) => s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
const fail = (error) => ({ ok: false, error })

// ── SVG: reject anything that could run code or fetch something ───────────────

const NAMED_ENTITIES = {
  lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', colon: ':', semi: ';', comma: ',', period: '.', sol: '/', bsol: '\\', num: '#', lpar: '(', rpar: ')', excl: '!', equals: '=', tab: '', newline: '',
}
const codePoint = (n) => (n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd')
/** Numeric (decimal / hex, ';' optional like in HTML) and the few named entities that build a scheme or a tag; repeated so `&amp;#106;` does not hide. */
export function decodeEntities(text) {
  let cur = text
  for (let i = 0; i < 4; i += 1) {
    const next = cur
      .replace(/&#x([0-9a-f]{1,8});?/gi, (m, h) => codePoint(parseInt(h, 16)))
      .replace(/&#(\d{1,10});?/g, (m, d) => codePoint(parseInt(d, 10)))
      .replace(/&([a-z]{2,8});?/gi, (m, n) => (has(NAMED_ENTITIES, n.toLowerCase()) ? NAMED_ENTITIES[n.toLowerCase()] : m))
    if (next === cur) break
    cur = next
  }
  return cur
}
// What a browser ignores inside a scheme or a function name: white space, controls, zero-width marks.
const INVISIBLE = /[\s\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g
const FORBIDDEN_TAG = /<\/?\s*(?:[a-z0-9_.-]+:)?(?:script|foreignobject|iframe|image|img|link|audio|video|embed|object|source|track|input|form|button|textarea|select|frame|frameset|meta|base|applet|portal|template|noscript|canvas|dialog|math)\b/
const FORBIDDEN_DECL = /<!(?:doctype|entity|attlist|element|notation)/
const EVENT_ATTR = /[\s"'/]on[a-z]+\s*=/
const SCHEME = /(?:javascript|vbscript|livescript|mocha):/
const RESOURCE_ATTR = /[\s"'/](?:src|srcset|poster|action|formaction|background|ping)\s*=/
const HREF_ATTR = /[\s"'/](?:[a-z0-9_.-]+:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
const ANIMATED_ATTR = /attributename\s*=\s*["']?\s*(?:(?:[a-z0-9_.-]+:)?href|on[a-z]+)/
const URL_FN = /url\(["']?([^)]{0,2})/g

/** Skip the optional BOM / white space / xml prolog / comments before the root; returns the index of the root's `<`, or -1. */
function rootStart(text) {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i += 1
    if (text.startsWith('<?xml', i)) {
      const end = text.indexOf('?>', i)
      if (end < 0) return -1
      i = end + 2
    } else if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4)
      if (end < 0) return -1
      i = end + 3
    } else break
  }
  return /^<svg[\s/>]/.test(text.slice(i, i + 5)) ? i : -1
}
/** Only white space and comments may follow the closing </svg>. */
function endsCleanly(text) {
  const close = text.lastIndexOf('</svg')
  if (close < 0) return false
  const m = /^<\/svg\s*>/.exec(text.slice(close, close + 40))
  if (m === null) return false
  let i = close + m[0].length
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i += 1
    if (i >= text.length) return true
    if (!text.startsWith('<!--', i)) return false
    const end = text.indexOf('-->', i + 4)
    if (end < 0) return false
    i = end + 3
  }
}

/** null when the SVG is acceptable, else the reason it is refused. Never throws. */
export function svgProblem(text) {
  if (typeof text !== 'string') return 'svg must be text'
  if (text.trim() === '') return 'svg is empty'
  if (Buffer.byteLength(text, 'utf8') > LIMITS.dataBytes) return 'svg is over 200 KB'
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return 'control characters are not allowed'
  if (rootStart(text) < 0) return 'must start with <svg (after an optional xml prolog or comments)'
  if (!endsCleanly(text)) return 'must end with </svg> (only comments may follow)'
  const dec = decodeEntities(text)
  const low = dec.toLowerCase()
  const squashed = low.replace(INVISIBLE, '')
  if (dec.includes('\\')) return 'backslash (CSS escapes can hide url() and @import)'
  if (FORBIDDEN_DECL.test(low)) return 'DOCTYPE / ENTITY declarations are not allowed'
  const tag = FORBIDDEN_TAG.exec(low)
  if (tag !== null) return 'forbidden element ' + tag[0].replace(/[<\s/]/g, '')
  if (EVENT_ATTR.test(low)) return 'event handler attribute (on...=)'
  if (SCHEME.test(squashed)) return 'script scheme (javascript:)'
  if (RESOURCE_ATTR.test(low)) return 'external resource attribute (src, poster, action...)'
  if (ANIMATED_ATTR.test(squashed)) return 'an animation may not target href or an event handler'
  HREF_ATTR.lastIndex = 0
  for (let m = HREF_ATTR.exec(low); m !== null; m = HREF_ATTR.exec(low)) {
    const value = (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]).replace(INVISIBLE, '')
    if (!value.startsWith('#')) return 'href must point to an #id inside the file'
  }
  if (squashed.includes('@import')) return '@import is not allowed'
  if (/(?:image-set|cross-fade)\(/.test(squashed) || /(?:^|[^a-z0-9_-])src\(/.test(squashed)) return 'external CSS image functions are not allowed'
  URL_FN.lastIndex = 0
  for (let m = URL_FN.exec(squashed); m !== null; m = URL_FN.exec(squashed)) {
    if (!m[1].startsWith('#')) return 'url() must point to an #id inside the file'
  }
  return null
}

// ── Lottie ────────────────────────────────────────────────────────────────────

const DATA_IMAGE_URL = /^data:image\/(?:png|jpe?g|gif|webp);base64,/i
const EXTERNAL_STRING = /^\s*(?:(?:https?|ftp|file|javascript|vbscript):|\/\/)/i
// Expressions are not evaluated by lottie_light, but a file that reaches for the host is refused anyway.
const HOST_REACH = /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(|\bXMLHttpRequest\b|\bfetch\s*\(|\bimportScripts\b|\bimport\s*\(|\bglobalThis\b|\b(?:window|document)\s*[.[]|<\s*script/

function lottieProblem(data) {
  if (!plain(data)) return 'lottie data must be a JSON object'
  if (!isNum(data.fr) || data.fr <= 0 || data.fr > 240) return 'lottie needs a frame rate "fr" (1-240)'
  if (!isNum(data.w) || data.w <= 0 || data.w > 8192) return 'lottie needs a width "w" (1-8192)'
  if (!isNum(data.h) || data.h <= 0 || data.h > 8192) return 'lottie needs a height "h" (1-8192)'
  if (!Array.isArray(data.layers) || data.layers.length === 0) return 'lottie needs a non-empty "layers" array'
  if (Array.isArray(data.assets)) {
    for (const a of data.assets) {
      if (!plain(a) || typeof a.p !== 'string' || a.p === '') continue
      if (!DATA_IMAGE_URL.test(a.p)) return 'lottie image assets must be embedded (data:image/...), not external'
      // lottie-web prepends `u` to `p` when `e` is not set: an external base turns an embedded image into a request.
      if (typeof a.u === 'string' && a.u !== '') return 'lottie image assets may not carry a base path'
    }
  }
  const fonts = plain(data.fonts) && Array.isArray(data.fonts.list) ? data.fonts.list : []
  for (const f of fonts) {
    if (plain(f) && typeof f.fPath === 'string' && f.fPath !== '') return 'lottie fonts may not be loaded from a path or URL'
  }
  // One bounded walk: depth, node count, strings that reach out of the file.
  const stack = [[data, 0]]
  let nodes = 0
  while (stack.length > 0) {
    const [node, depth] = stack.pop()
    nodes += 1
    if (nodes > 200000) return 'lottie is too complex'
    if (depth > 64) return 'lottie is nested too deeply'
    if (typeof node === 'string') {
      if (DATA_IMAGE_URL.test(node)) continue
      if (EXTERNAL_STRING.test(node)) return 'lottie contains an external URL'
      if (HOST_REACH.test(node)) return 'lottie contains a script-like expression'
    } else if (Array.isArray(node)) {
      for (const v of node) stack.push([v, depth + 1])
    } else if (plain(node)) {
      for (const k of Object.keys(node)) {
        if (k === '__proto__') return 'lottie contains a forbidden key'
        stack.push([node[k], depth + 1])
      }
    }
  }
  return null
}

// ── Raster image (GIF / WebP / PNG as a data URL) ─────────────────────────────

const IMG_URL = /^data:image\/(gif|webp|png);base64,([A-Za-z0-9+/]*={0,2})$/
const startsWith = (buf, bytes, at = 0) => bytes.every((b, i) => buf[at + i] === b)
const MAGIC = {
  gif: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
}
/** Decoded byte length, or an error text. */
function imgBytes(data) {
  if (typeof data !== 'string') return { error: 'image data must be a data URL string' }
  // The string cap is the decoded cap plus base64 overhead, checked before any regex runs on it.
  if (data.length > Math.ceil(LIMITS.dataBytes / 3) * 4 + 40) return { error: 'image is over 200 KB' }
  const m = IMG_URL.exec(data)
  if (m === null) return { error: 'image must be a data:image/(gif|webp|png);base64 URL' }
  const b64 = m[2]
  if (b64.length === 0 || b64.length % 4 !== 0) return { error: 'image base64 is malformed' }
  const buf = Buffer.from(b64, 'base64')
  const expected = (b64.length / 4) * 3 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)
  if (buf.length !== expected || buf.length < 12) return { error: 'image base64 does not decode' }
  if (buf.length > LIMITS.dataBytes) return { error: 'image is over 200 KB' }
  if (!MAGIC[m[1]](buf)) return { error: 'image bytes are not a ' + m[1].toUpperCase() }
  return { bytes: buf.length }
}

// ── Records, settings, words: whitelist sanitizers ────────────────────────────

/** `{ok:true, loader}` with only the documented fields (size recomputed), or `{ok:false, error}`. Never throws. */
export function sanitizeLoader(raw, now = () => Date.now()) {
  if (!plain(raw)) return fail('loader must be an object')
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return fail('invalid loader id (lowercase letters, digits and hyphens, 64 max)')
  if (typeof raw.name !== 'string') return fail('loader name must be text')
  const name = clean(raw.name)
  if (name === '') return fail('loader name is empty')
  if (name.length > LIMITS.name) return fail('loader name is over ' + LIMITS.name + ' characters')
  if (TYPES.indexOf(raw.type) < 0) return fail('type must be svg, lottie or img')
  if (KINDS.indexOf(raw.kind) < 0) return fail('kind must be mono or color')
  if (SOURCES.indexOf(raw.source) < 0) return fail('source must be file or skill')
  const out = { id: raw.id, name, type: raw.type, kind: raw.kind, source: raw.source, size: 0 }
  for (const [key, max] of [['dur', LIMITS.dur], ['prompt', LIMITS.prompt]]) {
    if (raw[key] === undefined || raw[key] === null) continue
    if (typeof raw[key] !== 'string') return fail(key + ' must be text')
    const v = clean(raw[key])
    if (v.length > max) return fail(key + ' is over ' + max + ' characters')
    if (v !== '') out[key] = v
  }
  out.createdAt = isNum(raw.createdAt) && raw.createdAt >= 0 ? raw.createdAt : now()
  if (raw.type === 'svg') {
    const problem = svgProblem(raw.data)
    if (problem !== null) return fail('svg refused: ' + problem)
    out.size = Buffer.byteLength(raw.data, 'utf8')
    out.data = raw.data
  } else if (raw.type === 'lottie') {
    const problem = lottieProblem(raw.data)
    if (problem !== null) return fail('lottie refused: ' + problem)
    let text = ''
    try { text = JSON.stringify(raw.data) } catch (e) { return fail('lottie refused: not serializable') }
    out.size = Buffer.byteLength(text, 'utf8')
    if (out.size > LIMITS.dataBytes) return fail('lottie is over 200 KB')
    out.data = raw.data
  } else {
    const img = imgBytes(raw.data)
    if (img.error !== undefined) return fail(img.error)
    out.size = img.bytes
    out.data = raw.data
  }
  return { ok: true, loader: out }
}

const pick = (v, allowed, fallback) => (allowed.indexOf(v) >= 0 ? v : fallback)
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback)
/** Whitelist + defaults; `updatedAt` is stamped by the caller. */
export function sanitizeSettings(raw, updatedAt) {
  const r = plain(raw) ? raw : {}
  const d = DEFAULT_SETTINGS
  const sel = []
  if (Array.isArray(r.sel)) {
    for (const id of r.sel) {
      if (sel.length >= LIMITS.sel) break
      if (typeof id === 'string' && ID_RE.test(id) && sel.indexOf(id) < 0) sel.push(id)
    }
  }
  return {
    sel,
    mode: pick(r.mode, ['random', 'order'], d.mode),
    size: pick(r.size, ['compact', 'standard', 'large'], d.size),
    tint: bool(r.tint, d.tint),
    keep: bool(r.keep, d.keep),
    speed: isNum(r.speed) ? clamp(r.speed, 0.5, 2) : d.speed,
    avoid: bool(r.avoid, d.avoid),
    delay: isNum(r.delay) ? clamp(Math.round(r.delay), 0, 1000) : d.delay,
    pack: typeof r.pack === 'string' && PACK_RE.test(r.pack) ? r.pack : d.pack,
    rot: pick(r.rot, ['fixed', '8', '15'], d.rot),
    dur: bool(r.dur, d.dur),
    updatedAt,
  }
}

/** Trimmed, de-duplicated (case-insensitive), 1-40 characters each, 40 at most; others are dropped. */
export function sanitizeWords(raw) {
  const out = []
  const seen = new Set()
  if (!Array.isArray(raw)) return out
  for (const w of raw) {
    if (out.length >= LIMITS.words) break
    if (typeof w !== 'string') continue
    const v = clean(w)
    if (v === '' || v.length > LIMITS.word) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

// ── The store ─────────────────────────────────────────────────────────────────

const prettyName = (stem) => { const s = stem.replace(/-+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1) }

/** @param {{ dir: string, now?: () => number }} opts  dir = <dsh home>/kybernos */
export function createLoaderStore(opts) {
  const dir = opts.dir
  const now = opts.now || (() => Date.now())
  const loadersDir = join(dir, 'loaders')
  const recordFile = (id) => join(loadersDir, id + '.json')
  const settingsFile = join(dir, 'loader-settings.json')
  const wordsFile = join(dir, 'loading-text.json')

  const writeText = (file, text) => {
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
  /** {value} | {absent:true} | {unreadable:true} | {damaged:true}. Only text that is not JSON is "damaged": it is set aside and counts as absent. */
  const readJson = (file) => {
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch (e) { return existsSync(file) ? { unreadable: true } : { absent: true } }
    try {
      return { value: JSON.parse(text) }
    } catch (e) {
      try { renameSync(file, file + '.bad-' + now()) } catch (e2) { /* already gone */ }
      return { damaged: true }
    }
  }
  const setAside = (file) => { try { renameSync(file, file + '.bad-' + now()) } catch (e) { /* already gone */ } }

  /** Every acceptable loader, plus `skipped` for the files that were not (humans debug with it). */
  const list = () => {
    const skipped = []
    let names = []
    try { names = readdirSync(loadersDir).sort() } catch (e) { return { loaders: [], skipped } }
    const byId = new Map()
    let records = 0
    for (const name of names) {
      const m = /^(.+)\.json$/.exec(name)
      if (m === null || !ID_RE.test(m[1])) continue
      const file = join(loadersDir, name)
      if (records >= LIMITS.loaders) { skipped.push({ file: name, reason: 'too many loaders (' + LIMITS.loaders + ' max)' }); continue }
      let size = 0
      try { size = statSync(file).size } catch (e) { continue }
      if (size > LIMITS.recordBytes) { skipped.push({ file: name, reason: 'record file is too large' }); continue }
      const got = readJson(file)
      if (got.absent === true) continue
      if (got.unreadable === true) { skipped.push({ file: name, reason: 'unreadable' }); continue }
      if (got.damaged === true) { skipped.push({ file: name, reason: 'damaged JSON, set aside' }); continue }
      if (!plain(got.value)) { setAside(file); skipped.push({ file: name, reason: 'not a JSON object, set aside' }); continue }
      if (got.value.id !== m[1]) { skipped.push({ file: name, reason: 'id does not match the file name' }); continue }
      const v = sanitizeLoader(got.value, now)
      if (v.ok !== true) { skipped.push({ file: name, reason: v.error }); continue }
      records += 1
      byId.set(v.loader.id, v.loader)
    }
    let bare = 0
    for (const name of names) {
      const m = /^(.*)\.svg$/i.exec(name)
      if (m === null) continue
      const stem = m[1]
      if (!name.endsWith('.svg')) { skipped.push({ file: name, reason: 'the extension must be lowercase .svg' }); continue }
      if (!BARE_NAME_RE.test(stem)) { skipped.push({ file: name, reason: 'invalid file name (lowercase letters, digits and hyphens, 61 characters max)' }); continue }
      const id = 'f-' + stem
      if (byId.has(id)) continue // a JSON record with the same id wins
      if (bare >= LIMITS.bare) { skipped.push({ file: name, reason: 'too many svg files (' + LIMITS.bare + ' max)' }); continue }
      const file = join(loadersDir, name)
      let st = null
      try { st = statSync(file) } catch (e) { skipped.push({ file: name, reason: 'unreadable: ' + errText(e) }); continue }
      if (!st.isFile()) { skipped.push({ file: name, reason: 'not a regular file' }); continue }
      if (st.size > LIMITS.dataBytes) { skipped.push({ file: name, reason: 'svg is over 200 KB' }); continue }
      let text = ''
      try { text = readFileSync(file, 'utf8') } catch (e) { skipped.push({ file: name, reason: 'unreadable: ' + errText(e) }); continue }
      const problem = svgProblem(text)
      if (problem !== null) { skipped.push({ file: name, reason: problem }); continue }
      bare += 1
      byId.set(id, {
        id, name: prettyName(stem), type: 'svg', kind: /currentcolor/i.test(text) ? 'mono' : 'color', source: 'skill',
        size: Buffer.byteLength(text, 'utf8'), createdAt: Math.round(st.mtimeMs), data: text,
      })
    }
    if (skipped.length > LIMITS.skipped) {
      const more = skipped.length - LIMITS.skipped
      skipped.length = LIMITS.skipped
      skipped.push({ file: '...', reason: more + ' more' })
    }
    const loaders = Array.from(byId.values()).sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return { loaders, skipped }
  }

  const putLoader = (raw) => {
    const v = sanitizeLoader(raw, now)
    if (v.ok !== true) return v
    try {
      let count = 0
      let exists = false
      try {
        for (const name of readdirSync(loadersDir)) {
          const m = /^(.+)\.json$/.exec(name)
          if (m === null || !ID_RE.test(m[1])) continue
          count += 1
          if (m[1] === v.loader.id) exists = true
        }
      } catch (e) { /* no folder yet */ }
      if (!exists && count >= LIMITS.loaders) return fail('too many loaders (' + LIMITS.loaders + ' max)')
      writeText(recordFile(v.loader.id), JSON.stringify(v.loader))
    } catch (e) { return fail('could not write: ' + errText(e)) }
    return { ok: true, loader: v.loader }
  }

  /** Idempotent, leaves no tombstone. An `f-<name>` id also removes the bare `<name>.svg`. */
  const deleteLoader = (id) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) return fail('invalid loader id')
    try {
      rmSync(recordFile(id), { force: true })
      if (id.startsWith('f-') && BARE_NAME_RE.test(id.slice(2))) rmSync(join(loadersDir, id.slice(2) + '.svg'), { force: true })
    } catch (e) { return fail('could not remove: ' + errText(e)) }
    return { ok: true }
  }

  /** The stored settings (re-sanitized), or null when there are none. */
  const readSettings = () => {
    const got = readJson(settingsFile)
    if (got.value === undefined) return null
    if (!plain(got.value)) { setAside(settingsFile); return null }
    let stamp = got.value.updatedAt
    if (!isNum(stamp)) { try { stamp = Math.round(statSync(settingsFile).mtimeMs) } catch (e) { stamp = 0 } }
    return sanitizeSettings(got.value, stamp)
  }
  const putSettings = (raw) => {
    if (!plain(raw)) return fail('settings must be an object')
    const settings = sanitizeSettings(raw, now())
    try { writeText(settingsFile, JSON.stringify(settings)) } catch (e) { return fail('could not write: ' + errText(e)) }
    return { ok: true, settings }
  }

  /** The stored words, or null when there are none. Accepts `{version, words, updatedAt}`, `{words}` (written by hand or by the skill) and a bare array. */
  const readWords = () => {
    const got = readJson(wordsFile)
    if (got.value === undefined) return null
    const list = Array.isArray(got.value) ? got.value : plain(got.value) ? got.value.words : undefined
    if (!Array.isArray(list)) { setAside(wordsFile); return null }
    return sanitizeWords(list)
  }
  const putWords = (raw) => {
    if (!Array.isArray(raw)) return fail('words must be an array of text')
    const words = sanitizeWords(raw)
    try { writeText(wordsFile, JSON.stringify({ version: STORE_VERSION, words, updatedAt: now() })) } catch (e) { return fail('could not write: ' + errText(e)) }
    return { ok: true, words }
  }

  const snapshot = () => {
    const { loaders, skipped } = list()
    return { ok: true, loaders, settings: readSettings(), words: readWords(), skipped }
  }

  return { dir, list, putLoader, deleteLoader, readSettings, putSettings, readWords, putWords, snapshot }
}

/**
 * The whole request logic, minus the origin check (the route does that):
 *   GET  -> { ok, loaders, settings, words, skipped }
 *   POST { op: 'put-loader', loader } | { op: 'delete-loader', id } |
 *        { op: 'put-settings', settings } | { op: 'put-words', words }
 * Returns { status, body }. A well-formed request the store REFUSES (a defect in the file, a limit)
 * is a normal 200 { ok:false, error }: Chrome prints every 4xx fetch as a red console error, and a
 * user's bad import is not a fault. A request that is not even well-formed (not an object, unknown op)
 * is a 400: that is a bug in the caller.
 */
export function handleLoaderStore(store, req) {
  if (req.method === 'GET') return { status: 200, body: store.snapshot() }
  if (req.method === 'POST') {
    const body = req.body
    if (!plain(body)) return { status: 400, body: fail('invalid body') }
    let res
    switch (body.op) {
      case 'put-loader': res = store.putLoader(body.loader); break
      case 'delete-loader': res = store.deleteLoader(body.id); break
      case 'put-settings': res = store.putSettings(body.settings); break
      case 'put-words': res = store.putWords(body.words); break
      default: return { status: 400, body: fail('unknown op') }
    }
    return { status: 200, body: res }
  }
  return { status: 405, body: fail('GET or POST expected') }
}

/**
 * The route itself, with the host's helpers handed in (`io`) so it can be tested
 * without the host: origin guard (strict for writes, lax for reads, like the other
 * Kybernos routes), the DSH home, the bounded body, then handleLoaderStore.
 * io = { home: () => Promise<string|null>, sameOriginStrict(req), sameOriginLax(req),
 *        readJson(req, maxBytes), send(res, status, body) }
 */
export async function serveLoaderStore(req, res, io) {
  if (req.method !== 'GET' && req.method !== 'POST') return io.send(res, 405, fail('GET or POST expected'))
  if ((req.method === 'POST' ? io.sameOriginStrict(req) : io.sameOriginLax(req)) === false) return io.send(res, 403, fail('origin refused'))
  try {
    const home = await io.home()
    if (home === null || home === undefined || home === '') return io.send(res, 200, fail('DSH home not found'))
    let body = null
    if (req.method === 'POST') {
      try { body = await io.readJson(req, MAX_BODY_BYTES) } catch (e) { return io.send(res, 413, fail('request body too large')) }
    }
    const out = handleLoaderStore(createLoaderStore({ dir: join(home, 'kybernos') }), { method: req.method, body })
    return io.send(res, out.status, out.body)
  } catch (e) {
    // The page treats any non-ok answer as "no disk copy": never let a host fault escape the route.
    return io.send(res, 500, fail('loader store failed: ' + errText(e)))
  }
}
