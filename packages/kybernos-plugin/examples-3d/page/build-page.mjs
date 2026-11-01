// Builds the shelf page: the host template + the simulation + the example modules + the .glb files of the CAD parts,
// all inlined, so the result is ONE self-contained html file.
//   node page/build-page.mjs <out.html> [--local]      (--local adds the viewport meta that a local file needs)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const here = (p) => new URL('../' + p, import.meta.url)
const read = (p) => readFileSync(here(p), 'utf8')
const b64 = (p) => readFileSync(here(p)).toString('base64')
const strip = (src) => src.replace(/^export\s+/gm, '')
const out = process.argv[2]
if (!out) { console.error('usage: node page/build-page.mjs <out.html> [--local]'); process.exit(2) }

const hasGrinder = existsSync(here('grinder/example.js')) && existsSync(here('grinder/grinder.glb'))
const report = JSON.parse(read('engine/engine-report.json')), checks = JSON.parse(read('engine/engine-checks.json'))
let data = `const ENGINE_CAD = ${JSON.stringify(report.constants)};\nconst ENGINE_CHECKS = ${JSON.stringify(checks)};\n`
data += `const GLB = { engine: '${b64('engine/engine.glb')}'${hasGrinder ? `, grinder: '${b64('grinder/grinder.glb')}'` : ''} };`
if (hasGrinder && existsSync(here('grinder/grinder-report.json'))) data += `\nconst GRINDER_REPORT = ${read('grinder/grinder-report.json')};`
const bomPath = existsSync(here('grinder/bom.mjs')) ? 'grinder/bom.mjs' : null
const modules = [strip(read('engine/example.js')), hasGrinder ? (bomPath ? strip(read(bomPath)) + '\n' : '') + strip(read('grinder/example.js')) : ''].join('\n')

let html = read('page/host.template.html')
const put = (marker, text) => { if (!html.includes(marker)) throw new Error('marker missing: ' + marker); html = html.replace(marker, () => text) }
put('/*@@SIM@@*/', strip(read('engine/engine-sim.mjs')))
put('/*@@DATA@@*/', data)
put('/*@@MODULES@@*/', modules)
put('/*@@GRINDER@@*/', hasGrinder ? 'await grinderExample({ ...env, camera, controls, renderer, report: GRINDER_REPORT, bom: { ASSUMPTIONS, bom }, parts: await loadParts(GLB.grinder) })' : 'grinderExampleLegacy()')
put('/*@@ENGINE@@*/', 'await engineExample({ ...env, parts: await loadParts(GLB.engine) })')
if (process.argv.includes('--local')) html = html.replace('<meta name="claude:viewport-fit-sides"', () => '<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="claude:viewport-fit-sides"')
writeFileSync(out, html)
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB, grinder ${hasGrinder ? 'new module' : 'legacy'}`)
