// The editor script that runs inside the sandboxed page (editor/ky-edit.js), read as text: it compiles, it reaches the outside through the bridge only, it asks
// the DSH page for what the DSH page answers, and every English sentence it draws has its French (the editor wears the language of the person's DSH, set by the
// host in `data-lang`; English is the source, French the dictionary). What it does to a real page is checked on the real GUI (scripts/check-kybernos-maquettes-live.mjs).
//
//   node packages/kybernos-maquettes/test-editor.mjs
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { API_OPS } from './routes.mjs'
import { paletteFor } from './maquette-lib.mjs'

let failed = 0
const ok = (label, fn) => { try { fn(); console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }
const must = (cond, msg) => { if (!cond) throw new Error(msg) }

const editor = readFileSync(new URL('./editor/ky-edit.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

console.log('Kybernos maquettes: the editor script')

ok('it compiles as a classic script', () => { new vm.Script(editor, { filename: 'ky-edit.js' }) })

ok('it starts once per page and reads its page name and language from its own tag', () => {
  must(editor.includes('if (window.__kyEdit) return;'), 'no once-guard')
  must(editor.includes('document.currentScript') && editor.includes('dataset.file') && editor.includes('dataset.lang'), 'tag attributes not read')
})

ok('the page has no way out but the bridge: no fetch, XHR, storage, cookie, eval, websocket or beacon', () => {
  for (const bad of ['fetch(', 'XMLHttpRequest', 'sessionStorage', 'localStorage', 'document.cookie', 'eval(', 'new Function', 'WebSocket', 'sendBeacon', 'indexedDB', 'importScripts']) {
    must(!editor.includes(bad), 'the editor uses ' + bad)
  }
})

ok('typing over a whole text follows the new text node, and an edit reaching past the text is refused', () => {
  must(editor.includes('function keepNode(') && (editor.match(/keepNode\(el, sel\.snap/g) || []).length === 2, 'keepNode is not used by both text paths')
  must(editor.includes("addEventListener('beforeinput'") && editor.includes('intersectsNode'), 'no guard on edits that reach past the text')
})

ok('it answers only the page around it (messages from anything else are ignored)', () => {
  must(editor.includes('e.source !== parent'), 'the reply is not checked against parent')
})

const bridgeTypes = [...editor.matchAll(/bridge\('([a-z-]+)'/g)].map((m) => m[1])
const ops = [...editor.matchAll(/\bapi\('([a-z]+)'/g)].map((m) => m[1]).concat([...editor.matchAll(/bridge\('api', \{ op: '([a-z]+)'/g)].map((m) => m[1]))
ok('every message type it sends is one the DSH page handles', () => {
  const handled = ['api', 'upload', 'kv-get', 'kv-set', 'ask']
  must(bridgeTypes.length > 0, 'no bridge call found')
  for (const t of new Set(bridgeTypes)) {
    must(handled.includes(t), 'unhandled type ' + t)
    must(client.includes("'" + t + "'") || t === 'api', 'the client does not mention ' + t)
  }
  for (const t of handled) must(client.includes("msg.type === '" + t + "'"), 'the client does not handle ' + t)
})
ok('every operation it asks of the host is on the host\'s list, and the DSH page forwards the same list', () => {
  must(ops.length >= 6, 'operations found: ' + ops.join())
  for (const o of new Set(ops)) must(API_OPS.includes(o), 'not a host operation: ' + o)
  const listed = /const API_OPS = (\[[^\]]*\])/.exec(client)
  must(listed !== null && JSON.stringify(JSON.parse(listed[1].replace(/'/g, '"'))) === JSON.stringify(API_OPS), 'the client list differs from the host list')
})

// ── the French ──────────────────────────────────────────────────────────────────────────────────
// The editor's words are English in the source. The French of each lives in ROWS as [fr, en] (French first, as the language policy wants it), and
// `tx` / `i18n` swap English for French only when the DSH speaks French.
const open = editor.indexOf('const ROWS = [')
const close = editor.indexOf('\n  ];', open)
const ROWS = new Function('return ' + editor.slice(open + 'const ROWS = '.length, close + 4))()
const body = editor.slice(0, open) + editor.slice(close)
const ENS = new Set(ROWS.map((r) => r[1]))

ok('the French dictionary is read (' + ROWS.length + ' sentences), each row a [fr, en] pair of non-empty strings', () => {
  must(ROWS.length > 200, 'only ' + ROWS.length)
  const bad = ROWS.filter((r) => !Array.isArray(r) || r.length !== 2 || typeof r[0] !== 'string' || typeof r[1] !== 'string' || !r[0].trim() || !r[1].trim())
  must(bad.length === 0, 'not a [fr, en] pair: ' + JSON.stringify(bad.slice(0, 2)))
})

ok('the English is the key: no two rows share an English, so the French can always be found again', () => {
  const seen = new Map()
  for (const [fr, en] of ROWS) { if (seen.has(en)) throw new Error('"' + en + '" is the English of both "' + seen.get(en) + '" and "' + fr + '"'); seen.set(en, fr) }
})

ok('every English sentence has a French that is not the English, and no French accent hides in an English', () => {
  // words that are the same in both languages (a name, a tag, a unit) are fine; a sentence is not
  const same = ROWS.filter(([fr, en]) => fr === en && en.includes(' ') && /[a-z]{4}/.test(en))
  must(same.length === 0, 'untranslated: ' + same.slice(0, 5).map((r) => r[1]).join(' | '))
  const accented = ROWS.filter(([, en]) => /[àâçéèêëîïôùûœÀÉÈ]/.test(en))
  must(accented.length === 0, 'French letters in the English of: ' + accented.slice(0, 5).map((r) => r[1]).join(' | '))
})

ok('no English word is left in a French sentence', () => {
  const english = /(?<![\p{L}-])(the|and|your|this|that|with|from|you|are|not|can|will|here|nothing|choose|click|save|cancel|delete|picture|block|text)(?![\p{L}-])/iu
  const off = ROWS.filter(([fr, en]) => fr !== en && english.test(fr))
  must(off.length === 0, 'English in the French of: ' + off.slice(0, 5).map((r) => r[0]).join(' | '))
})

ok('a French sentence and its English keep the same ${…} and %s places', () => {
  const marks = (s) => (s.match(/\$\{[^}]*\}|%s|%d|\{\w+\}/g) || []).join()
  const off = ROWS.filter(([fr, en]) => marks(fr) !== marks(en))
  must(off.length === 0, 'places differ in: ' + off.slice(0, 5).map((r) => r[1]).join(' | '))
})

ok('a French sentence is never the English of another row (the translating observer ends after one pass)', () => {
  const loops = ROWS.filter(([fr, en]) => fr !== en && ENS.has(fr))
  must(loops.length === 0, 'would be translated twice: ' + loops.slice(0, 5).map((r) => r[0]).join(' | '))
})

ok('tx() and i18n() answer French only for French; every other language keeps the English; the observer starts only for French', () => {
  must(editor.includes('const tx = (en) => (F && FR.has(en) ? FR.get(en) : en);'), 'tx is not English-first')
  must(editor.includes('const FR = new Map(ROWS.map(([fr, en]) => [en, fr]));'), 'FR is not built from the rows')
  must(/function i18n\(node\) \{\s*if \(!F\) return;/.test(editor) && /function startI18n\(\) \{\s*if \(!F\) return;/.test(editor), 'i18n or its observer runs for English')
  must(editor.includes("const LANG = SCRIPT && SCRIPT.dataset.lang === 'fr' ? 'fr' : 'en';"), 'the language is not French only when the host says so')
  must(editor.includes('const kt = (fr, en) => (F ? fr : en);'), 'the pair helper is not (fr, en)')
})

ok('no sentence is picked by a bare language test any more (everything goes through tx, i18n or kt)', () => {
  const ternaries = [...body.replace(/const kt = .*\n/, '').matchAll(/\b(?:F|LANG === 'fr') \?/g)].map((m) => m[0])
  must(ternaries.length === 0, ternaries.length + ' left')
})

ok('a block the editor looks up by kind is one the host offers (a kind is an id, never a sentence to translate)', () => {
  const kinds = new Set(paletteFor('en').map((b) => b.kind))
  const looked = [...body.matchAll(/palette\.find\(\(\w+\) => \w+\.kind === '([a-z]+)'\)/g)].map((m) => m[1])
  must(looked.length >= 2, 'no kind lookup found')
  const unknown = looked.filter((k) => !kinds.has(k) && true)
  must(unknown.length === 0, 'not a host kind: ' + unknown.join(', '))
})

ok('every sentence passed to tx() has its French row', () => {
  const missing = []
  for (const m of body.matchAll(/\btx\('((?:[^'\\\n]|\\.)*)'\)/g)) {
    const en = m[1].replace(/\\'/g, "'")
    if (!ENS.has(en) && /[A-Za-z]{3}/.test(en)) missing.push(en)
  }
  must(missing.length === 0, missing.length + ' without French: ' + [...new Set(missing)].slice(0, 6).join(' | '))
})

ok('no row is dead (the English of each appears somewhere else in the script)', () => {
  const dead = ROWS.filter(([, en]) => !body.includes(en.replace(/'/g, "\\'")) && !body.includes(en))
  must(dead.length === 0, dead.length + ' unused: ' + dead.slice(0, 4).map((r) => r[1]).join(' | '))
})

ok('the script stays a single reviewable file under 160 KB', () => { must(editor.length < 160 * 1024, editor.length + ' bytes') })

console.log(failed === 0 ? '\nEDITOR — all passed' : '\nEDITOR — ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
