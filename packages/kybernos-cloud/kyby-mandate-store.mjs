// Where Kaby's mandate lives on this computer: three files of <DSH home>/kybernos, written by the host only (mode 0600, replaced atomically).
//   kyby-mandate.json        the signed record (kyby-mandate.mjs), written by the Settings route and by nothing else.
//   kyby-mandate-usage.json  the day's count of what ran without a question, counted here and not by Kaby.
//   kyby-mandate-audit.jsonl one line per signature and per action that ran under it, so « what did you let it do » has an answer. Trimmed when it grows.
// Every method is safe to call from a hook: none throws, and a file that cannot be read means no mandate, never a permissive one.
import { appendFileSync, chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { countUse, decide, describe, mandateText, readRequest, sign, usageOf, verify } from './kyby-mandate.mjs'

const AUDIT_MAX_BYTES = 256 * 1024
const AUDIT_KEEP_LINES = 500
const TEXT_TTL_MS = 1000
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,80}$/u

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return null } }
const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(value) + '\n', { mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch (e) { /* a filesystem with no modes */ }
  renameSync(tmp, file)
}

/**
 * @param deps { home: () => string (the DSH home), secret: () => Buffer | null (the machine secret), now?: () => number }
 */
export function createMandateStore (deps) {
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const dir = () => join(deps.home(), 'kybernos')
  const recordFile = () => join(dir(), 'kyby-mandate.json')
  const usageFile = () => join(dir(), 'kyby-mandate-usage.json')
  const auditFile = () => join(dir(), 'kyby-mandate-audit.jsonl')
  const secret = () => { try { return deps.secret() } catch (e) { return null } }
  let cached = { at: 0, text: '' }

  const audit = (event) => {
    try {
      const file = auditFile()
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, JSON.stringify({ at: new Date(now()).toISOString(), ...event }) + '\n', { mode: 0o600 })
      if (statSync(file).size > AUDIT_MAX_BYTES) {
        const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l !== '')
        writeFileSync(file, lines.slice(-AUDIT_KEEP_LINES).join('\n') + '\n', { mode: 0o600 })
      }
    } catch (e) { /* the audit never stops a turn */ }
  }

  return {
    /** What the Settings page shows. */
    view () {
      return describe(readJson(recordFile()), secret(), readJson(usageFile()), now())
    },
    /**
     * The person's request from the Settings page (the route has checked the origin and the signed session): the new record is the old fields with the request over them.
     * @returns { ok: true, view } or { ok: false, error }
     */
    set (raw) {
      try {
        const old = readJson(recordFile())
        const base = verify(old, secret()).ok === true ? old : null
        const req = readRequest(raw, base)
        if (req.ok !== true) return { ok: false, error: req.error }
        const signed = sign(req.fields, secret(), now())
        if (signed.ok !== true) return { ok: false, error: signed.error }
        writeJson(recordFile(), signed.record)
        cached = { at: 0, text: '' }
        const v = describe(signed.record, secret(), readJson(usageFile()), now())
        audit({ kind: 'signed', preset: v.preset, memory: v.memory, computer: v.computer, memoryPerDay: v.memoryPerDay, computerPerDay: v.computerPerDay, paused: v.paused })
        return { ok: true, view: v }
      } catch (e) { return { ok: false, error: 'write_failed' } }
    },
    /**
     * Called by the native gate for a tool of ours in Kaby's chat: true when the mandate covers it right now, in which case the use is counted and written down.
     * A false is the old behaviour (the question).
     */
    allow (toolName, sessionId) {
      try {
        const t = now()
        const verdict = decide(readJson(recordFile()), secret(), readJson(usageFile()), toolName, t)
        if (verdict.allow !== true) return { allow: false, why: verdict.why }
        writeJson(usageFile(), countUse(readJson(usageFile()), verdict.klass, t))
        audit({ kind: 'ran', tool: toolName, klass: verdict.klass, session: typeof sessionId === 'string' && SAFE_ID.test(sessionId) ? sessionId : null })
        return { allow: true, why: 'covered' }
      } catch (e) { return { allow: false, why: 'error' } }
    },
    /** The block for Kaby's prompt, or ''. Read at most once a second. */
    text () {
      try {
        const t = now()
        if (t - cached.at < TEXT_TTL_MS) return cached.text
        cached = { at: t, text: mandateText(readJson(recordFile()), secret()) }
      } catch (e) { cached = { at: 0, text: '' } }
      return cached.text
    },
    /** Today's use, for tests and the page. */
    usage () { return usageOf(readJson(usageFile()), now()) },
    files: { record: recordFile, usage: usageFile, audit: auditFile }
  }
}
