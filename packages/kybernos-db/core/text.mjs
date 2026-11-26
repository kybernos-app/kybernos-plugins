// Text helpers shared by the filter, the sort and the search. Pure and locale-free: the same text gives the same answer in Node, in a browser and on a server.

/** The case- and accent-insensitive form of a text (« Éclair » → « eclair »). `toLowerCase` ignores the locale, unlike `toLocaleLowerCase`. */
export const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Orders two texts by their folded form, then by the raw form so that two different texts are never equal.
 * It compares UTF-16 units, not a locale's collation (which differs between ICU versions): the order is the same everywhere.
 */
export const compareText = (a, b) => {
  const x = fold(a)
  const y = fold(b)
  if (x !== y) return x < y ? -1 : 1
  return a === b ? 0 : a < b ? -1 : 1
}

export const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Deep equality of two JSON values (key order does not matter). */
export const sameJson = (a, b) => {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]))
  if (isPlain(a)) {
    if (!isPlain(b)) return false
    const ka = Object.keys(a)
    return ka.length === Object.keys(b).length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameJson(a[k], b[k]))
  }
  return false
}
