#!/usr/bin/env node
/** The Skills page after the owner's review of 2026-10-23, source-level like test-picks.mjs:
 *   - « For your field » draws its skills as picks (the card or the row of the Featured tab, whichever view is on), with Details, Use / Install and the star,
 *     not as a second kind of row; Details opens the pick, the skill's own panel (in Yours) or the install panel, and is absent when there is nothing to open;
 *   - the Use buttons say « Copied » for a moment (the toast alone went unseen);
 *   - the card of a skill of Yours says what it is and does: no source, no folder, no modification date (they are in its panel);
 *   - the actions at the foot of a panel stay in view while its content scrolls.
 *  Usage: node packages/kybernos-skills/test-field-picks.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')
const between = (a, b) => {
  const i = src.indexOf(a)
  const j = src.indexOf(b, i + 1)
  assert.ok(i >= 0 && j > i, a + ' … ' + b + ' were found')
  return src.slice(i, j)
}

const field = between('const fieldAsPick = ', 'const renderFeatured = ')
assert.ok(field.includes('pickRow(it.pick, i, it.opts)') && field.includes('pickCard(it.pick, i, it.opts)') && field.includes('pick: fieldAsPick(sk), opts: fieldOpts(sk, f)'))
assert.ok(field.includes("h('i', { className: 'kbsf-fdot'") && !/kbsf-fhead|fld\.title/.test(src), 'a dot in the field\'s colour, no frame and no title')
assert.ok(field.includes("views.featured === 'list'"))
assert.ok(!src.includes('const fieldRow ') && !src.includes('kbsf-frow') && !src.includes('kbsf-fgrid'), 'the old field rows are gone (dead code)')
ok('the field skills are the same cards and rows as the picks, in the view the page is on; the old rows are gone')

assert.ok(field.includes('noDetails') && field.includes("setMode('yours')") && field.includes("setMode('discover')"))
assert.ok(/const noDetails = curated !== true && own === undefined && sk\.shipped === true/.test(field))
ok('Details opens a curated pick, an installed skill (its panel in Yours) or the install panel; a shipped skill that is not installed has none')

const buttons = between('const pickButtons = ', 'const pickStar = ')
assert.ok(buttons.includes("copied === '/' + p.id ? t('pick.copied') : t('pick.use')"))
assert.ok(src.includes("'pick.copied': { fr: 'Copié', en: 'Copied' }"))
assert.ok(/setCopied\(text\)\s*\n\s*setTimeout\(\(\) => \{ if \(alive\.current === true\) setCopied\(\(c\) => \(c === text \? '' : c\)\) \}, 1800\)/.test(src))
ok('Use says « Copied » for 1.8 s after the copy worked')

const card = between('const yourCard = ', 'const pendingCard = ')
assert.ok(!card.includes('s.root') && !card.includes("t('mod.on'") && !card.includes("icon('shield', 13)"))
assert.ok(card.includes("'/' + s.name"))
ok('the card of a skill of Yours has no source, no folder, no modification date; the /name chip stays')

assert.ok(/\.kbs-root \.kbs-panel-acts\{position:sticky;bottom:-16px;/.test(src))
ok('the actions of a panel are sticky at its foot')

console.log(pass + ' tests passed')
