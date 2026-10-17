// src/plugin.js: body of the browser factory (assembled by scripts/build.mjs).
// In scope from the assembler: `require` (DSH module loader), `engine`, `audio`, `render2d`, `renderExt`, `Mediabunny`, `RUNTIME_SRC`.
//
// Two things live here:
//   MotionPlayer  plays a motion scene; registered as the "motion" player of the Creations page, the chat card and the popup
//   MotionPanel   the right-sidebar tab: play, scrub, change the scene's settings, export (MP4, standalone page, app)
const React = require('react')
const h = React.createElement

const TYPE_ID = 'kybernos-motion'
const KIND = 'kybernos-motion'
const SLOT = 'sidebar.right.pane.tab'
const STYLE_ID = 'kybernos-motion-styles'
const R = '/kybernos-motion/'

// French is the source, English the pair; French only for a French UI, a translated language is looked up by its French text,
// and every other language (and a language not known yet) reads English.
const lang = () => {
  try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')) } catch (e) { return 'en' }
}
const kt = (fr, en) => {
  const l = lang()
  if (l === 'kybernos' || l.slice(0, 2) === 'fr') return fr
  if (l === 'en') return en
  try {
    const a = window.__KB_I18N_ACTIVE__
    if (a !== null && a !== undefined && a.dict !== null && typeof a.dict === 'object' && typeof a.dict[fr] === 'string') return a.dict[fr]
  } catch (e) { /* no dictionary: English */ }
  return en
}
/** True for a French UI only: the typography below (the space before a colon, the guillemets) is French. */
const isFr = () => { const l = lang(); return l === 'kybernos' || l.slice(0, 2) === 'fr' }
// Text separator, locale-aware: French ' : ', every other language ': '.
const sep = () => (isFr() ? ' : ' : ': ')
/** A name or a text between quotes, in the typography of the language. */
const quoted = (s) => (isFr() ? '« ' + s + ' »' : '“' + s + '”')
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const fmtT = (t) => { const m = Math.floor(t / 60); const s = (t % 60).toFixed(1); return m + ':' + (s.length < 4 ? '0' + s : s) }
// One size style per language, the same as Creations and the media player: English « 86 KB », « 5.0 MB » (a decimal point), French
// « 86 Ko », « 5,0 Mo ». It used to mix « 5,0 MB » (a French comma on an English unit) and « 31 Ko » in one dialog.
const fmtBytes = (n) => {
  const fr = kt(true, false)
  if (n >= 1048576) { const v = (n / 1048576).toFixed(1); return fr ? v.replace('.', ',') + ' Mo' : v + ' MB' }
  if (n >= 1024) return Math.round(n / 1024) + (fr ? ' Ko' : ' KB')
  return n + (fr ? ' o' : ' B')
}
const slugOf = (s) => String(s || 'animation').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'animation'

let CTX = null
let SESSION_ID = ''
let LAST_STATE = null

/* ══════════════════════ host access ══════════════════════ */

async function api (method, path, body, extra) {
  const url = R + path + (path.includes('?') ? '&' : '?') + (SESSION_ID ? 'session=' + encodeURIComponent(SESSION_ID) : '')
  const init = { method, credentials: 'same-origin', headers: {} }
  if (body !== undefined && body !== null) {
    if (body instanceof Blob || body instanceof ArrayBuffer || body instanceof Uint8Array) { init.body = body; init.headers['content-type'] = (extra && extra.type) || 'application/octet-stream' } else { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json' }
  }
  const r = await fetch(url, init)
  let json = null
  try { json = await r.json() } catch (e) { json = null }
  return { status: r.status, ok: r.ok && (json === null || json.ok !== false), json: json || {} }
}
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&')

function openTab () {
  try {
    const sb = CTX && CTX.get('sidebarRight')
    if (sb && typeof sb.openTab === 'function') sb.openTab(KIND, {})
  } catch (e) { /* no session mounted */ }
}

// The tab can only show inside a chat. When someone asks for it elsewhere (the Creations page), keep trying for a minute
// so it appears as soon as a chat is on screen.
let WANT_OPEN_UNTIL = 0
function requestOpen () {
  WANT_OPEN_UNTIL = Date.now() + 60000
  openTab()
}
const panelShown = () => { const p = document.querySelector('[data-kb="motion-panel"]'); return !!p && p.getClientRects().length > 0 } // mounted AND on screen: a hidden chat keeps its tabs in the page

/* ══════════════════════ scene files ══════════════════════ */

/** A scene file's text -> { ok, scene, title, rev, errors } (validated; never throws). */
function parseDoc (text) {
  let doc = null
  try { doc = JSON.parse(String(text || '')) } catch (e) { return { ok: false, message: kt('Fichier illisible (JSON invalide).', 'Unreadable file (invalid JSON).') } }
  const first = doc && Array.isArray(doc.data) ? doc.data[0] : null
  if (!first || typeof first !== 'object') return { ok: false, message: kt('Aucune scène dans ce fichier.', 'No scene in this file.') }
  const raw = first.payload && typeof first.payload === 'object' ? first.payload : first
  const v = engine.validate(raw)
  return { ok: true, scene: v.scene, errors: v.errors, title: typeof doc.title === 'string' ? doc.title : 'Animation', rev: doc.meta && doc.meta.rev ? doc.meta.rev : 0 }
}

const PALETTE = [['Bleu', '#4176e6'], ['Corail', '#e8603c'], ['Vert', '#1f9d6b'], ['Ambre', '#f59e0b'], ['Violet', '#7c5cff'], ['Noir', '#0f1115'], ['Blanc', '#f5f6f7']]

/** The settings form of a scene: its own `controls`, else one control per param (text, number or colour). */
function controlsOf (scene) {
  if (scene.controls && scene.controls.length > 0) return scene.controls
  const out = []
  for (const [id, v] of Object.entries(scene.params || {})) {
    if (typeof v === 'number') out.push({ id, label: id, type: 'number', min: 0, max: 1e9 })
    else if (typeof v === 'string' && engine.parseColor(v) !== null) out.push({ id, label: id, type: 'color' })
    else if (typeof v === 'string') out.push({ id, label: id, type: 'text' })
  }
  return out
}

/* ══════════════════════ the big libraries, loaded only when a scene needs them ══════════════════════ */

// three.js and lottie-web are not in this bundle: the host serves them (/kybernos-motion/vendor/<name>.js) and they land in private
// globals, so they never replace another bundle's `THREE` or `lottie`.
const VENDOR_GLOBAL = { three: 'KbMotionThree', lottie: 'KbMotionLottie' }
const vendorLoads = new Map()
function loadVendor (name) {
  const g = VENDOR_GLOBAL[name]
  if (window[g]) return Promise.resolve(window[g])
  if (vendorLoads.has(name)) return vendorLoads.get(name)
  const p = new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = R + 'vendor/' + name + '.js'
    el.onload = () => (window[g] ? resolve(window[g]) : reject(new Error(name + ' did not load')))
    el.onerror = () => reject(new Error(name + ' is unavailable'))
    document.head.appendChild(el)
  })
  p.catch(() => vendorLoads.delete(name))
  vendorLoads.set(name, p)
  return p
}

/* ══════════════════════ media: images, sounds, Lottie files and 3D models of a scene ══════════════════════ */

function createAssets (path, opts) {
  const o = opts || {}
  const images = new Map()
  const sounds = new Map()
  const lotties = new Map()
  const models = new Map()
  const failed = new Set()
  const notes = [] // why something does not show (no WebGL, a library that did not load)
  let listener = null
  const external = renderExt.createExternal({ three: () => window.KbMotionThree || null, lottie: () => window.KbMotionLottie || null, lotties, models, createCanvas: () => document.createElement('canvas') })
  const url = (src) => R + 'asset?' + q({ scene: path, src, session: SESSION_ID })
  const fetchBuf = async (src) => { const r = await fetch(url(src), { credentials: 'same-origin' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer() }
  return {
    images, sounds, lotties, models, failed, notes, external,
    onChange (fn) { listener = fn },
    dispose () { try { external.dispose() } catch (e) { /* gone */ } },
    /** Lottie files and 3D models (and the libraries that play them): only for a scene that has such layers. `skip3d` leaves 3D out (card thumbnails). */
    async loadExternal (scene) {
      const need = engine.needs(scene)
      const a = engine.assetsOf(scene)
      if (need.lottie) {
        try {
          await loadVendor('lottie')
          for (const src of a.lotties) {
            if (lotties.has(src) || failed.has(src)) continue
            try {
              const r = await fetch(url(src), { credentials: 'same-origin' })
              if (!r.ok) throw new Error('HTTP ' + r.status)
              lotties.set(src, JSON.parse(await r.text()))
            } catch (e) { failed.add(src) }
          }
        } catch (e) { notes.push(String(e.message || e)) }
      }
      if (need.three && !o.skip3d) {
        try {
          const THREE = await loadVendor('three')
          for (const src of a.models) {
            if (models.has(src) || failed.has(src)) continue
            try {
              const r = await fetch(url(src), { credentials: 'same-origin' })
              if (!r.ok) throw new Error('HTTP ' + r.status)
              const buf = await r.arrayBuffer()
              models.set(src, await new Promise((resolve, reject) => renderExt.createModelLoader(THREE).parse(buf, '', resolve, reject)))
            } catch (e) { failed.add(src) }
          }
        } catch (e) { notes.push(String(e.message || e)) }
      }
      if (listener) listener()
    },
    /** The text of a vendored library (to embed in a standalone page). */
    async vendorText (name) { const r = await fetch(R + 'vendor/' + name + '.js', { credentials: 'same-origin' }); return r.ok ? r.text() : null },
    async lottieText (src) { const r = await fetch(url(src), { credentials: 'same-origin' }); return r.ok ? r.text() : null },
    async loadImages (scene) {
      for (const src of render2d.imagesOf(scene)) {
        if (images.has(src) || failed.has(src)) continue
        try {
          const r = await fetch(url(src), { credentials: 'same-origin' })
          if (!r.ok) throw new Error('HTTP ' + r.status)
          images.set(src, await createImageBitmap(await r.blob()))
          if (listener) listener()
        } catch (e) { failed.add(src) }
      }
    },
    async loadSounds (scene) {
      for (const src of audio.sourcesOf(scene.audio)) {
        if (sounds.has(src) || failed.has(src)) continue
        try {
          const buf = await fetchBuf(src)
          const ctxA = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 48000)
          const dec = await ctxA.decodeAudioData(buf)
          sounds.set(src, { rate: dec.sampleRate, channels: Array.from({ length: Math.min(2, dec.numberOfChannels) }, (_, i) => dec.getChannelData(i)) })
        } catch (e) { failed.add(src) }
      }
    },
    /** Raw bytes of an asset as a data URL (for a standalone page). */
    async dataUrl (src) {
      const r = await fetch(url(src), { credentials: 'same-origin' })
      if (!r.ok) return null
      const blob = await r.blob()
      return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob) })
    },
  }
}

/* ══════════════════════ audio preview ══════════════════════ */

function createAudioPreview () {
  let ac = null
  let node = null
  let token = 0 // a start that was waiting (the browser holds audio until a click) must not play after a later stop or start
  let cache = { key: '', buffer: null }
  return {
    async play (scene, assets, t, muted) {
      this.stop()
      const mine = token
      if (muted || !scene.audio || scene.audio.length === 0) return
      try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)()
        if (ac.state === 'suspended') await ac.resume()
        if (mine !== token) return
        await assets.loadSounds(scene)
        if (mine !== token) return
        const key = JSON.stringify(scene.audio) + scene.format.duration + [...assets.sounds.keys()].join()
        if (cache.key !== key) {
          const m = audio.mix(scene.audio, scene.format.duration, audio.SAMPLE_RATE, assets.sounds)
          const b = ac.createBuffer(2, m.left.length, m.rate)
          b.copyToChannel(m.left, 0)
          b.copyToChannel(m.right, 1)
          cache = { key, buffer: b }
        }
        if (mine !== token) return
        node = ac.createBufferSource()
        node.buffer = cache.buffer
        node.connect(ac.destination)
        node.start(0, clamp(t, 0, scene.format.duration))
      } catch (e) { /* no sound: the picture still plays */ }
    },
    stop () { token++; try { if (node) { node.stop(); node.disconnect() } } catch (e) { /* already stopped */ } node = null },
  }
}

/* ══════════════════════ playback hook ══════════════════════ */

function usePlayer (scene, path, opts) {
  const o = opts || {}
  const canvasRef = React.useRef(null)
  const st = React.useRef({ t: o.startAt || 0, playing: false, last: 0, raf: 0, loop: true })
  const [, force] = React.useReducer((x) => x + 1, 0)
  const assets = React.useMemo(() => createAssets(path, { skip3d: o.compact === true }), [path, o.compact])
  const sound = React.useMemo(() => createAudioPreview(), [])
  const [muted, setMuted] = React.useState(false)
  const mutedRef = React.useRef(false)
  mutedRef.current = muted
  const sceneRef = React.useRef(scene)
  const overrides = React.useRef(o.overrides)
  sceneRef.current = scene
  overrides.current = o.overrides

  const paintNow = React.useCallback(() => {
    const cv = canvasRef.current
    const sc = sceneRef.current
    if (!cv || !sc) return
    const box = cv.parentElement
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = clamp(Math.round(((box && box.clientWidth) || 480) * dpr), 240, 1920)
    const hh = Math.max(2, Math.round((w * sc.format.height) / sc.format.width))
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh }
    try { render2d.paint(cv.getContext('2d'), engine.evaluate(sc, st.current.t, overrides.current), { width: w, height: hh, images: assets.images, external: assets.external }) } catch (e) { /* a bad frame must not stop the player */ }
  }, [assets])

  React.useEffect(() => {
    if (!scene) return undefined
    assets.onChange(paintNow)
    assets.loadImages(scene)
    assets.loadExternal(scene)
    paintNow()
    return () => assets.onChange(null)
  }, [scene, assets, paintNow])
  React.useEffect(() => () => assets.dispose(), [assets])
  React.useEffect(() => { paintNow() })
  React.useEffect(() => {
    const box = canvasRef.current && canvasRef.current.parentElement
    if (!box || typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(() => paintNow())
    ro.observe(box)
    return () => ro.disconnect()
  }, [paintNow])
  React.useEffect(() => () => { cancelAnimationFrame(st.current.raf); sound.stop() }, [sound])

  const tick = React.useCallback((now) => {
    const s = st.current
    if (!s.playing) return
    const dur = sceneRef.current.format.duration
    s.t += (now - s.last) / 1000
    s.last = now
    if (s.t >= dur) {
      if (s.loop) { s.t = 0; sound.play(sceneRef.current, assets, 0, mutedRef.current) } else { s.t = dur; s.playing = false; sound.stop() }
    }
    paintNow()
    force()
    if (s.playing) s.raf = requestAnimationFrame(tick)
  }, [paintNow, sound, assets])

  const api2 = {
    canvasRef, assets, muted,
    get t () { return st.current.t },
    get playing () { return st.current.playing },
    get loop () { return st.current.loop },
    setLoop (v) { st.current.loop = v; force() },
    setMuted (v) { setMuted(v); if (st.current.playing) { if (v) sound.stop(); else sound.play(sceneRef.current, assets, st.current.t, false) } },
    play () {
      const s = st.current
      if (s.playing) { s.playing = false; cancelAnimationFrame(s.raf); sound.stop(); force(); return }
      if (s.t >= sceneRef.current.format.duration - 0.05) s.t = 0
      s.playing = true
      s.last = performance.now()
      sound.play(sceneRef.current, assets, s.t, mutedRef.current)
      s.raf = requestAnimationFrame(tick)
      force()
    },
    pause () { const s = st.current; if (s.playing) { s.playing = false; cancelAnimationFrame(s.raf); sound.stop(); force() } },
    seek (t) {
      const s = st.current
      s.t = clamp(t, 0, sceneRef.current.format.duration)
      if (s.playing) sound.play(sceneRef.current, assets, s.t, mutedRef.current)
      paintNow()
      force()
    },
    paintNow,
  }
  return api2
}

/* ══════════════════════ small UI pieces ══════════════════════ */

const ICONS = {
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/>',
  up: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M8 5v14M16 5v14"/>',
  file: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"/><path d="M14 3.5V8h4"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  app: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9h17"/>',
  hist: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4M12 8v4.5l3 1.5"/>',
  loop: '<path d="M5 11V9a3 3 0 0 1 3-3h10l-3-3M19 13v2a3 3 0 0 1-3 3H6l3 3"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l4 6M21 9l-4 6"/>',
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/>',
}
const Ic = (name, size) => h('svg', { className: 'kbmt-ic', width: size || 16, height: size || 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: ICONS[name] } })

function Timeline ({ scene, player }) {
  const rows = React.useMemo(() => engine.timeline(scene), [scene])
  const d = scene.format.duration
  const areaRef = React.useRef(null)
  const drag = React.useRef(false)
  const seekAt = (clientX) => { const r = areaRef.current.getBoundingClientRect(); player.seek(clamp((clientX - r.left) / r.width, 0, 1) * d) }
  const ticks = []
  const step = d <= 12 ? 1 : d <= 60 ? 5 : 15
  for (let i = 0; i <= d + 1e-9; i += step) ticks.push(i)
  return h('div', { className: 'kbmt-tl', 'data-kb': 'motion-timeline' },
    h('div', { className: 'kbmt-tl-l' }, h('div', null), rows.map((r, i) => h('div', { key: i, title: r.name, style: { paddingLeft: 8 + r.depth * 8 } }, r.name))),
    h('div', {
      className: 'kbmt-tl-a', ref: areaRef, tabIndex: 0, role: 'slider', 'aria-label': kt('Position dans l\'animation', 'Position in the animation'), 'aria-valuemin': 0, 'aria-valuemax': d, 'aria-valuenow': Number(player.t.toFixed(1)),
      onPointerDown: (e) => { drag.current = true; try { e.currentTarget.setPointerCapture(e.pointerId) } catch (x) { /* no capture */ } player.pause(); seekAt(e.clientX) },
      onPointerMove: (e) => { if (drag.current) seekAt(e.clientX) },
      onPointerUp: () => { drag.current = false },
      onKeyDown: (e) => { const s = e.shiftKey ? 1 : 0.1; if (e.key === 'ArrowRight') { player.seek(player.t + s); e.preventDefault() } else if (e.key === 'ArrowLeft') { player.seek(player.t - s); e.preventDefault() } },
    },
    h('div', { className: 'kbmt-tl-r' }, ticks.map((t) => h('span', { key: t, style: { left: (t / d) * 100 + '%' } }, t + 's'))),
    rows.map((r, i) => h('div', { key: i, className: 'kbmt-tl-row' },
      r.from !== null && r.to > r.from ? h('i', { className: 'kbmt-bar', style: { left: (r.from / d) * 100 + '%', width: ((r.to - r.from) / d) * 100 + '%' } }) : null,
      r.keys.map((k) => h('i', { key: k, className: 'kbmt-kf', style: { left: (k / d) * 100 + '%' } })))),
    h('div', { className: 'kbmt-ph', style: { left: (player.t / d) * 100 + '%' } })))
}

function Transport ({ scene, player, extra }) {
  const hasSound = scene.audio && scene.audio.length > 0
  return h('div', { className: 'kbmt-transport' },
    h('button', { type: 'button', className: 'kbmt-play', 'data-act': 'play', 'aria-label': player.playing ? kt('Pause', 'Pause') : kt('Lecture', 'Play'), onClick: () => player.play() }, Ic(player.playing ? 'pause' : 'play', 14)),
    h('span', { className: 'kbmt-time' }, fmtT(player.t) + ' / ' + fmtT(scene.format.duration)),
    h('span', { className: 'kbmt-sp' }),
    hasSound ? h('button', { type: 'button', className: 'kbmt-tgl', 'aria-pressed': !player.muted, title: kt('Son', 'Sound'), 'aria-label': kt('Son', 'Sound'), onClick: () => player.setMuted(!player.muted) }, Ic(player.muted ? 'mute' : 'sound', 14)) : null,
    h('button', { type: 'button', className: 'kbmt-tgl', 'aria-pressed': player.loop, onClick: () => player.setLoop(!player.loop) }, Ic('loop', 14), kt('Boucle', 'Loop')),
    extra || null)
}

/* ══════════════════════ the player (Creations, chat card, popup) ══════════════════════ */

function MotionPlayer (props) {
  const parsed = React.useMemo(() => parseDoc(props.text), [props.text])
  const path = props.path || ''
  const scene = parsed.ok ? parsed.scene : null
  const compact = props.compact === true
  const player = usePlayer(scene, path, { startAt: scene ? scene.format.duration * 0.66 : 0, compact })
  const [hint, setHint] = React.useState(false)
  if (!parsed.ok) return h('div', { className: 'kbmt-root kbmt-bad' }, parsed.message)
  if (compact) return h('div', { className: 'kbmt-root kbmt-compact', 'data-kb': 'motion-player-compact' }, h('div', { className: 'kbmt-stage' }, h('canvas', { ref: player.canvasRef })))
  return h('div', { className: 'kbmt-root kbmt-solo', 'data-kb': 'motion-player', 'data-kb-path': path },
    h('div', { className: 'kbmt-stage' }, h('canvas', { ref: player.canvasRef, onClick: () => player.play() })),
    h(Transport, {
      scene, player,
      extra: path ? h('button', { type: 'button', className: 'kbmt-btn', 'data-act': 'edit', onClick: async () => {
        await api('POST', 'open', { path })
        requestOpen()
        setTimeout(() => setHint(!panelShown()), 900)
      } }, Ic('pencil', 13), kt('Modifier', 'Edit')) : null,
    }),
    hint ? h('p', { className: 'kbmt-note', role: 'status', 'data-kb': 'motion-hint' }, kt('Ouvre un chat : l\'animation s\'ouvrira dans le panneau Motion (barre latérale droite).', 'Open a chat: the animation will open in the Motion panel (right sidebar).')) : null,
    h('div', { className: 'kbmt-scrub' }, h('input', { type: 'range', min: 0, max: scene.format.duration, step: 0.05, value: player.t, 'aria-label': kt('Position', 'Position'), onChange: (e) => { player.pause(); player.seek(Number(e.target.value)) } })),
    parsed.errors.length ? h('p', { className: 'kbmt-note' }, (parsed.errors.length === 1 ? kt('1 élément ignoré dans ce fichier.', '1 item ignored in this file.') : kt(parsed.errors.length + ' éléments ignorés dans ce fichier.', parsed.errors.length + ' items ignored in this file.'))) : null)
}

/* ══════════════════════ export ══════════════════════ */

const hasWebCodecs = () => typeof VideoEncoder === 'function' && typeof VideoFrame === 'function'

/** Encode the whole scene to MP4 (WebM if the browser cannot write H.264). Returns { bytes, format }. */
async function exportVideo ({ scene, assets, height, fps, onProgress, isCancelled }) {
  if (!hasWebCodecs()) throw new Error(kt('Ce navigateur ne sait pas encoder de vidéo (WebCodecs).', 'This browser cannot encode video (WebCodecs).'))
  const w = Math.max(2, Math.round((height * scene.format.width) / scene.format.height / 2) * 2)
  const hh = Math.max(2, Math.round(height / 2) * 2)
  let format = 'mp4'
  let fmt = new Mediabunny.Mp4OutputFormat()
  let vcodec = await Mediabunny.getFirstEncodableVideoCodec(fmt.getSupportedVideoCodecs(), { width: w, height: hh })
  if (!vcodec) { format = 'webm'; fmt = new Mediabunny.WebMOutputFormat(); vcodec = await Mediabunny.getFirstEncodableVideoCodec(fmt.getSupportedVideoCodecs(), { width: w, height: hh }) }
  if (!vcodec) throw new Error(kt('Aucun codec vidéo disponible dans ce navigateur.', 'No video codec available in this browser.'))
  const output = new Mediabunny.Output({ format: fmt, target: new Mediabunny.BufferTarget() })
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = hh
  const ctx = cv.getContext('2d')
  const vs = new Mediabunny.CanvasSource(cv, { codec: vcodec, bitrate: Mediabunny.QUALITY_HIGH })
  output.addVideoTrack(vs, { frameRate: fps })
  let as = null
  if (scene.audio && scene.audio.length > 0 && typeof AudioEncoder === 'function') {
    await assets.loadSounds(scene)
    const acodec = await Mediabunny.getFirstEncodableAudioCodec(fmt.getSupportedAudioCodecs(), { numberOfChannels: 2, sampleRate: audio.SAMPLE_RATE })
    if (acodec) { as = new Mediabunny.AudioBufferSource({ codec: acodec, bitrate: 128000 }); output.addAudioTrack(as) }
  }
  await assets.loadImages(scene)
  await assets.loadExternal(scene)
  await output.start()
  const total = Math.max(1, Math.round(scene.format.duration * fps))
  for (let i = 0; i < total; i++) {
    if (isCancelled()) { try { await output.cancel() } catch (e) { /* nothing to cancel */ } return null }
    render2d.paint(ctx, engine.evaluate(scene, i / fps), { width: w, height: hh, images: assets.images, external: assets.external })
    await vs.add(i / fps, 1 / fps)
    if (i % 4 === 0) { onProgress(i + 1, total); await new Promise((r) => setTimeout(r, 0)) }
  }
  vs.close()
  if (as) {
    const m = audio.mix(scene.audio, scene.format.duration, audio.SAMPLE_RATE, assets.sounds)
    const buf = new AudioBuffer({ length: m.left.length, sampleRate: m.rate, numberOfChannels: 2 })
    buf.copyToChannel(m.left, 0)
    buf.copyToChannel(m.right, 1)
    await as.add(buf)
    as.close()
  }
  await output.finalize()
  onProgress(total, total)
  return { bytes: new Uint8Array(output.target.buffer), format }
}

/** Everything a standalone page must carry: media as data URLs, Lottie files as text, and the libraries a scene needs. */
async function gatherMedia (assets, scene) {
  const a = engine.assetsOf(scene)
  const out = { images: {}, sounds: {}, lotties: {}, models: {}, libs: { three: null, lottie: null } }
  for (const src of a.images) { const d = await assets.dataUrl(src); if (d) out.images[src] = d }
  for (const src of a.sounds) { const d = await assets.dataUrl(src); if (d) out.sounds[src] = d }
  for (const src of a.lotties) { const t = await assets.lottieText(src); if (t) out.lotties[src] = t }
  for (const src of a.models) { const d = await assets.dataUrl(src); if (d) out.models[src] = d }
  const need = engine.needs(scene)
  if (need.three) out.libs.three = await assets.vendorText('three')
  if (need.lottie) out.libs.lottie = await assets.vendorText('lottie')
  return out
}

/** A page that plays the scene by itself (no DSH, no network): the runtime, the scene and its media in one file. */
function standaloneHTML ({ title, scene, images, sounds, lotties, models, libs }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const LS = String.fromCharCode(0x2028)
  const PS = String.fromCharCode(0x2029)
  const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029')
  const player = `
const SCENE = JSON.parse(document.getElementById('scene').textContent)
const MEDIA = JSON.parse(document.getElementById('media').textContent)
const cv = document.getElementById('cv'), ctx = cv.getContext('2d')
const F = SCENE.format, D = F.duration
let t = 0, playing = true, last = performance.now(), ac = null, node = null, muted = false
const images = new Map()
const lotties = new Map(), models = new Map()
const external = renderExt.createExternal({ three: () => window.KbMotionThree || null, lottie: () => window.KbMotionLottie || null, lotties, models, createCanvas: () => document.createElement('canvas') })
for (const [src, text] of Object.entries(MEDIA.lotties || {})) { try { lotties.set(src, JSON.parse(text)) } catch (e) {} }
const loaded = Promise.all(Object.entries(MEDIA.images).map(async ([src, url]) => { try { images.set(src, await createImageBitmap(await (await fetch(url)).blob())) } catch (e) {} }).concat(Object.entries(MEDIA.models || {}).map(async ([src, url]) => { try { const buf = await (await fetch(url)).arrayBuffer(); models.set(src, await new Promise((ok, no) => renderExt.createModelLoader(window.KbMotionThree).parse(buf, '', ok, no))) } catch (e) {} })))
const decoded = new Map()
const soundsReady = Promise.all(Object.entries(MEDIA.sounds).map(async ([src, url]) => { try { const a = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 48000); const d = await a.decodeAudioData(await (await fetch(url)).arrayBuffer()); decoded.set(src, { rate: d.sampleRate, channels: Array.from({ length: Math.min(2, d.numberOfChannels) }, (_, i) => d.getChannelData(i)) }) } catch (e) {} }))
let mixed = null
async function startSound () {
  stopSound()
  if (muted || !SCENE.audio.length) return
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)()
    if (ac.state === 'suspended') await ac.resume()
    await soundsReady
    if (!mixed) { const m = audio.mix(SCENE.audio, D, audio.SAMPLE_RATE, decoded); mixed = ac.createBuffer(2, m.left.length, m.rate); mixed.copyToChannel(m.left, 0); mixed.copyToChannel(m.right, 1) }
    node = ac.createBufferSource(); node.buffer = mixed; node.connect(ac.destination); node.start(0, Math.min(t, D))
  } catch (e) {}
}
function stopSound () { try { if (node) { node.stop(); node.disconnect() } } catch (e) {} node = null }
function fit () { const k = Math.min(innerWidth / F.width, (innerHeight - 44) / F.height); cv.style.width = F.width * k + 'px'; cv.style.height = F.height * k + 'px'; cv.width = Math.min(1920, Math.round(F.width * k * (devicePixelRatio || 1))); cv.height = Math.round(cv.width * F.height / F.width) }
function draw () { render2d.paint(ctx, engine.evaluate(SCENE, t), { width: cv.width, height: cv.height, images, external }) }
function frame (now) { if (playing) { t += (now - last) / 1000; if (t >= D) { t = 0; startSound() } } last = now; draw(); document.getElementById('bar').value = t / D * 1000; requestAnimationFrame(frame) }
document.getElementById('pp').onclick = () => { playing = !playing; if (playing) { if (t >= D - .05) t = 0; last = performance.now(); startSound() } else stopSound(); document.getElementById('pp').textContent = playing ? '❚❚' : '▶' }
document.getElementById('bar').oninput = (e) => { t = e.target.value / 1000 * D; if (playing) startSound() }
document.getElementById('mu').onclick = () => { muted = !muted; document.getElementById('mu').style.opacity = muted ? .4 : 1; if (muted) stopSound(); else if (playing) startSound() }
if (!SCENE.audio.length) document.getElementById('mu').hidden = true
addEventListener('resize', fit); fit()
loaded.then(() => { requestAnimationFrame(frame); startSound() })
`
  const lines = [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(title)}</title>`,
    '<style>html,body{margin:0;height:100%;background:#000;color:#eee;font:13px -apple-system,system-ui,sans-serif;overflow:hidden}body{display:flex;flex-direction:column;align-items:center;justify-content:center}canvas{display:block;max-width:100%}#ctl{display:flex;gap:10px;align-items:center;width:min(92vw,900px);height:44px}#ctl button{background:#222;color:#eee;border:1px solid #444;border-radius:7px;padding:5px 10px;cursor:pointer}#bar{flex:1}</style>',
    '</head><body><canvas id="cv"></canvas><div id="ctl"><button id="pp" aria-label="Play/Pause">❚❚</button><input id="bar" type="range" min="0" max="1000" value="0" aria-label="Position"><button id="mu" aria-label="Sound">♪</button></div>',
    `<script id="scene" type="application/json">${json(scene)}</script>`,
    `<script id="media" type="application/json">${json({ images: images || {}, sounds: sounds || {}, lotties: lotties || {}, models: models || {} })}</script>`,
  ].concat(
    libs && libs.three ? ['<script>', libs.three.replace(/<\/script/gi, '<\\/script'), '</script>'] : [],
    libs && libs.lottie ? ['<script>', libs.lottie.replace(/<\/script/gi, '<\\/script'), '</script>'] : [],
    [
    '<script>',
    RUNTIME_SRC.replace(/<\//g, '<\\/'),
    player.replace(/<\//g, '<\\/'),
    '</script></body></html>',
    ])
  return lines.join('\n')
}

function downloadBlob (name, blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

/* ══════════════════════ the panel ══════════════════════ */

function Field ({ ctl, value, onChange }) {
  const id = 'kbmt-f-' + ctl.id
  if (ctl.type === 'text') return h('div', { className: 'kbmt-fld' }, h('label', { htmlFor: id }, ctl.label), h('input', { id, type: 'text', maxLength: 300, value: String(value ?? ''), onChange: (e) => onChange(e.target.value, 'text') }))
  if (ctl.type === 'number') return h('div', { className: 'kbmt-fld' }, h('label', { htmlFor: id }, ctl.label), h('input', { id, type: 'number', min: ctl.min, max: ctl.max, value: Number(value) || 0, onChange: (e) => onChange(Number(e.target.value) || 0, 'text') }))
  if (ctl.type === 'color') {
    const opts = ctl.options && ctl.options.length ? ctl.options : PALETTE
    return h('div', { className: 'kbmt-fld' }, h('span', { className: 'kbmt-lbl' }, ctl.label),
      h('div', { className: 'kbmt-sws', role: 'radiogroup', 'aria-label': ctl.label },
        opts.map(([n, c]) => h('label', { key: c, className: 'kbmt-sw', title: n },
          h('input', { type: 'radio', name: 'kbmt-' + ctl.id, checked: String(value).toLowerCase() === c.toLowerCase(), 'aria-label': n, onChange: () => onChange(c, 'swatch', n) }),
          h('span', { style: { background: c } }))),
        h('label', { className: 'kbmt-sw kbmt-sw-custom', title: kt('Autre couleur', 'Other colour') },
          h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(String(value)) ? value : '#4176e6', 'aria-label': kt('Autre couleur', 'Other colour'), onChange: (e) => onChange(e.target.value, 'text') }), h('span', null, '+'))))
  }
  const opts = ctl.options || []
  return h('div', { className: 'kbmt-fld' }, h('span', { className: 'kbmt-lbl' }, ctl.label),
    h('div', { className: 'kbmt-rseg', role: 'radiogroup', 'aria-label': ctl.label },
      opts.map(([n, v]) => h('label', { key: String(n) }, h('input', { type: 'radio', name: 'kbmt-' + ctl.id, checked: value === v, onChange: () => onChange(v, 'swatch', n) }), h('span', null, n)))))
}

function ExportModal ({ doc, player, onClose, onToast }) {
  const scene = doc.scene
  const canApp = !!(window.__KB_MINIAPPS__ && typeof window.__KB_MINIAPPS__.install === 'function' && window.__KB_MINIAPPS__.supported === true)
  const [fmt, setFmt] = React.useState('mp4')
  const [res, setRes] = React.useState(String(Math.min(1080, scene.format.height)))
  const [fps, setFps] = React.useState('30')
  const [phase, setPhase] = React.useState('choose') // choose | work | done | error
  const [prog, setProg] = React.useState([0, 1])
  const [result, setResult] = React.useState(null)
  const [err, setErr] = React.useState('')
  const cancelled = React.useRef(false)
  const base = slugOf(doc.title)
  const heights = Array.from(new Set([Math.min(1080, scene.format.height), Math.min(720, scene.format.height), Math.min(480, scene.format.height)]))
  // A rough ceiling (one megabyte per second at 1080p): a simple scene encodes far smaller (31 KB for 5 s), so it says « up to ».
  const est = fmtBytes(scene.format.duration * (Number(res) / 1080) * (fps === '60' ? 1.5 : 1) * 1048576)
  const inlineMedia = () => gatherMedia(player.assets, scene)
  const go = async () => {
    cancelled.current = false
    setPhase('work')
    setErr('')
    try {
      if (fmt === 'mp4') {
        const out = await exportVideo({ scene, assets: player.assets, height: Number(res), fps: Number(fps), onProgress: (i, n) => setProg([i, n]), isCancelled: () => cancelled.current })
        if (out === null) { onClose(); onToast(kt('Export annulé', 'Export cancelled')); return }
        const saved = await api('POST', 'export?' + q({ format: out.format, path: doc.path }), out.bytes, { type: out.format === 'webm' ? 'video/webm' : 'video/mp4' })
        setResult({ name: saved.ok && saved.json.name ? saved.json.name : base + '.' + out.format, saved: saved.ok, blob: new Blob([out.bytes], { type: out.format === 'webm' ? 'video/webm' : 'video/mp4' }), size: out.bytes.length, where: saved.ok ? saved.json.path : null })
      } else if (fmt === 'html') {
        const html = standaloneHTML({ title: doc.title, scene, ...(await inlineMedia()) })
        setResult({ name: base + '.html', saved: false, blob: new Blob([html], { type: 'text/html' }), size: html.length, where: null })
      } else if (fmt === 'scene') {
        const text = JSON.stringify({ kind: 'motion', renderer: 'motion', title: doc.title, meta: { rev: doc.rev, history: [] }, data: [(({ _n, ...c }) => c)(scene)] }, null, 2)
        setResult({ name: base + '.miniapp.json', saved: false, blob: new Blob([text], { type: 'application/json' }), size: text.length, where: null })
      } else if (fmt === 'app') {
        const html = standaloneHTML({ title: doc.title, scene, ...(await inlineMedia()) })
        const r = await window.__KB_MINIAPPS__.install({ id: 'motion-' + base, titre: doc.title, html, largeur: 520, hauteur: Math.round(520 * scene.format.height / scene.format.width) + 60 })
        if (!r || r.ok !== true) throw new Error((r && r.message) || kt('L\'installation a échoué.', 'The installation failed.'))
        setResult({ name: doc.title, saved: true, app: true, size: html.length, where: '~/Applications/Kybernos/' })
      }
      setPhase('done')
    } catch (e) { setErr(String((e && e.message) || e)); setPhase('error') }
  }
  const opt = (v, ic, t, s, off) => h('label', { className: 'kbmt-opt' + (off ? ' off' : ''), key: v },
    h('input', { type: 'radio', name: 'kbmt-fmt', value: v, checked: fmt === v, disabled: !!off, onChange: () => setFmt(v) }),
    h('span', { className: 'kbmt-oi' }, Ic(ic, 16)), h('span', { className: 'kbmt-ot' }, h('b', null, t), h('small', null, s)))
  const seg = (name, value, set, items) => h('div', { className: 'kbmt-rseg', role: 'radiogroup', 'aria-label': name }, items.map(([label, v]) => h('label', { key: v }, h('input', { type: 'radio', name: 'kbmt-' + name, checked: value === v, onChange: () => set(v) }), h('span', null, label))))
  let body
  let foot
  if (phase === 'work') {
    body = h('div', { className: 'kbmt-progress' }, h('div', { className: 'kbmt-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round((prog[0] / prog[1]) * 100) }, h('i', { style: { width: (prog[0] / prog[1]) * 100 + '%' } })),
      h('p', { className: 'kbmt-hint' }, fmt === 'mp4' ? kt('Encodage dans ton navigateur · image ' + prog[0] + '/' + prog[1], 'Encoding in your browser · frame ' + prog[0] + '/' + prog[1]) : kt('Préparation…', 'Preparing…')))
    foot = h('button', { type: 'button', className: 'kbmt-btn', 'data-act': 'cancel', onClick: () => { cancelled.current = true } }, kt('Annuler l\'export', 'Cancel export'))
  } else if (phase === 'done') {
    body = h('div', { className: 'kbmt-done' }, h('span', { className: 'kbmt-big' }, Ic('check', 20)), h('b', null, result.name),
      h('span', { className: 'kbmt-hint' }, result.app ? kt('Installée dans ', 'Installed in ') + result.where : fmtBytes(result.size) + (result.saved ? kt(' · enregistré dans le projet (artifacts/)', ' · saved in the project (artifacts/)') : '')))
    foot = [h('button', { type: 'button', className: 'kbmt-btn', key: 'c', onClick: onClose }, kt('Fermer', 'Close')),
      result.blob ? h('button', { type: 'button', className: 'kbmt-btn pri', key: 'd', 'data-act': 'download', onClick: () => downloadBlob(result.name, result.blob) }, Ic('up', 14), kt('Télécharger', 'Download')) : null]
  } else if (phase === 'error') {
    body = h('p', { className: 'kbmt-err', role: 'alert' }, err)
    foot = [h('button', { type: 'button', className: 'kbmt-btn', key: 'c', onClick: onClose }, kt('Fermer', 'Close')), h('button', { type: 'button', className: 'kbmt-btn pri', key: 'r', onClick: () => setPhase('choose') }, kt('Réessayer', 'Try again'))]
  } else {
    body = [h('div', { className: 'kbmt-opts', key: 'o', role: 'radiogroup', 'aria-label': kt('Format', 'Format') },
      opt('mp4', 'film', kt('Vidéo MP4', 'MP4 video'), kt('Pour publier ou envoyer. Encodée dans ton navigateur.', 'To publish or send. Encoded in your browser.')),
      opt('html', 'file', kt('Page autonome (.html)', 'Standalone page (.html)'), kt('Un lecteur dans un seul fichier, sans DSH.', 'A player in one file, no DSH needed.')),
      opt('scene', 'box', kt('Fichier de scène', 'Scene file'), kt('Pour la réimporter ou la partager.', 'To import it again or share it.')),
      canApp ? opt('app', 'app', kt('App macOS', 'macOS app'), kt('Une fenêtre qui reste ouverte sans DSH.', 'A window that stays open without DSH.')) : null),
    fmt === 'mp4' ? h('div', { className: 'kbmt-sub', key: 's' },
      h('div', { className: 'kbmt-fld' }, h('span', { className: 'kbmt-lbl' }, kt('Hauteur', 'Height')), seg('res', res, setRes, heights.map((x) => [x + 'p', String(x)]))),
      h('div', { className: 'kbmt-fld' }, h('span', { className: 'kbmt-lbl' }, kt('Images par seconde', 'Frames per second')), seg('fps', fps, setFps, [['30', '30'], ['60', '60']])),
      h('p', { className: 'kbmt-hint' }, kt('Jusqu\'à environ ' + est + '. Rien n\'est envoyé hors de cette machine.', 'Up to about ' + est + '. Nothing leaves this machine.'))) : null]
    foot = [h('button', { type: 'button', className: 'kbmt-btn', key: 'c', onClick: onClose }, kt('Annuler', 'Cancel')),
      h('button', { type: 'button', className: 'kbmt-btn pri', key: 'g', 'data-act': 'export-go', onClick: go }, fmt === 'mp4' ? kt('Exporter en MP4', 'Export MP4') : fmt === 'app' ? kt('Installer l\'app', 'Install the app') : kt('Enregistrer le fichier', 'Save the file'))]
  }
  return h('div', { className: 'kbmt-mask', onClick: (e) => { if (e.target === e.currentTarget && phase !== 'work') onClose() } },
    h('div', { className: 'kbmt-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': kt('Exporter', 'Export') },
      h('div', { className: 'kbmt-mh' }, h('h2', null, kt('Exporter ', 'Export ') + quoted(doc.title)), phase === 'work' ? null : h('button', { type: 'button', className: 'kbmt-ibtn', 'aria-label': kt('Fermer', 'Close'), onClick: onClose }, Ic('x', 16))),
      h('div', { className: 'kbmt-mb' }, body), h('div', { className: 'kbmt-mf' }, foot)))
}

function MotionPanel () {
  const [doc, setDoc] = React.useState(null) // { path, title, rev, scene, errors, userEdits }
  const [loadErr, setLoadErr] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [pop, setPop] = React.useState(null) // 'revs' | 'list'
  const [revs, setRevs] = React.useState([])
  const [list, setList] = React.useState([])
  const [modal, setModal] = React.useState(false)
  const [toast, setToast] = React.useState('')
  const [arrival, setArrival] = React.useState(0) // counts the scenes the HOST handed us (the agent wrote, Creations pointed here), not our own edits
  const draft = React.useRef(null)
  const timer = React.useRef(null)
  const seenAt = React.useRef(0)
  const failedLoad = React.useRef({ at: -1, when: 0 }) // the scene the host named that could not be read: asked again only after a pause, not every poll
  const lastFrameId = React.useRef('')
  const docRef = React.useRef(null)
  docRef.current = doc
  const scene = doc ? doc.scene : null
  const player = usePlayer(scene, doc ? doc.path : '', { startAt: scene ? scene.format.duration * 0.66 : 0 })
  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 2600) }

  // A scene that just arrived plays from the start, so the first thing seen is the animation, not an empty first frame
  // (with reduced motion it rests on its finished picture instead). The browser keeps the sound until the first click.
  React.useEffect(() => {
    const d = docRef.current
    if (arrival === 0 || !d) return
    const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    player.pause()
    player.seek(calm ? d.scene.format.duration * 0.66 : 0)
    if (!calm) player.play()
  }, [arrival])

  const load = React.useCallback(async (path) => {
    const r = await api('GET', 'scene?' + q({ path }))
    if (!r.ok) { setLoadErr(r.json.message || kt('Impossible de lire cette animation.', 'Cannot read this animation.')); return false }
    setLoadErr('')
    const v = engine.validate(r.json.scene)
    setDoc({ path: r.json.path, title: r.json.title, rev: r.json.rev, scene: v.scene, errors: r.json.errors || [], userEdits: r.json.userEdits || [] })
    draft.current = null
    setStatus('')
    setArrival((n) => n + 1)
    return true
  }, [])

  // follow what the host says is current (the agent wrote, Creations pointed here); answer frame requests
  React.useEffect(() => {
    let dead = false
    const poll = async () => {
      let s = null
      try { s = await api('GET', 'state') } catch (e) { return }
      if (dead || !s.ok) return
      const cur = s.json.current
      const failed = failedLoad.current
      if (cur && (cur.at !== seenAt.current || (!docRef.current && (failed.at !== cur.at || Date.now() - failed.when > 15000)))) {
        seenAt.current = cur.at
        const d = docRef.current
        if (!d || d.path !== cur.path || (draft.current === null)) failedLoad.current = (await load(cur.path)) ? { at: -1, when: 0 } : { at: cur.at, when: Date.now() }
      }
      const f = s.json.frame
      if (f && f.id !== lastFrameId.current && docRef.current) {
        lastFrameId.current = f.id
        try {
          const sc = docRef.current.scene
          const w = Math.min(1280, sc.format.width)
          const hh = Math.max(2, Math.round((w * sc.format.height) / sc.format.width))
          const cv = document.createElement('canvas')
          cv.width = w
          cv.height = hh
          const assets = createAssets(docRef.current.path)
          await assets.loadImages(sc)
          await assets.loadExternal(sc)
          render2d.paint(cv.getContext('2d'), engine.evaluate(sc, f.t), { width: w, height: hh, images: assets.images, external: assets.external })
          assets.dispose()
          const blob = await new Promise((res) => cv.toBlob(res, 'image/png'))
          if (blob) await api('POST', 'frame?' + q({ id: f.id }), blob, { type: 'image/png' })
        } catch (e) { /* the agent's call times out with an instruction */ }
      }
    }
    poll()
    const t = setInterval(poll, 1200)
    return () => { dead = true; clearInterval(t) }
  }, [load])

  const save = React.useCallback(async (what) => {
    const d = docRef.current
    if (!d || draft.current === null) return
    const { _n, ...raw } = draft.current
    const r = await api('POST', 'save', { path: d.path, scene: raw, what })
    if (r.ok) { setStatus(kt('Envoyé à l\'agent', 'Sent to the agent')); setDoc((x) => (x ? { ...x, rev: r.json.rev } : x)); draft.current = null; seenAt.current = Date.now() + 1; setTimeout(() => setStatus(''), 1800) } else say(r.json.message || kt('Enregistrement impossible.', 'Cannot save.'))
  }, [])

  const setParam = (ctl, value, kind, shown) => {
    const d = docRef.current
    if (!d) return
    const next = { ...(draft.current || d.scene), params: { ...(draft.current || d.scene).params, [ctl.id]: value } }
    draft.current = next
    setDoc({ ...d, scene: engine.validate(next).scene })
    clearTimeout(timer.current)
    const what = ctl.label + sep() + (kind === 'text' ? quoted(String(value).slice(0, 40)) : shown || String(value))
    if (kind === 'text') timer.current = setTimeout(() => save(what), 700)
    else save(what)
  }

  const openList = async () => {
    if (pop === 'list') { setPop(null); return }
    const r = await api('GET', 'list')
    setList(r.ok ? r.json.scenes || [] : [])
    setPop('list')
  }
  const openRevs = async () => {
    if (pop === 'revs') { setPop(null); return }
    const r = await api('GET', 'revisions?' + q({ path: doc.path }))
    setRevs(r.ok ? r.json.revisions || [] : [])
    setPop('revs')
  }

  if (!doc) {
    return h('div', { className: 'kbmt-root kbmt-panel', 'data-kb': 'motion-panel' },
      h('div', { className: 'kbmt-head' }, h('div', { className: 'kbmt-title' }, h('strong', null, 'Motion')),
        h('div', { className: 'kbmt-actions' }, h('button', { type: 'button', className: 'kbmt-btn', 'data-act': 'list', onClick: openList }, Ic('list', 14), kt('Mes animations', 'My animations')))),
      pop === 'list' ? ListPop({ list, onPick: async (p) => { await api('POST', 'open', { path: p }); setPop(null); await load(p) } }) : null,
      h('div', { className: 'kbmt-empty', 'data-kb': 'motion-empty' }, loadErr ? h('p', { className: 'kbmt-err' }, loadErr) : null,
        h('b', null, kt('Aucune animation ouverte', 'No animation open')),
        h('p', null, kt('Demandes-en une à l\'agent (titre animé, graphique, compteur, logo…), ou ouvre un fichier de type motion depuis la page Créations.', 'Ask the agent for one (animated title, chart, counter, logo…), or open a motion file from the Creations page.'))))
  }

  const controls = controlsOf(scene)
  return h('div', { className: 'kbmt-root kbmt-panel', 'data-kb': 'motion-panel', 'data-kb-path': doc.path },
    h('div', { className: 'kbmt-head' },
      h('div', { className: 'kbmt-title' }, h('strong', { title: doc.path }, doc.title),
        h('button', { type: 'button', className: 'kbmt-status', 'aria-haspopup': 'true', 'aria-expanded': pop === 'revs', 'data-act': 'revisions', onClick: openRevs },
          status ? [Ic('check', 13), status] : [Ic('hist', 13), kt('Enregistré · r', 'Saved · r') + doc.rev])),
      h('div', { className: 'kbmt-actions' },
        h('button', { type: 'button', className: 'kbmt-btn', 'data-act': 'list', onClick: openList }, Ic('list', 14), kt('Animations', 'Animations')),
        h('button', { type: 'button', className: 'kbmt-btn pri', 'data-act': 'export', onClick: () => { setPop(null); setModal(true) } }, Ic('up', 14), kt('Exporter', 'Export')))),
    h('div', { className: 'kbmt-stage' }, h('canvas', { ref: player.canvasRef, 'data-kb': 'motion-canvas', 'aria-label': kt('Aperçu de l\'animation', 'Animation preview'), onClick: () => player.play() })),
    h(Transport, { scene, player }),
    h(Timeline, { scene, player }),
    h('div', { className: 'kbmt-params' },
      h('h3', null, kt('Paramètres', 'Settings')),
      controls.length === 0 ? h('p', { className: 'kbmt-hint' }, kt('Cette animation n\'a pas de réglages : demande à l\'agent de la modifier.', 'This animation has no settings: ask the agent to change it.')) : controls.map((c) => h(Field, { key: c.id, ctl: c, value: scene.params[c.id], onChange: (v, kind, shown) => setParam(c, v, kind, shown) })),
      doc.errors && doc.errors.length ? h('p', { className: 'kbmt-note' }, (doc.errors.length === 1 ? kt('1 élément ignoré par le moteur.', '1 item ignored by the engine.') : kt(doc.errors.length + ' éléments ignorés par le moteur.', doc.errors.length + ' items ignored by the engine.'))) : null),
    pop === 'revs' ? h('div', { className: 'kbmt-pop', role: 'menu' }, h('h3', null, kt('Révisions', 'Revisions')),
      revs.length === 0 ? h('p', { className: 'kbmt-hint', style: { padding: '4px 8px' } }, kt('Aucune révision conservée.', 'No revision kept.')) : revs.map((v, i) => h('div', { className: 'kbmt-rv', key: v.r },
        h('span', { className: 'kbmt-r' }, 'r' + v.r), h('span', { className: 'kbmt-w' }, (v.by === 'user' ? kt('Toi', 'You') : v.by === 'agent' ? kt('Agent', 'Agent') : v.by) + ' · ' + v.what, h('small', null, v.at ? new Date(v.at).toLocaleString() : '')),
        i === 0 ? h('span', { className: 'kbmt-cur' }, kt('actuelle', 'current')) : h('button', { type: 'button', 'data-act': 'restore', onClick: async () => { const r = await api('POST', 'restore', { path: doc.path, rev: v.r }); setPop(null); if (r.ok) { await load(doc.path); say(kt('Révision r' + v.r + ' restaurée', 'Revision r' + v.r + ' restored')) } else say(r.json.message) } }, kt('Restaurer', 'Restore'))))) : null,
    pop === 'list' ? ListPop({ list, onPick: async (p) => { await api('POST', 'open', { path: p }); setPop(null); await load(p) } }) : null,
    modal ? h(ExportModal, { doc, player, onClose: () => setModal(false), onToast: say }) : null,
    toast ? h('div', { className: 'kbmt-toast', role: 'status' }, toast) : null)
}

function ListPop ({ list, onPick }) {
  return h('div', { className: 'kbmt-pop', role: 'menu', 'data-kb': 'motion-list' }, h('h3', null, kt('Mes animations', 'My animations')),
    list.length === 0 ? h('p', { className: 'kbmt-hint', style: { padding: '4px 8px' } }, kt('Aucune animation dans ce projet.', 'No animation in this project.')) : list.map((s) => h('button', { type: 'button', className: 'kbmt-li', key: s.path, onClick: () => onPick(s.path) }, h('b', null, s.title), h('small', null, s.path.split('/').slice(-2).join('/') + ' · r' + s.rev))))
}

/* ══════════════════════ styles ══════════════════════ */

const CSS = `
.kbmt-root{--k-l1:var(--dsw-alias-bg-layer-1,#fff);--k-l2:var(--dsw-alias-bg-layer-2,#f5f6f7);--k-l3:var(--dsw-alias-bg-layer-3,#ebeef2);
  --k-line:var(--dsw-alias-border-l1,rgba(0,0,0,.07));--k-line2:var(--dsw-alias-border-l2,rgba(0,0,0,.12));--k-line3:var(--dsw-alias-border-l4,rgba(0,0,0,.22));
  --k-t1:var(--dsw-alias-label-primary,#0f1115);--k-t2:var(--dsw-alias-label-secondary,#61666b);--k-t3:var(--dsw-alias-label-tertiary,#81858c);
  --k-acc:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);--k-acc-soft:color-mix(in srgb,var(--k-acc) 18%,transparent);
  --k-pri:var(--dsw-alias-brand-primary,#0f1115);--k-pri-ink:var(--dsw-alias-label-primary-foreground,#fff);
  color:var(--k-t1);font:12.5px/1.45 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)}
.kbmt-root *{box-sizing:border-box}
:where(.kbmt-root) button{font:inherit;color:inherit;cursor:pointer}
.kbmt-root :focus-visible{outline:2px solid var(--k-acc);outline-offset:2px}
.kbmt-ic{flex:none;display:block}
.kbmt-panel{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--k-l1);overflow:hidden}
.kbmt-solo{display:flex;flex-direction:column;gap:6px;padding:8px;background:var(--k-l1)}
.kbmt-compact{display:block;background:#000}.kbmt-compact .kbmt-stage{margin:0;border-radius:0}
.kbmt-bad{padding:12px;color:var(--k-t2)}
.kbmt-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px 9px;border-bottom:1px solid var(--k-line)}
.kbmt-title{min-width:0;display:flex;flex-direction:column;gap:1px}
.kbmt-title strong{font-size:13px;font-weight:620;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbmt-status{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;padding:0;color:var(--k-t3);font-size:11.5px;text-align:left}
.kbmt-status:hover{color:var(--k-t1)}
.kbmt-actions{display:flex;gap:6px;flex:none}
.kbmt-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--k-line2);border-radius:7px;background:var(--k-l1);white-space:nowrap}
.kbmt-btn:hover{background:var(--k-l2)}
.kbmt-btn.pri{background:var(--k-pri);border-color:var(--k-pri);color:var(--k-pri-ink)}
.kbmt-btn.pri:hover{opacity:.9}
.kbmt-ibtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:var(--k-t2)}
.kbmt-ibtn:hover{background:var(--k-l3);color:var(--k-t1)}
.kbmt-stage{flex:none;margin:12px 12px 0;border-radius:8px;overflow:hidden;background:#000;box-shadow:0 0 0 1px var(--k-line2)}
.kbmt-solo .kbmt-stage{margin:0}
.kbmt-stage canvas{display:block;width:100%;height:auto;cursor:pointer}
.kbmt-transport{flex:none;display:flex;align-items:center;gap:10px;padding:9px 12px 8px}
.kbmt-solo .kbmt-transport{padding:0}
.kbmt-play{width:30px;height:30px;border-radius:50%;border:0;background:var(--k-pri);color:var(--k-pri-ink);display:inline-flex;align-items:center;justify-content:center}
.kbmt-time{font:12px var(--dsw-font-family-code,"SF Mono",Menlo,monospace);font-variant-numeric:tabular-nums;color:var(--k-t2)}
.kbmt-sp{flex:1}
.kbmt-tgl{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;color:var(--k-t3);padding:4px 6px;border-radius:6px}
.kbmt-tgl[aria-pressed="true"]{color:var(--k-acc);background:var(--k-acc-soft)}
.kbmt-scrub input{width:100%}
.kbmt-note,.kbmt-hint{margin:0;color:var(--k-t2);font-size:12px}
.kbmt-err{margin:0;color:#d64545;font-size:12px}
.kbmt-tl{flex:none;margin:0 12px;border:1px solid var(--k-line);border-radius:8px;background:var(--k-l2);display:grid;grid-template-columns:88px minmax(0,1fr);overflow:hidden;max-height:210px;overflow-y:auto}
.kbmt-tl-l{display:flex;flex-direction:column;border-right:1px solid var(--k-line)}
.kbmt-tl-l div{height:22px;padding:0 8px;display:flex;align-items:center;font-size:11px;color:var(--k-t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-top:1px solid var(--k-line)}
.kbmt-tl-l div:first-child{height:20px;border-top:0;padding:0}
.kbmt-tl-a{position:relative;cursor:ew-resize;touch-action:none;outline-offset:-2px}
.kbmt-tl-r{height:20px;position:relative}
.kbmt-tl-r span{position:absolute;top:4px;transform:translateX(-50%);font:10px var(--dsw-font-family-code,monospace);color:var(--k-t3)}
.kbmt-tl-r span:first-child{transform:none;left:4px!important}
.kbmt-tl-r span:last-child{transform:translateX(-100%);margin-left:-4px}
.kbmt-tl-row{height:22px;position:relative;border-top:1px solid var(--k-line)}
.kbmt-bar{position:absolute;top:7px;height:8px;border-radius:4px;background:var(--k-acc-soft);box-shadow:inset 0 0 0 1px var(--k-acc)}
.kbmt-kf{position:absolute;top:7px;width:8px;height:8px;margin-left:-4px;transform:rotate(45deg);background:var(--k-acc);border-radius:1.5px}
.kbmt-ph{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--k-t1);pointer-events:none}
.kbmt-ph::before{content:"";position:absolute;top:0;left:-4px;width:10px;height:7px;background:var(--k-t1);clip-path:polygon(0 0,100% 0,50% 100%)}
.kbmt-params{flex:1;min-height:0;overflow:auto;padding:14px 12px;display:grid;gap:13px;align-content:start}
.kbmt-params h3,.kbmt-pop h3{margin:0 0 -4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--k-t3)}
.kbmt-fld{display:grid;gap:5px;min-width:0}
.kbmt-fld label,.kbmt-lbl{font-size:12px;color:var(--k-t2)}
.kbmt-fld input[type="text"],.kbmt-fld input[type="number"]{height:30px;border:1px solid var(--k-line2);border-radius:7px;background:var(--k-l1);color:var(--k-t1);padding:0 9px;width:100%;font:inherit}
.kbmt-rseg{display:flex;gap:2px;padding:2px;background:var(--k-l3);border-radius:8px}
.kbmt-rseg label{flex:1;position:relative;min-width:0}
.kbmt-rseg input{position:absolute;opacity:0;inset:0}
.kbmt-rseg span{display:block;text-align:center;padding:5px 6px;border-radius:6px;color:var(--k-t2);white-space:nowrap}
.kbmt-rseg input:checked + span{background:var(--k-l1);color:var(--k-t1);box-shadow:0 0 0 1px var(--k-line2)}
.kbmt-rseg input:focus-visible + span{outline:2px solid var(--k-acc);outline-offset:1px}
.kbmt-sws{display:flex;gap:10px;flex-wrap:wrap}
.kbmt-sw{position:relative;display:block}
.kbmt-sw input{position:absolute;opacity:0;inset:0;cursor:pointer}
.kbmt-sw span{display:block;width:24px;height:24px;border-radius:50%;border:2px solid var(--k-l1);box-shadow:0 0 0 1px var(--k-line3)}
.kbmt-sw input:checked + span{box-shadow:0 0 0 2px var(--k-t1)}
.kbmt-sw input:focus-visible + span{outline:2px solid var(--k-acc);outline-offset:3px}
.kbmt-sw-custom span{display:flex;align-items:center;justify-content:center;background:var(--k-l3);color:var(--k-t2);font-size:14px;line-height:1}
.kbmt-empty{padding:28px 18px;display:grid;gap:8px;text-align:center;color:var(--k-t2)}
.kbmt-empty b{color:var(--k-t1);font-size:13.5px}.kbmt-empty p{margin:0}
.kbmt-mask{position:absolute;inset:0;z-index:5;background:rgba(15,17,21,.45);display:flex;align-items:center;justify-content:center;padding:12px}
.kbmt-modal{width:100%;max-height:100%;background:var(--k-l1);border:1px solid var(--k-line2);border-radius:12px;box-shadow:0 14px 44px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden}
.kbmt-mh{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 12px 8px 14px}
.kbmt-mh h2{margin:0;font-size:14px;font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbmt-mb{flex:1;min-height:0;overflow:auto;padding:2px 14px 14px}
.kbmt-mf{flex:none;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;padding:10px 14px;border-top:1px solid var(--k-line)}
.kbmt-mf .kbmt-btn{height:30px}
.kbmt-opts{display:grid;gap:8px}
.kbmt-opt{position:relative;display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid var(--k-line2);border-radius:10px;cursor:pointer}
.kbmt-opt input{position:absolute;opacity:0;inset:0;cursor:pointer}
.kbmt-opt:has(input:checked){border-color:var(--k-acc);box-shadow:0 0 0 1px var(--k-acc);background:var(--k-acc-soft)}
.kbmt-opt:has(input:focus-visible){outline:2px solid var(--k-acc);outline-offset:2px}
.kbmt-oi{width:30px;height:30px;border-radius:8px;background:var(--k-l3);display:flex;align-items:center;justify-content:center;color:var(--k-t2);flex:none}
.kbmt-ot{display:grid;gap:1px;min-width:0}.kbmt-ot b{font-size:12.5px;font-weight:620}.kbmt-ot small{font-size:11.5px;color:var(--k-t2)}
.kbmt-sub{margin-top:12px;display:grid;gap:10px}
.kbmt-progress{display:grid;gap:10px;padding:10px 0 4px}
.kbmt-track{height:8px;border-radius:99px;background:var(--k-l3);overflow:hidden}.kbmt-track i{display:block;height:100%;background:var(--k-acc);border-radius:99px}
.kbmt-done{display:grid;gap:6px;justify-items:center;text-align:center;padding:14px 4px 4px}
.kbmt-big{width:40px;height:40px;border-radius:50%;background:color-mix(in srgb,#1f8f5f 18%,transparent);color:#1f8f5f;display:flex;align-items:center;justify-content:center}
.kbmt-pop{position:absolute;z-index:4;top:52px;left:12px;width:min(320px,calc(100% - 24px));max-height:60%;overflow:auto;background:var(--k-l1);border:1px solid var(--k-line2);border-radius:10px;box-shadow:0 14px 44px rgba(0,0,0,.3);padding:6px}
.kbmt-pop h3{margin:6px 8px 4px}
.kbmt-rv{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:6px 8px;border-radius:6px}
.kbmt-rv:hover{background:var(--k-l2)}
.kbmt-r{font:11.5px var(--dsw-font-family-code,monospace);color:var(--k-t3)}
.kbmt-w{min-width:0;font-size:12px}.kbmt-w small{display:block;color:var(--k-t3);font-size:11px}
.kbmt-rv button{border:0;background:transparent;color:var(--k-acc);font-size:12px;padding:2px 4px;border-radius:4px}
.kbmt-cur{font-size:11px;color:var(--k-t3)}
.kbmt-li{display:grid;width:100%;text-align:left;border:0;background:transparent;padding:6px 8px;border-radius:6px}
.kbmt-li:hover{background:var(--k-l2)}.kbmt-li small{color:var(--k-t3);font-size:11px}
.kbmt-toast{position:absolute;left:12px;right:12px;bottom:12px;z-index:9;background:var(--k-pri);color:var(--k-pri-ink);padding:8px 12px;border-radius:8px;font-size:12px}
@media (prefers-reduced-motion: reduce){.kbmt-root *{transition:none!important;animation:none!important}}
`

/* ══════════════════════ wiring ══════════════════════ */

/** The door of the Creations page: the "motion" player, and the exporter the Mac app install uses. */
function registerPlayer () {
  try {
    if (window.__KB_MINIAPP__ && typeof window.__KB_MINIAPP__.register === 'function') window.__KB_MINIAPP__.register('motion', MotionPlayer)
    else { window.__KB_MINIAPP_PENDING__ = window.__KB_MINIAPP_PENDING__ || []; window.__KB_MINIAPP_PENDING__.push(['motion', MotionPlayer]) }
    // the miniapps bundle asks for a LIVE page (a frozen canvas would be a still picture)
    window.__KB_MINIAPP_EXPORTERS__ = window.__KB_MINIAPP_EXPORTERS__ || {}
    window.__KB_MINIAPP_EXPORTERS__.motion = async (root) => {
      const path = root && root.getAttribute ? root.querySelector('[data-kb-path]')?.getAttribute('data-kb-path') : null
      if (!path) return null
      const r = await api('GET', 'scene?' + q({ path }))
      if (!r.ok) return null
      const assets = createAssets(path)
      const scene = engine.validate(r.json.scene).scene
      return { titre: r.json.title, html: standaloneHTML({ title: r.json.title, scene, ...(await gatherMedia(assets, scene)) }) }
    }
  } catch (e) { /* the player is optional */ }
}

function apply (ctx) {
  CTX = ctx
  ctx.effect(() => {
    if (document.getElementById(STYLE_ID)) return undefined
    const el = document.createElement('style')
    el.id = STYLE_ID
    el.setAttribute('data-plugin', '@local/kybernos-motion')
    el.textContent = CSS
    document.head.appendChild(el)
    return () => { el.remove() }
  }, 'kybernos-motion: styles')

  let registre = null
  try { registre = ctx.get('sidebarRightTabs') } catch (e) { registre = null }
  if (registre && typeof registre.register === 'function') {
    ctx.effect(() => registre.register({
      id: TYPE_ID,
      kind: KIND,
      title: () => 'Motion',
      guide: [{ title: () => 'Motion', description: () => kt('Animations (titres, graphiques, compteurs, particules, son) créées par le chat : lecture, réglages et export MP4.', 'Animations (titles, charts, counters, particles, sound) made by the chat: playback, settings and MP4 export.') }],
    }), 'kybernos-motion: sidebar tab type')
  }
  ctx.effect(() => ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, key: TYPE_ID }, MotionPanel)), 'kybernos-motion: panel body')

  ctx.effect(() => {
    const t = setInterval(() => {
      try {
        const ui = ctx.get('uiSession')
        const key = ui && ui.adapter && ui.adapter.current ? ui.adapter.current.getSnapshot().key : ''
        if (typeof key === 'string' && key.length > 0) SESSION_ID = key
      } catch (e) { /* keep the last known key */ }
    }, 4000)
    return () => clearInterval(t)
  }, 'kybernos-motion: session key')

  // open the tab when a scene arrives (the panel cannot do it itself: its own polling only runs once mounted)
  let seen = null
  ctx.effect(() => {
    const probe = async () => {
      let s = null
      try { s = await api('GET', 'state') } catch (e) { return }
      if (!s.ok) return
      LAST_STATE = s.json
      const at = s.json.current ? s.json.current.at : null
      if (at !== null && seen !== at) {
        const first = seen === null
        seen = at
        if (!first || Date.now() - at < 15000) requestOpen()
      }
      if (WANT_OPEN_UNTIL > Date.now()) { if (panelShown()) WANT_OPEN_UNTIL = 0; else openTab() }
    }
    probe()
    const t = setInterval(probe, 1200)
    return () => clearInterval(t)
  }, 'kybernos-motion: open-on-arrival probe')

  registerPlayer()
  try { window.__KB_MOTION__ = { open: async (path) => { await api('POST', 'open', { path }); requestOpen() } } } catch (e) { /* no window */ }
}

return {
  // `sidebarRightTabs` must be declared: ui-sidebar-right provides it, and without this `apply` could run before.
  inject: ['slots', 'sidebarRightTabs'],
  apply,
  __test: { parseDoc, controlsOf, standaloneHTML, fmtT, fmtBytes, slugOf, q, PALETTE },
}
