// The suggestions Kaby makes that wait for a click on a page: a memory, or a section of the custom instructions. (Automations and dashboards keep their own flag in their own
// store.) A ledger file of the DSH home, written atomically with mode 0600, one writer at a time. Nothing here applies anything: the page reads the ledger, shows a dashed
// card with Add / Edit / Discard, and Add goes through the page's own save (the memory route, the instructions' Save). The text is written by a model that read e-mail, so a
// text with an address, a phone number or a secret-looking link is refused here, at the door.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeLedgerFile } from './ledger-file.mjs'

export const KINDS = ['instructions', 'memory']
/** The longest text of a suggestion, and how many of a kind wait at once (a new instruction suggestion replaces the older one). */
export const LIMITS = { instructions: { text: 1500, keep: 1 }, memory: { text: 500, keep: 8 } }

const clip = (v, max) => (typeof v === 'string' ? Array.from(v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()).slice(0, max).join('') : '')

// The person's way of asking in French is language data, in a file next to this module (not UI text).
const FR = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'suggestion-lead.json'), 'utf8'))
const POLITE = '(?:(?:please|' + FR.polite + ')[ ,]+)?'
// « remember that… » / « retiens que… »: the person's way of asking, not part of the fact (a small model copies the whole sentence into the suggestion). « remember to… » is a task, not a fact: left alone.
const LEAD = new RegExp('^' + POLITE + '(?:'
  + '(?:remember|note|keep in mind|don[\'’]?t forget|do not forget|make a note|memori[sz]e|save)\\s+that\\s+'
  + '|(?:remember|note)\\s*:\\s*'
  + '|remember\\s+(?!to\\b)'
  + '|' + FR.lead
  + ')', 'i')

/** The fact of a memory suggestion: the text without the words the person asked with, first letter up. A text that is nothing but those words is kept as it is. */
export const factOf = (text) => {
  const t = typeof text === 'string' ? text.trim() : ''
  const cut = t.replace(LEAD, '').trim()
  return cut !== t && cut.length >= 3 && !/^(?:that|que|qu['’])$/i.test(cut) ? cut.charAt(0).toUpperCase() + cut.slice(1) : t
}

/** Two suggestion texts that only differ by case, spaces or the dot at the end are the same suggestion. */
export const sameText = (a, b) => {
  const n = (v) => String(v).toLowerCase().replace(/\s+/g, ' ').replace(/[\s.!?…]+$/u, '')
  return n(a) === n(b)
}

/** True when the text carries something that must not be kept as « learned from your work »: an e-mail address, a phone number, a link with a token. */
export const hasPersonalData = (text) => /[\w.+-]+@[\w-]+\.[\w.-]+/.test(text) || /\+?\d[\d ().-]{7,}\d/.test(text) || /https?:\/\/\S*[?&](token|key|secret|password)=/i.test(text)

/** The text and the proof of a suggestion, checked: `{ ok: true, text, from }` or `{ ok: false, error }`. Pure. */
export const checkSuggestion = (kind, raw) => {
  if (KINDS.indexOf(kind) < 0) return { ok: false, error: 'unknown kind' }
  const r = raw !== null && typeof raw === 'object' ? raw : {}
  const asked = clip(r.text, LIMITS[kind].text + 1)
  const text = kind === 'memory' ? factOf(asked) : asked
  if (text === '') return { ok: false, error: 'empty' }
  if (text.length > LIMITS[kind].text) return { ok: false, error: 'too long' }
  if (hasPersonalData(text)) return { ok: false, error: 'personal data' }
  const n = Number.isFinite(r.n) ? Math.max(0, Math.min(100000, Math.round(r.n))) : null
  return { ok: true, text, from: { n, span: clip(r.span, 40), where: clip(r.where, 80) } }
}

const valid = (i) => i !== null && typeof i === 'object' && typeof i.id === 'string' && KINDS.indexOf(i.kind) >= 0 && typeof i.text === 'string'

/** The ledger of one DSH home. `file` is the whole path; `now` and `newId` are injected for the tests. */
export const makeLedger = ({ file, now = () => new Date().toISOString(), newId = () => 's_' + randomBytes(5).toString('hex') }) => {
  const { read, write, serial } = makeLedgerFile({ file, valid })
  return {
    list: (kind) => read().filter((i) => kind === undefined || kind === null || i.kind === kind),
    add: (kind, raw) => serial(async () => {
      const c = checkSuggestion(kind, raw)
      if (c.ok !== true) return c
      let items = read()
      if (items.some((i) => i.kind === kind && sameText(i.text, c.text))) return { ok: false, error: 'already waiting' }
      if (LIMITS[kind].keep === 1) items = items.filter((i) => i.kind !== kind)
      else if (items.filter((i) => i.kind === kind).length >= LIMITS[kind].keep) return { ok: false, error: 'too many waiting' }
      const item = { id: newId(), kind, text: c.text, from: c.from, at: now() }
      items.push(item)
      write(items)
      return { ok: true, item }
    }),
    resolve: (id) => serial(async () => {
      const items = read()
      const hit = items.find((i) => i.id === id)
      if (hit === undefined) return { ok: false, error: 'not found' }
      write(items.filter((i) => i.id !== id))
      return { ok: true, item: hit }
    }),
  }
}
