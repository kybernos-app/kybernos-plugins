#!/usr/bin/env node
/** The local fallback classifier of kybernos-sessions (2026-10-15).
 *
 *  Why: the decision brain (Jev, on the gateway) answered HTTP 403 « Free tier users do not have access to this model », so
 *  no session created since had a category and every row kept the « not classified » dot. When the brain gives NO verdict,
 *  the host now classifies from the words of the title (`classement-local.mjs`), labelled `local`, and only on a clear
 *  signal. This test pins (1) the classifier, (2) its rules against the categories the product knows, (3) the route: the
 *  fallback fires only when the brain did not answer, and never contradicts a verdict.
 *
 *  Usage: node packages/kybernos-sessions/test-classement-local.mjs   (exit 0 = all pass) */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classerLocalement, SEUIL_LOCAL, ECART_LOCAL } from './classement-local.mjs'
import { CATEGORIES } from './decision.mjs'
import { monterRoutes } from './index.js'

let ok0 = 0
let ko = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 300) : '')) }
}
const cat = (t) => classerLocalement(t).categorie

console.log('\n── the real titles of the owner\'s sidebar (measured 2026-10-15) ──')
const REELS = [
  ['Créer un nouveau thème', 'ui'],
  ['Create automation via skill interview', 'fonctionnalite'],
  ['Tendances des agents IA', 'donnees'],
  ['Rapport mission IA location voiture abonnement', 'doc'],
  ['Serveur Hetzner et services Coolify', 'integration'],
  ['Nettoyage Docker libérer espace', 'nettoyage'],
  ['Automatisation étude à la demande', 'fonctionnalite'],
  ['Greeting', 'question']
]
for (const [titre, attendu] of REELS) ok('« ' + titre + ' » → ' + attendu, cat(titre) === attendu, classerLocalement(titre))

console.log('\n── it says nothing rather than guess ──')
for (const t of ['New Session', 'Nouvelle session', 'Untitled', '', '   ', 'abc', 'Quiz de culture générale', 'Projet Mars'])
  ok('« ' + t + ' » stays unclassified', cat(t) === null, classerLocalement(t))
ok('null / undefined do not throw', (() => { try { return classerLocalement(null).categorie === null && classerLocalement(undefined).categorie === null } catch (e) { return false } })())
ok('a single weak hint is not enough (« ajouter » alone)', cat('Ajouter quelque chose') === null, classerLocalement('Ajouter quelque chose'))
ok('a tie is not a verdict', (() => { const r = classerLocalement('theme migration'); return r.categorie === null && r.ecart === 0 })(), classerLocalement('theme migration'))
ok('the thresholds are the documented ones', SEUIL_LOCAL === 2 && ECART_LOCAL === 1)

console.log('\n── how words are matched ──')
ok('accents and case are ignored (THÈME / theme / Thème)', cat('THÈME') === 'ui' && cat('theme dark') === 'ui' && cat('Thème sombre') === 'ui')
ok('a short stem is a whole word: « ui » is not in « quiz », « bug » not in « debugger »', cat('Quiz de culture') === null && cat('Debugger') === null)
ok('...but a 3-letter stem takes its common inflections (bugs, fixed)', cat('Les bugs du menu') === 'correctif' && cat('Fixed the layout crash') === 'correctif')
ok('an exact-word rule is not a prefix: « quelque » is not « quel », « memory » not « memo », « logout » not « logo », « commentaire » not « comment »',
  cat('Ajouter quelque chose') === null && cat('Memory and lessons') === null && classerLocalement('Logout').score === 0 && cat('Logo') === 'ui' && cat('Commentaires du code') === null,
  [cat('Ajouter quelque chose'), cat('Memory and lessons'), classerLocalement('Logout').score, cat('Logo'), cat('Commentaires du code')])
ok('a long stem is a word start: « nettoy » → nettoyage, nettoyer', cat('Nettoyer les logs') === 'nettoyage' && cat('Nettoyage du repo') === 'nettoyage')
ok('a word counts once per category: « creer » is not also « cree »', classerLocalement('Créer un nouveau thème').score === 3, classerLocalement('Créer un nouveau thème'))
ok('a question mark makes a question', cat('Comment créer un thème ?') === 'question' && cat('Le thème ?') === 'question' && cat('Le thème') === 'ui')
ok('a phrase matches word by word (« mode sombre »)', cat('Passer en mode sombre') === 'ui')
ok('French and English both work', cat('Fix du bug de la sidebar') === 'correctif' && cat('Fix the crash on startup') === 'correctif')

console.log('\n── its rules and the product\'s categories agree ──')
{
  const connus = CATEGORIES.map((c) => c.slug).sort()
  const produits = new Set()
  for (const [titre] of REELS) { const c = cat(titre); if (c !== null) produits.add(c) }
  ok('every category it can answer is one the product knows', [...produits].every((c) => connus.includes(c)), [...produits])
  // every known category is reachable: one title per slug
  const EXEMPLES = { fonctionnalite: 'Implement a new feature', correctif: 'Corriger le bug', ui: 'Refaire le design', doc: 'Rédiger le README', integration: 'Brancher le webhook Stripe', donnees: 'Analyse des statistiques', nettoyage: 'Nettoyage des fichiers', question: 'Pourquoi ce choix ?' }
  ok('there is an example for each of the ' + connus.length + ' categories', Object.keys(EXEMPLES).sort().join() === connus.join())
  for (const s of connus) ok('the category « ' + s + ' » is reachable', cat(EXEMPLES[s]) === s, classerLocalement(EXEMPLES[s]))
}

console.log('\n── through the route: the fallback fires only when the brain gave NO verdict ──')
{
  const racine = mkdtempSync(join(tmpdir(), 'ksess-local-'))
  mkdirSync(join(racine, 'kybernos'), { recursive: true })
  writeFileSync(join(racine, 'kybernos', 'settings.json'), '{}')
  let reponseCerveau = null
  const appels = []
  const decision = {
    decider: async () => reponseCerveau,
    selectionner: async (...a) => { appels.push(['kybers', a[0]]); return reponseCerveau },
    selectionnerCategorie: async (t) => { appels.push(['categorie', t]); return reponseCerveau }
  }
  const routes = {}
  monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { reglagesPath: join(racine, 'kybernos', 'settings.json'), categoriesPath: join(racine, 'kybernos', 'categories.json'), sessionsHome: join(racine, 'sessions'), decision })
  const PORT = 3080
  const requete = (corps) => ({ method: 'POST', url: '/kybernos-sessions/decision', headers: { origin: 'http://127.0.0.1:' + PORT }, socket: { localPort: PORT }, on (ev, cb) { if (ev === 'data') cb(JSON.stringify(corps)); if (ev === 'end') cb() } })
  const reponse = () => { const r = { code: null, corps: null, writeHead (c) { r.code = c }, end (s) { try { r.corps = JSON.parse(s) } catch (e) { r.corps = s } } }; return r }
  const poser = async (corps) => { const r = reponse(); await routes['/kybernos-sessions/decision'](requete(corps), r); return r }

  reponseCerveau = { ok: false, code: 'HTTP-403', erreur: 'Free tier users do not have access to this model.', ms: 480, seuil: 0.6 }
  let r = await poser({ categorie: 'Nettoyage Docker libérer espace' })
  ok('the brain errors (403) → a local verdict, labelled', r.code === 200 && r.corps.ok === true && r.corps.motif === 'local' && r.corps.categorie === 'nettoyage' && r.corps.source === 'local', r.corps)
  ok('...and it says why the brain did not answer', r.corps.cerveau !== null && r.corps.cerveau.code === 'HTTP-403', r.corps)
  r = await poser({ categorie: 'Projet Mars' })
  ok('the brain errors and the title says nothing → the brain\'s own answer, unchanged', r.corps.ok === false && r.corps.code === 'HTTP-403', r.corps)
  reponseCerveau = { ok: false, code: 'CERVEAU-ETEINT', erreur: 'off', ms: 0, seuil: 0.6 }
  r = await poser({ categorie: 'Tendances des agents IA' })
  ok('the brain is switched off → local verdict (the caller keeps its own rule)', r.corps.motif === 'local' && r.corps.categorie === 'donnees', r.corps)

  reponseCerveau = { ok: true, categorie: 'ui', confiance: 0.9, motif: 'choisi', seuil: 0.6, probabilites: {} }
  r = await poser({ categorie: 'Nettoyage Docker libérer espace' })
  ok('the brain chose → its verdict is kept, never replaced by the local one', r.corps.motif === 'choisi' && r.corps.categorie === 'ui', r.corps)
  reponseCerveau = { ok: true, categorie: null, confiance: 0.4, motif: 'sous-le-seuil', seuil: 0.6, probabilites: {} }
  r = await poser({ categorie: 'Nettoyage Docker libérer espace' })
  ok('the brain answered « not sure » → that answer is kept (it did answer)', r.corps.motif === 'sous-le-seuil' && r.corps.categorie === null, r.corps)

  reponseCerveau = { ok: false, code: 'HTTP-403', erreur: 'x', ms: 1, seuil: 0.6 }
  r = await poser({ kybers: [{ id: 'k', mission: 'm' }], demande: 'Nettoyage du repo' })
  ok('the kyber routing question never gets a local answer', r.corps.ok === false && r.corps.motif === undefined, r.corps)
  r = await poser({ questions: { q: { type: 'boolean' } }, state: 'Nettoyage du repo' })
  ok('a free typed question never gets a local answer', r.corps.ok === false && r.corps.motif === undefined, r.corps)

  const sans = reponse()
  await routes['/kybernos-sessions/decision']({ method: 'POST', url: '/kybernos-sessions/decision', headers: {}, socket: { localPort: PORT }, on (ev, cb) { if (ev === 'data') cb('{"categorie":"Nettoyage"}'); if (ev === 'end') cb() } }, sans)
  ok('a POST with no origin is still refused (403) before anything is classified', sans.code === 403, sans.code)
  rmSync(racine, { recursive: true, force: true })
}

console.log('\n── the page: it takes a local verdict, and re-judges a row whose title changed ──')
{
  const client = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
  ok('the page records a `local` verdict like a `choisi` one (registry entry `auto`, replaceable by an agent)',
    /v\.ok === true && \(v\.motif === 'choisi' \|\| v\.motif === 'local'\)/.test(client))
  ok('an auto-classified row comes back to the queue when its title changed (« Greeting » becomes the real subject)',
    /CATEGORIES_AUTO\[id\] === true && avant !== undefined && avant !== null && String\(avant\.titre \|\| ''\) !== texte/.test(client))
  ok('...and a row classified by an agent or another browser (no local record) does not',
    /if \(!\(CATEGORIES_AUTO\[id\] === true && avant !== undefined/.test(client))
}

console.log('\nCLASSEMENT LOCAL — ' + (ok0 + ko) + ' assertions, ' + ko + ' failure(s)')
process.exit(ko === 0 ? 0 : 1)
