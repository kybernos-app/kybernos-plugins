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

console.log('the Kybernos section')
const kyb = /titre: kbt\('settings\.group\.kybernos'\), mots: \[([^\]]*)\]/.exec(block)
const kybWords = kyb === null ? [] : kyb[1].split(',').map((w) => w.trim().replace(/^'|'$/g, '')).filter((w) => w !== '')
check('there is a Kybernos section', kyb !== null)
check('it opens with the Suite', kybWords[0] === 'kybernos suite', kybWords.slice(0, 3))
const rank = (w) => kybWords.indexOf(w)
check('then the models, the routing that picks one, what the agents keep, and the comfort pages last (value, then importance)',
  rank('kybernos suite') === 0 && rank('ai provider & models') > 0 && rank('ai provider & models') < rank('auto routing') && rank('auto routing') < rank('memory & lessons') && rank('memory & lessons') < rank('workers') && rank('workers') < rank('calls') && rank('language') < rank('theme') && rank('theme') === kybWords.length - 1, kybWords)
check('it sits right after Account, before the shell\'s own Settings', block.indexOf("settings.group.account") < block.indexOf("settings.group.kybernos") && block.indexOf("settings.group.kybernos") < block.indexOf("settings.group.settings"))
check('the Desktop divider follows its section, not an index (a section can be added before it)', /GROUPES\[g\]\.bureau === true/.test(block) && /bureau: true/.test(block) && !/if \(g === 2\)/.test(block))
check('the « seen » flags follow the number of sections', /const vus = GROUPES\.map\(\(\) => false\)/.test(block))

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
