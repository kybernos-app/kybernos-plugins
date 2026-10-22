#!/usr/bin/env node
/** The project page's Connectors tab (2026-10-23), source-level like test-conn-logos.mjs:
 *   - the connectors the owner ticked for the project, and those its agent teams declare, are « selected »: they come first, a declared one says who uses it, and the rest of the account follows;
 *   - an app ticked but no longer held by the account stays listed (so it can be unticked); the names are the catalogue's (« Google Calendar »), made from the slug otherwise;
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
  const names = { googlecalendar: 'Google Calendar' }
  const ctx = { String, Array, Object, RegExp, kbe: (en) => en, window: { __KB_APP_LOGOS__: { name: (slug) => names[slug] || null } } }
  vm.createContext(ctx)
  vm.runInContext(between('const kbPrettySlug', '// <conn-logo:begin>') + '\nthis.kbConnRowsOf = kbConnRowsOf; this.kbAppName = kbAppName', ctx)
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

  // ticked by the owner: selected like a declared one, but nobody « uses » it, and a ticked app the account no longer holds is kept
  const picked = ctx.kbConnRowsOf(real, declared, () => true, ['outlook', 'zoom']).connRows
  assert.deepEqual(Array.from(picked, (r) => r.name + (r.selected ? '*' : '')), ['outlook*', 'gmail*', 'notion*', 'slack*', 'zoom*', 'drive'])
  const outlook = picked.find((r) => r.name === 'outlook')
  assert.equal(outlook.attached, true)
  assert.equal(outlook.declared, false)
  assert.equal(outlook.usedBy, '')
  const zoom = picked.find((r) => r.name === 'zoom')
  assert.equal(zoom.ghost, undefined)
  assert.equal(zoom.key, 'att/zoom')
  assert.equal(zoom.real, false)
  assert.equal(zoom.state, 'Not connected')
  ok('a ticked app is selected without being « used by » a team, and one the account no longer holds is kept as a not connected row')
  assert.equal(ctx.kbConnRowsOf(null, declared, () => true, ['zoom']).connRows.some((r) => r.key === 'att/zoom'), false)
  assert.equal(ctx.kbConnRowsOf(real, [], () => false, ['zoom']).connRows.length, 0)
  ok('no ticked-app row while the account is still being read, nor when the search filters it out')

  // names
  assert.equal(ctx.kbAppName('googlecalendar'), 'Google Calendar')
  assert.equal(ctx.kbAppName('microsoft_teams'), 'Microsoft Teams')
  assert.equal(ctx.kbAppName('one-drive.v2'), 'One Drive V2')
  assert.equal(ctx.kbAppName('gmail'), 'Gmail')
  assert.equal(ctx.kbAppName('googledocs'), 'Google Docs')
  assert.equal(ctx.kbAppName('zohocrm'), 'Zoho Crm')
  assert.equal(ctx.kbAppName('Google'), 'Google')
  ok('the name is the catalogue\'s, or made from the slug (separators become spaces, each word capitalised)')
  const found = ctx.kbConnRowsOf(real, [], (text) => text.indexOf('Google Calendar') >= 0, []).connRows
  assert.deepEqual(Array.from(found, (r) => r.name), [])
  const real2 = { configured: true, connections: [{ toolkit: 'googlecalendar', status: 'active', accounts: [{ id: 'c1', alias: 'cal', status: 'active' }] }] }
  assert.deepEqual(Array.from(ctx.kbConnRowsOf(real2, [], (text) => text.indexOf('Google Calendar') >= 0, []).connRows, (r) => r.name), ['googlecalendar'])
  ok('the search also finds an app by its display name')
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
  for (const hook of ['project-conns-list', 'project-conn-group', 'project-conn-row', 'project-conn-check', 'project-conn-usedby', 'project-conn-pill', 'project-conn-toggle', 'project-conn-cancel', 'project-conn-etat']) assert.ok(tab.includes(hook), hook)
  ok('the tab has its groups, rows, tick box, « used by » line, pill, toggle, cancel and result')
  assert.ok(tab.includes("disabled: c.declared === true"))
  assert.ok(tab.includes('h(KbConnName, { slug: c.slug })'))
  ok('a connector a team declares is ticked and cannot be unticked here; the row writes the display name')
  assert.ok(client.includes("host.call('kybers/workspace-connectors', { workspaceId: ws.workspaceId, connectors: next })"))
  assert.ok(client.includes("'kybers/workspace-connectors': 'workspace-connectors'"))
  assert.ok(/name === 'kybers\/workspace-connectors'/.test(client))
  ok('the tick is saved by the host route, which the call table knows as a POST')
  assert.ok(tab.includes('Disconnect everywhere?'))
  ok('the armed step says the disconnect is global, in words')
  assert.ok(client.includes("if (connRows.length === 0 && connsReal === null) return h('span', { className: 'kb8-parent', 'data-kb': 'connectors-source' }, connsNote)"))
  ok('no empty-state card while the account is being read')
}

console.log(pass + ' tests passed')
