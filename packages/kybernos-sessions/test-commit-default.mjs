// L6-01 (audit 2026-10-20): `POST /kybernos-sessions/commit` pushed to the remote by default, from a body with no flag at all (`pousser: corps.local !== true`): a script or a curl
// that only meant « save my work » sent the person's commits to GitHub. The route now sends only when the body says `push:true`; the page's two actions that mean « save and send »
// (« Save my work », « Add to project ») say it, after the dry run has shown the `git push` and the person confirmed.
//
//   node packages/kybernos-sessions/test-commit-default.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { veutPousser } from './index.js'

const here = dirname(fileURLToPath(import.meta.url))
const index = readFileSync(join(here, 'index.js'), 'utf8')
const client = readFileSync(join(here, 'client.js'), 'utf8')
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

assert.equal(veutPousser({}), false, 'a bare body sends nothing')
assert.equal(veutPousser({ session: 's', chemins: ['a.js'], exec: true }), false, 'a body that only asks to run it sends nothing')
assert.equal(veutPousser({ push: true }), true, 'push:true sends')
assert.equal(veutPousser({ push: true, local: true }), false, 'local:true wins: nothing leaves the computer')
assert.equal(veutPousser({ local: true }), false)
assert.equal(veutPousser({ push: 'yes' }), false, 'only the boolean true counts')
assert.equal(veutPousser(null), false)
assert.equal(veutPousser(undefined), false)
ok('veutPousser: only an explicit push:true sends, local:true always wins, nothing else does')

assert.match(index, /pousser: veutPousser\(corps\)/, 'the route asks veutPousser')
assert.doesNotMatch(index, /pousser: corps\.local !== true/, 'the old default is gone')
ok('the commit route decides with veutPousser (the old « anything but local » default is gone)')

assert.match(client, /url: '\/kybernos-sessions\/commit', corps: \{ session: sessionId, chemins: mesChemins, push: true \}/, '« Save my work » asks for the push')
assert.match(client, /url: '\/kybernos-sessions\/commit', corps: \{ session: sessionId, push: true \}/, '« Add to project » asks for the push')
assert.match(client, /corps: \{ session: sessionId, chemins: mesChemins, local: true \}/, 'the local gesture stays local')
ok('the page’s « Save my work » and « Add to project » ask for the push, the local gesture stays local')
console.log('\nSESSIONS COMMIT DEFAULT — ' + pass + ' check(s), 0 échec')
