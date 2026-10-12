#!/usr/bin/env node
/** One name for one object, on the screens of the core plugin.
 *
 *  The rule (decided with the owner, see the pull request that introduced it):
 *    · what the user builds and chats with — the AI team on a mission, `kyber.yml` — is a **Kyber** (plural **Kybers**), everywhere:
 *      the sidebar entry, the page, the tabs, the menus, the consoles;
 *    · **Agent Teams** names DSH's own runtime (the roster of a session) and nothing else;
 *    · **Team** is the paid workspace / plan (Team plan, Team access, the Team skills tab).
 *  "AI Team" and "Agent Team" as the name of a Kyber are gone, and this test keeps them from coming back by accident: the
 *  strings that really mean DSH's runtime are listed below by key — a new one has to be added here on purpose.
 *
 *  No browser: the dictionary is read from client.js (a browser bundle, not importable).
 *  Usage: node packages/kybernos-plugin/test-naming.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const dict = new Map()
for (const m of src.matchAll(/^\s+'([A-Za-z0-9_.]+)': \{ kybernos: '((?:[^'\\]|\\.)*)', en: '((?:[^'\\]|\\.)*)' \},?\s*$/gm)) dict.set(m[1], { kybernos: m[2], en: m[3] })
assert.ok(dict.size > 800, 'the dictionary was read (' + dict.size + ' entries)')

console.log('kybernos-plugin — one name for one object')

// 1. the nav entry and the page it opens agree
assert.equal(dict.get('menu.aiteams').en, 'Kybers')
assert.equal(dict.get('menu.aiteams').kybernos, 'Kybers')
assert.equal(dict.get('kbui.kybers').en, 'Kybers')
assert.equal(dict.get('ui.team.guide').en, 'Kybers')
assert.equal(dict.get('kbui.marketplace.tab').en, 'Marketplace')
ok('the sidebar entry, the page title and the right-panel tab all say « Kybers »; the second tab says « Marketplace »')

// 2. « AI Team » is not a name of anything any more
const aiTeam = [...dict].filter(([, v]) => /\bAI Teams?\b/.test(v.en))
assert.deepEqual(aiTeam.map(([k]) => k), [], 'an « AI Team » label is back: it is a Kyber')
assert.equal([...dict].filter(([, v]) => /\bNew AI Team\b/.test(v.en)).length, 0)
assert.equal(dict.get('menu.newchat.newteam').en, 'New Kyber')
ok('no label calls a Kyber an « AI Team » (the new-chat menu says « New Kyber »)')

// 3. « Agent Team(s) » only where the words mean DSH's runtime
const RUNTIME = new Set([
  'kbui.agentteams', 'kbui.kybers.vs.at', 'kbui.at.executes', 'kbui.model.caveat', 'kbat.c2.a', 'kbat.hr6.c',
  'ui.noliveteam', 'ui.liveteam.head', 'ui.rosterunavailable',
  'crew.roster.note.flat', 'crew.roster.note', 'crew.matrix.note', 'crew.noagentteams', 'crew.nomember', 'crew.offcrew.meta', 'crew.role.noagent',
])
const stray = [...dict].filter(([k, v]) => /\bAgent Teams?\b/.test(v.en) && !RUNTIME.has(k)).map(([k, v]) => k + ' = ' + v.en)
assert.deepEqual(stray, [], 'a label uses « Agent Team(s) » outside the runtime strings')
const gone = [...RUNTIME].filter((k) => !dict.has(k))
assert.deepEqual(gone, [], 'a key of the allow-list no longer exists: drop it from this test')
ok('« Agent Team(s) » appears only in the ' + RUNTIME.size + ' strings that explain DSH’s own runtime')

// 4. the help that explains the difference does not call the Kyber by the runtime's name
assert.equal(dict.get('kbat.c3.a').en, 'Kyber')
assert.ok(/Kyber/.test(dict.get('kbui.help.s1').en) && !/Agent Team/.test(dict.get('kbui.help.s1').en))
ok('the help table lists three different things: subagent, Agent Team (native DSH), Kyber')

// 5. a Kyber's page: its roles tab is not called « Team »
assert.ok(src.includes("const TABS = ['Identity', 'Roles', 'Workflow',"), 'the Kyber page has an « Identity · Roles · Workflow… » tab bar')
assert.ok(!/const TABS = \['Identity', 'Team'/.test(src))
assert.equal(dict.get('kbui.insight').en, 'Insight')
ok('a Kyber’s tabs are Identity · Roles · Workflow · … · Insight (« Team » is the plan)')

// 6. the marketplace is one word, and the page header does not change with the tab
assert.ok(!dict.has('kbui.marketplace.title'), 'no second title for the Marketplace tab (the header moved when it was swapped)')
assert.ok(/h\('h1', \{ className: 'kb6-title' \}, kbt\('kbui\.kybers'\)\)/.test(src), 'the page title is « Kybers » on both tabs')
ok('the page header is the same on both tabs (no « Kybers Marketplace » title swapped in)')

console.log('\n' + pass + ' verifications OK')
