#!/usr/bin/env node
// A page of Settings has ONE name: the nav entry, the title of the page and the card of its module in the Suite say the same words
// (audit A1-09). No browser, no DSH.
//
//   node scripts/test-settings-names.mjs
//
// Born from the audit of 2026-10-16: the nav said « Ollama Local Models », « Skills », « Commands » and « Memory & Lessons » while the
// pages said « Local models », « Skills — catalogue », « Commands & actions » and « Memory & Lessons learned », and the Suite had a
// fifth spelling (« Slash commands », « About & Maintenance », « Web search »). The capitalisation of the nav is the one the menu
// already had (Title Case for the pages of ours, sentence case for DSH's own: « Agent presets »): it is kept, the titles follow it.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('  ✓ ' + name); return }
  fail += 1
  console.log('  ✗ ' + name + (Array.isArray(detail) ? '\n      ' + detail.join('\n      ') : detail === undefined ? '' : ' — ' + JSON.stringify(detail)))
}
const read = (...p) => readFileSync(join(REPO, ...p), 'utf8')

// ── The nav, as it is drawn in English (the id of each section is the React key of its cell, the same in every language).
const NAV = {
  general: 'General', models: 'Models', 'kybernos-theme': 'Theme', 'kybernos-language': 'Language', 'kybernos-memory': 'Memory & Lessons', 'kbac-appearance': 'Appearance',
  'kybernos-maintenance': 'About', 'kybernos-servers': 'Servers', 'kybernos-auto-page': 'Auto Routing', 'kybernos-websearch-page': 'Web Search',
  plugins: 'Built-in plugins', 'kybernos-atlas': 'Atlas', 'kybernos-models': 'AI Provider & Models', 'agent-presets': 'Agent presets', voice: 'Voice',
  'kybernos-slash': 'Commands', 'kybernos-ollama': 'Ollama Local Models', 'kybernos-suite': 'Kybernos Suite', 'kybernos-tools': 'Tools',
  'kybernos-workers': 'Workers', 'kybernos-call': 'Calls', 'kybernos-usage': 'Usage', 'kybernos-automations': 'Automations', 'kybernos-skills': 'Skills',
  'kybernos-composio': 'Connectors', 'kybernos-free-llms': 'Free LLMs', 'kybernos-mobile': 'Remote Control', 'kybernos-computers': 'Cloud computers',
  'kybernos-local': 'Kybernos',
}

console.log('the nav')
const CORE = read('packages', 'kybernos-plugin', 'client.js')
const block = /const KB_NAV_KEYS = \{([\s\S]*?)\n\}/.exec(CORE)
const keys = {}
if (block !== null) for (const m of block[1].matchAll(/'?([A-Za-z0-9_-]+)'?:\s*'([^']+)'/g)) keys[m[1]] = m[2]
const drift = Object.keys(keys).filter((k) => NAV[k] === undefined || NAV[k].toLowerCase() !== keys[k])
check('the list of names here and the menu\'s KB_NAV_KEYS say the same pages (a page added to the menu is added here)', Object.keys(keys).length >= 25 && drift.length === 0 && Object.keys(NAV).every((k) => keys[k] !== undefined), drift)

console.log('the title of each page is its nav entry')
const memory = read('packages', 'kybernos-memory', 'client.js')
const memShown = memory.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
check('Memory & Lessons: the title and the « back » links of its sub-pages say « Memory & Lessons », not « … learned »', !/'Memory & Lessons learned'/.test(memShown) && /const PAGE_TITLE = 'Memory & Lessons'/.test(memory) && /h1', \{ className: 'kbmem-h1' \}, PAGE_TITLE\)/.test(memory), memShown.match(/'Memory & Lessons learned'/g))

const skills = read('packages', 'kybernos-skills', 'client.js')
const skH1 = /'set\.h1': \{ fr: '([^']+)', en: '([^']+)' \}/.exec(skills)
const skNav = /'set\.nav': \{ fr: '([^']+)', en: '([^']+)' \}/.exec(skills)
check('Skills: the title of its settings page is the nav entry, in both languages (not « Skills — catalogue »)', skH1 !== null && skNav !== null && skH1[1] === skNav[1] && skH1[2] === skNav[2] && skH1[2] === NAV['kybernos-skills'], [skH1 && skH1[0], skNav && skNav[0]])

const slash = read('packages', 'kybernos-slash', 'client.js')
const slTitle = /className: 'kbsl-h1' \}, L\(\{ fr: '([^']+)', en: '([^']+)' \}\)/.exec(slash)
const slNav = /label: kbslLabel\('([^']+)', '([^']+)'\)/.exec(slash)
check('Commands: the title of its page is the nav entry, in both languages (not « Commands & actions »)', slTitle !== null && slNav !== null && slTitle[1] === slNav[1] && slTitle[2] === slNav[2] && slTitle[2] === NAV['kybernos-slash'], [slTitle && slTitle[0], slNav && slNav[0]])

const ollama = read('packages', 'kybernos-modeles-locaux', 'client.js')
check('Ollama Local Models: the page draws its heading from the key the nav label comes from (not from « Local models »)', /h\('h2', \{ className: 'kml-titre' \}, m\('kml\.page\.titre'\)\)/.test(ollama) && /label: m\('kml\.page\.titre'\)/.test(ollama) && !/'kml\.titre'/.test(ollama))
const ollamaEn = /'kml\.page\.titre': \{ fr: '[^']+', en: '([^']+)' \}/.exec(ollama)
check('and that string is the nav entry', ollamaEn !== null && ollamaEn[1] === NAV['kybernos-ollama'], ollamaEn && ollamaEn[1])

console.log('the card of the module in the Suite is the nav entry too')
// One module, one page: the card is named like the page. A module whose card names something else than one page keeps its own name:
// Kybernos Core (many pages), Kybernos Cloud (the account; its Settings page is « Kybernos »), Suite (the manager; its page is « Kybernos Suite »).
const OWN_NAME = new Set(['kybernos-plugin', 'kybernos-cloud', 'kybernos-hub'])
const catalogue = JSON.parse(read('packages', 'kybernos-hub', 'catalog.json'))
const card = Object.fromEntries(catalogue.modules.map((m) => [m.id, m.titre]))
const sectionsOf = (dir) => {
  const f = join(REPO, 'packages', dir, 'client.js')
  return existsSync(f) ? [...readFileSync(f, 'utf8').matchAll(/name: 'settings\.section',\s*id: '([^']+)'/g)].map((m) => m[1]) : []
}
const odd = []
let seen = 0
for (const dir of readdirSync(join(REPO, 'packages'))) {
  if (OWN_NAME.has(dir) || card[dir] === undefined) continue
  const ids = sectionsOf(dir)
  if (ids.length !== 1 || NAV[ids[0]] === undefined) continue
  seen += 1
  if (card[dir] !== NAV[ids[0]]) odd.push(dir + ': the card says « ' + card[dir] + ' », the nav « ' + NAV[ids[0]] + ' »')
}
// The models page registers its section through another door (see its client), so it is named here.
seen += 1
if (card['kybernos-models'] !== NAV['kybernos-models']) odd.push('kybernos-models: the card says « ' + card['kybernos-models'] + ' », the nav « ' + NAV['kybernos-models'] + ' »')
check('every module that is one Settings page carries the name of that page on its card', seen >= 14 && odd.length === 0, odd)

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
