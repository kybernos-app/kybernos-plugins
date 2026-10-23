#!/usr/bin/env node
/** The project page shows no « Budget » and no « Insight » tab for now (2026-10-23, product request): behind two flags, as « Documents » is behind KB_SHOW_DOCS.
 *  Their panes, hosts and translations stay in place; a tab kept in the store from before is not reopened.
 *  Usage: node packages/kybernos-plugin/test-project-tabs.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')
const between = (a, b) => {
  const i = client.indexOf(a)
  const j = client.indexOf(b, i + 1)
  assert.ok(i >= 0 && j > i, a + ' … ' + b + ' were found')
  return client.slice(i, j)
}

const flags = between('const KB_SHOW_PROJECT_BUDGET', '// Entrée « Cloud Computer »')
const play = (budget, insight) => {
  const ctx = { kbt: (k) => ({ 'kbui.budget': 'Budget', 'kbui.insight': 'Insight' }[k] || k) }
  vm.createContext(ctx)
  vm.runInContext(flags.replace('KB_SHOW_PROJECT_BUDGET = false', 'KB_SHOW_PROJECT_BUDGET = ' + budget).replace('KB_SHOW_PROJECT_INSIGHT = false', 'KB_SHOW_PROJECT_INSIGHT = ' + insight) + '\nthis.hidden = kbProjectTabHidden', ctx)
  return ctx.hidden
}
const shipped = play(false, false)
assert.equal(shipped('Budget'), true)
assert.equal(shipped('Insight'), true)
assert.equal(shipped('Threads'), false)
assert.equal(shipped('Skills'), false)
ok('Budget and Insight are hidden as shipped, the other tabs are not')
assert.equal(play(true, false)('Budget'), false)
assert.equal(play(true, false)('Insight'), true)
assert.equal(play(false, true)('Insight'), false)
ok('each flag brings its own tab back')

assert.ok(client.includes("kbt('kbui.connecteurs'), kbt('kbui.devices'), kbt('kbui.budget'), kbt('kbui.insight')].filter((t) => kbProjectTabHidden(t) === false && (t !== kbt('kbui.devices') || kbMdExtras('devices', ws) !== null))"))
assert.ok(client.includes("s.projectTab.length > 0 && kbProjectTabHidden(s.projectTab) === false ? s.projectTab : 'Threads'"))
ok('the tab bar is filtered and a hidden tab kept in the store opens Threads instead')
assert.ok(client.includes("if (tab === kbt('kbui.insight')) return h(KbiProjetWsInsight"))
assert.ok(client.includes("'kbui.budget': {"))
ok('the panes and the translations are still there')

// The Details tab (2026-10-23): one card laid out like the Identity tab of an Agent Team, the old « Advanced » block now a tab of its own, « Devices ».
assert.ok(client.includes("'kbui.devices': { kybernos: 'Appareils', en: 'Devices' }"))
ok('the new tab is called Devices (Appareils)')
const details = between("if (tab === kbt('kbui.details')) {\n          // Laid out like", "// The body of the Devices tab comes from")
assert.ok(details.includes("className: 'kbpd-card'") && details.includes("className: 'kbpd-danger'"))
assert.ok(!details.includes('kbpd-top') && !details.includes('kbpd-look') && !details.includes('kbpd-col'), 'the fields are stacked, not in columns')
assert.ok(details.includes("kbMdExtras('folder', ws)"))
assert.ok(!details.includes("kbMdExtras('advanced'") && !details.includes('Changing the name, icon or colour updates'))
assert.ok(!details.includes('kbCfIcon('))
ok('Details is one card with the fields stacked like the Identity tab of an Agent Team (name, description, folder row, icon, colour) and a one-line danger zone; no second tile, no folded Advanced, no repeated sentence')
assert.ok(client.includes("if (tab === kbt('kbui.devices')) return kbMdExtras('devices', ws)"))
assert.ok(client.includes("(tab === kbt('kbui.budget') || tab === kbt('kbui.details') || tab === kbt('kbui.devices')) ? null : h('div', { className: 'kb8-search' }"))
ok('the Devices tab shows the satellite\'s body and has no search box')
assert.ok(/\(tab === kbt\('kbui\.details'\)\s*\? h\('div', \{ className: 'kbpd-save', 'data-kb': 'project-save' \}/.test(client))
ok('Auto-save and Save now sit in the page header, on the Details tab')
for (const css of ['.kbpd-card{', '.kbpd-lh{', '.kbpd-danger{', '.kbpd-save{']) assert.ok(client.includes(css), css)
assert.ok(/\.kbpd-card\{[^}]*padding:16px;display:flex;flex-direction:column;gap:11px\}/.test(client), 'the card has the padding and the rhythm of the Agent Team card')
ok('the styles are there')

console.log(pass + ' tests passed')
