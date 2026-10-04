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
  // French: articles, pronouns, possessives, prepositions, conjunctions, and the verbs people use to ASK ("peux", "fais")
  'le la les un une des de du d l et ou a au aux en dans sur sous pour par que qui quoi dont ne pas est sont etre ete avoir ai as ont se sa son ses ce cet cette ces il elle on nous vous ils elles je tu toi moi y' +
  ' mon ma mes ton ta tes notre nos votre vos leur leurs lui eux ca cela ceci celui celle si tout tous toute toutes plus moins tres bien alors donc mais comme avec sans vers chez entre quand comment pourquoi ou est-ce' +
  ' peux peut peuvent veux veut faire fais fait donne dis dit voir vois va vas vont aller etc svp stp' +
  // English: articles, pronouns, auxiliaries, question words, politeness
  ' the a an of and or to in on for with is are was were be been it its this that these those by as at from i me my you your we our they them his her' +
  ' do does did done can could would should will shall may might have has had having not no yes please what how why when where which who whom there here also just very'
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

/** A word that counts: 2+ characters or a single digit ("lesson 3"), and not a stop word. */
const keep = (t) => (t.length > 1 || (t.length === 1 && t >= '0' && t <= '9')) && !STOP.has(t)

/** The words of a text that count: normalised, stop words out, folded. A lone letter never counts. */
export const tokens = (text) => normalize(text).split(' ').filter(keep).map(stem)

/**
 * A query word matches a memory word as a prefix when (a) the user typed the START of the memory's word ("doc" →
 * "docker"), or (b) the memory's word is most of the query's word ("docker" for "dockerfile"). A short memory word
 * that merely begins the query's word does not count: "com" (from an address) is not "communique".
 */
const prefixMatch = (qt, t) => t.length >= 3 && (t.startsWith(qt) || (t.length >= 4 && qt.startsWith(t) && t.length / qt.length >= 0.6))

const WEIGHT_EXACT = 1
const WEIGHT_PREFIX = 0.6
const WEIGHT_FRAGMENT = 0.3

/**
 * Ranks `docs` ({ content, createdAt?, pinned? … }) against `query`. Returns the matching docs, best first, each as
 * `{ doc, score, matched, of }` — `matched` of the query's `of` words were found. Order: more words matched first,
 * then higher score, then pinned, then newest; the same inputs always give the same order.
 * A query made only of stop words falls back to a plain accent-insensitive "contains".
 *
 * `options.maxTerms` keeps only that many query words, the rarest (most informative) ones: a pasted paragraph is
 * judged by its distinctive words, not by "the" and "file". Each result also carries `coverage`, 0..1: the share of
 * the kept words' rarity that the memory has (exact word 1, prefix 0.6, fragment 0.3) — a threshold on it says
 * "this memory is about the question", where `score` only orders.
 */
export const rank = (docs, query, options = {}) => {
  const q = tokens(query)
  const list = Array.isArray(docs) ? docs : []
  if (q.length === 0) {
    const needle = normalize(query)
    if (needle === '') return []
    return list.filter((d) => normalize(d.content).indexOf(needle) >= 0).map((doc) => ({ doc, score: 1, matched: 1, of: 1 })).sort(tieBreak)
  }
  let qUnique = Array.from(new Set(q))
  const prepared = list.map((doc) => {
    const norm = normalize(doc.content)
    const toks = norm.split(' ').filter(keep).map(stem)
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
  if (Number.isFinite(options.maxTerms) && options.maxTerms >= 1 && qUnique.length > options.maxTerms) {
    // The words that CAN match something come first (a word nobody ever wrote is the "rarest" and the most useless),
    // then the rarest of those; the original order breaks ties, so the same query always keeps the same words.
    const canMatch = (qt) => idf.get(qt) < Math.log(1 + n) || (qt.length >= 3 && prepared.some((p) => p.toks.some((t) => prefixMatch(qt, t)) || p.norm.indexOf(qt) >= 0))
    qUnique = qUnique.map((qt, i) => ({ qt, i, ok: canMatch(qt) })).sort((a, b) => (Number(b.ok) - Number(a.ok)) || (idf.get(b.qt) - idf.get(a.qt)) || (a.i - b.i)).slice(0, Math.floor(options.maxTerms)).sort((a, b) => a.i - b.i).map((x) => x.qt)
  }
  let idfTotal = 0
  for (const qt of qUnique) idfTotal += idf.get(qt)
  const out = []
  for (const p of prepared) {
    let score = 0
    let matched = 0
    let covered = 0
    for (const qt of qUnique) {
      let w = 0
      if (p.tf.has(qt)) w = WEIGHT_EXACT * (1 + Math.log(p.tf.get(qt)))
      else if (qt.length >= 3 && p.toks.some((t) => prefixMatch(qt, t))) w = WEIGHT_PREFIX
      else if (qt.length >= 3 && p.norm.indexOf(qt) >= 0) w = WEIGHT_FRAGMENT
      if (w > 0) { matched += 1; score += w * idf.get(qt); covered += Math.min(1, w) * idf.get(qt) }
    }
    if (matched === 0) continue
    // a long memory that mentions the words in passing ranks under a short one about them
    score /= 1 + 0.1 * Math.log(1 + p.toks.length)
    out.push({ doc: p.doc, score, matched, of: qUnique.length, coverage: idfTotal > 0 ? covered / idfTotal : 0 })
  }
  return out.sort(tieBreak)
}

const when = (d) => { const t = Date.parse(String(d.createdAt === undefined ? '' : d.createdAt).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')); return Number.isFinite(t) ? t : 0 }
const tieBreak = (a, b) => (b.matched - a.matched) || (b.score - a.score) || ((b.doc.pinned === true ? 1 : 0) - (a.doc.pinned === true ? 1 : 0)) || (when(b.doc) - when(a.doc))
