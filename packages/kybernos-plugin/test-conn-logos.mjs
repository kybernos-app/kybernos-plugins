#!/usr/bin/env node
/** Two display fixes of 2026-10-22, source-level like test-chat-tools.mjs (the bundles are browser modules, so the parts are cut out and played as they are):
 *   1. the Connectors tabs of a project and a team draw the real logo of each app (the seam `window.__KB_APP_LOGOS__` of kybernos-composio), initials only as a fallback;
 *   2. a task of the board that belongs to no team of ours is one line (its state and its subject), no longer a card that reads « ? · call ».
 *
 *  The rendered halves need react + react-dom: NODE_PATH=<a node_modules that has them> node packages/kybernos-plugin/test-conn-logos.mjs
 *  Usage: node packages/kybernos-plugin/test-conn-logos.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const plugin = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')
const composio = readFileSync(join(here, '..', 'kybernos-composio', 'client.js'), 'utf8')
const between = (src, a, b) => {
  const i = src.indexOf(a)
  const j = src.indexOf(b)
  assert.ok(i >= 0 && j > i, a + ' … ' + b + ' were found')
  return src.slice(i, j)
}
const tick = () => new Promise((r) => setTimeout(r, 0))

// 1. the seam: what kybernos-composio hands out
{
  const win = {}
  const loads = []
  let resolveLoad = null
  const ctx = vm.createContext({
    window: win,
    Date,
    // the part of the bundle the seam leans on, as the bundle has it
    CAT_BY_SLUG: { gmail: { s: 'gmail', n: 'Gmail', l: '<svg id="g"/>' }, nologo: { s: 'nologo', n: 'No logo' } },
    catOk: true,
    catalogLoad: null,
    kbCpCatalog: () => { loads.push(1); return new Promise((res) => { resolveLoad = res }) },
  })
  vm.runInContext(between(composio, '// <app-logos:begin>', '// <app-logos:end>'), ctx)
  const seam = win.__KB_APP_LOGOS__
  assert.equal(seam.version, 1)
  assert.equal(seam.svg('gmail'), '<svg id="g"/>', 'a known app answers its embedded logo')
  assert.equal(seam.svg('GMail'), '<svg id="g"/>', 'whatever the case of the slug')
  assert.equal(seam.svg('nologo'), null, 'an app without a logo answers null')
  assert.equal(seam.svg('constructor'), null, 'a name of Object.prototype is not an app')
  assert.equal(seam.svg(null), null)
  assert.equal(loads.length, 0, 'a loaded catalogue is never fetched again')
  ok('seam: known app → its SVG, unknown / no logo / odd slug → null, nothing refetched')

  ctx.catOk = false
  assert.equal(seam.svg('gmail'), '<svg id="g"/>', 'the logo already held is still served')
  assert.equal(seam.svg('slack'), null, 'the app is not there yet')
  assert.equal(seam.svg('slack'), null)
  assert.equal(loads.length, 1, 'the catalogue is asked once, however many renders ask')
  let heard = 0
  const off = seam.subscribe(() => { heard += 1 })
  seam.subscribe(() => { throw new Error('a failing listener') })
  const after = seam.subscribe(() => { heard += 10 })
  resolveLoad([])
  await tick()
  assert.equal(heard, 11, 'every listener is told when the catalogue lands, one that throws stops no other')
  off(); after()
  ok('seam: the first miss starts one load, listeners are told when it lands')

  const failing = vm.createContext({ window: {}, Date, CAT_BY_SLUG: {}, catOk: false, catalogLoad: null, kbCpCatalog: () => { loads.push(2); return Promise.reject(new Error('offline')) } })
  vm.runInContext(between(composio, '// <app-logos:begin>', '// <app-logos:end>'), failing)
  const f = failing.window.__KB_APP_LOGOS__
  const n0 = loads.length
  for (let i = 0; i < 5; i += 1) f.svg('gmail')
  await tick()
  assert.equal(loads.length - n0, 1, 'a failed load is not retried on every render')
  ok('seam: a failing catalogue is not hammered')

  const noWindow = vm.createContext({ Date, CAT_BY_SLUG: {}, catOk: true, catalogLoad: null, kbCpCatalog: () => Promise.resolve([]) })
  vm.runInContext(between(composio, '// <app-logos:begin>', '// <app-logos:end>'), noWindow)
  ok('seam: no window object does not throw')
}

// 2. the rendered halves
let React = null
let renderToStaticMarkup = null
try {
  const require = createRequire(import.meta.url)
  React = require('react')
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup
} catch (e) {
  console.log('SKIPPED: the rendered part (tile, call card) — react / react-dom not found. Re-run with:')
  console.log('  NODE_PATH=<a node_modules that has react + react-dom> node ' + join('kybernos-plugin', 'test-conn-logos.mjs'))
}

if (renderToStaticMarkup !== null) {
  // the tile of a connection
  const make = (win) => {
    const ctx = vm.createContext({ React, h: React.createElement, window: win })
    vm.runInContext(between(plugin, '// <conn-logo:begin>', '// <conn-logo:end>') + '\n;globalThis.Tile = KbConnTile', ctx)
    return (props) => renderToStaticMarkup(React.createElement(ctx.Tile, props))
  }
  const withLogos = make({ __KB_APP_LOGOS__: { svg: (s) => (s === 'gmail' ? '<svg viewBox="0 0 8 8"><path d="M0 0"/></svg>' : null), subscribe: () => () => {} } })
  const gmail = withLogos({ slug: 'gmail', name: 'gmail' })
  assert.ok(gmail.includes('kbcn-logo') && gmail.includes('<svg'), 'a known app draws its logo: ' + gmail)
  assert.ok(gmail.includes('role="img"') && gmail.includes('aria-label="gmail"'), 'and the tile still says which app it is')
  assert.ok(!gmail.includes('>GM<'), 'with no initials next to it')
  const unknown = withLogos({ slug: 'googlecalendar', name: 'googlecalendar' })
  assert.ok(unknown.includes('data-kb="conn-initials"') && unknown.includes('>GO<'), 'an app without a logo keeps its two letters: ' + unknown)
  ok('tile: the real logo when the seam has it, two letters when it has not')

  const bare = make({})
  assert.ok(bare({ slug: 'gmail', name: 'gmail' }).includes('>GM<'), 'without kybernos-composio: initials')
  const throwing = make({ __KB_APP_LOGOS__: { svg: () => { throw new Error('boom') }, subscribe: () => { throw new Error('boom') } } })
  assert.ok(throwing({ slug: 'gmail', name: 'gmail' }).includes('>GM<'), 'a seam that throws: initials, never a failed render')
  assert.ok(bare({ slug: null, name: null }).includes('data-kb="conn-initials"'), 'no slug and no name: an empty tile, no crash')
  const hostile = make({ __KB_APP_LOGOS__: { svg: () => 42, subscribe: () => () => {} } })
  assert.ok(hostile({ slug: 'gmail', name: 'gmail' }).includes('>GM<'), 'a seam that answers a non-string: initials')
  ok('tile: no seam, a throwing seam, odd props → initials')

  for (const [label, needle] of [['project tab', "h(KbConnTile, { slug: c.slug, name: c.name })"], ['team tab, real rows', "h(KbConnTile, { slug: c.slug, name: c.name })"], ['team tab, declared rows', "h(KbConnTile, { slug: d.slug, name: d.name })"]]) {
    assert.ok(plugin.includes(needle), label + ' uses the tile')
  }
  assert.ok(!/[cd]\.name\.slice\(0, 2\)\.toUpperCase\(\)/.test(plugin), 'no list builds its own initials any more: they live in the tile')
  assert.ok(/\.kbcn-logo svg\{width:68%/.test(plugin), 'the logo is sized inside its tile')
  ok('the three Connectors lists draw their tile through KbConnTile')

  // the card of a team call
  const card = (env, subject, status) => {
    const calls = { n: 0 }
    const stub = (initial) => ({
      createElement: React.createElement,
      Fragment: React.Fragment,
      useState: () => [initial, () => {}],
      useEffect: () => {},
    })
    const ctx = vm.createContext({
      React: stub(env),
      h: React.createElement,
      host: { call: () => { calls.n += 1; return new Promise(() => {}) } },
      kbRevPushEffect: () => () => {},
      kbBadgeSpans: (s) => s,
      kbt: (k) => k,
      kbCrew2FocusOn: () => {},
      kbOpenCrewView: () => {},
      kbClickViewTab: () => {},
    })
    vm.runInContext(between(plugin, 'const KbTeamCallCard = (props) => {', 'const KBTC_CSS =') + '\n;globalThis.Card = KbTeamCallCard', ctx)
    const node = { data: { id: 't1', subject: subject, status: status, scopes: [], crew: (subject.match(/^\s*\[([a-z0-9][a-z0-9-]*)\]/i) || [])[1] || null, st: status === 'completed' ? 'done' : (status === 'in_progress' ? 'active' : 'pending') } }
    return renderToStaticMarkup(React.createElement(ctx.Card, { node: node, sessionId: 's1' }))
  }
  const lot = 'Lot S — gardes d’écriture (A-15, A-16)'
  const before = card(null, lot, 'in_progress')
  assert.ok(before.includes('data-plain="1"') && before.includes(lot) && !before.includes('kbtc-card') && !before.includes('kbtc-plain'), 'before the host answers: only the subject, no card to flash: ' + before)
  const plain = card({ call: null, crews: [] }, lot, 'in_progress')
  assert.ok(plain.includes('kbtc-plain') && plain.includes('data-st="active"') && plain.includes('kbtc.st.active') && plain.includes(lot), 'a task with no team: one line, its state and its subject: ' + plain)
  assert.ok(!plain.includes('kbtc-card') && !plain.includes('kbtc-voir') && !plain.includes('kbtc-mono') && !plain.includes('>?<') && !plain.includes('kbtc.appel'), 'no « ? », no « call », no button that leads nowhere')
  assert.ok(card({ call: null, crews: [] }, lot, 'completed').includes('kbtc.st.done'), 'a finished one says so')
  assert.ok(card({ call: null, crews: [] }, '', 'pending').includes('kbtc.st.pending'), 'no subject: the state alone')
  ok('call card: a task with no team is one line (state + subject), never « ? · call »')

  const real = card({ call: null, crews: [{ id: 'acme', name: 'Acme' }] }, '[acme] Draft the plan', 'in_progress')
  assert.ok(real.includes('kbtc-card') && real.includes('Acme') && real.includes('kbtc-voir') && !real.includes('kbtc-plain'), 'a task tagged with a team keeps its card: ' + real)
  const known = card({ call: { id: 't1', team: 'acme', n: 3, st: 'active', short: 'Draft', nodes: [] }, crews: [{ id: 'acme', name: 'Acme' }] }, lot, 'in_progress')
  assert.ok(known.includes('kbtc-card') && known.includes('Acme') && known.includes('#3'), 'a call the host knows keeps its card even with no tag in the subject: ' + known)
  ok('call card: a team call (tag or known to the host) keeps its card')
}

console.log(pass + ' groups OK')
