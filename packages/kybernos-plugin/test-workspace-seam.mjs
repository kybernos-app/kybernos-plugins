// The core publishes how other bundles find a session's folder and check a path (kybernos-motion relies on it).
// `cd packages/kybernos-plugin && node test-workspace-seam.mjs`
import { existsSync, readFileSync } from 'node:fs'

let fail = 0
const ok = (name, cond) => { if (!cond) { fail++; console.log('FAIL ' + name) } }
const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8')

ok("publishes on Symbol.for('kybernos.workspace')", src.includes("globalThis[Symbol.for('kybernos.workspace')] = { sessionCwd: kbSessionCwd, pathAllowed: cheminAutorise }"))
ok('kbSessionCwd is defined before it is published', src.indexOf('const kbSessionCwd = async') > 0 && src.indexOf('const kbSessionCwd = async') < src.indexOf("Symbol.for('kybernos.workspace')"))
ok('cheminAutorise is defined before it is published', src.indexOf('const cheminAutorise = async') > 0 && src.indexOf('const cheminAutorise = async') < src.indexOf("Symbol.for('kybernos.workspace')"))
ok('the publication is guarded (a frozen global must not stop DSH)', /try \{ globalThis\[Symbol\.for\('kybernos\.workspace'\)\][^\n]*catch/.test(src))
// the consumer reads the same key (skipped when this bundle runs alone, without its sibling)
const sibling = new URL('../kybernos-motion/index.js', import.meta.url)
if (existsSync(sibling)) ok('kybernos-motion reads the same key', readFileSync(sibling, 'utf8').includes("Symbol.for('kybernos.workspace')"))

console.log(fail === 0 ? 'workspace seam: ok' : `${fail} failed`)
process.exit(fail ? 1 : 0)
