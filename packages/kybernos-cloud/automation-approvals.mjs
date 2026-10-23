// An automation that asks first, running on a cloud computer: what its gate does with a call, what it remembers on the volume, and what the run is told when the person has answered
// (ADR 0052 § 15). Pure and dependency-light: index.js gives it the records of a run and the clock, and does the calls to the platform and to the session.
//
// The run does not wait for the answer: a person may take hours, and a machine kept awake for it would cost the person's run hours and never sleep. So the gate asks the platform, then
// REFUSES the call with « stop and wait »; the run ends (the schedule row says `waiting_approval`); the machine may sleep. The answer is fetched later (the platform wakes the machine for it)
// and the SAME session is continued with one message: what was allowed, or that it was refused. The records below are what survives the sleep.
//
// A record holds the action's text (a command line, a path, a connector's call): it stays on the computer's own volume, 0600, and is dropped three days after it was asked.
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Most questions one run puts to its person. From the next one it is told to finish with what it has and say what it would need. */
export const MAX_ASKS = 3
/** A record is dropped this long after it was asked (a decision older than that was taken long ago). */
export const KEEP_MS = 3 * 86_400_000
export const MAX_ITEMS = 200
export const STATES = Object.freeze(['pending', 'allowed', 'allowed_turn', 'denied', 'expired'])
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const SAFE = /^[A-Za-z0-9_.:-]{1,80}$/u

/** The action as the gate knows it: its kind and its text with the spaces collapsed, hashed. An « allow once » is matched on this and on nothing looser. */
export const actionKey = (kind, summary) => createHash('sha256').update(String(kind) + '\n' + String(summary).replace(/\s+/gu, ' ').trim()).digest('hex').slice(0, 32)

const valid = (r) => r !== null && typeof r === 'object' && typeof r.id === 'string' && ID.test(r.id) && typeof r.sessionId === 'string' && SAFE.test(r.sessionId) && STATES.indexOf(r.state) >= 0 && typeof r.key === 'string'

/** The records on the volume; none when the file is not there or not ours. */
export const readItems = (file) => {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return j !== null && typeof j === 'object' && Array.isArray(j.items) ? j.items.filter(valid) : []
  } catch (e) { return [] }
}

/** Writes them whole, atomically, 0600; the oldest and the stale go first. */
export const writeItems = (file, items, nowMs = Date.now()) => {
  const kept = items.filter((r) => valid(r) && nowMs - Date.parse(r.askedAt) < KEEP_MS).slice(-MAX_ITEMS)
  mkdirSync(dirname(file), { recursive: true })
  const temp = file + '.tmp-' + String(process.pid)
  writeFileSync(temp, JSON.stringify({ v: 1, items: kept }), { mode: 0o600 })
  renameSync(temp, file)
  try { chmodSync(file, 0o600) } catch (e) { /* the mode was set at creation */ }
  return kept
}

/**
 * What the gate does with one call of a run that asks first, from the records of that run and the call's key:
 *   pass          the person allowed the rest of the run, or this very action once (`use` is the record to mark used);
 *   deny waiting  a question of this run is still waiting: nothing else is asked, the run stops;
 *   deny refused  the person already refused this very action, or it ran out unanswered: it is not asked again;
 *   deny many     the run has asked its limit;
 *   ask           the platform is asked.
 */
export const verdict = (mine, key) => {
  if (mine.some((r) => r.state === 'allowed_turn')) return { kind: 'pass' }
  const once = mine.find((r) => r.state === 'allowed' && r.used !== true && r.key === key)
  if (once !== undefined) return { kind: 'pass', use: once.id }
  if (mine.some((r) => r.state === 'pending')) return { kind: 'deny', why: 'waiting' }
  if (mine.some((r) => (r.state === 'denied' || r.state === 'expired') && r.key === key)) return { kind: 'deny', why: 'refused' }
  if (mine.length >= MAX_ASKS) return { kind: 'deny', why: 'many' }
  return { kind: 'ask' }
}

/** What the model is told when a call is refused. It must stop: nothing here invites it to try again or to go round. */
export const denyReason = (why) => {
  if (why === 'waiting') return 'The person must allow this first, and the answer can take hours. It has been asked. Do not try this or anything else that changes something: say in one short sentence what you wanted to do, and stop. You will be told when to go on.'
  if (why === 'refused') return 'The person did not allow this action. Do not try it again, and do not look for another way to do the same thing: say so in your answer.'
  if (why === 'many') return 'You have already asked the person ' + String(MAX_ASKS) + ' times in this task. Do not ask again: say what you could not do and what you would need them to allow, and stop.'
  if (why === 'nobody') return 'Nobody can answer here: ask the question in your reply to the person, in one short message, and stop.'
  return 'The person could not be asked, so this action was not done. Do not try it again: say so in your answer.'
}

const quote = (summary) => '« ' + String(summary).replace(/\s+/gu, ' ').trim().slice(0, 400) + ' »'

/** The one message a run is continued with once its question was answered. The action is quoted as data: it is what the run itself asked to do. */
export const continuationText = (state, summary) => {
  if (state === 'allowed') return 'The person allowed this action: ' + quote(summary) + '. Do it now, then carry on with the task.'
  if (state === 'allowed_turn') return 'The person allowed what you ask for the rest of this task, starting with: ' + quote(summary) + '. Do it now, then carry on with the task.'
  if (state === 'expired') return 'The person did not answer in time, so this action was refused: ' + quote(summary) + '. Do not try it again or look for another way. Finish the task without it and say plainly in your answer what you could not do.'
  return 'The person refused this action: ' + quote(summary) + '. Do not try it again or look for another way. Finish the task without it and say plainly in your answer what you could not do.'
}

/** The records of one run, in the order they were asked. */
export const ofRun = (items, sessionId) => items.filter((r) => r.sessionId === sessionId).sort((a, b) => Date.parse(a.askedAt) - Date.parse(b.askedAt))

/** What the decided list says, once for each id: the answer, and the record it belongs to when this volume has not acted on it yet (else null). */
export const toContinue = (items, decided) => {
  const out = []
  const seen = new Set()
  for (const d of Array.isArray(decided) ? decided : []) {
    if (d === null || typeof d !== 'object' || typeof d.id !== 'string' || ID.test(d.id) !== true || seen.has(d.id)) continue
    seen.add(d.id)
    if (['allowed', 'allowed_turn', 'denied', 'expired'].indexOf(d.state) < 0) continue
    const rec = items.find((r) => r.id === d.id)
    out.push({ id: d.id, state: d.state, record: rec === undefined || rec.continued === true ? null : rec })
  }
  return out
}
