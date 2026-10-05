#!/usr/bin/env node
// kybernos-maintenance — the About page, without a browser and without
// dependency: the REAL client.js is run against a tiny React stand-in (state,
// effects, error boundary) and its element tree is inspected.
//
//   node test-about.mjs
//
// What stays pinned:
//  - the section keeps its id (stored state and tests depend on it) and only the
//    label changed (About / À propos), in both languages;
//  - above the fold: wordmark (brand component or text fallback), version line,
//    Check now, ONE status block, three tiles, a links row — nothing else;
//  - everything the old page showed (stat cards, last operation, journal,
//    contract, compatibility matrix, engine surfaces, update procedure) sits in
//    ONE collapsed disclosure whose choice is remembered, and the old
//    Simple/Advanced toggle is gone;
//  - nothing here may throw: absent or broken brand component, storage that
//    throws, a host answer that is not a state;
//  - the host reads the shipped VERSION and never makes a version up.
//
// Optional last stage: with react + react-dom on NODE_PATH, the same tree is
// rendered by the real React (renderToStaticMarkup). Without them it is skipped.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lireVersion } from './version.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const ICI = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(ICI, '..', '..')
const SOURCE = readFileSync(join(ICI, 'client.js'), 'utf8')
const HOST = readFileSync(join(ICI, 'index.js'), 'utf8')

// ── a tiny React stand-in: elements, hooks, class boundary ─────────────────
const FRAGMENT = Symbol('fragment')
class Component { constructor (props) { this.props = props; this.state = {} } }
const createElement = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })

const session = { hooks: new Map(), insts: new Map(), effects: [], path: '', i: 0, rendering: false, dirty: false, tree: null, root: null }
const slotOf = () => {
  if (!session.hooks.has(session.path)) session.hooks.set(session.path, [])
  const hk = session.hooks.get(session.path)
  const idx = session.i++
  return { hk, idx }
}
const useState = (init) => {
  const { hk, idx } = slotOf()
  if (!(idx in hk)) hk[idx] = { v: typeof init === 'function' ? init() : init }
  const slot = hk[idx]
  return [slot.v, (n) => { slot.v = typeof n === 'function' ? n(slot.v) : n; demander() }]
}
const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])
const useEffect = (fn, deps) => {
  const { hk, idx } = slotOf()
  if (!(idx in hk) || !sameDeps(hk[idx].deps, deps)) { hk[idx] = { deps }; session.effects.push(fn) }
}
const useCallback = (fn, deps) => {
  const { hk, idx } = slotOf()
  if (!(idx in hk) || !sameDeps(hk[idx].deps, deps)) hk[idx] = { deps, fn }
  return hk[idx].fn
}
const FAKE_REACT = { createElement, Fragment: FRAGMENT, Component, useState, useEffect, useCallback }

const rendre = (node, path) => {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  const { type, props, children } = node
  const kids = () => children.map((c, i) => rendre(c, path + '/' + i)).filter((x) => x !== null)
  if (type === FRAGMENT) return { tag: '#frag', props, kids: kids() }
  if (typeof type === 'string') return { tag: type, props, kids: kids() }
  const propsC = { ...props, children: children.length === 0 ? undefined : (children.length === 1 ? children[0] : children) }
  if (type.prototype instanceof Component) {
    let inst = session.insts.get(path)
    if (inst === undefined) { inst = new type(propsC); session.insts.set(path, inst) }
    inst.props = propsC
    try { return rendre(inst.render(), path + '/c') } catch (e) {
      if (typeof type.getDerivedStateFromError !== 'function') throw e
      inst.state = { ...inst.state, ...type.getDerivedStateFromError(e) }
      return rendre(inst.render(), path + '/c')
    }
  }
  session.path = path
  session.i = 0
  return rendre(type(propsC), path + '/f')
}
function demander () { if (session.rendering) { session.dirty = true } else passe() }
function passe () {
  session.rendering = true
  try {
    for (let n = 0; n < 20; n += 1) {
      session.dirty = false
      session.effects = []
      session.tree = rendre(session.root, 'r')
      const effets = session.effects
      session.effects = []
      for (const fx of effets) fx()
      if (session.dirty !== true) break
    }
  } finally { session.rendering = false }
}
const monter = (element) => { session.hooks = new Map(); session.insts = new Map(); session.root = element; passe(); return session }
const tick = () => new Promise((r) => setTimeout(r, 0))

const walk = (n, fn) => { if (n === null || typeof n === 'string') return; fn(n); n.kids.forEach((k) => walk(k, fn)) }
const trouver = (n, pred) => { const out = []; walk(n, (x) => { if (pred(x)) out.push(x) }); return out }
const parKb = (n, kb) => trouver(n, (x) => x.props['data-kb'] === kb)
const parClasse = (n, c) => trouver(n, (x) => typeof x.props.className === 'string' && x.props.className.split(' ').includes(c))
const texte = (n) => (typeof n === 'string' ? n : n === null ? '' : n.kids.map(texte).join(''))

// ── the environment the client script expects ──────────────────────────────
const stock = new Map()
let stockageCasse = false
const fakeStorage = {
  getItem: (k) => { if (stockageCasse) throw new Error('SecurityError'); return stock.has(k) ? stock.get(k) : null },
  setItem: (k, v) => { if (stockageCasse) throw new Error('QuotaExceededError'); stock.set(k, String(v)) },
}
let lang = 'en'
let definition
const win = { __ModuleLoader__: { load: (def) => { definition = def } }, __KB_LANG_RESOLVE__: () => lang, localStorage: fakeStorage }
let reponse = null
let appels = 0
globalThis.fetch = (url) => {
  appels += 1
  return reponse === 'reseau-ko' ? Promise.reject(new Error('offline')) : Promise.resolve({ json: async () => reponse })
}
new Function('window', SOURCE)(win)
const modele = definition.factory((nom) => { if (nom === 'react') return FAKE_REACT; throw new Error('no ' + nom) })
const T = modele.__test

// ── fixtures ───────────────────────────────────────────────────────────────
const ETAT = {
  global: '0.2.0-rc.2', plugin: 'a1b2c3d', version: '1.0.0-beta.1', problemes: [], couleur: 'verte',
  compat: { min: '0.1.6-alpha.2', max: '0.2.0-rc.2', horsZone: false }, testee: '0.2.0-rc.2', niveau: 'Parfaite', direction: 'same',
  maj: { niveau: 'Aucune', cible: null, note: 'Moteur installé = plus récente version publiée, tous canaux.' },
  distant: { ok: true, latest: '0.1.7', alpha: null, next: '0.2.0-rc.2', derniere: '0.2.0-rc.2', canal: 'next', note: 'à jour de la plus récente publiée (next 0.2.0-rc.2)' },
  versions: [
    { v: '0.2.0-rc.2', niveau: 'Parfaite', detail: 'Testée ensemble, retouches posées.', repere: 'testée · installée · npm next', ici: true },
    { v: '0.1.7', niveau: 'Partielle', detail: 'Démarrerait, des retouches en moins.', repere: 'npm latest', ici: false },
  ],
  surfaces: {
    conformes: 10, total: 11, mesureesSurVierge: 4, ruptures: [], aVerifier: [],
    doublons: ['kybernos-slash recoupe le natif « dictée locale » (dsh-voice).'],
    natifs: [{ id: 'voix', quoi: 'dictée locale (SenseVoice ONNX), bundle optionnel « Voice input »', paquet: 'dsh-voice', livre: true }],
  },
  serveur: { perime: false, demarrageServeur: 1, installation: 2 },
  journal: [
    { date: '2026-10-03T10:00:00.000Z', quoi: 'moteur', de: '0.1.7', vers: '0.2.0-rc.2', resultat: 'reussi' },
    { date: '2026-10-01T09:30:00.000Z', quoi: 'plugin', de: 'aaaaaaa', vers: 'bbbbbbb', resultat: 'echec', raison: 'boot échoué, photo remise' },
    { date: '2026-09-30T08:00:00.000Z', quoi: 'plugin', de: '—', vers: 'aaaaaaa', resultat: 'reussi', raison: 'installation' },
  ],
}
const avec = (extra) => ({ ...ETAT, ...extra })
const DEPASSE = avec({
  problemes: ['Des paquets DSH du profil sont épinglés à une autre version que le moteur (2).', 'Le paquet @local/kybernos-flow n\'est pas lié au profil.'],
  niveau: 'Partielle', maj: { niveau: 'Recommandée', cible: '0.2.0-rc.2', note: 'Une version plus récente du moteur réactiverait les retouches non posées.' },
})
const HORS_ZONE = avec({
  compat: { min: '0.1.6-alpha.2', max: '0.2.0-rc.2', horsZone: true }, niveau: 'Hors zone',
  problemes: ['La version du moteur (0.3.0) n\'a jamais été testée avec ce plugin.'], global: '0.3.0',
  maj: { niveau: 'Recommandée', cible: '0.2.0-rc.2', note: 'Moteur hors de la zone supportée — reviens à la version testée ou attends un plugin adapté.' },
})

const rendrePage = (etat, langue = 'en', props = {}) => {
  lang = langue
  return monter(createElement(T.Page, { etat, onRafraichir: () => {}, charge: false, ...props })).tree
}
const panneau = (tree) => parKb(tree, 'maintenance-details')[0]
const dansPanneau = (tree, kb) => parKb(panneau(tree), kb).length

console.log('── host: the shipped version ──')
{
  const lu = (contenu) => lireVersion('VERSION', () => contenu)
  check('a semver is read, trimmed', lu('1.0.0-beta.1\n') === '1.0.0-beta.1')
  check('a stable semver', lu('2.3.4') === '2.3.4')
  check('build metadata is a semver too (the packager writes 0.0.0-dev+<date> when there is no VERSION)', lu('0.0.0-dev+2026-10-04\n') === '0.0.0-dev+2026-10-04')
  check('an empty file is not a version', lu('\n') === null)
  check('garbage is not a version', lu('hello') === null && lu('1.0') === null && lu('v1.0.0') === null && lu('1.0.0 beta') === null)
  check('an unreadable file gives null, never throws', lireVersion('/nope', () => { throw new Error('ENOENT') }) === null)
  const reel = lireVersion(join(REPO, 'VERSION'))
  check('the repo-root VERSION (shipped in the archive root) is a semver', reel !== null, reel)
  check('the host state exposes it as `version`, next to the git hash `plugin`', /const version = lireVersion\(VERSION_CHEMIN\)/.test(HOST) && /global, plugin, version,/.test(HOST) && /VERSION_CHEMIN = join\(REPO, 'VERSION'\)/.test(HOST))
  check('the host stays read-only: GET only, no write call', /req\.method !== 'GET'/.test(HOST) && !/writeFile|appendFile|unlink|rmSync|mkdirSync/.test(HOST))
}

console.log('── pure logic ──')
{
  check('1.0.0-beta.1 splits into core / channel / rank', JSON.stringify(T.decouperVersion('1.0.0-beta.1')) === JSON.stringify({ core: '1.0.0', canal: 'beta', rang: '1' }))
  check('0.2.0-rc.2 and 0.1.6-alpha.2', T.decouperVersion('0.2.0-rc.2').canal === 'rc' && T.decouperVersion('0.1.6-alpha.2').rang === '2')
  check('a stable version has no channel', T.decouperVersion('1.2.3').canal === '' && T.decouperVersion('1.2.3').rang === '')
  check('a dev build keeps its channel and drops the date', T.decouperVersion('0.0.0-dev+2026-10-04').canal === 'dev')
  check('a git hash or nothing is not a semver', T.decouperVersion('a1b2c3d') === null && T.decouperVersion('inconnu') === null && T.decouperVersion(undefined) === null && T.decouperVersion(null) === null)
  lang = 'en'
  check('line: « Version 1.0.0 · beta 1 »', T.ligneVersion('1.0.0-beta.1') === 'Version 1.0.0 · beta 1', T.ligneVersion('1.0.0-beta.1'))
  check('line: a stable version carries no channel', T.ligneVersion('2.0.0') === 'Version 2.0.0')
  check('line: a hash is shown as it is, an unknown one is translated', T.ligneVersion('a1b2c3d') === 'Version a1b2c3d' && T.ligneVersion('inconnu') === 'Version unknown')
  lang = 'fr'
  check('line (fr): an unknown version stays French', T.ligneVersion('inconnu') === 'Version inconnu')
  check('Kybernos number: the semver when the host read one', T.versionPlugin({ version: '1.0.0-beta.1', plugin: 'a1b2c3d' }) === '1.0.0-beta.1')
  check('Kybernos number: else the git hash the state already has', T.versionPlugin({ version: null, plugin: 'a1b2c3d' }) === 'a1b2c3d' && T.versionPlugin({ plugin: 'a1b2c3d' }) === 'a1b2c3d')
  check('Kybernos number: nothing is invented', T.versionPlugin({}) === 'inconnu' && T.versionPlugin({ version: '', plugin: '' }) === 'inconnu')
  check('tested zone text: min → max, min only, absent', T.zoneTexte({ min: '0.1.6', max: '0.2.0' }) === '0.1.6 → 0.2.0' && T.zoneTexte({ min: '0.1.6', max: null }) === '0.1.6' && T.zoneTexte(null) === '—' && T.zoneTexte({ min: null, max: null }) === '—')
  const s = (e) => { const r = T.statutDe(e); return r.tone + '/' + r.cle }
  check('status: in sync is green', s(ETAT) === 'ok/ok')
  check('status: engine ahead is blue, partial is orange', s(avec({ niveau: 'Compatible' })) === 'info/avancer' && s(avec({ niveau: 'Partielle' })) === 'warn/partielle')
  check('status: out of range with its problem is red', s(HORS_ZONE) === 'bad/action')
  check('status: a problem turns it orange (to check), whatever the level', s(DEPASSE) === 'warn/afaire' && s(avec({ niveau: 'Parfaite', problemes: ['x'] })) === 'warn/afaire')
  check('status: a problem with horsZone set is red', s(avec({ niveau: 'Compatible', problemes: ['x'], compat: { min: '1', max: '2', horsZone: true } })) === 'bad/afaire')
  check('status: unknown level is « to check » (tone unchanged from the old hero: green)', s(avec({ niveau: 'Inconnue' })) === 'ok/inconnu')
  check('status: a state without problems array does not throw', T.statutDe({}).cle === 'inconnu')
  check('a host answer is a state only with problems[] and global', T.etatValide(ETAT) === true && T.etatValide({ erreur: 'boom' }) === false && T.etatValide(null) === false && T.etatValide({ problemes: [] }) === false && T.etatValide('x') === false)
  const st = new Map()
  const bon = { getItem: (k) => (st.has(k) ? st.get(k) : null), setItem: (k, v) => st.set(k, v) }
  const casse = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
  check('disclosure memory: closed by default', T.lireOuvert(bon) === false)
  T.ecrireOuvert(bon, true)
  check('disclosure memory: open is remembered, closed too', T.lireOuvert(bon) === true && st.get(T.CLE_DETAILS) === '1' && (T.ecrireOuvert(bon, false), T.lireOuvert(bon) === false) && st.get(T.CLE_DETAILS) === '0')
  check('disclosure memory: storage that throws, or none, never throws', T.lireOuvert(casse) === false && T.lireOuvert(null) === false && (T.ecrireOuvert(casse, true), T.ecrireOuvert(null, true), true))
}

console.log('── the section ──')
{
  const enregistre = []
  const slots = { inject: (nom, fn) => { enregistre.push({ nom, ...fn() }) }, register: (meta, comp) => ({ meta, comp }) }
  lang = 'en'
  modele.apply({ slots })
  check('one section, same id and slot as before, same order', enregistre.length === 1 && enregistre[0].nom === 'settings.section' && enregistre[0].meta.id === 'kybernos-maintenance' && enregistre[0].meta.order === 13 && enregistre[0].meta.name === 'settings.section', enregistre.map((e) => e.meta))
  check('the label is « About » in English', enregistre[0].meta.label === 'About', enregistre[0].meta.label)
  lang = 'fr'
  modele.apply({ slots })
  check('the label is « À propos » in French', enregistre[1].meta.label === 'À propos', enregistre[1].meta.label)
  lang = 'de'
  modele.apply({ slots })
  check('any language but French falls back to English, like kbt', enregistre[2].meta.label === 'About')
  check('inject: slots only', JSON.stringify(modele.inject) === JSON.stringify(['slots']))
  const sans = []
  const log = console.error
  console.error = (m) => sans.push(m)
  check('without the slots service nothing throws', (modele.apply({ slots: undefined }), true))
  console.error = log
  check('… and says so', sans.length === 1 && /slots service unavailable/.test(sans[0]))
  check('the label is the page title too', rendrePage(ETAT, 'en').kids.some((k) => typeof k !== 'string' && k.tag === 'h1' && texte(k) === 'About') && rendrePage(ETAT, 'fr').kids.some((k) => typeof k !== 'string' && k.tag === 'h1' && texte(k) === 'À propos'))
  check('the full-width rule of the page is still there', /\[data-slot="settings\.section"\]:has\(\.kbmz-page\)\{width:100%;max-width:none\}/.test(SOURCE))
}

console.log('── above the fold ──')
{
  const tree = rendrePage(ETAT, 'en')
  const horsPanneau = (kb) => parKb(tree, kb).filter((n) => parKb(panneau(tree), kb).indexOf(n) === -1)
  check('the page is the .kbmz-page root', tree.props.className === 'kbmz-page')
  const direct = tree.kids.filter((k) => typeof k !== 'string').map((k) => k.props.className || '')
  check('top level: title, identity, status, tiles, links, disclosure — in that order', JSON.stringify(direct) === JSON.stringify(['kbmz-titre', 'kbmz-haut', 'kbmz-status', 'kbmz-tuiles', 'kbmz-liens', '']), direct)
  const marque = texte(parKb(tree, 'maintenance-brand')[0])
  check('without the brand component the wordmark is a plain « Kybernos » (30 px, bold)', marque === 'Kybernos' && parKb(tree, 'maintenance-brand')[0].kids[0].props.style.fontSize === 30 && parKb(tree, 'maintenance-brand')[0].kids[0].props.style.fontWeight === 700)
  check('version line under the wordmark, exact version on hover', texte(parKb(tree, 'maintenance-version')[0]) === 'Version 1.0.0 · beta 1' && parKb(tree, 'maintenance-version')[0].props.title === '1.0.0-beta.1')
  const verifier = parKb(tree, 'maintenance-refresh')
  check('exactly one « Check now », in the identity block, enabled', verifier.length === 1 && texte(verifier[0]) === 'Check now' && verifier[0].props.disabled === false && parClasse(tree, 'kbmz-haut')[0].kids.includes(verifier[0]))
  check('« Check now » is a real button of type button', verifier[0].tag === 'button' && verifier[0].props.type === 'button')
  check('while loading it is disabled and says …', (() => { const t2 = rendrePage(ETAT, 'en', { charge: true }); const b = parKb(t2, 'maintenance-refresh')[0]; return b.props.disabled === true && texte(b) === '…' })())
  const statut = parKb(tree, 'maintenance-status')
  check('ONE status block, green, with state and one-line verdict', statut.length === 1 && statut[0].props['data-tone'] === 'ok' && texte(parClasse(statut[0], 'kbmz-kicker')[0]) === 'In sync' && texte(parClasse(statut[0], 'kbmz-verdict')[0]) === 'All good — engine and plugin in sync')
  check('green and nothing to do: no action hint', parKb(tree, 'maintenance-copy-upgrade').length === 0)
  const tuiles = parClasse(tree, 'kbmz-tuile')
  check('three tiles: DSH engine, Kybernos, Tested zone', tuiles.length === 3 && tuiles.map((x) => texte(parClasse(x, 'kbmz-tuile-l')[0])).join('|') === 'DSH engine|Kybernos|Tested zone', tuiles.map(texte))
  check('tile values: engine version, shipped semver, min → max', tuiles.map((x) => texte(parClasse(x, 'kbmz-tuile-v')[0])).join('|') === '0.2.0-rc.2|1.0.0-beta.1|0.1.6-alpha.2 → 0.2.0-rc.2')
  const liens = texte(parKb(tree, 'maintenance-links')[0])
  check('links row: licence, trademark policy, modules', liens === 'License Apache-2.0Trademark policyModules: Kybernos Suite', liens)
  check('links are plain text: no anchor, no button, no handler', trouver(parKb(tree, 'maintenance-links')[0], (x) => x.tag === 'a' || x.tag === 'button' || x.props.onClick !== undefined || x.props.href !== undefined).length === 0)
  check('none of the technical cards leaks above the fold', ['maintenance-engine-card', 'maintenance-plugin-card', 'maintenance-compat-card', 'maintenance-update-card', 'maintenance-last-op', 'maintenance-journal', 'maintenance-contract-card', 'maintenance-compat-matrix', 'maintenance-surfaces', 'maintenance-copy'].every((kb) => horsPanneau(kb).length === 0), ['maintenance-last-op'].map(horsPanneau).map((x) => x.length))
  check('no old Simple/Advanced toggle anywhere (hook, pressed state, words)', parKb(tree, 'maintenance-vue-simple').length === 0 && parKb(tree, 'maintenance-vue-avance').length === 0 && trouver(tree, (x) => x.props['aria-pressed'] !== undefined).length === 0 && !/Simple|Advanced/.test(texte(tree)))
  const fr = rendrePage(ETAT, 'fr')
  check('French: title, tiles, links, status', texte(fr.kids[0]) === 'À propos' && parClasse(fr, 'kbmz-tuile').map((x) => texte(parClasse(x, 'kbmz-tuile-l')[0])).join('|') === 'Moteur DSH|Kybernos|Zone testée' && texte(parKb(fr, 'maintenance-links')[0]) === 'Licence Apache-2.0Politique de marqueModules : Kybernos Suite' && texte(parClasse(fr, 'kbmz-kicker')[0]) === 'Synchronisé')
  check('French: the check button and the disclosure', texte(parKb(fr, 'maintenance-refresh')[0]) === 'Vérifier maintenant' && texte(parKb(fr, 'maintenance-details-toggle')[0]).startsWith('Détails techniques'))
}

console.log('── the version when the host has no semver ──')
{
  const tree = rendrePage(avec({ version: null }), 'en')
  check('the line and the tile fall back to the git hash the state has', texte(parKb(tree, 'maintenance-version')[0]) === 'Version a1b2c3d' && parKb(tree, 'maintenance-version')[0].props.title === undefined && texte(parClasse(tree, 'kbmz-tuile-v')[1]) === 'a1b2c3d')
  check('… and an unknown plugin reads « unknown », not a made-up number', texte(parKb(rendrePage(avec({ version: null, plugin: 'inconnu' }), 'en'), 'maintenance-version')[0]) === 'Version unknown')
  check('a missing compatibility range shows a dash in the tile', texte(parClasse(rendrePage(avec({ compat: null }), 'en'), 'kbmz-tuile-v')[2]) === '—')
}

console.log('── the status block: problems and the action hint ──')
{
  const tree = rendrePage(DEPASSE, 'en')
  const statut = parKb(tree, 'maintenance-status')[0]
  check('orange, state « To check », the first problem is the verdict (translated)', statut.props['data-tone'] === 'warn' && texte(parClasse(statut, 'kbmz-kicker')[0]) === 'To check' && texte(parClasse(statut, 'kbmz-verdict')[0]) === 'DSH profile packages are pinned to a different version than the engine (2).')
  check('the other problems stay visible, in the status block', texte(parClasse(statut, 'kbmz-problemes')[0]) === 'Package @local/kybernos-flow is not linked to the profile.')
  const copier = parKb(statut, 'maintenance-copy-upgrade')
  check('« Copy the command » is the action hint when an update is advised, inside the status block', copier.length === 1 && texte(copier[0]) === 'Copy the command' && copier[0].props['data-primaire'] === 'true')
  const hz = parKb(rendrePage(HORS_ZONE, 'en'), 'maintenance-status')[0]
  check('out of range: red, « Action required », the problem as verdict, no empty list', hz.props['data-tone'] === 'bad' && texte(parClasse(hz, 'kbmz-kicker')[0]) === 'Action required' && texte(parClasse(hz, 'kbmz-verdict')[0]) === 'Engine version (0.3.0) has never been tested with this plugin.' && parClasse(hz, 'kbmz-problemes').length === 0)
  const sansCible = parKb(rendrePage(avec({ maj: { niveau: 'Possible', cible: null, note: 'x' } }), 'en'), 'maintenance-copy-upgrade')
  check('no target, no hint', sansCible.length === 0)
  check('partial level without problems: orange with its own sentence', texte(parClasse(rendrePage(avec({ niveau: 'Partielle' }), 'en'), 'kbmz-verdict')[0]) === 'It starts, but some patches are not applied on this engine: updating is recommended.')
  check('unknown level no longer says « All good » next to « discrepancies »', texte(parClasse(rendrePage(avec({ niveau: 'Inconnue' }), 'en'), 'kbmz-verdict')[0]) === 'Compatibility could not be measured: the compatibility range is missing from the repository.')
  const fr = parKb(rendrePage(DEPASSE, 'fr'), 'maintenance-status')[0]
  check('French: the host sentence is shown untouched', texte(parClasse(fr, 'kbmz-verdict')[0]) === 'Des paquets DSH du profil sont épinglés à une autre version que le moteur (2).' && texte(parKb(fr, 'maintenance-copy-upgrade')[0]) === 'Copier la commande')
}

console.log('── Technical details: ONE collapsed disclosure ──')
{
  stock.clear()
  const tree = rendrePage(ETAT, 'en')
  const bouton = parKb(tree, 'maintenance-details-toggle')
  const pan = parKb(tree, 'maintenance-details')
  check('exactly one disclosure button and one panel', bouton.length === 1 && pan.length === 1)
  check('a real button, collapsed by default', bouton[0].tag === 'button' && bouton[0].props.type === 'button' && bouton[0].props['aria-expanded'] === 'false' && pan[0].props.hidden === true)
  check('aria-controls points at the panel id', bouton[0].props['aria-controls'] === pan[0].props.id && pan[0].props.id === T.ID_DETAILS)
  check('label and hint text', texte(bouton[0]) === 'Technical detailscompatibility, last operation, journal', texte(bouton[0]))
  check('a chevron that rotates through CSS on aria-expanded, hidden from assistive tech', trouver(bouton[0], (x) => x.tag === 'svg' && x.props.className === 'kbmz-chev' && x.props['aria-hidden'] === 'true').length === 1 && /\.kbmz-toggle\[aria-expanded="true"\] \.kbmz-chev\{transform:rotate\(90deg\)\}/.test(SOURCE))
  check('the chevron respects reduced motion and right-to-left', /prefers-reduced-motion:reduce\)\{\.kbmz-chev\{transition:none\}/.test(SOURCE) && /html\[dir="rtl"\] \.kbmz-chev/.test(SOURCE))
  check('the hidden panel is really hidden by CSS (display:flex would override [hidden])', /\.kbmz-panel\[hidden\]\{display:none\}/.test(SOURCE))
  check('only ONE disclosure on the page: no native <details>, no other aria-expanded', trouver(tree, (x) => x.tag === 'details' || x.tag === 'summary').length === 0 && trouver(tree, (x) => x.props['aria-expanded'] !== undefined).length === 1)
  check('nothing was written to storage just by showing the page', stock.size === 0)

  // click: open, remembered; reopen: stays open; click again: closed, remembered
  const s = monter(createElement(T.Page, { etat: ETAT, onRafraichir: () => {}, charge: false }))
  parKb(s.tree, 'maintenance-details-toggle')[0].props.onClick()
  check('click opens it: aria-expanded, panel visible', parKb(s.tree, 'maintenance-details-toggle')[0].props['aria-expanded'] === 'true' && parKb(s.tree, 'maintenance-details')[0].props.hidden === false)
  check('… and the choice is remembered', stock.get(T.CLE_DETAILS) === '1')
  check('a new visit opens it right away', parKb(monter(createElement(T.Page, { etat: ETAT, onRafraichir: () => {}, charge: false })).tree, 'maintenance-details-toggle')[0].props['aria-expanded'] === 'true')
  const s2 = monter(createElement(T.Page, { etat: ETAT, onRafraichir: () => {}, charge: false }))
  parKb(s2.tree, 'maintenance-details-toggle')[0].props.onClick()
  check('click again closes it and remembers that too', parKb(s2.tree, 'maintenance-details-toggle')[0].props['aria-expanded'] === 'false' && parKb(s2.tree, 'maintenance-details')[0].props.hidden === true && stock.get(T.CLE_DETAILS) === '0')
  check('then a new visit is closed', parKb(monter(createElement(T.Page, { etat: ETAT, onRafraichir: () => {}, charge: false })).tree, 'maintenance-details-toggle')[0].props['aria-expanded'] === 'false')

  // storage that throws: closed, and the click still works
  stockageCasse = true
  const s3 = monter(createElement(T.Page, { etat: ETAT, onRafraichir: () => {}, charge: false }))
  check('storage that throws: closed by default, no crash', parKb(s3.tree, 'maintenance-details-toggle')[0].props['aria-expanded'] === 'false')
  parKb(s3.tree, 'maintenance-details-toggle')[0].props.onClick()
  check('… and the click still opens it for this visit', parKb(s3.tree, 'maintenance-details-toggle')[0].props['aria-expanded'] === 'true')
  stockageCasse = false
  const sans = win.localStorage
  delete win.localStorage
  const s4 = monter(createElement(T.Page, { etat: ETAT, onRafraichir: () => {}, charge: false }))
  parKb(s4.tree, 'maintenance-details-toggle')[0].props.onClick()
  check('no storage at all: still works', parKb(s4.tree, 'maintenance-details-toggle')[0].props['aria-expanded'] === 'true')
  win.localStorage = sans
  stock.clear()
}

console.log('── nothing is lost: everything the old page showed is in the panel ──')
{
  const tree = rendrePage(ETAT, 'en')
  const kbs = ['maintenance-engine-card', 'maintenance-plugin-card', 'maintenance-compat-card', 'maintenance-update-card', 'maintenance-last-op', 'maintenance-journal', 'maintenance-contract-card', 'maintenance-compat-matrix', 'maintenance-surfaces']
  check('the 4 stat cards, last operation, earlier updates, contract, matrix and surfaces are all inside the panel', kbs.every((kb) => dansPanneau(tree, kb) === 1), kbs.map((kb) => kb + ':' + dansPanneau(tree, kb)))
  check('the update procedure (3 copy buttons) is inside the panel', dansPanneau(tree, 'maintenance-copy') === 3)
  const pan = texte(panneau(tree))
  check('engine card: version, registry note; plugin card: hash and range', pan.includes('0.2.0-rc.2') && pan.includes('up to date with the newest published (next 0.2.0-rc.2)') && pan.includes('a1b2c3d') && pan.includes('Supported engine range : 0.1.6-alpha.2 → 0.2.0-rc.2'))
  check('compatibility card: level, tested version', pan.includes('Perfect') && pan.includes('tested with the plugin: 0.2.0-rc.2'))
  check('update card: level and note', pan.includes('None') && pan.includes('Installed engine = newest published version, all channels.'))
  const dernier = texte(parKb(tree, 'maintenance-last-op')[0])
  check('last operation: the newest entry, from → to, result', dernier.includes('Last operation') && dernier.includes('2026-10-03 10:00') && dernier.includes('0.1.7 → 0.2.0-rc.2') && dernier.includes('✓ succeeded'))
  const avant = texte(parKb(tree, 'maintenance-journal')[0])
  check('earlier updates: every other journal entry, with its reason', avant.includes('Earlier updates') && avant.includes('aaaaaaa → bbbbbbb — boot échoué, photo remise') && avant.includes('✗ failed') && avant.includes('— → aaaaaaa — installation'))
  check('…and the newest entry is not repeated there', !avant.includes('0.1.7 → 0.2.0-rc.2'))
  const contrat = texte(parKb(tree, 'maintenance-contract-card')[0])
  check('contract: range, tested version, surfaces ratio, legend', contrat.includes('≥ 0.1.6-alpha.2  < 0.2.0-rc.2') && contrat.includes('10/11') && contrat.includes('tested together') && contrat.includes('must not run'))
  const mat = texte(parKb(tree, 'maintenance-compat-matrix')[0])
  check('matrix: every version row with level, detail and markers; the installed one is marked', mat.includes('0.2.0-rc.2  ●') && mat.includes('0.1.7') && mat.includes('Tested together, patches applied.') && mat.includes('Would start, with fewer patches.') && mat.includes('tested · installed · npm next') && parClasse(tree, 'kbmz-mat-ligne').filter((x) => x.props['data-ici'] === 'true').length === 1)
  const surf = texte(parKb(tree, 'maintenance-surfaces')[0])
  check('surfaces: ratio, clean-backup count, native capabilities, overlaps', surf.includes('10/11 engine contracts compliant (4 measured on a clean backup)') && surf.includes('dsh-voice — local dictation (SenseVoice ONNX), optional “Voice input” bundle') && surf.includes('kybernos-slash overlaps the native “dictée locale” (dsh-voice).'))
  check('the engine arrow keeps the registry tooltip', parClasse(tree, 'kbmz-fleche')[0].props.title === 'latest 0.1.7 · next 0.2.0-rc.2 · alpha —')
  check('an empty journal says so, once, and shows no earlier-updates card', (() => { const t2 = rendrePage(avec({ journal: [] }), 'en'); return texte(parKb(t2, 'maintenance-last-op')[0]).includes('No update recorded yet.') && parKb(t2, 'maintenance-journal').length === 0 })())
  check('a single entry: no earlier-updates card', parKb(rendrePage(avec({ journal: [ETAT.journal[0]] }), 'en'), 'maintenance-journal').length === 0)
  check('a failed audit is reported, not hidden', texte(parKb(rendrePage(avec({ surfaces: { erreur: 'boom', ruptures: [], aVerifier: [], doublons: [], natifs: [] } }), 'en'), 'maintenance-surfaces')[0]).includes('Audit failed: boom'))
  const fr = texte(panneau(rendrePage(ETAT, 'fr')))
  check('French panel: titles and host sentences', fr.includes('Mises à jour précédentes') && fr.includes('Surfaces du moteur') && fr.includes('Plage de moteurs supportée') && fr.includes('à jour de la plus récente publiée (next 0.2.0-rc.2)'))
}

console.log('── the wordmark: shared brand component, never a throw ──')
{
  const wm = (props) => createElement('b', { 'data-wordmark': String(props.size) }, 'WM')
  win.__KB_BRAND__ = { Wordmark: wm, Mark: () => null }
  let tree = rendrePage(ETAT, 'en')
  const marque = parKb(tree, 'maintenance-brand')[0]
  check('with the brand component: it is rendered with size 30', trouver(marque, (x) => x.props['data-wordmark'] === '30').length === 1 && texte(marque) === 'WM')
  win.__KB_BRAND__ = { Wordmark: () => { throw new Error('broken wordmark') } }
  let jete = null
  try { tree = rendrePage(ETAT, 'en') } catch (e) { jete = e }
  check('a wordmark that throws is caught: text fallback, page intact', jete === null && texte(parKb(tree, 'maintenance-brand')[0]) === 'Kybernos' && parKb(tree, 'maintenance-status').length === 1, String(jete))
  win.__KB_BRAND__ = {}
  check('a brand object without Wordmark: text fallback', texte(parKb(rendrePage(ETAT, 'en'), 'maintenance-brand')[0]) === 'Kybernos')
  win.__KB_BRAND__ = null
  check('a null brand: text fallback', texte(parKb(rendrePage(ETAT, 'en'), 'maintenance-brand')[0]) === 'Kybernos')
  Object.defineProperty(win, '__KB_BRAND__', { get () { throw new Error('getter') }, configurable: true })
  jete = null
  try { tree = rendrePage(ETAT, 'en') } catch (e) { jete = e }
  check('a throwing getter is caught too', jete === null && texte(parKb(tree, 'maintenance-brand')[0]) === 'Kybernos', String(jete))
  delete win.__KB_BRAND__
  check('the page only ever uses the contract, never draws a logo (no svg besides the chevron, no image)', trouver(rendrePage(ETAT, 'en'), (x) => x.tag === 'svg').length === 1 && trouver(rendrePage(ETAT, 'en'), (x) => x.tag === 'img').length === 0)
}

console.log('── the container: loading, failing, refreshing ──')
{
  const enregistre = []
  modele.apply({ slots: { inject: (nom, fn) => { enregistre.push(fn()) }, register: (meta, comp) => ({ meta, comp }) } })
  const Section = enregistre[0].comp
  lang = 'en'
  stock.clear()
  reponse = ETAT; appels = 0
  let s = monter(createElement(Section))
  check('first paint is the .kbmz-page placeholder (keeps the full-width rule working while loading)', s.tree.props.className === 'kbmz-page' && texte(s.tree) === '…')
  await tick(); await tick()
  check('the state is fetched once on mount, then the page shows it', appels === 1 && s.tree.props.className === 'kbmz-page' && parKb(s.tree, 'maintenance-status').length === 1)
  parKb(s.tree, 'maintenance-refresh')[0].props.onClick()
  await tick(); await tick()
  check('« Check now » fetches again', appels === 2 && parKb(s.tree, 'maintenance-status').length === 1)

  reponse = { erreur: 'boom' }; appels = 0
  s = monter(createElement(Section))
  await tick(); await tick()
  check('a host 500 ({ erreur }) shows « Status unavailable » with Check now — no crash', texte(parKb(s.tree, 'maintenance-status')[0]).includes('Status unavailable') && parKb(s.tree, 'maintenance-refresh').length === 1, texte(s.tree))
  reponse = ETAT
  parKb(s.tree, 'maintenance-refresh')[0].props.onClick()
  await tick(); await tick()
  check('… and Check now recovers the page once the host answers', parClasse(s.tree, 'kbmz-tuile').length === 3)

  reponse = 'reseau-ko'
  s = monter(createElement(Section))
  await tick(); await tick()
  check('a network failure shows the same message', texte(parKb(s.tree, 'maintenance-status')[0]).includes('Status unavailable'))
  lang = 'fr'
  s = monter(createElement(Section))
  await tick(); await tick()
  check('French: « État indisponible » and « Vérifier maintenant »', texte(parKb(s.tree, 'maintenance-status')[0]).includes('État indisponible') && texte(parKb(s.tree, 'maintenance-refresh')[0]) === 'Vérifier maintenant')
  lang = 'en'
  reponse = ETAT
  const sansFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('fetch is not defined') }
  s = monter(createElement(Section))
  await tick()
  check('fetch that throws synchronously is caught', texte(parKb(s.tree, 'maintenance-status')[0]).includes('Status unavailable'))
  globalThis.fetch = sansFetch
}

console.log('── source guards ──')
{
  const dico = (nom) => { const i = SOURCE.indexOf('    const ' + nom + ' = {'); const j = SOURCE.indexOf('\n    }\n', i); return new Set([...SOURCE.slice(i, j).matchAll(/^ {6}([A-Za-z][A-Za-z0-9_.]*): '/gm)].map((m) => m[1])) }
  const fr = dico('FR')
  const en = dico('EN')
  check('FR and EN dictionaries have the same keys', fr.size > 40 && [...fr].every((k) => en.has(k)) && [...en].every((k) => fr.has(k)), [...fr].filter((k) => !en.has(k)).concat([...en].filter((k) => !fr.has(k))))
  const utilisees = new Set([...SOURCE.matchAll(/\bt\('([A-Za-z][A-Za-z0-9_.]*)'\)/g)].map((m) => m[1]))
  utilisees.add('moteur'); utilisees.add('plugin') // t(e.quoi): the journal says « moteur » or « plugin »
  check('every t(\'key\') exists in the dictionaries', [...utilisees].every((k) => fr.has(k)), [...utilisees].filter((k) => !fr.has(k)))
  check('no dead key left in the dictionaries', [...fr].every((k) => utilisees.has(k)), [...fr].filter((k) => !utilisees.has(k)))
  check('the old toggle left nothing behind', !/vueSimple|vueAvance|setVue|kbmz-seg|maintenance-vue/.test(SOURCE))
  const css = SOURCE.slice(SOURCE.indexOf('const CSS = `'), SOURCE.indexOf('`', SOURCE.indexOf('const CSS = `') + 14))
  const code = SOURCE.replace(css, '')
  const classes = new Set([...css.matchAll(/\.(kbmz-[a-z0-9-]+)/g)].map((m) => m[1]))
  const mortes = [...classes].filter((c) => !code.includes(c))
  check('no dead CSS class (each .kbmz-* rule is used by the markup)', mortes.length === 0, mortes)
  const manque = [...code.matchAll(/className: '(kbmz-[a-z0-9-]+)'/g)].map((m) => m[1]).filter((c) => !classes.has(c))
  check('every class the markup uses is styled', manque.length === 0, [...new Set(manque)])
  // The page reads /state; the update notice (own feature, same bundle) reads /update, asks the Suite's signed catalogue and, only
  // when the user presses "Update now", starts and follows the Suite's own update. Nothing else leaves the page.
  const appelsReseau = [...SOURCE.matchAll(/fetch\('([^']+)'/g)].map((m) => m[1].split('?')[0])
  const attendus = ['/kybernos-hub/catalogue/refresh', '/kybernos-hub/update', '/kybernos-hub/update/status', '/kybernos-maintenance/state', '/kybernos-maintenance/update']
  check('the module only touches the page: no engine patch, and the only network calls are the maintenance reads and the Suite\'s own routes', !/XMLHttpRequest|WebSocket|eval\(|new Function/.test(SOURCE) && appelsReseau.slice().sort().join() === attendus.join(), appelsReseau)
  check('the two writes (refresh, update) are POSTs to the Suite, and "Update now" asks for an explicit confirm', /fetch\('\/kybernos-hub\/catalogue\/refresh', \{ method: 'POST'/.test(SOURCE) && /fetch\('\/kybernos-hub\/update', \{ method: 'POST'/.test(SOURCE) && /confirm: true/.test(SOURCE))
  // The About page keeps ONE key (the disclosure). The update notice keeps three more: snooze and skip in localStorage
  // (its own lsGet/lsSet helpers) and the once-per-session card flag in sessionStorage; no other code reaches storage.
  const cles = [...new Set([...SOURCE.matchAll(/'(kybernos\.(?:maintenance|update)\.[a-z]+)'/g)].map((m) => m[1]))].sort()
  check('storage keys are the disclosure one and the three of the update notice, nothing else', cles.join() === 'kybernos.maintenance.details,kybernos.update.card,kybernos.update.skip,kybernos.update.snooze' && T.CLE_DETAILS === 'kybernos.maintenance.details', cles)
  check('localStorage is reached from exactly three places (disclosure helper, update get and set)', (SOURCE.match(/window\.localStorage/g) || []).length === 3)
}

console.log('── optional: the same tree through the real React ──')
{
  let React = null
  let serveur = null
  try {
    const req = createRequire(import.meta.url)
    React = req('react')
    serveur = req('react-dom/server')
  } catch (e) { React = null }
  if (React === null || serveur === null) {
    console.log('  (skipped: react and react-dom are not on NODE_PATH)')
  } else {
    const reel = {}
    const w2 = { __ModuleLoader__: { load: (def) => { reel.def = def } }, __KB_LANG_RESOLVE__: () => 'en', localStorage: undefined }
    new Function('window', SOURCE)(w2)
    const m2 = reel.def.factory((n) => React)
    const html = serveur.renderToStaticMarkup(React.createElement(m2.__test.Page, { etat: ETAT, onRafraichir: () => {}, charge: false }))
    check('real React: renders without throwing, title About', html.includes('>About</h1>'))
    check('real React: the disclosure is a collapsed button controlling a hidden panel', /<button[^>]*aria-expanded="false"[^>]*aria-controls="kbmz-details"/.test(html) || /<button[^>]*aria-controls="kbmz-details"[^>]*aria-expanded="false"/.test(html))
    check('real React: the panel is hidden', /id="kbmz-details"[^>]*hidden=""/.test(html) || /hidden=""[^>]*id="kbmz-details"/.test(html))
    check('real React: wordmark fallback, version line and three tiles', html.includes('>Kybernos</span>') && html.includes('Version 1.0.0 · beta 1') && (html.match(/class="kbmz-tuile"/g) || []).length === 3)
    w2.__KB_BRAND__ = { Wordmark: ({ size }) => React.createElement('i', { 'data-size': size }, 'KB'), Mark: () => null }
    const html2 = serveur.renderToStaticMarkup(React.createElement(m2.__test.Page, { etat: ETAT, onRafraichir: () => {}, charge: false }))
    check('real React: the shared Wordmark is used with size 30', html2.includes('<i data-size="30">KB</i>'))
  }
}

// ── the notification follows the signed release ────────────────────────────
console.log('update notification: the signed release decides')
{
  const hote = { ok: true, checkedAt: 'T', pack: { installee: '1.0.0-beta.2', latest: '1.0.0-beta.2', disponible: false, joignable: true, depot: 'https://example.test/r', git: false }, moteur: {}, pending: null }
  const signee = (o) => ({ cle: true, evaluation: 'ok', suite: '1.0.0-beta.3', plusRecent: true, miseAJour: { possible: true, raison: null }, ...o })
  const f = T.fusionnerSigne(hote, signee({}))
  check('a newer signed release is announced as a Kybernos update', f.pending !== null && f.pending.kind === 'kybernos' && f.pending.cible === '1.0.0-beta.3' && f.pending.installee === '1.0.0-beta.2' && f.pending.requis === false, f.pending)
  check('and the pack says it is signed and that this install can apply it', f.pack.signe === true && f.pack.applicable === true && f.pack.disponible === true && f.pack.latest === '1.0.0-beta.3', f.pack)
  const dev = T.fusionnerSigne(hote, signee({ miseAJour: { possible: false, raison: 'development-checkout' } }))
  check('a development checkout is told it cannot apply it (git steps stay)', dev.pending !== null && dev.pack.applicable === false && dev.pack.raison === 'development-checkout', dev.pack)
  check('nothing newer: the host answer is returned untouched', T.fusionnerSigne(hote, signee({ plusRecent: false })) === hote)
  check('no key / no release: untouched', T.fusionnerSigne(hote, { cle: false, evaluation: 'aucune', suite: null, plusRecent: false }) === hote)
  check('no distant block: untouched', T.fusionnerSigne(hote, null) === hote && T.fusionnerSigne(hote, undefined) === hote)
  check('suite version not a string: untouched', T.fusionnerSigne(hote, signee({ suite: 3 })) === hote)
  const sansVersion = { ...hote, pack: { ...hote.pack, installee: null } }
  check('installed version unknown: nothing is made up', T.fusionnerSigne(sansVersion, signee({})) === sansVersion)
  check('the host announcement of a newer engine is not hidden by an up-to-date signed suite', (() => { const m = { ...hote, pending: { kind: 'moteur', cible: '0.2.1', installee: '0.2.0', requis: false, note: '' } }; return T.fusionnerSigne(m, signee({ plusRecent: false })).pending.kind === 'moteur' })())
  check('the words of each step (fr/en) never print "undefined"', ['telechargement', 'extraction', 'installation', 'termine', 'echec'].every((e) => { const t = T.motMaj({ etat: e, version: '1.0.0-beta.3', erreur: 'x' }); return t.length > 0 && !/undefined|null/.test(t) }))
  check('idle says nothing', T.motMaj({ etat: 'idle' }) === '' && T.motMaj(null) === '')
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
