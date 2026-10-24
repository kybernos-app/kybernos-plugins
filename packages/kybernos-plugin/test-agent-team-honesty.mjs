#!/usr/bin/env node
/** The Agent Team pages say only what they do (T2-17, T2-18, T2-19, 2026-10-24). Source-level: the page is checked on the real GUI (docs/dev/live-testing.md).
 *   - the designer's « Mockup · model info as Tooltip / Side panel » toggle is gone from the live Roles tab (it was a dashed box with hard-coded hex colours, and its choice was lost on reopening);
 *   - the marketplace preview (read-only) draws neither the « Model management » bar of pills that do nothing nor the inert « + Add a role » chip;
 *   - the Roles tab says "Declared … Today the model written for each role is the one that runs" for the automatic and per-role modes, whose routing the host does not do.
 *  Usage: node packages/kybernos-plugin/test-agent-team-honesty.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const nocomment = src.replace(/^\s*\/\/.*$/gm, '')

assert.ok(!/Mockup · model info as/.test(src), 'the Mockup toggle is gone')
assert.ok(!/kbuiVariant|setKbuiVariant|pickVariant|setVariantFn/.test(src), 'and so is its plumbing (state, props, the setter)')
console.log('  ✓ no « Mockup · model info as » toggle, no dead variant plumbing')

assert.match(nocomment, /\(editable === true \? mmBar : null\)/, 'the model-management bar needs editable')
const addRole = nocomment.indexOf("kbt('kbui.crew.addrole.soon')")
assert.ok(addRole > 0 && /\(editable === true \? h\('span', \{ title: kbt\('kbui\.crew\.addrole\.soon'\)/.test(nocomment), 'the add-role chip needs editable')
console.log('  ✓ the marketplace preview (read-only) draws neither the model-management bar nor the add-role chip')

const m = /const modeSummary = \(prefsMode === 'auto'\)\s*\? '([^']*)'\s*: \(\(prefsMode === 'per-role'\)\s*\? '([^']*)'/.exec(src)
assert.ok(m !== null, 'modeSummary exists')
for (const [mode, text] of [['auto', m[1]], ['per-role', m[2]]]) {
  assert.match(text, /^Declared:/, mode + ': says it is declared')
  assert.match(text, /Today the model written for each role is the one that runs\.$/, mode + ': says what runs today')
}
console.log('  ✓ the automatic and per-role summaries say they are declared and what runs today')
console.log('\n3 checks passed')
