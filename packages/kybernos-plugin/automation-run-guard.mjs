// The person's rules over ONE automation run, for every automation: a time box (« Maximum duration »), the person's own message (« When I write in its chat »: stop and
// answer me, or let it finish) and the Stop button. Only the engine's session controller is used (`state`, `wait`, `cancel`, and `updateQueue` when the engine has it): no new seam.
//
// A run that has neither option is not watched at all (today's behaviour); the Stop button works on any run. The chat is the person's, so when the option says so the person wins:
// their message waiting in the queue cancels the run's turn. The engine keeps its inbox but does not run it by itself after a cancel (measured on the real engine), so the
// person's queued messages are steered, which starts their turn behind the cancelled one, and the run's own unread message is removed so that it does not run later.
// Several runs can share one chat (a home chat, a reminder): each run has its own watch, queued one behind the other. A watch ends « done » when the next run's message leaves
// the queue (its turn is over: the engine started the next one), never cancels a turn that is not its run's, and a cut-short run only removes its own message: the other runs
// queued in the chat stay (their history says they fired), and when no message of the person's is waiting the next one is steered so that it really starts.
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
  const queuedMaxMs = Number.isFinite(deps.queuedMaxMs) ? deps.queuedMaxMs : QUEUED_MAX_MS
  /** sessionId -> the watches of that chat, oldest first. */
  const live = new Map()
  const watchesOf = (sid) => live.get(sid) || []
  const queuedOf = (st, requestId) => requestId !== '' && st.queue.some((q) => isRunItem(q) && String(q.rpcId).startsWith(requestId))
  /** True when a run queued after `entry` in the same chat has left the queue: the engine started it, so the turn of `entry` is over. */
  const handedOver = (entry, st) => {
    const list = watchesOf(entry.sessionId)
    const i = list.indexOf(entry)
    return i >= 0 && list.slice(i + 1).some((e) => e.stopped !== true && e.requestId !== '' && !queuedOf(st, e.requestId))
  }

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
  /**
   * Cancels the turn and keeps what waits behind it: the stopped run's own unread message (`ownRequestId`) is removed, the person's messages are steered so that their
   * turn really starts, and the other runs stay queued; with no message of the person's, the first other run is steered (the engine does not start the queue by itself
   * after a cancel) and the rest follow it as usual.
   */
  const cancelKeeping = async (sc, sid, ownRequestId = '') => {
    let items = []
    try { const st = await readState(sc, sid); if (st !== null) items = st.queue } catch (e) { items = [] }
    try { await sc.cancel({ sessionId: sid }) } catch (e) { /* already over */ }
    if (typeof sc.updateQueue !== 'function') return
    const valid = items.filter((q) => q !== null && typeof q === 'object' && typeof q.id === 'string')
    const own = valid.filter((q) => ownRequestId !== '' && isRunItem(q) && String(q.rpcId).startsWith(ownRequestId))
    const person = valid.filter((q) => !isRunItem(q))
    const others = valid.filter((q) => isRunItem(q) && own.includes(q) !== true)
    const act = async (q, kind) => { try { await sc.updateQueue({ sessionId: sid, itemId: q.id, action: { kind } }, new AbortController().signal) } catch (e) { /* read meanwhile, or the turn is already over */ } }
    for (const q of own) await act(q, 'remove')
    if (person.length > 0) { for (const q of person) await act(q, 'steer') } else if (others.length > 0) await act(others[0], 'steer')
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
    const entry = { sessionId: sid, taskId: o.taskId, requestId: String(o.requestId || ''), stopped: false, person: false, timeUp: false, over: false, started: false, quit: undefined }
    live.set(sid, watchesOf(sid).concat([entry]))
    try {
      const sc = controller()
      if (sc === null) return 'error'
      const boxMs = Number.isFinite(o.maxMinutes) && o.maxMinutes > 0 ? o.maxMinutes * 60 * 1000 : 0
      // 1. The run's own message may still wait behind a turn of the person's: the clock and the person rule start when it does.
      // While an earlier run of this chat is still watched, the wait is that run's (bounded by its own box), not a reason to give up.
      const queuedUntil = now() + queuedMaxMs
      const queuedHardUntil = now() + WATCH_MAX_MS
      let graceUntil = now() + graceMs
      for (;;) {
        if (entry.stopped === true) return 'stopped'
        let st = null
        try { st = await readState(sc, sid) } catch (e) { st = null }
        if (st === null) return 'error'
        if (queuedOf(st, entry.requestId) === true) {
          const earlier = watchesOf(sid).indexOf(entry) > 0
          if ((now() >= queuedUntil && earlier !== true) || now() >= queuedHardUntil) return 'error'
          // The grace for the turn to show counts from the moment the message leaves the queue.
          graceUntil = now() + graceMs
          await sleep(pollMs); continue
        }
        // Out of the queue but an earlier run's watch is still closing (a cancelled turn winding down): the turn going may still be that run's, so wait for its watch to end.
        if (watchesOf(sid).indexOf(entry) > 0) {
          if (now() >= queuedHardUntil) return 'error'
          graceUntil = now() + graceMs
          await sleep(pollMs); continue
        }
        if (st.running === true || st.pendingInput.length > 0) break
        if (now() >= graceUntil) return 'done'
        await sleep(Math.min(300, pollMs))
      }
      // 2. The turn is going: watch it.
      entry.started = true
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
          // The next run has started: this run's turn is over, whatever the engine's wait says (it may follow the chat, not the turn).
          if (st !== null && handedOver(entry, st) === true) { entry.over = true; quit.abort(); return }
          if (st !== null && o.stopOnPerson === true && st.queue.some((q) => !isRunItem(q))) { entry.person = true; await cancelKeeping(sc, sid, entry.requestId); quit.abort(); return }
          if (st !== null && deadline > 0 && now() >= deadline) { entry.timeUp = true; await cancelKeeping(sc, sid, entry.requestId); quit.abort(); return }
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
      if (entry.over === true) return 'done'
      if (entry.person === true) { await settle(sc, sid); return 'person' }
      if (entry.stopped === true) { await settle(sc, sid); return 'stopped' }
      if (entry.timeUp === true) { await settle(sc, sid); return 'time' }
      return reason === 'idle' ? 'done' : 'error'
    } catch (e) { return 'error' } finally {
      const rest = watchesOf(sid).filter((e) => e !== entry)
      if (rest.length > 0) live.set(sid, rest); else live.delete(sid)
    }
  }

  /**
   * The person's Stop on the run of `taskId` in session `sid` (watched or not). A run of it still waiting in the queue behind another one loses its message only: the turn
   * going is not its. Otherwise the turn is cancelled, what waits behind it kept (cancelKeeping). Answers once the cancel is sent, with the stopped run's request id ('' unknown).
   * @returns { ok: true, requestId } or { ok: false, error: 'sessions_unavailable' | 'error' }
   */
  const stop = async (sid, taskId) => {
    try {
      const sc = controller()
      if (sc === null) return { ok: false, error: 'sessions_unavailable' }
      const list = watchesOf(sid)
      const going = list.filter((e) => e.started === true).pop()
      const mine = taskId === undefined ? undefined : list.find((e) => e.taskId === taskId && e.started !== true)
      if (mine !== undefined && (going === undefined || going.taskId !== taskId) && typeof sc.updateQueue === 'function') {
        mine.stopped = true
        let items = []
        try { const st = await readState(sc, sid); if (st !== null) items = st.queue } catch (e) { items = [] }
        for (const q of items) {
          if (q === null || typeof q !== 'object' || typeof q.id !== 'string' || !isRunItem(q) || !String(q.rpcId).startsWith(mine.requestId)) continue
          try { await sc.updateQueue({ sessionId: sid, itemId: q.id, action: { kind: 'remove' } }, new AbortController().signal) } catch (e) { /* it started meanwhile */ }
        }
        return { ok: true, requestId: mine.requestId }
      }
      if (going !== undefined) going.stopped = true
      await cancelKeeping(sc, sid, going !== undefined ? going.requestId : '')
      if (going !== undefined && going.quit !== undefined) going.quit.abort()
      return { ok: true, requestId: going !== undefined ? going.requestId : '' }
    } catch (e) { return { ok: false, error: 'error' } }
  }

  return { begin, stop, watching: (sid) => watchesOf(sid).length > 0 }
}
