#!/usr/bin/env node
/** The Skills page's header: the shared bar (search, filter, order) and the primary action sit in the header row like the other listing
 *  pages. Pinned at source level (the page is a browser half): the adapter between the bar and the page's own state, the fallback when
 *  the page is mounted without the bar, and the hand-over from kybernos-plugin.
 *
 *  Usage: node packages/kybernos-skills/test-bar.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')
const plugin = readFileSync(join(here, '..', 'kybernos-plugin', 'client.js'), 'utf8')

// 1. the bar is the one the core plugin hands over, and it carries the primary action
assert.match(src, /props\.toolbar !== null && typeof props\.toolbar === 'object'/, 'the page reads the bar from its props')
assert.match(src, /KbBar !== null\s*\? h\('div', \{ className: 'kb6-headrow' \}/, 'the header row is the template one')
assert.match(src, /trailing: headAction,/, 'the primary action is the bar\'s trailing item')
assert.match(src, /: h\('div', \{ className: 'kb6-headacts' \}, headAction\)/, 'with nothing to list, the action alone keeps its place')
ok('the header row carries the bar, with the primary action as its trailing item (the action alone when nothing is listed)')

// 2. the bar's changes go to the page's own state; the two Yours groups and the Discover rows are single choices
assert.match(src, /const barUpdate = \(patch\) =>/)
assert.match(src, /patch\.query !== undefined[\s\S]*setQ\(\(m\) => \(\{ \.\.\.m, \[mode\]: v \}\)\)/, 'search goes to the query of the active tab')
assert.match(src, /setSort\(\(m\) => \(\{ \.\.\.m, discover: 'installs' \}\)\); setIview\(/, 'a Discover ranking is a view of the index')
assert.match(src, /\^rows:\\d\+\$/, 'rows per page is read back from its facet')
assert.match(src, /st:' \+ stateFilter[\s\S]*src:' \+ sourceFilter/, 'state and source are the two filter groups of Yours')
ok('search, order and filters are mapped onto the page\'s own state (state and source of Yours, ranking and rows of Discover)')

// 3. mounted without the bar nothing changes
assert.match(src, /h\('div', \{ className: 'kbs-top' \}/, 'the old header is still there')
assert.match(src, /KbBar !== null \? null : \(mode === 'team'/, 'and so are the old controls')
ok('mounted without the bar (Settings, tests) the page keeps its own header and controls')

// 4. kybernos-plugin hands the tools down and drops its second title
assert.match(plugin, /h\(SkillsMount, \{ sessionId: sid, toolbar: \{ KbToolbar: KbToolbar, useToolbarState: useToolbarState \} \}\)/)
assert.ok(!/kbPageHead\(kbt\('kbui\.skills'\)\)/.test(plugin), 'no outer « Skills » above the page\'s own')
assert.match(plugin, /return h\(first\.component, \{ sessionId: sid, toolbar: toolbar \}\)/, 'the mounted component receives it')
ok('kybernos-plugin passes the bar down and no longer draws a second title')

console.log('\n' + pass + ' checks passed')
