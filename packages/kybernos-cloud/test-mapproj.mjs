#!/usr/bin/env node
// The memory map, the pure half (mapproj.mjs): vectors kept on disk, 2-D positions, clusters and their names, links.
//   node packages/kybernos-cloud/test-mapproj.mjs
import assert from 'node:assert/strict'
import { MAP_TUNING, textHash, packVector, unpackVector, centreVectors, similarities, pca2, place, pickK, kmeans, labelClusters, links, buildMap } from './mapproj.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// A deterministic « embedding »: a bag of hashed words (no short words) over 512 dimensions, so texts that share words are close.
const DIM = 512
const embed = (text) => {
  const v = new Float64Array(DIM)
  for (const w of String(text).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3)) {
    let h = 2166136261
    for (const ch of w) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
    v[h % DIM] += 1
    v[(h >>> 8) % DIM] += 0.5
  }
  return v
}
const TOPICS = {
  database: ['The staging database is reset every night at midnight', 'Seed files reach the database only when it is empty', 'Run the database migration before the seed files', 'The database password lives in the secrets vault', 'Backups of the database are kept for thirty days', 'A database migration must be idempotent'],
  mobile: ['The Expo app is captured through the simulator screenshots', 'Mobile screenshots of the Expo app need the simulator running', 'The Expo simulator keeps a frozen bundle when CI is set', 'Expo app builds on the simulator take two minutes', 'Mobile Expo app icons come from the design folder', 'Screenshots from the simulator are not stored in git'],
  billing: ['Stripe invoices are paid after the checkout completes', 'The billing webhook confirms the Stripe payment intent', 'Failed Stripe payments move the subscription to past due', 'Billing credits are topped up after a Stripe checkout', 'A Stripe refund is a negative billing credit', 'Test Stripe customers live in the billing sandbox'],
}
const items = []
for (const [topic, texts] of Object.entries(TOPICS)) texts.forEach((t, i) => items.push({ id: topic + '-' + i, text: t, topic }))
const vectors = items.map((it) => embed(it.text))

console.log('vectors on disk')
assert.equal(textHash('abc'), textHash('abc'))
assert.notEqual(textHash('abc'), textHash('abd'))
assert.equal(textHash('abc').length, 20)
const v0 = Float64Array.from({ length: 1024 }, (_, i) => Math.sin(i) * 0.04)
const back = unpackVector(packVector(v0), 1024)
assert.equal(back.length, 1024)
const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2 } return d / Math.sqrt(na * nb) }
assert.ok(cos(v0, back) > 0.9999, 'int8 keeps the direction (' + cos(v0, back) + ')')
assert.ok(packVector(v0).q.length < 1500, 'about 1.4 KB a vector in base64')
assert.equal(unpackVector(packVector(v0), 512), null, 'a vector of another size is refused')
assert.equal(unpackVector(null, 1024), null)
assert.equal(unpackVector({ q: 3, s: 1 }, 4), null)
assert.equal(unpackVector({ q: 'AAAA', s: NaN }, 3), null)
assert.deepEqual(Array.from(unpackVector(packVector(new Float64Array(4)), 4)), [0, 0, 0, 0], 'a zero vector stays zero, no NaN')
ok('a vector is kept as int8 + scale (1.4 KB), comes back in the same direction, and anything else than a vector of the right size is refused')

console.log('positions')
const raw = pca2(vectors)
assert.equal(raw.length, items.length)
assert.ok(raw.every((p) => p.length === 2 && p.every(Number.isFinite)))
assert.deepEqual(pca2(vectors), raw, 'same input, same output')
assert.deepEqual(pca2([]), [])
assert.deepEqual(pca2([embed('alone')]), [[0, 0]])
const same = pca2([embed('same'), embed('same'), embed('same')])
assert.ok(same.every((p) => p.every((x) => Math.abs(x) < 1e-6)), 'identical points: no variance, no NaN')
const placed = place(raw)
assert.ok(placed.every((p) => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1), 'inside the drawing')
let minD = Infinity
for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) minD = Math.min(minD, Math.hypot((placed[a].x - placed[b].x) * MAP_TUNING.width, (placed[a].y - placed[b].y) * MAP_TUNING.height))
assert.ok(minD >= MAP_TUNING.minGap - 0.5, 'no two dots on top of each other (' + minD.toFixed(1) + ')')
const pile = place(Array.from({ length: 12 }, () => [0.5, 0.5]))
assert.equal(new Set(pile.map((p) => p.x.toFixed(4) + ':' + p.y.toFixed(4))).size, 12, 'twelve dots on one spot are all pulled apart')
const many = place(Array.from({ length: 150 }, (_, i) => [Math.cos(i) * (1 + i / 150), Math.sin(i * 1.3)]))
assert.ok(many.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) && many.length === 150)
const withOutlier = place([...Array.from({ length: 40 }, (_, i) => [i / 40, (i % 5) / 5]), [1000, 1000]])
assert.ok(Math.max(...withOutlier.slice(0, 40).map((p) => p.x)) - Math.min(...withOutlier.slice(0, 40).map((p) => p.x)) > 0.5, 'a far outlier does not squash everybody else')
ok('positions: deterministic, finite, inside the drawing, dots never stacked, identical points and outliers handled')

console.log('clusters')
const topicOf = items.map((it) => it.topic)
const centred = centreVectors(vectors)
const sims = similarities(centred)
assert.ok(sims.every((row, i) => Math.abs(row[i] - 1) < 1e-9) && sims[0][1] === sims[1][0])
const k = pickK(items.length)
assert.equal(pickK(3), 1)
assert.equal(pickK(7), 1)
assert.ok(pickK(8) >= 2 && pickK(150) <= MAP_TUNING.clusterMax && pickK(10000) === MAP_TUNING.clusterMax)
const assign = kmeans(centred, 3)
assert.deepEqual(kmeans(centred, 3), assign, 'deterministic')
const together = (topic) => new Set(assign.filter((_, i) => topicOf[i] === topic)).size
assert.ok(['database', 'mobile', 'billing'].every((t) => together(t) === 1), 'each topic ends in one cluster: ' + JSON.stringify(assign))
assert.equal(new Set(assign).size, 3)
assert.deepEqual(kmeans(centred, 1), vectors.map(() => 0))
assert.deepEqual(kmeans([], 3), [])
assert.deepEqual(kmeans([embed('a one'), embed('b two')], 5), [0, 1], 'fewer points than clusters: one each')
const sizes = [0, 1, 2].map((c) => assign.filter((a) => a === c).length)
assert.ok(sizes[0] >= sizes[1] && sizes[1] >= sizes[2], 'numbered from the biggest')
ok('k-means finds the topics, is deterministic, and numbers the clusters from the biggest')

console.log('names')
const names = labelClusters(items.map((it) => it.text), assign, 3)
const nameOf = (topic) => names[assign[items.findIndex((it) => it.topic === topic)]]
assert.match(nameOf('database'), /database/, nameOf('database'))
assert.match(nameOf('mobile'), /expo|simulator|screenshots/, nameOf('mobile'))
assert.match(nameOf('billing'), /stripe|billing/, nameOf('billing'))
assert.ok(names.every((n) => n.split(' · ').length <= MAP_TUNING.labelWords))
assert.ok(names.every((n) => n === n.toLowerCase()), 'words as written, lower case')
assert.deepEqual(labelClusters(items.map((it) => it.text), assign, 3), names)
assert.equal(labelClusters(['a b', 'c d'], [0, 0], 1)[0], '', 'nothing to name: an empty label, not a crash')
const accents = labelClusters(['La préférence de langue française', 'Une préférence de langue anglaise', 'La préférence de couleur sombre', 'Une préférence de couleur claire'], [0, 0, 0, 0], 1)[0]
assert.match(accents, /préférence/, 'the words keep their accents: ' + accents)
ok('each cluster is named by the words that set it apart, as they are written (accents kept)')

console.log('links')
const lk = links(sims, assign)
assert.ok(lk.length > 0 && lk.every(([a, b]) => a < b && assign[a] === assign[b]), 'only inside a cluster')
assert.equal(new Set(lk.map((p) => p.join(':'))).size, lk.length, 'each pair once')
assert.ok(lk.every(([a, b]) => sims[a][b] >= MAP_TUNING.linkMinSimilarity))
assert.ok(links(sims, assign, 2, 0.99999).length < lk.length, 'only alike enough')
assert.deepEqual(links([], []), [])
ok('links join near neighbours of the same cluster, each pair once')

console.log('the whole map')
const map = buildMap(items, vectors)
assert.equal(map.nodes.length, items.length)
assert.deepEqual(map.nodes.map((n) => n.id), items.map((it) => it.id), 'nodes come back in the order of the items')
assert.ok(map.nodes.every((n) => n.x > 0 && n.x < 1 && n.y > 0 && n.y < 1 && Number.isInteger(n.cl)))
assert.equal(map.clusters.reduce((a, c) => a + c.size, 0), items.length)
assert.ok(map.clusters.every((c) => c.cx > 0 && c.cx < 1 && c.cy > 0 && c.cy < 1 && typeof c.label === 'string'))
assert.ok(map.links.every(([a, b]) => a < b && b < items.length))
// the topics are apart on the page: each dot is closer to the centre of its own topic than to another topic's centre
const centre = (topic) => { const m = map.nodes.filter((_, i) => topicOf[i] === topic); return [m.reduce((a, n) => a + n.x, 0) / m.length, m.reduce((a, n) => a + n.y, 0) / m.length] }
const dist = (n, c) => Math.hypot((n.x - c[0]) * MAP_TUNING.width, (n.y - c[1]) * MAP_TUNING.height)
const centres = Object.fromEntries(Object.keys(TOPICS).map((t) => [t, centre(t)]))
let nearest = 0
map.nodes.forEach((n, i) => { const best = Object.keys(TOPICS).sort((a, b) => dist(n, centres[a]) - dist(n, centres[b]))[0]; if (best === topicOf[i]) nearest += 1 })
assert.ok(nearest >= items.length - 1, 'close dots mean close meaning: ' + nearest + ' of ' + items.length + ' sit nearest their own topic')
// the picture does not depend on the order the sample came in
const shuffled = items.map((_, i) => i).sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13))
const m2 = buildMap(shuffled.map((i) => items[i]), shuffled.map((i) => vectors[i]))
const byId = new Map(map.nodes.map((n) => [n.id, n]))
assert.ok(m2.nodes.every((n) => Math.abs(n.x - byId.get(n.id).x) < 1e-9 && Math.abs(n.y - byId.get(n.id).y) < 1e-9 && true), 'the same dots at the same places whatever the order')
assert.deepEqual(buildMap(items, vectors), map, 'deterministic')
assert.deepEqual(buildMap([], []), { nodes: [], clusters: [], links: [] })
const one = buildMap([items[0]], [vectors[0]])
assert.equal(one.nodes.length, 1)
assert.ok(one.nodes[0].x > 0 && one.nodes[0].x < 1)
const two = buildMap(items.slice(0, 2), vectors.slice(0, 2))
assert.equal(two.nodes.length, 2)
assert.ok(two.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)))
const big = Array.from({ length: 150 }, (_, i) => ({ id: 'm' + i, text: 'memory number ' + i + ' about ' + ['sql', 'expo', 'stripe', 'react', 'docker'][i % 5] + ' topic ' + (i % 7) }))
const t0 = Date.now()
const bigMap = buildMap(big, big.map((b) => embed(b.text)))
assert.ok(Date.now() - t0 < 3000, 'a full sample of 150 takes ' + (Date.now() - t0) + ' ms')
assert.equal(bigMap.nodes.length, 150)
assert.ok(bigMap.clusters.length >= 2 && bigMap.clusters.length <= MAP_TUNING.clusterMax)
ok('the map: nodes in the items\' order, topics apart, independent of the sample\'s order, deterministic, edge cases, 150 in well under 3 s')

console.log('\n' + pass + ' verifications OK')
