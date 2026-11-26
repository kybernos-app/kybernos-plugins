// ── The person's custom instructions, as a marked section of `<DSH home>/AGENTS.md` ─────────────────────────────
//
// The Account page has a "Custom instructions" field. It used to live in the browser's localStorage only, so no
// agent ever read it. DSH's own `dsh-agent-instructions` already loads `<DSH home>/AGENTS.md` into the first
// request of every chat, so the field is written there, between two HTML markers: the rest of the file (the
// person's own rules, the `kybernos:force-proposition` section) is never touched.
//
// Same contract as `kybernos-plugin/agents-proposition.mjs` (a boot-time seam, not an engine patch), with one
// difference: that section is laid once and never rewritten, this one follows what the person types, so it is
// replaced in place and removed when the field is emptied.
//
// Pure functions over a file path, so the host route stays thin and the tests run on a temp directory.
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const OPEN = '<!-- kybernos:custom-instructions v1 -->'
export const CLOSE = '<!-- /kybernos:custom-instructions -->'
export const HEADING = '## Custom instructions (from the person\'s Kybernos account)'
/** Same cap as the field in the page: the baseline message of `dsh-agent-instructions` has a byte budget (64 KiB by default). */
export const MAX_CHARS = 2000

export const agentsFile = (home) => join(home, 'AGENTS.md')

/** Where the section sits in `raw`: `{ start, end }` (end is past the closing marker), `null` when absent, `'damaged'` for
 *  an opening marker without a closing one after it (or the reverse): the file is left alone then, never guessed at. */
const locate = (raw) => {
  const open = raw.indexOf(OPEN)
  const close = raw.indexOf(CLOSE)
  if (open < 0 && close < 0) return null
  if (open < 0 || close < open) return 'damaged'
  return { start: open, end: close + CLOSE.length }
}

/** `{ ok, present, text, file }`, or `{ ok: false, error }`. An absent file or section reads as an empty text. */
export function readInstructions (file) {
  let raw = ''
  try { raw = existsSync(file) ? readFileSync(file, 'utf8') : '' } catch (e) { return { ok: false, error: 'unreadable' } }
  const at = locate(raw)
  if (at === 'damaged') return { ok: false, error: 'markers-damaged' }
  if (at === null) return { ok: true, present: false, text: '', file }
  let inner = raw.slice(at.start + OPEN.length, at.end - CLOSE.length).replace(/\r\n/g, '\n').trim()
  if (inner.startsWith(HEADING)) inner = inner.slice(HEADING.length).trim()
  return { ok: true, present: true, text: inner, file }
}

/** Replaces, inserts or removes the section so that the file carries `text`. `{ ok, present, changed, file }`, or
 *  `{ ok: false, error }` with one of: `bad-text`, `too-long`, `reserved`, `markers-damaged`, `unreadable`, `write-failed`. */
export function writeInstructions (file, text) {
  if (typeof text !== 'string') return { ok: false, error: 'bad-text' }
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (clean.length > MAX_CHARS) return { ok: false, error: 'too-long' }
  // A marker typed in the field would end the section early, and the rest would be read as the person's own rules.
  if (clean.includes('kybernos:custom-instructions')) return { ok: false, error: 'reserved' }

  let raw = ''
  const exists = existsSync(file)
  try { raw = exists ? readFileSync(file, 'utf8') : '' } catch (e) { return { ok: false, error: 'unreadable' } }
  const at = locate(raw)
  if (at === 'damaged') return { ok: false, error: 'markers-damaged' }

  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const block = [OPEN, HEADING, '', clean, CLOSE].join('\n').replace(/\n/g, eol)
  let next
  if (clean === '') {
    if (at === null) return { ok: true, present: false, changed: false, file }
    // The blank lines that set the section apart go with it; what is on either side keeps one blank line between.
    const before = raw.slice(0, at.start).replace(/(\r?\n)+$/, '')
    const after = raw.slice(at.end).replace(/^(\r?\n)+/, '')
    next = before === '' ? after : (after === '' ? before + eol : before + eol + eol + after)
  } else if (at !== null) {
    next = raw.slice(0, at.start) + block + raw.slice(at.end)
  } else {
    const lead = raw === '' ? '' : (raw.endsWith(eol) ? eol : eol + eol)
    next = raw + lead + block + eol
  }
  if (next === raw && exists) return { ok: true, present: clean !== '', changed: false, file }

  // A symlinked AGENTS.md (a dotfiles repo) keeps pointing at its target: the new content goes next to the real file.
  let target = file
  try { if (exists) target = realpathSync(file) } catch (e) { target = file }
  const tmp = target + '.kybernos-' + process.pid + '.tmp'
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(tmp, next, 'utf8')
    if (exists) { try { chmodSync(tmp, statSync(target).mode & 0o777) } catch (e) { /* the default mode is fine */ } }
    renameSync(tmp, target)
  } catch (e) {
    try { unlinkSync(tmp) } catch (e2) { /* nothing was written */ }
    return { ok: false, error: 'write-failed' }
  }
  return { ok: true, present: clean !== '', changed: true, file }
}
