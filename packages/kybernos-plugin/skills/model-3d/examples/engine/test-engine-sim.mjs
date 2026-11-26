// Tests for engine-sim.mjs: every number the lesson shows comes from this model, so the model is checked against
// closed-form physics (kinematics, isentropic compression, energy balance) and against what a real small spark-ignition
// engine does (peak pressure, its angle, indicated efficiency, valve events). Pure node, no dependency.
import assert from 'node:assert/strict'
import { PARAMS, R_GAS, cv, uOf, geometry, valveLift, wiebe, simulate, at } from './engine-sim.mjs'

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`); n++ }
const rel = (a, b, tol, msg) => near(a, b, Math.abs(b) * tol, msg)

const g = geometry(PARAMS)

// 1. kinematics and volumes, exact
near(g.travel(0), 0, 1e-15, 'piston at top dead centre')
near(g.travel(180), PARAMS.stroke, 1e-12, 'travel between the dead centres is the stroke')
near(g.travel(360), 0, 1e-12, 'back to the top after one turn')
for (const x of [10, 47, 90, 133]) near(g.travel(180 + x), g.travel(180 - x), 1e-12, 'travel is symmetric about the bottom dead centre')
near(g.Vd * 1e6, 123.15, 0.05, 'displacement in cm3 (bore 56 x stroke 50)')
near(g.volume(180) / g.volume(0), PARAMS.cr, 1e-9, 'compression ratio is the volume ratio')
for (const d of [20, 77, 140, 250, 333]) {
  const h = 1e-4, num = (g.volume(d + h) - g.volume(d - h)) / (2 * h * Math.PI / 180)
  rel(g.dVdTheta(d), num, 1e-6, `analytic dV/dtheta at ${d} deg matches the numerical derivative`)
}
// the rod is not infinitely long: the piston is not at mid-stroke at 90 deg (it is lower), so the second harmonic is there
ok(g.travel(90) > PARAMS.stroke / 2, 'at 90 deg the piston is past mid-stroke (finite rod)')

// 2. valve events
let prev = null, maxStep = 0
for (let d = 0; d < 720; d += 0.5) {
  const l = valveLift(d), lift = [l.intake, l.exhaust]
  ok(lift.every((x) => x >= 0), 'lift is never negative')
  if (d >= 235 && d <= 485) assert.equal(Math.max(...lift), 0, `both valves closed at ${d} deg, between intake closing and exhaust opening`)
  if (prev) maxStep = Math.max(maxStep, Math.abs(l.intake - prev[0]), Math.abs(l.exhaust - prev[1]))
  prev = lift
}
ok(maxStep < 0.00025, 'valve lift is smooth: less than 0.25 mm per half degree')
near(valveLift(110).intake, PARAMS.valves.inLift, 2e-5, 'intake reaches its maximum lift at the middle of its opening')
near(valveLift(610).exhaust, PARAMS.valves.exLift, 2e-5, 'exhaust reaches its maximum lift at the middle of its opening')
ok(valveLift(5).intake > 0 && valveLift(5).exhaust > 0, 'both valves are open for a moment around the gas-exchange top dead centre (overlap)')
ok(valveLift(100).exhaust === 0 && valveLift(600).intake === 0, 'the valves do not open at the wrong stroke')

// 3. valve-to-piston clearance: the lift at the overlap must stay under the gap between the piston crown and the head
const clearance = (P) => {                       // gap between the valve head and the piston crown, at the worst crank angle (m)
  const gg = geometry(P); let min = Infinity
  for (let d = 0; d < 720; d += 0.5) { const l = valveLift(d, P); min = Math.min(min, P.chamberClearance + gg.travel(d) - Math.max(l.intake, l.exhaust)) }
  return min
}
ok(clearance(PARAMS) > 0.005, `with this timing the valves stay ${(clearance(PARAMS) * 1000).toFixed(1)} mm from the piston at worst`)
const longOverlap = { ...PARAMS, timing: { ivo: -120, ivc: 220, evo: 500, evc: 840 }, valves: { ...PARAMS.valves, inLift: 0.0095, exLift: 0.0095 } }
ok(clearance(longOverlap) < 0, 'the check is not vacuous: a long overlap with high lift would hit the piston')

// 4. the combustion curve
near(wiebe(PARAMS.spark + PARAMS.ignitionDelay + PARAMS.burnDuration).x, 1 - Math.exp(-PARAMS.wiebeA), 1e-12, 'burn fraction at the end of the burn')
ok(wiebe(300).x === 0 && wiebe(700).rate === 0, 'nothing burns before the flame starts or after it is over')
let integ = 0; for (let d = 340; d < 400; d += 0.01) integ += wiebe(d + 0.005).rate * 0.01
near(integ, 1 - Math.exp(-PARAMS.wiebeA), 1e-4, 'the burn rate integrates to the burned fraction')

// 5. the cylinder without flow, spark or heat loss is isentropic: entropy is constant along the whole turn
const adiabatic = simulate(PARAMS, { noFlow: true, noCombustion: true, noLoss: true, cycles: 1 })
// cv(T) = 613 + 0.35 T  =>  s = 613 ln T + 0.35 T + R ln V
const entropy = (T, V) => (cv(300) - 0.35 * 300) * Math.log(T / adiabatic.T[0]) + 0.35 * (T - adiabatic.T[0]) + R_GAS * Math.log(V / adiabatic.V[0])
let maxS = 0; for (let k = 0; k < 1440; k++) maxS = Math.max(maxS, Math.abs(entropy(adiabatic.T[k], adiabatic.V[k])))
ok(maxS < 0.5, `entropy stays constant along an adiabatic cycle (worst drift ${maxS.toFixed(4)} J/kg/K, against ${(R_GAS * Math.log(PARAMS.cr)).toFixed(0)} for the compression itself)`)
near(adiabatic.p[720] / adiabatic.p[0], g.volume(0) / g.volume(360), 1e-6, 'the gas returns to where it started after a full turn (p at TDC)')

// 6. the fired cycle
const fired = simulate(PARAMS)
const M = fired.metrics
ok(fired.cycles < 14, `the cycle repeats (converged in ${fired.cycles} turns of the loop)`)
near(fired.T[0], fired.T[1439] , 40, 'start and end of the cycle agree (temperature, K)')
// energy: change in the gas energy between intake closing and exhaust opening = heat released - wall loss - work done by the gas
const c = fired.closed
near(c.U1 - c.U0, c.Qc - c.Ql - c.W, 0.005 * c.Qc, 'energy balance of the closed part of the cycle')
let mMin = Infinity, mMax = 0
for (let k = Math.round(236 / 0.5); k < Math.round(484 / 0.5); k++) { mMin = Math.min(mMin, fired.m[k]); mMax = Math.max(mMax, fired.m[k]) }
ok((mMax - mMin) / mMax < 1e-9, 'mass is constant while both valves are closed')
near(fired.Qtot, fired.mFuel * PARAMS.lhv * PARAMS.combustionEfficiency, 1e-9, 'heat released = fuel mass x heating value x combustion efficiency')
near(fired.mFuel * (1 + PARAMS.afr), fired.ivc.m - fired.mRes, 1e-9, 'fuel is one part in 14.7 of the fresh charge')
ok(M.peakPressureBar > 35 && M.peakPressureBar < 80, `peak pressure ${M.peakPressureBar.toFixed(1)} bar is in the range of a spark-ignition engine`)
ok(M.peakAngle > 368 && M.peakAngle < 385, `peak pressure comes ${M.peakAngle - 360} deg after top dead centre`)
ok(M.ca50 - 360 > 6 && M.ca50 - 360 < 14, `half of the fuel is burned ${(M.ca50 - 360).toFixed(1)} deg after top dead centre (the usual 8 to 10)`)
ok(M.indicatedEfficiency > 0.30 && M.indicatedEfficiency < 0.45, `indicated efficiency ${(M.indicatedEfficiency * 100).toFixed(0)} %`)
ok(M.indicatedEfficiency < 1 - Math.pow(PARAMS.cr, -0.33), 'it stays under the ideal Otto cycle of the same compression ratio')
ok(M.imepNetBar > 8 && M.imepNetBar < 13, `mean effective pressure ${M.imepNetBar.toFixed(1)} bar`)
ok(M.imepNetBar < M.imepGrossBar, 'the gas exchange costs work (pumping loop is negative)')
ok(M.volumetricEfficiency > 0.8 && M.volumetricEfficiency < 1.05, `the cylinder fills to ${(M.volumetricEfficiency * 100).toFixed(0)} % of its displacement`)
ok(M.residualFraction > 0.02 && M.residualFraction < 0.10, `${(M.residualFraction * 100).toFixed(1)} % of the charge is burnt gas left from the last cycle`)
ok(fired.Ql / fired.Qtot > 0.05 && fired.Ql / fired.Qtot < 0.20, `${(fired.Ql / fired.Qtot * 100).toFixed(0)} % of the fuel energy goes into the walls`)
near(M.workPerCycleJ, M.imepNetBar * 1e5 * g.Vd, 0.01 * M.workPerCycleJ, 'work per cycle = mean effective pressure x displacement')
let maxT = 0; for (const t of fired.T) maxT = Math.max(maxT, t)
ok(maxT > 2000 && maxT < 3000, `peak gas temperature ${Math.round(maxT)} K`)

// 7. without the spark, the peak is at top dead centre and much lower
const motored = simulate(PARAMS, { noCombustion: true })
let pk = 0, pa = 0; for (let k = 0; k < 1440; k++) if (motored.p[k] > pk) { pk = motored.p[k]; pa = k * 0.5 }
near(pa, 360, 1.5, 'a motored engine peaks at top dead centre')
ok(pk / 1e5 > 14 && pk / 1e5 < 30 && pk < 0.6 * fired.metrics.peakPressureBar * 1e5, `motored peak ${(pk / 1e5).toFixed(1)} bar is well under the fired peak`)

// 8. the interpolation the page uses
const a0 = at(fired, 0), a720 = at(fired, 720)
near(a0.p, a720.p, 1, 'at() wraps at 720 deg')
rel(at(fired, 100.25).V, g.volume(100.25), 2e-4, 'at() interpolates the volume')


// 9. what the two sliders of the page do must be what a real engine does
const advances = [10, 15, 20, 25, 30, 35, 40, 45, 50]
const runs = advances.map((a) => ({ a, m: simulate({ ...PARAMS, spark: 360 - a }).metrics }))
const best = runs.reduce((x, y) => (y.m.workPerCycleJ > x.m.workPerCycleJ ? y : x))
ok(best.a >= 28 && best.a <= 42, `there is a best spark advance (${best.a} deg before top dead centre gives the most work)`)
ok(runs[0].m.workPerCycleJ < 0.9 * best.m.workPerCycleJ && runs[runs.length - 1].m.workPerCycleJ < 0.97 * best.m.workPerCycleJ, 'too late and too early both lose work')
for (let i = 1; i < runs.length; i++) ok(runs[i].m.peakPressureBar > runs[i - 1].m.peakPressureBar, 'the earlier the spark, the higher the peak pressure')
const loads = [0.3, 0.5, 0.7, 0.95].map((p) => ({ p, m: simulate({ ...PARAMS, manifold: { ...PARAMS.manifold, pIn: p * 1e5 } }).metrics }))
for (let i = 1; i < loads.length; i++) ok(loads[i].m.workPerCycleJ > loads[i - 1].m.workPerCycleJ, 'more intake pressure, more work')
near(loads[3].m.workPerCycleJ / loads[1].m.workPerCycleJ, 0.95 / 0.5, 0.25, 'work follows the charge (about proportional to intake pressure)')

console.log(`engine-sim: ${n} checks passed`)
