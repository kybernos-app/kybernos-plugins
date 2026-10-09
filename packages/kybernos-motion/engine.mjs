// Motion engine: the pure core of the Motion plugin. No DOM, no disk, no clock.
//
//   validate(raw)            raw scene (what an agent or a file gives) -> a clean, bounded scene + the problems found
//   evaluate(scene, t, over) one instant -> a frame: the list of drawing primitives, already resolved
//   inspect(scene)           what an agent cannot see: off-screen, overlapping or unreadable text, too-short reads
//   timeline(scene)          rows for the editor (layer, span, keyframe times)
//
// A scene is DATA. Nothing in it is ever executed: every layer has a `type` that names a component written
// here, and every property is checked against that component's table (known keys only, clamped numbers,
// bounded strings). The same file is therefore safe to open from anywhere, like any other livrable.
//
// The renderers (render2d.mjs, later others) only know the primitives that `evaluate` returns:
//   rect, circle, line, poly, text, image
// Composite components (number, chart, particles, path, morph) are expanded into primitives here, so the
// whole pipeline can be tested in Node without a browser.
//
// Keep this file free of `import`: scripts/build.mjs pastes it into the browser bundle.

export const FORMAT_VERSION = 1

export const LIMITS = {
  width: [64, 4096],
  height: [64, 4096],
  fps: [1, 60],
  duration: [0.1, 300],
  layers: 400, // every layer, groups included
  depth: 4, // group nesting
  keys: 64, // keyframes per track
  text: 600,
  name: 80,
  params: 64,
  paramString: 600,
  audio: 32,
  particles: 1500,
  chartItems: 40,
  objects3d: 60,
  path: 6000,
  points: 256,
}

// ───────────────────────── easing ─────────────────────────

const C1 = 1.70158
const C3 = C1 + 1
const bounceOut = (x) => {
  const n1 = 7.5625
  const d1 = 2.75
  if (x < 1 / d1) return n1 * x * x
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375
  return n1 * (x -= 2.625 / d1) * x + 0.984375
}

export const EASES = {
  lin: (x) => x,
  in: (x) => x * x * x,
  out: (x) => 1 - Math.pow(1 - x, 3),
  io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  sine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  expo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  back: (x) => 1 + C3 * Math.pow(x - 1, 3) + C1 * Math.pow(x - 1, 2),
  backIn: (x) => C3 * x * x * x - C1 * x * x,
  elastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin(((x * 10 - 0.75) * (2 * Math.PI)) / 3) + 1),
  bounce: bounceOut,
  step: (x) => (x < 1 ? 0 : 1),
}
export const EASE_NAMES = Object.keys(EASES)

/** cubic-bezier(x1, y1, x2, y2) as an easing function (Newton, then bisection). */
function bezier (x1, y1, x2, y2) {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = (t) => ((ax * t + bx) * t + cx) * t
  const sy = (t) => ((ay * t + by) * t + cy) * t
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x
      if (Math.abs(e) < 1e-6) return sy(t)
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= e / d
    }
    let lo = 0
    let hi = 1
    t = x
    for (let i = 0; i < 24; i++) {
      const e = sx(t) - x
      if (Math.abs(e) < 1e-6) break
      if (e > 0) hi = t
      else lo = t
      t = (lo + hi) / 2
    }
    return sy(t)
  }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isRef = (v) => typeof v === 'string' && /^\$[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(v)

function easeFn (e) {
  if (Array.isArray(e) && e.length === 4 && e.every(isNum)) return bezier(clamp(e[0], 0, 1), e[1], clamp(e[2], 0, 1), e[3])
  if (typeof e === 'string' && Object.prototype.hasOwnProperty.call(EASES, e)) return EASES[e]
  return EASES.out
}

// ───────────────────────── colours ─────────────────────────

/** '#rgb' | '#rrggbb' | '#rrggbbaa' | 'transparent' -> [r, g, b, a] (a in 0..1), or null. */
export function parseColor (s) {
  if (typeof s !== 'string') return null
  const v = s.trim().toLowerCase()
  if (v === 'transparent') return [0, 0, 0, 0]
  let m = /^#([0-9a-f]{3})$/.exec(v)
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1)
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v)
  if (m) {
    const n = parseInt(m[1], 16)
    return [n >> 16, (n >> 8) & 255, n & 255, m[2] === undefined ? 1 : parseInt(m[2], 16) / 255]
  }
  return null
}

const h2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
export function toColor (c) {
  const a = Math.round(clamp(c[3] === undefined ? 1 : c[3], 0, 1) * 255)
  return '#' + h2(c[0]) + h2(c[1]) + h2(c[2]) + (a === 255 ? '' : h2(a))
}

function lerpColor (a, b, u) {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (ca === null || cb === null) return u < 1 ? a : b
  return toColor([0, 1, 2, 3].map((i) => ca[i] + (cb[i] - ca[i]) * u))
}

const lin = (c) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
export function luminance (c) {
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
}
export function contrast (c1, c2) {
  const a = luminance(c1)
  const b = luminance(c2)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** The most readable ink (near-black or near-white) on a given background colour. */
export function inkOn (bg) {
  const c = parseColor(bg) || [15, 17, 21, 1]
  return contrast(c, [15, 17, 21]) >= contrast(c, [245, 246, 247]) ? '#0f1115' : '#f5f6f7'
}

// ───────────────────────── component tables ─────────────────────────
// Each property: t = num | col | fill | str | enum | bool | list. `anim: false` = a plain value, no keyframes.

const NUM = (def, min, max, o) => ({ t: 'num', def, min, max, ...o })
const COL = (def) => ({ t: 'col', def })
const FILL = (def) => ({ t: 'fill', def })
const STR = (def, max, o) => ({ t: 'str', def, max: max || LIMITS.text, ...o })
const ENUM = (def, list) => ({ t: 'enum', def, list })
const BOOL = (def) => ({ t: 'bool', def })
const FAMILIES = ['sans', 'serif', 'mono', 'rounded']

const POS = { x: NUM(0, -20000, 20000), y: NUM(0, -20000, 20000) }
const XFORM = {
  ...POS,
  rot: NUM(0, -3600, 3600),
  sx: NUM(1, -50, 50),
  sy: NUM(1, -50, 50),
  alpha: NUM(1, 0, 1),
  start: NUM(null, 0, 300, { anim: false }),
  end: NUM(null, 0, 300, { anim: false }),
}
const TEXTSTYLE = {
  size: NUM(48, 1, 2000),
  weight: NUM(600, 100, 900),
  family: ENUM('sans', FAMILIES),
  fill: FILL('$ink'),
  align: ENUM('center', ['left', 'center', 'right']),
  maxW: NUM(1700, 10, 20000),
  lineHeight: NUM(1.2, 0.5, 4),
  tracking: NUM(0, -20, 100),
}

// The things inside a scene3d layer. Positions are world units (a unit box is 1 across); angles are degrees.
const SHAPES3D = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'ring', 'knot', 'capsule', 'model']
export const OBJECT3D = {
  shape: ENUM('box', SHAPES3D),
  x: NUM(0, -1000, 1000), y: NUM(0, -1000, 1000), z: NUM(0, -1000, 1000),
  rx: NUM(0, -3600, 3600), ry: NUM(0, -3600, 3600), rz: NUM(0, -3600, 3600),
  s: NUM(1, 0, 1000), w: NUM(1, 0, 1000), h: NUM(1, 0, 1000), d: NUM(1, 0, 1000),
  color: COL('#ffffff'), metal: NUM(0.1, 0, 1), rough: NUM(0.5, 0, 1), opacity: NUM(1, 0, 1), wire: BOOL(false),
  src: STR('', 400, { anim: false }), clip: STR('', 120, { anim: false }), clipT0: NUM(0, 0, 300, { anim: false }), speed: NUM(1, -20, 20, { anim: false }), loop: BOOL(true),
}

export const COMPONENTS = {
  rect: {
    about: 'Rectangle (centred on x,y unless origin is tl). Rounded with r. A layer without x,y sits at the centre of the frame.',
    props: { ...XFORM, w: NUM(100, 0, 20000), h: NUM(100, 0, 20000), r: NUM(0, 0, 10000), fill: FILL('#ffffff'), stroke: COL(null), lw: NUM(0, 0, 200), origin: ENUM('center', ['center', 'tl']) },
  },
  circle: {
    about: 'Circle or ring (fill and/or stroke), centred on x,y.',
    props: { ...XFORM, r: NUM(50, 0, 20000), fill: FILL(null), stroke: COL(null), lw: NUM(0, 0, 400) },
  },
  line: {
    about: 'Straight line from (x,y) to (x2,y2) (default: 200px to the right). draw 0..1 grows it from the start.',
    props: { ...XFORM, x2: NUM(null, -20000, 20000), y2: NUM(null, -20000, 20000), stroke: COL('$ink'), lw: NUM(4, 0, 400), cap: ENUM('round', ['butt', 'round', 'square']), draw: NUM(1, 0, 1) },
  },
  text: {
    about: 'Text, one or several lines (\\n). reveal 0..1 types it out. {name} inserts a param.',
    props: { ...XFORM, text: STR(''), ...TEXTSTYLE, reveal: NUM(1, 0, 1) },
  },
  number: {
    about: 'A number that can count: set value (animate it for a counter). prefix/suffix, decimals.',
    props: { ...XFORM, value: NUM(0, -1e12, 1e12), decimals: NUM(0, 0, 6, { int: true }), prefix: STR('', 20), suffix: STR('', 20), group: BOOL(true), locale: ENUM('fr', ['fr', 'en']), ...TEXTSTYLE, size: NUM(120, 1, 2000) },
  },
  image: {
    about: 'An image file of the project (src is a path next to the scene or under it). Centred on x,y.',
    props: { ...XFORM, src: STR('', 400, { anim: false }), w: NUM(400, 1, 20000), h: NUM(300, 1, 20000), fit: ENUM('contain', ['contain', 'cover', 'stretch']), r: NUM(0, 0, 10000), origin: ENUM('center', ['center', 'tl']) },
  },
  path: {
    about: 'An SVG path (M L H V C Q Z, absolute or relative). draw 0..1 traces it. Coordinates are relative to x,y.',
    props: { ...XFORM, d: STR('', LIMITS.path, { anim: false }), fill: FILL(null), stroke: COL('$ink'), lw: NUM(4, 0, 400), cap: ENUM('round', ['butt', 'round', 'square']), draw: NUM(1, 0, 1) },
  },
  morph: {
    about: 'A shape that turns into another: from/to are SVG paths or presets (circle, square, triangle, star, hexagon). p 0..1.',
    props: { ...XFORM, from: STR('circle', LIMITS.path, { anim: false }), to: STR('star', LIMITS.path, { anim: false }), p: NUM(0, 0, 1), size: NUM(200, 1, 20000, { anim: false }), points: NUM(96, 16, LIMITS.points, { anim: false, int: true }), fill: FILL('#ffffff'), stroke: COL(null), lw: NUM(0, 0, 400) },
  },
  chart: {
    about: 'Animated chart (bar, line or pie) from data [{label,value,color?}]. p 0..1 plays it in.',
    props: { ...XFORM, kind: ENUM('bar', ['bar', 'line', 'pie']), data: { t: 'list', kind: 'chart' }, w: NUM(900, 10, 20000), h: NUM(500, 10, 20000), p: NUM(1, 0, 1), max: NUM(null, 0, 1e12, { anim: false }), colors: { t: 'list', kind: 'colors' }, labels: BOOL(true), values: BOOL(true), labelSize: NUM(36, 6, 400, { anim: false }), ink: COL('$ink') },
  },
  particles: {
    about: 'Deterministic particles: burst or stream between t0 and t1. Confetti, sparks, snow, smoke.',
    props: { ...XFORM, mode: ENUM('burst', ['burst', 'stream']), shape: ENUM('circle', ['circle', 'square', 'spark']), count: NUM(120, 1, LIMITS.particles, { anim: false, int: true }), t0: NUM(0, 0, 300, { anim: false }), t1: NUM(1, 0, 300, { anim: false }), life: NUM(1.6, 0.05, 60, { anim: false }), speed: NUM(380, 0, 5000, { anim: false }), speedVar: NUM(0.6, 0, 1, { anim: false }), angle: NUM(-90, -360, 360, { anim: false }), spread: NUM(360, 0, 360, { anim: false }), gravity: NUM(600, -5000, 5000, { anim: false }), drag: NUM(0, 0, 20, { anim: false }), size0: NUM(14, 0, 400, { anim: false }), size1: NUM(2, 0, 400, { anim: false }), spin: NUM(0, -50, 50, { anim: false }), fade: BOOL(true), seed: NUM(1, 0, 1e9, { anim: false, int: true }), colors: { t: 'list', kind: 'colors' } },
  },
  scene3d: {
    about: 'A 3D scene in a w x h window centred on x,y: objects (box, sphere, cylinder, cone, torus, plane, ring, knot, capsule, or a glTF model with its animation clip), a camera that can orbit, lights.',
    props: { ...XFORM, w: NUM(800, 10, 8000), h: NUM(600, 10, 8000), bg: COL(null), cx: NUM(0, -1000, 1000), cy: NUM(1.5, -1000, 1000), cz: NUM(6, -1000, 1000), lx: NUM(0, -1000, 1000), ly: NUM(0.5, -1000, 1000), lz: NUM(0, -1000, 1000), fov: NUM(40, 10, 120), orbit: NUM(0, -3600, 3600), ambient: NUM(0.6, 0, 5), sun: NUM(1.4, 0, 10), sunX: NUM(3, -1000, 1000), sunY: NUM(5, -1000, 1000), sunZ: NUM(4, -1000, 1000), objects: { t: 'list', kind: 'objects3d' } },
  },
  lottie: {
    about: 'A Lottie animation (a .json file of the project, for instance a character) drawn in w x h at x,y, from time t0, looping if asked. Lottie expressions are never run.',
    props: { ...XFORM, src: STR('', 400, { anim: false }), w: NUM(400, 1, 20000), h: NUM(400, 1, 20000), t0: NUM(0, 0, 300, { anim: false }), speed: NUM(1, -20, 20, { anim: false }), loop: BOOL(true) },
  },
  group: {
    about: 'Moves, turns, scales and fades its layers together. Children are relative to x,y.',
    props: { ...XFORM },
    container: true,
  },
}

// ───────────────────────── validation ─────────────────────────

const AUDIO_SYNTH = ['whoosh', 'click', 'pop', 'ding', 'hit', 'riser', 'tick']
export { AUDIO_SYNTH }

function str (v, max) {
  if (typeof v !== 'string') return null
  return v.length > max ? v.slice(0, max) : v
}

function normKeys (list, spec, where, errs, paramNames) {
  if (!Array.isArray(list)) return null
  const keys = []
  for (const k of list.slice(0, LIMITS.keys)) {
    if (!Array.isArray(k) || !isNum(k[0]) || k[0] < 0 || k[0] > LIMITS.duration[1]) continue
    let v = k[1]
    if (spec.t === 'num') {
      if (isRef(v)) { /* param reference, resolved at evaluation */ } else if (isNum(v)) v = clamp(v, spec.min, spec.max)
      else continue
    } else if (spec.t === 'col' || spec.t === 'fill') {
      if (!(isRef(v) || (typeof v === 'string' && parseColor(v) !== null))) continue
    } else continue
    const e = k[2]
    const key = [k[0], v]
    if (e !== undefined && e !== null) key.push(Array.isArray(e) && e.length === 4 && e.every(isNum) ? e.slice() : isRef(e) || (typeof e === 'string' && EASES[e]) ? e : 'out')
    keys.push(key)
  }
  if (keys.length === 0) return null
  keys.sort((a, b) => a[0] - b[0])
  const dedup = []
  for (const k of keys) {
    if (dedup.length > 0 && dedup[dedup.length - 1][0] === k[0]) dedup[dedup.length - 1] = k
    else dedup.push(k)
  }
  return { k: dedup }
}

function normGradient (g) {
  if (!isObj(g) || !isObj(g.gradient)) return null
  const gr = g.gradient
  const stops = Array.isArray(gr.stops) ? gr.stops.filter((s) => Array.isArray(s) && isNum(s[0]) && (isRef(s[1]) || parseColor(s[1]) !== null)).slice(0, 8).map((s) => [clamp(s[0], 0, 1), s[1]]) : []
  if (stops.length < 2) return null
  return { gradient: { angle: isNum(gr.angle) ? clamp(gr.angle, -360, 360) : 90, stops } }
}

function normProp (name, spec, v, where, errs) {
  switch (spec.t) {
    case 'num':
      if (v === null || v === undefined) return spec.def
      if (isNum(v)) { const c = clamp(v, spec.min, spec.max); return spec.int ? Math.round(c) : c }
      if (isRef(v)) return v
      if (isObj(v) && spec.anim !== false) {
        const k = normKeys(v.k, spec, where, errs)
        if (k !== null) return k
      }
      errs.push(`${where}.${name}: expected a number, keyframes {k:[[t,value,ease?],...]} or a $param`)
      return spec.def
    case 'col':
    case 'fill':
      if (v === null || v === undefined) return spec.def
      if (isRef(v)) return v
      if (typeof v === 'string' && (parseColor(v) !== null)) return v.trim()
      if (spec.t === 'fill') { const g = normGradient(v); if (g !== null) return g }
      if (isObj(v) && spec.anim !== false) {
        const k = normKeys(v.k, spec, where, errs)
        if (k !== null) return k
      }
      errs.push(`${where}.${name}: invalid colour (use #rgb, #rrggbb, #rrggbbaa, transparent or a $param)`)
      return spec.def
    case 'str': {
      if (v === null || v === undefined) return spec.def
      if (typeof v === 'number' && Number.isFinite(v)) v = String(v)
      const s = str(v, spec.max)
      if (s === null) { errs.push(`${where}.${name}: expected text`); return spec.def }
      return s
    }
    case 'enum':
      if (v === null || v === undefined) return spec.def
      if (isRef(v)) return v
      if (spec.list.includes(v)) return v
      errs.push(`${where}.${name}: "${String(v).slice(0, 30)}" is not one of ${spec.list.join(', ')}`)
      return spec.def
    case 'bool':
      if (v === null || v === undefined) return spec.def
      if (typeof v === 'boolean' || isRef(v)) return v
      return spec.def
    default:
      return v
  }
}

function normList (kind, v, where, errs) {
  if (kind === 'colors') {
    if (!Array.isArray(v)) return null
    const out = v.filter((c) => isRef(c) || parseColor(c) !== null).slice(0, 12)
    return out.length > 0 ? out : null
  }
  if (kind === 'chart') {
    if (!Array.isArray(v)) { errs.push(`${where}.data: expected a list of {label, value, color?}`); return [] }
    const out = []
    for (const it of v.slice(0, LIMITS.chartItems)) {
      if (!isObj(it)) continue
      const value = isNum(it.value) ? it.value : isRef(it.value) ? it.value : null
      if (value === null) continue
      const item = { label: str(typeof it.label === 'number' ? String(it.label) : it.label, 60) || '', value }
      if (it.color !== undefined && (isRef(it.color) || parseColor(it.color) !== null)) item.color = it.color
      out.push(item)
    }
    return out
  }
  if (kind === 'objects3d') {
    if (!Array.isArray(v)) { errs.push(`${where}.objects: expected a list of 3D objects`); return [] }
    const out = []
    v.slice(0, LIMITS.objects3d).forEach((raw, i) => {
      const at = `${where}.objects[${i}]`
      if (!isObj(raw)) { errs.push(`${at}: expected an object`); return }
      const o = {}
      for (const [name, spec] of Object.entries(OBJECT3D)) o[name] = normProp(name, spec, raw[name], at, errs)
      for (const key of Object.keys(raw)) if (!(key in OBJECT3D)) errs.push(`${at}.${key}: not a property of a 3D object (ignored)`)
      if (o.shape === 'model' && o.src === '') errs.push(`${at}: a model needs src (a .glb file of the project)`)
      out.push(o)
    })
    return out
  }
  return null
}

function normLayer (raw, ctx, depth, where) {
  if (!isObj(raw)) { ctx.errs.push(`${where}: expected an object`); return null }
  const type = raw.type
  const comp = typeof type === 'string' && Object.prototype.hasOwnProperty.call(COMPONENTS, type) ? COMPONENTS[type] : null
  if (comp === null) {
    ctx.errs.push(`${where}: unknown type "${String(type).slice(0, 30)}" (known: ${Object.keys(COMPONENTS).join(', ')})`)
    return null
  }
  if (++ctx.count > LIMITS.layers) { ctx.errs.push(`too many layers (max ${LIMITS.layers})`); return null }
  const layer = { type, name: str(raw.name, LIMITS.name) || `${type}${ctx.count}` }
  for (const [name, spec] of Object.entries(comp.props)) {
    if ((name === 'x' || name === 'y') && depth === 0 && (raw[name] === undefined || raw[name] === null)) {
      layer[name] = name === 'x' ? ctx.cx : ctx.cy // a layer that does not say where it is goes to the centre
      continue
    }
    if (spec.t === 'list') {
      const l = normList(spec.kind, raw[name], where, ctx.errs)
      if (l !== null) layer[name] = l
      else if (spec.kind === 'chart' || spec.kind === 'objects3d') layer[name] = []
      continue
    }
    layer[name] = normProp(name, spec, raw[name], where, ctx.errs)
  }
  for (const key of Object.keys(raw)) {
    if (!(key in comp.props) && key !== 'type' && key !== 'name' && key !== 'layers') ctx.errs.push(`${where}.${key}: not a property of "${type}" (ignored)`)
  }
  if (comp.container) {
    layer.layers = []
    if (depth >= LIMITS.depth) ctx.errs.push(`${where}: groups nest at most ${LIMITS.depth} deep`)
    else if (Array.isArray(raw.layers)) {
      raw.layers.forEach((c, i) => {
        const child = normLayer(c, ctx, depth + 1, `${where}.layers[${i}]`)
        if (child !== null) layer.layers.push(child)
      })
    }
  }
  return layer
}

function normAudio (raw, errs) {
  if (!Array.isArray(raw)) return []
  const out = []
  raw.slice(0, LIMITS.audio).forEach((a, i) => {
    const where = `audio[${i}]`
    if (!isObj(a)) { errs.push(`${where}: expected an object`); return }
    const t = { at: isNum(a.at) ? clamp(a.at, 0, LIMITS.duration[1]) : 0, volume: isNum(a.volume) ? clamp(a.volume, 0, 2) : 1 }
    if (typeof a.synth === 'string') {
      if (!AUDIO_SYNTH.includes(a.synth)) { errs.push(`${where}.synth: "${a.synth.slice(0, 20)}" is not one of ${AUDIO_SYNTH.join(', ')}`); return }
      t.synth = a.synth
      t.pitch = isNum(a.pitch) ? clamp(a.pitch, 0.25, 4) : 1
    } else if (typeof a.src === 'string' && a.src !== '') {
      t.src = a.src.slice(0, 400)
      t.loop = a.loop === true
      t.trim = Array.isArray(a.trim) && isNum(a.trim[0]) && isNum(a.trim[1]) && a.trim[1] > a.trim[0] ? [Math.max(0, a.trim[0]), a.trim[1]] : null
      t.fadeIn = isNum(a.fadeIn) ? clamp(a.fadeIn, 0, 60) : 0
      t.fadeOut = isNum(a.fadeOut) ? clamp(a.fadeOut, 0, 60) : 0
    } else { errs.push(`${where}: give a synth sound or a src file`); return }
    out.push(t)
  })
  return out
}

/**
 * Check and clean a raw scene. Never throws. Returns { ok, scene, errors }: `scene` is always usable
 * (unknown or invalid things are dropped and listed in `errors`), `ok` is true when nothing was dropped.
 * `scene._n` marks a scene that went through here (evaluate() skips a second pass).
 */
export function validate (raw) {
  const errs = []
  const src = isObj(raw) ? raw : {}
  if (!isObj(raw)) errs.push('the scene must be an object')
  const f = isObj(src.format) ? src.format : {}
  const fmt = {
    width: isNum(f.width) ? Math.round(clamp(f.width, ...LIMITS.width)) : 1920,
    height: isNum(f.height) ? Math.round(clamp(f.height, ...LIMITS.height)) : 1080,
    fps: isNum(f.fps) ? Math.round(clamp(f.fps, ...LIMITS.fps)) : 30,
    duration: isNum(f.duration) ? clamp(f.duration, ...LIMITS.duration) : 5,
  }
  const params = {}
  if (isObj(src.params)) {
    for (const [k, v] of Object.entries(src.params).slice(0, LIMITS.params)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k)) { errs.push(`params.${k.slice(0, 20)}: names are letters, digits and _`); continue }
      if (typeof v === 'string') params[k] = v.slice(0, LIMITS.paramString)
      else if (isNum(v) || typeof v === 'boolean') params[k] = v
    }
  }
  const controls = []
  if (Array.isArray(src.controls)) {
    for (const c of src.controls.slice(0, LIMITS.params)) {
      if (!isObj(c) || typeof c.id !== 'string' || !(c.id in params)) continue
      const ctl = { id: c.id, label: str(c.label, 60) || c.id, type: ['text', 'color', 'number', 'choice'].includes(c.type) ? c.type : typeof params[c.id] === 'number' ? 'number' : parseColor(params[c.id]) !== null && typeof params[c.id] === 'string' ? 'color' : 'text' }
      if (ctl.type === 'choice' && Array.isArray(c.options)) ctl.options = c.options.slice(0, 12).filter((o) => Array.isArray(o) && typeof o[0] === 'string').map((o) => [o[0].slice(0, 30), typeof o[1] === 'number' || typeof o[1] === 'string' ? o[1] : o[0]])
      if (ctl.type === 'color' && Array.isArray(c.options)) ctl.options = c.options.slice(0, 12).filter((o) => Array.isArray(o) && typeof o[0] === 'string' && parseColor(o[1]) !== null).map((o) => [o[0].slice(0, 30), o[1]])
      if (ctl.type === 'number') { ctl.min = isNum(c.min) ? c.min : 0; ctl.max = isNum(c.max) ? c.max : 1e9 }
      controls.push(ctl)
    }
  }
  let background = '#0f1115'
  if (src.background !== undefined) {
    if (isRef(src.background) || (typeof src.background === 'string' && parseColor(src.background) !== null)) background = src.background
    else { const g = normGradient(src.background); if (g !== null) background = g; else errs.push('background: invalid colour or gradient') }
  }
  const ctx = { errs, count: 0, cx: fmt.width / 2, cy: fmt.height / 2 }
  const layers = []
  if (!Array.isArray(src.layers)) errs.push('layers: expected a list')
  else {
    src.layers.forEach((l, i) => {
      const nl = normLayer(l, ctx, 0, `layers[${i}]`)
      if (nl !== null) layers.push(nl)
    })
  }
  const scene = { v: FORMAT_VERSION, format: fmt, background, params, controls, layers, audio: normAudio(src.audio, errs), _n: true }
  return { ok: errs.length === 0, scene, errors: errs }
}

/**
 * The leanest document that validates back to the same scene: properties equal to their default are left out
 * (top-level x,y are kept: an omitted one means "the centre"). This is what gets written to disk, so a file stays
 * short for the agent that reads it back, whoever last saved it.
 */
export function compact (sceneIn) {
  const scene = sceneIn && sceneIn._n === true ? sceneIn : validate(sceneIn).scene
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const lean = (layer, depth) => {
    const comp = COMPONENTS[layer.type]
    const out = { type: layer.type, name: layer.name }
    for (const [k, spec] of Object.entries(comp.props)) {
      if (spec.t === 'list') {
        if (!Array.isArray(layer[k]) || layer[k].length === 0) continue
        out[k] = spec.kind === 'objects3d' ? layer[k].map((o) => { const lo = {}; for (const [n, sp] of Object.entries(OBJECT3D)) if (!same(o[n], sp.def)) lo[n] = o[n]; return lo }) : layer[k]
        continue
      }
      const v = layer[k]
      if (v === undefined) continue
      if (depth === 0 && (k === 'x' || k === 'y')) { out[k] = v; continue }
      if (same(v, spec.def)) continue
      out[k] = v
    }
    if (layer.layers && layer.layers.length > 0) out.layers = layer.layers.map((l) => lean(l, depth + 1))
    return out
  }
  const out = { v: scene.v, format: { ...scene.format }, background: scene.background }
  if (Object.keys(scene.params || {}).length > 0) out.params = scene.params
  if ((scene.controls || []).length > 0) out.controls = scene.controls
  out.layers = (scene.layers || []).map((l) => lean(l, 0))
  if ((scene.audio || []).length > 0) {
    out.audio = scene.audio.map((a) => {
      const t = { ...a }
      if (t.at === 0) delete t.at
      if (t.volume === 1) delete t.volume
      if (t.pitch === 1) delete t.pitch
      if (t.loop === false) delete t.loop
      if (t.trim === null) delete t.trim
      if (t.fadeIn === 0) delete t.fadeIn
      if (t.fadeOut === 0) delete t.fadeOut
      return t
    })
  }
  return out
}

// ───────────────────────── evaluation ─────────────────────────

function evalNum (v, t, P, fallback) {
  if (typeof v === 'number') return v
  if (v === null || v === undefined) return fallback
  if (typeof v === 'string') { const n = Number(isRef(v) ? P[v.slice(1)] : v); return Number.isFinite(n) ? n : fallback }
  const a = v.k
  const ref = (x) => { const n = isRef(x) ? Number(P[x.slice(1)]) : x; return Number.isFinite(n) ? n : fallback }
  if (t <= a[0][0]) return ref(a[0][1])
  for (let i = 1; i < a.length; i++) {
    if (t <= a[i][0]) {
      const s = a[i - 1]
      const e = a[i]
      const span = e[0] - s[0]
      let ease = e[2]
      if (isRef(ease)) ease = P[ease.slice(1)]
      const u = span <= 0 ? 1 : easeFn(ease)((t - s[0]) / span)
      const v0 = ref(s[1])
      return v0 + (ref(e[1]) - v0) * u
    }
  }
  return ref(a[a.length - 1][1])
}

function evalColor (v, t, P, fallback) {
  if (v === null || v === undefined) return fallback
  if (typeof v === 'string') {
    const c = isRef(v) ? P[v.slice(1)] : v
    return typeof c === 'string' && parseColor(c) !== null ? c : fallback
  }
  if (isObj(v) && isObj(v.gradient)) {
    return { gradient: { angle: v.gradient.angle, stops: v.gradient.stops.map((s) => [s[0], evalColor(s[1], t, P, '#000000')]) } }
  }
  const a = v.k
  const ref = (x) => { const c = isRef(x) ? P[x.slice(1)] : x; return typeof c === 'string' && parseColor(c) !== null ? c : fallback }
  if (t <= a[0][0]) return ref(a[0][1])
  for (let i = 1; i < a.length; i++) {
    if (t <= a[i][0]) {
      const s = a[i - 1]
      const e = a[i]
      const span = e[0] - s[0]
      let ease = e[2]
      if (isRef(ease)) ease = P[ease.slice(1)]
      return lerpColor(ref(s[1]), ref(e[1]), span <= 0 ? 1 : easeFn(ease)((t - s[0]) / span))
    }
  }
  return ref(a[a.length - 1][1])
}

function evalStr (v, P, fallback) {
  if (typeof v !== 'string') return fallback
  const s = isRef(v) ? P[v.slice(1)] : v
  const out = s === undefined || s === null ? '' : String(s)
  return out.replace(/\{([A-Za-z_][A-Za-z0-9_]{0,40})\}/g, (m, k) => (k in P ? String(P[k]) : m))
}

function evalEnum (v, spec, P) {
  const e = isRef(v) ? P[v.slice(1)] : v
  return spec.list.includes(e) ? e : spec.def
}

function evalBool (v, P, def) {
  const b = isRef(v) ? P[v.slice(1)] : v
  return typeof b === 'boolean' ? b : b === 'false' || b === 0 ? false : b === 'true' || b === 1 ? true : def
}

// 2x3 affine matrices [a, b, c, d, e, f] as in CanvasRenderingContext2D.transform
const IDENT = [1, 0, 0, 1, 0, 0]
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
]
const translate = (x, y) => [1, 0, 0, 1, x, y]
const rotate = (deg) => { const r = (deg * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r); return [c, s, -s, c, 0, 0] }
const scale = (sx, sy) => [sx, 0, 0, sy, 0, 0]
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** Deterministic pseudo-random in [0,1): mulberry32 over (seed, index, lane). */
export function rand (seed, i, lane) {
  let a = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((i | 0) + 1, 0x85ebca6b) ^ Math.imul((lane | 0) + 1, 0xc2b2ae35)) >>> 0
  a = (a + 0x6d2b79f5) >>> 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ── geometry: paths -> polylines (for path, morph, progress strokes) ──

const PRESETS = {
  circle: (n) => Array.from({ length: n }, (_, i) => { const a = (i / n) * 2 * Math.PI - Math.PI / 2; return [Math.cos(a), Math.sin(a)] }),
  square: () => [[-1, -1], [1, -1], [1, 1], [-1, 1]],
  triangle: () => [[0, -1], [0.95, 0.75], [-0.95, 0.75]],
  hexagon: () => Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * 2 * Math.PI - Math.PI / 2; return [Math.cos(a), Math.sin(a)] }),
  star: () => Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * 2 * Math.PI - Math.PI / 2; const r = i % 2 === 0 ? 1 : 0.42; return [Math.cos(a) * r, Math.sin(a) * r] }),
}

/** Parse an SVG path into closed/open subpaths of points. Supports M L H V C S Q T Z (abs + rel); arcs are skipped. */
export function parsePath (d) {
  const toks = String(d).match(/[MmLlHhVvCcSsQqTtZzAa]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || []
  const subs = []
  let cur = null
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let lc = null // last control point for S/T
  let cmd = ''
  let i = 0
  const num = () => (i < toks.length && !/^[A-Za-z]$/.test(toks[i]) ? parseFloat(toks[i++]) : NaN)
  const push = (px, py) => { if (cur === null) { cur = { pts: [], closed: false }; subs.push(cur) } cur.pts.push([px, py]); x = px; y = py }
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const x0 = x
    const y0 = y
    for (let s = 1; s <= 16; s++) {
      const u = s / 16
      const v = 1 - u
      push(v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3, v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3)
    }
    lc = [x2, y2]
  }
  const quad = (x1, y1, x2, y2) => {
    const x0 = x
    const y0 = y
    for (let s = 1; s <= 12; s++) {
      const u = s / 12
      const v = 1 - u
      push(v * v * x0 + 2 * v * u * x1 + u * u * x2, v * v * y0 + 2 * v * u * y1 + u * u * y2)
    }
    lc = [x1, y1]
  }
  let guard = 0
  while (i < toks.length && guard++ < 20000) {
    if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++]
    else if (cmd === '') break
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    if (C === 'Z') { if (cur !== null) { cur.closed = true; x = sx; y = sy } cur = null; continue }
    if (C === 'M') {
      const nx = num(); const ny = num()
      if (Number.isNaN(ny)) break
      cur = null; push(ox + nx, oy + ny); sx = x; sy = y; cmd = rel ? 'l' : 'L'; continue
    }
    if (C === 'L') { const nx = num(); const ny = num(); if (Number.isNaN(ny)) break; push(ox + nx, oy + ny); continue }
    if (C === 'H') { const nx = num(); if (Number.isNaN(nx)) break; push(ox + nx, y); continue }
    if (C === 'V') { const ny = num(); if (Number.isNaN(ny)) break; push(x, oy + ny); continue }
    if (C === 'C') { const v = [num(), num(), num(), num(), num(), num()]; if (v.some(Number.isNaN)) break; cubic(ox + v[0], oy + v[1], ox + v[2], oy + v[3], ox + v[4], oy + v[5]); continue }
    if (C === 'S') {
      const v = [num(), num(), num(), num()]; if (v.some(Number.isNaN)) break
      const c1 = lc === null ? [x, y] : [2 * x - lc[0], 2 * y - lc[1]]
      cubic(c1[0], c1[1], ox + v[0], oy + v[1], ox + v[2], oy + v[3]); continue
    }
    if (C === 'Q') { const v = [num(), num(), num(), num()]; if (v.some(Number.isNaN)) break; quad(ox + v[0], oy + v[1], ox + v[2], oy + v[3]); continue }
    if (C === 'T') {
      const v = [num(), num()]; if (v.some(Number.isNaN)) break
      const c1 = lc === null ? [x, y] : [2 * x - lc[0], 2 * y - lc[1]]
      quad(c1[0], c1[1], ox + v[0], oy + v[1]); continue
    }
    break // arcs and anything unknown: stop, keep what was parsed
  }
  return subs.filter((s) => s.pts.length >= 2)
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

function polyLength (pts, closed) {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i])
  if (closed && pts.length > 1) L += dist(pts[pts.length - 1], pts[0])
  return L
}

/** Resample a polyline to n points evenly spaced along its length. */
function resample (pts, closed, n) {
  const ring = closed ? pts.concat([pts[0]]) : pts
  const total = polyLength(pts, closed)
  if (total === 0) return Array.from({ length: n }, () => pts[0].slice())
  const out = []
  const step = total / (closed ? n : n - 1)
  let seg = 0
  let acc = 0
  for (let k = 0; k < n; k++) {
    const target = k * step
    while (seg < ring.length - 2 && acc + dist(ring[seg], ring[seg + 1]) < target) { acc += dist(ring[seg], ring[seg + 1]); seg++ }
    const a = ring[seg]
    const b = ring[seg + 1] || ring[seg]
    const sl = dist(a, b)
    const u = sl === 0 ? 0 : clamp((target - acc) / sl, 0, 1)
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u])
  }
  return out
}

/** The first `frac` of a polyline's length as a new polyline. */
function partial (pts, closed, frac) {
  if (frac >= 1) return closed ? pts.concat([pts[0]]) : pts
  const ring = closed ? pts.concat([pts[0]]) : pts
  const want = polyLength(pts, closed) * Math.max(0, frac)
  const out = [ring[0]]
  let acc = 0
  for (let i = 1; i < ring.length; i++) {
    const sl = dist(ring[i - 1], ring[i])
    if (acc + sl >= want) {
      const u = sl === 0 ? 0 : (want - acc) / sl
      out.push([ring[i - 1][0] + (ring[i][0] - ring[i - 1][0]) * u, ring[i - 1][1] + (ring[i][1] - ring[i - 1][1]) * u])
      return out
    }
    out.push(ring[i])
    acc += sl
  }
  return out
}

const flat = (pts) => { const o = []; for (const p of pts) o.push(p[0], p[1]); return o }

function shapePoints (spec, size, n) {
  const key = String(spec).trim()
  if (Object.prototype.hasOwnProperty.call(PRESETS, key)) {
    const base = PRESETS[key](n)
    const pts = base.map((p) => [p[0] * size / 2, p[1] * size / 2])
    return { pts: resample(pts, true, n), closed: true }
  }
  const subs = parsePath(key)
  if (subs.length === 0) return null
  const s = subs[0]
  return { pts: resample(s.pts, s.closed, n), closed: s.closed }
}

// ── component expansion ──

const FAMILY_CSS = {
  sans: '-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif',
  serif: 'Georgia,"Times New Roman",serif',
  mono: '"SF Mono","JetBrains Mono","Fira Code",Consolas,Menlo,monospace',
  rounded: 'ui-rounded,"SF Pro Rounded","Nunito","Segoe UI",sans-serif',
}
export { FAMILY_CSS }

function fmtNumber (n, decimals, group, locale) {
  try {
    return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: group }).format(n)
  } catch (e) { return String(Math.round(n)) }
}

function ctxFor (layer, t, P, table) {
  const comp = table || COMPONENTS[layer.type].props
  const num = (k) => evalNum(layer[k], t, P, comp[k].def === null ? 0 : comp[k].def)
  const col = (k) => evalColor(layer[k], t, P, comp[k].def === null ? null : (isRef(comp[k].def) ? P[comp[k].def.slice(1)] : comp[k].def))
  const text = (k) => evalStr(layer[k], P, comp[k].def)
  const en = (k) => evalEnum(layer[k], comp[k], P)
  const bool = (k) => evalBool(layer[k], P, comp[k].def)
  return { num, col, text, en, bool }
}

function textOp (g, m, alpha, str, t) {
  return {
    op: 'text', m, alpha, text: str, x: 0, y: 0,
    size: g.num('size'), weight: g.num('weight'), family: g.en('family'), css: FAMILY_CSS[g.en('family')], fill: g.col('fill'), align: g.en('align'),
    maxW: g.num('maxW'), lineHeight: g.num('lineHeight'), tracking: g.num('tracking'),
  }
}

function emit (layers, parent, alphaIn, t, P, scene, ops, name) {
  for (const layer of layers) {
    const g = ctxFor(layer, t, P)
    const start = layer.start
    const end = layer.end
    if ((typeof start === 'number' && t < start) || (typeof end === 'number' && t > end)) continue
    const alpha = alphaIn * clamp(g.num('alpha'), 0, 1)
    if (alpha <= 0.002) continue
    const m = mul(parent, mul(mul(translate(g.num('x'), g.num('y')), rotate(g.num('rot'))), scale(g.num('sx'), g.num('sy'))))
    const tag = { layer: layer.name, comp: layer.type }
    switch (layer.type) {
      case 'group':
        emit(layer.layers, m, alpha, t, P, scene, ops)
        break
      case 'rect': {
        const w = g.num('w'); const h = g.num('h')
        if (w <= 0 || h <= 0) break
        const tl = g.en('origin') === 'tl'
        ops.push({ op: 'rect', m, alpha, x: tl ? 0 : -w / 2, y: tl ? 0 : -h / 2, w, h, r: Math.min(g.num('r'), Math.min(w, h) / 2), fill: g.col('fill'), stroke: g.col('stroke'), lw: g.num('lw'), ...tag })
        break
      }
      case 'circle': {
        const r = g.num('r')
        if (r <= 0) break
        ops.push({ op: 'circle', m, alpha, x: 0, y: 0, r, fill: g.col('fill'), stroke: g.col('stroke'), lw: g.num('lw'), ...tag })
        break
      }
      case 'line': {
        const d = clamp(g.num('draw'), 0, 1)
        if (d <= 0) break
        const dx = layer.x2 === null ? 200 : g.num('x2') - g.num('x')
        const dy = layer.y2 === null ? 0 : g.num('y2') - g.num('y')
        ops.push({ op: 'line', m, alpha, x1: 0, y1: 0, x2: dx * d, y2: dy * d, stroke: g.col('stroke'), lw: g.num('lw'), cap: g.en('cap'), ...tag })
        break
      }
      case 'text': {
        let s = g.text('text')
        const rv = clamp(g.num('reveal'), 0, 1)
        if (rv < 1) s = s.slice(0, Math.floor(s.length * rv + 1e-9))
        if (s === '') break
        ops.push({ ...textOp(g, m, alpha, s, t), ...tag })
        break
      }
      case 'number': {
        const s = g.text('prefix') + fmtNumber(g.num('value'), g.num('decimals'), g.bool('group'), g.en('locale')) + g.text('suffix')
        ops.push({ ...textOp(g, m, alpha, s, t), ...tag })
        break
      }
      case 'image': {
        const src = layer.src
        if (typeof src !== 'string' || src === '') break
        const w = g.num('w'); const h = g.num('h')
        const tl = g.en('origin') === 'tl'
        ops.push({ op: 'image', m, alpha, src, x: tl ? 0 : -w / 2, y: tl ? 0 : -h / 2, w, h, fit: g.en('fit'), r: g.num('r'), ...tag })
        break
      }
      case 'path': {
        const subs = parsePath(layer.d)
        const d = clamp(g.num('draw'), 0, 1)
        if (d <= 0) break
        for (const s of subs) {
          const pts = d >= 1 ? (s.closed ? s.pts.concat([s.pts[0]]) : s.pts) : partial(s.pts, s.closed, d)
          ops.push({ op: 'poly', m, alpha, pts: flat(pts), closed: s.closed && d >= 1, fill: d >= 1 ? g.col('fill') : null, stroke: g.col('stroke'), lw: g.num('lw'), cap: g.en('cap'), ...tag })
        }
        break
      }
      case 'morph': {
        const n = g.num('points')
        const size = g.num('size')
        const a = shapePoints(evalStr(layer.from, P, 'circle'), size, n)
        const b = shapePoints(evalStr(layer.to, P, 'star'), size, n)
        if (a === null || b === null) break
        const p = clamp(g.num('p'), 0, 1)
        const pts = a.pts.map((q, i) => [q[0] + (b.pts[i][0] - q[0]) * p, q[1] + (b.pts[i][1] - q[1]) * p])
        ops.push({ op: 'poly', m, alpha, pts: flat(pts), closed: true, fill: g.col('fill'), stroke: g.col('stroke'), lw: g.num('lw'), cap: 'round', ...tag })
        break
      }
      case 'scene3d': {
        const objects = (layer.objects || []).map((o, i) => {
          const og = ctxFor(o, t, P, OBJECT3D)
          const k = og.num('s')
          return {
            id: 'o' + i, shape: og.en('shape'),
            pos: [og.num('x'), og.num('y'), og.num('z')], rot: [og.num('rx'), og.num('ry'), og.num('rz')], scale: [k * og.num('w'), k * og.num('h'), k * og.num('d')],
            color: og.col('color'), metal: og.num('metal'), rough: og.num('rough'), opacity: og.num('opacity'), wire: og.bool('wire'),
            src: o.src, clip: o.clip, clipTime: Math.max(0, (t - og.num('clipT0')) * og.num('speed')), loop: og.bool('loop'),
          }
        }).filter((o) => o.opacity > 0.002)
        if (objects.length === 0) break
        const w = g.num('w'); const h = g.num('h')
        const look = [g.num('lx'), g.num('ly'), g.num('lz')]
        const th = (g.num('orbit') * Math.PI) / 180
        const dx = g.num('cx') - look[0]
        const dz = g.num('cz') - look[2]
        ops.push({
          op: 'scene3d', m, alpha, x: -w / 2, y: -h / 2, w, h, bg: g.col('bg'),
          camera: { pos: [look[0] + dx * Math.cos(th) + dz * Math.sin(th), g.num('cy'), look[2] - dx * Math.sin(th) + dz * Math.cos(th)], look, fov: g.num('fov') },
          light: { ambient: g.num('ambient'), sun: g.num('sun'), pos: [g.num('sunX'), g.num('sunY'), g.num('sunZ')] },
          objects, ...tag,
        })
        break
      }
      case 'lottie': {
        const src = layer.src
        if (typeof src !== 'string' || src === '') break
        const w = g.num('w'); const h = g.num('h')
        const t0 = g.num('t0')
        if (t < t0) break
        ops.push({ op: 'lottie', m, alpha, src, x: -w / 2, y: -h / 2, w, h, time: (t - t0) * g.num('speed'), loop: g.bool('loop'), ...tag })
        break
      }
      case 'chart':
        expandChart(layer, g, m, alpha, t, P, ops, tag)
        break
      case 'particles':
        expandParticles(layer, g, m, alpha, t, P, ops, tag)
        break
      default:
        break
    }
  }
}

const PALETTE = ['#4176e6', '#e8603c', '#1f9d6b', '#f59e0b', '#7c5cff', '#14b8a6', '#ec4899', '#64748b']

function chartColors (layer, g, P) {
  const list = Array.isArray(layer.colors) && layer.colors.length > 0 ? layer.colors : PALETTE
  return list.map((c) => (isRef(c) ? P[c.slice(1)] : c)).filter((c) => typeof c === 'string' && parseColor(c) !== null)
}

function expandChart (layer, g, m, alpha, t, P, ops, tag) {
  const data = (layer.data || []).map((d) => ({ ...d, value: evalNum(d.value, t, P, 0) }))
  if (data.length === 0) return
  const w = g.num('w'); const h = g.num('h'); const p = clamp(g.num('p'), 0, 1)
  const ink = g.col('ink') || P.ink
  const colors = chartColors(layer, g, P)
  const colorOf = (d, i) => (d.color !== undefined ? evalColor(d.color, t, P, colors[i % colors.length]) : colors[i % colors.length])
  const ls = layer.labelSize
  const kind = g.en('kind')
  const showLabels = g.bool('labels')
  const showValues = g.bool('values')
  const maxV = layer.max !== null && layer.max !== undefined && layer.max > 0 ? layer.max : Math.max(...data.map((d) => d.value), 1e-9)
  const n = data.length
  const labelBand = showLabels ? ls * 1.9 : 0
  const valueBand = showValues && kind !== 'pie' ? ls * 1.6 : 0
  const plotH = Math.max(1, h - labelBand - valueBand)
  // whole numbers stay whole while a bar grows (no "33,6" on the way to 34); a data set with decimals keeps one
  const wholeData = data.every((d) => Number.isInteger(d.value))
  const fmt = (v) => (wholeData ? fmtNumber(Math.round(v), 0, true, 'fr') : fmtNumber(v, Math.abs(v) < 100 && v % 1 !== 0 ? 1 : 0, true, 'fr'))
  const label = (text, x, y, size, alphaK, align) => ops.push({ op: 'text', m, alpha: alpha * alphaK, text, x, y, size, weight: 500, family: 'sans', css: FAMILY_CSS.sans, fill: ink, align: align || 'center', maxW: Math.max(40, w / n * 0.95), lineHeight: 1.2, tracking: 0, ...tag })
  if (kind === 'bar') {
    const slot = w / n
    const bw = slot * 0.62
    const stag = 0.5
    data.forEach((d, i) => {
      const local = clamp((p * (1 + stag * (n - 1)) - i * stag), 0, 1)
      const e = EASES.out(local)
      const bh = Math.max(0, (d.value / maxV) * plotH * e)
      const cx = -w / 2 + slot * (i + 0.5)
      const base = h / 2 - labelBand
      if (bh > 0.5) ops.push({ op: 'rect', m, alpha, x: cx - bw / 2, y: base - bh, w: bw, h: bh, r: Math.min(8, bw / 2), fill: colorOf(d, i), stroke: null, lw: 0, ...tag })
      if (showValues && local > 0.05) label(fmt(d.value * e), cx, base - bh - ls * 0.95, ls, local)
      if (showLabels && d.label !== '') label(d.label, cx, base + ls * 1.05, ls, 1)
    })
    ops.push({ op: 'line', m, alpha: alpha * 0.5, x1: -w / 2, y1: h / 2 - labelBand, x2: w / 2, y2: h / 2 - labelBand, stroke: ink, lw: 2, cap: 'butt', ...tag })
  } else if (kind === 'line') {
    const xs = (i) => (n === 1 ? 0 : -w / 2 + (w * i) / (n - 1))
    const base = h / 2 - labelBand
    const pts = data.map((d, i) => [xs(i), base - (d.value / maxV) * plotH])
    const shown = partial(pts, false, p)
    if (shown.length > 1) ops.push({ op: 'poly', m, alpha, pts: flat(shown), closed: false, fill: null, stroke: colors[0], lw: 8, cap: 'round', ...tag })
    const reach = polyLength(pts, false) * p
    let acc = 0
    pts.forEach((q, i) => {
      if (i > 0) acc += dist(pts[i - 1], q)
      if (acc <= reach + 1e-6) {
        ops.push({ op: 'circle', m, alpha, x: q[0], y: q[1], r: 11, fill: colors[0], stroke: null, lw: 0, ...tag })
        if (showValues) label(fmt(data[i].value), q[0], q[1] - ls * 1.3, ls, 1)
      }
      if (showLabels && data[i].label !== '') label(data[i].label, q[0], base + ls * 1.05, ls, 1)
    })
  } else {
    const total = data.reduce((a, d) => a + Math.max(0, d.value), 0) || 1
    const R = Math.min(w, h) / 2
    let a0 = -Math.PI / 2
    const sweep = EASES.io(p) * 2 * Math.PI
    let used = 0
    data.forEach((d, i) => {
      const span = (Math.max(0, d.value) / total) * 2 * Math.PI
      const visible = clamp(sweep - used, 0, span)
      used += span
      if (visible > 0.001) {
        const steps = Math.max(2, Math.ceil(visible / 0.08))
        const pts = [[0, 0]]
        for (let s = 0; s <= steps; s++) { const a = a0 + (visible * s) / steps; pts.push([Math.cos(a) * R, Math.sin(a) * R]) }
        ops.push({ op: 'poly', m, alpha, pts: flat(pts), closed: true, fill: colorOf(d, i), stroke: null, lw: 0, cap: 'butt', ...tag })
        if (showLabels && visible >= span - 1e-6 && d.label !== '') {
          const mid = a0 + span / 2
          label(`${d.label}${showValues ? ' ' + Math.round((d.value / total) * 100) + '%' : ''}`, Math.cos(mid) * R * 0.62, Math.sin(mid) * R * 0.62, ls, 1)
        }
      }
      a0 += span
    })
  }
}

function expandParticles (layer, g, m, alpha, t, P, ops, tag) {
  const count = g.num('count')
  const mode = g.en('mode')
  const t0 = g.num('t0'); const t1 = Math.max(t0, g.num('t1'))
  const life = g.num('life')
  const speed = g.num('speed'); const speedVar = g.num('speedVar')
  const angle = g.num('angle'); const spread = g.num('spread')
  const gravity = g.num('gravity'); const drag = g.num('drag')
  const size0 = g.num('size0'); const size1 = g.num('size1'); const spin = g.num('spin')
  const seed = g.num('seed')
  const fade = g.bool('fade')
  const shape = g.en('shape')
  const colors = (Array.isArray(layer.colors) && layer.colors.length > 0 ? layer.colors : ['#4176e6', '#e8603c', '#f59e0b', '#1f9d6b', '#7c5cff']).map((c) => (isRef(c) ? P[c.slice(1)] : c)).filter((c) => typeof c === 'string' && parseColor(c) !== null)
  if (colors.length === 0) return
  for (let i = 0; i < count; i++) {
    const birth = mode === 'burst' ? t0 : t0 + (i / count) * (t1 - t0)
    const age = t - birth
    if (age < 0 || age > life) continue
    const u = age / life
    const a = ((angle + (rand(seed, i, 1) - 0.5) * spread) * Math.PI) / 180
    const sp = speed * (1 - speedVar * rand(seed, i, 2))
    const vx = Math.cos(a) * sp
    const vy = Math.sin(a) * sp
    const run = drag > 0 ? (1 - Math.exp(-drag * age)) / drag : age
    const px = vx * run
    const py = vy * run + 0.5 * gravity * age * age
    const size = Math.max(0, (size0 + (size1 - size0) * u) * (0.6 + 0.8 * rand(seed, i, 3)))
    if (size <= 0.2) continue
    const fill = colors[Math.floor(rand(seed, i, 4) * colors.length) % colors.length]
    const pa = alpha * (fade ? Math.min(1, (1 - u) * 1.6, age * 12) : Math.min(1, age * 12))
    if (pa <= 0.004) continue
    const pm = mul(m, mul(translate(px, py), rotate(spin * age * 57.2958 + rand(seed, i, 5) * 360)))
    if (shape === 'circle') ops.push({ op: 'circle', m: pm, alpha: pa, x: 0, y: 0, r: size / 2, fill, stroke: null, lw: 0, ...tag })
    else if (shape === 'square') ops.push({ op: 'rect', m: pm, alpha: pa, x: -size / 2, y: -size / 2, w: size, h: size, r: 0, fill, stroke: null, lw: 0, ...tag })
    else ops.push({ op: 'rect', m: pm, alpha: pa, x: -size * 1.4, y: -size * 0.12, w: size * 2.8, h: size * 0.24, r: size * 0.12, fill, stroke: null, lw: 0, ...tag })
  }
}

/** Params as the scene sees them: its own, the caller's overrides, plus $bg and $ink derived from the background. */
export function buildParams (scene, overrides) {
  const P = { ...scene.params }
  if (isObj(overrides)) for (const [k, v] of Object.entries(overrides)) if (typeof v === 'string' || isNum(v) || typeof v === 'boolean') P[k] = v
  const bgRaw = scene.background
  const bg = isObj(bgRaw) ? evalColor(bgRaw.gradient.stops[0][1], 0, P, '#0f1115') : evalColor(bgRaw, 0, P, '#0f1115')
  P.bg = bg
  P.ink = inkOn(bg)
  return P
}

/** One instant of a scene as a frame { t, width, height, background, ops }. `scene` may be raw (it is validated). */
export function evaluate (sceneIn, t, overrides) {
  const scene = sceneIn && sceneIn._n === true ? sceneIn : validate(sceneIn).scene
  const P = buildParams(scene, overrides)
  const T = clamp(isNum(t) ? t : 0, 0, scene.format.duration)
  const ops = []
  emit(scene.layers, IDENT, 1, T, P, scene, ops)
  const bgRaw = scene.background
  const background = isObj(bgRaw) ? evalColor(bgRaw, T, P, P.bg) : evalColor(bgRaw, T, P, '#0f1115')
  return { t: T, width: scene.format.width, height: scene.format.height, background, ops }
}

// ───────────────────────── timeline + inspection ─────────────────────────

function keyTimes (layer) {
  const out = []
  const props = COMPONENTS[layer.type].props
  for (const name of Object.keys(props)) {
    const v = layer[name]
    if (isObj(v) && Array.isArray(v.k)) for (const k of v.k) if (!out.includes(k[0])) out.push(k[0])
  }
  if (layer.type === 'particles') { if (!out.includes(layer.t0)) out.push(layer.t0); if (!out.includes(layer.t1) && layer.mode === 'stream') out.push(layer.t1) }
  if (layer.type === 'lottie' && !out.includes(layer.t0)) out.push(layer.t0)
  if (layer.type === 'scene3d') {
    for (const o of layer.objects || []) {
      for (const name of Object.keys(OBJECT3D)) { const v = o[name]; if (isObj(v) && Array.isArray(v.k)) for (const k of v.k) if (!out.includes(k[0])) out.push(k[0]) }
    }
  }
  return out.sort((a, b) => a - b)
}

/** Editor rows: one per layer, groups flattened with a depth. { name, type, depth, keys, from, to } */
export function timeline (sceneIn) {
  const scene = sceneIn && sceneIn._n === true ? sceneIn : validate(sceneIn).scene
  const rows = []
  const walk = (layers, depth) => {
    for (const l of layers) {
      const keys = keyTimes(l)
      rows.push({ name: l.name, type: l.type, depth, keys, from: keys.length ? keys[0] : null, to: keys.length ? keys[keys.length - 1] : null })
      if (l.layers) walk(l.layers, depth + 1)
    }
  }
  walk(scene.layers, 0)
  return rows
}

const CHAR_W = (ch) => (/[il.,;:'!|`]/.test(ch) ? 0.28 : /[mwMW@%]/.test(ch) ? 0.86 : /[A-Z]/.test(ch) ? 0.68 : /[0-9]/.test(ch) ? 0.58 : ch === ' ' ? 0.3 : 0.52)
/** Rough text width in px (no font access in pure code): enough to catch clipping and collisions. */
export function estimateTextWidth (text, size, weight, tracking) {
  let w = 0
  for (const ch of String(text)) w += CHAR_W(ch)
  return w * size * (weight >= 700 ? 1.06 : 1) + (tracking || 0) * Math.max(0, String(text).length - 1)
}

function opBox (op) {
  const pts = []
  const add = (x, y) => pts.push(apply(op.m, x, y))
  if (op.op === 'rect' || op.op === 'image' || op.op === 'lottie' || op.op === 'scene3d') { add(op.x, op.y); add(op.x + op.w, op.y); add(op.x + op.w, op.y + op.h); add(op.x, op.y + op.h) }
  else if (op.op === 'circle') { add(op.x - op.r, op.y - op.r); add(op.x + op.r, op.y - op.r); add(op.x + op.r, op.y + op.r); add(op.x - op.r, op.y + op.r) }
  else if (op.op === 'line') { add(op.x1, op.y1); add(op.x2, op.y2) }
  else if (op.op === 'poly') for (let i = 0; i < op.pts.length; i += 2) add(op.pts[i], op.pts[i + 1])
  else if (op.op === 'text') {
    const lines = op.text.split('\n')
    const width = Math.min(op.maxW, Math.max(...lines.map((l) => estimateTextWidth(l, op.size, op.weight, op.tracking))))
    const height = lines.length * op.size * op.lineHeight
    const x0 = op.align === 'left' ? 0 : op.align === 'right' ? -width : -width / 2
    add(op.x + x0, op.y - height / 2); add(op.x + x0 + width, op.y - height / 2); add(op.x + x0 + width, op.y + height / 2); add(op.x + x0, op.y + height / 2)
  }
  if (pts.length === 0) return null
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]) }
  return { x0, y0, x1, y1 }
}
export { opBox }

const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)
const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))

/**
 * What an agent cannot see. Samples the scene and reports, per layer, when it is on screen, and warns about:
 *   cutoff     text that leaves the frame
 *   overlap    two readable texts on top of each other
 *   contrast   text hard to read on what is behind it
 *   small      text under ~3% of the frame height (hard to read on a phone)
 *   short      text on screen too briefly to be read
 *   empty      nothing visible at all, or a layer that never shows
 * Approximate on purpose (text is measured by an estimate), so each warning names the instant and the layer.
 */
export function inspect (sceneIn, overrides) {
  const scene = sceneIn && sceneIn._n === true ? sceneIn : validate(sceneIn).scene
  const { width, height, duration } = scene.format
  const step = Math.min(0.1, duration / 20)
  const PERSIST = 0.3 // a problem that lasts less than this is a transition, not a defect
  const seen = new Map()
  const problems = new Map() // code|layer -> { code, layer, t, message, secs }
  const texts = new Map() // text layer -> { longest, secs: Map(text -> seconds readable) }
  let anyVisible = false
  for (let t = 0; t <= duration + 1e-9; t += step) {
    const fr = evaluate(scene, t, overrides)
    const bgc = parseColor(typeof fr.background === 'string' ? fr.background : (fr.background && fr.background.gradient ? fr.background.gradient.stops[0][1] : '#000000')) || [0, 0, 0, 1]
    const boxes = []
    const now = new Set()
    const flag = (code, layer, message) => {
      const k = code + '|' + layer
      if (now.has(k)) return
      now.add(k)
      const p = problems.get(k) || { code, layer, t, message, secs: 0 }
      p.secs += step
      problems.set(k, p)
    }
    fr.ops.forEach((op, idx) => {
      const b = opBox(op)
      if (b === null) return
      const rec = seen.get(op.layer) || { name: op.layer, type: op.comp, first: t, last: t }
      rec.last = t
      seen.set(op.layer, rec)
      if (op.alpha > 0.05 && area(b) > 4) anyVisible = true
      if (op.op !== 'text') return
      boxes.push({ op, b, idx })
      const inFrame = b.x0 >= -width * 0.02 && b.x1 <= width * 1.02 && b.y0 >= -height * 0.02 && b.y1 <= height * 1.02
      if (!inFrame && op.alpha > 0.5) flag('cutoff', op.layer, `text "${op.text.slice(0, 30)}" leaves the frame (${Math.round(b.x0)}..${Math.round(b.x1)} x ${Math.round(b.y0)}..${Math.round(b.y1)} on ${width}x${height})`)
      if (op.size * Math.hypot(op.m[0], op.m[1]) < height * 0.03 && op.alpha > 0.5) flag('small', op.layer, `text "${op.text.slice(0, 30)}" is ${Math.round(op.size)}px on a ${height}px-tall frame: hard to read on a phone`)
      // what is behind it: the last filled rect or circle painted before it that contains its centre, else the background
      let back = bgc
      const cx = (b.x0 + b.x1) / 2
      const cy = (b.y0 + b.y1) / 2
      for (let j = idx - 1; j >= 0; j--) {
        const o = fr.ops[j]
        if ((o.op !== 'rect' && o.op !== 'circle') || typeof o.fill !== 'string' || o.alpha < 0.6) continue
        const ob = opBox(o)
        if (ob !== null && cx >= ob.x0 && cx <= ob.x1 && cy >= ob.y0 && cy <= ob.y1) { const c = parseColor(o.fill); if (c !== null && c[3] > 0.6) { back = c; break } }
      }
      const fg = typeof op.fill === 'string' ? parseColor(op.fill) : null
      if (fg !== null && op.alpha > 0.7) {
        const need = op.size >= 48 ? 3 : 4.5
        const ratio = contrast(fg, back)
        if (ratio < need) flag('contrast', op.layer, `text "${op.text.slice(0, 30)}" has contrast ${ratio.toFixed(1)}:1 on what is behind it (needs ${need}:1)`)
      }
      if (op.comp === 'text' && op.alpha >= 0.9) {
        const rec2 = texts.get(op.layer) || { longest: '', secs: new Map() }
        if (op.text.length > rec2.longest.length) rec2.longest = op.text
        rec2.secs.set(op.text, (rec2.secs.get(op.text) || 0) + step)
        texts.set(op.layer, rec2)
      }
    })
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i]
        const B = boxes[j]
        if (A.op.alpha < 0.6 || B.op.alpha < 0.6 || A.op.layer === B.op.layer) continue
        if (overlapArea(A.b, B.b) > 0.15 * Math.min(area(A.b), area(B.b))) flag('overlap', A.op.layer, `texts "${A.op.text.slice(0, 24)}" (${A.op.layer}) and "${B.op.text.slice(0, 24)}" (${B.op.layer}) overlap`)
      }
    }
  }
  const warnings = []
  for (const p of problems.values()) if (p.code === 'small' || p.secs >= PERSIST - 1e-9) warnings.push({ code: p.code, layer: p.layer, t: Math.round(p.t * 100) / 100, message: p.message })
  for (const [layer, rec] of texts) {
    const secs = rec.secs.get(rec.longest) || 0
    const need = Math.max(1, rec.longest.trim().split(/\s+/).length * 0.25)
    if (secs + 1e-6 < need) warnings.push({ code: 'short', layer, t: 0, message: `text "${rec.longest.slice(0, 30)}" is fully readable for only ${secs.toFixed(1)}s (about ${need.toFixed(1)}s needed)` })
  }
  if (!anyVisible) warnings.push({ code: 'empty', layer: '(scene)', t: 0, message: 'nothing is visible in this scene' })
  for (const row of timeline(scene)) if (!seen.has(row.name) && row.type !== 'group') warnings.push({ code: 'empty', layer: row.name, t: 0, message: `layer "${row.name}" never draws anything (check alpha, size, start/end)` })
  const layers = [...seen.values()].map((r) => ({ name: r.name, type: r.type, from: Math.round(r.first * 100) / 100, to: Math.round(r.last * 100) / 100 }))
  return { duration, size: `${width}x${height}`, layers, warnings }
}

/** Every file a scene points at, by kind: { images, lotties, models, sounds }. */
export function assetsOf (sceneIn) {
  const scene = sceneIn && sceneIn._n === true ? sceneIn : validate(sceneIn).scene
  const out = { images: [], lotties: [], models: [], sounds: [] }
  const add = (list, v) => { if (typeof v === 'string' && v !== '' && !list.includes(v)) list.push(v) }
  const walk = (layers) => {
    for (const l of layers || []) {
      if (l.type === 'image') add(out.images, l.src)
      else if (l.type === 'lottie') add(out.lotties, l.src)
      else if (l.type === 'scene3d') for (const o of l.objects || []) if (o.shape === 'model') add(out.models, o.src)
      if (l.layers) walk(l.layers)
    }
  }
  walk(scene.layers)
  for (const a of scene.audio || []) add(out.sounds, a.src)
  return out
}

/** Which heavy libraries a scene needs: { three, lottie }. They are only fetched when this says so. */
export function needs (sceneIn) {
  const scene = sceneIn && sceneIn._n === true ? sceneIn : validate(sceneIn).scene
  const out = { three: false, lottie: false }
  const walk = (layers) => { for (const l of layers || []) { if (l.type === 'scene3d') out.three = true; if (l.type === 'lottie') out.lottie = true; if (l.layers) walk(l.layers) } }
  walk(scene.layers)
  return out
}

/** A compact catalogue of the components, for a tool description: what the agent may put in `layers`. */
export function describeComponents () {
  const lines = []
  for (const [type, comp] of Object.entries(COMPONENTS)) {
    const names = Object.entries(comp.props).filter(([n]) => !(n in XFORM) || n === 'x' || n === 'y').map(([n, s]) => n + (s.t === 'enum' ? `(${s.list.join('|')})` : '')).join(', ')
    lines.push(`- ${type}: ${comp.about} Props: ${names}.${comp.container ? ' Holds layers[].' : ''}${type === 'scene3d' ? ' objects[] each: ' + Object.entries(OBJECT3D).map(([n, sp]) => n + (sp.t === 'enum' ? `(${sp.list.join('|')})` : '')).join(', ') + '.' : ''}`)
  }
  return lines.join('\n')
}
