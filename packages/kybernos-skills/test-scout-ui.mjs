#!/usr/bin/env node
/** The Featured tab after the owner's remark of 2026-10-23 (« faire simple, homogénéiser les premières cartes avec les autres; si une image manque, Kaby ou le système
 *  l'ajoute avec le même prompt ») and the skill scout, source-level like test-picks.mjs:
 *   - the first cards (the field's skills and the scout's finds) are the picks' own cards and rows: no tint of their own, no smaller picture;
 *   - a find is a pick: Install through the usual confirmation, Details in Discover, « Not interested » that leaves at once and is remembered by the host;
 *   - a card with no picture asks the host for one (once), looks again while it is made, and shows it; a picture the browser cannot read counts as missing;
 *   - « Scan now » says what happened, « Make it weekly » goes through the page seam of the core plugin.
 *  Usage: node packages/kybernos-skills/test-scout-ui.mjs   (exit 0 = all pass) */
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

// 1. nothing makes the first cards different from the others
assert.ok(!/\.kbsf-flat \.kbsf-t\b/.test(src) && !/\.kbsf-flat \.kbsf-pic/.test(src), 'the field cards are not re-tinted or shrunk')
assert.ok(/\.kbs-root \.kbsf-flat\{margin:0 0 16px\}/.test(src))
const group = between('const firstGroup = ', 'const renderScoutLine = ')
assert.ok(group.includes('pickRow(it.pick, i, it.opts)') && group.includes('pickCard(it.pick, i, it.opts)'), 'the same card and row as the picks')
assert.ok(group.includes("pcat !== 'all' || q.featured.trim() !== ''") && group.includes('skills.some((y) => y.name === f.name) === false'), 'a category or a search leaves the first group alone; an installed find is not offered')
ok('the first cards are the picks\' own cards and rows: no tint, no smaller picture; the group shows on the whole tab only')

// 2. a find is a pick with three gestures
const scoutAsPick = between('const scoutAsPick = ', 'const scoutOpts = ')
assert.ok(scoutAsPick.includes("needs: f.risky === true ? 'commands' : null") && scoutAsPick.includes("t('scout.tag')") && scoutAsPick.includes('f.audits'))
const scoutOpts = between('const scoutOpts = ', 'const firstGroup = ')
assert.ok(scoutOpts.includes('onSkip: () => skipFind(f)') && scoutOpts.includes("setMode('discover'); setDetail(x)") && scoutOpts.includes("t('scout.why'"))
const buttons = between('const pickButtons = ', 'const pickStar = ')
assert.ok(buttons.includes("'data-kb': 'scout-skip'") && buttons.includes('opts.onSkip()') && buttons.includes("icon('close', 14)") && buttons.includes("t('scout.skip') + ' — '"))
assert.ok(buttons.includes('setAskInstall(x)'), 'Install goes through the usual confirmation')
ok('a find is a pick: audits as pills, « can run commands » for a risky one, Install with the usual confirmation, Details in Discover, a labelled « Not interested »')

const skip = between('const skipFind = ', 'const scoutWeekly = ')
assert.ok(skip.includes("setScout((m) => ({ ...m, found: m.found.filter((x) => x.id !== f.id) }))") && skip.includes("postJson('/kybernos-skills/scout/dismiss', { id: f.id })") && skip.includes('loadScout()'))
ok('« Not interested » takes the card away at once, tells the host, and reads again if the host refuses')

// 3. Scan now and Make it weekly
const scan = between('const loadScout = ', 'const skipFind = ')
assert.ok(scan.includes('setTimeout(loadScout, 3000)') && scan.includes("postJson('/kybernos-skills/scout/run', {})") && scan.includes("t('scout.recent')") && scan.includes("t('scout.done'"))
assert.ok(scan.includes('if (scout.scanning === true) return'), 'a second press while it scans does nothing')
const weekly = between('const scoutWeekly = ', 'const switchCovers = ')
assert.ok(weekly.includes("o.template('skill-scout') === true") && weekly.includes("t('scout.weeklyFail')"))
ok('« Scan now » asks again every three seconds while it scans and answers (done, under ten minutes old, a refusal); « Make it weekly » uses the core plugin\'s seam and says when it cannot')

// 4. covers
const covers = between('const coverWanted = ', 'const renderFeatured = ')
assert.ok(covers.includes("getJson('/kybernos-skills/covers/state?names='") && covers.includes("postJson('/kybernos-skills/covers/make'") && covers.includes('coverAsked.current'))
assert.ok(covers.includes('setTimeout(look, 4000)') && covers.includes("mode !== 'featured'"), 'it looks again every four seconds while pictures are made, and only on the Featured tab')
assert.ok(covers.includes('return { ...m, can: j.can === true'), 'the answer is merged into the state, never replaces it (it lost `broken` once and the page crashed: Cannot read properties of undefined)')
assert.ok(covers.includes("items[n] === 'none'") && covers.includes('j.can === true'), 'only what can be made, only what is missing')
const cover = between('const coverSrc = ', 'const pickBy = ')
assert.ok(cover.includes('covers.ver[p.id]') && cover.includes('covers.broken[p.id]') && cover.includes('setCovers((m) => (m.broken[p.id] === true'))
ok('a card with no picture asks the host for one (once, only when it can), looks again while it is made, shows it; a picture that cannot be read counts as missing')
assert.ok(src.includes('.kbs-root .kbsf-making .kb8-tile{animation:kbsf-wait') && src.includes('prefers-reduced-motion:reduce'))
ok('a picture being made pulses gently, and not for a person who asked for less motion')

// 5. the words
for (const key of ['scout.tag', 'scout.skip', 'scout.skipped', 'scout.name', 'scout.never', 'scout.last', 'scout.now', 'scout.scanning', 'scout.weekly', 'scout.weeklyTip', 'scout.weeklyFail', 'scout.done', 'scout.recent', 'scout.why', 'need.commands', 'cover.making', 'cover.line', 'cover.off', 'cover.on', 'cover.turnOn', 'md.raw', 'md.rendered', 'md.tip']) {
  assert.match(src, new RegExp("'" + key.replace(/\./g, '\\.') + "': \\{ fr: '[^']+', en: '[^']+' \\}"), key + ' has both languages')
}
ok('every new sentence has a French and an English text')

console.log(pass + ' tests passed')
