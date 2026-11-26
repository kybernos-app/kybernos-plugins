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

// ── The question before a reminder is stored ─────────────────────────────────────────────────────────────────
// `automation_remind` is a tool of this plugin: the engine knows nothing of what it does, so in an « ask first » chat (Workspace Write, Read Only) it ran with no card at all (measured on 0.2.1-rc.2:
// « Remind me tomorrow at 9 to call the plumber » created the reminder in Simple and in the full app, nothing was asked). The promise to the person is « it asks before it acts »: the card
// below is the engine's own approval card (`{ kind: 'ask' }` from `tools/pre-execute`), worded for the person, with the day and the time the reminder will really come, so a wrong date the
// model worked out is seen before it is stored. It is not shown: in « Full access » (the person switched the questions off: the engine would reject the card unseen), in a run of an automation or on a
// cloud computer (nobody is in front of an engine card there; the cloud bundle's own gates ask), and for a call that would fail anyway (the tool says why).
export const REMIND_TOOL = 'automation_remind'

const CARD_LEAD = /^(?:(?:remind|tell) (?:the person|the user|me|them|you) (?:to|that|of|about) |rappelle(?:-moi| moi| à la personne| à l'utilisateur)? (?:de |d'|que |qu'))/iu
const pad2 = (n) => String(n).padStart(2, '0')

/** What the reminder says, as the person reads it: the model writes « Remind the person to call the plumber. », the card shows « Call the plumber ». Display only. */
export const reminderWhat = (message) => {
  const t = Array.from(text(message).replace(/\s+/gu, ' ').trim()).slice(0, 120).join('')
  const cut = t.replace(CARD_LEAD, '').replace(/[.\s]+$/u, '')
  return cut !== t && cut.length >= 3 ? cut.charAt(0).toUpperCase() + cut.slice(1) : t
}

/** The wall-clock parts of an instant in a zone (the machine's when none, or when the name is not one). */
const zoneParts = (ms, tz) => {
  for (const zone of tz !== '' ? [tz, undefined] : [undefined]) {
    try {
      const f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      const p = {}
      for (const x of f.formatToParts(new Date(ms))) p[x.type] = Number(x.value)
      return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute }
    } catch (e) { /* a zone the host does not know: the machine's */ }
  }
  return null
}

const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/u
const ZONED = /(?:Z|[+-]\d{2}:?\d{2})$/iu

/** The time the model gave → `{ at, tz, minutes }` (`minutes` when it said « in N minutes »), or null when the call would fail anyway. */
const scheduleOf = (a, nowMs) => {
  const at = text(a.at).trim()
  const m = a.in_minutes
  if (at !== '' && (m === undefined || m === null)) return { at, tz: text(a.timezone).trim(), minutes: 0 }
  if (at === '' && typeof m === 'number' && Number.isFinite(m) && m >= 1 && m <= REMIND_MAX_MINUTES) return { at: new Date(nowMs + Math.round(m) * 60000).toISOString(), tz: '', minutes: Math.round(m) }
  return null
}

const NAMES = { en: 'en', fr: 'fr' }
const name = (lang, utcMs, opt) => new Intl.DateTimeFormat(NAMES[lang], Object.assign({ timeZone: 'UTC' }, opt)).format(new Date(utcMs))

/** « tomorrow (Saturday) at 9:00 », « on Saturday at 9:00 », « on Saturday 21 November at 9:00 », « in 10 minutes »; `null` when the date cannot be read. */
export const whenWords = (sched, nowMs, lang) => {
  const kt = (fr, en) => (lang === 'fr' ? fr : en)
  if (sched.minutes > 0 && sched.minutes <= 90) return lang === 'fr' ? 'dans ' + sched.minutes + ' minute' + (sched.minutes === 1 ? '' : 's') : 'in ' + sched.minutes + ' minute' + (sched.minutes === 1 ? '' : 's')
  const now = zoneParts(nowMs, sched.tz)
  let at = null
  const n = NAIVE.exec(sched.at)
  if (n !== null && ZONED.test(sched.at) !== true) at = { y: Number(n[1]), m: Number(n[2]), d: Number(n[3]), h: Number(n[4]), min: Number(n[5]) }
  else { const ms = Date.parse(sched.at); if (Number.isFinite(ms)) at = zoneParts(ms, sched.tz) }
  if (at === null || now === null) return null
  const dayMs = Date.UTC(at.y, at.m - 1, at.d, 12)
  const diff = Math.round((dayMs - Date.UTC(now.y, now.m - 1, now.d, 12)) / 86400000)
  const weekday = name(lang, dayMs, { weekday: 'long' })
  const clock = lang === 'fr' ? at.h + ' h ' + pad2(at.min) : at.h + ':' + pad2(at.min)
  if (diff === 0) return kt('aujourd’hui à ', 'today at ') + clock
  if (diff === 1) return kt('demain (' + weekday + ') à ', 'tomorrow (' + weekday + ') at ') + clock
  if (diff >= 2 && diff <= 6) return (lang === 'fr' ? weekday + ' à ' : 'on ' + weekday + ' at ') + clock
  // The pieces are named one by one: the order of a whole date differs from one ICU version to the next.
  const date = weekday + ' ' + at.d + ' ' + name(lang, dayMs, { month: 'long' }) + (at.y === now.y ? '' : ' ' + at.y)
  return (lang === 'fr' ? 'le ' + date + ' à ' : 'on ' + date + ' at ') + clock
}

/** One sentence of the card in one language: `when` is `whenWords` for that language, or null when the date cannot be read. */
const cardText = (lang, when, what) => {
  const kt = (fr, en) => (lang === 'fr' ? fr : en)
  return when === null
    ? kt('Kaby veut créer un rappel : « ' + what + ' »', 'Kaby wants to set a reminder: “' + what + '”')
    : kt('Kaby veut te rappeler ' + when + ' : « ' + what + ' »', 'Kaby wants to remind you ' + when + ': “' + what + '”')
}

/**
 * The words of the card for a call of `automation_remind`: `{ en, fr }`, or null when the call is not one or would fail anyway (no message, no time, two times): the tool then says why, no card is
 * worth a person's tap. `nowMs` is the clock.
 */
export const reminderCard = (exec, nowMs) => {
  if (exec === null || typeof exec !== 'object' || exec.name !== REMIND_TOOL) return null
  const a = exec.arguments !== null && typeof exec.arguments === 'object' ? exec.arguments : {}
  const what = reminderWhat(a.message)
  const sched = scheduleOf(a, nowMs)
  if (what === '' || sched === null) return null
  const en = whenWords(sched, nowMs, 'en')
  const fr = whenWords(sched, nowMs, 'fr')
  return { en: cardText('en', en, what), fr: cardText('fr', fr, what) }
}

/** The `tools/pre-execute` answer for a call: the engine's own approval card, or null (the call goes on). `policy` is the chat's approval policy (`'never'` = Full access, `null` = no way to ask). */
export const reminderAsk = (exec, policy, nowMs) => {
  if (policy === null || policy === 'never') return null
  const card = reminderCard(exec, nowMs)
  return card === null ? null : { kind: 'ask', reason: card.en, displayReason: card }
}

/**
 * Mounts the question on the engine's `tools/pre-execute` seam. `deps.skip(exec)`: true for a call nobody can be asked about (an automation run, a cloud computer's turn: their own gates ask).
 * The chat's policy comes from the engine's `approval` service (`'ask'` unless it says `'never'`; no service = no card). Any failure here lets the call go on (the tool is not held up by a card that cannot be made).
 */
export function mountReminderAsk (ctx, deps = {}, log = () => {}) {
  try {
    if (ctx === null || ctx === undefined || typeof ctx.on !== 'function') return false
    // The words of the card, for the one other chat that asks for a reminder itself (the phone's Light agent chat): read as `globalThis[Symbol.for('kybernos.reminderCard')](exec)` → `{ en, fr }` or null.
    try { globalThis[Symbol.for('kybernos.reminderCard')] = Object.freeze((exec) => { try { return reminderCard(exec, Date.now()) } catch (e) { return null } }) } catch (e) { /* a frozen global: that chat keeps its own words */ }
    ctx.on('tools/pre-execute', async (exec, next) => {
      try {
        if (exec !== null && typeof exec === 'object' && exec.name === REMIND_TOOL && !(typeof deps.skip === 'function' && deps.skip(exec) === true)) {
          const approval = typeof ctx.get === 'function' ? ctx.get('approval') : undefined
          let policy = null
          if (approval !== undefined && approval !== null) {
            policy = 'ask'
            try { if (typeof approval.effectivePolicy === 'function' && approval.effectivePolicy(exec.agent.session) === 'never') policy = 'never' } catch (e) { policy = 'ask' }
          }
          const answer = reminderAsk(exec, policy, Date.now())
          if (answer !== null) return answer
        }
      } catch (e) { /* never break a call */ }
      return next()
    })
    return true
  } catch (e) {
    log('automation reminder: the question before a reminder is not mounted: ' + String((e && e.message) || e))
    return false
  }
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
