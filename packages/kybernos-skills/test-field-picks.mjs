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

// A skill of the field carries its goal as its tag, curated pick or not (domain-packs.md: « each with its goal as a tag »). Run the real function: a skill that
// is also a curated pick (xlsx, docx in Law) used to come back as the pick itself, whose tag is its category, so the card read « Time » nowhere and a category instead.
{
  const fn = between('const fieldAsPick = ', 'const fieldOpts = ').replace(/^const fieldAsPick = /, 'return ').trimEnd()
  const curated = { id: 'xlsx', source: 'anthropics/skills', category: 'productivity', title: { fr: 'Tableur', en: 'Spreadsheet' }, outcome: { fr: 'x', en: 'x' }, prompt: { fr: 'a', en: 'a' }, installs: 12, audits: [['A', 'pass']], cover: 'c.png', needs: null }
  const before = JSON.stringify(curated)
  const picks = { items: [curated] }
  const fieldAsPick = new Function('picks', 'humanName', fn)(picks, (n) => 'Name of ' + n)
  const own = fieldAsPick({ source: 'anthropics/skills', name: 'xlsx', goal: 'Time', d: 'Spreadsheets' })
  assert.equal(own.tag, 'Time', 'a curated pick shows the goal of the skill as its tag, not its category')
  assert.equal(own.id, 'xlsx')
  assert.equal(own.category, 'productivity', 'the pick keeps the rest of itself (its Details page, cover and audits)')
  assert.equal(own.cover, 'c.png')
  assert.equal(JSON.stringify(curated), before, 'the curated list itself is not touched (the same pick in a category below stays tagged by its category)')
  const plain = fieldAsPick({ source: 'someone/skills', name: 'review-contract', goal: 'Contracts', d: 'Reads a contract' })
  assert.equal(plain.tag, 'Contracts')
  assert.equal(plain.category, undefined)
  assert.equal(plain.title.en, 'Name of review-contract')
  ok('a skill of the field has its goal as its tag, whether it is also a curated pick (xlsx, docx) or not; the curated list is left as it was')
}

assert.ok(field.includes('noDetails') && !field.includes("setMode('yours')") && !field.includes("setMode('discover')"), 'Details stays on the tab it was clicked on')
assert.ok(/const noDetails = curated !== true && own === undefined && sk\.shipped === true/.test(field))
ok('Details opens a curated pick, an installed skill or the install panel, in a window over the tab (no switch of tab); a shipped skill that is not installed has none')

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
