// The person's rules over ONE automation run, for every automation: a time box (« Maximum duration »), the person's own message (« When I write in its chat »: stop and
// answer me, or let it finish) and the Stop button. Only the engine's session controller is used (`state`, `wait`, `cancel`, and `updateQueue` when the engine has it): no new seam.
//
// A run that has neither option is not watched at all (today's behaviour); the Stop button works on any run. The chat is the person's, so when the option says so the person wins:
// their message waiting in the queue cancels the run's turn. The engine keeps its inbox but does not run it by itself after a cancel (measured on the real engine), so the
// person's queued messages are steered, which starts their turn behind the cancelled one, and the run's own unread message is removed so that it does not run later.
// A factory over injected helpers, so it is tested without DSH. Nothing here throws into a turn.

/** Every request this host queues for a run starts with this (`kb-task-<id>-<time>`): what tells a run's own queued message from a person's. */
export const RUN_REQUEST_PREFIX = 'kb-task-'

const POLL_MS = 1500
const START_GRACE_MS = 5000
const SETTLE_MS = 8000
/** The most a watch waits for the run's message to leave the queue (a turn of the person's may be ahead of it). */
const QUEUED_MAX_MS = 15 * 60 * 1000
/** No run is watched longer than this, whatever the options say. */
const WATCH_MAX_MS = 6 * 60 * 60 * 1000

/** The engine answers `{ ok, value }` through some doors and the value itself through others. */
const unwrap = (res) => {
  if (res === null || typeof res !== 'object') return null
  if (res.ok === false) return null
  return res.value !== undefined && res.value !== null && typeof res.value === 'object' ? res.value : res
}
const isRunItem = (item) => item !== null && typeof item === 'object' && typeof item.rpcId === 'string' && item.rpcId.startsWith(RUN_REQUEST_PREFIX)

/**
 * @param deps { controller: () => the engine's sessionController or undefined, now?, sleep?: (ms) => Promise, pollMs?, graceMs?, settleMs? }
 */
export function createRunGuard (deps) {
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const sleep = typeof deps.sleep === 'function' ? deps.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const pollMs = Number.isFinite(deps.pollMs) ? deps.pollMs : POLL_MS
  const graceMs = Number.isFinite(deps.graceMs) ? deps.graceMs : START_GRACE_MS
  const settleMs = Number.isFinite(deps.settleMs) ? deps.settleMs : SETTLE_MS
  const live = new Map()

  const controller = () => {
    try {
      const sc = deps.controller()
      return sc !== undefined && sc !== null && ['state', 'wait', 'cancel'].every((m) => typeof sc[m] === 'function') ? sc : null
    } catch (e) { return null }
  }
  const readState = async (sc, sid) => {
    const st = unwrap(await sc.state({ sessionId: sid }, new AbortController().signal))
    if (st === null) return null
    return { running: st.running === true, queue: Array.isArray(st.queue) ? st.queue : [], pendingInput: Array.isArray(st.pendingInput) ? st.pendingInput : [] }
  }
  /** Cancels the turn, steers the person's queued messages so that their turn really starts, removes the runs' own unread messages. */
  const cancelKeeping = async (sc, sid) => {
    let items = []
    try { const st = await readState(sc, sid); if (st !== null) items = st.queue } catch (e) { items = [] }
    try { await sc.cancel({ sessionId: sid }) } catch (e) { /* already over */ }
    if (typeof sc.updateQueue !== 'function') return
    for (const q of items) {
      if (q === null || typeof q !== 'object' || typeof q.id !== 'string') continue
      try { await sc.updateQueue({ sessionId: sid, itemId: q.id, action: { kind: isRunItem(q) ? 'remove' : 'steer' } }, new AbortController().signal) } catch (e) { /* read meanwhile, or the turn is already over */ }
    }
  }
  /** Waits (a little) until the cancelled turn has really stopped, so that the engine's end hooks run before the watch is forgotten. */
  const settle = async (sc, sid) => {
    const until = now() + settleMs
    while (now() < until) {
      await sleep(Math.min(500, pollMs))
      try { const st = await readState(sc, sid); if (st === null || st.running !== true) return } catch (e) { return }
    }
  }

  /**
   * Watches the run of `taskId` in session `sessionId`, whose message was queued as `requestId`. `maxMinutes` is the time box (0 or absent: none), `stopOnPerson` the person's message
   * rule. Resolves with the word that says how the watch ended: 'done', 'time', 'person', 'stopped', 'error'. The caller does not wait for it.
   */
  const begin = async (o) => {
    const sid = o.sessionId
    if (typeof sid !== 'string' || sid === '') return 'error'
    const before = live.get(sid)
    if (before !== undefined) { before.replaced = true; if (before.quit !== undefined) before.quit.abort() }
    const entry = { sessionId: sid, taskId: o.taskId, requestId: String(o.requestId || ''), stopped: false, person: false, timeUp: false, replaced: false, quit: undefined }
    live.set(sid, entry)
    try {
      const sc = controller()
      if (sc === null) return 'error'
      const boxMs = Number.isFinite(o.maxMinutes) && o.maxMinutes > 0 ? o.maxMinutes * 60 * 1000 : 0
      // 1. The run's own message may still wait behind a turn of the person's: the clock and the person rule start when it does.
      const queuedUntil = now() + QUEUED_MAX_MS
      const graceUntil = now() + graceMs
      for (;;) {
        if (entry.stopped === true) return 'stopped'
        if (entry.replaced === true) return 'error'
        let st = null
        try { st = await readState(sc, sid) } catch (e) { st = null }
        if (st === null) return 'error'
        const waiting = entry.requestId !== '' && st.queue.some((q) => isRunItem(q) && String(q.rpcId).startsWith(entry.requestId))
        if (waiting === true) { if (now() >= queuedUntil) return 'error'; await sleep(pollMs); continue }
        if (st.running === true || st.pendingInput.length > 0) break
        if (now() >= graceUntil) return 'done'
        await sleep(Math.min(300, pollMs))
      }
      // 2. The turn is going: watch it.
      const quit = new AbortController()
      entry.quit = quit
      const deadline = boxMs > 0 ? now() + boxMs : 0
      let finished = false
      const polling = (async () => {
        while (finished === false) {
          await sleep(pollMs)
          if (finished === true) return
          let st = null
          try { st = await readState(sc, sid) } catch (e) { st = null }
          if (st !== null && o.stopOnPerson === true && st.queue.some((q) => !isRunItem(q))) { entry.person = true; await cancelKeeping(sc, sid); quit.abort(); return }
          if (deadline > 0 && now() >= deadline) { entry.timeUp = true; await cancelKeeping(sc, sid); quit.abort(); return }
        }
      })()
      let reason = 'error'
      try {
        for (;;) {
          const res = unwrap(await sc.wait({ sessionId: sid, timeoutMs: WATCH_MAX_MS }, quit.signal))
          reason = res !== null && typeof res.reason === 'string' ? res.reason : 'error'
          // An approval is open: the run waits for the person, and so does the watch (the time box keeps counting).
          if (reason === 'input-required' && quit.signal.aborted !== true) { await sleep(pollMs); continue }
          break
        }
      } catch (e) { reason = 'aborted' }
      finished = true
      await polling.catch(() => null)
      if (entry.replaced === true) return 'error'
      if (entry.person === true) { await settle(sc, sid); return 'person' }
      if (entry.stopped === true) { await settle(sc, sid); return 'stopped' }
      if (entry.timeUp === true) { await settle(sc, sid); return 'time' }
      return reason === 'idle' ? 'done' : 'error'
    } catch (e) { return 'error' } finally {
      if (live.get(sid) === entry) live.delete(sid)
    }
  }

  /**
   * The person's Stop on the run in session `sid` (watched or not): the turn is cancelled, their queued messages kept and steered. Answers once the cancel is sent.
   * @returns { ok: true } or { ok: false, error: 'sessions_unavailable' | 'error' }
   */
  const stop = async (sid) => {
    try {
      const sc = controller()
      if (sc === null) return { ok: false, error: 'sessions_unavailable' }
      const entry = live.get(sid)
      if (entry !== undefined) entry.stopped = true
      await cancelKeeping(sc, sid)
      if (entry !== undefined && entry.quit !== undefined) entry.quit.abort()
      return { ok: true }
    } catch (e) { return { ok: false, error: 'error' } }
  }

  return { begin, stop, watching: (sid) => live.has(sid) }
}
