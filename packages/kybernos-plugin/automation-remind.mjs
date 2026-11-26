// A reminder is an automation that runs once, in the chat that made it (the “one notion” of the Automations page).
//
// DSH's own `schedule_create` makes a native scheduled task with a card of its own. The plugin hides that panel, so the person ended up with the model's text, the native
// card and a notification block for one reminder, and a task that the Automations page never showed. `automation_remind` makes the same thing as a stored automation
// instead: the same sheet, the same Sessions, one line in the chat. `schedule_create` is refused with the way to the new tool (no engine patch: the engine's own
// `tools/pre-execute` seam, run before any approval card), unless the person turned DSH's native tasks back on in the Automations settings.
//
// No I/O here: index.js stores the task and reads the settings, these functions only decide, so the tests can drive them without a host.
//
// What a reminder is NOT allowed to be (it skips the certification gate, like a suggestion Kaby proposes or an automation that predates the gate, so its reach is kept narrow):
// one date, never a cron; a few months ahead at most; approvals always `ask` (every action it prompts still waits for the person); no apps and no skills (`needs` is left out);
// posted only in the chat that made it, whose id is the engine's and never the model's; and a few of them at a time.
import { HOME_ID_RE } from './automation-suggest.mjs'

export const REMIND_RECIPE = 'reminder'
export const REMIND_MAX_DAYS = 366
export const REMIND_MAX_WAITING = 25
export const REMIND_MAX_MINUTES = REMIND_MAX_DAYS * 24 * 60
export const NATIVE_TOOL = 'schedule_create'
export const NATIVE_DENIAL = 'Reminders are made with automation_remind: it keeps the reminder with the person\'s automations, in this chat. Call automation_remind with the same message and the same time. Do not use schedule_create.'

const text = (value) => (typeof value === 'string' ? value : '')

/** The name of a reminder when the model gave none: its first line, short. */
export const nameOf = (name, message) => {
  const given = text(name).trim()
  if (given !== '') return given
  const line = text(message).trim().split(/\r?\n/u)[0].trim()
  return Array.from(line).slice(0, 60).join('')
}

/**
 * What the model gave → the task input of the tasks route, or why not. `args`: `{ message, name?, at?, in_minutes?, timezone? }`; `sessionId` is the engine's;
 * `nowMs` is the clock. `at` is a date-time (`2026-11-03T23:07`, in the machine's zone unless it carries an offset or a Z); `in_minutes` is counted from now.
 */
export const reminderInput = (args, sessionId, nowMs) => {
  const a = args !== null && typeof args === 'object' ? args : {}
  const message = text(a.message).trim()
  if (message === '') return { ok: false, error: 'message required' }
  if (typeof sessionId !== 'string' || HOME_ID_RE.test(sessionId) !== true) return { ok: false, error: 'no chat' }
  const hasAt = text(a.at).trim() !== ''
  const hasIn = a.in_minutes !== undefined && a.in_minutes !== null
  if (hasAt === hasIn) return { ok: false, error: hasAt ? 'one time only' : 'time required' }
  let at = text(a.at).trim()
  if (hasIn === true) {
    const m = a.in_minutes
    if (typeof m !== 'number' || Number.isFinite(m) !== true || m < 1 || m > REMIND_MAX_MINUTES) return { ok: false, error: 'invalid minutes' }
    at = new Date(nowMs + Math.round(m) * 60000).toISOString().replace(/\.\d{3}Z$/u, 'Z')
  }
  const tz = text(a.timezone).trim()
  return {
    ok: true,
    task: {
      name: nameOf(a.name, message),
      prompt: message,
      schedule: Object.assign({ mode: 'once', at }, tz !== '' && hasIn === false ? { tz } : {}),
      active: true,
      approvals: 'ask',
      sessionMode: 'home',
      homeSessionId: sessionId
    }
  }
}

/** A reminder this module made (the route stamps `origin.recipe`), still waiting for its date. */
export const isWaitingReminder = (task) => task !== null && typeof task === 'object' && task.active === true
  && task.origin !== null && typeof task.origin === 'object' && task.origin.recipe === REMIND_RECIPE

/** The same reminder asked twice (a retry of the model): same chat, same words, same moment. */
export const sameReminder = (task, other) => isWaitingReminder(task) === true
  && task.homeSessionId === other.homeSessionId && task.prompt === other.prompt
  && task.schedule !== null && typeof task.schedule === 'object' && other.schedule !== null && typeof other.schedule === 'object' && task.schedule.at === other.schedule.at

/** Why a reminder cannot be stored, or null: too far away, or too many already wait. `nextMs` is its first run. */
export const reminderRefusal = (tasks, nextMs, nowMs) => {
  if (typeof nextMs !== 'number' || Number.isFinite(nextMs) !== true) return 'that date is in the past'
  if (nextMs - nowMs > REMIND_MAX_DAYS * 86400000) return 'too far ahead'
  const waiting = (Array.isArray(tasks) ? tasks : []).filter((t) => isWaitingReminder(t) === true).length
  return waiting >= REMIND_MAX_WAITING ? 'too many reminders waiting' : null
}

/**
 * The refusal of DSH's own `schedule_create`: the engine's `{ kind: 'deny', reason }` for the pre-execute policy, or null when the call goes on. `allowNative()` is the
 * person's own choice (“DSH's Automation tasks stay in the menu”): when it answers true, nothing here changes how DSH behaves.
 */
export const nativeDenial = async (exec, allowNative) => {
  try {
    if (exec === null || typeof exec !== 'object' || exec.name !== NATIVE_TOOL) return null
    if (typeof allowNative === 'function' && (await allowNative()) === true) return null
    return { kind: 'deny', reason: NATIVE_DENIAL }
  } catch (e) { return null }
}

/** Mounts the refusal on the engine's `tools/pre-execute` seam, before any approval card. A missing seam drops it (the prompt chunk still steers); it never throws. */
export function mountNativeReminderDenial (ctx, allowNative, log = () => {}) {
  try {
    if (ctx === null || ctx === undefined || typeof ctx.on !== 'function') return false
    ctx.on('tools/pre-execute', async (exec, next) => (await nativeDenial(exec, allowNative)) || next(), { prepend: true })
    return true
  } catch (e) {
    log('automation reminder: native schedule_create not refused: ' + String((e && e.message) || e))
    return false
  }
}
