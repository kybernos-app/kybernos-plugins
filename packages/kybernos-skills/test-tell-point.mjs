// The skills bundle tells the registry its point at boot and again until the registry has heard it (the registry may mount after the bundle).
// Hermetic: a fake registry on the global seam, a fake scheduler.   node packages/kybernos-skills/test-tell-point.mjs
import assert from 'node:assert/strict'
import { tellSkillPointWhenReady } from './index.js'

let count = 0
const ok = (label, fn) => { fn(); count += 1; console.log('ok  ', label) }
const SEAM = Symbol.for('kybernos.registry')
const keep = globalThis[SEAM]
const timers = []
const schedule = (fn, ms) => { const t = { fn, ms, live: true, unref () {} }; timers.push(t); return t }
const tick = () => { const t = timers.find((x) => x.live); if (t === undefined) return false; t.live = false; t.fn(); return true }

try {
  ok('registry already there: told at once, nothing is scheduled', () => {
    const defined = []
    globalThis[SEAM] = { version: 1, definePoint: (p) => defined.push(p.owner + '#' + p.name) }
    timers.length = 0
    const told = tellSkillPointWhenReady({ schedule })
    assert.deepEqual(defined, ['kybernos/skills#skill'])
    assert.equal(told(), true)
    assert.equal(timers.length, 0)
  })
  ok('registry absent at boot: asked again on the delays until it shows up, then it stops', () => {
    globalThis[SEAM] = undefined
    timers.length = 0
    const defined = []
    const told = tellSkillPointWhenReady({ schedule, delays: [10, 20, 30, 40] })
    assert.equal(told(), false)
    assert.equal(timers.filter((t) => t.live).length, 1)
    assert.equal(timers[0].ms, 10)
    tick()
    assert.equal(told(), false)
    globalThis[SEAM] = { version: 1, definePoint: (p) => defined.push(p.name) }
    tick()
    assert.equal(told(), true)
    assert.deepEqual(defined, ['skill'])
    assert.equal(tick(), false, 'nothing more is scheduled once it is heard')
  })
  ok('a registry that never comes: it gives up after the last delay, and nothing throws', () => {
    globalThis[SEAM] = undefined
    timers.length = 0
    const told = tellSkillPointWhenReady({ schedule, delays: [1, 2] })
    let laps = 0
    while (tick() && laps < 20) laps += 1
    assert.equal(laps, 2)
    assert.equal(told(), false)
  })
  ok('a registry that throws, or an old one, does not break the boot', () => {
    globalThis[SEAM] = { version: 1, definePoint: () => { throw new Error('boom') } }
    timers.length = 0
    assert.doesNotThrow(() => tellSkillPointWhenReady({ schedule, delays: [1] }))
    globalThis[SEAM] = { version: 0, definePoint: () => {} }
    timers.length = 0
    assert.equal(tellSkillPointWhenReady({ schedule, delays: [1] })(), false)
  })
  ok('the default delays reach a minute, and the timers do not hold DSH open', () => {
    globalThis[SEAM] = undefined
    timers.length = 0
    let unref = 0
    const sched = (fn, ms) => { const t = { fn, ms, live: true, unref () { unref += 1 } }; timers.push(t); return t }
    tellSkillPointWhenReady({ schedule: sched })
    for (let i = 0; i < 10 && tick(); i += 1) { /* run them all */ }
    assert.deepEqual(timers.map((t) => t.ms), [500, 1500, 4000, 10000, 30000, 60000])
    assert.equal(unref, 6)
  })
} finally { globalThis[SEAM] = keep }
console.log('\n' + count + ' checks passed')
