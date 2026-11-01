// The four-stroke engine example of the 3D shelf. The solids come from the CAD kernel (cad/engine.py, loaded from the
// .glb as env.parts); every number and every movement comes from engine-sim.mjs, whose code the build puts in the same
// page just above this one (simulate, at, geometry, valveLift, PARAMS ...), and from ENGINE_CAD / ENGINE_CHECKS, the
// constants and the results of the checks written by the CAD scripts.
export async function engineExample(env) {
  const { THREE, std, ease, $, ctl, legend, reduced, parts } = env
  const C = ENGINE_CAD, K = ENGINE_CHECKS
  const MM = 0.001, clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), rad = (d) => d * Math.PI / 180
  const NOMINAL_RPM = PARAMS.rpm

  // ── the operating point: two sliders re-run the simulation ─────────────────────────────────────
  const op = { throttle: 1, advance: 30 }
  const params = () => ({ ...PARAMS, spark: 360 - op.advance, manifold: { ...PARAMS.manifold, pIn: (0.30 + 0.65 * op.throttle) * 1e5 } })
  let P = params(), sim = simulate(P), geom = geometry(P)
  const PAXIS = 75, VAXIS = 140                                          // fixed axes: the loop visibly shrinks with the throttle

  // ── solids ─────────────────────────────────────────────────────────────────────────────────────
  const M = {
    alu: std(0xaab0b6, { metalness: 0.85, roughness: 0.5 }), piston: std(0xd3d7dc, { metalness: 1, roughness: 0.28 }),
    steel: std(0x8d9299, { metalness: 1, roughness: 0.34 }), dark: std(0x2f3136, { metalness: 0.8, roughness: 0.45 }),
    iron: std(0x4a4d53, { metalness: 0.9, roughness: 0.4 }), valveIn: std(0x62aee0, { metalness: 0.9, roughness: 0.3 }),
    valveEx: std(0xc4623a, { metalness: 0.9, roughness: 0.35 }), pipeIn: std(0x3f8fc6, { metalness: 0.2, roughness: 0.5 }),
    pipeEx: std(0xb5502d, { metalness: 0.2, roughness: 0.5 }), section: std(0xe6c36d, { metalness: 0, roughness: 0.95 }),
    ceramic: std(0xf1efe8, { metalness: 0, roughness: 0.3 }), spring: std(0xc7cbd0, { metalness: 1, roughness: 0.3 })
  }
  const geo = (name) => { const g = parts.get(name); if (!g) throw new Error('engine part missing: ' + name); return g }
  const solid = (name, mat) => { const m = new THREE.Mesh(geo(name), mat); m.castShadow = !/_cut$/.test(name); m.receiveShadow = true; return m }
  const pivoted = (name, mat, y) => { const m = new THREE.Mesh(geo(name).clone().translate(0, -y, 0), mat); m.castShadow = m.receiveShadow = true; return m }

  const G = new THREE.Group()
  const rig = new THREE.Group(); rig.position.y = 0.055; G.add(rig)           // crankcase bottom sits on the floor
  for (const [n, m] of [['barrel', M.alu], ['barrel_cut', M.section], ['crankcase', M.alu], ['crankcase_cut', M.section], ['head', M.alu], ['head_cut', M.section],
    ['pipe_in', M.pipeIn], ['pipe_in_cut', M.section], ['pipe_ex', M.pipeEx], ['pipe_ex_cut', M.section], ['plug_metal', M.steel], ['plug_ceramic', M.ceramic]]) rig.add(solid(n, m))

  const pistonG = new THREE.Group()
  for (const [n, m] of [['piston', M.piston], ['ring_top', M.dark], ['ring_second', M.dark], ['ring_oil', M.dark], ['pin', M.steel]]) pistonG.add(solid(n, m))
  const rodY = C.PIN0 * MM
  const rodG = new THREE.Group(); rodG.add(pivoted('rod', M.steel, rodY), pivoted('rod_cap', M.steel, rodY))
  const crankG = new THREE.Group(); crankG.add(solid('crank', M.iron), solid('flywheel', M.dark))
  const valve = { in: new THREE.Group(), ex: new THREE.Group() }, spring = {}
  for (const s of ['in', 'ex']) {
    valve[s].add(solid('valve_' + s, s === 'in' ? M.valveIn : M.valveEx), solid('retainer_' + s, M.dark))
    spring[s] = new THREE.Group(); spring[s].position.y = C.SPRING_Z0 * MM
    spring[s].add(pivoted('spring_' + s, M.spring, C.SPRING_Z0 * MM))
  }
  rig.add(pistonG, rodG, crankG, valve.in, valve.ex, spring.in, spring.ex)

  // ── the gas: its volume is the real one, its colour is its temperature ─────────────────────────────
  const gasMat = new THREE.MeshStandardMaterial({ color: 0x2b86c5, transparent: true, opacity: 0.5, roughness: 0.25, depthWrite: false })
  const gasLow = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48), gasMat), gasUp = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48), gasMat)
  gasLow.scale.x = gasLow.scale.z = 0.0276; gasUp.scale.x = gasUp.scale.z = 0.0258
  gasUp.scale.y = (C.ZC - C.DECK) * MM; gasUp.position.y = (C.DECK + C.ZC) / 2 * MM
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.011, 20, 14), new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0 }))
  spark.position.y = (C.ZC - 2.0) * MM
  const flash = new THREE.PointLight(0xffb066, 0, 0.5); flash.position.set(0, (C.ZC - 3) * MM, 0.02)
  const flowMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0 })
  const port = (s) => {                                                      // the port path in metres: out in the pipe, round the elbow, down to the valve
    const x = C.XV[s] * MM, sg = s === 'in' ? -1 : 1, rb = C.PORT_BEND * MM, z1 = (C.ZC + C.PORT_BEND) * MM, pts = [[sg * 0.078, C.PIPE_Z * MM]]
    for (let i = 8; i >= 0; i--) { const t = i / 8 * Math.PI / 2; pts.push([x + sg * rb - sg * rb * Math.cos(t), z1 + rb * Math.sin(t)]) }
    pts.push([x, (C.ZC + 1) * MM], [x, (C.ZC - 4) * MM]); return pts
  }
  const paths = { in: port('in'), ex: port('ex') }
  const alongPath = (pts, u) => {
    const seg = []; let tot = 0
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); tot += l }
    let d = clamp(u) * tot, i = 0; while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++ }
    const f = seg[i] ? d / seg[i] : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]
  }
  const flows = []
  for (const s of ['in', 'ex']) for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 10, 8), flowMat(s === 'in' ? 0x7cc4f2 : 0xd8c9bd)); flows.push({ s, i, m }); rig.add(m) }
  rig.add(gasLow, gasUp, spark, flash)
  for (const o of [gasLow, gasUp, spark, flash, ...flows.map((f) => f.m)]) o.userData.skipExport = true

  // temperature → colour: cool blue, amber, orange, white-yellow
  const STOPS = [[300, [0x2b, 0x86, 0xc5]], [700, [0xd9, 0x9a, 0x1d]], [1500, [0xe2, 0x43, 0x2b]], [2600, [0xff, 0xe9, 0x9c]]]
  const tempRGB = (T) => {
    for (let i = 1; i < STOPS.length; i++) if (T <= STOPS[i][0] || i === STOPS.length - 1) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i], f = clamp((T - t0) / (t1 - t0)); return c0.map((v, k) => v + (c1[k] - v) * f)
    }
  }

  // ── legend and commands ────────────────────────────────────────────────────────────────────────────
  const TM = PARAMS.timing
  const PHASES = [
    { n: 'Intake', c: '#2b86c5', t: `The piston goes down with the intake valve open: fresh air and fuel are drawn in. The valve opened ${Math.round(-TM.ivo)}° before the top, so a little burnt gas of the last cycle is still around.` },
    { n: 'Compression', c: '#d99a1d', t: `The intake valve closes ${Math.round(TM.ivc - 180)}° after the bottom and traps the charge. Then the piston rises and squeezes it to a tenth of its volume: pressure and temperature climb.` },
    { n: 'Power', c: '#e2432b', t: `The spark ignites the mixture just before the top. The burning gas expands and pushes the piston down: the only stroke that gives work. The exhaust valve opens ${Math.round(540 - TM.evo)}° before the bottom.` },
    { n: 'Exhaust', c: '#76787e', t: `The exhaust valve is open and the piston rises, pushing the burnt gas out. At the top the intake valve opens ${Math.round(-TM.ivo)}° early and the exhaust closes ${Math.round(TM.evc - 720)}° late: the two overlap briefly.` }
  ]
  const st = { a: 0, playing: !reduced, speed: 25, loop: null, lastPhase: -1, lastShown: -1, flowPhase: 0 }
  const px = (V) => 10 + (V * 1e6 / VAXIS) * 280, py = (p) => 108 - (p / 1e5 / PAXIS) * 100
  const loopPath = () => { let d = ''; for (let k = 0; k < 1440; k += 3) d += `${k ? 'L' : 'M'}${px(sim.V[k]).toFixed(1)} ${py(sim.p[k]).toFixed(1)}`; return d + 'Z' }
  const bar = () => {
    ctl.innerHTML = `
      <div class="grp"><span class="lab">Stroke</span><div class="seg">${PHASES.map((p, i) => `<button type="button" data-act="phase" data-val="${i}" aria-pressed="${st.loop === i}" title="Jump here. Click again to loop it.">${i + 1} ${p.n}</button>`).join('')}</div></div>
      <div class="grp"><button class="btn" type="button" data-act="play" aria-pressed="${st.playing}">${st.playing ? 'Pause' : 'Play'}</button></div>
      <div class="grp"><label class="lab" for="spd">Speed</label><input id="spd" type="range" min="2" max="100" value="${st.speed}" data-act="speed"><span class="out" id="spdOut"></span></div>
      <div class="grp"><label class="lab" for="thr">Throttle</label><input id="thr" type="range" min="0" max="100" value="${Math.round(op.throttle * 100)}" data-act="throttle"><span class="out" id="thrOut"></span></div>
      <div class="grp"><label class="lab" for="adv">Spark</label><input id="adv" type="range" min="5" max="55" value="${op.advance}" data-act="spark"><span class="out" id="advOut"></span></div>`
    outs()
  }
  const outs = () => {
    const set = (id, t) => { const o = $(id); if (o) o.textContent = t }
    set('#spdOut', `${Math.round(st.speed * 0.6)} rpm · slow-mo`); set('#thrOut', `${(P.manifold.pIn / 1e5).toFixed(2)} bar intake`); set('#advOut', `${op.advance}° before TDC`)
  }
  const results = () => {
    const m = sim.metrics
    return `<dt>Peak pressure</dt><dd>${m.peakPressureBar.toFixed(0)} bar, ${Math.round(m.peakAngle - 360)}° after TDC</dd>
      <dt>Work per cycle</dt><dd>${m.workPerCycleJ.toFixed(0)} J</dd><dt>Mean effective pressure</dt><dd>${m.imepNetBar.toFixed(1)} bar</dd>
      <dt>Indicated efficiency</dt><dd>${(m.indicatedEfficiency * 100).toFixed(0)} %</dd><dt>Power at ${NOMINAL_RPM.toLocaleString('en-US')} rpm</dt><dd>${m.powerKw.toFixed(1)} kW</dd>
      <dt>Fuel per cycle</dt><dd>${m.fuelMg.toFixed(1)} mg</dd>`
  }
  const drawLegend = () => {
    legend.innerHTML = `
      <div><h3>The four-stroke cycle</h3><p class="sub">Two turns of the crankshaft, 720°, for one power stroke.</p></div>
      <div class="cyc" id="cyc">${PHASES.map((p, i) => `<i style="--c:${p.c}" data-i="${i}">${i + 1}</i>`).join('')}<span class="mark" id="mark"></span></div>
      <div class="card"><b id="ph"></b><p id="phtxt"></p></div>
      <dl class="facts">
        <dt>Crank angle</dt><dd id="ang">0°</dd><dt>Piston travel</dt><dd id="pis">0 mm</dd>
        <dt>Intake valve</dt><dd id="vin">closed</dd><dt>Exhaust valve</dt><dd id="vex">closed</dd>
        <dt>Pressure</dt><dd id="prs">0 bar</dd><dt>Gas temperature</dt><dd id="tmp">0 °C</dd><dt>Gas volume</dt><dd id="vol">0 cm³</dd>
      </dl>
      <div class="scale" aria-hidden="true"><span>cool</span><i></i><span>hot</span></div>
      <svg class="pv" viewBox="0 0 300 120" role="img" aria-label="Pressure against volume over one cycle: the area inside the loop is the work">
        <line x1="10" y1="108" x2="290" y2="108"/><line x1="10" y1="8" x2="10" y2="108"/>
        <path id="loop" d="${loopPath()}"/><circle id="dotp" r="4" cx="10" cy="108"/>
        <text x="288" y="118" text-anchor="end">volume</text><text x="14" y="14">pressure</text>
      </svg>
      <p class="sub">Pressure against volume. The area inside the loop is the work of one cycle. Close the throttle or move the spark and it changes.</p>
      <dl class="facts res" id="res">${results()}</dl>
      <details class="checked"><summary>How this model was checked</summary>
        <p>The solids are built with a CAD kernel: ${K.parts} parts, each a closed valid solid. The compression ratio read from their volumes is ${K.compressionRatio.toFixed(2)} (the simulation uses ${PARAMS.cr}). The assembly was moved through ${K.sweepAngles} crank angles: ${K.pairChecks} checks that two parts never occupy the same space, worst overlap ${K.worstSharedMm3} mm³.</p>
        <p>The numbers come from a physical model, not a drawing: exact slider-crank motion, a gas that obeys mass and energy balance, valve flow through an orifice, a Wiebe burn, wall heat loss. Its energy balance closes, and without a spark its entropy stays constant. Values are indicated (before friction) at ${NOMINAL_RPM.toLocaleString('en-US')} rpm; the animation is slow motion.</p>
      </details>`
    st.lastPhase = -1; st.lastShown = -1
  }
  const refresh = (a) => {
    const ph = strokeOf(a), s = at(sim, a)
    if (ph !== st.lastPhase) {
      st.lastPhase = ph; $('#ph').textContent = `${ph + 1} · ${PHASES[ph].n}`; $('#phtxt').textContent = PHASES[ph].t
      document.querySelectorAll('#cyc i').forEach((el) => el.classList.toggle('on', Number(el.dataset.i) === ph))
    }
    const lin = clamp(s.liftIn / P.valves.inLift), lex = clamp(s.liftEx / P.valves.exLift)
    $('#mark').style.left = `calc(${(a / 720) * 100}% - 1px)`
    $('#ang').textContent = `${Math.round(a)}°`; $('#pis').textContent = `${(s.travel * 1000).toFixed(0)} mm from top`
    $('#vin').textContent = lin > 0.02 ? `open ${(s.liftIn * 1000).toFixed(1)} mm` : 'closed'; $('#vex').textContent = lex > 0.02 ? `open ${(s.liftEx * 1000).toFixed(1)} mm` : 'closed'
    $('#prs').textContent = `${(s.p / 1e5).toFixed(s.p < 1e6 ? 2 : 0)} bar`; $('#tmp').textContent = `${Math.round(s.T - 273.15)} °C`; $('#vol').textContent = `${(s.V * 1e6).toFixed(0)} cm³`
    const d = $('#dotp'); d.setAttribute('cx', px(s.V).toFixed(1)); d.setAttribute('cy', py(s.p).toFixed(1))
  }
  const resim = () => {
    P = params(); sim = simulate(P); geom = geometry(P)
    const l = $('#loop'); if (l) l.setAttribute('d', loopPath())
    const r = $('#res'); if (r) r.innerHTML = results()
    outs(); st.lastShown = -1
  }

  return {
    label: 'Four-stroke engine', tag: 'Education', sub: 'Computed cycle · intake, compression, power, exhaust', group: G,
    cam: { pos: [0.36, 0.27, 0.62], target: [0, 0.14, 0] }, autoRotate: false, file: 'four-stroke-engine.glb',
    request: 'Make an interactive 3D lesson on how a four-stroke engine works, from a real physical model: animate the cycle, let the student jump to each stroke and loop it, change the speed, the throttle and the spark timing, and show the crank angle, the valves, the pressure and temperature of the gas and the pressure-volume loop. Use a cutaway of the engine and let me export the 3D model.',
    enter() { st.a = 0; st.loop = null; bar(); drawLegend(); refresh(0) },
    act(a, v) {
      if (a === 'phase') { const i = Number(v); if (st.loop === i) st.loop = null; else { st.loop = i; st.a = i * 180 + 0.01 } if (!st.playing) st.playing = true; bar() }
      else if (a === 'play') { st.playing = !st.playing; bar() }
      else if (a === 'speed') { st.speed = Number(v); outs() }
      else if (a === 'throttle') { op.throttle = Number(v) / 100; resim() }
      else if (a === 'spark') { op.advance = Number(v); resim() }
    },
    tick(dt) {
      if (st.playing) {
        st.a += dt * st.speed * 3.6                                       // 360° per second at full speed (60 rpm)
        if (st.loop !== null) { const lo = st.loop * 180; if (st.a >= lo + 180 || st.a < lo) st.a = lo + (st.a - lo) % 180 }
        st.a = ((st.a % 720) + 720) % 720
      }
      const a = st.a, th = rad(a), lift = valveLift(a, P), s = at(sim, a)
      const R = C.R * MM, L = C.ROD * MM, pinZ = geom.pinDist(a)
      pistonG.position.y = pinZ - C.PIN0 * MM
      rodG.position.y = pinZ; rodG.rotation.z = Math.asin(R * Math.sin(th) / L)
      crankG.rotation.z = -th
      for (const [k, l, max] of [['in', lift.intake, P.valves.inLift], ['ex', lift.exhaust, P.valves.exLift]]) {
        valve[k].position.y = -l; spring[k].scale.y = (C.SPRING_H * MM - l) / (C.SPRING_H * MM)
      }
      const crown = C.CROWN0 * MM - geom.travel(a), deck = C.DECK * MM
      gasLow.scale.y = Math.max(0.0002, deck - crown); gasLow.position.y = (deck + crown) / 2
      const rgb = tempRGB(s.T), hot = clamp((s.T - 1200) / 1400)
      gasMat.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); gasMat.emissive.setRGB(hot * rgb[0] / 255, hot * rgb[1] / 255 * 0.6, hot * rgb[2] / 255 * 0.2)
      gasMat.opacity = 0.42 + 0.3 * hot
      const sp = a >= P.spark - 4 && a < P.spark + 32 ? Math.sin(((a - (P.spark - 4)) / 36) * Math.PI) : 0
      spark.material.opacity = sp; spark.scale.setScalar(0.6 + sp * 1.6); flash.intensity = sp * 0.5
      st.flowPhase += dt * (st.playing ? 1 : 0)
      for (const f of flows) {
        const open = f.s === 'in' ? clamp(lift.intake / P.valves.inLift) : clamp(lift.exhaust / P.valves.exLift)
        f.m.material.opacity = open > 0.04 ? 0.9 * Math.min(1, open * 2) : 0
        const u = (st.flowPhase * (0.35 + 0.9 * open) + f.i / 6) % 1
        const [x, y] = alongPath(paths[f.s], f.s === 'in' ? u : 1 - u); f.m.position.set(x, y, 0)
      }
      if (st.playing || st.a !== st.lastShown) { refresh(a); st.lastShown = a }
    }
  }
}
