#!/usr/bin/env node
/** F7 guard: the text separator is locale-aware (`kbfSep`), so no bare ` + ' : ' + ` (or `k + ' : '`) is left in
 *  rendered labels, and the Composio connection id is masked on screen. Source-level: the bundles are browser
 *  modules, not importable here.
 *
 *  Usage: node packages/kybernos-plugin/test-kbfsep.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))

// 1. kybernos-plugin: kbfSep exists and is used, no bare separator concatenation remains.
{
  const src = readFileSync(join(here, 'client.js'), 'utf8')
  assert.ok(/const kbfSep = \(\) =>/.test(src), 'kbfSep is defined')
  assert.ok(src.includes('kbfSep()'), 'kbfSep is used')
  assert.ok(!/ \+ ' : ' \+ /.test(src), "no bare ` + ' : ' + ` separator remains")
  assert.ok(!/k \+ ' : '/.test(src), "no bare `k + ' : '` separator remains")
  ok('kybernos-plugin: the text separator goes through kbfSep, none is left bare')
}

// 2. kybernos-composio: the connection id is masked on screen (FV3).
{
  const src = readFileSync(join(here, '..', 'kybernos-composio', 'client.js'), 'utf8')
  assert.ok(/slice\(0, 5\) \+ '\\u2022\\u2022\\u2022\\u2022' \+ .*slice\(-3\)/.test(src) || /\\u2022\\u2022\\u2022\\u2022/.test(src), 'the connection id is masked')
  assert.ok(/title: a\.id/.test(src), 'the full id is kept in the title for reference')
  ok('kybernos-composio: the connection id is masked on screen (full id kept in the title)')
}

// 3. kybernos-auto: the availability badge keeps a neutral/success tint when healthy (FV2).
{
  const src = readFileSync(join(here, '..', 'kybernos-auto', 'client.js'), 'utf8')
  assert.ok(/\.kaa-pop-dispo\.ok\{/.test(src), 'the badge has a healthy (ok) tint rule')
  assert.ok(/refs\.pastille\.className = 'kaa-pop-dispo ' \+ ton/.test(src), 'the badge tint follows the health state')
  ok('kybernos-auto: the availability badge is only amber when degraded')
}

console.log('\n' + pass + ' verifications OK')
