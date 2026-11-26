// test-map.mjs: the Map view of the Tables page (MapLibre GL + OpenFreeMap), outside a browser. client.js is evaluated as the engine loads it, against a small fake DOM and a
// fake map library; the pieces under test are the pure helpers (projection, clusters, the gate, the verdicts, the colours, the style made quiet) and the two components that
// use them (`MapSwitch`, `RealMap`): that nothing is asked of anyone before the view is opened, what is asked (and what is NOT sent: no cookie, no referrer), that a failure of any
// kind ends in the drawn map with its reason and a way back, that the pins are buttons that light, open, cluster and follow the zoom, and that everything is taken away on unmount.
// The real browser is `scripts/check-db-map-live.mjs`.
//
//   node packages/kybernos-db/test-map.mjs
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createLite } from '../kybernos-plugin/lib-lite-react-test.mjs'
import * as core from './core/index.mjs'

let failed = 0
const ok = (label, cond, detail) => {
  if (cond) console.log('✓ ' + label + (detail === undefined ? '' : ' (' + detail + ')'))
  else { console.error('✗ ' + label + (detail === undefined ? '' : ' — ' + detail)); failed += 1 }
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

// ── a small fake DOM ───────────────────────────────────────────────────────────────────────────────────
const doc = { activeElement: null }
class El {
  constructor (tag) { this.tag = tag; this.attrs = new Map(); this.kids = []; this.parent = null; this.listeners = new Map(); this.cls = new Set(); this.textContent = ''; this.style = {} }
  get className () { return [...this.cls].join(' ') }
  set className (v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)) }
  get classList () { const me = this; return { toggle (c, on) { const want = on === undefined ? !me.cls.has(c) : on; if (want) me.cls.add(c); else me.cls.delete(c); return want }, contains: (c) => me.cls.has(c) } }
  setAttribute (k, v) { this.attrs.set(k, String(v)) }
  getAttribute (k) { return this.attrs.has(k) ? this.attrs.get(k) : null }
  removeAttribute (k) { this.attrs.delete(k) }
  appendChild (c) { if (c.parent !== null) c.parent.kids = c.parent.kids.filter((x) => x !== c); c.parent = this; this.kids.push(c); return c }
  remove () { if (this.parent !== null) { this.parent.kids = this.parent.kids.filter((x) => x !== this); this.parent = null } }
  addEventListener (t, fn) { if (!this.listeners.has(t)) this.listeners.set(t, []); this.listeners.get(t).push(fn) }
  fire (t, ev = {}) { for (const fn of this.listeners.get(t) || []) fn(ev) }
  focus () { doc.activeElement = this; this.fire('focus') }
}
const env = { webgl: true, tokens: null, storageThrows: false }
let pixel = [0, 0, 0]
const parseForPixel = (text) => {
  if (text === 'black') return [0, 0, 0]
  return null
}
doc.createElement = (tag) => {
  const el = new El(tag)
  if (tag === 'canvas') {
    el.getContext = (kind) => {
      if (kind === '2d') {
        let last = [0, 0, 0]
        const ctx = { clearRect () {}, fillRect () { pixel = last }, getImageData: () => ({ data: [Math.round(pixel[0]), Math.round(pixel[1]), Math.round(pixel[2]), 255] }) }
        Object.defineProperty(ctx, 'fillStyle', { set (v) { const c = parseForPixel(v) || T.parseColor(v); if (c !== null) last = c } })
        return ctx
      }
      return env.webgl ? {} : null
    }
  }
  return el
}
doc.head = new El('head')
doc.getElementById = () => null
const docListeners = new Map()
doc.addEventListener = (t, fn) => { if (!docListeners.has(t)) docListeners.set(t, new Set()); docListeners.get(t).add(fn) }
doc.removeEventListener = (t, fn) => { if (docListeners.has(t)) docListeners.get(t).delete(fn) }
doc.visibilityState = 'visible'
doc.contains = () => false
globalThis.document = doc

// ── a fake browser: window, fetch, timers, the map library ─────────────────────────────────────────────
let language = 'en'
let reduced = false
let narrow = false
const store = new Map()
const listeners = new Map()
const windowObject = {
  __ModuleLoader__: { load: (entry) => { loaded = entry } },
  __KB_LANG_RESOLVE__: () => language,
  localStorage: { getItem: (k) => { if (env.storageThrows) throw new Error('storage blocked'); return store.has(k) ? store.get(k) : null }, setItem: (k, v) => { if (env.storageThrows) throw new Error('storage blocked'); store.set(k, String(v)) } },
  matchMedia: (q) => ({ matches: /reduced-motion/.test(q) ? reduced : (/max-width: 900px/.test(q) ? narrow : false) }),
  addEventListener (t, fn) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn) },
  removeEventListener (t, fn) { if (listeners.has(t)) listeners.get(t).delete(fn) },
}
const emit = (t) => { for (const fn of [...(listeners.get(t) || [])]) fn({}) }
globalThis.window = windowObject
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
let loaded = null

const STYLE = {
  version: 8,
  sprite: 'https://tiles.openfreemap.org/sprites/x/ofm',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }, ne2_shaded: { type: 'raster', tiles: ['https://tiles.openfreemap.org/natural_earth/{z}/{x}/{y}.png'] } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': 'rgb(242,243,240)' } },
    { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', paint: { 'fill-color': 'rgb(230, 233, 229)' } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': 'rgb(194, 200, 202)' } },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 12, paint: { 'fill-color': 'rgb(234, 234, 229)', 'fill-outline-color': 'rgb(219, 219, 218)' } },
    { id: 'highway_major_casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': 'rgb(213, 213, 213)', 'line-width': 3 } },
    { id: 'highway_major_inner', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': '#fff', 'line-width': 2 } },
    { id: 'highway_motorway_inner', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': ['interpolate', ['linear'], ['zoom'], 5.8, 'hsla(0,0%,85%,0.53)', 6, '#fff'] } },
    { id: 'highway_minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': 'hsl(0,0%,88%)' } },
    { id: 'boundary_3', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', paint: { 'line-color': 'hsl(0,0%,70%)' } },
    { id: 'strange_new_layer', type: 'fill', source: 'openmaptiles', 'source-layer': 'x', paint: { 'fill-color': 'rgb(250, 250, 250)', 'fill-opacity': 0.5 } },
    { id: 'highway-shield-non-us', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', layout: { 'icon-image': 'shield' } },
    { id: 'highway-name-minor', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', minzoom: 15, layout: { 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']] }, paint: { 'text-color': '#666', 'text-halo-width': 1 } },
    { id: 'label_town', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 6, layout: { 'icon-image': ['step', ['zoom'], 'circle_11_black', 10, ''], 'icon-size': 0.2, 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']] }, paint: { 'text-color': '#000', 'text-halo-color': '#fff', 'text-halo-width': 1 } },
  ],
}
const net = { style: 'ok', fetches: [], down: new Set() }
/** What OpenFreeMap answers for a style: « positron » is the fixture above; the two detailed ones have their own warm background and a place-of-interest layer. */
const styleOf = (name) => {
  const out = JSON.parse(JSON.stringify(STYLE))
  if (name === 'positron') return out
  out.layers[0].paint['background-color'] = name === 'liberty' ? 'rgb(250, 240, 228)' : 'rgb(246, 244, 240)'
  out.layers.push({ id: 'poi_r20', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', layout: { 'icon-image': 'shop', 'text-field': ['get', 'name'] } })
  return out
}
globalThis.fetch = async (url, init = {}) => {
  net.fetches.push({ url: String(url), init })
  if (!['positron', 'liberty', 'bright'].some((n) => String(url) === 'https://tiles.openfreemap.org/styles/' + n)) return { ok: false, status: 404, json: async () => ({}) }
  if (net.down.has(String(url).split('/').pop())) return { ok: false, status: 503, json: async () => ({}) }
  if (net.style === 'throw') throw new TypeError('Failed to fetch')
  if (net.style === 'status') return { ok: false, status: 503, json: async () => ({}) }
  if (net.style === 'shape') return { ok: true, status: 200, json: async () => ({ nope: true }) }
  return { ok: true, status: 200, json: async () => styleOf(String(url).split('/').pop()) }
}
// timers: a long one (the budget of the start, the theme watcher) is kept so the test can fire it; short ones run for real (the harness settles on them)
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
const held = []
globalThis.setTimeout = (fn, ms, ...rest) => { if (typeof ms === 'number' && ms >= 1000) { const t = { fn, ms, live: true }; held.push(t); return t } return realSetTimeout(fn, ms, ...rest) }
globalThis.clearTimeout = (id) => { if (id !== null && typeof id === 'object' && 'live' in id) id.live = false; else realClearTimeout(id) }
globalThis.setInterval = (fn, ms) => { const t = { fn, ms, live: true, interval: true }; held.push(t); return t }
globalThis.clearInterval = (id) => { if (id !== null && typeof id === 'object') id.live = false; else realClearInterval(id) }
const live = () => held.filter((t) => t.live)
let skew = 0
const realNow = Date.now.bind(Date)
Date.now = () => realNow() + skew

const makeLib = (log) => {
  class Marker {
    constructor (options) { this.options = options; this.element = options.element; this.lngLat = null; this.removed = false; log.markers.push(this) }
    setLngLat (l) { this.lngLat = l; return this }
    addTo (map) { map.getCanvasContainer().appendChild(this.element); return this }
    remove () { this.removed = true; this.element.remove() }
  }
  class MapLib {
    constructor (options) {
      if (log.throwOnCreate) throw new Error('Failed to initialize WebGL')
      this.options = options; this.handlers = {}; this.calls = []; this.zoom = 11; this.removed = false; this.container = new El('div'); this.box = [[2.2, 48.8], [2.5, 48.9]]
      this.touchZoomRotate = { disableRotation: () => this.calls.push(['noRotate']) }
      this.keyboard = { disableRotation: () => this.calls.push(['noKeyRotate']) }
      log.maps.push(this)
    }
    on (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn) }
    fire (ev, payload) { for (const fn of this.handlers[ev] || []) fn(payload) }
    getZoom () { return this.zoom }
    getCenter () { return { lat: 48.86, lng: 2.35 } }
    getCanvasContainer () { return this.container }
    getBounds () { return { contains: ([lng, lat]) => lng >= this.box[0][0] && lng <= this.box[1][0] && lat >= this.box[0][1] && lat <= this.box[1][1] } }
    fitBounds (b, o) { this.calls.push(['fitBounds', b, o]) }
    flyTo (o) { this.calls.push(['flyTo', o]); this.zoom = o.zoom }
    jumpTo (o) { this.calls.push(['jumpTo', o]); this.zoom = o.zoom }
    zoomIn (o) { this.calls.push(['zoomIn', o]) }
    zoomOut (o) { this.calls.push(['zoomOut', o]) }
    setStyle (s, o) { this.calls.push(['setStyle', s, o]) }
    resize () {}
    remove () { this.removed = true }
  }
  return { Map: MapLib, Marker }
}

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
// eslint-disable-next-line no-new-func
new Function('window', 'document', source)(windowObject, doc)
const lite = createLite()
const { React } = lite
// the lite React does not wire refs: the box the real map is made in is put in the ref of the element that asks for it, as the browser would
const gl = new El('div')
const plainCreate = React.createElement
React.createElement = (type, props, ...kids) => { if (props !== null && props !== undefined && props.ref !== undefined && props['data-kb'] === 'tables-map' && props['data-map'] === 'real') props.ref.current = gl; return plainCreate(type, props, ...kids) }
const h = React.createElement
const plugin = loaded.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) })
const T = plugin.__test
T.useCore(core)
const P = T.build(React).parts

// ── the projection ─────────────────────────────────────────────────────────────────────────────────────
{
  const a = T.worldPx(0, 0, 0)
  ok('the world is 512 px wide at zoom 0, its middle at the equator and the meridian', close(a.x, 256) && close(a.y, 256) && close(T.worldPx(0, 180, 1).x, 1024) && T.worldPx(60, 0, 3).y < T.worldPx(0, 0, 3).y)
  ok('each zoom doubles the world, and a latitude past the poles of the projection is held', close(T.worldPx(48.85, 2.35, 5).x * 2, T.worldPx(48.85, 2.35, 6).x) && Number.isFinite(T.worldPx(90, 0, 4).y) && Number.isFinite(T.worldPx(-90, 0, 4).y))
}

// ── the clusters ───────────────────────────────────────────────────────────────────────────────────────
const place = (id, lat, lng, over) => ({ row: Object.assign({ id, title: 'Item ' + id, label: '€' + (300 + id) + 'k', amount: '€' + (300000 + id * 1000) }, over), lat, lng })
const PARIS = [place(1, 48.8567, 2.3603), place(2, 48.8516, 2.3573), place(3, 48.8509, 2.3337), place(4, 48.8646, 2.3467), place(5, 48.8584, 2.2653), place(6, 48.8657, 2.4078)]
{
  const far = T.clusterPins(PARIS, 16)
  ok('far enough in, every place stands alone, keyed by its id, in the order of the list', far.length === 6 && far.every((c) => c.count === 1 && /^p\d+$/.test(c.key)) && far.map((c) => c.items[0].row.id).join() === '1,2,3,4,5,6')
  const wide = T.clusterPins(PARIS, 8)
  ok('far out, places whose pills would overlap make one cluster, with the count and the middle of its members', wide.length === 1 && wide[0].count === 6 && wide[0].key === 'c1-2-3-4-5-6' && close(wide[0].lat, PARIS.reduce((n, p) => n + p.lat, 0) / 6) && wide[0].items.length === 6)
  const mid = T.clusterPins(PARIS, 11)
  ok('in between, some join and some do not, and the pair that is close joins first', mid.length > 1 && mid.length < 6 && mid.some((c) => c.count > 1) && mid.reduce((n, c) => n + c.count, 0) === 6)
  ok('what a cluster is depends on the zoom only: the same places give the same clusters, whatever order the rest comes in', JSON.stringify(T.clusterPins(PARIS, 11).map((c) => c.key)) === JSON.stringify(T.clusterPins(PARIS.slice().reverse(), 11).map((c) => c.key).sort()) || T.clusterPins(PARIS, 11).map((c) => c.key).sort().join() === T.clusterPins(PARIS.slice().reverse(), 11).map((c) => c.key).sort().join() && T.clusterPins([], 5).length === 0)
  const twins = [place(7, 48.85, 2.35), place(8, 48.85, 2.35)]
  ok('two places on the very same spot are one cluster at every zoom', T.clusterPins(twins, 18).length === 1 && T.clusterPins(twins, 18)[0].count === 2)
  ok('a wider pill box clusters more', T.clusterPins(PARIS, 14, { w: 400, h: 400 }).length < T.clusterPins(PARIS, 14, { w: 20, h: 10 }).length)
  const near = PARIS[0]
  ok('the zoom at which a place stands alone: where it already does, that same zoom; further out it takes a step in; on one spot, never', T.aloneZoom(near, PARIS, 16, 17) === 16 && T.aloneZoom(near, PARIS, 9, 17) > 9 && T.aloneZoom(near, PARIS, 9, 17) <= 17 && T.aloneZoom(twins[0], twins, 10, 17) === 17)
  const b = T.boundsOf(PARIS)
  ok('the box around the places is [[west, south], [east, north]], and none for no place', b[0][0] === 2.2653 && b[0][1] === 48.8509 && b[1][0] === 2.4078 && b[1][1] === 48.8657 && T.boundsOf([]) === null)
  const pair = T.clusterAction([PARIS[0], PARIS[1]])
  ok('a click on a cluster brings its members into view', pair.kind === 'fit' && pair.bounds[0][0] === 2.3573 && pair.bounds[1][1] === 48.8567)
  const same = T.clusterAction(twins)
  ok('a click on a cluster of places on one spot opens the first of them (no zoom would ever part them)', same.kind === 'pick' && same.row.id === 7)
}

// ── the gate, the verdicts ─────────────────────────────────────────────────────────────────────────────
{
  const base = { placed: 3, webgl: true, online: true, failure: null, now: 1000000 }
  ok('the gate: a map may start with places, WebGL, a network and no recent failure', T.mapGate(base).use === true && T.mapGate(base).why === '')
  ok('the gate: nothing to put on a map asks nothing of anyone', T.mapGate({ ...base, placed: 0 }).use === false && T.mapGate({ ...base, placed: 0 }).why === 'empty')
  ok('the gate: no WebGL, and a machine known to be offline, stop before any request', T.mapGate({ ...base, webgl: false }).why === 'webgl' && T.mapGate({ ...base, online: false }).why === 'offline')
  ok('the gate: a failure of the last minute is not tried again, an older one is', T.mapGate({ ...base, failure: { at: base.now - 5000, why: 'tiles' } }).why === 'tiles' && T.mapGate({ ...base, failure: { at: base.now - T.MAP_RETRY_MS - 1, why: 'tiles' } }).use === true)
  const v = (over) => T.startVerdict({ loaded: false, ok: 0, errors: 0, elapsed: 0, budget: 8000, ...over })
  ok('the verdict: wait while nothing is known and the budget is not spent', v({}).state === 'wait' && v({ errors: 3, elapsed: 7999 }).state === 'wait')
  ok('the verdict: the map is ready once it has loaded and has drawn a tile', v({ loaded: true, ok: 4 }).state === 'ready')
  ok('the verdict: loaded with every tile failed is as useless as never loaded: the drawn map takes over, saying « tiles »', v({ loaded: true, ok: 0, errors: 5 }).state === 'fallback' && v({ loaded: true, errors: 5 }).why === 'tiles')
  ok('the verdict: loaded with nothing asked (an empty sea) is ready', v({ loaded: true }).state === 'ready')
  ok('the verdict: past the budget, a map that has drawn something stays, one that has not gives up (« tiles » if it saw errors, « timeout » if it saw nothing)', v({ elapsed: 8000, ok: 2 }).state === 'ready' && v({ elapsed: 8000 }).why === 'timeout' && v({ elapsed: 8000, errors: 2 }).why === 'tiles')
}

// ── the colours of the style ───────────────────────────────────────────────────────────────────────────
{
  const near = (c, r, g, b, a) => c !== null && close(c[0], r, 0.6) && close(c[1], g, 0.6) && close(c[2], b, 0.6) && (a === undefined ? c.length === 3 : close(c[3], a, 1e-6))
  ok('colours the style holds are read: hex of 3, 4, 6 and 8 digits, rgb(), rgba(), hsl(), hsla(), with percent', near(T.parseColor('#fff'), 255, 255, 255) && near(T.parseColor('#f0a'), 255, 0, 170) && near(T.parseColor('#336699'), 51, 102, 153) && near(T.parseColor('#33669980'), 51, 102, 153, 128 / 255) && near(T.parseColor('rgb(242,243,240)'), 242, 243, 240) && near(T.parseColor('rgba(255,255,255,0.7)'), 255, 255, 255, 0.7) && near(T.parseColor('hsl(0,0%,88%)'), 224.4, 224.4, 224.4) && near(T.parseColor('hsla(0,0%,85%,0.53)'), 216.75, 216.75, 216.75, 0.53) && near(T.parseColor('hsl(195,17%,78%)'), 189.4, 203.7, 208.4) && near(T.parseColor('rgb(100%, 0%, 0%)'), 255, 0, 0))
  ok('anything else is not a colour', ['water', 'wood', '#12', '#12345', 'rgb(1,2)', 'rgb(a,b,c)', '', 'hsl(1,2,3,4,5)', 'color(srgb 1 1 1)'].every((t) => T.parseColor(t) === null))
  ok('a colour is written as six hex digits, or eight when it is not opaque', T.colorHex([255, 0, 16]) === '#ff0010' && T.colorHex([1, 2, 3, 0.5]) === '#01020380' && T.colorHex([300, -4, 7.6]) === '#ff0008' && T.colorHex([1, 2, 3, 1]) === '#010203')
  const white = T.flipColor([255, 255, 255])
  const grey = T.flipColor([242, 243, 240])
  const blue = T.flipColor([100, 140, 220])
  ok('a light colour turned for a dark page keeps its hue and has its lightness turned over', white[0] < 5 && grey[0] < 30 && grey[0] > 5 && blue[2] > blue[0] && blue[0] < 100 && T.flipColor([1, 2, 3, 0.4])[3] === 0.4)
  const tok = (dark) => (dark
    ? { l1: [35, 35, 36], l2: [44, 44, 46], l3: [53, 54, 56], t1: [249, 250, 251], t2: [207, 211, 214], t3: [173, 178, 184], blue: [122, 170, 255], ok: [34, 197, 94] }
    : { l1: [255, 255, 255], l2: [255, 255, 255], l3: [255, 255, 255], t1: [15, 17, 21], t2: [97, 102, 107], t3: [129, 133, 140], blue: [65, 118, 230], ok: [34, 197, 94] })
  const light = T.paletteFrom(tok(false))
  const dark = T.paletteFrom(tok(true))
  ok('the palette says which page it is for', light.dark === false && dark.dark === true)
  const L = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
  ok('light page: the land is a step off white, main roads are the page white, side roads a step darker than the land (so they show), the words are the page\'s grey', L(light.land) < 1 && L(light.land) > 0.9 && L(light.roadMajor) > L(light.land) && L(light.roadMinor) < L(light.land) && L(light.roadEdge) < L(light.land) && JSON.stringify(light.label) === JSON.stringify(tok(false).t2))
  ok('dark page: the land is a step lighter than the surface, main roads lighter still, side roads a step lighter than the land, the words are the page\'s light grey', L(dark.land) > L(tok(true).l1) && L(dark.roadMajor) > L(dark.land) && L(dark.roadMinor) > L(dark.land) && L(dark.roadEdge) < L(dark.land) && JSON.stringify(dark.label) === JSON.stringify(tok(true).t2))
  ok('water is bluer than the land and parks greener, on both pages; the halo of a name is the land it sits on', [light, dark].every((p) => p.water[2] - p.water[0] > p.land[2] - p.land[0] + 10 && p.park[1] - p.park[0] > p.land[1] - p.land[0] + 10 && p.halo === p.land))
}

// ── the style made quiet and ours ──────────────────────────────────────────────────────────────────────
{
  const tok = { l1: [255, 255, 255], l2: [255, 255, 255], l3: [255, 255, 255], t1: [15, 17, 21], t2: [97, 102, 107], t3: [129, 133, 140], blue: [65, 118, 230], ok: [34, 197, 94] }
  const before = JSON.stringify(STYLE)
  const out = T.tweakStyle(STYLE, T.paletteFrom(tok), { lang: 'en' })
  const layer = (style, id) => style.layers.find((l) => l.id === id)
  ok('the style it was given is not touched', JSON.stringify(STYLE) === before && out !== STYLE)
  ok('shields, the dashed district lines and the like are dropped, the rest stays in order', layer(out, 'highway-shield-non-us') === undefined && layer(out, 'boundary_3') === undefined && out.layers.map((l) => l.id).join() === 'background,park,water,building,highway_major_casing,highway_major_inner,highway_motorway_inner,highway_minor,strange_new_layer,highway-name-minor,label_town')
  ok('the sprite is gone, so it is never asked for, and the dot icons with it; a source no layer uses is dropped, the other kept', out.sprite === undefined && out.sources.ne2_shaded === undefined && out.sources.openmaptiles !== undefined && Object.keys(layer(out, 'label_town').layout).every((k) => k.indexOf('icon-') !== 0) && out.glyphs === STYLE.glyphs)
  const pal = T.paletteFrom(tok)
  ok('each known layer takes its colour from the palette, as six hex digits', layer(out, 'background').paint['background-color'] === T.colorHex(pal.land) && layer(out, 'water').paint['fill-color'] === T.colorHex(pal.water) && layer(out, 'park').paint['fill-color'] === T.colorHex(pal.park) && layer(out, 'building').paint['fill-outline-color'] === T.colorHex(pal.buildingEdge) && layer(out, 'highway_major_casing').paint['line-color'] === T.colorHex(pal.roadEdge) && layer(out, 'highway_major_inner').paint['line-color'] === T.colorHex(pal.roadMajor) && layer(out, 'highway_minor').paint['line-color'] === T.colorHex(pal.roadMinor))
  ok('a colour that was an expression (fading in with the zoom) becomes one flat colour; what is not a colour (widths, opacity) is left alone', layer(out, 'highway_motorway_inner').paint['line-color'] === T.colorHex(pal.roadMajor) && layer(out, 'highway_major_casing').paint['line-width'] === 3 && layer(out, 'strange_new_layer').paint['fill-opacity'] === 0.5)
  ok('names take the palette\'s words and a halo of the land; a layer no role knows keeps its colour on a light page', layer(out, 'highway-name-minor').paint['text-color'] === T.colorHex(pal.labelSoft) && layer(out, 'label_town').paint['text-halo-color'] === T.colorHex(pal.halo) && layer(out, 'strange_new_layer').paint['fill-color'] === 'rgb(250, 250, 250)')
  ok('fewer names: street and district names come in later', layer(out, 'highway-name-minor').minzoom === 16 && layer(out, 'label_town').minzoom === 11.5 && layer(out, 'building').minzoom === 12)
  const darkTok = { l1: [35, 35, 36], l2: [44, 44, 46], l3: [53, 54, 56], t1: [249, 250, 251], t2: [207, 211, 214], t3: [173, 178, 184], blue: [122, 170, 255], ok: [34, 197, 94] }
  const night = T.tweakStyle(STYLE, T.paletteFrom(darkTok), { lang: 'en' })
  const flipped = T.parseColor(layer(night, 'strange_new_layer').paint['fill-color'])
  ok('on a dark page a layer no role knows has its lightness turned over, so a new layer of the style is never a white patch', flipped !== null && flipped[0] < 40)
  ok('without a palette (the page could not say) the colours stay the style\'s own; the structure is still tidied', layer(T.tweakStyle(STYLE, null, {}), 'water').paint['fill-color'] === 'rgb(194, 200, 202)' && layer(T.tweakStyle(STYLE, null, {}), 'highway-shield-non-us') === undefined)
  const fr = T.tweakStyle(STYLE, null, { lang: 'fr' })
  ok('names follow the language: French asks for name:fr first, English keeps the style\'s own', JSON.stringify(layer(fr, 'label_town').layout['text-field']) === '["coalesce",["get","name:fr"],["get","name"]]' && JSON.stringify(layer(out, 'label_town').layout['text-field']) === '["coalesce",["get","name_en"],["get","name"]]')
}

// ── nothing is asked until the view is opened ──────────────────────────────────────────────────────────
ok('loading the plugin and applying it asks nobody for anything: no fetch, no script, no stylesheet', net.fetches.length === 0 && doc.head.kids.length === 0)

// ── the components ─────────────────────────────────────────────────────────────────────────────────────
const by = (root, kb, extra) => lite.find(root.tree, (n) => n.props['data-kb'] === kb && (extra === undefined || extra(n)))
let log = { maps: [], markers: [], throwOnCreate: false }
const calls = { picks: [], hovers: [], fails: [] }
const baseProps = (over) => Object.assign({ placed: PARIS, unplaced: 2, seed: 7, selected: null, hot: null, onHover: (id) => calls.hovers.push(id), onPick: (row) => calls.picks.push(row.id) }, over)
const mount = async (props) => {
  const root = lite.mount(h(P.MapSwitch, props))
  await root.settle()
  return root
}
const reset = () => {
  log = { maps: [], markers: [], throwOnCreate: false }
  windowObject.maplibregl = makeLib(log)
  net.fetches.length = 0
  net.style = 'ok'
  net.down.clear()
  store.clear()
  env.storageThrows = false
  env.webgl = true
  navigator.onLine = true
  T.resetMapState()
  calls.picks.length = 0; calls.hovers.length = 0
  held.length = 0
  skew = 0
  reduced = false
  narrow = false
  language = 'en'
  gl.kids = []
  gl.attrs.clear()
  doc.visibilityState = 'visible'
  docListeners.clear()
  doc.activeElement = null
}
const draw = async (root, map, tiles = 3) => {
  for (let i = 0; i < tiles; i += 1) map.fire('sourcedata', { dataType: 'source', tile: {} })
  map.fire('load')
  await root.settle()
}
globalThis.getComputedStyle = () => ({ getPropertyValue: (k) => (env.tokens === null ? '' : (env.tokens[k.replace('--kbtb-', '')] || '')) })

{
  reset()
  const root = await mount(baseProps())
  ok('opening the view starts the real map: the style is asked for, once, from OpenFreeMap, with no cookie and no referrer', net.fetches.length === 1 && net.fetches[0].url === 'https://tiles.openfreemap.org/styles/positron' && net.fetches[0].init.credentials === 'omit' && net.fetches[0].init.referrerPolicy === 'no-referrer')
  const map = log.maps[0]
  ok('the map is made in the box that was drawn, with our own controls and attribution, no rotation, and requests with no cookie and no referrer', map !== undefined && map.options.container === gl && map.options.attributionControl === false && map.options.dragRotate === false && map.options.maxPitch === 0 && map.options.transformRequest('https://x/y').credentials === 'omit' && map.options.transformRequest('https://x/y').referrerPolicy === 'no-referrer' && JSON.stringify(map.options.bounds) === JSON.stringify(T.boundsOf(PARIS)) && map.calls.some((c) => c[0] === 'noRotate'))
  ok('the style it was given is the quiet one: no sprite, no shields', map.options.style.sprite === undefined && map.options.style.layers.every((l) => l.id !== 'highway-shield-non-us'))
  ok('while it loads the box says so and is not blank: a status, the controls and the caption are there', by(root, 'tables-map-box')[0].props['data-map'] === 'loading' && by(root, 'tables-map-loading').length === 1 && by(root, 'tables-map-zoom-in').length === 1 && by(root, 'tables-map-note').length === 1)
  ok('and the attribution is there from the start: OpenFreeMap, OpenMapTiles and OpenStreetMap contributors, each a link that opens apart', lite.textOf(by(root, 'tables-map-attribution')[0]).includes('OpenFreeMap') && lite.textOf(by(root, 'tables-map-attribution')[0]).includes('OpenMapTiles') && lite.textOf(by(root, 'tables-map-attribution')[0]).includes('OpenStreetMap contributors') && lite.find(root.tree, (n) => n.tag === 'a').length === 3 && lite.find(root.tree, (n) => n.tag === 'a').every((n) => n.props.rel === 'noopener noreferrer' && n.props.target === '_blank' && /^https:\/\//.test(n.props.href)))
  ok('no pin is made before the map has loaded', log.markers.length === 0)
  await draw(root, map)
  ok('once loaded and drawn the loading veil goes and the map is the real one', by(root, 'tables-map-box')[0].props['data-map'] === 'real' && by(root, 'tables-map-loading').length === 0)
  const first = T.clusterPins(PARIS, 11)
  ok('one marker per pin or cluster at the zoom of the map, each a button the keyboard reaches, named for a screen reader, in the order of the list', log.markers.length === first.length && log.markers.every((m) => m.element.tag === 'button' && m.element.getAttribute('aria-label') !== null && m.options.anchor === 'bottom') && gl.kids.length === 0 && map.getCanvasContainer().kids.length === first.length)
  const singles = log.markers.filter((m) => m.element.getAttribute('data-kb') === 'tables-pin')
  const clusters = log.markers.filter((m) => m.element.getAttribute('data-kb') === 'tables-cluster')
  ok('a single pin says its price short, its name and its price in full, and is not pressed; a cluster says how many', singles.length > 0 && singles.every((m) => /^€\d+k$/.test(m.element.kids[0].kids[0].textContent) && /^Item \d+, €/.test(m.element.getAttribute('aria-label')) && m.element.getAttribute('aria-pressed') === 'false' && m.element.getAttribute('data-id') !== null) && (clusters.length === 0 || clusters.every((m) => /^\d+$/.test(m.element.kids[0].kids[0].textContent) && /rows here/.test(m.element.getAttribute('aria-label')) && m.element.getAttribute('data-id') === null && m.element.classList.contains('cluster'))))
  const pin = singles[0]
  const id = Number(pin.element.getAttribute('data-id'))
  pin.element.fire('mouseenter')
  pin.element.fire('mouseleave')
  pin.element.fire('focus')
  pin.element.fire('blur')
  ok('the pointer or the keyboard on a pin lights its card (the page is told which item), and going away tells it nothing', JSON.stringify(calls.hovers) === JSON.stringify([id, null, id, null]), JSON.stringify(calls.hovers))
  pin.element.fire('click', { clientX: 0, clientY: 0 })
  ok('a click (or Enter, which is a click on a button) opens the item', calls.picks.join() === String(id))
  calls.picks.length = 0
  pin.element.fire('pointerdown', { clientX: 10, clientY: 10 })
  pin.element.fire('click', { clientX: 40, clientY: 10 })
  ok('the click that ends a drag of the map opens nothing', calls.picks.length === 0)
  pin.element.fire('pointerdown', { clientX: 10, clientY: 10 })
  pin.element.fire('click', { clientX: 12, clientY: 11 })
  ok('a click that moved a pixel or two is still a click', calls.picks.join() === String(id))
  root.update(h(P.MapSwitch, baseProps({ hot: id })))
  await root.settle()
  ok('the card that is hovered lights its pin', pin.element.classList.contains('hot') && !pin.element.classList.contains('sel') && log.markers.filter((m) => m.element.classList.contains('hot')).length === 1)
  root.update(h(P.MapSwitch, baseProps({ hot: null, selected: id })))
  await root.settle()
  ok('the chosen item is the filled pin, and is pressed for a screen reader; the light of the hover is gone', pin.element.classList.contains('sel') && pin.element.getAttribute('aria-pressed') === 'true' && !pin.element.classList.contains('hot') && log.markers.filter((m) => m.element.classList.contains('sel')).length === 1)
  const fly = map.calls.filter((c) => c[0] === 'flyTo')
  const chosen = PARIS.find((p) => p.row.id === id)
  ok('choosing an item flies the map to it, smoothly, at least as far in as the zoom where it stands alone', fly.length === 1 && fly[0][1].center[0] === chosen.lng && fly[0][1].center[1] === chosen.lat && fly[0][1].zoom >= T.aloneZoom(chosen, PARIS, 11, 17) && fly[0][1].duration > 0 && fly[0][1].essential === false)
  root.unmount()
  ok('taking the view away removes the map, every marker, the timers and the watcher', map.removed === true && log.markers.every((m) => m.removed) && live().length === 0)
}

{
  reset()
  const root = await mount(baseProps())
  const map = log.maps[0]
  await draw(root, map)
  const before = log.markers.length
  map.zoom = 16
  map.fire('zoomend')
  await root.settle()
  const active = log.markers.filter((m) => !m.removed)
  ok('when the zoom ends the pins are made again for it: far in, every place alone', active.length === 6 && active.every((m) => m.element.getAttribute('data-kb') === 'tables-pin') && before < 6 + 1)
  ok('the order of the buttons in the map follows the order of the cards (so Tab does)', map.getCanvasContainer().kids.map((e) => e.getAttribute('data-id')).join() === PARIS.map((p) => p.row.id).join())
  map.zoom = 8
  map.fire('zoomend')
  await root.settle()
  const wide = log.markers.filter((m) => !m.removed)
  ok('far out again, one cluster of all of them, and the single pins are taken out of the map', wide.length === 1 && wide[0].element.getAttribute('data-kb') === 'tables-cluster' && wide[0].element.kids[0].kids[0].textContent === '6' && map.getCanvasContainer().kids.length === 1)
  const cluster = wide[0]
  cluster.element.focus()
  cluster.element.fire('click', { clientX: 0, clientY: 0 })
  const fit = map.calls.filter((c) => c[0] === 'fitBounds').pop()
  ok('a click on a cluster brings its members into view, not further in than is useful', fit !== undefined && JSON.stringify(fit[1]) === JSON.stringify(T.boundsOf(PARIS)) && fit[2].maxZoom < 18 && fit[2].duration > 0)
  map.zoom = 12.5
  map.fire('zoomend')
  await root.settle()
  const next = log.markers.filter((m) => !m.removed)
  const wanted = T.clusterPins(PARIS, 12.5).find((c) => c.items.some((q) => q.row.id === 1))
  const here = doc.activeElement
  ok('the keyboard follows the cluster it was on: the focus goes to the pin or cluster that now holds its first member', here !== null && here.parent === map.getCanvasContainer() && next.some((m) => m.element === here) && (wanted.count === 1 ? here.getAttribute('data-id') === '1' : here.kids[0].kids[0].textContent === String(wanted.count) && here.getAttribute('data-kb') === 'tables-cluster'))
  const stay = log.markers.filter((m) => !m.removed)
  root.update(h(P.MapSwitch, baseProps({ placed: PARIS.slice(0, 3) })))
  await root.settle()
  const total = (list) => list.reduce((n, m) => n + (m.element.getAttribute('data-kb') === 'tables-cluster' ? Number(m.element.kids[0].kids[0].textContent) : 1), 0)
  ok('when the items change (a filter) the pins follow: what is on the map is the three that are left, and the markers of the others are removed from the page', total(log.markers.filter((m) => !m.removed)) === 3 && map.getCanvasContainer().kids.every((e) => log.markers.some((m) => m.element === e && !m.removed)) && stay.length > 0)
  ok('and the map looks at the new set when some of it is out of view: here the places of the new set are inside the view, so it does not move', map.calls.filter((c) => c[0] === 'fitBounds').length === 1)
  map.box = [[2.3, 48.84], [2.31, 48.85]]
  root.update(h(P.MapSwitch, baseProps({ placed: PARIS.slice(0, 4) })))
  await root.settle()
  const refit = map.calls.filter((c) => c[0] === 'fitBounds').pop()
  ok('…but when a place of the new set is out of view, the map fits the set (the same fit as at the start)', map.calls.filter((c) => c[0] === 'fitBounds').length === 2 && JSON.stringify(refit[1]) === JSON.stringify(T.boundsOf(PARIS.slice(0, 4))) && refit[2].maxZoom === 15.5)
  ok('the buttons: zoom in, zoom out and « show everything » drive the map', await (async () => {
    await by(root, 'tables-map-zoom-in')[0].props.onClick()
    await by(root, 'tables-map-zoom-out')[0].props.onClick()
    await by(root, 'tables-map-fit')[0].props.onClick()
    const names = map.calls.map((c) => c[0])
    return names.includes('zoomIn') && names.includes('zoomOut') && names.filter((n) => n === 'fitBounds').length === 3
  })())
  root.unmount()
}

{
  reset()
  reduced = true
  narrow = true
  const root = await mount(baseProps({ selected: 3 }))
  const map = log.maps[0]
  ok('on a narrow screen the map asks for two fingers (and says so in the person\'s language)', map.options.cooperativeGestures === true && /Ctrl/.test(map.options.locale['CooperativeGesturesHandler.WindowsHelpText']))
  ok('a person who asks for less motion gets none: no fade, and a jump where the map would fly', map.options.fadeDuration === 0)
  await draw(root, map)
  ok('…the item chosen before the map came up is flown to as soon as it is there, as a jump', map.calls.some((c) => c[0] === 'jumpTo' && c[1].center[1] === 48.8509) && !map.calls.some((c) => c[0] === 'flyTo'))
  await by(root, 'tables-map-zoom-in')[0].props.onClick()
  ok('and the buttons move it with no animation', map.calls.find((c) => c[0] === 'zoomIn')[1].duration === 0)
  root.unmount()
  language = 'fr'
  reduced = false
  narrow = true
  const fr = await mount(baseProps())
  ok('in French the touch message is French', /Deux doigts/.test(log.maps[log.maps.length - 1].options.locale['CooperativeGesturesHandler.MobileHelpText']) && /Chargement/.test(lite.textOf(by(fr, 'tables-map-loading')[0])))
  fr.unmount()
}

// ── a tab in the background draws nothing ──────────────────────────────────────────────────────────────
{
  reset()
  doc.visibilityState = 'hidden'
  const root = await mount(baseProps())
  const map = log.maps[0]
  ok('the map is made in a tab nobody is looking at, and listens for the tab coming back', map !== undefined && (docListeners.get('visibilitychange') || new Set()).size === 1)
  skew = T.MAP_BUDGET_MS + 10
  live().find((t) => t.ms === T.MAP_BUDGET_MS && !t.interval).fn()
  await root.settle()
  ok('a background tab gets no animation frames, so the map cannot draw: the clock does not run it out, the drawn map does NOT take over', by(root, 'tables-map-box')[0].props['data-map'] === 'loading' && map.removed === false)
  doc.visibilityState = 'visible'
  for (const fn of [...docListeners.get('visibilitychange')]) fn({})
  const again = live().filter((t) => t.ms === T.MAP_BUDGET_MS && !t.interval)
  ok('…when the person is back the budget starts again, from now', again.length >= 1)
  await draw(root, map)
  ok('…and the map draws', by(root, 'tables-map-box')[0].props['data-map'] === 'real')
  root.unmount()
  ok('the listener goes with the map', (docListeners.get('visibilitychange') || new Set()).size === 0)
  reset()
  doc.visibilityState = 'hidden'
  const slow = await mount(baseProps())
  skew = T.MAP_BUDGET_MS + 10
  live().find((t) => t.ms === T.MAP_BUDGET_MS && !t.interval).fn()
  doc.visibilityState = 'visible'
  for (const fn of [...docListeners.get('visibilitychange')]) fn({})
  skew += T.MAP_BUDGET_MS + 10
  live().filter((t) => t.ms === T.MAP_BUDGET_MS && !t.interval).pop().fn()
  await slow.settle()
  ok('back in front, a map that still draws nothing within its budget gives way to the drawn one', by(slow, 'tables-map-box')[0].props['data-map'] === 'drawn')
  slow.unmount()
}

// ── the colours follow the page ────────────────────────────────────────────────────────────────────────
{
  reset()
  env.tokens = { l1: '#ffffff', l2: '#ffffff', l3: '#ffffff', t1: '#0f1115', t2: '#61666b', t3: '#81858c', blue: '#4176e6', ok: '#22c55e' }
  const root = await mount(baseProps())
  const map = log.maps[0]
  const light = map.options.style.layers.find((l) => l.id === 'background').paint['background-color']
  ok('the page\'s tokens are read where the map sits, and the map is made in its colours', /^#[0-9a-f]{6}$/.test(light) && gl.getAttribute('data-scheme') === 'light' && light !== '#f2f3f0')
  await draw(root, map)
  const ticker = live().find((t) => t.interval === true)
  ok('a watcher looks at the tokens now and then', ticker !== undefined && ticker.ms >= 1000)
  ticker.fn()
  ok('nothing changed, nothing is redone', !map.calls.some((c) => c[0] === 'setStyle'))
  env.tokens = { l1: '#232324', l2: '#2c2c2e', l3: '#353638', t1: '#f9fafb', t2: '#cfd3d6', t3: '#adb2b8', blue: '#7aaaff', ok: '#22c55e' }
  ticker.fn()
  const set = map.calls.find((c) => c[0] === 'setStyle')
  ok('the page goes dark while the map is open: the map gets the dark colours at once, as a difference (the tiles stay)', set !== undefined && set[2].diff === true && gl.getAttribute('data-scheme') === 'dark' && set[1].layers.find((l) => l.id === 'background').paint['background-color'] !== light)
  language = 'fr'
  ticker.fn()
  ok('and the language changing gives the names the language again', map.calls.filter((c) => c[0] === 'setStyle').length === 2)
  root.unmount()
  env.tokens = null
}


// ── the themes of the map ─────────────────────────────────────────────────────────────────────────────
{
  const hosts = new Set(T.MAP_STYLES.map((m) => new URL(T.mapStyleUrl(m.id)).host))
  ok('the menu offers Auto, Light, Dark, Streets and Bright, in that order, each with a word in both languages', T.MAP_STYLES.map((m) => m.id).join() === 'auto,light,dark,streets,bright' && T.MAP_STYLES.every((m) => m.label.length === 2 && m.label.every((w) => typeof w === 'string' && w.length > 0)) && T.MAP_STYLES[0].label[1] === 'Auto' && T.MAP_STYLES[3].label[1] === 'Streets')
  ok('every theme starts from a style OpenFreeMap serves (positron, liberty or bright) on the one host the manifest names, so the permission and the privacy sentence hold for all five', hosts.size === 1 && hosts.has('tiles.openfreemap.org') && T.MAP_STYLES.every((m) => ['positron', 'liberty', 'bright'].includes(m.style)) && T.mapStyleUrl('streets') === 'https://tiles.openfreemap.org/styles/liberty' && T.mapStyleUrl('bright') === 'https://tiles.openfreemap.org/styles/bright' && ['auto', 'light', 'dark'].every((id) => T.mapStyleUrl(id) === T.MAP_STYLE_URL))
  // the page itself asks one other host (the map's); the others are the hosts Publish talks to from the DSH process (remote/space.mjs): a team space, on the web or on this machine
  ok('the manifest declares the map host first, and then only the hosts of a team space', JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8')).permissions.filter((x) => /^net:/.test(x)).join() === 'net:tiles.openfreemap.org,net:*.kaby.app,net:localhost')
  ok('an id that is not one of ours is Auto: nothing, a number, another word, a name of the prototype, another case', ['nope', '', null, undefined, 3, 'toString', '__proto__', 'LIGHT'].every((v) => T.mapStyleOf(v).id === 'auto') && T.mapStyleOf('dark').id === 'dark')
  ok('the choice is kept under kybernos.db.mapstyle.v1', T.MAP_STYLE_KEY === 'kybernos.db.mapstyle.v1')
  reset()
  ok('nothing stored: Auto', T.readMapStyle() === 'auto')
  T.saveMapStyle('bright')
  ok('a theme saved is the theme read back', store.get(T.MAP_STYLE_KEY) === 'bright' && T.readMapStyle() === 'bright')
  ok('…each of the five survives the round trip', T.MAP_STYLES.every((m) => { T.saveMapStyle(m.id); return T.readMapStyle() === m.id }))
  store.set(T.MAP_STYLE_KEY, 'sepia')
  ok('a stored value that is not a theme (an old build, a hand edit) falls back to Auto', T.readMapStyle() === 'auto')
  T.saveMapStyle('sepia')
  ok('and one that is not a theme is never written as such', store.get(T.MAP_STYLE_KEY) === 'auto')
  env.storageThrows = true
  let threw = false
  try { T.saveMapStyle('dark') } catch (e) { threw = true }
  ok('a storage that throws (private window, blocked site data): reading says Auto, saving does not throw', T.readMapStyle() === 'auto' && threw === false)
  env.storageThrows = false

  // the colours of a theme
  const lightTok = { l1: [255, 255, 255], l2: [255, 255, 255], l3: [255, 255, 255], t1: [15, 17, 21], t2: [97, 102, 107], t3: [129, 133, 140], blue: [65, 118, 230], ok: [34, 197, 94] }
  const darkTok = { l1: [35, 35, 36], l2: [44, 44, 46], l3: [53, 54, 56], t1: [249, 250, 251], t2: [207, 211, 214], t3: [173, 178, 184], blue: [122, 170, 255], ok: [34, 197, 94] }
  const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
  const flipped = T.flipTokens(darkTok)
  ok('the other mode\'s tokens: surface and ink swapped, the softer inks as far along the way as they were, the accents kept', flipped.l1.join() === darkTok.t1.join() && flipped.t1.join() === darkTok.l1.join() && lum(flipped.t2) < 0.45 && lum(flipped.t2) > lum(flipped.t1) && ratio(flipped.t2, flipped.l1) > 4.5 && flipped.blue === darkTok.blue && darkTok.l1.join() === '35,35,36')
  for (const [name, tok, pageDark] of [['light', lightTok, false], ['dark', darkTok, true]]) {
    ok('on a ' + name + ' page: Auto is the page\'s own map, Light is a light one and Dark is a dark one, whatever the page', T.mapPalette(tok, 'auto').dark === pageDark && T.mapPalette(tok, 'light').dark === false && T.mapPalette(tok, 'dark').dark === true)
    ok('…the map of the other mode is as legible as the page\'s own: names on the land at 4.5:1, the land far from the opposite extreme', ['light', 'dark'].every((id) => { const p = T.mapPalette(tok, id); return ratio(p.label, p.land) >= 4.5 && (id === 'light' ? lum(p.land) > 0.8 : lum(p.land) < 0.1) }))
  }
  ok('the recipe is unchanged for the theme that is the page\'s own mode (the same colours as before there were themes)', JSON.stringify(T.mapPalette(lightTok, 'auto')) === JSON.stringify(T.paletteFrom(lightTok)) && JSON.stringify(T.mapPalette(darkTok, 'dark')) === JSON.stringify(T.paletteFrom(darkTok)) && JSON.stringify(T.mapPalette(lightTok, 'light')) === JSON.stringify(T.paletteFrom(lightTok)))
  ok('Streets and Bright keep their own colours: no palette', T.mapPalette(lightTok, 'streets') === null && T.mapPalette(darkTok, 'bright') === null)
  ok('the tokens it was given are not touched', darkTok.l1.join() === '35,35,36' && lightTok.t1.join() === '15,17,21')

  // what the detailed styles lose, and how their colours are calmed
  const DETAIL = {
    version: 8,
    sprite: 'https://tiles.openfreemap.org/sprites/x/ofm',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }, natural_earth: { type: 'raster', tiles: ['https://tiles.openfreemap.org/natural_earth/{z}/{x}/{y}.png'] } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': 'rgb(248,244,240)' } },
      { id: 'natural_earth', type: 'raster', source: 'natural_earth', paint: { 'raster-opacity': 0.5 } },
      { id: 'landcover_wetland', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', paint: { 'fill-pattern': 'wetland_bg_11' } },
      { id: 'road_area_pattern', type: 'fill', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'fill-pattern': 'pedestrian_polygon' } },
      { id: 'road_minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': 'rgb(255,200,60)', 'line-width': 2 } },
      { id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', paint: { 'fill-extrusion-color': 'rgb(200,200,200)' } },
      { id: 'tunnel-minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': 'rgb(200,200,200)' } },
      { id: 'poi_r20', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', layout: { 'icon-image': 'shop', 'text-field': ['get', 'name'] } },
      { id: 'road_one_way_arrow', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation', layout: { 'icon-image': 'arrow' } },
      { id: 'label_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'icon-image': 'dot', 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']] }, paint: { 'text-color': 'rgb(40,40,40)', 'text-halo-color': 'rgb(255,255,255)' } },
    ],
  }
  const detail = T.tweakStyle(DETAIL, null, { lang: 'en', calm: 0.4 })
  ok('the detailed styles lose their places of interest, one-way arrows, 3D buildings, tunnels and every layer that paints with a picture of the sprite (no sprite, so no image to miss on the console)', detail.layers.map((l) => l.id).join() === 'background,natural_earth,road_minor,label_city' && detail.sprite === undefined && JSON.stringify(detail).indexOf('pattern') < 0 && Object.keys(detail.layers[3].layout).join() === 'text-field')
  const sat = (c) => { const mx = Math.max(c[0], c[1], c[2]); const mn = Math.min(c[0], c[1], c[2]); return mx === 0 ? 0 : (mx - mn) / mx }
  const roadBefore = T.parseColor('rgb(255,200,60)')
  const roadAfter = T.parseColor(detail.layers.find((l) => l.id === 'road_minor').paint['line-color'])
  ok('their colours are calmed (a share of the saturation goes, the hue stays) and nothing else is: widths, text colours and halos are as the style had them', roadAfter !== null && sat(roadAfter) < sat(roadBefore) * 0.8 && sat(roadAfter) > 0 && roadAfter[0] > roadAfter[2] && detail.layers.find((l) => l.id === 'road_minor').paint['line-width'] === 2 && detail.layers.find((l) => l.id === 'label_city').paint['text-color'] === 'rgb(40,40,40)' && detail.layers.find((l) => l.id === 'label_city').paint['text-halo-color'] === 'rgb(255,255,255)')
  ok('with no « calm » the style keeps its colours as they were', T.tweakStyle(DETAIL, null, { lang: 'en' }).layers.find((l) => l.id === 'road_minor').paint['line-color'] === 'rgb(255,200,60)')
  ok('only Streets and Bright are calmed, and they are the two that keep the style\'s own colours', T.MAP_STYLES.filter((m) => m.calm > 0).map((m) => m.id).join() === 'streets,bright' && T.MAP_STYLES.filter((m) => m.scheme === null).map((m) => m.id).join() === 'streets,bright')
}

// ── when the real map cannot be had ────────────────────────────────────────────────────────────────────
const drawn = (root) => by(root, 'tables-map-box')[0].props['data-map'] === 'drawn' && by(root, 'tables-map')[0].props['data-map'] === 'drawn' && by(root, 'tables-pin').length === PARIS.length

// ── a theme picked, remembered, or that cannot be had ───────────────────────────────────────────────────
{
  const lightTokens = { l1: '#ffffff', l2: '#ffffff', l3: '#ffffff', t1: '#0f1115', t2: '#61666b', t3: '#81858c', blue: '#4176e6', ok: '#22c55e' }
  const darkTokens = { l1: '#232324', l2: '#2c2c2e', l3: '#353638', t1: '#f9fafb', t2: '#cfd3d6', t3: '#adb2b8', blue: '#7aaaff', ok: '#22c55e' }
  const bg = (style) => style.layers.find((l) => l.id === 'background').paint['background-color']
  const lumOf = (hex) => { const c = T.parseColor(hex); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 }
  const themeBtn = (root) => by(root, 'tables-map-theme')[0]
  const items = (root) => lite.find(root.tree, (n) => n.props.role === 'menuitemradio')
  const tick = (root) => items(root).map((n) => n.props['data-kb'].replace('tables-map-theme-', '') + ':' + n.props['aria-checked']).join()
  const openMenu = async (root) => { themeBtn(root).props.onClick(); await root.settle() }
  const pickItem = async (root, id) => { await openMenu(root); by(root, 'tables-map-theme-' + id)[0].props.onClick(); await root.settle() }
  const sets = (map) => map.calls.filter((c) => c[0] === 'setStyle')

  reset()
  env.tokens = lightTokens
  let root = await mount(baseProps())
  ok('the map opens in Auto (nothing stored): the quiet style, the page\'s own colours, and the box says which theme it wears', net.fetches.length === 1 && net.fetches[0].url === T.MAP_STYLE_URL && gl.getAttribute('data-style') === 'auto' && lumOf(bg(log.maps[0].options.style)) > 0.8)
  let map = log.maps[0]
  ok('the theme button is there from the start but not offered while the map loads (a theme cannot be worn before there is a map)', themeBtn(root) !== undefined && themeBtn(root).props.disabled === true)
  await draw(root, map)
  ok('once the map is up the button is under the three others, named, and opens a menu (aria-haspopup)', by(root, 'tables-map-theme').length === 1 && themeBtn(root).props['aria-haspopup'] === 'menu' && themeBtn(root).props['aria-expanded'] === 'false' && /theme|thème/i.test(themeBtn(root).props['aria-label']) && !themeBtn(root).props.disabled && lite.find(lite.find(root.tree, (n) => n.props.className === 'kbtb-geoctl')[0], (n) => n.tag === 'button').map((n) => n.props['data-kb']).join() === 'tables-map-zoom-in,tables-map-zoom-out,tables-map-fit,tables-map-theme')
  await openMenu(root)
  ok('opened, the menu is five radio items, Auto ticked and alone in the tab order, with the words of an English page', by(root, 'tables-map-themes')[0].props.role === 'menu' && tick(root) === 'auto:true,light:false,dark:false,streets:false,bright:false' && items(root).map((n) => lite.textOf(n)).join() === 'Auto,Light,Dark,Streets,Bright' && items(root).filter((n) => n.props.tabIndex === 0).length === 1 && items(root)[0].props.tabIndex === 0 && themeBtn(root).props['aria-expanded'] === 'true')
  root.unmount()

  // in French
  reset()
  env.tokens = lightTokens
  language = 'fr'
  root = await mount(baseProps())
  await draw(root, log.maps[0])
  await openMenu(root)
  ok('on a French page the words are French (Auto, Clair, Sombre, Rues, Vif) and the button is named in French', items(root).map((n) => lite.textOf(n)).join() === 'Auto,Clair,Sombre,Rues,Vif' && /thème/i.test(themeBtn(root).props['aria-label']))
  root.unmount()
  language = 'en'

  // Streets, then Dark, Light, a page that goes dark, Auto
  reset()
  env.tokens = lightTokens
  root = await mount(baseProps())
  map = log.maps[0]
  await draw(root, map)
  const markersBefore = log.markers.length
  const callsBefore = map.calls.length
  await pickItem(root, 'streets')
  const liberty = net.fetches.filter((f) => f.url.endsWith('/liberty'))
  ok('Streets: its style (liberty) is asked for, once, with no cookie and no referrer, and the map is restyled as a difference, at once', liberty.length === 1 && liberty[0].init.credentials === 'omit' && liberty[0].init.referrerPolicy === 'no-referrer' && sets(map).length === 1 && sets(map)[0][2].diff === true && gl.getAttribute('data-style') === 'streets')
  const streets = sets(map)[0][1]
  ok('…it keeps its own warm colours (the page\'s are not poured over it) and loses what the quiet map loses: no place of interest, no sprite', lumOf(bg(streets)) > 0.9 && bg(streets) !== bg(log.maps[0].options.style) && T.parseColor(bg(streets))[0] > T.parseColor(bg(streets))[2] && streets.layers.every((l) => l.id !== 'poi_r20') && streets.sprite === undefined)
  ok('the pins, the clusters, the selection and the camera are not touched: no marker made or removed, no fit, no flight', log.markers.length === markersBefore && log.markers.every((m) => !m.removed) && map.calls.slice(callsBefore).every((c) => c[0] === 'setStyle'))
  ok('the choice is remembered once the map wears it, the menu has closed, and Streets is the ticked one next time', store.get(T.MAP_STYLE_KEY) === 'streets' && by(root, 'tables-map-themes').length === 0 && themeBtn(root).props['aria-expanded'] === 'false')
  await openMenu(root)
  ok('…(opened again: Streets ticked, the others not)', tick(root) === 'auto:false,light:false,dark:false,streets:true,bright:false')
  themeBtn(root).props.onClick()
  await root.settle()
  await pickItem(root, 'dark')
  ok('Dark on a light page: the quiet style again (already had, not asked for twice) in the dark recipe, and the pills still follow the page', sets(map).length === 2 && net.fetches.filter((f) => f.url === T.MAP_STYLE_URL).length === 1 && lumOf(bg(sets(map)[1][1])) < 0.2 && gl.getAttribute('data-style') === 'dark' && gl.getAttribute('data-scheme') === 'light' && store.get(T.MAP_STYLE_KEY) === 'dark')
  await pickItem(root, 'light')
  ok('Light: the light recipe', sets(map).length === 3 && lumOf(bg(sets(map)[2][1])) > 0.8 && store.get(T.MAP_STYLE_KEY) === 'light')
  env.tokens = darkTokens
  live().find((t) => t.interval === true).fn()
  ok('the page goes dark while Light is worn: Light stays light, and the pills follow the page (data-scheme says dark)', sets(map).length === 4 && lumOf(bg(sets(map)[3][1])) > 0.8 && gl.getAttribute('data-scheme') === 'dark' && gl.getAttribute('data-style') === 'light')
  await pickItem(root, 'auto')
  ok('Auto on that dark page is the dark recipe, the page\'s own', sets(map).length === 5 && lumOf(bg(sets(map)[4][1])) < 0.2 && gl.getAttribute('data-style') === 'auto' && store.get(T.MAP_STYLE_KEY) === 'auto')
  root.unmount()

  // a remembered theme
  reset()
  env.tokens = lightTokens
  store.set(T.MAP_STYLE_KEY, 'bright')
  root = await mount(baseProps())
  ok('a remembered theme is the one the map opens with: its style is the one asked for, and the quiet one is not', net.fetches.length === 1 && net.fetches[0].url.endsWith('/bright') && gl.getAttribute('data-style') === 'bright' && log.maps[0].options.style.layers.every((l) => !/^poi_/.test(l.id)))
  root.unmount()
  reset()
  env.tokens = lightTokens
  store.set(T.MAP_STYLE_KEY, 'neon')
  root = await mount(baseProps())
  ok('a remembered value that is not a theme opens Auto', net.fetches.length === 1 && net.fetches[0].url === T.MAP_STYLE_URL && gl.getAttribute('data-style') === 'auto')
  root.unmount()
  reset()
  env.tokens = lightTokens
  env.storageThrows = true
  root = await mount(baseProps())
  map = log.maps[0]
  await draw(root, map)
  await pickItem(root, 'streets')
  ok('with a storage that throws the map opens in Auto, a theme can still be picked, and nothing escapes', gl.getAttribute('data-style') === 'streets' && sets(map).length === 1 && by(root, 'tables-map-box')[0].props['data-map'] === 'real')
  root.unmount()

  // a theme that cannot be had
  reset()
  env.tokens = lightTokens
  store.set(T.MAP_STYLE_KEY, 'streets')
  net.down.add('liberty')
  root = await mount(baseProps())
  ok('a remembered theme whose style is gone (Streets, 503): the quiet map comes instead, never the drawing', net.fetches.map((f) => f.url.split('/').pop()).join() === 'liberty,positron' && gl.getAttribute('data-style') === 'auto' && by(root, 'tables-map-box')[0].props['data-map'] !== 'drawn')
  root.unmount()
  reset()
  env.tokens = lightTokens
  root = await mount(baseProps())
  map = log.maps[0]
  await draw(root, map)
  net.down.add('bright')
  await pickItem(root, 'bright')
  ok('a theme picked that cannot be had: the map keeps what it has, nothing is stored, and the menu opens again with an alert, Auto still ticked', sets(map).length === 0 && gl.getAttribute('data-style') === 'auto' && store.get(T.MAP_STYLE_KEY) === undefined && by(root, 'tables-map-theme-failed').length === 1 && by(root, 'tables-map-theme-failed')[0].props.role === 'alert' && tick(root) === 'auto:true,light:false,dark:false,streets:false,bright:false' && by(root, 'tables-map-box')[0].props['data-map'] === 'real')
  net.down.clear()
  by(root, 'tables-map-theme-bright')[0].props.onClick()
  await root.settle()
  ok('asked again once the network is back, it works, and the alert is gone', sets(map).length === 1 && gl.getAttribute('data-style') === 'bright' && by(root, 'tables-map-theme-failed').length === 0 && store.get(T.MAP_STYLE_KEY) === 'bright')
  root.unmount()

  // the drawn map ignores all of it
  reset()
  env.tokens = lightTokens
  store.set(T.MAP_STYLE_KEY, 'streets')
  navigator.onLine = false
  root = await mount(baseProps())
  ok('the drawn map ignores the theme: no theme button, nothing asked of anyone', drawn(root) && by(root, 'tables-map-theme').length === 0 && net.fetches.length === 0)
  root.unmount()
  env.tokens = null
}
{
  reset()
  env.webgl = false
  const root = await mount(baseProps())
  ok('no WebGL: the drawn map at once, nothing fetched, the reason in the caption, and no button (trying again would change nothing)', drawn(root) && net.fetches.length === 0 && doc.head.kids.length === 0 && lite.textOf(by(root, 'tables-map-why')[0]).includes('WebGL') && by(root, 'tables-map-retry').length === 0 && /Schematic map/.test(lite.textOf(by(root, 'tables-map-note')[0])))
  root.unmount()
}
{
  reset()
  navigator.onLine = false
  const root = await mount(baseProps())
  ok('offline: the drawn map at once, nothing fetched, the reason, and a button to try again', drawn(root) && net.fetches.length === 0 && /Offline/.test(lite.textOf(by(root, 'tables-map-why')[0])) && by(root, 'tables-map-retry').length === 1)
  navigator.onLine = true
  emit('online')
  await root.settle()
  ok('back online: the real map is tried again by itself (the lite React keeps the hooks of the old component at the same place, so the start itself is not measured here: the browser check does)', by(root, 'tables-map-box')[0].props['data-map'] === 'loading' && by(root, 'tables-map-loading').length === 1 && by(root, 'tables-map-retry').length === 0)
  root.unmount()
}
{
  reset()
  const root = await mount(baseProps({ placed: [], unplaced: 5 }))
  ok('no item has a place: the drawn map, with nothing asked of anyone and no reason given', by(root, 'tables-map-box')[0].props['data-map'] === 'drawn' && net.fetches.length === 0 && by(root, 'tables-map-why').length === 0 && by(root, 'tables-map-retry').length === 0)
  root.update(h(P.MapSwitch, baseProps()))
  await root.settle()
  ok('…and the real one comes by itself once an item has a place', by(root, 'tables-map-box')[0].props['data-map'] === 'loading' && by(root, 'tables-map-loading').length === 1)
  root.unmount()
}
for (const [mode, why] of [['throw', 'style'], ['status', 'style'], ['shape', 'style']]) {
  reset()
  net.style = mode
  const root = await mount(baseProps())
  ok('the style cannot be had (' + mode + '): the drawn map, saying so, with a button', drawn(root) && by(root, 'tables-map-retry').length === 1 && /unavailable|indisponible/.test(lite.textOf(by(root, 'tables-map-why')[0])) && log.maps.length === 0)
  const again = await mount(baseProps())
  ok('…and a minute of calm: going away and coming back shows the drawn map at once, asking nothing', drawn(again) && net.fetches.length === 1)
  again.unmount()
  skew = T.MAP_RETRY_MS + 1000
  const later = await mount(baseProps())
  ok('…after the minute it tries again', net.fetches.length === 2)
  later.unmount()
  root.unmount()
}
{
  reset()
  net.style = 'throw'
  const root = await mount(baseProps())
  net.style = 'ok'
  skew = 0
  await by(root, 'tables-map-retry')[0].props.onClick()
  await root.settle()
  ok('the button asks again at once, whatever the last minute said: the real map is on screen again, loading, with no reason and no button', by(root, 'tables-map-box')[0].props['data-map'] === 'loading' && by(root, 'tables-map-why').length === 0 && by(root, 'tables-map-retry').length === 0)
  root.unmount()
  const fresh = await mount(baseProps())
  await draw(fresh, log.maps[log.maps.length - 1])
  ok('…and, as a new start, draws', by(fresh, 'tables-map-box')[0].props['data-map'] === 'real' && log.markers.length > 0)
  fresh.unmount()
}
{
  reset()
  log.throwOnCreate = true
  const root = await mount(baseProps())
  ok('the library cannot start a map (WebGL lost): the drawn map, saying WebGL, and no button (it would not help)', drawn(root) && /WebGL/.test(lite.textOf(by(root, 'tables-map-why')[0])) && by(root, 'tables-map-retry').length === 0)
  root.unmount()
}
{
  reset()
  const root = await mount(baseProps())
  const map = log.maps[0]
  map.fire('error', { error: new Error('tile 404') })
  map.fire('error', { error: new Error('tile 404') })
  map.fire('load')
  await root.settle()
  ok('every tile fails: the map loads but has drawn nothing, so the drawn map takes over (never a blank box), with the removed map', drawn(root) && map.removed === true && by(root, 'tables-map-retry').length === 1 && live().length === 0)
  root.unmount()
}
{
  reset()
  const root = await mount(baseProps())
  const map = log.maps[0]
  const budget = live().find((t) => t.ms === T.MAP_BUDGET_MS && !t.interval)
  ok('a clock runs from the start: the budget of the map', budget !== undefined)
  skew = T.MAP_BUDGET_MS + 10
  budget.fn()
  await root.settle()
  ok('too slow (nothing drawn within the budget): the drawn map takes over, the real one is taken away', drawn(root) && map.removed === true && live().length === 0)
  root.unmount()
}
{
  reset()
  const root = await mount(baseProps())
  const map = log.maps[0]
  map.fire('sourcedata', { dataType: 'source', tile: {} })
  skew = T.MAP_BUDGET_MS + 10
  live().find((t) => t.ms === T.MAP_BUDGET_MS && !t.interval).fn()
  await root.settle()
  ok('slow but drawing (a tile is there at the budget): the map stays', by(root, 'tables-map-box')[0].props['data-map'] === 'real' && map.removed === false)
  root.unmount()
}
{
  reset()
  delete windowObject.maplibregl
  const root = await mount(baseProps())
  const nodes = doc.head.kids
  ok('the library is fetched only now, from this plugin\'s own routes, as one stylesheet and one script, versioned', nodes.length === 2 && nodes.some((n) => n.tag === 'link' && n.href === T.MAP_LIB.css && n.rel === 'stylesheet') && nodes.some((n) => n.tag === 'script' && n.src === T.MAP_LIB.js && n.async === true) && /^\/kybernos-db\/vendor\/maplibre-gl\.js\?v=\d/.test(T.MAP_LIB.js) && /^\/kybernos-db\/vendor\/maplibre-gl\.css\?v=\d/.test(T.MAP_LIB.css) && net.fetches.length === 0)
  windowObject.maplibregl = makeLib(log)
  for (const n of [...nodes]) n.onload()
  await root.settle()
  ok('when both files have loaded the map starts', net.fetches.length === 1 && log.maps.length === 1)
  root.unmount()
  const again = await mount(baseProps())
  ok('and the library is not fetched twice', doc.head.kids.length === 2 && log.maps.length === 2)
  again.unmount()
}
{
  reset()
  delete windowObject.maplibregl
  doc.head.kids = []
  const root = await mount(baseProps())
  const nodes = [...doc.head.kids]
  nodes[1].onerror()
  await root.settle()
  ok('the library file does not come (the route is down): the drawn map with its button, and the two nodes taken away so a retry starts clean', drawn(root) && by(root, 'tables-map-retry').length === 1 && doc.head.kids.length === 0 && net.fetches.length === 0)
  root.unmount()
}

// ── the Map view of a table: its records become pins, a pin opens its record, the open record lights its pin ─────────────────────
{
  const field = (key, type, label, extra) => Object.assign({ key, type, label, required: false, protection: 'normal' }, extra || {})
  const OBJ = { key: 'property', label: 'Properties', title: 'title', fields: [field('title', 'text', 'Title', { required: true }), field('price', 'money', 'Price', { currency: 'EUR', precision: 0 }), field('lat', 'number', 'Latitude'), field('lng', 'number', 'Longitude')] }
  const rec = (id, values) => ({ id, values, rev: 1 })
  const ROWS = [rec('a1', { title: 'Villa', price: 385000, lat: 48.8567, lng: 2.3603 }), rec('a2', { title: 'A loft with a very long name', lat: 48.8516, lng: 2.3573 }), rec('a3', { title: 'No place' }), rec('a4', { title: 'Far away', lat: 123, lng: 2 }), rec('a5', { title: 'Flat', price: 1450000, lat: 48.8509, lng: 2.3337 })]
  const VIEW = { id: 'm1', name: 'Map', kind: 'map', lat: 'lat', lng: 'lng', owner: 'me', fav: false, state: { flt: core.blankFilter(), sorts: [], hidden: [] } }
  ok('a pin says an amount short: €780, €385k, €1.45M, and the money of the currency it is in', T.compactMoney(OBJ.fields[1], 780) === '€780' && T.compactMoney(OBJ.fields[1], 385000) === '€385k' && T.compactMoney(OBJ.fields[1], 1450000) === '€1.45M' && T.compactMoney(OBJ.fields[1], 2000000) === '€2M' && T.compactMoney(Object.assign({}, OBJ.fields[1], { currency: 'USD' }), 12500) === '$13k')
  ok('a pin says the first shown money field when the record has an amount, else its title cut short', T.pinLabel(OBJ, ROWS[0], []) === '€385k' && T.pinLabel(OBJ, ROWS[1], []) === 'A loft with a…' && T.pinLabel(OBJ, ROWS[0], ['price']) === 'Villa')
  const placed = T.placedRecords(OBJ, VIEW, ROWS)
  ok('only a record with both numbers, in range, is placed: a missing one and a latitude of 123 are left out, the order is kept', placed.map((q) => q.row.id).join() === 'a1,a2,a5' && placed[0].lat === 48.8567 && placed[0].lng === 2.3603 && placed[0].row.title === 'Villa' && placed[2].row.label === '€1.45M')
  ok('the view names the fields: another latitude field places the same records elsewhere', T.placedRecords(OBJ, Object.assign({}, VIEW, { lat: 'lng', lng: 'lat' }), ROWS).map((q) => q.row.id).join() === 'a1,a2,a4,a5')

  reset()
  const opened = []
  const page = (extra) => Object.assign({ db: { id: 'db1' }, obj: OBJ, view: VIEW, rows: ROWS, drawer: null, openRecord: (id) => opened.push(id) }, extra || {})
  const root = lite.mount(h(P.GeoView, { p: page() }))
  await root.settle()
  const map = log.maps[0]
  ok('the page asks nobody for anything but the library, the style and the tiles, and the caption counts the places and the records without one', map !== undefined && net.fetches.length === 1 && lite.textOf(by(root, 'tables-map-note')[0]).includes('3 places') && lite.textOf(by(root, 'tables-map-note')[0]).includes('2 without a place'))
  map.zoom = 16 // close in: the two records a few hundred metres apart stand alone
  await draw(root, map)
  const pins = log.markers.filter((m) => m.element.getAttribute('data-kb') === 'tables-pin')
  ok('each placed record is a pin button with its label and its title for a screen reader', pins.length === 3 && pins.map((m) => m.element.kids[0].kids[0].textContent).join() === '€385k,A loft with a…,€1.45M' && pins[0].element.getAttribute('aria-label') === 'Villa, €385,000' && pins[1].element.getAttribute('aria-label') === 'A loft with a very long name' && pins[0].element.getAttribute('data-id') === 'a1')
  pins[0].element.fire('click', { clientX: 0, clientY: 0 })
  ok('a click on a pin opens its record', opened.join() === 'a1')
  root.update(h(P.GeoView, { p: page({ drawer: { id: 'a5' } }) }))
  await root.settle()
  const lit = log.markers.filter((m) => !m.removed && m.element.classList.contains('sel'))
  ok('the record that is open lights its pin, and the map flies to it', lit.length === 1 && lit[0].element.getAttribute('data-id') === 'a5' && lit[0].element.getAttribute('aria-pressed') === 'true' && map.calls.some((c) => c[0] === 'flyTo' && c[1].center[0] === 2.3337))
  root.update(h(P.GeoView, { p: page({ rows: ROWS.slice(2) }) }))
  await root.settle()
  ok('a filter that leaves one place on the map takes the other pins off', log.markers.filter((m) => !m.removed).length === 1)
  root.unmount()
  ok('taking the view off takes the map and its pins away', map.removed === true && log.markers.every((m) => m.removed))

  reset()
  const none = lite.mount(h(P.GeoView, { p: page({ rows: [ROWS[2]] }) }))
  await none.settle()
  ok('records with no place at all draw the schematic map with its caption, and ask nobody for anything', log.maps.length === 0 && net.fetches.length === 0 && by(none, 'tables-map-box')[0].props['data-map'] === 'drawn' && lite.textOf(by(none, 'tables-map-note')[0]).includes('1 without a place'))
  none.unmount()
}

// the clocks the test borrowed are given back
globalThis.setTimeout = realSetTimeout
globalThis.clearTimeout = realClearTimeout
globalThis.setInterval = realSetInterval
globalThis.clearInterval = realClearInterval
Date.now = realNow

if (failed > 0) { console.log('test-map: ' + failed + ' failure(s)'); process.exit(1) }
console.log('test-map: all green')
