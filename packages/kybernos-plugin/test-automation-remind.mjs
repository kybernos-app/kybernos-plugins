// The rules of a reminder (automation-remind.mjs): what the model may ask for, what the route stores, and how DSH's own schedule_create is refused.
// The whole path through the real host (tool, route, tick, list) is proved in scripts/test-reminder-route.mjs.
import { reminderInput, reminderRefusal, sameReminder, isWaitingReminder, nameOf, nativeDenial, mountNativeReminderDenial, NATIVE_DENIAL, reminderWhat, reminderCard, reminderAsk, mountReminderAsk, whenWords, REMIND_MAX_WAITING, REMIND_MAX_MINUTES } from './automation-remind.mjs'

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

// ── the question before a reminder is stored (the card the person reads) ──
// NOW is Tuesday 3 November 2026, 22:00 UTC; the zone is given in every call so the test does not depend on the machine's.
const call = (args) => ({ name: 'automation_remind', arguments: args })
const card = (args) => reminderCard(call(args), NOW)
eq('« Remind the person to … » is shown as the thing to do', [reminderWhat('Remind the person to call the plumber.'), reminderWhat('Rappelle à la personne de appeler le plombier.'), reminderWhat('Call the plumber'), reminderWhat('Remind me to a')], ['Call the plumber', 'Appeler le plombier', 'Call the plumber', 'Remind me to a'])
eq('tomorrow: the day is named, so a wrong date is seen', card({ message: 'Remind the person to call the plumber.', at: '2026-11-04T09:00', timezone: 'UTC' }), { en: 'Kaby wants to remind you tomorrow (Wednesday) at 9:00: “Call the plumber”', fr: 'Kaby veut te rappeler demain (mercredi) à 9 h 00 : « Call the plumber »' })
eq('today', card({ message: 'Take the bread out', at: '2026-11-03T23:30', timezone: 'UTC' }), { en: 'Kaby wants to remind you today at 23:30: “Take the bread out”', fr: 'Kaby veut te rappeler aujourd’hui à 23 h 30 : « Take the bread out »' })
eq('within the week: the weekday', [whenWords({ at: '2026-11-06T15:05', tz: 'UTC', minutes: 0 }, NOW, 'en'), whenWords({ at: '2026-11-06T15:05', tz: 'UTC', minutes: 0 }, NOW, 'fr')], ['on Friday at 15:05', 'vendredi à 15 h 05'])
eq('further away: the date, and the year when it is not this one', [whenWords({ at: '2026-11-21T09:00', tz: 'UTC', minutes: 0 }, NOW, 'en'), whenWords({ at: '2026-11-21T09:00', tz: 'UTC', minutes: 0 }, NOW, 'fr'), whenWords({ at: '2027-01-05T08:00', tz: 'UTC', minutes: 0 }, NOW, 'en')], ['on Saturday 21 November at 9:00', 'le samedi 21 novembre à 9 h 00', 'on Tuesday 5 January 2027 at 8:00'])
eq('a few minutes: in N minutes', [card({ message: 'Stand up', in_minutes: 10 }).en, card({ message: 'Stand up', in_minutes: 1 }).fr], ['Kaby wants to remind you in 10 minutes: “Stand up”', 'Kaby veut te rappeler dans 1 minute : « Stand up »'])
eq('an instant with an offset is read in the zone given', whenWords({ at: '2026-11-04T08:00:00Z', tz: 'Europe/Paris', minutes: 0 }, NOW, 'en'), 'tomorrow (Wednesday) at 9:00')
eq('a zone the host does not know falls back to the machine\'s: still a sentence', typeof whenWords({ at: '2026-11-04T09:00', tz: 'Not/AZone', minutes: 0 }, NOW, 'en'), 'string')
eq('a date nobody can read: the card still says what it is for', card({ message: 'Call', at: 'soon-ish', timezone: 'UTC' }), { en: 'Kaby wants to set a reminder: “Call”', fr: 'Kaby veut créer un rappel : « Call »' })
eq('a call that would fail anyway has no card (the tool says why)', [card({ message: ' ', at: '2026-11-04T09:00' }), card({ message: 'x' }), card({ message: 'x', at: '2026-11-04T09:00', in_minutes: 5 }), card({ message: 'x', in_minutes: 0 }), reminderCard({ name: 'bash', arguments: {} }, NOW), reminderCard(null, NOW)], [null, null, null, null, null, null])
const want = { kind: 'ask', reason: 'Kaby wants to remind you tomorrow (Wednesday) at 9:00: “Call”', displayReason: { en: 'Kaby wants to remind you tomorrow (Wednesday) at 9:00: “Call”', fr: 'Kaby veut te rappeler demain (mercredi) à 9 h 00 : « Call »' } }
const args = { message: 'Call', at: '2026-11-04T09:00', timezone: 'UTC' }
eq('the engine\'s own card is asked for in a chat that asks', reminderAsk(call(args), 'ask', NOW), want)
eq('...but not in Full access (the person switched the questions off), nor with no way to ask', [reminderAsk(call(args), 'never', NOW), reminderAsk(call(args), null, NOW)], [null, null])
const hooks = []
const approvalOf = (policy) => ({ get: (n) => (n === 'approval' ? (policy === null ? undefined : { effectivePolicy: () => policy }) : undefined), on: (name, fn, opts) => { hooks.push({ name, fn, opts }) } })
const run = async (ctx, exec) => { hooks.length = 0; mountReminderAsk(ctx, ctx.deps); return hooks[0].fn(exec, async () => 'went-on') }
const live = { name: 'automation_remind', arguments: { message: 'Call', in_minutes: 10 }, agent: { session: {} } }
eq('mounted on tools/pre-execute, not first (the Light agent chat answers before it)', (await run(approvalOf('ask'), live)).kind === 'ask' && hooks[0].name === 'tools/pre-execute' && hooks[0].opts === undefined, true)
eq('a chat in Full access: the call goes on', await run(approvalOf('never'), live), 'went-on')
eq('no approval service: the call goes on', await run(approvalOf(null), live), 'went-on')
eq('another tool goes on', await run(approvalOf('ask'), { name: 'bash', arguments: {} }), 'went-on')
const skipping = Object.assign(approvalOf('ask'), { deps: { skip: () => true } })
eq('an automation run or a cloud computer\'s turn (skip) goes on without a card', await run(skipping, live), 'went-on')
const broken = Object.assign(approvalOf('ask'), { get: () => { throw new Error('no service') } })
eq('a service that throws never breaks the call', await run(broken, live), 'went-on')
eq('a policy that cannot be read counts as asking', (await run(Object.assign(approvalOf('ask'), { get: (n) => (n === 'approval' ? { effectivePolicy: () => { throw new Error('unreadable') } } : undefined) }), live)).kind, 'ask')
delete globalThis[Symbol.for('kybernos.reminderCard')]
mountReminderAsk(approvalOf('ask'))
const published = globalThis[Symbol.for('kybernos.reminderCard')]
eq('mounting publishes the card\'s words for the phone\'s Light agent chat (the same sentence, or null for a call that would fail)', [typeof published, published(call({ message: 'Call', in_minutes: 10 })).en, published(call({ message: ' ' })), published(null)], ['function', 'Kaby wants to remind you in 10 minutes: “Call”', null, null])
const asked = []
eq('a seam that throws is logged and the bundle starts', [mountReminderAsk({ on: () => { throw new Error('no seam') } }, {}, (m) => asked.push(m)), asked.length, mountReminderAsk(null), mountReminderAsk({})], [false, 1, false, false])

console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
