#!/usr/bin/env node
/** The top-up is called a top-up, in both languages, and a pack that only carries money still says what it grants.
 *
 *  The person, 2026-10-30: « dans le menu, Upgrade → Extra credits (15,000 credits) n'est plus d'actualité, c'est
 *  maintenant un système de top-up ». Two things were wrong, and this file keeps them fixed:
 *    · the words — « Extra credits » / « Crédits supplémentaires » describe a fixed pack of credits that the product
 *      no longer sells; the action is a top-up (« Recharger »), on the plan card (planAddCredits), in the Upgrade
 *      dialog (upTopup) and on its button (upBuyCredits);
 *    · the shape — the card read `pack.grant_credits` only. A server that describes its grant in money (`grant_usd`,
 *      which the repo's own fixtures carry) rendered « undefined crédits » (measured by reading client.js:2837).
 *      The words now come from `upGrantText`, which accepts both shapes and says nothing rather than a wrong word.
 *
 *  Source-level (the dictionaries are inside a browser bundle, not importable): an occurrence count is enough here,
 *  and the rendering itself is covered by the gate of test-cloud-client.mjs.
 *
 *  Usage: node packages/kybernos-cloud/test-topup-labels.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'client.js'), 'utf8')
const count = (needle) => src.split(needle).length - 1

// 1. the words, in the two languages the product ships
assert.equal(count("upTopup: 'Recharger des crédits',"), 1, 'French dictionary: upTopup is « Recharger des crédits »')
assert.equal(count("upBuyCredits: 'Recharger',"), 1, 'French dictionary: the button is « Recharger »')
assert.equal(count("planAddCredits: 'Recharger',"), 1, 'French dictionary: the plan card action is « Recharger »')
assert.equal(count("upTopup: 'Top-up',"), 1, 'English dictionary: upTopup is « Top-up »')
assert.equal(count("upBuyCredits: 'Top up',"), 1, 'English dictionary: the button is « Top up »')
assert.equal(count("planAddCredits: 'Top up',"), 1, 'English dictionary: the plan card action is « Top up »')
ok('the three actions are called a top-up in French and in English')

// 2. the old words are gone from the dictionaries (a leftover may still be read in the quota sentence, which names
//    the app's own « Plan & Credits » page: that one is not a label of these three actions)
for (const stale of ["upTopup: 'Extra credits'", "upTopup: 'Crédits supplémentaires'", "upBuyCredits: 'Buy credits'", "upBuyCredits: 'Acheter des crédits'", "planAddCredits: 'Add credits'", "planAddCredits: 'Ajouter des crédits'"]) {
  assert.equal(count(stale), 0, 'no stale label: ' + stale)
}
ok('no « extra credits » label is left to be shown by accident')

// 3. a pack that carries money instead of credits: no more « undefined crédits »
assert.equal(count('const upGrantText = (pack) => {'), 1, 'the grant is read through upGrantText')
assert.ok(/Number\.isInteger\(credits\) && credits > 0/.test(src), 'a credit count is used when the server sends one')
assert.ok(/typeof usd === 'string' && usd !== ''/.test(src), 'a money grant (grant_usd) is used when that is what the server sends')
assert.ok(/return ''/.test(src.slice(src.indexOf('const upGrantText'), src.indexOf('const upGrantText') + 900)), 'and neither shape says nothing at all')
assert.equal(count('Number(topup.pack.grant_credits).toLocaleString(upLocale())'), 0, 'the old direct read of grant_credits is gone from the card')
assert.ok(src.includes("upGrantText(topup.pack) + ' · ' + upMoney(price.amount, cur)"), 'the card shows the grant, then the price')
ok('a pack described in money, in credits or in neither shape renders a true sentence')

console.log('\n' + pass + ' verifications OK')
