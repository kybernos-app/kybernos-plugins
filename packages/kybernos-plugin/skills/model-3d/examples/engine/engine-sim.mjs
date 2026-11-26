// Single-cylinder four-stroke engine, computed instead of drawn.
//
// What is modelled (the standard textbook set, nothing hand-shaped):
//   - slider-crank kinematics, exact (no small-angle approximation);
//   - an open single-zone ideal-gas cylinder: mass and energy balance, valve flow through an orifice
//     (subsonic and choked), so intake, exhaust, back-flow and the residual gas come out of the model;
//   - combustion: a Wiebe burn-rate curve, energy = fuel mass x lower heating value;
//   - wall heat loss: Woschni heat-transfer coefficient;
//   - gas energy u(T) with a specific heat that grows with temperature.
// Crank angle theta is in degrees, 0 = top dead centre of the gas exchange (start of intake), 720 = one cycle.
// The numbers are for the nominal speed (rpm below); the page plays the cycle in slow motion.
// Pure ES module, no dependency: it runs in node (tests) and inlined in the page.

export const PARAMS = {
  bore: 0.056, stroke: 0.050, rod: 0.090, cr: 10,           // m, m, m, compression ratio  (about 123 cm3)
  rpm: 3000,
  valves: { inDia: 0.020, exDia: 0.018, inLift: 0.0075, exLift: 0.0070, throat: 0.85, cd: 0.65 },
  chamberClearance: 0.00628,                                 // m: closed valve face to piston crown at top dead centre (5.28 mm chamber, 26 mm radius, + 1.0 mm squish)
  timing: { ivo: -15, ivc: 235, evo: 485, evc: 735 },       // degrees; intake 250 deg long, exhaust 250 deg long
  manifold: { pIn: 0.95e5, tIn: 320, pEx: 1.08e5, tEx: 900 },
  spark: 330, ignitionDelay: 13, burnDuration: 50, wiebeA: 5, wiebeM: 2,
  afr: 14.7, lhv: 44e6, combustionEfficiency: 0.95,
  wallTemp: 450
}

export const R_GAS = 287
const D2R = Math.PI / 180
// u(T): internal energy above 300 K, J/kg; cv grows with T (burnt gas at 2500 K is near 1500 J/kg/K)
export const cv = (T) => 718 + 0.35 * (T - 300)
export const uOf = (T) => 718 * (T - 300) + 0.175 * (T - 300) ** 2

export function geometry(P = PARAMS) {
  const A = Math.PI * P.bore ** 2 / 4, r = P.stroke / 2, L = P.rod
  const Vd = A * P.stroke, Vc = Vd / (P.cr - 1)
  // distance from the crank axis to the piston pin, then travel from top dead centre (m)
  const pinDist = (deg) => { const t = deg * D2R; return r * Math.cos(t) + Math.sqrt(L * L - (r * Math.sin(t)) ** 2) }
  const travel = (deg) => pinDist(0) - pinDist(deg)
  const volume = (deg) => Vc + A * travel(deg)
  const dVdTheta = (deg) => { const t = deg * D2R, s = Math.sin(t); return A * (r * s + (r * r * s * Math.cos(t)) / Math.sqrt(L * L - (r * s) ** 2)) }   // m3 per rad
  return { A, r, L, Vd, Vc, pinDist, travel, volume, dVdTheta, stroke: P.stroke }
}

const wrap = (deg) => ((deg % 720) + 720) % 720
// sin^2 cam: zero lift and zero speed at both ends
function liftOf(deg, open, close, max) {
  const dur = close - open
  const d = wrap(deg - open)
  return d < dur ? max * Math.sin(Math.PI * d / dur) ** 2 : 0
}
export const valveLift = (deg, P = PARAMS) => ({
  intake: liftOf(deg, wrap(P.timing.ivo), wrap(P.timing.ivo) + (P.timing.ivc - P.timing.ivo), P.valves.inLift),
  exhaust: liftOf(deg, wrap(P.timing.evo), wrap(P.timing.evo) + (P.timing.evc - P.timing.evo), P.valves.exLift)
})

const GAMMA_O = 1.35
// mass flow through an orifice of area A from (pUp, TUp) to pDn, kg/s (compressible, choked below the critical ratio)
function orifice(pUp, TUp, pDn, A) {
  if (A <= 0 || pUp <= 0) return 0
  const pr = Math.min(1, pDn / pUp), g = GAMMA_O
  const crit = (2 / (g + 1)) ** (g / (g - 1))
  const psi = pr > crit
    ? Math.sqrt(2 * g / (g - 1) * (pr ** (2 / g) - pr ** ((g + 1) / g)))
    : Math.sqrt(g) * (2 / (g + 1)) ** ((g + 1) / (2 * (g - 1)))
  return A * pUp / Math.sqrt(R_GAS * TUp) * psi
}

export const wiebe = (deg, P = PARAMS) => {
  const x0 = P.spark + P.ignitionDelay, u = (deg - x0) / P.burnDuration
  if (u <= 0) return { x: 0, rate: 0 }
  if (u >= 1) return { x: 1 - Math.exp(-P.wiebeA), rate: 0 }
  const e = Math.exp(-P.wiebeA * u ** (P.wiebeM + 1))
  return { x: 1 - e, rate: P.wiebeA * (P.wiebeM + 1) / P.burnDuration * u ** P.wiebeM * e }   // fraction per degree
}

/**
 * Runs the cycle until it repeats and returns it sampled every `stepDeg` degrees.
 * opts: { noCombustion, noLoss, noFlow (closed cylinder from the start state), cycles, dDeg }
 */
export function simulate(P = PARAMS, opts = {}) {
  const g = geometry(P), omega = 2 * Math.PI * P.rpm / 60, dDeg = opts.dDeg || 0.25, dth = dDeg * D2R
  const nStep = Math.round(720 / dDeg), every = Math.round(0.5 / dDeg), maxCycles = opts.cycles || 14
  const Sp = 2 * P.stroke * P.rpm / 60            // mean piston speed
  const wMean = 2.28 * Sp                          // Woschni gas velocity (compression and expansion)
  const vIn = P.valves, tm = P.timing
  let Qtot = 0, mFuel = 0
  let state = { m: 1.1e5 * g.volume(0) / (R_GAS * 900), T: 900 }
  const out = {}
  let last = Infinity

  const deriv = (deg, m, T, acc) => {
    const V = g.volume(deg), p = m * R_GAS * T / V, lift = valveLift(deg, P)
    let dm = 0, dE = -p * g.dVdTheta(deg)                       // J per rad
    if (!opts.noFlow) {
      const Ain = vIn.cd * Math.min(Math.PI * vIn.inDia * lift.intake, Math.PI * (vIn.throat * vIn.inDia) ** 2 / 4)
      const Aex = vIn.cd * Math.min(Math.PI * vIn.exDia * lift.exhaust, Math.PI * (vIn.throat * vIn.exDia) ** 2 / 4)
      const man = P.manifold
      const flows = [[Ain, man.pIn, man.tIn], [Aex, man.pEx, man.tEx]].map(([A, pM, tM]) => {
        if (A <= 0) return 0
        return pM >= p ? orifice(pM, tM, p, A) : -orifice(p, T, pM, A)    // kg/s, positive into the cylinder
      })
      const hIn = [man.tIn, man.tEx]
      flows.forEach((f, i) => {
        const perRad = f / omega
        dm += perRad
        dE += perRad * (f > 0 ? uOf(hIn[i]) + R_GAS * hIn[i] - uOf(T) : R_GAS * T)
        if (acc) { if (i === 0) { acc.inFlow += perRad * dth * (f > 0 ? 1 : 0); acc.backIn += perRad * dth * (f < 0 ? 1 : 0) } }
      })
    }
    let dQc = 0
    if (!opts.noCombustion && Qtot > 0) dQc = Qtot * wiebe(deg, P).rate / D2R
    let dQl = 0
    if (!opts.noLoss) {
      const x = g.travel(deg), Aw = 2 * g.A + Math.PI * P.bore * (g.Vc / g.A + x)
      const h = 3.26 * P.bore ** -0.2 * (p / 1000) ** 0.8 * T ** -0.55 * wMean ** 0.8      // W/m2/K, p in kPa
      dQl = h * Aw * Math.max(0, T - P.wallTemp) / omega
    }
    // energy: d(m u) = flow enthalpy - p dV + combustion - wall loss, so m cv dT = (dE_total - u dm); dE already holds (h - u) per flow
    return { dm, dT: (dE + dQc - dQl) / (m * cv(T)), dQc, dQl, p, V }
  }

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const rec = { p: new Float32Array(1440), T: new Float32Array(1440), V: new Float32Array(1440), m: new Float32Array(1440), W: new Float32Array(1440) }
    const acc = { inFlow: 0, backIn: 0 }
    let { m, T } = state, W = 0, Qc = 0, Ql = 0, mRes = 0
    const closed = { W: 0, Qc: 0, Ql: 0, U0: null, U1: null }
    let ivc = null
    const ivcDeg = wrap(tm.ivc), evoDeg = wrap(tm.evo)
    for (let i = 0; i < nStep; i++) {
      const deg = i * dDeg
      if (i % every === 0) {
        const k = i / every, V = g.volume(deg)
        rec.p[k] = m * R_GAS * T / V; rec.T[k] = T; rec.V[k] = V; rec.m[k] = m; rec.W[k] = W
      }
      if (ivc === null && deg >= ivcDeg) {                        // intake valve just closed: the charge is trapped
        ivc = { m, T, V: g.volume(deg) }
        mFuel = Math.max(0, m - mRes) / (1 + P.afr)               // the fresh part of the charge carries the fuel
        Qtot = mFuel * P.lhv * P.combustionEfficiency
        closed.U0 = m * uOf(T)
      }
      if (ivc !== null && closed.U1 === null && deg >= evoDeg) closed.U1 = m * uOf(T)
      const k1 = deriv(deg, m, T, null)                           // midpoint step
      const k2 = deriv(deg + dDeg / 2, m + k1.dm * dth / 2, T + k1.dT * dth / 2, acc)
      const dW = k2.p * g.dVdTheta(deg + dDeg / 2) * dth
      W += dW; Qc += k2.dQc * dth; Ql += k2.dQl * dth
      if (ivc !== null && closed.U1 === null) { closed.W += dW; closed.Qc += k2.dQc * dth; closed.Ql += k2.dQl * dth }
      m += k2.dm * dth; T += k2.dT * dth
      if (deg < 15 && deg + dDeg >= 15) mRes = m                  // mass left in the cylinder just after the exhaust valve has closed
    }
    state = { m, T }
    Object.assign(rec, { Wnet: W, Qc, Ql, mFuel, Qtot, mRes, ivc, closed, inFlow: acc.inFlow, backIn: acc.backIn })
    Object.assign(out, rec)
    const drift = Math.abs(ivc.m - last) / ivc.m
    last = ivc.m
    out.cycles = cycle + 1
    if (cycle > 2 && drift < 1e-5) break
  }

  // numbers a lesson wants to show
  let pmax = 0, kmax = 0
  for (let k = 0; k < 1440; k++) if (out.p[k] > pmax) { pmax = out.p[k]; kmax = k }
  const work = (a, b) => { let s = 0; for (let k = Math.round(a / 0.5); k < Math.round(b / 0.5); k++) s += (out.p[k] + out.p[k + 1]) / 2 * (out.V[k + 1] - out.V[k]); return s }
  const Wi = work(0, 719.5), Wg = work(180, 540)
  out.params = P; out.geometry = g
  out.metrics = {
    peakPressureBar: pmax / 1e5, peakAngle: kmax * 0.5,
    imepNetBar: Wi / g.Vd / 1e5, imepGrossBar: Wg / g.Vd / 1e5,
    workPerCycleJ: out.Wnet,
    indicatedEfficiency: out.Qtot > 0 ? out.Wnet / (out.mFuel * P.lhv) : 0,
    powerKw: out.Wnet * (P.rpm / 60 / 2) / 1000,
    torqueNm: out.Wnet / (4 * Math.PI),
    fuelMg: out.mFuel * 1e6,
    ca50: (() => { for (let d = P.spark; d < 720; d += 0.1) if (wiebe(d, P).x >= 0.5 * (1 - Math.exp(-P.wiebeA))) return d; return null })(),
    volumetricEfficiency: (out.ivc.m - out.mRes) / (P.manifold.pIn * g.Vd / (R_GAS * P.manifold.tIn)),
    residualFraction: out.mRes / out.ivc.m,
    meanPistonSpeed: Sp
  }
  return out
}

/** The numbers at one crank angle (degrees, any real), interpolated from a simulated cycle. */
export function at(sim, deg) {
  const d = wrap(deg) / 0.5, i = Math.floor(d) % 1440, j = (i + 1) % 1440, f = d - Math.floor(d)
  const mix = (a) => a[i] * (1 - f) + a[j] * f
  const lift = valveLift(deg, sim.params), g = sim.geometry
  return { p: mix(sim.p), T: mix(sim.T), V: mix(sim.V), m: mix(sim.m), W: mix(sim.W), travel: g.travel(wrap(deg)), liftIn: lift.intake, liftEx: lift.exhaust, burned: wiebe(wrap(deg), sim.params).x }
}

export const strokeOf = (deg) => Math.floor(wrap(deg) / 180)
