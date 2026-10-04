// Local relevance ranking of memories: a query against the memories the plugin already holds.
// No model, no network, nothing leaves the machine, no plan needed. Pure functions (tested without DSH).
//
// What it does: accents and case are ignored, a few French/English endings are folded (plurals, -ing, -ed),
// stop words ("le", "of"...) do not count, and a memory is scored by how many of the query's words it has
// and how rare those words are across ALL the memories (a word found in 5 memories says more than one found
// in 500). A word also matches as a prefix ("doc" → "docker") and, last, as a fragment, at lower weight.
// What it cannot do: link words that share no letters ("voiture" / "bagnole", "lundi" / "monday") — that is
// the job of search by meaning, which needs the embedding model.

const STOP = new Set((
  'le la les un une des de du d l et ou a au aux en dans sur pour par que qui ne pas est sont se sa son ses ce cet cette ces il elle on nous vous ils elles je tu y' +
  ' the a an of and or to in on for with is are was it its this that these those be by as at from'
).split(' '))

/** Lower case, accents removed, anything that is not a letter or a digit becomes a space. */
export const normalize = (text) => {
  let s = String(text === undefined || text === null ? '' : text).toLowerCase()
  try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, '') } catch (e) { /* keep as is */ }
  return s.replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Light ending folding, only on words long enough that it cannot eat the root. */
export const stem = (word) => {
  let w = word
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3)
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2)
  else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2)
  else if (w.length > 3 && (w.endsWith('s') || w.endsWith('x'))) w = w.slice(0, -1)
  return w
}

/** The words of a text that count: normalised, stop words out, folded. A 1-letter word never counts. */
export const tokens = (text) => normalize(text).split(' ').filter((t) => t.length > 1 && !STOP.has(t)).map(stem)

const WEIGHT_EXACT = 1
const WEIGHT_PREFIX = 0.6
const WEIGHT_FRAGMENT = 0.3

/**
 * Ranks `docs` ({ content, createdAt?, pinned? … }) against `query`. Returns the matching docs, best first, each as
 * `{ doc, score, matched, of }` — `matched` of the query's `of` words were found. Order: more words matched first,
 * then higher score, then pinned, then newest; the same inputs always give the same order.
 * A query made only of stop words falls back to a plain accent-insensitive "contains".
 */
export const rank = (docs, query) => {
  const q = tokens(query)
  const list = Array.isArray(docs) ? docs : []
  if (q.length === 0) {
    const needle = normalize(query)
    if (needle === '') return []
    return list.filter((d) => normalize(d.content).indexOf(needle) >= 0).map((doc) => ({ doc, score: 1, matched: 1, of: 1 })).sort(tieBreak)
  }
  const qUnique = Array.from(new Set(q))
  const prepared = list.map((doc) => {
    const norm = normalize(doc.content)
    const toks = norm.split(' ').filter((t) => t.length > 1 && !STOP.has(t)).map(stem)
    const tf = new Map()
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1)
    return { doc, norm, toks, tf }
  })
  // document frequency of each query word, counted the same way it will be matched
  const n = Math.max(1, prepared.length)
  const idf = new Map()
  for (const qt of qUnique) {
    let df = 0
    for (const p of prepared) if (p.tf.has(qt)) df += 1
    idf.set(qt, Math.log(1 + n / (1 + df)))
  }
  const out = []
  for (const p of prepared) {
    let score = 0
    let matched = 0
    for (const qt of qUnique) {
      let w = 0
      if (p.tf.has(qt)) w = WEIGHT_EXACT * (1 + Math.log(p.tf.get(qt)))
      else if (qt.length >= 3 && p.toks.some((t) => t.length >= 3 && (t.startsWith(qt) || qt.startsWith(t)))) w = WEIGHT_PREFIX
      else if (qt.length >= 3 && p.norm.indexOf(qt) >= 0) w = WEIGHT_FRAGMENT
      if (w > 0) { matched += 1; score += w * idf.get(qt) }
    }
    if (matched === 0) continue
    // a long memory that mentions the words in passing ranks under a short one about them
    score /= 1 + 0.1 * Math.log(1 + p.toks.length)
    out.push({ doc: p.doc, score, matched, of: qUnique.length })
  }
  return out.sort(tieBreak)
}

const when = (d) => { const t = Date.parse(String(d.createdAt === undefined ? '' : d.createdAt).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')); return Number.isFinite(t) ? t : 0 }
const tieBreak = (a, b) => (b.matched - a.matched) || (b.score - a.score) || ((b.doc.pinned === true ? 1 : 0) - (a.doc.pinned === true ? 1 : 0)) || (when(b.doc) - when(a.doc))
