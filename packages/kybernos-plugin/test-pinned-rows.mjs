#!/usr/bin/env node
/** The chats of the « Pinned » section look like the chats under a workspace (2026-10-15).
 *
 *  Reported: pinned chats were 28px rows of 13px text with no icon, starting at x=24, while the same chats under a
 *  workspace are 32px rows of 14px text with their category icon (icon at x=40, text at x=60). Measured on the real
 *  GUI: native row left 12, title left 40, 14px/20px, radius 12; pinned row left 12, text padding 12, 13px, radius 8.
 *
 *  Two bundles are involved, so two halves are pinned here:
 *    - kybernos-plugin draws the Pinned section (`.kbpin_*`): its geometry must be the native one;
 *    - kybernos-sessions owns the category icon: it must recognise a Pinned row (same session id, other attribute)
 *      and decorate it the way it decorates a native row.
 *  Source-level: the bundles are browser modules, not importable here.
 *
 *  Usage: node packages/kybernos-plugin/test-pinned-rows.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const plugin = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')
const sessionsFile = process.env.KB_SESSIONS_CLIENT || join(here, '..', 'kybernos-sessions', 'client.js')
if (!existsSync(sessionsFile)) { console.log('  - kybernos-sessions is not next to this bundle: the two-sided checks are skipped'); process.exit(0) }
const sessions = readFileSync(sessionsFile, 'utf8')

// The CSS rule of a selector, as the Pinned section injects it (one array entry per rule).
const rule = (sel) => {
  const at = plugin.indexOf("'" + sel + '{')
  assert.ok(at >= 0, sel + ' is declared')
  return plugin.slice(at + 1, plugin.indexOf("'", at + 1))
}

// 1. geometry: the native session row (measured) — 32px high, 14px text, icon 28px in from the row edge, radius 12.
{
  const open = rule('.kbpin_open')
  assert.match(open, /height:32px/, 'a pinned row is 32px high like a session row')
  assert.match(open, /line-height:32px/)
  assert.match(open, /font-size:14px/, 'its text is 14px like a session row')
  assert.match(open, /padding:0 8px 0 28px/, 'its icon starts where a session row\'s icon starts (28px in from the row edge)')
  assert.match(open, /border-radius:12px/)
  assert.match(rule('.kbpin_row'), /border-radius:12px/, 'the row hover has the native radius')
  ok('a pinned row has the geometry of a session row (32px, 14px text, icon 28px in, radius 12)')
}

// 2. rhythm: two rows of one group are 2px apart (they were flush), like the native list.
{
  assert.ok(/'\.kbpin_group>\.kbpin_row\+\.kbpin_row\{margin-top:2px\}'/.test(plugin), 'rows of a group are 2px apart')
  assert.match(rule('.kbpin_threads>*+*'), /margin-top:2px/, 'the grouped rows keep their 2px')
  ok('the rows of the Pinned section are 2px apart like the session list')
}

// 3. the contract between the two bundles: what one writes, the other reads.
{
  assert.ok(/row\.className = 'kbpin_row'/.test(plugin) && /setAttribute\('data-kbpin-kind', kind\)/.test(plugin) && /setAttribute\('data-kbpin-id', id\)/.test(plugin), 'the Pinned section marks its rows with kind and id')
  assert.ok(/open\.className = 'kbpin_open'/.test(plugin), 'the title of a pinned row is .kbpin_open')
  assert.ok(sessions.includes('data-kbpin-id') && sessions.includes('data-kbpin-kind'), 'the sessions bundle reads the id and the kind of a pinned row')
  assert.ok(/querySelector\('\.kbpin_open'\)/.test(sessions), 'it finds the title element of a pinned row')
  assert.ok(/\.kbpin_row\[data-kbpin-kind="session"\]/.test(sessions), 'its sweep covers the pinned session rows')
  ok('both bundles agree on the pinned row markup (.kbpin_row, data-kbpin-kind/id, .kbpin_open)')
}

// 4. behaviour: the session id of a row, native or pinned (the function is cut out of the bundle and run as it is).
{
  const at = sessions.indexOf('const idDeLigne = (ligne) => {')
  assert.ok(at >= 0, 'idDeLigne was found')
  let depth = 0
  let i = sessions.indexOf('{', at + 'const idDeLigne = (ligne) => '.length - 1)
  const from = i
  for (; i < sessions.length; i += 1) {
    if (sessions[i] === '{') depth += 1
    else if (sessions[i] === '}') { depth -= 1; if (depth === 0) break }
  }
  const body = sessions.slice(at, i + 1)
  assert.ok(from > at, 'the function body was cut')
  const ctx = vm.createContext({})
  vm.runInContext(body + '\n;globalThis.idDeLigne = idDeLigne', ctx)
  const idDeLigne = ctx.idDeLigne
  const el = (attrs) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null) })
  assert.equal(idDeLigne(el({ 'data-row-key': 'session:session-abc' })), 'session-abc', 'a native row')
  assert.equal(idDeLigne(el({ 'data-kbpin-kind': 'session', 'data-kbpin-id': 'session-abc' })), 'session-abc', 'a pinned session row')
  assert.equal(idDeLigne(el({ 'data-kbpin-kind': 'workspace', 'data-kbpin-id': 'ws-1' })), '', 'a pinned workspace is not a session')
  assert.equal(idDeLigne(el({})), '', 'a row with no key')
  assert.equal(idDeLigne(null), '')
  ok('a pinned session row gives the same session id as its native row')
}

console.log('\n' + pass + ' checks passed')
