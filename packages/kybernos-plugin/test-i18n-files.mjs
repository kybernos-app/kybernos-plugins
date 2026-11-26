// The core's page texts live in i18n/fr.json and i18n/en.json, not in client.js (2026-11-23, the « KB_T » move). This test holds the rules that move needs:
//   1. the two files have the SAME keys (a key in one language and not the other fails here, naming it), plain non-empty strings, the same {placeholders};
//   2. every literal kbt('key') of client.js has an entry (a typo would show the bare key on the page);
//   3. the route answers what the page asks, leaves a broken file out instead of failing, never reads a path the caller chose, and revalidates by ETag;
//   4. the loader in client.js is first (before any kbt call), is ONE synchronous request, and turns every failure into « less text », never an error;
//   5. kbt falls back English -> French -> key, so a language file that cannot be read never stops DSH or leaves a hole.
//
//   node packages/kybernos-plugin/test-i18n-files.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { I18N_LANGS, i18nAnswer, readI18nLanguage, wantedI18nLanguages } from './i18n-files.mjs'
import { I18N_DIR, PLUGIN_DIR, kbDictLoadSource, loadTable, loadTableWithCalls, readClient, readFiles } from './lib-i18n-test.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const tmp = mkdtempSync(join(tmpdir(), 'kb-i18n-'))
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* gone */ } })
const fixture = (files) => { const d = mkdtempSync(join(tmp, 'd-')); for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text); return d }

const { fr, en } = readFiles()
const client = readClient()

// ── 1. the files ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  assert.ok(Object.keys(en).length > 2000, 'the files carry the dictionary (' + Object.keys(en).length + ' keys)')
  const onlyEn = Object.keys(en).filter((k) => !(k in fr))
  const onlyFr = Object.keys(fr).filter((k) => !(k in en))
  assert.deepEqual(onlyEn, [], 'keys that have an English text and no French one: ' + onlyEn.slice(0, 10).join(', '))
  assert.deepEqual(onlyFr, [], 'keys that have a French text and no English one: ' + onlyFr.slice(0, 10).join(', '))
  ok('fr.json and en.json hold exactly the same ' + Object.keys(en).length + ' keys')

  const bad = []
  for (const lang of [['fr', fr], ['en', en]]) for (const [k, v] of Object.entries(lang[1])) if (typeof v !== 'string' || v.trim() === '') bad.push(lang[0] + ':' + k)
  assert.deepEqual(bad, [], 'texts that are not a non-empty string: ' + bad.slice(0, 10).join(', '))
  ok('every text of both files is a non-empty string')

  const ph = (s) => (s.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort().join(',')
  const mismatch = Object.keys(en).filter((k) => ph(fr[k]) !== ph(en[k]))
  assert.deepEqual(mismatch, [], 'the French and English texts do not use the same {placeholders}: ' + mismatch.slice(0, 10).join(', '))
  ok('each key uses the same {placeholders} in French and English')

  // JSON.parse keeps the LAST of two equal keys without a word, so a pasted duplicate would silently win or lose: read the raw lines.
  for (const lang of ['fr', 'en']) {
    const seen = new Set()
    const twice = []
    for (const m of readFileSync(join(I18N_DIR, lang + '.json'), 'utf8').matchAll(/^  ("(?:[^"\\]|\\.)*"): /gm)) { if (seen.has(m[1])) twice.push(m[1]); seen.add(m[1]) }
    assert.deepEqual(twice, [], lang + '.json names a key twice: ' + twice.slice(0, 10).join(', '))
    assert.equal(seen.size, Object.keys(lang === 'fr' ? fr : en).length, lang + '.json: one entry per line, one line per key')
  }
  ok('no key appears twice in either file (one entry per line)')

  const bareKeys = Object.keys(en).filter((k) => !/^[A-Za-z0-9][A-Za-z0-9_.\-]*$/.test(k))
  assert.deepEqual(bareKeys, [], 'keys with an odd shape: ' + bareKeys.slice(0, 10).join(', '))
  ok('every key is a plain dotted id')

  // the order in the files is the order of the table the page builds (the language plugin lists keys in that order)
  assert.deepEqual(Object.keys(loadTable()), Object.keys(fr))
  ok('the table the page builds lists the keys in the files\' order')
}

// ── 2. the keys the code reads ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const literal = new Set([...client.matchAll(/\bkbt\(\s*'([^'\\]+)'\s*[,)]/g)].map((m) => m[1]))
  assert.ok(literal.size > 1000, 'the scan found the kbt calls (' + literal.size + ')')
  const missing = [...literal].filter((k) => !(k in en))
  assert.deepEqual(missing, [], 'kbt(\'…\') of client.js with no entry (the page would show the bare key): ' + missing.slice(0, 10).join(', '))
  ok(literal.size + ' literal kbt keys of client.js all have a text')
  assert.equal(client.split('\n').filter((l) => /^\s+'[A-Za-z0-9_.\-]+': \{ kybernos: '/.test(l)).length, 0, 'client.js must not carry dictionary lines again: add the key to both i18n files')
  ok('client.js carries no dictionary entry any more')
}

// ── 3. the route ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const both = i18nAnswer(I18N_DIR, 'fr,en', null)
  assert.equal(both.status, 200)
  const body = JSON.parse(both.body)
  assert.equal(body.ok, true)
  assert.deepEqual(body.missing, [])
  assert.deepEqual(body.langs.fr, fr)
  assert.deepEqual(body.langs.en, en)
  assert.match(both.headers['content-type'], /^application\/json/)
  assert.equal(both.headers['cache-control'], 'no-cache')
  assert.equal(both.headers['content-length'], String(Buffer.byteLength(both.body)))
  ok('GET ?lang=fr,en answers both files, as JSON, with a length and no-cache')

  assert.deepEqual(Object.keys(JSON.parse(i18nAnswer(I18N_DIR, 'en', null).body).langs), ['en'])
  assert.deepEqual(Object.keys(JSON.parse(i18nAnswer(I18N_DIR, null, null).body).langs).sort(), ['en', 'fr'], 'no ?lang = every language')
  assert.deepEqual(wantedI18nLanguages('en,en, fr ,../etc/passwd,xx'), ['en', 'fr'])
  assert.deepEqual(wantedI18nLanguages('../../x'), I18N_LANGS.slice(), 'nothing known asked = all, never a path')
  assert.equal(readI18nLanguage(I18N_DIR, '../i18n/fr'), null)
  assert.equal(readI18nLanguage(I18N_DIR, 'ar'), null, 'a language with no file here is not read')
  ok('only fr and en are ever read; the id is never a path')

  const etag = both.headers.etag
  assert.match(etag, /^"[0-9a-f]{20}"$/)
  const again = i18nAnswer(I18N_DIR, 'fr,en', etag)
  assert.equal(again.status, 304)
  assert.equal(again.body, '')
  assert.equal(i18nAnswer(I18N_DIR, 'fr,en', '"other"').status, 200)
  assert.notEqual(i18nAnswer(I18N_DIR, 'en', null).headers.etag, etag, 'another set of languages is another ETag')
  ok('If-None-Match with the current ETag costs a 304; a stale one gets the body')

  // a broken file is left out, the other still comes
  const noFr = i18nAnswer(fixture({ 'en.json': '{"a":"A"}' }), 'fr,en', null)
  assert.equal(noFr.status, 200)
  assert.deepEqual(JSON.parse(noFr.body), { ok: true, langs: { en: { a: 'A' } }, missing: ['fr'] })
  const badFr = JSON.parse(i18nAnswer(fixture({ 'fr.json': '{not json', 'en.json': '{"a":"A","n":3,"o":{"x":1}}' }), 'fr,en', null).body)
  assert.deepEqual(badFr, { ok: true, langs: { en: { a: 'A' } }, missing: ['fr'] }, 'a corrupt file is left out; a value that is not a string is dropped')
  assert.deepEqual(JSON.parse(i18nAnswer(fixture({ 'fr.json': '[1,2]', 'en.json': 'null' }), 'fr,en', null).body), { ok: false, langs: {}, missing: ['fr', 'en'] }, 'an array or null is no dictionary')
  assert.deepEqual(JSON.parse(i18nAnswer(join(tmp, 'no-such-dir'), 'fr,en', null).body), { ok: false, langs: {}, missing: ['fr', 'en'] }, 'no folder = nothing, not an error')
  ok('a missing, corrupt or non-object file is left out of the answer, never an error')

  // the route in index.js
  const host = readFileSync(join(PLUGIN_DIR, 'index.js'), 'utf8')
  const at = host.indexOf("path: '/kybernos/i18n'")
  assert.ok(at > 0, 'index.js registers /kybernos/i18n')
  const handler = host.slice(at, host.indexOf("'kybernos: route i18n'", at))
  assert.match(handler, /req\.method !== 'GET' && req\.method !== 'HEAD'/, 'GET and HEAD only')
  assert.match(handler, /i18nAnswer\(pluginDir \+ '\/i18n'/, 'it serves ./i18n of the plugin folder')
  assert.match(host, /import \{ i18nAnswer \} from '\.\/i18n-files\.mjs'/)
  ok('index.js wires GET/HEAD /kybernos/i18n to the folder ./i18n')
}

// ── 4. the loader in client.js ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const loaderAt = client.indexOf('const KB_T = kbDictLoad()')
  assert.ok(loaderAt > 0)
  const firstKbt = client.search(/(^|[^\w$.])kbt\(/m)
  const code = client.slice(0, loaderAt).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  assert.equal(/(^|[^\w$.])kbt\(/.test(code), false, 'no kbt( call before the loader, comments aside (first at ' + firstKbt + ', loader at ' + loaderAt + ')')
  assert.equal(/\bKB_T\[/.test(code), false, 'KB_T is not read before it exists')
  assert.ok(client.indexOf('try {') < loaderAt && loaderAt < client.indexOf('const kbt = (key)'), 'the loader runs inside the factory guard, before kbt is defined')
  ok('the loader is the first thing the factory does with the dictionary: before kbt and every read of KB_T')

  const { table, calls } = loadTableWithCalls()
  assert.equal(calls.length, 1, 'one request')
  assert.deepEqual(calls[0], { method: 'GET', url: '/kybernos/i18n?lang=fr,en', async: false })
  ok('it is ONE synchronous GET /kybernos/i18n?lang=fr,en (async=false: kbt is called while the factory runs)')
  assert.equal(table['tb.sort.by'].kybernos, fr['tb.sort.by'])
  assert.equal(table['tb.sort.by'].en, en['tb.sort.by'])
  assert.deepEqual(Object.keys(table['tb.sort.by']), ['kybernos', 'en'], 'the shape the language plugin reads')
  ok('the table has the shape it always had: { key: { kybernos, en } }')

  const baseOf = (re) => { const m = re.exec(client); return m === null ? null : m[1] }
  assert.equal(baseOf(/let base = '\/kybernos'\n\s+try \{ base = (new URL\('kybernos', document\.baseURI\)\.pathname\.replace\(\/\\\/\$\/, ''\)) \}/), baseOf(/const kbApiBase = \(\) => \{\n\s+try \{ return (new URL\('kybernos', document\.baseURI\)\.pathname\.replace\(\/\\\/\$\/, ''\)) \}/), 'the loader finds the host the way kbApiBase does (same expression)')
  assert.equal(loadTableWithCalls({ baseURI: 'https://box.example/dsh/' }).calls[0].url, '/dsh/kybernos/i18n?lang=fr,en', 'under a sub-path (a hosted DSH) the route is under it too, as kbApiBase does')
  ok('the route is looked up from the page base like every other call of the client')

  // failures: less text, never an error
  const ans = (a) => () => a
  const frOnly = loadTable({ respond: ans({ status: 200, body: JSON.stringify({ ok: true, langs: { fr: { k: 'Bonjour' } }, missing: ['en'] }) }) })
  assert.deepEqual(frOnly, { k: { kybernos: 'Bonjour' } })
  const enOnly = loadTable({ respond: ans({ status: 200, body: JSON.stringify({ ok: true, langs: { en: { k: 'Hello' } }, missing: ['fr'] }) }) })
  assert.deepEqual(enOnly, { k: { en: 'Hello' } })
  for (const [name, respond] of [
    ['a 404 (a host that has no route yet)', ans({ status: 404, body: '' })],
    ['a 500', ans({ status: 500, body: 'oops' })],
    ['an answer that is not JSON', ans({ status: 200, body: '<html>' })],
    ['an answer with no languages', ans({ status: 200, body: '{"ok":false}' })],
    ['a null body', ans({ status: 200, body: 'null' })],
    ['languages that are not objects', ans({ status: 200, body: '{"langs":{"fr":"x","en":[1]}}' })],
    ['a refused connection (the request throws)', () => { throw new Error('network error') }],
  ]) assert.deepEqual(loadTable({ respond }), {}, name + ' gives an empty table')
  assert.deepEqual(loadTable({ respond: ans({ status: 200, body: JSON.stringify({ langs: { en: { a: 'A', b: 3, c: null } } }) }) }), { a: { en: 'A' } }, 'a text that is not a string is skipped')
  assert.deepEqual(loadTable({ respond: ans({ status: 200, body: '{"langs":{"fr":{"__proto__":"x","constructor":"y"},"en":{}}}' }) }), loadTable({ respond: ans({ status: 200, body: '{"langs":{"fr":{"__proto__":"x","constructor":"y"},"en":{}}}' }) }), 'odd keys are stable')
  // a client with no XMLHttpRequest at all (tests, a worker image): the loader returns {} instead of throwing
  const noXhr = vm.runInNewContext('(() => {\n' + kbDictLoadSource() + '\nreturn kbDictLoad() })()', { document: { baseURI: 'http://x/' }, URL, Object, JSON })
  assert.equal(Object.keys(noXhr).length, 0)
  ok('every failure (404, 500, bad JSON, no XHR, refused connection, one language missing) ends in a table with less text, never a throw')
}

// ── 5. kbt: English, then French, then the key ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const at = client.indexOf('const kbt = (key) => {')
  const src = client.slice(at, client.indexOf('\n}\n', at) + 3)
  const make = ({ lang, KB_T, dict }) => vm.runInNewContext(src + '\nkbt', { kbLangResolve: () => lang, KB_T, kbI18nDict: () => dict ?? null, String })
  const T = { both: { kybernos: 'Oui', en: 'Yes' }, onlyEn: { en: 'Only English' }, onlyFr: { kybernos: 'Seulement français' } }
  assert.equal(make({ lang: 'kybernos', KB_T: T })('both'), 'Oui')
  assert.equal(make({ lang: 'en', KB_T: T })('both'), 'Yes')
  assert.equal(make({ lang: 'kybernos', KB_T: T })('onlyEn'), 'Only English', 'the French file could not be read: the English text')
  assert.equal(make({ lang: 'en', KB_T: T })('onlyFr'), 'Seulement français', 'the English file could not be read: the French text, better than a bare key')
  assert.equal(make({ lang: 'en', KB_T: T })('nowhere'), 'nowhere', 'nothing at all: the key')
  assert.equal(make({ lang: 'en', KB_T: {} })('tb.sort.by'), 'tb.sort.by', 'no file at all: the key, and nothing throws')
  assert.equal(make({ lang: 'ar', KB_T: T, dict: { both: 'نعم' } })('both'), 'نعم', 'a translated language still comes from its pack')
  assert.equal(make({ lang: 'ar', KB_T: T, dict: {} })('both'), 'Yes', 'a language with no pack text gets English')
  ok('kbt: language text, else the generated pack, else English, else French, else the key')
}

mkdirSync(tmp, { recursive: true })
console.log('\n' + pass + ' checks passed')
