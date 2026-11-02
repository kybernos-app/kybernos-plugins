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

console.log('── permissions and where Kaby works: the words, the draft ──')
{
  resolved = 'en'
  const view = (o) => ({ ok: true, inForce: false, why: 'none', canSign: true, signedAt: null, preset: 'off', memory: false, computer: false, memoryPerDay: 40, computerPerDay: 40, paused: false, usedToday: { memory: 0, computer: 0 }, limits: { memoryPerDay: 500, computerPerDay: 500 },
    presets: { off: { memory: false, computer: false, memoryPerDay: 40, computerPerDay: 40 }, prudent: { memory: true, computer: false, memoryPerDay: 40, computerPerDay: 40 }, standard: { memory: true, computer: true, memoryPerDay: 40, computerPerDay: 40 }, intensive: { memory: true, computer: true, memoryPerDay: 100, computerPerDay: 150 } }, ...o })
  const FORCE = view({ inForce: true, why: 'in_force', signedAt: '2026-11-01T10:00:00.000Z', preset: 'standard', memory: true, computer: true })
  const chipOf = (o, dirty) => T.mandateChip(view(o), dirty === true).code
  ok('no permission yet, nothing on, or a signed record with everything off: none in force', chipOf({}) === 'none' && chipOf({ why: 'nothing_on', signedAt: '2026-11-01T10:00:00.000Z' }) === 'none')
  ok('in force: the chip says since when, in the language', (() => { const c = T.mandateChip(FORCE, false); resolved = 'kybernos'; const f = T.mandateChip(FORCE, false).text; resolved = 'en'; return c.code === 'in_force' && c.cls === 'ok' && /^In force since .*2026/.test(c.text) && /^En vigueur depuis le /.test(f) })())
  ok('a draft not signed yet says so, whatever the host says', chipOf({ inForce: true, why: 'in_force' }, true) === 'dirty' && chipOf({}, true) === 'dirty')
  ok('paused, altered or unreadable (sign again), no key (cannot sign): each its own state', chipOf({ why: 'paused' }) === 'paused' && chipOf({ why: 'altered' }) === 'resign' && chipOf({ why: 'unreadable' }) === 'resign' && chipOf({ why: 'no_secret' }) === 'cannot_sign' && chipOf({ canSign: false }) === 'cannot_sign')
  ok('no key wins over a draft: nothing can be signed', chipOf({ canSign: false }, true) === 'cannot_sign')
  const dr = T.draftOf(view({ memory: true, memoryPerDay: 7 }))
  ok('the draft holds the four fields the host signs, and no more', Object.keys(dr).sort().join() === 'computer,computerPerDay,memory,memoryPerDay' && dr.memory === true && dr.memoryPerDay === 7)
  ok('a draft equal to a starting point is that point; any other is custom', T.draftPreset(T.draftOf(FORCE), FORCE.presets) === 'standard' && T.draftPreset({ ...T.draftOf(FORCE), memoryPerDay: 41 }, FORCE.presets) === 'custom' && T.draftPreset({ memory: true, computer: true, memoryPerDay: 100, computerPerDay: 150 }, FORCE.presets) === 'intensive' && T.draftPreset(dr, null) === 'custom')
  ok('the starting points are named in both languages', T.PRESET_ORDER.every((p) => T.presetLabel(p).length > 2) && (() => { resolved = 'kybernos'; const f = T.presetLabel('off'); resolved = 'en'; return f === 'Arrêt' && T.presetLabel('off') === 'Off' })())
  ok('every refusal of the host has a sentence, and an unknown one a plain fallback', ['cannot_sign', 'write_failed', 'session', 'down'].every((c) => T.mandateProblem(c).length > 20) && T.mandateProblem('?').length > 5)
  ok('the cloud computer’s chip names its state, this computer is always ready', T.whereChip({ local: true }).text === 'Ready' && T.whereChip({ local: false, state: 'suspended' }).text === 'Asleep' && T.whereChip({ local: false, state: 'running' }).cls === 'ok' && T.whereChip({ local: false, state: 'failed' }).cls === 'err' && T.whereChip({ local: false, state: '' }).text === 'On request' && T.whereChip({ local: false, state: 'odd' }).text === 'odd')
  ok('tokens are filled in, every occurrence', T.fill('{a} of {a} for {b}', { a: 1, b: 'x' }) === '1 of 1 for x')
}

console.log('── permissions and where Kaby works: the cards, rendered once ──')
{
  resolved = 'en'
  const view = (o) => ({ ok: true, inForce: false, why: 'none', canSign: true, signedAt: null, preset: 'off', memory: false, computer: false, memoryPerDay: 40, computerPerDay: 40, paused: false, usedToday: { memory: 0, computer: 0 }, limits: { memoryPerDay: 500, computerPerDay: 500 },
    presets: { off: { memory: false, computer: false, memoryPerDay: 40, computerPerDay: 40 }, prudent: { memory: true, computer: false, memoryPerDay: 40, computerPerDay: 40 }, standard: { memory: true, computer: true, memoryPerDay: 40, computerPerDay: 40 }, intensive: { memory: true, computer: true, memoryPerDay: 100, computerPerDay: 150 } }, ...o })
  // A React whose hooks hand back what the test forces (by their order in the component) and note every set: Mandate = view, down, draft, busy, problem, logOpen, log.
  const mount = (which, forced = {}) => {
    const sets = []
    let i = 0
    const R = { ...React, useState: (v) => { const n = i++; return [n in forced ? forced[n] : (typeof v === 'function' ? v() : v), (x) => sets.push([n, x])] } }
    const cards = T.buildCards(R)
    return { tree: cards[which](), sets }
  }
  const only = (tree, kb) => byKb(tree, kb)[0]

  const panelTree = T.buildPanel(React)
  T.store.profile = publicProfile(emptyProfile())
  const page = panelTree()
  ok('the page draws the three cards, after the three blocks', ['KabyWhereCard', 'KabyMandateCard', 'KabyHeartbeatCard'].every((n) => find(page, (x) => typeof x.type === 'function' && x.type.displayName === n).length === 1))

  T.store.mandate = null
  let m = mount('MandateCard')
  ok('before the host answers, the card says it is reading', byKb(m.tree, 'kaby-custom-mandate-loading').length === 1 && byKb(m.tree, 'kaby-custom-mandate-sign').length === 0)
  m = mount('MandateCard', { 1: true })
  ok('when the host does not answer, it says so (and how to fix it)', byKb(m.tree, 'kaby-custom-mandate-down').length === 1 && /restart DSH/.test(text(m.tree)))

  T.store.mandate = view({})
  m = mount('MandateCard')
  ok('nothing signed: four starting points, « Off » pressed, sign and pause off', byKb(m.tree, 'kaby-custom-mandate-preset').length === 4 && byKb(m.tree, 'kaby-custom-mandate-preset').filter((b) => b.props['aria-pressed'] === 'true').map((b) => b.props['data-preset']).join() === 'off' && only(m.tree, 'kaby-custom-mandate-sign').props.disabled === true && only(m.tree, 'kaby-custom-mandate-pause').props.disabled === true)
  ok('with both classes off the limits are off, the switches are not', byKb(m.tree, 'kaby-custom-mandate-limit').every((i) => i.props.disabled === true) && byKb(m.tree, 'kaby-custom-mandate-switch').every((s) => s.props.disabled === false && s.props['aria-checked'] === 'false' && s.props.role === 'switch'))
  ok('the switches and the number fields are named for a screen reader', byKb(m.tree, 'kaby-custom-mandate-switch').every((s) => /allow without asking/.test(s.props['aria-label'])) && find(m.tree, (n) => n.type === 'label' && /^kbkc-limit-/.test(n.props.htmlFor || '')).length === 2)
  ok('the card says what is always asked, and that the limits count actions not euros', byKb(m.tree, 'kaby-custom-mandate-asked').length === 1 && /connected app/.test(text(only(m.tree, 'kaby-custom-mandate-asked'))) && /Restart DSH/.test(text(m.tree)) && /actions, not euros/.test(text(m.tree)))

  T.store.mandate = view({ inForce: true, why: 'in_force', signedAt: '2026-11-01T10:00:00.000Z', preset: 'standard', memory: true, computer: true, usedToday: { memory: 12, computer: 40 } })
  m = mount('MandateCard')
  const useOf = (tree, k) => byKb(tree, 'kaby-custom-mandate-use').find((u) => u.props['data-class'] === k)
  ok('in force: the chip is green and « Standard » is pressed', only(m.tree, 'kaby-custom-mandate-chip').props['data-state'] === 'in_force' && / ok$/.test(only(m.tree, 'kaby-custom-mandate-chip').props.className) && only(m.tree, 'kaby-custom-mandate-preset').props['aria-pressed'] === 'false' && byKb(m.tree, 'kaby-custom-mandate-preset').find((b) => b.props['data-preset'] === 'standard').props['aria-pressed'] === 'true')
  ok('today’s use is shown for each class on, and a class at its limit says what comes next', text(useOf(m.tree, 'memory')) === '12 of 40 today ' && !/kbkc-warnline/.test(useOf(m.tree, 'memory').props.className) && /40 of 40 today/.test(text(useOf(m.tree, 'computer'))) && /will be asked/.test(text(useOf(m.tree, 'computer'))) && /kbkc-warnline/.test(useOf(m.tree, 'computer').props.className))
  ok('a draft hides the count (it is not signed yet) and offers to sign', byKb(mount('MandateCard', { 2: { memory: true, computer: true, memoryPerDay: 41, computerPerDay: 40 } }).tree, 'kaby-custom-mandate-use').length === 0)
  m = mount('MandateCard', { 2: { memory: true, computer: true, memoryPerDay: 41, computerPerDay: 40 } })
  ok('a draft: « Changes to sign », « Custom » shown, no starting point pressed, sign on', only(m.tree, 'kaby-custom-mandate-chip').props['data-state'] === 'dirty' && byKb(m.tree, 'kaby-custom-mandate-custom').length === 1 && byKb(m.tree, 'kaby-custom-mandate-preset').every((b) => b.props['aria-pressed'] === 'false') && only(m.tree, 'kaby-custom-mandate-sign').props.disabled === false && /Sign the changes/.test(text(only(m.tree, 'kaby-custom-mandate-sign'))))

  T.store.mandate = view({ why: 'paused', signedAt: '2026-11-01T10:00:00.000Z', paused: true, memory: true })
  m = mount('MandateCard')
  ok('paused: the chip, the sentence, and « Resume »', only(m.tree, 'kaby-custom-mandate-chip').props['data-state'] === 'paused' && /Nothing goes through without your answer/.test(text(only(m.tree, 'kaby-custom-mandate-note'))) && /Resume/.test(text(only(m.tree, 'kaby-custom-mandate-pause'))) && only(m.tree, 'kaby-custom-mandate-pause').props.disabled === false)
  T.store.mandate = view({ why: 'altered' })
  m = mount('MandateCard')
  ok('altered or another key: red, an alert, nothing allowed, and a pick then offers « Sign again »', only(m.tree, 'kaby-custom-mandate-chip').props['data-state'] === 'resign' && only(m.tree, 'kaby-custom-mandate-note').props.role === 'alert' && only(m.tree, 'kaby-custom-mandate-pause').props.disabled === true && /Sign again/.test(text(only(m.tree, 'kaby-custom-mandate-sign'))))
  T.store.mandate = view({ canSign: false, why: 'no_secret' })
  m = mount('MandateCard')
  ok('no key on this machine: every control is off and the card says why', only(m.tree, 'kaby-custom-mandate-chip').props['data-state'] === 'cannot_sign' && /cannot find this machine’s key/.test(text(only(m.tree, 'kaby-custom-mandate-note'))) && [...byKb(m.tree, 'kaby-custom-mandate-switch'), ...byKb(m.tree, 'kaby-custom-mandate-preset'), ...byKb(m.tree, 'kaby-custom-mandate-limit'), only(m.tree, 'kaby-custom-mandate-sign'), only(m.tree, 'kaby-custom-mandate-pause')].every((n) => n.props.disabled === true))

  // what the buttons do
  T.store.mandate = view({})
  m = mount('MandateCard')
  byKb(m.tree, 'kaby-custom-mandate-preset').find((b) => b.props['data-preset'] === 'intensive').props.onClick()
  ok('a starting point fills the draft from the host’s own numbers', JSON.stringify(m.sets.find(([n]) => n === 2)[1]) === JSON.stringify({ memory: true, computer: true, memoryPerDay: 100, computerPerDay: 150 }))
  m = mount('MandateCard')
  byKb(m.tree, 'kaby-custom-mandate-switch').find((s) => s.props['data-class'] === 'memory').props.onClick()
  ok('a switch changes that class only', JSON.stringify(m.sets.find(([n]) => n === 2)[1]) === JSON.stringify({ memory: true, computer: false, memoryPerDay: 40, computerPerDay: 40 }))
  m = mount('MandateCard', { 2: { memory: true, computer: true, memoryPerDay: 40, computerPerDay: 40 } })
  const limit = (k) => byKb(m.tree, 'kaby-custom-mandate-limit').find((i) => i.props['data-class'] === k)
  limit('memory').props.onChange({ target: { value: '9999' } })
  limit('computer').props.onChange({ target: { value: '0' } })
  limit('memory').props.onChange({ target: { value: 'abc' } })
  ok('a limit is kept within 1 and the host’s maximum, and a word is ignored', m.sets.length === 2 && m.sets[0][1].memoryPerDay === 500 && m.sets[1][1].computerPerDay === 1)

  const asked = []
  const answer = (status, json) => { globalThis.fetch = async (url, init) => { asked.push({ url, init }); return { status, json: async () => json } } }
  T.store.mandate = view({})
  m = mount('MandateCard', { 2: { memory: true, computer: false, memoryPerDay: 25, computerPerDay: 40 } })
  answer(200, { ok: true, view: view({ inForce: true, why: 'in_force', signedAt: '2026-11-02T08:00:00.000Z', preset: 'custom', memory: true, memoryPerDay: 25 }) })
  await only(m.tree, 'kaby-custom-mandate-sign').props.onClick()
  const sent = JSON.parse(asked[0].init.body)
  ok('signing posts the four fields to the host, never « paused », same origin, with the cookie', asked[0].url === '/kybernos-cloud/kyby/mandate/set' && asked[0].init.method === 'POST' && asked[0].init.credentials === 'same-origin' && JSON.stringify(sent) === JSON.stringify({ memory: true, computer: false, memoryPerDay: 25, computerPerDay: 40 }))
  ok('the host’s answer replaces the card’s state and clears the draft', T.store.mandate.inForce === true && T.store.mandate.memoryPerDay === 25 && m.sets.some(([n, x]) => n === 2 && x === null) && m.sets.some(([n, x]) => n === 3 && x === true) && m.sets.some(([n, x]) => n === 3 && x === false))
  asked.length = 0
  T.store.mandate = view({ inForce: true, why: 'in_force', signedAt: '2026-11-01T10:00:00.000Z', memory: true })
  m = mount('MandateCard')
  answer(200, { ok: true, view: view({ why: 'paused', paused: true, signedAt: '2026-11-02T08:00:00.000Z' }) })
  await only(m.tree, 'kaby-custom-mandate-pause').props.onClick()
  ok('pausing posts only « paused: true »; the host keeps the rest', asked[0].url.endsWith('/set') && JSON.stringify(JSON.parse(asked[0].init.body)) === JSON.stringify({ paused: true }))
  asked.length = 0
  T.store.mandate = view({ why: 'paused', paused: true, signedAt: '2026-11-01T10:00:00.000Z' })
  m = mount('MandateCard')
  answer(200, { ok: true, view: view({ inForce: true, why: 'in_force' }) })
  await only(m.tree, 'kaby-custom-mandate-pause').props.onClick()
  ok('resuming posts « paused: false »', JSON.stringify(JSON.parse(asked[0].init.body)) === JSON.stringify({ paused: false }))
  T.store.mandate = view({})
  m = mount('MandateCard', { 2: { memory: true, computer: false, memoryPerDay: 40, computerPerDay: 40 } })
  answer(401, { ok: false, error: 'session' })
  await only(m.tree, 'kaby-custom-mandate-sign').props.onClick()
  ok('a request without the page’s session is refused in words, the draft is kept', m.sets.some(([n, x]) => n === 4 && /reload it/.test(x)) && !m.sets.some(([n, x]) => n === 2 && x === null) && T.store.mandate.inForce === false)
  m = mount('MandateCard', { 2: { memory: true, computer: false, memoryPerDay: 40, computerPerDay: 40 } })
  answer(200, { ok: false, error: 'cannot_sign' })
  await only(m.tree, 'kaby-custom-mandate-sign').props.onClick()
  ok('a refusal of the host is shown as its sentence', m.sets.some(([n, x]) => n === 4 && /cannot find this computer’s key/.test(x)))
  m = mount('MandateCard', { 2: { memory: true, computer: false, memoryPerDay: 40, computerPerDay: 40 } })
  globalThis.fetch = async () => { throw new Error('offline') }
  await only(m.tree, 'kaby-custom-mandate-sign').props.onClick()
  ok('a host that does not answer is a sentence, not a crash', m.sets.some(([n, x]) => n === 4 && /do not answer/.test(x)) && m.sets.some(([n, x]) => n === 3 && x === false))

  // the action log
  m = mount('MandateCard')
  answer(200, { ok: true, entries: [{ at: '2026-11-02T10:42:00.000Z', klass: 'memory', tool: 'memory_write' }, { at: '2026-11-02T10:17:00.000Z', klass: 'computer', tool: 'computer_start' }] })
  asked.length = 0
  await only(m.tree, 'kaby-custom-mandate-log-toggle').props.onClick()
  await new Promise((r) => setTimeout(r, 0))
  ok('opening the log reads it from the host', m.sets.some(([n, x]) => n === 5 && x === true) && asked.length === 1 && asked[0].url === '/kybernos-cloud/kyby/mandate/log' && m.sets.some(([n, x]) => n === 6 && Array.isArray(x) && x.length === 2))
  m = mount('MandateCard', { 5: true, 6: [{ at: '2026-11-02T10:42:00.000Z', klass: 'memory', tool: 'memory_write' }, { at: '2026-11-02T10:17:00.000Z', klass: 'computer', tool: 'computer_start' }] })
  ok('the log lists each action: time, class, tool', byKb(m.tree, 'kaby-custom-mandate-log-row').length === 2 && /memory_write/.test(text(byKb(m.tree, 'kaby-custom-mandate-log-row')[0])) && /Memory/.test(text(byKb(m.tree, 'kaby-custom-mandate-log-row')[0])) && /Cloud computer/.test(text(byKb(m.tree, 'kaby-custom-mandate-log-row')[1])) && only(m.tree, 'kaby-custom-mandate-log-toggle').props['aria-expanded'] === 'true')
  ok('an empty log says so', byKb(mount('MandateCard', { 5: true, 6: [] }).tree, 'kaby-custom-mandate-log-empty').length === 1)

  // where Kaby works
  const seam = (w) => { const k = { where: () => w, picked: [], pickWhere (v) { k.picked.push(v) }, subscribe: () => () => {}, refresh () {} }; globalThis.window.__KB_KYBER__ = k; return k }
  delete globalThis.window.__KB_KYBER__
  ok('without kybernos-kyber there is no « Where Kaby works » card, and no crash', mount('WhereCard').tree === null)
  seam(null)
  ok('before that screen has read the account, no card yet', mount('WhereCard').tree === null)
  let k = seam({ signedIn: true, local: true, computers: [{ id: 'aaaaaaaa-1111', name: 'Home' }, { id: 'bbbbbbbb-2222', name: 'Atelier' }], picked: 'local', state: 'suspended', paused: '' })
  let w = mount('WhereCard')
  const pick = only(w.tree, 'kaby-custom-where-pick')
  ok('this computer: a labelled select, this computer first, then the cloud ones, ready', pick.type === 'select' && pick.props.value === 'local' && pick.children.length === 3 && text(pick.children[0]) === 'This computer ' && /Home \(cloud\)/.test(text(pick.children[1])) && find(w.tree, (n) => n.type === 'label' && n.props.htmlFor === 'kbkc-where').length === 1 && /Ready/.test(text(only(w.tree, 'kaby-custom-where-chip'))))
  ok('this computer: it says to keep Kybernos open and no cloud hour is used, and there is no cloud warning', /keep Kybernos open/.test(text(only(w.tree, 'kaby-custom-where-help'))) && /No cloud computer hour/.test(text(only(w.tree, 'kaby-custom-where-help'))) && byKb(w.tree, 'kaby-custom-where-cloud-note').length === 0)
  pick.props.onChange({ target: { value: 'bbbbbbbb-2222' } })
  ok('a pick goes through kybernos-kyber’s own pick: the same setting as « Set up… »', k.picked.join() === 'bbbbbbbb-2222')
  k = seam({ signedIn: true, local: false, computers: [{ id: 'aaaaaaaa-1111', name: 'Home' }], picked: 'aaaaaaaa-1111', state: 'suspended', paused: '' })
  w = mount('WhereCard')
  ok('a cloud computer: its state, how it wakes, the plan’s hours, and that the permissions below do not reach it', /Asleep/.test(text(only(w.tree, 'kaby-custom-where-chip'))) && /wakes when it has work/.test(text(only(w.tree, 'kaby-custom-where-help'))) && /run hours count/.test(text(only(w.tree, 'kaby-custom-where-help'))) && /On its cloud computer, Kaby asks as before/.test(text(only(w.tree, 'kaby-custom-where-cloud-note'))))
  seam({ signedIn: false, local: true, computers: [], picked: 'local', state: '', paused: '' })
  w = mount('WhereCard')
  ok('no account: this computer is the only choice, so the select is off', only(w.tree, 'kaby-custom-where-pick').props.disabled === true && only(w.tree, 'kaby-custom-where-pick').children.length === 1)
  store_reset: {
    const name = T.store.profile.name
    T.store.profile = { ...T.store.profile, name: 'Léa' }
    seam({ signedIn: true, local: true, computers: [], picked: 'local', state: '', paused: '' })
    ok('the cards speak of the assistant by its own name', /Où Léa travaille|Where Léa works/.test(text(mount('WhereCard').tree)))
    T.store.profile = { ...T.store.profile, name }
  }
  resolved = 'kybernos'
  ok('in French the same cards speak French', /Où Kaby travaille/.test(text(mount('WhereCard').tree)) && /Autorisations/.test(text(mount('MandateCard').tree)) && /Mémoire/.test(text(mount('MandateCard').tree)))
  resolved = 'en'
  delete globalThis.window.__KB_KYBER__
  T.store.mandate = null
}

console.log('── wake-ups: the words, the draft ──')
{
  resolved = 'en'
  const PRESETS = { off: { on: false, everyHours: 4, boxMin: 10, items: 2 }, light: { on: true, everyHours: 8, boxMin: 5, items: 1 }, regular: { on: true, everyHours: 4, boxMin: 10, items: 2 }, steady: { on: true, everyHours: 2, boxMin: 20, items: 3 } }
  const view = (o) => ({ ok: true, inForce: false, why: 'none', canSign: true, signedAt: null, preset: 'off', on: false, everyHours: 4, boxMin: 10, items: 2, quiet: true, quietFrom: '22:00', quietTo: '08:00', paused: false, quietNow: false, nextAt: null, lastAt: null, lastOutcome: null, running: false, desktop: true,
    choices: { everyHours: [2, 4, 8, 24], boxMin: [5, 10, 20], items: [1, 2, 3] }, presets: PRESETS, ...o })
  const chipOf = (o, dirty) => T.heartbeatChip(view(o), dirty === true).code
  const SIGNED = '2026-11-02T08:00:00.000Z'
  const ON = { inForce: true, why: 'in_force', signedAt: SIGNED, on: true, preset: 'regular' }
  ok('nothing signed: no wake-ups; signed but off: the same words, another state', chipOf({}) === 'none' && chipOf({ why: 'off', signedAt: SIGNED }) === 'off' && T.heartbeatChip(view({}), false).text === 'No wake-ups')
  ok('on: the chip says when the next one is due, in the language; with no date it just says on', (() => { const n = new Date(2026, 10, 2, 14, 30).toISOString(); const c = T.heartbeatChip(view({ ...ON, nextAt: n }), false); resolved = 'kybernos'; const f = T.heartbeatChip(view({ ...ON, nextAt: n }), false).text; resolved = 'en'; return c.code === 'on' && c.cls === 'ok' && c.text === 'On · next around 14:30' && f === 'Actifs · prochain vers 14:30' && T.heartbeatChip(view(ON), false).text === 'On' })())
  ok('in the quiet hours the chip says when they end', (() => { const c = T.heartbeatChip(view({ ...ON, quietNow: true, quietTo: '07:30' }), false); return c.code === 'quiet' && c.text === 'Quiet · resumes at 07:30' })())
  ok('a wake-up under way names the longest it can take, and wins over the next date', (() => { const c = T.heartbeatChip(view({ ...ON, running: true, boxMin: 20 }), false); return c.code === 'running' && c.text === 'Working · 20 min at most' })())
  ok('a draft not signed yet says so, whatever the host says', chipOf(ON, true) === 'dirty' && chipOf({}, true) === 'dirty')
  ok('paused, altered or unreadable (sign again), no key (cannot sign): each its own state', chipOf({ why: 'paused', signedAt: SIGNED }) === 'paused' && chipOf({ why: 'altered' }) === 'resign' && chipOf({ why: 'unreadable' }) === 'resign' && chipOf({ why: 'no_secret' }) === 'cannot_sign' && chipOf({ canSign: false }) === 'cannot_sign' && chipOf({ canSign: false }, true) === 'cannot_sign')
  const dr = T.heartbeatDraftOf(view({ on: true, everyHours: 8, quiet: false }))
  ok('the draft holds the seven fields the host signs besides « paused », and no more', Object.keys(dr).sort().join() === 'boxMin,everyHours,items,on,quiet,quietFrom,quietTo' && dr.on === true && dr.everyHours === 8 && dr.quiet === false)
  ok('a draft equal to a starting point is that point whatever the quiet hours; any other is custom', T.heartbeatPreset({ ...T.heartbeatDraftOf(view(ON)), quiet: false }, PRESETS) === 'regular' && T.heartbeatPreset({ on: true, everyHours: 2, boxMin: 20, items: 3 }, PRESETS) === 'steady' && T.heartbeatPreset({ on: true, everyHours: 24, boxMin: 20, items: 3 }, PRESETS) === 'custom' && T.heartbeatPreset(dr, null) === 'custom' && T.heartbeatPreset(T.heartbeatDraftOf(view({})), PRESETS) === 'off')
  ok('the starting points are named in both languages', T.HEARTBEAT_PRESETS.every((p) => T.heartbeatPresetLabel(p).length > 2) && (() => { resolved = 'kybernos'; const f = T.heartbeatPresetLabel('light'); resolved = 'en'; return f === 'Léger' && T.heartbeatPresetLabel('light') === 'Light' })())
  ok('every outcome word of the runner has a phrase, and an unknown one none', ['running', 'done', 'time', 'blocked', 'person', 'stopped', 'refused', 'error', 'interrupted'].every((w) => T.wakeOutcome(w).length > 3) && T.wakeOutcome('?') === '' && T.wakeOutcome(null) === '')
  ok('every refusal of the host has a sentence, and an unknown one a plain fallback', ['cannot_sign', 'write_failed', 'session', 'down'].every((c) => T.heartbeatProblem(c).length > 20) && T.heartbeatProblem('?').length > 5)
  ok('every reason a wake-up cannot start has a sentence, and an unknown one a plain fallback', ['running', 'not_desktop', 'not_in_force', 'sessions_unavailable', 'no_chat', 'busy', 'not_running', 'session'].every((c) => T.wakeProblem(c).length > 20) && T.wakeProblem('?').length > 5)
  ok('the clock shows hours and minutes, from a date or from milliseconds, and nothing for a date it cannot read', T.clockOf(new Date(2026, 10, 2, 7, 5).toISOString()) === '07:05' && T.clockOf(new Date(2026, 10, 2, 7, 5).getTime()) === '07:05' && T.clockOf('nope') === '' && T.clockOf(null) === '')
}

console.log('── wake-ups: the card, rendered once ──')
{
  resolved = 'en'
  const PRESETS = { off: { on: false, everyHours: 4, boxMin: 10, items: 2 }, light: { on: true, everyHours: 8, boxMin: 5, items: 1 }, regular: { on: true, everyHours: 4, boxMin: 10, items: 2 }, steady: { on: true, everyHours: 2, boxMin: 20, items: 3 } }
  const view = (o) => ({ ok: true, inForce: false, why: 'none', canSign: true, signedAt: null, preset: 'off', on: false, everyHours: 4, boxMin: 10, items: 2, quiet: true, quietFrom: '22:00', quietTo: '08:00', paused: false, quietNow: false, nextAt: null, lastAt: null, lastOutcome: null, running: false, desktop: true,
    choices: { everyHours: [2, 4, 8, 24], boxMin: [5, 10, 20], items: [1, 2, 3] }, presets: PRESETS, ...o })
  const SIGNED = '2026-11-02T08:00:00.000Z'
  const ON = { inForce: true, why: 'in_force', signedAt: SIGNED, on: true, preset: 'regular' }
  // Heartbeat = view 0, down 1, draft 2, busy 3, problem 4.
  const mount = (forced = {}) => {
    const sets = []
    let i = 0
    const R = { ...React, useState: (v) => { const n = i++; return [n in forced ? forced[n] : (typeof v === 'function' ? v() : v), (x) => sets.push([n, x])] } }
    return { tree: T.buildCards(R).HeartbeatCard(), sets }
  }
  const only = (tree, kb) => byKb(tree, kb)[0]
  const label = (tree, kb) => text(only(tree, kb))
  delete globalThis.window.__KB_KYBER__

  T.store.heartbeat = null
  let m = mount()
  ok('before the host answers, the card says it is reading', byKb(m.tree, 'kaby-custom-heartbeat-loading').length === 1 && byKb(m.tree, 'kaby-custom-heartbeat-sign').length === 0)
  m = mount({ 1: true })
  ok('when the host does not answer, it says so (and how to fix it)', byKb(m.tree, 'kaby-custom-heartbeat-down').length === 1 && /restart DSH/.test(text(m.tree)))

  T.store.heartbeat = view({})
  m = mount()
  ok('nothing signed: four starting points, « Off » pressed, sign, pause and wake off', byKb(m.tree, 'kaby-custom-heartbeat-preset').length === 4 && byKb(m.tree, 'kaby-custom-heartbeat-preset').filter((b) => b.props['aria-pressed'] === 'true').map((b) => b.props['data-preset']).join() === 'off' && only(m.tree, 'kaby-custom-heartbeat-sign').props.disabled === true && only(m.tree, 'kaby-custom-heartbeat-pause').props.disabled === true && only(m.tree, 'kaby-custom-heartbeat-wake').props.disabled === true)
  ok('three labelled selects with the host’s choices, and the quiet hours as a switch and two times', ['everyHours', 'boxMin', 'items'].every((k) => { const s = only(m.tree, 'kaby-custom-heartbeat-' + k); return s.type === 'select' && s.props['aria-label'].length > 10 && find(m.tree, (n) => n.type === 'label' && n.props.htmlFor === s.props.id).length === 1 }) && only(m.tree, 'kaby-custom-heartbeat-everyHours').children.map((o) => text(o).trim()).join() === '2 h,4 h,8 h,24 h' && only(m.tree, 'kaby-custom-heartbeat-items').children.length === 3 && only(m.tree, 'kaby-custom-heartbeat-quiet-switch').props.role === 'switch' && only(m.tree, 'kaby-custom-heartbeat-from').props.type === 'time' && only(m.tree, 'kaby-custom-heartbeat-to').props.value === '08:00')
  ok('the card holds parameters only: no list, no report, and it says where those are', !byKb(m.tree, 'kaby-custom-heartbeat-last').length && /in its chat, not here/.test(text(m.tree)))
  ok('the card says what is never different during a wake-up, and that nothing is measured in euros', byKb(m.tree, 'kaby-custom-heartbeat-rules').length === 1 && /nobody can answer a question/.test(text(only(m.tree, 'kaby-custom-heartbeat-rules'))) && /connected app, restarting DSH: never/.test(text(only(m.tree, 'kaby-custom-heartbeat-rules'))) && /half an hour/.test(text(only(m.tree, 'kaby-custom-heartbeat-rules'))) && /No budget in euros/.test(text(m.tree)))
  ok('no cloud warning on the person’s own computer', byKb(m.tree, 'kaby-custom-heartbeat-cloud-note').length === 0 && byKb(m.tree, 'kaby-custom-heartbeat-open').length === 0)

  T.store.heartbeat = view({ ...ON, nextAt: new Date(2026, 10, 2, 16, 0).toISOString(), lastAt: new Date(2026, 10, 2, 12, 5).toISOString(), lastOutcome: 'done' })
  m = mount()
  ok('on: the chip is green with the next time, « Regular » is pressed, and the last wake-up is one line', only(m.tree, 'kaby-custom-heartbeat-chip').props['data-state'] === 'on' && / ok$/.test(only(m.tree, 'kaby-custom-heartbeat-chip').props.className) && byKb(m.tree, 'kaby-custom-heartbeat-preset').find((b) => b.props['data-preset'] === 'regular').props['aria-pressed'] === 'true' && /next around 16:00/.test(label(m.tree, 'kaby-custom-heartbeat-chip')) && label(m.tree, 'kaby-custom-heartbeat-last').trim() === 'Last wake-up at 12:05: finished.')
  ok('on and nothing changed: sign is off, pause and « Wake it now » are on', only(m.tree, 'kaby-custom-heartbeat-sign').props.disabled === true && only(m.tree, 'kaby-custom-heartbeat-pause').props.disabled === false && only(m.tree, 'kaby-custom-heartbeat-wake').props.disabled === false && /Pause/.test(label(m.tree, 'kaby-custom-heartbeat-pause')))
  m = mount({ 2: { on: true, everyHours: 8, boxMin: 5, items: 1, quiet: true, quietFrom: '22:00', quietTo: '08:00' } })
  ok('a draft: « Changes to sign », « Light » pressed, the last wake-up hidden, sign on and « Wake it now » off until it is signed', only(m.tree, 'kaby-custom-heartbeat-chip').props['data-state'] === 'dirty' && byKb(m.tree, 'kaby-custom-heartbeat-preset').find((b) => b.props['data-preset'] === 'light').props['aria-pressed'] === 'true' && byKb(m.tree, 'kaby-custom-heartbeat-last').length === 0 && only(m.tree, 'kaby-custom-heartbeat-sign').props.disabled === false && /Sign the changes/.test(label(m.tree, 'kaby-custom-heartbeat-sign')) && only(m.tree, 'kaby-custom-heartbeat-wake').props.disabled === true)
  m = mount({ 2: { on: true, everyHours: 24, boxMin: 5, items: 1, quiet: true, quietFrom: '22:00', quietTo: '08:00' } })
  ok('numbers that match no starting point show « Custom », none pressed', byKb(m.tree, 'kaby-custom-heartbeat-custom').length === 1 && byKb(m.tree, 'kaby-custom-heartbeat-preset').every((b) => b.props['aria-pressed'] === 'false'))
  T.store.heartbeat = view({})
  m = mount({ 2: { on: true, everyHours: 4, boxMin: 10, items: 2, quiet: true, quietFrom: '22:00', quietTo: '08:00' } })
  ok('turning on for the first time says « Turn the wake-ups on »', /Turn the wake-ups on/.test(label(m.tree, 'kaby-custom-heartbeat-sign')))
  T.store.heartbeat = view({ ...ON, running: true, lastAt: SIGNED, lastOutcome: 'running' })
  m = mount()
  ok('a wake-up under way: the chip says so, « Wake it now » is off, « Stop this wake-up » is there, and the last-wake-up line waits for its end', only(m.tree, 'kaby-custom-heartbeat-chip').props['data-state'] === 'running' && only(m.tree, 'kaby-custom-heartbeat-wake').props.disabled === true && only(m.tree, 'kaby-custom-heartbeat-stop').props.disabled === false && /Stop this wake-up/.test(label(m.tree, 'kaby-custom-heartbeat-stop')) && byKb(m.tree, 'kaby-custom-heartbeat-last').length === 0)
  T.store.heartbeat = view(ON)
  m = mount()
  ok('no wake-up under way: no « Stop this wake-up »', byKb(m.tree, 'kaby-custom-heartbeat-stop').length === 0)
  T.store.heartbeat = view({ why: 'paused', signedAt: SIGNED, on: true, paused: true })
  m = mount()
  ok('paused: the chip, the sentence, « Resume », and no wake-up', only(m.tree, 'kaby-custom-heartbeat-chip').props['data-state'] === 'paused' && /No wake-up until you resume/.test(label(m.tree, 'kaby-custom-heartbeat-note')) && /Resume/.test(label(m.tree, 'kaby-custom-heartbeat-pause')) && only(m.tree, 'kaby-custom-heartbeat-pause').props.disabled === false && only(m.tree, 'kaby-custom-heartbeat-wake').props.disabled === true)
  T.store.heartbeat = view({ why: 'altered' })
  m = mount()
  ok('altered or another key: red, an alert, pause and wake off, « Sign again » waits for a pick', only(m.tree, 'kaby-custom-heartbeat-chip').props['data-state'] === 'resign' && only(m.tree, 'kaby-custom-heartbeat-note').props.role === 'alert' && only(m.tree, 'kaby-custom-heartbeat-pause').props.disabled === true && only(m.tree, 'kaby-custom-heartbeat-wake').props.disabled === true && /Sign again/.test(label(m.tree, 'kaby-custom-heartbeat-sign')) && only(m.tree, 'kaby-custom-heartbeat-sign').props.disabled === true)
  T.store.heartbeat = view({ canSign: false, why: 'no_secret' })
  m = mount()
  ok('no key on this machine: every control is off and the card says why', only(m.tree, 'kaby-custom-heartbeat-chip').props['data-state'] === 'cannot_sign' && /cannot find this machine’s key/.test(label(m.tree, 'kaby-custom-heartbeat-note')) && [...byKb(m.tree, 'kaby-custom-heartbeat-preset'), ...['everyHours', 'boxMin', 'items'].map((k) => only(m.tree, 'kaby-custom-heartbeat-' + k)), only(m.tree, 'kaby-custom-heartbeat-quiet-switch'), only(m.tree, 'kaby-custom-heartbeat-sign'), only(m.tree, 'kaby-custom-heartbeat-pause'), only(m.tree, 'kaby-custom-heartbeat-wake')].every((n) => n.props.disabled === true))
  T.store.heartbeat = view({ ...ON, desktop: false })
  m = mount()
  ok('on a cloud computer the card warns that wake-ups happen on the person’s own computer, and « Wake it now » is off', /do not cover Kaby’s cloud computer/.test(label(m.tree, 'kaby-custom-heartbeat-cloud-note')) && only(m.tree, 'kaby-custom-heartbeat-wake').props.disabled === true)
  T.store.heartbeat = view({ ...ON })
  globalThis.window.__KB_KYBER__ = { where: () => ({ local: false, computers: [], picked: 'x', state: 'suspended' }), openChat: () => true }
  m = mount()
  ok('when Kaby works on a cloud computer the same warning shows, and « Open Kaby’s chat » is offered', byKb(m.tree, 'kaby-custom-heartbeat-cloud-note').length === 1 && /Open Kaby’s chat/.test(label(m.tree, 'kaby-custom-heartbeat-open')))
  let opened = 0
  globalThis.window.__KB_KYBER__ = { where: () => null, openChat: () => { opened += 1; return true } }
  m = mount()
  only(m.tree, 'kaby-custom-heartbeat-open').props.onClick()
  ok('« Open Kaby’s chat » goes through kybernos-kyber’s seam', opened === 1 && byKb(m.tree, 'kaby-custom-heartbeat-cloud-note').length === 0)
  globalThis.window.__KB_KYBER__ = { where: () => null, openChat: () => { throw new Error('no chat on screen') } }
  m = mount()
  ok('a seam that throws never breaks the card', (() => { only(m.tree, 'kaby-custom-heartbeat-open').props.onClick(); return true })())
  delete globalThis.window.__KB_KYBER__

  // what the controls do
  T.store.heartbeat = view({})
  m = mount()
  byKb(m.tree, 'kaby-custom-heartbeat-preset').find((b) => b.props['data-preset'] === 'steady').props.onClick()
  ok('a starting point fills the draft from the host’s own numbers and keeps the quiet hours', JSON.stringify(m.sets.find(([n]) => n === 2)[1]) === JSON.stringify({ on: true, everyHours: 2, boxMin: 20, items: 3, quiet: true, quietFrom: '22:00', quietTo: '08:00' }))
  m = mount()
  only(m.tree, 'kaby-custom-heartbeat-everyHours').props.onChange({ target: { value: '24' } })
  only(m.tree, 'kaby-custom-heartbeat-boxMin').props.onChange({ target: { value: 'abc' } })
  only(m.tree, 'kaby-custom-heartbeat-items').props.onChange({ target: { value: '3' } })
  ok('a select changes that field only, and a word is ignored', m.sets.length === 2 && m.sets[0][1].everyHours === 24 && m.sets[0][1].boxMin === 10 && m.sets[1][1].items === 3 && m.sets[1][1].everyHours === 4)
  m = mount()
  only(m.tree, 'kaby-custom-heartbeat-quiet-switch').props.onClick()
  only(m.tree, 'kaby-custom-heartbeat-from').props.onChange({ target: { value: '23:30' } })
  only(m.tree, 'kaby-custom-heartbeat-to').props.onChange({ target: { value: '25:00' } })
  only(m.tree, 'kaby-custom-heartbeat-to').props.onChange({ target: { value: '' } })
  ok('the quiet switch and the start time change the draft; a time that is not one is ignored', m.sets.length === 2 && m.sets[0][1].quiet === false && m.sets[1][1].quietFrom === '23:30')
  ok('the two times are off while the quiet hours are off', (() => { const d = { on: false, everyHours: 4, boxMin: 10, items: 2, quiet: false, quietFrom: '22:00', quietTo: '08:00' }; const x = mount({ 2: d }); return only(x.tree, 'kaby-custom-heartbeat-from').props.disabled === true && only(x.tree, 'kaby-custom-heartbeat-to').props.disabled === true })())

  const asked = []
  const answer = (status, json) => { globalThis.fetch = async (url, init) => { asked.push({ url, init }); return { status, json: async () => json } } }
  const DRAFT = { on: true, everyHours: 8, boxMin: 5, items: 1, quiet: false, quietFrom: '21:00', quietTo: '07:00' }
  T.store.heartbeat = view({})
  m = mount({ 2: DRAFT })
  answer(200, { ok: true, view: view({ ...ON, preset: 'light', everyHours: 8, boxMin: 5, items: 1, quiet: false, quietFrom: '21:00', quietTo: '07:00' }) })
  await only(m.tree, 'kaby-custom-heartbeat-sign').props.onClick()
  ok('signing posts the seven fields to the host, never « paused », same origin, with the cookie', asked[0].url === '/kybernos-cloud/kyby/heartbeat/set' && asked[0].init.method === 'POST' && asked[0].init.credentials === 'same-origin' && JSON.stringify(JSON.parse(asked[0].init.body)) === JSON.stringify(DRAFT))
  ok('the host’s answer replaces the card’s state and clears the draft', T.store.heartbeat.inForce === true && T.store.heartbeat.everyHours === 8 && T.store.heartbeat.desktop === true && m.sets.some(([n, x]) => n === 2 && x === null) && m.sets.some(([n, x]) => n === 3 && x === true) && m.sets.some(([n, x]) => n === 3 && x === false))
  asked.length = 0
  T.store.heartbeat = view(ON)
  m = mount()
  answer(200, { ok: true, view: view({ why: 'paused', paused: true, signedAt: SIGNED, on: true }) })
  await only(m.tree, 'kaby-custom-heartbeat-pause').props.onClick()
  ok('pausing posts only « paused: true »; the host keeps the rest', asked[0].url.endsWith('/heartbeat/set') && JSON.stringify(JSON.parse(asked[0].init.body)) === JSON.stringify({ paused: true }))
  asked.length = 0
  T.store.heartbeat = view({ why: 'paused', paused: true, signedAt: SIGNED, on: true })
  m = mount()
  answer(200, { ok: true, view: view(ON) })
  await only(m.tree, 'kaby-custom-heartbeat-pause').props.onClick()
  ok('resuming posts « paused: false »', JSON.stringify(JSON.parse(asked[0].init.body)) === JSON.stringify({ paused: false }))
  T.store.heartbeat = view({})
  m = mount({ 2: DRAFT })
  answer(401, { ok: false, error: 'session' })
  await only(m.tree, 'kaby-custom-heartbeat-sign').props.onClick()
  ok('a request without the page’s session is refused in words, the draft is kept', m.sets.some(([n, x]) => n === 4 && /reload it/.test(x)) && !m.sets.some(([n, x]) => n === 2 && x === null) && T.store.heartbeat.inForce === false)
  m = mount({ 2: DRAFT })
  answer(200, { ok: false, error: 'cannot_sign' })
  await only(m.tree, 'kaby-custom-heartbeat-sign').props.onClick()
  ok('a refusal of the host is shown as its sentence', m.sets.some(([n, x]) => n === 4 && /cannot find this computer’s key/.test(x)))
  m = mount({ 2: DRAFT })
  globalThis.fetch = async () => { throw new Error('offline') }
  await only(m.tree, 'kaby-custom-heartbeat-sign').props.onClick()
  ok('a host that does not answer is a sentence, not a crash', m.sets.some(([n, x]) => n === 4 && /do not answer/.test(x)) && m.sets.some(([n, x]) => n === 3 && x === false))

  // « Wake it now »
  asked.length = 0
  T.store.heartbeat = view(ON)
  m = mount()
  globalThis.fetch = async (url, init) => { asked.push({ url, init }); return init !== undefined && init.method === 'POST' ? { status: 200, json: async () => ({ ok: true }) } : { status: 200, json: async () => view({ ...ON, running: true }) } }
  await only(m.tree, 'kaby-custom-heartbeat-wake').props.onClick()
  ok('« Wake it now » posts to the wake route, then reads the view again so the chip follows it', asked[0].url === '/kybernos-cloud/kyby/heartbeat/wake' && asked[0].init.method === 'POST' && asked[0].init.credentials === 'same-origin' && asked[1].url === '/kybernos-cloud/kyby/heartbeat' && T.store.heartbeat.running === true)
  m = mount()
  answer(200, { ok: false, error: 'busy' })
  await only(m.tree, 'kaby-custom-heartbeat-wake').props.onClick()
  ok('a wake-up that cannot start says why, in words', m.sets.some(([n, x]) => n === 4 && /busy/.test(x)) && m.sets.some(([n, x]) => n === 3 && x === false))
  m = mount()
  answer(401, { ok: false, error: 'session' })
  await only(m.tree, 'kaby-custom-heartbeat-wake').props.onClick()
  ok('a wake-up asked without the page’s session is refused in words', m.sets.some(([n, x]) => n === 4 && /reload it/.test(x)))
  // « Stop this wake-up »
  asked.length = 0
  T.store.heartbeat = view({ ...ON, running: true })
  m = mount()
  globalThis.fetch = async (url, init) => { asked.push({ url, init }); return init !== undefined && init.method === 'POST' ? { status: 200, json: async () => ({ ok: true }) } : { status: 200, json: async () => view({ ...ON, running: false, lastAt: SIGNED, lastOutcome: 'stopped' }) } }
  await only(m.tree, 'kaby-custom-heartbeat-stop').props.onClick()
  ok('« Stop this wake-up » posts to the stop route, then reads the view again so the chip follows it', asked[0].url === '/kybernos-cloud/kyby/heartbeat/stop' && asked[0].init.method === 'POST' && asked[0].init.credentials === 'same-origin' && asked[1].url === '/kybernos-cloud/kyby/heartbeat' && T.store.heartbeat.running === false && m.sets.some(([n, x]) => n === 3 && x === false))
  T.store.heartbeat = view({ ...ON, running: true })
  m = mount()
  answer(200, { ok: false, error: 'not_running' })
  await only(m.tree, 'kaby-custom-heartbeat-stop').props.onClick()
  ok('a stop that finds nothing running says so, in words', m.sets.some(([n, x]) => n === 4 && /just ended/.test(x)) && m.sets.some(([n, x]) => n === 3 && x === false))
  m = mount()
  answer(401, { ok: false, error: 'session' })
  await only(m.tree, 'kaby-custom-heartbeat-stop').props.onClick()
  ok('a stop asked without the page’s session is refused in words', m.sets.some(([n, x]) => n === 4 && /reload it/.test(x)))
  T.store.heartbeat = view(ON)
  resolved = 'kybernos'
  T.store.heartbeat = view(ON)
  ok('in French the same card speaks French', /Réveils/.test(text(mount().tree)) && /Réveiller maintenant/.test(text(mount().tree)) && /Silence la nuit/.test(text(mount().tree)))
  resolved = 'en'
  T.store.heartbeat = null
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
  const mandatePaths = [...source.matchAll(/mandateCall\(\s*'([^']*)'/g)].map((m) => m[1])
  ok('the permissions are asked only of kybernos-cloud’s three routes: the view, the log and the signing', T.MANDATE === '/kybernos-cloud/kyby/mandate' && mandatePaths.length >= 3 && mandatePaths.every((p) => ['', '/log', '/set'].includes(p)), mandatePaths.join('|'))
  const heartbeatPaths = [...source.matchAll(/heartbeatCall\(\s*'([^']*)'/g)].map((m) => m[1])
  ok('the wake-ups are asked only of kybernos-cloud’s four routes: the view, the signing, the wake and the stop', T.HEARTBEAT === '/kybernos-cloud/kyby/heartbeat' && heartbeatPaths.length >= 4 && heartbeatPaths.every((p) => ['', '/set', '/wake', '/stop'].includes(p)) && ['', '/set', '/wake', '/stop'].every((p) => heartbeatPaths.includes(p)), heartbeatPaths.join('|'))
  ok('every hook the wake-up checks need is in the source', ['kaby-custom-heartbeat', 'kaby-custom-heartbeat-chip', 'kaby-custom-heartbeat-preset', 'kaby-custom-heartbeat-quiet-switch', 'kaby-custom-heartbeat-from', 'kaby-custom-heartbeat-to', 'kaby-custom-heartbeat-sign', 'kaby-custom-heartbeat-pause', 'kaby-custom-heartbeat-wake', 'kaby-custom-heartbeat-stop', 'kaby-custom-heartbeat-open'].every((k) => source.includes("'" + k + "'")) && source.includes("'kaby-custom-heartbeat-' + key"))
  ok('the where-card reaches kybernos-kyber only through its seam, never its files', ['where', 'pickWhere', 'subscribe', 'refresh'].every((m) => source.includes('k.' + m)) && !/kybernos-kyber\/|import .*kybernos-kyber/.test(source.replace(/\/\/.*$/gm, '').replace(/kybernos-kyber'?s? seam/g, '')))
  ok('every hook the permission checks need is in the source', ['kaby-custom-where', 'kaby-custom-where-pick', 'kaby-custom-mandate', 'kaby-custom-mandate-preset', 'kaby-custom-mandate-switch', 'kaby-custom-mandate-limit', 'kaby-custom-mandate-sign', 'kaby-custom-mandate-pause', 'kaby-custom-mandate-log-toggle', 'kaby-custom-mandate-chip'].every((k) => source.includes("'" + k + "'")))
  ok('the section id is the one the nav key table will carry', /SECTION_ID = 'kybernos-kaby-customisation'/.test(source))
  ok('every hook the live checks need is in the source', ['kaby-custom-page', 'kaby-custom-name', 'kaby-custom-look', 'kaby-custom-generate', 'kaby-custom-import', 'kaby-custom-voice-pill', 'kaby-custom-preview', 'kaby-custom-custom-voice', 'kaby-custom-face-provider', 'kaby-custom-face-use'].every((k) => source.includes("'" + k + "'")))
  ok('a recording that ends after the window was closed cannot reopen it', /patchCv = \(patch\) => setCv\(\(c\) => \(c === null \? c :/.test(source))
  ok('the help card is wired the guarded way', /window\.__KB_HELP__ && window\.__KB_HELP__\.Help/.test(source))
}

console.log(failures === 0 ? '\nall passed' : '\n' + failures + ' FAILED')
process.exit(failures > 0 ? 1 : 0)
