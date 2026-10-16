// The Free LLMs page checks the free tier before it offers to connect (audit A3-14): when the tier is locked it says so in a
// sentence, the models are not drawn as available, Connect is off, and « Probe a model » gives a sentence, not a code.
// The real Panel runs here on a tiny synchronous renderer (useState / useEffect / useCallback), with a scripted host.
//
//   node packages/kybernos-free-llms/test-panel.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')

// ── the renderer ──────────────────────────────────────────────────────────────
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
    useCallback: (f, deps) => { const s = slot(); if (!same(s.deps, deps)) { s.deps = deps; s.f = f } return s.f },
    useEffect: (f, deps) => { const s = slot(); if (s.deps === undefined || !same(s.deps, deps)) { s.deps = deps; current.effects.push(() => { if (typeof s.cleanup === 'function') s.cleanup(); s.cleanup = f() }) } },
  }
  const expand = (node, path) => {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (typeof node.type === 'function') {
      const key = path + '/' + node.type.name
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
  const findAll = (t, pred, out = []) => { if (t === null || typeof t === 'string') return out; if (pred(t)) out.push(t); for (const k of t.kids) findAll(k, pred, out); return out }
  const mount = (rootEl) => {
    const view = { tree: null }
    const pass = () => { view.tree = expand(rootEl, 'root') }
    pass()
    view.settle = async () => { for (let n = 0; n < 12; n += 1) { await new Promise((r) => setImmediate(r)); if (dirty) { dirty = false; pass() } } }
    view.text = () => textOf(view.tree)
    view.all = (pred) => findAll(view.tree, pred)
    view.one = (pred) => findAll(view.tree, pred)[0] || null
    return view
  }
  return { React, mount }
}

// ── a scripted host ───────────────────────────────────────────────────────────
const MODELS = Array.from({ length: 13 }, (_, i) => 'free-model-' + (i + 1))
const calls = []
let healthAnswer = { ok: true, model: MODELS[0], code: 'ok' }
globalThis.fetch = async (url) => {
  calls.push(String(url))
  const u = String(url)
  if (u.startsWith('/free-llms/status')) return { json: async () => ({ ok: true, models: MODELS, catalogOk: true, state: { wired: false, acknowledged: false } }) }
  if (u.startsWith('/free-llms/health')) return { json: async () => healthAnswer }
  return { json: async () => ({ ok: true }) }
}
globalThis.document = { documentElement: { lang: 'en' }, head: { append () {} }, createElement: () => ({ dataset: {}, remove () {} }) }
const open = async (answer) => {
  healthAnswer = answer
  calls.length = 0
  const r = makeRenderer()
  let def = null
  globalThis.window = { __ModuleLoader__: { load: (d) => { def = d } } }
  new Function('window', 'document', SOURCE)(globalThis.window, globalThis.document)
  const plugin = def.factory((name) => (name === 'react' ? r.React : undefined))
  let Panel = null
  const slots = { inject: (n, fn) => fn(), register: (spec, comp) => { Panel = comp; return () => {} } }
  plugin.apply({ get: (n) => (n === 'slots' ? slots : (n === 'locale' ? 'en' : undefined)), effect: (fn) => fn() })
  const view = r.mount(r.React.createElement(Panel))
  await view.settle()
  return view
}
const connectButton = (view) => view.one((n) => n.props && n.props['data-kfl'] === 'connecter')
const acknowledge = async (view) => { view.one((n) => n.tag === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); await view.settle() }
const dots = (view) => view.all((n) => n.props && n.props.className === 'kbm-dot').map((n) => n.props['data-state'])

console.log('the free tier is locked (the answer of 2026-10-16: 403 free_tier_locked)')
{
  const view = await open({ ok: false, code: 'free_tier_locked', status: 403 })
  check('the page asks the host for the tier on open, with the cached form', calls.includes('/free-llms/health?cached=1'), calls)
  check('13 models are listed', dots(view).length === 13, dots(view).length)
  check('the list says, in a sentence, that the tier is unavailable', /The free tier is unavailable right now/.test(view.text()) && view.one((n) => n.props && n.props['data-kfl'] === 'tier-locked') !== null, view.text())
  check('...and not with a code or the word « Gate »', !/free_tier_locked|Gate/.test(view.text()))
  check('the models are not drawn as available (no green dot)', dots(view).every((d) => d === 'error'), dots(view))
  await acknowledge(view)
  check('Connect to DSH stays off even once the retention notice is acknowledged', connectButton(view).props.disabled === true)
  check('...and its tooltip says why', /locked it/.test(connectButton(view).props.title || ''), connectButton(view).props.title)
}

console.log('the free tier answers')
{
  const view = await open({ ok: true, model: MODELS[0], code: 'ok' })
  check('no warning, green dots', view.one((n) => n.props && n.props['data-kfl'] === 'tier-locked') === null && dots(view).every((d) => d === 'done'), dots(view))
  check('Connect is off until the notice is acknowledged, then on', connectButton(view).props.disabled === true && (await acknowledge(view), connectButton(view).props.disabled === false))
}

console.log('the check has not answered yet, or failed for a reason that says nothing about the tier')
{
  const view = await open({ ok: false, code: 'network' })
  await acknowledge(view)
  check('a network failure does not block Connect (the tier is not known to be locked)', connectButton(view).props.disabled === false && view.one((n) => n.props && n.props['data-kfl'] === 'tier-locked') === null)
}

console.log('« Probe a model »')
{
  const view = await open({ ok: true, model: MODELS[0], code: 'ok' })
  healthAnswer = { ok: false, code: 'free_tier_locked', status: 403 }
  calls.length = 0
  const probe = view.all((n) => n.tag === 'button').find((b) => /Probe a model/.test(view.text()) && (b.kids || []).some((k) => typeof k === 'string' && k === 'Probe a model'))
  probe.props.onClick()
  await view.settle()
  check('it asks for a fresh probe (no cached form)', calls.includes('/free-llms/health'), calls)
  check('a refusal is worded as a sentence, never as « Gate refused: free_tier_locked »', /The free tier is unavailable right now/.test(view.text()) && !/Gate refused|free_tier_locked/.test(view.text()), view.text())
  check('the probe also tells the page the tier is locked: Connect goes off', view.one((n) => n.props && n.props['data-kfl'] === 'tier-locked') !== null)
  healthAnswer = { ok: false, code: 'upstream_500' }
  probe.props.onClick()
  await view.settle()
  check('an unknown code is still a sentence with the code in brackets', /The test failed \(upstream_500\)/.test(view.text()), view.text())
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
