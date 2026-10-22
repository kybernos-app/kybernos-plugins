#!/usr/bin/env node
// The Memory & Lessons card and the action card of the sessions client, in two languages (audit L5-03).
//
// The file is bilingual (kt(fr, en) all over), but the card of the Memory pill — the two empty states, the auto-capture status, the
// « picked for your latest message » lines, the ledger — and the buttons of an action card (« Confirm & run », « Copy as text », « Details »,
// « Close ») were English only: in a French interface, exactly the lines that explain to the reader what the panel does stayed English.
// The real components run here on a recording stand-in for React; each phrase is checked in French (the page resolves to « kybernos »),
// in English, and in a language that has no table of ours (English, never French).
//
//   node packages/kybernos-sessions/test-panels-language.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 400))) } }

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'client.js'), 'utf8')

// A React stand-in that records the tree, and hands each useState its scripted value in the order the component asks for them.
let script = []
let asked = 0
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: (init) => { const v = asked < script.length ? script[asked] : (typeof init === 'function' ? init() : init); asked += 1; return [v, () => {}] },
  useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (f) => f, useMemo: (f) => f(), Fragment: 'fragment'
}
const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {}, __ModuleLoader__: null }
let definition = null
win.__ModuleLoader__ = { load: (def) => { definition = def } }
globalThis.window = win
globalThis.CustomEvent = class { constructor (type) { this.type = type } }
globalThis.document = { documentElement: { lang: 'en', getAttribute: () => null }, createElement: () => ({ style: {} }), head: { append () {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener () {}, removeEventListener () {} }
new Function('window', SOURCE)(win)
const mod = definition.factory((spec) => { if (spec === 'react') return React; throw new Error('unexpected require ' + spec) })
const T = mod.__test
const setLang = (l) => { win.__KB_LANG_RESOLVE__ = typeof l === 'function' ? l : () => l }
check('the pieces under test are reachable (Pills, PlanAction, Pop, Copier)', ['Pills', 'PlanAction', 'Pop', 'Copier'].every((k) => typeof T[k] === 'function'))

// Every text the tree shows, including what a card receives as props (its title, its sentence, its visual, its tabs, its details).
const CARD_PROPS = ['name', 'titre', 'texte', 'visuel', 'nav', 'action', 'details']
const texts = (node, out = []) => {
  if (typeof node === 'string') { out.push(node); return out }
  if (Array.isArray(node)) { for (const c of node) texts(c, out); return out }
  if (node === null || node === undefined || typeof node !== 'object') return out
  for (const k of ['aria-label', 'title', 'placeholder']) if (typeof node.props[k] === 'string') out.push(node.props[k])
  if (typeof node.type === 'function') {
    if (node.type === T.Copier) return out // its sentence is the text it copies, said apart below
    for (const k of CARD_PROPS) texts(node.props[k], out)
  }
  for (const c of node.children) texts(c, out)
  return out
}
const run = (fn, state) => { asked = 0; script = state; return texts(fn()).join(' ¶ ') }

// ── the card of the Memory pill ───────────────────────────────────────────────────────────────────────────────────────
const ev = (name, args, ts) => ({ type: 'tool/call', time: ts, data: { name, callId: 'c' + ts, arguments: JSON.stringify(args) } })
const JOURNAL = { cwd: '', events: [
  ev('bash', { command: 'node memory.cjs record --kyber k1 --role dev --outcome ok --note done' }, 1700000001000),
  ev('bash', { command: 'node memory.cjs lesson --kyber k1 --text "Check twice"' }, 1700000002000),
  ev('bash', { command: 'node memory.cjs used --kyber k1 --index 3' }, 1700000003000),
  ev('memory_write', { kind: 'pref', content: 'likes tea', pinned: true }, 1700000004000)
] }
const MEM = { sent: 3, total: 7, used: 120, cap: 4000, picked: 2, capture: { status: 'ecrit', facts: 2 }, actif: true }
// useState order of Pills: changesOn, etat, journal, ouverte, kyberChoisi, onglet, memInfo, lesPicked, teamSent
const pills = (o) => run(() => T.Pills({ sessionId: 's1' }), [true, { session: null }, o.journal, 'notes', null, o.onglet, o.mem, o.lesPicked === undefined ? 0 : o.lesPicked, o.team === undefined ? null : o.team])

// [what it says in French, what it says in English], by view. Each view is rendered once per language.
const VUES = {
  'memory tab, with an account, a journal and a capture status': [{ journal: JOURNAL, onglet: 'mem', mem: MEM, lesPicked: 1, team: { count: 2, picked: 1 } }, [
    ['Mémoire & Leçons', 'Memory & Lessons'],
    ['3 sur 7 souvenirs envoyés au modèle', '3 of 7 memories sent to the model'],
    ['Ce que le compte retient sur toi', 'What the account remembers about you'],
    ['Retenus pour ton dernier message : 2 souvenirs qui y correspondent', 'Picked for your latest message: 2 memories that match it'],
    ['Capture automatique : a écrit 2 souvenirs', 'Auto-capture: wrote 2 memories'],
    ['3 sur 7 · 120 / 4000 caractères', '3 of 7 · 120 / 4000 characters'],
    ['Écrit par cette conversation', 'Written by this chat'],
    ['souvenir enregistré', 'memory saved'],
    ['épinglé', 'pinned'],
    ['exécution enregistrée', 'run recorded'],
    ['leçon écrite', 'lesson written'],
    ['leçon réutilisée', 'lesson reused'],
    ['leçon n° 3 — son compteur d’utilisations a été augmenté', 'lesson #3 — its uses counter was raised'],
    ['Ouvrir Mémoire & Leçons ›', 'Open Memory & Lessons ›'],
    ['Registre de l’Agent Team', 'Agent Team ledger'],
    ['Exécutions enregistrées', 'Runs recorded'],
    ['Leçons écrites', 'Lessons written'],
    ['Leçons réutilisées', 'Lessons reused'],
    ['Souvenirs enregistrés', 'Memories saved'],
    ['Stockage', 'Storage'],
    ['Mémoire et leçons', 'Memory and lessons'],
    ['2 écrits par cette conversation', '2 written by this chat']
  ]],
  'lessons tab': [{ journal: JOURNAL, onglet: 'les', mem: MEM, lesPicked: 1, team: { count: 2, picked: 1 } }, [
    ['Les leçons sont écrites par un agent', 'Lessons are written by an agent'],
    ['Retenue pour ton dernier message : 1 leçon qui y correspond', 'Picked for your latest message: 1 lesson that match it'],
    ['De ton équipe : 2 leçons envoyées (1 qui correspond à ton dernier message)', 'From your team: 2 lessons sent (1 that match your latest message)'],
    ['Leçons de cette conversation', 'Lessons in this chat'],
    ['2 leçons dans cette conversation', '2 lessons in this chat']
  ]],
  'memory tab, no account (the first empty state)': [{ journal: null, onglet: 'mem', mem: null }, [
    ['La mémoire du compte n’est pas disponible ici : connecte Kybernos Cloud, ou active son plugin.', 'The account memory is not available here: connect Kybernos Cloud, or switch its plugin on.'],
    ['Rien pour l’instant. Les souvenirs sont capturés à la fin d’un tour, ou enregistrés par l’agent.', 'Nothing yet. Memories are captured at the end of a turn, or saved by the agent.'],
    ['Mémoire du compte indisponible (connecte Kybernos Cloud)', 'Account memory unavailable (connect Kybernos Cloud)'],
    ['Rien d’écrit par cette conversation pour l’instant', 'Nothing written by this chat yet'],
    ['aucune leçon dans cette conversation', 'no lesson in this chat']
  ]],
  'memory tab, one of everything (the singular is French too)': [{ journal: null, onglet: 'mem', mem: { sent: 1, total: 1, used: 10, cap: 4000, picked: 1, capture: { status: 'ecrit', facts: 1 }, actif: true } }, [
    ['1 sur 1 souvenir envoyé au modèle', '1 of 1 memories sent to the model'],
    ['Retenu pour ton dernier message : 1 souvenir qui y correspond', 'Picked for your latest message: 1 memory that match it'],
    ['Capture automatique : a écrit 1 souvenir', 'Auto-capture: wrote 1 memory']
  ]],
  'memory tab, memory switched off': [{ journal: null, onglet: 'mem', mem: { ...MEM, actif: false, picked: 0, capture: { status: 'desactivee' } } }, [
    ['La mémoire est désactivée : rien n’est envoyé au modèle.', 'Memory is switched off: nothing is sent to the model.'],
    ['Capture automatique : désactivée', 'Auto-capture: switched off']
  ]],
  'lessons tab, nothing learned (the second empty state)': [{ journal: null, onglet: 'les', mem: null }, [
    ['Rien d’appris ni de réutilisé dans cette conversation pour l’instant.', 'Nothing learned or reused in this chat yet.']
  ]]
}
for (const [vue, [etat, phrases]] of Object.entries(VUES)) {
  console.log('\n── ' + vue + ' ──')
  setLang('kybernos')
  const fr = pills(etat)
  setLang('en')
  const en = pills(etat)
  setLang('es')
  const es = pills(etat)
  for (const [f, e] of phrases) {
    check('« ' + e + ' » — French says « ' + f + ' », not the English', fr.includes(f) && !fr.includes(e), fr.includes(f) ? 'the English is still there' : 'the French is missing')
    check('...and English still says it as it did; so does a language with no table of ours (never French)', en.includes(e) && !en.includes(f) && es.includes(e) && !es.includes(f))
  }
}

// ── the pill itself ───────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── the pill ──')
{
  const pillText = (lg) => { setLang(lg); asked = 0; script = [true, { session: null }, JOURNAL, null, null, 'mem', MEM, 0, null]; return texts(T.Pills({ sessionId: 's1' })).join(' ¶ ') }
  const fr = pillText('kybernos')
  const en = pillText('en')
  check('French: the pill says « Mémoire » and its bubble lines are French', fr.includes('Mémoire') && fr.includes('3 sur 7 souvenirs envoyés au modèle') && !/\bMemory\b/.test(fr), fr.slice(0, 200))
  check('English: the pill says « Memory » and its bubble lines are English', en.includes('Memory') && en.includes('3 of 7 memories sent to the model') && !/Mémoire/.test(en), en.slice(0, 200))
}

// ── the action card ───────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── the action card (Confirm & run, Done, Copy as text, Details, Close) ──')
{
  const CARTES = [
    ['a plan waiting for confirmation', () => run(() => T.PlanAction({ url: '/x', corps: {}, label: 'Save', hint: '' }), [{ ok: true, dry: true, commandes: ['git commit'] }]), 'Confirmer et lancer', 'Confirm & run'],
    ['an action that went through', () => run(() => T.PlanAction({ url: '/x', corps: {}, label: 'Save', hint: '' }), [{ ok: true, dry: false, message: 'fait' }]), 'Terminé ✓', 'Done ✓'],
    ['a refusal that carries no sentence', () => run(() => T.PlanAction({ url: '/x', corps: {}, label: 'Save', hint: '' }), [{ ok: false }]), 'refusé', 'refused'],
    ['the copy button', () => run(() => T.Copier({ texte: 'x' }), [false]), 'Copier en texte', 'Copy as text'],
    ['...once copied', () => run(() => T.Copier({ texte: 'x' }), [true]), 'copié ✓', 'copied ✓'],
    ['the close button of a card', () => run(() => T.Pop({ idCarte: 'x', name: 'N', icon: 'brain', accent: '#000', titre: 'T', visuel: null, onClose: () => {} }), [false]), 'Fermer', 'Close'],
    ['the details button of a card', () => run(() => T.Pop({ idCarte: 'x', name: 'N', icon: 'brain', accent: '#000', titre: 'T', visuel: null, details: 'd', onClose: () => {} }), [false]), 'Détails', 'Details']
  ]
  for (const [nom, rendre, f, e] of CARTES) {
    setLang('kybernos')
    const fr = rendre()
    setLang('en')
    const en = rendre()
    setLang('es')
    const es = rendre()
    check(nom + ': « ' + f + ' » in French, « ' + e + ' » in English and in a language with no table of ours', fr.includes(f) && !fr.includes(e) && en.includes(e) && !en.includes(f) && es.includes(e) && !es.includes(f), [fr, en])
  }
}

// ── the way into the Settings page ────────────────────────────────────────────────────────────────────────────────────
// « Open Memory & Lessons » finds the page by the text of its entry in the Settings menu: that entry is worded by the memory plugin
// (kt('Mémoire & Leçons', 'Memory & Lessons')). The button must look for the same words in the same language, or it finds nothing.
console.log('\n── the button that opens the Settings page ──')
{
  const memoire = readFileSync(join(HERE, '..', 'kybernos-memory', 'client.js'), 'utf8')
  check('the memory plugin words its page « Mémoire & Leçons » / « Memory & Lessons »', /kt\('Mémoire & Leçons', PAGE_TITLE\)/.test(memoire) && /const PAGE_TITLE = 'Memory & Lessons'/.test(memoire))
  check('the button looks the page up with the same pair, not with a fixed English label', /const titreMemLecons = kt\('Mémoire & Leçons', 'Memory & Lessons'\)/.test(SOURCE) && /ouvrirReglagesSection\(titreMemLecons\)/.test(SOURCE) && !/ouvrirReglagesSection\('Memory & Lessons'\)/.test(SOURCE))
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
