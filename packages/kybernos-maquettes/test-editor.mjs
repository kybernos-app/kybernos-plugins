// The editor script that runs inside the sandboxed page (editor/ky-edit.js), read as text: it compiles, it reaches the outside through the bridge only, it asks
// the DSH page for what the DSH page answers, and every French sentence it draws has its English (the editor wears the language of the person's DSH, set by the
// host in `data-lang`). What it does to a real page is checked on the real GUI (scripts/check-kybernos-maquettes-live.mjs).
//
//   node packages/kybernos-maquettes/test-editor.mjs
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { API_OPS } from './routes.mjs'

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

// ── the English ─────────────────────────────────────────────────────────────────────────────────
const open = editor.indexOf('const EN = {')
const close = editor.indexOf('\n  };', open)
const EN = new Function('return ' + editor.slice(open + 'const EN = '.length, close + 4))()
const keys = Object.keys(EN)

ok('the English dictionary is read (' + keys.length + ' sentences)', () => { must(keys.length > 200, 'only ' + keys.length) })

ok('every sentence has an English that is not the French and holds no French accent', () => {
  const same = keys.filter((k) => EN[k] === k && /[a-z]{4}/.test(k))
  // words that are the same in both languages (a name, a tag, a unit) are fine; a sentence is not
  const sentences = same.filter((k) => k.includes(' '))
  must(sentences.length === 0, 'untranslated: ' + sentences.slice(0, 5).join(' | '))
  const accented = keys.filter((k) => /[àâçéèêëîïôùûœÀÉÈ]/.test(EN[k]))
  must(accented.length === 0, 'French letters in the English of: ' + accented.slice(0, 5).join(' | '))
})

ok('a sentence and its English keep the same ${…} and %s places', () => {
  const marks = (s) => (s.match(/\$\{[^}]*\}|%s|%d|\{\w+\}/g) || []).join()
  const off = keys.filter((k) => marks(k) !== marks(EN[k]))
  must(off.length === 0, 'places differ in: ' + off.slice(0, 5).join(' | '))
})

ok('every sentence passed to tx() has its English', () => {
  const missing = []
  for (const m of editor.matchAll(/\btx\('((?:[^'\\\n]|\\.)*)'\)/g)) {
    const fr = m[1].replace(/\\'/g, "'")
    if (EN[fr] === undefined && /[a-zà-ÿ]{3}/i.test(fr)) missing.push(fr)
  }
  must(missing.length === 0, missing.length + ' without English: ' + [...new Set(missing)].slice(0, 6).join(' | '))
})

ok('no key of the dictionary is dead (each appears somewhere else in the script)', () => {
  const rest = editor.slice(close)
  const body = editor.slice(0, open) + rest
  const dead = keys.filter((k) => !body.includes(k.replace(/'/g, "\\'")) && !body.includes(k))
  must(dead.length === 0, dead.length + ' unused: ' + dead.slice(0, 4).join(' | '))
})

ok('the script stays a single reviewable file under 160 KB', () => { must(editor.length < 160 * 1024, editor.length + ' bytes') })

console.log(failed === 0 ? '\nEDITOR — all passed' : '\nEDITOR — ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
