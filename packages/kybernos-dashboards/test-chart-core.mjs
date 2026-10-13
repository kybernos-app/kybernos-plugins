// kybernos-dashboards: chart geometry and motion maths. `cd packages/kybernos-dashboards && node test-chart-core.mjs`
import * as C from './chart-core.mjs'

let fail = 0
let passed = 0
const ok = (name, cond, detail) => {
  if (cond) { passed++; return }
  fail++
  console.log('FAIL ' + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)))
}
const finite = (o) => JSON.stringify(o).indexOf('null') < 0 && !/NaN|Infinity/.test(JSON.stringify(o))
const inside = (r, W, H) => r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= W + 0.01 && r.y + r.h <= H + 0.01

// ── motion maths ─────────────────────────────────────────────────────────────
ok('the easing starts at 0 and ends at 1', Math.abs(C.easeOutCubic(0)) < 1e-9 && Math.abs(C.easeOutCubic(1) - 1) < 1e-9)
ok('easings clamp their input', C.easeOutCubic(-3) === 0 && C.easeOutCubic(9) === 1)
ok('easeOutCubic never goes backwards', Array.from({ length: 21 }, (_, i) => C.easeOutCubic(i / 20)).every((v, i, a) => i === 0 || v >= a[i - 1]))
ok('countUpAt is monotone and lands on the target', Array.from({ length: 21 }, (_, i) => C.countUpAt(0, 1234, i / 20)).every((v, i, a) => i === 0 || v >= a[i - 1]) && C.countUpAt(0, 1234, 1) === 1234 && C.countUpAt(10, 50, 0) === 10)
ok('countUpAt never shows more than the target', Array.from({ length: 101 }, (_, i) => C.countUpAt(0, 80, i / 100)).every((v) => v <= 80 + 1e-9))
ok('countUpAt survives garbage', C.countUpAt(NaN, undefined, 'x') === 0)
{
  const d = Array.from({ length: 60 }, (_, i) => C.staggerDelay(i, 60))
  ok('stagger: starts at 0, never decreases', d[0] === 0 && d.every((v, i) => i === 0 || v >= d[i - 1]))
  ok('stagger: a 60-mark cascade is capped', d[59] <= 620, d[59])
  ok('stagger: a short list keeps the even step', C.staggerDelay(3, 5) === 84 && C.staggerDelay(0, 1) === 0)
}

// ── ticks ────────────────────────────────────────────────────────────────────
{
  const t = C.niceTicks(2.4, 4)
  ok('niceTicks: from 0, round steps, the top is a tick at or above the value', t.ticks[0] === 0 && t.max >= 2.4 && t.ticks[t.ticks.length - 1] === t.max && t.max === 3 && t.step === 1, t)
  const gaps = t.ticks.slice(1).map((v, i) => Math.round((v - t.ticks[i]) * 1000) / 1000)
  ok('niceTicks: steps are equal', new Set(gaps).size === 1, gaps)
  ok('niceTicks: known scales', C.niceTicks(4800, 4).max === 6000 && C.niceTicks(100, 4).max === 100 && C.niceTicks(7, 4).ticks.length <= 6 && C.niceTicks(0).max === 1 && C.niceTicks(-3).max === 1 && C.niceTicks(0.8, 4).max >= 0.8, [C.niceTicks(4800, 4), C.niceTicks(7, 4)])
  ok('niceTicks: always covers the value, with a handful of ticks', [0.03, 0.3, 1, 2.4, 7, 13, 99, 101, 4800, 1e7 + 1, 3e11].every((v) => { const k = C.niceTicks(v, 4); return k.max >= v && k.ticks.length >= 2 && k.ticks.length <= 8 }))
}

// ── columns ──────────────────────────────────────────────────────────────────
{
  const series = [[3, 1, 0, 5], [1, 1, 0, 2], [0.5, 0, 0, 1]]
  const W = 400; const H = 200
  const L = C.columnsLayout({ series, labelCount: 4, W, H, mode: 'stack' })
  ok('columns stack: finite', finite(L))
  ok('columns stack: every bar inside the plot', L.bars.every((b) => b.x >= L.plot.l - 0.01 && b.x + b.w <= L.plot.l + L.plot.w + 0.01 && b.y >= L.plot.t - 0.01 && b.y + b.h <= L.plot.t + L.plot.h + 0.01), L.bars[0])
  ok('columns stack: bars are at most 24px wide', L.bars.every((b) => b.w <= 24.01))
  const col0 = L.bars.filter((b) => b.i === 0)
  ok('columns stack: segments touch the baseline then climb, 2px apart', col0.length === 3 && col0[0].y > col0[1].y && col0[1].y > col0[2].y && Math.abs((col0[0].y - (col0[1].y + col0[1].h)) - 2) < 0.2, col0)
  ok('columns stack: the highest segment of each stack is the rounded one', L.bars.filter((b) => b.i === 0).filter((b) => b.top).length === 1 && L.bars.filter((b) => b.i === 0 && b.top)[0].s === 2)
  ok('columns stack: an empty column draws nothing', L.bars.filter((b) => b.i === 2).length === 0)
  const heights = (i) => L.bars.filter((b) => b.i === i).reduce((a, b) => a + b.h + 2, 0)
  ok('columns stack: the tallest stack reaches its value on the scale', Math.abs(heights(3) - (8 / L.max) * L.plot.h) < 3, [heights(3), (8 / L.max) * L.plot.h])
  ok('columns: one hit band and the last label always shown', L.hits.length === 4 && L.labels.some((l) => l.i === 3))
  const G = C.columnsLayout({ series, labelCount: 4, W, H, mode: 'group' })
  ok('columns group: side by side, inside their slot', G.bars.length === 8 && inside({ x: G.bars[0].x, y: G.bars[0].y, w: G.bars[0].w, h: G.bars[0].h }, W, H) && G.bars.filter((b) => b.i === 0).every((b, k, a) => k === 0 || b.x > a[k - 1].x))
  const E = C.columnsLayout({ series: [], labelCount: 0, W, H })
  ok('columns: empty input draws nothing, no NaN', E.bars.length === 0 && finite(E))
  const Z = C.columnsLayout({ series: [[0, 0, 0]], labelCount: 3, W, H })
  ok('columns: all zeros draws nothing, no NaN', Z.bars.length === 0 && finite(Z) && Z.max >= 1)
  const T = C.columnsLayout({ series: [[1e12, 5e11]], labelCount: 2, W: 120, H: 80 })
  ok('columns: huge values and a tiny box stay finite', finite(T) && T.bars.every((b) => b.h > 0))
  const many = C.columnsLayout({ series: [Array.from({ length: 90 }, (_, i) => i % 7)], labelCount: 90, W: 300, H: 120 })
  ok('columns: 90 bars thin out their labels', many.labels.length <= 20 && many.labels.length >= 3, many.labels.length)
}

// ── horizontal bars ──────────────────────────────────────────────────────────
{
  const L = C.hbarsLayout({ values: [4.8, 2.9, 1.4, 0.4, 0], W: 380, H: 220 })
  ok('hbars: finite and inside', finite(L) && L.bars.every((b) => b.x >= L.plot.l - 0.01 && b.x + b.w <= L.plot.l + L.plot.w + 0.01 && b.y >= 0 && b.y + b.h <= 220))
  ok('hbars: width follows the value, 0 stays 0', L.bars[0].w > L.bars[1].w && L.bars[1].w > L.bars[2].w && L.bars[4].w === 0)
  ok('hbars: a tiny value is still visible', L.bars[3].w >= 2)
  ok('hbars: rows do not overlap', L.bars.every((b, i, a) => i === 0 || b.y >= a[i - 1].y + a[i - 1].h))
  ok('hbars: empty is empty', C.hbarsLayout({ values: [], W: 300, H: 100 }).bars.length === 0)
}

// ── lines ────────────────────────────────────────────────────────────────────
{
  const vals = [10, 40, 35, 80, 60, 120]
  const L = C.lineLayout({ series: [vals], labelCount: 6, W: 400, H: 200 })
  const line = L.lines[0]
  ok('line: one point per value, left to right', line.points.length === 6 && line.points.every((p, i, a) => i === 0 || p.x > a[i - 1].x), line.points)
  ok('line: higher values are higher on screen', line.points[5].y < line.points[0].y)
  ok('line: the path is longer than the chord', line.length > Math.hypot(line.points[5].x - line.points[0].x, line.points[5].y - line.points[0].y))
  ok('line: the curve never overshoots its data (monotone cubic)', (() => {
    const nums = line.d.match(/-?\d+(\.\d+)?/g).map(Number)
    const ys = nums.filter((_, i) => i % 2 === 1) // after M x,y every number pair is x,y
    const lo = Math.min(...line.points.map((p) => p.y)); const hi = Math.max(...line.points.map((p) => p.y))
    return ys.length === 1 + 3 * 5 && ys.every((y) => y >= lo - 0.11 && y <= hi + 0.11)
  })(), line.d)
  ok('line: the area closes to the baseline', line.areaD.endsWith('Z') && line.areaD.includes('L' + line.points[5].x + ',' + L.baseline))
  ok('line: the end marker is the last point', L.end.length === 1 && L.end[0].x === line.points[5].x && L.end[0].v === 120)
  ok('line: finite', finite(L))
  const flat = C.lineLayout({ series: [[5, 5, 5]], labelCount: 3, W: 300, H: 120 })
  ok('line: a flat series stays flat', new Set(flat.lines[0].points.map((p) => p.y)).size === 1 && finite(flat))
  const one = C.lineLayout({ series: [[7]], labelCount: 1, W: 300, H: 120 })
  ok('line: a single point is centred and has no length', one.lines[0].points.length === 1 && one.lines[0].length === 0 && finite(one))
  ok('line: no data is no line', C.lineLayout({ series: [[]], labelCount: 0, W: 300, H: 120 }).lines[0].d === '')
  const zig = C.smoothPath([{ x: 0, y: 50 }, { x: 10, y: 0 }, { x: 20, y: 50 }, { x: 30, y: 0 }])
  ok('smoothPath: the curve is made of cubic segments', (zig.d.match(/C/g) || []).length === 3 && zig.length > 90)
}

// ── donut ────────────────────────────────────────────────────────────────────
{
  const D = C.donutLayout({ values: [50, 30, 20], size: 160, thickness: 18 })
  ok('donut: segments add up to the whole circle (less the gaps)', Math.abs(D.segs.reduce((a, s) => a + s.len, 0) - (D.circ - 3 * 2)) < 1.1, D.segs.map((s) => s.len))
  ok('donut: each starts where the previous ended', D.segs.every((s, i, a) => i === 0 || Math.abs(s.offset - (a[i - 1].offset + a[i - 1].len + 2)) < 1.1))
  ok('donut: percentages add to 100', Math.abs(D.segs.reduce((a, s) => a + s.pct, 0) - 100) < 0.2)
  ok('donut: fits its box', D.r + D.thickness / 2 <= 80)
  ok('donut: a zero is skipped, one value is a ring without a gap', C.donutLayout({ values: [0, 5], size: 100 }).segs.length === 1 && C.donutLayout({ values: [5], size: 100 }).segs[0].len > C.donutLayout({ values: [5], size: 100 }).circ - 1)
  ok('donut: nothing to show', C.donutLayout({ values: [0, 0], size: 100 }).segs.length === 0 && finite(C.donutLayout({ values: [], size: 100 })))
}

// ── sankey ───────────────────────────────────────────────────────────────────
{
  const cols = [[{ name: 'A', v: 9 }, { name: 'B', v: 3 }], [{ name: 'x', v: 7 }, { name: 'y', v: 5 }]]
  const links = [[0, 0, 1, 0, 7], [0, 0, 1, 1, 2], [0, 1, 1, 1, 3]]
  const S = C.sankeyLayout({ cols, links, W: 520, H: 260 })
  ok('sankey: a node per input, links per link', S.nodes.length === 4 && S.links.length === 3 && finite(S))
  ok('sankey: node height is proportional to its value', Math.abs(S.nodes[0].h / S.nodes[1].h - 3) < 0.05, S.nodes.map((n) => n.h))
  ok('sankey: nodes stay in the box and do not overlap in a column', S.nodes.every((n) => n.y >= 0 && n.y + n.h <= 260 + 0.01) && S.nodes.filter((n) => n.c === 0).every((n, i, a) => i === 0 || n.y >= a[i - 1].y + a[i - 1].h))
  ok('sankey: ribbon width is proportional to the flow', Math.abs(S.links[0].w / S.links[1].w - 3.5) < 0.1, S.links.map((l) => l.w))
  ok('sankey: ribbons leave the right edge of the left node', S.links.every((l) => l.d.startsWith('M' + (S.nodes.find((n) => n.c === l.a[0] && n.i === l.a[1]).x + 10))))
  ok('sankey: a ribbon that ends in a node never exceeds the node', (() => { const used = {}; for (const l of S.links) { const k = l.b.join(':'); used[k] = (used[k] || 0) + l.w } return S.nodes.filter((n) => n.c === 1).every((n) => (used[n.c + ':' + n.i] || 0) <= n.h + 0.3) })())
  ok('sankey: empty is empty', C.sankeyLayout({ cols: [[], []], links: [], W: 300, H: 200 }).nodes.length === 0)
  ok('sankey: a link to a missing node is ignored', C.sankeyLayout({ cols, links: [[0, 0, 1, 9, 5]], W: 400, H: 200 }).links.length === 0)
}

// ── flow + sparkline + paths ─────────────────────────────────────────────────
{
  const e = C.flowEdgePath({ x: 0, y: 0 }, { x: 300, y: 100 })
  ok('flow edge: from the right edge of a to the left edge of b', e.d.startsWith('M180,28') && e.d.endsWith('300,128') && e.length > 150 && finite(e))
  const s = C.sparkPoints([1, 5, 3], 96, 34)
  ok('spark: inside the box with its inset, higher is higher', s.length === 3 && s.every((p) => p.x >= 4 && p.x <= 92 && p.y >= 4 && p.y <= 30) && s[1].y < s[0].y)
  ok('spark: flat is centred, none is none', C.sparkPoints([2, 2], 96, 34)[0].y === 17 && C.sparkPoints([], 96, 34).length === 0 && C.sparkPoints([9], 96, 34)[0].x === 48)
  ok('roundedTopPath: square at the baseline, round at the end', C.roundedTopPath(10, 20, 24, 50, 4).startsWith('M10,70V24Q10,20 14,20') && C.roundedTopPath(10, 20, 2, 1, 4).length > 0)
  ok('roundedRightPath: grows to the right', C.roundedRightPath(10, 20, 100, 14, 4).startsWith('M10,20H106Q110,20'))
}

// ── heatmap ─────────────────────────────────────────────────────────────────
{
  // Tue 13 Oct 2026 is a Tuesday: the first cell of a run starting there is row 1 (Monday is row 0)
  const days = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']
  const L = C.heatmapLayout({ keys: days, values: [0, 1, 4, 9, 16, 0, 100, 25], W: 400, H: 140 })
  ok('heatmap: a cell per day, a week per column', L.cells.length === 8 && L.weeks === 2, [L.cells.length, L.weeks])
  ok('heatmap: Monday is the top row, the first day (a Tuesday) sits on row 1', L.cells[0].y === L.size + 3 && L.cells[6].y === 0 && L.cells[6].x > L.cells[0].x, L.cells.map((c) => [c.x, c.y]))
  ok('heatmap: the busiest day is level 4, an empty one is level 0, the others in between', L.cells[6].level === 4 && L.cells[0].level === 0 && L.cells[1].level >= 1 && L.cells[1].level <= 2, L.cells.map((c) => c.level))
  ok('heatmap: square root scale keeps small days visible next to a huge one (4 of 100 is level 1, 25 of 100 level 2)', L.cells[2].level === 1 && L.cells[7].level === 2, [L.cells[2].level, L.cells[7].level])
  ok('heatmap: the grid fits its box and is centred', L.width <= 400 && L.height <= 140 && L.cells.every((c) => c.x >= 0 && c.x + c.s <= 400 && c.y + c.s <= 140))
  ok('heatmap: nothing in, nothing out', C.heatmapLayout({ keys: [], values: [], W: 100, H: 100 }).cells.length === 0)
  ok('heatmap: junk values do not throw', C.heatmapLayout({ keys: ['x'], values: [NaN], W: 100, H: 100 }).cells[0].level === 0)
}

console.log(fail === 0 ? 'chart-core: ok (' + passed + ' checks)' : fail + ' failed of ' + (passed + fail))
process.exit(fail ? 1 : 0)
