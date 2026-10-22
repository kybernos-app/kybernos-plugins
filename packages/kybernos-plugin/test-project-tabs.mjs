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

assert.ok(client.includes("kbt('kbui.connecteurs'), kbt('kbui.budget'), kbt('kbui.insight')].filter((t) => kbProjectTabHidden(t) === false)"))
assert.ok(client.includes("s.projectTab.length > 0 && kbProjectTabHidden(s.projectTab) === false ? s.projectTab : 'Threads'"))
ok('the tab bar is filtered and a hidden tab kept in the store opens Threads instead')
assert.ok(client.includes("if (tab === kbt('kbui.insight')) return h(KbiProjetWsInsight"))
assert.ok(client.includes("'kbui.budget': {"))
ok('the panes and the translations are still there')

console.log(pass + ' tests passed')
