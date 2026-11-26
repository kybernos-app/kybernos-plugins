// The saved state of the unified toolbar (localStorage `kybernos.toolbar.<page>`): what is read back must be what was written.
// Regression: the Creations page saves which filter tiles are HIDDEN as `vis` + `visMode: 'hidden'`; the reader kept `vis` and dropped `visMode`, so the list
// was read back as an old « shown » list and the choice came back inverted after a reload.
// It extracts kbTbSanitize from client.js (a browser bundle with no exports).
// Usage: node packages/kybernos-plugin/test-toolbar-state.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
const from = src.indexOf('const kbTbSanitize = (raw, sorts) => {')
const to = src.indexOf('const useToolbarState = (pageId, defaults) => {')
if (from < 0 || to < from) { console.error('kbTbSanitize not found in client.js'); process.exit(1) }
const m = await import('data:text/javascript,' + encodeURIComponent(src.slice(from, to) + '\nexport { kbTbSanitize }'))

let fails = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}
const roundTrip = (state) => m.kbTbSanitize(JSON.parse(JSON.stringify(state)), [])

eq('the hidden tiles and their mode survive a reload', roundTrip({ query: '', sort: 'modified', dir: 'desc', types: [], period: 'all', fav: false, viewMode: 'cards', vis: ['fam-doc', 'miniapp'], visMode: 'hidden' }),
  { query: '', sort: 'modified', dir: 'desc', types: [], period: 'all', fav: false, viewMode: 'cards', vis: ['fam-doc', 'miniapp'], visMode: 'hidden' })
eq('an old « shown » list (no mode) stays without a mode, so the page can convert it', roundTrip({ vis: ['html', 'quiz'] }), { vis: ['html', 'quiz'] })
eq('a mode with no list is nothing (the page reads « default »)', roundTrip({ visMode: 'hidden' }), {})
eq('a mode other than « hidden » is not kept', roundTrip({ vis: ['a'], visMode: 'shown' }), { vis: ['a'] })
eq('an empty hidden list is a real choice (every tile shown) and is kept', roundTrip({ vis: [], visMode: 'hidden' }), { vis: [], visMode: 'hidden' })
eq('junk in the list is dropped, the list is bounded', roundTrip({ vis: ['a', 5, null, 'b'], visMode: 'hidden' }), { vis: ['a', 'b'], visMode: 'hidden' })
eq('the other fields still read back (search, sort, direction, types, period, favourites, view)', roundTrip({ query: 'q', sort: 'name', dir: 'asc', dirTouched: true, types: ['html'], period: '7', fav: true, viewMode: 'list' }),
  { query: 'q', sort: 'name', dir: 'asc', dirTouched: true, types: ['html'], period: '7', fav: true, viewMode: 'list' })

if (fails > 0) { console.log('\n' + fails + ' FAILED'); process.exit(1) }
console.log('\nALL PASS')
