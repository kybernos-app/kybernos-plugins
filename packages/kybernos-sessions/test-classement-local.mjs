#!/usr/bin/env node
/** The local classifier of kybernos-sessions, and the decision route that puts it first (2026-10-15, reworked in WP-08).
 *
 *  Why: no session created while the old decision brain (a model on the gateway's evaluation API) answered HTTP 403 had a
 *  category, and every row kept the « not classified » dot. A chat title is now classified by the cautious word rules of
 *  `classement-local.mjs` FIRST, labelled `local`, and only on a clear signal; the Study model is asked only when they say
 *  nothing. This test pins (1) the classifier, (2) its rules against the categories the product knows, (3) the route: local
 *  words first, then the Study model through a stub `llm` (an id of the list, or nothing), the rests and the caches, and
 *  that nothing leaves through the network.
 *
 *  Usage: node packages/kybernos-sessions/test-classement-local.mjs   (exit 0 = all pass) */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classerLocalement, SEUIL_LOCAL, ECART_LOCAL } from './classement-local.mjs'
import { CATEGORIES } from './decision.mjs'
import { monterRoutes } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

// The POST routes need the signed session as well as the Origin (L3-18): the page's own request carries both.
sessionSource.secret = () => SESSION_SECRET

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
  ['Greeting', 'question'],
  ['Recherche des derniers modèles open source', 'question'],
  ['Skills équipe : sélecteur sur la fiche', 'ui'],
  ['Installation et mise à jour sur Linux', 'integration']
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
  cat('Ajouter quelque chose') === null && cat('Memorandum du projet') === null && classerLocalement('Logout').score === 0 && cat('Logo') === 'ui' && cat('Commentaires du code') === null,
  [cat('Ajouter quelque chose'), cat('Memorandum du projet'), classerLocalement('Logout').score, cat('Logo'), cat('Commentaires du code')])
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

console.log('\n── through the route: the local words first, the Study model only when they say nothing ──')
{
  const racine = mkdtempSync(join(tmpdir(), 'ksess-local-'))
  mkdirSync(join(racine, 'kybernos'), { recursive: true })
  const reglages = join(racine, 'kybernos', 'settings.json')
  const poserReglages = (objet) => writeFileSync(reglages, JSON.stringify(objet))
  poserReglages({ brain: 'zai-coding-cn/glm-5.3-flash' })
  let horloge = 1_000_000
  const MIN = 60 * 1000
  // A stub `llm`: the scripted answer of the moment, every call recorded.
  const appels = []
  let scene = { texte: 'ui' }
  const llm = {
    stream (params) {
      appels.push(params)
      const s = scene
      return (async function * () {
        if (s.erreur) throw s.erreur
        yield { type: 'text-delta', text: s.texte }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    }
  }
  const services = { llm }
  const reseau = []
  const fetchReel = globalThis.fetch
  globalThis.fetch = async (...a) => { reseau.push(String(a[0])); throw new Error('no network in this test') }
  const routes = {}
  monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { reglagesPath: reglages, categoriesPath: join(racine, 'kybernos', 'categories.json'), sessionsHome: join(racine, 'sessions'), ctx: { get: (nom) => services[nom] }, maintenant: () => horloge })
  const PORT = 3080
  const requete = (corps) => ({ method: 'POST', url: '/kybernos-sessions/decision', headers: { origin: 'http://127.0.0.1:' + PORT, cookie: sessionCookie('127.0.0.1:3080') }, socket: { localPort: PORT }, on (ev, cb) { if (ev === 'data') cb(JSON.stringify(corps)); if (ev === 'end') cb() } })
  const reponse = () => { const r = { code: null, corps: null, writeHead (c) { r.code = c }, end (s) { try { r.corps = JSON.parse(s) } catch (e) { r.corps = s } } }; return r }
  const poser = async (corps) => { const r = reponse(); await routes['/kybernos-sessions/decision'](requete(corps), r); return r }

  let r = await poser({ categorie: 'Nettoyage Docker libérer espace' })
  ok('a title the word rules place → a local verdict, labelled, and the model is not asked', r.code === 200 && r.corps.ok === true && r.corps.motif === 'local' && r.corps.categorie === 'nettoyage' && r.corps.source === 'local' && appels.length === 0, { corps: r.corps, appels: appels.length })
  r = await poser({ categorie: 'Projet Mars' })
  ok('a title they cannot place → the Study model answers, and it is the Study model of the settings', r.corps.ok === true && r.corps.motif === 'choisi' && r.corps.categorie === 'ui' && r.corps.source === 'study' && appels.length === 1 && appels[0].provider === 'zai-coding-cn' && appels[0].model === 'glm-5.3-flash', { corps: r.corps, appels: appels.map((a) => a.provider + '/' + a.model) })
  r = await poser({ categorie: 'Projet Mars' })
  ok('the same title again → answered from memory, the model is not asked twice', r.corps.categorie === 'ui' && appels.length === 1, appels.length)
  r = await poser({ categorie: '  projet   MARS ' })
  ok('...whatever its spacing and case', r.corps.categorie === 'ui' && appels.length === 1, appels.length)

  scene = { texte: 'bugfix' }
  r = await poser({ categorie: 'Voyage en Islande' })
  ok('an answer that is not in the list → answered « not sure » (hors-catalogue), nothing is chosen', r.corps.ok === true && r.corps.categorie === null && r.corps.motif === 'hors-catalogue', r.corps)
  const avant = appels.length
  await poser({ categorie: 'Voyage en Islande' })
  ok('...and that doubt is not asked again at once', appels.length === avant, appels.length)
  horloge += 31 * MIN
  scene = { texte: 'question' }
  r = await poser({ categorie: 'Voyage en Islande' })
  ok('...but it is, half an hour later', appels.length === avant + 1 && r.corps.categorie === 'question', { n: appels.length, corps: r.corps })

  // The model fails: it is not called again for 5 minutes (the list asks for a dozen rows at once); the local words still answer.
  appels.length = 0
  scene = { erreur: Object.assign(new Error('HTTP 403 Free tier users do not have access to this model'), { code: 'SERVER' }) }
  r = await poser({ categorie: 'Un autre sujet sans signal' })
  ok('the model fails → the failure is the answer, with its reason', r.corps.ok === false && r.corps.code === 'MODELE-EN-ERREUR' && /403/.test(r.corps.erreur), r.corps)
  await poser({ categorie: 'Encore un sujet obscur' })
  ok('a model that just failed is not called again at once (rest period)', appels.length === 1, appels.length)
  r = await poser({ categorie: 'Tendances des agents IA' })
  ok('...while a title the word rules place is still answered', r.corps.ok === true && r.corps.motif === 'local' && r.corps.categorie === 'donnees', r.corps)
  horloge += 4 * MIN
  await poser({ categorie: 'Encore un sujet obscur' })
  ok('still at rest 4 minutes later', appels.length === 1, appels.length)
  horloge += 2 * MIN
  scene = { texte: 'doc' }
  r = await poser({ categorie: 'Encore un sujet obscur' })
  ok('after 5 minutes the model is asked again, and its answer counts', appels.length === 2 && r.corps.ok === true && r.corps.categorie === 'doc', { n: appels.length, corps: r.corps })

  // What the person chose is read at each request.
  appels.length = 0
  poserReglages({ brain: 'ollama-local/qwen2.5:3b' })
  scene = { texte: 'integration' }
  r = await poser({ categorie: 'Quelque chose de nouveau' })
  ok('the Study model is read from the settings at each request (no restart)', appels.length === 1 && appels[0].provider === 'ollama-local' && appels[0].model === 'qwen2.5:3b' && r.corps.categorie === 'integration', { appels: appels.map((a) => a.provider + '/' + a.model), corps: r.corps })
  appels.length = 0
  poserReglages({ brain: 'none', decisionBrain: 'typesafe-ai/jev' })
  r = await poser({ categorie: 'Un sujet encore différent' })
  ok('the Study model set to None → nothing is sent to any model (ETUDE-ABSENTE), whatever else the file says', appels.length === 0 && r.corps.ok === false && r.corps.code === 'ETUDE-ABSENTE', { appels: appels.length, corps: r.corps })
  r = await poser({ categorie: 'Nettoyage du repo' })
  ok('...and the word rules still answer', r.corps.ok === true && r.corps.motif === 'local' && r.corps.categorie === 'nettoyage', r.corps)
  poserReglages({ brain: 'a/b', decisionBrain: 'none' })
  r = await poser({ categorie: 'Un sujet tout autre' })
  ok('the old « Decision Brain » key is ignored: only the Study model counts', appels.length === 1 && r.corps.ok === true, { appels: appels.length, corps: r.corps })

  // Automatic: an empty setting.
  appels.length = 0
  poserReglages({ brain: '' })
  r = await poser({ categorie: 'Un sujet sans modèle' })
  ok('Automatic with no model connected → ETUDE-ABSENTE, nothing is sent', appels.length === 0 && r.corps.ok === false && r.corps.code === 'ETUDE-ABSENTE', { appels: appels.length, corps: r.corps })
  services.settings = { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { kybernos: { apiKeyEnv: 'KT', models: [{ id: 'auto' }] }, openai: { apiKeyEnv: 'OK', models: [{ id: 'gpt-5-mini' }] } } } }] }
  services.credentials = { describe: async () => ({ configured: true }) }
  horloge += 10 * MIN
  scene = { texte: 'ui' }
  r = await poser({ categorie: 'Un sujet sans modèle' })
  ok('Automatic with the Cloud connected → the Cloud model answers', appels.length === 1 && appels[0].provider === 'kybernos' && appels[0].model === 'auto' && r.corps.ok === true && r.corps.categorie === 'ui', { appels: appels.map((a) => a.provider + '/' + a.model), corps: r.corps })
  ok('...and the verdict says which model answered', r.corps.modele === 'kybernos/auto', r.corps)

  // The other closed question: which agent team.
  appels.length = 0
  scene = { texte: 'doc-team' }
  const equipes = [{ id: 'dev-team', mission: 'ships code' }, { id: 'doc-team', mission: 'writes docs' }]
  r = await poser({ kybers: equipes, demande: 'Nettoyage du repo' })
  ok('the agent team question goes to the Study model (the word rules do not apply to it)', appels.length === 1 && r.corps.ok === true && r.corps.kyber === 'doc-team' && r.corps.motif === 'choisi', { n: appels.length, corps: r.corps })
  scene = { texte: 'aucun' }
  r = await poser({ kybers: equipes, demande: 'Quelle heure est-il' })
  ok('« aucun » comes back as such', r.corps.ok === true && r.corps.kyber === null && r.corps.motif === 'aucun', r.corps)
  poserReglages({ brain: 'none' })
  r = await poser({ kybers: equipes, demande: 'Écris la doc' })
  ok('with the Study model on None the agent team question is not asked at all', r.corps.ok === false && r.corps.code === 'ETUDE-ABSENTE', r.corps)
  poserReglages({ brain: 'a/b' })
  appels.length = 0
  r = await poser({ state: 'Nettoyage du repo', questions: { q: { type: 'boolean' } } })
  ok('the old free typed question (it belonged to the evaluation API) is refused, nothing is sent', r.code === 200 && r.corps.ok === false && r.corps.code === 'QUESTION-NON-SUPPORTEE' && r.corps.motif === undefined && appels.length === 0, { corps: r.corps, appels: appels.length })

  r = await poser({ categorie: 'New Session' })
  ok('a placeholder title (« New Session ») is not worth a call', r.corps.ok === false && r.corps.code === 'SANS-TEXTE' && appels.length === 0, { corps: r.corps, appels: appels.length })

  ok('nothing went through the network: no call to the evaluation API, no key read', reseau.length === 0, reseau)
  globalThis.fetch = fetchReel

  const sans = reponse()
  await routes['/kybernos-sessions/decision']({ method: 'POST', url: '/kybernos-sessions/decision', headers: {}, socket: { localPort: PORT }, on (ev, cb) { if (ev === 'data') cb('{"categorie":"Nettoyage"}'); if (ev === 'end') cb() } }, sans)
  ok('a POST with no origin is still refused (403) before anything is classified', sans.code === 403, sans.code)
  rmSync(racine, { recursive: true, force: true })
}

console.log('\n── coverage on the registry\'s own titles (measured 2026-10-15: 113 titles an agent or the brain had classified) ──')
{
  // A frozen sample of real titles and the category they got, to keep the keyword lists honest: more coverage must not cost accuracy.
  const ECHANTILLON = [
    ['ui', 'Nommage des chats, réglages Kybernos et barre de statut allégée'], ['ui', 'Pinned : réordonnancement façon Workspaces et repli'],
    ['ui', 'Crew éditable : prompts + sélecteur modèle (fiche Team)'], ['ui', 'Goal en chat : objectif, tours et barre sur deux lignes'],
    ['ui', 'Panneau de partage : reprise au pixel près'], ['ui', 'Skills Featured : rangée cartes à pochette, liste manuelle à l\'étoile'],
    ['correctif', 'Onglet Team : non-regression des parcours et correctif fallback'], ['correctif', 'Chasse aux bugs visuels — 11 correctifs prouvés'],
    ['fonctionnalite', 'Relance DSH : accord, reprise des sessions, coupure réseau'], ['fonctionnalite', 'Modeleur 2D/3D : dessiner des modèles depuis le chat'],
    ['fonctionnalite', 'Doublage Short EN : voix clonées, lipsync et QC itérative'], ['fonctionnalite', 'Redesign slash-creation : plans, jetons DSH resolus, portier durci'],
    ['integration', 'Recette beta : installation et mise a jour prouvees sur Linux et Windows'], ['integration', 'Kybernos : code de parrainage lu sur le compte'],
    ['question', 'Matchs des Bleus en septembre (Soccerway)'], ['donnees', 'Quality Score : KPIs réels, tendance et scoping dans la fiche AI Team']
  ]
  let juste = 0
  let classe = 0
  for (const [attendu, titre] of ECHANTILLON) { const c = cat(titre); if (c !== null) { classe += 1; if (c === attendu) juste += 1 } }
  ok('the sample is mostly classified (' + classe + '/' + ECHANTILLON.length + ')', classe >= Math.ceil(ECHANTILLON.length * 0.7), { classe })
  ok('and mostly right when it is (' + juste + '/' + classe + ')', juste >= Math.ceil(classe * 0.6), { juste, classe })
}

console.log('\n── the page: it takes a local verdict, and re-judges a row whose title changed ──')
{
  const client = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
  ok('the page records a `local` verdict like a `choisi` one (registry entry `auto`, replaceable by an agent)',
    /v\.ok === true && \(v\.motif === 'choisi' \|\| v\.motif === 'local'\)/.test(client))
  ok('an auto-classified row comes back to the queue when its title changed (« Greeting » becomes the real subject)',
    /CATEGORIES_AUTO\[id\] === true && avant !== undefined && avant !== null && String\(avant\.titre \|\| ''\) !== texte/.test(client))
  ok('a session no category fits shows a speech bubble, not a dot (« no icon was created »), and the question category a bubble with a « ? »',
    /const CATEGORIE_DEFAUT = \{ ico: 'chat', mot: 'Uncategorised' \}/.test(client) && /question: \{ ico: 'chatq', mot: 'Question' \}/.test(client) &&
    /\n\s+chat: '<path d="M7\.9 20A9 9 0 1 0 4 16\.1L2 22Z"\/>',/.test(client) && /'\\u\{2753\}': 'chatq'/.test(client))
  ok('a dozen rows are classified per pass, and a pass runs soon after new rows appear (it was 3 per 30 s: a long list took minutes)',
    /AUTOCAT_FILE\.length >= 12/.test(client) && /Date\.now\(\) - dernierePompe > 5000/.test(client))
  ok('...and a row classified by an agent or another browser (no local record) does not',
    /if \(!\(CATEGORIES_AUTO\[id\] === true && avant !== undefined/.test(client))
}

console.log('\nCLASSEMENT LOCAL — ' + (ok0 + ko) + ' assertions, ' + ko + ' failure(s)')
process.exit(ko === 0 ? 0 : 1)
