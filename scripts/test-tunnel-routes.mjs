// A phone must not write through the cookie-guarded routes (recette 2026-10-25, L3-11).
//
// kybernos-mobile replays a paired phone's requests against this DSH with the person's own Origin and session cookie, and marks them with
// `x-kybernos-tunnel`. Origin and cookie are then both right, so the marker is the only thing that tells a stolen phone from the person's
// browser: every write route that asks for the cookie must refuse it (packages/*/session-guard.mjs for the bundles, the terminal's run route,
// and the task routes of kybernos-plugin, which keep their own cookie check).
//
// The family is enumerated, not listed: scripts/audit-routes.mjs mounts every route of every bundle in-process and, for each method, sends a
// request with the right Origin, the real cookie AND the marker (its probe E). A route added tomorrow at the cookie level is in the table
// without touching this file, and it fails here until it refuses the marker.
//
//   node scripts/test-tunnel-routes.mjs
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const check = (label, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : '  -- ' + detail))
  if (!ok) failed += 1
}

const run = spawnSync(process.execPath, [join(root, 'scripts', 'audit-routes.mjs'), '--json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 5 * 60 * 1000 })
let table = null
try { table = JSON.parse(run.stdout) } catch (e) { /* reported below */ }
check('the route audit ran and printed its table', table !== null && Array.isArray(table.rows), String(run.status) + ' ' + String(run.stderr).slice(0, 200))
if (table === null || !Array.isArray(table.rows)) process.exit(1)

const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE']
const cookieWrites = table.rows.flatMap((row) => WRITES.filter((m) => row.methods[m] !== undefined && row.methods[m].level === 'cookie').map((m) => ({ row, m })))
const bundles = new Set(cookieWrites.map(({ row }) => row.bundle))
// A floor, so that an audit that silently stops mounting bundles cannot turn this test into a pass about nothing (140 routes of 19 bundles when it was written).
check('the audit found the cookie-guarded write routes (' + cookieWrites.length + ' route-methods in ' + bundles.size + ' bundles)', cookieWrites.length >= 120 && bundles.size >= 17)
for (const name of ['kybernos-terminal', 'kybernos-plugin', 'kybernos-cloud', 'kybernos-mobile', 'kybernos-call']) check(name + ' is in the family', bundles.has(name))

const passing = cookieWrites.filter(({ row, m }) => row.methods[m].E !== 403).map(({ row, m }) => row.bundle + ' ' + m + ' ' + row.path + ' -> ' + row.methods[m].E)
check('no cookie-guarded write passes with the right Origin, the real cookie and the phone-link marker (all answer 403)', passing.length === 0, '\n      ' + passing.join('\n      '))

// Not a failure, a ledger: the write routes that only ask for an Origin are not behind the cookie yet, so the marker cannot be asked of them in the guard (fixes 1, 2 and 7 of the recette move them behind it).
const strictOnly = table.rows.flatMap((row) => WRITES.filter((m) => row.methods[m] !== undefined && row.methods[m].level === 'strict').map(() => row.bundle))
const perBundle = strictOnly.reduce((acc, b) => { acc[b] = (acc[b] ?? 0) + 1; return acc }, {})
console.log('  note ' + strictOnly.length + ' write route-methods are guarded by the Origin alone and are not covered by this test: ' + JSON.stringify(perBundle))

console.log(failed === 0 ? '\nALL PASS' : '\n' + failed + ' check(s) FAILED')
process.exit(failed === 0 ? 0 : 1)
