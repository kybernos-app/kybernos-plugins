// Motion renderers for what 2D primitives cannot express: a 3D scene (three.js) and a Lottie animation (lottie-web).
//
//   createExternal(deps) -> { scene3d(ctx, op), lottie(ctx, op), dispose() }
//
// `paint()` (render2d.mjs) hands them the ops `evaluate()` produced; they draw into their own off-screen canvas and
// `drawImage` it onto the frame, inside the op's transform. Everything they draw is a pure function of the op: a 3D
// object's pose, the camera, the clip time of a model and the time into a Lottie are all resolved by the engine, so a
// frame is the same whether it is previewed, exported or asked for by the agent.
//
// deps: { three: () => THREE | null, lottie: () => lottie | null,
//         lotties: Map(src -> parsed Lottie JSON), models: Map(src -> loaded glTF), createCanvas: () => canvas }
// The libraries are looked up on every call (they load lazily, only for scenes that need them); until they are there a
// layer simply draws nothing and the player repaints when they arrive.
//
// Keep this file free of `import`: scripts/build.mjs pastes it into the browser bundle.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const RAD = Math.PI / 180

/** How many device pixels one scene unit covers under the context's current transform. */
function scaleOf (ctx) {
  try {
    const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null
    return m ? Math.max(0.05, Math.hypot(m.a, m.b)) : 1
  } catch (e) { return 1 }
}

/**
 * A copy of a Lottie file that cannot reach the network: image assets that are not embedded are blanked and every font is
 * marked "no external source" (Lottie can load fonts from a URL, from Google Fonts or from Typekit). A data file must not make
 * the browser fetch anything.
 */
export function sanitizeLottie (data) {
  const copy = JSON.parse(JSON.stringify(data))
  const walk = (assets) => {
    if (!Array.isArray(assets)) return
    for (const a of assets) if (a && typeof a.p === 'string' && a.p !== '' && !/^data:/i.test(a.p)) { a.p = ''; a.u = '' }
  }
  walk(copy.assets)
  if (copy.fonts && Array.isArray(copy.fonts.list)) for (const f of copy.fonts.list) if (f) { f.fPath = ''; f.fOrigin = 'n' }
  return copy
}

/** A glTF loader that only reads what is inside the file (data: and blob: URLs): a model must not make the browser fetch anything. */
export function createModelLoader (THREE) {
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => (/^(data|blob):/i.test(url) ? url : 'data:image/gif;base64,R0lGODlhAQABAAAAACw='))
  return new THREE.GLTFLoader(manager)
}

export function createExternal (deps) {
  const scenes = new Map() // layer name -> 3D state
  const lotties = new Map() // layer name + src -> Lottie state

  // ── 3D ────────────────────────────────────────────────────────────────────

  function makeGeometry (THREE, shape) {
    switch (shape) {
      case 'sphere': return new THREE.SphereGeometry(0.5, 48, 32)
      case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 48)
      case 'cone': return new THREE.ConeGeometry(0.5, 1, 48)
      case 'torus': return new THREE.TorusGeometry(0.5, 0.18, 24, 64)
      case 'plane': return new THREE.PlaneGeometry(1, 1)
      case 'ring': return new THREE.RingGeometry(0.3, 0.5, 48)
      case 'knot': return new THREE.TorusKnotGeometry(0.4, 0.12, 128, 16)
      case 'capsule': return new THREE.CapsuleGeometry(0.25, 0.5, 8, 24)
      default: return new THREE.BoxGeometry(1, 1, 1)
    }
  }

  function disposeEntry (st, entry) {
    if (!entry) return
    try { st.scene.remove(entry.node) } catch (e) { /* already out */ }
    try { if (entry.geometry) entry.geometry.dispose() } catch (e) { /* nothing to free */ }
    try { if (entry.material) entry.material.dispose() } catch (e) { /* nothing to free */ }
  }

  function makeState (THREE) {
    const canvas = deps.createCanvas()
    let renderer = null
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }) } catch (e) { return { failed: true } }
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000)
    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    scene.add(ambient)
    scene.add(sun)
    return { canvas, renderer, scene, camera, ambient, sun, objs: new Map(), pw: 0, ph: 0, failed: false }
  }

  /** Make the object exist (or keep it): a shape, or a model cloned from the loaded glTF. Null while a model is not loaded yet. */
  function ensureObject (THREE, st, o) {
    const key = o.shape + '|' + (o.shape === 'model' ? o.src : '')
    let entry = st.objs.get(o.id)
    if (entry && entry.key === key) return entry
    if (entry) { disposeEntry(st, entry); st.objs.delete(o.id) }
    if (o.shape === 'model') {
      const gltf = deps.models.get(o.src)
      if (!gltf || !gltf.scene) return null
      const node = THREE.SkeletonUtils && typeof THREE.SkeletonUtils.clone === 'function' ? THREE.SkeletonUtils.clone(gltf.scene) : gltf.scene.clone(true)
      let mixer = null
      let action = null
      const clips = Array.isArray(gltf.animations) ? gltf.animations : []
      const clip = o.clip !== '' ? clips.find((c) => c.name === o.clip) : null
      if (clip) {
        mixer = new THREE.AnimationMixer(node)
        action = mixer.clipAction(clip)
        action.play()
      }
      entry = { key, node, mixer, action, geometry: null, material: null, model: true }
    } else {
      const geometry = makeGeometry(THREE, o.shape)
      const material = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide })
      entry = { key, node: new THREE.Mesh(geometry, material), geometry, material, mixer: null, action: null, model: false }
    }
    st.scene.add(entry.node)
    st.objs.set(o.id, entry)
    return entry
  }

  function applyObject (THREE, entry, o) {
    const n = entry.node
    n.position.set(o.pos[0], o.pos[1], o.pos[2])
    n.rotation.set(o.rot[0] * RAD, o.rot[1] * RAD, o.rot[2] * RAD)
    n.scale.set(o.scale[0], o.scale[1], o.scale[2])
    if (entry.model) {
      if (entry.mixer && entry.action) {
        entry.action.loop = o.loop ? THREE.LoopRepeat : THREE.LoopOnce
        entry.action.clampWhenFinished = true
        entry.mixer.setTime(o.clipTime)
      }
      if (o.opacity < 1 && typeof n.traverse === 'function') {
        n.traverse((c) => { if (c.material) { c.material.transparent = true; c.material.opacity = o.opacity } })
      }
      return
    }
    const m = entry.material
    m.color.set(o.color)
    m.metalness = o.metal
    m.roughness = o.rough
    m.opacity = o.opacity
    m.transparent = o.opacity < 1
    m.wireframe = o.wire === true
  }

  function scene3d (ctx, op) {
    const THREE = deps.three()
    if (!THREE) return
    let st = scenes.get(op.layer)
    if (!st) { st = makeState(THREE); scenes.set(op.layer, st) }
    if (st.failed) return
    const k = scaleOf(ctx)
    const pw = clamp(Math.round(op.w * k), 16, 2048)
    const ph = clamp(Math.round(op.h * k), 16, 2048)
    if (st.pw !== pw || st.ph !== ph) { st.renderer.setSize(pw, ph, false); st.pw = pw; st.ph = ph }
    const cam = st.camera
    cam.aspect = op.w / op.h
    cam.fov = op.camera.fov
    cam.position.set(op.camera.pos[0], op.camera.pos[1], op.camera.pos[2])
    cam.lookAt(op.camera.look[0], op.camera.look[1], op.camera.look[2])
    cam.updateProjectionMatrix()
    st.ambient.intensity = op.light.ambient
    st.sun.intensity = op.light.sun
    st.sun.position.set(op.light.pos[0], op.light.pos[1], op.light.pos[2])
    if (op.bg) { st.scene.background = new THREE.Color(op.bg); st.renderer.setClearColor(0x000000, 1) } else { st.scene.background = null; st.renderer.setClearColor(0x000000, 0) }
    const seen = new Set()
    for (const o of op.objects) {
      const entry = ensureObject(THREE, st, o)
      if (entry === null) continue
      seen.add(o.id)
      applyObject(THREE, entry, o)
    }
    for (const [id, entry] of st.objs) if (!seen.has(id)) { disposeEntry(st, entry); st.objs.delete(id) }
    st.renderer.render(st.scene, cam)
    ctx.drawImage(st.canvas, op.x, op.y, op.w, op.h)
  }

  // ── Lottie ────────────────────────────────────────────────────────────────

  function lottie (ctx, op) {
    const lib = deps.lottie()
    const data = deps.lotties.get(op.src)
    if (!lib || !data) return
    const k = scaleOf(ctx)
    const pw = clamp(Math.round(op.w * k), 16, 2048)
    const ph = clamp(Math.round(op.h * k), 16, 2048)
    const key = op.layer + '|' + op.src
    let st = lotties.get(key)
    if (!st) {
      const canvas = deps.createCanvas()
      canvas.width = pw
      canvas.height = ph
      const anim = lib.loadAnimation({
        renderer: 'canvas', loop: false, autoplay: false,
        animationData: sanitizeLottie(data),
        rendererSettings: { context: canvas.getContext('2d'), clearCanvas: true, preserveAspectRatio: 'xMidYMid meet' },
      })
      st = { canvas, anim, pw, ph }
      lotties.set(key, st)
    } else if (st.pw !== pw || st.ph !== ph) {
      st.canvas.width = pw
      st.canvas.height = ph
      st.pw = pw
      st.ph = ph
      try { st.anim.resize() } catch (e) { /* the next frame will show it */ }
    }
    const fps = Number(data.fr) > 0 ? Number(data.fr) : 30
    const total = Math.max(1, (Number(data.op) || 0) - (Number(data.ip) || 0))
    let f = op.time * fps
    f = op.loop ? ((f % total) + total) % total : Math.min(Math.max(0, f), total - 0.01)
    try { st.anim.goToAndStop(f, true) } catch (e) { return }
    ctx.drawImage(st.canvas, op.x, op.y, op.w, op.h)
  }

  function dispose () {
    for (const st of scenes.values()) {
      if (st.failed) continue
      for (const entry of st.objs.values()) disposeEntry(st, entry)
      try { st.renderer.dispose(); if (typeof st.renderer.forceContextLoss === 'function') st.renderer.forceContextLoss() } catch (e) { /* gone */ }
    }
    scenes.clear()
    for (const st of lotties.values()) { try { st.anim.destroy() } catch (e) { /* gone */ } }
    lotties.clear()
  }

  return { scene3d, lottie, dispose }
}
