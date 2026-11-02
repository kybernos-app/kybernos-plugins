#!/usr/bin/env node
/** The pure model of the Journal's Story and Flow views (the block between KB-STORY-VIEW-BEGIN and KB-STORY-VIEW-END of client.js), played as it is:
 *  durations, the filters, the fold of automation ticks, the flow's merged nodes and its snake layout, the charts' paths. The page itself (React) is checked on the real GUI.
 *  Usage: node packages/kybernos-plugin/test-journal-story-view.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const a = src.indexOf('// KB-STORY-VIEW-BEGIN')
const b = src.indexOf('// KB-STORY-VIEW-END')
assert.ok(a > 0 && b > a, 'the story model block was found')
const code = src.slice(a, b)
const names = ['wvsDur', 'wvsTime', 'wvsIsErr', 'wvsCrewAt', 'wvsPass', 'wvsCounts', 'wvsFeed', 'wvsGraph', 'wvsLayout', 'wvsArea', 'wvsSplit', 'wvsHost', 'WVS_MAX_NODES', 'WVS_NW']
const box = { kbFmtNum: (n, o) => n.toFixed(o && o.minimumFractionDigits !== undefined ? o.minimumFractionDigits : 0), kbLocaleTag: () => 'en-US', URL, out: {} }
vm.runInNewContext(code + '\n' + names.map((n) => 'out.' + n + ' = ' + n).join(';') + ';', box)
// The model runs in its own realm: its arrays and objects have another prototype, which strict deep equality refuses. Results are copied across.
const copy = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const m = {}
for (const k of Object.keys(box.out)) m[k] = typeof box.out[k] === 'function' ? (...args) => copy(box.out[k](...args)) : box.out[k]

// ── durations: never « 8373 min » ────────────────────────────────────────────────────────
assert.equal(m.wvsDur(null), '—')
assert.equal(m.wvsDur(-5), '—')
assert.equal(m.wvsDur(420), '420 ms')
assert.equal(m.wvsDur(1234), '1.2 s')
assert.equal(m.wvsDur(42_000), '42 s')
assert.equal(m.wvsDur(3 * 60_000 + 5000), '3 min 05 s')
assert.equal(m.wvsDur(25 * 60_000), '25 min')
assert.equal(m.wvsDur(5 * 3600_000 + 7 * 60_000), '5 h 07 min')
assert.equal(m.wvsDur(8373 * 60_000), '6 d')
ok('a duration is milliseconds, seconds, minutes, hours or days: a long one never reads « 8373 min »')

// ── a story to play with ─────────────────────────────────────────────────────────────────
const T = Date.UTC(2026, 10, 2, 12, 0, 0)
const min = 60_000
let n = 0
const mk = (kind, at, more) => { n += 1; return Object.assign({ id: 'm' + n, kind: kind, at: T + at * min, seq: n }, more) }
const conn = (id, at, status, recovered) => mk('connector', at, { connector: { id: id, name: id.toUpperCase(), action: 'act', via: 'composio' }, status: status, recovered: recovered, durMs: 2000, endAt: T + at * min + 2000, links: [] })
const story = {
  chat: { id: 'session-x', startedAt: T, endedAt: T + 40 * min }, trigger: { kind: 'chat' },
  crews: [{ id: 'r1', name: 'Research', startedAt: T + 2 * min, endedAt: T + 10 * min, members: [] }, { id: 'r2', name: 'Build', startedAt: T + 14 * min, endedAt: null, members: [] }],
  moments: [
    mk('message', 0, { text: 'go', automation: false }),
    mk('crew', 2, { crewId: 'r1', status: 'done', endAt: T + 10 * min }),
    conn('gmail', 3, 'error', true), conn('gmail', 4, 'ok'), conn('gmail', 5, 'ok'),
    mk('work', 6, { counts: { command: 3 }, total: 3, failed: 0, items: [] }),
    mk('skill', 7, { op: 'use', subject: 'pack' }), mk('skill', 8, { op: 'use', subject: 'pack' }),
    mk('handover', 15, { source: 'question', outcome: 'waiting', text: 'Publish?', options: [], approvers: [], waitMs: null }),
    mk('handover', 16, { source: 'question', outcome: 'answered', text: 'Send?', options: [], approvers: [], waitMs: 1000 }),
    conn('github', 20, 'error', false),
    mk('output', 25, { files: [{ name: 'a.pdf' }] }),
    mk('crew', 14, { crewId: 'r2', status: 'running', endAt: null }),
  ],
  deliverables: [],
}
story.moments.sort((x, y) => x.at - y.at)

// ── errors, counts, filters ──────────────────────────────────────────────────────────────
const byKind = (k) => story.moments.filter((x) => x.kind === k)
assert.equal(m.wvsIsErr(byKind('connector')[0]), false) // recovered
assert.equal(m.wvsIsErr(story.moments.filter((x) => x.connector && x.connector.id === 'github')[0]), true)
const c = m.wvsCounts(story.moments)
assert.deepEqual([c.all, c.needs, c.errors, c.handovers, c.connectors, c.skills, c.outputs], [13, 1, 2, 2, 4, 2, 1])
ok('a recovered error is not an open one; the counts say what each filter will show')

assert.equal(m.wvsFeed(story, 'needs', 'all').filter((r) => r.kind !== 'day').length, 1)
assert.equal(m.wvsFeed(story, 'errors', 'all').filter((r) => r.kind !== 'day').length, 2)
assert.equal(m.wvsFeed(story, 'connectors', 'all').filter((r) => r.kind !== 'day').length, 4)
const inR1 = m.wvsFeed(story, 'all', 'r1').filter((r) => r.kind !== 'day')
assert.deepEqual(inR1.map((r) => r.kind), ['crew', 'connector', 'connector', 'connector', 'work', 'skill', 'skill'])
const inR2 = m.wvsFeed(story, 'all', 'r2').filter((r) => r.kind !== 'day')
assert.ok(inR2.length >= 4 && inR2[0].kind === 'crew' && inR2[0].crewId === 'r2')
ok('a filter and a crew window narrow the story; a crew shows its own row and what happened while it ran')

assert.equal(m.wvsCrewAt(story.crews, T + 3 * min), 0)
assert.equal(m.wvsCrewAt(story.crews, T + 12 * min), null)
assert.equal(m.wvsCrewAt(story.crews, T + 30 * min), 1) // a crew still running has no end
assert.equal(m.wvsCrewAt(story.crews, null), null)
ok('the crew « during » a moment is the one whose window holds it; a running crew has no end')

// ── automation ticks fold, days divide ───────────────────────────────────────────────────
const ticks = { chat: story.chat, trigger: { kind: 'automation' }, crews: [], deliverables: [], moments: [mk('message', 0, { text: 'tick', automation: true }), mk('message', 1, { text: 'tick', automation: true }), mk('message', 2, { text: 'tick', automation: true }), mk('reply', 3, { text: 'ok' }), mk('message', 4, { text: 'tick', automation: true }), mk('message', 5, { text: 'tick', automation: true })] }
const tr = m.wvsFeed(ticks, 'all', 'all').filter((r) => r.kind !== 'day')
assert.deepEqual(tr.map((r) => r.kind), ['ticks', 'reply', 'message', 'message'])
assert.equal(tr[0].n, 3)
ok('three automation ticks in a row fold into one row; two stay as they are')
const days = { chat: story.chat, trigger: { kind: 'chat' }, crews: [], deliverables: [], moments: [mk('message', 0, { text: 'a' }), mk('message', 60 * 24 + 5, { text: 'b' })] }
assert.deepEqual(m.wvsFeed(days, 'all', 'all').map((r) => r.kind), ['day', 'message', 'day', 'message'])
ok('a divider opens each day')

// ── the flow ─────────────────────────────────────────────────────────────────────────────
const g = m.wvsGraph(story)
assert.deepEqual(g.nodes.map((x) => x.kind), ['trigger', 'crew', 'connector', 'skill', 'crew', 'handover', 'handover', 'connector', 'output'])
assert.equal(g.nodes[2].count, 3) // the three Gmail calls are one node
assert.equal(g.nodes[2].errors, 1)
assert.equal(g.nodes[2].status, 'ok') // its error was recovered
assert.equal(g.nodes[3].count, 2)
assert.equal(g.nodes[4].status, 'wait') // the crew still running
assert.equal(g.nodes[5].status, 'wait') // the question nobody answered
assert.equal(g.nodes.filter((x) => x.kind === 'connector' && x.status === 'err').length, 1)
ok('consecutive calls of one connector (or skill) are one node; a recovered error leaves it ok, an open one makes it red, a waiting question amber')

const many = { chat: story.chat, trigger: { kind: 'chat' }, crews: [], deliverables: [], moments: [] }
for (let i = 0; i < 50; i += 1) many.moments.push(mk(i % 2 === 0 ? 'handover' : 'output', i, { outcome: 'answered', files: [{ name: 'f' }], approvers: [] }))
const big = m.wvsGraph(many)
assert.equal(big.nodes.length, m.WVS_MAX_NODES)
assert.equal(big.dropped, 50 - (m.WVS_MAX_NODES - 1))
ok('the flow is capped, and says how many steps it left to the Story view')

const L = m.wvsLayout(Array.from({ length: 7 }, () => ({ status: 'ok' })), 3, 66)
assert.deepEqual(L.pos.map((p) => p.col), [0, 1, 2, 2, 1, 0, 0])
assert.deepEqual(L.pos.map((p) => p.row), [0, 0, 0, 1, 1, 1, 2])
assert.equal(L.edges.length, 6)
assert.ok(/^M\d+ \d+ L\d+ \d+$/.test(L.edges[3].d))
// a row change keeps the same column, so the line is vertical
const e2 = L.edges[2].d.match(/\d+/g).map(Number)
assert.equal(e2[0], e2[2])
// the second row runs right to left: the line goes from the left edge of a box to the right edge of the next
const e3 = L.edges[3].d.match(/\d+/g).map(Number)
assert.equal(e3[0], L.pos[3].x)
assert.equal(e3[2], L.pos[4].x + m.WVS_NW)
ok('the boxes lie on a snake: a line only joins neighbours and never crosses another')

// ── charts ───────────────────────────────────────────────────────────────────────────────
assert.equal(m.wvsArea([], 300, 96).ok, false)
assert.equal(m.wvsArea([{ tokens: 0 }, { tokens: 0 }], 300, 96).ok, false)
const priced = m.wvsArea([{ costEur: 0.1, tokens: 10 }, { costEur: 0.5, tokens: 20 }, { costEur: 1, tokens: 30 }], 300, 96)
assert.equal(priced.ok, true)
assert.equal(priced.priced, true)
assert.equal(priced.max, 1)
assert.ok(priced.line.startsWith('M0.0 ') && priced.area.endsWith('Z'))
const raw = m.wvsArea([{ costEur: null, tokens: 10 }, { costEur: null, tokens: 40 }], 300, 96)
assert.equal(raw.priced, false)
assert.equal(raw.max, 40)
ok('the cost curve falls back to tokens when nothing is priced, and draws nothing from less than two points')

const sp = m.wvsSplit({ activeMs: 100, waitingMs: 30, crewMs: 50 })
assert.deepEqual(sp.parts.map((p) => Math.round(p.ms)), [50, 30, 20])
const over = m.wvsSplit({ activeMs: 100, waitingMs: 80, crewMs: 80 })
assert.equal(Math.round(over.parts.reduce((x, p) => x + p.ms, 0)), 100)
assert.equal(m.wvsSplit({ activeMs: 0, waitingMs: 5, crewMs: 5 }).total, 0)
ok('the time split never exceeds the active time, even when waiting and crews overlap in the log')

assert.equal(m.wvsHost('https://www.github.com/a/b/pull/2'), 'github.com')
assert.equal(m.wvsHost('nope'), null)
ok('a link shows its host')

console.log('\n' + pass + ' groups passed')
