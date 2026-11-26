// The card of a connected app in a chat set to « never ask » (journey UJ-203, the half the engine cannot do).
//
// A connected app acts for real (a mail goes out, an issue is opened, something is paid). In a chat whose approval policy is « ask » the engine puts its own card before the call
// (index.js, `ordinaryAsk`). In a chat set to « never » (Full access) the engine rejects every card without showing it, so a question there is ours: the call waits here, the chat shows
// a card (the engine's own card factory, drawn by this plugin's client in the composer dock) and the person's tap lets it go or stops it.
//
// No I/O and no clock but the timer: the host wires the routes, the tests drive this file alone. What is asked is made of words the model chose (an app, an action, a few fields):
// the page shows them as text, and only the person's own page can answer (the answer route is strict about the origin and needs the signed session).
import { randomUUID } from 'node:crypto'

/** How long one question is waited for, in ms. The person may be away from the chat; the call is held, not lost. */
const DEFAULT_WAIT_MS = 30 * 60_000
/** The most questions held at once, over every chat: from the next one the call is refused rather than piled up. */
const MAX_PENDING = 50

const waitMs = () => { const v = Number(process.env.KYBERNOS_CONNECTOR_ASK_WAIT_MS); return Number.isFinite(v) && v > 0 ? v : DEFAULT_WAIT_MS }

/**
 * The questions waiting for a person.
 * `ask({ sessionId, text, signal })` → Promise of `allowed`, `rejected`, `timeout`, `cancelled` or `overflow`; `text` is `{ en, fr }`, `sessionId` the chat the call came from ('' when unknown: every chat shows it).
 */
export const createConnectorAsks = () => {
  const pending = new Map()
  return {
    ask ({ sessionId, text, signal } = {}) {
      if (pending.size >= MAX_PENDING) return Promise.resolve('overflow')
      if (signal !== undefined && signal !== null && signal.aborted === true) return Promise.resolve('cancelled')
      return new Promise((resolve) => {
        const id = randomUUID()
        let timer = null
        let onAbort = null
        const settle = (outcome) => {
          if (!pending.has(id)) return
          pending.delete(id)
          if (timer !== null) clearTimeout(timer)
          if (onAbort !== null) signal.removeEventListener('abort', onAbort)
          resolve(outcome)
        }
        pending.set(id, { id, sessionId: typeof sessionId === 'string' ? sessionId : '', text: { en: String(text && text.en), fr: String(text && text.fr) }, at: Date.now(), settle })
        timer = setTimeout(() => settle('timeout'), waitMs())
        if (typeof timer.unref === 'function') timer.unref()
        if (signal !== undefined && signal !== null && typeof signal.addEventListener === 'function') {
          onAbort = () => settle('cancelled')
          signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    },
    /** What a chat shows, the oldest first: `{ id, text, at }` for the questions of that chat (and those of a call whose chat is not known). */
    list (sessionId) {
      const want = typeof sessionId === 'string' ? sessionId : ''
      return [...pending.values()].filter((p) => p.sessionId === want || p.sessionId === '').sort((a, b) => a.at - b.at).map((p) => ({ id: p.id, text: p.text, at: p.at }))
    },
    /** The person's tap: `answer` is `allow` or `reject`. A question already settled (timed out, stopped, answered) is `unknown`. */
    answer (id, answer) {
      if (answer !== 'allow' && answer !== 'reject') return { ok: false, error: 'bad_answer' }
      const p = typeof id === 'string' ? pending.get(id) : undefined
      if (p === undefined) return { ok: false, error: 'unknown' }
      p.settle(answer === 'allow' ? 'allowed' : 'rejected')
      return { ok: true }
    },
    size: () => pending.size,
  }
}
