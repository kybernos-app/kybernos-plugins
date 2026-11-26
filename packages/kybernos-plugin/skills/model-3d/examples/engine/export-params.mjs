// Writes the numbers the CAD script needs from the single source of truth (engine-sim.mjs), so the two cannot drift apart.
import { writeFileSync } from 'node:fs'
import { PARAMS, valveLift } from './engine-sim.mjs'
const lift = []
for (let d = 0; d < 720; d += 1) { const l = valveLift(d); lift.push([d, l.intake, l.exhaust]) }
writeFileSync(new URL('./engine-params.json', import.meta.url), JSON.stringify({ params: PARAMS, lift }, null, 1))
console.log('engine-params.json written')
