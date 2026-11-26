#!/usr/bin/env node
// A5-19: one help affordance, in one place. The « ? How it works » pill is at the top of the page, on the title's line, right after its text
// (Settings pages: the Suite's Title through each bundle's pageHead, scripts/test-page-titles.mjs; the main views keep the title row), and every page that
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
  check('a helper draws the Suite\'s pill for a page card of the bundle', /const kbPagePill = \(page, lead, title\) => \{[^\n]*window\.__KB_HELP__\.Help[^\n]*id: 'kybernos-plugin', page: page/.test(src))
  check('Creations: on the title row', /h\('div', \{ className: 'kb6-titlerow' \}, h\('h1', \{ className: 'kb6-title' \}, kbDomainTitle\('deliverables', kbt\('deliverables\.title'\)\)\), kbPagePill\('creations', kbt\('deliverables\.desc'\)/.test(src))
  check('Workspaces: on the title row', /h\('div', \{ className: 'kb6-titlerow' \}, h\('h1', \{ className: 'kb6-title' \}, kbDomainTitle\('projects', kbt\('kbui\.projects'\)\)\), kbPagePill\('workspaces', kbt\('kbui\.project\.holds'\)/.test(src))
  check('Tools: in the page head, right after the title text', /pageHead\(\{ as: 'h1', className: 'kbt2-h1', id: 'kybernos-plugin', page: 'tools', lead: leadTools, title: kbt\('kbui\.tools'\) \}\)/.test(src))
  check('Settings › Automations: in the head of the page, right after the title text', /h\(KbacHead, \{ title: kbt\('kbui\.automations\.set'\), sub: kbt\('kbauto\.set\.sub'\), help: 'automation-settings' \}\)/.test(src) && /pageHead\(\{ id: 'kybernos-plugin', page: props\.help, lead: props\.sub, title: props\.title \}\)/.test(src))
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
  check('Dashboards: the pill beside the title (card of the bundle)', /h\('h1', \{ className: 'kb6-title' \}, pageName\(\)\), typeof window !== 'undefined' && window\.__KB_HELP__ && window\.__KB_HELP__\.Help \? h\(window\.__KB_HELP__\.Help, \{ id: 'kybernos-dashboards', lead: galleryLead\(\), title: pageName\(\) \}\)/.test(dash))
  check('Dashboards: the built client holds it', read('kybernos-dashboards', 'client.js').includes("{ id: 'kybernos-dashboards' }"))
  const auto = read('kybernos-auto', 'client.js')
  check('Auto Routing: the pill right after the title text', /pageHead\(\{ id: 'kybernos-auto', lead: intro, title: kt\('Routage Auto', 'Auto Routing'\) \}\)/.test(auto) && !/kaa-titrerow\{[^}]*justify-content/.test(auto))
}

console.log('Workers and Calls: the pill left its own row')
{
  const wk = read('kybernos-workers', 'client.js')
  check('Workers: the pill is right after the title text (the Suite\'s Title), not on a row of its own', /pageHead\(\{ id: 'kybernos-workers', lead: pageLead\(\), title: 'Workers', action: /.test(wk) && !/kbwk-titlerow/.test(wk))
  const buttons = wk.slice(wk.indexOf("h('span', { className: 'kbwk-hbtn' },"), wk.indexOf("h('div', { className: 'kbwk-count' }"))
  check('Workers: the buttons row keeps only its own buttons', !/__KB_HELP__/.test(buttons))
  const call = read('kybernos-call', 'client.js')
  check('Calls: the pill is right after the title text (handed to the title as its tail)', /pageHead\(\{ key: 'top', title: kt\('Appels', 'Calls'\), className: 'kbcl-title', after: h\(HelpPill, \{ id: tab/.test(call) && !/kbcl-top/.test(call))
  check('Calls: the text it opens stays under the tabs, drawn only when open', /open\[tab\] === true \? h\(HelpBox, \{ key: 'helpbox'/.test(call))
}

console.log(failed === 0 ? '\nOK' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
