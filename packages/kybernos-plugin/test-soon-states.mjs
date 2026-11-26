#!/usr/bin/env node
/** « If it does not work, say so: grey it and write coming soon. » — the two surfaces the person named.
 *
 *  The person, 2026-10-30: « je ne sais pas si Team automations are for team spaces, fonctionne ou pas, si des
 *  fonctionnalités ne marchent pas, on devrait les griser et mettre coming soon. Même remarque pour share creation. »
 *
 *  What the code said (etat-gating.md, read the same day): the Team automations tab is entirely written on the client
 *  side, and its server half is not built yet — docs/dev/team-automations-contract.md: « Nothing implements it yet ».
 *  A server without those routes therefore showed a lock card with a CTA (« Open the Servers page »), which promised a
 *  page that serves nothing. The card now reads « Bientôt » — greyed, no button — for exactly the two kinds that mean
 *  « not delivered » (server, absent); a plan or a sign-in problem keeps its door, because those are actionable.
 *
 *  The share sheet already greyed its button with no cloud account, but said nothing (the « nothing to share yet »
 *  hint was the only one). It now says why, once.
 *
 *  Source-level on purpose: both surfaces need a server state to render, which no test harness here can fake today.
 *  The live check (a server without the routes) is quoted in campagne-recette-2026-10-30, not claimed by this file.
 *
 *  Usage: node packages/kybernos-plugin/test-soon-states.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasEntry } from './lib-i18n-test.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'client.js'), 'utf8')
const has = (needle, label) => assert.ok(src.indexOf(needle) >= 0, label + ' — missing: ' + needle.slice(0, 70))

// 1. the words exist in both languages of the dictionary
const dict = (key, label) => assert.ok(hasEntry(key), label + ' — missing (or not in both languages): ' + key)
dict('kbta.lock.soon.t', 'the soon title is in the dictionary')
dict('kbta.lock.soon.b', 'the soon body is in the dictionary')
dict('kbta.soon', 'the « Bientôt » chip has its word')
dict('kbsd.nocloud', 'the share sheet has its reason for « no account »')
ok('the four new labels are bilingual')

// 2. « not delivered » is its own state: greyed, no action, a chip
has("const soon = kind === 'server' || kind === 'absent'", 'only server and absent count as « not delivered » (plan and sign-in stay actionable)')
has("if (soon === true) { /* no action at all: nothing to retry, no page to open */ }", 'the soon state offers no button at all')
has("data-kb': 'team-locked', 'data-lock': soon === true ? 'soon' : kind", 'the card names its state `soon` for the stylesheet')
has("'data-kb': 'team-soon'", 'the card carries the « Bientôt » chip')
has('.kbta-lock[data-lock="soon"]{opacity:.72}', 'a not-delivered card reads as inactive (72 %, not invisible)')
has("soon === true ? kbt('kbta.lock.soon.t') : (known ? kbt('kbta.lock.' + kind + '.t')", 'the soon title replaces the lock title')
ok('a function that is not delivered is greyed and labelled, with no dead CTA')

// 3. the actionable states keep their door: the branch did not swallow them
for (const door of ["kind === 'plan'", "kind === 'signin' || kind === 'reconnect'", "kind === 'personal'"]) {
  has(door, 'the ' + door + ' door is still drawn for the actionable states')
}
// server and absent are « soon » now, so the « Open the Servers page » button that used to serve them is dead code:
// it was removed with the change (the dead-code rider), and it must not come back.
assert.equal(src.indexOf("kind === 'server') acts.push(btn('servers'"), -1, 'the Servers-page button is gone with the state it served')
ok('plan, sign-in and team problems keep their door; the state that had none today lost its dead button')

// 4. the share sheet explains a greyed button, not just when the reason is « nothing to share »
has("(inactif === true && busy !== true && niveau === 'me' && meilleurDispo !== true)", 'the « nothing to share yet » hint is kept')
has("(inactif === true && busy !== true && cloud === null)", 'the « no cloud account » case gets its own hint')
has("'data-kb': 'share-no-cloud'", 'the new hint is addressable (data-kb), like its neighbour')
ok('a greyed share button always says why (nothing to share, or no account)')

console.log('\n' + pass + ' verifications OK')
