// Anti-flash v2: what the page paints BEFORE the client bundle has run.
//
//   <dsh home>/kybernos/theme-boot.json     { v, tokens: { '--dsw-x': { light, dark } }, font: string | null }
//
// Until now the look came back only when this bundle's JavaScript activated, a few hundred milliseconds after the
// first paint, so a themed page flashed DSH's default palette on every load. The browser half posts what it applies
// (the token layer and the font) to /kybernos-theme/boot; the host keeps it here and puts it into every index
// render through DSH's own `webserver/index-inject` seam, as a `<style id="kbth-boot">` right after `<head>`.
// The browser half removes that sheet once its own layer is in place, so the sheet is scaffolding: it can never
// outvote a later choice.
//
// What crosses the route is untrusted data that ends up inside a `<style>` of every page, so nothing is taken as
// CSS: token names and values are matched against strict grammars (no `;`, braces, `<`, `url(`, escapes, quotes
// that do not pair), and the sheet is built here from the validated parts only.
//
// Pure node:fs, no DSH service: unit-testable on a temp folder (see test-boot-store.mjs). `dir` is the
// `<dsh home>/kybernos` folder. A damaged file counts as absent; every write is tmp + rename.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const FILE_NAME = 'theme-boot.json'
export const BOOT_ID = 'kbth-boot'
export const VERSION = 1
export const MAX_BODY_BYTES = 16 * 1024
export const LIMITS = { tokens: 64, font: 240 }

const NAME = /^--dsw-[a-z0-9-]{1,60}$/
// A colour (hex, rgb[a], hsl[a]), a length or a bare number: what the token layer holds, and nothing that can carry a url.
const VALUE = /^(?:#[0-9a-fA-F]{3,8}|-?\d{1,4}(?:\.\d{1,3})?(?:px|rem|em|%)?|(?:rgba?|hsla?)\([0-9., %]{1,50}\)|transparent)$/
// A font stack: names, each bare (words, digits, hyphens) or wholly quoted, separated by commas.
const FONT_ITEM = '(?:[A-Za-z0-9 _-]{1,40}|\'[A-Za-z0-9 _-]{1,40}\'|"[A-Za-z0-9 _-]{1,40}")'
const FONT = new RegExp('^' + FONT_ITEM + '(?:\\s*,\\s*' + FONT_ITEM + '){0,11}$')

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (error) => ({ ok: false, error })
const errText = (e) => (e && e.message ? e.message : String(e))

/** `{ ok: true, snapshot }` with only known, valid parts, or `{ ok: false, error }`. */
export function cleanBoot (raw) {
  if (!plain(raw)) return fail('object expected')
  const tokens = {}
  if (raw.tokens !== undefined) {
    if (!plain(raw.tokens)) return fail('tokens: object expected')
    const names = Object.keys(raw.tokens)
    if (names.length > LIMITS.tokens) return fail('too many tokens')
    for (const name of names) {
      const pair = raw.tokens[name]
      if (!NAME.test(name)) return fail('token name refused')
      if (!plain(pair) || typeof pair.light !== 'string' || typeof pair.dark !== 'string' || !VALUE.test(pair.light) || !VALUE.test(pair.dark)) return fail('token value refused')
      tokens[name] = { light: pair.light, dark: pair.dark }
    }
  }
  let font = null
  if (raw.font !== undefined && raw.font !== null) {
    if (typeof raw.font !== 'string' || raw.font.length > LIMITS.font || !FONT.test(raw.font)) return fail('font refused')
    font = raw.font
  }
  return { ok: true, snapshot: { v: VERSION, tokens, font } }
}

/** The sheet for a snapshot: `''` when it carries nothing. The selectors beat DSH's base palette by one point of
 *  specificity, and the page's own inline variables (the theme presenter writes them on `body`) beat the sheet. */
export function renderBootCss (snapshot) {
  if (!snapshot || !plain(snapshot.tokens)) return ''
  const names = Object.keys(snapshot.tokens)
  const parts = []
  if (names.length > 0) {
    parts.push('html body:not([data-ds-dark-theme]){' + names.map((n) => n + ':' + snapshot.tokens[n].light).join(';') + '}')
    parts.push('html body[data-ds-dark-theme]{' + names.map((n) => n + ':' + snapshot.tokens[n].dark).join(';') + '}')
  }
  // `body` as well as `:root`: DSH 0.2.1-alpha.2 declares --dsw-font-family again on `body`, which shadows a `:root` rule.
  if (typeof snapshot.font === 'string' && snapshot.font !== '') parts.push(':root,body{--dsw-font-family:' + snapshot.font + ' !important}')
  return parts.join('')
}

/** The stored snapshot, re-validated on the way out, or `null`. */
export function readBoot (dir) {
  try {
    const file = join(dir, FILE_NAME)
    if (!existsSync(file)) return null
    const out = cleanBoot(JSON.parse(readFileSync(file, 'utf8')))
    return out.ok === true ? out.snapshot : null
  } catch (e) { return null }
}

const isEmpty = (snapshot) => Object.keys(snapshot.tokens).length === 0 && snapshot.font === null

/** Stores a validated snapshot; an empty one removes the file. `{ ok, changed }`. */
export function writeBoot (dir, snapshot) {
  try {
    const file = join(dir, FILE_NAME)
    if (isEmpty(snapshot)) {
      const had = existsSync(file)
      if (had) rmSync(file, { force: true })
      return { ok: true, changed: had }
    }
    const text = JSON.stringify(snapshot)
    try { if (existsSync(file) && readFileSync(file, 'utf8') === text) return { ok: true, changed: false } } catch (e) { /* rewritten below */ }
    mkdirSync(dir, { recursive: true })
    const tmp = file + '.' + process.pid + '.tmp'
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, file)
    return { ok: true, changed: true }
  } catch (e) { return fail('write failed: ' + errText(e)) }
}

/** POST /kybernos-theme/boot. `io` is the same shape the other stores' routes take, plus `changed(css)`. */
export async function serveBoot (req, res, io) {
  if (req.method !== 'POST') return io.send(res, 405, fail('POST expected'))
  if (io.sameOriginStrict(req) === false) return io.send(res, 403, fail('origin refused'))
  try {
    const home = await io.home()
    if (home === null || home === undefined || home === '') return io.send(res, 200, fail('DSH home not found'))
    let body = null
    try { body = await io.readJson(req, MAX_BODY_BYTES) } catch (e) { return io.send(res, 413, fail('request body too large')) }
    const cleaned = cleanBoot(body)
    if (cleaned.ok !== true) return io.send(res, 400, cleaned)
    const written = writeBoot(join(home, 'kybernos'), cleaned.snapshot)
    if (written.ok !== true) return io.send(res, 200, written)
    if (typeof io.changed === 'function') io.changed(renderBootCss(cleaned.snapshot))
    return io.send(res, 200, { ok: true, changed: written.changed })
  } catch (e) {
    return io.send(res, 500, fail('boot store failed: ' + errText(e)))
  }
}
