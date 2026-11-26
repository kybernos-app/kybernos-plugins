// The engine's own Settings pages (Agent presets, Models, Built-in plugins) say « DSH » in sentences no plugin writes: the open native page's text is reworded in what is drawn.
// A fake document stands for the page: text nodes, a section, a TreeWalker. No browser.
//   node packages/kybernos-hub/test-native-plain-words.mjs
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let failed = 0
let total = 0
const check = (name, ok, detail) => {
  total += 1
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
let def
new Function('window', SOURCE)({ __ModuleLoader__: { load: (d) => { def = d } }, __KB_LANG_RESOLVE__: () => 'en' })
const T = def.factory().__test

// text node: { nodeValue, parentElement }, element: { tag }
const el = (tag) => ({ tag, closest: (sel) => (sel.split(',').includes(tag) ? { tag } : null) })
const text = (value, tag = 'p') => ({ nodeValue: value, parentElement: el(tag) })
const docOf = (nodes, withSection = true) => ({
  querySelector: () => (withSection ? { section: true } : null),
  createTreeWalker: () => { let i = -1; return { nextNode: () => { i += 1; return i < nodes.length ? nodes[i] : null } } },
})

console.log('the words')
{
  const nodes = [
    text('Choose the agent’s tools and how it works. Use Standard mode for everyday tasks, or Creator mode to add capabilities to DSH.'),
    text('Customize DSH through conversation. Let the agent write plugins that add features or UI.'),
    text('Built into DSH’s own set'),
    text('Standard mode'),
  ]
  const n = T.plainNativeWords(docOf(nodes))
  check('the two sentences of Agent presets lose the word', n === 3 && nodes[0].nodeValue.endsWith('to add capabilities to Kybernos.') && nodes[1].nodeValue.startsWith('Customize Kybernos through conversation.'), nodes.map((x) => x.nodeValue))
  check('a possessive stays readable and a text without the word is untouched', nodes[2].nodeValue === 'Built into Kybernos’s own set' && nodes[3].nodeValue === 'Standard mode')
  check('asked again it changes nothing (the look runs at every change of the page)', T.plainNativeWords(docOf(nodes)) === 0)
}
console.log('what it must not touch')
{
  const nodes = [text('DSH_HOME=/x', 'code'), text('dsh --version', 'pre'), text('DSH stays here', 'textarea'), text('the dsh-api package'), text('DSHELL'), text('A DSH word')]
  const n = T.plainNativeWords(docOf(nodes))
  check('code, a field, another word and a lower-case package name are left as they are', n === 1 && nodes[0].nodeValue === 'DSH_HOME=/x' && nodes[1].nodeValue === 'dsh --version' && nodes[2].nodeValue === 'DSH stays here' && nodes[3].nodeValue === 'the dsh-api package' && nodes[4].nodeValue === 'DSHELL' && nodes[5].nodeValue === 'A Kybernos word', nodes.map((x) => x.nodeValue))
}
console.log('a shell that does not look like this')
{
  check('no section: nothing, no throw', T.plainNativeWords(docOf([text('DSH')], false)) === 0)
  check('a document without a tree walker, or one that throws: nothing, no throw', T.plainNativeWords({ querySelector: () => ({}) }) === 0 && T.plainNativeWords({ querySelector: () => { throw new Error('x') }, createTreeWalker: () => ({}) }) === 0)
}
console.log('the wiring')
{
  check('it runs only when a native page is open (the look found one), from the same look that draws the « ? »', /const next = findNativeHost\(document\); if \(next !== null\) plainNativeWords\(document\)/.test(SOURCE))
  check('it reads the open native section only', /const section = doc\.querySelector\(NATIVE_SEL\.section\)/.test(SOURCE))
}
console.log('\n' + (total - failed) + '/' + total + ' passed')
process.exit(failed === 0 ? 0 : 1)
