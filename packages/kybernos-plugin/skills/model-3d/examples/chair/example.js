// The armchair configurator: an e-commerce page made of primitives only, so it needs no CAD toolchain. Fabric, frame, size and a
// live price follow what the person picks. The functions it calls (std, mesh, lathe, shadowed, ease, countTo, flyTo, eur, $, ctl, legend)
// are the host's: the build puts this file in the same script, just under them.
export function chairExample() {
  const FABRICS = {
    green:   { name: 'Green velvet', color: 0x2f6b4f, price: 260, sheen: 0x3f8764 },
    mustard: { name: 'Mustard velvet', color: 0xc99524, price: 260, sheen: 0xd8ae4a },
    ink:     { name: 'Ink wool', color: 0x25395e, price: 220, sheen: 0x486290 },
    oat:     { name: 'Oat tweed', color: 0xd9cdb6, price: 290, sheen: 0xe9dfc9 }
  };
  const WOODS = { oak: { name: 'Oak', color: 0xb98a55, price: 180, lead: 3 }, walnut: { name: 'Walnut', color: 0x5b3a26, price: 210, lead: 4 }, black: { name: 'Black ash', color: 0x1d1d1f, price: 170, lead: 3 } };
  const st = { fabric: 'green', wood: 'oak', size: 'lounge', quote: [] };
  const fabricMat = new THREE.MeshPhysicalMaterial({ color: FABRICS.green.color, roughness: 0.92, sheen: 0.55, sheenRoughness: 0.5, envMapIntensity: 0.65, sheenColor: new THREE.Color(FABRICS.green.sheen) });
  const woodMat = std(WOODS.oak.color, { roughness: 0.5 });
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.62, 0.12, 0.58, 5, 0.045), fabricMat, 0, 0.405, 0.02));       // seat cushion
  const back = mesh(new RoundedBoxGeometry(0.62, 0.46, 0.11, 5, 0.05), fabricMat, 0, 0.675, -0.245); back.rotation.x = -0.2; g.add(back);
  g.add(mesh(new RoundedBoxGeometry(0.67, 0.05, 0.6, 3, 0.012), woodMat, 0, 0.315, 0.02));           // seat rail
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = mesh(new THREE.CylinderGeometry(0.026, 0.014, 0.29, 20), woodMat, sx * 0.28, 0.145, 0.02 + sz * 0.25);
    leg.rotation.z = sx * 0.1; leg.rotation.x = -sz * 0.1; g.add(leg);
  }
  for (const sx of [-1, 1]) {
    g.add(mesh(new RoundedBoxGeometry(0.07, 0.035, 0.5, 3, 0.012), woodMat, sx * 0.355, 0.555, 0.0));  // arm
    g.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.24, 16), woodMat, sx * 0.355, 0.44, 0.2));   // arm post
    const post = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 16), woodMat, sx * 0.325, 0.56, -0.28); post.rotation.x = -0.2; g.add(post);
  }
  shadowed(g);
  const fabricGoal = new THREE.Color(FABRICS.green.color), woodGoal = new THREE.Color(WOODS.oak.color), sheenGoal = new THREE.Color(FABRICS.green.sheen);
  const sizeK = () => (st.size === 'lounge' ? 1 : 0.86);
  const price = () => {
    const f = FABRICS[st.fabric], w = WOODS[st.wood], k = st.size === 'lounge' ? 1 : 0.85;
    return { frame: w.price * k, seat: Math.round(f.price * 0.55) * k, back: Math.round(f.price * 0.45) * k, total: (w.price + f.price) * k, lead: w.lead + (st.fabric === 'oat' ? 1 : 0) };
  };
  let goalScale = 1;
  const draw = () => {
    const p = price(), f = FABRICS[st.fabric], w = WOODS[st.wood];
    const dims = st.size === 'lounge' ? 'W 82 · D 74 · H 78 cm' : 'W 71 · D 64 · H 67 cm';
    legend.innerHTML = `
      <div><h3>Your configuration</h3><p class="sub">Price and lead time follow every choice.</p></div>
      <ul class="rows">
        <li><i class="dot" style="--c:#${f.color.toString(16).padStart(6, '0')}"></i><div><b>Seat cushion</b><small>${f.name}</small></div><span class="v">${eur(p.seat)}</span></li>
        <li><i class="dot" style="--c:#${f.color.toString(16).padStart(6, '0')}"></i><div><b>Back cushion</b><small>${f.name}</small></div><span class="v">${eur(p.back)}</span></li>
        <li><i class="dot" style="--c:#${w.color.toString(16).padStart(6, '0')}"></i><div><b>Frame and legs</b><small>${w.name}, oiled</small></div><span class="v">${eur(p.frame)}</span></li>
      </ul>
      <div class="total"><span>Total, VAT incl.</span><output class="big" id="total" data-v="${st.prevTotal || 0}">${eur(st.prevTotal || 0)}</output></div>
      <dl class="facts"><dt>Lead time</dt><dd>${p.lead} weeks</dd><dt>Size</dt><dd>${dims}</dd></dl>
      <div class="quote"><h4>Quote &middot; ${st.quote.length} ${st.quote.length === 1 ? 'item' : 'items'}</h4>
        ${st.quote.length ? `<ul>${st.quote.map((q) => `<li><span>${q.label}</span><span class="v">${eur(q.total)}</span></li>`).join('')}</ul>
        <div class="total"><span>Quote total</span><span class="v">${eur(st.quote.reduce((s, q) => s + q.total, 0))}</span></div>` : '<p class="sub">Nothing yet. Add this configuration to build a quote.</p>'}
      </div>`;
    countTo($('#total'), p.total, eur); st.prevTotal = p.total;
    fabricGoal.set(f.color); sheenGoal.set(f.sheen); woodGoal.set(w.color); goalScale = sizeK();
  };
  const bar = () => {
    ctl.innerHTML = `
      <div class="grp"><span class="lab">Fabric</span>${Object.entries(FABRICS).map(([k, f]) => `<button class="sw" type="button" data-act="fabric" data-val="${k}" aria-label="${f.name}" title="${f.name}" aria-pressed="${st.fabric === k}" style="--c:#${f.color.toString(16).padStart(6, '0')}"></button>`).join('')}</div>
      <div class="grp"><span class="lab">Frame</span><div class="seg">${Object.entries(WOODS).map(([k, w]) => `<button type="button" data-act="wood" data-val="${k}" aria-pressed="${st.wood === k}">${w.name}</button>`).join('')}</div></div>
      <div class="grp"><span class="lab">Size</span><div class="seg">${[['lounge', 'Lounge'], ['compact', 'Compact']].map(([k, n]) => `<button type="button" data-act="size" data-val="${k}" aria-pressed="${st.size === k}">${n}</button>`).join('')}</div></div>
      <button class="btn" type="button" data-act="quote">Add to quote</button>`;
  };
  return {
    label: 'Armchair configurator', tag: 'Business', sub: 'E-commerce · fabric, frame, size, live price', group: g,
    cam: { pos: [1.45, 1.0, 1.75], target: [0, 0.4, 0] }, autoRotate: true, file: 'armchair.glb',
    request: 'Make a 3D configurator for my armchair: let the visitor pick the fabric, the wood and the size, show the price and the lead time live, let them add the configuration to a quote, and export the 3D model.',
    enter() { st.prevTotal = 0; bar(); draw(); },
    act(a, v) {
      if (a === 'fabric') st.fabric = v; else if (a === 'wood') st.wood = v; else if (a === 'size') st.size = v;
      else if (a === 'quote') {
        const p = price(); st.quote.push({ label: `${st.size === 'lounge' ? 'Lounge' : 'Compact'} · ${FABRICS[st.fabric].name} · ${WOODS[st.wood].name}`, total: p.total });
        toast('Added to the quote'); draw(); return;
      }
      bar(); draw();
    },
    tick() {
      const k = 0.14;
      fabricMat.color.lerp(fabricGoal, k); fabricMat.sheenColor.lerp(sheenGoal, k); woodMat.color.lerp(woodGoal, k);
      const s = g.scale.x + (goalScale - g.scale.x) * 0.16; g.scale.setScalar(s);
    }
  };
}
