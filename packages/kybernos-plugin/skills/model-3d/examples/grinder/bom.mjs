// Bill of materials of the hand grinder, computed from what the CAD kernel measured (grinder-report.json):
//   mass of a part  = its exact volume x its density
//   material cost   = mass x stock factor (what is bought to make the part) x price per kg
//   machining cost  = (setup minutes / quantity + run minutes) / 60 x shop rate
//   assembly        = minutes / 60 x assembly rate
// Everything in ASSUMPTIONS is an ASSUMPTION: planning values for a small French workshop in 2026, ex VAT, before margin.
// They are written down on purpose so that the page can show them and a person can change them. This is not a quote.
// Pure module, no import, no DOM: runs in the page and in node (test-bom.mjs).

export const ASSUMPTIONS = {
  note: 'Planning assumptions for a small workshop in France, 2026, ex VAT, before margin. Not a quote: change a value and every number follows.',
  currency: 'EUR',
  rates: { wood: 48, metal: 62, assembly: 38 },                    // shop rate, EUR per hour
  materials: { walnut: 14, beech: 4.5, brass: 9.5, steel: 1.8, 'hardened steel': 6.5 },   // stock price, EUR per kg
  assemblyMinutes: 9,
  quantities: [1, 100, 1000],
  // per part: which shop, minutes of set-up per batch, minutes of machine time per piece, stock factor (bought mass / finished mass),
  // an optional fixed extra per piece (heat treatment) and, for a bought-in part, its price per piece
  parts: {
    body:   { rate: 'wood',  setupMin: 35, runMin: 7,   stock: 1.7 },
    drawer: { rate: 'wood',  setupMin: 20, runMin: 4,   stock: 1.8 },
    ring:   { rate: 'metal', setupMin: 40, runMin: 3.5, stock: 1.7, extraEur: 0.8 },
    burr:   { rate: 'metal', setupMin: 45, runMin: 5,   stock: 1.8, extraEur: 0.8 },
    shaft:  { rate: 'metal', setupMin: 25, runMin: 2.5, stock: 1.6 },
    plate:  { rate: 'metal', setupMin: 20, runMin: 1.5, stock: 1.4 },
    screws: { boughtEur: 0.4 },
    hopper: { rate: 'metal', setupMin: 30, runMin: 3,   stock: 1.8 },
    lid:    { rate: 'wood',  setupMin: 15, runMin: 1.5, stock: 2.2 },
    nut:    { rate: 'metal', setupMin: 20, runMin: 2,   stock: 1.7 },
    crank:  { rate: 'metal', setupMin: 20, runMin: 2.5, stock: 1.5 },
    handle: { rate: 'wood',  setupMin: 15, runMin: 1.5, stock: 2.0 },
  },
}

/**
 * @param {{parts: Record<string, any>, order: string[]}} report  grinder-report.json
 * @param {number} qty  how many mills are made in the batch
 * @param {typeof ASSUMPTIONS} [a]
 */
export function bom(report, qty, a = ASSUMPTIONS) {
  if (!(qty >= 1)) throw new Error('quantity must be at least 1')
  const rows = report.order.map((id) => {
    const p = report.parts[id], proc = a.parts[id]
    if (!proc) throw new Error('no process for part ' + id)
    const volumeCm3 = p.volume_mm3 / 1000
    const massG = volumeCm3 * p.density_g_cm3
    let materialEur = 0, machiningEur = 0, otherEur = 0
    if (proc.boughtEur !== undefined) otherEur = proc.boughtEur
    else {
      const price = a.materials[p.material]
      if (price === undefined) throw new Error('no price for material ' + p.material)
      materialEur = (massG / 1000) * proc.stock * price
      machiningEur = ((proc.setupMin / qty + proc.runMin) / 60) * a.rates[proc.rate]
      otherEur = proc.extraEur || 0
    }
    return { id, name: p.display, material: p.material, process: p.process, volumeCm3, densityGCm3: p.density_g_cm3, massG, materialEur, machiningEur, otherEur,
      unitEur: materialEur + machiningEur + otherEur, bbox: p.bbox_mm }
  })
  const partsEur = rows.reduce((s, r) => s + r.unitEur, 0)
  const assemblyEur = (a.assemblyMinutes / 60) * a.rates.assembly
  const totalEur = partsEur + assemblyEur
  rows.forEach((r) => { r.share = r.unitEur / totalEur })
  return { qty, rows, partsEur, assemblyEur, totalEur, totalMassG: rows.reduce((s, r) => s + r.massG, 0) }
}
