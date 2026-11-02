#!/usr/bin/env node
// The `kbs-` prefix is shared with kybernos-slides (and, historically, cloud, plugin, skills): a class
// defined in two bundles is styled by BOTH, and the one loaded last wins on every property it sets. That
// is how a sessions card once got a slides rule — `.kbs-empty{position:absolute;inset:0}` stretched an
// empty-state box over the whole card, and `.kbs-foot{position:absolute}` pushed every card's « Details »
// button into the middle of it. This pins the fix: no class this bundle's client defines may be defined by
// another bundle.
//
//   node packages/kybernos-sessions/test-prefix.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..')
const classesOf = (file) => new Set((readFileSync(file, 'utf8').match(/\.(kbs-[A-Za-z0-9_-]+)/g) || []).map((c) => c.slice(1)))
const mine = classesOf(join(PACKAGES, 'kybernos-sessions', 'client.js'))

let fail = 0
let pass = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

check('sessions defines kbs- classes at all (the scan sees something)', mine.size > 40, mine.size)
const clash = {}
for (const dir of readdirSync(PACKAGES)) {
  if (dir === 'kybernos-sessions') continue
  for (const rel of ['client.js', 'src/plugin.js', 'client/client.js']) {
    const file = join(PACKAGES, dir, rel)
    if (!existsSync(file)) continue
    const shared = [...classesOf(file)].filter((c) => mine.has(c))
    if (shared.length > 0) clash[dir + '/' + rel] = shared
  }
}
check('no kbs- class of kybernos-sessions is also written by another bundle', Object.keys(clash).length === 0, clash)
for (const renamed of ['kbs-empty', 'kbs-foot', 'kbs-title', 'kbs-notes', 'kbs-sep']) {
  check(renamed + ' is not one of this bundle\'s classes any more', !mine.has(renamed))
}
console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
