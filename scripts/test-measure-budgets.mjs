#!/usr/bin/env node
// scripts/measure-budgets-live.mjs: the arithmetic of the timings and the budget verdicts, without a browser.
import { against, BUDGETS_MS, summarise } from './measure-budgets-live.mjs'

let fails = 0
const check = (name, ok, detail = '') => { if (!ok) fails += 1; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }

check('the median of an odd list is its middle', summarise([900, 100, 500]).median === 500)
check('the median of an even list is the mean of the two middle values, rounded', summarise([100, 200, 300, 401]).median === 250)
check('the slowest and the number of runs are kept', summarise([5, 9, 7]).worst === 9 && summarise([5, 9, 7]).runs === 3)
check('an empty list measures nothing, it does not invent zero', summarise([]).median === null && against('shell', summarise([])) === 'within')
check('a median above its budget is « over », at the budget it is « within »', against('shell', { median: BUDGETS_MS.shell + 1 }) === 'over' && against('shell', { median: BUDGETS_MS.shell }) === 'within')
check('a name with no proposed budget says so', against('nothing', { median: 1 }) === 'no budget')
check('every proposed budget is a positive number of milliseconds', Object.values(BUDGETS_MS).every((n) => Number.isFinite(n) && n > 0))

process.exit(fails === 0 ? 0 : 1)
