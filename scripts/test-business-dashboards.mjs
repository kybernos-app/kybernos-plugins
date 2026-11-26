// The dashboards the three shipped templates bring (kybernos/dashboards#preset), against the REAL data path: each template is installed in a temp profile read by the real
// registry, its database is made with its sample rows in a real Tables service, and the routes of Tables answer with their real logic. Every widget of every
// dashboard is then drawn by the model and must show something, and every number on a card is checked against a direct count of the sample file: a dashboard shows
// what the data holds, not what looked good in a mockup.
//
// Hermetic: temp folders only (a database file, a profile), nothing started, nothing fetched.
//
//   node scripts/test-business-dashboards.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as M from '../packages/kybernos-dashboards/model.mjs'
import { createHost } from '../packages/kybernos-dashboards/dashboard-host.mjs'
import { POINT_REF, validateDashboardPreset } from '../packages/kybernos-dashboards/preset-point.mjs'
import { templatePresets } from '../packages/kybernos-dashboards/template-presets.mjs'
import { openWorld, readTable } from './lib-template-world.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(REPO, 'packages', 'kybernos-plugin', 'themes')
const DAY = 86400000
// the sample rows carry absolute dates (late 2026): the numbers that depend on today are checked at a fixed today
const NOW = new Date(2026, 9, 30, 10, 0, 0).getTime()
const TODAY = Date.UTC(2026, 9, 30) / DAY
const daysUntil = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY) - TODAY }
const sum = (xs) => xs.reduce((a, b) => a + b, 0)
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const okAsync = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'))
const dirs = ['real-estate', 'ecommerce', 'recruitment']

/** Draws one widget from the table its source gives, as the page does: what it shows, or `null` when it has nothing to show. */
function draw (w, table) {
  switch (w.type) {
    case 'card': { const c = M.cardData(table, w); return c.empty ? null : c }
    case 'chart': { const c = M.chartData(table, w); return c.empty ? null : c }
    case 'list': { const c = M.listData(table, w); return c.length === 0 ? null : c }
    case 'table': { const c = M.tableData(table, w); return c.rows.length === 0 ? null : c }
    case 'kanban': { const c = M.kanbanData(table, w); return c.some((x) => x.total > 0) ? c : null }
    case 'calendar': { const c = M.calendarData(table, w, NOW); return c.some((d) => d.events.length > 0) ? c : null }
    case 'carousel': { const c = M.carouselData(table, w); return c.length === 0 ? null : c }
    case 'sankey': { const c = M.sankeyData(table, w); return c.empty ? null : c }
    default: return null
  }
}

for (const dir of dirs) {
  const themeDir = join(ROOT, dir)
  const file = join(themeDir, 'dashboards', 'overview.json')
  const manifest = readJson(join(themeDir, 'plugin.json'))
  const sample = readJson(join(themeDir, 'demo', 'db-sample.json'))
  const rowsOf = (object) => sample.rows[object].map((r) => r.values)
  const raw = readJson(file)
  const world = openWorld({ themeDir, now: NOW })

  ok(dir + ': the template names the point (optionally), and ships one valid overview with its own word for the row', () => {
    assert.ok(manifest.extends.some((e) => e.point === POINT_REF && e.dir === 'dashboards' && e.range === '^1.0' && e.optional === true))
    assert.equal(manifest.requires.plugins['kybernos/dashboards'], undefined, 'optional: the template works without the Dashboards plugin')
    const checked = validateDashboardPreset(raw, 'overview')
    assert.equal(checked.ok, true, JSON.stringify(checked.errors))
    assert.equal(checked.value.overview, true)
    assert.deepEqual(Object.keys(checked.value.menu).sort(), ['en', 'fr'])
    assert.ok(checked.value.widgets.length >= 8 && checked.value.widgets.length <= 12, 'room on the page, not a wall: ' + checked.value.widgets.length)
    assert.equal(checked.value.widgets[0].type, 'card', 'numbers first')
    assert.deepEqual(checked.value.widgets.slice(0, 4).map((w) => w.type), ['card', 'card', 'card', 'card'], 'four numbers on the first row')
    assert.equal(new Set(checked.value.widgets.map((w) => w.title)).size, checked.value.widgets.length, 'titles are unique')
    for (const w of checked.value.widgets) assert.ok(['card', 'chart', 'list', 'table', 'kanban', 'calendar'].includes(w.type), w.title + ': a kind of widget the plugin already had')
    assert.equal(sum(checked.value.widgets.map((w) => w.w * w.h)) > 0, true)
  })

  ok(dir + ': the real registry takes the template once the dashboards tell their point, and hands back the overview', () => {
    const plugin = world.plugin()
    assert.equal(plugin.status, 'ok', plugin.reason)
    const ext = plugin.extends.find((e) => e.point === POINT_REF)
    assert.deepEqual([ext.contributions, ext.rejected], [1, []])
    const presets = templatePresets(world.registry)
    assert.equal(presets.length, 1)
    assert.equal(presets[0].id, dir + '-overview')
    assert.equal(presets[0].template.id, manifest.id)
    assert.equal(presets[0].template.name, manifest.name.en, 'the gallery names the template')
  })

  const dash = M.validateDashboard({ name: raw.name, widgets: raw.widgets }).dashboard
  const tables = new Map()
  const tableOf = (w) => { const key = JSON.stringify(w.source); if (!tables.has(key)) tables.set(key, readTable(M, world, w.source, NOW)); return tables.get(key) }
  const byTitle = (title) => { const w = dash.widgets.find((x) => x.title === title); assert.ok(w !== undefined, 'no widget "' + title + '"'); return w }
  const card = (title) => draw(byTitle(title), tableOf(byTitle(title)))
  const chart = (title) => draw(byTitle(title), tableOf(byTitle(title)))

  ok(dir + ': every widget shows something on the sample rows (nothing is an empty frame)', () => {
    for (const w of dash.widgets) {
      const t = tableOf(w)
      assert.ok(t.rows.length > 0, w.title + ': its source gave no row (' + t.asked.join(', ') + ')')
      assert.ok(draw(w, t) !== null, w.title + ' draws nothing')
    }
  })

  ok(dir + ': the sources are read in at most two rounds and never more than a handful of requests', () => {
    for (const w of dash.widgets) assert.ok(tableOf(w).asked.length <= 8, w.title + ': ' + tableOf(w).asked.length + ' requests')
  })

  ok(dir + ': no number is made up: every card is a count or a sum of rows the sample holds', () => {
    if (dir === 'real-estate') {
      const items = rowsOf('property')
      const sales = rowsOf('sales')
      const active = items.filter((i) => ['for-sale', 'to-let', 'under-offer'].includes(i.status))
      assert.equal(card('Active listings').value, active.length)
      assert.equal(card('Active listings').subValue, items.filter((i) => i.status === 'under-offer').length)
      const open = sales.filter((c) => c.stage !== 'closed')
      assert.equal(card('Open sales value').value, sum(open.map((c) => c.value)))
      assert.equal(card('Open sales value').subValue, open.length)
      const viewings = sales.filter((c) => c.stage === 'viewing')
      assert.equal(card('Sales viewings to run').value, viewings.length)
      assert.equal(card('Sales viewings to run').subValue, viewings.filter((c) => daysUntil(c.due) >= 0 && daysUntil(c.due) <= 7).length)
      const onFile = items.filter((i) => i.mandate_until !== undefined && i.status !== 'sold')
      assert.equal(card('Mandates ending soon').value, onFile.filter((i) => daysUntil(i.mandate_until) <= 120).length)
      assert.equal(card('Mandates ending soon').subValue, onFile.length)
      // the lists and charts agree with the cards
      assert.equal(sum(chart('Properties by status').totals), items.length)
      assert.equal(sum(chart('Sales pipeline by stage').totals), sum(sales.map((c) => c.value)))
      assert.deepEqual(chart('Sales pipeline by stage').labels.map((l) => l.label), ['Enquiry', 'Viewing', 'Offer', 'Agreement', 'Closed'], 'the board\'s order, not the alphabet\'s')
      assert.equal(sum(chart('Sales leads by source').totals), sales.length)
      const ending = draw(byTitle('Mandates ending soon, by date'), tableOf(byTitle('Mandates ending soon, by date')))
      assert.equal(ending.length, Math.min(6, card('Mandates ending soon').value))
      assert.deepEqual(ending.map((r) => r.when), ending.map((r) => r.when).slice().sort(), 'soonest first')
    } else if (dir === 'ecommerce') {
      const orders = rowsOf('orders')
      const products = rowsOf('product')
      const paid = orders.filter((c) => ['paid', 'packed', 'shipped', 'delivered'].includes(c.stage))
      assert.equal(card('Revenue, paid orders').value, sum(paid.map((c) => c.value)))
      assert.equal(card('Revenue, paid orders').subValue, paid.length)
      assert.equal(card('Orders to ship').value, orders.filter((c) => ['paid', 'packed'].includes(c.stage)).length)
      assert.equal(card('Orders to ship').subValue, orders.filter((c) => c.stage === 'new').length)
      const low = products.filter((i) => typeof i.stock === 'number' && typeof i.reorder_at === 'number' && i.stock <= i.reorder_at && i.status !== 'draft')
      assert.equal(card('Low stock').value, low.length)
      assert.equal(card('Low stock').subValue, products.filter((i) => i.status === 'out').length)
      const customers = rowsOf('contact').filter((c) => c.type === 'customer')
      assert.equal(card('Customers').value, customers.length)
      assert.equal(card('Customers').subValue, customers.filter((c) => (c.tags || []).includes('repeat')).length)
      assert.deepEqual(chart('Orders by status').labels.map((l) => l.label), ['New', 'Paid', 'Packed', 'Shipped', 'Delivered'])
      assert.equal(sum(chart('Orders by status').totals), orders.length)
      assert.equal(sum(chart('Products by category').totals), products.length)
      const reorder = draw(byTitle('Stock to reorder'), tableOf(byTitle('Stock to reorder')))
      assert.equal(reorder.total, low.length)
      assert.ok(reorder.rows.every((r) => r[1].v <= r[2].v), 'every product listed is at or under its reorder level')
      assert.equal(draw(byTitle('Next orders to ship'), tableOf(byTitle('Next orders to ship'))).length, Math.min(6, card('Orders to ship').value))
      assert.equal(sum(chart('Top products by orders').totals), orders.filter((c) => c.product !== undefined).length)
    } else {
      const jobs = rowsOf('job')
      const candidates = rowsOf('candidates')
      const open = jobs.filter((i) => i.status === 'open')
      assert.equal(card('Open jobs').value, open.length)
      assert.equal(card('Open jobs').subValue, jobs.filter((i) => i.status === 'on-hold').length)
      assert.equal(card('Candidates in play').value, candidates.filter((c) => c.stage !== 'placed').length)
      assert.equal(card('Candidates in play').subValue, candidates.filter((c) => c.stage === 'interview').length)
      const placed = candidates.filter((c) => c.stage === 'placed')
      assert.equal(card('Candidates placed').value, placed.length)
      assert.equal(card('Candidates placed').subValue, sum(placed.map((c) => c.value)))
      const ages = open.filter((i) => i.opened !== undefined).map((i) => -daysUntil(i.opened))
      assert.equal(card('Oldest open job').value, Math.max(...ages))
      assert.equal(card('Oldest open job').subValue, open.length)
      assert.deepEqual(chart('Candidates by stage').labels.map((l) => l.label), ['Sourced', 'Screened', 'Interview', 'Proposed', 'Placed'])
      assert.equal(sum(chart('Candidates by stage').totals), candidates.length)
      assert.deepEqual(chart('Client missions by stage').labels.map((l) => l.label), ['Brief', 'Searching', 'Shortlist sent', 'Offer', 'Placed'])
      assert.equal(sum(chart('Client missions by stage').totals), rowsOf('missions').length)
      assert.equal(sum(chart('Where candidates come from').totals), candidates.length)
      const longest = draw(byTitle('Open the longest'), tableOf(byTitle('Open the longest')))
      assert.deepEqual(longest.map((r) => r.when), longest.map((r) => r.when).slice().sort(), 'the oldest first')
      assert.equal(longest.length, Math.min(6, ages.length))
    }
  })

  await okAsync(dir + ': using the preset gives the person their own copy; the Overview makes it once; the dashboard is the preset\'s, widget for widget', async () => {
    const home = mkdtempSync(join(tmpdir(), 'kb-bizdash-home-'))
    try {
      const host = createHost({ fs: fsp, home, log: () => {}, presets: (taken) => templatePresets(world.registry, taken) })
      assert.equal(host.allPresets().filter((p) => p.template !== undefined).length, 1)
      const info = await host.overviewInfo()
      assert.equal(info.preset, dir + '-overview')
      assert.deepEqual(info.label, { en: 'Overview', fr: 'Vue d’ensemble' })
      assert.equal(info.dashboardId, null)
      const a = await host.ensureOverview()
      const b = await host.ensureOverview()
      assert.deepEqual([a.ok, a.created, a.id, b.created, b.id], [true, true, dir + '-overview', false, dir + '-overview'])
      const copy = await host.readDoc(a.id)
      assert.equal(copy.ok, true)
      assert.equal(copy.dashboard.name, raw.name)
      assert.deepEqual(copy.dashboard.widgets.map((w) => w.title), dash.widgets.map((w) => w.title))
      assert.deepEqual(copy.errors, [], 'nothing was dropped when the file was written')
      assert.deepEqual(M.inspectDashboard(copy.dashboard), [], 'the copy has no warning')
      assert.equal((await host.list()).dashboards.length, 1, 'one copy, however many times the row is opened')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  ok(dir + ': with the other two templates installed too (their databases in the same service) every widget shows the very same thing', () => {
    const crowded = openWorld({ themeDir, also: dirs.filter((d) => d !== dir).map((d) => join(ROOT, d)), now: NOW })
    try {
      assert.equal(crowded.plugin().status, 'ok')
      assert.equal(templatePresets(crowded.registry).length, 3, 'the gallery has the three dashboards')
      assert.equal(crowded.service.list().length, 3, 'the service really holds the other templates\' databases')
      for (const w of dash.widgets) {
        const alone = JSON.stringify(draw(w, tableOf(w)))
        const together = JSON.stringify(draw(w, readTable(M, crowded, w.source, NOW)))
        assert.equal(together, alone, w.title + ' changes when the other templates\' rows are there')
      }
    } finally { crowded.close() }
  })

  ok(dir + ': without its sample rows (the person cleared them) every widget says it is empty instead of showing a number', () => {
    const bare = openWorld({ themeDir, now: NOW, sample: false })
    try {
      for (const w of dash.widgets.filter((x) => x.type === 'card')) {
        const c = M.cardData(readTable(M, bare, w.source, NOW), w)
        assert.equal(c.empty, true, w.title + ' still shows ' + c.text)
      }
    } finally { bare.close() }
  })

  world.close()
}

console.log(count + ' checks passed')
