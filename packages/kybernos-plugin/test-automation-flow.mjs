// Test of the pure part of the automation canvas (the Workflow tab and the graph of a run): where each card goes, how the wires run,
// what a canvas style changes, what a dragged card keeps. It extracts the KB-AUTOFLOW block of client.js (the file is a browser bundle
// with no exports), then checks on the source the contract of the canvas that draws it.
// Usage: node packages/kybernos-plugin/test-automation-flow.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
const parts = src.split('// KB-AUTOFLOW-BEGIN')
if (parts.length !== 2) { console.error('exactly one KB-AUTOFLOW block expected in client.js'); process.exit(1) }
const block = parts[1].split('// KB-AUTOFLOW-END')[0]
const names = ['KB_FLOW_NW', 'KB_FLOW_STYLES', 'kbFlowStyleOf', 'kbFlowGrid', 'kbFlowBase', 'kbFlowRounded', 'kbFlowRoute', 'kbFlowCoords', 'kbFlowOffsetsClean', 'kbFlowDragOffset', 'kbFlowScale']
const m = await import('data:text/javascript,' + encodeURIComponent(block + '\nexport { ' + names.join(', ') + ' }'))

let fails = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}
const yes = (label, cond) => eq(label, cond === true, true)

/* ── styles ──────────────────────────────────────────────────────────────── */
eq('nine styles, in order', m.KB_FLOW_STYLES.map((s) => s.id), ['auto', 'nr', 'bp', 'pp', 'sf', 'lg', 'at', 'jy', 'mx'])
eq('an unknown or missing style is the first one (it follows the app)', [m.kbFlowStyleOf('nope').id, m.kbFlowStyleOf(null).id, m.kbFlowStyleOf(undefined).id], ['auto', 'auto', 'auto'])
eq('a known style comes back as itself', m.kbFlowStyleOf('mx').id, 'mx')
yes('every style has a height, a bend radius and a wire kind', m.KB_FLOW_STYLES.every((s) => s.nh >= 80 && s.r > 0 && (s.wire === 'orth' || s.wire === 'bez')))
eq('only two styles put an arrowhead on a wire, only one shows the amounts', [m.KB_FLOW_STYLES.filter((s) => s.arrow).map((s) => s.id), m.KB_FLOW_STYLES.filter((s) => s.val).map((s) => s.id)], [['jy', 'mx'], ['mx']])

/* ── the grid ─────────────────────────────────────────────────────────────── */
const chain = (n, triggers) => { const c = []; for (let i = 0; i < triggers; i++) c.push({ id: 't' + i, trg: true }); for (let i = 0; i < n; i++) c.push({ id: 's' + i, trg: false }); return c }
{
  const g = m.kbFlowGrid(chain(6, 1))
  eq('the trigger takes the first place, the steps follow four to a row', g.map((x) => x.id + ':' + x.row + ',' + x.col + ',' + x.lane), ['t0:0,0,0', 's0:0,1,0', 's1:0,2,0', 's2:0,3,0', 's3:1,0,0', 's4:1,1,0', 's5:1,2,0'])
  const g2 = m.kbFlowGrid(chain(2, 2))
  eq('a second trigger sits under the first one, the steps start after them', g2.map((x) => x.id + ':' + x.row + ',' + x.col + ',' + x.lane), ['t0:0,0,0', 't1:0,0,1', 's0:0,1,0', 's1:0,2,0'])
  eq('a third trigger is an ordinary card, not a third lane', m.kbFlowGrid(chain(0, 3)).map((x) => x.lane), [0, 1, 0])
  eq('the number of columns can change', m.kbFlowGrid(chain(5, 1), 3).map((x) => x.row + ',' + x.col).join(' '), '0,0 0,1 0,2 1,0 1,1 1,2')
  eq('no card, no place', m.kbFlowGrid([]), [])
}
{
  const st = m.kbFlowStyleOf('auto')
  const b = m.kbFlowBase(m.kbFlowGrid(chain(6, 1)), st.nh)
  eq('the first card is at the padding', b.pos.t0, { x: 70, y: 54 })
  eq('the second row starts one card, one gap lower', b.pos.s3.y - b.pos.t0.y, st.nh + 52)
  eq('the canvas is as wide as its columns, not wider', b.W, 70 * 2 + 4 * 212 + 3 * 52)
  const b2 = m.kbFlowBase(m.kbFlowGrid(chain(6, 2)), st.nh)
  eq('a lane under the first row pushes the next row down by a card and a lane', b2.pos.s3.y - b.pos.s3.y, st.nh + 22)
  const b3 = m.kbFlowBase(m.kbFlowGrid(chain(1, 1)), st.nh)
  eq('two cards make a two-column canvas', b3.W, 70 * 2 + 2 * 212 + 52)
  yes('a taller style makes a taller canvas', m.kbFlowBase(m.kbFlowGrid(chain(6, 1)), 132).H > b.H)
}

/* ── the wires ────────────────────────────────────────────────────────────── */
const links = (cards) => cards.slice(1).map((c, i) => ({ from: cards[i].id, to: c.id }))
const hits = (pts, box) => { // does an axis-aligned polyline go through the inside of a box?
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1]
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by)
    if (x1 > box.x + 1 && x0 < box.x + box.w - 1 && y1 > box.y + 1 && y0 < box.y + box.h - 1) return true
  }
  return false
}
for (const sid of ['auto', 'nr', 'bp', 'pp', 'sf', 'lg', 'at', 'jy', 'mx']) {
  const st = m.kbFlowStyleOf(sid)
  for (const [n, t] of [[6, 1], [8, 2], [11, 1], [3, 1]]) {
    const cards = chain(n, t)
    const ln = links(cards)
    if (t === 2) ln.splice(0, 1, { from: 't0', to: 's0' }, { from: 't1', to: 's0' })
    const c = m.kbFlowCoords(cards, ln, { style: st })
    let crossed = 0
    ln.forEach((l, i) => {
      const w = c.wires[i]
      if (w === null) { crossed += 100; return }
      for (const k of cards) {
        if (k.id === l.from || k.id === l.to) continue
        if (w.pts.length > 2 && hits(w.pts, { x: c.pos[k.id].x, y: c.pos[k.id].y, w: 212, h: st.nh })) crossed++
      }
    })
    eq('style ' + sid + ', ' + n + ' steps, ' + t + ' trigger(s): no right-angle wire goes through a card', crossed, 0)
  }
}
{
  const st = m.kbFlowStyleOf('auto')
  const c = m.kbFlowCoords(chain(6, 1), links(chain(6, 1)), { style: st })
  eq('two cards in a row are joined by a straight wire', c.wires[0].d, 'M' + (70 + 212) + ' ' + (54 + 46) + ' L' + (70 + 212 + 52) + ' ' + (54 + 46))
  const back = c.wires[3] // s2 (end of row 0) -> s3 (start of row 1)
  yes('a wire to the row below leaves to the right, runs in the gap and comes in from the left', back.pts.length === 6 && back.pts[0][0] < back.pts[1][0] && back.pts[3][0] < back.pts[2][0] && back.pts[2][1] > 54 + st.nh && back.pts[2][1] < 54 + st.nh + 52 + st.nh)
  eq('the label of a wire sits on its longest stretch', c.wires[0].mid, [70 + 212 + 26, 54 + 46])
  const two = m.kbFlowCoords(chain(2, 2), [{ from: 't1', to: 's0' }], { style: st })
  yes('the webhook, under the schedule, joins the first step with a bend', two.wires[0].pts.length === 4)
  const bez = m.kbFlowCoords(chain(2, 2), [{ from: 't1', to: 's0' }], { style: m.kbFlowStyleOf('nr') })
  yes('a curved style draws a curve for a forward wire at another height', bez.wires[0].d.indexOf(' C') > 0)
  const bezBack = m.kbFlowCoords(chain(6, 1), links(chain(6, 1)), { style: m.kbFlowStyleOf('nr') })
  yes('...but the wire that wraps a row stays at right angles', bezBack.wires[3].d.indexOf(' C') < 0 && bezBack.wires[3].d.indexOf(' Q') > 0)
  eq('a link to a card that does not exist has no wire', m.kbFlowCoords(chain(2, 1), [{ from: 't0', to: 'zz' }], { style: st }).wires, [null])
}

/* ── dragging ─────────────────────────────────────────────────────────────── */
{
  const st = m.kbFlowStyleOf('auto')
  const cards = chain(6, 1)
  const ln = links(cards)
  const plain = m.kbFlowCoords(cards, ln, { style: st })
  const moved = m.kbFlowCoords(cards, ln, { style: st, offsets: { s5: { dx: 400, dy: 120 } } })
  eq('a dragged card is at its default place plus its offset', moved.pos.s5, { x: plain.pos.s5.x + 400, y: plain.pos.s5.y + 120 })
  eq('its default place is still known', moved.base.s5, plain.pos.s5)
  yes('the canvas grows when a card goes beyond it', moved.W > plain.W && moved.H > plain.H)
  yes('the wire into a dragged card is drawn again', moved.wires[5].d !== plain.wires[5].d)
  eq('the other wires do not change', moved.wires[0].d, plain.wires[0].d)
  const tall = m.kbFlowCoords(cards, ln, { style: m.kbFlowStyleOf('lg'), offsets: { s5: { dx: 0, dy: 40 } } })
  eq('with taller cards the offset is kept from the new default place', tall.pos.s5.y - tall.base.s5.y, 40)
  eq('a card cannot be dragged out of the canvas on the top or the left', m.kbFlowDragOffset({ x: 70, y: 54 }, { x: 70, y: 54 }, -500, -500), { dx: 8 - 70, dy: 8 - 54 })
  eq('an offset is relative to the default place', m.kbFlowDragOffset({ x: 300, y: 100 }, { x: 320, y: 110 }, 30, -20), { dx: 50, dy: -10 })
  eq('saved offsets of cards that do not exist, or that are not numbers, are dropped', m.kbFlowOffsetsClean({ s1: { dx: 5.4, dy: -3 }, gone: { dx: 1, dy: 1 }, s2: { dx: 'a', dy: 1 }, s3: { dx: NaN, dy: 1 }, s4: null, s5: { dx: 99999, dy: -99999 } }, ['s1', 's2', 's3', 's4', 's5']), { s1: { dx: 5, dy: -3 }, s5: { dx: 3000, dy: -3000 } })
  eq('saved offsets that are not an object are nothing', [m.kbFlowOffsetsClean(null, ['a']), m.kbFlowOffsetsClean([1], ['a']), m.kbFlowOffsetsClean('x', ['a'])], [{}, {}, {}])
}

/* ── the scale ────────────────────────────────────────────────────────────── */
eq('a canvas that fits is not scaled up', m.kbFlowScale(800, 400, 1600, 900), 1)
eq('a canvas that is too wide is scaled down to fit', m.kbFlowScale(1000, 400, 508, 900), 0.74)
eq('a canvas that is a little too wide is scaled to its frame', Math.round(m.kbFlowScale(1000, 400, 908, 900) * 100) / 100, 0.9)
eq('below the minimum it stops shrinking and scrolls', m.kbFlowScale(2000, 400, 500, 900), 0.74)
eq('an unmeasured frame shows the canvas at its size', m.kbFlowScale(1000, 400, 0, 0), 1)

console.log(fails === 0 ? '\nall passed' : '\n' + fails + ' failed')
process.exit(fails === 0 ? 0 : 1)
