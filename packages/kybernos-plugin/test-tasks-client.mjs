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
const mod = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { KB_ROUTES_WITH_LOCAL_FALLBACK, kbRemoteOutcome, kbMachineTz, kbCronHuman, kbOnceLabel, kbFmtWhen, kbTasksList, kbExportTask, kbCloneDefinition, kbTaskError, kbTaskTriggerCode, KB_TASK_ERRORS }'))

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
const cron = (c, t) => mod.kbCronHuman(c, t || en)
eq('every Monday', cron('0 8 * * 1'), 'Every Monday, 08:00')
eq('weekdays with minutes', cron('30 9 * * 1-5'), 'Weekdays, 09:30')
eq('every day', cron('0 8 * * *'), 'Every day, 08:00')
eq('Friday is in 24 h like the others (it read "4:00 PM")', cron('0 16 * * 5'), 'Every Friday, 16:00')
eq('French', cron('0 16 * * 5', fr), 'Chaque vendredi, 16:00')
for (const [c, why] of [['0 8 1 * *', 'a day of the month used to read "Every day"'], ['0 9 * 3 *', 'a month'], ['0 */2 * * *', 'an hour step used to read "NaN:00"'], ['0 8,17 * * *', 'an hour list'], ['0 * * * *', 'every hour'], ['*/15 * * * *', 'every 15 minutes'], ['0 8 * * 1,3', 'two weekdays']]) {
  eq('shown as the expression: ' + c + ' (' + why + ')', cron(c), 'Cron expression \u00b7 ' + c)
}
eq('not a cron: shown as written', cron('banana'), 'banana')
eq('empty', cron(''), '')

/* ── One-time and dates ──────────────────────────────────────────────────── */
eq('one-time label', mod.kbOnceLabel('2027-01-01T09:00', en, 2026), 'One time \u00b7 01/01 09:00 2027')
eq('same year: no year', mod.kbOnceLabel('2026-10-06T09:05', en, 2026), 'One time \u00b7 06/10 09:05')
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

/* ── Every key the page uses exists, in both languages ───────────────────── */
{
  const keys = new Set(Object.values(mod.KB_TASK_ERRORS))
  for (const k of ['tasks.monday8', 'tasks.weekdays8', 'tasks.everyday8', 'tasks.friday16', 'tasks.cron', 'tasks.onetime', 'tasks.trigger.webhook', 'tasks.ask', 'tasks.auto', 'tasks.name.placeholder', 'tasks.timezone']) keys.add(k)
  const missing = [...keys].filter((k) => table[k] === undefined || typeof table[k].en !== 'string' || table[k].en === '' || typeof table[k].kybernos !== 'string' || table[k].kybernos === '')
  eq('every translation key of the new code exists in both languages', missing.join(',') || 'none', 'none')
  const unreferenced = Object.keys(table).filter((k) => /^tasks\.(filter\.fromchat|origin\.(chat|template)|waiting|newautomation|desc|new|approvals|pausednodate|none|fire\.now)$/.test(k))
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
  eq('the on/off switches are reachable with the keyboard', (page.match(/className: 'kba-toggle'[^\n]*tabIndex: 0/g) || []).length, 2)
}

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
