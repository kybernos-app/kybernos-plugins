// kybernos-mobile, the phone link page: what it draws when the status poll fails (audit A5-08).
//   node packages/kybernos-mobile/test-remote-ui.mjs
// A tiny synchronous renderer (useState / useRef / useCallback / useEffect) stands in for React so the real components run.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const SOURCE = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'client.js'), 'utf8')

// ── the renderer ──────────────────────────────────────────────────────────────
const timers = []
globalThis.setInterval = (f) => { timers.push(f); return timers.length }
globalThis.clearInterval = () => {}
const makeRenderer = () => {
  const store = new Map()
  let current = null
  let dirty = false
  const slot = () => { const k = current.i; current.i += 1; if (current.hooks[k] === undefined) current.hooks[k] = {}; return current.hooks[k] }
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const React = {
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
    useState: (init) => {
      const s = slot()
      if (!('v' in s)) s.v = typeof init === 'function' ? init() : init
      return [s.v, (n) => { const nv = typeof n === 'function' ? n(s.v) : n; if (!Object.is(nv, s.v)) { s.v = nv; dirty = true } }]
    },
    useRef: (init) => { const s = slot(); if (!('r' in s)) s.r = { current: init }; return s.r },
    useCallback: (f, deps) => { const s = slot(); if (!same(s.deps, deps)) { s.deps = deps; s.f = f } return s.f },
    useEffect: (f, deps) => { const s = slot(); if (s.deps === undefined || !same(s.deps, deps)) { s.deps = deps; current.effects.push(() => { if (typeof s.cleanup === 'function') s.cleanup(); s.cleanup = f() }) } },
  }
  const seen = new Set()
  const expand = (node, path) => {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (typeof node.type === 'function') {
      const key = path + '/' + node.type.name + (node.props.key !== undefined ? '#' + node.props.key : '')
      seen.add(key)
      let inst = store.get(key)
      if (inst === undefined) { inst = { hooks: [], i: 0, effects: [] }; store.set(key, inst) }
      inst.i = 0; inst.effects = []
      current = inst
      const out = node.type({ ...node.props, children: node.kids })
      const effects = inst.effects
      const tree = expand(out, key)
      for (const e of effects) e()
      return tree
    }
    return { tag: node.type, props: node.props, kids: node.kids.map((k, n) => expand(k, path + '.' + n)).filter((k) => k !== null) }
  }
  const textOf = (t) => (t === null ? '' : typeof t === 'string' ? t : (t.kids || []).map(textOf).join(' '))
  const find = (t, pred) => { if (t === null || typeof t === 'string') return null; if (pred(t)) return t; for (const k of t.kids) { const f = find(k, pred); if (f !== null) return f } return null }
  const mount = (rootEl) => {
    const view = { tree: null }
    const pass = () => { seen.clear(); view.tree = expand(rootEl, 'root'); for (const [k, inst] of store) if (!seen.has(k)) { inst.hooks.forEach((h) => { if (typeof h.cleanup === 'function') h.cleanup() }); store.delete(k) } }
    pass()
    // everything that was scheduled (state changes, fetches) has landed
    view.settle = async () => { for (let n = 0; n < 12; n += 1) { await new Promise((r) => setImmediate(r)); if (dirty) { dirty = false; pass() } } }
    view.text = () => textOf(view.tree)
    view.find = (pred) => find(view.tree, pred)
    return view
  }
  return { React, mount }
}

// ── the page under test ───────────────────────────────────────────────────────
const GOOD = { ok: true, available: true, running: true, connected: true, configured: true, entitled: true, pairing: null, devices: [], refused: 0, relay: 'up' }
let answer = null // what the status route says next: an object, or a function that throws
let pairAnswer = { ok: true } // what the pairing route says next
const calls = []
globalThis.fetch = async (url, init) => {
  calls.push(String(url))
  if (String(url).includes('kybernos-cloud/status')) return { json: async () => ({ state: {} }) }
  if (String(url).includes('/remote/status')) {
    if (typeof answer === 'function') return answer()
    return { json: async () => answer }
  }
  if (String(url).endsWith('/remote/pair')) return { json: async () => pairAnswer }
  return { json: async () => ({ ok: true }) } // pair, cancel: nothing to see
}
globalThis.document = { baseURI: 'http://127.0.0.1:3080/', visibilityState: 'visible', body: null, head: { appendChild: (c) => c }, createElement: () => ({ dataset: {}, remove () {} }), addEventListener () {}, querySelector: () => null }
const events = [] // the window events the page dispatched
const load = (renderer) => {
  let def = null
  globalThis.window = { __ModuleLoader__: { load: (d) => { def = d } }, matchMedia: () => ({ matches: false }), __KB_LANG_RESOLVE__: () => 'en', dispatchEvent: (ev) => { events.push(ev.type); return true } }
  new Function('window', 'document', SOURCE)(globalThis.window, globalThis.document)
  const plugin = def.factory((name) => (name === 'react' ? renderer.React : undefined))
  let page = null
  const slots = { inject: (n, fn) => fn(), register: (spec, comp) => { page = comp; return () => {} } }
  plugin.apply({ effect: (fn) => fn(), inject: (names, cb) => cb({ slots }) })
  return { page, panel: globalThis.window.__KB_MOBILE__.Panel }
}
const poll = async (view) => { for (const f of [...timers]) f(); await view.settle() }

console.log('Settings › Remote Control: one failed poll')
for (const [label, make] of [
  ['the network fails', () => { throw new Error('offline') }],
  ['an HTTP 500 with an HTML body', () => ({ json: async () => { throw new SyntaxError('Unexpected token <') } })],
  ['the route answers {}', () => ({ json: async () => ({}) })],
  ['the route answers {ok:false,error:server_unavailable}', () => ({ json: async () => ({ ok: false, error: 'server_unavailable' }) })],
]) {
  const r = makeRenderer()
  timers.length = 0
  const { page } = load(r)
  answer = GOOD
  const view = r.mount(r.React.createElement(page))
  await view.settle()
  check(label + ': the page first shows the pairing start button', view.find((n) => n.props && n.props['data-kb'] === 'mobile-pair') !== null, view.text())
  answer = make
  let threw = null
  try { await poll(view) } catch (e) { threw = e }
  check(label + ': the render does not throw', threw === null, threw && String(threw.message))
  check(label + ': the page still shows what it had', view.find((n) => n.props && n.props['data-kb'] === 'mobile-pair') !== null, view.text())
  check(label + ': and says the poll failed', view.find((n) => n.props && n.props['data-kb'] === 'mobile-poll-error') !== null, view.text())
  answer = GOOD
  await poll(view)
  check(label + ': the next good poll clears the message', view.find((n) => n.props && n.props['data-kb'] === 'mobile-poll-error') === null && view.find((n) => n.props && n.props['data-kb'] === 'mobile-pair') !== null, view.text())
}

console.log('the very first poll fails')
{
  const r = makeRenderer()
  timers.length = 0
  const { page } = load(r)
  answer = () => { throw new Error('offline') }
  const view = r.mount(r.React.createElement(page))
  await view.settle()
  check('it says it cannot reach DSH instead of loading for ever', /Cannot reach DSH/.test(view.text()), view.text())
  answer = GOOD
  await poll(view)
  check('and recovers on the next good poll', view.find((n) => n.props && n.props['data-kb'] === 'mobile-pair') !== null, view.text())
}

console.log('the sidebar panel')
{
  const r = makeRenderer()
  timers.length = 0
  const { panel } = load(r)
  answer = { ...GOOD, pairing: { state: 'waiting', expires_at: Date.now() + 60000, qr: null, url: 'https://x.example/p' } }
  const view = r.mount(r.React.createElement(panel, {}))
  await view.settle()
  check('with a code in progress the panel shows the pairing', view.find((n) => n.props && n.props['data-kb'] === 'mobile-pairing') !== null, view.text())
  answer = () => { throw new Error('offline') }
  let threw = null
  try { await poll(view) } catch (e) { threw = e }
  check('a failed poll does not crash the panel (it would take the account card down with it)', threw === null, threw && String(threw.message))
  check('the code is still there', view.find((n) => n.props && n.props['data-kb'] === 'mobile-pairing') !== null, view.text())
}

// The server does not answer when a code is asked for: the sentence names the server (its label and host) and, when the registry has another one, offers to
// switch (audit V-41). The same words on the sidebar panel and on the Settings page.
console.log('the server does not answer: it is named, and another one can be chosen')
const press = (view, key) => { const n = view.find((x) => x.props && x.props['data-kb'] === key); if (n !== null) n.props.onClick() }
for (const where of ['panel', 'page']) {
  for (const [label, server, wantButton] of [
    ['another server exists', { name: 'Kybernos (local)', host: 'localhost:8791', can_switch: true }, true],
    ['it is the only server', { name: 'Kybernos Cloud', host: 'api.kybernos.app', can_switch: false }, false],
  ]) {
    const r = makeRenderer()
    timers.length = 0
    events.length = 0
    const { page, panel } = load(r)
    answer = GOOD
    pairAnswer = { ok: false, error: 'server_unavailable', server }
    let closed = 0
    const view = r.mount(r.React.createElement(where === 'panel' ? panel : page, where === 'panel' ? { onClose: () => { closed += 1 } } : {}))
    await view.settle()
    if (where === 'page') { press(view, 'mobile-pair'); await view.settle() }
    const said = view.text()
    check(where + ' (' + label + '): the sentence names the server: label and host', said.includes(server.name) && said.includes(server.host) && /does not answer/.test(said), said)
    check(where + ' (' + label + '): it is not the sentence that fits any server', !/The Kybernos server does not answer/.test(said), said)
    const sw = view.find((n) => n.props && n.props['data-kb'] === 'mobile-switch-server')
    check(where + ' (' + label + '): « Switch server » ' + (wantButton ? 'is offered' : 'is not (nothing to switch to)'), (sw !== null) === wantButton, said)
    if (wantButton && sw !== null) {
      sw.props.onClick()
      check(where + ': « Switch server » asks the footer to open Settings › Servers', events.includes('kybernos-cloud:servers'), events)
      if (where === 'panel') check('the panel closes itself first', closed === 1, closed)
    }
  }
  // A seam that named no server: the old sentence, and nothing to switch to.
  const r = makeRenderer()
  timers.length = 0
  const { page, panel } = load(r)
  answer = GOOD
  pairAnswer = { ok: false, error: 'server_unavailable' }
  const view = r.mount(r.React.createElement(where === 'panel' ? panel : page, {}))
  await view.settle()
  if (where === 'page') { press(view, 'mobile-pair'); await view.settle() }
  check(where + ' (no server named): the sentence stays the generic one, with no switch', /The Kybernos server does not answer/.test(view.text()) && view.find((n) => n.props && n.props['data-kb'] === 'mobile-switch-server') === null, view.text())
}
pairAnswer = { ok: true }

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
