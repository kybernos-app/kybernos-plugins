#!/usr/bin/env node
/** R4 guard (recoupement 2026-10-15): hovering the selected tab of a skill's detail (« Contents ») must not
 *  drop its background. `.kbs-root .kb8-chip:hover` (specificity 0,3,0) beat `.kb8-chip.on` (0,2,0): the
 *  selected tab lost its fill but kept its dark label, near-invisible on the dark panel
 *  (measured: color rgb(15,17,21) on rgba(255,255,255,.08)).
 *
 *  Usage: node packages/kybernos-skills/test-tabs-contrast.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

// Every hover rule on a chip either excludes the selected chip or restates the selected fill.
{
  const rules = [...src.matchAll(/([^{}\n]*\.kb8-chip[^{}\n]*:hover[^{}\n]*)\{([^}]*)\}/g)]
  assert.ok(rules.length > 0, 'a hover rule on .kb8-chip exists')
  const bad = rules.filter((r) => !/:not\(\.on\)/.test(r[1]) && !/\.on:hover/.test(r[1]))
  assert.deepEqual(bad.map((r) => r[1].trim()), [], 'hover rules that also hit the selected chip')
  ok('a hover rule never repaints the selected chip')
}

console.log('\n' + pass + ' checks passed')
