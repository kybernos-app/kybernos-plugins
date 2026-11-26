// kybernos-dashboards: chart geometry and motion maths. Pure: numbers in, numbers and path strings out. No DOM, no clock,
// no import (the browser build pastes this file in as it is).
//
// The page turns these shapes into SVG and decides when they animate; nothing here knows about colours or React. Every
// function is total: an empty input gives an empty drawing, never NaN, and everything stays inside the box it was given.

const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const r1 = (v) => Math.round(fin(v) * 10) / 10
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ── motion maths ─────────────────────────────────────────────────────────────

export const clamp01 = (t) => clamp(fin(t), 0, 1)
export const lerp = (a, b, t) => a + (b - a) * clamp01(t)
export const easeOutCubic = (t) => { const u = 1 - clamp01(t); return 1 - u * u * u }

/** The value a counter shows at progress t (0..1): never past the target, never negative for a non-negative target. */
export const countUpAt = (from, to, t, ease = easeOutCubic) => lerp(fin(from), fin(to), ease(t))

/**
 * Delay (ms) of the i-th of n marks in an entrance: even steps, but the whole cascade never lasts more than `total` ms,
 * so a 60-bar chart does not take three seconds to appear.
 */
export const staggerDelay = (i, n, step = 28, total = 620) => {
  const count = Math.max(1, fin(n, 1))
  const s = count <= 1 ? 0 : Math.min(step, total / (count - 1))
  return Math.round(Math.max(0, fin(i)) * s)
}

// ── scales and ticks ─────────────────────────────────────────────────────────

/**
 * Ticks from 0 on a round step (1, 2, 2.5, 5 times a power of ten), about `target` of them, and the top of the scale: the
 * first tick at or above the value, so the highest gridline is always a round number and the data always fits.
 * -> { max, step, ticks }. An empty or non-positive maximum gives a 0..1 scale.
 */
export function niceTicks (value, target = 4) {
  const v = fin(value)
  if (v <= 0) return { max: 1, step: 0.5, ticks: [0, 0.5, 1] }
  const raw = v / Math.max(1, target)
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  let step = 10 * p
  for (const m of [1, 2, 2.5, 5, 10]) { if (m * p >= raw * 0.9999) { step = m * p; break } }
  const n = Math.max(1, Math.ceil(v / step - 1e-9))
  const ticks = []
  for (let i = 0; i <= n; i++) ticks.push(Math.round(i * step * 1e6) / 1e6)
  return { max: ticks[ticks.length - 1], step, ticks }
}

const BOX = { l: 40, r: 8, t: 8, b: 22 }
const box = (W, H, m) => { const b = Object.assign({}, BOX, m || {}); return { l: b.l, r: b.r, t: b.t, b: b.b, pw: Math.max(1, W - b.l - b.r), ph: Math.max(1, H - b.t - b.b) } }

/** A bar with its data end rounded and its baseline end square: the path of a rectangle standing on y + h. */
export function roundedTopPath (x, y, w, h, r) {
  const rr = clamp(fin(r), 0, Math.min(fin(w) / 2, fin(h)))
  const X = r1(x); const Y = r1(y); const Wd = r1(w); const Hh = r1(h)
  return 'M' + X + ',' + r1(Y + Hh) + 'V' + r1(Y + rr) + 'Q' + X + ',' + Y + ' ' + r1(X + rr) + ',' + Y + 'H' + r1(X + Wd - rr) + 'Q' + r1(X + Wd) + ',' + Y + ' ' + r1(X + Wd) + ',' + r1(Y + rr) + 'V' + r1(Y + Hh) + 'Z'
}
/** The same for a bar growing to the right from x. */
export function roundedRightPath (x, y, w, h, r) {
  const rr = clamp(fin(r), 0, Math.min(fin(h) / 2, fin(w)))
  const X = r1(x); const Y = r1(y); const Wd = r1(w); const Hh = r1(h)
  return 'M' + X + ',' + Y + 'H' + r1(X + Wd - rr) + 'Q' + r1(X + Wd) + ',' + Y + ' ' + r1(X + Wd) + ',' + r1(Y + rr) + 'V' + r1(Y + Hh - rr) + 'Q' + r1(X + Wd) + ',' + r1(Y + Hh) + ' ' + r1(X + Wd - rr) + ',' + r1(Y + Hh) + 'H' + X + 'Z'
}

// ── columns, stacked or grouped ──────────────────────────────────────────────

/**
 * values: series[k][i] (non-negative). mode: 'stack' | 'group'.
 * -> { plot, max, ticks:[{v,y}], bars:[{s,i,x,y,w,h,top,v}], hits:[{i,x,w}], labels:[{i,x}] }
 * `top` marks the last drawn segment of a stack (the only one with a rounded end). Segments are separated by a 2px gap.
 */
export function columnsLayout ({ series, labelCount, W, H, mode = 'stack', maxBar = 24, gap = 2, radius = 4, margin, labelEvery }) {
  const n = Math.max(0, Math.floor(fin(labelCount, (series[0] || []).length)))
  const b = box(W, H, margin)
  const totals = []
  for (let i = 0; i < n; i++) {
    let t = 0; let mx = 0
    for (const s of series) { const v = Math.max(0, fin(s[i])); t += v; mx = Math.max(mx, v) }
    totals.push(mode === 'stack' ? t : mx)
  }
  const { max, ticks } = niceTicks(Math.max(0, ...totals), 4)
  const band = b.pw / Math.max(1, n)
  const bw = Math.min(maxBar, band * 0.62)
  const Y = (v) => b.t + b.ph - (v / max) * b.ph
  const bars = []
  const hits = []
  const labels = []
  const every = labelEvery !== undefined ? labelEvery : (n > 16 ? 5 : n > 8 ? 2 : 1)
  for (let i = 0; i < n; i++) {
    const cx = b.l + i * band + band / 2
    hits.push({ i, x: r1(b.l + i * band), w: r1(band) })
    if ((n - 1 - i) % every === 0) labels.push({ i, x: r1(cx) })
    if (mode === 'stack') {
      let y = b.t + b.ph
      let topIdx = -1
      for (let k = series.length - 1; k >= 0; k--) if (Math.max(0, fin(series[k][i])) > 0) { topIdx = k; break }
      for (let k = 0; k < series.length; k++) {
        const v = Math.max(0, fin(series[k][i]))
        if (v <= 0) continue
        const full = Math.max(2, (v / max) * b.ph)
        const h = r1(Math.max(1, full - gap))
        const bottom = y
        y -= full
        bars.push({ s: k, i, x: r1(cx - bw / 2), y: r1(bottom - h), w: r1(bw), h, top: k === topIdx, v })
      }
    } else {
      const k = Math.max(1, series.length)
      const gw = Math.max(2, (bw * 1.2 - gap * (k - 1)) / k)
      const total = gw * k + gap * (k - 1)
      for (let s = 0; s < series.length; s++) {
        const v = Math.max(0, fin(series[s][i]))
        const h = v <= 0 ? 0 : Math.max(2, (v / max) * b.ph)
        if (h <= 0) continue
        bars.push({ s, i, x: r1(cx - total / 2 + s * (gw + gap)), y: r1(Y(0) - h), w: r1(gw), h: r1(h), top: true, v })
      }
    }
  }
  return { plot: { l: b.l, t: b.t, w: b.pw, h: b.ph }, max, ticks: ticks.map((v) => ({ v, y: r1(Y(v)) })), bars, hits, labels, radius }
}

// ── ranked horizontal bars ───────────────────────────────────────────────────

/** values: number[]. -> { max, ticks:[{v,x}], bars:[{i,x,y,w,h,v}], plot, rowH } */
export function hbarsLayout ({ values, W, H, labelW = 96, valueW = 52, thick = 14, margin }) {
  const n = values.length
  const b = box(W, H, Object.assign({ l: labelW, r: valueW, t: 4, b: 18 }, margin || {}))
  const { max, ticks } = niceTicks(Math.max(0, ...values.map((v) => Math.max(0, fin(v)))), 3)
  const rowH = b.ph / Math.max(1, n)
  const t = Math.min(thick, Math.max(4, rowH - 6))
  const bars = values.map((v, i) => {
    const w = Math.max(v > 0 ? 2 : 0, (Math.max(0, fin(v)) / max) * b.pw)
    return { i, x: r1(b.l), y: r1(b.t + i * rowH + (rowH - t) / 2), w: r1(w), h: r1(t), v }
  })
  return { plot: { l: b.l, t: b.t, w: b.pw, h: b.ph }, max, ticks: ticks.map((v) => ({ v, x: r1(b.l + (v / max) * b.pw) })), bars, rowH: r1(rowH) }
}

// ── lines and areas ──────────────────────────────────────────────────────────

/** Tangents of a monotone cubic through (x[i], y[i]): the curve never overshoots a data point. */
function monotoneTangents (xs, ys) {
  const n = xs.length
  const d = []
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]))
  const m = new Array(n).fill(0)
  if (n < 2) return m
  m[0] = d[0]; m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / d[i]; const bb = m[i + 1] / d[i]
    const s = a * a + bb * bb
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * bb * d[i] }
  }
  return m
}
/** A smooth path through points, and its length (sampled). */
export function smoothPath (pts) {
  if (pts.length === 0) return { d: '', length: 0 }
  if (pts.length === 1) return { d: 'M' + r1(pts[0].x) + ',' + r1(pts[0].y), length: 0 }
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y)
  const m = monotoneTangents(xs, ys)
  let d = 'M' + r1(xs[0]) + ',' + r1(ys[0])
  let length = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = xs[i + 1] - xs[i]
    const c1x = xs[i] + dx / 3; const c1y = ys[i] + (m[i] * dx) / 3
    const c2x = xs[i + 1] - dx / 3; const c2y = ys[i + 1] - (m[i + 1] * dx) / 3
    d += 'C' + r1(c1x) + ',' + r1(c1y) + ' ' + r1(c2x) + ',' + r1(c2y) + ' ' + r1(xs[i + 1]) + ',' + r1(ys[i + 1])
    let px = xs[i]; let py = ys[i]
    for (let s = 1; s <= 12; s++) {
      const t = s / 12; const u = 1 - t
      const x = u * u * u * xs[i] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * xs[i + 1]
      const y = u * u * u * ys[i] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ys[i + 1]
      length += Math.hypot(x - px, y - py); px = x; py = y
    }
  }
  return { d, length: Math.ceil(length) }
}

/**
 * series: number[][]; -> { plot, max, ticks, lines:[{s, points:[{x,y,v}], d, length, areaD}], hits:[{i,x,w}], labels, end:[{s,x,y,v}] }
 * The area closes down to the baseline; the hit bands are one per x position (full height), for a crosshair.
 */
export function lineLayout ({ series, labelCount, W, H, margin, labelEvery }) {
  const n = Math.max(0, Math.floor(fin(labelCount, (series[0] || []).length)))
  const b = box(W, H, Object.assign({ r: 56 }, margin || {}))
  let top = 0
  for (const s of series) for (let i = 0; i < n; i++) top = Math.max(top, fin(s[i]))
  const { max, ticks } = niceTicks(top, 4)
  const X = (i) => b.l + (n <= 1 ? b.pw / 2 : (i * b.pw) / (n - 1))
  const Y = (v) => b.t + b.ph - (Math.max(0, fin(v)) / max) * b.ph
  const base = b.t + b.ph
  const lines = series.map((vals, s) => {
    const points = []
    for (let i = 0; i < n; i++) points.push({ x: r1(X(i)), y: r1(Y(vals[i])), v: fin(vals[i]) })
    const p = smoothPath(points)
    const areaD = points.length > 1 ? p.d + 'L' + points[points.length - 1].x + ',' + r1(base) + 'L' + points[0].x + ',' + r1(base) + 'Z' : ''
    return { s, points, d: p.d, length: p.length, areaD }
  })
  const bw = n <= 1 ? b.pw : b.pw / (n - 1)
  const hits = []
  const labels = []
  const every = labelEvery !== undefined ? labelEvery : (n > 16 ? 5 : n > 8 ? 2 : 1)
  for (let i = 0; i < n; i++) {
    hits.push({ i, x: r1(X(i) - bw / 2), w: r1(bw) })
    if ((n - 1 - i) % every === 0) labels.push({ i, x: r1(X(i)) })
  }
  const end = lines.filter((l) => l.points.length > 0).map((l) => { const p = l.points[l.points.length - 1]; return { s: l.s, x: p.x, y: p.y, v: p.v } })
  return { plot: { l: b.l, t: b.t, w: b.pw, h: b.ph }, max, ticks: ticks.map((v) => ({ v, y: r1(Y(v)) })), lines, hits, labels, end, baseline: r1(base) }
}

// ── donut ────────────────────────────────────────────────────────────────────

/**
 * values -> stroked-circle segments: each is a circle of radius r with stroke-dasharray "len circ" and a negative dashoffset.
 * The caller turns the group by -90deg so the first segment starts at 12 o'clock. A small gap separates segments (`gapLen`).
 */
export function donutLayout ({ values, size, thickness = 18, gapLen = 2 }) {
  const total = values.reduce((a, v) => a + Math.max(0, fin(v)), 0)
  const r = Math.max(1, size / 2 - thickness / 2 - 1)
  const circ = 2 * Math.PI * r
  const segs = []
  let acc = 0
  values.forEach((v, i) => {
    const val = Math.max(0, fin(v))
    if (total <= 0 || val <= 0) return
    const frac = val / total
    const len = frac * circ
    const visible = Math.max(0.5, len - (values.length > 1 ? gapLen : 0))
    segs.push({ i, v: val, pct: Math.round(frac * 1000) / 10, len: r1(visible), offset: r1(acc * circ), circ: r1(circ) })
    acc += frac
  })
  return { cx: r1(size / 2), cy: r1(size / 2), r: r1(r), thickness, circ: r1(circ), total, segs }
}

// ── sankey ───────────────────────────────────────────────────────────────────

/**
 * cols: [[{name, v}]] per column, links: [[fromCol, fromIdx, toCol, toIdx, value]] (toCol = fromCol + 1).
 * -> { nodes:[{c,i,x,y,w,h,v,name}], links:[{a:[c,i], b:[c,i], d, w, v, length}], scale }
 */
export function sankeyLayout ({ cols, links, W, H, nodeW = 10, gap = 10, margin }) {
  const b = box(W, H, Object.assign({ l: 92, r: 104, t: 6, b: 6 }, margin || {}))
  let scale = Infinity
  let anyValue = false
  for (const c of cols) {
    const sum = c.reduce((a, n) => a + Math.max(0, fin(n.v)), 0)
    if (sum > 0) { anyValue = true; scale = Math.min(scale, (b.ph - gap * Math.max(0, c.length - 1)) / sum) }
  }
  if (!anyValue || !Number.isFinite(scale) || scale <= 0) return { nodes: [], links: [], scale: 0 }
  const colX = (ci) => b.l + (cols.length <= 1 ? 0 : (ci * (b.pw - nodeW)) / (cols.length - 1))
  const nodes = []
  const pos = cols.map((c, ci) => {
    const sum = c.reduce((a, n) => a + Math.max(0, fin(n.v)), 0)
    let y = b.t + (b.ph - (sum * scale + gap * Math.max(0, c.length - 1))) / 2
    return c.map((n, i) => {
      const h = Math.max(1, Math.max(0, fin(n.v)) * scale)
      const o = { c: ci, i, x: r1(colX(ci)), y: r1(y), w: nodeW, h: r1(h), v: Math.max(0, fin(n.v)), name: n.name, out: 0, inn: 0 }
      y += h + gap
      nodes.push(o)
      return o
    })
  })
  const out = []
  const sorted = links.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[3] - q[3])
  for (const l of sorted) {
    const a = pos[l[0]] && pos[l[0]][l[1]]; const t = pos[l[2]] && pos[l[2]][l[3]]
    if (a === undefined || t === undefined || fin(l[4]) <= 0) continue
    const w = Math.max(1, fin(l[4]) * scale)
    const x1 = a.x + nodeW; const x2 = t.x
    const y1 = a.y + a.out + w / 2; const y2 = t.y + t.inn + w / 2
    a.out += w; t.inn += w
    const mx = (x1 + x2) / 2
    out.push({ a: [l[0], l[1]], b: [l[2], l[3]], d: 'M' + r1(x1) + ',' + r1(y1) + 'C' + r1(mx) + ',' + r1(y1) + ' ' + r1(mx) + ',' + r1(y2) + ' ' + r1(x2) + ',' + r1(y2), w: r1(w), v: fin(l[4]), length: Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 1.15) })
  }
  return { nodes: nodes.map(({ out: _o, inn: _i, ...n }) => n), links: out, scale }
}

// ── flow ─────────────────────────────────────────────────────────────────────

/**
 * A calendar heatmap: one square per day, a week per column (Monday on top), the oldest day at the left.
 * keys: 'YYYY-MM-DD' in time order, values: numbers. -> { cells:[{i,key,x,y,s,level,v}], weeks, size, width, height, max }
 * level 0 is "nothing"; 1..4 are the busier days, on a square-root scale so one huge day does not wash out the rest.
 */
export function heatmapLayout ({ keys, values, W, H, gap = 3, maxCell = 30, minCell = 5 }) {
  const n = Math.min(arrLen(keys), arrLen(values))
  if (n === 0) return { cells: [], weeks: 0, size: 0, width: 0, height: 0, max: 0 }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(keys[0]))
  const first = m === null ? 0 : (new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay() + 6) % 7
  const weeks = Math.ceil((first + n) / 7)
  const s = clamp(Math.floor(Math.min((fin(W) - gap * (weeks - 1)) / weeks, (fin(H) - gap * 6) / 7)), minCell, maxCell)
  const width = weeks * s + (weeks - 1) * gap
  const x0 = Math.max(0, Math.round((fin(W) - width) / 2))
  let max = 0
  for (let i = 0; i < n; i++) max = Math.max(max, fin(values[i]))
  const cells = []
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, fin(values[i]))
    const col = Math.floor((first + i) / 7)
    const row = (first + i) % 7
    const level = v <= 0 || max <= 0 ? 0 : Math.min(4, 1 + Math.floor(Math.sqrt(v / max) * 4 - 1e-9))
    cells.push({ i, key: String(keys[i]), col, row, x: x0 + col * (s + gap), y: row * (s + gap), s, level, v })
  }
  return { cells, weeks, size: s, width, height: 7 * s + 6 * gap, max }
}
const arrLen = (a) => (Array.isArray(a) ? a.length : 0)

export const FLOW_NODE = { w: 180, h: 56 }
/** A cubic from the right edge of node a to the left edge of node b, and a rough length for dash animation. */
export function flowEdgePath (a, b, nw = FLOW_NODE.w, nh = FLOW_NODE.h) {
  const x1 = fin(a.x) + nw; const y1 = fin(a.y) + nh / 2; const x2 = fin(b.x); const y2 = fin(b.y) + nh / 2
  const mx = (x1 + x2) / 2
  return { d: 'M' + r1(x1) + ',' + r1(y1) + 'C' + r1(mx) + ',' + r1(y1) + ' ' + r1(mx) + ',' + r1(y2) + ' ' + r1(x2) + ',' + r1(y2), mx: r1(mx), my: r1((y1 + y2) / 2), length: Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 1.2) }
}

/** Sparkline points (x, y) inside a w x h box with a 4px inset, for values (a flat series sits in the middle). */
export function sparkPoints (values, w, h, inset = 4) {
  const n = values.length
  if (n === 0) return []
  let lo = Infinity; let hi = -Infinity
  for (const v of values) { lo = Math.min(lo, fin(v)); hi = Math.max(hi, fin(v)) }
  return values.map((v, i) => ({
    x: r1(inset + (n === 1 ? (w - 2 * inset) / 2 : (i * (w - 2 * inset)) / (n - 1))),
    y: r1(hi === lo ? h / 2 : h - inset - ((fin(v) - lo) / (hi - lo)) * (h - 2 * inset)),
  }))
}
