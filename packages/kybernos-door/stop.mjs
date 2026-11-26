// Stopping a turn on a cloud computer for real (docs/dev/task-contract.md § 8, rule 1).
//
// A task that the platform cancels, that runs out of time or whose lease is lost used to be acknowledged by the runner while the engine's session went on: the model kept being
// called (and paid for) and the next job was claimed on top of it. The stop reaches the engine here: the turn's own session and every sub-agent session below it are cancelled,
// the messages still waiting in their queues are removed (the engine does not start a queue by itself after a cancel, and a queued prompt must never run later), and the turn is
// remembered as stopped by the caller, so that the gate refuses every call a session of it might still make and `turn/continue` takes no more words for it.
//
// Pure: the session controller and the sessions registry are handed in. Nothing here reads a file, the network or the clock.
//
// A bundle is self-contained, so the local door (`packages/kybernos-door/stop.mjs`) holds a byte-for-byte copy; `packages/kybernos-door/test-door.mjs` fails when the two differ.

/** The id of a session that a stop may name (the same shape `turn/answer` accepts). */
const SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/u
const DEPTH = 6

const unwrapValue = (res) => {
  if (res === null || typeof res !== 'object') return null
  if (res.ok === false) return null
  return res.value !== undefined && res.value !== null ? res.value : res
}

/**
 * The ids of the sessions below `root` (its sub-agents, and theirs), from the registry's own list. A session whose parent chain does not lead to `root` is never in it. Bounded in depth
 * so that a chain that loops cannot hold the stop; a registry that cannot be read gives none, and the root is still stopped.
 */
export function descendantsOf (sessions, root) {
  let all = []
  try { all = sessions !== undefined && sessions !== null && typeof sessions.list === 'function' ? sessions.list() : [] } catch (e) { all = [] }
  if (Array.isArray(all) === false) return []
  const parentOf = new Map()
  for (const s of all) {
    // The id is the session's own (`get id()`); a header that carries one stands in for it.
    const id = s !== null && typeof s === 'object' ? (typeof s.id === 'string' ? s.id : (s.header !== null && typeof s.header === 'object' ? s.header.id : undefined)) : undefined
    const parent = s !== null && typeof s === 'object' && s.header !== null && typeof s.header === 'object' ? s.header.parentSession : undefined
    if (typeof id === 'string' && typeof parent === 'string' && parent !== '') parentOf.set(id, parent)
  }
  const below = []
  for (const id of parentOf.keys()) {
    let current = id
    for (let depth = 0; depth < DEPTH && typeof current === 'string'; depth += 1) {
      current = parentOf.get(current)
      if (current === root) { below.push(id); break }
    }
  }
  return below
}

/**
 * Cancels `sessionId` and every session below it, and removes what waits in their queues. Returns `{ ok: true, stopped }` (how many sessions were cancelled) or a short code. A session that
 * is already over is no failure: the stop is idempotent.
 */
export async function stopTurn ({ sc, sessions, sessionId }) {
  if (typeof sessionId !== 'string' || SESSION_ID.test(sessionId) === false) return { ok: false, error: 'a session id is expected' }
  if (sc === undefined || sc === null || typeof sc.cancel !== 'function') return { ok: false, error: 'sessions_unavailable' }
  const ids = [sessionId, ...descendantsOf(sessions, sessionId)]
  let stopped = 0
  for (const id of ids) {
    // The queue first: a prompt that is still waiting would start the moment the cancelled one converges to idle.
    if (typeof sc.state === 'function' && typeof sc.updateQueue === 'function') {
      try {
        const st = unwrapValue(await sc.state({ sessionId: id }, new AbortController().signal))
        const queue = st !== null && Array.isArray(st.queue) ? st.queue : []
        for (const q of queue) {
          if (q === null || typeof q !== 'object' || typeof q.id !== 'string') continue
          try { await sc.updateQueue({ sessionId: id, itemId: q.id, action: { kind: 'remove' } }, new AbortController().signal) } catch (e) { /* read meanwhile, or already over */ }
        }
      } catch (e) { /* the state cannot be read: the cancel below still goes */ }
    }
    try { await sc.cancel({ sessionId: id }); stopped += 1 } catch (e) { /* already over */ }
  }
  return { ok: true, stopped }
}
