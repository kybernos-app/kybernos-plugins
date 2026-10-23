#!/usr/bin/env node
// A5-19: one help affordance, in one place. The « ? How it works » pill is at the top of the page, on the title's row, and every page that
// has a card carries it. Left over after round 2: Settings › Calls and Workers drew it on a row of its own under the tabs / the intro, and
// Creations, Workspaces, Dashboards, Tools, Auto Routing and Settings › Automations drew none. (Servers draws it in its page header:
// scripts/check-servers-live.mjs looks for it.)
//
//   node scripts/test-help-pill-position.mjs
// Static checks on the browser halves (read as text, as the neighbours do) and on the cards the catalogue ships.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
const read = (...p) => readFileSync(join(PACKAGES, ...p), 'utf8')
let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300)))
  if (!ok) failed += 1
}

console.log('the core plugin: the pill on Creations, Workspaces, Tools and Settings › Automations')
{
  const src = read('kybernos-plugin', 'client.js')
  check('a helper draws the Suite\'s pill for a page card of the bundle', /const kbPagePill = \(page\) => \{[^\n]*window\.__KB_HELP__\.Help[^\n]*id: 'kybernos-plugin', page: page/.test(src))
  check('Creations: on the title row', /h\('div', \{ className: 'kb6-titlerow' \}, h\('div', \{ className: 'kb6-title' \}, kbDomainTitle\('deliverables', kbt\('deliverables\.title'\)\)\), kbPagePill\('creations'\)\)/.test(src))
  check('Workspaces: on the title row', /h\('div', \{ className: 'kb6-titlerow' \}, h\('h1', \{ className: 'kb6-title' \}, kbDomainTitle\('projects', kbt\('kbui\.projects'\)\)\), kbPagePill\('workspaces'\)\)/.test(src))
  check('Tools: in the page head, next to the text', /kbPagePill\('tools'\)\)\n\s+const colonne/.test(src))
  check('Settings › Automations: in the head of the page, at the right of the title', /help: 'automation-settings' \}\)/.test(src) && /kbac-titlerow\{justify-content:space-between\}/.test(src))
  const help = JSON.parse(read('kybernos-plugin', 'help.json'))
  const catalogue = JSON.parse(read('kybernos-hub', 'catalog.json'))
  const shipped = catalogue.modules.find((m) => m.id === 'kybernos-plugin').aide.pages
  for (const key of ['creations', 'workspaces', 'tools', 'automation-settings']) {
    const c = help.pages[key]
    check('the card « ' + key + ' » is in help.json in both languages, with 2 to 4 steps', c !== undefined && c.title.fr !== '' && c.title.en !== '' && c.what.fr !== '' && c.what.en !== '' && c.steps.length >= 2 && c.steps.length <= 4)
    check('and in the catalogue the hub serves (node scripts/build-catalog.mjs)', shipped[key] !== undefined && shipped[key].what.en === c.what.en)
  }
}

console.log('the pill is on the title row of the other pages too')
{
  const dash = read('kybernos-dashboards', 'src', 'plugin.js')
  check('Dashboards: the pill beside the title (card of the bundle)', /h\('h1', \{ className: 'kb6-title' \}, pageName\(\)\), typeof window !== 'undefined' && window\.__KB_HELP__ && window\.__KB_HELP__\.Help \? h\(window\.__KB_HELP__\.Help, \{ id: 'kybernos-dashboards' \}\)/.test(dash))
  check('Dashboards: the built client holds it', read('kybernos-dashboards', 'client.js').includes("{ id: 'kybernos-dashboards' }"))
  const auto = read('kybernos-auto', 'client.js')
  check('Auto Routing: the pill at the right of the title', /className: 'kaa-titrerow'[\s\S]{0,400}h\(window\.__KB_HELP__\.Help, \{ id: 'kybernos-auto' \}\)/.test(auto) && /\.kaa-titrerow\{display:flex;[^}]*justify-content:space-between/.test(auto))
}

console.log('Workers and Calls: the pill left its own row')
{
  const wk = read('kybernos-workers', 'client.js')
  const row = wk.slice(wk.indexOf("h('div', { className: 'kbwk-titlerow' }"), wk.indexOf("h('span', { className: 'kbwk-hbtn' },", wk.indexOf("h('div', { className: 'kbwk-titlerow' }")))
  check('Workers: the pill is on the title row, at the top right', /h\(window\.__KB_HELP__\.Help, \{ id: 'kybernos-workers'/.test(row) && /\.kbwk-titlerow\{display:flex;[^}]*justify-content:space-between/.test(wk))
  const buttons = wk.slice(wk.indexOf("h('span', { className: 'kbwk-hbtn' },"), wk.indexOf("h('div', { className: 'kbwk-count' }"))
  check('Workers: the buttons row keeps only its own buttons', !/__KB_HELP__/.test(buttons))
  const call = read('kybernos-call', 'client.js')
  check('Calls: the pill is in the top row of the page (next to the title)', /h\('div', \{ key: 'top', className: 'kbcl-top' \}, \[[\s\S]{0,900}h\(HelpPill, \{ key: 'help', id: tab/.test(call) && /\.kbcl-top\{display:flex;[^}]*justify-content:space-between/.test(call))
  check('Calls: the text it opens stays under the tabs, drawn only when open', /open\[tab\] === true \? h\(HelpBox, \{ key: 'helpbox'/.test(call))
}

console.log(failed === 0 ? '\nOK' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
