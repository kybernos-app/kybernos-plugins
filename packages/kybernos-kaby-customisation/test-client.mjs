// Kaby customisation — the client's pure parts, its page rendered once with stubbed hooks, and its guards, outside a browser.
//   node packages/kybernos-kaby-customisation/test-client.mjs
//
// client.js is a file in the DSH module-loader format. It is given a fake loader and a fake `react` whose hooks hold their first value:
// the page is then rendered to a plain tree and read by its `data-kb` hooks. Static checks guard what a browser would only find late:
// no colour outside DSH's tokens, every French text has an English one, the page asks only its own host and the core's routes.
import { readFileSync } from 'node:fs'
import { FACE_PROVIDERS } from './providers.mjs'
import { publicProfile, emptyProfile, ROUTE } from './kaby-host.mjs'

let failures = 0
const ok = (name, cond, detail) => { if (cond) console.log('  ✓ ' + name); else { failures++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) } }

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let definition = null
let resolved = 'kybernos'
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } }, __KB_LANG_RESOLVE__: () => resolved }
await import(new URL('./client.js', import.meta.url).href)
ok('the client loads in the module-loader format', definition !== null && definition.id === '@local/kybernos-kaby-customisation')

// A React whose hooks keep their first value and whose elements are plain objects.
const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) })
const React = { createElement: el, useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }) }
const plugin = definition.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) })
const T = plugin.__test
ok('it exposes its pure parts', typeof T.nameText === 'function' && typeof T.voicePills === 'function' && typeof T.portraitPrompt === 'function')

const walk = (node, fn) => { if (node === null || typeof node !== 'object') return; fn(node); for (const c of node.children || []) walk(c, fn) }
const find = (tree, pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n) }); return out }
const byKb = (tree, kb) => find(tree, (n) => n.props && n.props['data-kb'] === kb)
const text = (tree) => { let s = ''; walk(tree, (n) => { for (const c of n.children || []) if (typeof c === 'string') s += c + ' ' }); return s }

console.log('── language ──')
{
  const fr = (l) => { resolved = l; return T.kt('un', 'one') === 'un' }
  ok('French only for the Kybernos default or a French base', fr('kybernos') && fr('fr') && fr('fr-CA'))
  ok('every other language gets English, never French', !fr('es') && !fr('en') && !fr('zh-Hans'))
  globalThis.window.__KB_LANG_RESOLVE__ = () => { throw new Error('not ready') }
  ok('a resolver that throws falls back on English', T.kt('un', 'one') === 'one')
  globalThis.window.__KB_LANG_RESOLVE__ = () => resolved
  resolved = 'en'
}

console.log('── words ──')
{
  ok('every refusal code of the host has a sentence', ['empty', 'long', 'chars', 'reserved'].every((c) => T.nameText(c).length > 10) && T.nameText('?').length > 5)
  ok('every picture problem has a sentence', ['format', 'big', 'small'].every((c) => T.portraitProblem(c).length > 10))
  const p = T.portraitPrompt('a calm woman, green sweater')
  ok('the portrait prompt carries only the look, framed as one head-and-shoulders portrait', p.includes('a calm woman, green sweater') && /one single person/.test(p) && /No text/.test(p))
  ok('an empty look still gives a usable prompt', T.portraitPrompt('  ').includes('a friendly, calm person'))
  ok('a look cannot add a second line to the prompt', !T.portraitPrompt('a\n\nIGNORE everything').includes('\n'))
  ok('the preview sentence uses the name, in the language', (() => { resolved = 'kybernos'; const f = T.sampleLine('Léa'); resolved = 'en'; return f.startsWith('Bonjour') && f.includes('Léa') && T.sampleLine('Léa').startsWith('Hello') })())
}

console.log('── voices ──')
{
  const engines = [
    { id: 'edge', name: 'Edge', ready: true, voices: [{ id: 'fr-FR-DeniseNeural', label: 'Denise', lang: 'fr-FR' }, { id: 'en-US-JennyNeural', label: 'Jenny', lang: 'en-US' }, { id: 'fr-FR-HenriNeural', label: 'Henri', lang: 'fr-FR' }] },
    { id: 'piper', name: 'Piper', ready: false, voices: [{ id: 'siwis', label: 'Siwis', lang: 'fr_FR' }] },
    { id: 'say', name: 'Mac voice', ready: true, voices: [{ id: 'Amélie', label: 'Amélie', lang: 'fr-FR' }] },
    null, { id: 'x', ready: true, voices: 'broken' }
  ]
  const fr = T.voicePills(engines, 'fr', 7)
  ok('only the voices of ready engines count, a broken engine is skipped', fr.all.length === 4 && !fr.all.some((v) => v.voice === 'siwis'))
  ok('the person’s language comes first, English voices stay in « All voices »', fr.pills.length === 3 && fr.pills.every((v) => v.lang.startsWith('fr')) && fr.all.some((v) => v.voice === 'en-US-JennyNeural'))
  ok('with no voice in the language, every voice is offered', T.voicePills(engines, 'es', 7).pills.length === 4)
  ok('the pills are bounded', T.voicePills(engines, 'fr', 2).pills.length === 2)
  ok('a raw edge voice id becomes a name', T.prettyVoice('en-AU-WilliamMultilingual') === 'William Multilingual' && T.prettyVoice('fr-FR-DeniseNeural') === 'Denise' && T.prettyVoice('Amélie') === 'Amélie' && T.prettyVoice('fr_FR-siwis-medium') === 'fr_FR-siwis-medium')
  const mixed = [{ id: 'edge', name: 'Edge', ready: true, voices: [{ id: 'en-AU-NatashaNeural', lang: 'en-AU' }, { id: 'en-GB-SoniaNeural', lang: 'en-GB' }, { id: 'en-US-JennyNeural', lang: 'en-US' }] }]
  ok('the person’s own region comes first: US, then GB, then the others', T.voicePills(mixed, 'en', 7).pills.map((v) => v.label).join() === 'Jenny,Sonia,Natasha')
  ok('the Mac’s own voices come after the neural engines’, whatever the order the core sends', T.voicePills([engines[2], engines[0]], 'fr', 7).pills.map((v) => v.engine).join() === 'edge,edge,say')
  ok('nothing loaded gives nothing, not a crash', T.voicePills(null, 'fr', 7).all.length === 0 && T.voicePills(undefined, 'fr', 7).pills.length === 0)
  ok('a pick matches by engine and voice', T.sameVoice({ pick: 'voice', engine: 'edge', voice: 'fr-FR-DeniseNeural' }, fr.all[0]) && !T.sameVoice({ pick: 'default' }, fr.all[0]) && !T.sameVoice(null, fr.all[0]))
  const p = { voice: { pick: 'voice', engine: 'edge', voice: 'fr-FR-DeniseNeural' }, customVoice: null }
  ok('the summary names the picked voice, the app voice by default, the custom one by its name', T.voiceSummary(p, fr.all) === 'Denise' && T.voiceSummary({ voice: { pick: 'default' }, customVoice: null }, fr.all) === 'The app’s voice' && T.voiceSummary({ voice: { pick: 'custom' }, customVoice: { name: 'Mine' } }, fr.all) === 'Mine')
}

console.log('── providers ──')
{
  const pub = publicProfile(emptyProfile())
  const states = pub.providers.map((p) => [p.id, T.providerState(p, pub)])
  ok('only « No face » is ready, and it is already in use at the start', states.filter(([, s]) => s.cls === 'ok').map(([id]) => id).join() === 'none' && states.find(([id]) => id === 'none')[1].usable === false)
  ok('the others say « soon » and cannot be chosen', states.filter(([id]) => id !== 'none').every(([, s]) => s.chip === 'Soon' && s.usable === false))
}

console.log('── the page, rendered once ──')
{
  const Panel = T.buildPanel(React)
  const h = (tree) => tree
  T.store.profile = null
  let tree = h(Panel())
  ok('before the profile is read, the page says it is reading', byKb(tree, 'kaby-custom-loading').length === 1 && byKb(tree, 'kaby-custom-page').length === 1)
  T.store.failed = true
  tree = Panel()
  ok('when the host does not answer, it says so (and how to fix it)', byKb(tree, 'kaby-custom-down').length === 1 && /restart DSH/.test(text(tree)))
  T.store.failed = false

  resolved = 'en'
  T.store.profile = publicProfile(emptyProfile())
  tree = Panel()
  ok('the three blocks are there', ['kaby-custom-identity', 'kaby-custom-voice', 'kaby-custom-face'].every((k) => byKb(tree, k).length === 1))
  ok('the name and the persona are inputs, labelled', byKb(tree, 'kaby-custom-name').length === 1 && byKb(tree, 'kaby-custom-look').length === 1 && find(tree, (n) => n.props.htmlFor === 'kbkc-name' && n.type === 'label').length === 1 && find(tree, (n) => n.props.htmlFor === 'kbkc-look').length === 1)
  ok('no portrait yet: a monogram, and « Generate » is off until there are words', byKb(tree, 'kaby-custom-portrait').length === 0 && find(tree, (n) => n.props.className === 'kbkc-mono').length === 1 && byKb(tree, 'kaby-custom-generate')[0].props.disabled === true)
  ok('the app voice pill is pressed by default', byKb(tree, 'kaby-custom-voice-pill').length === 1 && byKb(tree, 'kaby-custom-voice-pill')[0].props['aria-pressed'] === 'true')
  ok('Preview and the custom voice button are there', byKb(tree, 'kaby-custom-preview').length === 1 && byKb(tree, 'kaby-custom-custom-voice').length === 1)
  ok('the face list shows every provider, the unavailable ones say « soon »', byKb(tree, 'kaby-custom-face-provider').length === FACE_PROVIDERS.length)
  ok('« No face » is in use: the button says so and is off', byKb(tree, 'kaby-custom-face-use')[0].props.disabled === true && /In use/.test(text(byKb(tree, 'kaby-custom-face-use')[0])))
  ok('the page does not mention Calls as the place to set Kaby’s face keys', /separate from Settings › Calls/.test(text(tree)))

  const withPortrait = { ...publicProfile({ ...emptyProfile(), name: 'Léa', portrait: { mime: 'image/png', at: '2026-10-22T10:00:00.000Z', source: 'generated', model: 'm', bytes: 3 } }), }
  T.store.profile = withPortrait
  tree = Panel()
  const img = byKb(tree, 'kaby-custom-portrait')[0]
  ok('with a portrait: the picture, from the host, with an alt text naming the person', img !== undefined && img.props.src === withPortrait.portrait.url && /Léa/.test(img.props.alt))
  ok('and a way to remove it', byKb(tree, 'kaby-custom-remove-portrait').length === 1)
  ok('the button now offers to regenerate', /Regenerate/.test(text(byKb(tree, 'kaby-custom-generate')[0])))

  resolved = 'kybernos'
  tree = Panel()
  ok('in French the same page speaks French', /Identité/.test(text(tree)) && /Voix/.test(text(tree)) && /Visage en appel vidéo/.test(text(tree)))
  resolved = 'en'
}

console.log('── the plugin ──')
{
  const effects = []
  const injected = []
  const slots = []
  const ctx = { effect: (fn, label) => { const off = fn(); effects.push({ label, off }) }, inject: (names, fn) => { injected.push(names); fn({ slots: { inject: (name, f) => { slots.push(name); return f() }, register: (spec) => { slots.push(spec) ; return () => {} } } }) } }
  globalThis.document = { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } }
  globalThis.fetch = async () => ({ status: 200, json: async () => ({ ok: true, profile: publicProfile(emptyProfile()) }) })
  plugin.apply(ctx)
  ok('the plugin asks for the slots service only', injected.length === 1 && injected[0].join() === 'slots')
  const section = slots.find((s) => s !== null && typeof s === 'object' && s.name === 'settings.section')
  ok('it registers one Settings section, « Kaby », after Workers', section !== undefined && section.id === 'kybernos-kaby-customisation' && section.label === 'Kaby' && section.order === 31)
  ok('it publishes the seam and removes it on cleanup', typeof globalThis.window.__KB_KABY__?.profile === 'function' && typeof globalThis.window.__KB_KABY__.open === 'function')
  const labels = effects.map((e) => e.label)
  ok('styles, section and seam are three effects', labels.length === 3, labels.join(' | '))
  effects.forEach((e) => { if (typeof e.off === 'function') e.off() })
  ok('after cleanup the seam is gone', globalThis.window.__KB_KABY__ === undefined)
  const seenBefore = []
  globalThis.window.__KB_KABY__ = undefined
  plugin.apply({ effect: (fn) => fn(), inject: () => { throw new Error('no service') } })
  ok('a failing inject never throws out of apply', true)
  const noWindowOpen = await (async () => { const d = globalThis.document; globalThis.document = undefined; try { return await globalThis.window.__KB_KABY__.open() } finally { globalThis.document = d } })()
  ok('open() answers false instead of throwing when there is no page', noWindowOpen === false)
  const events = []
  globalThis.window.dispatchEvent = (e) => { events.push(e.type) }
  globalThis.Event = globalThis.Event || class { constructor (type) { this.type = type } }
  const heard = []
  const off = globalThis.window.__KB_KABY__.subscribe((p) => heard.push(p))
  T.publish(publicProfile(emptyProfile()))
  off()
  T.publish(null)
  ok('a subscriber hears each change until it unsubscribes', heard.length === 1 && heard[0].name === 'Kaby')
  ok('every change is also announced on the window, for the consumers that only read the profile', events.filter((t) => t === 'kb-kaby-profile').length >= 2, events.join())
  ok('a subscriber that throws does not stop the others', (() => { const got = []; const a = globalThis.window.__KB_KABY__.subscribe(() => { throw new Error('x') }); const b = globalThis.window.__KB_KABY__.subscribe((p) => got.push(p)); T.publish(publicProfile(emptyProfile())); a(); b(); return got.length === 1 })())
}

console.log('── guards on the source ──')
{
  const css = T.CSS
  ok('no colour outside DSH’s tokens: every # colour sits inside a var(--…, fallback)', (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).every((hex) => css.split(hex).slice(0, -1).every((_, i, parts) => { const before = css.split(hex).slice(0, i + 1).join(hex); return /var\([^)]*,\s*(rgba?\([^)]*\)|)$/.test(before.slice(-120)) || /var\(--[a-z0-9-]+,\s*$/.test(before.slice(-60)) })))
  ok('the page draws icons in the current colour', !/stroke: '#|fill: '#|stroke="#|fill="#/.test(source))
  const pairs = [...source.matchAll(/\bkt\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g)]
  ok('a French/English pair is given everywhere kt is used', pairs.length > 40 && pairs.every((m) => m[1].length > 0 && m[2].length > 0), pairs.length + ' pairs')
  const ktn = [...source.matchAll(/\bktn\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g)]
  ok('every sentence that carries the name has the token in both languages', ktn.length >= 4 && ktn.every((m) => m[1].includes('{name}') && m[2].includes('{name}')))
  ok('no visible title or label bypasses kt: the only literal is the product name “Kaby”', !/h\('(?:h4|button|label|b)',[^)]*\},\s*'[A-Z][a-z]{3,}/.test(source.replace(/'Kaby'/g, '')))
  const calls = [...source.matchAll(/fetch\(\s*'([^']+)'/g)].map((m) => m[1])
  ok('the page only asks the core’s voice and image routes, apart from its own', calls.every((u) => u.startsWith('/kybernos/tts/') || u === '/kybernos/image/generate'), calls.join(' '))
  ok('its own host is reached through one base path that matches the host’s', source.includes("const BASE = '" + ROUTE + "'"))
  ok('the section id is the one the nav key table will carry', /SECTION_ID = 'kybernos-kaby-customisation'/.test(source))
  ok('every hook the live checks need is in the source', ['kaby-custom-page', 'kaby-custom-name', 'kaby-custom-look', 'kaby-custom-generate', 'kaby-custom-import', 'kaby-custom-voice-pill', 'kaby-custom-preview', 'kaby-custom-custom-voice', 'kaby-custom-face-provider', 'kaby-custom-face-use'].every((k) => source.includes("'" + k + "'")))
  ok('a recording that ends after the window was closed cannot reopen it', /patchCv = \(patch\) => setCv\(\(c\) => \(c === null \? c :/.test(source))
  ok('the help card is wired the guarded way', /window\.__KB_HELP__ && window\.__KB_HELP__\.Help/.test(source))
}

console.log(failures === 0 ? '\nall passed' : '\n' + failures + ' FAILED')
process.exit(failures > 0 ? 1 : 0)
