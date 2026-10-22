// Test the slash plugin's i18n: every L({fr, en}) call must have both sides filled, and kbslLang must
// correctly resolve 'fr' vs 'en' based on window.__KB_I18N_ACTIVE__.lang, document.documentElement.lang, or navigator.language.
// kbslLang is not exported from the module (no test hook), so its logic is mirrored here for isolated testing.
//   node packages/kybernos-slash/test-client.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')

console.log('L({fr, en}) calls')
{
  // Every L({ fr: '...', en: '...' }) literal must have both sides non-empty.
  // Match the literal pairs in the source (single-quoted strings).
  const pairs = [...src.matchAll(/L\(\s*\{\s*fr:\s*'([^']*)'\s*,\s*en:\s*'([^']*)'\s*\}\)/g)]
  check('L({fr, en}) literal pairs found', pairs.length > 0, 'count=' + pairs.length)
  const emptyFr = pairs.filter((p) => p[1].trim() === '')
  check('every fr side is non-empty', emptyFr.length === 0, emptyFr.map((p) => p[2]).join(','))
  const emptyEn = pairs.filter((p) => p[2].trim() === '')
  check('every en side is non-empty', emptyEn.length === 0, emptyEn.map((p) => p[1]).join(','))
  // Also catch L({fr: '...' + ...}) concatenated strings: both sides must exist.
  // A simpler check: count all L({ fr: ... occurrences and make sure none is missing an en: field.
  const lCalls = [...src.matchAll(/L\(\s*\{\s*fr:/g)]
  check('every L({fr:...}) call has an en: field', lCalls.every((m) => {
    const after = src.slice(m.index, m.index + 500)
    return /en:\s*'/.test(after)
  }), 'L calls=' + lCalls.length)
}

// mirror of kbslLang from client.js (not exported; duplicate logic here for isolated testing).
// Prefers the shared resolver __KB_LANG_RESOLVE__ (set by kybernos-plugin); 'kybernos' means the
// default French, 'en' means English, otherwise the language base decides.
const kbslLang = () => {
  try {
    let r = (typeof window !== 'undefined' && typeof window.__KB_LANG_RESOLVE__ === 'function') ? String(window.__KB_LANG_RESOLVE__()) : null
    if (r === null) {
      const a = (typeof window !== 'undefined') ? window.__KB_I18N_ACTIVE__ : null
      r = (a && a.lang !== null && a.lang !== undefined) ? String(a.lang) : ((typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) ? document.documentElement.lang : ((typeof navigator !== 'undefined' && navigator.language) || 'en'))
    }
    const base = r.toLowerCase().split(/[-_]/)[0]
    return (r.toLowerCase() === 'kybernos' || base === 'fr') ? 'fr' : 'en'
  } catch (e) { return 'en' }
}

console.log('kbslLang: mirror of kbslLang from client.js')
{
  // __KB_LANG_RESOLVE__ = 'kybernos' (default French) → 'fr'  (the regression this guards against)
  globalThis.window = { __KB_LANG_RESOLVE__: () => 'kybernos' }
  check('__KB_LANG_RESOLVE__ = "kybernos" → "fr"', kbslLang() === 'fr', kbslLang())

  // __KB_LANG_RESOLVE__ = 'en' → 'en'
  globalThis.window = { __KB_LANG_RESOLVE__: () => 'en' }
  check('__KB_LANG_RESOLVE__ = "en" → "en"', kbslLang() === 'en', kbslLang())

  // __KB_LANG_RESOLVE__ = 'fr-FR' → 'fr'
  globalThis.window = { __KB_LANG_RESOLVE__: () => 'fr-FR' }
  check('__KB_LANG_RESOLVE__ = "fr-FR" → "fr"', kbslLang() === 'fr', kbslLang())

  // resolver absent → __KB_I18N_ACTIVE__ = { lang: 'fr' } → 'fr'
  globalThis.window = { __KB_I18N_ACTIVE__: { lang: 'fr' } }
  check('window.__KB_I18N_ACTIVE__.lang = fr → "fr"', kbslLang() === 'fr', kbslLang())

  // window.__KB_I18N_ACTIVE__ = { lang: 'en' } → 'en'
  globalThis.window = { __KB_I18N_ACTIVE__: { lang: 'en' } }
  check('window.__KB_I18N_ACTIVE__.lang = en → "en"', kbslLang() === 'en', kbslLang())

  // window.__KB_I18N_ACTIVE__ absent → fallback to document.documentElement.lang
  globalThis.window = {}
  globalThis.document = { documentElement: { lang: 'fr' } }
  check('no __KB_I18N_ACTIVE__, documentElement.lang = fr → "fr"', kbslLang() === 'fr', kbslLang())

  globalThis.document = { documentElement: { lang: 'en' } }
  check('no __KB_I18N_ACTIVE__, documentElement.lang = en → "en"', kbslLang() === 'en', kbslLang())

  // No window, no document → fallback to navigator.language
  // (navigator is a getter on globalThis in newer Node; override it via Object.defineProperty)
  globalThis.window = undefined
  globalThis.document = undefined
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'fr-FR' }, writable: true, configurable: true })
  check('navigator.language = fr-FR → "fr"', kbslLang() === 'fr', kbslLang())

  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, writable: true, configurable: true })
  check('navigator.language = en-US → "en"', kbslLang() === 'en', kbslLang())

  // __KB_I18N_ACTIVE__ = { lang: 'fr' } wins over documentElement.lang = 'en'
  globalThis.window = { __KB_I18N_ACTIVE__: { lang: 'fr' } }
  globalThis.document = { documentElement: { lang: 'en' } }
  check('__KB_I18N_ACTIVE__.lang = fr wins over documentElement.lang = en', kbslLang() === 'fr', kbslLang())
}

console.log('non-regression: __KB_I18N_ACTIVE__ is read in client.js')
{
  check('client.js references __KB_I18N_ACTIVE__', src.includes('__KB_I18N_ACTIVE__'), 'not found in source')
  check('client.js references __KB_LANG_RESOLVE__', src.includes('__KB_LANG_RESOLVE__'), 'not found in source')
  check('client.js treats "kybernos" as French', src.includes("'kybernos'"), 'kybernos case missing')
  check('client.js references kbslLang', src.includes('kbslLang'), 'not found in source')
}

// The name typed after the slash (audit 2026-10-16: « ÉTÉ » became « t », « goal » was accepted, so was « -x » and an 80-letter name).
console.log('the slash name')
{
  const a = src.indexOf('// <kbsl-slug>')
  const b = src.indexOf('// </kbsl-slug>', a)
  check('the name helpers can be cut out of client.js', a > 0 && b > a)
  const { kbCleanSlug, KB_DSH_COMMANDS, KB_SLUG_MAX } = new Function(src.slice(a, b) + '\nreturn { kbCleanSlug, KB_DSH_COMMANDS, KB_SLUG_MAX }')()
  check('accents are transliterated, not dropped (« ÉTÉ » is « ete », « Crème brûlée » is « creme-brulee »)', kbCleanSlug('ÉTÉ') === 'ete' && kbCleanSlug('Crème brûlée') === 'creme-brulee', [kbCleanSlug('ÉTÉ'), kbCleanSlug('Crème brûlée')])
  check('a space becomes a dash, a slash and other signs are dropped', kbCleanSlug('a b') === 'a-b' && kbCleanSlug('a/b') === 'ab' && kbCleanSlug('a.b!') === 'ab')
  check('the name starts with a letter or a digit (a leading dash or underscore goes), and keeps its inner ones', kbCleanSlug('-x') === 'x' && kbCleanSlug('__x') === 'x' && kbCleanSlug('9lives') === '9lives' && kbCleanSlug('a-b_c') === 'a-b_c')
  check('a name is bounded', kbCleanSlug('a'.repeat(80)).length === KB_SLUG_MAX && KB_SLUG_MAX >= 16 && KB_SLUG_MAX <= 64)
  check('typing stays possible: a trailing dash is kept so « a-b » can be typed', kbCleanSlug('a-') === 'a-')
  check('DSH\'s own commands are known (goal, compact, help, plan, feedback)', ['goal', 'compact', 'help', 'plan', 'feedback'].every((c) => KB_DSH_COMMANDS.indexOf(c) !== -1))
  check('the editor refuses such a name, with its own sentence', /KB_DSH_COMMANDS\.indexOf\(kbCleanSlug\(d\.slug\)\) !== -1\) return \{ msg: '\/' \+ kbCleanSlug\(d\.slug\) \+ ' is one of DSH/.test(src))
}

console.log('the animated help of the Commands page (V-36)')
{
  const guard = "typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__"
  const at = src.indexOf("id: 'kybernos-slash',\n")
  const call = at < 0 ? '' : src.slice(at, at + 3000)
  check('the page asks the Suite for the animation, keyed by its bundle, behind a guard', src.includes(guard + '.Intro') && /h\(window\.__KB_HELP__\.Intro, \{\s*id: 'kybernos-slash'/.test(src))
  check('three steps with a title and a sentence each, in both languages', (call.match(/\{ t: L\(\{ fr: '[^']+', en: '[^']+' \}\), b: L\(\{ fr: '[^']+', en: '[^']+' \}\) \}/g) || []).length === 3, call.slice(0, 200))
  check('they say what to do: save a prompt, call it with « / », or run it on a reply', /Save a prompt/.test(call) && /Call it with \//.test(call) && /run it on a reply/i.test(call))
  check('the mock names the page and shows a command with its three states and three labels', /bar: L\(\{ fr: 'Commandes', en: 'Commands' \}\)/.test(call) && /hot: '\/summary'/.test(call) && /states: \[L\(/.test(call) && /actions: \[L\(/.test(call))
  check('it sits under the header and above the tabs', src.indexOf('introNode,') > src.indexOf("className: 'kbsl-head'") && src.indexOf('introNode,') < src.indexOf("className: 'kbsl-tabs'"))
}

console.log('the page says what each tab is for (V-36), without a permanent line')
{
  // 2026-10-22: the sentence is the tooltip of the tab and the text of an empty list (where a person needs it), not a line under the toolbar.
  const at = src.indexOf('const tabFor = (k) => (k === ')
  const where = at < 0 ? '' : src.slice(at, at + 900)
  check('the sentence follows the tab (tabFor), and is the tooltip of each tab and the text of an empty list', at > 0 && /title: tabFor\(k\)/.test(src) && /: tabFor\(tab\)\)/.test(src) && !/kbsl-tabfor/.test(src))
  check('slash tab: it says what a slash command is, in both languages', /fr: 'Une commande slash est un prompt enregistré/.test(where) && /en: 'A slash command is a saved prompt/.test(where))
  check('message actions tab: it says what an action is and where it shows, in both languages', /fr: 'Une action de message est un bouton sous/.test(where) && /en: 'A message action is a button under/.test(where))
  check('it explains how to run a slash command (the « / » key) and what an action works on (that reply)', /“\/”/.test(where) && /that reply/.test(where) && /cette réponse/.test(where))
  const pairs = [...src.matchAll(/L\(\s*\{\s*fr:\s*'([^']*)'\s*,\s*en:\s*'([^']*)'\s*\}\)/g)]
  check('the new sentences are among the L({fr, en}) pairs, none empty', pairs.filter((p) => /commande slash est un prompt|action de message est un bouton/.test(p[1])).length === 2)
}

console.log('the Commands page and its editor (owner\'s redesign, 2026-10-22)')
{
  const css = src.slice(src.indexOf('const CSS = `'), src.indexOf('\n`', src.indexOf('const CSS = `')))
  check('a row shows its actions on hover or focus, and always on a touch screen', /\.kbsl-lacts\{[^}]*opacity:0/.test(css) && /\.kbsl-lrow:hover \.kbsl-lacts,\.kbsl-lrow:focus-within \.kbsl-lacts[^{]*\{opacity:1\}/.test(css) && /@media \(hover:none\)\{\.kbsl-lacts\{opacity:1\}\}/.test(css))
  check('« New command » and « Create with AI » are in the toolbar, above the list, and the old bottom buttons and the details fold are gone', src.indexOf("className: 'kbsl-btn kbsl-primary sm', onClick: () => kbOpenEditor('create'") < src.indexOf("className: 'kbsl-list'") && !/kbsl-dashed/.test(src) && !/h\('details', \{ className: 'kbsl-json'/.test(src))
  check('the stored JSON is a link in the footer that opens it', /kbsl-jsonbtn/.test(src) && /View stored JSON/.test(src))
  check('« Create with AI » wears the wand, not the sparkles, on the page and in the editor', (src.match(/name: 'wand-sparkles', size: 1[56], weight: 2 \}\), (L\(\{ fr: 'Créer avec l’IA'|'Create with AI')/g) || []).length === 2 && !/name: 'sparkles', size: 16, weight: 2 \}\), 'Create with AI'/.test(src))
  check('the editor is four sections with no numbered steps', /'Identity'|kbsl-idrow/.test(src) && /h\('h3', \{ className: 'kbsl-steph' \}, 'Prompt'\)/.test(src) && /'Questions'/.test(src) && /'When it runs'/.test(src) && !/kbsl-stepn|stepN\(/.test(src))
  check('the prompt grows with its text: a mirror gives the height and the field sits on it, the blanks coloured', /className: 'kbsl-edm'/.test(src) && /\.kbsl-edta\{position:absolute[^}]*overflow:hidden/.test(css) && /\.kbsl-var\{/.test(css))
  check('the preview is a panel opened from the header, kept between visits, closed by default', /KB_PREVIEW_KEY = 'kybernos\.slash\.preview'/.test(src) && /getItem\(KB_PREVIEW_KEY\) === 'on'/.test(src) && /'aria-pressed': pv/.test(src) && /const aside = pv \? h\('aside'/.test(src))
  check('the window takes its content\'s height (a ceiling, no fixed height), and widens when the preview opens', /\.kbsl-modal\{width:min\(760px,100%\);max-height:min\(840px/.test(css) && !/\.kbsl-modal\{[^}]*[^-]height:min\(780px/.test(css) && /\.kbsl-modal\.pv\{width:min\(1100px/.test(css))
  check('« Insert a blank » drops the token at the cursor, the footer names what blocks a save and goes to it, unsaved changes are said', /kbInsertAtCaret/.test(src) && /kbFocusProblem\(problem\.go\)/.test(src) && /Unsaved changes/.test(src))
  check('the icon picker searches, shows a ring on the chosen icon and says when nothing matches', /'aria-label': 'Search icons'/.test(src) && /'aria-pressed': n === d\.icon/.test(src) && /No icon matches/.test(src))
  check('Escape belongs to the editor while it is open: the listener is on window (capture) and stops the event, so DSH\'s Settings dialog behind it stays open', /window\.addEventListener\('keydown', onKey, true\)/.test(src) && /window\.removeEventListener\('keydown', onKey, true\)/.test(src) && /if \(mine\) \{ ev\.preventDefault\(\); ev\.stopImmediatePropagation\(\) \}/.test(src) && !/document\.addEventListener\('keydown', onKey, true\)/.test(src))
  check('Ctrl/Cmd + S saves the open editor', /String\(ev\.key\)\.toLowerCase\(\) === 's' && ui\.editor !== null/.test(src) && /kbSaveEditor\(\)/.test(src))
}

{
  // UX audit 2026-10-20: the icon search split the query on the LETTER s (`/s+/`, the backslash lost), so « sport » looked for « port ».
  const at = src.indexOf('const kbIconSearch = (q) => {')
  const body = src.slice(at, at + 700)
  check('the icon search splits the typed words on spaces, not on the letter s', at > 0 && body.includes('s.split(/\\s+/)') && !body.includes('s.split(/s+/)'))
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
