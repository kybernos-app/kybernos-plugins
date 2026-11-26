#!/usr/bin/env node
// scripts/pairwise.mjs: the look matrix is a pairwise cover, deterministic, and no larger than it needs to be by much.
import { allPairs, coverRows, LOOK_FACTORS, lookMatrix, uncovered } from './pairwise.mjs'

let fails = 0
const check = (name, ok, detail = '') => { if (!ok) fails += 1; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }

const matrix = lookMatrix()
check('every pair of values meets in some row', uncovered(LOOK_FACTORS, matrix).length === 0, uncovered(LOOK_FACTORS, matrix).slice(0, 3).join('; '))
check('the cover has at least the product of the two biggest factors (66)', matrix.length >= 66, `${matrix.length} rows`)
check('the cover stays well under the full product and under 100 rows', matrix.length < 100, `${matrix.length} rows of ${LOOK_FACTORS.reduce((n, f) => n * f.values.length, 1)}`)
check('the same factors give the same rows twice', JSON.stringify(lookMatrix()) === JSON.stringify(matrix))
check('Arabic is looked at on every theme and every width', ['theme', 'width'].every((k) => new Set(matrix.filter((m) => m.language === 'ar').map((m) => m[k])).size === LOOK_FACTORS.find((f) => f.name === k).values.length))
check('a cover of two factors is their product', coverRows([{ name: 'a', values: [1, 2, 3] }, { name: 'b', values: ['x', 'y'] }]).length === 6)
check('a single factor has nothing to pair', allPairs([{ name: 'a', values: [1, 2] }]).length === 0 && coverRows([{ name: 'a', values: [1, 2] }]).length === 0)
check('a missing row is reported', uncovered(LOOK_FACTORS, matrix.slice(1)).length > 0)

process.exit(fails === 0 ? 0 : 1)
