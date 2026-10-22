#!/usr/bin/env node
/** The chat tools of the header (2026-10-22, mockup variant B): the occasional actions of a chat (send to another session, public link, chat id, full screen) are entries of ONE
 *  menu, the « + » at the right end of the header actions, instead of four buttons on the title line. Source-level, like test-pinned-rows.mjs: the bundles are browser modules,
 *  not importable here, so the registry and the running of an entry are cut out of the bundle and played as they are.
 *
 *  Usage: node packages/kybernos-plugin/test-chat-tools.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const plugin = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')
const between = (a, b) => {
  const i = plugin.indexOf(a)
  const j = plugin.indexOf(b)
  assert.ok(i >= 0 && j > i, a + ' … ' + b + ' were found')
  return plugin.slice(i, j)
}

// 1. the registry: what a bundle can add, in which order, and how it leaves.
{
  const ctx = vm.createContext({})
  vm.runInContext(between('// <chat-tools:begin>', '// <chat-tools:end>') + '\n;globalThis.make = kbChatToolsMake; globalThis.V = KB_CHAT_TOOLS_VERSION', ctx)
  const reg = ctx.make()
  const run = () => {}
  assert.equal(reg.version, ctx.V)
  assert.equal(reg.list().length, 0, 'empty at first')
  const t2 = { id: 'b', order: 30, run }
  const t1 = { id: 'a', order: 10, run }
  const t3 = { id: 'c', run }
  const off2 = reg.add(t2); reg.add(t3); reg.add(t1)
  assert.equal(reg.list().map((t) => t.id).join(), 'a,b,c', 'by order, an entry with none last')
  let heard = 0
  const unsub = reg.subscribe(() => { heard += 1 })
  off2()
  assert.equal(reg.list().map((t) => t.id).join(), 'a,c', 'an entry leaves with its remove function')
  assert.equal(heard, 1, 'and the menu is told')
  reg.add({ id: 'a', order: 5, run })
  assert.equal(reg.list()[0].order, 5, 'the same id replaces the entry')
  const offOld = reg.add(t1)
  reg.add({ id: 'a', order: 7, run })
  offOld()
  assert.equal(reg.list().find((t) => t.id === 'a').order, 7, 'a stale remove function does not remove the entry that replaced it')
  for (const bad of [null, undefined, 'x', { id: '', run }, { id: 'z' }, { id: 5, run }, { id: 'z', run: 'no' }]) {
    const before = reg.list().length
    const off = reg.add(bad)
    assert.equal(typeof off, 'function', 'a bad entry still answers a remove function')
    off()
    assert.equal(reg.list().length, before, 'and is ignored: ' + JSON.stringify(bad))
  }
  reg.subscribe(() => { throw new Error('a failing subscriber') })
  reg.add({ id: 'q', run })
  assert.ok(reg.list().some((t) => t.id === 'q'), 'a subscriber that throws does not stop the others nor the add')
  unsub()
  const heardBefore = heard
  reg.add({ id: 'r', run })
  assert.equal(heard, heardBefore, 'an unsubscribed listener hears nothing')
  ok('the registry orders entries, replaces by id, ignores bad ones, tells the menu and survives a failing subscriber')
}

// 2. running an entry: a promise or a plain answer says itself in the toast; a refusal or a throw says it failed, never silence.
{
  const toasts = []
  const els = []
  const fakeDocument = {
    body: { appendChild: (e) => { e.isConnected = true } },
    createElement: () => { const e = { attrs: {}, isConnected: false, setAttribute (k, v) { this.attrs[k] = v }, remove () { this.isConnected = false }, className: '', textContent: '' }; els.push(e); return e },
  }
  let timers = []
  const ctx = vm.createContext({
    document: fakeDocument,
    kbt: (k) => (k === 'kbct.failed' ? 'The action failed' : k),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeout: (id) => { timers[id - 1] = null },
    Promise,
  })
  vm.runInContext(between('// <chat-tools-run:begin>', '// <chat-tools-run:end>') + '\n;globalThis.run = kbChatToolRun; globalThis.toast = kbChatToast',
    ctx)
  const last = () => { const e = els[els.length - 1]; return e === undefined ? null : { text: e.textContent, tone: e.attrs['data-tone'], on: e.isConnected } }
  ctx.run({ run: () => ({ ok: true, note: 'Chat ID copied' }) }, {})
  assert.deepEqual(last(), { text: 'Chat ID copied', tone: 'ok', on: true }, 'a plain answer with a note is said')
  assert.equal(timers[timers.length - 1].ms, 5000, 'for a few seconds')
  ctx.run({ run: () => ({ ok: false, note: 'sharing refused: nope' }) }, {})
  assert.deepEqual(last(), { text: 'sharing refused: nope', tone: 'err', on: true }, 'a refusal is said as an error')
  ctx.run({ run: () => { throw new Error('boom') } }, {})
  assert.deepEqual(last(), { text: 'The action failed', tone: 'err', on: true }, 'a throw says it failed')
  const before = els.length
  ctx.run({ run: () => undefined }, {})
  assert.equal(els.length, before, 'an entry that answers nothing (send, full screen) draws no toast')
  let release
  const pending = new Promise((resolve) => { release = resolve })
  ctx.run({ working: () => 'Creating the link…', run: () => pending }, {})
  assert.deepEqual(last(), { text: 'Creating the link…', tone: 'busy', on: true }, 'a slow entry says what it is doing at once')
  release({ ok: true, note: 'link copied — https://x/s/abc' })
  await pending
  await Promise.resolve()
  assert.deepEqual(last(), { text: 'link copied — https://x/s/abc', tone: 'ok', on: true }, 'then the answer replaces it')
  const rejected = Promise.reject(new Error('network'))
  ctx.run({ working: 'Creating the link…', run: () => rejected }, {})
  await rejected.catch(() => {})
  await Promise.resolve()
  assert.equal(last().text, 'The action failed', 'a rejected promise says it failed')
  const silent = Promise.resolve({ ok: true })
  ctx.run({ working: 'Working…', run: () => silent }, {})
  await silent
  await Promise.resolve()
  assert.equal(last().on, false, 'an answer without a note takes the busy toast away')
  ok('an entry says what it does in a toast: busy while it works, then its note, an error as an error, a throw as « failed », nothing when it has nothing to say')
}

// 3. the wiring: the three buttons of the plugin are entries now, the menu sits after the call, the old components are gone.
{
  assert.ok(!/const (KbShareChat|KbChatId|KbFullscreen) = /.test(plugin), 'the three buttons are gone')
  for (const id of ["id: 'share'", "id: 'chat-id'", "id: 'fullscreen'"]) assert.ok(plugin.includes(id), 'the plugin adds the entry ' + id)
  assert.ok(/id: 'kybernos-chat-tools', order: 55 \}, KbChatTools/.test(plugin), 'the menu is injected in the header actions, after the call (order 50)')
  assert.ok(!/id: 'kybernos-(share-chat|chat-id|fullscreen)'/.test(plugin), 'the three old slot registrations are gone')
  assert.ok(/\[class\*="kbct-root"\]\{order:100\}/.test(plugin) && !/kbsh-root|kbci-root/.test(plugin), 'the menu is last of the row, and the order CSS no longer names the removed roots')
  assert.ok(/data-kb-sheet': 'skip'/.test(plugin), 'the « + » keeps itself out of the phone sheet (its entries are listed there)')
  assert.ok(/className: 'kbct-flat', hidden: true/.test(plugin), 'and each entry is a hidden button for that sheet')
  const root = between("return h('div', { className: 'kbct-root'", "ctx.effect(() => slots.inject('conversation.session.header.actions', () => slots.register(\n      { name: 'conversation.session.header.actions', id: 'kybernos-chat-tools'")
  assert.ok(!/'data-kb':/.test(root.split("className: 'kbct-menu'")[0]) && !/h\('span'/.test(root), 'the menu root has no data-kb and no span: mobile.css parks it on a phone like the roots it replaces')
  assert.ok(/\.kbtg-root\[data-empty="1"\]\{display:none\}/.test(plugin), '« Teams 0 » is hidden until the chat has a team or a call to validate')
  for (const k of ["'kbct.title'", "'kbct.share'", "'kbct.id'", "'kbct.working'", "'kbct.failed'"]) assert.ok(plugin.includes(k + ': { kybernos:'), 'the string ' + k + ' has both languages')
  ok('the plugin\'s three header buttons are entries of the menu, after the call, parked on a phone like before; « Teams 0 » is hidden while empty')
}

console.log('\n' + pass + ' checks passed')
