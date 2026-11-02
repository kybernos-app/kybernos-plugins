// Who decided, and on which computer: the record the chat Journal joins to the handovers of a chat.
//
// The engine's `approval/decided` event (and the answer to a question put to the person) carries neither the person nor the computer. The host sees every session event
// (`ctx.on('session/event')`), so at the moment a decision is made it writes ONE line naming the person signed in and the computer, in a small file of its own beside the chat's log,
// and seals it (journal-seal.mjs) when a key is available. The engine's log is not touched, and nothing here is guessed afterwards: a decision made while nobody was recorded stays unnamed.
//
// What is recorded is what this Kybernos knows: the person signed in HERE (the person seam of the cloud bundle) and the computer it runs on. A decision made from a phone through the
// remote link is still recorded as made on this computer.
//
// Pure and dependency-light: index.js gives it the folder, a `who()` that answers `{ by, device }` and a `seal()` that answers the key of this computer (or null).
import { appendFileSync, chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDecisionTracker, sealPayload, sessionKey } from './journal-seal.mjs'
import { decisionKey } from './journal-story.mjs'

export { decisionKey }

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/u
const MAX_LINES = 5000
const MAX_SESSIONS = 60

const isObj = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
const str = (v) => (typeof v === 'string' && v !== '' ? v : null)
const cut = (v, n) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, n) : null)

/** The file of one chat's decisions (`session-<id>` and `<id>` are the same chat), or null when its id is not one we would write under. */
export const decisionsFile = (dir, sessionId) => {
  const id = sessionKey(sessionId)
  return typeof dir === 'string' && dir !== '' && SAFE_ID.test(id) ? join(dir, id + '.jsonl') : null
}

/** What the recorded decisions of a chat say: `{ [key]: { by, device, at, kid, sig } }`, the latest line of a key winning. Never throws: no file is no decision. */
export function readDecisions (dir, sessionId) {
  const out = {}
  const file = decisionsFile(dir, sessionId)
  if (file === null) return out
  let raw = ''
  try { raw = readFileSync(file, 'utf8') } catch (e) { return out }
  const lines = raw.split('\n')
  for (let i = Math.max(0, lines.length - MAX_LINES); i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue
    let rec = null
    try { rec = JSON.parse(lines[i]) } catch (e) { continue }
    if (isObj(rec) === false || str(rec.key) === null) continue
    out[rec.key] = {
      by: cut(rec.by, 80), device: cut(rec.device, 80), at: typeof rec.at === 'number' && Number.isFinite(rec.at) ? rec.at : null,
      kid: cut(rec.kid, 40), sig: typeof rec.sig === 'string' && rec.sig.length <= 200 ? rec.sig : null,
    }
  }
  return out
}

/**
 * The recorder: feed it every session event; it writes a line for each decision of a person.
 * @param opts { dir, who: () => ({ by, device }), seal?: () => key | null, now? }
 */
export function createRecorder (opts) {
  const o = isObj(opts) ? opts : {}
  const who = typeof o.who === 'function' ? o.who : () => ({ by: null, device: null })
  const sealKey = typeof o.seal === 'function' ? o.seal : () => null
  const now = typeof o.now === 'function' ? o.now : () => Date.now()
  const trackers = new Map() // sessionId -> the reading of that chat's log, to know what each decision was about
  const done = new Map() // sessionId -> Set(key), one line per decision
  let dirReady = false

  const write = (sessionId, facts) => {
    const file = decisionsFile(o.dir, sessionId)
    if (file === null) return false
    let seen = done.get(sessionId)
    if (seen === undefined) { seen = new Set(); done.set(sessionId, seen) }
    if (seen.has(facts.key)) return false
    seen.add(facts.key)
    let w = null
    try { w = who() } catch (e) { w = null }
    const by = isObj(w) ? cut(w.by, 80) : null
    const device = isObj(w) ? cut(w.device, 80) : null
    if (by === null && device === null) return false
    const line = { key: facts.key, at: facts.at !== null ? facts.at : now(), by: by, device: device }
    // Sealed only when what was asked is known: a seal over « something » would prove nothing.
    if (facts.subject !== null) {
      try {
        const key = sealKey()
        if (key !== null && key !== undefined) {
          line.kid = key.keyId
          line.sig = key.sign(sealPayload({ session: sessionId, key: facts.key, subject: facts.subject, outcome: facts.outcome, by: by, device: device, at: facts.at }))
        }
      } catch (e) { delete line.kid; delete line.sig }
    }
    try {
      if (dirReady === false) { mkdirSync(o.dir, { recursive: true, mode: 0o700 }); dirReady = true }
      appendFileSync(file, JSON.stringify(line) + '\n', { mode: 0o600 })
      try { chmodSync(file, 0o600) } catch (e) { /* not ours to change */ }
      return true
    } catch (e) { return false }
  }

  const ingest = (sessionId, event) => {
    try {
      if (typeof sessionId !== 'string' || isObj(event) === false) return false
      let tracker = trackers.get(sessionId)
      if (tracker === undefined) {
        if (trackers.size >= MAX_SESSIONS) { const oldest = trackers.keys().next().value; trackers.delete(oldest); done.delete(oldest) }
        tracker = createDecisionTracker()
        trackers.set(sessionId, tracker)
      }
      const facts = tracker.ingest(event)
      // An engine that names the decider itself is believed over this record.
      if (facts === null || facts.named === true) return false
      return write(sessionId, facts)
    } catch (e) { /* a recorder never breaks a session */ }
    return false
  }
  return { ingest: ingest }
}
