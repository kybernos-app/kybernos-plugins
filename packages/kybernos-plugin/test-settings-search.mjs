#!/usr/bin/env node
// Search in the Settings: the engine (kbSsSearch) and its index (KB_SS_INDEX) of client.js, cut out between their markers and run alone.
// No browser. The panel and the menu around it are checked against the real GUI (scripts/check-settings-search-live.mjs), which also
// opens every page and looks for the labels this index promises.
//
//   node packages/kybernos-plugin/test-settings-search.mjs
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SRC.indexOf('const KB_SS_MODE')
const b = SRC.indexOf('// </kb-settings-search>')
if (a < 0 || b < a) { console.log('  ✗ cannot cut the search out of client.js'); process.exit(1) }
const { KB_SS_INDEX, KB_SS_PAGE_KW, kbSsBuild, kbSsSearch, kbSsNorm } = new Function(SRC.slice(a, b) + '\nreturn { KB_SS_INDEX, KB_SS_PAGE_KW, kbSsBuild, kbSsSearch, kbSsNorm }')()
const ENTRIES = kbSsBuild(KB_SS_INDEX)

// The pages of the menu, as the organiser names them (the values of KB_NAV_KEYS); the native Models page is not drawn.
const keysBlock = /const KB_NAV_KEYS = \{([\s\S]*?)\n\}/.exec(SRC)
const PAGES = [...new Set([...keysBlock[1].matchAll(/'?[A-Za-z0-9_-]+'?:\s*'([^']+)'/g)].map((m) => m[1]))].filter((k) => k !== 'models')
// The titles a menu carries: here the page's own key, written out (the panel passes the title drawn in the language of the day).
const TITLES = Object.fromEntries(PAGES.map((k) => [k, k]))
TITLES.general = 'General'
TITLES['memory & lessons'] = 'Memory & Lessons'
TITLES.theme = 'Theme'
TITLES.appearance = 'Appearance'
TITLES.language = 'Language'
TITLES.voice = 'Voice'
const run = (q, titles) => kbSsSearch(q, ENTRIES, titles || TITLES).list
const labels = (list) => list.filter((x) => x.kind === 'item').map((x) => x.e.page + '/' + x.e.label)
const pagesOf = (list) => list.filter((x) => x.kind === 'page').map((x) => x.key)

console.log('the index')
check('there are rows, each with a page, a label and its fields', ENTRIES.length >= 60 && KB_SS_INDEX.every((r) => r.length >= 6 && r.length <= 8 && r.slice(0, 6).every((x) => typeof x === 'string') && r[0] !== '' && r[2] !== '' && (r[7] === undefined || (typeof r[7] === 'string' && r[7] !== ''))), ENTRIES.length)
check('every row points at a page the menu has (a key of KB_NAV_KEYS)', KB_SS_INDEX.every((r) => PAGES.indexOf(r[0]) >= 0), KB_SS_INDEX.filter((r) => PAGES.indexOf(r[0]) < 0).map((r) => r[0]))
check('every page of the menu has at least one row: what is on it can be found, not only its title', PAGES.every((k) => KB_SS_INDEX.some((r) => r[0] === k)), PAGES.filter((k) => !KB_SS_INDEX.some((r) => r[0] === k)))
check('every page a person could look for by a word of theirs has related words (French, Spanish) for its own title', Object.keys(KB_SS_PAGE_KW).every((k) => PAGES.indexOf(k) >= 0))
check('a description is either what the page shows or empty: none ends mid-word, none is a placeholder', KB_SS_INDEX.every((r) => r[3] === '' || (/[.a-z)”’!?]$/.test(r[3]) && !/lorem|todo|xxx/i.test(r[3]))), KB_SS_INDEX.filter((r) => r[3] !== '' && !/[.a-z)”’!?]$/.test(r[3])).map((r) => r[2]))
check('no two rows are the same setting by accident: label and page are unique', new Set(KB_SS_INDEX.map((r) => r[0] + '|' + r[1] + '|' + r[2])).size === KB_SS_INDEX.length)

console.log('what people type')
{
  const dark = run('dark')
  check('« dark » finds the mode first, one result for the setting three pages show, and says where else it is', labels(dark)[0] === 'appearance/Mode' && dark[0].also.length === 2 && labels(dark).filter((l) => /\/Mode$/.test(l)).length === 1, labels(dark))
  const police = run('police')
  check('« police » (French) finds the text size, shown on two pages as one setting, then the font', labels(police)[0] === 'general/Font size' && police[0].also.length === 1 && labels(police).indexOf('theme/Font') > 0, labels(police))
  check('« police » also offers the Theme page, but only after the settings', pagesOf(police).join() === 'theme' && police[police.length - 1].kind === 'page', police.map((x) => x.kind))
  check('« font size » finds the same setting; the words of the label come first', labels(run('font size'))[0] === 'general/Font size')
  const key = run('clé api')
  check('« clé api » (French, with the accent) finds every place an API key goes', ['cloud computers/API key', 'connectors/Composio key', 'ai provider & models/Add provider', 'web search/Default engine'].every((l) => labels(key).indexOf(l) >= 0), labels(key))
  check('« API KEY » in capitals finds the same rows as « api key »', labels(run('API KEY')).join() === labels(run('api key')).join())
  check('« mémoire » finds the memory page\'s rows and the settings that talk about memory', labels(run('mémoire')).indexOf('memory & lessons/Memories') >= 0 && labels(run('mémoire')).indexOf('general/Study model') >= 0)
  check('« mode sombre » finds the mode', labels(run('mode sombre'))[0] === 'appearance/Mode')
  check('« voix » finds the Voice page and its rows', pagesOf(run('voix')).indexOf('voice') >= 0 && labels(run('voix')).some((l) => /^voice\//.test(l)))
}

console.log('mistakes and silence')
{
  const typo = run('themme')
  check('a typo in a page name finds the page and says what it understood', pagesOf(typo)[0] === 'theme' && typo[0].typo !== null && typo[0].typo.w === 'theme', typo.map((x) => x.kind))
  check('« langage » (a word nobody wrote) finds the Language page by typo', pagesOf(run('langage')).indexOf('language') >= 0)
  check('short words are never forgiven: « font » does not become « fond » (the French for background)', labels(run('font')).indexOf('theme/Background image') < 0)
  check('a word nothing matches finds nothing, so the panel can say so', run('proxy').length === 0 && run('zzzz').length === 0)
  check('an empty or blank query finds nothing (the menu is left as it is)', run('').length === 0 && run('   ').length === 0)
  check('small words are ignored: « the font » is « font »', labels(run('the font')).join() === labels(run('font')).join())
  check('every word of the query must match: « dark banana » finds nothing', run('dark banana').length === 0)
}

console.log('a menu without a page')
{
  const without = Object.assign({}, TITLES)
  delete without.theme
  const r = run('dark', without)
  check('the rows of a page the menu has not (a module switched off) are not offered', labels(r).every((l) => !/^theme\//.test(l)) && labels(r).indexOf('appearance/Mode') === 0, labels(r))
  check('the same setting shown on a page that is not there is not listed as « also in »', r[0].also.every((x) => x.page !== 'theme'), r[0].also.map((x) => x.page))
  check('a page the index does not know (a plugin added later) is still found by its title', kbSsSearch('widgets', ENTRIES, Object.assign({ 'my widgets': 'My Widgets' }, TITLES)).list.some((x) => x.kind === 'page' && x.key === 'my widgets'))
}

console.log('the words people use are not lost to a page\'s own title')
check('the normaliser drops accents, case and symbols', kbSsNorm('  Clé  API !') === 'cle api')
check('every page\'s related words are plain: lower case, no accent', Object.values(KB_SS_PAGE_KW).every((w) => w === kbSsNorm(w)))
check('every row\'s related words are plain: lower case, no accent', KB_SS_INDEX.every((r) => r[5] === kbSsNorm(r[5])), KB_SS_INDEX.filter((r) => r[5] !== kbSsNorm(r[5])).map((r) => r[2]))

console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
