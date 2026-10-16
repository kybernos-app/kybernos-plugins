// Test of the pure helpers of the Automations page and of the host calls: what to do with a
// reply (or a failure) of a host route, the cron / one-time / date labels, the export and the
// clone, and that every translation key the page uses exists in both languages.
// It extracts the KB-TASKS-CLIENT block of client.js (the file is a browser bundle with no exports).
// Usage: node packages/kybernos-plugin/test-tasks-client.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
const m = src.match(/\/\/ KB-TASKS-CLIENT-BEGIN([\s\S]*?)\/\/ KB-TASKS-CLIENT-END/)
if (m === null) { console.error('KB-TASKS-CLIENT block not found in client.js'); process.exit(1) }
const mod = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { KB_ROUTES_WITH_LOCAL_FALLBACK, kbRemoteOutcome, kbMachineTz, kbCronHuman, kbCronTime, kbCronAt, kbCronOnDays, kbOnceLabel, kbZoneLabel, kbEditChatText, kbTaskWho, kbFmtWhen, kbTasksList, kbExportTask, kbCloneDefinition, kbTaskError, kbTaskTriggerCode, kbTriggerParts, kbListState, KB_TASK_ERRORS }'))

let fails = 0
const eq = (label, got, want) => { const ok = got === want; if (!ok) { fails++; console.log('FAIL', label, '| got', got, '| want', want) } else console.log('ok  ', label) }

// The real translation table: the `tasks.*` entries of KB_T, one object literal per line.
const table = {}
for (const line of src.split('\n')) {
  const t = /^\s*'(tasks\.[A-Za-z0-9_.]+)':\s*(\{.*\}),?\s*$/.exec(line)
  if (t !== null) { try { table[t[1]] = (0, eval)('(' + t[2] + ')') } catch (e) { /* not a plain entry */ } }
}
const tr = (lang) => (key) => (table[key] !== undefined ? table[key][lang] : '?' + key)
const en = tr('en'); const fr = tr('kybernos')

/* ── What to do with the answer of a host route ──────────────────────────── */
const R = (status, json) => ({ ok: status >= 200 && status < 300, status, json })
const out = (name, reply, failure) => mod.kbRemoteOutcome(name, reply, failure)
eq('a JSON answer is used', out('kybers/tasks', R(200, { ok: true, tasks: [] }), null).use, 'remote')
eq('an answer that says ok:false is used too (it carries the reason)', JSON.stringify(out('kybers/tasks', R(200, { ok: false, error: 'x' }), null).value), '{"ok":false,"error":"x"}')
eq('404: this host has no routes, switch to the local copy', JSON.stringify(out('kybers/load', R(404, undefined), null)), '{"use":"fallback","hostHasNoRoutes":true}')
eq('404 on tasks too', out('kybers/tasks', R(404, undefined), null).hostHasNoRoutes, true)
eq('a 500 on a route with a local copy falls back for this call only', JSON.stringify(out('kybers/load', R(500, undefined), null)), '{"use":"fallback","hostHasNoRoutes":false}')
eq('a dropped request on a route with a local copy never disables the host', JSON.stringify(out('kybers/load', null, new Error('network down'))), '{"use":"fallback","hostHasNoRoutes":false}')
eq('a refusal with a reason (401) is shown as it is, not as "workspaceFiles unavailable"', JSON.stringify(out('kybers/tasks', R(401, { ok: false, error: 'sign-in required' }), null).value), '{"ok":false,"error":"sign-in required"}')
eq('413 too', out('kybers/tasks', R(413, { ok: false, error: 'request body too large' }), null).value.error, 'request body too large')
eq('an HTML error page says the status', JSON.stringify(out('kybers/tasks', R(502, undefined), null).value), '{"ok":false,"error":"HTTP 502"}')
eq('a dropped request on tasks says why', JSON.stringify(out('kybers/tasks', null, new Error('network down'))), '{"use":"error","value":{"ok":false,"error":"network down"}}')
eq('a 200 that is not JSON is reported', out('kybers/tasks', R(200, undefined), null).value.error, 'unexpected reply')
eq('write routes that have a local message keep falling back', ['kybers/yaml', 'kybers/save', 'kybers/ui-save'].map((n) => out(n, R(500, undefined), null).use).join(','), 'fallback,fallback,fallback')
eq('routes without a local copy are not in the fallback set', ['kybers/tasks', 'kybers/create', 'kybers/art-action'].some((n) => mod.KB_ROUTES_WITH_LOCAL_FALLBACK.has(n)), false)

/* ── Cron labels: exact, or the expression itself ────────────────────────── */
const cron = (c, t, locale, zone) => mod.kbCronHuman(c, t || en, locale, zone)
eq('every Monday', cron('0 8 * * 1'), 'Every Monday, 08:00')
eq('weekdays with minutes', cron('30 9 * * 1-5'), 'Weekdays, 09:30')
eq('every day', cron('0 8 * * *'), 'Every day, 08:00')
eq('Friday is in 24 h like the others (it read "4:00 PM")', cron('0 16 * * 5'), 'Every Friday, 16:00')
eq('French', cron('0 16 * * 5', fr, 'fr'), 'Chaque vendredi, 16:00')
// A5-09: the common shapes read as words (\u00ab Every 2 hours \u00bb used to read \u00ab Cron expression \u00b7 0 */2 * * * \u00bb).
eq('every 2 hours', cron('0 */2 * * *'), 'Every 2 hours')
eq('every 6 hours', cron('0 */6 * * *'), 'Every 6 hours')
eq('every 6 hours, at :30', cron('30 */6 * * *'), 'Every 6 hours at :30')
eq('every hour', cron('0 * * * *'), 'Every hour')
eq('every hour at :15', cron('15 * * * *'), 'Every hour at :15')
eq('every 15 minutes', cron('*/15 * * * *'), 'Every 15 minutes')
eq('every minute', cron('* * * * *') + '|' + cron('*/1 * * * *'), 'Every minute|Every minute')
eq('the 1st of the month', cron('0 8 1 * *', en, 'en'), 'Every month on the 1st, 08:00')
eq('ordinals: 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd', [2, 3, 4, 11, 12, 13, 21, 22, 23].map((d) => cron('0 8 ' + d + ' * *', en, 'en').replace(/^.* the (\d+[a-z]+),.*$/, '$1')).join(' '), '2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd')
eq('French says \u00ab le 1er \u00bb', cron('0 8 1 * *', fr, 'fr'), 'Chaque mois le 1er, 08:00')
eq('French: a plain day', cron('30 9 15 * *', fr, 'fr'), 'Chaque mois le 15, 09:30')
eq('any single weekday: Tuesday', cron('30 10 * * 2', en, 'en'), 'Every Tuesday, 10:30')
eq('...Sunday is 0 and 7', cron('0 9 * * 0', en, 'en') + '|' + cron('0 9 * * 7', en, 'en'), 'Every Sunday, 09:00|Every Sunday, 09:00')
eq('...in French', cron('30 10 * * 2', fr, 'fr'), 'Chaque mardi, 10:30')
eq('a wall-clock sentence names another zone', cron('0 8 * * *', en, 'en', 'Kolkata'), 'Every day, 08:00 (Kolkata)')
eq('...an interval has no wall clock, so no zone', cron('0 */2 * * *', en, 'en', 'Kolkata') + '|' + cron('*/15 * * * *', en, 'en', 'Kolkata'), 'Every 2 hours|Every 15 minutes')
// What a sentence cannot say exactly stays the expression (a wrong sentence is worse than the cron).
for (const [c, why] of [['30 23 31 * *', 'the 31st: not every month has one'], ['0 8 29 * *', 'the 29th: not every February has one'], ['0 9 * 3 *', 'a month'], ['0 */5 * * *', 'every 5 hours: 0, 5, 10, 15, 20, then 0 again'], ['*/7 * * * *', 'every 7 minutes: 56 then 0 is 4 minutes'], ['0 8,17 * * *', 'an hour list'], ['0 8 * * 1,3', 'two weekdays'], ['0 8 1 * 1', 'a day of the month AND a weekday'], ['99 99 * * *', 'not a time'], ['60 8 * * *', 'minute 60'], ['*/15 9-17 * * 1-5', 'working hours']]) {
  eq('shown as the expression: ' + c + ' (' + why + ')', cron(c), 'Cron expression \u00b7 ' + c)
}
// A5-31: the time of day of a schedule, read and rewritten by the form's time field.
eq('the time of a daily schedule', JSON.stringify(mod.kbCronTime('15 9 * * 1-5')), '{"hh":9,"mi":15}')
eq('...a custom expression has none', String(mod.kbCronTime('0 */6 * * *')) + '|' + String(mod.kbCronTime('0 8,17 * * *')) + '|' + String(mod.kbCronTime('banana')), 'null|null|null')
eq('...a monthly one has one', JSON.stringify(mod.kbCronTime('30 7 1 * *')), '{"hh":7,"mi":30}')
eq('changing the time keeps the days (the presets used to overwrite 09:15 with 08:00)', mod.kbCronAt('15 9 * * 1-5', 7, 30), '30 7 * * 1-5')
eq('...a bad time is refused', String(mod.kbCronAt('15 9 * * 1-5', 24, 0)) + '|' + String(mod.kbCronAt('0 */6 * * *', 7, 30)), 'null|null')
eq('the days of a preset keep the time', mod.kbCronOnDays('15 9 * * 1-5', '*'), '15 9 * * *')
eq('...and a custom expression becomes the preset at the default time', mod.kbCronOnDays('0 */6 * * *', '1'), '0 8 * * 1')
eq('not a cron: shown as written', cron('banana'), 'banana')
eq('empty', cron(''), '')

/* ── One-time and dates ──────────────────────────────────────────────────── */
// A5-10: one style, the board's own (\u00ab Sat, Oct 17 \u00b7 10:00 \u00bb), in the language of the page; never dd/mm.
eq('one-time label: weekday, day, month, then the time', mod.kbOnceLabel('2026-10-17T10:00', en, 2026, 'en'), 'One time \u00b7 Sat, Oct 17 \u00b7 10:00')
eq('...the year only when it is not this year', mod.kbOnceLabel('2027-01-01T09:00', en, 2026, 'en'), 'One time \u00b7 Fri, Jan 1, 2027 \u00b7 09:00')
eq('...in French', mod.kbOnceLabel('2026-10-17T10:00', fr, 2026, 'fr'), 'Une seule fois \u00b7 sam. 17 oct. \u00b7 10:00')
eq('...05/10 can no longer be read as the 10th of May', /\b0?5\/10\b/.test(mod.kbOnceLabel('2026-10-05T09:05', en, 2026, 'en')), false)
eq('...it names another zone', mod.kbOnceLabel('2026-10-17T10:00', en, 2026, 'en', 'Kolkata'), 'One time \u00b7 Sat, Oct 17 \u00b7 10:00 (Kolkata)')
eq('a zone is shown by its city', [mod.kbZoneLabel('Asia/Kolkata'), mod.kbZoneLabel('America/Argentina/Buenos_Aires'), mod.kbZoneLabel('UTC'), mod.kbZoneLabel(''), mod.kbZoneLabel(undefined)].join('|'), 'Kolkata|Buenos Aires|UTC||')
eq('an unreadable date is just "One time" (it used to be an empty cell)', mod.kbOnceLabel('', en, 2026) + '|' + mod.kbOnceLabel(undefined, en, 2026), 'One time|One time')
eq('a run time is shown in the zone of the automation (New York)', mod.kbFmtWhen('2026-10-12T12:00:00.000Z', 'America/New_York'), '12/10 08:00')
eq('...Tokyo', mod.kbFmtWhen('2026-10-12T12:00:00.000Z', 'Asia/Tokyo'), '12/10 21:00')
eq('...UTC', mod.kbFmtWhen('2026-10-12T12:00:00.000Z', 'UTC'), '12/10 12:00')
eq('midnight is 00:00, not 24:00', mod.kbFmtWhen('2026-10-12T22:00:00.000Z', 'Europe/Paris'), '13/10 00:00')
eq('an unreadable date is a dash, never NaN', mod.kbFmtWhen('garbage', 'UTC') + mod.kbFmtWhen(null, 'UTC') + mod.kbFmtWhen('', 'UTC'), '\u2014\u2014\u2014')
eq('an unknown zone falls back to the browser time', /^\d\d\/\d\d \d\d:\d\d$/.test(mod.kbFmtWhen('2026-10-12T12:00:00.000Z', 'Mars/Phobos')), true)
eq('no zone: the browser time', /^\d\d\/\d\d \d\d:\d\d$/.test(mod.kbFmtWhen('2026-10-12T12:00:00.000Z')), true)
eq('the machine zone is a real zone', Intl.supportedValuesOf('timeZone').includes(mod.kbMachineTz()) || mod.kbMachineTz() === 'UTC', true)

/* ── List, export, clone, messages ───────────────────────────────────────── */
eq('a null entry in the list is dropped (it crashed the whole page)', mod.kbTasksList([null, { id: 'a' }, 'x', [], undefined, 5, { id: 'b' }]).map((t) => t.id).join(','), 'a,b')
eq('not an array: empty', mod.kbTasksList(undefined).length + mod.kbTasksList({}).length, 0)
{
  const t = { id: 'st-1', name: 'N', prompt: 'P', schedule: { mode: 'cron', cron: '0 8 * * *', tz: 'UTC' }, runsOn: 'local', active: true, approvals: 'auto', notify: ['push'], nextRun: 'x', lastRun: 'y', history: [{ at: 'z' }], trigger: { type: 'webhook', hookId: 'hk_aaaaaaaaaaaa', secret: 'SECRET0123456789' }, pendingFires: ['an event'] }
  const exported = JSON.stringify(mod.kbExportTask(t))
  eq('the export never holds the webhook secret', exported.indexOf('SECRET0123456789') < 0 && exported.indexOf('hk_aaaaaaaaaaaa') < 0, true)
  eq('...nor the history, the id or queued events', ['history', 'st-1', 'an event', 'nextRun'].every((x) => exported.indexOf(x) < 0), true)
  eq('...but the whole definition', JSON.stringify(Object.keys(JSON.parse(exported))), '["name","prompt","schedule","runsOn","active","approvals","notify"]')
  const c = mod.kbCloneDefinition(t, 'N copy')
  eq('a clone is created paused (an active one ran the same work twice)', c.active, false)
  eq('...with the same schedule, zone and approvals', JSON.stringify(c.schedule) + c.approvals, '{"mode":"cron","cron":"0 8 * * *","tz":"UTC"}auto')
  eq('...and no webhook, id or history', JSON.stringify(c).indexOf('SECRET') < 0 && c.id === undefined && c.history === undefined, true)
  eq('a webhook-only automation clones as webhook-only', mod.kbCloneDefinition({ prompt: 'p', schedule: { mode: 'webhook', tz: 'UTC' } }, 'c').schedule.mode, 'webhook')
}
eq('a server message is translated', mod.kbTaskError('that date is in the past', en) + ' | ' + mod.kbTaskError('that date is in the past', fr), 'That date is in the past. | Cette date est déjà passée.')
eq('an unknown message is shown as it is', mod.kbTaskError('some other message', en), 'some other message')
eq('a prototype key is not a message', mod.kbTaskError('constructor', en), 'constructor')

eq('code view: a cron trigger carries the automation\x27s zone', mod.kbTaskTriggerCode({ mode: 'cron', cron: '0 8 * * 1', tz: 'America/New_York' }), '  trigger: schedule({ cron: "0 8 * * 1", tz: "America/New_York" }),')
eq('code view: a one-time trigger is a date (it printed cron: "")', mod.kbTaskTriggerCode({ mode: 'once', at: '2027-01-01T09:00', tz: 'UTC' }), '  trigger: once({ at: "2027-01-01T09:00", tz: "UTC" }),')
eq('code view: a webhook-only trigger', mod.kbTaskTriggerCode({ mode: 'webhook' }), '  trigger: webhook(),')
eq('code view: quotes in a value cannot break the line', mod.kbTaskTriggerCode({ mode: 'cron', cron: 'a"b', tz: 'UTC' }).includes('\\"'), true)

/* ── What the list shows, and the trigger on two lines ───────────────────── */
eq('loading: nothing answered yet', mod.kbListState(null, null), 'loading')
eq('the host could not answer: the reason, not "create your first automation"', mod.kbListState(null, 'Session expired'), 'error')
eq('an answered empty list is empty', mod.kbListState([], null), 'empty')
eq('a list holding only invalid entries is empty', mod.kbListState([null, 'x'], null), 'empty')
eq('a list with an automation', mod.kbListState([{ id: 'a' }], null), 'list')
eq('a later failed poll never hides a list that was loaded', mod.kbListState([{ id: 'a' }], 'HTTP 500'), 'list')
{
  const cronHook = mod.kbTriggerParts({ schedule: { mode: 'cron', cron: '0 9 * * 1-5' }, trigger: { type: 'webhook' } }, en)
  eq('schedule + webhook: the label is the schedule alone, the webhook is a second fact', cronHook.label + '|' + cronHook.hooked, 'Weekdays, 09:00|true')
  const only = mod.kbTriggerParts({ schedule: { mode: 'webhook' }, trigger: { type: 'webhook' } }, en)
  eq('webhook-only: its label already says it, no second line', only.label + '|' + only.hooked, 'External webhook|false')
  eq('one-time without a webhook (the board\x27s own date style, never dd/mm)', /^One time \u00b7 Tue, Dec 15(, \d{4})? \u00b7 09:00$/.test(mod.kbTriggerParts({ schedule: { mode: 'once', at: '2026-12-15T09:00' } }, en, 'en').label), true)
  eq('no schedule at all does not throw', typeof mod.kbTriggerParts({}, en).label, 'string')
  // A5-25: the schedule's own clock names its zone as soon as it is not the person's.
  const kolkata = { schedule: { mode: 'cron', cron: '0 8 * * *', tz: 'Asia/Kolkata' } }
  eq('another zone: the words name it', mod.kbTriggerParts(kolkata, en, 'en', 'Europe/Paris').label, 'Every day, 08:00 (Kolkata)')
  eq('the person\x27s own zone is not repeated', mod.kbTriggerParts(kolkata, en, 'en', 'Asia/Kolkata').label, 'Every day, 08:00')
  eq('no zone known for the viewer: nothing is guessed', mod.kbTriggerParts(kolkata, en, 'en').label, 'Every day, 08:00')
  eq('a one-time date names its zone too', mod.kbTriggerParts({ schedule: { mode: 'once', at: '2026-12-15T09:00', tz: 'America/New_York' } }, en, 'en', 'Europe/Paris').label.endsWith(' (New York)'), true)
  // A5-09: whatever the words, the tooltip is the expression (and its zone) so nothing is hidden.
  eq('the tooltip of a schedule is its cron and its zone', mod.kbTriggerParts(kolkata, en, 'en', 'Europe/Paris').tip, '0 8 * * * \u00b7 Asia/Kolkata')
  eq('...a webhook has none', mod.kbTriggerParts({ schedule: { mode: 'webhook' } }, en).tip, '')
  eq('...nor a zone line when it is the person\x27s', mod.kbTriggerParts({ schedule: { mode: 'cron', cron: '0 */2 * * *', tz: 'Europe/Paris' } }, en, 'en', 'Europe/Paris').tip, '0 */2 * * *')
}
eq('a paused webhook test is explained', mod.kbTaskError('automation paused', en), 'Resume the automation before testing its webhook.')

/* ── V-19: « Edit → chat » opens the automation-creator skill with the definition ── */
{
  const t = { id: 'st-abc-123456', name: 'Weekly product report', prompt: '1. Collect the changes\n2. Summarise them', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, approvals: 'auto', notify: ['push', 'email'], active: true, runsOn: 'local', nextRun: '2026-10-19T06:00:00.000Z', history: [{ at: '2026-10-12T06:00:00.000Z', sessionId: 's-1', status: 'fired' }], trigger: { type: 'webhook', hookId: 'hk_aaaaaaaaaaaa', secret: 'SECRET0123456789' } }
  const text = mod.kbEditChatText(t, en, 'en')
  eq('it names the skill, so the chat starts the interview the same way « Create » does', text.startsWith('Skill automation-creator'), true)
  eq('...it says this is an edit and not a new automation', /do not create a new one/.test(text), true)
  eq('...it carries the id the script needs', text.indexOf('st-abc-123456') >= 0, true)
  eq('...the name, the words of the schedule and the cron with its zone', text.indexOf('Weekly product report') >= 0 && text.indexOf('Every Monday, 08:00') >= 0 && text.indexOf('0 8 * * 1') >= 0 && text.indexOf('Europe/Paris') >= 0, true)
  eq('...the approvals, the notifications and the prompt', text.indexOf('Always allow') >= 0 && text.indexOf('push, email') >= 0 && text.indexOf('1. Collect the changes\n2. Summarise them') >= 0, true)
  eq('...never the webhook secret, the hook id or the history', text.indexOf('SECRET0123456789') < 0 && text.indexOf('hk_aaaaaaaaaaaa') < 0 && text.indexOf('s-1') < 0, true)
  eq('...it ends where the person types what to change', text.endsWith(en('tasks.edit.chat.ask')), true)
  eq('a one-time and a webhook-only automation say what they are', mod.kbEditChatText({ id: 'a', name: 'N', prompt: 'p', schedule: { mode: 'once', at: '2026-12-15T09:00', tz: 'UTC' } }, en, 'en').indexOf('2026-12-15T09:00') >= 0 && mod.kbEditChatText({ id: 'a', name: 'N', prompt: 'p', schedule: { mode: 'webhook' } }, en, 'en').indexOf('External webhook') >= 0, true)
  eq('an automation with nothing but an id does not throw', typeof mod.kbEditChatText({ id: 'a' }, en, 'en'), 'string')
  eq('in French, through the dictionary', mod.kbEditChatText(t, fr, 'fr').startsWith('Skill automation-creator'), true)
  eq('V-18: the line under the name says how it runs (an automation has no team of its own to name)', mod.kbTaskWho({ approvals: 'ask', notify: [] }, en) + '|' + mod.kbTaskWho({ approvals: 'auto', notify: ['push'] }, en), 'Ask me first|Always allow · notifications on')
}
{
  const keys = ['tasks.trigger.plushook', 'tasks.delete.title', 'tasks.delete.body', 'tasks.delete', 'tasks.deleted', 'tasks.load.error.title', 'tasks.loading', 'tasks.retry', 'tasks.preset.webhook', 'tasks.webhook.hint', 'tasks.hook.regen.title', 'tasks.hook.regen.body', 'tasks.hook.revoke.title', 'tasks.hook.revoke.body', 'tasks.hook.regen', 'tasks.hook.revokeBtn', 'tasks.cancel', 'tasks.err.paused']
  const missing = keys.filter((k) => table[k] === undefined || !table[k].en || !table[k].kybernos)
  eq('every translation key of the delete, confirm, state and webhook screens exists in both languages', missing.join(',') || 'none', 'none')
  eq('the delete text names the automation', en('tasks.delete.title').replace('{name}', 'Quarterly board deck'), 'Delete \u201cQuarterly board deck\u201d?')
}

/* ── Every key the page uses exists, in both languages ───────────────────── */
{
  const keys = new Set(Object.values(mod.KB_TASK_ERRORS))
  for (const k of ['tasks.weekdays8', 'tasks.everyday8', 'tasks.every.minute', 'tasks.every.minutes', 'tasks.every.hour', 'tasks.every.hour.at', 'tasks.every.hours', 'tasks.every.hours.at', 'tasks.every.dow', 'tasks.every.month', 'tasks.edit.chat', 'tasks.edit.chat.ask', 'tasks.edit.chat.act', 'tasks.edit.chat.aria', 'tasks.err.frequent', 'tasks.time', 'tasks.prompt.max', 'tasks.cron', 'tasks.onetime', 'tasks.trigger.webhook', 'tasks.ask', 'tasks.auto', 'tasks.name.placeholder', 'tasks.timezone']) keys.add(k)
  const missing = [...keys].filter((k) => table[k] === undefined || typeof table[k].en !== 'string' || table[k].en === '' || typeof table[k].kybernos !== 'string' || table[k].kybernos === '')
  eq('every translation key of the new code exists in both languages', missing.join(',') || 'none', 'none')
  const unreferenced = Object.keys(table).filter((k) => /^tasks\.(filter\.fromchat|origin\.(chat|template)|waiting|newautomation|desc|new|approvals|pausednodate|none|fire\.now|monday8|friday16)$/.test(k))
  eq('keys proved dead are gone', unreferenced.join(',') || 'none', 'none')
  const dups = {}; for (const line of src.split('\n')) { const t = /^\s*'(tasks\.[A-Za-z0-9_.]+)':\s*\{/.exec(line); if (t !== null) dups[t[1]] = (dups[t[1]] || 0) + 1 }
  eq('no tasks.* key is defined twice (the second silently won)', Object.keys(dups).filter((k) => dups[k] > 1).join(',') || 'none', 'none')
}

/* ── The page itself uses the helpers (static checks on the source) ──────── */
{
  const page = src.slice(src.indexOf('const KbTaskModal = '), src.indexOf('const ScheduledTasksPage = ') + 200000)
  eq('no hard-coded Europe/Paris in the page', page.indexOf('Europe/Paris') < 0, true)
  eq('the webhook URL goes through the API base, not a fixed path', page.indexOf("'/kybernos/hooks") < 0 && page.indexOf("kbApiBase() + '/hooks?hook='") >= 0, true)
  eq('the export goes through kbExportTask', page.indexOf('JSON.stringify(kbExportTask(t), null, 2)') >= 0 && page.indexOf('JSON.stringify(t, null, 2)') < 0, true)
  eq('the clone goes through kbCloneDefinition', page.indexOf('kbCloneDefinition(t, nom)') >= 0, true)
  eq('the French placeholder is gone from the page', page.indexOf("placeholder: 'Rapport hebdo") < 0, true)
  eq('the list is filtered through kbTasksList', page.indexOf('const list = kbTasksList(tasks)') >= 0, true)
  eq('an automation can be deleted, from the row and from its page, always after a confirmation', (page.match(/askDelete\(/g) || []).length === 2 && page.indexOf('KbConfirm, {') >= 0 && page.indexOf('await act(\'delete\', id)') >= 0, true)
  eq('the confirmation is rendered by the list view AND by the page of an automation', (page.match(/h\(KbConfirm, \{/g) || []).length === 2, true)
  eq('regenerating and revoking a webhook ask first', page.indexOf('tasks.hook.regen.title') >= 0 && page.indexOf('tasks.hook.revoke.title') >= 0 && page.indexOf('onClick: genHook }, kbt(\'tasks.hook.regen\')') < 0 && page.indexOf('onClick: revokeHook }') < 0, true)
  eq('the list has a loading state and an error state with a retry', page.indexOf('kbaSkeleton()') >= 0 && page.indexOf('kbaLoadError()') >= 0 && page.indexOf('tasks-retry') >= 0, true)
  eq('the form offers a webhook-only choice and opens the webhook tab after saving it', page.indexOf('pr.id === \'webhook\'') >= 0 && page.indexOf('openWebhookOf') >= 0, true)
  eq('a failed run shows its reason', page.indexOf('className: \'kba-reason\'') >= 0, true)
  eq('the confirmation closes on Escape without closing what is behind it', /KbConfirm = [\s\S]{0,700}e\.key === \'Escape\'\) \{ e\.stopPropagation\(\)/.test(page), true)
  eq('the on/off switches are reachable with the keyboard', (page.match(/className: 'kba-toggle'[^\n]*tabIndex: 0/g) || []).length, 2)
  // A5-10: no date of the page is written by a hard-coded locale; they all go through kbWhenOf (the board's formatter) or the helpers above.
  const tasksPage = src.slice(src.indexOf('const kbScheduleLabel = '), src.indexOf('const KB_MOCK_SKILLS = '))
  eq('no hard-coded en-GB in the page of the Automations', tasksPage.indexOf('en-GB') < 0 && tasksPage.indexOf('const kbWhenOf = (iso) =>') >= 0 && tasksPage.indexOf('kbBoardWhen(ms, Date.now(), kbMachineTz(), kbBoardLocale())') >= 0, true)
  eq('the cadence chips, the List and the detail read the schedule with the page\x27s language and the person\x27s zone', (tasksPage.match(/kbTriggerParts\(t, kbt, (kbBoardLocale\(\)|locale), (kbMachineTz\(\)|zone)\)/g) || []).length >= 3, true)
  // V-18: one column declaration for the header and the rows.
  eq('the header and the rows of the List share ONE column declaration', (src.match(/\n\.kba-rowbtn,\.kba-rowhead\{display:grid;grid-template-columns:/g) || []).length === 1 && /\n\.kba-row(head|btn)\{[^}]*grid-template-columns/.test(src) === false, true)
  eq('the header is built once for the skeleton and the list', (page.match(/kbaListHead\(\)/g) || []).length === 2, true)
  eq('the row actions come after the name button and are not nested in it', page.indexOf("className: 'kba-rowbtn'") < page.indexOf("className: 'kba-lacts'") && page.indexOf("className: 'kba-lacts'") < page.indexOf("role: 'switch', 'aria-checked': a.active"), true)
  // V-19: Edit in chat from the row and from the page of an automation, through the channel « Create » uses.
  eq('« Edit in chat » is on the row and on the page of an automation', page.indexOf("'data-kb': 'action-edit-chat'") >= 0 && page.indexOf("'data-kb': 'detail-edit-chat'") >= 0 && (page.match(/editInChat\(/g) || []).length >= 2, true)
  eq('...it opens the chat the way « Create » does (kbStartChatText) and falls back to the form', /const editInChat = \(t\) => \{\s*try \{ kbStartChatText\(kbEditChatText\(t, kbt, kbBoardLocale\(\)\)\) \} catch \(e\) \{ setModal\(t\) \}/.test(page), true)
  eq('...and the row\x27s button is named for its row', page.indexOf("kbt('tasks.edit.chat.aria').replace('{name}', () => a.name)") >= 0, true)
  // A5-31: presets keep the time, a time field edits it, the prompt says where it stops.
  eq('a preset sets the days and keeps the time, and the form has a time field', page.indexOf('kbCronOnDays(cron, pr.days)') >= 0 && page.indexOf("type: 'time'") >= 0 && page.indexOf('kbCronAt(cron, Number(m[1]), Number(m[2]))') >= 0, true)
  eq('the prompt field shows a counter near its 8000 characters', page.indexOf("'data-kb': 'prompt-count'") >= 0 && page.indexOf('maxLength: 8000') >= 0, true)
}

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
