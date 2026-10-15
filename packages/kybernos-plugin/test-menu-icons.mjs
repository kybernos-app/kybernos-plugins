// The menu draws its entries through the icon-set registry of kybernos-theme (window.__KB_ICONSETS__),
// and keeps its own line icons when there is none. Static checks on client.js (the menu is a React component).
import { existsSync, readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let fail = 0
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : ' — ' + JSON.stringify(detail)))
  if (!cond) fail += 1
}

const mapSrc = /const KB_MENU_ENTRY = \{([^}]*)\}/.exec(SRC)
const entry = {}
if (mapSrc !== null) for (const m of mapSrc[1].matchAll(/(\w+): '(\w+)'/g)) entry[m[1]] = m[2]
const classicSrc = /const KB_MENU_CLASSIC = \{([^}]*)\}/.exec(SRC)
const classic = {}
if (classicSrc !== null) for (const m of classicSrc[1].matchAll(/(\w+): ('?[\w]+'?)/g)) classic[m[1]] = m[2].replace(/'/g, '')

ok('the row key → icon entry table exists with the nine entries', Object.keys(entry).length === 9 && new Set(Object.values(entry)).size === 9, entry)
const rowIds = [...SRC.matchAll(/\brow\('(\w+)', Icon\(/g)].map((m) => m[1])
ok('every menu row that has an icon-set entry is in the table', Object.keys(entry).every((k) => rowIds.indexOf(k) >= 0), { rows: rowIds, table: Object.keys(entry) })
ok('the rows that are not in the table are the ones with no entry (documents)', rowIds.filter((r) => entry[r] === undefined).every((r) => r === 'documents'), rowIds.filter((r) => entry[r] === undefined))
ok('the row helper draws its icon through the registry', /h\('span', \{ className: 'kb4-ico' \}, kbMenuIcon\(id, ico, active === true\)\)/.test(SRC))
ok('without a registry (or with the classic set) the line icon is returned as it was', /return fallback\n\}/.test(SRC) && /typeof svg === 'string'/.test(SRC))
ok('the menu redraws when the set changes', /addEventListener\('kb-icons-change'/.test(SRC) && /removeEventListener\('kb-icons-change'/.test(SRC))
const lucideKeys = new Set([...SRC.slice(SRC.indexOf('const LUCIDE = {'), SRC.indexOf('const Icon = (name, size)')).matchAll(/^  (\w+): \[/gm)].map((m) => m[1]))
ok('the classic preview lent to the theme page only names line icons that exist', Object.values(classic).every((n) => lucideKeys.has(n) || n === 'KB_DEFAULT_ICON'), { classic, missing: Object.values(classic).filter((n) => !lucideKeys.has(n) && n !== 'KB_DEFAULT_ICON') })
ok('the classic preview is lent on window', /window\.__KB_MENU_CLASSIC__ = /.test(SRC))
ok('the icon colour at rest is a text token, not a literal', /\.kb4-isvg\{[^}]*color:var\(--dsw-alias-label-secondary\)/.test(SRC))

// Same entries as the theme plugin draws (only checked when the sibling is there: a bundle's tests may run alone).
const themePath = new URL('../kybernos-theme/client.js', import.meta.url)
if (existsSync(themePath)) {
  const T = readFileSync(themePath, 'utf8')
  const list = /const ICON_ENTRIES = \[([^\]]*)\]/.exec(T)
  const drawn = list === null ? [] : [...list[1].matchAll(/'(\w+)'/g)].map((m) => m[1])
  ok('the menu table and the theme plugin\'s drawings use the same nine entries', drawn.slice().sort().join() === Object.values(entry).sort().join(), { drawn, menu: Object.values(entry) })
}

console.log(fail === 0 ? '\n✓ menu icons OK' : '\n✗ ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
