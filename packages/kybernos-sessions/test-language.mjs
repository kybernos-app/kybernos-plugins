#!/usr/bin/env node
// The words of the client of kybernos-sessions, in two languages (decision D1: English is the base, French the twin; A2-19, A2-21).
//
// The « Kybernos Settings » block of Settings › General, the words of the category icons and the refusals of the settings route
// are said by one pair helper, `kt(fr, en)`: French for `kybernos` or an fr* tag, English for every other language, English when
// the language resolver throws or is absent, and a translated language looks the French text up in the dictionary it serves.
// No browser: the block is rendered by a recording React stand-in, and read as the list of the texts it shows.
//
//   node packages/kybernos-sessions/test-language.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) } }

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
// A React stand-in that records the tree, and hands each useState its scripted value in the order the component asks for them.
let script = []
let asked = 0
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: (init) => { const v = asked < script.length ? script[asked] : init; asked += 1; return [v, () => {}] },
  useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (f) => f, useMemo: (f) => f(), Fragment: 'fragment'
}
const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, dispatchEvent: () => true, __ModuleLoader__: null }
let definition = null
win.__ModuleLoader__ = { load: (def) => { definition = def } }
globalThis.window = win
globalThis.CustomEvent = class { constructor (type) { this.type = type } }
globalThis.document = { documentElement: { lang: 'en', getAttribute: () => null }, createElement: () => ({ style: {} }), head: { append () {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener () {} }
new Function('window', SOURCE)(win)
const mod = definition.factory((spec) => { if (spec === 'react') return React; throw new Error('unexpected require ' + spec) })
const T = mod.__test
const setLang = (l) => { win.__KB_LANG_RESOLVE__ = typeof l === 'function' ? l : () => l }

// Every text the tree shows: the children that are strings, and the labels of the attributes a person reads.
const texts = (node, out = []) => {
  if (typeof node === 'string') { out.push(node); return out }
  if (node === null || node === undefined || typeof node !== 'object') return out
  for (const k of ['aria-label', 'title']) if (typeof node.props[k] === 'string') out.push(node.props[k])
  if (node.props.label !== undefined && typeof node.props.label === 'string') out.push(node.props.label)
  for (const c of node.children) texts(c, out)
  return out
}
const render = (state) => {
  asked = 0
  script = [state.reglages, state.erreur === undefined ? null : state.erreur, state.enregistre === true, state.modeles, state.etude === undefined ? null : state.etude]
  return texts(T.ReglagesKybernos())
}
const MODELES = [{ cle: 'groq/llama-3.1-8b', route: 'groq', id: 'llama-3.1-8b' }, { cle: 'zai/glm-4', route: 'zai', id: 'glm-4' }]
const STATES = {
  auto: { reglages: { renameAfterRecap: true, brain: '' }, modeles: MODELES, etude: { mode: 'auto', cle: 'kybernos/auto', auto: 'kybernos/auto' }, enregistre: true },
  off: { reglages: { renameAfterRecap: false, brain: 'none' }, modeles: MODELES, etude: { mode: 'none', cle: '', auto: 'kybernos/auto' } },
  gone: { reglages: { renameAfterRecap: true, brain: 'old/gone' }, modeles: MODELES, etude: { mode: 'choisi', cle: 'old/gone', auto: '' }, erreur: 'boom' },
  empty: { reglages: { renameAfterRecap: true, brain: '' }, modeles: [], etude: { mode: 'aucun', cle: '', auto: '' } },
  unreadable: { reglages: { renameAfterRecap: true, brain: '' }, modeles: null, etude: null }
}
const ACCENT = /[àâçéèêëîïôùûœ]/i

console.log('the pair helper')
setLang('en'); check('English shows the English side', T.kt('Bonjour', 'Hello') === 'Hello')
setLang('kybernos'); check('French (« kybernos ») shows the French side', T.kt('Bonjour', 'Hello') === 'Bonjour')
setLang('fr-CA'); check('an fr* tag shows the French side', T.kt('Bonjour', 'Hello') === 'Bonjour')
for (const l of ['es', 'ar', 'zh', 'de', 'pt-BR']) { setLang(l); check(l + ' (no dictionary) shows English, never French', T.kt('Bonjour', 'Hello') === 'Hello') }
win.__KB_I18N_ACTIVE__ = { lang: 'es', dict: { Bonjour: 'Hola' } }
setLang('es'); check('a translated language is looked up by the French text', T.kt('Bonjour', 'Hello') === 'Hola' && T.kt('Salut', 'Hi') === 'Hi')
delete win.__KB_I18N_ACTIVE__
setLang(() => { throw new Error('not ready') }); check('a resolver that throws gives English', T.kt('Bonjour', 'Hello') === 'Hello')
win.__KB_LANG_RESOLVE__ = undefined; check('no resolver at all gives English (the page language attribute is the only hint left)', T.kt('Bonjour', 'Hello') === 'Hello')

console.log('the « Kybernos Settings » block has a French twin (A2-19)')
for (const [nom, st] of Object.entries(STATES)) {
  setLang('en'); const en = render(st)
  setLang('kybernos'); const fr = render(st)
  setLang('es'); const es = render(st)
  const meme = en.map((t, i) => [t, fr[i]]).filter(([a, b]) => a === b)
  check(nom + ': the block shows the same texts in both languages (' + en.length + ')', en.length === fr.length && en.length > 3 && JSON.stringify(es) === JSON.stringify(en), { en: en.length, fr: fr.length })
  check(nom + ': in French, every text but a model name has changed', meme.every(([a]) => a === '…' || /^[\w./:-]+$/.test(a) || /[\w-]+\/[\w.:-]+( —.*)?$/.test(a)), meme.map((x) => x[0]))
  check(nom + ': in English, no French accent', en.every((t) => !ACCENT.test(t)), en.filter((t) => ACCENT.test(t)))
  check(nom + ': in French, « tu », never « vous »', fr.every((t) => !/\b(vous|votre|vos)\b/i.test(t)), fr.filter((t) => /\b(vous|votre|vos)\b/i.test(t)))
}
setLang('en'); const enAuto = render(STATES.auto)
setLang('kybernos'); const frAuto = render(STATES.auto)
check('the labels the help quotes: Réglages Kybernos, Premiers pas, Nommer chaque conversation à sa fin, Modèle d’étude, Rejouer, Oui/Non',
  ['Réglages Kybernos', 'Premiers pas', 'Nommer chaque conversation à sa fin', 'Modèle d’étude', 'Rejouer', 'Oui', 'Non', 'Aucun', 'Automatique — kybernos/auto'].every((t) => frAuto.includes(t)), frAuto)
check('…and in English: Kybernos Settings, Onboarding, Name each chat when it ends, Study model, Replay, Yes/No, None',
  ['Kybernos Settings', 'Onboarding', 'Name each chat when it ends', 'Study model', 'Replay', 'Yes', 'No', 'None', 'Automatic — kybernos/auto'].every((t) => enAuto.includes(t)), enAuto)
setLang('es'); win.__KB_I18N_ACTIVE__ = { lang: 'es', dict: { 'Réglages Kybernos': 'Ajustes de Kybernos', Rejouer: 'Repetir' } }
const esAuto = render(STATES.auto)
check('a translated language gets its dictionary where it has a word, and English elsewhere', esAuto.includes('Ajustes de Kybernos') && esAuto.includes('Repetir') && esAuto.includes('Study model') && !esAuto.some((t) => ACCENT.test(t)), esAuto)
delete win.__KB_I18N_ACTIVE__

console.log('the refusals of the settings route are worded by their code')
{
  const codes = Object.keys(T.ERR_REGLAGES)
  setLang('en')
  check('every code has an English and a French sentence', codes.length >= 5 && codes.every((c) => T.ERR_REGLAGES[c].length === 2 && T.ERR_REGLAGES[c].every((t) => t.length > 5)), codes)
  check('English: the sentence, not the host’s', T.direErreur({ ok: false, code: 'invalid-brain', erreur: 'brain: expected…' }) === 'The Study model must be a “provider/model” identifier, “none” or empty.')
  setLang('kybernos')
  check('French: the sentence, in « tu »', T.direErreur({ ok: false, code: 'settings-corrupt' }).includes('Corrige ou supprime le fichier') && codes.every((c) => !/\b(vous|votre|vos)\b/i.test(T.ERR_REGLAGES[c][0])))
  setLang('es')
  check('Spanish: English', T.direErreur({ ok: false, code: 'settings-corrupt' }).startsWith('settings.json is not a valid JSON object'))
  setLang('kybernos')
  check('the system’s own words follow a write failure, untranslated', T.direErreur({ ok: false, code: 'settings-not-written', erreur: 'EACCES: permission denied' }) === 'Le fichier de réglages n’a pas pu être écrit (EACCES: permission denied)')
  check('a code it does not know shows the host’s English sentence; none at all shows a worded fallback', T.direErreur({ ok: false, code: 'new-one', erreur: 'something else' }) === 'something else' && T.direErreur({ ok: false }) === 'Refusé par l’hôte.' && T.direErreur(null) === 'Refusé par l’hôte.')
  setLang('en')
  check('…in English too', T.direErreur({ ok: false }) === 'Rejected by the host.' && T.direErreur({ ok: false, code: 'constructor' }) === 'Rejected by the host.')
}

console.log('the words of the category icons')
{
  const mots = Object.values(T.CATEGORIE_PAR_SLUG).map((c) => c.mot)
  setLang('en')
  check('the base of every word is English (it is the key kept in data-mot)', mots.every((m) => !ACCENT.test(m)) && T.motAffiche('Feature') === 'Feature' && T.motAffiche('Uncategorised') === 'Uncategorised', mots)
  check('every category has a French twin', mots.every((m) => T.MOTS_FR[m] !== undefined), mots.filter((m) => T.MOTS_FR[m] === undefined))
  setLang('kybernos')
  check('French: Fonctionnalité, Correctif, Intégration, Données, Nettoyage, Non classé', ['Feature', 'Fix', 'Integration', 'Data', 'Cleanup', 'Uncategorised'].map(T.motAffiche).join() === 'Fonctionnalité,Correctif,Intégration,Données,Nettoyage,Non classé')
  setLang('es')
  check('Spanish with no dictionary: English', T.motAffiche('Integration') === 'Integration')
  setLang('en')
}

console.log('the « General » tab is renamed in French only (a French default was the bug)')
{
  const bouton = () => { const noeud = { nodeType: 3, nodeValue: ' General ' }; return { noeud, dataset: {}, childNodes: [noeud], querySelectorAll: () => [] } }
  // the old code read the html lang attribute and took « fr » when it was missing: an English UI with no attribute got « Général »
  globalThis.document.documentElement.getAttribute = () => null
  setLang('en'); const a = bouton(); T.rgRenommerGeneral(a)
  check('English with no lang attribute: the tab keeps « General »', a.noeud.nodeValue.trim() === 'General' && a.dataset.kbRenomme === '1', a.noeud.nodeValue)
  win.__KB_LANG_RESOLVE__ = undefined; const b = bouton(); T.rgRenommerGeneral(b)
  check('no language resolver and no lang attribute: English too', b.noeud.nodeValue.trim() === 'General')
  setLang('es'); const c = bouton(); T.rgRenommerGeneral(c)
  check('Spanish: untouched (the live layer translates it)', c.noeud.nodeValue.trim() === 'General')
  setLang('kybernos'); const d = bouton(); T.rgRenommerGeneral(d)
  check('French: « Général »', d.noeud.nodeValue.trim() === 'Général')
  setLang('en')
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
