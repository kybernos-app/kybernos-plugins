// A client bundle registers under the NAME OF ITS PACKAGE, nothing added.
//
//   node scripts/test-client-bundle-ids.mjs
//
// Found on 2026-11-23 on DSH 0.2.3-alpha.2: eleven bundles registered as `@local/<package>/client`. DSH 0.2.2-rc.5 strips a trailing `/client`
// from the id (`stripClientSuffix`); 0.2.3-alpha.2 does not, so the factory was filed under `<package>/client`, the loader never found the row
// `<package>`, loaded the single-resource URL as a fallback, and the second run stopped on « duplicate factory registration ». The bundles never
// started (no sessions seam, no Changes page, no Slides, Servers, Maintenance, ...). The bare package name works on both engines.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1 } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

// The id of the first `__ModuleLoader__.load({ id: '...' })` of a file, or null when it has none.
const REGISTRATION = /__ModuleLoader__\s*\.\s*load\(\s*\{\s*id:\s*(['"`])([^'"`]+)\1/
const idOf = (source) => { const m = REGISTRATION.exec(source); return m === null ? null : m[2] }

check('the pattern reads a registration', idOf("window.__ModuleLoader__.load({\n  id: '@local/x',\n  factory () {} })") === '@local/x')
check('the pattern reads none when there is none', idOf('const a = 1') === null)

let seen = 0
for (const dir of readdirSync(ROOT).sort()) {
  const manifest = join(ROOT, dir, 'package.json')
  const client = join(ROOT, dir, 'client.js')
  if (!existsSync(manifest) || !existsSync(client)) continue
  let pkg
  try { pkg = JSON.parse(readFileSync(manifest, 'utf8')) } catch (e) { continue }
  if (pkg?.dsh?.client === undefined) continue
  const id = idOf(readFileSync(client, 'utf8'))
  if (id === null) continue
  seen += 1
  check(dir + ': registers as its package name (' + pkg.name + ')', id === pkg.name, { registers: id, package: pkg.name })
}
check('the scan found the bundles (a path change must not turn this test into a no-op)', seen >= 40, seen)

console.log(`${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
