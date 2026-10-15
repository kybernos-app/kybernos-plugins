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

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
