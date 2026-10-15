// The sentence behind the sidebar's phone button (its tooltip and aria-label, `mobHelp`) must be true. It once said the phone
// « connects directly » to the computer; it goes through the Kybernos relay, which carries the messages and reads nothing
// (end-to-end encryption), and it works only while the computer is switched on and online. No word about plans: the link is open
// to every account.
//
//   node packages/kybernos-cloud/test-mobile-help.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const texts = [...source.matchAll(/^\s*mobHelp: '((?:[^'\\]|\\.)*)',$/gm)].map((m) => m[1])
assert.equal(texts.length, 2, 'one text per language')
const [fr, en] = texts

assert.match(fr, /web app/i, 'fr: says it is a web app')
assert.match(en, /web app/i, 'en: says it is a web app')
assert.match(fr, /relais/i, 'fr: goes through a relay')
assert.match(en, /relay/i, 'en: goes through a relay')
assert.match(fr, /bout en bout/i, 'fr: end-to-end')
assert.match(en, /end-to-end/i, 'en: end-to-end')
assert.match(fr, /allumé/i, 'fr: the computer must be on')
assert.match(en, /\bon\b/i, 'en: the computer must be on')
assert.match(fr, /Internet/, 'fr: and online')
assert.match(en, /Internet/, 'en: and online')
assert.doesNotMatch(fr, /direct/i, 'fr: not « direct »')
assert.doesNotMatch(en, /direct|straight/i, 'en: not « direct »')
assert.doesNotMatch(fr, /payant|offre|abonnement/i, 'fr: no plan mentioned')
assert.doesNotMatch(en, /\b(paid|plans?|subscription)\b/i, 'en: no plan mentioned')
console.log('ok   the phone button’s help is true\n\n1 tests passed')
