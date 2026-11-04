#!/usr/bin/env node
// scripts/look-matrix-live.mjs: the plan of the rows (grouping, order, skips) and the picture names, without a browser.
import { pictureName, planGroups } from './look-matrix-live.mjs'
import { lookMatrix } from './pairwise.mjs'

let fails = 0
const check = (name, ok, detail = '') => { if (!ok) fails += 1; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }

const matrix = lookMatrix()
const groups = planGroups(matrix)
const rows = groups.flatMap((g) => g.rows)
check('every row of the matrix is planned exactly once', rows.length === matrix.length && new Set(rows.map((r) => r.n)).size === matrix.length)
check('English is played first, then French', groups[0].language === 'en' && groups.findIndex((g) => g.language === 'fr') > 0 && groups.filter((g) => g.language === 'en').every((g) => groups.indexOf(g) < groups.findIndex((x) => x.language === 'fr')))
check('a language is never split by another between its groups', groups.every((g, i) => groups.slice(i + 1).every((h) => h.language !== g.language) || groups[i + 1].language === g.language))
check('inside a group every row has the group\'s language and mode', groups.every((g) => g.rows.every((r) => r.language === g.language && ({ 'default-dark': 'dark', 'default-light': 'light' }[r.theme] || 'start') === g.mode)))
check('the three sector themes are skipped and named', rows.filter((r) => r.skipped).every((r) => ['e-commerce', 'real-estate', 'recruitment'].includes(r.theme)) && rows.filter((r) => ['e-commerce', 'real-estate', 'recruitment'].includes(r.theme)).every((r) => r.skipped))
check('--lang keeps only those languages, with their original row numbers', (() => { const g = planGroups(matrix, { langs: ['ar'] }).flatMap((x) => x.rows); return g.length > 0 && g.every((r) => r.language === 'ar' && matrix[r.n - 1].language === 'ar') })())
check('--limit keeps the first rows of the matrix', planGroups(matrix, { limit: 5 }).flatMap((g) => g.rows).map((r) => r.n).sort((a, b) => a - b).join() === '1,2,3,4,5')
check('the same matrix plans the same way twice', JSON.stringify(planGroups(matrix)) === JSON.stringify(groups))
check('a picture name carries the row number, language, theme, width and page', pictureName({ n: 7, language: 'ar', theme: 'default-light', width: 390, page: 'usage' }) === '007-ar-default-light-390-usage.png')
check('names are distinct across the whole matrix', new Set(rows.map(pictureName)).size === matrix.length)

process.exit(fails === 0 ? 0 : 1)
