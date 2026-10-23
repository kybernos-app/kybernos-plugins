// An automation published to this computer from the person's laptop (ADR 0052, the server's outbox of 2026-10-23): what the computer's reporter hands to
// `POST /kybernos/tasks/apply`, turned into a change of the task list. Pure: index.js gives it the list, the rules it already has (the sanitizer, the
// frequency rule, the next run) and the clock; the list is changed in place, inside the store's own serialized write.
//
// A published task is an ordinary task with one more field, `published: { ref, at }`. `ref` is the id the laptop gave it, and it is the id the reporter
// reports to the platform for it (a schedule row, a run), so that the person's laptop finds its automation again by the id it knows. The server's
// definition is never trusted whole: only six fields are read, everything else of a task (a home session, a workspace, a webhook, who is told) is
// the computer's own and keeps its defaults.
//
// Only `auto` automations can be published for now: the computer runs with no approval prompt and has no path yet to ask a person (the server refuses
// `ask` too, 422 `approval_path_missing`). A task that was made on this computer is never touched: only a task whose `published.ref` matches is replaced or removed.

export const REF = /^[A-Za-z0-9_.:-]{1,64}$/u

/** The id a task is known by outside this computer: the laptop's id when it was published, else its own. */
export const refOf = (task) => (task !== null && typeof task === 'object' && task.published !== null && typeof task.published === 'object' && REF.test(String(task.published.ref)) ? String(task.published.ref) : null)

const fail = (code) => ({ ok: false, code })

/** The six fields of a published definition, as the sanitizer should see them; null when it is not an object. */
const inputOf = (raw) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = { name: raw.name, prompt: raw.prompt, schedule: raw.schedule, active: raw.active, approvals: raw.approvals }
  if (raw.needs !== undefined) input.needs = raw.needs
  return input
}

/**
 * Applies one op to the task list.
 *   tasks: the stored array (changed in place)   op: 'put' | 'delete'   ref: the laptop's id for the automation   raw: the definition (put)
 *   deps:  { sanitize(input) -> {ok, task, error}, frequent(clean, input, previous) -> null | refusal, nextRun(task, nowMs) -> ms | null,
 *            neverRuns(task, nextMs) -> bool, newId() -> string, nowMs() -> number }
 * Returns { ok: true, state: 'applied', created? | removed? } or { ok: false, code } with a code from a closed list (it is sent to the platform as is):
 * invalid_op, invalid_ref, invalid_task, approval_path_missing, too_frequent, never_runs.
 */
export const applyOp = (tasks, op, ref, raw, deps) => {
  if (op !== 'put' && op !== 'delete') return fail('invalid_op')
  if (typeof ref !== 'string' || REF.test(ref) !== true) return fail('invalid_ref')
  if (op === 'delete') {
    let removed = 0
    for (let i = tasks.length - 1; i >= 0; i -= 1) if (refOf(tasks[i]) === ref) { tasks.splice(i, 1); removed += 1 }
    // Taking away what is not there is done: a removal sent twice must not fail the second time.
    return { ok: true, state: 'applied', removed }
  }
  const input = inputOf(raw)
  if (input === null) return fail('invalid_task')
  if (input.approvals !== 'auto') return fail('approval_path_missing')
  const clean = deps.sanitize(input)
  if (clean === null || typeof clean !== 'object' || clean.ok !== true) return fail('invalid_task')
  const at = tasks.findIndex((t) => refOf(t) === ref)
  const previous = at >= 0 ? tasks[at] : null
  if (deps.frequent(clean.task, input, previous) !== null) return fail('too_frequent')
  const nowMs = deps.nowMs()
  const now = new Date(nowMs).toISOString()
  const task = previous === null
    ? Object.assign({ id: deps.newId(), createdAt: now, updatedAt: now, history: [], lastRun: null }, clean.task, { published: { ref, at: now } })
    : Object.assign({}, previous, clean.task, { id: previous.id, createdAt: previous.createdAt, updatedAt: now, history: Array.isArray(previous.history) ? previous.history : [], published: { ref, at: previous.published.at } })
  const next = deps.nextRun(task, nowMs)
  if (deps.neverRuns(task, next) === true) return fail('never_runs')
  task.nextRun = next === null ? null : new Date(next).toISOString()
  if (at >= 0) tasks[at] = task
  else tasks.push(task)
  return { ok: true, state: 'applied', created: at < 0 }
}
