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
const { KB_SS_INDEX, KB_SS_PAGE_KW, KB_SS_FR, KB_SS_SEC_FR, kbSsBuild, kbSsSearch, kbSsNorm, kbSsLocalise, kbSsPackKeys, kbSsSlug } = new Function(SRC.slice(a, b) + '\nreturn { KB_SS_INDEX, KB_SS_PAGE_KW, KB_SS_FR, KB_SS_SEC_FR, kbSsBuild, kbSsSearch, kbSsNorm, kbSsLocalise, kbSsPackKeys, kbSsSlug }')()
const ENTRIES = kbSsBuild(KB_SS_INDEX)

// The pages of the menu, as the organiser names them (the values of KB_NAV_KEYS); the native Models page is not drawn.
const keysBlock = /const KB_NAV_KEYS = \{([\s\S]*?)\n\}/.exec(SRC)
const PAGES = [...new Set([...keysBlock[1].matchAll(/'?[A-Za-z0-9_-]+'?:\s*'([^']+)'/g)].map((m) => m[1]))].filter((k) => k !== 'models')
// The titles a menu carries: here the page's own key, written out (the panel passes the title drawn in the language of the day).
const TITLES = Object.fromEntries(PAGES.map((k) => [k, k]))
TITLES.general = 'General'
TITLES['memory & lessons'] = 'Memory & Lessons'
TITLES.theme = 'Theme'
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
  // The mode is set on the Theme page (three cards); the same setting is also drawn by DSH's own General block, which the Theme page hides.
  check('« dark » finds the mode first, one result for the setting two pages draw (Theme, and DSH\'s own General block), and says where else it is', labels(dark)[0] === 'theme/Appearance' && dark[0].also.length === 1 && labels(dark).filter((l) => /\/Appearance$/.test(l)).length === 1, labels(dark))
  const police = run('police')
  check('« police » (French) finds the text size, shown on two pages as one setting, then the font', labels(police)[0] === 'general/Font size' && police[0].also.length === 1 && labels(police).indexOf('theme/Font') > 0, labels(police))
  check('« police » also offers the Theme page, but only after the settings', pagesOf(police).join() === 'theme' && police[police.length - 1].kind === 'page', police.map((x) => x.kind))
  check('« font size » finds the same setting; the words of the label come first', labels(run('font size'))[0] === 'general/Font size')
  const key = run('clé api')
  check('« clé api » (French, with the accent) finds every place an API key goes', ['code sandbox (e2b)/API key', 'connectors/Composio key', 'ai provider and models/Add provider', 'web search/Default engine'].every((l) => labels(key).indexOf(l) >= 0), labels(key))
  check('« API KEY » in capitals finds the same rows as « api key »', labels(run('API KEY')).join() === labels(run('api key')).join())
  check('« mémoire » finds the memory page\'s rows and the settings that talk about memory', labels(run('mémoire')).indexOf('memory & lessons/Memories') >= 0 && labels(run('mémoire')).indexOf('general/Study model') >= 0)
  check('« mode sombre » finds the mode', labels(run('mode sombre'))[0] === 'theme/Appearance')
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
  check('the rows of a page the menu has not (a module switched off) are not offered', labels(r).every((l) => !/^theme\//.test(l)) && labels(r).indexOf('general/Appearance') === 0, labels(r))
  check('the same setting shown on a page that is not there is not listed as « also in »', r[0].also.every((x) => x.page !== 'theme'), r[0].also.map((x) => x.page))
  check('a page the index does not know (a plugin added later) is still found by its title', kbSsSearch('widgets', ENTRIES, Object.assign({ 'my widgets': 'My Widgets' }, TITLES)).list.some((x) => x.kind === 'page' && x.key === 'my widgets'))
}

console.log('the words people use are not lost to a page\'s own title')
check('the normaliser drops accents, case and symbols', kbSsNorm('  Clé  API !') === 'cle api')
check('every page\'s related words are plain: lower case, no accent', Object.values(KB_SS_PAGE_KW).every((w) => w === kbSsNorm(w)))
check('every row\'s related words are plain: lower case, no accent', KB_SS_INDEX.every((r) => r[5] === kbSsNorm(r[5])), KB_SS_INDEX.filter((r) => r[5] !== kbSsNorm(r[5])).map((r) => r[2]))

console.log('the index only promises what the pages draw')
{
  // The core plugin's bundle patch removes DSH's switch « Upload Session Log when using the official model API » (privacy default): a row for it opened a General page with nothing to blink (T1-7, 2026-10-24).
  const patch = readFileSync(new URL('./cordis.patch.yml', import.meta.url), 'utf8')
  const removed = /- id: session-log-deepseek\s*\n\s*disabled: true/.test(patch)
  check('the bundle patch still removes the Session Log switch (so the premise of the next check holds)', removed)
  check('and then no row of the index offers it', !KB_SS_INDEX.some((r) => /session log/i.test(r[2])), KB_SS_INDEX.filter((r) => /session log/i.test(r[2])).map((r) => r[2]))
}

console.log('the Replay copy names the steps the wizard has')
{
  // « Replay the welcome pages to redo your profession, display mode, … »: display mode stopped being a step (it follows the field) and « profession » is the field-of-work step (T1-10, 2026-10-24).
  const plan = /const kbObPlan = \(withField\) => \(withField === false \? \[[^\]]*\] : \[([^\]]*)\]\)/.exec(SRC)
  const steps = plan === null ? [] : plan[1].split(',').map((s) => s.trim().replace(/'/g, ''))
  check('the wizard plan has no display-mode step', steps.length >= 5 && steps.indexOf('display') < 0 && steps.indexOf('mode') < 0, steps)
  const row = KB_SS_INDEX.find((r) => r[0] === 'general' && r[2] === 'Onboarding')
  check('the search row exists and does not offer to redo a display mode', row !== undefined && !/display mode/i.test(row[3]), row && row[3])
  check('it names the field of work, the goals, the models and the starter kit (steps job, goals, model, kit)', ['job', 'goals', 'model', 'kit'].every((s) => steps.indexOf(s) >= 0) && /field of work, goals, models and starter kit/.test(row[3]), row && row[3])
  const fr = KB_SS_FR['general|Onboarding']
  check('and so does its French twin', Array.isArray(fr) && !/mode d’affichage/.test(fr[1]) && /ton domaine, tes objectifs, tes modèles et ton kit de départ/.test(fr[1]), fr)
  const sessions = readFileSync(new URL('../kybernos-sessions/client.js', import.meta.url), 'utf8')
  check('the page says the same thing as the search row, in both languages', sessions.includes(row[3]) && sessions.includes(fr[1]), null)
}

console.log('a Theme result opens the folded editor before it looks for its row')
{
  // 17 of the 19 Theme results name a tab of the classic editor, which sits in a closed <details>: nothing inside a closed one has a box, so the reveal gave up and blinked nothing (T1-6, 2026-10-24).
  const at = SRC.indexOf('const kbSsOpenFolded = ')
  const end = SRC.indexOf('/** Open the page of a result', at)
  check('the helper exists', at > 0 && end > at)
  const kbSsOpenFolded = new Function(SRC.slice(at, end) + '\nreturn kbSsOpenFolded')()
  const fakePane = (details) => ({ querySelector: (sel) => (sel === 'details[data-kb="theme-classic"]' ? details : null) })
  const closed = { open: false }
  check('a closed editor is opened, and the helper says it did', kbSsOpenFolded(fakePane(closed)) === true && closed.open === true)
  const open = { open: true }
  check('an open one is left alone', kbSsOpenFolded(fakePane(open)) === false && open.open === true)
  check('a page without the editor is not an error', kbSsOpenFolded(fakePane(null)) === false)
  const reveal = SRC.slice(SRC.indexOf('const kbSsReveal = '), SRC.indexOf('const KbSettingsSearchInline'))
  check('the reveal opens it for a tab row of the Theme page BEFORE it looks for the tab (the tabs are inside it)', reveal.indexOf('kbSsOpenFolded(pane)') > 0 && reveal.indexOf('kbSsOpenFolded(pane)') < reveal.indexOf('const tab = '))
  check('and only for a row that names a tab, so a search that lands on the look studio does not unfold the editor', /e\.page === 'theme' && e\.sec !== '' && clickedTab === false\) \{\s*if \(kbSsOpenFolded/.test(reveal))
}

console.log('the Kaby row goes to text the page draws')
{
  // « Name, portrait and voice » is not drawn by the Kaby page (its blocks are Identity / Voice / Face on video calls): the row blinked nothing (T1-13, 2026-10-24).
  const kabySrc = readFileSync(new URL('../kybernos-kaby-customisation/client.js', import.meta.url), 'utf8')
  const row = KB_SS_INDEX.find((r) => r[0] === 'kaby' && r[2] === 'Name, portrait and voice')
  check('the row names the text to go to', row !== undefined && row[7] === 'Identity', row && row[7])
  check('the Kaby page draws that text, in both languages', kabySrc.includes("kt('Identité', 'Identity')") && KB_SS_FR['kaby|Name, portrait and voice'][2] === 'Identité')
}

console.log('French: the results read as the French pages do')
{
  const key = (r) => r[0] + '|' + r[2]
  // The rows the French pages draw in English (DSH's own rows): they keep their English text, which is what the page shows.
  const NATIVE = ['general|Permission', 'general|Appearance', 'general|Font size', 'general|Work details', 'general|When to Collapse Work Details', 'general|Show coding view', 'general|Keyboard shortcuts', 'general|Send behavior while busy', 'general|Performance & usage', 'agent presets|Standard mode', 'built-in plugins|Session plugins']
  check('every French twin is a row of the index (no orphan: a renamed label would drop its French silently)', Object.keys(KB_SS_FR).every((k) => KB_SS_INDEX.some((r) => key(r) === k)), Object.keys(KB_SS_FR).filter((k) => !KB_SS_INDEX.some((r) => key(r) === k)))
  const bare = KB_SS_INDEX.filter((r) => KB_SS_FR[key(r)] === undefined && NATIVE.indexOf(key(r)) < 0).map(key)
  check('every row has its French, except the ones the French pages draw in English: a new row needs its French line', bare.length === 0, bare)
  check('a French twin is [label, description] or [label, description, text to go to], with a label', Object.values(KB_SS_FR).every((f) => Array.isArray(f) && f.length >= 2 && f.length <= 3 && f.every((x) => typeof x === 'string') && f[0] !== ''))
  check('a French twin has a description only where the English row has one', KB_SS_INDEX.every((r) => { const f = KB_SS_FR[key(r)]; return f === undefined || r[3] !== '' || f[1] === '' }), KB_SS_INDEX.filter((r) => { const f = KB_SS_FR[key(r)]; return f !== undefined && r[3] === '' && f[1] !== '' }).map(key))
  check('every section the index names has its French (a tab of the Theme page, a block of General)', [...new Set(KB_SS_INDEX.map((r) => r[1]).filter((x) => x !== ''))].every((x) => KB_SS_SEC_FR[x] !== undefined))
  const FR = kbSsBuild(KB_SS_INDEX, 'kybernos', null)
  const frRun = (q) => kbSsSearch(q, FR, TITLES).list
  const frLabels = (list) => list.filter((x) => x.kind === 'item').map((x) => x.e.page + '/' + x.e.label)
  check('the result is drawn with the French label and tab of the page', frLabels(frRun('rayons')).indexOf('theme/Rayons') === 0 && frRun('rayons')[0].e.sec === 'Texte et forme', frLabels(frRun('rayons')))
  check('« taille du texte » finds the row that is called that on its French page first, and the same setting on General (English there) as « also in »', frRun('taille du texte')[0].e.label === 'Taille du texte' && frRun('taille du texte')[0].also.length === 1 && frRun('taille du texte')[0].also[0].label === 'Font size', frLabels(frRun('taille du texte')))
  check('a French reader can still type the English words: « font size », « api key »', frLabels(frRun('font size'))[0] === 'general/Font size' && frLabels(frRun('api key')).indexOf('code sandbox (e2b)/Clé API') >= 0, frLabels(frRun('api key')))
  check('« nommer conversation » finds the French label', frLabels(frRun('nommer conversation'))[0] === 'general/Nommer chaque conversation à sa fin', frLabels(frRun('nommer conversation')))
  check('a typo is forgiven in French too: « apparance » finds the mode on the Theme page', frLabels(frRun('apparance')).indexOf('theme/Apparence') >= 0, frLabels(frRun('apparance')))
  check('a row with its own target keeps it in French (the plan of the phone link, the engine of the version)', FR.find((e) => e.key === 'phone and channels|Link a phone').at === 'Relier un téléphone en trois étapes' && FR.find((e) => e.key === 'about|Version').at === 'Moteur DSH')
  check('English stays as it was: no French in the English index', kbSsBuild(KB_SS_INDEX).every((e) => e.label === KB_SS_INDEX.find((r) => key(r) === e.key)[2]))
  check('« fr » and « fr-CA » take the French too (the shell may say either)', kbSsLocalise(KB_SS_INDEX[0], 'fr', null).label === 'Premiers pas' && kbSsLocalise(KB_SS_INDEX[0], 'fr-CA', null).label === 'Premiers pas')
}

console.log('other languages: served from the translation pack, English when it has nothing')
{
  const keys = kbSsPackKeys(KB_SS_INDEX)
  check('the pack has a key per label, in the shape the Language page reads ({ fr, en }, both non-empty)', Object.keys(keys).length > KB_SS_INDEX.length && Object.values(keys).every((v) => typeof v.fr === 'string' && v.fr !== '' && typeof v.en === 'string' && v.en !== ''))
  check('the keys are stable and unique: from the page and the label, not from the position', new Set(KB_SS_INDEX.map((r) => kbSsSlug(r[0], r[2]))).size === KB_SS_INDEX.length && kbSsSlug('general', 'Font size') === 'general-font-size')
  check('the French half of the pack is the French twin, the English half the English row', keys['general-onboarding.l'].fr === 'Premiers pas' && keys['general-onboarding.l'].en === 'Onboarding' && keys['sec.behaviour'].fr === 'Comportement')
  check('a row with a text to go to publishes it too', keys['phone-and-channels-link-a-phone.a'].fr === 'Relier un téléphone en trois étapes' && keys['phone-and-channels-link-a-phone.a'].en === 'Link a phone in three steps')
  const es = { 'settingsidx.general-font-size.l': 'Tamaño de fuente', 'settingsidx.general-font-size.d': 'Solo afecta al contenido de la conversación', 'settingsidx.sec.behaviour': 'Comportamiento' }
  const row = KB_SS_INDEX.find((r) => r[2] === 'Font size')
  const L = kbSsLocalise(row, 'es', es)
  check('a translated language reads its label and description back from its pack, under the namespace', L.label === 'Tamaño de fuente' && L.desc === 'Solo afecta al contenido de la conversación' && L.at === 'Tamaño de fuente', L)
  check('and the section of a row', kbSsLocalise(KB_SS_INDEX[0], 'es', es).sec === 'Comportamiento')
  check('a string the pack does not hold stays English (never a hole)', kbSsLocalise(KB_SS_INDEX[0], 'es', es).label === 'Onboarding' && kbSsLocalise(KB_SS_INDEX[0], 'es', null).label === 'Onboarding')
  const ES = kbSsBuild(KB_SS_INDEX, 'es', es)
  check('the search finds it by the Spanish label, and by the English words too', kbSsSearch('tamano de fuente', ES, TITLES).list[0].e.label === 'Tamaño de fuente' && kbSsSearch('font size', ES, TITLES).list[0].e.label === 'Tamaño de fuente')
}


console.log('the words an English reader types for a page that is not called that')
// The related words of the pages were French and Spanish only, so « cost » found nothing on a Settings menu that has a Usage page (measured on the
// real GUI: 34 of 98 everyday queries found nothing, among them cost, price, sound, export, reset, backup, restart, email, schedule).
for (const [q, page] of [['cost', 'usage'], ['price', 'usage'], ['spending', 'usage'], ['sound', 'calls'], ['sound', 'voice'], ['speaker', 'voice'], ['camera', 'calls'], ['export', 'theme'], ['reset', 'theme'], ['backup', 'tools'], ['restart', 'kybernos suite'], ['restart', 'about'], ['email', 'connectors'], ['schedule', 'automations'], ['openrouter', 'ai provider and models'], ['translate', 'language'], ['memories', 'memory & lessons'], ['firewall', null]]) {
  const found = pagesOf(run(q, Object.fromEntries([...PAGES, 'tools'].map((k) => [k, k]))))
  check('« ' + q + ' » ' + (page === null ? 'still finds no page (a word that is nowhere stays nowhere)' : 'leads to the ' + page + ' page'), page === null ? found.length === 0 : found.indexOf(page) >= 0, found)
}
console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
