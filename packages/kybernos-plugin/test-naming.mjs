#!/usr/bin/env node
/** One name for one object, on every screen that names it.
 *
 *  The rule (decided by the owner, 2026-10-12):
 *    · what the user builds and chats with — a team of agents on a mission, defined by a `kyber.yml` — is an
 *      **Agent Team** (plural **Agent Teams**), everywhere: the sidebar entry, the page, the tabs, the menus, the consoles.
 *      DSH's own runtime (the Agent Teams roster of a session) has the same name on purpose: an Agent Team is defined by a
 *      `kyber.yml` and run by DSH's Agent Teams runtime;
 *    · **Team** is the paid workspace / plan (Team plan, Team access, the Team skills tab) and is left alone;
 *    · « Kyber » is not a label any more, and neither is « AI Team ». It stays only as a technical word: the file
 *      `kyber.yml`, the `.kyber…` markers, the skill `kyber-authoring`, ids, routes and keys.
 *  This test keeps both names from coming back by accident, in the English and in the French text of the dictionary, in
 *  the French sentences of `KB_FR_EN`, in the `help.json` of every bundle and in the catalogue built from them.
 *
 *  French: « Agent Team » is kept in English as the product term and is feminine (« une Agent Team », « les Agent Teams »,
 *  « cette Agent Team »): a masculine article in front of it is a bug.
 *
 *  No browser: the dictionary is read from client.js (a browser bundle, not importable).
 *  Usage: node packages/kybernos-plugin/test-naming.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGES = join(HERE, '..')
const src = readFileSync(join(HERE, 'client.js'), 'utf8')
const dict = new Map()
for (const m of src.matchAll(/^\s+'([A-Za-z0-9_.]+)': \{ kybernos: '((?:[^'\\]|\\.)*)', en: '((?:[^'\\]|\\.)*)' \},?\s*$/gm)) dict.set(m[1], { kybernos: m[2], en: m[3] })
assert.ok(dict.size > 800, 'the dictionary was read (' + dict.size + ' entries)')

// « kyber » as a technical word: the file, the markers, the skills, the ids and routes. Everything else is a label.
const TECHNICAL = [
  /kyber\.ya?ml/gi,
  /kyber-(?:authoring|routing|memory|topology|selection)/gi,
  /kyber_id|kyberId/g,
  /`[^`]*kybers?\/[^`]*`/g,
]
const kyberLeft = (s) => {
  let t = String(s)
  for (const re of TECHNICAL) t = t.replace(re, '')
  const m = /kyber(?!nos)/i.exec(t)
  return m === null ? null : t.slice(Math.max(0, m.index - 20), m.index + 30)
}

console.log('kybernos-plugin — one name for one object')

// 1. the nav entry, the page and the right-panel tab agree
for (const key of ['menu.aiteams', 'kbui.kybers', 'ui.team.guide', 'kbtg.kybers']) {
  assert.equal(dict.get(key).en, 'Agent Teams', key)
  assert.equal(dict.get(key).kybernos, 'Agent Teams', key)
}
assert.equal(dict.get('kbui.marketplace.tab').en, 'Marketplace')
ok('the sidebar entry, the page title, the right-panel tab and the chip all say « Agent Teams » (EN and FR); the second tab says « Marketplace »')

// 2. « Kyber » is not a label, in any string of the dictionary, in either language
// The one exception, on purpose: « Kyber » is also the name of the person's OWN assistant (ADR 0053: the one that answers them on Telegram and works on their
// computer), and its menu row and page say so. It is allowed on exactly these keys; an Agent Team is still never called a Kyber.
const ASSISTANT_KEYS = new Set(['kbui.kyber', 'kbui.kyber.off'])
const kyberLabels = []
for (const [k, v] of dict) for (const lang of ['en', 'kybernos']) { if (ASSISTANT_KEYS.has(k)) continue; const at = kyberLeft(v[lang]); if (at !== null) kyberLabels.push(k + ' (' + lang + '): …' + at + '…') }
assert.deepEqual(kyberLabels, [], 'a « Kyber » label is back: it is an Agent Team')
assert.equal(dict.get('kbui.kyber').en, 'Kyber')
ok('no string of the dictionary calls an Agent Team a « Kyber » (only kyber.yml, the other technical words, and the name of the person\'s own assistant remain)')

// 3. nor « AI Team »
const aiTeam = []
for (const [k, v] of dict) {
  if (/\bAI Teams?\b/i.test(v.en)) aiTeam.push(k + ' (en): ' + v.en)
  if (/\b[ée]quipes? IA\b/i.test(v.kybernos) || /\bAI Teams?\b/i.test(v.kybernos)) aiTeam.push(k + ' (fr): ' + v.kybernos)
}
assert.deepEqual(aiTeam, [], 'an « AI Team » label is back: it is an Agent Team')
ok('no string calls an Agent Team an « AI Team » (« équipe IA » in French)')

// 4. the new-chat menu and the empty states
assert.equal(dict.get('menu.newchat.newteam').en, 'New Agent Team')
assert.equal(dict.get('menu.newchat.newteam').kybernos, 'Nouvelle Agent Team')
assert.equal(dict.get('kbui.new.kyber').en, 'New Agent Team')
assert.equal(dict.get('kbui.new.kyber').kybernos, 'Nouvelle Agent Team')
assert.equal(dict.get('menu.newchat.noteam').en, 'No Agent Team installed yet.')
assert.equal(dict.get('menu.newchat.noteam').kybernos, 'Aucune Agent Team installée pour l’instant.')
ok('the new-chat menu says « New Agent Team » / « Nouvelle Agent Team » and the empty state agrees with the noun')

// 5. grammar: « an Agent Team » in English, a feminine noun in French
const gram = []
for (const [k, v] of dict) {
  if (/\ba Agent Team/i.test(v.en)) gram.push(k + ' (en): ' + v.en)
  if (/\b(?:un|le|ce|du|au|aucun|nouveau|tous les|ceux|celui)\s+Agent Teams?\b/i.test(v.kybernos)) gram.push(k + ' (fr): ' + v.kybernos)
  if (/\b(?:un|ce|aucun)\s+(?:autre\s+)?Agent Teams?\b/i.test(v.kybernos)) gram.push(k + ' (fr): ' + v.kybernos)
}
assert.deepEqual(gram, [], 'an article or an adjective does not agree with « Agent Team »')
ok('English says « an Agent Team »; French puts the feminine article in front of « Agent Team » (une, la, cette, aucune)')

// 6. the French sentences of the `kbf` table and the code that uses them stay in step
const tableAt = src.indexOf('const KB_FR_EN = {')
const tableEnd = src.indexOf('\n}\n', tableAt)
const table = src.slice(tableAt, tableEnd)
const phrases = []
for (const m of table.matchAll(/^  '((?:[^'\\]|\\.)*)': '((?:[^'\\]|\\.)*)',?\s*$/gm)) phrases.push([m[1], m[2]])
assert.ok(phrases.length > 500, 'the kbf table was read (' + phrases.length + ' phrases)')
const phraseBad = phrases.filter(([fr, en]) => kyberLeft(fr) !== null || kyberLeft(en) !== null || /\bAI Teams?\b/i.test(en)).map(([fr]) => fr)
assert.deepEqual(phraseBad, [], 'a French sentence of KB_FR_EN (or its English) still says « Kyber »')
ok('the ' + phrases.length + ' French sentences of KB_FR_EN and their English say « Agent Team », never « Kyber »')

// 7. the help that explained « Kybers and Agent Teams: two different things » no longer opposes two names
assert.ok(!/two different things/i.test(dict.get('kbui.kybers.vs.at').en), 'the help title still opposes two names')
assert.ok(!/Kybers? and Agent Teams?/i.test(dict.get('kbui.kybers.vs.at').en))
assert.ok(/Agent Team/.test(dict.get('kbui.kybers.vs.at').en) && /Agent Team/.test(dict.get('kbui.kybers.vs.at').kybernos))
assert.ok(src.includes("h('th', null, kbt('kbat.col.def')), h('th', null, kbt('kbat.col.runtime'))"), 'the help table heads its two columns with the definition and the runtime')
assert.ok(/kyber\.yml/.test(dict.get('kbat.col.def').en) && /runtime/i.test(dict.get('kbat.col.runtime').en))
assert.ok(/kyber\.yml/.test(dict.get('kbui.kyber.declares').en) && !/\bagent team\b/i.test(dict.get('kbui.kyber.declares').en), 'the file declares the crew')
assert.equal(dict.get('kbat.c3.a').en, 'Agent Team')
assert.ok(/runtime/i.test(dict.get('kbat.c2.a').en) && /runtime/i.test(dict.get('kbat.c2.a').kybernos), 'the second « notion » is the runtime, not a second name for the Agent Team')
ok('the help says: an Agent Team is defined by a kyber.yml and run by DSH’s Agent Teams runtime; a subagent is another thing')

// 8. a team's page: its roles tab is not called « Team »
assert.ok(src.includes("const TABS = ['Identity', 'Roles', 'Workflow',"), 'the Agent Team page has an « Identity · Roles · Workflow… » tab bar')
assert.ok(!/const TABS = \['Identity', 'Team'/.test(src))
assert.equal(dict.get('kbui.insight').en, 'Insight')
ok('an Agent Team’s tabs are Identity · Roles · Workflow · … · Insight (« Team » is the plan)')

// 9. the marketplace is one word, and the page header does not change with the tab
assert.ok(!dict.has('kbui.marketplace.title'), 'no second title for the Marketplace tab (the header moved when it was swapped)')
assert.ok(/h\('h1', \{ className: 'kb6-title' \}, kbt\('kbui\.kybers'\)\)/.test(src), 'the page title is « Agent Teams » on both tabs')
ok('the page header is the same on both tabs (no « Agent Teams Marketplace » title swapped in)')

// 10. the other bundles: their help.json (EN and FR) and the catalogue built from them
const jsonStrings = (v, out = []) => {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => jsonStrings(x, out))
  else if (v !== null && typeof v === 'object') Object.values(v).forEach((x) => jsonStrings(x, out))
  return out
}
const files = []
for (const d of readdirSync(PACKAGES)) {
  const f = join(PACKAGES, d, 'help.json')
  if (existsSync(f)) files.push(f)
}
files.push(join(PACKAGES, 'kybernos-hub', 'catalog.json'))
const helpBad = []
// The tab of the person's own assistant says « Kyber » (ASSISTANT_KEYS above): its help and its catalogue entry are not scanned for the word.
const withoutAssistant = (f) => {
  const j = JSON.parse(readFileSync(f, 'utf8'))
  if (f.includes('kybernos-kyber')) return {}
  if (j !== null && typeof j === 'object' && Array.isArray(j.modules)) j.modules = j.modules.filter((m) => m === null || typeof m !== 'object' || m.id !== 'kybernos-kyber')
  return j
}
for (const f of files) for (const s of jsonStrings(withoutAssistant(f))) {
  const at = kyberLeft(s)
  if (at !== null) helpBad.push(f.slice(PACKAGES.length + 1) + ': …' + at + '…')
  if (/\b(?:un|le|ce|du|au|aucun)\s+Agent Teams?\b/i.test(s) || /\ba Agent Team/i.test(s)) helpBad.push(f.slice(PACKAGES.length + 1) + ' (grammar): ' + s)
}
assert.deepEqual(helpBad, [], 'a help.json or the catalogue says « Kyber » (or does not agree with « Agent Team »)')
ok('the help.json of every bundle (' + (files.length - 1) + ') and the catalogue say « Agent Team », never « Kyber »')

// 11. the strings of the other bundles' browser halves: a capitalised « Kyber(s) » alone in a line of code is a label
const clientFiles = []
// kybernos-kyber is the person's own assistant's tab: its name is the label (ASSISTANT_KEYS above), not an Agent Team called a Kyber.
for (const d of readdirSync(PACKAGES)) for (const rel of ['client.js', 'client/client.js', 'src/plugin.js']) {
  const f = join(PACKAGES, d, rel)
  if (existsSync(f) && d !== 'kybernos-plugin' && d !== 'kybernos-kyber') clientFiles.push(f)
}
const labelBad = []
for (const f of clientFiles) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const code = line.trim()
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return
    if (/(?<![\w.$/-])Kybers?(?![\w.:/-])/.test(code)) labelBad.push(f.slice(PACKAGES.length + 1) + ':' + (i + 1))
  })
}
assert.deepEqual(labelBad, [], 'a « Kyber » label is back in a browser half')
ok('no browser half of the other ' + clientFiles.length + ' bundles carries a « Kyber(s) » label')

console.log('\n' + pass + ' verifications OK')
