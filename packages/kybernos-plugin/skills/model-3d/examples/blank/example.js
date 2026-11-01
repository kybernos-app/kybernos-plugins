// A generic parts viewer: the smallest page module of the skill. Plain ES module, no import: the host hands everything in `env`.
//
//   env.THREE, env.std, env.ease, env.$, env.ctl, env.legend, env.reduced   what the host page already has
//   env.parts    Map<part id, THREE.BufferGeometry>   the parts of the .glb (metres, Y up, creased normals applied)
//   env.report   the parsed model-report.json         per part: material, volume_mm3, mass_g, bbox_mm (CAD frame, Z up); optionally explode_m[id] = [x, y, z],
//                                                       the part's explode vector in metres in the page's frame (Y up): without it the parts spread along the height
//
// It returns { label, tag, sub, group, cam, autoRotate, file, request, enter, act, tick, pickables, pointer } (the host calls these):
//   label, tag, sub   the tab (shown when the page holds more than one example)
//   group             the THREE.Group the host puts in the scene       cam { pos, target }   where the camera starts, in metres
//   file              the name Export gives the .glb                  enter()   the page switched to this example
//   act(name, value)  a click on any element with data-act            tick(dt)  every frame, dt in seconds
//   pickables()       the object a click can hit                       pointer('click' | 'move', object)   what was clicked or hovered, or null
const COLOR = { beech: 0xc9a066, ash: 0xd9c9a5, steel: 0xa3a6ac, brass: 0xc9a14a, aluminium: 0xb9bcc2, walnut: 0x5a3825, plastic: 0x2b2d31 }

export function partsExample(env) {
  const { THREE, std, ease, ctl, legend, reduced, parts, report } = env
  const ids = report.order.filter((id) => parts.has(id))
  const g = new THREE.Group()
  const P = ids.map((id) => {
    const info = report.parts[id]
    const mat = std(COLOR[info.material] || 0xb0b0b0, { roughness: 0.55 })
    const mesh = new THREE.Mesh(parts.get(id), mat); mesh.castShadow = true; mesh.receiveShadow = true
    const grp = new THREE.Group(); grp.userData.part = id; grp.add(mesh); g.add(grp)
    // default explosion, along the height: the parts above the middle of the model go up, the ones below go down
    const z0 = info.bbox_mm[0][2], z1 = info.bbox_mm[1][2]
    return { id, info, mat, grp, zc: (z0 + z1) / 2 }
  })
  const mid = P.reduce((s, p) => s + p.zc, 0) / P.length
  const span = Math.max(...P.map((p) => Math.abs(p.zc - mid))) || 1
  for (const p of P) p.vec = (report.explode_m && report.explode_m[p.id]) || [0, ((p.zc - mid) / span) * 0.12, 0]          // metres at full explosion
  const st = { E: 0, goal: 0, sel: null }
  const hex = (p) => '#' + (COLOR[p.info.material] || 0xb0b0b0).toString(16).padStart(6, '0')
  const draw = () => {
    const sel = P.find((p) => p.id === st.sel)
    legend.innerHTML = `<div style="display:grid;gap:12px">
      <div><h3>Parts</h3><p class="sub">${P.length} parts · ${Math.round(report.total_mass_g)} g in all. Mass is the exact volume of each solid times its density. Click a part or a row.</p></div>
      <ul style="list-style:none;margin:0;padding:0;display:grid">${P.map((p) => `<li data-act="pick" data-val="${p.id}" style="display:grid;grid-template-columns:12px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line);cursor:pointer;${st.sel === p.id ? 'font-weight:600' : ''}"><span style="width:10px;height:10px;border-radius:50%;background:${hex(p)}"></span><span>${p.info.display || p.id}</span><span style="font-family:var(--font-mono)">${Math.round(p.info.mass_g)} g</span></li>`).join('')}</ul>
      <div class="card">${sel ? `<b>${sel.info.display || sel.id}</b><p>${sel.info.material} · ${sel.info.density_g_cm3} g/cm³</p><p>Volume ${(sel.info.volume_mm3 / 1000).toFixed(1)} cm³ × density = ${Math.round(sel.info.mass_g)} g</p>` : '<b>Nothing selected</b><p>Click a part or a row for its material and mass.</p>'}</div></div>`
  }
  const bar = () => { ctl.innerHTML = `<div class="grp"><button class="btn" type="button" data-act="toggle" aria-pressed="${st.goal === 1}">${st.goal === 1 ? 'Assemble' : 'Explode'}</button></div>` }
  const paint = () => P.forEach((p) => { p.mat.emissive.set(0xf2372a); p.mat.emissiveIntensity = st.sel === p.id ? 0.4 : 0 })
  const owner = (o) => { while (o && !(o.userData && o.userData.part)) o = o.parent; return o ? o.userData.part : null }
  return {
    label: 'Parts viewer', tag: 'Product', sub: 'Solids, mass from volume', group: g,
    cam: { pos: [0.7, 0.55, 0.9], target: [0, 0.24, 0] }, autoRotate: true, file: 'model.glb',
    request: '',
    enter() { st.E = 0; st.goal = 0; st.sel = null; bar(); draw(); paint() },
    act(a, v) { if (a === 'toggle') st.goal = st.goal === 1 ? 0 : 1; else if (a === 'pick') st.sel = st.sel === v ? null : v; bar(); draw(); paint() },
    pickables: () => g,
    pointer(kind, obj) { if (kind === 'click') { const id = owner(obj); st.sel = id === st.sel ? null : id; draw(); paint() } },
    tick(dt) {
      if (st.E !== st.goal) st.E = reduced ? st.goal : st.goal > st.E ? Math.min(1, st.E + dt / 1.2) : Math.max(0, st.E - dt / 1.2)
      const e = ease(st.E)
      for (const p of P) p.grp.position.set(p.vec[0] * e, p.vec[1] * e, p.vec[2] * e)
    }
  }
}
