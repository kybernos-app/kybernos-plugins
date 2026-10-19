// Test of the pure part of the runs views of an automation (the Sessions and Journal tabs of its page): which history lines are one
// run, how a run stands, the four figures above the list, the nodes and links of the execution graph, and the layout that draws it.
// It extracts the KB-AUTORUNS block of client.js (the file is a browser bundle with no exports), then checks, on the source, the
// contract of the pane that draws it: read-only, own fetch, bounded calls.
// Usage: node packages/kybernos-plugin/test-automation-runs-client.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
const parts = src.split('// KB-AUTORUNS-BEGIN')
if (parts.length !== 2) { console.error('exactly one KB-AUTORUNS block expected in client.js'); process.exit(1) }
const block = parts[1].split('// KB-AUTORUNS-END')[0]
const names = ['kbRunsOf', 'kbRunFmtDur', 'kbRunFmtBytes', 'kbRunFmtDT', 'kbRunFmtHm', 'kbRunState', 'kbRunStats', 'kbRunGraph', 'kbGraphLayout']
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

/* ── Layout of the graph ─────────────────────────────────────────────────── */
{
  const lay = m.kbGraphLayout(6, { cols: 4 })
  eq('the first row runs left to right, the second right to left', lay.pos.map((p) => [p.x, p.y]), [[0, 0], [206, 0], [412, 0], [618, 0], [618, 106], [412, 106]])
  eq('5 links for 6 nodes', lay.edges.length, 5)
  eq('a link inside a row is horizontal, from the edge of one node to the edge of the next', [lay.edges[0].x1, lay.edges[0].x2, lay.edges[0].y1 === lay.edges[0].y2, lay.edges[0].vertical], [172, 206, true, false])
  eq('a link between two rows is vertical and leaves from the middle of the node', [lay.edges[3].vertical, lay.edges[3].x1, lay.edges[3].x1 === lay.edges[3].x2, lay.edges[3].y1, lay.edges[3].y2], [true, 704, true, 70, 106])
  eq('on the second row the link runs leftwards', [lay.edges[4].x1, lay.edges[4].x2], [618, 584])
  eq('the label of a link sits in the middle of it', [lay.edges[0].lx, lay.edges[3].ly], [189, 88])
  eq('size of the whole graph', [lay.width, lay.height], [790, 176])
  eq('a short graph is as wide as its nodes, not as wide as a full row', m.kbGraphLayout(2).width, 378)
  eq('no node, no size, no link', m.kbGraphLayout(0), { width: 0, height: 0, pos: [], edges: [] })
  eq('one node, no link', m.kbGraphLayout(1).edges, [])
  const all = m.kbGraphLayout(9, { cols: 3 })
  eq('no two nodes share a place', new Set(all.pos.map((p) => p.x + ',' + p.y)).size, 9)
}

/* ── What the pane that draws it is allowed to do ────────────────────────── */
const pane = src.slice(src.indexOf('const kbRunsCache = new Map()'), src.indexOf('const kbBoardBones = '))
eq('the pane is found', pane.length > 1000, true)
eq('read-only: the pane never calls the host, never acts on a task, never writes', pane.indexOf('host.call') < 0 && pane.indexOf('act(') < 0 && pane.indexOf("method: 'POST'") < 0 && pane.indexOf('method: \'PUT\'') < 0 && pane.indexOf('DELETE') < 0, true)
eq('it reads the runs with its own fetch on the API base, GET only', pane.indexOf("fetch(kbApiBase() + '/tasks/runs?ids='") >= 0 && pane.indexOf("method: 'GET'") >= 0, true)
eq('a host without the route (404, network error) gives an empty answer, never an exception', /if \(res\.ok !== true\) return \{\}/.test(pane) && /catch \(e\) \{ return \{\} \}/.test(pane), true)
eq('journals are asked for five at a time, at most 20 runs, and detail for one run only', pane.indexOf('need.slice(i, i + 5)') >= 0 && pane.indexOf('.slice(0, 20)') >= 0 && /kbRunsFetch\(\[[^\]]+\], true\)/.test(pane), true)
eq('a run still open is not cached, it is read again', pane.indexOf("outcome.state !== 'open'") >= 0, true)
eq('the page has a Journal tab, next to Sessions and Webhook', src.indexOf("'data-kb': 'tab-journal'") >= 0 && src.indexOf("tab === 'journal'") >= 0, true)
eq('the Sessions and Journal tabs are one pane, keyed by the automation and the tab', src.indexOf("key: t.id + ':' + tab") >= 0 && src.indexOf('KbRunsPane, {') >= 0, true)
eq('the Journal shows six run chips, the chosen run when older, and a way to the rest: no run is cut without a word', src.indexOf('i < 6 || keys[i] === selKey') >= 0 && src.indexOf("'data-kb': 'runs-all'") >= 0 && src.indexOf('onSessions: () => setTab(\'sessions\')') >= 0, true)
eq('the tab counts runs, not history lines', src.indexOf("kbt('tasks.tab.sessions').replace('{n}', String(kbRunsOf(t.history).length))") >= 0, true)
eq('the old rows of the Sessions tab are gone', src.indexOf('kba-srow') < 0 && src.indexOf('sessionRows') < 0, true)
eq('the pure block holds no DOM, no network, no React', !/\b(document|window|fetch|React|localStorage)\b/.test(block.replace(/\/\/[^\n]*/g, '')), true)

if (fails > 0) { console.log('\n' + fails + ' FAILED'); process.exit(1) }
console.log('\nALL PASS')
