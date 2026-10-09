// ═══════════════════════════════════════════════════════════════════════════
// Tests de kybernos-modeleur — moitié HÔTE, hors DSH.
//
// On monte un contexte factice (tools + webServer), on démarre un VRAI serveur
// HTTP sur les gestionnaires enregistrés, puis on exerce le contrat complet :
//   1. l'outil `modeliser` est enregistré et dépose une commande ;
//   2. GET /kybernos-modeleur/state la relit, avec l'espace et l'horloge ;
//   3. POST /kybernos-modeleur/push incrémente la version ;
//   4. `mode: modifier` sur un espace différent repart en « nouveau » ;
//   5. `duree_ms` est borné, et un corps illisible ne casse rien.
//
// Usage : node kybernos-modeleur/test-host.mjs
// ═══════════════════════════════════════════════════════════════════════════

import { createServer } from 'node:http'
import { apply, creerMagasin, optionsOutil, monterRoutes, definitionLiteral, specDefineTool } from './index.js'

let echecs = 0
const ok = (label, condition, detail) => {
  if (condition) console.log(`✓ ${label}${detail === undefined ? '' : ` (${detail})`}`)
  else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
}

// ── 1. l'outil ──────────────────────────────────────────────────────────────
const magasin = creerMagasin()
const definition = optionsOutil(magasin)
ok('l\'outil porte le nom attendu', definition.name === 'modeliser', definition.name)
ok('il déclare espace + prompt + ops + mode + titre + duree_ms',
  ['espace', 'prompt', 'ops', 'mode', 'titre', 'duree_ms'].every((k) => k in definition.parameters))
ok('le repli littéral garde la forme compilée de defineTool',
  definitionLiteral(definition).output !== undefined && specDefineTool(definition).output.schema.type === 'json')

const reponse = await definition.execute({ espace: '3d', prompt: 'un phare' }, { agent: { id: 'session-t' } })
ok('un appel sans session est refusé (échec fermé)',
  (await definition.execute({ prompt: 'x' }, {})).raison === 'agent_inconnu')
ok('un appel normal rend ok', reponse.ok === true, JSON.stringify(reponse.version))
ok('l\'espace par défaut est 3d', reponse.espace === '3d', reponse.espace)
ok('l\'espace invalide retombe sur 3d',
  (await definition.execute({ espace: 'platoire', prompt: 'x' }, { agent: { id: 's1' } })).espace === '3d')
ok('l\'espace 2d passe', (await definition.execute({ espace: '2d', prompt: 'x' }, { agent: { id: 's2' } })).espace === '2d')
ok('la durée est bornée par le haut', (await definition.execute({ espace: '2d', duree_ms: 999999 }, { agent: { id: 's3' } })).duree_ms === 120000)
ok('la durée est bornée par le bas', (await definition.execute({ espace: '2d', duree_ms: 3 }, { agent: { id: 's4' } })).duree_ms === 1500)
ok('une durée absente prend le défaut', (await definition.execute({ prompt: 'x' }, { agent: { id: 's5' } })).duree_ms === 8000)

const avecOps = await definition.execute({
  espace: '3d',
  ops: [{ op: 'box', x: 0, y: 0, z: 0, w: 4, d: 4, h: 3, color: '#C4291C' }],
  titre: 'Essai',
}, { agent: { id: 'session-t' } })
ok('les ops sont comptées', avecOps.lots === 1, String(avecOps.lots))

// ── 2. les routes, sur un vrai serveur ──────────────────────────────────────
const routes = new Map()
const fauxWebServer = { register: (r) => routes.set(r.path, r.handler) }
monterRoutes(fauxWebServer, magasin)
ok('les deux routes sont montées', routes.has('/kybernos-modeleur/state') && routes.has('/kybernos-modeleur/push') && routes.has('/kybernos-modeleur/annote'))

const serveur = createServer((req, res) => {
  const chemin = new URL(req.url, 'http://127.0.0.1').pathname
  const handler = routes.get(chemin)
  if (handler === undefined) { res.writeHead(404); res.end('nope'); return }
  handler(req, res).catch((e) => { res.writeHead(500); res.end(String(e)) })
})
await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${serveur.address().port}`

const lireEtat = async (session) => {
  const u = await fetch(`${base}/kybernos-modeleur/state${session === undefined ? '' : `?session=${session}`}`)
  return u.json()
}

await definition.execute({ espace: '2d', prompt: 'un schéma de ligne de production', ops: [{ op: 'line', x1: 0, y1: 0, x2: 4, y2: 4 }] }, { agent: { id: 'session-t' } })
const etat = await lireEtat('session-t')
ok('l\'état porte la version, le t0, la durée et l\'espace',
  Number.isInteger(etat.version) && Number.isInteger(etat.t0) && etat.dureeMs >= 1500 && etat.espace === '2d',
  `espace=${etat.espace}`)
ok('l\'état porte le prompt', etat.prompt === 'un schéma de ligne de production', etat.prompt)
ok('l\'horloge de pose est dans le passé (le panneau rattrape)',
  etat.t0 <= Date.now() && Date.now() - etat.t0 < 5000, `${Date.now() - etat.t0} ms`)

const avant = etat.version
const pousse = await fetch(`${base}/kybernos-modeleur/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: 'session-t', espace: '3d', ops: [{ op: 'cyl', cx: 0, cy: 0, z: 0, r: 3, h: 8 }], duree_ms: 4000 }),
})
const repPush = await pousse.json()
ok('un push incrémente la version', repPush.version === avant + 1, `${avant} → ${repPush.version}`)
ok('le push change l\'espace', (await lireEtat('session-t')).espace === '3d')

// modifier à travers un changement d'espace → nouveau
await definition.execute({ espace: '3d', mode: 'modifier', ops: [{ op: 'box', x: 0, y: 0, z: 0, w: 1, d: 1, h: 1 }] }, { agent: { id: 's-mod' } })
const vMod2 = await definition.execute({ espace: '3d', mode: 'modifier', ops: [{ op: 'box', x: 0, y: 0, z: 0, w: 1, d: 1, h: 1 }] }, { agent: { id: 's-mod' } })
ok('modifier sur le même espace reste modifier', vMod2.mode === 'modifier', vMod2.mode)
const vBasculé = await definition.execute({ espace: '2d', mode: 'modifier', ops: [{ op: 'rect', x: 0, y: 0, w: 1, h: 1 }] }, { agent: { id: 's-mod' } })
ok('modifier à travers un changement d\'espace repart en nouveau', vBasculé.mode === 'nouveau', vBasculé.mode)

ok('une session inconnue retombe sur la dernière commande',
  (await lireEtat('session-absente')).titre !== undefined)
ok('un corps illisible est refusé (400), il ne dépose pas de modèle vide', (await fetch(`${base}/kybernos-modeleur/push`, { method: 'POST', body: '{oops' })).status === 400)
ok('une méthode non POST est refusée', (await fetch(`${base}/kybernos-modeleur/push`)).status === 405)
ok('une origine étrangère est refusée',
  (await fetch(`${base}/kybernos-modeleur/state`, { headers: { Origin: 'https://evil.example' } })).status === 403)
ok('une origine par préfixe est refusée (localhost.evil.example)',
  (await fetch(`${base}/kybernos-modeleur/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost.evil.example' }, body: '{}' })).status === 403)
ok('une origine par préfixe est refusée (127.0.0.1.nip.io)',
  (await fetch(`${base}/kybernos-modeleur/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1.nip.io' }, body: '{}' })).status === 403)

// ── 2 bis. les annotations : le pinceau du panneau relu par l'outil ─────────
const repAnnote = await (await fetch(`${base}/kybernos-modeleur/annote`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ sessionId: 'session-t', strokes: [
    { coul: '#2A6FD6', pts: [[0.1, 0.2], [0.4, 0.5], [1.7, 0.5]] },
    { coul: 'pas-une-couleur', pts: [[0.1, 0.9], [0.3, 0.9]] },
    { coul: '#FFFFFF', pts: [[0.5]] },
  ] }),
})).json()
ok('la route annote compte les traits valides', repAnnote.ok === true && repAnnote.traits === 2, JSON.stringify(repAnnote))
const etatAnnote = await lireEtat('session-t')
ok('l\'état porte les annotations, bornées en 0..1',
  Array.isArray(etatAnnote.ann?.strokes) && etatAnnote.ann.strokes.length === 2
  && etatAnnote.ann.strokes[0].pts[2][0] === 1 && etatAnnote.ann.strokes[1].coul === '#E1502A',
  JSON.stringify(etatAnnote.ann?.strokes?.[0]?.pts?.[2]))
const relit = await definition.execute({ relire: true }, { agent: { id: 'session-t' } })
ok('relire:true renvoie les traits sans redéposer de modèle',
  relit.ok === true && relit.relire === true && relit.annotations.strokes.length === 2, relit.message.slice(0, 40))

// annotations typées : trait libre, formes 2 pts, texte ; dégénérés et
// type inconnu traités proprement (inconnu → trait, texte vide → écarté)
const repTypes = await (await fetch(`${base}/kybernos-modeleur/annote`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ sessionId: 'session-t', strokes: [
    { type: 'trait', coul: '#E1502A', pts: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.1]] },
    { type: 'rect', coul: '#2A6FD6', pts: [[0.1, 0.1], [0.5, 0.5], [0.9, 0.9]] },
    { type: 'fleche', coul: '#2A6FD6', pts: [[0.7, 0.7], [0.7, 0.2]] },
    { type: 'texte', coul: '#F2C31A', pts: [[0.4, 0.3]], text: '  agrandis ça  ' },
    { type: 'texte', coul: '#F2C31A', pts: [[0.4, 0.3]], text: '   ' },
    { type: 'gomme', pts: [[0.1, 0.1], [0.2, 0.2]] },
  ] }),
})).json()
ok('la route annote filtre les annotations typées (5 gardées sur 6)',
  repTypes.ok === true && repTypes.traits === 5, JSON.stringify(repTypes))
const etatTypes = await lireEtat('session-t')
const annTypes = etatTypes.ann.strokes
ok('rect tronqué à 2 pts, texte rogné, gomme devenue trait',
  annTypes.find((t) => t.type === 'rect').pts.length === 2
  && annTypes.find((t) => t.type === 'texte').text === 'agrandis ça'
  && annTypes.filter((t) => t.type === 'trait').length === 2)
const relitTypes = await definition.execute({ relire: true }, { agent: { id: 'session-t' } })
ok('le message de relire compte par type',
  /2 trait, 1 rect, 1 fleche, 1 texte/.test(relitTypes.message), relitTypes.message.slice(0, 90))
const relitAutre = await definition.execute({ relire: true }, { agent: { id: 'session-inconnue' } })
ok('relire sans modèle ne casse pas',
  relitAutre.ok === true && relitAutre.annotations.strokes.length === 0)
const vAvantPush = etatAnnote.version
await definition.execute({ espace: '3d', ops: [{ op: 'box', x: 0, y: 0, z: 0, w: 1, d: 1, h: 1 }] }, { agent: { id: 'session-t' } })
ok('un nouveau modèle repart feuille neuve (ann vidée)',
  (await lireEtat('session-t')).ann.strokes.length === 0 && (await lireEtat('session-t')).version === vAvantPush + 1)

// ── 2 ter. an empty call reopens the panel, it does not erase the model ─────
// It used to replace the model, and the annotations drawn over it, by an empty one; a push with an unreadable
// body did the same under the default session name, and became "the last model" for a panel naming no session.
{
  const SES = 'session-reouvre'
  const sans = await definition.execute({}, { agent: { id: 'session-sans-modele' } })
  ok('with no model to reopen, an empty call still answers ok', sans.ok === true)
  await definition.execute({ espace: '3d', ops: [{ op: 'box', x: 0, y: 0, z: 0, w: 2, d: 2, h: 2 }, { op: 'box', x: 3, y: 0, z: 0, w: 2, d: 2, h: 2 }], titre: 'A garder' }, { agent: { id: SES } })
  await fetch(`${base}/kybernos-modeleur/annote`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ sessionId: SES, strokes: [{ coul: '#2A6FD6', pts: [[0.1, 0.2], [0.4, 0.5]] }] }) })
  const avantR = await lireEtat(SES)
  const r = await definition.execute({}, { agent: { id: SES } })
  const apresR = await lireEtat(SES)
  ok('an empty call answers ok and says the panel was reopened', r.ok === true && /rouvert/.test(r.message), r.message)
  ok('it keeps the model, its title and its version', apresR.ops.length === 2 && apresR.titre === 'A garder' && apresR.version === avantR.version, JSON.stringify([apresR.ops && apresR.ops.length, apresR.titre, apresR.version, avantR.version]))
  ok('it keeps the strokes the user drew over it', Array.isArray(apresR.ann?.strokes) && apresR.ann.strokes.length === 1)
  ok('it raises the reopen counter the panel watches', apresR.ouverture === avantR.ouverture + 1, `${avantR.ouverture} → ${apresR.ouverture}`)
  ok('the agent can still read the strokes afterwards', (await definition.execute({ relire: true }, { agent: { id: SES } })).annotations.strokes.length === 1)
  for (const [nom, corps] of [['unreadable', '{oops'], ['an empty object', '{}'], ['null', 'null'], ['a JSON array', '[]'], ['ops that is not an array', '{"ops":"x"}']]) {
    const rep = await fetch(`${base}/kybernos-modeleur/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: corps })
    const j = await rep.json()
    ok(`a push with ${nom} → 400 corps_illisible`, rep.status === 400 && j.ok === false && j.raison === 'corps_illisible', `${rep.status} ${JSON.stringify(j)}`)
  }
  const sansSession = await lireEtat()
  ok('...and leaves no empty model behind: the state without a session is still the real one', sansSession.sessionId === SES && sansSession.ops.length === 2, JSON.stringify([sansSession.sessionId, sansSession.ops && sansSession.ops.length]))
  const bonPush = await fetch(`${base}/kybernos-modeleur/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ sessionId: SES, ops: [{ op: 'box', x: 0, y: 0, z: 0, w: 1, d: 1, h: 1 }] }) })
  ok('a push with ops still works', bonPush.status === 200 && (await bonPush.json()).ok === true)
}

// ── 3. le montage cordis ────────────────────────────────────────────────────
let outilVu = null
const ctx = {
  get: (nom) => (nom === 'tools' ? { register: (o) => { outilVu = o } } : nom === 'webServer' ? fauxWebServer : undefined),
  inject: () => { throw new Error('le contexte factice fournit déjà tout') },
  effect: (f) => { const d = f(); return typeof d === 'function' ? d : () => {} },
}
apply(ctx)
await new Promise((r) => setTimeout(r, 60))
ok('apply installe l\'outil sur le contexte', outilVu !== null && outilVu.name === 'modeliser')

await new Promise((r) => serveur.close(r))
console.log(echecs === 0 ? '\nhôte : tout est vert' : `\nhôte : ${echecs} échec(s)`)
process.exitCode = echecs === 0 ? 0 : 1
