// Test of the pure part of the Automations board (the Columns and Calendar views): which run is in which
// column, what a day of the calendar holds, the week and month grids, and what the page refuses to claim.
// It extracts the KB-AUTOBOARD block of client.js (the file is a browser bundle with no exports), and then
// checks, on the source, the contract of the page that draws it.
// Usage: node packages/kybernos-plugin/test-automation-board.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
const parts = src.split('// KB-AUTOBOARD-BEGIN')
if (parts.length !== 2) { console.error('exactly one KB-AUTOBOARD block expected in client.js'); process.exit(1) }
const block = parts[1].split('// KB-AUTOBOARD-END')[0]
const names = ['KB_BOARD_WINDOW_DAYS', 'KB_BOARD_DONE_MAX', 'KB_BOARD_OVERDUE_MS', 'kbBoardView', 'kbBoardDayKey', 'kbBoardHm', 'kbBoardAddDays', 'kbBoardWeekStart',
  'kbBoardWeekKeys', 'kbBoardMonthGrid', 'kbBoardWeekOffset', 'kbBoardWeekTitle', 'kbBoardMonthTitle', 'kbBoardDayName', 'kbBoardWhen', 'kbBoardIn', 'kbBoardLiveOf',
  'kbBoardRunState', 'kbBoardRuns', 'kbBoardIsPaused', 'kbBoardOverdue', 'kbBoardPlanned', 'kbBoardColumns', 'kbBoardGroupState', 'kbBoardDays', 'kbBoardReason']
const m = await import('data:text/javascript,' + encodeURIComponent(block + '\nexport { ' + names.join(', ') + ' }'))

let fails = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}
const Z = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h || 0, mi || 0)
const iso = (ms) => new Date(ms).toISOString()
const NOW = Z(2026, 10, 12, 9, 20) // Monday 12 October 2026, 09:20 UTC

/* ── The view that was stored ────────────────────────────────────────────── */
eq('columns and calendar are kept', [m.kbBoardView('columns'), m.kbBoardView('calendar')], ['columns', 'calendar'])
eq('list is the list', m.kbBoardView('list'), 'list')
eq('`cards`, what the toolbar stored before, reads as the list', m.kbBoardView('cards'), 'list')
eq('anything unknown is the list (the old screen is the safe one)', [m.kbBoardView(undefined), m.kbBoardView(null), m.kbBoardView('kanban'), m.kbBoardView(7)], ['list', 'list', 'list', 'list'])

/* ── Days, weeks, months ─────────────────────────────────────────────────── */
eq('a Monday starts its own week', m.kbBoardWeekKeys('2026-10-12', 0), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
eq('a Sunday belongs to the week that began on the Monday before', m.kbBoardWeekKeys('2026-10-18', 0)[0], '2026-10-12')
eq('next week and the week before', [m.kbBoardWeekKeys('2026-10-12', 1)[0], m.kbBoardWeekKeys('2026-10-12', -1)[0]], ['2026-10-19', '2026-10-05'])
eq('a week can straddle two years', m.kbBoardWeekKeys('2026-12-30', 0), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
eq('29 February is a day', m.kbBoardAddDays('2028-02-28', 1), '2028-02-29')
eq('...and the day after it is March', m.kbBoardAddDays('2028-02-29', 1), '2028-03-01')
{
  const g = m.kbBoardMonthGrid('2026-10-12', 0)
  eq('October 2026: five whole weeks, from the Monday before the 1st', [g.year, g.month, g.weeks.length, g.weeks[0][0], g.weeks[4][6]], [2026, 10, 5, '2026-09-28', '2026-11-01'])
  eq('...every row is seven days', g.weeks.every((w) => w.length === 7), true)
  eq('...first and last day of the month', [g.first, g.last], ['2026-10-01', '2026-10-31'])
  const f = m.kbBoardMonthGrid('2026-10-12', 4)
  eq('four months on: February 2027 starts on a Monday and is exactly four weeks', [f.year, f.month, f.weeks.length, f.weeks[0][0], f.weeks[3][6]], [2027, 2, 4, '2027-02-01', '2027-02-28'])
  eq('across the year end', [m.kbBoardMonthGrid('2026-10-12', 3).year, m.kbBoardMonthGrid('2026-10-12', 3).month], [2027, 1])
  eq('...and before it', [m.kbBoardMonthGrid('2026-01-15', -1).year, m.kbBoardMonthGrid('2026-01-15', -1).month], [2025, 12])
  eq('a month that needs six weeks has six', m.kbBoardMonthGrid('2027-05-10', 0).weeks.length, 6)
  eq('February 2028 (leap) ends on the 29th', m.kbBoardMonthGrid('2028-02-10', 0).last, '2028-02-29')
}
eq('a day of next week is one week away', m.kbBoardWeekOffset('2026-10-12', '2026-10-20'), 1)
eq('a Sunday of this week is 0, the Sunday before is -1', [m.kbBoardWeekOffset('2026-10-12', '2026-10-18'), m.kbBoardWeekOffset('2026-10-12', '2026-10-11')], [0, -1])
eq('from a day of the month grid back to its week', m.kbBoardWeekKeys('2026-10-12', m.kbBoardWeekOffset('2026-10-12', '2026-11-03')).includes('2026-11-03'), true)

/* ── The viewer's day, whatever the automation's zone ────────────────────── */
{
  const t = Z(2026, 10, 12, 22, 30)
  eq('22:30 UTC is still the 12th in UTC', [m.kbBoardDayKey(t, 'UTC'), m.kbBoardHm(t, 'UTC')], ['2026-10-12', '22:30'])
  eq('...and already the 13th, 00:30, in Paris', [m.kbBoardDayKey(t, 'Europe/Paris'), m.kbBoardHm(t, 'Europe/Paris')], ['2026-10-13', '00:30'])
  eq('...and 18:30 in New York', [m.kbBoardDayKey(t, 'America/New_York'), m.kbBoardHm(t, 'America/New_York')], ['2026-10-12', '18:30'])
  eq('midnight is 00:00, never 24:00', m.kbBoardHm(Z(2026, 10, 12, 0, 0), 'UTC'), '00:00')
  eq('an unknown zone does not throw: the browser zone is used', /^\d{2}:\d{2}$/.test(m.kbBoardHm(t, 'Mars/Phobos')), true)
}
eq('week title, one month', m.kbBoardWeekTitle(m.kbBoardWeekKeys('2026-10-12', 0), 'en'), '12 – 18 October 2026')
eq('week title, two months', m.kbBoardWeekTitle(m.kbBoardWeekKeys('2026-10-01', 0), 'en'), '28 September – 4 October 2026')
eq('week title, two years', m.kbBoardWeekTitle(m.kbBoardWeekKeys('2026-12-30', 0), 'en'), '28 December 2026 – 3 January 2027')
eq('week title in French', m.kbBoardWeekTitle(m.kbBoardWeekKeys('2026-10-12', 0), 'fr'), '12 – 18 octobre 2026')
eq('month title', m.kbBoardMonthTitle(m.kbBoardMonthGrid('2026-10-12', 0), 'en'), 'October 2026')
eq('day names follow the language', [m.kbBoardDayName('2026-10-12', 'en'), m.kbBoardDayName('2026-10-12', 'fr')], ['Mon', 'lun.'])
eq('when: today, tomorrow, later', [m.kbBoardWhen(Z(2026, 10, 12, 17), NOW, 'UTC', 'en'), m.kbBoardWhen(Z(2026, 10, 13, 8), NOW, 'UTC', 'en'), m.kbBoardWhen(Z(2026, 10, 16, 8), NOW, 'UTC', 'en')], ['Today · 17:00', 'Tomorrow · 08:00', 'Fri, Oct 16 · 08:00'])
eq('when, in French', m.kbBoardWhen(Z(2026, 10, 13, 8), NOW, 'UTC', 'fr'), 'Demain · 08:00')
eq('in: minutes, hours, days', [m.kbBoardIn(NOW + 12 * 60000, NOW, 'en'), m.kbBoardIn(NOW + 3 * 3600000, NOW, 'en'), m.kbBoardIn(NOW + 3 * 86400000, NOW, 'en')], ['in 12 minutes', 'in 3 hours', 'in 3 days'])
eq('in: a time already past is "this minute", never negative', m.kbBoardIn(NOW - 60000, NOW, 'en'), 'this minute')

/* ── What the engine says about a session ────────────────────────────────── */
{
  const row = (running) => ({ running })
  const ready = { phase: 'ready', ids: ['s-idle', 's-run', 's-ask', 's-q', 's-plan'], byId: { 's-idle': row(false), 's-run': row(true), 's-ask': row(false), 's-q': row(false), 's-plan': row(false) } }
  const approval = { kind: 'approval', toolName: 'mcp__x__send', answerable: true, answer: async () => {} }
  const status = new Map([
    ['s-run', { running: true, pendingInteraction: undefined, completionUnread: false }],
    ['s-ask', { running: true, pendingInteraction: approval, completionUnread: false }],
    ['s-q', { running: true, pendingInteraction: { kind: 'question' }, completionUnread: false }],
    ['s-plan', { running: false, pendingInteraction: { kind: 'plan-review' }, completionUnread: false }],
  ])
  const live = m.kbBoardLiveOf(ready, status)
  eq('a session that is neither running nor asking has ended', live('s-idle'), { running: false, waiting: null, pending: null })
  eq('a running session', live('s-run'), { running: true, waiting: null, pending: null })
  eq('a session the engine holds for an approval gives the request to answer', [live('s-ask').waiting, live('s-ask').pending === approval], ['approval', true])
  eq('a question is waiting too, but there is nothing to approve', [live('s-q').waiting, live('s-q').pending], ['question', null])
  eq('...and a plan to review', [live('s-plan').waiting, live('s-plan').pending], ['plan-review', null])
  eq('a session that is not in the list is unknown, not ended', live('s-gone'), null)
  eq('a prototype key is not a session', [live('constructor'), live('__proto__'), live(42)], [null, null, null])
  eq('while the list is loading nothing is claimed about any session', m.kbBoardLiveOf({ phase: 'pending', ids: [], byId: {} }, status)('s-idle'), null)
  eq('no list at all', [m.kbBoardLiveOf(null, null)('s-idle'), m.kbBoardLiveOf(undefined, undefined)('s-idle'), m.kbBoardLiveOf({ phase: 'ready' }, null)('s-idle')], [null, null, null])
  eq('no status service: the list row says if it runs', [m.kbBoardLiveOf(ready, null)('s-run'), m.kbBoardLiveOf(ready, null)('s-idle')], [{ running: true, waiting: null, pending: null }, { running: false, waiting: null, pending: null }])
  eq('an interaction of a kind this page does not know is not "waiting"', m.kbBoardLiveOf(ready, new Map([['s-idle', { running: false, pendingInteraction: { kind: 'something-new' } }]]))('s-idle').waiting, null)
}
eq('failed entries are failed whatever the session', [m.kbBoardRunState('error', { running: true, waiting: null }), m.kbBoardRunState('error', null)], ['failed', 'failed'])
eq('a started run whose session is not visible is `started`, not `ended`', m.kbBoardRunState('fired', null), 'started')
eq('queued: handed to the page, outcome not known', m.kbBoardRunState('queued', null), 'started')
eq('waiting beats running', m.kbBoardRunState('fired', { running: true, waiting: 'approval' }), 'waiting')

/* ── Runs, from the histories ────────────────────────────────────────────── */
const H = (at, status, sessionId, extra) => Object.assign({ at: iso(at), status, sessionId: sessionId === undefined ? null : sessionId }, extra || {})
const T = (id, o) => Object.assign({ id, name: id, active: true, approvals: 'ask', schedule: { mode: 'cron', cron: '0 8 * * *', tz: 'UTC' }, nextRun: iso(NOW + 3600000), history: [] }, o || {})
{
  const liveOf = (sid) => ({ 's-run': { running: true, waiting: null, pending: null }, 's-end': { running: false, waiting: null, pending: null } }[sid] || null)
  const tasks = [T('a', { history: [H(NOW - 86400000, 'fired', 's-end'), H(NOW - 3600000, 'fired', 's-run'), { at: 'garbage', status: 'fired' }, null, 'x', H(NOW - 1000, 'error', null, { error: 'session service refused' })] })]
  const runs = m.kbBoardRuns(tasks, liveOf, NOW)
  eq('every readable entry is a run, the others are skipped', runs.map((r) => r.state), ['ended', 'running', 'failed'])
  eq('the reason of a failure comes from the entry', runs[2].error, 'session service refused')
  eq('only the last entry is flagged last', runs.map((r) => r.last), [false, false, true])
  eq('keys are unique', new Set(runs.map((r) => r.key)).size, 3)
  eq('an entry dated far in the future is not a run (clock skew up to a minute is)', m.kbBoardRuns([T('f', { history: [H(NOW + 3600000, 'fired', 's-end'), H(NOW + 30000, 'fired', 's-end')] })], liveOf, NOW).length, 1)
  eq('webhook runs are marked', m.kbBoardRuns([T('w', { history: [H(NOW - 5000, 'fired', 's-end', { via: 'webhook' })] })], liveOf, NOW)[0].via, 'webhook')
  eq('hostile input does not throw', m.kbBoardRuns([null, 3, { id: 5 }, { id: 'z', history: 'no' }], liveOf, NOW), [])
}

/* ── The four columns ────────────────────────────────────────────────────── */
{
  const DAY = 86400000
  const live = {
    's-run': { running: true, waiting: null, pending: null },
    's-ask': { running: true, waiting: 'approval', pending: { kind: 'approval', toolName: 'x' } },
    's-end': { running: false, waiting: null, pending: null },
  }
  const liveOf = (sid) => live[sid] || null
  const tasks = [
    T('veille', { nextRun: iso(NOW + 22 * 3600000), history: [H(NOW - 2 * DAY, 'fired', 's-end'), H(NOW - 9 * DAY, 'fired', 's-end'), H(NOW - 3600000, 'fired', 's-ask')] }),
    T('relance', { schedule: { mode: 'cron', cron: '0 9 * * 1', tz: 'UTC' }, nextRun: iso(NOW + 7 * DAY - 20 * 60000), history: [H(NOW - 20 * 60000, 'fired', 's-run')] }),
    T('logs', { nextRun: iso(NOW + 17 * 3600000), history: [H(NOW - 5 * DAY, 'error', null, { error: 'timed out' }), H(NOW - 2 * 3600000, 'error', null, { error: 'no space left' })] }),
    T('superseded', { nextRun: iso(NOW + 3 * 3600000), history: [H(NOW - 4 * DAY, 'error', null, { error: 'old failure' }), H(NOW - 3 * DAY, 'fired', 's-end')] }),
    T('beta7', { schedule: { mode: 'once', at: '2026-10-13T10:00', tz: 'UTC' }, nextRun: iso(Z(2026, 10, 13, 10)) }),
    T('ticket', { schedule: { mode: 'webhook', tz: 'UTC' }, nextRun: null, history: [H(NOW - 2 * DAY, 'fired', 's-end', { via: 'webhook' })] }),
    T('digest', { active: false, history: [H(NOW - 6 * 3600000, 'fired', 's-end')] }),
    T('digest-fail', { active: false, history: [H(NOW - 3600000, 'error', null, { error: 'x' })] }),
    T('launch', { active: false, schedule: { mode: 'once', at: '2026-10-11T10:00', tz: 'UTC' }, nextRun: null, history: [H(NOW - DAY, 'fired', 's-end')] }),
    T('never', { nextRun: null, schedule: { mode: 'cron', cron: '0 0 31 2 *', tz: 'UTC' } }),
    T('written-by-hand', { nextRun: null }),
  ]
  const plan = { occurrences: [{ id: 'written-by-hand', at: iso(NOW + 5 * 3600000) }, { id: 'written-by-hand', at: iso(NOW + 29 * 3600000) }, { id: 'veille', at: iso(NOW + 22 * 3600000) }], cannotFire: [{ id: 'never', error: 'this schedule never fires' }] }
  const runs = m.kbBoardRuns(tasks, liveOf, NOW)
  const c = m.kbBoardColumns(tasks, runs, plan, NOW)
  eq('upcoming: the next run of each active scheduled automation, soonest first', c.upcoming.map((u) => u.taskId), ['superseded', 'written-by-hand', 'logs', 'veille', 'beta7', 'relance'])
  eq('...the stored next run is used, the host\'s plan only when it is missing', [c.upcoming.find((u) => u.taskId === 'veille').atMs === NOW + 22 * 3600000, c.upcoming.find((u) => u.taskId === 'written-by-hand').atMs === NOW + 5 * 3600000], [true, true])
  eq('...an automation with no next run and no plan is not drawn', c.upcoming.some((u) => u.taskId === 'never'), false)
  eq('...and is reported as unable to fire, in the scheduler\'s words', c.cannotFire, [{ id: 'never', error: 'this schedule never fires' }])
  eq('running: the run whose session runs', c.running.map((r) => r.taskId + ':' + r.sessionId), ['relance:s-run'])
  eq('to approve: the request the engine holds first, then the failure to retry', c.approve.map((r) => r.taskId + ':' + r.state), ['veille:waiting', 'logs:failed'])
  eq('...a failure that a later run replaced is not asked about again', c.approve.some((r) => r.taskId === 'superseded'), false)
  eq('...nor the failure of a paused automation', c.approve.some((r) => r.taskId === 'digest-fail'), false)
  eq('done: the runs of the last 7 days that ended, newest first', c.done.map((r) => r.taskId), ['launch', 'veille', 'ticket', 'superseded'])
  eq('...a run of 9 days ago is out', c.done.some((r) => r.atMs === NOW - 9 * DAY), false)
  eq('...the run of a paused automation is out', c.done.some((r) => r.taskId === 'digest'), false)
  eq('...a one-time automation that ran is done, not paused', [c.done.some((r) => r.taskId === 'launch'), c.paused], [true, 2])
  eq('on event: the webhook automation, with its last run', c.hooks, [{ taskId: 'ticket', lastAtMs: NOW - 2 * DAY }])
  eq('the paused ones are counted, not drawn', c.paused, 2)
  eq('nothing overdue here', c.overdue, [])
  const due = m.kbBoardColumns([T('late', { nextRun: iso(NOW - 40000) })], [], null, NOW)
  eq('a next run that is just past is "due", the tick takes it within 30 s', [due.upcoming[0].due, due.overdue], [true, []])
  eq('...three minutes late means the scheduler is not running', m.kbBoardColumns([T('late', { nextRun: iso(NOW - 181000) })], [], null, NOW).overdue, ['late'])
  eq('...a paused automation is never overdue', m.kbBoardOverdue([T('p', { active: false, nextRun: iso(NOW - 3600000) })], NOW), [])
  eq('...nor a webhook one', m.kbBoardOverdue([T('h', { schedule: { mode: 'webhook' }, nextRun: iso(NOW - 3600000) })], NOW), [])
  const many = []
  for (let i = 0; i < 25; i += 1) many.push(H(NOW - (i + 1) * 3600000, 'fired', 's-end'))
  const big = m.kbBoardColumns([T('busy', { history: many })], m.kbBoardRuns([T('busy', { history: many })], liveOf, NOW), null, NOW)
  eq('done shows 20, and says how many more', [big.done.length, big.doneMore], [20, 5])
  eq('no plan, no tasks: empty columns', Object.values(m.kbBoardColumns([], [], null, NOW)).map((v) => (Array.isArray(v) ? v.length : v)), [0, 0, 0, 0, 0, 0, 0, 0, 0])
}

/* ── A day of the calendar ───────────────────────────────────────────────── */
{
  const mk = (taskId, hour, state) => ({ key: taskId + hour, taskId, atMs: Z(2026, 10, 12, hour), state, sessionId: null, via: 'schedule', error: '', last: false, live: null })
  const items = [mk('six', 0, 'ended'), mk('six', 6, 'ended'), mk('six', 12, 'planned'), mk('six', 18, 'planned'), mk('daily', 8, 'ended'), mk('other', 13, 'failed'), mk('other', 14, 'running'), mk('future', 9, 'planned')]
  const days = m.kbBoardDays(items, ['2026-10-11', '2026-10-12', '2026-10-13'], 'UTC')
  const day = days.get('2026-10-12')
  eq('days outside the window or with no run are present and empty', [days.get('2026-10-11'), days.get('2026-10-13')], [[], []])
  eq('one entry per automation and day, in time order', day.map((g) => g.taskId + ':' + g.n), ['six:4', 'daily:1', 'future:1', 'other:2'])
  eq('past and planned slots of one automation fold into `mixed`', day[0].state, 'mixed')
  eq('...failed beats running', day[3].state, 'failed')
  eq('a single planned run is `planned`', day[2].state, 'planned')
  eq('...a single run that ended is `ended`', day[1].state, 'ended')
  eq('precedence: waiting, failed, running, mixed, planned, ended, started', [
    m.kbBoardGroupState([{ state: 'failed' }, { state: 'waiting' }]), m.kbBoardGroupState([{ state: 'running' }, { state: 'ended' }]),
    m.kbBoardGroupState([{ state: 'planned' }, { state: 'planned' }]), m.kbBoardGroupState([{ state: 'started' }, { state: 'ended' }]), m.kbBoardGroupState([{ state: 'started' }]),
  ], ['waiting', 'running', 'planned', 'ended', 'started'])
  const paris = m.kbBoardDays([mk('x', 23, 'planned')], ['2026-10-12', '2026-10-13'], 'Europe/Paris')
  eq('a run belongs to the day of the viewer\'s zone (23:00 UTC is already tomorrow in Paris)', [paris.get('2026-10-12').length, paris.get('2026-10-13').length], [0, 1])
  eq('planned runs only exist for automations that are still active', m.kbBoardPlanned([T('a'), T('b', { active: false })], { occurrences: [{ id: 'a', at: iso(NOW + 1000) }, { id: 'b', at: iso(NOW + 1000) }, { id: 'c', at: iso(NOW + 1000) }, { id: 'a', at: 'nope' }] }).map((p) => p.taskId), ['a'])
  eq('no plan: no planned runs', m.kbBoardPlanned([T('a')], null), [])
}

/* ── The text of a question the engine holds ─────────────────────────────── */
eq('the localized copy of the asker wins', m.kbBoardReason({ reason: 'English reason', displayReason: { en: 'EN', fr: 'FR' }, toolName: 't' }, 'fr'), 'FR')
eq('...falling back to its English', m.kbBoardReason({ displayReason: { en: 'EN' }, toolName: 't' }, 'es'), 'EN')
eq('...then to the reason, then to the tool', [m.kbBoardReason({ reason: 'R', toolName: 't' }, 'en'), m.kbBoardReason({ toolName: 't' }, 'en')], ['R', 't'])
eq('a plain string copy is used as it is', m.kbBoardReason({ displayReason: 'plain' }, 'fr'), 'plain')
eq('nothing at all is an empty string', [m.kbBoardReason(null, 'en'), m.kbBoardReason({}, 'en')], ['', ''])

/* ── The page that draws it (static checks on the source) ────────────────── */
{
  const pure = block
  eq('the pure block touches no React, DOM, host call or translation', /\b(React|document|window|fetch|kbt|kbf|host\.call|localStorage)\b/.test(pure.replace(/\/\/[^\n]*/g, '')), false)
  eq('the board never marks a past slot as done by itself: no run is made from a cron', /kbNextCronAfter|parseCron/.test(pure), false)
  const page = src.slice(src.indexOf('const KbAutoBoard = '), src.indexOf('const ScheduledTasksPage = '))
  eq('the board component exists, before the page', page.length > 1000, true)
  eq('the occurrences route is read with its own fetch: a 404 must not switch the other routes off', /fetch\(kbApiBase\(\) \+ '\/tasks\/occurrences\?from='/.test(src) && /res\.status === 404\) return \{ ok: false, error: 'unavailable' \}/.test(src), true)
  eq('the route is not in the host.call route map (a 404 there sets kbRemoteOk = false)', /'kybers\/tasks-occurrences'/.test(src), false)
  eq('the engine session status is read lazily and guarded, never injected', /ctx\.get\('uiSession'\)/.test(page) && !/inject: \[[^\]]*uiSession/.test(src.slice(0, src.indexOf('const KbAutoBoard = '))), true)
  eq('an approval is answered with the engine\'s own request, allowed once or rejected', /pending\.answer\(outcome\)/.test(page) && /answer\('allowed-once'\)|'allowed-once'/.test(page) && /'rejected'/.test(page), true)
  eq('Approve and Refuse exist only for an approval, never for a question', /waiting === 'approval'/.test(page), true)
  eq('what is answered is the request the card showed, never a newer one of the same session', /pending\.key !== shownKey/.test(page) && /answerOf\(sid, 'allowed-once', it\.live\.pending\.key\)/.test(page) && /answerOf\(sid, 'rejected', it\.live\.pending\.key\)/.test(page), true)
  eq('a failed card offers Retry (run now) and the journal', /btn\('retry', 'retry'/.test(page) && /btn\('journal', 'journal'/.test(page), true)
  eq('Launch now reuses the existing run-now action', /props\.act\('run-now'/.test(page), true)
  eq('no cost anywhere (a separate plugin will own it)', /cost|coût|\$|€/i.test(page.replace(/\$\{/g, '')) , false)
  eq('the board is wrapped in a boundary: a failing view must not take the page down', /class KbBoardBoundary extends React\.Component/.test(src) && /h\(KbBoardBoundary/.test(src), true)
  eq('the toolbar offers the three views, labelled', /views: \['columns', 'calendar', 'list'\]/.test(src) && /viewLabels: true/.test(src), true)
  eq('a stored `cards` is moved to `list` once', /viewMode === 'cards'/.test(src.slice(src.indexOf('const ScheduledTasksPage = '))), true)
}

/* ── Every text of the board exists in French and English ─────────────────── */
{
  const table = {}
  for (const line of src.split('\n')) {
    const t = /^\s*'((?:tasks\.board|tb\.view)\.[A-Za-z0-9_.]+)':\s*(\{.*\}),?\s*$/.exec(line)
    if (t !== null) { try { table[t[1]] = (0, eval)('(' + t[2] + ')') } catch (e) { /* not a plain entry */ } }
  }
  const region = src.slice(src.indexOf('const kbBoardLocale = '), src.indexOf('const ScheduledTasksPage = '))
  const used = new Set((region.match(/'tasks\.board\.[A-Za-z0-9_.]+'/g) || []).map((k) => k.slice(1, -1)))
  used.add('tb.view.columns')
  eq('the board uses its texts through translation keys (and uses a fair number of them)', used.size > 40, true)
  const missing = [...used].filter((k) => table[k] === undefined || typeof table[k].en !== 'string' || table[k].en === '' || typeof table[k].kybernos !== 'string' || table[k].kybernos === '')
  eq('every key the board uses exists in both languages', missing, [])
  const dup = {}
  for (const line of src.split('\n')) { const t = /^\s*'(tasks\.board\.[A-Za-z0-9_.]+)':\s*\{/.exec(line); if (t !== null) dup[t[1]] = (dup[t[1]] || 0) + 1 }
  eq('no board key is defined twice', Object.keys(dup).filter((k) => dup[k] > 1), [])
  const unused = Object.keys(table).filter((k) => k.startsWith('tasks.board.') && used.has(k) !== true)
  eq('no board text is left unused', unused, [])
  const placeholders = Object.keys(table).filter((k) => (table[k].en.match(/\{[a-z]+\}/g) || []).sort().join() !== (table[k].kybernos.match(/\{[a-z]+\}/g) || []).sort().join())
  eq('the two languages carry the same {placeholders}', placeholders, [])
}

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
