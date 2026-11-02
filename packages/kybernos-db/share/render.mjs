// kybernos-db/share: how a snapshot is drawn. The page that shows a shared dashboard is ONE fixed page that we serve (or the same page inside a file); a snapshot is data and never
// code, so nothing in it can run, and nothing is ever put in the page as HTML. Everything below returns a small tree of plain objects (`kvh`), and `kvMount` turns it into DOM
// with createElement, createTextNode and setAttribute on a short list of tags and attributes: a text of the snapshot can only ever become a text node or an `aria-label`.
//
// Pure, no DOM until `kvMount`: the tests walk the trees. The only import is the chart geometry of the Dashboards plugin (a vendored copy); the browser build pastes the files in
// order (see viewer.mjs), so every name here starts with `kv` and cannot meet one of theirs.
//
// Colours, sizes and the grid are classes of viewer.css (a `style` attribute would need a looser content policy): a series is `kv-c0` to `kv-c5`, a widget is `kv-s<columns>` wide
// and `kv-r<rows>` high, a state is `kv-st-ok|warn|fail|idle`.

import { columnsLayout, donutLayout, heatmapLayout, hbarsLayout, lineLayout, roundedTopPath, sparkPoints } from './vendor/chart-core.mjs'

const kvInt = (v, lo, hi, d) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d)
const kvStr = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const kvArr = (v, max = 400) => (Array.isArray(v) ? v.slice(0, max) : [])
const kvNums = (v, max = 400) => kvArr(v, max).map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0))
const kvOne = (v, list, d) => (list.includes(v) ? v : d)
const kvR = (v) => Math.round(v * 10) / 10

/** A node: `kvh('div', { class: 'x' }, child, [children], 'text')`. Nothing, null, undefined and false are dropped. */
export const kvh = (t, a, ...c) => ({ t, a: a || {}, c: c.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) })

/** 1234.5 -> "1,234.5"; kept short for a label. */
export const kvNum = (n) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(Math.round(v * 100) / 100)
}
/** An axis tick: 1500 -> "1.5k", 2000000 -> "2M". */
export const kvTick = (n) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  const a = Math.abs(v)
  const t = (x) => String(Math.round(x * 10) / 10)
  return a >= 1e9 ? t(v / 1e9) + 'B' : a >= 1e6 ? t(v / 1e6) + 'M' : a >= 1e3 ? t(v / 1e3) + 'k' : t(v)
}
/** A label for an axis: a day shows as month-day, a long text is cut. */
export const kvShort = (text, max = 11) => {
  const s = kvStr(text, 120)
  const m = /^\d{4}-(\d{2}-\d{2})$/.exec(s)
  const t = m === null ? s : m[1]
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
const kvTone = (t) => kvOne(t, ['ok', 'warn', 'err', 'fail', 'idle'], '')

const KV_COLORS = 6
const kvSize = (w, h) => ({ W: Math.min(940, Math.max(300, kvInt(w, 1, 12, 6) * 78)), H: Math.max(120, kvInt(h, 1, 8, 4) * 88 - 70) })
const kvSvg = (W, H, label, ...c) => kvh('svg', { class: 'kv-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': label }, c)
const kvText = (x, y, cls, text, anchor) => kvh('text', { x: kvR(x), y: kvR(y), class: cls, ...(anchor ? { 'text-anchor': anchor } : {}) }, text)
const kvLegend = (items) => kvh('ul', { class: 'kv-legend' }, items.map((it, i) => kvh('li', null, kvh('i', { class: 'kv-sw kv-c' + (i % KV_COLORS) }), kvh('span', null, it))))
const kvEmpty = () => kvh('p', { class: 'kv-none' }, 'No data')

// ── the widgets ──────────────────────────────────────────────────────────

function kvCard (d) {
  const spark = kvNums(d.spark, 120)
  const pts = spark.length > 1 ? sparkPoints(spark, 140, 34) : []
  return kvh('div', { class: 'kv-card' },
    kvh('div', { class: 'kv-big' }, kvStr(d.text, 80) || '0'),
    d.empty === true ? kvh('div', { class: 'kv-sub' }, 'No data') : null,
    kvStr(d.sub, 120) !== '' ? kvh('div', { class: 'kv-sub kv-st-' + kvOne(d.st, ['ok', 'warn', 'fail', 'idle'], 'ok') }, kvh('i', { class: 'kv-dot' }), kvh('span', null, kvStr(d.sub, 120))) : null,
    pts.length > 1 ? kvh('svg', { class: 'kv-spark', viewBox: '0 0 140 34', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, kvh('polyline', { class: 'kv-line kv-c0', fill: 'none', points: pts.map((p) => p.x + ',' + p.y).join(' ') })) : null)
}

function kvAxes (L, W, H, labels) {
  const p = L.plot
  return [
    L.ticks.map((t) => [kvh('line', { class: 'kv-gl', x1: p.l, x2: kvR(p.l + p.w), y1: t.y, y2: t.y }), kvText(p.l - 6, t.y + 4, 'kv-tick', kvTick(t.v), 'end')]),
    L.labels.map((l) => kvText(l.x, H - 6, 'kv-lab', kvShort(labels[l.i] === undefined ? '' : labels[l.i].label), 'middle')),
  ]
}

function kvColumns (d, W, H, title) {
  const labels = kvArr(d.labels)
  const series = kvArr(d.series, KV_COLORS).map((s) => ({ name: kvStr(s.name, 60), values: kvNums(s.values) }))
  const L = columnsLayout({ series: series.map((s) => s.values), labelCount: labels.length, W, H, mode: d.kind === 'stacked' ? 'stack' : 'group' })
  return [
    kvSvg(W, H, title, kvAxes(L, W, H, labels), L.bars.map((b) => {
      const tip = kvh('title', null, kvStr(labels[b.i] && labels[b.i].label, 80) + (series.length > 1 ? ' · ' + series[b.s].name : '') + ': ' + kvNum(b.v) + (kvStr(d.unit, 16) !== '' ? ' ' + kvStr(d.unit, 16) : ''))
      return b.top ? kvh('path', { class: 'kv-bar kv-c' + (b.s % KV_COLORS), d: roundedTopPath(b.x, b.y, b.w, b.h, L.radius) }, tip) : kvh('rect', { class: 'kv-bar kv-c' + (b.s % KV_COLORS), x: b.x, y: b.y, width: b.w, height: b.h }, tip)
    })),
    series.length > 1 ? kvLegend(series.map((s) => s.name)) : null,
  ]
}

function kvBars (d, W, H, title) {
  const labels = kvArr(d.labels, 40)
  const values = kvNums(kvArr(d.series)[0] === undefined ? [] : d.series[0].values, 40)
  const h = Math.max(H, labels.length * 26 + 28)
  const L = hbarsLayout({ values, W, H: h, labelW: Math.min(150, Math.round(W * 0.3)), valueW: 64 })
  return kvSvg(W, h, title,
    L.bars.map((b) => kvh('g', null,
      kvText(L.plot.l - 8, b.y + b.h / 2 + 4, 'kv-lab', kvShort(labels[b.i] && labels[b.i].label, 22), 'end'),
      kvh('rect', { class: 'kv-bar kv-c0', x: b.x, y: b.y, width: b.w, height: b.h, rx: 3 }, kvh('title', null, kvStr(labels[b.i] && labels[b.i].label, 80) + ': ' + kvNum(b.v))),
      kvText(b.x + b.w + 6, b.y + b.h / 2 + 4, 'kv-val', kvTick(b.v)))))
}

function kvLines (d, W, H, title) {
  const labels = kvArr(d.labels)
  const series = kvArr(d.series, KV_COLORS).map((s) => ({ name: kvStr(s.name, 60), values: kvNums(s.values) }))
  const L = lineLayout({ series: series.map((s) => s.values), labelCount: labels.length, W, H })
  return [
    kvSvg(W, H, title, kvAxes(L, W, H, labels),
      L.lines.map((l) => [d.kind === 'area' && l.areaD !== '' ? kvh('path', { class: 'kv-area kv-c' + (l.s % KV_COLORS), d: l.areaD }) : null, kvh('path', { class: 'kv-line kv-c' + (l.s % KV_COLORS), fill: 'none', d: l.d })]),
      L.end.map((e) => kvh('circle', { class: 'kv-end kv-c' + (e.s % KV_COLORS), cx: e.x, cy: e.y, r: 3.5 }, kvh('title', null, kvNum(e.v))))),
    series.length > 1 ? kvLegend(series.map((s) => s.name)) : null,
  ]
}

function kvDonut (d, W, H, title) {
  const labels = kvArr(d.labels, 40)
  const values = kvNums(kvArr(d.series)[0] === undefined ? [] : d.series[0].values, 40)
  const size = Math.max(120, Math.min(H, 220))
  const L = donutLayout({ values, size, thickness: 24 })
  const total = values.reduce((a, b) => a + Math.max(0, b), 0)
  return kvh('div', { class: 'kv-donut' },
    kvSvg(size, size, title,
      L.segs.map((s) => kvh('circle', { class: 'kv-seg kv-c' + (s.i % KV_COLORS), cx: L.cx, cy: L.cy, r: L.r, fill: 'none', 'stroke-width': L.thickness, 'stroke-dasharray': s.len + ' ' + s.circ, 'stroke-dashoffset': -s.offset, transform: 'rotate(-90 ' + L.cx + ' ' + L.cy + ')' },
        kvh('title', null, kvStr(labels[s.i] && labels[s.i].label, 80) + ': ' + kvNum(s.v) + ' (' + s.pct + '%)'))),
      kvText(L.cx, L.cy + 6, 'kv-donut-n', kvTick(total), 'middle')),
    kvh('ul', { class: 'kv-legend col' }, labels.map((l, i) => (values[i] > 0 ? kvh('li', null, kvh('i', { class: 'kv-sw kv-c' + (i % KV_COLORS) }), kvh('span', { class: 'kv-ll' }, kvStr(l.label, 60)), kvh('b', null, kvNum(values[i]))) : null))))
}

function kvHeat (d, W, H, title) {
  const labels = kvArr(d.labels, 400)
  const L = heatmapLayout({ keys: labels.map((l) => kvStr(l.label, 12)), values: kvNums(d.totals, 400), W, H })
  return kvSvg(W, Math.max(40, L.height), title, L.cells.map((c) => kvh('rect', { class: 'kv-hl kv-hl' + c.level, x: c.x, y: c.y, width: c.s, height: c.s, rx: 2 }, kvh('title', null, c.key + ': ' + kvNum(c.v)))))
}

function kvChart (d, w) {
  if (d.empty === true || kvArr(d.labels).length === 0) return kvEmpty()
  const { W, H } = kvSize(w.w, w.h)
  const title = kvStr(w.title, 120) || 'Chart'
  switch (d.kind) {
    case 'bars': return kvBars(d, W, H, title)
    case 'line': case 'area': return kvLines(d, W, H, title)
    case 'donut': return kvDonut(d, W, H, title)
    case 'heatmap': return kvHeat(d, W, H, title)
    default: return kvColumns(d, W, H, title)
  }
}

function kvTable (d) {
  const cols = kvArr(d.columns, 12).map((c) => ({ label: kvStr(c.label, 60), num: c.type === 'number', bar: c.bar === true }))
  const rows = kvArr(d.rows, 60)
  if (cols.length === 0 || rows.length === 0) return kvEmpty()
  const total = kvInt(d.total, 0, 1e9, rows.length)
  return kvh('div', { class: 'kv-tblwrap' },
    kvh('table', { class: 'kv-tbl' },
      kvh('thead', null, kvh('tr', null, cols.map((c) => kvh('th', { class: c.num ? 'num' : '', scope: 'col' }, c.label)))),
      kvh('tbody', null, rows.map((r) => kvh('tr', null, kvArr(r, 12).map((cell, i) => {
        const col = cols[i] || { num: false, bar: false }
        const bar = typeof cell.bar === 'number' && cell.bar >= 0 ? Math.min(1, cell.bar) : null
        return kvh('td', { class: col.num ? 'num' : '' }, kvStr(cell.s, 160), bar !== null ? kvh('svg', { class: 'kv-minibar', viewBox: '0 0 100 5', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, kvh('rect', { class: 'kv-c0', x: 0, y: 0, width: kvR(bar * 100), height: 5, rx: 2 })) : null)
      }))))),
    total > rows.length ? kvh('p', { class: 'kv-more' }, 'The first ' + rows.length + ' of ' + kvNum(total)) : null)
}

function kvList (d) {
  const rows = kvArr(d.rows, 60)
  if (rows.length === 0) return kvEmpty()
  return kvh('ul', { class: 'kv-list' }, rows.map((r) => kvh('li', null,
    kvh('span', { class: 'kv-lt' }, kvStr(r.title, 160)),
    kvStr(r.sub, 120) !== '' ? kvh('span', { class: 'kv-ls' }, kvStr(r.sub, 120)) : null,
    kvStr(r.state, 40) !== '' ? kvh('span', { class: 'kv-pill' }, kvStr(r.state, 40)) : null,
    kvStr(r.when, 40) !== '' ? kvh('span', { class: 'kv-lw' }, kvStr(r.when, 40)) : null)))
}

function kvNote (d) {
  if (Array.isArray(d.check)) return kvh('ul', { class: 'kv-check' }, d.check.slice(0, 40).map((c) => kvh('li', { class: Array.isArray(c) && c[1] ? 'done' : '' }, kvh('i', { class: 'kv-box', 'aria-hidden': 'true' }, Array.isArray(c) && c[1] ? '✓' : ''), kvh('span', null, kvStr(Array.isArray(c) ? c[0] : c, 200)))))
  return kvh('div', { class: 'kv-text' }, kvStr(d.text, 4000).split('\n').map((line) => kvh('p', null, line)))
}

export const KV_TYPES = ['card', 'chart', 'table', 'list', 'note']
export function kvWidget (w) {
  if (w === null || typeof w !== 'object' || !KV_TYPES.includes(w.type)) return null
  const d = w.data !== null && typeof w.data === 'object' ? w.data : {}
  const tint = w.type === 'note' ? kvOne(d.tint, ['amber', 'green', 'blue', 'pink'], '') : ''
  const body = w.type === 'card' ? kvCard(d) : w.type === 'chart' ? kvChart(d, w) : w.type === 'table' ? kvTable(d) : w.type === 'list' ? kvList(d) : kvNote(d)
  const title = kvStr(w.title, 120)
  return kvh('section', { class: 'kv-w kv-s' + kvInt(w.w, 1, 12, 6) + ' kv-r' + kvInt(w.h, 1, 8, 4) + ' kv-t-' + w.type + (tint !== '' ? ' kv-tint-' + tint : ''), 'aria-label': title || w.type },
    title !== '' ? kvh('h2', { class: 'kv-wt' }, title) : null, body)
}

/** The page of a snapshot (already checked by `kvCheck`). */
export function kvPage (doc) {
  const when = kvStr(doc.made, 10)
  return kvh('main', { class: 'kv-main' },
    kvh('header', { class: 'kv-head' }, kvh('h1', null, kvStr(doc.title, 120) || 'Dashboard'), kvStr(doc.desc, 240) !== '' ? kvh('p', null, kvStr(doc.desc, 240)) : null),
    kvh('div', { class: 'kv-grid' }, kvArr(doc.widgets, 24).map(kvWidget)),
    kvh('footer', { class: 'kv-foot' }, kvh('span', null, 'A snapshot' + (when !== '' ? ' of ' + when : '') + ', shared from Kybernos')))
}

/** A message in place of the page: the link is gone, the file is broken, this browser cannot open it. */
export const kvMessage = (title, text) => kvh('main', { class: 'kv-main kv-center' }, kvh('h1', null, title), kvh('p', { class: 'kv-sub' }, text))

/** The password page of a protected snapshot. `onOpen(password)` is called on submit. */
export function kvLock ({ error = '', busy = false, onOpen }) {
  return kvh('main', { class: 'kv-main kv-center' },
    kvh('h1', null, 'Protected dashboard'),
    kvh('p', { class: 'kv-sub' }, 'Enter the password you were given. It opens this page in your browser: nothing is sent anywhere.'),
    kvh('form', { class: 'kv-form', onsubmit: (e) => { e.preventDefault(); const f = e.target.elements; onOpen(f.password === undefined ? '' : f.password.value) } },
      kvh('label', { for: 'kv-pw' }, 'Password'),
      kvh('input', { id: 'kv-pw', name: 'password', type: 'password', autocomplete: 'off', required: 'required', ...(busy ? { disabled: 'disabled' } : {}) }),
      kvh('button', { type: 'submit', ...(busy ? { disabled: 'disabled' } : {}) }, busy ? 'Opening…' : 'Open'),
      error !== '' ? kvh('p', { class: 'kv-err', role: 'alert' }, error) : null))
}

/** A snapshot as the page may trust it: the kind and version it knows, at most 24 widgets of the types it draws. Anything else is null. */
export function kvCheck (doc) {
  if (doc === null || typeof doc !== 'object' || doc.kind !== 'kybernos-snapshot' || doc.version !== 1 || !Array.isArray(doc.widgets)) return null
  return { ...doc, widgets: doc.widgets.slice(0, 24).filter((w) => w !== null && typeof w === 'object' && KV_TYPES.includes(w.type)) }
}

// ── tree to DOM ──────────────────────────────────────────────────────────

const KV_HTML = ['main', 'header', 'footer', 'section', 'div', 'span', 'h1', 'h2', 'p', 'i', 'b', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'form', 'label', 'input', 'button']
const KV_SVG = ['svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'text', 'title']
const KV_NS = 'http://www.w3.org/2000/svg'
const KV_ATTR = /^[a-zA-Z][a-zA-Z0-9-]*$/ // camel case for viewBox and preserveAspectRatio
// What a tree may never set: a script, a style, an address to load, or a form that leaves the page.
const KV_NEVER = ['style', 'href', 'src', 'srcdoc', 'action', 'formaction', 'target', 'is', 'xmlns']

/** A node of `kvh` as DOM, in `doc` (a Document). Throws on a tag or an attribute that the page does not use: the trees are made by the code above, never by a snapshot. */
export function kvMount (doc, node, inSvg = false) {
  if (typeof node === 'string' || typeof node === 'number') return doc.createTextNode(String(node))
  const svg = inSvg || node.t === 'svg'
  if (!(svg ? KV_SVG : KV_HTML).includes(node.t)) throw new Error('kvMount: a tag the page does not use: ' + node.t)
  const el = svg ? doc.createElementNS(KV_NS, node.t) : doc.createElement(node.t)
  for (const name of Object.keys(node.a)) {
    const v = node.a[name]
    if (typeof v === 'function') { if (/^on[a-z]+$/.test(name)) el.addEventListener(name.slice(2), v); continue }
    if (v === null || v === undefined || v === false || !KV_ATTR.test(name) || KV_NEVER.includes(name.toLowerCase()) || /^on/i.test(name)) continue
    el.setAttribute(name, String(v))
  }
  for (const child of node.c) el.appendChild(kvMount(doc, child, svg && node.t !== 'foreignObject'))
  return el
}
