#!/usr/bin/env node
/** The rating of an answer: five stars as ever, and two thumbs for the phone (the Theme setting `rating`, owner's list item 31, mock-up of 2026-11-24).
 *
 *  The component is cut out of client.js and rendered on the lite React (lib-lite-react-test.mjs). What it pins:
 *   - BOTH groups are always drawn (the page's CSS shows one of the two: `.kbq-rating-pouces` is hidden by the plugin's own CSS until the Theme's token asks), five stars and two thumbs;
 *   - thumbs up sends a 5 at once with no issue and no comment, shows the thanks card with a thumb in it, and never opens the sheet;
 *   - thumbs down is a 1 that opens the SAME sheet a low star opens (issue type, comment, Skip / Submit), titled with the thumb's words, and nothing is sent until Skip / Submit;
 *   - a star still does what it did (its sheet is titled « Rate n / 5 », the thumbs do not light);
 *   - the CSS: the thumbs are hidden unless asked for, and 36 px when shown by the plugin alone (44 px comes from the Theme's rule).
 *
 *  Usage: node packages/kybernos-plugin/test-rating-thumbs.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLite } from './lib-lite-react-test.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const lite = createLite()
const { React } = lite
const h = React.createElement
const a = src.indexOf('const KbQualityRating = (props) => {')
const b = src.indexOf('const KB_QUALITY_DAYS', a)
assert.ok(a > 0 && b > a, 'the rating component is in client.js')
const issues = src.slice(src.indexOf('const KB_RATING_ISSUES = ['), src.indexOf('const KbQualityRating = (props) => {'))
const calls = []
const doc = { addEventListener () {}, removeEventListener () {}, body: {} }
const win = { addEventListener () {}, removeEventListener () {}, innerWidth: 406, innerHeight: 757 }
const scope = {
  React, h, kbt: (k) => k, kbe: (s) => s, Icon: (n) => h('i', { 'data-icon': n }), kbPortal: null, kbRatingEtats: new Map(),
  kbActiverPoucesNatifs () {}, kbActiverGoalBadge () {}, kbActionsSurvol () {},
  host: { call: async (route, body) => { calls.push({ route, body }); return { ok: true } } },
  document: doc, window: win,
}
const KB_RATING_ISSUES = new Function('return ' + issues.replace(/^const KB_RATING_ISSUES = /, '').trim())()
const Rating = new Function(...Object.keys(scope), 'KB_RATING_ISSUES', 'return ' + src.slice(a, b).replace(/^const \w+ = /, ''))(...Object.values(scope), KB_RATING_ISSUES)
const byKb = (root, id) => lite.find(root.tree, (n) => n.props['data-kb'] === id)
const byClass = (root, c) => lite.find(root.tree, (n) => typeof n.props.className === 'string' && n.props.className.split(' ').indexOf(c) >= 0)

// 1. both groups are drawn
{
  const root = lite.mount(h(Rating, { messageId: 'm1', sessionId: 's1' }))
  await root.settle()
  assert.equal(byClass(root, 'kbq-rating-etoile').length, 5, 'five stars')
  assert.equal(byKb(root, 'rating-thumb-up').length, 1)
  assert.equal(byKb(root, 'rating-thumb-down').length, 1)
  assert.equal(byClass(root, 'kbq-rating-pouces').length, 1, 'and the group the page shows or hides')
  assert.equal(byKb(root, 'rating-thumb-up')[0].props.title, 'kbui.rating.thumbup', 'the thumbs carry their words')
  ok('the five stars and the two thumbs are always drawn (the page\'s CSS shows one of the two groups)')
}

// 2. thumbs up: a 5 at once
{
  calls.length = 0
  const root = lite.mount(h(Rating, { messageId: 'm2', sessionId: 's1' }))
  await root.settle()
  await byKb(root, 'rating-thumb-up')[0].props.onClick()
  await root.settle()
  assert.equal(calls.length, 1, 'one call to the host')
  assert.equal(calls[0].route, 'kybers/quality-rating')
  assert.deepEqual({ ...calls[0].body }, { sessionId: 's1', messageId: 'm2', note: 5, issue: '', comment: '', shared: true }, 'a 5, nothing else')
  assert.equal(byClass(root, 'kbq-rating-pop').length, 0, 'the sheet is not opened')
  assert.equal(byClass(root, 'kbq-rating-merci').length, 1, 'the thanks card is drawn')
  assert.ok(lite.find(root.tree, (n) => n.props['data-icon'] === 'thumbsUp').length >= 1, 'with a thumb in its tag, not « ★ 5 / 5 »')
  assert.equal(lite.textOf(root.tree).indexOf('★'), -1, 'no star text')
  assert.ok(/ on/.test(byKb(root, 'rating-thumb-up')[0].props.className), 'the thumb up is lit')
  ok('thumbs up sends a 5 at once (no issue, no comment), shows the thanks card with a thumb in it, never opens the sheet')
}

// 2b. thumbs up shows what it did: the share box, ticked as it was sent, and unticking sends the same rating again, not shared
{
  calls.length = 0
  const root = lite.mount(h(Rating, { messageId: 'm2b', sessionId: 's1' }))
  await root.settle()
  await byKb(root, 'rating-thumb-up')[0].props.onClick()
  await root.settle()
  const box = () => lite.find(root.tree, (n) => n.tag === 'input' && n.props.type === 'checkbox')
  assert.equal(box().length, 1, 'the share box is drawn under the thumbs')
  assert.equal(box()[0].props.checked, true, 'ticked: that is how the 5 was sent')
  assert.equal(byClass(root, 'kbq-rating-partage-apres').length, 1, 'in its own line (the Theme makes it 44 px)')
  assert.ok(lite.textOf(root.tree).indexOf('kbui.rating.partage') >= 0 && lite.textOf(root.tree).indexOf('kbui.rating.partage.ok') < 0, 'its words are the box\'s, not the tag\'s')
  await box()[0].props.onChange({ target: { checked: false } })
  await root.settle()
  assert.equal(calls.length, 2, 'unticking sends the rating again')
  assert.deepEqual({ ...calls[1].body }, { sessionId: 's1', messageId: 'm2b', note: 5, issue: '', comment: '', shared: false }, 'the same 5, now kept local (the host keeps one row per message)')
  assert.equal(box()[0].props.checked, false, 'and the box shows it')
  await box()[0].props.onChange({ target: { checked: true } })
  await root.settle()
  assert.equal(calls[2].body.shared, true, 'ticking it again shares it again')
  ok('thumbs up shows the share box ticked as sent; unticking sends the same 5 with shared:false, ticking again shares it')
}

// 2c. a star keeps the tag, not the box (its sheet already showed the box before sending)
{
  calls.length = 0
  const root = lite.mount(h(Rating, { messageId: 'm2c', sessionId: 's1' }))
  await root.settle()
  await byClass(root, 'kbq-rating-etoile')[4].props.onClick()
  await root.settle()
  const submit = lite.find(byClass(root, 'kbq-rating-pop')[0], (n) => n.tag === 'button' && typeof n.props.className === 'string' && n.props.className.indexOf('primary') >= 0)
  await submit[0].props.onClick()
  await root.settle()
  assert.equal(byClass(root, 'kbq-rating-partage-apres').length, 0, 'no share box after a star')
  assert.ok(lite.textOf(root.tree).indexOf('kbui.rating.partage.ok') >= 0, 'the tag says it was shared')
  ok('a star keeps the « shared » tag after sending (its sheet showed the box before)')
}

// 3. thumbs down: a 1 that opens the same sheet
{
  calls.length = 0
  const root = lite.mount(h(Rating, { messageId: 'm3', sessionId: 's1' }))
  await root.settle()
  await byKb(root, 'rating-thumb-down')[0].props.onClick()
  await root.settle()
  assert.equal(calls.length, 0, 'nothing is sent yet')
  const pop = byClass(root, 'kbq-rating-pop')
  assert.equal(pop.length, 1, 'the sheet is open')
  const text = lite.textOf(pop[0])
  assert.ok(text.indexOf('kbui.rating.thumbdown') >= 0, 'it is titled with the thumb\'s words')
  assert.equal(text.indexOf('/ 5'), -1, 'not « Rate 1 / 5 »')
  assert.equal(lite.find(pop[0], (n) => n.tag === 'select').length, 1, 'a 1 asks the issue type like a low star')
  assert.equal(lite.find(pop[0], (n) => n.tag === 'textarea').length, 1, 'and the comment')
  const submit = lite.find(pop[0], (n) => n.tag === 'button' && typeof n.props.className === 'string' && n.props.className.indexOf('primary') >= 0)
  assert.equal(submit.length, 1)
  await submit[0].props.onClick()
  await root.settle()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].body.note, 1, 'Submit stores a 1')
  assert.ok(lite.find(root.tree, (n) => n.props['data-icon'] === 'thumbsDown').length >= 1, 'the thanks card shows the thumb down')
  ok('thumbs down is a 1 that opens the same sheet (issue, comment, Skip / Submit), sends nothing until Submit, and stores a 1')
}

// 4. a star is what it was
{
  calls.length = 0
  const root = lite.mount(h(Rating, { messageId: 'm4', sessionId: 's1' }))
  await root.settle()
  await byClass(root, 'kbq-rating-etoile')[2].props.onClick()
  await root.settle()
  const pop = byClass(root, 'kbq-rating-pop')
  assert.equal(pop.length, 1)
  assert.ok(lite.textOf(pop[0]).indexOf('kbui.rating.notation 3 / 5') >= 0, 'a star\'s sheet is titled « Rate 3 / 5 »')
  assert.ok(!/ on/.test(byKb(root, 'rating-thumb-down')[0].props.className) && !/ on/.test(byKb(root, 'rating-thumb-up')[0].props.className), 'no thumb lights for a star')
  assert.equal(calls.length, 0)
  ok('a star still opens its sheet (« Rate n / 5 ») and lights no thumb')
}

// 5. the plugin's own CSS
{
  assert.ok(/\.kbq-rating-pouces\{display:none;/.test(src), 'the thumbs are hidden until the Theme asks')
  assert.ok(/\.kbq-rating-pouce\{[^}]*width:36px;height:36px/.test(src) && /\.kbq-rating-pouce\.on svg\{fill:currentColor\}/.test(src), 'a thumb is 36 px by itself and lit by a fill')
  assert.ok(!/\.kbq-rating-pouces\{[^}]*display:inline-flex/.test(src), 'only the Theme (rating-thumbs) shows the group')
  ok('CSS: the thumbs are hidden unless the Theme asks, 36 px by themselves, a lit one is filled')
}

console.log('\n' + pass + ' checks passed')
