#!/usr/bin/env node
// The Settings nav (organiser in client.js): what the layout promises, pinned without a browser.
// The DOM result itself is checked against the real GUI (scripts/check-settings-nav-live.mjs).
//
//   node packages/kybernos-plugin/test-settings-nav.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const start = SRC.indexOf("const GROUPES = [")
const block = SRC.slice(start, start + 24000)

console.log('About closes the list')
const fin = /const FIN_DE_LISTE = \[([^\]]*)\]/.exec(block)
const finWords = fin === null ? [] : fin[1].split(',').map((w) => w.trim().replace(/^'|'$/g, ''))
check('the end-of-list labels are About, in English and in French', finWords.indexOf('about') >= 0 && finWords.indexOf('a propos') >= 0, finWords)
const groupOrder = block.indexOf('cellule.style.order = String(g * 100 + 10 + wi)')
const endOrder = block.indexOf("if (FIN_DE_LISTE.indexOf(n) !== -1) cellule.style.order = '9000'")
check('the override comes AFTER the group order (else the group order wins)', groupOrder > 0 && endOrder > groupOrder, { groupOrder, endOrder })
const unknown = /cellule\.style\.order = String\((\d+) \+ idx\)/.exec(block)
check('9000 sits after every page a plugin can add (unknown labels start at 450)', unknown !== null && Number(unknown[1]) + 200 < 9000, unknown && unknown[1])
check('About is still a known label, so the Settings nav is still recognised from it', /'about', 'a propos'/.test(block))

// ── The sections, as the organiser reads them (the GROUPES literal, run with a stub for kbt) ──────────────────────
const gStart = SRC.indexOf('const GROUPES = [')
const gEnd = SRC.indexOf('\n      ]\n', gStart)
const GROUPES = gStart < 0 || gEnd < 0 ? [] : new Function('kbt', SRC.slice(gStart, gEnd + 8).replace('const GROUPES = ', 'return ').replace(/\n\s*\]\n$/, '\n]'))((k) => k)
const titlesOf = (g) => g.mots
// The English titles (the keys of KB_NAV_KEYS' values), one per page of the menu.
const keysBlock0 = /const KB_NAV_KEYS = \{([\s\S]*?)\n\}/.exec(SRC)
const PAGE_TITLES = new Set(keysBlock0 === null ? [] : [...keysBlock0[1].matchAll(/'?[A-Za-z0-9_-]+'?:\s*'([^']+)'/g)].map((m) => m[1]))
const where = (title) => GROUPES.findIndex((g) => g.mots.indexOf(title) >= 0)

console.log('the sections: the essentials first, the rest folded away (N-01, V-24)')
check('there are three sections: the essentials (no header), Advanced (a fold) and Other settings', GROUPES.length === 3 && GROUPES[0].titre === null && GROUPES[1].titre === 'settings.group.advanced' && GROUPES[1].pliable === true && GROUPES[2].titre === 'settings.group.other' && GROUPES[2].pliable !== true, GROUPES.map((g) => g.titre))
const first = GROUPES.length > 0 ? titlesOf(GROUPES[0]) : []
check('General comes first, before anything else', first[0] === 'general', first.slice(0, 3))
const essentials = ['general', 'ai provider & models', 'memory & lessons', 'skills', 'connectors', 'appearance', 'theme', 'language']
const rankIn = (list, w) => list.indexOf(w)
check('then what a newcomer needs, in the owner\'s order: AI Provider & Models, Memory & Lessons, Skills, Connectors, Appearance, Theme, Language',
  essentials.every((w) => rankIn(first, w) >= 0) && essentials.every((w, i) => i === 0 || rankIn(first, essentials[i - 1]) < rankIn(first, w)), first)
const shown = new Set(first.filter((w) => PAGE_TITLES.has(w)))
check('a newcomer sees eight pages before opening anything, ten at most (it was 28)', shown.size >= 8 && shown.size <= 10, [...shown])
const advanced = GROUPES.length > 1 ? titlesOf(GROUPES[1]) : []
const ownerAdvanced = ['servers', 'kybernos suite', 'auto routing', 'usage', 'workers', 'automations', 'tools', 'web search', 'calls', 'remote control', 'commands', 'atlas', 'ollama local models', 'free llms', 'voice']
check('Advanced holds the owner\'s list, in the owner\'s order', ownerAdvanced.every((w) => rankIn(advanced, w) >= 0) && ownerAdvanced.every((w, i) => i === 0 || rankIn(advanced, ownerAdvanced[i - 1]) < rankIn(advanced, w)), advanced)
check('the two pages the owner did not name sit in Advanced too: Kybernos (what stays on this computer) and Cloud computers', rankIn(advanced, 'kybernos') >= 0 && rankIn(advanced, 'cloud computers') >= 0)
const other = GROUPES.length > 2 ? titlesOf(GROUPES[2]) : []
check('Other settings holds Built-in plugins, then Agent presets', rankIn(other, 'built-in plugins') >= 0 && rankIn(other, 'built-in plugins') < rankIn(other, 'agent presets'), other)
check('every page of the menu has exactly one section (none is lost, none is twice)', [...PAGE_TITLES].every((t) => GROUPES.filter((g) => g.mots.indexOf(t) >= 0).length === 1), [...PAGE_TITLES].filter((t) => GROUPES.filter((g) => g.mots.indexOf(t) >= 0).length !== 1))
check('About is the one page nobody groups with the others: it closes the list from Other settings', where('about') === 2)
check('the old « Kybernos » section, its Desktop divider and the shell\'s Settings header are gone (a header named like a page, 23 pages under it)', !/settings\.group\.(kybernos|settings|desktop|plugins)|settings\.divider\.desktop|settings-divider/.test(SRC))
check('the « seen » flags follow the number of sections', /const vus = GROUPES\.map\(\(\) => false\)/.test(block))
check('a page no section knows (a plugin added later) sits after them all, before About', /cellule\.style\.order = String\(450 \+ idx\)/.test(block))

console.log('the Advanced fold: shut by itself, open when the person needs it, remembered')
const fa = SRC.indexOf('const kbFoldNext = ')
const fb = SRC.indexOf('// </kb-settings-fold>')
const FOLD = fa < 0 || fb < fa ? null : new Function(SRC.slice(fa, fb) + '\nreturn { kbFoldNext }')()
check('the fold logic is cut out of client.js between its markers', FOLD !== null)
if (FOLD !== null) {
  const next = FOLD.kbFoldNext
  check('a person who never chose finds it shut', next({ stored: null, inside: false, changed: false }).open === false)
  check('a person who opened it finds it open, and one who shut it finds it shut', next({ stored: true, inside: false, changed: false }).open === true && next({ stored: false, inside: false, changed: false }).open === false)
  const landed = next({ stored: false, inside: true, changed: true })
  check('landing on a page inside it (a deep link, a help pointer, a click on a row of the Suite) opens it, and that is remembered', landed.open === true && landed.remember === true, landed)
  check('staying on a page inside it does not fight the person who shuts the fold on purpose', next({ stored: false, inside: true, changed: false }).open === false)
  check('landing on a page outside it changes nothing', next({ stored: false, inside: false, changed: true }).open === false && next({ stored: true, inside: false, changed: true }).open === true)
  check('a fold that is already open is not written again', next({ stored: true, inside: true, changed: true }).remember === false)
}
check('the fold remembers its state through the shared helper (one store for every fold)', /const PLI_ID = 'settings-advanced'/.test(block) && /kbCzWrite\(PLI_ID, /.test(block) && /kbCzRead\(PLI_ID\)/.test(block) && /window\.__KB_CUSTOMIZE__ = \{ Fold: KbCustomize/.test(SRC))
check('the nav\'s fold button is the shared one (the same button as the Customize fold of a page)', /kbCzToggle\(GROUPES\[g\]\.titre/.test(block))
check('the shut fold hides only its own entries, only in the Settings list, and never the page the person is on', /\[class\*="navList"\]\[data-kb-settings\]\[data-kb-fold="shut"\]:not\(\[data-kb-searching\]\) \[data-kb-fold-cell\]:not\(\[aria-current="true"\]\)\{display:none\}/.test(SRC))
check('the search box opens it while a query runs (a match inside must show) and lets go when the query is cleared', /setAttribute\('data-kb-searching', '1'\)/.test(SRC) && /removeAttribute\('data-kb-searching'\)/.test(SRC))
check('the search hides a header with no entry left under it, and the fold\'s header is no <button> (the phone layout takes a tap on a nav button for « a page was picked »)', /hd\.style\.display = /.test(SRC) && /document\.createElement\(plain === true \? 'div' : 'button'\)/.test(SRC) && /kbCzToggle\(GROUPES\[g\]\.titre, false, \(\) => basculer\(liste\), true\)/.test(block))
check('the observer also hears the page change (aria-current), so a click on a hidden row opens the fold', /attributeFilter: \['aria-current'\]/.test(block))
check('Theme and Language are drawn under Appearance, one step in', /data-kb-sub/.test(block) && /\[data-kb-sub\]\{padding-inline-start:/.test(SRC))

console.log('room at the end, smaller names')
check('the Settings list is marked, so only it is restyled', block.indexOf("liste.dataset.kbSettings = '1'") > 0)
check('it gets room under the last tab', /\[class\*="navList"\]\[data-kb-settings\]\{padding-bottom:\d+px\}/.test(SRC))
const fs = /\[class\*="navList"\]\[data-kb-settings\] \[class\*="navCell"\]\{font-size:(\d+(?:\.\d+)?)px\}/.exec(SRC)
check('tab names are smaller than the shell\'s 14px but still readable', fs !== null && Number(fs[1]) < 14 && Number(fs[1]) >= 12, fs && fs[1])
check('the other navs of the app are not touched (every rule is scoped by data-kb-settings)', !/\[class\*="navList"\]\{[^}]*(padding-bottom|font-size)/.test(SRC))

// ── A page a bundle adds to Settings must be known to the organiser ──────────────────────────────────────────
// The organiser draws the icon of a cell, and places it in a section, from the cell's TITLE. A bundle that
// registers a settings page and is not in KB_NAV_KEYS / ICONES / GROUPES gets the shell's gear and falls to the
// tail of the menu (Skills, Connectors, Free LLMs and Mobile did, and Usage lost its icon outside English).
console.log('every settings page a bundle adds is known to the organiser')
const here = dirname(fileURLToPath(import.meta.url))
const pkgs = join(here, '..')
const ids = new Set()
for (const d of readdirSync(pkgs)) {
  const f = join(pkgs, d, 'client.js')
  if (!existsSync(f)) continue
  const txt = readFileSync(f, 'utf8')
  for (const m of txt.matchAll(/name: 'settings\.section',\s*id: '([^']+)'/g)) ids.add(m[1])
}
const keysBlock = /const KB_NAV_KEYS = \{([\s\S]*?)\n\}/.exec(SRC)
const navKeys = {}
if (keysBlock !== null) for (const m of keysBlock[1].matchAll(/'?([A-Za-z0-9_-]+)'?:\s*'([^']+)'/g)) navKeys[m[1]] = m[2]
const iconBlock = /const ICONES = \{([\s\S]*?)\n      \}/.exec(SRC)
const iconKeys = new Set(iconBlock === null ? [] : [...iconBlock[1].matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]))
const groupWords = new Set([...block.matchAll(/mots: \[([^\]]*)\]/g)].flatMap((m) => m[1].split(',').map((w) => w.trim().replace(/^'|'$/g, '')).filter(Boolean)))
check('some settings pages were found in the bundles', ids.size >= 15, ids.size)
const unknownIds = [...ids].filter((id) => navKeys[id] === undefined)
check('every registered settings page has a key in KB_NAV_KEYS (its title is the same in every language)', unknownIds.length === 0, unknownIds)
const noIcon = [...ids].filter((id) => navKeys[id] !== undefined && !iconKeys.has(navKeys[id]))
check('every one of them has its own icon in ICONES (no gear)', noIcon.length === 0, noIcon.map((id) => id + ' -> ' + navKeys[id]))
const noGroup = [...ids].filter((id) => navKeys[id] !== undefined && !groupWords.has(navKeys[id]))
check('every one of them sits in a section (none falls to the tail of the menu)', noGroup.length === 0, noGroup.map((id) => id + ' -> ' + navKeys[id]))
const mobile = SRC.length > 0 ? readFileSync(join(pkgs, 'kybernos-mobile', 'client.js'), 'utf8') : ''
check('the phone page is called « Remote Control » in the nav and as its title', /label: 'Remote Control'/.test(mobile) && /kbmr-title' \}, 'Remote Control'/.test(mobile))
const free = readFileSync(join(pkgs, 'kybernos-free-llms', 'client.js'), 'utf8')
check('the free models page does not put a provider name in its title', !/'kfl\.(page\.)?titre': \{[^}]*OpenCode/.test(free))

console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
