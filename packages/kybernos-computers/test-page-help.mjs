#!/usr/bin/env node
/** The Settings page « Code sandbox (E2B) » and its « ? » card: the page's description lives IN the card (`lead`), not under the title.
 *  The real client runs on a fake React that only builds a tree; the Suite's Help is a stand-in that records what it was asked for.
 *    - with the Suite: one Help, given the description as `lead` and the page's name as `title`; no description paragraph under the title;
 *    - without the Suite: no button, and the description stays under the title (as it always was).
 *
 *  Usage: node packages/kybernos-computers/test-page-help.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeHelp } from '../kybernos-hub/fake-help.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

const noop = () => {}
const Help = function Help () { return null }

/** Loads the client and renders the Settings page once; `suite` puts the Suite's Help on `window`. */
const draw = ({ suite }) => {
  let def = null
  const win = { __ModuleLoader__: { load: (d) => { def = d } }, __KB_LANG_RESOLVE__: () => 'en', addEventListener: noop, removeEventListener: noop, dispatchEvent: noop }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: (v) => [typeof v === 'function' ? v() : v, noop],
    useCallback: (f) => f,
    useEffect: noop,
    useRef: (v) => ({ current: v }),
  }
  if (suite) win.__KB_HELP__ = { version: 1, ...fakeHelp(React, Help) }
  const tag = () => ({ dataset: {}, remove: noop })
  const doc = { documentElement: { lang: 'en' }, head: { append: noop, appendChild: noop }, createElement: tag, addEventListener: noop, removeEventListener: noop }
  globalThis.window = win
  globalThis.document = doc
  new Function('window', 'document', src)(win, doc)
  const primitives = { SettingsForm: noop, SettingsSecretField: noop, SettingsFormModel: class { actions () { return {} } dispose () {} } }
  const plugin = def.factory((name) => (name === 'react' ? React : name === 'react/jsx-runtime' ? { jsx: noop, jsxs: noop } : name === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : undefined))
  let dict = null
  let Page = null
  const slots = { inject: (names, make) => { make(); return noop }, register: (spec, comp) => { if (spec.id === 'kybernos-computers' && spec.name === 'settings.section') Page = comp; return noop }, subscribe: () => noop, entries: () => [] }
  const ctx = {
    get: (n) => (n === 'slots' ? slots : undefined),
    slots,
    locale: { bind: () => (key) => (dict !== null && typeof dict.en[key] === 'string' ? dict.en[key] : key), register: (ns, d) => { dict = d; return noop } },
    configForms: { whileServed: noop, get: noop },
    remote: { $on: noop, credentials: {} },
    effect: (fn) => fn(),
  }
  plugin.apply(ctx)
  return Page === null ? null : Page()
}
const find = (node, test, out = []) => {
  if (node === null || typeof node !== 'object') return out
  if (test(node)) out.push(node)
  // The Suite's Title is a component: it is drawn (heading, then the button), the Help stand-in stays a leaf.
  const kids = typeof node.type === 'function' && node.type !== Help ? [node.type(node.props)] : (node.children || [])
  for (const c of kids) find(c, test, out)
  return out
}
const text = (node) => (node === null || node === undefined ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(''))

const DESCRIPTION = 'Run the code of your agents in a throwaway cloud computer (E2B) instead of on this machine. You bring your own E2B key: the usage is billed to your E2B account.'

// 1. with the Suite
{
  const tree = draw({ suite: true })
  assert.ok(tree !== null, 'the Settings page is registered and renders')
  const helps = find(tree, (n) => n.type === Help)
  assert.equal(helps.length, 1, 'one « ? » card')
  assert.equal(helps[0].props.id, 'kybernos-computers', 'for this bundle')
  assert.equal(helps[0].props.lead, DESCRIPTION, 'the page hands its description to the card as `lead`, word for word')
  assert.equal(helps[0].props.title, 'Code sandbox (E2B)', '…and its name as `title`')
  assert.equal(find(tree, (n) => n.props && n.props.className === 'kcc-sub').length, 0, 'no description paragraph under the title')
  assert.ok(!text(tree).includes(DESCRIPTION), 'the description is nowhere on the page itself')
  assert.equal(find(tree, (n) => n.type === 'h2' && n.props.className === 'kbhp-title kcc-title').length, 1, 'the title stays, in the shared class')
  ok('with the Suite the description moves into the « ? » card (`lead`) and leaves the page')
}

// 2. without the Suite
{
  const tree = draw({ suite: false })
  assert.ok(tree !== null, 'the page still renders')
  assert.equal(find(tree, (n) => n.type === Help).length, 0, 'no « ? » button')
  const sub = find(tree, (n) => n.props && n.props.className === 'kcc-sub')
  assert.equal(sub.length, 1, 'the description paragraph is there')
  assert.equal(text(sub[0]), DESCRIPTION, '…with the same words')
  assert.equal(find(tree, (n) => n.type === 'h2' && n.props.className === 'kbhp-title kcc-title').length, 1, 'the bare title is in the shared class')
  ok('without the Suite the description stays under the title')
}

// 3. the title has no style of its own: the page draws it through pageHead, and no rule of the bundle sizes or weighs it
{
  assert.match(src, /pageHead\(\{ id: 'kybernos-computers', lead: t\('pageIntro'\), title: t\('title'\), className: 'kcc-title' \}\)/, 'the head goes through pageHead')
  assert.ok(!/\.kcc-title\s*[{,]/.test(src), 'no rule styles .kcc-title (the Settings frame sets the title)')
  ok('the page title has no style of its own')
}

console.log('\n' + pass + ' checks passed')
