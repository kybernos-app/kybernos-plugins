#!/usr/bin/env node
/** Harnais hôte de kybernos-auto : routes sur un webServer FACTICE, home
 *  temporaire — aucun réseau, aucune écriture hors du home de test. */
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monterRoutes, lireSessions, lireSante } from './index.js'

let ok0 = 0
let ko = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 220) : '')) }
}

const home = mkdtempSync(join(tmpdir(), 'kauto-'))
const reglagesPath = join(home, 'kybernos', 'settings.json')
const sessionsAutoPath = join(home, 'kybernos', 'auto-sessions.json')
const santePath = join(home, 'kybernos', 'auto-health.json')

// webServer factice : capture les handlers par chemin
const routes = {}
const webServerSvc = { register: (r) => { routes[r.path] = r.handler } }
monterRoutes(webServerSvc, { home, reglagesPath, sessionsAutoPath, santePath, ollama: 'http://127.0.0.1:1' })

const requete = (method, path, corps) => ({ method, url: path, headers: { origin: 'http://127.0.0.1:3080' }, socket: { localPort: 3080 }, on: ('data', (d) => {}), ...{} , __corps: corps })
// petite fabrique conforme à lireCorps (events)
const fabriqueRequete = (method, path, corps) => {
  const body = corps === undefined ? '' : JSON.stringify(corps)
  return {
    method, url: path, headers: { origin: 'http://127.0.0.1:3080' }, socket: { localPort: 3080 },
    on (ev, cb) { if (ev === 'data') cb(body); if (ev === 'end') cb() }
  }
}
const reponse = () => { let out = null; return { writeHead () {}, end (s) { out = JSON.parse(s) }, get corps () { return out } } }

console.log('\n── état : lecture à vide ──')
let r = reponse()
await routes['/kybernos-auto/state'](requete('GET', '/kybernos-auto/state?sessionId=s1'), r)
ok('state à vide : global=false, session off, whitelist vide', r.corps.ok === true && r.corps.global === false && r.corps.sessionOn === false && Array.isArray(r.corps.whitelist) && r.corps.whitelist.length === 0, r.corps)

console.log('\n── session : on/off par sessionId ──')
r = reponse()
await routes['/kybernos-auto/session'](fabriqueRequete('POST', '/kybernos-auto/session', { sessionId: 's1', on: true }), r)
ok('s1 → on', r.corps.ok === true && r.corps.sessionOn === true, r.corps)
r = reponse()
await routes['/kybernos-auto/session'](fabriqueRequete('POST', '/kybernos-auto/session', { sessionId: 's2', on: true }), r)
r = reponse()
await routes['/kybernos-auto/session'](fabriqueRequete('POST', '/kybernos-auto/session', { sessionId: 's1', on: false }), r)
ok('s1 → off, s2 reste on', r.corps.ok === true && r.corps.sessionOn === false && lireSessions(sessionsAutoPath).s2 === true, r.corps)
r = reponse()
await routes['/kybernos-auto/session'](fabriqueRequete('POST', '/kybernos-auto/session', { sessionId: '', on: true }), r)
ok('sessionId vide refusée', r.corps.ok === false && typeof r.corps.erreur === 'string', r.corps)

console.log('\n── settings : whitelist et classifieur ──')
r = reponse()
await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoWhitelist: ['deepseek-official/deepseek-chat', 'token-plan/wan2.7-image'], autoClassifier: 'ollama-local/tev1:0.8b' }), r)
ok('whitelist + classifier écrits', r.corps.ok === true && r.corps.whitelist.length === 2 && r.corps.classifier === 'ollama-local/tev1:0.8b', r.corps)
r = reponse()
await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoWhitelist: ['a', 'a'] }), r)
ok('doublon refusé', r.corps.ok === false && String(r.corps.erreur).indexOf('autoWhitelist') !== -1, r.corps)

console.log('\n── router : global OFF → inactif ; global ON + session → route ──')
r = reponse()
await routes['/kybernos-auto/router'](fabriqueRequete('POST', '/kybernos-auto/router', { demande: 'corrige ce bug', sessionId: 's1' }), r)
ok('global off + session jamais activée → inactif', r.corps.actif === false, r.corps)
writeFileSync(reglagesPath, JSON.stringify({ autoRouting: true, autoWhitelist: ['deepseek-official/deepseek-chat', 'token-plan/wan2.7-image'] }))
writeFileSync(reglagesPath, JSON.stringify({ autoRouting: false, autoWhitelist: ['deepseek-official/deepseek-chat', 'token-plan/wan2.7-image'] }))
r = reponse()
await routes['/kybernos-auto/router'](fabriqueRequete('POST', '/kybernos-auto/router', { demande: 'corrige ce bug', sessionId: 's3' }), r)
ok('global off + s3 jamais activée → inactif (par session)', r.corps.actif === false, r.corps)
r = reponse()
await routes['/kybernos-auto/router'](fabriqueRequete('POST', '/kybernos-auto/router', { demande: 'corrige ce bug de pagination', sessionId: 's2' }), r)
ok('global off + s2 on → actif, règle code → deepseek-chat', r.corps.actif === true && r.corps.classe === 'code' && r.corps.modele === 'deepseek-official/deepseek-chat', r.corps)
writeFileSync(reglagesPath, JSON.stringify({ autoRouting: true, autoWhitelist: ['deepseek-official/deepseek-chat', 'token-plan/wan2.7-image'] }))
r = reponse()
await routes['/kybernos-auto/router'](fabriqueRequete('POST', '/kybernos-auto/router', { demande: 'corrige ce bug', sessionId: 's3' }), r)
ok('global on → disjoncteur : même s3 devient active', r.corps.actif === true, r.corps)

console.log('\n── santé : compteur écrit au routage, down exclu ──')
ok('compteur posé (calls≥1)', (lireSante(santePath)['deepseek-official/deepseek-chat']?.calls || 0) >= 1, lireSante(santePath))
r = reponse()
await routes['/kybernos-auto/state'](requete('GET', '/kybernos-auto/state'), r)
const santeChat = r.corps.sante.find((s) => s.modele === 'deepseek-official/deepseek-chat')
ok('vue santé : ok, erreurPct 0', santeChat && santeChat.etat === 'ok' && santeChat.calls >= 1, r.corps.sante)

console.log('\n── settings : disjoncteur global ──')
r = reponse()
await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoRouting: 'oui' }), r)
ok('autoRouting non booléen refusé', r.corps.ok === false, r.corps)
r = reponse()
await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoRouting: false }), r)
ok('autoRouting=false écrit, whitelist conservée', r.corps.ok === true && r.corps.global === false && r.corps.whitelist.length === 2, r.corps)
r = reponse()
await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoRouting: true }), r)
ok('autoRouting=true réécrit', r.corps.global === true, r.corps)

console.log('\n── report : latence, erreurs et cache réels ──')
const modeleRapport = 'deepseek-official/deepseek-chat'
r = reponse()
await routes['/kybernos-auto/report'](fabriqueRequete('POST', '/kybernos-auto/report', { modele: modeleRapport, latenceMs: 1800, erreur: false, inputTokens: 1000, cacheReadTokens: 900 }), r)
let sc = r.corps.sante.find((x) => x.modele === modeleRapport)
ok('report : latence 1800 ms, cacheHitPct 90, modèle « chaud »', r.corps.ok === true && sc.lastLatencyMs === 1800 && sc.cacheHitPct === 90 && r.corps.chaud === modeleRapport, sc)
ok('état : disponibles/total/checkedAt/intervalS présents', r.corps.total === 2 && r.corps.disponibles === 2 && typeof r.corps.checkedAt === 'number' && r.corps.intervalS === 60, r.corps)
ok('le routage seul ne pose PAS de latence (celle du router n’est pas celle du modèle)', lireSante(santePath)['token-plan/wan2.7-image'] === undefined || lireSante(santePath)['token-plan/wan2.7-image'].lastLatencyMs === null)
r = reponse()
await routes['/kybernos-auto/report'](fabriqueRequete('POST', '/kybernos-auto/report', { modele: modeleRapport, latenceMs: -5 }), r)
ok('report : latence négative refusée', r.corps.ok === false, r.corps)
for (let i = 0; i < 4; i++) {
  r = reponse()
  await routes['/kybernos-auto/report'](fabriqueRequete('POST', '/kybernos-auto/report', { modele: modeleRapport, latenceMs: 9000, erreur: true }), r)
}
sc = r.corps.sante.find((x) => x.modele === modeleRapport)
ok('erreurs répétées → « down », 1 modèle disponible sur 2', sc.etat === 'down' && r.corps.disponibles === 1, sc)
r = reponse()
await routes['/kybernos-auto/router'](fabriqueRequete('POST', '/kybernos-auto/router', { demande: 'corrige ce bug', sessionId: 's2' }), r)
ok('router : seul candidat code « down » → écarté, modèle de session conservé (modele null)', r.corps.actif === true && r.corps.modele === null && /hors service/.test(r.corps.raison), r.corps)
writeFileSync(santePath, JSON.stringify({}))

console.log('\n── router : classifieur hors ligne → repli chat, sans crash ──')
r = reponse()
await routes['/kybernos-auto/router'](fabriqueRequete('POST', '/kybernos-auto/router', { demande: 'analyse la stratégie de prix', sessionId: 's2' }), r)
ok('repli chat (whitelist sans média non applicable → chat modèle texte)', r.corps.actif === true && r.corps.modele !== null, r.corps)

console.log('\n── origin garde ──')
let brut403 = null
const rep403 = { writeHead (code) { brut403 = { code } }, end (s) { brut403.corps = s } }
await routes['/kybernos-auto/state']({ method: 'GET', url: '/kybernos-auto/state', headers: { origin: 'https://evil.example' }, on () {} }, rep403)
ok('origine étrangère → 403', brut403 !== null && brut403.code === 403, brut403)

console.log('\n' + (ko === 0 ? 'HARNAIS AUTO VERT — ' + ok0 + ' contrôles ✓' : ko + ' échec(s) sur ' + (ok0 + ko)))
process.exit(ko === 0 ? 0 : 1)
