// The rules of a reminder (automation-remind.mjs): what the model may ask for, what the route stores, and how DSH's own schedule_create is refused.
// The whole path through the real host (tool, route, tick, list) is proved in scripts/test-reminder-route.mjs.
import { reminderInput, reminderRefusal, sameReminder, isWaitingReminder, nameOf, nativeDenial, mountNativeReminderDenial, NATIVE_DENIAL, REMIND_MAX_WAITING, REMIND_MAX_MINUTES } from './automation-remind.mjs'

let fails = 0
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label) }

const NOW = Date.UTC(2026, 10, 3, 22, 0, 0)

// ── what the model asks for → what the route stores ──
eq('in minutes: counted from now, as an instant', reminderInput({ message: 'Call', in_minutes: 10 }, 'sess-1', NOW).task.schedule, { mode: 'once', at: '2026-11-03T22:10:00Z' })
eq('a date-time keeps its zone when one is given', reminderInput({ message: 'Call', at: '2026-11-04T09:30', timezone: 'Europe/Paris' }, 'sess-1', NOW).task.schedule, { mode: 'once', at: '2026-11-04T09:30', tz: 'Europe/Paris' })
eq('...and an instant in minutes never carries a zone of the model\'s', reminderInput({ message: 'Call', in_minutes: 5, timezone: 'Asia/Tokyo' }, 'sess-1', NOW).task.schedule, { mode: 'once', at: '2026-11-03T22:05:00Z' })
const full = reminderInput({ message: '  Remind the person.  ', in_minutes: 1 }, 'sess-1', NOW).task
eq('always on, always asking, in the engine\'s chat, with no apps', [full.active, full.approvals, full.sessionMode, full.homeSessionId, full.needs], [true, 'ask', 'home', 'sess-1', undefined])
eq('the prompt is the trimmed message, the name its first line', [full.prompt, full.name], ['Remind the person.', 'Remind the person.'])
eq('a long first line is cut for the name', nameOf('', 'x'.repeat(100)).length, 60)
eq('a name the model gave wins', nameOf('  Plumber ', 'Call the plumber'), 'Plumber')
const refuse = (args, sid) => reminderInput(args, sid === undefined ? 'sess-1' : sid, NOW).error
eq('no message', refuse({ message: ' ', in_minutes: 5 }), 'message required')
eq('no time', refuse({ message: 'x' }), 'time required')
eq('two times', refuse({ message: 'x', at: '2026-11-04T09:30', in_minutes: 5 }), 'one time only')
eq('minutes out of range or not a number', [refuse({ message: 'x', in_minutes: 0 }), refuse({ message: 'x', in_minutes: REMIND_MAX_MINUTES + 1 }), refuse({ message: 'x', in_minutes: '5' }), refuse({ message: 'x', in_minutes: NaN })], ['invalid minutes', 'invalid minutes', 'invalid minutes', 'invalid minutes'])
eq('no chat or an odd chat id', [refuse({ message: 'x', in_minutes: 5 }, ''), refuse({ message: 'x', in_minutes: 5 }, 'a b'), refuse({ message: 'x', in_minutes: 5 }, undefined)], ['no chat', 'no chat', undefined])
eq('a missing args object is a missing message, not a crash', [reminderInput(null, 'sess-1', NOW).error, reminderInput(undefined, 'sess-1', NOW).error], ['message required', 'message required'])

// ── what the route keeps ──
const reminder = (o) => Object.assign({ id: 't', active: true, prompt: 'p', homeSessionId: 'sess-1', schedule: { mode: 'once', at: 'A' }, origin: { by: 'chat', recipe: 'reminder' } }, o || {})
eq('a waiting reminder is active and stamped by this module', [isWaitingReminder(reminder()), isWaitingReminder(reminder({ active: false })), isWaitingReminder(reminder({ origin: { by: 'kaby', recipe: 'x' } })), isWaitingReminder(null)], [true, false, false, false])
eq('the same chat, words and moment are the same reminder', [sameReminder(reminder(), reminder()), sameReminder(reminder(), reminder({ prompt: 'q' })), sameReminder(reminder(), reminder({ homeSessionId: 's2' })), sameReminder(reminder(), reminder({ schedule: { mode: 'once', at: 'B' } })), sameReminder(reminder({ active: false }), reminder())], [true, false, false, false, false])
const many = Array.from({ length: REMIND_MAX_WAITING }, () => reminder())
eq('too far, too many, or fine', [reminderRefusal([], NOW + 400 * 86400000, NOW), reminderRefusal(many, NOW + 60000, NOW), reminderRefusal(many.slice(1), NOW + 60000, NOW), reminderRefusal([], null, NOW)], ['too far ahead', 'too many reminders waiting', null, 'that date is in the past'])
eq('reminders that ran do not count against the limit', reminderRefusal(many.map((t) => Object.assign({}, t, { active: false })), NOW + 60000, NOW), null)

// ── DSH's own schedule_create ──
eq('schedule_create is denied with the way to the tool', await nativeDenial({ name: 'schedule_create' }, () => false), { kind: 'deny', reason: NATIVE_DENIAL })
eq('...the reason names automation_remind', NATIVE_DENIAL.includes('automation_remind'), true)
eq('every other tool goes on', [await nativeDenial({ name: 'schedule_list' }, () => false), await nativeDenial({ name: 'bash' }, () => false), await nativeDenial(null, () => false), await nativeDenial({}, () => false)], [null, null, null, null])
eq('the person\'s choice to keep DSH\'s native tasks wins (also when the answer is a promise)', [await nativeDenial({ name: 'schedule_create' }, () => true), await nativeDenial({ name: 'schedule_create' }, async () => true)], [null, null])
eq('an unreadable choice is not an excuse to break the call: it goes on', await nativeDenial({ name: 'schedule_create' }, () => { throw new Error('unreadable') }), null)

// ── mounting: guarded, a missing seam only drops the refusal ──
const seen = []
eq('the refusal is put on tools/pre-execute, before the approval cards', [mountNativeReminderDenial({ on: (name, fn, opts) => { seen.push([name, typeof fn, opts]) } }, () => false), seen], [true, [['tools/pre-execute', 'function', { prepend: true }]]])
const logged = []
eq('a seam that throws is logged and the bundle starts', [mountNativeReminderDenial({ on: () => { throw new Error('no seam') } }, () => false, (m) => logged.push(m)), logged.length], [false, 1])
eq('no context at all is not an error', [mountNativeReminderDenial(null, () => false), mountNativeReminderDenial({}, () => false)], [false, false])

console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
