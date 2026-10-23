#!/usr/bin/env node
// Every signpost to a Settings page names a page the Settings menu really has. No browser, no DSH.
//
//   node scripts/test-signposts.mjs
//
// A signpost is a text of the shape « Settings › Page », « Settings ▸ Page » or « Settings → Page » (and its French
// and Spanish spellings) in a help.json, a README, a package.json or a string of a bundle. Born from the audit of
// 2026-10-16: the help of Composio and Cloud computers sent people to « Settings › Plugins › … » (no such page),
// Usage was said to sit under Kybernos (it is a page of its own), and nothing noticed because nobody compared the
// words with the menu.
//
// The menu is the one packages/kybernos-plugin/client.js builds (KB_NAV_KEYS: the key of each page to its title).
// PLACES below names the pages as a person reads them, in every language the texts use; a test keeps that list and
// the menu in step, so a page added to the menu has to be added here too.
//
// The same goes for the sidebar (« Sidebar › Skills »): a flat list of rows, no « Kybernos » menu above them.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

// ── The pages of the Settings menu: the title in English (the key of KB_NAV_KEYS values), then the other spellings.
const PLACES = {
  general: ['général'],
  theme: ['thème', 'tema'],
  language: ['langue', 'idioma'],
  'memory & lessons': ['mémoire & leçons'],
  'learned skills': ['compétences apprises'],
  models: ['modelos'],
  kybernos: [],
  about: ['à propos'],
  servers: ['serveurs'],
  'auto routing': ['routage auto'],
  'web search': ['recherche web'],
  'built-in plugins': ['plugins intégrés', 'plugins integrados'],
  atlas: [],
  'ai provider and models': ['fournisseur ia et modèles'],
  'agent presets': ['préréglages d’agent', 'preajustes de agente'],
  voice: ['voix', 'voz'],
  skills: ['compétences'],
  commands: ['commandes'],
  'ollama local models': ['modèles locaux ollama'],
  automations: ['automatisations'],
  'free llms': [],
  'kybernos suite': [],
  tools: ['outils', 'herramientas'],
  workers: [],
  connectors: ['connecteurs'],
  'code sandbox (e2b)': ['bac à sable de code (e2b)'],
  calls: ['appels'],
  kaby: [],
  usage: [],
  'phone and channels': ['téléphone et canaux'],
}
// A page that lives INSIDE another one under the same name as a page of the menu (a tab or a row, not a second entry): the Voice
// tab of Calls, the Language row of General (it opens the Language page), the Models list of the AI provider page.
const NESTED_OK = new Set(['calls>voice', 'general>language', 'general>langue', 'ai provider and models>models', 'fournisseur ia et modèles>models'])
// The sidebar rows (a flat list; « Kybernos » is the wordmark on top, not a menu).
const SIDEBAR_ROWS = ['kaby', 'dashboards', 'tableaux de bord', 'agent teams', 'workspaces', 'creations', 'automations', 'skills', 'compétences', 'connectors', 'connecteurs']
// Pointers that are NOT ours, by the snippet that follows the arrow: the Composio dashboard's own menu.
const EXTERNAL = ['api keys']
// « <Word> Settings › » is another thing than the Settings menu (macOS System Settings, DSH's General › Kybernos Settings card…).
const NOT_THE_MENU = '(?<!\\b(?:System|Kybernos|Team|Desktop|Account|GitHub|Repository|Repo) )'
const ARROW = '(?:›|▸|→|&gt;|(?<=\\s)>(?=\\s))'

const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘]/g, "'").toLowerCase()
const names = (list) => list.map((n) => ({ name: fold(n), len: n.length })).sort((a, b) => b.len - a.len)
const NAMES = names(Object.entries(PLACES).flatMap(([en, others]) => [en].concat(others)))
const ROWS = names(SIDEBAR_ROWS)
/** The head of a text folded (accents and case off), with where each folded letter ends in the original. */
const foldHead = (text) => {
  let f = ''
  const ends = []
  let at = 0
  for (const ch of text.slice(0, 80)) {
    at += ch.length
    for (const c of fold(ch)) { f += c; ends.push(at) }
  }
  return { f, ends }
}

/** The page the text STARTS with, as a whole phrase (not the first word of a longer title), or null. */
const startsWith = (list, text) => {
  const { f, ends } = foldHead(text)
  for (const { name } of list) {
    if (!f.startsWith(name)) continue
    const tail = text.slice(ends[name.length - 1])
    if (tail === '') return name
    if (/^[^\s\p{L}\p{N}]/u.test(tail)) return name // punctuation, an arrow or markup right after
    const next = /^\s+(\S)/u.exec(tail)
    if (next === null) return null // letters glued to it: another word
    return /^\p{Lu}/u.test(next[1]) ? null : name // a Capital word goes on with a longer title; a lower-case one is prose
  }
  return null
}

const LEAD = /^[\s*_`"“”«»'‘’(]+/
/**
 * The problems of the signposts on one line of text.
 * @returns {string[]} one sentence per wrong signpost (empty: all good)
 */
export const problemsOfLine = (line) => {
  const out = []
  const settings = new RegExp(NOT_THE_MENU + '\\b(?:Settings|Réglages|Reglages|Paramètres|Parametres|Ajustes)\\s*' + ARROW + '\\s*', 'gu')
  for (let m = settings.exec(line); m !== null; m = settings.exec(line)) {
    // « Settings › » closing a string is the label of a link with its chevron (the button that opens the page): there is no page to name after it.
    if (/^['"`]/.test(line.slice(m.index + m[0].length))) continue
    const rest = line.slice(m.index + m[0].length).replace(LEAD, '')
    const head = rest.slice(0, 40)
    if (EXTERNAL.some((x) => fold(head).startsWith(x))) continue
    const first = startsWith(NAMES, rest)
    if (first === null) { out.push('« ' + head.trim() + ' » is not a page of the Settings menu'); continue }
    // Settings › Kybernos › Usage: a second step that is a page of the menu is no step at all.
    const between = new RegExp('^[^›▸→|.;:!?()]{0,' + (first.length + 4) + '}?\\s*' + ARROW + '\\s*', 'u').exec(rest)
    if (between === null) continue
    const second = startsWith(NAMES, rest.slice(between[0].length).replace(LEAD, ''))
    if (second !== null && !NESTED_OK.has(first + '>' + second)) out.push('« ' + first + ' › ' + second + ' »: ' + second + ' is a page of the menu on its own, not inside ' + first)
  }
  const sidebar = new RegExp('(?<!\\b(?:Right|droite) )\\b(?:Sidebar|Barre latérale)\\s*' + ARROW + '\\s*', 'gu')
  for (let m = sidebar.exec(line); m !== null; m = sidebar.exec(line)) {
    const rest = line.slice(m.index + m[0].length).replace(LEAD, '')
    if (startsWith(ROWS, rest) === null) out.push('« Sidebar › ' + rest.slice(0, 30).trim() + ' » is not a row of the sidebar')
  }
  return out
}
/** The places of the product that do not exist, named in a where line or a help text. */
const GONE = /\bKybernos menu\b|\bMenu Kybernos\b|\bKybernos \((?:sidebar|barre latérale)\)|\bphone button\b|\bbouton téléphone\b|\bMenu ›|\bMenu ▸/i
export const goneOfLine = (line) => { const m = GONE.exec(line); return m === null ? [] : ['« ' + m[0] + ' » is not a place of the product'] }

// ── Does the checker see what it must? (a checker that sees nothing would pass on any text)
console.log('the checker')
{
  const bad = (t) => problemsOfLine(t).length > 0
  check('it refuses a Plugins page that does not exist', bad('Add your key under Settings → Plugins → kybernos-composio to enable connections.') && bad('Réglages › Plugins › Ordinateurs cloud'))
  check('it refuses Usage under Kybernos (a page of its own)', bad('Settings › Kybernos › Usage') && bad('Réglages › Kybernos › Usage pour le détail par jour'))
  check('it refuses a card taken for a page (Kybernos Settings, Starter kit, Mobile)', bad('Settings → Kybernos Settings → Starter kit → Open') && bad('the Settings › Mobile page') && bad('Settings → Starter kit'))
  check('it refuses a page of the menu put inside another one', bad('Settings › General › Usage') && bad('Réglages › Appels › Atlas'))
  check('it refuses a sidebar that has a Kybernos level', bad('Sidebar › Kybernos › Skills') && bad('Barre latérale › Kybernos'))
  check('it accepts the pages of the menu, at any depth and in a sentence', !bad('Settings › Connectors') && !bad('Settings › Calls › Voice marks the online engines') && !bad('Réglages › Général › Langue') && !bad('Settings › General › Kybernos Settings') && !bad('Réglages › Fournisseur IA et modèles') && !bad('Settings → **Memory & Lessons** (in the Kybernos group)') && !bad('Settings ▸ Phone and channels and the sidebar') && !bad('Sidebar › Skills'))
  check('it leaves System Settings and the Composio dashboard alone', !bad('Screen Recording (System Settings > Privacy)') && !bad('Menu Settings ▸ API Keys, then Generate new key.') && !bad('Right sidebar › Files tab'))
  check('it leaves the label of a link that ends with its chevron alone, and still refuses a signpost that names nothing real', !bad("'kbld.settings': { kybernos: 'Réglages ›', en: 'Settings ›' },") && bad('Open Settings › and tick the goals') && bad("tick some goals (Settings › Profile) or install"))
  check('it names the places that do not exist', goneOfLine('Kybernos menu › Dashboards').length > 0 && goneOfLine('Phone button at the bottom of the sidebar').length > 0 && goneOfLine('Menu › Search everywhere').length > 0 && goneOfLine('Sidebar › Skills').length === 0)
}

// ── The list above and the menu say the same pages.
console.log('the menu')
const CORE = readFileSync(join(REPO, 'packages', 'kybernos-plugin', 'client.js'), 'utf8')
{
  const block = /const KB_NAV_KEYS = \{([\s\S]*?)\n\}/.exec(CORE)
  const titles = new Set(block === null ? [] : [...block[1].matchAll(/'?[A-Za-z0-9_-]+'?:\s*'([^']+)'/g)].map((m) => m[1]))
  const mine = new Set(Object.keys(PLACES))
  check('KB_NAV_KEYS was found, with the pages of the menu', titles.size >= 25, titles.size)
  check('every page of the menu is in PLACES', [...titles].every((t) => mine.has(t)), [...titles].filter((t) => !mine.has(t)))
  check('PLACES holds no page the menu does not have', [...mine].every((t) => titles.has(t)), [...mine].filter((t) => !titles.has(t)))
}

// ── Every text of the product that points somewhere.
console.log('the signposts of the product')
const files = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean)
const SHOWN = (f) => {
  if (/(^|\/)(test-|check-)|\/test\/|\/vendor\/|\.min\.js$|package-lock|\/icons\.json$|\/catalog\.json$|\/src\/|\/template-dsh\//.test(f)) return false
  return /^packages\/.+\/(help\.json|README\.md|package\.json)$/.test(f) || /^packages\/.+\.m?js$/.test(f) || f === 'README.md' || f === 'docs/install.md' || /^docs\/beta\/.+\.json$/.test(f) || f === 'scripts/build-catalog.mjs'
}
const isCode = (f) => /\.m?js$/.test(f)
const wrong = []
const gone = []
let lines = 0
for (const f of files) {
  if (!SHOWN(f)) continue
  const code = isCode(f)
  let inBlock = false
  const src = readFileSync(join(REPO, f), 'utf8').split('\n')
  for (let i = 0; i < src.length; i += 1) {
    let line = src[i]
    if (code) {
      // Comments are the maintainers', not the person's: drop the block comments and the end-of-line ones.
      if (inBlock) { const end = line.indexOf('*/'); if (end < 0) continue; line = line.slice(end + 2); inBlock = false }
      line = line.replace(/\/\*.*?\*\//g, ' ')
      const open = line.indexOf('/*')
      if (open >= 0) { line = line.slice(0, open); inBlock = true }
      line = line.replace(/(^|\s)\/\/.*$/, '$1')
    }
    if (line.trim() === '') continue
    lines += 1
    for (const p of problemsOfLine(line)) wrong.push(f + ':' + (i + 1) + ' ' + p)
    if (/help\.json$|README\.md$/.test(f)) for (const p of goneOfLine(line)) gone.push(f + ':' + (i + 1) + ' ' + p)
  }
}
check('the scan read the texts of the product', lines > 5000, lines)
check('every « Settings › … » points at a page of the Settings menu, and every « Sidebar › … » at a row of the sidebar', wrong.length === 0, wrong)
check('no help or README sends people to a menu, a button or a place the product does not have', gone.length === 0, gone)

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
