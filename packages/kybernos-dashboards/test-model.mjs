// kybernos-dashboards: the pure model. `cd packages/kybernos-dashboards && node test-model.mjs`
import * as M from './model.mjs'
import { PARTS, NOW } from './lib-fixtures.mjs'

let fail = 0
let passed = 0
const ok = (name, cond, detail) => {
  if (cond) { passed++; return }
  fail++
  console.log('FAIL ' + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)))
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── helpers ──────────────────────────────────────────────────────────────────
ok('slug: accents and punctuation', M.slug('Coût & Tokens (14 j)') === 'cout-tokens-14-j')
ok('slug: empty falls back', M.slug('') === 'dashboard' && M.slug('???', 'x') === 'x')
ok('slug: bounded', M.slug('a'.repeat(300)).length <= M.LIMITS.name)
ok('dayKey is local YYYY-MM-DD', M.dayKey(new Date(2026, 9, 5, 23, 59).getTime()) === '2026-10-05')

// ── validate ─────────────────────────────────────────────────────────────────
{
  const r = M.validateDashboard('nope')
  ok('a non-object is refused, with an empty dashboard to show', r.ok === false && r.dashboard.widgets.length === 0 && r.errors.length === 1)
  const e = M.validateDashboard({})
  ok('an empty object is a valid empty dashboard', e.ok === true && e.dashboard.name === 'Dashboard' && e.dashboard.widgets.length === 0 && e.errors.length === 0)
}
{
  const r = M.validateDashboard({
    name: '  Mine  ', desc: 'x'.repeat(500),
    widgets: [
      { type: 'card', title: 'T', source: { provider: 'usage.daily', params: { days: 7, bogus: 1 } }, metric: { agg: 'sum', field: 'tokens' }, w: 99, h: 0 },
      { type: 'nope' },
      'not an object',
      { type: 'chart', title: 'no x', source: { provider: 'usage.daily' } },
      { type: 'chart', x: 'day', source: { provider: 'does.not.exist' } },
      { type: 'list', source: { provider: 'automations.runs' } },
      { type: 'sankey', stages: ['a'], source: { provider: 'usage.daily' } },
      { type: 'flow', nodes: [] },
      { type: 'carousel', source: { provider: 'deliverables.list' } },
      { type: 'kanban', source: { provider: 'automations.list' }, groupBy: 'state', label: 'name' },
      { type: 'note', text: 'hello', tint: 'neon' },
    ],
  })
  const d = r.dashboard
  ok('name trimmed and desc bounded', d.name === 'Mine' && d.desc.length <= M.LIMITS.desc)
  ok('only valid widgets are kept', same(d.widgets.map((w) => w.type), ['card', 'note']), d.widgets.map((w) => w.type))
  ok('each dropped widget explains itself', r.errors.length >= 9, r.errors)
  ok('an unknown provider names the known ones', r.errors.some((e) => e.includes('unknown source') && e.includes('usage.daily')))
  const c = d.widgets[0]
  ok('size is clamped into the grid', c.w === 12 && c.h === 1)
  ok('only declared params survive', same(c.source.params, { days: 7 }) && r.errors.some((e) => e.includes('has no parameter')))
  ok('a bad tint becomes no tint', d.widgets[1].tint === '')
  ok('a bound kanban needs columns', r.errors.some((e) => e.includes('needs columns')))
}
{
  const many = []
  for (let i = 0; i < 40; i++) many.push({ type: 'note', text: String(i) })
  const r = M.validateDashboard({ widgets: many })
  ok('widgets are capped', r.dashboard.widgets.length === M.LIMITS.widgets && r.errors.some((e) => e.includes('only the first')))
  ok('ids are unique', new Set(r.dashboard.widgets.map((w) => w.id)).size === r.dashboard.widgets.length)
  const dup = M.validateDashboard({ widgets: [{ type: 'note', id: 'a' }, { type: 'note', id: 'a' }, { type: 'note', id: 'A' }] })
  ok('duplicate ids are made unique, never dropped', same(dup.dashboard.widgets.map((w) => w.id), ['a', 'a-2', 'a-3']), dup.dashboard.widgets.map((w) => w.id))
}
{
  const r = M.validateDashboard({ widgets: [
    { type: 'flow', nodes: [{ id: 'A b', t: 'One' }, { id: 'two', t: 'Two', s: 'ok' }, { id: 'two', t: 'Dup' }], edges: [['a-b', 'two'], ['a-b', 'ghost'], ['two', 'a-b', 'f']] },
    { type: 'kanban', manual: true, cols: [{ t: 'To do', c: [['Task', 'sub'], 'plain'] }] },
    { type: 'note', check: [['one', 1], 'two', ['three', 0]] },
    { type: 'sankey', stages: ['provider', 'model', 'x', 'y'], value: 'tokens', source: { provider: 'usage.daily' } },
  ] })
  const [f, k, n, s] = r.dashboard.widgets
  ok('flow node ids are slugged and unique', same(f.nodes.map((x) => x.id), ['a-b', 'two', 'two-2']), f.nodes.map((x) => x.id))
  ok('flow edges must join existing nodes', same(f.edges, [['a-b', 'two', ''], ['two', 'a-b', 'f']]), f.edges)
  ok('manual kanban keeps cards as [title, sub]', same(k.cols[0].c, [['Task', 'sub'], ['plain', '']]), k.cols)
  ok('checklist items are [text, done]', same(n.check, [['one', 1], ['two', 0], ['three', 0]]), n.check)
  ok('sankey keeps at most three stages', s.stages.length === 3)
}
{
  const r = M.validateDashboard({ widgets: [{ type: 'card', title: 'x', source: { provider: 'usage.daily' }, spark: { x: 'day', y: 'tokens' }, alertAbove: 3, sub: { template: '{v} out', state: 'bogus', warnAbove: 2 } }] })
  const c = r.dashboard.widgets[0]
  ok('card spark, alert and sub are normalised', c.spark.x === 'day' && c.spark.agg === 'sum' && c.alertAbove === 3 && c.sub.state === undefined && c.sub.warnAbove === 2, c)
}

// ── inspect ──────────────────────────────────────────────────────────────────
{
  const d = M.validateDashboard({ widgets: [
    { type: 'chart', title: 'a', x: 'dayy', y: 'tokens', source: { provider: 'usage.daily' }, w: 3 },
    { type: 'chart', title: 'b', x: 'day', y: 'model', agg: 'sum', source: { provider: 'usage.daily' } },
    { type: 'card', title: 'c', metric: { agg: 'sum', field: 'automation' }, source: { provider: 'automations.runs' } },
    { type: 'note' },
    { type: 'chart', title: 'd', kind: 'donut', x: 'model', y: 'tokens', series: 'provider', source: { provider: 'usage.daily' } },
    { type: 'chart', title: 'e', x: 'team', y: 'lessons', source: { provider: 'teams.lessons', params: {} } },
  ] }).dashboard
  const w = M.inspectDashboard(d)
  ok('a field that is not a column is named with the real columns', w.some((x) => x.includes('"dayy" is not a column of usage.daily') && x.includes('day, model')), w)
  ok('a number asked of a text column is flagged', w.some((x) => x.includes('"model"') && x.includes('not a number')), w)
  ok('sum over a text column in a card is flagged', w.some((x) => x.includes('metric.field') && x.includes('automation')), w)
  ok('a narrow chart is flagged', w.some((x) => x.includes('narrower than 4')), w)
  ok('an empty note is flagged', w.some((x) => x.includes('the note is empty')), w)
  ok('a donut with a series is flagged', w.some((x) => x.includes('donut ignores series')), w)
  ok('a clean dashboard has no warning', M.inspectDashboard(M.validateDashboard({ widgets: [{ type: 'chart', title: 'ok', x: 'day', y: 'tokens', series: 'model', kind: 'stacked', source: { provider: 'usage.daily' }, w: 8 }] }).dashboard).length === 0)
  ok('an empty dashboard says so', same(M.inspectDashboard(M.emptyDashboard()), ['the dashboard has no widget yet']))
}

// ── providers ────────────────────────────────────────────────────────────────
for (const id of M.PROVIDER_IDS) {
  const p = M.PROVIDERS[id]
  const plan = M.planFor({ provider: id, params: {} }, NOW)
  ok(id + ': a plan with at least one same-origin request', plan.length > 0 && plan.every((r) => r.path.startsWith('/') && (r.method === 'GET' || r.method === 'POST')), plan)
  const t = M.buildTable({ provider: id, params: {} }, PARTS[id], NOW)
  ok(id + ': builds a table from its fixture', t.rows.length > 0, t.rows.length)
  const ids = p.columns.map((c) => c.id)
  ok(id + ': every row only uses declared columns', t.rows.every((r) => Object.keys(r).every((k) => ids.includes(k))), t.rows[0])
  ok(id + ': every declared column is present on each row', t.rows.every((r) => ids.every((k) => k in r)), t.rows[0])
  ok(id + ': numeric columns hold finite numbers', t.rows.every((r) => p.columns.filter((c) => c.type === 'number').every((c) => typeof r[c.id] === 'number' && Number.isFinite(r[c.id]))), t.rows[0])
  const empty = M.buildTable({ provider: id, params: {} }, {}, NOW)
  ok(id + ': an empty answer is an empty table, not a throw', empty.rows.length === 0 && Array.isArray(empty.columns))
  const junk = M.buildTable({ provider: id, params: {} }, { summary: 42, tasks: 'x', load: [], state: null, skills: true, index: {}, occurrences: 7 }, NOW)
  ok(id + ': junk answers never throw', Array.isArray(junk.rows))
}
{
  const t = M.buildTable({ provider: 'usage.daily', params: { days: 14 } }, PARTS['usage.daily'], NOW)
  ok('usage.daily: model and provider are split', t.rows.some((r) => r.provider === 'anthropic' && r.model === 'sonnet-5-5'))
  ok('usage.daily: tokens add the four counters', t.rows.every((r) => r.tokens === r.input + r.output + r.cache_read + r.cache_write))
  ok('usage.daily: the day axis is the whole period', t.meta.xDomain.field === 'day' && t.meta.xDomain.values.length === 14 && t.meta.xDomain.values[13] === M.dayKey(NOW), t.meta.xDomain)
  ok('usage.daily: undated usage is called out', t.meta.note.includes('before'))
  ok('usage.daily: days is bounded in the plan', M.planFor({ provider: 'usage.daily', params: { days: 9999 } }, NOW)[0].path.endsWith('days=120') && M.planFor({ provider: 'usage.daily', params: { days: -4 } }, NOW)[0].path.endsWith('days=1'))
}
{
  const t = M.buildTable({ provider: 'automations.runs', params: { days: 14 } }, PARTS['automations.runs'], NOW)
  ok('automations.runs: statuses are mapped', t.rows.some((r) => r.state === 'done') && t.rows.some((r) => r.state === 'failed') && t.rows.some((r) => r.state === 'queued'))
  ok('automations.runs: newest first', t.rows.every((r, i) => i === 0 || t.rows[i - 1].at >= r.at))
  ok('automations.runs: the period cuts old runs', M.buildTable({ provider: 'automations.runs', params: { days: 1 } }, PARTS['automations.runs'], NOW).rows.length < t.rows.length)
  const l = M.buildTable({ provider: 'automations.list', params: {} }, PARTS['automations.list'], NOW)
  const by = (id) => l.rows.find((r) => r.id === id)
  ok('automations.list: last result per automation', by('morning-digest').state === 'done' && by('weekly-post').state === 'paused' && by('new-one').state === 'none', l.rows.map((r) => r.id + ':' + r.state))
  ok('automations.list: failed runs kept are counted', by('morning-digest').failed === 1 && by('morning-digest').runs === 4)
}
{
  const t = M.buildTable({ provider: 'automations.timeline', params: {} }, PARTS['automations.timeline'], NOW)
  ok('automations.timeline: a week of seven days Monday first', t.meta.xDomain.values.length === 7 && t.meta.xDomain.values[0] === '2026-10-12' && t.meta.xDomain.values[6] === '2026-10-18', t.meta.xDomain.values)
  ok('automations.timeline: past runs and planned runs', t.rows.some((r) => r.state === 'done') && t.rows.some((r) => r.state === 'upcoming'))
  ok('automations.timeline: only this week', t.rows.every((r) => r.day >= '2026-10-12' && r.day <= '2026-10-18'), t.rows.map((r) => r.day))
  ok('automations.timeline: planned runs carry the automation name', t.rows.filter((r) => r.state === 'upcoming').every((r) => r.automation !== r.id || r.id === ''), t.rows[0])
  const plan = M.planFor({ provider: 'automations.timeline', params: {} }, NOW)
  ok('automations.timeline: asks the occurrences route from now to Sunday night', plan.length === 2 && plan[1].path.includes('/kybernos/tasks/occurrences?from=') && plan[1].path.includes('to='), plan[1].path)
  const prev = M.buildTable({ provider: 'automations.timeline', params: { weekOffset: -1 } }, PARTS['automations.timeline'], NOW)
  ok('automations.timeline: last week shows no planned run', prev.rows.every((r) => r.state !== 'upcoming') && prev.meta.xDomain.values[0] === '2026-10-05')
}
{
  const t = M.buildTable({ provider: 'teams.list', params: {} }, PARTS['teams.list'], NOW)
  ok('teams.list: name, roles and declared skills', t.rows[0].team === 'Release' && t.rows[0].roles === 2 && t.rows[0].skills === 2 && t.rows.length === 3)
  const d = M.buildTable({ provider: 'deliverables.list', params: { limit: 2 } }, PARTS['deliverables.list'], NOW)
  ok('deliverables.list: limit and newest first, kinds from extensions', d.rows.length === 2 && d.rows[0].name.startsWith('q4') && d.rows[0].kind === 'pptx' && d.rows[1].kind === 'document', d.rows)
  const r = M.buildTable({ provider: 'sessions.runs', params: {} }, PARTS['sessions.runs'], NOW)
  ok('sessions.runs: folder name, untitled sessions get an id prefix', r.rows[0].workspace === 'kybernos-plugins' && r.rows[1].title === 'bbbbbbbb' && r.rows[2].workspace === '', r.rows)
  const s = M.buildTable({ provider: 'skills.list', params: {} }, PARTS['skills.list'], NOW)
  ok('skills.list: inactive and colliding skills are marked', s.rows.find((x) => x.skill === 'airtable-sales-ops').active === 'no' && s.rows.find((x) => x.skill === 'docx').collision === 'yes')
}
ok('an unknown provider is a harmless empty table', M.buildTable({ provider: 'x' }, {}, NOW).rows.length === 0 && M.planFor({ provider: 'x' }, NOW).length === 0)
ok('period support is declared per provider', M.supportsPeriod('usage.daily') === true && M.supportsPeriod('teams.list') === false && M.supportsPeriod('nope') === false)

// ── query ────────────────────────────────────────────────────────────────────
{
  const rows = [{ a: 'x', n: 1, s: 'Alpha' }, { a: 'y', n: 5, s: 'beta' }, { a: 'x', n: 3, s: '' }, { a: 'z', n: 10, s: 'Alphabet' }]
  const w = (c) => M.applyWhere(rows, c).map((r) => r.n)
  ok('where =, case-insensitive', same(w([{ field: 'a', op: '=', value: 'X' }]), [1, 3]))
  ok('where !=, in, not_in', same(w([{ field: 'a', op: '!=', value: 'x' }]), [5, 10]) && same(w([{ field: 'a', op: 'in', value: ['y', 'z'] }]), [5, 10]) && same(w([{ field: 'a', op: 'not_in', value: ['y', 'z'] }]), [1, 3]))
  ok('where numeric comparisons', same(w([{ field: 'n', op: '>', value: 3 }]), [5, 10]) && same(w([{ field: 'n', op: '<=', value: 3 }]), [1, 3]))
  ok('where contains, empty, not_empty', same(w([{ field: 's', op: 'contains', value: 'alph' }]), [1, 10]) && same(w([{ field: 's', op: 'empty' }]), [3]) && same(w([{ field: 's', op: 'not_empty' }]), [1, 5, 10]))
  ok('where conditions are ANDed', same(w([{ field: 'a', op: '=', value: 'x' }, { field: 'n', op: '>', value: 1 }]), [3]))
  ok('no where keeps everything', M.applyWhere(rows, undefined).length === 4 && M.applyWhere(rows, []).length === 4)
  ok('aggregate: sum avg min max last count distinct', M.aggregate(rows, 'sum', 'n') === 19 && M.aggregate(rows, 'avg', 'n') === 4.75 && M.aggregate(rows, 'min', 'n') === 1 && M.aggregate(rows, 'max', 'n') === 10 && M.aggregate(rows, 'last', 'n') === 10 && M.aggregate(rows, 'count') === 4 && M.aggregate(rows, 'distinct', 'a') === 3)
  ok('aggregate: empty input is 0, never NaN', M.aggregate([], 'avg', 'n') === 0 && M.aggregate([], 'max', 'n') === 0 && M.aggregate([{ n: 'abc' }], 'sum', 'n') === 0)
}
ok('formatNumber: thousands, compact, percent', M.formatNumber(1234567.8, 'number') === '1.2M' && M.formatNumber(1234, 'number') === '1,234' && M.formatNumber(12.34, 'number') === '12.3' && M.formatNumber(15000, 'compact') === '15k' && M.formatNumber(2400000, 'compact') === '2.4M' && M.formatNumber(42.04, 'percent') === '42%' && M.formatNumber(NaN, 'number') === '0')

// ── shapers ──────────────────────────────────────────────────────────────────
const widget = (raw) => M.validateDashboard({ widgets: [raw] }).dashboard.widgets[0]
const tableOf = (id, params) => M.buildTable({ provider: id, params: params || {} }, PARTS[id], NOW)
{
  const t = tableOf('usage.daily', { days: 14 })
  const w = widget({ type: 'card', title: 'Tokens', source: { provider: 'usage.daily' }, metric: { agg: 'sum', field: 'tokens' }, format: 'compact', sub: { template: '{v} output', metric: { agg: 'sum', field: 'output' } }, spark: { x: 'day', y: 'tokens', agg: 'sum' } })
  const c = M.cardData(t, w)
  const total = t.rows.reduce((a, r) => a + r.tokens, 0)
  ok('card: the value is the aggregate', c.value === total && c.text === M.formatNumber(total, 'compact'), c)
  ok('card: the sub line fills its template', c.sub === M.formatNumber(t.rows.reduce((a, r) => a + r.output, 0), 'number') + ' output', c.sub)
  ok('card: the sparkline has one point per day, in order', c.spark.length === 14 && c.spark[13] > 0, c.spark)
  const a = M.cardData(tableOf('automations.list'), widget({ type: 'card', title: 'f', source: { provider: 'automations.list' }, metric: { agg: 'count', where: [{ field: 'state', op: '=', value: 'failed' }] }, alertAbove: 0 }))
  ok('card: alertAbove turns it amber', a.value === 0 && a.st === 'ok')
  const b = M.cardData(tableOf('automations.runs', { days: 14 }), widget({ type: 'card', title: 'f', source: { provider: 'automations.runs' }, metric: { agg: 'count', where: [{ field: 'state', op: '=', value: 'failed' }] }, alertAbove: 0 }))
  ok('card: and stays amber while there is something to look at', b.value === 1 && b.st === 'warn', b)
  const e = M.cardData(M.buildTable({ provider: 'usage.daily' }, {}, NOW), w)
  ok('card: an empty source is flagged empty, value 0', e.empty === true && e.value === 0 && e.spark.every((v) => v === 0))
}
{
  const t = tableOf('usage.daily', { days: 14 })
  const st = M.chartData(t, widget({ type: 'chart', kind: 'stacked', x: 'day', y: 'tokens', series: 'model', source: { provider: 'usage.daily' } }))
  ok('chart stacked: one label per day of the period, oldest first', st.labels.length === 14 && st.labels[0].key < st.labels[13].key)
  ok('chart stacked: one series per model, biggest first', st.series.length === 3 && st.series[0].name === 'sonnet-5-5', st.series.map((s) => s.name))
  ok('chart stacked: totals are the sum of the series', st.totals.every((tot, i) => Math.abs(tot - st.series.reduce((a, s) => a + s.values[i], 0)) < 1e-6))
  ok('chart stacked: a day without usage is a zero', st.series.every((s) => s.values.length === 14))
  const grand = st.totals.reduce((a, b) => a + b, 0)
  ok('chart stacked: nothing is lost', grand === t.rows.reduce((a, r) => a + r.tokens, 0))
  const many = { columns: [{ id: 'x', type: 'string' }, { id: 's', type: 'string' }, { id: 'v', type: 'number' }], rows: [], meta: { xDomain: null } }
  for (let i = 0; i < 9; i++) many.rows.push({ x: 'a', s: 's' + i, v: 10 - i })
  const folded = M.chartData(many, widget({ type: 'chart', kind: 'stacked', x: 'x', y: 'v', series: 's', source: { provider: 'usage.daily' } }))
  ok('chart: more than six series fold into Other', folded.series.length === 6 && folded.series[5].name === 'Other' && folded.series[5].values[0] === (10 - 5) + (10 - 6) + (10 - 7) + (10 - 8), folded.series.map((s) => s.name + ':' + s.values[0]))
  const bars = M.chartData(t, widget({ type: 'chart', kind: 'bars', x: 'model', y: 'tokens', source: { provider: 'usage.daily' }, limit: 2 }))
  ok('chart bars: ranked, capped, the rest folded', bars.labels.length === 2 && bars.labels[1].other === true && bars.labels[0].other !== true && bars.series[0].values[0] >= bars.series[0].values[1], bars.labels)
  const all = M.chartData(t, widget({ type: 'chart', kind: 'bars', x: 'model', y: 'tokens', source: { provider: 'usage.daily' }, limit: 8 }))
  ok('chart bars: sorted by value, descending', all.series[0].values.every((v, i, a) => i === 0 || a[i - 1] >= v), all.series[0].values)
  const donut = M.chartData(t, widget({ type: 'chart', kind: 'donut', x: 'provider', y: 'tokens', source: { provider: 'usage.daily' } }))
  ok('chart donut: a share per provider', donut.labels.length === 3 && Math.abs(donut.totals.reduce((a, b) => a + b, 0) - t.rows.reduce((a, r) => a + r.tokens, 0)) < 1e-6)
  const cnt = M.chartData(tableOf('automations.runs', { days: 14 }), widget({ type: 'chart', kind: 'stacked', x: 'day', series: 'state', source: { provider: 'automations.runs' } }))
  ok('chart: without y it counts rows', cnt.series.some((s) => s.name === 'failed') && cnt.totals.reduce((a, b) => a + b, 0) === tableOf('automations.runs', { days: 14 }).rows.length)
  ok('states keep their meaning in a chart: done green, failed red, queued amber', M.stateTone('done') === 'ok' && M.stateTone('failed') === 'err' && M.stateTone('queued') === 'warn' && M.stateTone('paused') === 'mute' && M.stateTone('x') === undefined)
  ok('chart: a series split by a state column carries the tones, a model column does not', cnt.series.filter((s) => s.name === 'failed').every((s) => s.tone === 'err') && cnt.series.some((s) => s.tone === 'ok') && st.series.every((s) => s.tone === undefined), cnt.series.map((s) => s.name + ':' + s.tone))
  const byState = M.chartData(tableOf('automations.runs', { days: 14 }), widget({ type: 'chart', kind: 'donut', x: 'state', source: { provider: 'automations.runs' } }))
  ok('chart: a donut of states is toned slice by slice', byState.labels.some((l) => l.key === 'failed' && l.tone === 'err') && byState.labels.some((l) => l.tone === 'ok'), byState.labels)
  const none = M.chartData(M.buildTable({ provider: 'usage.daily' }, {}, NOW), widget({ type: 'chart', kind: 'columns', x: 'day', y: 'tokens', source: { provider: 'usage.daily' } }))
  ok('chart: empty data is flagged empty', none.empty === true && none.labels.length === 0)
}
{
  const t = tableOf('automations.runs', { days: 14 })
  const w = widget({ type: 'list', label: 'automation', sub: 'error', when: 'at', state: 'state', source: { provider: 'automations.runs' }, sort: '-at', limit: 3, failedChip: true })
  const all = M.listData(t, w)
  ok('list: limited and sorted', all.length === 3 && all[0].whenType === 'time')
  ok('list: the type of the sub and when columns is kept so the page can format a date', all[0].whenType === 'time' && M.listData(tableOf('usage.sessions', { days: 14 }), widget({ type: 'list', label: 'title', sub: 'day', when: 'seen', source: { provider: 'usage.sessions' } }))[0].subType === 'date')
  const failed = M.listData(t, w, 'failed')
  ok('list: the Failed chip keeps failures only', failed.length > 0 && failed.every((r) => r.state === 'failed'), failed)
  const k = M.kanbanData(tableOf('automations.list'), widget({ type: 'kanban', groupBy: 'state', label: 'name', sub: 'schedule', columns: [{ value: 'failed', label: 'Failed' }, { value: 'done', label: 'Done' }, { value: 'none', label: 'Never' }, { value: 'paused', label: 'Paused' }], source: { provider: 'automations.list' } }))
  ok('kanban: cards land in the column of their state', k.length === 4 && k[1].total === 3 && k[2].total === 1 && k[3].cards[0].title === 'Draft weekly post', k.map((c) => c.title + ':' + c.total))
  const m = M.kanbanData({ rows: [] }, widget({ type: 'kanban', manual: true, cols: [{ t: 'A', c: [['x', 'y']] }, { t: 'B', c: [] }] }))
  ok('kanban: a manual board is its own data', m.length === 2 && m[0].cards[0].title === 'x' && m[1].total === 0)
  const cal = M.calendarData(tableOf('automations.timeline'), widget({ type: 'calendar', at: 'at', label: 'automation', state: 'state', source: { provider: 'automations.timeline' } }), NOW)
  ok('calendar: seven days, today marked, Monday first', cal.length === 7 && cal[0].key === '2026-10-12' && cal[1].today === true && cal.filter((d) => d.today).length === 1, cal.map((d) => d.key))
  ok('calendar: events are in time order with HH:MM', cal.every((d) => d.events.every((e, i) => /^\d\d:\d\d$/.test(e.time) && (i === 0 || d.events[i - 1].time <= e.time))))
  ok('calendar: past and planned runs both appear', cal.some((d) => d.events.some((e) => e.state === 'done')) && cal.some((d) => d.events.some((e) => e.state === 'upcoming')))
  const car = M.carouselData(tableOf('deliverables.list'), widget({ type: 'carousel', label: 'name', sub: 'workspace', kind: 'kind', source: { provider: 'deliverables.list' }, limit: 3 }))
  ok('carousel: cards from rows', car.length === 3 && car[0].title.startsWith('q4') && car[0].kind === 'pptx')
}
{
  const t = tableOf('usage.daily', { days: 14 })
  const s = M.sankeyData(t, widget({ type: 'sankey', stages: ['provider', 'model'], value: 'tokens', source: { provider: 'usage.daily' } }))
  const total = t.rows.reduce((a, r) => a + r.tokens, 0)
  ok('sankey: two columns, flow conserved', s.cols.length === 2 && Math.abs(s.total - total) < 1e-6 && s.links.length > 0 && Math.abs(s.links.reduce((a, l) => a + l[4], 0) - total) < 1e-6, s.total)
  ok('sankey: links join adjacent columns by index', s.links.every((l) => l[2] === l[0] + 1 && s.cols[l[0]][l[1]] !== undefined && s.cols[l[2]][l[3]] !== undefined))
  ok('sankey: no value counts rows', M.sankeyData(t, widget({ type: 'sankey', stages: ['provider', 'model'], source: { provider: 'usage.daily' } })).total === t.rows.length)
  ok('sankey: empty data is flagged', M.sankeyData(M.buildTable({ provider: 'usage.daily' }, {}, NOW), widget({ type: 'sankey', stages: ['provider', 'model'], source: { provider: 'usage.daily' } })).empty === true)
}
ok('sourcesOf lists each provider once with its widgets', same(M.sourcesOf({ widgets: [{ id: 'a', source: { provider: 'usage.daily' } }, { id: 'b', source: { provider: 'usage.daily' } }, { id: 'c' }] }).map((s) => s.provider + ':' + s.widgets.join('+')), ['usage.daily:a+b']))
ok('describeCatalogue names every provider and widget type', M.PROVIDER_IDS.every((id) => M.describeCatalogue().providers.includes(id)) && M.WIDGET_TYPES.every((t) => M.describeCatalogue().widgets.includes('- ' + t + ' ')))

// ── a flow with live numbers on its nodes ──────────────────────────────────────
{
  const v = M.validateDashboard({ name: 'F', widgets: [{
    type: 'flow', title: 'Pipe',
    nodes: [
      { id: 'run', t: 'Run', s: 'ok', bind: { source: { provider: 'automations.runs', params: { days: 14 } }, metric: { agg: 'count' }, template: '{v} runs' } },
      { id: 'bad', t: 'Failed', s: 'ok', bind: { source: { provider: 'automations.runs', params: { days: 14 } }, metric: { agg: 'count', where: [{ field: 'state', op: '=', value: 'failed' }] }, template: '{v} failed', failAbove: 0 } },
      { id: 'ghost', t: 'Ghost', bind: { source: { provider: 'nope.nothing' }, metric: { agg: 'count' } } },
      { id: 'plain', t: 'Plain', sub: 'by hand' },
    ],
    edges: [['run', 'bad', 'f']],
  }] })
  const f = v.dashboard.widgets[0]
  ok('flow: a bound node keeps its source, metric, template and thresholds', f.nodes[0].bind && f.nodes[0].bind.source.provider === 'automations.runs' && f.nodes[0].bind.template === '{v} runs' && f.nodes[1].bind.failAbove === 0, f.nodes.map((n) => n.bind))
  ok('flow: an unknown source drops the number, not the node', f.nodes.length === 4 && f.nodes[2].bind === undefined && v.errors.some((e) => e.includes('nope.nothing')), v.errors)
  ok('flow: a node with no bind stays as written', f.nodes[3].bind === undefined && f.nodes[3].sub === 'by hand')
  ok('flow: sources are listed once each, keyed', M.flowSources(f).length === 1 && M.flowSources(f)[0].key.startsWith('automations.runs|'), M.flowSources(f))
  ok('sourcesOf: the sources of the nodes count for the flow', same(M.sourcesOf(v.dashboard).map((s) => [s.provider, s.widgets]), [['automations.runs', [f.id]]]), M.sourcesOf(v.dashboard))
  const t = M.buildTable({ provider: 'automations.runs', params: { days: 14 } }, PARTS['automations.runs'], NOW)
  const total = t.rows.length
  const failed = t.rows.filter((r) => r.state === 'failed').length
  const a = M.liveNode(f.nodes[0], t)
  const b = M.liveNode(f.nodes[1], t)
  ok('liveNode: the line is the number, in the template', a.sub === total + ' runs' && a.s === 'ok', a.sub)
  ok('liveNode: a threshold turns the state', failed > 0 ? b.s === 'fail' && b.sub === failed + ' failed' : b.s === 'ok', [b.s, b.sub])
  ok('liveNode: no table keeps the node as written, a plain node is untouched', M.liveNode(f.nodes[0], null) === f.nodes[0] && M.liveNode(f.nodes[3], t) === f.nodes[3])
  ok('liveNode: the saved node is not changed (the page draws a copy)', f.nodes[0].sub === '' && f.nodes[1].s === 'ok')
  ok('inspect: a field that is not a column of the node\'s source is named', M.inspectDashboard(M.validateDashboard({ widgets: [{ type: 'flow', nodes: [{ id: 'a', t: 'A', bind: { source: { provider: 'usage.daily' }, metric: { agg: 'sum', field: 'nope' } } }] }] }).dashboard).some((w) => w.includes('node "a"') && w.includes('"nope"')))
  ok('inspect: a sum of a text column is named', M.inspectDashboard(M.validateDashboard({ widgets: [{ type: 'flow', nodes: [{ id: 'a', t: 'A', bind: { source: { provider: 'usage.daily' }, metric: { agg: 'sum', field: 'model' } } }] }] }).dashboard).some((w) => w.includes('not a number')))
  ok('catalogue: the flow documents bind', M.describeCatalogue().widgets.includes('bind:{source'))
}
{
  // a blank cell is a node called (none), not an empty label
  const t = { columns: [], rows: [{ a: 'x', b: '' }, { a: 'y', b: 'z' }], meta: {} }
  const s = M.sankeyData(t, { stages: ['a', 'b'], where: [] })
  ok('sankey: an empty cell is named', s.cols[1].some((n) => n.name === '(none)') && s.cols.every((c) => c.every((n) => n.name !== '')), s.cols)
}

console.log(fail === 0 ? 'model: ok (' + passed + ' checks)' : fail + ' failed of ' + (passed + fail))
process.exit(fail ? 1 : 0)
