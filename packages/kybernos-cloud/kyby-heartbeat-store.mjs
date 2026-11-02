// Where Kaby's wake-ups live on this computer: three files of <DSH home>/kybernos, written by the host only (mode 0600, replaced atomically).
//   kyby-heartbeat.json        the signed rhythm (kyby-heartbeat.mjs), written by the Settings route and by nothing else.
//   kyby-heartbeat-state.json  when the last wake-up started and how it ended, and when the person last wrote to Kaby (so that a wake-up never starts over their words).
//   kyby-heartbeat-audit.jsonl one line per signature and per wake-up, started and ended. Trimmed when it grows.
// Every method is safe to call from a hook: none throws, and a file that cannot be read means no wake-ups, never more of them.
import { join } from 'node:path'
import { appendAudit, readJson, writeJson } from './kyby-files.mjs'
import { describe, dueNow, inForce, nextDueAt, readRequest, sign, verify, wakeText } from './kyby-heartbeat.mjs'

const TEXT_TTL_MS = 1000
const OUTCOMES = new Set(['running', 'done', 'time', 'blocked', 'person', 'refused', 'error', 'interrupted'])

/**
 * @param deps { home: () => string (the DSH home), secret: () => Buffer | null (the machine secret), now?: () => number }
 */
export function createHeartbeatStore (deps) {
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const dir = () => join(deps.home(), 'kybernos')
  const recordFile = () => join(dir(), 'kyby-heartbeat.json')
  const stateFile = () => join(dir(), 'kyby-heartbeat-state.json')
  const auditFile = () => join(dir(), 'kyby-heartbeat-audit.jsonl')
  const secret = () => { try { return deps.secret() } catch (e) { return null } }
  const record = () => readJson(recordFile())
  const state = () => { const s = readJson(stateFile()); return s !== null && typeof s === 'object' && !Array.isArray(s) ? s : {} }
  const patchState = (patch) => { try { writeJson(stateFile(), { ...state(), ...patch }) } catch (e) { /* the state is a convenience: a wake-up does not depend on writing it */ } }
  const audit = (event) => appendAudit(auditFile(), now(), event)
  let cached = { at: 0, running: null, text: '' }

  return {
    /** What the Settings page shows. */
    view () { return describe(record(), secret(), state(), now()) },
    /**
     * The person's request from the Settings page (the route has checked the origin and the signed session): the new record is the old fields with the request over them.
     * Signing starts the clock again: the next wake-up is one interval after it, not at once.
     * @returns { ok: true, view } or { ok: false, error }
     */
    set (raw) {
      try {
        const old = record()
        const base = verify(old, secret()).ok === true ? old : null
        const req = readRequest(raw, base)
        if (req.ok !== true) return { ok: false, error: req.error }
        const signed = sign(req.fields, secret(), now())
        if (signed.ok !== true) return { ok: false, error: signed.error }
        writeJson(recordFile(), signed.record)
        cached = { at: 0, running: null, text: '' }
        const v = describe(signed.record, secret(), state(), now())
        audit({ kind: 'signed', preset: v.preset, on: v.on, everyHours: v.everyHours, boxMin: v.boxMin, items: v.items, quiet: v.quiet, paused: v.paused })
        return { ok: true, view: v }
      } catch (e) { return { ok: false, error: 'write_failed' } }
    },
    /** The record when it is in force (signed, on, not paused), else null: what the runner needs to start a wake-up. */
    active () { const r = record(); return inForce(r, secret()).ok === true ? r : null },
    /** `{ due, why }` for the runner's tick. */
    due () { return dueNow(record(), secret(), state(), now()) },
    nextAt () { return nextDueAt(record(), secret(), state(), now()) },
    state,
    /** A wake-up started: its time is kept at once, so that a restart in the middle does not start another. */
    started (at) { patchState({ lastAt: at, lastOutcome: 'running' }); audit({ kind: 'started' }) },
    /** A wake-up ended, with a closed word for how. */
    ended (outcome, extra) {
      const word = OUTCOMES.has(outcome) ? outcome : 'error'
      patchState({ lastOutcome: word, lastEndedAt: now() })
      audit({ kind: 'ended', outcome: word, ...(extra !== null && typeof extra === 'object' ? extra : {}) })
    },
    /** The person's words reached Kaby's chat. */
    personSpoke (at) { patchState({ lastPersonAt: at }) },
    /** A restart found a wake-up marked as running that nothing is running. */
    settleStale () { if (state().lastOutcome === 'running') patchState({ lastOutcome: 'interrupted', lastEndedAt: now() }) },
    /** The block for Kaby's prompt, or ''. Read at most once a second per state of `running`. */
    text (running) {
      try {
        const t = now()
        if (t - cached.at < TEXT_TTL_MS && cached.running === (running === true)) return cached.text
        cached = { at: t, running: running === true, text: wakeText(record(), secret(), running === true) }
      } catch (e) { cached = { at: 0, running: null, text: '' } }
      return cached.text
    },
    files: { record: recordFile, state: stateFile, audit: auditFile }
  }
}
