// The menu draws its entries through the icon-set registry of kybernos-theme (window.__KB_ICONSETS__),
// and keeps its own line icons when there is none. The ONE table of the fixed rows (`<kb-menu-entries>` in client.js) is cut out and run alone;
// the menu itself (a React component) is checked at source level.
import { existsSync, readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let fail = 0
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : ' — ' + JSON.stringify(detail)))
  if (!cond) fail += 1
}

const a = SRC.indexOf('// <kb-menu-entries>')
const b = SRC.indexOf('// </kb-menu-entries>', a)
if (a < 0 || b < a) { console.log('  ✗ cannot cut the menu entry table out of client.js'); process.exit(1) }
const T = new Function('KB_DEFAULT_ICON', SRC.slice(a, b) + '\nreturn { KB_MENU_FIXED, kbMenuFixed, kbMenuClassicOf }')('waypoints')
const entry = {}
for (const d of T.KB_MENU_FIXED) if (d.icon !== null) entry[d.id] = d.icon
const classic = {}
for (const d of T.KB_MENU_FIXED) if (d.icon !== null) classic[d.icon] = d.classic

ok('the one table holds the nine fixed rows, eight of them with an icon-set entry (all different)', T.KB_MENU_FIXED.length === 9 && Object.keys(entry).length === 8 && new Set(Object.values(entry)).size === 8, entry)
ok('the old two tables are gone (one registry, not two)', !/const KB_MENU_ENTRY\b/.test(SRC) && !/const KB_MENU_CLASSIC\b/.test(SRC))
const built = SRC.slice(SRC.indexOf('const built = {'), SRC.indexOf('const rowsShown = '))
// Every row of the table is drawn by the menu from its line of the table (the icon, the name key): no second list of rows to keep in step.
ok('every row of the table is built by the menu through `rowOf`, which reads the line icon from the table', T.KB_MENU_FIXED.every((d) => new RegExp("\\b" + d.id + ": \\(\\) => rowOf\\('" + d.id + "'").test(built)) && /const rowOf = \(id, badge, active, onClick, extra\) => row\(id, Icon\(kbMenuFixed\(id\)\.classic, 15\)/.test(SRC), T.KB_MENU_FIXED.map((d) => d.id))
ok('the rows that are not in the icon-set table are the ones with no entry (documents)', T.KB_MENU_FIXED.filter((d) => d.icon === null).every((d) => d.id === 'documents'), T.KB_MENU_FIXED.filter((d) => d.icon === null).map((d) => d.id))
ok('the row helper draws its icon through the registry (but for Kaby\'s own portrait)', /: kbMenuIcon\(id, ico, active === true\)/.test(SRC) && /h\('span', \{ className: 'kb4-ico' \}, iconNode\)/.test(SRC))
ok('without a registry (or with the classic set) the line icon is returned as it was', /return fallback\n\}/.test(SRC) && /typeof svg === 'string'/.test(SRC))
ok('the menu redraws when the set changes', /addEventListener\('kb-icons-change'/.test(SRC) && /removeEventListener\('kb-icons-change'/.test(SRC))
const lucideKeys = new Set([...SRC.slice(SRC.indexOf('const LUCIDE = {'), SRC.indexOf('const Icon = (name, size)')).matchAll(/^  (\w+): \[/gm)].map((m) => m[1]))
ok('the classic preview lent to the theme page only names line icons that exist', Object.values(classic).every((n) => lucideKeys.has(n)), { classic, missing: Object.values(classic).filter((n) => !lucideKeys.has(n)) })
ok('the classic preview answers for every icon-set entry and for no other (the Theme page\'s old `ws` entry is gone)', Object.keys(entry).every((k) => T.kbMenuClassicOf(entry[k]) !== null) && T.kbMenuClassicOf('nothing') === null && T.kbMenuClassicOf('__proto__') === null && T.kbMenuClassicOf('ws') === null)
ok('the classic preview is lent on window', /window\.__KB_MENU_CLASSIC__ = /.test(SRC))
ok('the icon colour at rest is a text token, not a literal', /\.kb4-isvg\{[^}]*color:var\(--dsw-alias-label-secondary\)/.test(SRC))

// Same entries as the theme plugin draws (only checked when the sibling is there: a bundle's tests may run alone).
const themePath = new URL('../kybernos-theme/client.js', import.meta.url)
if (existsSync(themePath)) {
  const Th = readFileSync(themePath, 'utf8')
  const list = /const ICON_ENTRIES = \[([^\]]*)\]/.exec(Th)
  const drawn = list === null ? [] : [...list[1].matchAll(/'(\w+)'/g)].map((m) => m[1])
  // The registry's eight entries are exactly the ones the Theme page draws (its old `ws` entry, which had no row, is gone).
  ok('the menu table and the theme plugin\'s drawings use the same entries ', Object.values(entry).every((e) => drawn.indexOf(e) >= 0) && drawn.every((e) => Object.values(entry).indexOf(e) >= 0), { drawn, menu: Object.values(entry) })
}

console.log(fail === 0 ? '\n✓ menu icons OK' : '\n✗ ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
