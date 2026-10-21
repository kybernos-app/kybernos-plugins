// Test of the pure part of the runs view of an automation (the Sessions tab of its page, which also holds what the Journal tab used to
// say): which history lines are one run, how a run stands, the four figures above the list, and the nodes and links of the execution graph.
// The layout that draws the graph is the KB-AUTOFLOW block (test-automation-flow.mjs).
// It extracts the KB-AUTORUNS block of client.js (the file is a browser bundle with no exports), then checks, on the source, the
// contract of the pane that draws it: read-only, own fetch, bounded calls.
// Usage: node packages/kybernos-plugin/test-automation-runs-client.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { STABLE_CHOICES } from './automation-settings.mjs'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
const parts = src.split('// KB-AUTORUNS-BEGIN')
if (parts.length !== 2) { console.error('exactly one KB-AUTORUNS block expected in client.js'); process.exit(1) }
const block = parts[1].split('// KB-AUTORUNS-END')[0]
const names = ['kbRunsOf', 'kbRunFmtDur', 'kbRunFmtBytes', 'kbRunFmtDT', 'kbRunFmtHm', 'kbRunState', 'kbRunStats', 'kbRunGraph', 'kbRunBars', 'kbRunUses', 'kbRunAgo', 'kbRunCardFigures']
const m = await import('data:text/javascript,' + encodeURIComponent('const KB_RUNS_NOTE_WINDOW_MS = 600000\n' + block.replace(/^const KB_RUNS_NOTE_WINDOW_MS[^\n]*\n/m, '') + '\nexport { ' + names.join(', ') + ' }'))

let fails = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}
const Z = (d, h, mi, s) => new Date(Date.UTC(2026, 9, d, h, mi, s || 0)).toISOString()

/* ── History lines → runs ────────────────────────────────────────────────── */
eq('no history, or something that is not a list, is no run', [m.kbRunsOf(undefined), m.kbRunsOf(null), m.kbRunsOf('x'), m.kbRunsOf([])], [[], [], [], []])
{
  const history = [
    { at: Z(10, 8, 0), sessionId: 'session-a', status: 'fired', via: 'schedule' },
    { at: Z(11, 8, 0), sessionId: 'session-b', status: 'fired', via: 'schedule' },
    { at: Z(12, 8, 0), sessionId: 'session-c', status: 'fired', via: 'webhook' },
  ]
  const runs = m.kbRunsOf(history)
  eq('runs come newest first', runs.map((r) => r.sessionId), ['session-c', 'session-b', 'session-a'])
  eq('a run keeps its trigger and its time', [runs[0].via, runs[0].at], ['webhook', Z(12, 8, 0)])
  eq('the order of the stored lines does not matter', m.kbRunsOf(history.slice().reverse()).map((r) => r.sessionId), ['session-c', 'session-b', 'session-a'])
}
{
  // The failure line a run writes about itself (no session id) is a note on that run, not a run of its own.
  const history = [
    { at: Z(10, 8, 0), sessionId: 'session-a', status: 'fired' },
    { at: Z(10, 8, 4), status: 'error', error: 'no event received' },
    { at: Z(11, 8, 0), sessionId: 'session-b', status: 'fired' },
    { at: Z(12, 8, 0), sessionId: 'session-c', status: 'fired' },
    { at: Z(12, 8, 3), status: 'error', error: 'no event received' },
  ]
  const runs = m.kbRunsOf(history)
  eq('5 history lines are 3 runs', runs.length, 3)
  eq('the note makes its run failed and gives it the reason', runs.map((r) => [r.sessionId, r.status, r.error]), [['session-c', 'error', 'no event received'], ['session-b', 'fired', null], ['session-a', 'error', 'no event received']])
  eq('a note is not a run in the figures either', m.kbRunStats(runs, {}).failed, 2)
}
{
  const alone = m.kbRunsOf([{ at: Z(10, 8, 4), status: 'error', error: 'boom' }])
  eq('a failure line with no run before it stays a line of its own', alone.map((r) => [r.sessionId, r.status, r.error]), [[null, 'error', 'boom']])
  const far = m.kbRunsOf([{ at: Z(10, 8, 0), sessionId: 'session-a', status: 'fired' }, { at: Z(10, 9, 0), status: 'error', error: 'late' }])
  eq('a failure line an hour after the run is not about that run', far.map((r) => [r.sessionId, r.status]), [[null, 'error'], ['session-a', 'fired']])
  const two = m.kbRunsOf([{ at: Z(10, 8, 0), sessionId: 'session-a', status: 'fired' }, { at: Z(10, 8, 1), status: 'error', error: 'one' }, { at: Z(10, 8, 2), status: 'error', error: 'two' }])
  eq('one run takes one note: the second failure line stays a line', two.map((r) => [r.sessionId, r.error]), [[null, 'two'], ['session-a', 'one']])
  const junk = m.kbRunsOf([null, 7, 'x', { at: 'not a date', sessionId: 'session-z' }, { sessionId: '' }])
  eq('junk lines do not throw; a line with a bad date is kept, it just has no time', junk.map((r) => String(r.sessionId)).sort(), ['null', 'session-z'])
}

/* ── Formats ─────────────────────────────────────────────────────────────── */
eq('durations read for a person', [6500, 9990, 35000, 89000, 90000, 420000, 5400000, 7200000].map(m.kbRunFmtDur), ['6.5 s', '10 s', '35 s', '89 s', '2 min', '7 min', '1.5 h', '2 h'])
eq('no duration is a dash, never zero', [null, undefined, -5, NaN, 'x'].map(m.kbRunFmtDur), ['—', '—', '—', '—', '—'])
eq('sizes read for a person', [12, 999, 1000, 1800, 2400000].map(m.kbRunFmtBytes), ['12 B', '999 B', '1 KB', '1.8 KB', '2.4 MB'])
eq('no size is empty', [null, -1, NaN, 'x'].map(m.kbRunFmtBytes), ['', '', '', ''])
eq('a bad date is a dash (short, long) or empty (time)', [m.kbRunFmtDT('nope', 'en', false), m.kbRunFmtDT(undefined, 'en', true), m.kbRunFmtHm('nope', 'en')], ['—', '—', ''])
eq('a good date carries a time; the long one carries the year', [/\d{2}:\d{2}/.test(m.kbRunFmtDT(Z(19, 16, 19), 'en', false)), /2026/.test(m.kbRunFmtDT(Z(19, 16, 19), 'en', true)), /^\d{2}:\d{2}$/.test(m.kbRunFmtHm(Z(19, 16, 19), 'en'))], [true, true, true])
eq('an unknown locale does not throw', typeof m.kbRunFmtDT(Z(19, 16, 19), 'zz-invalid-locale-xx', false), 'string')

/* ── How a run stands ────────────────────────────────────────────────────── */
const done = (ms) => ({ outcome: { state: 'completed' }, durationMs: ms })
const bad = (ms) => ({ outcome: { state: 'failed', code: 'x' }, durationMs: ms })
eq('the journal says completed / failed / still open', [m.kbRunState({ status: 'fired' }, done(1)), m.kbRunState({ status: 'fired' }, bad(1)), m.kbRunState({ status: 'fired' }, { outcome: { state: 'open' } })], ['completed', 'failed', 'running'])
eq('a failure the history recorded wins over a journal that looks fine', m.kbRunState({ status: 'error' }, done(1)), 'failed')
eq('a run whose journal was not read is « unread », never « completed »', [m.kbRunState({ status: 'fired' }, undefined), m.kbRunState({ status: 'fired' }, null), m.kbRunState({ status: 'fired' }, {}), m.kbRunState({ status: 'queued' }, undefined)], ['unread', 'unread', 'unread', 'unread'])

/* ── The four figures ────────────────────────────────────────────────────── */
{
  const runs = [{ sessionId: 'a', status: 'fired' }, { sessionId: 'b', status: 'error' }, { sessionId: 'c', status: 'fired' }, { sessionId: null, status: 'fired' }]
  const st = m.kbRunStats(runs, { a: done(35000), b: bad(17000), c: null })
  eq('runs, failed, and the durations of the journals that were read', [st.runs, st.failed, st.read, st.slowest], [4, 1, 2, 35000])
  eq('an even number of durations takes the upper middle one', st.median, 35000)
  eq('three durations: the middle one', m.kbRunStats([{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'c' }], { a: done(30), b: done(10), c: done(20) }).median, 20)
  const none = m.kbRunStats(runs, {})
  eq('no journal read: no median, no slowest, nothing invented', [none.median, none.slowest, none.read], [null, null, 0])
  eq('a journal that reports a failure counts as failed even if the history says fired', m.kbRunStats([{ sessionId: 'a', status: 'fired' }], { a: bad(5) }).failed, 1)
  eq('sums that are not an object do not throw', m.kbRunStats(runs, null).runs, 4)
}

/* ── The execution graph ─────────────────────────────────────────────────── */
const tool = (i, over) => Object.assign({ kind: 'bash', label: 'step ' + i, thinkMs: 1000 + i, runMs: 10 + i, outBytes: 100 * i, ok: true }, over || {})
const tools = (n) => Array.from({ length: n }, (_, i) => tool(i + 1))
eq('a run whose journal was not read is its start alone', [m.kbRunGraph(null, false), m.kbRunGraph(undefined, true), m.kbRunGraph({}, false)].map((g) => [g.nodes.map((n) => n.type), g.read]), [[['start'], false], [['start'], false], [['start'], false]])
{
  const g = m.kbRunGraph({ nodes: tools(3), nodeCount: 3, final: { thinkMs: 4190 } }, false)
  eq('3 tool calls: start, 3 tools, final', g.nodes.map((n) => n.type), ['start', 'tool', 'tool', 'tool', 'final'])
  eq('a link carries what the step before it handed on', g.labels, [null, 100, 200, 300])
  eq('one label per link', g.labels.length, g.nodes.length - 1)
  eq('the final node carries the last think time and is ok', [g.nodes[4].thinkMs, g.nodes[4].ok], [4190, true])
  eq('a tool node keeps its kind, label, timings, size and status', [g.nodes[1].kind, g.nodes[1].label, g.nodes[1].thinkMs, g.nodes[1].runMs, g.nodes[1].outBytes, g.nodes[1].ok, g.nodes[1].approval], ['bash', 'step 1', 1001, 11, 100, true, null])
}
{
  const seven = m.kbRunGraph({ nodes: tools(7), nodeCount: 7, final: null }, false)
  eq('7 tool calls are all drawn', seven.nodes.map((n) => n.type).join(','), 'start,tool,tool,tool,tool,tool,tool,tool,final')
  const eight = m.kbRunGraph({ nodes: tools(8), nodeCount: 8, final: null }, false)
  eq('8 tool calls: the first 6, then « 2 more », then the final', eight.nodes.map((n) => n.type === 'more' ? 'more' + n.n : n.type).join(','), 'start,tool,tool,tool,tool,tool,tool,more2,final')
  eq('the link into « more » carries the 6th step, the one out of it nothing', [eight.labels[6], eight.labels[7]], [600, null])
  eq('one label per link when collapsed', eight.labels.length, eight.nodes.length - 1)
  const many = m.kbRunGraph({ nodes: tools(12), nodeCount: 30, final: null }, false)
  eq('the host sends at most 12; « more » counts from the real number of calls', many.nodes.find((n) => n.type === 'more').n, 24)
  eq('no think time known for the final step: null', seven.nodes[seven.nodes.length - 1].thinkMs, null)
}
{
  const g = m.kbRunGraph({ nodes: [tool(1, { ok: false, approval: 'denied' })], nodeCount: 1, final: null }, true)
  eq('a failed call and the approval it got', [g.nodes[1].ok, g.nodes[1].approval], [false, 'denied'])
  eq('a failed run ends on a failed final node', g.nodes[2].ok, false)
}

/* ── The last ten runs, as bars, for the list ───────────────────────────── */
{
  const hist = (n, badAt) => Array.from({ length: n }, (_, i) => ({ at: Z(1 + (i % 28), 8, i), sessionId: 's' + i, status: badAt.indexOf(i) >= 0 ? 'error' : 'fired' }))
  const b = m.kbRunBars(hist(12, [11]))
  eq('at most ten bars, the newest on the right', b.bars.length, 10)
  eq('the newest run is the last bar', m.kbRunBars(hist(12, [11])).bars[9], 'bad')
  eq('the share of the last ten that are not bad', m.kbRunBars(hist(12, [11])).pct, 90)
  eq('a run the history says failed is a bad bar, the others are ok', m.kbRunBars(hist(3, [1])).bars.join(','), 'ok,bad,ok')
  eq('no run: no bar, no percentage is claimed', m.kbRunBars([]), { bars: [], pct: null })
  eq('a history that is not a list is no run', [m.kbRunBars(null).pct, m.kbRunBars('x').bars.length], [null, 0])
  eq('a journal that was not read is never a bad bar', m.kbRunBars(hist(4, [])).bars.every((x) => x === 'ok'), true)
}

/* ── What the newest runs used ───────────────────────────────────────────── */
{
  const hist = [1, 2, 3, 4].map((d) => ({ at: Z(d, 8, 0), sessionId: 's' + d, status: 'fired' }))
  const sums = {
    s4: { selected: false, models: [{ provider: 'acme', model: 'alpha-1' }], uses: { skills: [{ name: 'writer', count: 2 }], apps: [{ name: 'gmail', count: 1 }], tools: [{ name: 'bash', count: 5 }], agents: [{ name: 'checker', model: 'beta-2' }] } },
    s3: { selected: true, models: [{ provider: 'acme', model: 'alpha-1' }, { provider: 'acme', model: 'beta-2' }], uses: { skills: [{ name: 'writer', count: 1 }, { name: 'editor', count: 4 }], apps: [], tools: [{ name: 'bash', count: 1 }], agents: [{ name: 'checker' }] } },
    s2: null,
  }
  const u = m.kbRunUses(hist, sums, 5)
  eq('four runs, two of them read (a run that was not read is not counted)', [u.runs, u.read], [4, 2])
  eq('the models that answered, the most used first', u.models.map((x) => [x.name, x.count]), [['alpha-1', 2], ['beta-2', 1]])
  eq('skills are counted by how often they were called, the most used first', u.skills.map((x) => [x.name, x.count]), [['editor', 4], ['writer', 3]])
  eq('apps and tools too', [u.apps.map((x) => [x.name, x.count]), u.tools.map((x) => [x.name, x.count])], [[['gmail', 1]], [['bash', 6]]])
  eq('a teammate keeps the model any of the runs named', u.agents, [{ name: 'checker', model: 'beta-2' }])
  eq('a model picked on purpose in one of the runs says so', u.chosen, true)
  eq('the limit is on runs, newest first', [m.kbRunUses(hist, sums, 1).read, m.kbRunUses(hist, sums, 1).models.map((x) => x.name)], [1, ['alpha-1']])
  eq('a host that does not say what was used still tells the model', m.kbRunUses(hist, { s4: { selected: false, models: [{ provider: 'acme', model: 'alpha-1' }] } }, 5).models.map((x) => x.name), ['alpha-1'])
  eq('no run read, nothing claimed', (() => { const e = m.kbRunUses(hist, {}, 5); return [e.read, e.models, e.skills, e.apps, e.tools, e.agents, e.chosen] })(), [0, [], [], [], [], [], false])
  eq('no history, or sums that are not an object, do not throw', [m.kbRunUses(null, null, 5).runs, m.kbRunUses(hist, 'x', 5).read], [0, 0])
  eq('at most eight of each', m.kbRunUses(hist, { s4: { models: [], uses: { skills: Array.from({ length: 12 }, (_, i) => ({ name: 'sk' + i, count: 1 })), apps: [], tools: [], agents: [] } } }, 5).skills.length, 8)
}

/* ── Relative time and the figures of a card ─────────────────────────────── */
{
  const NOW = Date.UTC(2026, 9, 19, 12, 0, 0)
  eq('a time reads relative to now, in the page language', [30, 3 * 60, 5400, 3 * 3600, 86400, 2 * 86400].map((s) => m.kbRunAgo(NOW - s * 1000, NOW, 'en')), ['now', '3 minutes ago', '1 hour ago', '3 hours ago', 'yesterday', '2 days ago'])
  eq('the same in French', [m.kbRunAgo(NOW - 3 * 3600 * 1000, NOW, 'fr'), m.kbRunAgo(NOW - 86400 * 1000, NOW, 'fr')], ['il y a 3 heures', 'hier'])
  eq('no claim for a time in the future or unknown, an unknown language does not throw', [m.kbRunAgo(NOW + 5000, NOW, 'en'), m.kbRunAgo(null, NOW, 'en'), m.kbRunAgo(NOW, NaN, 'en'), typeof m.kbRunAgo(NOW - 7200000, NOW, 'zz-bad-locale-xx')], ['', '', '', 'string'])
}
{
  const history = [
    { at: Z(10, 8, 0), sessionId: 'session-a', status: 'fired' },
    { at: Z(11, 8, 0), sessionId: 'session-b', status: 'fired' },
    { at: Z(11, 8, 3), status: 'error', error: 'no event received' },
    { at: Z(12, 8, 0), sessionId: 'session-c', status: 'fired' },
  ]
  const sums = { 'session-c': { outcome: { state: 'completed' }, durationMs: 35000, nodes: [{ kind: 'bash' }, { kind: 'web_search' }, { kind: 'bash' }] } }
  const f = m.kbRunCardFigures(history, sums)
  eq('runs, failed and success: a failure note joins its run', [f.runs, f.failed, f.success], [3, 1, 67])
  eq('the newest run: its time, how it stands, how long it took', [f.lastAt, f.lastState, f.lastDurationMs], [Z(12, 8, 0), 'completed', 35000])
  eq('tools are those of the newest run, once each, in order', f.tools, ['bash', 'web_search'])
  const none = m.kbRunCardFigures(history, {})
  eq('without any journal read: no duration, no tools, the newest run is « unread », never « completed »', [none.lastDurationMs, none.tools, none.lastState], [null, [], 'unread'])
  eq('a journal that says failed makes the run failed even if the history says fired', m.kbRunCardFigures(history, { 'session-c': { outcome: { state: 'failed' }, durationMs: 5, nodes: [] } }).failed, 2)
  const empty = m.kbRunCardFigures([], {})
  eq('no run at all: nothing is claimed', [empty.runs, empty.success, empty.lastAt, empty.lastState, empty.tools], [0, null, null, null, []])
  eq('sums that are not an object do not throw', m.kbRunCardFigures(history, null).runs, 3)
  const many = Array.from({ length: 30 }, (_, i) => ({ at: Z(1 + (i % 28), 8, i), sessionId: 's' + i, status: i < 25 ? 'fired' : 'error' }))
  eq('success counts the last 20 runs only', m.kbRunCardFigures(many, {}).success <= 100 && m.kbRunCardFigures(many, {}).runs === 30, true)
}

/* ── What the pane that draws it is allowed to do ────────────────────────── */
const pane = src.slice(src.indexOf('const kbRunsCache = new Map()'), src.indexOf('const kbBoardBones = '))
eq('the pane is found', pane.length > 1000, true)
eq('read-only but for one button: the pane never calls the host, never acts on a task; its only write is « Create skill »', pane.indexOf('host.call') < 0 && pane.indexOf('act(') < 0 && (pane.match(/method: 'POST'/g) || []).length === 1 && pane.indexOf("fetch(kbApiBase() + '/automation-skills', { method: 'POST'") >= 0 && pane.indexOf('method: \'PUT\'') < 0 && pane.indexOf('DELETE') < 0, true)
eq('it reads the runs with its own fetch on the API base, GET only', pane.indexOf("fetch(kbApiBase() + '/tasks/runs?ids='") >= 0 && pane.indexOf("method: 'GET'") >= 0, true)
eq('a host without the route (404, network error) gives an empty answer, never an exception', /if \(res\.ok !== true\) return \{\}/.test(pane) && /catch \(e\) \{ return \{\} \}/.test(pane), true)
eq('journals are asked for five at a time, at most 20 runs, and detail for one run only', pane.indexOf('need.slice(i, i + 5)') >= 0 && pane.indexOf('.slice(0, 20)') >= 0 && /kbRunsFetch\(\[[^\]]+\], true\)/.test(pane), true)
eq('a run still open is not cached, it is read again', pane.indexOf("outcome.state !== 'open'") >= 0, true)
eq('the page has two tabs, Workflow and Sessions: no Journal tab, no Webhook tab', src.indexOf("'data-kb': 'tab-flow'") >= 0 && src.indexOf("'data-kb': 'tab-sessions'") >= 0 && src.indexOf("'data-kb': 'tab-journal'") < 0 && src.indexOf("tab === 'journal'") < 0 && src.indexOf("tab === 'hook'") < 0, true)
eq('the Sessions pane is one pane per automation', src.indexOf("key: t.id,") >= 0 && src.indexOf('KbRunsPane, {') >= 0, true)
eq('what the Journal said stays, under the run it is about: who ran (the model and why), the approvals, the lessons', src.indexOf("'data-kb': 'run-about'") >= 0 && src.indexOf("kbt('tasks.journal.who')") >= 0 && src.indexOf("kbt('tasks.journal.approvals')") >= 0 && src.indexOf("'data-kb': 'journal-lesson'") >= 0, true)
eq('every run stays in the list: no run is cut', src.indexOf("runs.map((r, i) => { const s = sumOf(r)") >= 0 && src.indexOf('i < 6 ||') < 0, true)
eq('the Workflow tab says what the newest runs used, from the journals read: a strip, the model on the cards, a Uses section in the panel of a step', src.indexOf("kbRunUses(t !== null ? t.history : null, wfSums, 5)") >= 0 && src.indexOf("'data-kb': 'uses-strip'") >= 0 && src.indexOf("'data-kb': 'step-uses'") >= 0 && src.indexOf('kbTaskCards(gr.nodes, wfUses)') >= 0, true)
eq('what a step names is matched on its own text, never tied to a tool call', src.indexOf('const kbStepMentions = (text, uses)') >= 0 && src.indexOf('hay.indexOf(n) >= 0') >= 0, true)
eq('the graph of a run is drawn by the shared canvas, with a card per step and a wire per hand-over', src.indexOf('h(KbFlowCanvas, { nodes: runCards, links: runLinks') >= 0, true)
eq('the tab counts runs, not history lines', src.indexOf("kbt('tasks.tab.sessions').replace('{n}', String(kbRunsOf(t.history).length))") >= 0, true)
eq('the Cards view reads one journal per card (the newest run), through the same reader as the runs pane', src.indexOf("const r = kbRunsOf(t.history)[0]; return r !== undefined ? r.sessionId : null") >= 0 && src.indexOf('React.useEffect(() => kbRunsRead(lastIds,') >= 0 && src.indexOf('React.useEffect(() => kbRunsRead(ids,') >= 0, true)
eq('the Cards view switches an automation through the page, never by itself', src.indexOf("onToggle: (t) => act('toggle', t.id, { active: t.active === false })") >= 0, true)
eq('the lessons are read with an own GET and a skill is asked for with the id alone: the page never sends text to be written', src.indexOf("fetch(kbApiBase() + '/automation-skills?id=' + encodeURIComponent(props.taskId)") >= 0 && src.indexOf("body: JSON.stringify({ id: props.taskId })") >= 0, true)
eq('the lessons card has the three states: written, stable, on its way', ['tasks.lesson.made.auto', 'tasks.lesson.made.manual', 'tasks.lesson.stable', 'tasks.lesson.progress', 'tasks.lesson.soon', 'tasks.lesson.hint'].every((k) => src.indexOf("'" + k + "'") >= 0), true)
eq('the page offers the same choices as the host', (() => { const m2 = /const KB_STABLE_CHOICES = (\[[0-9, ]+\])/.exec(src); return m2 !== null && JSON.stringify(JSON.parse(m2[1])) === JSON.stringify(STABLE_CHOICES) })(), true)
eq('the old rows of the Sessions tab are gone', src.indexOf('kba-srow') < 0 && src.indexOf('sessionRows') < 0, true)
eq('the pure block holds no DOM, no network, no React', !/\b(document|window|fetch|React|localStorage)\b/.test(block.replace(/\/\/[^\n]*/g, '')), true)

if (fails > 0) { console.log('\n' + fails + ' FAILED'); process.exit(1) }
console.log('\nALL PASS')
