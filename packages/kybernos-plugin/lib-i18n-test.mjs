// Test helper: the texts of the core client, the way the page gets them.
//
// client.js asks the host route /kybernos/i18n for ./i18n/fr.json and ./i18n/en.json while its factory starts (`kbDictLoad`). A test that used to
// read the `KB_T` table out of client.js with a regular expression calls `loadTable()` instead: it runs the REAL `kbDictLoad` text of client.js against
// the REAL route code (`i18nAnswer`) and the real files, and gets the same { key: { kybernos, en } } object the page builds.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { i18nAnswer } from './i18n-files.mjs'

export const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
export const I18N_DIR = join(PLUGIN_DIR, 'i18n')
export const readClient = () => readFileSync(join(PLUGIN_DIR, 'client.js'), 'utf8')

/** The text of `const kbDictLoad = () => { … }` in a client.js source (or throws, so a rename cannot turn a test into a no-op). */
export const kbDictLoadSource = (src = readClient()) => {
  const start = src.indexOf('const kbDictLoad = () => {')
  const end = src.indexOf('\n    const KB_T = kbDictLoad()', start)
  if (start < 0 || end < 0) throw new Error('kbDictLoad is not in client.js (or no longer followed by `const KB_T = kbDictLoad()`)')
  return src.slice(start, end)
}

/**
 * The table `kbDictLoad` builds, and the requests it made. `respond(url)` stands for the server (default: the real route code over ./i18n); it returns { status, body } or throws
 * (a refused connection). `baseURI` is what the page's `document.baseURI` says. `src` is the client source (default: the file).
 */
export const loadTableWithCalls = ({ dir = I18N_DIR, respond, baseURI = 'http://127.0.0.1:3080/', src } = {}) => {
  const answer = respond ?? ((url) => i18nAnswer(dir, new URL(url, baseURI).searchParams.get('lang'), null))
  const calls = []
  class FakeXhr {
    open (method, url, asyncFlag) { this.method = method; this.url = url; this.asyncFlag = asyncFlag }
    send () { calls.push({ method: this.method, url: this.url, async: this.asyncFlag }); const a = answer(this.url); this.status = a.status; this.responseText = a.body }
  }
  const sandbox = { document: { baseURI }, URL, XMLHttpRequest: FakeXhr, Object, JSON }
  const made = vm.runInNewContext('(() => {\n' + kbDictLoadSource(src) + '\nreturn kbDictLoad() })()', sandbox, { timeout: 5000 })
  // Back into this realm: a table from the sandbox has the sandbox's Object.prototype, and deepStrictEqual compares prototypes.
  return { table: JSON.parse(JSON.stringify(made)), calls }
}

/** The table alone (see loadTableWithCalls for the requests the loader made). */
export const loadTable = (options) => loadTableWithCalls(options).table

/** The two flat maps straight from the files: { fr: { key: text }, en: { key: text } }. */
export const readFiles = (dir = I18N_DIR) => ({
  fr: JSON.parse(readFileSync(join(dir, 'fr.json'), 'utf8')),
  en: JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')),
})

// ── What a test asks of the dictionary (it used to regex the source of client.js; now it reads the files) ─────────────────────────────────────────
let cache = null
/** The table as the page builds it: { key: { kybernos, en } } (read once per test process). */
export const table = () => { if (cache === null) cache = loadTable(); return cache }

/** The entry of one key as { kybernos, en } (a language the files lack is simply absent), or null when no file has the key. */
export const entry = (key) => { const t = table(); return Object.prototype.hasOwnProperty.call(t, key) ? t[key] : null }

/** True when BOTH files give the key a non-empty text. */
export const hasEntry = (key) => { const e = entry(key); return e !== null && typeof e.kybernos === 'string' && e.kybernos !== '' && typeof e.en === 'string' && e.en !== '' }

/** What `new RegExp("'key': \\{ kybernos: '([^']+)', en: '([^']+)' \\}").exec(source)` used to give: [ whole, fr, en ] or null. */
export const execEntry = (key) => (hasEntry(key) ? [key, entry(key).kybernos, entry(key).en] : null)

/** Every key matching `keyPattern` (a RegExp tested on the key), as [ key, fr, en ] rows in file order: the old `matchAll` over the table lines. */
export const entriesMatching = (keyPattern) => Object.keys(table()).filter((k) => keyPattern.test(k)).map((k) => [k, table()[k].kybernos, table()[k].en])

