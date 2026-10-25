// The origin rule, as a family (recette 2026-10-25, fix 7: L3-09, L3-14 to L3-18, L3-20, L3-21).
//
// `scripts/audit-routes.mjs` mounts every route of every bundle in-process and measures how each write route answers. This test holds the table to the rule
// of docs/dev/route-origin-rule.md: a write route that a request with the right Origin and NO cookie gets through (« weak ») is accepted only if scripts/route-guard-exceptions.mjs writes
// it down with its reason, and an entry that matches no weak route any more is stale. Four things are checked:
//   1. the judge (scripts/lib-route-guards.mjs) on small fixtures: an unlisted weak route, a listed one, a queued one, a stale entry, an entry with no reason, a route in both lists;
//   2. the real table of this checkout is accepted by the judge (the same verdict as `node scripts/audit-routes.mjs --check`);
//   3. the eight bundles that had no session-guard (hub, workers, servers, skills, search, websearch, free-llms, sessions) have all their write routes under the cookie, except the ones
//      written down as decided exceptions (never as queued debts);
//   4. the judge is sensitive to the real table: weaken any ONE of those routes (its level read as « strict ») and the verdict names exactly that route; so a route that loses its guard,
//      or a new one that never had it, cannot get through.
//
//   node scripts/test-route-guards.mjs
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { judge, report, weakWrites } from './lib-route-guards.mjs'
import { EXCEPTIONS, QUEUED } from './route-guard-exceptions.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const check = (label, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : '  -- ' + detail))
  if (!ok) failed += 1
}

// ── 1. the judge on fixtures ─────────────────────────────────────────────────────────────────────────────────────
const row = (bundle, path, levels) => ({ bundle, path, methods: Object.fromEntries(Object.entries(levels).map(([m, level]) => [m, { level }])) })
const REASON = 'a caller that cannot send the cookie, written down so that the check can be read'
{
  const rows = [row('b', '/b/a', { POST: 'cookie' }), row('b', '/b/w', { GET: 'open', POST: 'strict' }), row('b', '/b/q', { POST: 'origin', DELETE: 'open' }), row('b', '/b/r', { GET: 'open', POST: 'open', PUT: 'open', PATCH: 'open', DELETE: 'open' })]
  check('a route under the cookie is not weak; a GET never counts', weakWrites(rows).every((w) => w.path !== '/b/a') && weakWrites(rows).every((w) => w.method !== 'GET'))
  check('a route answering every method alike is judged on its write methods', weakWrites(rows).filter((w) => w.path === '/b/r').length === 4)
  let v = judge(rows, [], [])
  check('an unlisted weak route fails, and is named with its method and level', v.ok === false && v.unlisted.some((w) => w.path === '/b/w' && w.method === 'POST' && w.level === 'strict') && v.unlisted.length === 7, JSON.stringify(v.unlisted))
  v = judge(rows, [{ bundle: 'b', paths: ['/b/w', '/b/q', '/b/r'], reason: REASON }], [])
  check('a listed route passes, whatever its write methods, when the entry names no method', v.ok === true && v.counts.decided === 7, report(v))
  v = judge(rows, [{ bundle: 'b', path: '/b/w', methods: ['POST'], reason: REASON }], [])
  check('an entry for POST does not excuse the DELETE of another route', v.ok === false && v.unlisted.some((w) => w.path === '/b/q'))
  v = judge(rows, [{ bundle: 'b', path: '/b/q', methods: ['POST'], reason: REASON }, { bundle: 'b', paths: ['/b/w', '/b/r'], reason: REASON }], [])
  check('...and an entry for POST does not excuse the same route\'s DELETE', v.ok === false && v.unlisted.length === 1 && v.unlisted[0].method === 'DELETE' && v.unlisted[0].path === '/b/q', JSON.stringify(v.unlisted))
  v = judge(rows, [], [{ bundle: 'b', paths: ['/b/w', '/b/q', '/b/r'], reason: REASON, until: 'the branch that converts them is merged' }])
  check('a queued route passes and is counted apart from the decided ones', v.ok === true && v.counts.waiting === 7 && v.counts.decided === 0)
  v = judge(rows, [{ bundle: 'b', paths: ['/b/w', '/b/q', '/b/r', '/b/a'], reason: REASON }], [])
  check('an entry for a route that is under the cookie is stale', v.ok === false && v.stale.length === 1 && /\/b\/a/.test(v.stale[0]), JSON.stringify(v.stale))
  v = judge(rows, [{ bundle: 'b', paths: ['/b/w', '/b/q', '/b/r', '/b/gone'], reason: REASON }], [])
  check('an entry for a route that is not mounted any more is stale', v.ok === false && v.stale.length === 1 && /\/b\/gone/.test(v.stale[0]))
  v = judge(rows, [{ bundle: 'b', paths: ['/b/w', '/b/q', '/b/r'], reason: 'too short' }], [])
  check('an entry with no real reason is invalid, and does not excuse its routes', v.ok === false && v.invalid.length === 1 && v.unlisted.length === 7)
  v = judge(rows, [], [{ bundle: 'b', paths: ['/b/w', '/b/q', '/b/r'], reason: REASON }])
  check('a queued entry says what removes it (`until`), or it is invalid', v.ok === false && v.invalid.length === 1)
  v = judge(rows, [{ bundle: 'b', paths: ['/b/w', '/b/q', '/b/r'], reason: REASON }], [{ bundle: 'b', path: '/b/w', reason: REASON, until: 'the branch that converts it is merged' }])
  check('a route in both lists is invalid (a decision and a debt cannot both be true)', v.ok === false && v.invalid.some((s) => /at once/.test(s)))
  v = judge(rows, [{ bundle: 'b', paths: ['/b/w', '/b/q', '/b/r'], methods: ['GET'], reason: REASON }], [])
  check('an entry whose methods are not write methods is invalid', v.ok === false && v.invalid.length === 1)
  v = judge(rows, [{ bundle: 'other', paths: ['/b/w', '/b/q', '/b/r'], reason: REASON }], [])
  check('an entry names the bundle: the same path in another bundle excuses nothing', v.ok === false && v.unlisted.length === 7 && v.stale.length === 3)
}

// ── 2. the real table ───────────────────────────────────────────────────────────────────────────────────────────
const run = spawnSync(process.execPath, [join(root, 'scripts', 'audit-routes.mjs'), '--json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 5 * 60 * 1000 })
let table = null
try { table = JSON.parse(run.stdout) } catch (e) { /* reported below */ }
check('the route audit ran and printed its table', table !== null && Array.isArray(table.rows), String(run.status) + ' ' + String(run.stderr).slice(0, 200))
if (table === null || !Array.isArray(table.rows)) process.exit(1)
const rows = table.rows
// A floor, so that an audit that silently stops mounting bundles cannot turn this test into a pass about nothing (479 routes of 35 bundles when it was written).
check('the audit mounted the bundles (' + rows.length + ' routes of ' + new Set(rows.map((r) => r.bundle)).size + ' bundles) and none failed to mount', rows.length >= 400 && new Set(rows.map((r) => r.bundle)).size >= 33 && table.problems.length === 0, JSON.stringify(table.problems))
const verdict = judge(rows, EXCEPTIONS, QUEUED)
check('every write route that an Origin alone lets through is written down with its reason, and no entry is stale (' + verdict.counts.weak + ' route-methods: ' + verdict.counts.decided + ' decided, ' + verdict.counts.waiting + ' queued)', verdict.ok === true, '\n' + report(verdict))

// ── 3. the eight bundles that had no session-guard ──────────────────────────────────────────────────────────────
const FAMILY = {
  'kybernos-hub': 5, 'kybernos-workers': 4, 'kybernos-servers': 5, 'kybernos-skills': 28,
  'kybernos-search': 3, 'kybernos-websearch': 4, 'kybernos-free-llms': 3, 'kybernos-sessions': 13,
}
const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE']
const cookieWrites = rows.flatMap((r) => WRITES.filter((m) => r.methods[m] !== undefined && r.methods[m].level === 'cookie').map((m) => ({ bundle: r.bundle, path: r.path, method: m })))
for (const [bundle, floor] of Object.entries(FAMILY)) {
  const mine = cookieWrites.filter((w) => w.bundle === bundle)
  check(bundle + ': at least ' + floor + ' write routes ask for the signed session (' + mine.length + ')', mine.length >= floor, mine.map((w) => w.path).join(', '))
  const weak = weakWrites(rows).filter((w) => w.bundle === bundle)
  const undecided = weak.filter((w) => !EXCEPTIONS.some((e) => e.bundle === w.bundle && (e.paths ?? [e.path]).includes(w.path) && (e.methods === undefined || e.methods.includes(w.method))))
  check(bundle + ': no write route is left at the Origin alone except the decided exceptions (' + weak.length + ' weak, all decided)', undecided.length === 0, undecided.map((w) => w.method + ' ' + w.path).join(', '))
}

// ── 4. the judge sees a route that loses its guard ──────────────────────────────────────────────────────────────
const weakened = (bundle, path, method) => rows.map((r) => (r.bundle === bundle && r.path === path ? { ...r, methods: { ...r.methods, [method]: { ...r.methods[method], level: 'strict' } } } : r))
let missed = []
for (const w of cookieWrites.filter((x) => FAMILY[x.bundle] !== undefined)) {
  const v = judge(weakened(w.bundle, w.path, w.method), EXCEPTIONS, QUEUED)
  if (!(v.ok === false && v.unlisted.length === 1 && v.unlisted[0].path === w.path && v.unlisted[0].bundle === w.bundle && v.unlisted[0].method === w.method)) missed.push(w.bundle + ' ' + w.method + ' ' + w.path)
}
check('weakening any one of the ' + cookieWrites.filter((x) => FAMILY[x.bundle] !== undefined).length + ' converted routes makes the verdict name exactly that route', missed.length === 0, missed.join(', '))
{
  const invented = rows.concat([row('kybernos-hub', '/kybernos-hub/a-new-write', { GET: 'origin', POST: 'strict' })])
  const v = judge(invented, EXCEPTIONS, QUEUED)
  check('a new write route that only asks for an Origin is refused until it is guarded or written down', v.ok === false && v.unlisted.length === 1 && v.unlisted[0].path === '/kybernos-hub/a-new-write')
}

console.log(failed === 0 ? '\nALL PASS' : '\n' + failed + ' check(s) FAILED')
process.exit(failed === 0 ? 0 : 1)
