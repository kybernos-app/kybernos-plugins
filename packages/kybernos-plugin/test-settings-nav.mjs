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

console.log('the groups: General alone, then eight folds')
check('there are nine groups: General (no header, no fold) and eight folds, each with an icon', GROUPES.length === 9 && GROUPES[0].titre === null && GROUPES[0].mots[0] === 'general' && GROUPES.slice(1).every((g) => g.pliable === true && /^settings\.group\./.test(String(g.titre)) && typeof g.icone === 'string'), GROUPES.map((g) => g.id))
check('the folds are, in order: Models & routing, Agents, Skills & tools, Memory & context, Voice & calls, Interface, Devices & cloud, System',
  GROUPES.slice(1).map((g) => g.id).join(',') === 'models,agents,tools,memory,voice,look,devices,system', GROUPES.map((g) => g.id))
const inGroup = (id) => (GROUPES.find((g) => g.id === id) || { mots: [] }).mots
const inOrder = (list, want) => want.every((w) => list.indexOf(w) >= 0) && want.every((w, i) => i === 0 || list.indexOf(want[i - 1]) < list.indexOf(w))
check('Models & routing holds the models, the routing that picks one, the free ones, the local ones and the usage, in that order', inOrder(inGroup('models'), ['ai provider and models', 'auto routing', 'free llms', 'ollama local models', 'usage']))
check('Agents holds the presets, the workers, the automations and the commands', inOrder(inGroup('agents'), ['agent presets', 'workers', 'automations', 'commands']))
check('Skills & tools holds the skills, the tools, the connectors and the web search', inOrder(inGroup('tools'), ['skills', 'tools', 'connectors', 'web search']))
check('Memory & context holds Memory & Lessons first, then what stays on this computer (Kybernos), then the Atlas', inOrder(inGroup('memory'), ['memory & lessons', 'kybernos', 'atlas']))
check('Voice & calls holds Voice and Calls', inOrder(inGroup('voice'), ['voice', 'calls']))
check('Interface holds Appearance, Theme and Language (the three pages that were drawn one step in under Appearance)', inOrder(inGroup('look'), ['appearance', 'theme', 'language']))
check('Devices & cloud holds the servers, the code sandbox and the phone link', inOrder(inGroup('devices'), ['servers', 'code sandbox (e2b)', 'phone and channels']))
check('System holds the Suite and the shell\'s Built-in plugins, and About closes it', inOrder(inGroup('system'), ['kybernos suite', 'built-in plugins', 'about']))
check('every page of the menu has exactly one group (none is lost, none is twice)', [...PAGE_TITLES].every((t) => GROUPES.filter((g) => g.mots.indexOf(t) >= 0).length === 1), [...PAGE_TITLES].filter((t) => GROUPES.filter((g) => g.mots.indexOf(t) >= 0).length !== 1))
check('About is the one page nobody groups with the others: it closes the list, after the folds', where('about') === 8)
check('the Advanced fold, Other settings and the old section headers are gone', !/settings\.group\.(advanced|other|kybernos|settings|desktop|plugins)|settings\.divider/.test(SRC))
check('the « seen » flags follow the number of groups', /const vus = GROUPES\.map\(\(\) => false\)/.test(block))
check('a page no group knows (a plugin added later) sits after them all, before About', /cellule\.style\.order = String\(450 \+ idx\)/.test(block))

console.log('the accordion: one group open, the one the person is in, remembered')
const fa = SRC.indexOf('const kbGroupNext = ')
const fb = SRC.indexOf('// </kb-settings-fold>')
const FOLD = fa < 0 || fb < fa ? null : new Function(SRC.slice(fa, fb) + '\nreturn { kbGroupNext }')()
check('the logic is cut out of client.js between its markers', FOLD !== null)
if (FOLD !== null) {
  const next = FOLD.kbGroupNext
  check('a person who never chose finds every group shut', next({ stored: null, active: null, changed: false }).open === null)
  check('a group the person left open is open on the next visit, and one they shut stays shut', next({ stored: 'tools', active: null, changed: false }).open === 'tools' && next({ stored: '', active: null, changed: false }).open === '')
  const landed = next({ stored: 'tools', active: 'look', changed: true })
  check('landing on a page in another group (a deep link, a help pointer, a search result) opens that group, shuts the first, and remembers it', landed.open === 'look' && landed.remember === true, landed)
  check('staying on a page does not fight the person who shuts its group on purpose', next({ stored: '', active: 'look', changed: false }).open === '' && next({ stored: '', active: 'look', changed: false }).remember === false)
  check('landing on General (no group) changes nothing', next({ stored: 'tools', active: null, changed: true }).open === 'tools')
  check('a group that is already the open one is not written again', next({ stored: 'look', active: 'look', changed: true }).remember === false)
}
check('the open group is remembered under one key of its own, in the browser\'s storage', /const OUVERT_CLE = 'kybernos\.settings\.open-group'/.test(block) && /window\.localStorage\.(get|set)Item\(OUVERT_CLE/.test(block))
check('the group header is a div with role="button", not a <button> (the phone layout takes a tap on a nav button for « a page was picked » and hides the list)', /createElement\('div'\)/.test(block) && /setAttribute\('role', 'button'\)/.test(block) && !/kbCzToggle/.test(SRC))
check('the group\'s pages are hidden unless it is open, except when a live check asks for all (data-kb-all-pages)', /html:not\(\[data-kb-all-pages\]\) \[class\*="navList"\]\[data-kb-settings\] \[data-kb-fold-cell\]:not\(\[data-kb-shown\]\)\{display:none\}/.test(SRC))
check('the search sets data-kb-shown on the cells of the groups with a match, and counts', /data-kb-shown', '1'/.test(SRC) && /\[data-kb-hits\]::after\{content:attr\(data-kb-hits\)/.test(SRC))
check('the observer also hears the page change (aria-current), so a click on a hidden row opens its group', /attributeFilter: \['aria-current'\]/.test(block))
check('the pages of a group are drawn one step in under its header', /data-kb-sub/.test(block) && /\[data-kb-sub\]\{padding-inline-start:/.test(SRC))
const c06 = /\[class\*="_navCell"\]\[aria-current="true"\]\{([^}]*)\}/.exec(SRC)
check('the open page is a soft pill: 18% of the text colour (the hover is 8%), heavier text, and no bar on the edge', c06 !== null && /color-mix\(in srgb,var\(--dsw-alias-label-primary\) 18%,transparent\)/.test(c06[1]) && /font-weight:600/.test(c06[1]) && !/box-shadow/.test(c06[1]), c06 && c06[1])
const open = /\[data-kb="settings-group"\]\[aria-expanded="true"\]\{([^}]*)\}/.exec(SRC)
check('an open group has no fill (one active element on the screen): heavier name, chevron turned down, also right to left', open !== null && !/background/.test(open[1]) && /font-weight:600/.test(open[1]) && /\[aria-expanded="true"\] \.kb-cz-chev\{transform:rotate\(90deg\)/.test(SRC) && /scaleX\(-1\) rotate\(90deg\)/.test(SRC), open && open[1])
check('the group of the open page is drawn stronger even when shut (the person still sees where they are)', /data-kb-here/.test(block) && /\[data-kb-here\]\{[^}]*font-weight:600/.test(SRC))

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
check('the phone page is called « Phone and channels » in the nav and as its title, in both languages', /label: kt\('Téléphone et canaux', 'Phone and channels'\)/.test(mobile) && /const TITLE = \(\) => kt\('Téléphone et canaux', 'Phone and channels'\)/.test(mobile) && /'kbpc-title'/.test(mobile))
const free = readFileSync(join(pkgs, 'kybernos-free-llms', 'client.js'), 'utf8')
check('the free models page does not put a provider name in its title', !/'kfl\.(page\.)?titre': \{[^}]*OpenCode/.test(free))

console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
