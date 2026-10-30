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
  ok(id + ': every row only uses declared columns' + (p.open === true ? ' (an open source may add the item\'s own fields)' : ''), p.open === true || t.rows.every((r) => Object.keys(r).every((k) => ids.includes(k))), t.rows[0])
  ok(id + ': every declared column is present on each row', t.rows.every((r) => ids.every((k) => k in r)), t.rows[0])
  ok(id + ': numeric columns hold finite numbers' + (p.sparse === true ? ' (or nothing: \'\')' : ''), t.rows.every((r) => p.columns.filter((c) => c.type === 'number').every((c) => (typeof r[c.id] === 'number' && Number.isFinite(r[c.id])) || (p.sparse === true && r[c.id] === ''))), t.rows[0])
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

// ── usage.models, usage.totals, top, per, table, heatmap ───────────────────────
{
  const mt = M.buildTable({ provider: 'usage.models', params: { days: 14 } }, PARTS['usage.models'], NOW)
  const all = mt.rows.reduce((a, r) => a + r.tokens, 0)
  ok('usage.models: one row per model, biggest first, shares add up to 100', mt.rows.length === 3 && mt.rows[0].tokens >= mt.rows[1].tokens && Math.abs(mt.rows.reduce((a, r) => a + r.share, 0) - 100) < 0.5 && mt.rows[0].provider === 'anthropic', mt.rows.map((r) => [r.model, r.share]))
  ok('usage.models: input + output + cache = tokens on every row', mt.rows.every((r) => r.tokens === r.input + r.output + r.cache_read + r.cache_write) && all > 0)
  ok('usage.models: no models, no rows', M.buildTable({ provider: 'usage.models' }, { summary: { daily: [], models: {} } }, NOW).rows.length === 0)
  const tt = M.buildTable({ provider: 'usage.totals', params: { days: 14 } }, PARTS['usage.totals'], NOW)
  ok('usage.totals: one row, the count of sessions is the ledger\'s, not the 40 listed', tt.rows.length === 1 && tt.rows[0].sessions === 121 && tt.rows[0].models === 3 && tt.rows[0].tokens === all, tt.rows[0])
  ok('usage.totals: active days are the days with tokens', tt.rows[0].active_days > 0 && tt.rows[0].active_days <= 14, tt.rows[0].active_days)
  ok('usage.totals: an older host (no sessionCount) falls back to the list', M.buildTable({ provider: 'usage.totals' }, { summary: { daily: [], models: {}, sessions: [{}, {}] } }, NOW).rows[0].sessions === 2)
  ok('usage.totals: an unreadable answer is an empty table', M.buildTable({ provider: 'usage.totals' }, {}, NOW).rows.length === 0)

  const top = M.validateDashboard({ widgets: [{ type: 'card', title: 'Fav', source: { provider: 'usage.models', params: { days: 14 } }, metric: { agg: 'top', field: 'model', by: 'tokens' }, sub: { template: '{v}% of all tokens', metric: { agg: 'max', field: 'share' } } }] }).dashboard.widgets[0]
  const cd = M.cardData(mt, top)
  ok('card top: names the model that weighs most', cd.label === mt.rows[0].model && cd.text === mt.rows[0].model, [cd.label, cd.text])
  ok('card top: the sub line keeps its number', cd.sub === Math.round(mt.rows[0].share * 10) / 10 + '% of all tokens' || cd.sub === mt.rows[0].share + '% of all tokens', cd.sub)
  ok('card top: without by it is the most frequent value', M.cardData(M.buildTable({ provider: 'usage.daily', params: { days: 14 } }, PARTS['usage.daily'], NOW), M.validateDashboard({ widgets: [{ type: 'card', source: { provider: 'usage.daily' }, metric: { agg: 'top', field: 'model' } }] }).dashboard.widgets[0]).label !== '')
  ok('card top: inspect asks for a field', M.inspectDashboard(M.validateDashboard({ widgets: [{ type: 'card', title: 'x', source: { provider: 'usage.daily' }, metric: { agg: 'top' } }] }).dashboard).some((w) => w.includes('top') && w.includes('metric.field')))
  const per = M.validateDashboard({ widgets: [{ type: 'card', title: 'x', source: { provider: 'usage.totals' }, metric: { agg: 'sum', field: 'tokens' }, per: 22000 }, { type: 'card', title: 'y', source: { provider: 'usage.totals' }, metric: { agg: 'sum', field: 'tokens' }, per: -4 }] }).dashboard.widgets
  const tot = tt.rows[0].tokens
  ok('card per: the number is divided, a bad divisor is ignored', Math.abs(M.cardData(tt, per[0]).value - tot / 22000) < 1e-9 && per[1].per === undefined && M.cardData(tt, per[1]).value === tot)

  const tb = M.validateDashboard({ widgets: [{ type: 'table', title: 'Models', source: { provider: 'usage.models', params: { days: 14 } }, columns: [{ field: 'model', label: 'Model' }, { field: 'output', label: 'Out', format: 'compact', bar: true }, { field: 'share', format: 'percent' }, { field: '' }], sort: '-tokens', limit: 2, swatch: true }] })
  const tw = tb.dashboard.widgets[0]
  ok('table: columns are cleaned, an empty field dropped, defaults filled', tw.type === 'table' && tw.columns.length === 3 && tw.columns[1].bar === true && tw.columns[2].format === 'percent' && tw.columns[0].format === 'compact' && tw.swatch === true && tw.limit === 2, tw)
  const td = M.tableData(mt, tw)
  ok('table: sorted, cut, with the label of a column from the source when none is given', td.rows.length === 2 && td.total === 3 && td.columns[2].label === 'Share of all tokens (%)' && td.rows[0][0].v === mt.rows[0].model && td.columns[1].max === Math.max(...mt.rows.slice(0, 2).map((r) => r.output)), td.columns)
  ok('table: a table with no column is refused', M.validateDashboard({ widgets: [{ type: 'table', title: 'x', source: { provider: 'usage.models' }, columns: [] }] }).dashboard.widgets.length === 0)
  ok('table: inspect names a field that is not a column', M.inspectDashboard(M.validateDashboard({ widgets: [{ type: 'table', title: 'x', source: { provider: 'usage.models' }, columns: [{ field: 'nope' }] }] }).dashboard).some((w) => w.includes('"nope"')))

  const hmw = M.validateDashboard({ widgets: [{ type: 'chart', title: 'Days', kind: 'heatmap', x: 'day', y: 'tokens', agg: 'sum', source: { provider: 'usage.daily', params: { days: 14 } } }] }).dashboard
  ok('heatmap: a chart kind, no warning on a date column', hmw.widgets[0].kind === 'heatmap' && M.inspectDashboard(hmw).length === 0, M.inspectDashboard(hmw))
  ok('heatmap: inspect says a text column is not a date', M.inspectDashboard(M.validateDashboard({ widgets: [{ type: 'chart', title: 'x', kind: 'heatmap', x: 'model', y: 'tokens', source: { provider: 'usage.daily' } }] }).dashboard).some((w) => w.includes('date column')))
  const dd = M.chartData(M.buildTable({ provider: 'usage.daily', params: { days: 14 } }, PARTS['usage.daily'], NOW), hmw.widgets[0])
  ok('heatmap: one total per day of the period, zeros kept', dd.labels.length === 14 && dd.totals.length === 14 && dd.totals.some((v) => v === 0) && dd.totals.some((v) => v > 0))
  ok('shapeOf: a chart tells its kind, a card its sparkline, nothing else is added', JSON.stringify(M.shapeOf({ w: 4, h: 2, type: 'chart', kind: 'heatmap' })) === '{"w":4,"h":2,"type":"chart","kind":"heatmap"}' && M.shapeOf({ w: 3, h: 2, type: 'card', spark: { x: 'day' } }).spark === true && M.shapeOf({ w: 3, h: 2, type: 'list' }).kind === undefined)
}

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

// ── the Business providers: Catalog, Contacts and Pipeline, read page by page ─────────────────────────────────────────────
{
  const cat = (parts, params) => M.buildTable({ provider: 'catalog.items', params: params || {} }, parts, NOW)
  const P = PARTS['catalog.items']
  const day = (n) => M.dayKey(NOW + n * 86400000)
  const t = cat(P)
  const row = (title) => t.rows.find((r) => r.title === title)
  ok('catalog.items: type and status are the words of the type, their keys beside', row('Stoneware mug, set of 2').type === 'Product' && row('Stoneware mug, set of 2').status === 'Live' && row('Stoneware mug, set of 2').status_key === 'live' && row('Beeswax taper candles').status === 'Out of stock')
  ok('catalog.items: a price is a number, the text as written beside it', row('Linen napkins, 4-pack').price === 34 && row('Linen napkins, 4-pack').price_text === '€34')
  ok('catalog.items: the item\'s own fields are columns, a picture reference is not', row('Stoneware mug, set of 2').supplier === 'Okafor Ceramics' && row('Stoneware mug, set of 2').stock === 42 && !('image' in row('Stoneware mug, set of 2')))
  ok('catalog.items: stock above the reorder level, only for an item that carries both', row('Linen napkins, 4-pack').stock_gap === -4 && row('Beeswax taper candles').stock_gap === -12 && row('Wool throw').stock_gap === '')
  ok('catalog.items: a field an item does not have is empty, not undefined', row('Wool throw').stock === '' && row('Wool throw').supplier === '' && row('Wool throw').surface === '')
  ok('catalog.items: sample rows say so, and the days are local days', row('Wool throw').demo === 'yes' && row('Wool throw').created === day(-9) && row('Wool throw').updated === day(-2))
  ok('catalog.items: a type the page does not know keeps its key as its word', cat({ page0: { rows: [{ id: 1, type: 'gadget', title: 'G', status: 'new', fields: {} }], total: 1 } }).rows[0].type === 'gadget')
  const dated = cat({ page0: { rows: [{ id: 1, type: 'p', title: 'House', status: 's', fields: { mandate_until: day(40), opened: day(-36), image: 'photo:x/y', note: 'free text', big: 2, flag: true, nested: { a: 1 }, 'Bad Key': 3 } }, { id: 2, type: 'p', title: 'Gone', status: 's', archived_at: '2026-01-01T00:00:00.000Z', fields: {} }], total: 2 } }).rows
  ok('catalog.items: a day field gives days until it and days since it', dated.length === 1 && dated[0].mandate_until === day(40) && dated[0].mandate_until_in === 40 && dated[0].mandate_until_ago === -40 && dated[0].opened_in === -36 && dated[0].opened_ago === 36, dated[0])
  ok('catalog.items: flat text, numbers and flags are kept; objects and odd keys are not; an archived row is never one of them', dated[0].note === 'free text' && dated[0].big === 2 && dated[0].flag === 'yes' && !('nested' in dated[0]) && !('Bad Key' in dated[0]) && !('image' in dated[0]))
  ok('catalog.items: an item field never overwrites a column of the row', cat({ page0: { rows: [{ id: 1, type: 'p', title: 'Real title', status: 's', price_num: 5, fields: { title: 'Fake', price: 99 } }], total: 1 } }).rows[0].title === 'Real title')
  ok('catalog.items: a price falls back to the item\'s money field', cat({ page0: { rows: [{ id: 1, type: 'p', title: 'A', status: 's', price_num: null, fields: { price: 12 } }], total: 1 } }).rows[0].price === 12)
  // pages: the first page says how many there are, the second round asks for the others (at most four pages, 2,000 rows)
  const plan = M.planFor({ provider: 'catalog.items', params: {} }, NOW)
  ok('catalog.items: the first round is the types (optional) and the first page of 500', plan.length === 2 && plan[0].path === '/kybernos-catalog/types' && plan[0].optional === true && plan[1].path === '/kybernos-catalog/list?limit=500&offset=0' && plan[1].optional !== true, plan)
  ok('catalog.items: nothing more to ask when the first page holds everything', M.planNext({ provider: 'catalog.items', params: {} }, { page0: { total: 500, rows: [] } }, NOW).length === 0)
  ok('catalog.items: the pages after the first, as many as the total needs', same(M.planNext({ provider: 'catalog.items', params: {} }, { page0: { total: 1200 } }, NOW).map((r) => r.path), ['/kybernos-catalog/list?limit=500&offset=500', '/kybernos-catalog/list?limit=500&offset=1000']))
  ok('catalog.items: at most four pages, and a page that fails is optional', (() => { const n = M.planNext({ provider: 'catalog.items', params: {} }, { page0: { total: 90000 } }, NOW); return n.length === 3 && n.every((r) => r.optional === true) })())
  const big = (n, off) => ({ rows: Array.from({ length: n }, (x, i) => ({ id: off + i, type: 'p', title: 'Item ' + (off + i), status: 's', fields: {} })), total: 1800 })
  const paged = cat({ page0: big(500, 0), page1: big(500, 500), page2: big(500, 1000), page3: big(300, 1500) })
  ok('catalog.items: every page read is in the table, in order', paged.rows.length === 1800 && paged.rows[1799].title === 'Item 1799' && paged.meta.note === '')
  ok('catalog.items: a table that stops short says so', cat({ page0: big(500, 0), page1: big(500, 500) }).meta.note === 'The first 1,000 of 1,800 rows are read.')
  ok('catalog.items: the type filter is a key or nothing', M.planFor({ provider: 'catalog.items', params: { type: 'product' } }, NOW)[1].path.endsWith('&type=product') && !M.planFor({ provider: 'catalog.items', params: { type: 'x&y=1' } }, NOW)[1].path.includes('type') && M.planNext({ provider: 'catalog.items', params: { type: 'product' } }, { page0: { total: 900 } }, NOW)[0].path.endsWith('&type=product'))

  const people = M.buildTable({ provider: 'contacts.people', params: {} }, PARTS['contacts.people'], NOW)
  const who = (n) => people.rows.find((r) => r.name === n)
  ok('contacts.people: the type is the theme\'s word, the key beside it', who('Amelia Hart').type === 'Customer' && who('Amelia Hart').type_key === 'customer' && who('Okafor Ceramics').type === 'Supplier')
  ok('contacts.people: tags are a line and a count, nobody without tags has none', who('Amelia Hart').tags === 'vip, repeat' && who('Amelia Hart').tag_count === 2 && who('Noah Bernard').tags === '' && who('Noah Bernard').tag_count === 0)
  ok('contacts.people: fields are columns, a day also says how long ago', who('Amelia Hart').city === 'Lyon' && who('Amelia Hart').spent === 1240 && who('Amelia Hart').last_order === day(-3) && who('Amelia Hart').last_order_ago === 3 && who('Noah Bernard').spent === '')
  ok('contacts.people: the company a person works for is named', M.buildTable({ provider: 'contacts.people', params: {} }, { page0: { rows: [{ id: 1, kind: 'person', type: 't', name: 'Ann', company: { id: 9, name: 'Acme' }, tags: [], fields: {} }], total: 1 } }, NOW).rows[0].company === 'Acme')
  ok('contacts.people: the first round is the schema (optional) and the first page', (() => { const pl = M.planFor({ provider: 'contacts.people', params: {} }, NOW); return pl.length === 2 && pl[0].path === '/kybernos-contacts/schema' && pl[0].optional === true && pl[1].path === '/kybernos-contacts/list?limit=500&offset=0' })())

  const cards = (parts, params) => M.buildTable({ provider: 'pipeline.cards', params: params || {} }, parts, NOW)
  const all = PARTS['pipeline.cards']
  ok('pipeline.cards: without a board, the boards come first', same(M.planFor({ provider: 'pipeline.cards', params: {} }, NOW), [{ key: 'flows', method: 'GET', path: '/kybernos-pipeline/flows' }]))
  ok('pipeline.cards: then one request per board that has cards', same(M.planNext({ provider: 'pipeline.cards', params: {} }, { flows: { flows: [{ id: 'orders', cards: 4 }, { id: 'empty', cards: 0 }, { id: 'bad id', cards: 3 }, { id: 'sales', cards: 2 }] } }, NOW).map((r) => r.path), ['/kybernos-pipeline/board?flow=orders', '/kybernos-pipeline/board?flow=sales']))
  ok('pipeline.cards: at most six boards', M.planNext({ provider: 'pipeline.cards', params: {} }, { flows: { flows: Array.from({ length: 9 }, (x, i) => ({ id: 'b' + i, cards: 1 })) } }, NOW).length === 6)
  ok('pipeline.cards: a named board is one request, and nothing more', same(M.planFor({ provider: 'pipeline.cards', params: { flow: 'orders' } }, NOW).map((r) => r.path), ['/kybernos-pipeline/board?flow=orders']) && M.planNext({ provider: 'pipeline.cards', params: { flow: 'orders' } }, { 'board:orders': {} }, NOW).length === 0)
  ok('pipeline.cards: a board name is a key or nothing (it is read as all of them)', M.planFor({ provider: 'pipeline.cards', params: { flow: '../x' } }, NOW)[0].path === '/kybernos-pipeline/flows')
  const one = cards({ 'board:orders': all['board:orders'] }, { flow: 'orders' })
  const c = (title) => one.rows.find((r) => r.title === title)
  ok('pipeline.cards: stage is the board\'s word, its key and its place beside it', c('#1053 · Amelia Hart').stage === 'New' && c('#1053 · Amelia Hart').stage_key === 'new' && c('#1053 · Amelia Hart').stage_no === 1 && c('#1050 · Mateo Silva').stage_no === 5 && c('#1050 · Mateo Silva').flow === 'Orders' && c('#1050 · Mateo Silva').flow_key === 'orders')
  ok('pipeline.cards: value, source, priority, tags, the person and the item are columns', c('#1053 · Amelia Hart').value === 89 && c('#1053 · Amelia Hart').source === 'Website' && c('#1053 · Amelia Hart').priority === 'high' && c('#1053 · Amelia Hart').tags === 'vip' && c('#1053 · Amelia Hart').contact === 'Amelia Hart' && c('#1053 · Amelia Hart').item === 'Wool throw')
  ok('pipeline.cards: a due day also says in how many days (negative once late); none is empty', c('#1053 · Amelia Hart').due === day(2) && c('#1053 · Amelia Hart').due_in === 2 && c('#1051 · Yusuf Demir').due_in === -1 && c('#1050 · Mateo Silva').due === '' && c('#1050 · Mateo Silva').due_in === '')
  ok('pipeline.cards: days in the stage count from the day it entered', c('#1053 · Amelia Hart').since === day(-1) && c('#1053 · Amelia Hart').days_in_stage === 1 && c('#1050 · Mateo Silva').days_in_stage === 4)
  ok('pipeline.cards: one board keeps the board\'s order for a chart of its stages, all of them read together do not', same(one.meta.xDomain, { field: 'stage', values: ['New', 'Paid', 'Packed', 'Shipped', 'Delivered'] }) && cards(all).meta.xDomain === null)
  ok('pipeline.cards: a stage with no card is still on the axis of a chart', M.chartData(one, M.validateDashboard({ widgets: [{ type: 'chart', title: 't', kind: 'columns', x: 'stage', source: { provider: 'pipeline.cards', params: { flow: 'orders' } } }] }).dashboard.widgets[0]).labels.map((l) => l.label).join() === 'New,Paid,Packed,Shipped,Delivered')
  ok('pipeline.cards: a card with no value or no stage date has empty cells', (() => { const r = cards({ 'board:x': { flow: { id: 'x', label: { en: 'X' } }, columns: [{ stage: 'a', label: { en: 'A' }, cards: [{ title: 'T', value: null, since: 'nonsense', fields: {} }] }] } }).rows[0]; return r.value === '' && r.since === '' && r.days_in_stage === '' })())
  ok('pipeline.cards: a board cut short says so', cards({ 'board:x': { truncated: true, columns: [] } }).meta.note.includes('2,000'))
  // an open source takes a plausible field key; a closed one does not
  const warn = (raw) => M.inspectDashboard(M.validateDashboard({ widgets: [raw] }).dashboard)
  ok('inspect: an open source (Catalog, Contacts) accepts the item\'s own field', warn({ type: 'chart', title: 'a', kind: 'bars', x: 'bedrooms', source: { provider: 'catalog.items' } }).length === 0 && warn({ type: 'chart', title: 'a', kind: 'bars', x: 'Bed Rooms', source: { provider: 'catalog.items' } }).length === 1)
  ok('inspect: a closed one (Pipeline) names what it does not have', warn({ type: 'chart', title: 'a', kind: 'bars', x: 'bedrooms', source: { provider: 'pipeline.cards' } }).length === 1)
  ok('inspect: a text column is no number, a declared one is checked even on an open source', warn({ type: 'card', title: 'a', metric: { agg: 'sum', field: 'status' }, source: { provider: 'catalog.items' } }).length === 1)
  ok('the catalogue text tells an agent a column can be empty and which fields come on top', (() => { const d = M.describeCatalogue().providers; return d.includes('catalog.items') && d.includes('The fields of the item\'s own type are columns too') && d.includes('add not_empty to where') })())
  ok('a provider with nothing more to ask, and junk, plan no second round', M.planNext({ provider: 'usage.daily', params: {} }, {}, NOW).length === 0 && M.planNext({ provider: 'nope' }, {}, NOW).length === 0 && M.planNext({ provider: 'pipeline.cards', params: {} }, { flows: 7 }, NOW).length === 0 && M.planNext(null, null, NOW).length === 0)
  ok('a second round is bounded', M.LIMITS.followUp >= 6 && M.LIMITS.followUp <= 24)
}

// ── db.rows: the rows of one table of a Tables database ──────────────────────────────────────────────────────────────────────────────────────
{
  const P = PARTS['db.rows']
  const src = (params) => ({ provider: 'db.rows', params: params || {} })
  const rows = (params, parts) => M.buildTable(src(params), parts || P, NOW)
  const deal = (t, title) => t.rows.find((r) => r.title === title)
  ok('db.rows: the first round is the state, nothing else', same(M.planFor(src({}), NOW), [{ key: 'state', method: 'GET', path: '/kybernos-db/state' }]))
  ok('db.rows: the second round is the rows of the table and of the table its relation points to (optional)', same(M.planNext(src({ db: 'real-estate', object: 'deal' }), { state: P.state }, NOW), [
    { key: 'rows', method: 'GET', path: '/kybernos-db/records?db=DB1&object=deal' }, { key: 'to:contact', method: 'GET', path: '/kybernos-db/records?db=DB1&object=contact', optional: true }]))
  ok('db.rows: a database is its id or the id of its template; none named is the first; the table defaults to the first', M.planNext(src({ db: 'DB1' }), { state: P.state }, NOW)[0].path.endsWith('db=DB1&object=deal') && M.planNext(src({}), { state: P.state }, NOW)[0].path.endsWith('db=DB1&object=deal'))
  ok('db.rows: no such database or table, nothing more to ask', M.planNext(src({ db: 'nope' }), { state: P.state }, NOW).length === 0 && M.planNext(src({ object: 'ghost' }), { state: P.state }, NOW).length === 0 && M.planNext(src({}), {}, NOW).length === 0)
  ok('db.rows: a table key is encoded, never joined as it comes', (() => { const st = JSON.parse(JSON.stringify(P.state)); st.dbs[0].objects[0].key = 'a&b'; return M.planNext(src({ object: 'a&b' }), { state: st }, NOW)[0].path.includes('object=a%26b') })())
  const t = rows({ db: 'real-estate', object: 'deal' })
  ok('db.rows: one row per live record (a deleted one is left out), with its title and its days', t.rows.length === 3 && deal(t, 'Loft viewing').created === M.dayKey(NOW - 9 * 86400000) && deal(t, 'Loft viewing').updated === M.dayKey(NOW - 9 * 86400000))
  ok('db.rows: a choice gives its label and its key, a checkbox yes or no, a number a number', deal(t, 'Loft viewing').stage === 'Lead' && deal(t, 'Loft viewing').stage_key === 'lead' && deal(t, 'Loft viewing').done === 'no' && deal(t, 'Offer on Elm St').done === 'yes' && deal(t, 'Loft viewing').value === 1200)
  ok('db.rows: a multi-choice gives its labels and its keys', deal(t, 'Offer on Elm St').tags === 'VIP, Repeat buyer' && deal(t, 'Offer on Elm St').tags_key === 'vip, repeat')
  ok('db.rows: a relation is the title of the row it links to, nothing when there is none or the table could not be read', deal(t, 'Loft viewing').contact === 'Noor Hadid' && deal(t, 'Closed sale').contact === '' && deal(rows({ object: 'deal' }, { state: P.state, rows: P.rows }), 'Loft viewing').contact === '')
  ok('db.rows: a date gives the days until it and since it', deal(t, 'Loft viewing').due_in === 2 && deal(t, 'Loft viewing').due_ago === -2 && deal(t, 'Offer on Elm St').due_in === -3)
  ok('db.rows: a field kept back (secret) and files are no column', !t.columns.some((c) => c.id === 'iban' || c.id === 'file') && t.rows.every((r) => !('iban' in r) && !('file' in r)))
  ok('db.rows: every column is on every row, an empty one is \'\'', t.rows.every((r) => t.columns.every((c) => c.id in r)) && deal(t, 'Closed sale').due === '' && deal(t, 'Closed sale').stock === '')
  ok('db.rows: the columns are typed from the fields (money and number are numbers, a date is a date)', ['value', 'stock', 'due_in'].every((k) => t.columns.find((c) => c.id === k).type === 'number') && t.columns.find((c) => c.id === 'due').type === 'date' && t.columns.find((c) => c.id === 'stage').type === 'string')
  ok('db.rows: order puts the options of a choice on the axis, empty ones too', same(rows({ object: 'deal', order: 'stage' }).meta.xDomain, { field: 'stage', values: ['Lead', 'Offer', 'Won'] }) && rows({ object: 'deal', order: 'title' }).meta.xDomain === null && t.meta.xDomain === null)
  ok('db.rows: diff adds a minus b where both are numbers, and only then', (() => { const d = rows({ object: 'deal', diff: 'stock,reorder' }); return d.columns.some((c) => c.id === 'stock_minus_reorder') && deal(d, 'Loft viewing').stock_minus_reorder === -7 && deal(d, 'Closed sale').stock_minus_reorder === '' && rows({ object: 'deal', diff: 'stock,title' }).columns.every((c) => !c.id.includes('_minus_')) })())
  ok('db.rows: a day text that is no date gives no days', (() => { const st = JSON.parse(JSON.stringify(P.rows)); st.records[0].values.due = 'soon'; return deal(rows({ object: 'deal' }, { state: P.state, rows: st }), 'Loft viewing').due_in === '' })())
  ok('db.rows: a table of 5,000 rows says so', rows({ object: 'deal' }, { state: P.state, rows: Object.assign({}, P.rows, { truncated: true }) }).meta.note.includes('first'))
  ok('db.rows: no database, no table: an empty table that says which', rows({}, {}).meta.note === 'No database found.' && rows({ object: 'ghost' }, { state: P.state }).meta.note === 'No such table in this database.')
  ok('db.rows: the shipped dashboards can chart it (a count by stage, the sum of a value)', (() => {
    const d = M.validateDashboard({ widgets: [{ type: 'chart', title: 't', kind: 'columns', x: 'stage', y: 'value', agg: 'sum', source: src({ object: 'deal', order: 'stage' }) }] }).dashboard
    const cd = M.chartData(t, d.widgets[0])
    return cd.labels.length === 3 && M.inspectDashboard(d).length === 0
  })())
  ok('inspect: db.rows is open (a field of the table is no error), a declared column is still checked', M.inspectDashboard(M.validateDashboard({ widgets: [{ type: 'chart', title: 'a', kind: 'bars', x: 'stage_key', source: src({ object: 'deal' }) }] }).dashboard).length === 0 && M.inspectDashboard(M.validateDashboard({ widgets: [{ type: 'card', title: 'a', metric: { agg: 'sum', field: 'title' }, source: src({ object: 'deal' }) }] }).dashboard).length === 1)
  ok('the catalogue text names db.rows with its params', (() => { const d = M.describeCatalogue().providers; return d.includes('db.rows') && d.includes('order (') && d.includes('diff (') })())
}

console.log(fail === 0 ? 'model: ok (' + passed + ' checks)' : fail + ' failed of ' + (passed + fail))
process.exit(fail ? 1 : 0)
