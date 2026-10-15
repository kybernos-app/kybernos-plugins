// The browser half: the contract, the pure helpers (cut out and run), and — when jsdom is importable (KYBERNOS_JSDOM=<path to
// jsdom/lib/api.js>, as kybernos-flow and kybernos-refs do) — the dialog itself.   node packages/kybernos-search/test-client.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let total = 0
let failed = 0
const ok = (name, cond, detail) => { total += 1; if (cond) console.log('  ✓ ' + name); else { failed += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 240))) } }
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')

console.log('contract')
ok('the factory is wrapped: a load error returns a disabled plugin', /catch \(err\) \{[\s\S]*return \{ apply \(\) \{/.test(SRC))
ok('nothing is ever written to the page as HTML from a result', !/\.innerHTML\s*=\s*[^'`]*\b(r|m|it|hit|result|text|title|q)\b/.test(SRC) && (SRC.match(/\.innerHTML =/g) || []).length === 1)
ok('the only innerHTML is the static icon constants of this file', /s\.innerHTML = inner \/\/ static constants/.test(SRC))
ok('every network call is to this plugin, or to two routes the page already uses', [...SRC.matchAll(/(?:post|getJson)\('([^']+)'/g)].map((m) => m[1]).every((u) => /^\/kybernos-search\/|^\/kybernos-cloud\/memory$|^\/kybernos\/state$/.test(u)))
ok('no engine patch, no eval, no remote script', !/\beval\(|new Function|importScripts|XMLHttpRequest|WebSocket/.test(SRC))
ok('the hooks of the live checks', ['search-dialog', 'search-input', 'search-header'].every((h) => SRC.includes("'" + h + "'")) && /data-act', 'scope'/.test(SRC) && /'data-act', 'result'/.test(SRC))
ok('the three ways in: the global opener, the shortcut, the header icon', SRC.includes('window.__KB_SEARCH__ = { open: openDialog') && /String\(e\.key\)\.toLowerCase\(\) === 'k'/.test(SRC) && /\[class\*="searchButton"\]/.test(SRC))
ok('the native search is not touched: the icon is inserted AFTER it', /native\.insertAdjacentElement\('afterend', b\)/.test(SRC) && !/native\.remove|native\.style|native\.addEventListener/.test(SRC))
ok('tool outputs and archived chats are not offered (they are not built)', !/archiv|tool output|sorties d/i.test(SRC.replace(/\/\/.*$/gm, '')))
ok('every visible string goes through kt (fr, en)', !/\.textContent = '[A-Z][a-z]+ [a-z]/.test(SRC) && !/createTextNode\('[A-Za-z]{4,}/.test(SRC))

console.log('pure helpers')
const a = SRC.indexOf('// KB-SEARCH-PURE-BEGIN')
const b = SRC.indexOf('// KB-SEARCH-PURE-END')
const scopesSrc = SRC.slice(SRC.indexOf('const SCOPES = ['), SRC.indexOf('const KEY_SCOPES'))
const api = vm.runInNewContext(
  "const kt = (fr, en) => en\n" + scopesSrc + SRC.slice(a, b) +
  '\n;({ fold, queryTerms, marksOf, maskSecrets, localMatch, hostScopes, normalizeScopes, SCOPES, DEFAULT_SCOPES })', { String, Array, Set, Object, Math })
{
  ok('fold: accents and case, one character for one', api.fold('Thème ÉTÉ') === 'theme ete' && api.fold('İstanbul').length === 'İstanbul'.length)
  ok('terms: distinct, folded, at most 6', JSON.stringify(api.queryTerms(' Thème thème Docker ')) === '["theme","docker"]' && api.queryTerms('a b c d e f g h').length === 6)
  const items = [
    { id: 'm1', title: 'Préférence : réponses courtes', text: 'Miled préfère une réponse courte, le résultat d’abord.', pinned: true, meta: { where: 'Account memory' } },
    { id: 'm2', title: 'Thème Kybernos', text: 'Le thème par défaut est « Neutre violet ».', meta: {} },
    { id: 'm3', title: 'Clé', text: 'voici la clé ' + 'ab12'.repeat(10) + ' ne pas partager thème', meta: {} }
  ]
  const r = api.localMatch(items, 'theme', 'memory')
  ok('page-side scopes: every word, accent-insensitive', r.length === 2 && r.every((x) => x.scope === 'memory') && r[0].hits[0].marks.length > 0)
  ok('a secret-looking token is masked in a window', !r.some((x) => x.hits[0].text.includes('ab12ab12ab12')) && r.some((x) => x.hits[0].text.includes('•')))
  ok('a pinned memory ranks first among equal matches', api.localMatch(items, 'reponse', 'memory')[0].id === 'm1')
  ok('only the scopes the host knows are sent to it', JSON.stringify(api.hostScopes(['chat', 'memory', 'creation', 'team'])) === '["chat","team"]')
  ok('stored scopes are sanitised, an empty or broken value is the defaults', JSON.stringify(api.normalizeScopes(['chat', 'evil'])) === '["chat"]' && api.normalizeScopes([]).length === 5 && api.normalizeScopes(null).length === 5 && api.normalizeScopes('x').length === 5)
  ok('seven scopes, all with a colour', api.SCOPES.length === 7 && api.SCOPES.every((s) => /^#[0-9a-f]{6}$/i.test(s.hue)))
}

console.log('the dialog')
let JSDOM = null
try { ({ JSDOM } = await import(process.env.KYBERNOS_JSDOM ?? 'jsdom')) } catch (e) { JSDOM = null }
if (JSDOM === null) {
  console.log('  - jsdom is not importable: the DOM part is skipped (set KYBERNOS_JSDOM=<path to jsdom/lib/api.js>)')
} else {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const dom = new JSDOM('<!doctype html><body><div class="x_sectionHeader"><span>Workspaces</span><button class="x_searchButton" aria-label="Search sessions"></button><button class="x_iconButton x_wide" aria-label="View options"></button></div></body>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://127.0.0.1:3080/' })
  const w = dom.window
  const calls = []
  const reply = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body })
  let hostAnswer = { ok: true, state: 'ready', terms: ['theme'], indexed: 3, tookMs: 4, counts: { chat: 1 }, results: [{ scope: 'chat', id: 'session-1', title: 'Créer un <img src=x onerror=alert(1)> thème', titleMarks: [[28, 33]], meta: { where: 'proj', when: Date.now() - 86400000 }, open: { kind: 'session', id: 'session-1' }, hits: [{ r: 'u', ts: 1, text: 'un thème <script>alert(1)</script> sombre', marks: [[3, 8]], pre: true, post: false }] }] }
  w.fetch = (url, opts) => {
    calls.push([String(url), opts && opts.body ? JSON.parse(opts.body) : null])
    const u = String(url)
    if (u === '/kybernos-search/query') return reply(hostAnswer)
    if (u === '/kybernos-search/start') return reply({ ok: true, state: 'building', done: 1, total: 2, chats: 1 }, 202)
    if (u === '/kybernos-search/status') return reply({ ok: true, state: 'ready', done: 2, total: 2, chats: 2, updatedAt: Date.now(), errors: 0, sources: 0 })
    if (u === '/kybernos-cloud/memory') return reply({ ok: true, account: [{ id: 'm1', content: 'Le thème sombre est préféré', kind: 'preference', pinned: true }] })
    if (u === '/kybernos/state') return reply({ data: { artifacts: [{ id: 'a1', title: 'Slides thème de marque', kind: 'slides' }] } })
    return reply({}, 404)
  }
  let def = null
  w.__ModuleLoader__ = { load (d) { def = d } }
  w.eval(SRC)
  const opened = []
  const plugin = def.factory()
  const effects = []
  plugin.apply({ get: (n) => (n === 'uiWorkspace' ? { openSession: (id) => opened.push(id) } : null), effect: (fn) => effects.push(fn()) })
  const doc = w.document
  ok('the plugin registers and exposes its opener', def.id === '@local/kybernos-search' && typeof w.__KB_SEARCH__.open === 'function')
  const hdr = doc.querySelector('[data-kb="search-header"]')
  ok('the icon sits right after the native search button, borrowing the look of the icon buttons', hdr !== null && hdr.previousElementSibling.getAttribute('aria-label') === 'Search sessions' && /x_iconButton/.test(hdr.className) && !/wide/.test(hdr.className))
  ok('the native search button is untouched', doc.querySelector('.x_searchButton').getAttribute('aria-label') === 'Search sessions' && doc.querySelector('.x_searchButton').className === 'x_searchButton')
  hdr.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  ok('the icon opens the dialog', doc.querySelector('[data-kb="search-dialog"]') !== null && doc.activeElement === doc.querySelector('[data-kb="search-input"]'))
  await sleep(50)
  ok('the first open starts the index (it is built on the first click)', calls.some((c) => c[0] === '/kybernos-search/start'))
  const input = doc.querySelector('[data-kb="search-input"]')
  input.value = 'theme'
  input.dispatchEvent(new w.Event('input', { bubbles: true }))
  await sleep(400)
  const q = calls.filter((c) => c[0] === '/kybernos-search/query').pop()
  ok('a query asks the host for the host scopes only', q !== undefined && q[1].q === 'theme' && JSON.stringify(q[1].scopes) === '["chat","skill","lesson"]', q)
  ok('memories and creations are read from the routes the page already uses', calls.some((c) => c[0] === '/kybernos-cloud/memory') && calls.some((c) => c[0] === '/kybernos/state'))
  const rows = [...doc.querySelectorAll('[data-act="result"]')]
  ok('results from all scopes are listed, grouped', rows.length === 3, rows.length)
  const html = doc.querySelector('.kbsr-list').innerHTML
  ok('a chat\'s text is shown as text: a tag in it is escaped, never an element', !doc.querySelector('.kbsr-list img') && !doc.querySelector('.kbsr-list script') && html.includes('&lt;img') && html.includes('&lt;script&gt;'))
  ok('the matches are <mark> elements', doc.querySelectorAll('.kbsr-list mark').length >= 2)
  doc.querySelector('[data-scope="memory"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  await sleep(400)
  ok('a scope chip turns a scope off, and the results follow', doc.querySelector('[data-scope="memory"]').getAttribute('aria-pressed') === 'false' && [...doc.querySelectorAll('[data-act="result"]')].length === 2)
  ok('the choice is remembered on this computer', JSON.parse(w.localStorage.getItem('kybernos.search.scopes')).indexOf('memory') < 0)
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  ok('Enter opens the selected chat like a pinned one, and closes', JSON.stringify(opened) === '["session-1"]' && doc.querySelector('[data-kb="search-dialog"]') === null, { opened })
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
  ok('Cmd+K opens it', doc.querySelector('[data-kb="search-dialog"]') !== null)
  ok('the dialog remembers nothing typed from last time: an empty box and the explanation', doc.querySelector('[data-kb="search-input"]').value === '' && /Rien ne quitte|Nothing leaves/.test(doc.querySelector('.kbsr-empty').textContent))
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  ok('Escape closes it and removes it from the page', doc.querySelector('[data-kb="search-dialog"]') === null)
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  ok('Ctrl+K again toggles it closed', doc.querySelector('[data-kb="search-dialog"]') === null)
  // the host does not answer: the dialog says so, it does not break
  hostAnswer = null
  w.__KB_SEARCH__.open()
  const i2 = doc.querySelector('[data-kb="search-input"]')
  w.fetch = () => Promise.reject(new Error('offline'))
  i2.value = 'zzz'
  i2.dispatchEvent(new w.Event('input', { bubbles: true }))
  await sleep(400)
  ok('an unreachable host is said, not thrown', /did not answer|n’a pas répondu/.test(doc.querySelector('.kbsr-empty').textContent))
  w.__KB_SEARCH__.close()
  effects.forEach((c) => { try { c() } catch (e) { /* */ } })
  ok('cleanup removes the icon, the style and the opener', doc.querySelector('[data-kb="search-header"]') === null && doc.querySelector('style[data-plugin="@local/kybernos-search"]') === null && w.__KB_SEARCH__ === undefined)
  w.close()
}

console.log('\n' + (total - failed) + '/' + total + (failed === 0 ? ' ✓' : ' ✗ ' + failed + ' failure(s)'))
process.exit(failed === 0 ? 0 : 1)
