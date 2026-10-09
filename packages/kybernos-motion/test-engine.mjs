// Engine tests: pure Node, no DSH, no browser. `cd packages/kybernos-motion && node test-engine.mjs`
import * as E from './engine.mjs'

let fail = 0
let n = 0
const ok = (name, cond, detail) => {
  n++
  if (cond) return
  fail++
  console.log(`FAIL ${name}${detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`)
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const op = (frame, layer) => frame.ops.filter((o) => o.layer === layer)

// ── validate ────────────────────────────────────────────────────────────────
{
  const v = E.validate({ format: { width: 1280, height: 720, fps: 24, duration: 3 }, layers: [{ type: 'rect', w: 200 }] })
  ok('validate: a minimal scene is ok', v.ok === true && v.errors.length === 0, v.errors)
  ok('validate: scene is marked normalised', v.scene._n === true)
  ok('validate: defaults applied', v.scene.layers[0].h === 100 && v.scene.layers[0].fill === '#ffffff' && v.scene.layers[0].alpha === 1)
  ok('validate: format kept', v.scene.format.width === 1280 && v.scene.format.fps === 24 && v.scene.format.duration === 3)
}
{
  const v = E.validate(null)
  ok('validate: null never throws and gives a usable scene', v.ok === false && v.scene.layers.length === 0 && v.scene.format.width === 1920)
  const v2 = E.validate('hello')
  ok('validate: a string is refused', v2.ok === false)
  const v3 = E.validate({ layers: 'nope' })
  ok('validate: layers must be a list', v3.errors.some((e) => e.includes('layers: expected a list')), v3.errors)
}
{
  const v = E.validate({ format: { width: 99999, height: 1, fps: 500, duration: 99999 }, layers: [] })
  ok('validate: format is clamped', v.scene.format.width === 4096 && v.scene.format.height === 64 && v.scene.format.fps === 60 && v.scene.format.duration === 300, v.scene.format)
}
{
  const v = E.validate({ layers: [{ type: 'rect', evil: 'x', onclick: 'alert(1)', w: 5 }, { type: 'script' }, { type: 'text', text: 'hi', size: 99999 }] })
  ok('validate: unknown property is reported and dropped', v.errors.some((e) => e.includes('layers[0].evil')) && !('evil' in v.scene.layers[0]) && !('onclick' in v.scene.layers[0]), v.errors)
  ok('validate: unknown type is refused with the list of known ones', v.errors.some((e) => e.includes('unknown type "script"') && e.includes('rect')), v.errors)
  ok('validate: the refused layer is not kept', v.scene.layers.length === 2)
  ok('validate: numbers are clamped', v.scene.layers[1].size === 2000)
}
{
  const v = E.validate({ layers: [{ type: 'rect', x: { k: [[2, 100], [0, 0], [1, 50, 'io'], [1, 60]] } }] })
  const k = v.scene.layers[0].x.k
  ok('validate: keyframes are sorted and deduplicated by time', k.length === 3 && k[0][0] === 0 && k[1][0] === 1 && k[1][1] === 60 && k[2][0] === 2, k)
}
{
  const v = E.validate({ layers: [{ type: 'rect', x: 'abc', fill: 'not-a-colour', alpha: { k: [['a', 1]] } }] })
  ok('validate: bad values fall back to the default and say so', v.errors.length === 3 && v.scene.layers[0].x === 0 && v.scene.layers[0].fill === '#ffffff', v.errors)
}
{
  const v = E.validate({ params: { a: 'x', 'bad name': 1, n: 3, ok: true, o: {} }, layers: [] })
  ok('validate: params keep only plain values with safe names', Object.keys(v.scene.params).sort().join() === 'a,n,ok' && v.errors.length === 1, [v.scene.params, v.errors])
}
{
  let deep = { type: 'group', layers: [] }
  let cur = deep
  for (let i = 0; i < 8; i++) { const c = { type: 'group', layers: [] }; cur.layers.push(c); cur = c }
  const v = E.validate({ layers: [deep] })
  ok('validate: group nesting is bounded', v.errors.some((e) => e.includes('nest at most')), v.errors)
  const many = { layers: Array.from({ length: E.LIMITS.layers + 50 }, () => ({ type: 'rect' })) }
  const vm = E.validate(many)
  ok('validate: layer count is bounded', vm.scene.layers.length === E.LIMITS.layers && vm.errors.some((e) => e.includes('too many layers')))
}
{
  const v = E.validate({ background: { gradient: { angle: 45, stops: [[0, '#000000'], [1, '#ffffff']] } }, layers: [{ type: 'rect', fill: { gradient: { stops: [[0, '#ff0000'], [1, '#0000ff']] } } }] })
  ok('validate: gradients are accepted for background and fill', v.ok === true && v.scene.background.gradient.stops.length === 2 && v.scene.layers[0].fill.gradient.angle === 90, v.errors)
  const bad = E.validate({ background: { gradient: { stops: [[0, '#000']] } }, layers: [] })
  ok('validate: a one-stop gradient is refused', bad.errors.some((e) => e.startsWith('background')))
}
{
  const v = E.validate({ audio: [{ synth: 'whoosh', at: 1 }, { synth: 'laser' }, { src: 'a.mp3', volume: 5, fadeOut: 2 }, { nothing: 1 }], layers: [] })
  ok('validate: audio keeps known synths and files, refuses the rest', v.scene.audio.length === 2 && v.scene.audio[1].volume === 2 && v.errors.length === 2, v.errors)
}
{
  const v = E.validate({ params: { titre: 'x', couleur: '#ff0000', n: 4 }, controls: [{ id: 'titre', label: 'Titre' }, { id: 'couleur' }, { id: 'n' }, { id: 'ghost' }], layers: [] })
  ok('validate: controls infer their type from the param and drop unknown ids', v.scene.controls.length === 3 && v.scene.controls[0].type === 'text' && v.scene.controls[1].type === 'color' && v.scene.controls[2].type === 'number', v.scene.controls)
}

{
  const v = E.validate({ format: { width: 1000, height: 600 }, layers: [{ type: 'rect', name: 'a' }, { type: 'group', x: 5, layers: [{ type: 'rect', name: 'b' }] }] })
  ok('validate: a top-level layer without x,y sits at the centre of the frame', v.scene.layers[0].x === 500 && v.scene.layers[0].y === 300, v.scene.layers[0])
  ok('validate: a child layer without x,y sits on its group origin', v.scene.layers[1].layers[0].x === 0 && v.scene.layers[1].x === 5)
  const l = E.evaluate({ layers: [{ type: 'line', x: 0, y: 0 }] }, 0).ops[0]
  ok('line: without x2,y2 it runs 200px to the right', l.x2 === 200 && l.y2 === 0)
}

// ── easing ──────────────────────────────────────────────────────────────────
for (const name of E.EASE_NAMES) {
  ok(`ease ${name}: starts at 0 and ends at 1`, near(E.EASES[name](0), 0, 1e-9) && near(E.EASES[name](1), 1, 1e-9), [E.EASES[name](0), E.EASES[name](1)])
}
ok('ease back overshoots', E.EASES.back(0.7) > 1)
ok('ease out is faster than linear at the start', E.EASES.out(0.2) > 0.2)
{
  const f = E.evaluate({ layers: [{ type: 'rect', w: 10, h: 10, x: { k: [[0, 0], [1, 100, [0.25, 0.1, 0.25, 1]]] } }] }, 0.5)
  const x = f.ops[0].m[4]
  ok('ease: a cubic-bezier array is accepted', x > 40 && x < 100, x)
}

// ── colours ─────────────────────────────────────────────────────────────────
ok('colour: #rgb', JSON.stringify(E.parseColor('#f80')) === '[255,136,0,1]')
ok('colour: #rrggbbaa', near(E.parseColor('#11223380')[3], 128 / 255, 1e-9))
ok('colour: junk is null', E.parseColor('red') === null && E.parseColor('#12') === null && E.parseColor(5) === null)
ok('contrast: black on white is 21', near(E.contrast([0, 0, 0], [255, 255, 255]), 21, 1e-6))
ok('inkOn: light ink on dark, dark ink on light', E.inkOn('#0f1115') === '#f5f6f7' && E.inkOn('#f5f6f7') === '#0f1115' && E.inkOn('#efe9dc') === '#0f1115')
{
  const f = E.evaluate({ layers: [{ type: 'rect', fill: { k: [[0, '#000000'], [1, '#ffffff', 'lin']] } }] }, 0.5)
  ok('colour: keyframed fills blend', f.ops[0].fill === '#808080' || f.ops[0].fill === '#7f7f7f', f.ops[0].fill)
}

// ── evaluate: values, params, windows ───────────────────────────────────────
{
  const scene = { format: { duration: 5 }, params: { entree: 'out', accent: '#4176e6' }, layers: [
    { type: 'rect', name: 'A', w: 100, h: 100, x: { k: [[1, 100], [2, 300, '$entree']] }, fill: '$accent' },
    { type: 'rect', name: 'B', w: 10, h: 10, start: 2, end: 3 },
    { type: 'rect', name: 'C', w: 10, h: 10, alpha: 0 },
  ] }
  const f0 = E.evaluate(scene, 0)
  ok('evaluate: before the first key the first value holds', f0.ops[0].m[4] === 100)
  const f2 = E.evaluate(scene, 2)
  ok('evaluate: on a key the exact value', f2.ops[0].m[4] === 300)
  const f15 = E.evaluate(scene, 1.5)
  ok('evaluate: between keys the eased value', near(f15.ops[0].m[4], 100 + 200 * E.EASES.out(0.5), 1e-9), f15.ops[0].m[4])
  const lin = E.evaluate(scene, 1.5, { entree: 'lin' })
  ok('evaluate: an easing can be a param', near(lin.ops[0].m[4], 200, 1e-9), lin.ops[0].m[4])
  ok('evaluate: a colour can be a param', f0.ops[0].fill === '#4176e6')
  const blue = E.evaluate(scene, 0, { accent: '#ff0000' })
  ok('evaluate: overrides win over scene params', blue.ops[0].fill === '#ff0000')
  ok('evaluate: start/end window hides a layer', op(E.evaluate(scene, 1), 'B').length === 0 && op(E.evaluate(scene, 2.5), 'B').length === 1 && op(E.evaluate(scene, 3.5), 'B').length === 0)
  ok('evaluate: alpha 0 draws nothing', op(f0, 'C').length === 0)
  const past = E.evaluate(scene, 99)
  ok('evaluate: time is clamped to the duration', past.t === 5)
  ok('evaluate: deterministic', JSON.stringify(E.evaluate(scene, 1.234)) === JSON.stringify(E.evaluate(scene, 1.234)))
}

// ── evaluate: groups and transforms ─────────────────────────────────────────
{
  const f = E.evaluate({ layers: [{ type: 'group', x: 100, y: 50, alpha: 0.5, layers: [{ type: 'rect', w: 10, h: 10, x: 20, y: 30, alpha: 0.5 }] }] }, 0)
  const o = f.ops[0]
  ok('group: child is placed relative to the group', o.m[4] === 120 && o.m[5] === 80, o.m)
  ok('group: alpha multiplies down the tree', near(o.alpha, 0.25))
  const r = E.evaluate({ layers: [{ type: 'group', x: 0, y: 0, rot: 90, layers: [{ type: 'rect', w: 10, h: 10, x: 10, y: 0 }] }] }, 0).ops[0]
  ok('group: rotation turns the child around the group origin', near(r.m[4], 0, 1e-9) && near(r.m[5], 10, 1e-9), r.m)
  const s = E.evaluate({ layers: [{ type: 'group', x: 0, y: 0, sx: 2, sy: 2, layers: [{ type: 'circle', r: 10, x: 5 }] }] }, 0).ops[0]
  ok('group: scale applies to the child', s.m[0] === 2 && s.m[4] === 10)
}

// ── evaluate: text and numbers ──────────────────────────────────────────────
{
  const f = E.evaluate({ params: { nom: 'Ada' }, layers: [{ type: 'text', name: 'T', text: 'Bonjour {nom}\nbis', reveal: { k: [[0, 0], [1, 1, 'lin']] } }] }, 0.5)
  ok('text: {param} is inserted and reveal types it out', f.ops[0].text === 'Bonjour {nom}\nbis'.replace('{nom}', 'Ada').slice(0, Math.floor('Bonjour Ada\nbis'.length * 0.5 + 1e-9)), f.ops[0].text)
  const full = E.evaluate({ layers: [{ type: 'text', text: 'abc', reveal: 0 }] }, 0)
  ok('text: reveal 0 draws nothing', full.ops.length === 0)
  const ref = E.evaluate({ params: { t: 'direct' }, layers: [{ type: 'text', text: '$t' }] }, 0)
  ok('text: a whole-value $param works too', ref.ops[0].text === 'direct')
}
{
  const f = E.evaluate({ layers: [{ type: 'number', value: 12480.4, suffix: ' €', prefix: '~' }] }, 0)
  ok('number: fr grouping with prefix and suffix', /^~12\s480 €$/.test(f.ops[0].text.replace(/[  ]/g, ' ')), f.ops[0].text)
  const en = E.evaluate({ layers: [{ type: 'number', value: 1234.567, decimals: 1, locale: 'en' }] }, 0)
  ok('number: en locale with decimals', en.ops[0].text === '1,234.6', en.ops[0].text)
  const counter = E.evaluate({ layers: [{ type: 'number', value: { k: [[0, 0], [2, 100, 'lin']] } }] }, 1)
  ok('number: a keyframed value counts', counter.ops[0].text === '50', counter.ops[0].text)
}

// ── evaluate: charts ────────────────────────────────────────────────────────
{
  const data = [{ label: 'A', value: 10 }, { label: 'B', value: 5 }, { label: 'C', value: 0 }]
  const none = E.evaluate({ layers: [{ type: 'chart', kind: 'bar', data, p: 0, w: 600, h: 400 }] }, 0)
  const full = E.evaluate({ layers: [{ type: 'chart', kind: 'bar', data, p: 1, w: 600, h: 400 }] }, 0)
  const bars = (f) => f.ops.filter((o) => o.op === 'rect')
  ok('chart bar: nothing grows at p=0', bars(none).length === 0)
  ok('chart bar: two bars with a value at p=1, taller for the bigger value', bars(full).length === 2 && bars(full)[0].h > bars(full)[1].h && near(bars(full)[0].h / bars(full)[1].h, 2, 1e-6), bars(full).map((b) => b.h))
  ok('chart bar: labels and values are text ops', full.ops.filter((o) => o.op === 'text').map((o) => o.text).join('|').includes('A'))
  const half = E.evaluate({ layers: [{ type: 'chart', kind: 'bar', data, p: 0.5, w: 600, h: 400 }] }, 0)
  ok('chart bar: bars grow in turn (the first is further along than the second)', bars(half)[0].h / bars(full)[0].h > bars(half)[1].h / bars(full)[1].h)
  const line = E.evaluate({ layers: [{ type: 'chart', kind: 'line', data, p: 1, w: 600, h: 400 }] }, 0)
  ok('chart line: one polyline and a marker per point', line.ops.filter((o) => o.op === 'poly').length === 1 && line.ops.filter((o) => o.op === 'circle').length === 3)
  const pie = E.evaluate({ layers: [{ type: 'chart', kind: 'pie', data, p: 1, w: 600, h: 600 }] }, 0)
  ok('chart pie: a wedge per positive value', pie.ops.filter((o) => o.op === 'poly').length === 2)
  const pieHalf = E.evaluate({ layers: [{ type: 'chart', kind: 'pie', data, p: 0.2, w: 600, h: 600 }] }, 0)
  ok('chart pie: wedges sweep in', pieHalf.ops.filter((o) => o.op === 'poly').length >= 1 && pieHalf.ops.filter((o) => o.op === 'poly')[0].pts.length < pie.ops.filter((o) => o.op === 'poly')[0].pts.length)
  const empty = E.evaluate({ layers: [{ type: 'chart', kind: 'bar', data: [], w: 100, h: 100 }] }, 0)
  ok('chart: no data draws nothing', empty.ops.length === 0)
}

// ── evaluate: particles ─────────────────────────────────────────────────────
{
  const sc = (extra) => ({ layers: [{ type: 'particles', name: 'P', x: 500, y: 500, count: 200, t0: 1, life: 1, seed: 7, ...extra }] })
  ok('particles: none before t0', E.evaluate(sc({}), 0.9).ops.length === 0)
  const a = E.evaluate(sc({}), 1.4)
  ok('particles: some are alive during the burst', a.ops.length > 50 && a.ops.length <= 200, a.ops.length)
  ok('particles: none after their life is over', E.evaluate(sc({}), 2.5).ops.length === 0)
  ok('particles: same seed and time give the same frame', JSON.stringify(a) === JSON.stringify(E.evaluate(sc({}), 1.4)))
  ok('particles: another seed gives another frame', JSON.stringify(a.ops.map((o) => o.m)) !== JSON.stringify(E.evaluate(sc({ seed: 8 }), 1.4).ops.map((o) => o.m)))
  const stream = E.evaluate(sc({ mode: 'stream', t0: 0, t1: 2, life: 0.5 }), 1)
  ok('particles: a stream keeps a steady crowd', stream.ops.length > 20 && stream.ops.length < 200, stream.ops.length)
  const g = E.evaluate(sc({ gravity: 2000, speed: 0, size0: 20, spread: 0 }), 1.8)
  ok('particles: gravity pulls down', g.ops.length > 0 && g.ops.every((o) => o.m[5] > 500))
  ok('particles: shapes', E.evaluate(sc({ shape: 'square' }), 1.3).ops.every((o) => o.op === 'rect') && E.evaluate(sc({ shape: 'circle' }), 1.3).ops.every((o) => o.op === 'circle'))
  const big = E.evaluate(sc({ count: 99999 }), 1.4)
  ok('particles: the count is bounded', big.ops.length <= E.LIMITS.particles)
}

// ── evaluate: path and morph ────────────────────────────────────────────────
{
  const sub = E.parsePath('M0 0 L10 0 l0 10 H0 V0 z M50 50 L60 60')
  ok('parsePath: absolute, relative, H, V, Z and a second subpath', sub.length === 2 && sub[0].closed === true && sub[0].pts.length === 5 && sub[1].closed === false, sub)
  const cur = E.parsePath('M0 0 C 0 10 10 10 10 0 S 20 -10 20 0 Q 25 5 30 0 T 40 0')
  ok('parsePath: curves are sampled into points', cur[0].pts.length > 40)
  ok('parsePath: junk never throws', E.parsePath('???').length === 0 && E.parsePath('M').length === 0 && E.parsePath('M1 2 A 5 5 0 0 1 9 9').length === 0)
  const half = E.evaluate({ layers: [{ type: 'path', d: 'M0 0 L100 0', draw: 0.5 }] }, 0).ops[0]
  ok('path: draw 0.5 stops half way', near(half.pts[half.pts.length - 2], 50, 1e-6) && half.closed === false, half.pts)
  const whole = E.evaluate({ layers: [{ type: 'path', d: 'M0 0 L100 0 L100 100 Z', fill: '#ff0000' }] }, 0).ops[0]
  ok('path: a full closed path is filled', whole.closed === true && whole.fill === '#ff0000')
  const m0 = E.evaluate({ layers: [{ type: 'morph', from: 'circle', to: 'square', p: 0, points: 64, size: 100 }] }, 0).ops[0]
  const m1 = E.evaluate({ layers: [{ type: 'morph', from: 'circle', to: 'square', p: 1, points: 64, size: 100 }] }, 0).ops[0]
  const mid = E.evaluate({ layers: [{ type: 'morph', from: 'circle', to: 'square', p: 0.5, points: 64, size: 100 }] }, 0).ops[0]
  ok('morph: 64 points whatever the shapes', m0.pts.length === 128 && m1.pts.length === 128)
  const radius = (pts) => Math.max(...Array.from({ length: pts.length / 2 }, (_, i) => Math.hypot(pts[2 * i], pts[2 * i + 1])))
  ok('morph: p=0 is the circle, p=1 the square (corners are further out)', near(radius(m0.pts), 50, 0.5) && radius(m1.pts) > 60, [radius(m0.pts), radius(m1.pts)])
  ok('morph: halfway lies between', radius(mid.pts) > radius(m0.pts) && radius(mid.pts) < radius(m1.pts))
  ok('morph: an unreadable path draws nothing', E.evaluate({ layers: [{ type: 'morph', from: '???', to: 'star', p: 0.5 }] }, 0).ops.length === 0)
  const svgMorph = E.evaluate({ layers: [{ type: 'morph', from: 'M0 -50 L50 50 L-50 50 Z', to: 'star', p: 1, size: 100 }] }, 0).ops
  ok('morph: an SVG path can morph into a preset', svgMorph.length === 1)
}

// ── evaluate: lines, circles, images ────────────────────────────────────────
{
  const l = E.evaluate({ layers: [{ type: 'line', x: 0, y: 0, x2: 100, y2: 0, draw: 0.25 }] }, 0).ops[0]
  ok('line: draw grows it from the start', l.x2 === 25)
  ok('line: draw 0 draws nothing', E.evaluate({ layers: [{ type: 'line', draw: 0 }] }, 0).ops.length === 0)
  const c = E.evaluate({ layers: [{ type: 'circle', r: 0 }, { type: 'circle', r: 5, stroke: '#ffffff', lw: 2 }] }, 0)
  ok('circle: radius 0 draws nothing, a ring keeps its stroke', c.ops.length === 1 && c.ops[0].stroke === '#ffffff')
  const img = E.evaluate({ layers: [{ type: 'image', src: 'logo.png', w: 100, h: 50 }, { type: 'image', src: '' }] }, 0)
  ok('image: needs a src, is centred', img.ops.length === 1 && img.ops[0].x === -50 && img.ops[0].y === -25)
}

// ── timeline ────────────────────────────────────────────────────────────────
{
  const rows = E.timeline({ layers: [{ type: 'rect', name: 'R', x: { k: [[0.5, 0], [2, 9]] }, alpha: { k: [[1, 0], [1.5, 1]] } }, { type: 'group', name: 'G', layers: [{ type: 'text', name: 'T', text: 'x' }] }] })
  ok('timeline: keys are merged, sorted and the span is first to last', rows[0].keys.join() === '0.5,1,1.5,2' && rows[0].from === 0.5 && rows[0].to === 2, rows[0])
  ok('timeline: groups are flattened with a depth', rows.length === 3 && rows[2].depth === 1 && rows[2].from === null)
}

// ── inspect ─────────────────────────────────────────────────────────────────
const codes = (scene) => E.inspect(scene).warnings.map((w) => w.code)
{
  const clean = { format: { duration: 4 }, layers: [
    { type: 'text', name: 'Titre', text: 'Un titre clair', x: 960, size: 110, y: { k: [[0, 560], [0.6, 500, 'out']] }, alpha: { k: [[0, 0], [0.6, 1, 'out']] } },
    { type: 'text', name: 'Sous', text: 'Sous-titre lisible', x: 960, size: 60, y: 640 },
  ] }
  ok('inspect: a clean scene has no warning (a slide-in is not a defect)', codes(clean).length === 0, E.inspect(clean).warnings)
  ok('inspect: reports when each layer is on screen', E.inspect(clean).layers.length === 2 && E.inspect(clean).layers[0].from === 0)
}
ok('inspect: text leaving the frame is a cutoff', codes({ layers: [{ type: 'text', text: 'Un texte beaucoup trop long pour tenir dans le cadre de la vidéo', x: 960, size: 160, maxW: 20000 }] }).includes('cutoff'))
ok('inspect: two texts on top of each other overlap', codes({ layers: [{ type: 'text', name: 'a', text: 'Premier texte', y: 500, size: 100 }, { type: 'text', name: 'b', text: 'Second texte', y: 520, size: 100 }] }).includes('overlap'))
ok('inspect: grey on grey is a contrast problem', codes({ background: '#777777', layers: [{ type: 'text', text: 'Illisible ici', size: 60, fill: '#808080' }] }).includes('contrast'))
ok('inspect: text over a coloured block uses the block as background', !codes({ layers: [{ type: 'rect', w: 900, h: 300, x: 960, y: 540, fill: '#ffffff' }, { type: 'text', text: 'Sur blanc', size: 90, x: 960, y: 540, fill: '#0f1115' }] }).includes('contrast'))
ok('inspect: white on a white block is flagged', codes({ layers: [{ type: 'rect', w: 900, h: 300, x: 960, y: 540, fill: '#ffffff' }, { type: 'text', text: 'Sur blanc', size: 90, x: 960, y: 540, fill: '#ffffff' }] }).includes('contrast'))
ok('inspect: tiny text is flagged', codes({ layers: [{ type: 'text', text: 'minuscule', size: 14 }] }).includes('small'))
ok('inspect: a quick flash of text is too short to read', codes({ format: { duration: 5 }, layers: [{ type: 'text', text: 'Une phrase assez longue pour être lue', size: 80, start: 1, end: 1.4 }] }).includes('short'))
ok('inspect: an empty scene is called empty', codes({ layers: [] }).includes('empty'))
ok('inspect: a layer that never draws is named', E.inspect({ layers: [{ type: 'rect', name: 'Fantôme', alpha: 0 }, { type: 'rect', name: 'Vu' }] }).warnings.some((w) => w.code === 'empty' && w.layer === 'Fantôme'))
ok('inspect: an animated counter is not a short-read problem', !codes({ format: { duration: 4 }, layers: [{ type: 'number', value: { k: [[0, 0], [2, 9999]] }, size: 160 }] }).includes('short'))

// ── compact ─────────────────────────────────────────────────────────────────
{
  const rich = { format: { width: 1280, height: 720, fps: 24, duration: 6 }, background: '#102030', params: { a: 'x', accent: '#ff8800' }, controls: [{ id: 'a', label: 'A' }],
    layers: [
      { type: 'rect', name: 'R0', x: 0, y: 0, w: 200, fill: '$accent' },
      { type: 'text', name: 'T', text: '{a}', y: { k: [[0, 10], [1, 20, 'io']] } },
      { type: 'group', name: 'G', x: 0, layers: [{ type: 'circle', name: 'C', r: 30, fill: '#fff', x: 0, y: 0 }] },
      { type: 'chart', name: 'Ch', data: [{ label: 'A', value: 3 }], colors: ['#f00', '#0f0'] },
      { type: 'particles', name: 'P', colors: ['#fff'] },
      { type: 'morph', name: 'M', from: 'circle', to: 'M0 0 L10 0 L10 10 Z' },
      { type: 'image', name: 'I', src: 'a.png' }, { type: 'path', name: 'Pa', d: 'M0 0 L9 9' }, { type: 'number', name: 'N', value: 5 }, { type: 'line', name: 'L' },
    ],
    audio: [{ synth: 'ding', at: 0, volume: 1, pitch: 1 }, { src: 'a.mp3', at: 2, volume: 0.5, loop: true, trim: [1, 3], fadeIn: 0.2 }] }
  const a = E.validate(rich).scene
  const c = E.compact(a)
  const b = E.validate(c).scene
  ok('compact: validates back to exactly the same scene', JSON.stringify(a) === JSON.stringify(b), [JSON.stringify(a).length, JSON.stringify(b).length])
  ok('compact: is much shorter than the normalised scene', JSON.stringify(c).length < JSON.stringify(a).length * 0.55, [JSON.stringify(c).length, JSON.stringify(a).length])
  ok('compact: a top-level layer at x=0,y=0 stays at 0,0 (not the centre)', c.layers[0].x === 0 && c.layers[0].y === 0 && b.layers[0].x === 0)
  ok('compact: a child at 0,0 inside a group stays on the group origin', b.layers[2].layers[0].x === 0)
  ok('compact: nothing runtime leaks in', !('_n' in c) && c.layers.every((l) => !('start' in l) && !('end' in l)))
  ok('compact: audio loses its defaults', JSON.stringify(c.audio[0]) === '{"synth":"ding"}', c.audio[0])
  ok('compact: is deterministic', JSON.stringify(E.compact(a)) === JSON.stringify(E.compact(b)))
}

// ── describe ────────────────────────────────────────────────────────────────
{
  const d = E.describeComponents()
  ok('describe: every component is listed', Object.keys(E.COMPONENTS).every((t) => d.includes(`- ${t}:`)))
}

// ── junk never breaks the engine ────────────────────────────────────────────
{
  let seed = 12345
  const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const junkVal = () => {
    const k = Math.floor(r() * 12)
    return [null, undefined, 'x', '$nope', -1e99, 1e99, NaN, {}, [], { k: [] }, { k: [[1]] }, { k: [[0, 'a'], [1, 'b']] }][k]
  }
  const types = [...Object.keys(E.COMPONENTS), 'bogus', 7, null]
  let threw = null
  for (let i = 0; i < 300 && threw === null; i++) {
    try {
      const layers = Array.from({ length: Math.floor(r() * 6) }, () => {
        const l = { type: types[Math.floor(r() * types.length)] }
        for (const key of ['x', 'y', 'w', 'h', 'r', 'size', 'alpha', 'fill', 'stroke', 'text', 'value', 'data', 'colors', 'd', 'from', 'to', 'p', 'count', 'draw', 'layers', 'reveal']) if (r() < 0.4) l[key] = junkVal()
        return l
      })
      const sc = { format: { duration: junkVal(), width: junkVal() }, params: junkVal(), background: junkVal(), layers, audio: junkVal() }
      E.evaluate(sc, r() * 6)
      E.inspect(sc)
      E.timeline(sc)
    } catch (e) { threw = e }
  }
  ok('fuzz: 300 junk scenes never throw', threw === null, threw && String(threw.stack).slice(0, 400))
}

console.log(`${n - fail}/${n} checks passed`)
process.exit(fail ? 1 : 0)
