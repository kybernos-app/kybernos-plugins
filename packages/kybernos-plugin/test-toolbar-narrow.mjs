// UJ-55: the tools of a page toolbar (search, favourites, view switcher) wrap when the column is narrower than they are, so that the primary button beside them is never
// pushed out of the window: at 768 px with the sidebar open the Automations toolbar was 479 px wide in a 432 px column and « Create » was cut at the window's edge.
//   node packages/kybernos-plugin/test-toolbar-narrow.mjs
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let fails = 0
const ok = (name, cond) => { if (!cond) fails += 1; console.log((cond ? '  ✓ ' : '  ✗ ') + name) }
const rule = (sel) => { const m = src.match(new RegExp('\\n' + sel.replace(/[.]/g, '\\.') + '\\{([^}]*)\\}')); return m === null ? null : m[1] }

const tools = rule('.kb6-tb-tools')
ok('the tools group of a page toolbar is a flex row that stays on one line while the window is wide (the search field shrinks first)', tools !== null && /display:flex/.test(tools) && /flex-wrap:nowrap/.test(tools) && !/flex-wrap:wrap/.test(tools))
ok('...and wraps in a narrow window', /@media \(max-width:900px\)\{\.kb6-tb-tools\{flex-wrap:wrap/.test(src))
ok('it still sits at the end of the row and its search may shrink', tools !== null && /margin-inline-start:auto/.test(tools) && /\.kb6-tb-tools \.kb6-tb-search\{flex:0 1 280px;min-width:0/.test(src))
ok('the row that holds it wraps too (the trailing buttons drop under the tools)', /\n\.kb6-tb-row\{[^}]*flex-wrap:wrap/.test(src))

process.exit(fails === 0 ? 0 : 1)
