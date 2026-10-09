// kybernos-call: what the session's assistant writes, kept for the call that is listening to it.
//
// One brain: the answer a call speaks is the answer of the SESSION (its model, its tools, its
// permissions), not a second model's. The host sees every session event (`ctx.on('session/event')`);
// this module keeps, per call room, the assistant's text of the session the call is attached to, and
// hands it to the worker, which polls for it (`GET /kybernos-call/speech`, a long poll).
//
// Pure: no DSH, no timers other than the waiters' own.

const MAX_ITEMS = 100          // per room: a worker that stops polling must not make the host grow
const MAX_WAIT_MS = 25000
const MAX_AGE_MS = 6 * 3600 * 1000 // the longest a room token lives

/** The spoken-or-not parts of an assistant message: its text blocks, nothing else (no thinking, no tool use). */
export function assistantText (event) {
  const message = (event !== null && typeof event === 'object' && event.data !== null && typeof event.data === 'object') ? event.data.message : null
  const content = (message !== null && message !== undefined && Array.isArray(message.content)) ? message.content : []
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') parts.push(block.text.trim())
  }
  return parts.join('\n')
}

/**
 * Items a worker reads, in order, each with a `seq` that only goes up:
 *   { seq, kind: 'text', text }              an assistant message
 *   { seq, kind: 'tool', name }              the assistant starts a tool (the thread shows it; nothing is spoken)
 *   { seq, kind: 'end', reason }             the turn is over
 */
export function createSpeechFeed (options = {}) {
  const now = options.now ?? (() => Date.now())
  const rooms = new Map() // room → { sessionId, since, items: [], next: 1, waiters: Set<fn> }
  const bySession = new Map() // sessionId → Set<room>

  const wake = (r) => { for (const fn of [...r.waiters]) { try { fn() } catch (e) { /* a dead waiter */ } } }

  const register = (room, sessionId) => {
    if (typeof room !== 'string' || room === '' || typeof sessionId !== 'string' || sessionId === '') return false
    unregister(room)
    rooms.set(room, { sessionId, since: now(), polledAt: now(), items: [], next: 1, waiters: new Set() })
    if (!bySession.has(sessionId)) bySession.set(sessionId, new Set())
    bySession.get(sessionId).add(room)
    return true
  }

  const unregister = (room) => {
    const r = rooms.get(room)
    if (r === undefined) return false
    rooms.delete(room)
    const set = bySession.get(r.sessionId)
    if (set !== undefined) { set.delete(room); if (set.size === 0) bySession.delete(r.sessionId) }
    wake(r) // a waiting poll answers (empty) instead of hanging
    return true
  }

  const push = (r, item) => {
    r.items.push(Object.assign({ seq: r.next }, item))
    r.next += 1
    if (r.items.length > MAX_ITEMS) r.items.splice(0, r.items.length - MAX_ITEMS)
    wake(r)
  }

  /** Called with every session event; it keeps only what a call is listening to. Never throws. */
  const ingest = (sessionId, event) => {
    try {
      const set = bySession.get(String(sessionId))
      if (set === undefined || event === null || typeof event !== 'object') return
      for (const room of set) {
        const r = rooms.get(room)
        if (r === undefined) continue
        if (event.type === 'assistant/message') {
          const text = assistantText(event)
          if (text !== '') push(r, { kind: 'text', text })
        } else if (event.type === 'tool/call') {
          const name = (event.data !== null && typeof event.data === 'object' && typeof event.data.name === 'string') ? event.data.name : ''
          push(r, { kind: 'tool', name })
        } else if (event.type === 'turn/end') {
          const kind = (event.data !== null && typeof event.data === 'object' && event.data.reason !== null && typeof event.data.reason === 'object') ? event.data.reason.kind : null
          push(r, { kind: 'end', reason: typeof kind === 'string' ? kind : null })
        }
      }
    } catch (e) { /* a listener must never break the session */ }
  }

  /** Forgets rooms nobody could still be in (a room token lives 6 h at most). */
  const sweep = () => {
    const limit = now() - MAX_AGE_MS
    for (const [room, r] of [...rooms.entries()]) if (r.since < limit) unregister(room)
  }

  /**
   * The items after `after` (a seq). When there are none and `waitMs` > 0, waits for the next one (a long
   * poll). `known: false` tells the worker the room is not (or no longer) registered: it should stop asking.
   */
  const poll = (room, after = 0, waitMs = 0) => new Promise((resolve) => {
    sweep()
    const r = rooms.get(room)
    if (r === undefined) { resolve({ ok: true, known: false, items: [], next: after }); return }
    r.polledAt = now()
    const read = () => {
      r.polledAt = now()
      const items = r.items.filter((i) => i.seq > after)
      return { ok: true, known: rooms.get(room) === r, items, next: items.length > 0 ? items[items.length - 1].seq : after }
    }
    const first = read()
    const wait = Math.min(Math.max(Number.isFinite(waitMs) ? waitMs : 0, 0), MAX_WAIT_MS)
    if (first.items.length > 0 || wait === 0) { resolve(first); return }
    let timer = null
    const done = () => { if (timer !== null) clearTimeout(timer); r.waiters.delete(done); resolve(read()) }
    r.waiters.add(done)
    timer = setTimeout(done, wait)
  })

  /**
   * Is a call going on with this session right now? A worker that follows a call polls all the time (a long poll
   * of 20 s), so a room that was polled (or created) within `ttlMs` is a live call; one nobody asks about any more is over.
   */
  const active = (sessionId, ttlMs = 60000) => {
    const set = bySession.get(String(sessionId))
    if (set === undefined) return false
    for (const room of set) {
      const r = rooms.get(room)
      if (r !== undefined && now() - Math.max(r.since, r.polledAt) < ttlMs) return true
    }
    return false
  }

  return { register, unregister, ingest, poll, sweep, active, size: () => rooms.size, sessionOf: (room) => (rooms.get(room) ?? {}).sessionId ?? null }
}
