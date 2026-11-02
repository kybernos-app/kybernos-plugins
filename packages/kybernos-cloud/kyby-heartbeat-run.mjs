// Starting and watching one wake-up of Kaby (kyby-heartbeat.mjs): one message into Kaby's own chat, then a watch that ends it at the first of: the turn is over, a question is open,
// the person's message is waiting behind it, the person pressed « Stop », the time box is spent. Only the engine's own session controller is used (`prompt`, `state`, `wait`, `cancel`): no new seam.
//
// The chat is the person's, so the person always wins: their message waiting in the queue cancels the wake-up's turn (the engine keeps the inbox, their message then runs), and no
// wake-up starts while a turn runs, a question is open, a message waits, or within half an hour of their last words.
// After a cancel the person's queued messages are steered so that their turn really starts (`cancelKeeping`); `updateQueue` is optional, an engine without it just keeps them queued.
// A factory over injected helpers, so it is tested without DSH. Nothing here throws into a turn.
import { REQUEST_PREFIX, TRIGGER_TEXT } from './kyby-heartbeat.mjs'

const POLL_MS = 1500
const START_GRACE_MS = 5000
const SETTLE_MS = 8000
const TICK_MS = 60 * 1000

/** The engine answers `{ ok, value }` through some doors and the value itself through others. */
const unwrap = (res) => {
  if (res === null || typeof res !== 'object') return null
  if (res.ok === false) return null
  return res.value !== undefined && res.value !== null && typeof res.value === 'object' ? res.value : res
}
const isOurs = (item) => item !== null && typeof item === 'object' && typeof item.rpcId === 'string' && item.rpcId.startsWith(REQUEST_PREFIX)

/**
 * @param deps { store (kyby-heartbeat-store.mjs), controller: () => the engine's sessionController or undefined, pointer: () => Kaby's session id or null, isDesktop: () => boolean,
 *   now?, sleep?: (ms) => Promise, pollMs?, graceMs?, settleMs? }
 */
export function createHeartbeat (deps) {
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const sleep = typeof deps.sleep === 'function' ? deps.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const pollMs = Number.isFinite(deps.pollMs) ? deps.pollMs : POLL_MS
  const graceMs = Number.isFinite(deps.graceMs) ? deps.graceMs : START_GRACE_MS
  const settleMs = Number.isFinite(deps.settleMs) ? deps.settleMs : SETTLE_MS
  const store = deps.store
  let active = null
  let seq = 0

  const controller = () => {
    try {
      const sc = deps.controller()
      return sc !== undefined && sc !== null && ['prompt', 'state', 'wait', 'cancel'].every((m) => typeof sc[m] === 'function') ? sc : null
    } catch (e) { return null }
  }
  const readState = async (sc, sid) => {
    const st = unwrap(await sc.state({ sessionId: sid }, new AbortController().signal))
    if (st === null) return null
    return { running: st.running === true, queue: Array.isArray(st.queue) ? st.queue : [], pendingInput: Array.isArray(st.pendingInput) ? st.pendingInput : [] }
  }
  const personQueued = (st) => st.queue.some((q) => !isOurs(q))
  /**
   * Cancels the turn. The engine keeps the inbox but does not run it by itself once the turn is cancelled (measured on the real engine: the person's message stayed queued, nothing ran),
   * so, while the cancelled turn still unwinds, the person's queued messages are steered (the engine then starts their turn behind the cancelled one: its own latch) and the
   * wake-up's own note, if it was never read, is removed so that it does not run later.
   */
  const cancelKeeping = async (sc, sid) => {
    let items = []
    try { const st = await readState(sc, sid); if (st !== null) items = st.queue } catch (e) { items = [] }
    try { await sc.cancel({ sessionId: sid }) } catch (e) { /* already over */ }
    if (typeof sc.updateQueue !== 'function') return
    for (const q of items) {
      if (q === null || typeof q !== 'object' || typeof q.id !== 'string') continue
      try { await sc.updateQueue({ sessionId: sid, itemId: q.id, action: { kind: isOurs(q) ? 'remove' : 'steer' } }, new AbortController().signal) } catch (e) { /* read meanwhile, or the turn is already over */ }
    }
  }
  /**
   * Waits until the cancelled turn has really stopped, so that its end hooks run while the wake-up is still marked. It also ends when a later turn has claimed its inbox (`mine.over`:
   * the person's message, started behind the cancelled turn, is not the wake-up's and must not wait for it).
   */
  const settleTurn = async (sc, sid, mine) => {
    const until = now() + settleMs
    while (now() < until) {
      await sleep(Math.min(500, pollMs))
      if (mine.over === true) return
      try { const st = await readState(sc, sid); if (st === null || st.running !== true) return } catch (e) { return }
    }
  }
  const stop = async (sc, sid, mine) => {
    await cancelKeeping(sc, sid)
    await settleTurn(sc, sid, mine)
  }

  /** Watches one wake-up's turn (`mine` is its entry in `active`); returns the word that says how it ended. */
  const watch = async (sc, sid, boxMs, mine) => {
    const quit = new AbortController()
    mine.quit = quit
    let finished = false
    let person = false
    const polling = (async () => {
      while (finished === false) {
        await sleep(pollMs)
        if (finished === true) return
        let st = null
        try { st = await readState(sc, sid) } catch (e) { st = null }
        if (st !== null && personQueued(st)) { person = true; await stop(sc, sid, mine); quit.abort(); return }
      }
    })()
    let reason = 'error'
    try {
      const res = unwrap(await sc.wait({ sessionId: sid, timeoutMs: boxMs }, quit.signal))
      reason = res !== null && typeof res.reason === 'string' ? res.reason : 'error'
    } catch (e) { reason = person === true ? 'person' : 'error' }
    finished = true
    await polling.catch(() => null)
    if (person === true) return 'person'
    if (mine.stopped === true) { await settleTurn(sc, sid, mine); return 'stopped' }
    if (reason === 'idle') return 'done'
    if (reason === 'input-required') { await stop(sc, sid, mine); return 'blocked' }
    if (reason === 'timeout') { await stop(sc, sid, mine); return 'time' }
    return 'error'
  }

  /**
   * Starts a wake-up if one may start now. `manual` is the person's own click: it skips the interval, the quiet hours and the half hour of calm, never the busy checks.
   * @returns { ok: true, finished: Promise<word> } or { ok: false, error } (a closed word)
   */
  const start = async (opts) => {
    try {
      const manual = opts !== null && typeof opts === 'object' && opts.manual === true
      if (active !== null) return { ok: false, error: 'running' }
      if (deps.isDesktop() !== true) return { ok: false, error: 'not_desktop' }
      const record = store.active()
      if (record === null) return { ok: false, error: 'not_in_force' }
      if (manual !== true) { const d = store.due(); if (d.due !== true) return { ok: false, error: d.why } }
      const sc = controller()
      if (sc === null) return { ok: false, error: 'sessions_unavailable' }
      const sid = deps.pointer()
      if (typeof sid !== 'string' || sid === '') return { ok: false, error: 'no_chat' }
      let st = null
      try { st = await readState(sc, sid) } catch (e) { return { ok: false, error: 'no_chat' } }
      if (st === null) return { ok: false, error: 'no_chat' }
      if (st.running === true || st.pendingInput.length > 0 || st.queue.length > 0) return { ok: false, error: 'busy' }
      if (active !== null) return { ok: false, error: 'running' }
      seq += 1
      // Known to the gate and to the prompt BEFORE the message is queued: its first call must already find the wake-up marked.
      active = { sessionId: sid, at: now(), requestId: REQUEST_PREFIX + now().toString(36) + '-' + String(seq), claimed: false }
      store.started(active.at)
      const mine = active
      const finished = (async () => {
        let outcome = 'error'
        try {
          const ack = await sc.prompt({ requestId: mine.requestId, sessionId: sid, mode: 'queue', content: [{ type: 'text', text: TRIGGER_TEXT }] }, new AbortController().signal)
          if (ack === null || typeof ack !== 'object' || ack.ok === false || ack.accepted === false) { outcome = 'refused'; return outcome }
          // The turn starts at once on an idle chat: wait for it to show before waiting for its end (an idle chat would answer « idle » at once).
          const until = now() + graceMs
          for (;;) {
            if (mine.stopped === true) break
            let seen = null
            try { seen = await readState(sc, sid) } catch (e) { seen = null }
            if (seen !== null && (seen.running === true || seen.queue.some(isOurs) || seen.pendingInput.length > 0)) break
            if (now() >= until) break
            await sleep(Math.min(300, pollMs))
          }
          // « Stop » clicked before the watch began: the turn that just started is cancelled, there is nothing to watch.
          if (mine.stopped === true) { await stop(sc, sid, mine); outcome = 'stopped'; return outcome }
          outcome = await watch(sc, sid, record.boxMin * 60 * 1000, mine)
          return outcome
        } catch (e) { return 'error' } finally {
          if (active === mine) active = null
          store.ended(outcome, { manual })
        }
      })()
      return { ok: true, finished }
    } catch (e) { return { ok: false, error: 'error' } }
  }

  return {
    start,
    /** The timer's step: starts a wake-up when one is due, and returns when it is over. Returns the word it ended with, or the reason it did not start. */
    async tick () {
      const r = await start({ manual: false })
      return r.ok === true ? r.finished : r.error
    },
    /**
     * The person's « Stop this wake-up »: the turn is cancelled (the engine keeps the inbox) and the watch ends as `stopped`. Answers at once; the wake-up ends a moment later, once the turn has really stopped.
     * @returns { ok: true } or { ok: false, error: 'not_running' | 'sessions_unavailable' | 'error' }
     */
    async stopNow () {
      try {
        const mine = active
        if (mine === null) return { ok: false, error: 'not_running' }
        const sc = controller()
        if (sc === null) return { ok: false, error: 'sessions_unavailable' }
        mine.stopped = true
        await cancelKeeping(sc, mine.sessionId)
        if (mine.quit !== undefined) mine.quit.abort()
        return { ok: true }
      } catch (e) { return { ok: false, error: 'error' } }
    },
    /** Kaby's session id while one of its wake-ups is running, else null. The gate and the prompt ask this. */
    runningSession () { return active !== null ? active.sessionId : null },
    isWake (sid) { return active !== null && active.over !== true && typeof sid === 'string' && sid === active.sessionId },
    /**
     * A turn of Kaby's chat claimed its inbox: the first claim after the wake-up started is the wake-up's own (its turn number is kept), any other is the person's words (or DSH's notes: the
     * cost of a doubt is half an hour of calm). A claim by a LATER turn says the wake-up's own is over: the person's message started behind it, and it is not under the wake-up's rules.
     */
    noteClaim (sid, turn) {
      try {
        if (typeof sid !== 'string' || sid !== deps.pointer()) return
        if (active !== null && active.claimed === false) { active.claimed = true; active.turn = turn; return }
        if (active !== null && Number.isFinite(turn) && Number.isFinite(active.turn) && turn > active.turn) active.over = true
        store.personSpoke(now())
      } catch (e) { /* a note is never worth a turn */ }
    },
    /** A restart or a first look: a wake-up marked as running that nothing runs. */
    settle () { if (active === null) { try { store.settleStale() } catch (e) { /* nothing to settle */ } } },
    TICK_MS
  }
}
