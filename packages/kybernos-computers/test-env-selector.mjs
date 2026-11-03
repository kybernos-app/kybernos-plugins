#!/usr/bin/env node
/** The execution-environment selector of the composer (« This machine / E2B / a cloud computer »), pinned at source level.
 *  A cloud computer is CHOSEN like E2B: nothing moves a message, the host keeps the choice and tells the agent (kybernos-cloud `computer-turn.mjs`),
 *  and the menu lists the person's own cloud computers, one row each, with their state in words.
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

// 1. the rows come from the person's own computers (the list the Automations page draws), only for a signed-in person
assert.ok(/fetch\('\/kybernos-cloud\/computers'/.test(src), 'the computers are read from the cloud bundle, not guessed')
assert.ok(/k\.connected === true && Array\.isArray\(k\.computers\)/.test(src), 'a signed-out person gets no cloud row')
assert.ok(/options\.push\(\{ id: 'cloud:' \+ c\.id, name: c\.name === '' \? t\('envCloud'\) : c\.name, sub: t\(CLOUD_SUB\[key\]\), disabled: key === 'off' \|\| key === 'waking' \}\)/.test(src), 'one row per computer, off or being set up cannot be chosen')
ok('one row per cloud computer, for a signed-in person, with its state in words')

// 2. choosing one stores it in the host; choosing anything else clears it; the two ways off this machine never stack
assert.ok(/callCloud\('\/kybernos-cloud\/computer\/target\/set', 'POST', \{ computer_id: id, name:/.test(src), 'a cloud row posts the computer id and its name')
assert.ok(/callCloud\('\/kybernos-cloud\/computer\/target\/set', 'POST', \{ computer_id: null \}\)/.test(src), 'This machine and E2B clear the cloud choice')
assert.ok(/if \(env !== 'desktop'\) \{\s*const back = await callEnv\('\/env\/set', 'POST', \{ env: 'desktop' \}\)/.test(src), 'choosing a cloud computer puts E2B off')
assert.ok(!/callEnv\('\/env\/set', 'POST', \{ env: 'cloud'/.test(src), 'no env « cloud » is ever sent to the E2B route')
ok('the choice goes to the host, clears the other ways off this machine and is cleared by them')

// 3. a computer that left the list is forgotten, so the agent is never told to use it
assert.ok(/cloud\.some\(\(c\) => c\.id === target\.id\) === true\) return\s*setTarget\(null\)/.test(src), 'a vanished computer clears the choice')
ok('a deleted computer clears the choice')

// 4. the button and the marks follow what is chosen
assert.ok(/const chosen = target !== null \? 'cloud:' \+ target\.id : isE2b \? 'e2b' : 'desktop'/.test(src), 'one place says what is chosen')
assert.ok(/'data-on': opt\.id === chosen \? 'true' : 'false'/.test(src), 'only the chosen row is marked on')
assert.ok(/target !== null \? \(target\.name !== '' \? target\.name : t\('envCloud'\)\) : isE2b \? 'E2B' : t\('envDesktop'\)/.test(src), 'the button shows the chosen computer')
ok('the button and the marks show the chosen computer, and only it')

// 5. the sentences exist in both languages
for (const lang of ['en', 'kybernos']) {
  const block = src.slice(src.indexOf('      ' + lang + ': {'), src.indexOf('      ' + lang + ': {') + 4200)
  for (const k of ['envCloud', 'envCloudAwake', 'envCloudAsleep', 'envCloudWinding', 'envCloudWaking', 'envCloudOff']) assert.ok(new RegExp(k + ": '[^']+'").test(block), lang + ' has ' + k)
}
assert.ok(!/envCloudSub/.test(src), 'the « not available from a chat » sentence is gone')
ok('every state sentence exists in English and in Kybernos\' French (the locale id « kybernos », not « fr »)')

console.log('\n' + pass + ' checks passed')
