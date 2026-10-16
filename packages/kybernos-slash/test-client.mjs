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

console.log('the page says what each tab is for (V-36)')
{
  const line = src.match(/className: 'kbsl-sub kbsl-tabfor'[^\n]*\n?/)
  const where = line === null ? '' : line[0] + src.slice(line.index + line[0].length, line.index + line[0].length + 900)
  check('a line under the tabs follows the tab that is open', line !== null && /tab === 'action'/.test(where.slice(0, 200)))
  check('slash tab: it says what a slash command is, in both languages', /fr: 'Une commande slash est un prompt enregistré/.test(where) && /en: 'A slash command is a saved prompt/.test(where))
  check('message actions tab: it says what an action is and where it shows, in both languages', /fr: 'Une action de message est un bouton sous/.test(where) && /en: 'A message action is a button under/.test(where))
  check('it explains how to run a slash command (the « / » key) and what an action works on (that reply)', /“\/”/.test(where) && /that reply/.test(where) && /cette réponse/.test(where))
  const pairs = [...src.matchAll(/L\(\s*\{\s*fr:\s*'([^']*)'\s*,\s*en:\s*'([^']*)'\s*\}\)/g)]
  check('the new sentences are among the L({fr, en}) pairs, none empty', pairs.filter((p) => /commande slash est un prompt|action de message est un bouton/.test(p[1])).length === 2)
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
