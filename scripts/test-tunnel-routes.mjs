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
// The exceptions are the table below, and nothing else: a POST that only READS may be made by a phone, because the phone's pages ask for lists with
// a POST (the Automations list, the live model list) and a phone that cannot list is not a phone that can be used. Each entry says why it is a read,
// where in the source that was checked, and what the same route refuses (a write body, or the sibling routes that act).
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

/**
 * The POST routes a paired phone may make because they only read. Every entry is a deliberate hole in the rule above:
 *   `read`   a body that must pass the guard with the marker;
 *   `writes` bodies of the same route that must still be refused 403 `refused_on_phone` (an action that changes something);
 *   `whole`  the route has no write action at all: the E probe (an empty body) is allowed too, and `siblings` are the routes of its bundle that act
 *            (they spend a call, store a key or a note) and must stay refused.
 */
const PHONE_READS = [
  {
    bundle: 'kybernos-plugin', path: '/kybernos/tasks', whole: false,
    why: 'action `list` returns the stored automations (kbTasksHandle: kbTasksRead, nothing written); the answer to a phone carries no webhook secret. Any other action creates, edits, deletes or runs one.',
    read: { action: 'list' },
    writes: [{ action: 'create', task: { name: 'x', prompt: 'x' } }, { action: 'run-now', id: 'x' }, { action: 'delete', id: 'x' }, { action: 'update', id: 'x' }, { action: 'toggle', id: 'x' }, { action: 'hook-generate', id: 'x' }, { action: 'LIST' }, { action: ' list' }, {}],
  },
  {
    bundle: 'kybernos-models', path: '/kybernos-models/models/live', whole: true,
    why: 'one GET of the provider\'s own model list (live-models.mjs: nothing stored, the key goes only where the saved profile or the catalogue says and never comes back); the model picker of the phone needs it.',
    read: { route: 'audit-probe-route' },
    writes: [],
    siblings: ['/kybernos-models/models/probe', '/kybernos-models/key/check', '/kybernos-models/providers/park', '/kybernos-models/providers/take', '/kybernos-models/providers/forget', '/kybernos-models/annotations/save'],
  },
]

const run = spawnSync(process.execPath, [join(root, 'scripts', 'audit-routes.mjs'), '--json', '--tunnel-probes', JSON.stringify(PHONE_READS)], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 5 * 60 * 1000 })
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

const refusedForPhone = (answer) => answer.status === 403 && /refused_on_phone/.test(answer.body)
const wholeReads = new Set(PHONE_READS.filter((e) => e.whole).map((e) => e.bundle + ' ' + e.path))
const passing = cookieWrites.filter(({ row, m }) => row.methods[m].E !== 403 && !(m === 'POST' && wholeReads.has(row.bundle + ' ' + row.path))).map(({ row, m }) => row.bundle + ' ' + m + ' ' + row.path + ' -> ' + row.methods[m].E)
check('no cookie-guarded write passes with the right Origin, the real cookie and the phone-link marker, except the table below (all answer 403)', passing.length === 0, '\n      ' + passing.join('\n      '))

// ── the table of reads a phone may make ──────────────────────────────────────────────────────────────────────
for (const entry of PHONE_READS) {
  const rows = table.rows.filter((r) => r.bundle === entry.bundle && r.path === entry.path && r.tunnel !== undefined)
  const label = entry.path
  check(label + ' is mounted and probed', rows.length >= 1)
  for (const row of rows) {
    check(label + ' is a cookie-guarded POST (so the exception is a deliberate hole in a real guard)', row.methods.POST !== undefined && row.methods.POST.level === 'cookie')
    check(label + ': the read ' + JSON.stringify(entry.read) + ' passes with the marker (' + row.tunnel.read.status + ')', row.tunnel.read.status !== 401 && row.tunnel.read.status !== 403 && !/refused_on_phone/.test(row.tunnel.read.body), row.tunnel.read.status + ' ' + row.tunnel.read.body)
    entry.writes.forEach((w, i) => check(label + ': the write ' + JSON.stringify(w) + ' is refused with the marker', refusedForPhone(row.tunnel.writes[i]), row.tunnel.writes[i].status + ' ' + row.tunnel.writes[i].body))
  }
  for (const sibling of entry.siblings ?? []) {
    const hit = table.rows.filter((r) => r.bundle === entry.bundle && r.path === sibling)
    check(label + ': its sibling ' + sibling + ' still refuses the marker', hit.length >= 1 && hit.every((r) => r.methods.POST !== undefined && r.methods.POST.E === 403), JSON.stringify(hit.map((r) => r.methods.POST && r.methods.POST.E)))
  }
}

// Not a failure, a ledger: the write routes that only ask for an Origin are not behind the cookie yet, so the marker cannot be asked of them in the guard (fixes 1, 2 and 7 of the recette move them behind it).
const strictOnly = table.rows.flatMap((row) => WRITES.filter((m) => row.methods[m] !== undefined && row.methods[m].level === 'strict').map(() => row.bundle))
const perBundle = strictOnly.reduce((acc, b) => { acc[b] = (acc[b] ?? 0) + 1; return acc }, {})
console.log('  note ' + strictOnly.length + ' write route-methods are guarded by the Origin alone and are not covered by this test: ' + JSON.stringify(perBundle))

console.log(failed === 0 ? '\nALL PASS' : '\n' + failed + ' check(s) FAILED')
process.exit(failed === 0 ? 0 : 1)
