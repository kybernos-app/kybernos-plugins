// The two tools of the local door. Pure: the DSH sessions, the clock and the disk are handed in, so that every path is tested without DSH.
//
//   kaby_do     give Kaby a task and read its answer, or come back to a task by its id and wait for it
//   list_tasks  the tasks given through this door, most recent first, with whether each is still going
//   kaby_stop   stop a task that is going: its session and its sub-agents are cancelled, what waits is removed, and its id then says `canceled`
//
// A task is a NEW conversation of the person's Kybernos, put under « ask first » before anything is sent (the core plugin's `kybernos.askSessions` seam: the asking permission preset for the engine's
// own tools, and the by-name gate for MCP tools): when Kaby needs a human yes for a step, the task stops at `waiting_approval` and the person gives it on the Kybernos screen. The door can read that it
// is waiting; it can never answer. If the seam is not there or cannot apply the preset, the task is NOT started. Whatever the assistant sends is the person's request, relayed: it is not wrapped.
import { isKey, isTaskId } from './tasks.mjs'
import { answerOf } from './answer.mjs'

export const TASK_MAX = 8000
export const WAIT_DEFAULT = 30
export const WAIT_MAX = 45
export const LIST_DEFAULT = 10
export const LIST_MAX = 20
/** How long a stop waits for the engine to show the task idle before it says the task is still stopping, in ms. */
export const STOP_WAIT_MS = 5000

const refuse = (error, hint) => ({ data: { ok: false, error, hint }, isError: true })

/** Arguments with a key outside `allowed` are refused with the list: the assistant corrects itself from the message. */
const onlyKeys = (args, allowed) => {
  const extra = Object.keys(args).filter((k) => allowed.indexOf(k) < 0)
  return extra.length === 0 ? null : 'Unknown argument: ' + extra.slice(0, 3).join(', ') + '. Allowed: ' + allowed.join(', ') + '.'
}
const integerIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max

const NEXT = {
  running: 'Kaby is still working. Call kaby_do again with this task_id to keep waiting (it waits up to wait_seconds).',
  waiting_approval: 'Kaby is waiting for the person to approve a step on the Kybernos screen. This door cannot approve anything: tell the person, then call kaby_do again with this task_id.',
  waiting_answer: 'Kaby asked the person a question on the Kybernos screen and waits for the answer. Tell the person, then call kaby_do again with this task_id.',
  canceled: 'The task was stopped. What it had already done is not undone. Give a new task to start again.',
}

/**
 * @param deps `{ facade, events, tasks, now?, sleep?, settleMs?, pollMs?, graceMs? }`
 *   `facade()` → `{ create(): Promise<sessionId | null>, askFirst(sessionId): Promise<{ ok, error? }>, prompt(sessionId, text): Promise<boolean>, state(sessionId): Promise<{ running, queue, pendingInput } | null> }`,
 *   or null while DSH's sessions are not ready
 *   `events(sessionId)` → Promise<the session's events>; `tasks` is tasks.mjs's store
 */
export function createTools (deps) {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const settleMs = deps.settleMs ?? 600
  const pollMs = deps.pollMs ?? 500
  const graceMs = deps.graceMs ?? 5000

  const liveState = async (session) => {
    const f = deps.facade()
    if (f === null) return null
    try { return await f.state(session) } catch (e) { return null }
  }
  const waitingOf = (st) => (st === null || st.pendingInput.length === 0 ? '' : (st.pendingInput.indexOf('approval') >= 0 ? 'waiting_approval' : 'waiting_answer'))
  const busyOf = (st) => st !== null && (st.running === true || st.queue.length > 0)

  const base = (rec, status) => ({ task_id: rec.id, session_id: rec.session, status })
  const still = (rec, status) => ({ data: { ...base(rec, status), next: NEXT[status] } })
  const finished = async (rec) => {
    let events = []
    try { events = await deps.events(rec.session) } catch (e) { events = [] }
    const a = answerOf(events)
    if (a.text !== '') return { data: { ...base(rec, 'done'), answer: a.text, tools_used: a.tools } }
    return { data: { ...base(rec, 'failed'), reason: a.failure !== '' ? a.failure : 'no_answer', tools_used: a.tools } }
  }

  /** Waits up to `waitMs` for the task to leave « going », and says where it stands. A task just given is « going » only once it has been seen going (or after a short grace: it never started). */
  const watch = async (rec, waitMs, fresh) => {
    if (rec.stopped === true) return still(rec, 'canceled')
    const t0 = now()
    const deadline = t0 + waitMs
    let seen = fresh !== true
    for (;;) {
      const st = await liveState(rec.session)
      const waiting = waitingOf(st)
      if (busyOf(st) || waiting !== '') seen = true
      if (waiting !== '') return still(rec, waiting)
      if (!busyOf(st) && (seen || now() - t0 >= graceMs)) return finished(rec)
      if (now() >= deadline) return still(rec, 'running')
      await sleep(pollMs)
    }
  }

  const kabyDo = {
    name: 'kaby_do',
    title: 'Have Kaby do something',
    description: 'Give the person\'s Kaby (the assistant of the Kybernos app on this computer) a task to do with its own tools, skills, memory and connected apps, and read its answer. Use it whenever the person asks Kaby to do or find something. '
      + 'Each task is a new conversation in Kybernos that the person can open. If Kaby finishes within wait_seconds the answer is in the result; otherwise the status is "running": call again with the task_id to keep waiting. '
      + 'If Kaby needs the person to approve a step, the status is "waiting_approval": the person approves it on the Kybernos screen, this door cannot approve anything. Give either task or task_id.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', minLength: 1, maxLength: TASK_MAX, description: 'The task, in words.' },
        task_id: { type: 'string', description: 'The task_id of a task given earlier: waits for it (up to wait_seconds) and starts nothing.' },
        idempotency_key: { type: 'string', maxLength: 100, description: 'With task: a label of your own for this request. Asking again with the same label returns the same task instead of starting a second one.' },
        wait_seconds: { type: 'integer', minimum: 0, maximum: WAIT_MAX, description: 'How long to wait for the answer before saying "running" (default ' + WAIT_DEFAULT + ').' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    parse (args) {
      const bad = onlyKeys(args, ['task', 'task_id', 'idempotency_key', 'wait_seconds'])
      if (bad !== null) return { ok: false, error: bad }
      const hasTask = args.task !== undefined
      if (hasTask === (args.task_id !== undefined)) return { ok: false, error: 'Give either task (to start one) or task_id (to wait for one), not both and not neither.' }
      if (hasTask && (typeof args.task !== 'string' || args.task.trim() === '' || args.task.length > TASK_MAX)) return { ok: false, error: 'task must be a text of 1 to ' + TASK_MAX + ' characters.' }
      if (!hasTask && !isTaskId(args.task_id)) return { ok: false, error: 'task_id must be the id a previous kaby_do returned.' }
      if (args.idempotency_key !== undefined && (!hasTask || !isKey(args.idempotency_key))) return { ok: false, error: 'idempotency_key goes with task, and uses only letters, digits and . _ : - (100 at most).' }
      const wait = args.wait_seconds === undefined ? WAIT_DEFAULT : args.wait_seconds
      if (!integerIn(wait, 0, WAIT_MAX)) return { ok: false, error: 'wait_seconds must be a whole number from 0 to ' + WAIT_MAX + '.' }
      return { ok: true, value: { task: hasTask ? args.task.trim() : undefined, task_id: args.task_id, key: args.idempotency_key, waitMs: wait * 1000 } }
    },
    async run (v) {
      if (v.task_id !== undefined) {
        const rec = deps.tasks.get(v.task_id)
        if (rec === null) return refuse('unknown_task', 'This door has no task with that id: it was never given here, or it is older than seven days.')
        return watch(rec, v.waitMs, false)
      }
      if (v.key !== undefined) {
        const same = deps.tasks.byKey(v.key)
        if (same !== null) return watch(same, v.waitMs, false)
      }
      const f = deps.facade()
      if (f === null) return refuse('sessions_unavailable', 'Kybernos cannot start a task right now: its sessions are not ready. Try again in a moment.')
      let session = null
      try { session = await f.create() } catch (e) { session = null }
      if (session === null) return refuse('no_session', 'Kybernos could not open a conversation for this task.')
      // « Ask first », BEFORE anything is sent: the profile's default permission may be one that never asks, and a task that came in through the door must not run on it. Fail closed.
      let asking = { ok: false, error: 'failed' }
      try { asking = await f.askFirst(session) } catch (e) { asking = { ok: false, error: 'failed' } }
      if (asking.ok !== true) return refuse('approvals_unavailable', 'The task was not started: Kybernos could not put it under "ask first" (' + String(asking.error || 'failed') + '), and a task from an outside assistant never runs without asking.')
      // Recorded BEFORE the prompt is queued: a task that runs always has its way back.
      const rec = deps.tasks.start({ session, key: v.key })
      if (rec === null) return refuse('task_not_kept', 'The task could not be recorded in the profile, so it was not started.')
      // Lets the new session settle before its first prompt, as the cloud computer's turn does.
      await sleep(settleMs)
      let queued = false
      try { queued = await f.prompt(session, v.task) } catch (e) { queued = false }
      if (queued !== true) return refuse('prompt_refused', 'Kybernos refused the task: its model may not be set up.')
      return watch(rec, v.waitMs, true)
    },
  }

  const listTasks = {
    name: 'list_tasks',
    title: 'List the tasks given to Kaby',
    description: 'The tasks given to Kaby through this door, most recent first, with whether each is still going. Read-only; use kaby_do with a task_id to read one\'s answer.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: LIST_MAX, description: 'How many (default ' + LIST_DEFAULT + ').' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    parse (args) {
      const bad = onlyKeys(args, ['limit'])
      if (bad !== null) return { ok: false, error: bad }
      const limit = args.limit === undefined ? LIST_DEFAULT : args.limit
      if (!integerIn(limit, 1, LIST_MAX)) return { ok: false, error: 'limit must be a whole number from 1 to ' + LIST_MAX + '.' }
      return { ok: true, value: { limit } }
    },
    async run (v) {
      const out = []
      for (const rec of deps.tasks.recent(v.limit)) {
        const st = await liveState(rec.session)
        const waiting = waitingOf(st)
        out.push({ task_id: rec.id, started_at: new Date(rec.at).toISOString(), status: rec.stopped === true ? 'canceled' : (waiting !== '' ? waiting : (busyOf(st) ? 'running' : 'finished')) })
      }
      return { data: { tasks: out } }
    },
  }

  const kabyStop = {
    name: 'kaby_stop',
    title: 'Stop a task Kaby is doing',
    description: 'Stop a task you gave Kaby that is still going: Kaby and the agents it started stop working at once and nothing waiting is run. What the task already did is not undone. '
      + 'Give the task_id a previous kaby_do returned. A task that already finished is not touched: its answer is returned as it was.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string', description: 'The task_id of the task to stop.' } }, required: ['task_id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    parse (args) {
      const bad = onlyKeys(args, ['task_id'])
      if (bad !== null) return { ok: false, error: bad }
      if (!isTaskId(args.task_id)) return { ok: false, error: 'task_id must be the id a previous kaby_do returned.' }
      return { ok: true, value: { task_id: args.task_id } }
    },
    async run (v) {
      const rec = deps.tasks.get(v.task_id)
      if (rec === null) return refuse('unknown_task', 'This door has no task with that id: it was never given here, or it is older than seven days.')
      if (rec.stopped === true) return still(rec, 'canceled')
      const f = deps.facade()
      if (f === null || typeof f.stop !== 'function') return refuse('sessions_unavailable', 'Kybernos cannot stop a task right now: its sessions are not ready. Try again in a moment.')
      // A task that is over is not « stopped »: its answer stays what it was.
      const before = await liveState(rec.session)
      if (!busyOf(before) && waitingOf(before) === '') return finished(rec)
      let stopped = { ok: false, error: 'failed' }
      try { stopped = await f.stop(rec.session) } catch (e) { stopped = { ok: false, error: 'failed' } }
      if (stopped === null || typeof stopped !== 'object' || stopped.ok !== true) return refuse('stop_failed', 'Kybernos could not stop the task (' + String((stopped && stopped.error) || 'failed') + '). It may still be running: ask again.')
      deps.tasks.markStopped(rec.id)
      // The engine shows the task idle within moments of the cancel; say so, or say that it is still stopping.
      const t0 = now()
      for (;;) {
        const st = await liveState(rec.session)
        if (!busyOf(st)) return still(rec, 'canceled')
        if (now() - t0 >= (deps.stopWaitMs ?? STOP_WAIT_MS)) return { data: { ...base(rec, 'canceled'), stopping: true, next: 'The stop was sent and the engine has not shown the task idle yet. Ask again in a few seconds.' } }
        await sleep(pollMs)
      }
    },
  }

  return [kabyDo, listTasks, kabyStop]
}
