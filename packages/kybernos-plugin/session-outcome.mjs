// How the last turn of a session ended, from the engine's own journal events.
//
// The Automations board files a run by what the engine says about its session (running, waiting, ended). « Ended »
// also covers a turn that failed (no credential for the model, a provider refusing, ...): the engine closes the
// turn with `turn/end` and a reason whose kind is `error`. This reads that reason, nothing else: no guess from the
// text of the answer, no retry count, no judgement about what the model wrote.
//
// Pure: events in, a verdict out. The host reads the events (sessionPersistence) and the page asks for the verdict.

/** The longest error text handed to the page (the card clips it again). */
export const OUTCOME_MESSAGE_MAX = 400

const one = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '')

/**
 * The verdict on the LAST turn of a session:
 *   { open: true }                                  a turn is still running (or none started yet): nothing to say
 *   { open: false, failed: false }                  the last turn ended without an error
 *   { open: false, failed: true, code, message }    the last turn ended with an error reason
 * A session whose events say nothing about a turn is `{ open: true }`: no outcome is claimed.
 */
export const lastTurnOutcome = (events) => {
  let started = -1
  let ended = -1
  let end = null
  const list = Array.isArray(events) === true ? events : []
  for (let i = 0; i < list.length; i += 1) {
    const ev = list[i]
    if (ev === null || typeof ev !== 'object') continue
    if (ev.type === 'turn/start') started = i
    else if (ev.type === 'turn/end') { ended = i; end = ev }
  }
  if (end === null || started > ended) return { open: true }
  const data = end.data !== null && typeof end.data === 'object' ? end.data : null
  const reason = data !== null && data.reason !== null && typeof data.reason === 'object' ? data.reason : null
  if (reason === null || reason.kind !== 'error') return { open: false, failed: false }
  const err = reason.error !== null && typeof reason.error === 'object' ? reason.error : null
  const message = err !== null ? one(err.message).slice(0, OUTCOME_MESSAGE_MAX) : ''
  const code = err !== null ? one(err.code).slice(0, 60) : ''
  return { open: false, failed: true, code, message }
}
