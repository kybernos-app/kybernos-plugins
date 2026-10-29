// test-client.mjs — the client half RUNS: the bundle is loaded the way DSH loads it (a factory handed `require`), then every component is drawn with a
// stand-in for React. It was merged on 2026-10-29 without ever having run: `factory ()` never received `require`, and once that was fixed `pills` was
// called under another name; either one stopped the entry from activating (« web boot: 1 entry did not activate »), and a failed entry makes the whole
// GUI show the « Failed to load plugins » harness. Nothing here needs a browser or the real React.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let echecs = 0
const check = (libelle, ok, detail) => {
  if (ok === true) { console.log('  ✓ ' + libelle); return }
  echecs++
  console.log('  ✗ ' + libelle + (detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''))
}

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(process.env.KB_WEBAPP_CLIENT || join(here, 'client.js'), 'utf8')

// A stand-in for React: elements are plain objects, the hooks return their initial value (or the next value of `states`, so that a component can be
// drawn in the state a fetch would have left it in), effects never run.
const states = []
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: (init) => [states.length > 0 ? states.shift() : (typeof init === 'function' ? init() : init), () => {}],
  useEffect: () => {},
  useCallback: (f) => f,
  useMemo: (f) => f(),
  useRef: (v) => ({ current: v === undefined ? null : v }),
}
// Draws the tree down to plain elements (a function component is called with its props and children).
const draw = (node) => {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (typeof node.type === 'function') return draw(node.type(Object.assign({}, node.props, { children: node.children })))
  return { type: node.type, props: node.props, children: node.children.map(draw) }
}
const walk = (node, fn) => { if (node === null || node === undefined || typeof node !== 'object') return; fn(node); for (const c of node.children) walk(c, fn) }
const textOf = (node) => { let t = ''; walk(node, (n) => { for (const c of n.children) if (typeof c === 'string') t += c + ' ' }); return t }
const all = (node, pred) => { const out = []; walk(node, (n) => { if (pred(n)) out.push(n) }); return out }
const render = (Component, props, init) => { states.length = 0; for (const s of (init || [])) states.push(s); return draw(Component(props || {})) }

// The page the bundle sees: `window.__ModuleLoader__.load` receives the definition, `fetch` answers like the host would.
let defs = []
const asked = []
const sandbox = {
  document: { documentElement: { lang: 'en' }, getElementById: () => null, createElement: () => ({ setAttribute () {}, remove () {} }), head: { appendChild () {} } },
  fetch: (url) => { asked.push(String(url)); return Promise.resolve({ json: () => Promise.resolve({ ok: true, apps: [], reglages: null }) }) },
}
sandbox.window = sandbox
sandbox.window.__ModuleLoader__ = { load: (def) => defs.push(def) }
vm.runInNewContext(source, sandbox, { filename: 'kybernos-webapp-creator/client.js' })

console.log('loading')
check('the bundle registers itself once, through the module loader', defs.length === 1 && defs[0].id === '@local/kybernos-webapp-creator/client' && typeof defs[0].factory === 'function', defs.map((d) => d.id))
const required = []
let api = null
let boot = null
try { api = defs[0].factory((name) => { required.push(name); if (name === 'react') return React; throw new Error('unexpected require: ' + name) }) } catch (e) { boot = e }
check('the factory runs when handed `require` (no « require is not defined »)', boot === null, boot === null ? undefined : String(boot.message))
if (api === null) { console.log('\n' + echecs + ' check(s) failed'); process.exit(1) }
check('it asks the loader for nothing but React', required.join() === 'react', required)
check('it names the services it needs and has an apply', Array.isArray(api.inject) && api.inject.join() === 'slots,sidebarRightTabs' && typeof api.apply === 'function')

console.log('components')
const t = api.__test
check('every name the test seam exports exists (a misspelt helper is undefined here)', ['AppsList', 'ProjectsView', 'SettingsView', 'WebappPage', 'WebappsPane', 'pills', 'kt', 'CSS'].every((k) => t[k] !== undefined), Object.keys(t).filter((k) => t[k] === undefined))
const apps = [
  { slug: 'boutique', nom: 'Boutique', stack: 'web', statut: { running: true, port: 4101 }, donnees: 'personnel' },
  { slug: 'vitrine', nom: 'Vitrine', stack: 'statique', statut: { running: false } },
]
let tree = render(t.AppsList, { apps: [], onAction () {} })
check('no app: it says so', /No webapp yet/.test(textOf(tree)), textOf(tree))
tree = render(t.AppsList, { apps, onAction () {} })
check('two apps: a card each, with Stop on the running one and Start on the other', /Boutique/.test(textOf(tree)) && /Vitrine/.test(textOf(tree)) && /Stop/.test(textOf(tree)) && /Start/.test(textOf(tree)), textOf(tree))
check('a running app with a port gets an Open link to it', all(tree, (n) => n.type === 'a' && n.props.href === 'http://127.0.0.1:4101').length === 1)
check('compact (the right pane) leaves out the data note', !/mini base data/.test(textOf(render(t.AppsList, { apps, onAction () {}, compact: true }))) && /mini base data/.test(textOf(tree)))
tree = render(t.ProjectsView, {}, [{ ok: true, apps }, null, 'a message'])
check('Projects: the apps, the refresh button and an error line', /My webapps/.test(textOf(tree)) && /Refresh/.test(textOf(tree)) && /a message/.test(textOf(tree)) && /Boutique/.test(textOf(tree)), textOf(tree))
tree = render(t.SettingsView, {}, [null, null])
check('Settings before the host answered: « Loading… » and nothing else', /Loading/.test(textOf(tree)) && all(tree, (n) => n.type === 'button').length === 0)
const reglages = { deployTarget: 'fly', linkPolicy: 'cle', sector: 'tech', quotaMediaKo: 2048, quotaProduits: 50, stripeMode: 'test' }
tree = render(t.SettingsView, {}, [reglages, null])
const pillsOn = all(tree, (n) => n.type === 'button' && n.props.className === 'kbwc-pill' && n.props['data-on'] === 'true').map((n) => textOf(n).trim())
check('Settings: four groups of pills, the current choice marked in each', pillsOn.join() === 'Fly.io,Link key,tech,Stripe test', pillsOn)
check('Settings: every sector has a pill, and there is a Save button', all(tree, (n) => n.type === 'button' && n.props.className === 'kbwc-pill').length === 3 + 2 + 10 + 2 && /Save/.test(textOf(tree)))
tree = render(t.WebappPage, {}, ['settings'])
check('the page: two tabs, and the Settings view when that tab is on', all(tree, (n) => n.props && n.props.className === 'kbwc-tab').length === 2 && /Deploy target/.test(textOf(draw(render(t.SettingsView, {}, [reglages, null])))))
tree = render(t.WebappsPane, {}, [{ ok: true, apps }])
check('the right pane: the compact list', /Boutique/.test(textOf(tree)) && all(tree, (n) => n.props && n.props['data-kb'] === 'webapps-pane').length === 1)

console.log('apply')
const effects = []
const injected = []
const registered = []
const tabTypes = []
const ctx = {
  effect: (fn, label) => { effects.push(label); const off = fn(); return off },
  slots: { inject: (slot, fn) => { injected.push(slot); return fn() }, register: (spec, component) => { registered.push({ spec, component }); return () => {} } },
  get: (name) => (name === 'sidebarRightTabs' ? { register: (def) => { tabTypes.push(def); return () => {} } } : null),
}
let applied = null
try { api.apply(ctx); applied = true } catch (e) { applied = String(e.message) }
check('apply runs against the host\'s services', applied === true, applied)
check('it injects its own page and the right-pane tab', injected.join() === 'main.kybernos-webapp-creator,sidebar.right.pane.tab', injected)
check('it registers the tab type with a title and an icon that draws', tabTypes.length === 1 && tabTypes[0].id === 'kybernos-webapp-creator' && tabTypes[0].title() === 'Webapps' && typeof tabTypes[0].guide[0].icon === 'function' && draw(React.createElement(tabTypes[0].guide[0].icon, { size: 18 })).type === 'svg')
check('the page component it registers is the real one', registered.length === 2 && registered[0].component === t.WebappPage && registered[1].component === t.WebappsPane)

if (echecs > 0) { console.log('\n' + echecs + ' check(s) failed'); process.exit(1) }
console.log('\nall checks passed')
