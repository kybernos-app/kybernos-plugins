// The judge of the origin rule (docs/dev/route-origin-rule.md): which write routes of the table scripts/audit-routes.mjs builds are still guarded by an Origin alone, and which of
// those the repository has written down, with the reason. Pure: rows in, verdict out. scripts/audit-routes.mjs calls it for `--check`, scripts/test-route-guards.mjs tests it on
// fixtures and on the real table.
//
// A write route-method (POST, PUT, PATCH, DELETE) is « weak » when a request with the right Origin and no cookie passes it (levels open, origin and strict of the audit). A route that
// answers every method alike is judged on its write methods too: the audit lists it apart as a read, but a handler that ignores the method can still write, so it has to be written down
// as a read. A weak write route is accepted only if it is in one of the two lists of scripts/route-guard-exceptions.mjs:
//   EXCEPTIONS  decided and permanent: a caller that cannot send the cookie, or a route that is public by design. Each says which caller and why.
//   QUEUED      a debt, not a decision: the route should take the cookie and has not yet. Each says who is converting it, or that nobody is. The list must only shrink.
// An entry that matches no weak route is stale (the route was converted, renamed or removed) and fails the check as well: a stale entry would hide the day the route is weakened again.
export const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE']
export const WEAK_LEVELS = ['open', 'origin', 'strict']
const MIN_REASON = 30

/** Every weak write route-method of the table: `[{ bundle, path, method, level }]`. */
export function weakWrites (rows) {
  const out = []
  for (const row of rows) {
    for (const method of WRITES) {
      const answer = row.methods[method]
      if (answer !== undefined && WEAK_LEVELS.indexOf(answer.level) >= 0) out.push({ bundle: row.bundle, path: row.path, method, level: answer.level })
    }
  }
  return out
}

const pathsOf = (entry) => (Array.isArray(entry.paths) ? entry.paths : (typeof entry.path === 'string' ? [entry.path] : []))
const covers = (entry, weak) => entry.bundle === weak.bundle && pathsOf(entry).indexOf(weak.path) >= 0 && (entry.methods === undefined || entry.methods.indexOf(weak.method) >= 0)

/** What is wrong with the shape of an entry, or null. */
const shapeProblem = (entry, kind) => {
  if (entry === null || typeof entry !== 'object') return 'not an object'
  if (typeof entry.bundle !== 'string' || entry.bundle === '') return 'no bundle'
  if (pathsOf(entry).length === 0) return 'no path'
  if (pathsOf(entry).some((p) => typeof p !== 'string' || p[0] !== '/')) return 'a path that is not a route path'
  if (entry.methods !== undefined && (!Array.isArray(entry.methods) || entry.methods.some((m) => WRITES.indexOf(m) < 0))) return 'methods must be a list of write methods'
  if (typeof entry.reason !== 'string' || entry.reason.trim().length < MIN_REASON) return 'no written reason (at least ' + MIN_REASON + ' characters)'
  if (kind === 'queued' && (typeof entry.until !== 'string' || entry.until.trim().length < 10)) return 'a queued route says what removes it from the list (`until`)'
  return null
}

/**
 * @param rows        the rows of `audit-routes.mjs --json`
 * @param exceptions  EXCEPTIONS of scripts/route-guard-exceptions.mjs
 * @param queued      QUEUED of the same file
 * @returns { ok, weak, unlisted, stale, invalid, counts } — `unlisted`: weak routes in no list; `stale`: entries that match no weak route; `invalid`: entries with a missing reason or a bad shape, or a route in both lists
 */
export function judge (rows, exceptions, queued) {
  const weak = weakWrites(rows)
  const invalid = []
  exceptions.forEach((e, i) => { const p = shapeProblem(e, 'exception'); if (p !== null) invalid.push('EXCEPTIONS[' + i + '] ' + (e && e.bundle) + ' ' + pathsOf(e || {}).join(',') + ': ' + p) })
  queued.forEach((e, i) => { const p = shapeProblem(e, 'queued'); if (p !== null) invalid.push('QUEUED[' + i + '] ' + (e && e.bundle) + ' ' + pathsOf(e || {}).join(',') + ': ' + p) })
  const goodExceptions = exceptions.filter((e) => shapeProblem(e, 'exception') === null)
  const goodQueued = queued.filter((e) => shapeProblem(e, 'queued') === null)
  const unlisted = []
  let decided = 0
  let waiting = 0
  for (const w of weak) {
    const inExceptions = goodExceptions.some((e) => covers(e, w))
    const inQueued = goodQueued.some((e) => covers(e, w))
    if (inExceptions && inQueued) invalid.push(w.bundle + ' ' + w.method + ' ' + w.path + ': in EXCEPTIONS and in QUEUED at once')
    else if (inExceptions) decided += 1
    else if (inQueued) waiting += 1
    else unlisted.push(w)
  }
  const stale = []
  for (const [kind, list] of [['EXCEPTIONS', goodExceptions], ['QUEUED', goodQueued]]) {
    for (const e of list) {
      for (const path of pathsOf(e)) {
        const single = { ...e, path, paths: undefined }
        if (!weak.some((w) => covers(single, w))) stale.push(kind + ': ' + e.bundle + ' ' + path + (e.methods === undefined ? '' : ' ' + e.methods.join('/')))
      }
    }
  }
  return { ok: unlisted.length === 0 && stale.length === 0 && invalid.length === 0, weak, unlisted, stale, invalid, counts: { weak: weak.length, decided, waiting } }
}

/** The report the audit prints for a verdict (lines, no trailing newline). */
export function report (verdict) {
  const lines = []
  const { counts } = verdict
  lines.push('write route-methods an Origin alone lets through: ' + counts.weak + ' (decided and written down: ' + counts.decided + ', queued for the cookie: ' + counts.waiting + ', unlisted: ' + verdict.unlisted.length + ')')
  if (verdict.unlisted.length > 0) {
    lines.push('UNLISTED (put the route under the signed-session rule, or write it in scripts/route-guard-exceptions.mjs with its reason):')
    for (const w of verdict.unlisted) lines.push('  ' + w.bundle.padEnd(26) + w.method.padEnd(7) + w.path + '  [' + w.level + ']')
  }
  if (verdict.stale.length > 0) {
    lines.push('STALE (the route is under the rule now, or gone: delete the entry, or it would hide the day the route is weakened again):')
    for (const s of verdict.stale) lines.push('  ' + s)
  }
  if (verdict.invalid.length > 0) {
    lines.push('INVALID entries of scripts/route-guard-exceptions.mjs:')
    for (const s of verdict.invalid) lines.push('  ' + s)
  }
  return lines.join('\n')
}
