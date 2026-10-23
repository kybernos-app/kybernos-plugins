// Versions and ranges (docs/dev/plugin-contract.md, section 5). Pure.
//
// `compareVersions` is the one the Suite already uses (packages/kybernos-hub/catalogue-distant.mjs `comparerVersions`): numbers as numbers, a
// release above its own pre-releases. Bundles import nothing from each other, so this is a copy; test-version.mjs compares the two on a table.
// `satisfies` reads the range grammar of the contract: up to four comparators separated by a space, all must hold; a comparator is
// `^x.y.z`, `~x.y.z` or one of `>= <= > < =` with a version; no `||`, no wildcards. `^` follows npm for 0.x (the first non-zero segment may
// not change). Pre-releases are ordinary versions here: DSH itself only ships pre-releases, so an npm-style "satisfies" would never match it.

/** "1.0.0-beta.2" vs "1.0.0-beta.10" → -1 | 0 | 1. */
export const compareVersions = (a, b) => {
  const split = (v) => {
    const [core, pre = ''] = String(v ?? '').split('-', 2)
    return { n: core.split('.').map((x) => parseInt(x, 10) || 0), pre: pre === '' ? [] : pre.split('.') }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < Math.max(x.n.length, y.n.length); i += 1) {
    const d = (x.n[i] ?? 0) - (y.n[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0
  if (x.pre.length === 0) return 1
  if (y.pre.length === 0) return -1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) { const d = parseInt(p, 10) - parseInt(q, 10); if (d !== 0) return d < 0 ? -1 : 1 } else if (pn !== qn) return pn ? -1 : 1
    else if (p !== q) return p < q ? -1 : 1
  }
  return 0
}

const COMPARATOR = /^(\^|~|>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?$/

/** One comparator → `{ op, base, upper? }` (versions padded to three numbers), or null when it is not one. */
function comparator (text) {
  const m = COMPARATOR.exec(text)
  if (m === null) return null
  const op = m[1] ?? '='
  const major = Number(m[2])
  const minor = m[3] === undefined ? undefined : Number(m[3])
  const patch = m[4] === undefined ? undefined : Number(m[4])
  const base = major + '.' + (minor ?? 0) + '.' + (patch ?? 0) + (m[5] ?? '')
  if (op === '^') {
    let upper
    if (major > 0 || minor === undefined) upper = major > 0 ? (major + 1) + '.0.0' : '1.0.0'
    else if (minor > 0 || patch === undefined) upper = '0.' + (minor + 1) + '.0'
    else upper = '0.0.' + (patch + 1)
    return { op, base, upper }
  }
  if (op === '~') return { op, base, upper: minor === undefined ? (major + 1) + '.0.0' : major + '.' + (minor + 1) + '.0' }
  return { op, base }
}

/** The comparators of a range, or null when the text is not a range of the grammar. */
export function parseRange (range) {
  if (typeof range !== 'string' || range.length === 0 || range.length > 120) return null
  const parts = range.trim().split(/\s+/)
  if (parts.length > 4) return null
  const out = parts.map(comparator)
  return out.some((c) => c === null) ? null : out
}

/** Does `version` satisfy `range`? false for a range or a version that does not parse. */
export function satisfies (version, range) {
  const set = parseRange(range)
  if (set === null || !/^\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/.test(String(version))) return false
  return set.every((c) => {
    const d = compareVersions(version, c.base)
    if (c.op === '^' || c.op === '~') return d >= 0 && compareVersions(version, c.upper) < 0
    if (c.op === '>=') return d >= 0
    if (c.op === '<=') return d <= 0
    if (c.op === '>') return d > 0
    if (c.op === '<') return d < 0
    return d === 0
  })
}
