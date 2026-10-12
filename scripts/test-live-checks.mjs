#!/usr/bin/env node
// Guards the live checks (scripts/check-*-live.mjs) against two ways of going stale, without a browser:
//
//   node scripts/test-live-checks.mjs
//
// 1. A live check compares the page it opened (KB_HOST: a sandbox, most of the time) with what the host routes of THAT instance
//    return. A literal « http://127.0.0.1:3080 » in a check reads the real DSH instead and the two never agree (the Memory page
//    check failed 7 of 22 assertions on a fresh sandbox for this reason, 2026-10-12). Hosts come from KB_HOST / live.authority.
// 2. check-memory-live.mjs states where the page sits in the Settings nav. That order is owned by GROUPES in
//    packages/kybernos-plugin/client.js (it changed on 2026-10-11 and the check kept the old « right after Language »): the lists the
//    check holds must agree with GROUPES, so the next reordering fails here, in CI, and not on someone's sandbox.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const words = (list) => list.split(',').map((w) => w.trim().replace(/^'|'$/g, '')).filter((w) => w !== '')

console.log('no live check reads its host routes from a fixed :3080')
{
  const files = readdirSync(join(ROOT, 'scripts')).filter((f) => /^check-.*-live\.mjs$/.test(f))
  check('there are live checks to look at', files.length > 10, files.length)
  const bad = []
  for (const f of files) {
    read('scripts/' + f).split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return
      if (/['"`]http:\/\/127\.0\.0\.1:3080/.test(line) || /cookieDeSession\(\s*['"`]127\.0\.0\.1:3080/.test(line)) bad.push(f + ':' + String(i + 1))
    })
  }
  check('none names http://127.0.0.1:3080 or signs a cookie for it (use KB_HOST / live.authority)', bad.length === 0, bad)
}

console.log('the Memory page check follows the Settings nav grouping')
{
  const src = read('scripts/check-memory-live.mjs')
  const above = /const NAV_ABOVE = \[([^\]]*)\]/.exec(src)
  const below = /const NAV_BELOW = \[([^\]]*)\]/.exec(src)
  check('the check declares what sits above and below the page', above !== null && below !== null)
  const groupes = read('packages/kybernos-plugin/client.js')
  const g = /titre: kbt\('settings\.group\.kybernos'\), mots: \[([^\]]*)\]/.exec(groupes)
  const mots = g === null ? [] : words(g[1])
  check('GROUPES has the Kybernos group and the page is in it', mots.indexOf('memory & lessons') >= 0, mots)
  if (above !== null && below !== null && mots.length > 0) {
    const rank = (label) => mots.indexOf(label.toLowerCase())
    const me = rank('Memory & Lessons')
    const up = words(above[1])
    const down = words(below[1])
    check('every label the check expects above the page is in the group, before it', up.length > 0 && up.every((l) => rank(l) >= 0 && rank(l) < me), up.map((l) => [l, rank(l)]))
    check('every label the check expects below the page is in the group, after it', down.length > 0 && down.every((l) => rank(l) > me), down.map((l) => [l, rank(l)]))
  }
}

console.log('\n' + (failed === 0 ? 'ALL GREEN' : String(failed) + ' FAILED'))
process.exit(failed === 0 ? 0 : 1)
