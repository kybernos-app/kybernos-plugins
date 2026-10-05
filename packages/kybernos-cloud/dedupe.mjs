// Near-duplicate detection for memories and lessons. Pure functions: no model, no network, nothing is read or written here.
//
// Two items are "the same" when their words (relevance.mjs tokens: accents, plurals and stop words folded) overlap
// almost entirely: Jaccard >= 0.8, or one is wholly inside the other (>= 95 % of the smaller one's words, and Jaccard
// >= 0.6, with at least 4 words so "Europe/Paris" alone does not swallow a sentence). Groups are STARS around a keeper,
// never chains: A~B and B~C does not put A and C together, which is how a loose threshold ends up merging different
// facts. The keeper is the pinned item if any, else the most complete one (most distinct words), then the newest.
// What it cannot decide (an older value replaced by a newer one, two similar facts about different things) is left alone:
// that is a judgement for a model, not for a word count.
//
// Two words that the token overlap cannot see are checked on the raw text, because they flip a fact while leaving the
// overlap at 100 %: a negation (« do not commit » vs « commit » — « not » is a stop word) and a number (« port 3000 »
// vs « port 3080 »). A pair that differs on either is NOT the same fact; it is handed to `unclearPairs`, which is what a
// model (or the user) is for. Only groups from `findDuplicateGroups` with a score >= AUTO_MIN_SCORE may be merged without asking.
import { tokens } from './relevance.mjs'

export const DEDUPE_TUNING = { jaccard: 0.8, containment: 0.95, containmentJaccard: 0.6, containmentMinWords: 4, minWords: 3 }

/** A group at or above this score (the lowest Jaccard of its members with the keeper, in %) is merged without asking, when the user allows it. */
export const AUTO_MIN_SCORE = 80

const fold = (text) => String(text === undefined || text === null ? '' : text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const NEGATION = /\b(?:not|no|never|none|nor|neither|cannot|without|nothing|nobody|jamais|pas|non|sans|aucun|aucune|nul|nulle|rien|ni)\b|n['’]t\b/
/** Does the text say « not »? (the stop-word list hides it from the overlap) */
export const negates = (text) => NEGATION.test(fold(text))
/** The numbers of a text, as a canonical string: « 3000 », « 2/3 » → « 2,3 ». Two texts with different numbers state different values. */
export const numbersOf = (text) => (fold(text).match(/\d+(?:[.,]\d+)*/g) || []).sort().join(',')
/** Why two otherwise alike texts must not be merged on the word count alone: 'negation' | 'number' | null. */
export const clash = (a, b) => (negates(a) !== negates(b) ? 'negation' : (numbersOf(a) !== numbersOf(b) ? 'number' : null))

const overlap = (a, b) => {
  let both = 0
  for (const x of a) if (b.has(x)) both += 1
  return both
}

/** How alike two word sets are: { jaccard, contained } (share of the smaller set that the other has). */
export const likeness = (a, b) => {
  const both = overlap(a, b)
  const union = a.size + b.size - both
  const small = Math.min(a.size, b.size)
  return { jaccard: union === 0 ? 0 : both / union, contained: small === 0 ? 0 : both / small, small }
}

export const sameFact = (a, b, t = DEDUPE_TUNING) => {
  const l = likeness(a, b)
  return l.jaccard >= t.jaccard || (l.contained >= t.containment && l.jaccard >= t.containmentJaccard && l.small >= t.containmentMinWords)
}

const when = (d) => { const t = Date.parse(String(d.createdAt === undefined || d.createdAt === null ? '' : d.createdAt).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')); return Number.isFinite(t) ? t : 0 }

// FNV-1a: a short stable id for a group (the same members give the same id on every scan)
const hash = (text) => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

/**
 * items: [{ id, content, createdAt?, pinned?, bucket? }] — only items with the same `bucket` (kind, scope, kyber…) are compared.
 * Returns groups, biggest saving first: { id, keeperId, items: [{ id, content, createdAt, pinned, keep: bool, like }], score, saves }
 * where `like` is the item's Jaccard with the keeper (0..1), `score` the lowest of them as a percentage, `saves` how many go.
 */
export const findDuplicateGroups = (items, options = {}) => {
  const t = { ...DEDUPE_TUNING, ...options }
  const prepared = []
  for (const it of Array.isArray(items) ? items : []) {
    if (it === null || typeof it !== 'object' || it.id === undefined || it.id === null) continue
    const set = new Set(tokens(it.content))
    if (set.size < t.minWords) continue
    prepared.push({ it, set, text: String(it.content), bucket: String(it.bucket === undefined ? '' : it.bucket) })
  }
  const buckets = new Map()
  for (const p of prepared) { if (!buckets.has(p.bucket)) buckets.set(p.bucket, []); buckets.get(p.bucket).push(p) }
  const groups = []
  for (const list of buckets.values()) {
    // keeper candidates first: pinned, then most complete, then newest, then lowest id (so the order never depends on the input order)
    list.sort((a, b) => (Number(b.it.pinned === true) - Number(a.it.pinned === true)) || (b.set.size - a.set.size) || (when(b.it) - when(a.it)) || (String(a.it.id) < String(b.it.id) ? -1 : 1))
    const taken = new Set()
    for (const keeper of list) {
      if (taken.has(keeper)) continue
      const members = []
      for (const other of list) {
        if (other === keeper || taken.has(other)) continue
        // two pinned items are both deliberate: never grouped
        if (keeper.it.pinned === true && other.it.pinned === true) continue
        if (sameFact(keeper.set, other.set, t) && clash(keeper.text, other.text) === null) members.push(other)
      }
      if (members.length === 0) continue
      taken.add(keeper)
      members.forEach((m) => taken.add(m))
      const rows = [keeper, ...members].map((p, i) => ({
        id: p.it.id, content: String(p.it.content), createdAt: p.it.createdAt === undefined ? null : p.it.createdAt, pinned: p.it.pinned === true, keep: i === 0,
        like: i === 0 ? 1 : likeness(keeper.set, p.set).jaccard,
      }))
      groups.push({
        id: hash(rows.map((r) => String(r.id)).sort().join('|')), keeperId: keeper.it.id, items: rows,
        score: Math.round(Math.min(...rows.map((r) => r.like)) * 100), saves: members.length,
      })
    }
  }
  return groups.sort((a, b) => (b.saves - a.saves) || (b.score - a.score) || (a.id < b.id ? -1 : 1))
}

/** A short stable id for a pair, whichever way round it is given. */
export const pairKey = (idA, idB) => hash([String(idA), String(idB)].sort().join('|'))

/**
 * Pairs that look alike but that the word count cannot call duplicates — what a model (or the user) should judge:
 *   · 'close'    Jaccard between `floor` and the duplicate threshold (a fact reworded, or a different one),
 *   · 'negation' / 'number'  alike enough to be duplicates, except that one says « not » or has another number.
 * Items already in a group (`taken`, a Set of ids) are left out. Best first, at most `max` pairs, each item in at most
 * `perItem` of them. Returns [{ id, a, b, like, why }] with a and b as { id, content, createdAt, pinned } (a is the older).
 */
export const unclearPairs = (items, options = {}) => {
  const t = { ...DEDUPE_TUNING, ...options }
  const floor = options.floor === undefined ? 0.5 : options.floor
  const max = options.max === undefined ? 30 : options.max
  const perItem = options.perItem === undefined ? 2 : options.perItem
  const taken = options.taken instanceof Set ? options.taken : new Set()
  const prepared = []
  for (const it of Array.isArray(items) ? items : []) {
    if (it === null || typeof it !== 'object' || it.id === undefined || it.id === null || taken.has(it.id)) continue
    const set = new Set(tokens(it.content))
    if (set.size < t.minWords) continue
    prepared.push({ it, set, text: String(it.content), bucket: String(it.bucket === undefined ? '' : it.bucket) })
  }
  const found = []
  const buckets = new Map()
  for (const p of prepared) { if (!buckets.has(p.bucket)) buckets.set(p.bucket, []); buckets.get(p.bucket).push(p) }
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        if (a.it.pinned === true && b.it.pinned === true) continue
        const l = likeness(a.set, b.set)
        if (l.jaccard < floor) continue
        const cl = clash(a.text, b.text)
        if (sameFact(a.set, b.set, t) && cl === null) continue   // a real duplicate without a clash is `findDuplicateGroups`' business
        const why = cl === null ? 'close' : cl
        found.push({ a, b, like: l.jaccard, why })
      }
    }
  }
  found.sort((x, y) => (y.like - x.like) || (pairKey(x.a.it.id, x.b.it.id) < pairKey(y.a.it.id, y.b.it.id) ? -1 : 1))
  const used = new Map()
  const out = []
  for (const f of found) {
    if (out.length >= max) break
    const ia = String(f.a.it.id)
    const ib = String(f.b.it.id)
    if ((used.get(ia) || 0) >= perItem || (used.get(ib) || 0) >= perItem) continue
    used.set(ia, (used.get(ia) || 0) + 1)
    used.set(ib, (used.get(ib) || 0) + 1)
    const row = (p) => ({ id: p.it.id, content: String(p.it.content), createdAt: p.it.createdAt === undefined ? null : p.it.createdAt, pinned: p.it.pinned === true })
    const [older, newer] = when(f.a.it) <= when(f.b.it) ? [f.a, f.b] : [f.b, f.a]
    out.push({ id: pairKey(f.a.it.id, f.b.it.id), a: row(older), b: row(newer), like: Math.round(f.like * 100), why: f.why })
  }
  return out
}
