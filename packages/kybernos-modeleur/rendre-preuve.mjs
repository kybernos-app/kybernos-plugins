// ═══════════════════════════════════════════════════════════════════════════
// Preuve visuelle du moteur 3D/2D — SANS navigateur.
//
// Le moteur du panneau (client.js) reçoit un contexte Canvas enregistreur qui
// traduit chaque beginPath/moveTo/lineTo/fill en <path> SVG — les MÊMES
// commandes que dessinerait le navigateur. Le SVG est rendu en PNG par
// qlmanage, et l'image sert de preuve à lire (projection, tri du peintre,
// ombrage, grille 2D).
//
// Usage : node kybernos-modeleur/rendre-preuve.mjs phare|maison|schema <sortie.svg>
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs'

const quel = process.argv[2] || 'phare'
const sortie = process.argv[3] || `/tmp/modeleur-${quel}.svg`
const W = 560, H = 430

// ── chargement du bundle, comme test-client ─────────────────────────────────
let definition = null
globalThis.window = { __ModuleLoader__: { load: (d) => { definition = d } }, devicePixelRatio: 1, addEventListener: () => {} }
globalThis.document = {
  createElement: () => ({ style: {}, appendChild: () => {}, set textContent (v) {}, id: '' }),
  getElementById: () => null,
  head: { appendChild: () => {} },
}
globalThis.fetch = async () => ({ ok: false, json: async () => ({ vide: true }) })
const React = {
  createElement: (type, props, ...enfants) => ({ type, props: props || {}, enfants: enfants.flat(Infinity).filter((e) => e !== null && e !== undefined && e !== false) }),
  useReducer: (_r, init) => [init, () => {}], useRef: (v) => ({ current: v ?? null }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useEffect: () => {},
}
const TAU = Math.PI * 2
new Function('window', 'document', 'React', readFileSync(new URL('./client.js', import.meta.url), 'utf8'))(globalThis.window, globalThis.document, React)
const T = definition.factory(() => React).__test

// ── le contexte enregistreur Canvas → SVG ───────────────────────────────────
const formes = []
let courant = null
let depart = null
const f2 = (n) => Number(n.toFixed(2))
const ctx = {
  setTransform: () => {}, clearRect: () => {},
  beginPath: () => { courant = []; depart = null },
  closePath: () => { if (courant && courant.length > 0) courant.push('Z') },
  moveTo: (x, y) => { courant.push(`M${f2(x)} ${f2(y)}`); depart = [x, y] },
  lineTo: (x, y) => { if (courant.length === 0) courant.push(`M${f2(x)} ${f2(y)}`); else courant.push(`L${f2(x)} ${f2(y)}`) },
  arc: (cx, cy, r, a0, a1, anti) => {
    // arc complet (0→2π) : un `A` SVG avec départ = arrivée est dégénéré —
    // on émet deux demi-arcs relatifs, comme pour `ellipse`.
    if (Math.abs(a1 - a0) >= TAU - 1e-6) {
      if (courant.length === 0) courant.push(`M${f2(cx + r)} ${f2(cy)}`)
      courant.push(`a${f2(r)} ${f2(r)} 0 1 0 ${f2(-r * 2)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(r * 2)} 0`)
      return
    }
    const fin = (anti ? a0 - (a0 - a1) : a1)
    const x1 = cx + r * Math.cos(a0), y1 = cy + r * Math.sin(a0)
    const x2 = cx + r * Math.cos(fin), y2 = cy + r * Math.sin(fin)
    if (courant.length === 0) courant.push(`M${f2(x1)} ${f2(y1)}`)
    const grand = Math.abs(fin - a0) > Math.PI ? 1 : 0
    const balayage = anti ? 0 : 1
    courant.push(`A${f2(r)} ${f2(r)} 0 ${grand} ${balayage} ${f2(x2)} ${f2(y2)}`)
  },
  ellipse: (cx, cy, rx, ry, _rot, _a0, _a1) => {
    courant.push(`M${f2(cx - rx)} ${f2(cy)}a${f2(rx)} ${f2(ry)} 0 1 0 ${f2(rx * 2)} 0a${f2(rx)} ${f2(ry)} 0 1 0 ${f2(-rx * 2)} 0`)
  },
  quadraticCurveTo: (x1, y1, x, y) => courant.push(`Q${f2(x1)} ${f2(y1)} ${f2(x)} ${f2(y)}`),
  bezierCurveTo: (x1, y1, x2, y2, x, y) => courant.push(`C${f2(x1)} ${f2(y1)} ${f2(x2)} ${f2(y2)} ${f2(x)} ${f2(y)}`),
  rect: (x, y, w, h) => courant.push(`M${f2(x)} ${f2(y)}h${f2(w)}v${f2(h)}h${f2(-w)}Z`),
  roundRect: (x, y, w, h, r) => courant.push(`M${f2(x + r)} ${f2(y)}h${f2(w - 2 * r)}a${f2(r)} ${f2(r)} 0 0 1 ${f2(r)} ${f2(r)}v${f2(h - 2 * r)}a${f2(r)} ${f2(r)} 0 0 1 ${f2(-r)} ${f2(r)}h${f2(-(w - 2 * r))}a${f2(r)} ${f2(r)} 0 0 1 ${f2(-r)} ${f2(-r)}v${f2(-(h - 2 * r))}a${f2(r)} ${f2(r)} 0 0 1 ${f2(r)} ${f2(-r)}Z`),
  setLineDash: () => {},
  fill: () => { if (courant && courant.length > 0) formes.push({ d: courant.join(''), fill: ctx._f, stroke: null }) },
  stroke: () => { if (courant && courant.length > 0) formes.push({ d: courant.join(''), fill: null, stroke: ctx._s }) },
  fillText: (t, x, y) => formes.push({ texte: String(t), x, y, fill: ctx._f, font: ctx._fo }),
  set fillStyle (v) { this._f = v }, get fillStyle () { return this._f },
  set strokeStyle (v) { this._s = v }, get strokeStyle () { return this._s },
  set lineWidth (v) { this._w = v }, get lineWidth () { return this._w ?? 1 },
  set font (v) { this._fo = v }, get font () { return this._fo ?? '' },
  set textAlign (v) { this._ta = v }, get textAlign () { return this._ta ?? 'start' },
  set textBaseline (v) {},
}

// ── rendu ───────────────────────────────────────────────────────────────────
const demo = T.DEMOS[quel] || T.DEMOS.phare
const echelleSvg = 1.45
const corps = []
if (demo.espace === '2d') {
  const ops = T.normaliser2D(demo.ops)
  const b = T.bornes2D(ops)
  const k = Math.min((W - 60) / Math.max(1e-6, b.x1 - b.x0), (H - 60) / Math.max(1e-6, b.y1 - b.y0))
  const tr = {
    W, H, k, cadre: b,
    kx: (x) => W / 2 + (x - (b.x0 + b.x1) / 2) * k,
    ky: (y) => H / 2 + ((b.y0 + b.y1) / 2 - y) * k,
  }
  // la grille, à la main (dessiner2D la pose d'abord — même ordre)
  ctx.beginPath()
  const pas = 10
  for (let x = Math.ceil(b.x0 / pas) * pas; x <= b.x1; x += pas) { ctx.moveTo(tr.kx(x), 0); ctx.lineTo(tr.kx(x), H) }
  for (let y = Math.ceil(b.y0 / pas) * pas; y <= b.y1; y += pas) { ctx.moveTo(0, tr.ky(y)); ctx.lineTo(W, tr.ky(y)) }
  ctx.strokeStyle = 'rgba(0,0,0,.06)'; ctx.stroke()
  ctx.beginPath()
  T.dessiner2D(ctx, ops, ops.length, tr, { grille: false })
} else {
  const objets = T.normaliser3D(demo.ops)
  ctx.beginPath()
  T.dessiner3D(ctx, W, H, objets, { yaw: 38 * Math.PI / 180, pitch: 27 * Math.PI / 180, zoom: 1 }, {})
}

for (const f of formes) {
  if (f.texte !== undefined) {
    const taille = Number((((f.font || '')).match(/([\d.]+)px/) || [])[1] || 12)
    const ancre = f.textAlign === 'middle' ? 'middle' : f.textAlign === 'end' ? 'end' : 'start'
    corps.push(`<text x="${f2(f.x)}" y="${f2(f.y)}" font-size="${f2(taille)}" text-anchor="${ancre}" fill="${f.fill}" font-family="ui-sans-serif,system-ui">${f.texte.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`)
  } else {
    corps.push(`<path d="${f.d}" fill="${f.fill ?? 'none'}"${f.stroke ? ` stroke="${f.stroke}" stroke-width="1"` : ''}/>`)
  }
}

writeFileSync(sortie, `<svg xmlns="http://www.w3.org/2000/svg" width="${W * echelleSvg}" height="${H * echelleSvg}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#f7f6f3"/>
<g transform="scale(${echelleSvg / echelleSvg})">${corps.join('\n')}</g>
</svg>`)
console.log(`svg écrit : ${sortie} (${formes.length} formes, démo « ${quel} »)`)
