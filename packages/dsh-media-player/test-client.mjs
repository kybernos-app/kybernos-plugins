// dsh-media-player: the language of the player, offline (no browser). A2-24 of the 2026-10-16 audit: the « zh » dictionary was
// French, and the French of Kybernos (locale id « kybernos ») got nothing.
//
//   node packages/dsh-media-player/test-client.mjs
//
// The real client/client.js is loaded under a fake DSH module loader and a fake plugin context; what is checked is which
// dictionaries it registers, that each one reads in its own language, and which table the labels come from for each language
// the page can resolve to. test/verify.py (Playwright) keeps checking the rendering in a real browser.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'client', 'client.js'), 'utf8')

let langue = 'en'
let definition = null
globalThis.window = {
  __ModuleLoader__: { load: (d) => { definition = d } },
  __KB_LANG_RESOLVE__: () => { if (langue === 'throws') throw new Error('not ready'); return langue },
}
globalThis.document = { documentElement: { lang: 'en' }, createElement: () => ({ style: {}, remove () {} }), head: { appendChild () {} } }
new Function('window', 'document', source)(globalThis.window, globalThis.document)
const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }), useMemo: (f) => f(), useState: (v) => [v, () => {}], useEffect: () => {} }
const exported = definition.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) })

console.log('dsh-media-player: language')
assert.equal(typeof exported.apply, 'function')
let registered = null
const ctx = {
  effect: (fn) => fn(),
  locale: { bind: () => (key) => 'DSH:' + key, register: (ns, dictionaries) => { registered = { ns, dictionaries }; return () => {} } },
  slots: { inject: () => () => {}, register: () => () => {} },
  inject: () => {},
}
exported.apply(ctx)
assert.ok(registered !== null)
const { en, zh, kybernos } = registered.dictionaries
assert.deepEqual(Object.keys(registered.dictionaries).sort(), ['en', 'kybernos', 'zh'])
ok('three dictionaries are registered: English, Chinese, and the French of Kybernos under its locale id « kybernos » (not « fr »)')

const keys = Object.keys(en).sort()
assert.deepEqual(Object.keys(zh).sort(), keys)
assert.deepEqual(Object.keys(kybernos).sort(), keys)
ok('each table carries the same labels')

const FRENCH = /[àâçéèêëîïôùûœ]|\b(le|la|les|du|des|ce|une?|à|pour|ne|pas|ouvrir|lecture)\b/i
assert.ok(Object.values(zh).every((text) => /[一-鿿]/.test(text) && !FRENCH.test(text) && !/^\s/.test(text)), 'zh is Chinese, with no French and no leading space')
ok('the « zh » table is Chinese (it was French, with a leading space in the title)')
assert.ok(Object.values(en).every((text) => !/[àâçéèêëîïôùûœ]/.test(text) && !/\b(Ouvrir|Lecteur|Lecture|fichier)\b/.test(text)))
ok('the English table is English')
assert.equal(kybernos.openExternal, 'Ouvrir à part')
assert.equal(kybernos.audio, 'Lecteur audio')
assert.equal(kybernos.title, 'Média')
ok('the French table is French (« Ouvrir à part », « Lecteur audio »: what the French help quotes)')

// which table the labels come from, for each language the page can resolve to
const labels = (lg) => { langue = lg; return exported.__test.localized((key) => 'DSH:' + key)('openExternal') }
assert.equal(labels('kybernos'), 'Ouvrir à part')
assert.equal(labels('fr'), 'Ouvrir à part')
assert.equal(labels('fr-CA'), 'Ouvrir à part')
ok('French (the Kybernos default or a fr base): the French label')
for (const lg of ['en', 'es', 'ar', 'zh', 'de']) assert.equal(labels(lg), 'DSH:openExternal', lg)
ok('English, Chinese and every other language: DSH\'s own label (its English or Chinese table), never French')
assert.equal(labels('throws'), 'DSH:openExternal')
ok('a language that is not known yet: not French')
langue = 'en'
assert.equal(exported.__test.localized((key) => 'DSH:' + key)('nothing-like-this'), 'DSH:nothing-like-this')
ok('a label the French table does not have falls to DSH\'s own')

// a registration that DSH refuses (the French locale not added yet) must not lose English and Chinese
let calls = 0
let kept = null
const ctx2 = { ...ctx, locale: { bind: () => (key) => key, register: (ns, dictionaries) => { calls += 1; if ('kybernos' in dictionaries) throw new Error('unknown language kybernos'); kept = dictionaries; return () => {} } } }
exported.apply(ctx2)
assert.equal(calls, 2)
assert.deepEqual(Object.keys(kept).sort(), ['en', 'zh'])
ok('if DSH does not know the French locale yet, English and Chinese are still registered')

console.log('\n' + pass + ' checks passed')
