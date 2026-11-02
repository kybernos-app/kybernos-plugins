// ═══════════════════════════════════════════════════════════════════════════
// Tests de kybernos-slides — moitié HÔTE, hors DSH.
//
// On monte un contexte factice (tools + webServer), on démarre un VRAI serveur
// HTTP sur les gestionnaires enregistrés, puis on exerce le contrat complet :
//   1. l'outil `creer_slides` dépose un deck ; durée bornée ; layouts filtrés ;
//   2. sans `slides`, l'outil LIT le deck + les annotations (échec fermé) ;
//   3. `mode: corriger` garde les annotations, `effacer_annotations` les vide ;
//   4. les annotations (éditions + traits) fusionnent, filtrées et bornées ;
//   5. GET /state et POST /push sur un vrai serveur HTTP.
//
// Usage : node kybernos-slides/test-host.mjs
// ═══════════════════════════════════════════════════════════════════════════

import { createServer } from 'node:http'
import {
  apply, creerMagasin, optionsOutil, monterRoutes,
  definitionLiteral, specDefineTool, normaliserSlide,
} from './index.js'

let echecs = 0
const ok = (label, condition, detail) => {
  if (condition) console.log(`✓ ${label}${detail === undefined ? '' : ` (${detail})`}`)
  else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
}

// ── 1. l'outil ──────────────────────────────────────────────────────────────
const magasin = creerMagasin()
const definition = optionsOutil(magasin)
ok('l\'outil porte le nom attendu', definition.name === 'creer_slides', definition.name)
ok('il déclare titre + theme + slides + mode + duree_ms + prompt',
  ['titre', 'theme', 'slides', 'mode', 'effacer_annotations', 'duree_ms', 'prompt'].every((k) => k in definition.parameters))
ok('le repli littéral garde la forme compilée de defineTool',
  definitionLiteral(definition).output !== undefined && specDefineTool(definition).output.schema.type === 'json')

ok('un appel sans session est refusé (échec fermé)',
  (await definition.execute({ slides: [] }, {})).raison === 'agent_inconnu')

const deck = await definition.execute({
  titre: 'Varde 2.0', theme: 'sombre', duree_ms: 9_000,
  slides: [
    { layout: 'titre', kicker: 'La démo', titre: 'Rain is a given.' },
    { layout: 'statement', titre: 'Shells should come prepared.' },
    { layout: 'puces', titre: 'Trois gestes', points: ['Le chat écrit.', 'Tu modifies.', 'Il corrige.'] },
  ],
}, { agent: { id: 'session-t' } })
ok('un appel normal rend ok', deck.ok === true && deck.slides === 3, JSON.stringify(deck.slides))
ok('la durée demandée passe telle quelle', deck.duree_ms === 9_000, String(deck.duree_ms))
ok('le premier dépôt est « nouveau »', deck.mode === 'nouveau', deck.mode)
ok('la durée est bornée par le haut',
  (await definition.execute({ slides: [{ titre: 'x' }], duree_ms: 999_999 }, { agent: { id: 's' } })).duree_ms === 120_000)
ok('la durée est bornée par le bas',
  (await definition.execute({ slides: [{ titre: 'x' }], duree_ms: 3 }, { agent: { id: 's' } })).duree_ms === 2_000)
ok('un thème inconnu retombe sur sombre',
  (await definition.execute({ slides: [{ titre: 'x' }], theme: 'fluorescent' }, { agent: { id: 's' } })).theme === 'sombre')

// ── 2. normalisation des slides ─────────────────────────────────────────────
const sale = normaliserSlide({
  layout: 'platoire', titre: '  a   b  '.repeat(300), points: ['ok', '', 42, 'x'.repeat(500)],
  accent: 'rouge', kicker: 'k', note: 'n', grand: 7,
})
ok('layout inconnu → puces', sale.layout === 'puces', sale.layout)
ok('titre tronqué à 300', sale.titre.length === 300, String(sale.titre.length))
ok('points vides/non-chaîne filtrés, longs tronqués', sale.points.length === 2 && sale.points[1].length === 220,
  JSON.stringify(sale.points.map((p) => p.length)))
ok('accent non hexadécimal écarté', sale.accent === undefined)
ok('champ non-chaîne écarté', sale.grand === undefined)
ok('un non-objet rend null', normaliserSlide('x') === null && normaliserSlide(null) === null)

// ── 3. lecture sans slides ──────────────────────────────────────────────────
const magasinVide = creerMagasin()
const vide = optionsOutil(magasinVide).execute
ok('lecture d\'une session sans aucun deck rend vide',
  (await vide({}, { agent: { id: 'session-vide' } })).vide === true)
// Un magasin qui connaît d'autres sessions retombe sur la dernière commande
// (même compromis que kybernos-modeleur : un onglet sans clé reste servi).

await definition.execute({
  titre: 'Lecture', slides: [{ titre: 'a' }, { titre: 'b' }],
}, { agent: { id: 'session-t' } })
magasin.pousserAnnotations({
  sessionId: 'session-t',
  edits: [{ slide: 0, champ: 'titre', idx: -1, avant: 'a', apres: 'a corrigé par l\'utilisateur' }],
  strokes: {
    1: [{ points: [[0, 0], [10, 10], [300, 400]], color: '#F2C31A', width: 5 }, 'pas un trait'],
    99: [{ points: [[0, 0], [1, 1]] }],
  },
})
const lecture = await definition.execute({}, { agent: { id: 'session-t' } })
ok('la lecture rend le deck', lecture.lecture === true && lecture.titre === 'Lecture' && lecture.slides === 2)
ok('la lecture porte les éditions', lecture.annotations.edits.length === 1
  && lecture.annotations.edits[0].apres === 'a corrigé par l\'utilisateur')
// Couleur : poussée telle quelle si #hex, retirée sinon (chemin réel : la
// route, pas l'outil — l'agent ne fait que relire).
magasin.pousserAnnotations({ sessionId: 'session-t', edits: [{ slide: 0, champ: 'titre', idx: -1, avant: 'a', apres: 'a', couleur: '#E1502A' }] })
magasin.pousserAnnotations({ sessionId: 'session-t', edits: [{ slide: 1, champ: 'titre', idx: -1, avant: 'b', apres: 'b', couleur: 'rouge vif' }] })
const lectureCouleur = await definition.execute({}, { agent: { id: 'session-t' } })
const editCouleur = lectureCouleur.annotations.edits.find((e) => e.couleur !== undefined)
ok('la couleur valide est relue, l\'invalide est retirée',
  editCouleur?.couleur === '#E1502A' && !lectureCouleur.annotations.edits.some((e) => e.couleur === 'rouge vif'))
ok('les traits invalides sont filtrés, hors-slide écartés',
  lecture.annotations.traits_total === 1 && lecture.annotations.traits_par_slide[1] === 1,
  JSON.stringify(lecture.annotations.traits_par_slide))

// ── 4. correction : garder ou effacer les annotations ───────────────────────
const corr = await definition.execute({
  mode: 'corriger', titre: 'Lecture', slides: [{ titre: 'a corrigé' }, { titre: 'b' }], prompt: 'coquilles',
}, { agent: { id: 'session-t' } })
ok('une correction est étiquetée', corr.mode === 'corriger', corr.mode)
ok('le premier passage sans précédent repart en « nouveau »',
  (await definition.execute({ mode: 'corriger', slides: [{ titre: 'x' }] }, { agent: { id: 'session-neuf' } })).mode === 'nouveau')
const apresCorr = await definition.execute({}, { agent: { id: 'session-t' } })
ok('une correction GARDE les annotations', apresCorr.annotations.traits_total === 1
  && apresCorr.annotations.edits.length === 3) // 1 texte + 2 retouches couleur
await definition.execute({
  mode: 'corriger', effacer_annotations: true, titre: 'Lecture', slides: [{ titre: 'a' }, { titre: 'b' }],
}, { agent: { id: 'session-t' } })
const apresEfface = await definition.execute({}, { agent: { id: 'session-t' } })
ok('effacer_annotations vide les traits', apresEfface.annotations.traits_total === 0
  , JSON.stringify(apresEfface.annotations.traits_total))

// ── 5. les routes, sur un vrai serveur ──────────────────────────────────────
const routes = new Map()
const fauxWebServer = { register: (r) => routes.set(r.path, r.handler) }
monterRoutes(fauxWebServer, magasin)
ok('les deux routes sont montées', routes.has('/kybernos-slides/state') && routes.has('/kybernos-slides/push'))

const serveur = createServer((req, res) => {
  const chemin = new URL(req.url, 'http://127.0.0.1').pathname
  const handler = routes.get(chemin)
  if (handler === undefined) { res.writeHead(404); res.end('nope'); return }
  handler(req, res).catch((e) => { res.writeHead(500); res.end(String(e)) })
})
await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${serveur.address().port}`

const lireEtat = async (session) => {
  const u = await fetch(`${base}/kybernos-slides/state${session === undefined ? '' : `?session=${session}`}`)
  return u.json()
}

const etat = await lireEtat('session-t')
ok('GET /state relit le deck', etat.vide === false && etat.titre === 'Lecture' && etat.slides.length === 2)
ok('GET /state porte l\'horloge de l\'hôte', typeof etat.t0 === 'number' && etat.dureeMs > 0)
ok('GET /state porte les annotations', etat.annotations.version >= 1)
const etatAutre = await lireEtat()
ok('GET /state sans session rend la dernière commande', etatAutre.vide === false && etatAutre.titre === 'Lecture')
ok('GET /state d\'une session inconnue retombe sur la dernière commande',
  (await lireEtat('personne')).vide === false)
{
  // Magasin neuf : aucune session connue → l'état est vide, pas une erreur.
  const routesVides = new Map()
  monterRoutes({ register: (r) => routesVides.set(r.path, r.handler) }, magasinVide)
  const serveurVide = createServer((req, res) => {
    routesVides.get(new URL(req.url, 'http://127.0.0.1').pathname)(req, res).catch(() => {})
  })
  await new Promise((r) => serveurVide.listen(0, '127.0.0.1', r))
  const etatVide = await (await fetch(`http://127.0.0.1:${serveurVide.address().port}/kybernos-slides/state`)).json()
  ok('GET /state sur un magasin neuf rend vide', etatVide.vide === true)
  serveurVide.close()
}

const pousser = async (corps, entete) => fetch(`${base}/kybernos-slides/push`, {
  method: 'POST',
  headers: entete === false ? {} : { 'Content-Type': 'application/json', Origin: base },
  body: typeof corps === 'string' ? corps : JSON.stringify(corps),
})
const rAnn = await pousser({
  sessionId: 'session-t',
  edits: [{ slide: 1, champ: 'titre', idx: -1, avant: 'b', apres: 'b retouché' }],
  strokes: { 0: [{ points: [[5, 5], [50, 80]] }] },
})
const rAnnJson = await rAnn.json()
ok('POST /push fusionne les annotations', rAnnJson.ok === true && rAnnJson.annotations.edits === 4, // 3 + 1 route
  JSON.stringify(rAnnJson.annotations))
const relit = await lireEtat('session-t')
ok('l\'édition poussée est relue par /state',
  relit.annotations.edits.some((e) => e.apres === 'b retouché'))
const rDeck = await pousser({ sessionId: 'route-x', titre: 'Route', slides: [{ titre: 'a' }], duree_ms: 5000 })
const rDeckJson = await rDeck.json()
ok('POST /push dépose un deck', rDeckJson.ok === true && rDeckJson.titre === 'Route' && rDeckJson.dureeMs === 5000,
  JSON.stringify(rDeckJson))
const illisible = await pousser('{{{', false)
ok('un corps illisible est refusé sans casser la route (et sans deck fantôme)',
  illisible.status === 400, String(illisible.status))
ok('une origine étrangère est refusée',
  (await fetch(`${base}/kybernos-slides/state`, { headers: { Origin: 'http://evil.example' } })).status === 403)
ok('une origine par préfixe est refusée (localhost.evil.example)',
  (await fetch(`${base}/kybernos-slides/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost.evil.example' }, body: '{}' })).status === 403)
ok('une origine par préfixe est refusée (127.0.0.1.nip.io)',
  (await fetch(`${base}/kybernos-slides/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1.nip.io' }, body: '{}' })).status === 403)
ok('GET sur /push est refusé', (await fetch(`${base}/kybernos-slides/push`)).status === 405)

// ── 6. le plugin hôte ───────────────────────────────────────────────────────
const demarres = []
apply({
  get: () => undefined,
  inject: (noms, f) => demarres.push(noms.join('+')),
})
ok('apply retombe sur ctx.inject quand les services manquent', demarres[0] === 'tools+webServer', demarres[0])
let outilEnregistre = false
apply({
  get: (nom) => nom === 'tools'
    ? { register: () => { outilEnregistre = true } }
    : (nom === 'webServer' ? { register: () => {} } : undefined),
  inject: (noms, f) => { /* services déjà là : demarrer tourne de suite */ },
})
await new Promise((r) => setTimeout(r, 50))
ok('apply enregistre l\'outil quand `tools` est là', outilEnregistre)

serveur.close()
console.log(echecs === 0 ? '\nHost : tout est vert.' : `\nHost : ${echecs} échec(s).`)
process.exit(echecs === 0 ? 0 : 1)
