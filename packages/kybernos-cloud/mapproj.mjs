// The memory map, the pure half: from the embedding vectors of a sample of memories to 2-D positions, clusters, a label per cluster and
// the links between near neighbours. No network, no file: kybernos-cloud's index.js embeds the texts, keeps the vectors and calls this.
//
// Close dots mean close meaning: the positions are the first two principal components of the vectors (computed on the Gram matrix,
// the sample is at most a few hundred points), spread a little so dots never sit on top of each other. Everything is deterministic: the
// same sample gives the same map, whatever the order it came in.
import { createHash } from 'node:crypto'
import { tokens } from './relevance.mjs'

export const MAP_TUNING = {
  sample: 150,            // dots drawn at most
  width: 1000,            // the drawing's own units (the page's viewBox is 1000 x 540)
  height: 540,
  marginX: 50,
  marginY: 56,
  minGap: 17,             // dots closer than this are pushed apart
  clusterMax: 6,
  starts: 8,              // k-means is run from this many starts, the tightest wins
  labelWords: 2,
  neighbours: 2,          // each dot links to its nearest ones of its own cluster
  linkMinSimilarity: 0.2,
  power: 300,             // iterations of the power method
  seed: 7,
}

// ── vectors kept on disk: int8 with a scale (1 KB a vector instead of 8), keyed by a hash of the text ──

export const textHash = (text) => createHash('sha1').update(String(text), 'utf8').digest('hex').slice(0, 20)

export const packVector = (v) => {
  let max = 0
  for (const x of v) if (Math.abs(x) > max) max = Math.abs(x)
  const scale = max > 0 ? max / 127 : 1
  const bytes = Buffer.alloc(v.length)
  for (let i = 0; i < v.length; i++) bytes.writeInt8(Math.max(-127, Math.min(127, Math.round(v[i] / scale))), i)
  return { s: Number(scale.toPrecision(8)), q: bytes.toString('base64') }
}

/** The vector back, or null when what was stored is not a vector of `dim` numbers. */
export const unpackVector = (p, dim) => {
  if (p === null || typeof p !== 'object' || typeof p.q !== 'string' || typeof p.s !== 'number' || !Number.isFinite(p.s)) return null
  const bytes = Buffer.from(p.q, 'base64')
  if (dim !== undefined && bytes.length !== dim) return null
  const out = new Float64Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) out[i] = bytes.readInt8(i) * p.s
  return out
}

// ── small linear algebra ──

const rngOf = (seed) => {            // mulberry32
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

const unit = (v) => {
  const n = Math.sqrt(dot(v, v))
  const out = new Float64Array(v.length)
  if (n > 0) for (let i = 0; i < v.length; i++) out[i] = v[i] / n
  return out
}

/** The unit vectors minus their mean: what is left once the background every text shares (embeddings are never spread over the whole sphere) is removed. */
export const centreVectors = (vectors) => {
  const N = vectors.map(unit)
  if (N.length === 0) return []
  const mean = new Float64Array(N[0].length)
  for (const v of N) for (let d = 0; d < mean.length; d++) mean[d] += v[d] / N.length
  return N.map((v) => v.map((x, d) => x - mean[d]))
}

/** Cosine similarities of every pair, as n x n rows (the vectors are normalised first). */
export const similarities = (vectors) => {
  const U = vectors.map(unit)
  const n = U.length
  const G = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    G[i][i] = U[i].some((x) => x !== 0) ? 1 : 0
    for (let j = i + 1; j < n; j++) { const s = dot(U[i], U[j]); G[i][j] = s; G[j][i] = s }
  }
  return G
}

const centered = (G) => {            // double centring: the Gram matrix of the points minus their mean
  const n = G.length
  const rm = G.map((row) => row.reduce((a, b) => a + b, 0) / n)
  const tm = rm.reduce((a, b) => a + b, 0) / n
  return G.map((row, i) => Float64Array.from(row, (x, j) => x - rm[i] - rm[j] + tm))
}

/** The `count` largest eigenpairs of a symmetric matrix, by the power method with deflation. */
const topEigen = (M, count, rng) => {
  const n = M.length
  const A = M.map((r) => Float64Array.from(r))
  const out = []
  for (let c = 0; c < count; c++) {
    let u = unit(Float64Array.from({ length: n }, () => rng() - 0.5))
    let lambda = 0
    for (let it = 0; it < MAP_TUNING.power; it++) {
      const w = new Float64Array(n)
      for (let i = 0; i < n; i++) w[i] = dot(A[i], u)
      const norm = Math.sqrt(dot(w, w))
      if (norm < 1e-12) { lambda = 0; break }
      const next = w.map((x) => x / norm)
      const moved = Math.sqrt(next.reduce((a, x, i) => a + (x - u[i]) ** 2, 0))
      u = next; lambda = norm
      if (moved < 1e-10) break
    }
    // a fixed sign, so the picture does not flip from one run to the next
    let big = 0
    for (let i = 0; i < n; i++) if (Math.abs(u[i]) > Math.abs(u[big])) big = i
    if (u[big] < 0) u = u.map((x) => -x)
    out.push({ u, lambda })
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i][j] -= lambda * u[i] * u[j]
  }
  return out
}

/** Raw 2-D coordinates (principal components) for the vectors: [[x, y], …]. */
export const pca2 = (vectors, seed = MAP_TUNING.seed, sims = similarities(vectors)) => {
  const n = vectors.length
  if (n === 0) return []
  if (n === 1) return [[0, 0]]
  const rng = rngOf(seed)
  const [e1, e2] = topEigen(centered(sims), 2, rng)
  const s1 = Math.sqrt(Math.max(e1.lambda, 0)), s2 = Math.sqrt(Math.max(e2.lambda, 0))
  return Array.from({ length: n }, (_, i) => [e1.u[i] * s1, e2.u[i] * s2])
}

// ── placing the dots in the drawing ──

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]

/** Raw coordinates → pixels of the drawing (clipping the 2 % of far outliers so they do not squash everybody else), then spread. */
export const place = (raw, tuning = MAP_TUNING) => {
  const n = raw.length
  if (n === 0) return []
  const W = tuning.width, H = tuning.height
  const axis = (k, lo, hi) => {
    const col = raw.map((p) => p[k]).sort((a, b) => a - b)
    const a = n >= 20 ? percentile(col, 0.02) : col[0], b = n >= 20 ? percentile(col, 0.98) : col[n - 1]
    const span = b - a
    return (x) => (span > 1e-12 ? lo + ((Math.min(b, Math.max(a, x)) - a) / span) * (hi - lo) : (lo + hi) / 2)
  }
  const fx = axis(0, tuning.marginX, W - tuning.marginX)
  const fy = axis(1, tuning.marginY, H - tuning.marginY)
  const pts = raw.map((p, i) => ({ x: fx(p[0]), y: fy(p[1]), i }))
  // a point that sits exactly on another one (same text twice, an empty axis) gets a tiny, deterministic offset
  const angle = (i) => i * 2.399963
  for (let pass = 0; pass < 80; pass++) {
    let moved = false
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        let dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y
        let d = Math.hypot(dx, dy)
        if (d >= tuning.minGap) continue
        if (d < 1e-6) { dx = Math.cos(angle(b)); dy = Math.sin(angle(b)); d = 1 }
        const push = (tuning.minGap - d) / 2
        const ux = dx / d, uy = dy / d
        pts[a].x -= ux * push; pts[a].y -= uy * push
        pts[b].x += ux * push; pts[b].y += uy * push
        moved = true
      }
    }
    for (const p of pts) { p.x = Math.min(W - tuning.marginX / 2, Math.max(tuning.marginX / 2, p.x)); p.y = Math.min(H - tuning.marginY / 2, Math.max(tuning.marginY / 2, p.y)) }
    if (!moved) break
  }
  return pts.map((p) => ({ x: p.x / W, y: p.y / H }))
}

// ── clusters and their names ──

export const pickK = (n) => (n < 8 ? 1 : Math.max(2, Math.min(MAP_TUNING.clusterMax, Math.round(Math.sqrt(n / 2)))))

/** One k-means run on unit vectors from a k-means++ start: { assign, inertia } (inertia = total cosine distance to the centres, lower is tighter). */
const kmeansOnce = (U, k, seed) => {
  const n = U.length
  const rng = rngOf(seed)
  const centres = [U[Math.floor(rng() * n)]]
  while (centres.length < k) {
    const d2 = U.map((u) => Math.min(...centres.map((c) => 1 - dot(u, c))) ** 2)
    const total = d2.reduce((a, b) => a + b, 0)
    if (total <= 1e-12) break
    let r = rng() * total, pick = n - 1
    for (let i = 0; i < n; i++) { r -= d2[i]; if (r <= 0) { pick = i; break } }
    centres.push(U[pick])
  }
  let assign = new Array(n).fill(0)
  for (let it = 0; it < 30; it++) {
    const next = U.map((u) => { let best = 0, bs = -Infinity; centres.forEach((c, j) => { const s = dot(u, c); if (s > bs) { bs = s; best = j } }); return best })
    const same = next.every((a, i) => a === assign[i])
    assign = next
    centres.forEach((_, j) => {
      const members = U.filter((_, i) => assign[i] === j)
      if (members.length === 0) return
      const sum = new Float64Array(U[0].length)
      for (const m of members) for (let d = 0; d < sum.length; d++) sum[d] += m[d]
      centres[j] = unit(sum)
    })
    if (same && it > 0) break
  }
  return { assign, inertia: U.reduce((a, u, i) => a + (1 - dot(u, centres[assign[i]])), 0) }
}

/**
 * k-means on the unit vectors (cosine; give it centred vectors, see centreVectors): the tightest of a few k-means++ starts, deterministic.
 * Returns one cluster number per vector, from the biggest cluster down.
 */
export const kmeans = (vectors, k, seed = MAP_TUNING.seed, starts = MAP_TUNING.starts) => {
  const n = vectors.length
  if (n === 0) return []
  if (k <= 1 || n <= k) return n <= k && k > 1 ? vectors.map((_, i) => i) : vectors.map(() => 0)
  const U = vectors.map(unit)
  let best = null
  for (let r = 0; r < starts; r++) {
    const run = kmeansOnce(U, k, seed + r * 101)
    if (best === null || run.inertia < best.inertia - 1e-12) best = run
  }
  const assign = best.assign
  // renumber from the biggest cluster, so the numbers (and the colours drawn from them) do not depend on the start
  const sizes = new Map()
  assign.forEach((a) => sizes.set(a, (sizes.get(a) || 0) + 1))
  const order = [...sizes.keys()].sort((a, b) => sizes.get(b) - sizes.get(a) || a - b)
  return assign.map((a) => order.indexOf(a))
}

const surfaceWords = (text) => String(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map((w) => ({ word: w.toLowerCase(), stem: tokens(w)[0] })).filter((x) => x.stem !== undefined)

/** A name for each cluster: the words that most set its members apart from the rest (frequent inside, rare outside), as they are written. */
export const labelClusters = (texts, assignment, count, words = MAP_TUNING.labelWords) => {
  const N = texts.length
  const docs = texts.map(surfaceWords)
  const df = new Map()
  docs.forEach((d) => new Set(d.map((x) => x.stem)).forEach((s) => df.set(s, (df.get(s) || 0) + 1)))
  const labels = []
  for (let c = 0; c < count; c++) {
    const idx = assignment.map((a, i) => (a === c ? i : -1)).filter((i) => i >= 0)
    const inside = new Map()
    const shown = new Map()
    for (const i of idx) {
      for (const s of new Set(docs[i].map((x) => x.stem))) inside.set(s, (inside.get(s) || 0) + 1)
      for (const x of docs[i]) { const m = shown.get(x.stem) || new Map(); m.set(x.word, (m.get(x.word) || 0) + 1); shown.set(x.stem, m) }
    }
    const need = idx.length >= 4 ? 2 : 1
    const ranked = [...inside.entries()].filter(([, n]) => n >= need).map(([s, n]) => [s, (n / idx.length) * Math.log(1 + N / df.get(s)) * (n / df.get(s))]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    const names = ranked.slice(0, words).map(([s]) => [...shown.get(s).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0])
    labels.push(names.join(' · '))
  }
  return labels
}

/** Links between near neighbours: each dot to its `neighbours` most alike of its own cluster, when they are alike enough. Pairs [a, b], a < b. */
export const links = (sims, assignment, neighbours = MAP_TUNING.neighbours, minSim = MAP_TUNING.linkMinSimilarity) => {
  const seen = new Set()
  const out = []
  for (let i = 0; i < sims.length; i++) {
    const near = []
    for (let j = 0; j < sims.length; j++) if (j !== i && assignment[j] === assignment[i] && sims[i][j] >= minSim) near.push(j)
    near.sort((a, b) => sims[i][b] - sims[i][a] || a - b)
    for (const j of near.slice(0, neighbours)) {
      const a = Math.min(i, j), b = Math.max(i, j), key = a + ':' + b
      if (!seen.has(key)) { seen.add(key); out.push([a, b]) }
    }
  }
  return out
}

/**
 * The whole map. `items` = [{ id, text }], `vectors` = one vector per item, same order. The result is independent of that order.
 * Returns { nodes: [{ id, x, y, cl }] (x, y in 0..1, in the order of `items`), clusters: [{ id, label, cx, cy, size }], links: [[a, b]] (indexes into nodes) }.
 */
export const buildMap = (items, vectors, tuning = MAP_TUNING) => {
  const n = items.length
  if (n === 0) return { nodes: [], clusters: [], links: [] }
  const order = items.map((_, i) => i).sort((a, b) => (String(items[a].id) < String(items[b].id) ? -1 : String(items[a].id) > String(items[b].id) ? 1 : a - b))
  const V = order.map((i) => vectors[i])
  const spots = place(pca2(V, tuning.seed), tuning)
  // clusters and links are about what sets the texts apart, so they work on the centred vectors
  const C = centreVectors(V)
  const sims = similarities(C)
  const k = pickK(n)
  const assign = kmeans(C, k, tuning.seed)
  const count = assign.length > 0 ? Math.max(...assign) + 1 : 0
  const names = labelClusters(order.map((i) => items[i].text), assign, count, tuning.labelWords)
  const nodesSorted = order.map((_, s) => ({ id: items[order[s]].id, x: spots[s].x, y: spots[s].y, cl: assign[s] }))
  const clusters = Array.from({ length: count }, (_, c) => {
    const m = nodesSorted.filter((p) => p.cl === c)
    return { id: c, label: names[c], cx: m.reduce((a, p) => a + p.x, 0) / m.length, cy: m.reduce((a, p) => a + p.y, 0) / m.length, size: m.length }
  })
  const edgesSorted = links(sims, assign, tuning.neighbours, tuning.linkMinSimilarity)
  // back to the order of `items`
  const where = new Array(n)
  order.forEach((orig, s) => { where[orig] = s })
  const nodes = items.map((_, i) => nodesSorted[where[i]])
  const back = (s) => order[s]
  const edges = edgesSorted.map(([a, b]) => { const x = back(a), y = back(b); return x < y ? [x, y] : [y, x] })
  return { nodes, clusters, links: edges }
}

