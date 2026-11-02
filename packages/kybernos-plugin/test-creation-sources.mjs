// Creations lists what a plugin keeps that is not a file (the Dashboards, the Apps): the registry plugins declare a source in, the page that draws a tile and one card
// per item, and the menu rows the sources stand in for. The registry rules are the real ones (the block of client.js evaluated on its own); the page and the menu, which
// need a browser, are pinned at source level and checked on the real GUI (scripts/check-creation-sources-live.mjs).
//   node packages/kybernos-plugin/test-creation-sources.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCreationSources } from './lib-creation-sources-test.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)))
  if (!ok) failed += 1
}
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const good = (over) => Object.assign({ id: 'dashboards', label: { en: 'Dashboards', fr: 'Dashboards' }, desc: { en: 'Boards.' }, art: 'dashboard', order: 10, foldsRow: 'dashboards', load: async () => [], open: () => {}, home: () => {} }, over || {})

console.log('the registry takes a source and gives it back')
{
  const L = loadCreationSources()
  check('it is published on the window as a versioned facade', L.win.__KB_CREATIONS__ === L.registry && L.registry.v === 1)
  let tick = 0
  const stop = L.registry.subscribe(() => { tick += 1 })
  const off = L.registry.register(good())
  check('a valid source is declared: listed, known by id, redraws the listeners and the window event', typeof off === 'function' && L.registry.list().length === 1 && L.registry.has('dashboards') && tick === 1 && L.win.dispatched === 1)
  check('it says which menu row it stands in for', L.registry.folds('dashboards') === true && L.registry.folds('tables') === false)
  check('what it keeps is frozen (the page cannot be changed from outside)', Object.isFrozen(L.registry.list()[0]) && Object.isFrozen(L.registry.list()[0].label))
  off()
  check('taking it back removes it, and its row comes back', L.registry.list().length === 0 && L.registry.folds('dashboards') === false && tick === 2)
  off()
  check('taking it back twice changes nothing', tick === 2)
  stop()
  const order = L.registry.register(good({ id: 'apps', order: 20, foldsRow: 'tables' })) && L.registry.register(good({ id: 'dashboards', order: 10 }))
  check('the sources are sorted by their order, then by arrival', typeof order === 'function' && L.registry.list().map((x) => x.id).join() === 'dashboards,apps')
}

console.log('the registry refuses what it cannot draw (and says why, without throwing)')
{
  const L = loadCreationSources()
  const why = (e) => L.check(e).errors || []
  check('a source is an object', L.check(null).ok === false && L.check([]).ok === false && L.check('x').ok === false)
  check('an id of a type of the core is refused (it would take the tile of Slides or Mini-app)', why(good({ id: 'slides' })).some((m) => /type of the core/.test(m)) && why(good({ id: 'miniapp' })).some((m) => /type of the core/.test(m)))
  check('a badly written id is refused', why(good({ id: 'A b' })).length > 0 && why(good({ id: 'x' })).length > 0)
  check('an unknown key is refused', why(good({ colour: 'red' })).some((m) => /unknown key/.test(m)))
  check('the English words are needed, no markup, a language that is not one is refused', why(good({ label: { fr: 'Tableaux' } })).length > 0 && why(good({ label: { en: '<b>x</b>' } })).length > 0 && why(good({ label: { en: 'X', de: 'Y' } })).length > 0)
  check('a drawing the tiles do not have is refused', why(good({ art: 'nope' })).some((m) => /art/.test(m)))
  check('load and open are required, home is optional but must be a function', why(good({ load: undefined })).length > 0 && why(good({ open: 'x' })).length > 0 && L.check(good({ home: undefined })).ok === true && why(good({ home: 3 })).length > 0)
  check('the order is a number', why(good({ order: 'first' })).length > 0 && why(good({ order: 5000 })).length > 0)
  check('foldsRow, when given, names a row', why(good({ foldsRow: 'No Row' })).length > 0)
  const before = L.warnings.length
  check('register gives null for a refused entry and writes one warning', L.registry.register(good({ id: 'slides' })) === null && L.warnings.length === before + 1 && L.registry.list().length === 0)
  L.registry.register(good({ id: 'one', foldsRow: null }))
  check('the same id twice is refused', why(good({ id: 'one' })).some((m) => /already a source/.test(m)))
  for (const id of ['two', 'three', 'four', 'five', 'six']) L.registry.register(good({ id, foldsRow: null }))
  check('at most six sources', L.registry.list().length === 6 && why(good({ id: 'seven' })).some((m) => /at most 6/.test(m)))
}

console.log('the items a source gives')
{
  const L = loadCreationSources()
  const got = L.items([{ id: 'a', title: 'Shop', sub: 'x', mtimeMs: 5 }, { id: 7, title: 'Seven' }, { id: 'b' }, { title: 'No id' }, null, 'x', { id: 'c', title: '' }, { id: 'd', title: 'D', sub: 3, mtimeMs: 'now' }])
  check('only items with an id and a title are kept, ids are strings, a missing sub is empty and a missing date is null', got.map((x) => x.id).join() === 'a,7,d' && got[1].sub === '' && got[1].mtimeMs === null && got[2].sub === '' && got[2].mtimeMs === null, got)
  check('anything that is not a list gives no item', L.items(null).length === 0 && L.items({}).length === 0 && L.items(undefined).length === 0)
  check('200 items at most, titles cut at 120', L.items(Array.from({ length: 300 }, (_, i) => ({ id: String(i), title: 'T' }))).length === 200 && L.items([{ id: 'x', title: 'y'.repeat(500) }])[0].title.length === 120)
  check('the words of a source follow the language, else the English', L.word({ en: 'Apps', fr: 'Apps FR' }, 'fr') === 'Apps FR' && L.word({ en: 'Apps' }, 'ar') === 'Apps' && L.word(null, 'en') === '')
}

console.log('an item is a card or a row, and it opens the item')
{
  const L = loadCreationSources()
  const opened = []
  const sx = Object.freeze(good({ open: (it) => opened.push(it.id) }))
  const it = { id: 'd1', title: 'Shop overview', sub: 'Revenue · 10 widgets', mtimeMs: 1 }
  const card = L.Item({ sx, it, list: false, appear: ' kb-in' })
  const find = (n, pred) => (n && typeof n === 'object' ? (pred(n) ? [n] : [].concat(...(n.kids || []).map((k) => find(k, pred)))) : [])
  check('the grid draws a card with the file card’s own classes', card.props.className === 'kb6-card kb-in' && card.props['data-kb'] === 'src-card' && find(card, (n) => n.props && n.props.className === 'kbg-name').length === 1)
  check('it shows the name, what the source calls it, the line under it and its age', find(card, (n) => n.kids && n.kids.indexOf('Shop overview') >= 0).length === 1 && find(card, (n) => n.kids && n.kids.indexOf('Dashboards') >= 0).length === 1 && find(card, (n) => n.kids && n.kids.indexOf('Revenue · 10 widgets') >= 0).length === 1 && find(card, (n) => n.kids && n.kids.indexOf('2 min ago') >= 0).length === 1)
  const prev = find(card, (n) => n.props && n.props['data-kb'] === 'src-prev')[0]
  prev.props.onClick()
  check('a click on the body opens the item', opened.join() === 'd1')
  let prevented = 0
  prev.props.onKeyDown({ target: 1, currentTarget: 1, key: 'Enter', preventDefault: () => { prevented += 1 } })
  prev.props.onKeyDown({ target: 1, currentTarget: 1, key: 'Tab', preventDefault: () => { prevented += 1 } })
  check('Enter opens it too (and Tab does not)', opened.join() === 'd1,d1' && prevented === 1)
  const row = L.Item({ sx, it, list: true })
  row.props.onClick()
  check('the list draws a row that opens the item', row.props['data-kb'] === 'src-row' && row.props.role === 'button' && opened.length === 3)
  const broken = L.Item({ sx: Object.freeze(good({ open: () => { throw new Error('page gone') } })), it, list: true })
  let threw = false
  try { broken.props.onClick() } catch (e) { threw = true }
  check('a source whose page cannot be opened does not break the page', threw === false)
  const bare = L.Item({ sx, it: { id: 'x', title: 'Bare', sub: '', mtimeMs: null }, list: false })
  check('an item with no line and no date draws neither', find(bare, (n) => n.props && (n.props.className === 'kb-src-sub' || n.props.className === 'kb-src-when')).length === 0)
}

console.log('the Creations page and the menu')
{
  const page = src.slice(src.indexOf('const ArtifactsPage = () => {'), src.indexOf('const KB_CP = (() =>'))
  check('the page reads the sources, loads them when it opens and when one appears, and keeps a failure to an empty list', /kbCreationSources\.subscribe\(\(\) => srcTick\[1\]/.test(page) && /Promise\.resolve\(p\)\.then\(\(list\) => \{ if \(dead === false\) srcItemsPair\[1\]/.test(page) && /\.catch\(\(\) => \{ if \(dead === false\) srcItemsPair\[1\]\(\(old\) => Object\.assign\(\{\}, old, \{ \[sx\.id\]: \[\] \}\)\)/.test(page) && /\}, \[srcKey\]\)/.test(page))
  check('the hooks sit above every early return of the page', page.indexOf('kbCreationSources.subscribe') < page.indexOf('const openPair = React.useState(null)') && page.indexOf('kbCreationSources.subscribe') < page.indexOf('if (openPath !== null && openPath !== undefined && real.length > 0) return'))
  check('a source is a tile of the row, selectable like a type, and shown by default', /\.concat\(srcIds\)/.test(page) && /\.concat\(sources\.map\(\(sx\) => \(\{ kind: 'source', id: sx\.id/.test(page) && /srcIds\.indexOf\(id\) >= 0\)/.test(page))
  check('its items show only when its tile is selected, follow the search and the period, and leave out the favourites filter', /const srcOn = sources\.filter\(\(sx\) => selTypes\.indexOf\(sx\.id\) >= 0\)/.test(page) && /\.filter\(\(c\) => tbArts\[0\]\.fav !== true\)/.test(page) && /kbArtInPeriod\(c\.it\.mtimeMs, tbArts\[0\]\.period, nowMs\)/.test(page))
  check('the way into the plugin’s page is always there when a source is selected, even with no item', /srcOn\.filter\(\(sx\) => sx\.home !== null\)\.map/.test(page) && /'data-kb': 'src-home'/.test(page) && /'deliv\.src\.open': \{ kybernos: 'Ouvrir la page \{name\}', en: 'Open the \{name\} page' \}/.test(src))
  check('the list view and the grid both draw the items; the « no creation » line waits for them', /vp\.mode === 'list'\s*\? h\('div', \{ className: 'kb6-lrows', 'data-kb': 'src-list' \}/.test(page) && /shown\.length === 0 && srcShown\.length === 0/.test(page))
  check('the toolbar counts them', /typed\.length \+ srcAll\.length/.test(page) && /sorted\.length \+ srcShown\.length/.test(page))
  check('selecting one source says what it is under the tiles', /const selS = sources\.filter\(\(sx\) => sx\.id === filter\)\[0\] \|\| null/.test(page))
  const menu = src.slice(src.indexOf('const SalesMenu = (p0) => {'), src.indexOf('const SidebarUtils = () => {'))
  check('the Dashboards row leaves the menu while its source is declared, and the menu redraws when one comes or goes', /KB_DB === true && kbCreationSources\.folds\('dashboards'\) !== true \? row\('dashboards'/.test(menu) && /React\.useEffect\(\(\) => kbCreationSources\.subscribe\(\(\) => icoSetter/.test(menu))
  check('the declared business rows do the same (Apps: row « tables »)', /kbBizMenu\.list\(\)\.filter\(\(r\) => kbCreationSources\.folds\(r\.id\) !== true\)/.test(src))
  check('Creations carries the states of the rows it took over, and is selected while one of their pages is open', /kbCreationSources\.list\(\)\.filter\(\(sx\) => sx\.foldsRow !== null\)\.map\(\(sx\) => h\(KbRowState, \{ key: sx\.id, k: sx\.foldsRow \}\)\)/.test(menu) && /kbCreationSources\.folds\(shown\) === true/.test(menu))
  check('no source id collides with a type of the core', !/\bid: 'dashboards'/.test(src.slice(src.indexOf('const KB_ART_TYPES = ['), src.indexOf('const KB_ART_TYPES = [') + 4000)) && !/\bid: 'apps'/.test(src.slice(src.indexOf('const KB_ART_FAMILIES = ['), src.indexOf('const KB_ART_FAMILIES = [') + 2000)))
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
