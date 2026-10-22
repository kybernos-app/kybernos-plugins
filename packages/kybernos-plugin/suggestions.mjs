// The suggestions Kaby makes that wait for a click on a page: a memory, or a section of the custom instructions. (Automations and dashboards keep their own flag in their own
// store.) A ledger file of the DSH home, written atomically with mode 0600, one writer at a time. Nothing here applies anything: the page reads the ledger, shows a dashed
// card with Add / Edit / Discard, and Add goes through the page's own save (the memory route, the instructions' Save). The text is written by a model that read e-mail, so a
// text with an address, a phone number or a secret-looking link is refused here, at the door.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

export const KINDS = ['instructions', 'memory']
/** The longest text of a suggestion, and how many of a kind wait at once (a new instruction suggestion replaces the older one). */
export const LIMITS = { instructions: { text: 1500, keep: 1 }, memory: { text: 500, keep: 8 } }

const clip = (v, max) => (typeof v === 'string' ? Array.from(v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()).slice(0, max).join('') : '')

/** True when the text carries something that must not be kept as « learned from your work »: an e-mail address, a phone number, a link with a token. */
export const hasPersonalData = (text) => /[\w.+-]+@[\w-]+\.[\w.-]+/.test(text) || /\+?\d[\d ().-]{7,}\d/.test(text) || /https?:\/\/\S*[?&](token|key|secret|password)=/i.test(text)

/** The text and the proof of a suggestion, checked: `{ ok: true, text, from }` or `{ ok: false, error }`. Pure. */
export const checkSuggestion = (kind, raw) => {
  if (KINDS.indexOf(kind) < 0) return { ok: false, error: 'unknown kind' }
  const r = raw !== null && typeof raw === 'object' ? raw : {}
  const text = clip(r.text, LIMITS[kind].text + 1)
  if (text === '') return { ok: false, error: 'empty' }
  if (text.length > LIMITS[kind].text) return { ok: false, error: 'too long' }
  if (hasPersonalData(text)) return { ok: false, error: 'personal data' }
  const n = Number.isFinite(r.n) ? Math.max(0, Math.min(100000, Math.round(r.n))) : null
  return { ok: true, text, from: { n, span: clip(r.span, 40), where: clip(r.where, 80) } }
}

const valid = (i) => i !== null && typeof i === 'object' && typeof i.id === 'string' && KINDS.indexOf(i.kind) >= 0 && typeof i.text === 'string'

/** The ledger of one DSH home. `file` is the whole path; `now` and `newId` are injected for the tests. */
export const makeLedger = ({ file, now = () => new Date().toISOString(), newId = () => 's_' + randomBytes(5).toString('hex') }) => {
  let chain = Promise.resolve()
  const read = () => {
    try { const j = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(j.items) ? j.items.filter(valid) : [] } catch (e) { return [] }
  }
  const write = (items) => {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = file + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2), { mode: 0o600 })
    renameSync(tmp, file)
  }
  const serial = (fn) => { const run = chain.then(fn, fn); chain = run.then(() => null, () => null); return run }
  return {
    list: (kind) => read().filter((i) => kind === undefined || kind === null || i.kind === kind),
    add: (kind, raw) => serial(async () => {
      const c = checkSuggestion(kind, raw)
      if (c.ok !== true) return c
      let items = read()
      if (items.some((i) => i.kind === kind && i.text.toLowerCase() === c.text.toLowerCase())) return { ok: false, error: 'already waiting' }
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
