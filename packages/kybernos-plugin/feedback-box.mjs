// The feedback box (V-10): what a person writes in the « Send feedback » form is appended, as ONE JSON line, to
// <DSH home>/kybernos/feedback.jsonl by « Save ». Nothing is sent anywhere by that: the file is what the owner reads, or what the
// person exports (copies to the clipboard) and passes on himself. « Send » (a signed-in person's way to the team) is the other door:
// `relayReportOf` turns the same form into the report the server's relay takes, and index.js posts it with the device token, through
// the beta-feedback sender that the skill report-feedback and its tool kybernos_report_feedback already use.
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
    const context = {}
    for (const key of ['os', 'dsh', 'revision']) if (typeof given[key] === 'string' && given[key] !== '') context[key] = mask(clip(given[key], 120))
    Object.assign(context, pageFacts(b.page, mask))
    entry.context = context
  }
  return { ok: true, entry }
}

/** The page facts a form may carry (title, language, window size), masked and bounded: the same for the box and for the relay. */
function pageFacts (value, mask) {
  const page = plain(value)
  const facts = {}
  if (typeof page.title === 'string' && page.title !== '') facts.title = mask(clip(page.title, 120))
  if (typeof page.lang === 'string' && page.lang !== '') facts.lang = mask(clip(page.lang, 16))
  for (const key of ['width', 'height']) if (Number.isFinite(page[key])) facts[key] = Math.max(0, Math.min(20000, Math.round(page[key])))
  return facts
}

/** The longest title made of a message's first line (the server accepts 160; a title is a headline). */
export const TITLE_MAX = 80

/** A message's first non-blank line as a headline: whitespace collapsed, cut at a word boundary (else hard) with an ellipsis past TITLE_MAX. */
const headline = (text) => {
  const first = text.split(/\r\n|\n|\r/).map((l) => l.replace(/\s+/g, ' ').trim()).find((l) => l !== '')
  const line = first === undefined ? '' : first
  if (line.length <= TITLE_MAX) return line
  const room = line.slice(0, TITLE_MAX - 1)
  const space = room.lastIndexOf(' ')
  return (space >= 20 ? room.slice(0, space) : room).trimEnd() + '…'
}

/**
 * The report the server's relay takes (POST /v1/feedback, kinds bug | feature) from what the form sent, or the reason it is refused.
 *   body  the form's own: { type: 'bug' | 'idea' | 'question', message, context?: true, page?: { title, lang, width, height } }
 *   env   { mask(text): text }
 * `input` is what the host's beta-feedback sender (kbFeedbackReport) takes: an idea is a `feature`, a question is a `feature` whose title says so
 * (the relay knows two kinds), the title is the message's first line and the body the whole message — both masked. `client` says whether
 * the technical sheet (system, DSH and Kybernos versions) may go: only when the form's toggle was on, which is also the only time the page
 * facts are added to the body. Nothing about the machine, the page or the language leaves otherwise.
 */
export function relayReportOf (body, env) {
  const b = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : null
  if (b === null) return { ok: false, error: 'a JSON object is expected' }
  if (FEEDBACK_TYPES.indexOf(b.type) < 0) return { ok: false, error: 'the type must be bug, idea or question' }
  const text = typeof b.message === 'string' ? b.message.trim() : ''
  if (text === '') return { ok: false, error: 'the message is empty' }
  const mask = env !== null && env !== undefined && typeof env.mask === 'function' ? env.mask : (t) => t
  const message = mask(clip(text, MESSAGE_MAX)).trim()
  const withDetails = b.context === true
  const facts = withDetails ? pageFacts(b.page, mask) : {}
  const lines = []
  if (facts.title !== undefined) lines.push('Page: ' + facts.title)
  if (facts.lang !== undefined) lines.push('Language: ' + facts.lang)
  if (facts.width !== undefined && facts.height !== undefined) lines.push('Window: ' + String(facts.width) + ' x ' + String(facts.height))
  const title = headline(message)
  return {
    ok: true,
    input: {
      kind: b.type === 'bug' ? 'bug' : 'feature',
      title: b.type === 'question' ? headline('Question: ' + title) : title,
      body: lines.length === 0 ? message : message + '\n\nTechnical details (added by the sender)\n' + lines.join('\n'),
    },
    client: withDetails,
  }
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
