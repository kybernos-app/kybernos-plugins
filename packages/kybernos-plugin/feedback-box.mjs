// The feedback box (V-10): what a person writes in the « Send feedback » form is appended, as ONE JSON line, to
// <DSH home>/kybernos/feedback.jsonl. Nothing is sent anywhere: the file is what the owner reads, or what the person exports
// (copies to the clipboard) and passes on himself. The relay path of the older interview (the skill report-feedback and its
// tool kybernos_report_feedback, index.js) is another door and stays as it is.
//
// Pure but for the file: the DSH home, the masking of secrets, the clock and the id are handed in (index.js gives the real ones).
import { appendFileSync, chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const FEEDBACK_TYPES = ['bug', 'idea', 'question']
/** The longest message kept (characters); a longer one is cut, never refused. */
export const MESSAGE_MAX = 4000
/** A box that holds this much (bytes) takes no more: nobody has written 1,000 messages by hand, a loop has. */
export const FILE_MAX = 4 * 1024 * 1024
/** What one export hands back (bytes): the newest lines, cut at a line boundary. */
export const EXPORT_MAX = 1024 * 1024

export const feedbackFile = (home) => join(String(home), 'kybernos', 'feedback.jsonl')

const clip = (value, limit) => (typeof value === 'string' ? value.slice(0, limit) : '')
const plain = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {})
// U+2028 and U+2029 are legal inside a JSON string but some line readers split on them: they are written escaped.
const LINE_SEPARATORS = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)]
const oneLine = (entry) => {
  let text = JSON.stringify(entry)
  for (const ch of LINE_SEPARATORS) text = text.split(ch).join('\\u' + ch.charCodeAt(0).toString(16))
  return text + '\n'
}

/**
 * The line to write for what the form sent, or the reason it is refused.
 *   body  { type: 'bug' | 'idea' | 'question', message, context?: true, page?: { title, lang, width, height } }
 *   env   { id(): string, now(): ms, mask(text): text, context(): { os?, dsh?, revision? } }
 * The technical context is added ONLY when the form asked for it (`context: true`); otherwise nothing about the machine, the page or
 * the language is written, whatever else the form sent. Every text is masked (a key pasted into a message does not reach the file).
 */
export function entryOf (body, env) {
  const b = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : null
  if (b === null) return { ok: false, error: 'a JSON object is expected' }
  if (FEEDBACK_TYPES.indexOf(b.type) < 0) return { ok: false, error: 'the type must be bug, idea or question' }
  const text = typeof b.message === 'string' ? b.message.trim() : ''
  if (text === '') return { ok: false, error: 'the message is empty' }
  const mask = typeof env.mask === 'function' ? env.mask : (t) => t
  const entry = { v: 1, id: env.id(), at: new Date(env.now()).toISOString(), type: b.type, message: mask(clip(text, MESSAGE_MAX)) }
  if (b.context === true) {
    const given = plain(typeof env.context === 'function' ? env.context() : null)
    const page = plain(b.page)
    const context = {}
    for (const key of ['os', 'dsh', 'revision']) if (typeof given[key] === 'string' && given[key] !== '') context[key] = mask(clip(given[key], 120))
    if (typeof page.title === 'string' && page.title !== '') context.title = mask(clip(page.title, 120))
    if (typeof page.lang === 'string' && page.lang !== '') context.lang = mask(clip(page.lang, 16))
    for (const key of ['width', 'height']) if (Number.isFinite(page[key])) context[key] = Math.max(0, Math.min(20000, Math.round(page[key])))
    entry.context = context
  }
  return { ok: true, entry }
}

const countLines = (text) => text.split('\n').filter((l) => l.trim() !== '').length

/** Appends one entry. `{ ok: true, id, count }`, or `{ ok: false, error }` — « full » when the box holds FILE_MAX bytes already. */
export function recordFeedback (home, body, env) {
  const made = entryOf(body, env)
  if (made.ok !== true) return made
  const file = feedbackFile(home)
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    let size = 0
    try { size = statSync(file).size } catch (e) { size = 0 }
    if (size >= FILE_MAX) return { ok: false, error: 'full' }
    appendFileSync(file, oneLine(made.entry), { mode: 0o600 })
    try { chmodSync(file, 0o600) } catch (e) { /* an exotic filesystem */ }
    let count = 1
    try { count = countLines(readFileSync(file, 'utf8')) } catch (e) { count = 1 }
    return { ok: true, id: made.entry.id, count }
  } catch (e) {
    return { ok: false, error: 'write failed' }
  }
}

/** The file's content for the Export button: `{ ok: true, count, text, truncated }`. An empty or missing box is a normal answer. */
export function exportFeedback (home) {
  let text = ''
  try { text = readFileSync(feedbackFile(home), 'utf8') } catch (e) { return { ok: true, count: 0, text: '', truncated: false } }
  let truncated = false
  if (text.length > EXPORT_MAX) {
    truncated = true
    const tail = text.slice(-EXPORT_MAX)
    const at = tail.indexOf('\n')
    text = at < 0 ? '' : tail.slice(at + 1)
  }
  return { ok: true, count: countLines(text), text, truncated }
}
