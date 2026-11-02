#!/usr/bin/env node
// A chat that works, waits for the person or has delivered something not read yet is never hidden by the chat list's default filter
// (6 rows with unfinished work). No browser: the pure pieces are taken from the bundle as it is.
//
//   node packages/kybernos-sessions/test-active-rows.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const React = { createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (f) => f, useMemo: (f) => f(), Fragment: 'fragment' }
let definition = null
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } } }
globalThis.document = { createElement: () => ({ style: {} }), head: { append() {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }
new Function('window', SOURCE)(globalThis.window)
const { choisirLignes, estVivant, statutDe } = definition.factory((spec) => { if (spec === 'react') return React; throw new Error('unexpected require ' + spec) }).__test

const row = (fait, extra = {}) => ({ fait, ouvert: false, vivant: false, ...extra })

// 1. the rule as it was: unfinished work first, 6 rows at most, 2 at least, the open row always.
{
  const rows = Array.from({ length: 10 }, (_, i) => row(i >= 8))
  const kept = choisirLignes(rows)
  assert.equal(kept.length, 6, 'capped at 6 (eight rows have unfinished work)')
  assert.ok(kept.every((i) => rows[i].fait !== true), 'only unfinished work')
  assert.deepEqual(choisirLignes([row(true), row(true), row(true)]), [0, 1], 'never fewer than 2 rows')
  assert.deepEqual(choisirLignes([row(true), row(true, { ouvert: true }), row(true), row(true)]), [0, 1], 'the open row stays, the guaranteed two complete it')
  assert.deepEqual(choisirLignes([row(null), row(true)]), [0, 1], 'an unknown state is never hidden')
  ok('without any alive chat the list keeps today\'s rule (unfinished first, 6 at most, 2 at least, the open one always)')
}

// 2. an alive chat stays, whatever its work state and whatever the cap.
{
  const rows = Array.from({ length: 10 }, () => row(true))
  rows[8] = row(true, { vivant: true })
  const kept = choisirLignes(rows)
  assert.ok(kept.includes(8), 'a chat that runs with committed work is kept although it falls beyond the guaranteed rows')
  assert.deepEqual(kept, [0, 8], 'and the list still has its two rows (the alive one counts toward them)')
  const many = Array.from({ length: 12 }, () => row(false, { vivant: true }))
  assert.equal(choisirLignes(many).length, 12, 'eight alive chats are not trimmed to six')
  const mixed = [row(false), row(false), row(false), row(false), row(false), row(false), row(true, { vivant: true })]
  assert.ok(choisirLignes(mixed).includes(6), 'an alive chat is kept even when six unfinished ones already fill the cap')
  ok('a chat that runs, waits or has delivered is kept: beyond the cap, with committed work, and many of them at once')
}

// 3. DSH's own facts decide.
{
  assert.equal(estVivant({ running: true }), true, 'working')
  assert.equal(estVivant({ completionUnread: true }), true, 'delivered, not read')
  assert.equal(estVivant({ pendingInteraction: { kind: 'approval' } }), true, 'waiting for the person')
  assert.equal(estVivant({ running: false, completionUnread: false, pendingInteraction: null }), false, 'idle')
  assert.equal(estVivant(undefined), false)
  assert.equal(estVivant(null), false)
  assert.equal(estVivant('running'), false, 'a stray value is idle')
  const map = new Map([['abc', { running: true }], ['session-def', { completionUnread: true }]])
  assert.equal(statutDe(map, 'abc').running, true, 'the bare key')
  assert.equal(statutDe(map, 'session-abc').running, true, 'the prefixed id finds the bare key')
  assert.equal(statutDe(map, 'def').completionUnread, true, 'the bare id finds the prefixed key')
  assert.equal(statutDe({ xyz: { running: true } }, 'xyz').running, true, 'a plain object works too')
  assert.equal(statutDe(map, 'nobody'), undefined)
  assert.equal(statutDe(map, ''), undefined)
  assert.equal(statutDe(null, 'abc'), undefined, 'no status service, no fact, no throw')
  ok('the three facts of the native dot make a chat alive, and the status is found under either id form')
}

// 4. wired: the filter asks DSH once per pass, only for a group it filters, and a missing service changes nothing.
{
  assert.ok(/let statuts \/\/ read on the first group that is filtered/.test(SOURCE), 'one read per pass')
  assert.ok(/if \(statuts === undefined\) statuts = lireStatuts\(\)/.test(SOURCE), 'read lazily, only when a group is actually filtered')
  assert.ok(/vivant: estVivant\(statutDe\(statuts, idDeLigne\(rows\[i\]\)\)\)/.test(SOURCE), 'each row is judged by the session id of its row key')
  assert.ok(/kbCtx\.get\('uiSession'\)/.test(SOURCE) && /\.sessionStatus/.test(SOURCE), 'the source is DSH\'s session-status service, read INSIDE a try/catch like the other optional services')
  ok('the filter reads DSH\'s status once per pass and judges each row by its session id; a missing service leaves the rule as it was')
}

console.log(pass + ' checks passed')
