// Page module of the « Hand grinder, exploded » shelf example. Plain ES module, no import: the host hands everything in `env`.
//
//   env.THREE, env.std, env.ease, env.$, env.ctl, env.legend, env.reduced   what the host page already has as globals
//   env.camera, env.controls, env.renderer                                    to follow the stack while it explodes, and for the pointer cursor
//   env.parts      Map<part id, THREE.BufferGeometry>   the twelve parts of grinder.glb (metres, Y up, creased normals applied)
//   env.report     parsed grinder-report.json            volumes, densities, bounding boxes, explode vectors, assembly order
//   env.bom        the namespace of bom.mjs              { ASSUMPTIONS, bom }
//
// Returns the same object as the other examples: { label, tag, sub, group, cam, autoRotate, file, request, enter, act, pointer, pickables, tick }.

const HEX = { walnut: 0x5a3825, beech: 0xc9a066, brass: 0xc9a14a, steel: 0xa3a6ac, 'hardened steel': 0x8d9096 }
const LOOK = { walnut: { roughness: 0.52 }, beech: { roughness: 0.58 }, brass: { metalness: 1, roughness: 0.28 }, steel: { metalness: 1, roughness: 0.4 }, 'hardened steel': { metalness: 1, roughness: 0.3 } }
const XRAY = { body: 0.16, ring: 0.3, plate: 0.35 }          // the parts that hide the burrs

const CSS = `
@media (min-width: 881px) {
  .body:has(.gr-root) .stage { min-height: 560px; }
  #legend:has(.gr-root) { height: 0; min-height: 100%; overflow: auto; }
}
.gr-root { display: grid; gap: 14px; }
.gr-rows { list-style: none; margin: 0; padding: 0; display: grid; }
.gr-rows li { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto 62px; gap: 8px; align-items: center; padding: 6px 0; border-top: 1px solid var(--line); cursor: pointer; }
.gr-rows li:first-child { border-top: 0; }
.gr-rows li.on { background: color-mix(in srgb, var(--accent) 9%, transparent); margin-inline: -8px; padding-inline: 8px; border-radius: 8px; border-top-color: transparent; }
.gr-rows li.on + li { border-top-color: transparent; }
.gr-rows b { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gr-rows .m { color: var(--muted); }
.gr-rows .v { text-align: right; }
.gr-tot { display: grid; gap: 6px; }
.gr-tot > div { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; color: var(--muted); }
.gr-tot output { font: 500 13px/1 var(--font-mono); color: var(--ink); font-variant-numeric: tabular-nums; }
.gr-tot .total { border-top: 1px solid var(--ink); padding-top: 10px; margin-top: 2px; color: var(--ink); }
.gr-tot .big { font: 500 28px/1 var(--font-mono); }
.gr-ass summary { cursor: pointer; font: 500 11px/1.2 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.gr-ass p { margin: 8px 0 0; font-size: 12.5px; color: var(--muted); }
.gr-ass table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; font-variant-numeric: tabular-nums; }
.gr-ass th { text-align: right; font: 500 10.5px/1.2 var(--font-mono); letter-spacing: .04em; color: var(--muted); padding: 3px 0; }
.gr-ass th:first-child, .gr-ass td:first-child { text-align: left; }
.gr-ass td { text-align: right; padding: 3px 0; border-top: 1px solid var(--line); font-family: var(--font-mono); }
.gr-ass td:first-child { font-family: var(--font-body); }
`

export async function grinderExample(env) {
  const { THREE, std, ease, ctl, legend, reduced, camera, controls, renderer, report, parts } = env
  const { ASSUMPTIONS: A, bom } = env.bom
  if (!document.getElementById('gr-css')) { const s = document.createElement('style'); s.id = 'gr-css'; s.textContent = CSS; document.head.append(s) }

  const PARTS = report.order.map((id, k) => ({ id, k, info: report.parts[id], grp: new THREE.Group(), pe: 0 }))
  const g = new THREE.Group()
  for (const p of PARTS) {
    const geo = parts.get(p.id)
    if (!geo) continue
    p.mat = std(HEX[p.info.material], LOOK[p.info.material])
    const m = new THREE.Mesh(geo, p.mat); m.castShadow = true; m.receiveShadow = true
    p.grp.add(m); p.grp.name = p.id; p.grp.userData.part = p.id
    p.dir = report.explode_m[p.id]
    g.add(p.grp)
  }
  const hex = (p) => '#' + HEX[p.info.material].toString(16).padStart(6, '0')
  const eur = (n) => '€' + n.toFixed(2)
  const st = { E: 0, goal: 0, dur: 1.5, xray: false, sel: null, hover: null, playing: false, lastE: -1, qty: 100, ass: false }
  const cache = new Map()
  const calc = (q) => { if (!cache.has(q)) cache.set(q, bom(report, q)); return cache.get(q) }
  const partOf = (obj) => { while (obj && !(obj.userData && obj.userData.part)) obj = obj.parent; return obj ? PARTS.find((p) => p.id === obj.userData.part) : null }
  const paint = () => PARTS.forEach((p) => { if (!p.mat) return; p.mat.emissive.set(0xf2372a); p.mat.emissiveIntensity = st.sel === p.id ? 0.42 : st.hover === p.id ? 0.14 : 0 })

  const drawLegend = () => {
    const b = calc(st.qty), row = (id) => b.rows.find((r) => r.id === id)
    const sel = st.sel && row(st.sel), selP = st.sel && PARTS.find((p) => p.id === st.sel)
    const dim = (bb) => [0, 1, 2].map((i) => Math.round(bb[1][i] - bb[0][i])).join(' × ')
    const card = sel
      ? `<div class="card"><b>${sel.name}</b>
          <p>${sel.material[0].toUpperCase() + sel.material.slice(1)} · ${sel.densityGCm3} g/cm³ · ${sel.process}</p>
          <p>Volume ${sel.volumeCm3.toFixed(1)} cm³ × density = <b style="font:inherit;color:var(--ink)">${Math.round(sel.massG)} g</b> · ${dim(sel.bbox)} mm</p>
          <p>Material ${eur(sel.materialEur)} + machining ${eur(sel.machiningEur)}${sel.otherEur ? ' + other ' + eur(sel.otherEur) : ''} = ${eur(sel.unitEur)} · ${(sel.share * 100).toFixed(0)}% of the unit cost</p></div>`
      : '<div class="card"><b>Nothing selected</b><p>Click a part in the picture or a row to see its material, mass and cost.</p></div>'
    legend.innerHTML = `<div class="gr-root">
      <div><h3>Bill of materials</h3><p class="sub">Hand coffee grinder · ${PARTS.length} parts. Mass and cost are computed from the CAD volumes. Click a part, or a row.</p></div>
      <div class="gr-tot">
        <div class="total"><span>Cost per unit · batch of ${st.qty.toLocaleString('en-US')}</span><output class="big">${eur(b.totalEur)}</output></div>
        <div><span>Parts ${eur(b.partsEur)} · assembly ${A.assemblyMinutes} min ${eur(b.assemblyEur)}</span><output>${Math.round(b.totalMassG)} g</output></div>
      </div>
      <ul class="gr-rows">${b.rows.map((r) => { const p = PARTS.find((x) => x.id === r.id); return `<li class="pick ${st.sel === r.id ? 'on' : ''}" data-act="pick" data-val="${r.id}"><span class="dot" style="--c:${hex(p)}"></span><b>${r.name}</b><span class="v m">${Math.round(r.massG)} g</span><span class="v">${eur(r.unitEur)}</span></li>` }).join('')}</ul>
      ${card}
      <details class="gr-ass" ${st.ass ? 'open' : ''}><summary data-act="ass">Assumptions, not a quote</summary>
        <p>${A.note}</p>
        <p>Shop rate per hour: wood ${A.rates.wood}, metal ${A.rates.metal}, assembly ${A.rates.assembly} (${A.assemblyMinutes} min per mill). Stock price per kg: ${Object.entries(A.materials).map(([k, v]) => k + ' ' + v).join(', ')}.</p>
        <table><thead><tr><th>Part</th><th>Set-up min</th><th>Run min</th><th>Stock ×</th></tr></thead><tbody>${PARTS.map((p) => { const a = A.parts[p.id]; return `<tr><td>${p.info.display}</td>${a.boughtEur !== undefined ? `<td colspan="3">bought in, ${eur(a.boughtEur)}</td>` : `<td>${a.setupMin}</td><td>${a.runMin}</td><td>${a.stock}</td>`}</tr>` }).join('')}</tbody></table>
      </details></div>`
  }
  const bar = () => {
    ctl.innerHTML = `
      <div class="grp"><button class="btn" type="button" data-act="toggle" aria-pressed="${st.goal === 1}">${st.goal === 1 ? 'Assemble' : 'Explode'}</button>
      <button class="btn" type="button" data-act="play">${st.playing ? 'Assembling…' : 'Play assembly'}</button>
      <button class="btn" type="button" data-act="xray" aria-pressed="${st.xray}" title="See the burrs through the body, the ring and the plate">X-ray</button></div>
      <div class="grp"><span class="lab">Batch</span><div class="seg">${[1, 100, 1000].map((q) => `<button type="button" data-act="qty" data-val="${q}" aria-pressed="${st.qty === q}">${q.toLocaleString('en-US')}</button>`).join('')}</div></div>`
  }
  const setE = (goal, dur) => { st.goal = goal; st.dur = reduced ? 0.01 : dur }
  const select = (id) => { st.sel = id; drawLegend(); paint(); const li = legend.querySelector('li.on'); if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' }) }

  return {
    label: 'Hand grinder, exploded', tag: 'Business · Training', sub: 'Product · CAD model, mass and cost by batch', group: g,
    cam: { pos: [0.36, 0.2, 0.44], target: [0, 0.085, 0] }, autoRotate: false, file: 'hand-grinder.glb',
    request: 'Make an exploded 3D view of my product from its CAD model: let me explode and re-assemble it, play the assembly step by step, click a part to see its material, mass (volume times density) and cost, switch the batch size to see the unit cost fall, add an x-ray view, and list the cost assumptions. Export the 3D model.',
    enter() { st.E = 0; st.goal = 0; st.sel = null; st.playing = false; st.lastE = -1; bar(); drawLegend(); paint() },
    act(a, v) {
      if (a === 'toggle') { st.playing = false; setE(st.goal === 1 ? 0 : 1, 1.8) }
      else if (a === 'play') { st.E = 1; st.playing = true; setE(0, 6.5) }
      else if (a === 'xray') st.xray = !st.xray
      else if (a === 'pick') st.sel = st.sel === v ? null : v
      else if (a === 'qty') st.qty = Number(v)
      else if (a === 'ass') st.ass = !st.ass
      bar(); drawLegend(); paint()
    },
    pointer(kind, obj) {
      const p = obj ? partOf(obj) : null
      if (kind === 'move') { const id = p ? p.id : null; if (id !== st.hover) { st.hover = id; paint(); renderer.domElement.style.cursor = id ? 'pointer' : '' } }
      else if (kind === 'click') select(p ? (st.sel === p.id ? null : p.id) : null)
    },
    pickables: () => g,
    tick(dt) {
      if (st.E !== st.goal) {
        const d = dt / st.dur
        st.E = st.goal > st.E ? Math.min(st.goal, st.E + d) : Math.max(st.goal, st.E - d)
        if (st.E === st.goal && st.playing) { st.playing = false; bar() }
      }
      const s = 0.55, n = PARTS.length
      for (const p of PARTS) {                       // the top of the stack leaves first when it explodes, the bottom arrives first when it assembles
        p.pe = ease(st.E * (1 + s) - (s * (n - 1 - p.k)) / (n - 1))
        p.grp.position.set(p.dir[0] * p.pe, p.dir[1] * p.pe, p.dir[2] * p.pe)
      }
      for (const p of PARTS) {
        const o = XRAY[p.id]; if (!o || !p.mat) continue
        p.mat.transparent = st.xray; p.mat.opacity = st.xray ? o : 1; p.mat.depthWrite = !st.xray; p.mat.side = st.xray ? THREE.DoubleSide : THREE.FrontSide
      }
      if (st.playing) { const moving = PARTS.filter((p) => p.pe > 0.04 && p.pe < 0.96).pop(); if (moving && moving.id !== st.sel) select(moving.id) }
      const e = ease(st.E)
      if (e !== st.lastE) {                          // while it explodes or assembles, the camera follows the stack and backs off
        const off = camera.position.clone().sub(controls.target)
        controls.target.y += ((0.085 + 0.115 * e) - controls.target.y) * 0.18
        off.setLength(off.length() + ((0.62 + 0.3 * e) - off.length()) * 0.12)
        camera.position.copy(controls.target).add(off); st.lastE = e
      }
    }
  }
}
