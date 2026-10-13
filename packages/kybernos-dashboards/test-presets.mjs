// kybernos-dashboards: the shipped presets are valid, warning-free, and draw something from realistic data.
// `cd packages/kybernos-dashboards && node test-presets.mjs`
import { PRESETS } from './presets.mjs'
import * as M from './model.mjs'
import { PARTS, NOW } from './lib-fixtures.mjs'

const PRESET_IDS = PRESETS.map((p) => p.id)

let fail = 0
let passed = 0
const ok = (name, cond, detail) => {
  if (cond) { passed++; return }
  fail++
  console.log('FAIL ' + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)))
}

ok('there are presets, with unique ids', PRESETS.length >= 7 && new Set(PRESET_IDS).size === PRESETS.length && PRESET_IDS.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)))

for (const p of PRESETS) {
  const v = M.validateDashboard({ name: p.name, desc: p.desc, widgets: p.widgets })
  ok(p.id + ': every widget is accepted as written', v.errors.length === 0 && v.dashboard.widgets.length === p.widgets.length, v.errors)
  ok(p.id + ': no warning', M.inspectDashboard(v.dashboard).length === 0, M.inspectDashboard(v.dashboard))
  ok(p.id + ': a name and a one-line description', p.name.length > 0 && p.name.length <= 40 && p.desc.length > 10 && p.desc.length <= M.LIMITS.desc)
  ok(p.id + ': room on the page, 6 to 12 widgets', v.dashboard.widgets.length >= 6 && v.dashboard.widgets.length <= 12, v.dashboard.widgets.length)
  ok(p.id + ': titles are filled and unique', v.dashboard.widgets.filter((w) => w.type !== 'note').every((w) => w.title !== '') && new Set(v.dashboard.widgets.map((w) => w.title)).size === v.dashboard.widgets.length)
  // numbers first, as the builder skill says: the first widgets of a preset are cards
  ok(p.id + ': leads with the numbers', ['card'].includes(v.dashboard.widgets[0].type))
  // only local sources: a preset must work on a machine with no account and no connected app
  const local = new Set(M.PROVIDER_IDS)
  ok(p.id + ': only sources of this catalogue', v.dashboard.widgets.every((w) => w.source === undefined || local.has(w.source.provider)))

  // draw every widget with the fixtures: nothing throws, and the preset is not an empty page
  let drawn = 0
  for (const w of v.dashboard.widgets) {
    if (w.type === 'flow') {
      // a flow with bound nodes: every number is read from its own source, and none is left as written
      const bound = w.nodes.filter((n) => n.bind)
      const live = bound.map((n) => M.liveNode(n, M.buildTable(n.bind.source, PARTS[n.bind.source.provider], NOW)))
      ok(p.id + ': ' + w.id + ' has a number on most nodes', bound.length >= Math.ceil(w.nodes.length / 2), [bound.length, w.nodes.length])
      ok(p.id + ': ' + w.id + ' draws a live number on every bound node', live.every((n) => /\d/.test(n.sub)), live.map((n) => n.sub))
      drawn += 1
      continue
    }
    if (w.source === undefined) { drawn += 1; continue }
    const t = M.buildTable(w.source, PARTS[w.source.provider], NOW)
    let out
    try {
      switch (w.type) {
        case 'card': out = M.cardData(t, w); drawn += out.empty ? 0 : 1; break
        case 'chart': out = M.chartData(t, w); drawn += out.empty ? 0 : 1; break
        case 'list': out = M.listData(t, w); drawn += out.length > 0 ? 1 : 0; break
        case 'kanban': out = M.kanbanData(t, w); drawn += out.some((c) => c.total > 0) ? 1 : 0; break
        case 'calendar': out = M.calendarData(t, w, NOW); drawn += out.some((d) => d.events.length > 0) ? 1 : 0; break
        case 'carousel': out = M.carouselData(t, w); drawn += out.length > 0 ? 1 : 0; break
        case 'sankey': out = M.sankeyData(t, w); drawn += out.empty ? 0 : 1; break
        default: drawn += 1
      }
    } catch (e) { ok(p.id + ': ' + w.id + ' draws without throwing', false, String(e && e.message)) }
  }
  ok(p.id + ': every widget has something to show with realistic data', drawn === v.dashboard.widgets.length, { drawn, of: v.dashboard.widgets.length })
}

{
  const types = new Set()
  for (const p of PRESETS) for (const w of M.validateDashboard({ widgets: p.widgets }).dashboard.widgets) types.add(w.type)
  ok('the presets together show every kind of widget', M.WIDGET_TYPES.every((x) => types.has(x)), M.WIDGET_TYPES.filter((x) => !types.has(x)))
  ok('a flow preset and a sankey preset exist', PRESETS.some((p) => p.widgets.some((w) => w.type === 'flow')) && PRESETS.some((p) => p.widgets.some((w) => w.type === 'sankey')))
}
console.log(fail === 0 ? 'presets: ok (' + passed + ' checks)' : fail + ' failed of ' + (passed + fail))
process.exit(fail ? 1 : 0)
