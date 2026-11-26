// ═════════════════════════════════════════════════════════════════
// Settings › Connectors: the two provider cards fold to their header row and one status line.
// The real settings page is rendered (client.js, unchanged) by a tiny hook-capable renderer, and its buttons are clicked the way a
// browser does: a click goes to the button, then up through its ancestors. No network, no browser.
//
//   node test-provider-cards.mjs
// ═════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import { suite } from './lib-test.mjs'

const { ok, done } = suite()

// ── the renderer: function components with useState / useRef / useEffect, a tree with parent links, settle() to let promises land ──
let inst = null
let dirty = false
const hookOf = (init) => { const i = inst.i++; if (!(i in inst.hooks)) inst.hooks[i] = init(); return i }
const React = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
  useState: (init) => { const me = inst; const i = hookOf(() => (typeof init === 'function' ? init() : init)); return [me.hooks[i], (v) => { me.hooks[i] = typeof v === 'function' ? v(me.hooks[i]) : v; dirty = true }] },
  useRef: (init) => { const i = hookOf(() => ({ current: init })); return inst.hooks[i] },
  useCallback: (f) => f,
  useEffect: (f, deps) => {
    const me = inst
    const i = hookOf(() => ({ deps: undefined, first: true, cleanup: undefined }))
    const slot = me.hooks[i]
    const same = !slot.first && Array.isArray(deps) && Array.isArray(slot.deps) && deps.length === slot.deps.length && deps.every((d, k) => Object.is(d, slot.deps[k]))
    if (same) return
    slot.first = false
    slot.deps = deps
    me.effects.push(() => { if (typeof slot.cleanup === 'function') slot.cleanup(); slot.cleanup = f() })
  },
}
function mount (Comp) {
  const store = new Map()
  let root = null
  const build = (node, path, parent) => {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return { text: String(node), parent }
    if (typeof node.type === 'function') {
      if (!store.has(path)) store.set(path, { hooks: [], effects: [] })
      const me = store.get(path)
      me.i = 0
      inst = me
      const out = node.type(node.props)
      inst = null
      return build(out, path + '/c', parent)
    }
    const el = { tag: node.type, props: node.props, kids: [], parent }
    el.kids = node.kids.map((k, n) => build(k, path + '/' + n, el)).filter((k) => k !== null)
    return el
  }
  const run = async () => {
    for (let round = 0; round < 12; round += 1) {
      dirty = false
      root = build({ type: Comp, props: {}, kids: [] }, 'root', null)
      for (const me of store.values()) { const fx = me.effects; me.effects = []; for (const f of fx) f() }
      await new Promise((r) => setTimeout(r, 5))
      if (dirty !== true) { root = build({ type: Comp, props: {}, kids: [] }, 'root', null); return }
    }
  }
  return { run, tree: () => root }
}
const all = (el, out = []) => { if (el === null || el.text !== undefined) return out; out.push(el); for (const k of el.kids) all(k, out); return out }
const textOf = (el) => (el.text !== undefined ? el.text : el.kids.map(textOf).join(''))
const inside = (el, ancestor) => { for (let p = el; p !== null; p = p.parent) if (p === ancestor) return true; return false }
/** A click: the button first, then every ancestor with a handler, until one stops it. */
const click = (el) => {
  let stopped = false
  const ev = { stopPropagation () { stopped = true }, preventDefault () {}, target: el }
  for (let p = el; p !== null && stopped === false; p = p.parent) { if (typeof p.props.onClick === 'function' && p.props.disabled !== true) p.props.onClick(ev) }
}

// ── the world the page talks to ──────────────────────────────────────────────────────────────
let lang = 'en'
const posted = []
const world = { key: { ok: true, api: 2, configured: true, source: 'env', agents: 'same' }, cloud: { ok: true, offered: true, connected: true, entitled: true, limit: 3, count: 0, connections: [] }, provider: null }
globalThis.window = { __ModuleLoader__: { load: (d) => { globalThis.__def = d } }, __KB_LANG_RESOLVE__: () => lang, addEventListener () {}, removeEventListener () {}, dispatchEvent () { return true } }
globalThis.localStorage = { getItem: () => null, setItem () {}, removeItem () {} }
globalThis.fetch = async (url, init) => {
  const method = (init && init.method) || 'GET'
  const json = (status, body) => ({ status, ok: status === 200, json: async () => body })
  if (url === '/kybernos/composio/catalog') return json(200, [])
  if (url === '/kybernos/composio/key') return json(200, world.key)
  if (url.startsWith('/kybernos/composio/connections')) return json(200, { ok: true, connections: [] })
  if (url === '/kybernos/composio/provider') {
    if (method === 'POST') { const b = JSON.parse(init.body); posted.push(b.provider); world.provider = b.provider; return json(200, { ok: true, provider: b.provider }) }
    return json(200, { ok: true, provider: world.provider })
  }
  if (url === '/kybernos-cloud/connections') return json(200, world.cloud)
  return json(404, null)
}
await import(new URL('./client.js', import.meta.url).href)
const plugin = globalThis.__def.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) })
const Page = plugin.composio.settingsPage
ok('the settings page is reachable for the test', typeof Page === 'function')

const hook = (tree, name) => all(tree).find((e) => e.props['data-kb'] === name) || null
const card = (tree, id) => hook(tree, 'provider-card-' + id)
const state = (tree, id) => { const c = card(tree, id); const s = all(c).find((e) => e.props.className === 'kbcp-pv-state'); return s === undefined ? null : textOf(s) }
const open = (tree, id) => hook(tree, 'provider-toggle-' + id).props['aria-expanded'] === 'true'
const checked = (tree, id) => hook(tree, 'provider-' + id).props['aria-checked'] === 'true'

// ── default: both folded, one status line each, nothing lost ──────────────────────────────────
let m = mount(Page)
await m.run()
let t = m.tree()
ok('default: both cards are folded', open(t, 'composio') === false && open(t, 'kybernos') === false)
ok('default: the folded part is hidden, in both cards', hook(t, 'provider-more-composio').props.hidden === true && hook(t, 'provider-more-kybernos').props.hidden === true)
ok('default: each toggle is a button that names the part it controls', ['composio', 'kybernos'].every((id) => { const b = hook(t, 'provider-toggle-' + id); return b.tag === 'button' && b.props.type === 'button' && b.props['aria-controls'] === hook(t, 'provider-more-' + id).props.id && typeof b.props['aria-label'] === 'string' && b.props['aria-label'].length > 0 }))
ok('default: the header keeps the radio, the name and the badge outside the folded part', ['composio', 'kybernos'].every((id) => !inside(hook(t, 'provider-' + id), hook(t, 'provider-more-' + id))) && textOf(card(t, 'composio')).includes('Composio — your own key') && textOf(card(t, 'composio')).includes('You manage it') && textOf(card(t, 'kybernos')).includes('Included in your plan'))
ok('default: the one-line status is Composio\'s footer, and stays outside the folded part', state(t, 'composio') === 'Configured · provided by the environment' && !inside(all(card(t, 'composio')).find((e) => e.props.className === 'kbcp-pv-state'), hook(t, 'provider-more-composio')), state(t, 'composio'))
ok('default: Kybernos Cloud says how many apps are connected', state(t, 'kybernos') === 'Connected · 0 of 3 apps', state(t, 'kybernos'))
ok('default: the status line follows the folded part directly (so it sits under the header when folded)', ['composio', 'kybernos'].every((id) => { const body = all(card(t, id)).find((e) => e.props.className === 'kbcp-pv-b'); const names = body.kids.map((k) => k.props['data-kb'] || k.props.className); return names.length === 3 && names[1] === 'provider-more-' + id && names[2] === 'kbcp-pv-state' }))
ok('default: every element is still in the page, only in the folded part (key box, input, save, help, manage button, description)',
  (() => { const more = hook(t, 'provider-more-composio'); const parts = all(more); return hook(t, 'composio-host-state') !== null && inside(hook(t, 'composio-host-state'), more) && parts.some((e) => e.tag === 'input' && e.props.placeholder === 'ck_…') && parts.some((e) => e.tag === 'details') && parts.some((e) => e.tag === 'p' && e.props.className === 'kbcp-pv-p') })()
  && inside(hook(t, 'provider-manage'), hook(t, 'provider-more-kybernos')))
ok('default: Composio\'s own box lists its three status lines', all(hook(t, 'composio-host-state')).filter((e) => e.props.className === 'kbcp-row').length === 3)
ok('default: the radio shows the choice in force (own key saved: Composio), unfolded or not', checked(t, 'composio') && !checked(t, 'kybernos'))

// ── unfolding: the toggle shows the rest and never touches the choice ────────────────────────────
click(hook(t, 'provider-toggle-composio'))
await m.run()
t = m.tree()
ok('toggle: it unfolds its own card only', open(t, 'composio') === true && open(t, 'kybernos') === false && hook(t, 'provider-more-composio').props.hidden === false && hook(t, 'provider-more-kybernos').props.hidden === true)
ok('toggle: the choice did not move and nothing was saved', checked(t, 'composio') && !checked(t, 'kybernos') && posted.length === 0)
click(hook(t, 'provider-toggle-kybernos'))
await m.run()
t = m.tree()
ok('toggle: the two cards fold and unfold independently', open(t, 'composio') === true && open(t, 'kybernos') === true && posted.length === 0)
click(hook(t, 'provider-toggle-composio'))
click(hook(t, 'provider-toggle-kybernos'))
await m.run()
t = m.tree()
ok('toggle: a second click folds again', open(t, 'composio') === false && open(t, 'kybernos') === false && hook(t, 'provider-more-composio').props.hidden === true)
ok('default: keyboard order is radio, toggle, then the card\'s contents', ['composio', 'kybernos'].every((id) => { const c = card(t, id); return c.kids[0] === hook(t, 'provider-' + id) && c.kids[1] === hook(t, 'provider-toggle-' + id) }))
ok('toggle: it sits beside the header, so a click on it cannot reach the header that selects', ['composio', 'kybernos'].every((id) => { const tog = hook(t, 'provider-toggle-' + id); let up = tog.parent; while (up !== null && up !== card(t, id)) { if (typeof up.props.onClick === 'function') return false; up = up.parent } return up !== null }))

// ── choosing: the radio and the header work with the cards folded, and do not unfold them ───────────
click(hook(t, 'provider-kybernos'))
await m.run()
t = m.tree()
ok('radio: choosing Kybernos Cloud while folded saves it and keeps both folded', posted.join() === 'kybernos' && checked(t, 'kybernos') && !checked(t, 'composio') && open(t, 'composio') === false && open(t, 'kybernos') === false, posted)
click(all(card(t, 'composio')).find((e) => e.props.className === 'kbcp-pv-h'))
await m.run()
t = m.tree()
ok('header: clicking the name chooses it without unfolding', posted.join() === 'kybernos,composio' && checked(t, 'composio') && open(t, 'composio') === false, posted)
click(hook(t, 'provider-toggle-kybernos'))
await m.run()
t = m.tree()
ok('toggle after a choice: still no change of the choice', checked(t, 'composio') && posted.length === 2)

// ── failure states ─────────────────────────────────────────────────────────────────────────────
posted.length = 0
world.key = { ok: true, api: 2, configured: false }
world.provider = null
world.cloud = { ok: true, offered: true, connected: false }
m = mount(Page)
await m.run()
t = m.tree()
ok('no key and signed out: the status lines say so, one line each', state(t, 'composio') === 'Not configured' && state(t, 'kybernos') === 'Not signed in', [state(t, 'composio'), state(t, 'kybernos')])
ok('signed out: the sign-in button is in the folded part and appears when unfolded', inside(hook(t, 'provider-signin'), hook(t, 'provider-more-kybernos')) && hook(t, 'provider-more-kybernos').props.hidden === true)
click(hook(t, 'provider-toggle-kybernos'))
await m.run()
t = m.tree()
ok('signed out: unfolding shows it, and the radio is still off', hook(t, 'provider-more-kybernos').props.hidden === false && hook(t, 'provider-signin').props.disabled !== true && hook(t, 'provider-kybernos').props.disabled === true)
click(hook(t, 'provider-kybernos'))
click(hook(t, 'provider-toggle-composio'))
await m.run()
t = m.tree()
ok('signed out: a click on the disabled radio saves nothing; unfolding the other card changes nothing', posted.length === 0)

world.cloud = { ok: true, offered: true, connected: true, entitled: false, limit: 0, count: 0, connections: [], web: 'https://example.com/plans' }
m = mount(Page)
await m.run()
t = m.tree()
ok('not in the plan: status says so and the plans button waits in the folded part', state(t, 'kybernos') === 'Not included in your plan' && inside(hook(t, 'provider-plans'), hook(t, 'provider-more-kybernos')) && textOf(card(t, 'kybernos')).includes('Paid plans'), state(t, 'kybernos'))

world.cloud = { offered: false, ok: true }
m = mount(Page)
await m.run()
t = m.tree()
ok('not offered by this server: the status line says so', state(t, 'kybernos') === 'This Kybernos server does not offer it yet.', state(t, 'kybernos'))

// ── the settings search must still reach what is folded (it blinks only text that is on screen) ──────────────────────────
{
  const core = readFileSync(new URL('../kybernos-plugin/client.js', import.meta.url), 'utf8')
  const at = core.indexOf('const kbSsReveal = ')
  const reveal = at < 0 ? '' : core.slice(at, at + 4000)
  ok('settings search: when a label is not on screen it presses a folded provider toggle (the hook this page sets) and looks again', reveal.includes('[data-kb^="provider-toggle-"][aria-expanded="false"]') && /folded\.click\(\)/.test(reveal))
}

// ── French: the new words exist ───────────────────────────────────────────────────────────────
lang = 'fr'
m = mount(Page)
await m.run()
t = m.tree()
ok('French: the toggle is named in French', hook(t, 'provider-toggle-composio').props['aria-label'].startsWith('Détails — '), hook(t, 'provider-toggle-composio').props['aria-label'])

done()
