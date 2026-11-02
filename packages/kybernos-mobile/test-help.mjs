// kybernos-mobile, the « ? How it works » help of the phone link: what the card says (help.json) and where the button is.
// The card must tell a person who is not a developer three things: the phone opens a web app that talks to the computer through a
// relay that reads nothing (end-to-end encryption), the computer must be switched on and online, and nothing about plans (the link is
// open to every account, and it is not « direct »). The shape (limits, both languages) is checked by scripts/build-catalog.mjs.
//   node packages/kybernos-mobile/test-help.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const HERE = fileURLToPath(new URL('.', import.meta.url))
const SOURCE = readFileSync(join(HERE, 'client.js'), 'utf8')
const help = JSON.parse(readFileSync(join(HERE, 'help.json'), 'utf8'))

console.log('what the card says')
{
  const text = (lang) => [help.what[lang]].concat(help.steps.map((s) => s[lang])).concat([help.where[lang]]).concat(help.good ? [help.good[lang]] : []).join('\n')
  const fr = text('fr')
  const en = text('en')
  check('it says the phone opens a web app that talks to the computer', /application web/i.test(help.what.fr) && /web app/i.test(help.what.en), help.what)
  check('it says the messages go through a relay that reads nothing', /relais/i.test(fr) && /relay/i.test(en))
  check('and that the link is end-to-end encrypted', /bout en bout/i.test(fr) && /end-to-end/i.test(en))
  check('it says the relay cannot read what it carries', /ne lit rien|sans pouvoir les lire|ne peut pas les lire/i.test(fr) && /reads nothing|cannot read/i.test(en))
  check('it says the computer must be switched on', /allumé/i.test(fr) && /switched on/i.test(en))
  check('and connected to the internet', /internet/i.test(fr) && /internet/i.test(en))
  check('it does not call the link direct (it goes through the Kybernos relay)', !/direct|en direct/i.test(fr) && !/direct/i.test(en))
  check('it does not say it is reserved to paid plans (the link is open to every account)', !/payant|offre|abonnement|réservé/i.test(fr) && !/\b(paid|plans?|subscription|reserved)\b/i.test(en))
  check('it gives a place to find it', typeof help.where.fr === 'string' && help.where.page === true)
}

console.log('where the button is')
{
  const guarded = "typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-mobile' }) : null"
  check('the help button is always asked behind a guard, for the bundle’s own help', SOURCE.includes(guarded))

  // The panel the sidebar's phone button opens (« Connect a phone »), rendered on a fake React that only builds a tree.
  const Help = function Help () { return null }
  const run = ({ withHelp }) => {
    const fakeReact = {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
      useRef: (v) => ({ current: v }),
      useEffect: () => {},
      useCallback: (f) => f,
    }
    let def = null
    const win = { __ModuleLoader__: { load: (d) => { def = d } }, matchMedia: () => ({ matches: false }), __KB_LANG_RESOLVE__: () => 'en' }
    if (withHelp) win.__KB_HELP__ = { version: 1, Help }
    const doc = {
      body: {}, head: { appendChild: (c) => c }, baseURI: 'http://127.0.0.1:3080/',
      createElement: () => ({ dataset: {}, remove () {} }), addEventListener () {}, removeEventListener () {},
    }
    globalThis.window = win
    globalThis.document = doc
    new Function('window', 'document', SOURCE)(win, doc)
    const plugin = def.factory((name) => (name === 'react' ? fakeReact : undefined))
    // Only the phone link's own effects run: the layout is not what is tested here.
    plugin.apply({ effect: (fn, label) => (/phone panel|styles|settings section/.test(String(label)) ? fn() : () => {}), inject: (names, cb) => cb({ slots: null }) })
    const Panel = win.__KB_MOBILE__ !== undefined ? win.__KB_MOBILE__.Panel : undefined
    return { tree: typeof Panel === 'function' ? Panel({ web: '', onManage: () => {} }) : null, Panel }
  }
  // Walks the tree the fake React built, running the small function components on the way (the title row's button is one);
  // the body of the panel (network, timers) is left as an element.
  const find = (node, test, out = []) => {
    if (node === null || typeof node !== 'object') return out
    if (test(node)) out.push(node)
    let kids = node.children || []
    if (typeof node.type === 'function' && node.type !== Help && node.type.name !== 'Body') kids = [node.type(node.props)]
    for (const c of kids) find(c, test, out)
    return out
  }
  const withHelp = run({ withHelp: true })
  const title = withHelp.tree === null ? [] : find(withHelp.tree, (n) => n.props && n.props.className === 'kbf-poptitle')
  const buttons = withHelp.tree === null ? [] : find(withHelp.tree, (n) => n.type === Help)
  check('the « Connect a phone » panel is published', typeof withHelp.Panel === 'function')
  check('the panel keeps its title', title.length === 1 && /Connect a phone/.test(JSON.stringify(title[0])), title.length)
  check('the panel carries one « ? How it works » button, for this bundle’s help', buttons.length === 1 && buttons[0].props.id === 'kybernos-mobile', buttons.map((b) => b.props))
  const without = run({ withHelp: false })
  const none = without.tree === null ? [] : find(without.tree, (n) => n.type === Help)
  check('without the Suite there is no button and the panel still draws', without.tree !== null && none.length === 0 && find(without.tree, (n) => n.props && n.props.className === 'kbf-poptitle').length === 1)
}

console.log('the animated help of the Settings page (V-05, V-36)')
{
  // The Settings page, rendered on the same fake React: the Suite's Help and Intro are stand-ins that only record what the page asks for.
  const Help = function Help () { return null }
  const Intro = function Intro () { return null }
  const draw = ({ lang, hub }) => {
    const fakeReact = {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
      useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useCallback: (f) => f,
    }
    let def = null
    const win = { __ModuleLoader__: { load: (d) => { def = d } }, matchMedia: () => ({ matches: false }), __KB_LANG_RESOLVE__: () => lang }
    if (hub !== undefined) win.__KB_HELP__ = hub
    globalThis.window = win
    globalThis.document = { body: {}, head: { appendChild: (c) => c }, baseURI: 'http://127.0.0.1:3080/', createElement: () => ({ dataset: {}, remove () {} }), addEventListener () {}, removeEventListener () {} }
    new Function('window', 'document', SOURCE)(win, globalThis.document)
    const plugin = def.factory((name) => (name === 'react' ? fakeReact : undefined))
    let page = null
    const slots = { inject: (name, make) => { if (name === 'settings.section') make() }, register: (d, comp) => { if (d.id === 'kybernos-mobile') page = comp; return () => {} } }
    plugin.apply({ effect: (fn, label) => (/settings section|phone panel/.test(String(label)) ? fn() : () => {}), inject: (names, cb) => cb({ slots }) })
    if (page === null) return null
    const el = page()
    return typeof el.type === 'function' ? el.type(el.props) : el
  }
  const find = (node, test, out = []) => {
    if (node === null || typeof node !== 'object') return out
    if (test(node)) out.push(node)
    for (const c of node.children || []) find(c, test, out)
    return out
  }
  const text = (n) => (n === null || typeof n !== 'object' ? String(n) : (n.children || []).map(text).join(' '))
  const tree = draw({ lang: 'en', hub: { version: 1, actions: true, Help, Intro } })
  const intros = tree === null ? [] : find(tree, (n) => n.type === Intro)
  const p = intros.length === 1 ? intros[0].props : null
  check('the Settings page is drawn', tree !== null)
  check('it asks the Suite for the animation, keyed by its own bundle', p !== null && p.id === 'kybernos-mobile', intros.length)
  check('three steps that say show the code, scan it, allow', p !== null && p.steps.length === 3 && /code/i.test(p.steps[0].t) && /scan/i.test(p.steps[1].t) && /allow/i.test(p.steps[2].t), p && p.steps.map((s) => s.t))
  check('every step has a sentence', p !== null && p.steps.every((s) => s.b.length > 20))
  check('the mock names the page, the phone, its three states and three labels', p !== null && p.mock.bar === 'Remote Control' && p.mock.hot.length > 2 && p.mock.states.length === 3 && p.mock.actions.length === 3 && p.mock.actions[2] === 'Allow', p && p.mock)
  check('it sits after the title row and before the body', (() => { const order = find(tree, (n) => n.type === Intro || (n.props && (n.props.className === 'kbmr-head' || n.type !== 'div' && typeof n.type === 'function' && n.type.name === 'Body'))).map((n) => (n.type === Intro ? 'intro' : n.props.className === 'kbmr-head' ? 'head' : 'body')); return order.join() === 'head,intro,body' })())
  check('the title row still carries one « ? How it works » button, for this bundle', find(tree, (n) => n.type === Help).length === 1 && find(tree, (n) => n.type === Help)[0].props.id === 'kybernos-mobile')
  const fr = draw({ lang: 'kybernos', hub: { version: 1, Help, Intro } })
  const q = fr === null ? null : find(fr, (n) => n.type === Intro)[0]
  check('in French: the same animation, in French', q !== undefined && q !== null && /code/i.test(q.props.steps[0].t) && /Autoriser/.test(q.props.mock.actions[2]) && q.props.title !== p.title, q && q.props.title)
  const older = draw({ lang: 'en', hub: { version: 1, Help } })
  check('an older Suite without the animation: the page draws, with its button and no animation', older !== null && find(older, (n) => n.type === Intro).length === 0 && find(older, (n) => n.type === Help).length === 1)
  const none = draw({ lang: 'en' })
  check('no Suite at all: the page draws with neither', none !== null && find(none, (n) => n.type === Intro || n.type === Help).length === 0)
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
