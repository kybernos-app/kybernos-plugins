// Near-duplicate detection for memories and lessons. Pure functions: no model, no network, nothing is read or written here.
//
// Two items are "the same" when their words (relevance.mjs tokens: accents, plurals and stop words folded) overlap
// almost entirely: Jaccard >= 0.8, or one is wholly inside the other (>= 95 % of the smaller one's words, and Jaccard
// >= 0.6, with at least 4 words so "Europe/Paris" alone does not swallow a sentence). Groups are STARS around a keeper,
// never chains: A~B and B~C does not put A and C together, which is how a loose threshold ends up merging different
// facts. The keeper is the pinned item if any, else the most complete one (most distinct words), then the newest.
// What it cannot decide (an older value replaced by a newer one, two similar facts about different things) is left alone:
// that is a judgement for a model, not for a word count.
import { tokens } from './relevance.mjs'

export const DEDUPE_TUNING = { jaccard: 0.8, containment: 0.95, containmentJaccard: 0.6, containmentMinWords: 4, minWords: 3 }

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
    prepared.push({ it, set, bucket: String(it.bucket === undefined ? '' : it.bucket) })
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
        if (sameFact(keeper.set, other.set, t)) members.push(other)
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
