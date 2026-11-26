#!/usr/bin/env node
// scripts/user-journey-seed-defects.mjs: the ten planted defects, the shuffle and the scoring, without a browser.
import { CLEAN, DEFECTS, grew, score, shuffled } from './user-journey-seed-defects.mjs'

let fails = 0
const check = (name, ok, detail = '') => { if (!ok) fails += 1; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }

check('ten defects with distinct ids', DEFECTS.length === 10 && new Set(DEFECTS.map((d) => d.id)).size === 10)
check('every planting script parses', DEFECTS.every((d) => { try { new Function(`return ${d.plant}`); return true } catch { return false } }))
check('two defects are decided by a measure, eight by a picture', DEFECTS.filter((d) => d.measure).length === 2)
check('the shuffle keeps every item and is repeatable', JSON.stringify(shuffled([1, 2, 3, 4, 5, 6, 7, 8])) === JSON.stringify(shuffled([1, 2, 3, 4, 5, 6, 7, 8])) && shuffled([1, 2, 3, 4, 5, 6, 7, 8]).sort().join('') === '12345678')
check('a different seed gives a different order', JSON.stringify(shuffled([1, 2, 3, 4, 5, 6, 7, 8], 1)) !== JSON.stringify(shuffled([1, 2, 3, 4, 5, 6, 7, 8], 2)))
check('there are clean pictures to measure false alarms', CLEAN.length >= 8)

const key = [
  { picture: 'p-01.png', defect: 'D01', what: 'a', measure: false }, { picture: 'p-02.png', defect: 'D06', what: 'b', measure: true },
  { picture: 'p-03.png', defect: null, what: 'nothing planted', measure: false }, { picture: 'p-04.png', defect: null, what: 'nothing planted', measure: false }
]
const s = score(key, [{ picture: '/x/y/p-01.png', what: 'clipped' }, { picture: 'p-03.png', what: 'false alarm' }])
check('a found defect is counted by its picture name, whatever the path', s.picture.found === 1 && s.picture.total === 1)
check('a measure defect is scored on its own line', s.measure.total === 1 && s.measure.found === 0 && s.missed.length === 1)
check('a finding on a clean picture is a false alarm', s.cleanFlagged === 1 && s.cleanTotal === 2)
check('an empty report finds nothing', score(key, []).picture.found === 0 && score(key, undefined).cleanFlagged === 0)

check('grew names what the look measured more of after the defect', JSON.stringify(grew({ overlaps: [], small: [1] }, { overlaps: [{}], small: [1, 2], clippedText: [] })) === JSON.stringify(['overlaps', 'small']))
check('a sideways scroll that was not there is named', grew({ scrollsSideways: false }, { scrollsSideways: true }).join() === 'scrollsSideways' && grew({ scrollsSideways: true }, { scrollsSideways: true }).length === 0)
check('two empty looks grew nothing', grew(null, undefined).length === 0)
const withCaught = score([{ picture: 'p-01.png', defect: 'D01', what: 'a', measure: false, caught: ['clippedText'] }, { picture: 'p-02.png', defect: 'D02', what: 'b', measure: false, caught: [] }], [])
check('the script line counts the defects the measures saw', withCaught.script.total === 2 && withCaught.script.found === 1 && withCaught.script.missed.length === 1)

process.exit(fails === 0 ? 0 : 1)
