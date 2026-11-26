#!/usr/bin/env node
// Case J18-09 of docs/tests/user-journey: the look matrix, chosen so that every PAIR of values from two different factors appears in at least one row.
// A full product of 11 languages x 6 themes x 3 widths x 8 page types is 1,584 pictures; a pairwise cover needs at least 11 x 6 = 66 rows (the two biggest factors alone), and this greedy cover lands a little above.
//
//   node scripts/pairwise.mjs [--json] [--width-first]
//
// The cover is deterministic (no random choice): the same factors give the same rows, so two runs of the recette look at the same screens.
import { pathToFileURL } from 'node:url'

export const LOOK_FACTORS = [
  { name: 'language', values: ['en', 'fr', 'ar', 'de', 'es', 'hi', 'it', 'ja', 'pt', 'ru', 'zh'] },
  { name: 'theme', values: ['default-dark', 'default-light', 'default', 'e-commerce', 'real-estate', 'recruitment'] },
  { name: 'width', values: [390, 768, 1440] },
  { name: 'page', values: ['new-chat', 'skills', 'creations', 'automations', 'account-menu', 'settings', 'usage', 'plan'] }
]

/** Every pair `[factor a, value a, factor b, value b]` (a < b) of a list of factors, as keys. Pure. */
export function allPairs (factors) {
  const keys = []
  for (let a = 0; a < factors.length; a++) {
    for (let b = a + 1; b < factors.length; b++) {
      for (let i = 0; i < factors[a].values.length; i++) for (let j = 0; j < factors[b].values.length; j++) keys.push(`${a}:${i}|${b}:${j}`)
    }
  }
  return keys
}

/** The rows (each an array of value indexes, one per factor) of a deterministic greedy pairwise cover. Pure. */
export function coverRows (factors) {
  const sizes = factors.map((f) => f.values.length)
  const left = new Set(allPairs(factors))
  const rows = []
  while (left.size > 0) {
    const [first] = left
    const [pa, pb] = first.split('|').map((s) => s.split(':').map(Number))
    const row = new Array(factors.length).fill(-1)
    row[pa[0]] = pa[1]
    row[pb[0]] = pb[1]
    // The other factors, one at a time: the value that meets the most pairs still uncovered with the values already chosen.
    for (let f = 0; f < factors.length; f++) {
      if (row[f] !== -1) continue
      let best = 0
      let bestGain = -1
      for (let v = 0; v < sizes[f]; v++) {
        let gain = 0
        for (let g = 0; g < factors.length; g++) {
          if (g === f || row[g] === -1) continue
          const key = g < f ? `${g}:${row[g]}|${f}:${v}` : `${f}:${v}|${g}:${row[g]}`
          if (left.has(key)) gain += 1
        }
        if (gain > bestGain) { bestGain = gain; best = v }
      }
      row[f] = best
    }
    for (let a = 0; a < factors.length; a++) for (let b = a + 1; b < factors.length; b++) left.delete(`${a}:${row[a]}|${b}:${row[b]}`)
    rows.push(row)
  }
  return rows
}

/** The look matrix as a list of `{ language, theme, width, page }` objects. */
export function lookMatrix (factors = LOOK_FACTORS) {
  return coverRows(factors).map((row) => Object.fromEntries(factors.map((f, i) => [f.name, f.values[row[i]]])))
}

/** The pairs a matrix leaves uncovered, as sentences (empty when it is a cover). Pure. */
export function uncovered (factors, matrix) {
  const seen = new Set()
  for (const m of matrix) {
    for (let a = 0; a < factors.length; a++) for (let b = a + 1; b < factors.length; b++) {
      seen.add(`${a}:${factors[a].values.indexOf(m[factors[a].name])}|${b}:${factors[b].values.indexOf(m[factors[b].name])}`)
    }
  }
  return allPairs(factors).filter((k) => !seen.has(k)).map((k) => {
    const [x, y] = k.split('|').map((s) => s.split(':').map(Number))
    return `${factors[x[0]].name}=${factors[x[0]].values[x[1]]} with ${factors[y[0]].name}=${factors[y[0]].values[y[1]]}`
  })
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const matrix = lookMatrix()
  if (process.argv.includes('--json')) console.log(JSON.stringify(matrix, null, 2))
  else {
    console.log(`J18-09 look matrix: ${matrix.length} combinations (a full product would be ${LOOK_FACTORS.reduce((n, f) => n * f.values.length, 1)})`)
    for (const m of matrix) console.log(`  ${m.language}  ${m.theme.padEnd(13)} ${String(m.width).padStart(4)}  ${m.page}`)
  }
}
