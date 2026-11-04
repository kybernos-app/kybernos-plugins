#!/usr/bin/env node
// The evidence scanner of case J20-06 reports a live key, a long bearer value or a card number that is not a published test card, never the value, and leaves the constants of a code file alone.
//
//   node scripts/test-scan-secrets-in-evidence.mjs
import assert from 'node:assert/strict'
import { luhn, scanText } from './scan-secrets-in-evidence.mjs'

let pass = 0
const ok = (name) => { pass += 1; console.log('  ✓ ' + name) }

{
  const bearer = 'Authorization: Bearer ' + 'a'.repeat(47)
  const found = scanText('first line\n' + bearer + '\n')
  assert.deepEqual(found, [{ kind: 'bearer value', hard: true, line: 2 }])
  assert.ok(!JSON.stringify(found).includes('aaaa'), 'the value is never part of a finding')
  assert.deepEqual(scanText('Bearer short'), [])
  ok('a bearer value of 40 characters or more is a hard finding by line, without its value')
}

{
  assert.ok(luhn('4242424242424242'))
  assert.deepEqual(scanText('card 4242 4242 4242 4242'), [{ kind: 'published test card number', hard: false, line: 1 }])
  assert.deepEqual(scanText('card 4929123456789016'), [], 'a number that fails the Luhn check is not a card')
  assert.deepEqual(scanText('card 4929123456789015'), [{ kind: 'card-like number that is not a published test card', hard: true, line: 1 }])
  ok('a published test card is soft, another number that passes Luhn is hard')
}

{
  const code = 'var x=4929123456789015;'
  assert.equal(scanText(code, 'site/entry.js').length, 0)
  assert.equal(scanText(code, 'site/app.css').length, 0)
  assert.equal(scanText(code, 'logs/run.log').length, 1)
  assert.equal(scanText('k=Bearer ' + 'b'.repeat(45), 'site/entry.js').length, 1, 'a bearer value in a script is still a finding')
  ok('a Luhn-passing constant in a script or a style sheet is left alone, in a log it is not; a bearer value is a finding anywhere')
}

console.log('\n' + pass + ' verifications OK')
