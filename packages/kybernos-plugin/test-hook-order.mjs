#!/usr/bin/env node
/** A component calls the same hooks in the same order on every render (recette L1-43, 2026-10-25).
 *
 *  The dock of a new chat crashed on the first message: `KbNewChatCards` returned `null` once the chat was no longer blank, BEFORE two of its
 *  `React.useEffect` calls, so the next render called two hooks fewer and React threw error #300; the engine then dropped the entry and the tiles and the
 *  « Cloud Computer » row never came back before a reload. Three pins, none of which needs react, react-dom or a browser:
 *   1. a scanner (lib-hook-scan-test.mjs) that finds a hook call placed after a `return` of the same function, run on EVERY bundle client, so the
 *      next component that does it fails here (the scanner's own shapes are pinned first);
 *   2. the two dock components cut out of client.js and rendered on a fake React that enforces the hook-order rule the real one enforces
 *      (lib-lite-react-test.mjs): a blank chat, then the same chat once a message is sent, then a new chat;
 *   3. the hooks of the two docks do not depend on the session id (a hook called only when `sid !== ''` changes the count when the id arrives).
 *
 *  Usage: node packages/kybernos-plugin/test-hook-order.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { createLite } from './lib-lite-react-test.mjs'
import { lineOf, scanHookOrder, selfTest } from './lib-hook-scan-test.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── 1. the scanner, then every client of the repo ─────────────────────────────────────────────────────────────
{
  selfTest()
  ok('the scanner flags a hook after an early return and leaves hooks in a returned value, in a callback or in an expression-bodied arrow alone')
  const packages = join(here, '..')
  const seen = []
  const bad = []
  for (const d of readdirSync(packages).sort()) {
    let files = []
    try { files = readdirSync(join(packages, d)).filter((f) => /^[^.].*\.(js|mjs)$/.test(f) && !/^test/.test(f) && !/-test\.mjs$/.test(f)) } catch (e) { continue }
    for (const f of files) {
      const code = readFileSync(join(packages, d, f), 'utf8')
      if (!/\buse[A-Z][A-Za-z0-9]*\(/.test(code)) continue
      const r = scanHookOrder(code)
      assert.equal(r.balanced, true, d + '/' + f + ': the scanner kept its place in the file (every brace and parenthesis matched)')
      seen.push({ file: d + '/' + f, fns: r.hookFns })
      for (const v of r.violations) bad.push(d + '/' + f + ':' + lineOf(code, v.hookPos) + ' ' + v.hook + ' is called after the return of line ' + lineOf(code, v.returnPos))
    }
  }
  const plugin = seen.find((s) => s.file === 'kybernos-plugin/client.js')
  assert.ok(plugin !== undefined && plugin.fns > 100, 'the scan did see the components of the main client (' + (plugin ? plugin.fns : 0) + ' functions with hooks)')
  assert.ok(seen.length > 20, 'and the clients of the other bundles (' + seen.length + ' files)')
  assert.ok(bad.length === 0, 'no component calls a hook after an early return:\n    ' + bad.join('\n    '))
  ok('no client of the repo calls a hook after an early return (' + seen.length + ' files, ' + seen.reduce((n, s) => n + s.fns, 0) + ' functions with hooks)')
}

// ── 2. the two docks, rendered ────────────────────────────────────────────────────────────────────────────────
const lite = createLite()
const { React } = lite
const h = React.createElement
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  assert.ok(a > 0 && b > a, 'found ' + from)
  return src.slice(a, b).replace(/^const \w+ = /, '')
}
const make = (code, scope) => new Function(...Object.keys(scope), 'return ' + code)(...Object.values(scope))
// DSH's `useSessions(selector)` is a store hook: it calls React hooks itself, so calling it (or not) changes the hook count.
const storeHook = (store) => (selector) => { React.useRef(null); return selector(store) }

// The new-chat cards. The pure block (templates, chapters, detection) is cut out and run as it is; what the page provides is stubbed.
{
  const a = src.indexOf('// KB-NEWCHAT-BEGIN')
  const b = src.indexOf('// KB-NEWCHAT-END')
  assert.ok(a > 0 && b > a, 'the KB-NEWCHAT block exists')
  const pure = vm.runInNewContext(src.slice(a, b) + '\n;({ KB_NC_TEMPLATES, KB_NC_ART, kbNcSlider, kbNcDetect, kbNcFill, kbNcSuggest, kbNcActions, kbNcDot, kbNcRefusalKey })')
  const win = { addEventListener () {}, removeEventListener () {}, __KB_KYBER__: undefined }
  const Cards = make(cut('const KbNewChatCards = (props) => {', "\n    ctx.effect(() => slots.inject('conversation.input.dock', () => slots.register(\n      { name: 'conversation.input.dock', id: 'kybernos-newchat'"), {
    React, h, window: win, fetch: () => new Promise(() => {}), kbt: (k) => k, Icon: (n) => h('i', { 'data-icon': n }),
    ...pure,
    kbNcBootIds: () => [], kbDomainHome: () => undefined, kbFmtWhen: (s) => s, kbNcCloudBurst () {},
    useNcCloud: () => React.useState({ kind: 'awake', lastActive: '', pausedReason: '' })[0],
    KbNcSlider: (sp) => h('div', { 'data-kb': 'newchat-slider' }, sp.groups.length + ' chapters'),
  })
  const tiles = (root) => lite.find(root.tree, (n) => n.props['data-kb'] === 'newchat-slider').length
  const cloud = (root) => lite.find(root.tree, (n) => n.props['data-kb'] === 'newchat-cloud').length
  const blank = { sessionId: 's1', session: { blank: true }, input: { draft: '' }, inputActions: { setDraft () {} } }
  const sent = { sessionId: 's1', session: { blank: false }, input: { draft: '' }, inputActions: { setDraft () {} } }
  const fresh = { sessionId: 's2', session: { blank: true }, input: { draft: '' }, inputActions: { setDraft () {} } }

  const root = lite.mount(h(Cards, blank))
  await root.settle()
  assert.equal(tiles(root), 1, 'a blank chat shows the tiles')
  assert.equal(cloud(root), 1, 'and the Cloud Computer row')
  // The first message is sent: the chat is no longer blank. Real React threw error #300 here (two hooks sat after the early return).
  assert.doesNotThrow(() => root.update(h(Cards, sent)), 'the chat stops being blank: the dock renders again, with the same hooks')
  assert.equal(tiles(root) + cloud(root), 0, 'and shows nothing')
  assert.doesNotThrow(() => root.update(h(Cards, fresh)), 'a new chat')
  await root.settle()
  assert.equal(tiles(root), 1, 'the tiles are back for the new chat')
  assert.equal(cloud(root), 1, 'and so is the Cloud Computer row')
  ok('new-chat cards: blank, first message sent, new chat — same hooks every time, tiles and Cloud Computer row come back')

  // Kaby's own chat takes the second early return; it becomes known after a page load (its bundle says so with an event).
  const kaby = lite.mount(h(Cards, blank))
  await kaby.settle()
  win.__KB_KYBER__ = { isKybySession: () => true }
  assert.doesNotThrow(() => kaby.update(h(Cards, Object.assign({}, blank))), 'Kaby\'s chat is recognised after the cards were drawn')
  assert.equal(tiles(kaby), 0, 'its strip is all that sits above the composer: no tiles')
  win.__KB_KYBER__ = { isKybySession: () => false }
  assert.doesNotThrow(() => kaby.update(h(Cards, Object.assign({}, blank))), 'and back to an ordinary chat')
  assert.equal(tiles(kaby), 1)
  win.__KB_KYBER__ = undefined
  ok('new-chat cards: Kaby\'s chat (the other early return) keeps the hook order too')

  // The chat is blank according to the store of sessions rather than to the slot, and the id is not known at first.
  const store = { byId: { s1: { blank: true } } }
  const useSessions = storeHook(store)
  const viaStore = (sid) => ({ sessionId: sid, useSessions, input: { draft: '' }, inputActions: { setDraft () {} } })
  const st = lite.mount(h(Cards, viaStore('')))
  await st.settle()
  assert.doesNotThrow(() => st.update(h(Cards, viaStore('s1'))), 'the session id arrives after the first render: the hook count does not change')
  assert.equal(tiles(st), 1, 'the store says the chat is blank')
  store.byId.s1.blank = false
  assert.doesNotThrow(() => st.update(h(Cards, viaStore('s1'))))
  assert.equal(tiles(st), 0, 'and not blank any more')
  ok('new-chat cards: the store of sessions is read on every render, whether the id is known yet or not')
}

// The conversation starters of an Agent Team.
{
  const scope = {
    React, h, kbt: (k) => k, Icon: (n) => h('i', { 'data-icon': n }),
    host: { call: async () => ({ ok: true, active: ['k1'], roots: [{ kybers: [{ id: 'k1', name: 'Desk', ui: { starters: [{ title: 'Plan', prompt: 'Plan my week', description: '', icon: 'x' }] } }] }] }) },
    kbActiveKyberOf: (a) => a[0], kbRevPushEffect: () => () => {}, kbStartersFromUi: (ui) => ui.starters, kbCsCouleur: () => null, kbHex: (c) => (typeof c === 'string' ? c : ''),
    KBCS_PAR_PAGE: 4, KBCS_TEINTES: ['#888888'], kbCsTeinte: () => 'rgba(0,0,0,.1)', kbStarterIco: () => null,
  }
  const Starters = make(cut('const KbChatStarters = (props) => {', '    // ── onglet « Team Insight » de la fiche AI Team'), scope)
  const cards = (root) => lite.find(root.tree, (n) => n.props['data-kb'] === 'starter').length
  const store = { byId: { s1: { blank: true } } }
  const useSessions = storeHook(store)
  const via = (sid) => ({ sessionId: sid, useSessions })
  const root = lite.mount(h(Starters, via('')))
  await root.settle()
  assert.doesNotThrow(() => root.update(h(Starters, via('s1'))), 'the session id arrives after the first render: the hook count does not change')
  await root.settle()
  assert.equal(cards(root), 1, 'a blank chat of an Agent Team shows its starters')
  store.byId.s1.blank = false
  assert.doesNotThrow(() => root.update(h(Starters, via('s1'))), 'the first message is sent')
  assert.equal(cards(root), 0, 'the starters go')
  ok('conversation starters: the id arriving late and the first message sent keep the hook order')
}

// ── 3. the source says the same, for a reader ─────────────────────────────────────────────────────────────────
{
  const guarded = src.split('\n').filter((l) => /\buseSessions\(/.test(l) && /sid !== ''/.test(l))
  assert.ok(guarded.length === 0, 'no `useSessions(...)` call is made only when the session id is known (' + guarded.length + ' still are)')
  ok('no dock calls useSessions only once its session id is known')
}

console.log('\n' + pass + ' checks passed')
