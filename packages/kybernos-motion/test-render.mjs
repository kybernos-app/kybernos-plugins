// Renderer tests: a recording context stands in for a canvas. `cd packages/kybernos-motion && node test-render.mjs`
import * as E from './engine.mjs'
import { paint, imagesOf } from './render2d.mjs'

let fail = 0
let n = 0
const ok = (name, cond, detail) => {
  n++
  if (cond) return
  fail++
  console.log(`FAIL ${name}${detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`)
}

function recorder () {
  const log = []
  const props = {}
  const ctx = new Proxy({}, {
    get (_, k) {
      if (k === '__log') return log
      if (k === 'measureText') return (t) => ({ width: String(t).length * (parseFloat(/(\d+(?:\.\d+)?)px/.exec(props.font || '10px')[1]) * 0.5) })
      if (k === 'createLinearGradient') return (...a) => { const g = { kind: 'gradient', a, stops: [], addColorStop (at, c) { g.stops.push([at, c]) } }; log.push(['createLinearGradient', a]); return g }
      if (k === 'letterSpacing') return props.letterSpacing
      if (k in props) return props[k]
      return (...a) => { log.push([String(k), a]) }
    },
    set (_, k, v) { props[k] = v; log.push(['=' + String(k), [v]]); return true },
    has (_, k) { return k === 'letterSpacing' },
  })
  return ctx
}
const calls = (ctx, name) => ctx.__log.filter((c) => c[0] === name)
const sets = (ctx, name) => ctx.__log.filter((c) => c[0] === '=' + name).map((c) => c[1][0])

{
  const frame = E.evaluate({ format: { width: 1000, height: 500, duration: 2 }, background: '#102030', layers: [
    { type: 'rect', x: 100, y: 100, w: 200, h: 80, r: 12, fill: '#ff0000', alpha: 0.5 },
    { type: 'circle', x: 400, y: 100, r: 30, stroke: '#00ff00', lw: 6 },
    { type: 'line', x: 10, y: 10, x2: 110, y2: 10, lw: 3, stroke: '#ffffff' },
    { type: 'path', d: 'M0 0 L50 0 L50 50 Z', x: 600, y: 100, fill: '#0000ff', stroke: '#ffffff', lw: 2 },
    { type: 'text', text: 'Bonjour', x: 500, y: 250, size: 80, weight: 700, fill: '#ffffff' },
  ] }, 0)
  const ctx = recorder()
  paint(ctx, frame, { width: 500, height: 250 })
  const st = calls(ctx, 'setTransform')[0][1]
  ok('paint: the canvas is scaled to the scene (500px for 1000 units)', st[0] === 0.5 && st[3] === 0.5, st)
  ok('paint: the background is filled first with the frame colour', sets(ctx, 'fillStyle')[0] === '#102030' && calls(ctx, 'fillRect')[0][1].join() === '0,0,1000,500')
  ok('paint: save and restore are balanced, one pair per primitive', calls(ctx, 'save').length === frame.ops.length && calls(ctx, 'restore').length === frame.ops.length)
  ok('paint: each primitive applies its matrix', calls(ctx, 'transform').length === frame.ops.length && calls(ctx, 'transform')[0][1].join() === frame.ops[0].m.join())
  ok('paint: alpha is applied per primitive', sets(ctx, 'globalAlpha').includes(0.5))
  ok('paint: a rounded rect goes through roundRect or arcTo', calls(ctx, 'roundRect').length + calls(ctx, 'arcTo').length > 0)
  ok('paint: a circle is an arc of the right radius', calls(ctx, 'arc').some((c) => c[1][2] === 30))
  ok('paint: a ring strokes with its width', sets(ctx, 'lineWidth').includes(6) && sets(ctx, 'strokeStyle').includes('#00ff00'))
  ok('paint: a line has its width and a cap', sets(ctx, 'lineWidth').includes(3) && sets(ctx, 'lineCap').length > 0)
  ok('paint: a closed path closes, is filled and stroked', calls(ctx, 'closePath').length >= 1 && sets(ctx, 'fillStyle').includes('#0000ff') && sets(ctx, 'strokeStyle').includes('#ffffff'))
  ok('paint: text uses weight, size and the CSS stack', sets(ctx, 'font').some((f) => f.startsWith('700 80px ') && f.includes('sans-serif')), sets(ctx, 'font'))
  ok('paint: text is drawn at its position', calls(ctx, 'fillText').length === 1 && calls(ctx, 'fillText')[0][1][0] === 'Bonjour')
}
{
  const f = E.evaluate({ layers: [{ type: 'text', text: 'Un texte vraiment très long', size: 100, maxW: 300 }] }, 0)
  const ctx = recorder()
  paint(ctx, f)
  const used = sets(ctx, 'font').map((s) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(s)[1]))
  ok('paint: text wider than maxW shrinks to fit it', used[used.length - 1] < 100 && used[used.length - 1] * 0.5 * 'Un texte vraiment très long'.length <= 300 + 1, used)
}
{
  const f = E.evaluate({ layers: [{ type: 'text', text: 'a\nb\nc', size: 40, lineHeight: 1.5, y: 300, x: 100 }] }, 0)
  const ctx = recorder()
  paint(ctx, f)
  const ys = calls(ctx, 'fillText').map((c) => c[1][2])
  ok('paint: several lines are centred as a block', ys.length === 3 && ys[0] === -60 && ys[1] === 0 && ys[2] === 60, ys)
}
{
  const f = E.evaluate({ background: { gradient: { angle: 90, stops: [[0, '#000000'], [1, '#ffffff']] } }, layers: [{ type: 'rect', x: 500, y: 500, w: 100, h: 100, fill: { gradient: { angle: 0, stops: [[0, '#ff0000'], [1, '#0000ff']] } } }] }, 0)
  const ctx = recorder()
  paint(ctx, f)
  const g = calls(ctx, 'createLinearGradient')
  ok('paint: gradients are created for background and fill', g.length === 2)
  ok('paint: a top-to-bottom gradient runs along y over the frame', g[0][1][0] === g[0][1][2] && g[0][1][1] < g[0][1][3])
  ok('paint: a left-to-right gradient runs along x over the shape', g[1][1][1] === g[1][1][3] && g[1][1][0] < g[1][1][2])
}
{
  const f = E.evaluate({ layers: [{ type: 'image', src: 'a.png', x: 200, y: 200, w: 200, h: 100 }] }, 0)
  const none = recorder()
  paint(none, f, { images: new Map() })
  ok('paint: an image that is not loaded draws nothing', calls(none, 'drawImage').length === 0)
  const withImg = recorder()
  paint(withImg, f, { images: new Map([['a.png', { width: 400, height: 400 }]]) })
  const d = calls(withImg, 'drawImage')[0][1]
  ok('paint: an image is fitted inside its box (contain) and clipped', d[3] === 100 && d[4] === 100 && d[1] === -50 && calls(withImg, 'clip').length === 1, d)
  const cover = E.evaluate({ layers: [{ type: 'image', src: 'a.png', x: 200, y: 200, w: 200, h: 100, fit: 'cover' }] }, 0)
  const c2 = recorder()
  paint(c2, cover, { images: new Map([['a.png', { width: 400, height: 400 }]]) })
  ok('paint: cover fills the box', calls(c2, 'drawImage')[0][1][3] === 200, calls(c2, 'drawImage')[0][1])
}
ok('imagesOf: lists every image once, groups included', imagesOf(E.validate({ layers: [{ type: 'image', src: 'a.png' }, { type: 'group', layers: [{ type: 'image', src: 'b.png' }, { type: 'image', src: 'a.png' }] }] }).scene).join() === 'a.png,b.png')
{
  // the real pipeline end to end on a busy scene must paint without throwing
  const sc = { format: { duration: 5 }, layers: [
    { type: 'chart', kind: 'bar', data: [{ label: 'A', value: 3 }, { label: 'B', value: 5 }], w: 800, h: 400 },
    { type: 'particles', count: 300, t0: 0, life: 2 },
    { type: 'morph', from: 'circle', to: 'star', p: 0.5, x: 300, y: 300 },
    { type: 'number', value: 4200, suffix: ' €', y: 800 },
  ] }
  let threw = null
  try { for (let t = 0; t <= 5; t += 0.25) paint(recorder(), E.evaluate(sc, t)) } catch (e) { threw = e }
  ok('paint: a busy scene paints at every instant without throwing', threw === null, threw && String(threw.stack).slice(0, 300))
}

console.log(`${n - fail}/${n} checks passed`)
process.exit(fail ? 1 : 0)
