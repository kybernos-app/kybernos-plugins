// Who decided, and on which computer: the record the chat Journal joins to the handovers of a chat.
//
// The engine's `approval/decided` event (and the answer to a question put to the person) carries neither the person nor the computer. The host sees every session event
// (`ctx.on('session/event')`), so at the moment a decision is made it writes ONE line naming the person signed in and the computer, in a small file of its own beside the chat's log.
// The engine's log is not touched, and nothing here is guessed afterwards: a decision made while nobody was recorded stays unnamed.
//
// What is recorded is what this Kybernos knows: the person signed in HERE (the person seam of the cloud bundle) and the computer it runs on. A decision made from a phone through the
// remote link is still recorded as made on this computer.
//
// Pure and dependency-light: index.js gives it the folder and a `who()` that answers `{ by, device }`.
import { appendFileSync, chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyTool, decisionKey } from './journal-story.mjs'

export { decisionKey }

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/u
const MAX_LINES = 5000
const MAX_CALLS_PER_SESSION = 400
const MAX_SESSIONS = 60

const isObj = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
const str = (v) => (typeof v === 'string' && v !== '' ? v : null)
const cut = (v, n) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, n) : null)

/** The file of one chat's decisions (`session-<id>` and `<id>` are the same chat), or null when its id is not one we would write under. */
export const decisionsFile = (dir, sessionId) => {
  const id = typeof sessionId === 'string' ? sessionId.replace(/^session-/u, '') : ''
  return typeof dir === 'string' && dir !== '' && SAFE_ID.test(id) ? join(dir, id + '.jsonl') : null
}

/** What the recorded decisions of a chat say: `{ [key]: { by, device, at } }`, the latest line of a key winning. Never throws: no file is no decision. */
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
    out[rec.key] = { by: cut(rec.by, 80), device: cut(rec.device, 80), at: typeof rec.at === 'number' && Number.isFinite(rec.at) ? rec.at : null }
  }
  return out
}

/**
 * The recorder: feed it every session event; it writes a line for each decision of a person.
 * @param opts { dir, who: () => ({ by, device }), now? }
 */
export function createRecorder (opts) {
  const o = isObj(opts) ? opts : {}
  const who = typeof o.who === 'function' ? o.who : () => ({ by: null, device: null })
  const now = typeof o.now === 'function' ? o.now : () => Date.now()
  const calls = new Map() // sessionId -> Map(callId -> tool name), to know which tool result is the answer to a question
  const done = new Map() // sessionId -> Set(key), one line per decision
  let dirReady = false

  const write = (sessionId, key, at) => {
    const file = decisionsFile(o.dir, sessionId)
    if (file === null) return false
    let seen = done.get(sessionId)
    if (seen === undefined) { seen = new Set(); done.set(sessionId, seen) }
    if (seen.has(key)) return false
    seen.add(key)
    let w = null
    try { w = who() } catch (e) { w = null }
    const by = isObj(w) ? cut(w.by, 80) : null
    const device = isObj(w) ? cut(w.device, 80) : null
    if (by === null && device === null) return false
    try {
      if (dirReady === false) { mkdirSync(o.dir, { recursive: true, mode: 0o700 }); dirReady = true }
      appendFileSync(file, JSON.stringify({ key: key, at: typeof at === 'number' ? at : now(), by: by, device: device }) + '\n', { mode: 0o600 })
      try { chmodSync(file, 0o600) } catch (e) { /* not ours to change */ }
      return true
    } catch (e) { return false }
  }

  const ingest = (sessionId, event) => {
    try {
      if (typeof sessionId !== 'string' || isObj(event) === false) return false
      const type = typeof event.type === 'string' ? event.type : ''
      const data = isObj(event.data) ? event.data : {}
      const at = typeof event.time === 'number' ? event.time : null
      if (type === 'tool/call') {
        const id = str(data.callId)
        const name = str(data.name)
        if (id === null || name === null || classifyTool(name).kind !== 'handover') return false
        let m = calls.get(sessionId)
        if (m === undefined) {
          if (calls.size >= MAX_SESSIONS) { calls.delete(calls.keys().next().value); done.delete(done.keys().next().value) }
          m = new Map()
          calls.set(sessionId, m)
        }
        if (m.size >= MAX_CALLS_PER_SESSION) m.delete(m.keys().next().value)
        m.set(id, name)
        return false
      }
      if (type === 'tool/result') {
        const msg = isObj(data.message) ? data.message : {}
        const id = str(msg.toolCallId) !== null ? str(msg.toolCallId) : (isObj(msg.source) ? str(msg.source.callId) : null)
        const m = calls.get(sessionId)
        if (id === null || m === undefined || m.has(id) === false) return false
        m.delete(id)
        return write(sessionId, decisionKey('question', id), at)
      }
      if (type === 'approval/decided') {
        const id = str(data.id)
        // An engine that names the decider itself is believed over this record.
        if (id === null || str(data.by) !== null) return false
        return write(sessionId, decisionKey('permission', id), at)
      }
    } catch (e) { /* a recorder never breaks a session */ }
    return false
  }
  return { ingest: ingest }
}
