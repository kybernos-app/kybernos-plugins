// kybernos-db/share: a dashboard turned into a snapshot, a small document of what its widgets show, with nothing behind it. The document holds the RESULTS (a number, the points of a
// chart, the rows a table lists), never the table: a reader sees what the dashboard showed on the day it was made, and nothing they could dig more out of.
//
// The numbers are the Dashboards plugin's own: its model (vendor/dashboards-model.mjs, a copy that a test keeps equal to the source) reads the same two routes the page reads, here answered
// by the Tables door in this process, builds the same table and computes each widget with the same functions. Nothing is changed in the Dashboards plugin.
//
// What a snapshot does not carry, said in the answer so the person is never surprised:
//  - widgets over anything but a Tables object (a dashboard about this computer's usage, sessions or automations is personal, and a reader has no business in it);
//  - widgets the viewer does not draw yet (kanban, carousel, calendar, flow, sankey);
//  - widgets that would show a `personal` field (a name, an address, a phone) as text, unless the person said they may: a chart "by customer" is a list of names.
// A field kept back by the Dashboards plugin (`sensitive`, `secret`) is not in the table, so it is in no snapshot.

import { buildTable, cardData, chartData, formatNumber, listData, planFor, planNext, tableData, validateDashboard } from './vendor/dashboards-model.mjs'

export const SNAPSHOT_KIND = 'kybernos-snapshot'
export const SNAPSHOT_VERSION = 1
/** The most one snapshot weighs, as text: far above what a dashboard of 24 widgets needs (a few dozen KB), far below what a page should be asked to hold. */
export const SNAPSHOT_MAX_BYTES = 1000000

const DRAWN = ['card', 'chart', 'table', 'list', 'note']
const CHARTS = ['columns', 'stacked', 'bars', 'line', 'area', 'donut', 'heatmap']
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const arr = (v) => (Array.isArray(v) ? v : [])
const day = (ms) => new Date(ms).toISOString().slice(0, 10)

/** The two answers a `db.rows` source asks the host for, from the Tables door of this process (the page asks the same routes over http). */
function answerOf (api, path) {
  const u = new URL(path, 'http://local')
  const r = u.pathname === '/kybernos-db/state' ? api.state() : u.pathname === '/kybernos-db/records' ? api.records(Object.fromEntries(u.searchParams)) : null
  return r !== null && isObj(r) && r.ok !== false ? r : null
}

/** What the page does for a source: round one, round two, then the table. { table, state } (the state tells which table, for the `personal` check). */
function readSource (api, source, now) {
  const parts = {}
  for (const req of planFor(source, now)) { const j = answerOf(api, req.path); if (j !== null) parts[req.key] = j }
  for (const req of planNext(source, parts, now)) { const j = answerOf(api, req.path); if (j !== null) parts[req.key] = j }
  return { table: buildTable(source, parts, now), state: parts.state }
}

/** The table a `db.rows` source means, in the state the host answered (the same choice the model makes: by id or template id, else the first). */
function objectOf (state, source) {
  const want = typeof source.params.db === 'string' ? source.params.db : ''
  const dbs = arr(isObj(state) ? state.dbs : []).filter((d) => isObj(d) && typeof d.id === 'string')
  const db = want === '' ? dbs[0] : dbs.find((d) => d.id === want || d.template === want)
  if (db === undefined) return null
  const key = typeof source.params.object === 'string' ? source.params.object : ''
  const object = arr(db.objects).find((o) => isObj(o) && (key === '' || o.key === key))
  return object === undefined ? null : { db, object }
}

/** The columns of a table that carry a `personal` field: its key, the columns made from it, and the title column when the title is one. A link shows the title of the row it points at. */
function personalColumns (found) {
  const out = new Set()
  if (found === null) return out
  const { db, object } = found
  const personal = (f) => isObj(f) && f.protection === 'personal'
  const mark = (f) => { out.add(f.key); out.add(f.key + '_in'); out.add(f.key + '_ago'); out.add(f.key + '_key') }
  for (const f of arr(object.fields)) {
    if (personal(f)) mark(f)
    if (isObj(f) && f.type === 'relation') {
      const target = arr(db.objects).find((o) => isObj(o) && o.key === f.to)
      const title = target === undefined ? undefined : arr(target.fields).find((x) => isObj(x) && x.key === target.title)
      if (title !== undefined && title.protection === 'personal') out.add(f.key)
    }
  }
  const title = arr(object.fields).find((f) => isObj(f) && f.key === object.title)
  if (title !== undefined && title.protection === 'personal') out.add('title')
  return out
}

/** The columns a widget prints as text, row by row: a number made of them is a sum, a name is a name. */
function shownColumns (w) {
  switch (w.type) {
    case 'table': return w.columns.map((c) => c.field)
    case 'list': return [w.label, w.sub, w.when, w.state].filter((f) => typeof f === 'string' && f !== '')
    case 'chart': return [w.x, w.series].filter((f) => typeof f === 'string' && f !== '')
    case 'card': return w.metric.agg === 'top' && typeof w.metric.field === 'string' ? [w.metric.field] : []
    default: return []
  }
}

const labelOf = (l) => ({ label: String(l.label), ...(l.other === true ? { other: true } : {}), ...(typeof l.tone === 'string' ? { tone: l.tone } : {}) })

/** The result of one widget, in the shape the viewer draws. A number is a number, and a text is already the text to print: the viewer has no model. */
function resultOf (w, table) {
  switch (w.type) {
    case 'note':
      return w.check !== undefined ? { tint: w.tint, check: w.check.map((c) => [String(c[0]), c[1] ? 1 : 0]) } : { tint: w.tint, text: String(w.text) }
    case 'card': {
      const d = cardData(table, w)
      return { text: d.text, sub: d.sub, st: d.st, empty: d.empty === true, ...(Array.isArray(d.spark) ? { spark: d.spark.map(Number) } : {}) }
    }
    case 'chart': {
      const d = chartData(table, w)
      return { kind: d.kind, unit: d.unit, empty: d.empty === true, labels: d.labels.map(labelOf), series: d.series.map((s) => ({ name: String(s.name), ...(typeof s.tone === 'string' ? { tone: s.tone } : {}), values: s.values.map(Number) })), totals: d.totals.map(Number) }
    }
    case 'list': return { rows: listData(table, w).map((r) => ({ title: String(r.title), sub: String(r.sub), when: String(r.when), state: String(r.state) })) }
    case 'table': {
      const d = tableData(table, w)
      return {
        total: d.total,
        columns: d.columns.map((c) => ({ label: String(c.label), type: c.type === 'number' ? 'number' : 'text', bar: c.bar === true })),
        rows: d.rows.map((row) => row.map((cell, i) => {
          const c = d.columns[i]
          const n = typeof cell.v === 'number' && Number.isFinite(cell.v) ? cell.v : null
          return { s: n !== null ? formatNumber(n, c.format) : String(cell.v), ...(n !== null && c.bar && c.max > 0 ? { bar: Math.max(0, Math.min(1, n / c.max)) } : {}) }
        })),
      }
    }
    default: return null
  }
}

/**
 * The snapshot of a dashboard: `{ ok: true, doc, bytes, included, left, withheld }` or `{ ok: false, error, message }`.
 *  - `dashboard`: the dashboard as it is in its file (it goes through the Dashboards model's own validation first);
 *  - `api`: the Tables door (`makeApi`), the owner's: the dashboard is the owner's, and the page reads the same routes;
 *  - `includePersonal`: the person agreed that a widget may print a `personal` field;
 *  - `maxBytes`: the most the document may weigh (the port may allow less than the default).
 */
export function buildSnapshot ({ dashboard, api, now = Date.now(), includePersonal = false, maxBytes = SNAPSHOT_MAX_BYTES }) {
  const v = validateDashboard(dashboard)
  if (!v.ok) return { ok: false, error: 'invalid_dashboard', message: 'the dashboard could not be read' }
  const d = v.dashboard
  const tables = new Map()
  const tableOf = (source) => {
    const key = JSON.stringify(source)
    if (!tables.has(key)) { const r = readSource(api, source, now); tables.set(key, { ...r, personal: personalColumns(objectOf(r.state, source)) }) }
    return tables.get(key)
  }
  const widgets = []
  const included = []
  const left = []
  const withheld = []
  for (const w of d.widgets) {
    const entry = { id: w.id, title: w.title || w.type, type: w.type }
    if (!DRAWN.includes(w.type)) { left.push({ ...entry, why: 'the page that shows a snapshot does not draw a ' + w.type + ' yet' }); continue }
    if (w.type === 'chart' && !CHARTS.includes(w.kind)) { left.push({ ...entry, why: 'the page that shows a snapshot does not draw a ' + w.kind + ' chart yet' }); continue }
    let result = null
    if (w.type !== 'note') {
      if (w.source.provider !== 'db.rows') { left.push({ ...entry, why: 'it reads "' + w.source.provider + '", which is about this computer and not a table: only widgets over a table are shared' }); continue }
      const t = tableOf(w.source)
      if (t.table.rows.length === 0 && /^No /.test(String(t.table.meta && t.table.meta.note))) { left.push({ ...entry, why: String(t.table.meta.note) }); continue }
      const hit = shownColumns(w).filter((c) => t.personal.has(c))
      if (hit.length > 0 && !includePersonal) { withheld.push({ ...entry, fields: hit }); continue }
      result = resultOf(w, t.table)
    } else result = resultOf(w, null)
    widgets.push({ id: w.id, type: w.type, title: w.title, w: w.w, h: w.h, data: result })
    included.push(entry)
  }
  const doc = { kind: SNAPSHOT_KIND, version: SNAPSHOT_VERSION, title: d.name, desc: d.desc, made: day(now), widgets }
  const bytes = Buffer.byteLength(JSON.stringify(doc))
  if (bytes > maxBytes) return { ok: false, error: 'too_big', message: 'the snapshot weighs ' + bytes + ' bytes, more than the ' + maxBytes + ' a shared page may hold: show fewer widgets or rows' }
  if (widgets.length === 0) return { ok: false, error: 'nothing_to_share', message: 'no widget of this dashboard can be shared', left, withheld }
  return { ok: true, doc, bytes, included, left, withheld }
}
