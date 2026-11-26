#!/usr/bin/env node
/** One icon column, one label column, in the sidebar menu — the workspace selector included.
 *
 *  The person, 2026-10-30: « dans le menu, il faudrait que les icônes et les titres soient alignés (collapsé ou non) ».
 *  Measured on a capture before the fix: a header label sat 34 px right of the items' and the workspace selector
 *  « Real estate agency » 8 px right (its own inset, plus a 1.65em tile where the items reserve 1.25em). The header (the
 *  « Business » group) has since gone: the menu is fixed and the declared rows are drawn flat, as items.
 *
 *  This file keeps the invariants in the source: one inset, one gap, one icon box of 1.25em.
 *
 *  Usage: node packages/kybernos-plugin/test-menu-axis.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'client.js'), 'utf8')

/** The rule body of a selector, as written in the bundle's stylesheet string. */
const rule = (sel) => {
  const i = src.indexOf(sel)
  assert.ok(i >= 0, 'the rule ' + sel + ' is in the bundle')
  const open = src.indexOf('{', i)
  const close = src.indexOf('}', open)
  return src.slice(open + 1, close)
}

// 1. the item has one inset and one gap
{
  const body = rule('.kb4-item{')
  assert.ok(/padding:[^;]*\.6em/.test(body) || /padding-left:calc\(\.6em - 1px\)/.test(body), '.kb4-item starts its content at .6em (' + body.slice(0, 90) + ')')
  assert.ok(/gap:\.5em/.test(body), '.kb4-item uses the .5em gap')
}
ok('the item has one inset and one gap')

// 2. one icon box
assert.ok(/\.kb4-ico\{[^}]*width:1\.25em/.test(src), 'the items’ icon sits in a fixed 1.25em box')
ok('one icon column of 1.25em')

console.log('\n' + pass + ' verifications OK')
