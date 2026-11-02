// A simple seal on each decision of the chat Journal: « this person, on this computer, decided THIS, then ».
//
// The seal is an Ed25519 signature, made by the host at the moment of the decision with a key that never leaves this computer, over: the chat, the decision, WHAT was asked (a digest of the
// permission's tool and reason, or of the question and its choices), WHAT was answered (the outcome, or a digest of the answer), who, which computer and when.
// The Journal checks it each time it is drawn, against the chat's own log: if the log or the record of the decision was edited afterwards, the seal no longer matches and is shown as broken.
//
// What it is NOT: a qualified electronic signature. It needs no third party, so it proves that nothing changed AFTER the decision by someone who does not hold the key file; whoever
// can read this user's `~/.dsh` can still forge one. A decision made while nobody was signed in, or before this existed, carries no seal.
//
// The tracker below is the one reading of a log that both sides use (the recorder live, the checker over the whole log), so they can never disagree about what a decision was.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { classifyTool, decisionKey, parseArgs, resultOf } from './journal-story.mjs'

const VERSION = 'kybernos-journal-seal/1'
const TEXT_MAX = 2000
const MAX_PENDING = 400

const isObj = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
const str = (v) => (typeof v === 'string' && v !== '' ? v : null)
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

/** The chat a decision belongs to: `session-<id>` and `<id>` are the same chat. */
export const sessionKey = (sessionId) => (typeof sessionId === 'string' ? sessionId.replace(/^session-/u, '') : '')

/** The digest of what was asked of the person. */
export const subjectOf = (source, tool, text) => sha(JSON.stringify([source, tool, typeof text === 'string' ? text.slice(0, TEXT_MAX) : '']))

/** The bytes that are signed: a fixed-order array, so two readers of the same facts always sign the same text. */
export const sealPayload = (f) => JSON.stringify([VERSION, sessionKey(f.session), f.key, f.subject, f.outcome, f.by === undefined ? null : f.by, f.device === undefined ? null : f.device, f.at === undefined ? null : f.at])

/**
 * The key of this computer: `{ keyId, publicKey (PEM), sign(payload) → base64 }`, or null when there is none (read) or none could be made (write).
 * With `create: true` a missing key is made once (file 0600, folder 0700); a damaged key file is never overwritten, it yields null.
 */
export function loadSealKey (file, opts) {
  try {
    if (typeof file !== 'string' || file === '') return null
    let rec = null
    try { rec = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { rec = null }
    if (rec === null) {
      if (isObj(opts) === false || opts.create !== true) return null
      const pair = generateKeyPairSync('ed25519')
      const fresh = { v: 1, alg: 'ed25519', created: new Date().toISOString(), publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) }
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      try {
        writeFileSync(file, JSON.stringify(fresh), { mode: 0o600, flag: 'wx' })
      } catch (e) {
        // Another process made it first: use theirs. Anything else (read-only disk): no seal.
        if (e !== null && typeof e === 'object' && e.code === 'EEXIST') return loadSealKey(file, null)
        return null
      }
      try { chmodSync(file, 0o600) } catch (e) { /* not ours to change */ }
      rec = fresh
    }
    if (isObj(rec) === false || rec.alg !== 'ed25519' || typeof rec.publicKey !== 'string') return null
    const keyId = sha(createPublicKey(rec.publicKey).export({ type: 'spki', format: 'der' }).toString('base64')).slice(0, 16)
    const priv = typeof rec.privateKey === 'string' ? createPrivateKey(rec.privateKey) : null
    return {
      keyId: keyId,
      publicKey: rec.publicKey,
      sign: (payload) => { if (priv === null) throw new Error('no private key'); return nodeSign(null, Buffer.from(payload, 'utf8'), priv).toString('base64') },
    }
  } catch (e) { return null }
}

/** Whether `sig` (base64) is the signature of `payload` under the public key (PEM). Never throws. */
export function verifySeal (publicKey, payload, sig) {
  try { return nodeVerify(null, Buffer.from(payload, 'utf8'), createPublicKey(publicKey), Buffer.from(sig, 'base64')) === true } catch (e) { return false }
}

/**
 * The reading of one chat's log that yields each decision as it completes: `{ key, subject, outcome, at, named }`.
 * `subject` is null when the question was not seen (the tracker started after it); `named` is true when the engine itself named the decider.
 */
export function createDecisionTracker () {
  const asked = new Map() // approval id → subject
  const calls = new Map() // call id → subject of the question put to the person
  const keep = (map, k, v) => { if (map.size >= MAX_PENDING) map.delete(map.keys().next().value); map.set(k, v) }
  return {
    ingest: (event) => {
      try {
        if (isObj(event) === false) return null
        const type = typeof event.type === 'string' ? event.type : ''
        const data = isObj(event.data) ? event.data : {}
        const at = typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : null
        if (type === 'approval/asked') {
          const id = str(data.id)
          if (id !== null) keep(asked, id, subjectOf('permission', str(data.toolName) !== null ? data.toolName : '', typeof data.reason === 'string' ? data.reason : ''))
          return null
        }
        if (type === 'approval/decided') {
          const id = str(data.id)
          if (id === null) return null
          const subject = asked.has(id) ? asked.get(id) : null
          return { key: decisionKey('permission', id), subject: subject, outcome: typeof data.outcome === 'string' ? data.outcome : '', at: at, named: str(data.by) !== null }
        }
        if (type === 'tool/call') {
          const id = str(data.callId)
          const name = str(data.name)
          if (id === null || name === null || classifyTool(name).kind !== 'handover') return null
          const args = parseArgs(data.arguments)
          const qs = args !== null && Array.isArray(args.questions) ? args.questions.filter((q) => isObj(q)) : []
          const q = qs.length > 0 ? qs[0] : {}
          const labels = Array.isArray(q.options) ? q.options.filter((x) => isObj(x) && typeof x.label === 'string').slice(0, 6).map((x) => x.label) : []
          keep(calls, id, subjectOf('question', name, JSON.stringify([typeof q.question === 'string' ? q.question : (typeof q.header === 'string' ? q.header : ''), labels, qs.length])))
          return null
        }
        if (type === 'tool/result') {
          const r = resultOf(data)
          if (r.callId === null || calls.has(r.callId) === false) return null
          const subject = calls.get(r.callId)
          calls.delete(r.callId)
          return { key: decisionKey('question', r.callId), subject: subject, outcome: (r.isError ? 'error:' : 'answer:') + sha(r.text === null ? '' : r.text), at: at, named: false }
        }
      } catch (e) { /* a tracker never breaks its caller */ }
      return null
    },
  }
}

/**
 * Check every sealed decision of a chat against its log. `decisions` is what the recorder wrote (`readDecisions`), `key` the key of this computer (or null).
 * Returns `{ [decisionKey]: 'valid' | 'broken' | 'foreign' }`; a decision with no seal is not in it.
 */
export function verifyDecisions (events, decisions, sessionId, key) {
  const states = {}
  const list = isObj(decisions) ? decisions : {}
  const sealed = Object.keys(list).filter((k) => isObj(list[k]) && typeof list[k].sig === 'string')
  if (sealed.length === 0) return states
  const facts = {}
  const tracker = createDecisionTracker()
  const evs = Array.isArray(events) ? events : []
  for (let i = 0; i < evs.length; i += 1) {
    const f = tracker.ingest(evs[i])
    if (f !== null) facts[f.key] = f
  }
  for (let i = 0; i < sealed.length; i += 1) {
    const k = sealed[i]
    const rec = list[k]
    if (key === null || key === undefined || rec.kid !== key.keyId) { states[k] = 'foreign'; continue }
    const f = facts[k]
    if (f === undefined || f.subject === null) { states[k] = 'broken'; continue }
    states[k] = verifySeal(key.publicKey, sealPayload({ session: sessionId, key: k, subject: f.subject, outcome: f.outcome, by: rec.by, device: rec.device, at: f.at }), rec.sig) ? 'valid' : 'broken'
  }
  return states
}
