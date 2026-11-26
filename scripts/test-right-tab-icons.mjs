#!/usr/bin/env node
// V-25: the icons of the suite are distinct where a person looks at them side by side.
//
//   node scripts/test-right-tab-icons.mjs
//
// 1. The « Start » picker of the right sidebar drew the engine's grey cube for every tab type that gave no icon, and nine tabs of the suite
//    (Summary, Databases, Bricks, Slides, 3D modeller, Motion, Dashboard, Kaby, Agent Teams) looked the same. A guide entry takes an `icon`
//    component (the engine's own Terminal and Files tabs do): each plugin passes its own, drawn here as the engine calls it, { size, className }.
// 2. In the sidebar, Kaby and Agent Teams drew the same glyph (waypoints). Kaby is a robot head, as every icon set of kybernos-theme says.
// No browser: each plugin's `KB-TABICON` block is cut out of its client and run as it ships.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}

// the nine tabs: [plugin, file that carries the block, the file the browser loads (listed when it is built from the first one)]
const TABS = [
  ['kybernos-summary', 'client.js'], ['dsh-db-viewer', 'src/plugin.js', 'client/client.js'], ['kybernos-bricks', 'client.js'],
  ['kybernos-slides', 'src/plugin.js', 'client.js'], ['kybernos-modeleur', 'client.js'], ['kybernos-motion', 'src/plugin.js', 'client.js'],
  ['kybernos-dashboards', 'src/plugin.js', 'client.js'], ['kybernos-kyber', 'client.js'], ['kybernos-plugin', 'client.js'],
]
const block = (text) => { const a = text.indexOf('// KB-TABICON-BEGIN'); const b = text.indexOf('// KB-TABICON-END'); return a < 0 || b < a ? null : text.slice(a, b) }
// The engine calls the icon as a component; a stub React turns an element into plain data.
const React = { createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat() }) }
const render = (src, props) => vm.runInNewContext(src + '\nKB_TAB_ICON', { React })(props)

console.log('every tab of the suite gives the Start picker its own icon')
const signatures = new Map()
for (const [plugin, file, built] of TABS) {
  const text = readFileSync(join(ROOT, plugin, file), 'utf8')
  const src = block(text)
  check(plugin + ' carries its icon', src !== null)
  if (src === null) continue
  check(plugin + ': the guide entry hands it to the engine', /guide: \[\{[^\n]*icon: KB_TAB_ICON/.test(text) || /guide: \[\{\n\s+icon: KB_TAB_ICON/.test(text))
  // the build indents the factory body: compare without the indentation
  const flat = (t) => t.split('\n').map((l) => l.trim()).join('\n')
  if (built !== undefined) check(plugin + ': the built client holds the same icon (rebuild with scripts/build.mjs)', flat(readFileSync(join(ROOT, plugin, built), 'utf8')).includes(flat(src)))
  const big = render(src, { size: 26, className: 'x' })
  check(plugin + ': a 24-unit line icon at the size the engine asks, in the ink around it', big.type === 'svg' && big.props.width === 26 && big.props.height === 26 && big.props.viewBox === '0 0 24 24' && big.props.stroke === 'currentColor' && big.props.className === 'x')
  const small = render(src, undefined)
  check(plugin + ': without props it still draws (22 px)', small.props.width === 22)
  const paths = big.kids.map((k) => k.props.d)
  check(plugin + ': it has strokes', paths.length >= 3 && paths.every((d) => typeof d === 'string' && /^[Mm]/.test(d)), paths)
  signatures.set(plugin, paths.join('|'))
}
const seen = new Map()
for (const [plugin, sig] of signatures) { if (!seen.has(sig)) seen.set(sig, []); seen.get(sig).push(plugin) }
const same = [...seen.values()].filter((l) => l.length > 1)
check('no two tabs draw the same icon', signatures.size === TABS.length && same.length === 0, same)

console.log('Kaby and Agent Teams have their own glyph in the sidebar')
{
  const text = readFileSync(join(ROOT, 'kybernos-plugin', 'client.js'), 'utf8')
  const lucide = text.slice(text.indexOf('const LUCIDE = {'), text.indexOf('const Icon = (name, size)'))
  const glyph = (name) => { const m = new RegExp('\\n  ' + name + ': (\\[[^\\n]*\\]),').exec(lucide); return m === null ? null : m[1] }
  const classic = /const KB_MENU_CLASSIC = \{([^}]*)\}/.exec(text)[1]
  const def = /const KB_DEFAULT_ICON = '(\w+)'/.exec(text)[1]
  const entry = (k) => { const m = new RegExp('\\b' + k + ': (\'?\\w+\'?)').exec(classic); return m === null ? null : m[1].replace(/'/g, '').replace('KB_DEFAULT_ICON', def) }
  check('the row of Kaby and the row of Agent Teams use different line icons', entry('kyber') !== null && entry('teams') !== null && entry('kyber') !== entry('teams'), [entry('kyber'), entry('teams')])
  check('both are drawn (not a name the icon table does not know)', glyph(entry('kyber')) !== null && glyph(entry('teams')) !== null && glyph(entry('kyber')) !== glyph(entry('teams')))
  check('the Kaby row draws its classic icon', /row\('kyber', Icon\('bot', 15\)/.test(text))
  // the nine rows of the sidebar are distinct among themselves in the classic set too
  const values = [...classic.matchAll(/(\w+): ('?\w+'?)/g)].map((m) => m[2].replace(/'/g, '').replace('KB_DEFAULT_ICON', def))
  check('the nine classic menu icons are all different', values.length === 9 && new Set(values).size === 9, values)
}

console.log(failed === 0 ? '\nOK' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
