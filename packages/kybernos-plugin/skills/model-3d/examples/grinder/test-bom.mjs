// node test-bom.mjs : the bill of materials of the grinder, from the CAD report. No dependency.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASSUMPTIONS, bom } from './bom.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const report = JSON.parse(readFileSync(join(here, 'grinder-report.json'), 'utf8'))
let fails = 0
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++ }
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))

const ids = report.order
ok(ids.length === 12 && ids.every((id) => report.parts[id]), 'the report has the 12 parts, in assembly order')
ok(ids.every((id) => ASSUMPTIONS.parts[id]), 'every part has a process line in the assumptions')
ok(ids.every((id) => ASSUMPTIONS.parts[id].boughtEur !== undefined || ASSUMPTIONS.materials[report.parts[id].material] > 0), 'every machined part has a material price')
ok(ids.every((id) => ASSUMPTIONS.parts[id].boughtEur !== undefined || ASSUMPTIONS.rates[ASSUMPTIONS.parts[id].rate] > 0), 'every machined part has a shop rate')

const one = bom(report, 1)
ok(one.rows.every((r) => close(r.massG, (report.parts[r.id].volume_mm3 / 1000) * report.parts[r.id].density_g_cm3)), 'mass = exact volume x density, for every part')
ok(one.rows.every((r) => Math.abs(r.massG - report.parts[r.id].mass_g) < 0.01), 'and it is the mass the CAD report already holds (within 0.01 g)')
ok(close(one.totalMassG, one.rows.reduce((s, r) => s + r.massG, 0)) && one.totalMassG > 350 && one.totalMassG < 900, 'total mass ' + one.totalMassG.toFixed(0) + ' g is the sum, and plausible')

for (const q of [1, 100, 1000]) {
  const b = bom(report, q)
  ok(close(b.totalEur, b.rows.reduce((s, r) => s + r.unitEur, 0) + b.assemblyEur), 'qty ' + q + ': total = parts + assembly (EUR ' + b.totalEur.toFixed(2) + ')')
  ok(b.rows.every((r) => close(r.unitEur, r.materialEur + r.machiningEur + r.otherEur)) && close(b.rows.reduce((s, r) => s + r.share, 0) + b.assemblyEur / b.totalEur, 1), 'qty ' + q + ': each row = material + machining + other; the shares of the parts and of the assembly add to 100 %')
}

const series = [1, 2, 5, 10, 100, 1000, 10000].map((q) => bom(report, q).totalEur)
ok(series.every((v, i) => i === 0 || v < series[i - 1]), 'unit cost falls with every step of quantity: ' + series.map((v) => v.toFixed(0)).join(' > '))
const drops = series.slice(1).map((v, i) => series[i] - v)
ok(drops.every((d, i) => i === 0 || d < drops[i - 1] * 4), 'and the set-up is what is shared out: no jump outside the 1/qty shape')
const floor = bom(report, 1e9).totalEur
ok(close(floor, series[series.length - 1], 0.01), 'at 10,000 pieces the set-up is almost gone (within 1 % of the run-only cost)')
const q1 = series[0], q100 = series[4], q1000 = series[5]
ok(q1 > 150 && q100 < q1 / 3 && q1000 < 90 && q1000 > 25, 'orders of magnitude: prototype ' + q1.toFixed(0) + ' EUR, batch of 100 ' + q100.toFixed(0) + ' EUR, batch of 1,000 ' + q1000.toFixed(0) + ' EUR')

// the numbers must follow the inputs, or the assumptions would be decoration
const heavy = structuredClone(report); heavy.parts.plate.density_g_cm3 *= 2
ok(bom(heavy, 100).totalMassG > bom(report, 100).totalMassG + report.parts.plate.mass_g * 0.99, 'doubling the brass density adds the plate mass again')
const dear = structuredClone(ASSUMPTIONS); dear.rates.metal *= 2
ok(bom(report, 100, dear).totalEur > bom(report, 100).totalEur, 'a dearer metal shop raises the cost')
const noSetup = structuredClone(ASSUMPTIONS); for (const p of Object.values(noSetup.parts)) p.setupMin = 0
ok(close(bom(report, 1, noSetup).totalEur, bom(report, 1e9).totalEur, 1e-6), 'without set-up minutes the cost no longer depends on the quantity')
let threw = false; try { bom(report, 0) } catch { threw = true }
ok(threw, 'a quantity below 1 is refused')

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED')
process.exit(fails ? 1 : 0)
