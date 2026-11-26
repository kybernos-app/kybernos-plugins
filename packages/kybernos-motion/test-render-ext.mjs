// 3D and Lottie renderers against fake libraries. `cd packages/kybernos-motion && node test-render-ext.mjs`
// What is checked here is OUR logic (what is created, updated, removed, with which numbers). Real pixels, in a real
// browser with real three.js and lottie-web, are in scripts/check-motion-live.mjs.
import * as E from './engine.mjs'
import { paint } from './render2d.mjs'
import { createExternal, sanitizeLottie, createModelLoader } from './render-ext.mjs'

let fail = 0
let n = 0
const ok = (name, cond, detail) => {
  n++
  if (cond) return
  fail++
  console.log(`FAIL ${name}${detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`)
}

// ── fakes ───────────────────────────────────────────────────────────────────
const V = class { set (...a) { this.v = a; return this } }
function fakeThree (log, opts = {}) {
  class Obj { constructor () { this.position = new V(); this.rotation = new V(); this.scale = new V() } }
  const geo = (name) => class { constructor (...a) { this.kind = name; this.args = a } dispose () { log.push(['gdispose', name]) } }
  return {
    WebGLRenderer: class {
      constructor (o) { if (opts.noWebGL) throw new Error('no webgl'); log.push(['renderer', Object.keys(o).sort().join()]); this.domElement = o.canvas }
      setSize (w, h) { log.push(['setSize', w, h]) }
      setClearColor (c, a) { this.clear = [c, a]; log.push(['clear', c, a]) }
      render (s) { log.push(['render', s.children.length]) }
      dispose () { log.push(['rdispose']) }
      forceContextLoss () { log.push(['loss']) }
    },
    Scene: class { constructor () { this.children = []; this.background = null } add (o) { this.children.push(o) } remove (o) { this.children = this.children.filter((x) => x !== o) } },
    PerspectiveCamera: class { constructor () { this.position = new V() } lookAt (...a) { this.look = a } updateProjectionMatrix () { this.updated = true } },
    AmbientLight: class { constructor () { this.intensity = 0 } },
    DirectionalLight: class { constructor () { this.intensity = 0; this.position = new V() } },
    Mesh: class extends Obj { constructor (g, m) { super(); this.geometry = g; this.material = m } },
    MeshStandardMaterial: class { constructor () { this.color = { set: (c) => { this.c = c } } } dispose () { log.push(['mdispose']) } },
    BoxGeometry: geo('box'), SphereGeometry: geo('sphere'), CylinderGeometry: geo('cylinder'), ConeGeometry: geo('cone'), TorusGeometry: geo('torus'),
    PlaneGeometry: geo('plane'), RingGeometry: geo('ring'), TorusKnotGeometry: geo('knot'), CapsuleGeometry: geo('capsule'),
    Color: class { constructor (c) { this.c = c } },
    AnimationMixer: class {
      constructor (node) { this.node = node }
      clipAction (clip) { this.action = { clip, played: false, play () { this.played = true } }; return this.action }
      setTime (t) { this.time = t }
    },
    LoopRepeat: 2201, LoopOnce: 2200, SRGBColorSpace: 'srgb', DoubleSide: 2,
    SkeletonUtils: { clone: (node) => { const c = new Obj(); c.clonedFrom = node; c.traverse = () => {}; return c } },
  }
}
const canvasMaker = () => () => { const c = { width: 0, height: 0, getContext: () => ({}) }; return c }
const ctxFake = (scale = 1) => { const calls = []; return { calls, getTransform: () => ({ a: scale, b: 0 }), drawImage: (...a) => calls.push(a) } }

function opOf (scene, t = 0) { return E.evaluate(scene, t).ops[0] }
const SC = (objects, extra) => ({ layers: [{ type: 'scene3d', name: 'S', x: 500, y: 400, w: 400, h: 300, objects, ...extra }] })

// ── 3D ──────────────────────────────────────────────────────────────────────
{
  const log = []
  const three = fakeThree(log)
  const models = new Map()
  const ext = createExternal({ three: () => null, lottie: () => null, lotties: new Map(), models, createCanvas: canvasMaker() })
  const ctx0 = ctxFake()
  ext.scene3d(ctx0, opOf(SC([{ shape: 'box' }])))
  ok('3D: without the library the layer draws nothing and does not throw', ctx0.calls.length === 0)

  const e2 = createExternal({ three: () => three, lottie: () => null, lotties: new Map(), models, createCanvas: canvasMaker() })
  const ctx = ctxFake(2)
  const op = opOf(SC([{ shape: 'sphere', x: 1, y: 2, z: 3, rx: 90, ry: 180, rz: 45, s: 2, w: 1, h: 0.5, d: 1, color: '#ff0000', metal: 0.7, rough: 0.2, opacity: 0.5, wire: true }, { shape: 'cone' }], { bg: '#102030', fov: 55 }))
  e2.scene3d(ctx, op)
  ok('3D: one renderer is made, asking for a transparent, antialiased canvas it can be read back from', log.filter((l) => l[0] === 'renderer').length === 1 && log.find((l) => l[0] === 'renderer')[1] === 'alpha,antialias,canvas,preserveDrawingBuffer', log)
  ok('3D: the drawing buffer follows the on-screen size (400x300 at scale 2)', log.some((l) => l[0] === 'setSize' && l[1] === 800 && l[2] === 600))
  ok('3D: the frame is drawn onto the 2D canvas inside the op\'s box', ctx.calls.length === 1 && ctx.calls[0][1] === op.x && ctx.calls[0][2] === op.y && ctx.calls[0][3] === 400 && ctx.calls[0][4] === 300, ctx.calls[0] && ctx.calls[0].slice(1))
  const st = [...log].filter((l) => l[0] === 'render')
  ok('3D: it rendered once with two lights and two objects in the scene', st.length === 1 && st[0][1] === 4, st)
  e2.scene3d(ctx, op)
  ok('3D: a second frame reuses the renderer and the size', log.filter((l) => l[0] === 'renderer').length === 1 && log.filter((l) => l[0] === 'setSize').length === 1 && log.filter((l) => l[0] === 'render').length === 2)

  // dig into the state through a fresh run with a probe scene
  const log2 = []
  const three2 = fakeThree(log2)
  let sceneRef = null
  const origScene = three2.Scene
  three2.Scene = class extends origScene { constructor () { super(); sceneRef = this } }
  let cameraRef = null
  const origCam = three2.PerspectiveCamera
  three2.PerspectiveCamera = class extends origCam { constructor () { super(); cameraRef = this } }
  const e3 = createExternal({ three: () => three2, lottie: () => null, lotties: new Map(), models, createCanvas: canvasMaker() })
  e3.scene3d(ctxFake(), op)
  const sphere = sceneRef.children.find((c) => c.geometry && c.geometry.kind === 'sphere')
  const cone = sceneRef.children.find((c) => c.geometry && c.geometry.kind === 'cone')
  ok('3D: each shape gets its geometry', sphere && cone)
  ok('3D: position is applied as given', JSON.stringify(sphere.position.v) === '[1,2,3]')
  ok('3D: rotation goes from degrees to radians', Math.abs(sphere.rotation.v[0] - Math.PI / 2) < 1e-9 && Math.abs(sphere.rotation.v[1] - Math.PI) < 1e-9 && Math.abs(sphere.rotation.v[2] - Math.PI / 4) < 1e-9)
  ok('3D: scale is s times w,h,d', JSON.stringify(sphere.scale.v) === '[2,1,2]')
  ok('3D: material: colour, metalness, roughness, opacity (transparent below 1), wireframe', sphere.material.c === '#ff0000' && sphere.material.metalness === 0.7 && sphere.material.roughness === 0.2 && sphere.material.opacity === 0.5 && sphere.material.transparent === true && sphere.material.wireframe === true)
  ok('3D: an opaque object is not transparent', cone.material.transparent === false && cone.material.wireframe === false)
  ok('3D: the camera looks where the op says, with its field of view', JSON.stringify(cameraRef.look) === JSON.stringify(op.camera.look) && cameraRef.fov === 55 && cameraRef.aspect === 400 / 300 && cameraRef.updated === true)
  ok('3D: a background colour is an opaque clear', sceneRef.background && sceneRef.background.c === '#102030' && log2.some((l) => l[0] === 'clear' && l[2] === 1))
  const noBg = opOf(SC([{ shape: 'box' }]))
  e3.scene3d(ctxFake(), noBg)
  ok('3D: no background means a transparent clear', sceneRef.background === null && log2.filter((l) => l[0] === 'clear').pop()[2] === 0)
  ok('3D: an object that disappears from the op is removed and freed', sceneRef.children.length === 3 && log2.some((l) => l[0] === 'mdispose') && log2.some((l) => l[0] === 'gdispose'), sceneRef.children.length)
  e3.dispose()
  ok('3D: dispose frees the renderer and the context', log2.some((l) => l[0] === 'rdispose') && log2.some((l) => l[0] === 'loss'))
}
{
  const log = []
  const e = createExternal({ three: () => fakeThree(log, { noWebGL: true }), lottie: () => null, lotties: new Map(), models: new Map(), createCanvas: canvasMaker() })
  const ctx = ctxFake()
  let threw = null
  try { e.scene3d(ctx, opOf(SC([{ shape: 'box' }]))); e.scene3d(ctx, opOf(SC([{ shape: 'box' }]))) } catch (x) { threw = x }
  ok('3D: a browser without WebGL does not break the frame, nor retry on every frame', threw === null && ctx.calls.length === 0)
}
{
  // models
  const log = []
  const three = fakeThree(log)
  let sceneRef = null
  const S0 = three.Scene
  three.Scene = class extends S0 { constructor () { super(); sceneRef = this } }
  const models = new Map()
  const e = createExternal({ three: () => three, lottie: () => null, lotties: new Map(), models, createCanvas: canvasMaker() })
  const mk = (clip, t, loop = true) => opOf(SC([{ shape: 'model', src: 'hero.glb', clip, clipT0: 1, speed: 2, loop, x: 1 }]), t)
  e.scene3d(ctxFake(), mk('Run', 2))
  ok('model: not loaded yet means nothing is added (and no throw)', sceneRef.children.length === 2)
  const walk = { name: 'Walk' }; const run = { name: 'Run' }
  const root = { id: 'root' }
  models.set('hero.glb', { scene: root, animations: [walk, run] })
  e.scene3d(ctxFake(), mk('Run', 3))
  const node = sceneRef.children[2]
  ok('model: once loaded it is cloned (skeleton-safe) into the scene', sceneRef.children.length === 3 && node.clonedFrom === root)
  ok('model: its pose follows the op', JSON.stringify(node.position.v) === '[1,0,0]')
  // the mixer lives on our entry, not on the node: reach it through the AnimationMixer fake
  let mixer = null
  const M0 = three.AnimationMixer
  three.AnimationMixer = class extends M0 { constructor (nd) { super(nd); mixer = this } }
  e.dispose()
  const e2 = createExternal({ three: () => three, lottie: () => null, lotties: new Map(), models, createCanvas: canvasMaker() })
  e2.scene3d(ctxFake(), mk('Run', 3))
  ok('model: the clip is found by name and played', mixer && mixer.action.clip === run && mixer.action.played === true)
  ok('model: the mixer is set to the clip time (deterministic, no clock)', mixer.time === 4, mixer.time)
  ok('model: loop true repeats, false plays once and holds the last pose', mixer.action.loop === 2201 && (e2.scene3d(ctxFake(), mk('Run', 3, false)), mixer.action.loop === 2200 && mixer.action.clampWhenFinished === true))
  mixer = null
  const e3 = createExternal({ three: () => three, lottie: () => null, lotties: new Map(), models, createCanvas: canvasMaker() })
  e3.scene3d(ctxFake(), mk('Nope', 3))
  ok('model: an unknown clip name animates nothing (the static pose shows)', mixer === null)
  e3.scene3d(ctxFake(), mk('', 3))
  ok('model: no clip name animates nothing either', mixer === null)
}

// ── Lottie ──────────────────────────────────────────────────────────────────
{
  const made = []
  const lib = { loadAnimation: (o) => { const a = { opts: o, frames: [], resized: 0, destroyed: false, goToAndStop (f, isFrame) { this.frames.push([f, isFrame]) }, resize () { this.resized++ }, destroy () { this.destroyed = true } }; made.push(a); return a } }
  const data = { fr: 30, ip: 0, op: 60, w: 100, h: 100, layers: [] }
  const lotties = new Map([['hero.json', data]])
  const e = createExternal({ three: () => null, lottie: () => lib, lotties, models: new Map(), createCanvas: canvasMaker() })
  const sc = (t0, speed, loop) => ({ layers: [{ type: 'lottie', name: 'L', src: 'hero.json', x: 300, y: 300, w: 200, h: 100, t0, speed, loop }] })
  const draw = (scene, t, scale = 1) => { const c = ctxFake(scale); const op = E.evaluate(scene, t).ops[0]; if (op) e.lottie(c, op); return c }
  const none = createExternal({ three: () => null, lottie: () => null, lotties, models: new Map(), createCanvas: canvasMaker() })
  const c0 = ctxFake(); none.lottie(c0, E.evaluate(sc(0, 1, true), 0).ops[0])
  ok('lottie: without the library nothing is drawn', c0.calls.length === 0)
  const missing = createExternal({ three: () => null, lottie: () => lib, lotties: new Map(), models: new Map(), createCanvas: canvasMaker() })
  const c1 = ctxFake(); missing.lottie(c1, E.evaluate(sc(0, 1, true), 0).ops[0])
  ok('lottie: a file that is not loaded yet draws nothing', c1.calls.length === 0 && made.length === 0)
  const c = draw(sc(0, 1, true), 1)
  ok('lottie: one animation is made with the canvas renderer, no autoplay, its own context', made.length === 1 && made[0].opts.renderer === 'canvas' && made[0].opts.autoplay === false && made[0].opts.loop === false && typeof made[0].opts.rendererSettings.context === 'object')
  ok('lottie: it gets a COPY of the data (lottie-web changes what it is given)', made[0].opts.animationData !== data && JSON.stringify(made[0].opts.animationData) === JSON.stringify(data))
  ok('lottie: one second at 30 fps is frame 30, set by frame (not by clock)', JSON.stringify(made[0].frames[0]) === '[30,true]', made[0].frames)
  ok('lottie: the frame is drawn into the op\'s box', c.calls.length === 1 && c.calls[0][3] === 200 && c.calls[0][4] === 100)
  draw(sc(0, 1, true), 3)
  ok('lottie: looping wraps around the length (90 frames in a 60-frame file is frame 30)', made[0].frames[1][0] === 30, made[0].frames)
  draw(sc(0, 1, false), 3)
  ok('lottie: not looping holds the last frame', made[0].frames[2][0] === 59.99, made[0].frames)
  draw(sc(1, 2, true), 1.5)
  ok('lottie: t0 and speed: (1.5 - 1) x 2 s at 30 fps is frame 30', made[0].frames[3][0] === 30, made[0].frames)
  ok('lottie: the animation is reused from frame to frame', made.length === 1)
  draw(sc(0, 1, true), 1, 2)
  ok('lottie: a size change resizes the canvas and the animation', made[0].resized === 1 && made[0].opts.rendererSettings.context !== undefined)
  e.dispose()
  ok('lottie: dispose destroys the animations', made[0].destroyed === true)
}

// ── no network from a data file ─────────────────────────────────────────────
{
  const data = { fr: 30, op: 60, layers: [], assets: [{ id: 'a', p: 'https://tracker.example/x.png', u: 'https://tracker.example/' }, { id: 'b', p: 'data:image/png;base64,AAAA', u: '' }, { id: 'c', layers: [] }], fonts: { list: [{ fFamily: 'Evil', fPath: 'https://evil.example/f.css', fOrigin: 'u' }, { fFamily: 'G', fPath: 'https://fonts.googleapis.com/css?family=G', fOrigin: 'g' }] } }
  const snapshot = JSON.stringify(data)
  const c = sanitizeLottie(data)
  ok('sanitizeLottie: an image that is not embedded is blanked', c.assets[0].p === '' && c.assets[0].u === '')
  ok('sanitizeLottie: an embedded image is kept, and precomp assets are untouched', c.assets[1].p.startsWith('data:image/png') && Array.isArray(c.assets[2].layers))
  ok('sanitizeLottie: no font can come from a URL, from Google or from Typekit', c.fonts.list.every((f) => f.fPath === '' && f.fOrigin === 'n'))
  ok('sanitizeLottie: the original is left alone (a copy is returned)', JSON.stringify(data) === snapshot && c !== data)
  ok('sanitizeLottie: a file with no assets or fonts is fine', sanitizeLottie({ fr: 30, op: 1, layers: [] }).layers.length === 0)

  const seen = []
  const THREE = { LoadingManager: class { setURLModifier (f) { this.mod = f } }, GLTFLoader: class { constructor (m) { this.manager = m } } }
  const loader = createModelLoader(THREE)
  const mod = loader.manager.mod
  ok('createModelLoader: the loader gets a manager that vets every URL', typeof mod === 'function' && loader instanceof THREE.GLTFLoader)
  ok('createModelLoader: data: and blob: URLs (inside the file) pass', mod('data:image/png;base64,AAAA') === 'data:image/png;base64,AAAA' && mod('blob:http://x/1') === 'blob:http://x/1')
  ok('createModelLoader: anything else (http, https, a relative path) becomes a blank pixel, never a request', mod('https://tracker.example/t.png').startsWith('data:image/gif') && mod('http://x/y').startsWith('data:image/gif') && mod('textures/a.png').startsWith('data:image/gif') && mod('//evil.example/a').startsWith('data:image/gif'))
  void seen

  const made = []
  const lib = { loadAnimation: (o) => { made.push(o); return { goToAndStop () {}, resize () {}, destroy () {} } } }
  const e = createExternal({ three: () => null, lottie: () => lib, lotties: new Map([['x.json', data]]), models: new Map(), createCanvas: canvasMaker() })
  const ctx = ctxFake()
  e.lottie(ctx, E.evaluate({ layers: [{ type: 'lottie', src: 'x.json', name: 'L' }] }, 0).ops[0])
  ok('lottie: the animation is built from the sanitised copy, not from the file as it came', made.length === 1 && made[0].animationData.assets[0].p === '' && made[0].animationData.fonts.list[0].fOrigin === 'n')
}

// ── through paint() ─────────────────────────────────────────────────────────
{
  const calls = []
  const rec = new Proxy({}, { get: (_, k) => (k === 'getTransform' ? () => ({ a: 1, b: 0 }) : (...a) => { calls.push(String(k)) }), set: () => true })
  const frame = E.evaluate({ layers: [{ type: 'rect', w: 10, h: 10 }, { type: 'scene3d', objects: [{ shape: 'box' }] }, { type: 'lottie', src: 'x.json' }, { type: 'circle', r: 5, fill: '#fff' }] }, 0)
  const seen = []
  paint(rec, frame, { external: { scene3d: (c, op) => seen.push(op.op), lottie: () => { throw new Error('one bad layer') } } })
  ok('paint: the 3D and Lottie ops go to the external renderers', seen.join() === 'scene3d')
  ok('paint: a renderer that throws does not stop the layers after it', calls.filter((c) => c === 'arc').length === 1)
  let threw = null
  try { paint(rec, frame, {}) } catch (e) { threw = e }
  ok('paint: with no external renderers those layers are skipped quietly', threw === null)
}

console.log(`${n - fail}/${n} checks passed`)
process.exit(fail ? 1 : 0)
