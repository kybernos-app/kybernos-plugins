#!/usr/bin/env node
/** The execution-environment selector of the composer (« This machine / E2B / Cloud Computer »), pinned at source level.
 *  The Cloud Computer is SHOWN, never chosen: no route runs a chat turn on it (docs/dev/cloud-computer-run-on.md), and a
 *  disabled option says why instead of the option being absent.
 *
 *  Usage: node packages/kybernos-computers/test-env-selector.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

// 1. the option exists, only for a signed-in person, and is disabled
assert.ok(/if \(cloud !== null\) options\.push\(\{ id: 'cloud', name: t\('envCloud'\), sub: t\('envCloudSub'\), disabled: true \}\)/.test(src), 'a disabled Cloud Computer option, only when the cloud bundle says the person is signed in')
assert.ok(/fetch\('\/kybernos-cloud\/kyber'/.test(src), 'its state is read from the cloud bundle, not guessed')
ok('the Cloud Computer is listed (disabled, with its reason) for a signed-in person')

// 2. choosing it is impossible: a disabled option never reaches `choose`, and no env value `cloud` is ever sent
assert.ok(/disabled: opt\.disabled === true, onClick: \(\) => \{ void choose\(opt\.id\) \}/.test(src), 'a disabled option does not call choose')
assert.ok(!/callEnv\('\/env\/set', 'POST', \{ env: 'cloud'/.test(src), 'no env « cloud » is ever posted')
ok('the option cannot be chosen')

// 3. only the chosen environment is marked « on » (the Cloud option was marked on whenever E2B was off)
assert.ok(/'data-on': opt\.id === \(isE2b \? 'e2b' : 'desktop'\) \? 'true' : 'false'/.test(src), 'data-on follows the chosen environment only')
ok('only the chosen environment is marked on')

// 4. its two sentences exist in both languages
for (const lang of ['en', 'kybernos']) {
  const block = src.slice(src.indexOf('      ' + lang + ': {'), src.indexOf('      ' + lang + ': {') + 3500)
  assert.ok(/envCloud: '[^']+'/.test(block) && /envCloudSub: '[^']+'/.test(block), lang + ' has envCloud and envCloudSub')
}
ok('the label and the reason exist in English and in Kybernos\' French (the locale id « kybernos », not « fr »)')

console.log('\n' + pass + ' checks passed')
