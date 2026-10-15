// The search itself: accent- and case-insensitive, every word must be there (in the title or the text), the title counts more,
// a phrase counts more, newer counts a little more. A linear scan: the text of a person's chats is a few megabytes (measured: ~8 MB
// for 1,700 chats), so an inverted index would buy nothing and cost a dependency or a flag.

/** Lower-case and strip accents, ONE character for one character (so offsets found in the folded text are offsets in the original).
 *  Built with a single `replace` (a flat string): appending character by character leaves a rope of one node per character, which
 *  measured 480 MB of heap for 15 M characters. */
const NEEDS_FOLD = /[A-Z]|[^\x00-\x7f]/g
const foldChar = (c) => {
  const code = c.charCodeAt(0)
  if (code < 128) return String.fromCharCode(code + 32)
  const f = c.normalize('NFD')[0].toLowerCase()
  return f.length === 1 ? f : c
}
export function fold (s) {
  return String(s).replace(NEEDS_FOLD, foldChar)
}

/** The words of a query: folded, distinct, at most 6, none empty. */
export function queryTerms (q) {
  const seen = new Set()
  const out = []
  for (const w of fold(String(q ?? '')).split(/\s+/)) {
    if (w === '' || seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= 6) break
  }
  return out
}

const count = (hay, needle, cap) => {
  let n = 0
  let at = 0
  while (n < cap) {
    at = hay.indexOf(needle, at)
    if (at < 0) break
    n += 1
    at += needle.length
  }
  return n
}

/** All [start, end) ranges of the terms in a folded text, merged, ascending. */
export function marksOf (folded, terms) {
  const r = []
  for (const t of terms) {
    let at = 0
    for (let k = 0; k < 40; k += 1) {
      at = folded.indexOf(t, at)
      if (at < 0) break
      r.push([at, at + t.length])
      at += t.length
    }
  }
  r.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged = []
  for (const x of r) {
    const last = merged[merged.length - 1]
    if (last !== undefined && x[0] <= last[1]) last[1] = Math.max(last[1], x[1])
    else merged.push([x[0], x[1]])
  }
  return merged
}

/** A long token that mixes letters and digits is almost always a key or a token: it is never shown in a result (the chat itself
 *  still holds it; this is only about what the popup puts on a screen). Same length, so the marks stay aligned. */
export function maskSecrets (t) {
  return String(t).replace(/[A-Za-z0-9_\-|+/=]{28,}/g, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? '\u2022'.repeat(m.length) : m))
}

/** A window of ~220 characters around the first match, on word edges, with the marks re-based on it. */
export function snippet (text, folded, terms, before = 70, after = 150) {
  let first = -1
  for (const t of terms) { const i = folded.indexOf(t); if (i >= 0 && (first < 0 || i < first)) first = i }
  if (first < 0) first = 0
  let a = Math.max(0, first - before)
  let b = Math.min(text.length, first + after)
  if (a > 0) { const sp = text.indexOf(' ', a); if (sp >= 0 && sp < first) a = sp + 1 }
  if (b < text.length) { const sp = text.lastIndexOf(' ', b); if (sp > first) b = sp }
  const win = maskSecrets(text.slice(a, b).replace(/\s+/g, ' '))
  // collapsing whitespace may shift offsets: fold the window again and re-find the terms there
  const marks = marksOf(fold(win), terms)
  return { text: win, marks, pre: a > 0, post: b < text.length }
}

/**
 * A searchable document: { scope, id, title, parts: [{ r, ts, t }], meta, open, ts }.
 * `prepare` adds the folded copies once (kept in memory, never persisted).
 */
export function prepare (doc) {
  return { ...doc, titleF: fold(doc.title ?? ''), parts: doc.parts.map((p) => ({ ...p, f: fold(p.t) })) }
}

/**
 * @param {object[]} docs prepared documents
 * @param {string} q
 * @param {{ scopes?: string[], limit?: number, perScope?: number, now?: number }} opts
 */
export function search (docs, q, opts = {}) {
  const terms = queryTerms(q)
  if (terms.length === 0) return { terms, results: [], counts: {} }
  const scopes = Array.isArray(opts.scopes) && opts.scopes.length > 0 ? new Set(opts.scopes) : null
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 200) : 60
  const perScope = Number.isInteger(opts.perScope) && opts.perScope > 0 ? Math.min(opts.perScope, 100) : 20
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const phrase = terms.length > 1 ? terms.join(' ') : null
  const scored = []
  const counts = {}
  for (const d of docs) {
    if (scopes !== null && !scopes.has(d.scope)) continue
    let score = 0
    let ok = true
    for (const t of terms) {
      const inTitle = d.titleF.includes(t)
      let inBody = 0
      for (const p of d.parts) { if (p.f.includes(t)) { inBody += count(p.f, t, 6) } }
      if (!inTitle && inBody === 0) { ok = false; break }
      score += (inTitle ? 6 : 0) + Math.min(10, inBody)
    }
    if (!ok) continue
    if (phrase !== null && (d.titleF.includes(phrase) || d.parts.some((p) => p.f.includes(phrase)))) score += 8
    if (typeof d.ts === 'number') {
      const days = Math.max(0, (now - d.ts) / 86400000)
      score += Math.max(0, 3 - days / 60)
    }
    counts[d.scope] = (counts[d.scope] || 0) + 1
    scored.push({ d, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const taken = {}
  const results = []
  for (const { d, score } of scored) {
    if ((taken[d.scope] || 0) >= perScope) continue
    taken[d.scope] = (taken[d.scope] || 0) + 1
    // the parts that hold the terms: those with ALL of them first, then any
    const withAll = d.parts.filter((p) => terms.every((t) => p.f.includes(t)))
    const withAny = d.parts.filter((p) => !withAll.includes(p) && terms.some((t) => p.f.includes(t)))
    const chosen = withAll.concat(withAny).slice(0, 3)
    const hits = chosen.map((p) => ({ r: p.r, ts: p.ts ?? null, ...snippet(p.t, p.f, terms) }))
    results.push({
      scope: d.scope,
      id: d.id,
      title: d.title,
      titleMarks: marksOf(d.titleF, terms),
      meta: d.meta ?? {},
      open: d.open ?? null,
      score: Math.round(score * 10) / 10,
      hits
    })
    if (results.length >= limit) break
  }
  return { terms, results, counts }
}
