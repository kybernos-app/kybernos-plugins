#!/usr/bin/env node
/** The project page's Connectors tab (2026-10-23), source-level like test-conn-logos.mjs:
 *   - the connectors the project's agent teams declare are « selected »: they come first, say who uses them, and the rest of the account follows;
 *   - after a connect or a disconnect the account is read again (the « busy » flags used to stay set, so the list stayed on « Reading… » for good);
 *   - the disconnect is armed in words (« Disconnect everywhere? ») with a way back, and the tab never shows an empty-state card while it reads.
 *  Usage: node packages/kybernos-plugin/test-project-connectors.mjs   (exit 0 = all pass) */
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

// 1. the rows
{
  const ctx = { String, Array, Object, kbe: (en) => en }
  vm.createContext(ctx)
  vm.runInContext(between('const kbConnRowsOf', '// <conn-logo:begin>') + '\nthis.kbConnRowsOf = kbConnRowsOf', ctx)
  const real = {
    configured: true,
    connections: [
      { toolkit: 'outlook', status: 'active', accounts: [{ id: 'o1', alias: 'outlook_a', status: 'active', isDefault: true }] },
      { toolkit: 'gmail', status: 'active', accounts: [{ id: 'g1', alias: 'me@x.org', status: 'active', accountType: 'PRIVATE', isDefault: true }] },
      { toolkit: 'drive', status: 'expired', accounts: [{ id: 'd1', alias: 'drive_a', status: 'expired' }] },
      { toolkit: 'notion', status: 'initiated', accounts: [] },
    ],
  }
  const declared = [
    { key: 'gmail/r1', slug: 'gmail', name: 'gmail', role: 'triage', kyber: 'Dev-Team' },
    { key: 'gmail/r2', slug: 'gmail', name: 'gmail', role: 'reply', kyber: 'Ops-Team' },
    { key: 'gmail/r3', slug: 'gmail', name: 'gmail', role: 'archive', kyber: 'Dev-Team' },
    { key: 'slack/r1', slug: 'slack', name: 'slack', role: 'notify', kyber: 'Dev-Team' },
    { key: 'notion/r1', slug: 'notion', name: 'notion', role: 'writer', kyber: 'Dev-Team' },
  ]
  const rows = ctx.kbConnRowsOf(real, declared, () => true).connRows
  assert.deepEqual(Array.from(rows, (r) => r.name + (r.selected ? '*' : '')), ['gmail*', 'notion*', 'slack*', 'outlook', 'drive'])
  ok('selected connectors come first (connected before not connected), then the account (connected before expired), the order kept inside each band')
  assert.equal(rows[0].usedBy, 'Dev-Team, Ops-Team')
  assert.equal(rows[3].usedBy, '')
  ok('a selected row names the teams that use it once each, the others name nobody')
  assert.equal(rows[0].label, 'me@x.org')
  assert.equal(rows[0].isDefault, true)
  ok('a connected account row carries its label and its default flag')
  // nothing declared: nothing is selected, what is connected still comes before what needs attention
  const plain = ctx.kbConnRowsOf(real, [], () => true).connRows
  assert.ok(plain.every((r) => r.selected === false))
  assert.deepEqual(Array.from(plain, (r) => r.name), ['outlook', 'gmail', 'drive', 'notion'])
  ok('with nothing declared no row is selected')
}

// 2. the refresh
{
  const calls = []
  const ctx = {
    String, Array, Object, Promise,
    kbe: (en) => en,
    kbRemoteOk: true,
    kbApiBase: () => '',
    fetch: (url) => { calls.push(url); return new Promise(() => { /* never answers: the flag stays set */ }) },
  }
  vm.createContext(ctx)
  vm.runInContext(between('const kbConnCache = {}', '// Ce que le COMPTE a connecte') + '\nthis.read = kbComposioConnections; this.forget = kbConnForget', ctx)
  assert.equal(ctx.read(['gmail']), null)
  assert.equal(calls.length, 1)
  assert.equal(ctx.read(['gmail']), null)
  assert.equal(calls.length, 1)
  ctx.forget()
  assert.equal(ctx.read(['gmail']), null)
  assert.equal(calls.length, 2)
  ok('after a connect or a disconnect the account is read again (the flags are cleared with the cache)')
}

// 3. the tab
{
  const tab = between("const connPage = pageOf(connRows, connsVp)", "pagerOf(connsVp))")
  for (const hook of ['project-conns-list', 'project-conn-group', 'project-conn-row', 'project-conn-usedby', 'project-conn-pill', 'project-conn-toggle', 'project-conn-cancel', 'project-conn-etat']) assert.ok(tab.includes(hook), hook)
  ok('the tab has its groups, rows, « used by » line, pill, toggle, cancel and result')
  assert.ok(tab.includes('Disconnect everywhere?'))
  ok('the armed step says the disconnect is global, in words')
  assert.ok(client.includes("if (connRows.length === 0 && connsReal === null) return h('span', { className: 'kb8-parent', 'data-kb': 'connectors-source' }, connsNote)"))
  ok('no empty-state card while the account is being read')
}

console.log(pass + ' tests passed')
