// ═══════════════════════════════════════════════════════════════════════════
// Tests de kybernos-bricks — moitié HÔTE, hors DSH.
//
// On monte un contexte factice (tools + webServer), on démarre un VRAI serveur
// HTTP sur les gestionnaires enregistrés, puis on exerce le contrat complet :
//   1. l'outil `animer_briques` est enregistré et dépose une commande ;
//   2. GET /kybernos-bricks/state la relit, avec l'horloge de pose (t0/dureeMs) ;
//   3. POST /kybernos-bricks/push incrémente la version ;
//   4. une session inconnue retombe sur la dernière commande déposée ;
//   5. `duree_ms` est borné, et un corps illisible ne casse rien.
//
// Usage : node kybernos-bricks/test-host.mjs
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
ok('l\'outil porte le nom attendu', definition.name === 'animer_briques', definition.name)
ok('il déclare prompt + ops + mode + titre + duree_ms',
  ['prompt', 'ops', 'mode', 'titre', 'duree_ms'].every((k) => k in definition.parameters))
ok('le repli littéral garde la forme compilée de defineTool',
  definitionLiteral(definition).output !== undefined && specDefineTool(definition).output.schema.type === 'json')

const reponse = await definition.execute({ prompt: 'un phare sur des rochers' }, { agent: { id: 'session-t' } })
ok('un appel sans session est refusé (échec fermé)',
  (await definition.execute({ prompt: 'x' }, {})).raison === 'agent_inconnu')
ok('un appel normal rend ok', reponse.ok === true, JSON.stringify(reponse.version))
ok('la durée est bornée par le haut', (await definition.execute({ prompt: 'x', duree_ms: 999999 }, { agent: { id: 's2' } })).duree_ms === 120000)
ok('la durée est bornée par le bas', (await definition.execute({ prompt: 'x', duree_ms: 3 }, { agent: { id: 's3' } })).duree_ms === 1500)
ok('une durée absente prend le défaut', (await definition.execute({ prompt: 'x' }, { agent: { id: 's4' } })).duree_ms === 12000)

const avecOps = await definition.execute({
  ops: [{ op: 'rect', x: 0, y: 0, z: 0, w: 4, d: 4, h: 3, color: '#C4291C' }],
  titre: 'Essai',
}, { agent: { id: 'session-t' } })
ok('les ops sont comptées', avecOps.lots === 1, String(avecOps.lots))

// ── 2. les routes, sur un vrai serveur ──────────────────────────────────────
const routes = new Map()
const fauxWebServer = { register: (r) => routes.set(r.path, r.handler) }
monterRoutes(fauxWebServer, magasin)
ok('les deux routes sont montées', routes.has('/kybernos-bricks/state') && routes.has('/kybernos-bricks/push'))

const serveur = createServer((req, res) => {
  const chemin = new URL(req.url, 'http://127.0.0.1').pathname
  const handler = routes.get(chemin)
  if (handler === undefined) { res.writeHead(404); res.end('nope'); return }
  handler(req, res).catch((e) => { res.writeHead(500); res.end(String(e)) })
})
await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${serveur.address().port}`

const lireEtat = async (session) => {
  const u = await fetch(`${base}/kybernos-bricks/state${session === undefined ? '' : `?session=${session}`}`)
  return u.json()
}

await definition.execute({ prompt: 'un chalet alpin' }, { agent: { id: 'session-t' } })
const etat = await lireEtat('session-t')
ok('l\'état porte la version, le t0 et la durée',
  Number.isInteger(etat.version) && Number.isInteger(etat.t0) && etat.dureeMs >= 1500)
ok('l\'état porte le prompt', etat.prompt === 'un chalet alpin', etat.prompt)
ok('l\'horloge de pose est dans le passé (le panneau rattrape)',
  etat.t0 <= Date.now() && Date.now() - etat.t0 < 5000, `${Date.now() - etat.t0} ms`)

const avant = etat.version
const pousse = await fetch(`${base}/kybernos-bricks/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ sessionId: 'session-t', cle: 'phare', duree_ms: 4000 }),
})
const repPush = await pousse.json()
ok('un push incrémente la version', repPush.version === avant + 1, `${avant} → ${repPush.version}`)
ok('le push retient la clé d\'archétype', (await lireEtat('session-t')).cle === 'phare')

ok('une session inconnue retombe sur la dernière commande',
  (await lireEtat('session-absente')).titre !== undefined)
ok('un corps illisible ne casse pas la route', (await (await fetch(`${base}/kybernos-bricks/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{oops' })).json()).ok === true)
ok('un Content-Type non JSON est refusé (415)', (await fetch(`${base}/kybernos-bricks/push`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: base }, body: '{}' })).status === 415)
ok('une origine par préfixe est refusée (localhost.evil.example)', (await fetch(`${base}/kybernos-bricks/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost.evil.example' }, body: '{}' })).status === 403)
ok('une origine par préfixe est refusée (127.0.0.1.nip.io)', (await fetch(`${base}/kybernos-bricks/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1.nip.io' }, body: '{}' })).status === 403)
ok('un port voisin est refusé (Origin :3080 vs port réel)', (await fetch(`${base}/kybernos-bricks/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3080' }, body: '{}' })).status === 403)
ok('une méthode non POST est refusée', (await fetch(`${base}/kybernos-bricks/push`)).status === 405)
ok('une origine étrangère est refusée',
  (await fetch(`${base}/kybernos-bricks/state`, { headers: { Origin: 'https://evil.example' } })).status === 403)

// ── 3. le montage cordis ────────────────────────────────────────────────────
let outilVu = null
const ctx = {
  get: (nom) => (nom === 'tools' ? { register: (o) => { outilVu = o } } : nom === 'webServer' ? fauxWebServer : undefined),
  inject: () => { throw new Error('le contexte factice fournit déjà tout') },
  effect: (f) => { const d = f(); return typeof d === 'function' ? d : () => {} },
}
apply(ctx)
await new Promise((r) => setTimeout(r, 60))
ok('apply installe l\'outil sur le contexte', outilVu !== null && outilVu.name === 'animer_briques')

await new Promise((r) => serveur.close(r))
console.log(echecs === 0 ? '\nhôte : tout est vert' : `\nhôte : ${echecs} échec(s)`)
process.exitCode = echecs === 0 ? 0 : 1