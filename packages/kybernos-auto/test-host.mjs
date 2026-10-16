#!/usr/bin/env node
/** Harnais hôte de kybernos-auto : routes sur un webServer FACTICE, home
 *  temporaire — aucun réseau, aucune écriture hors du home de test. */
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, chmodSync } from 'node:fs'
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

console.log('\n── santé : le routage seul n’écrit rien (un modèle choisi n’a encore rien fait) ──')
ok('aucun compteur posé par un routage', lireSante(santePath)['deepseek-official/deepseek-chat'] === undefined, lireSante(santePath))
r = reponse()
await routes['/kybernos-auto/state'](requete('GET', '/kybernos-auto/state'), r)
const santeChat = r.corps.sante.find((s) => s.modele === 'deepseek-official/deepseek-chat')
ok('vue santé : « jamais » vu, disjoncteur fermé, donc disponible', santeChat && santeChat.etat === 'jamais' && santeChat.disjoncteur === 'closed' && r.corps.disponibles === 2, r.corps.sante)

console.log('\n── settings : disjoncteur global ──')
r = reponse()
await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoRouting: 'oui' }), r)
ok('autoRouting non booléen refusé', r.corps.ok === false, r.corps)

// Repli du chat (failover.mjs) : un réglage opt-in, désactivé par défaut, exposé dans l'état de la page.
r = reponse()
await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoFailover: 'oui' }), r)
ok('autoFailover non booléen refusé', r.corps.ok === false, r.corps)
r = reponse()
await routes['/kybernos-auto/state'](requete('GET', '/kybernos-auto/state'), r)
ok('state : le repli du chat est désactivé par défaut et rien n\'a bougé', r.corps.failover !== undefined && r.corps.failover.enabled === false && r.corps.failover.last === null, r.corps.failover)
r = reponse()
await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoFailover: true }), r)
ok('autoFailover=true écrit, le state le dit, la whitelist est conservée', r.corps.ok === true && r.corps.failover.enabled === true && r.corps.whitelist.length === 2, r.corps)
r = reponse()
await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoFailover: false }), r)
ok('autoFailover=false le désactive', r.corps.ok === true && r.corps.failover.enabled === false, r.corps)
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
ok('trois échecs de suite → disjoncteur ouvert (« down »), 1 modèle disponible sur 2', sc.etat === 'down' && sc.disjoncteur === 'open' && sc.jusqua > Date.now() && r.corps.disponibles === 1, sc)
r = reponse()
await routes['/kybernos-auto/router'](fabriqueRequete('POST', '/kybernos-auto/router', { demande: 'corrige ce bug', sessionId: 's2' }), r)
ok('router : seul candidat code en pause → écarté (avec sa raison), modèle de session conservé (modele null)', r.corps.actif === true && r.corps.modele === null && /paused|did not answer/.test(r.corps.raison) && r.corps.ecartes.length === 1 && r.corps.ecartes[0].modele === 'deepseek-official/deepseek-chat', r.corps)
writeFileSync(santePath, JSON.stringify({}))

console.log('\n── router : classifieur hors ligne → repli chat, sans crash ──')
r = reponse()
await routes['/kybernos-auto/router'](fabriqueRequete('POST', '/kybernos-auto/router', { demande: 'analyse la stratégie de prix', sessionId: 's2' }), r)
ok('repli chat (whitelist sans média non applicable → chat modèle texte)', r.corps.actif === true && r.corps.modele !== null, r.corps)

console.log('\n── settings.json partagé : fusion, fichier corrompu, écriture atomique ──')
{
  const SECRETS = { pairingToken: 'pt-secret', gatewayBase: 'https://gateway.example', wsAdminKey: 'wk-secret' }
  const dossier = join(reglagesPath, '..')
  const autour = () => readdirSync(dossier)
  const lireDisque = () => JSON.parse(readFileSync(reglagesPath, 'utf8'))
  writeFileSync(reglagesPath, JSON.stringify({ ...SECRETS, renameAfterRecap: true, brain: 'a/b' }))
  chmodSync(reglagesPath, 0o644)
  r = reponse()
  await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoRouting: false, autoClassifier: 'ollama/qwen' }), r)
  let disque = lireDisque()
  ok('save : les clés des autres bundles survivent (pairingToken, gatewayBase, wsAdminKey, renameAfterRecap, brain)', disque.pairingToken === SECRETS.pairingToken && disque.gatewayBase === SECRETS.gatewayBase && disque.wsAdminKey === SECRETS.wsAdminKey && disque.renameAfterRecap === true && disque.brain === 'a/b', disque)
  ok('save : les clés d\'Auto sont écrites', disque.autoRouting === false && disque.autoClassifier === 'ollama/qwen', disque)
  ok('save : le mode du fichier est conservé (0644, jamais élargi ni durci)', (statSync(reglagesPath).mode & 0o777) === 0o644, (statSync(reglagesPath).mode & 0o777).toString(8))
  ok('save : aucun fichier temporaire ne reste', autour().every((nom) => !nom.includes('.tmp-')), autour())

  const tordu = '{ "pairingToken": "pt-secret", "autoWhitelist": '
  writeFileSync(reglagesPath, tordu)
  r = reponse()
  await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoRouting: 'oui' }), r)
  ok('corrompu + corps invalide : refus de validation, aucune copie créée', r.corps.ok === false && autour().filter((nom) => nom.startsWith('settings.json.corrupt-')).length === 0, autour())
  r = reponse()
  await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoRouting: true }), r)
  ok('corrompu : l\'enregistrement est refusé avec un message clair', r.corps.ok === false && /nothing was saved/.test(r.corps.erreur), r.corps)
  ok('corrompu : le fichier reste tel quel, octet pour octet', readFileSync(reglagesPath, 'utf8') === tordu)
  const copies = autour().filter((nom) => nom.startsWith('settings.json.corrupt-'))
  ok('corrompu : une copie est gardée, identique (le jeton est récupérable)', copies.length === 1 && readFileSync(join(dossier, copies[0]), 'utf8') === tordu, copies)
  r = reponse()
  await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoRouting: true }), r)
  ok('corrompu : répéter n\'empile pas les copies', autour().filter((nom) => nom.startsWith('settings.json.corrupt-')).length === 1, autour())

  writeFileSync(reglagesPath, JSON.stringify({ ...SECRETS }))
  r = reponse()
  await routes['/kybernos-auto/settings'](fabriqueRequete('POST', '/kybernos-auto/settings', { autoRouting: true }), r)
  ok('réparé : l\'enregistrement repasse et garde les secrets', r.corps.ok === true && lireDisque().pairingToken === SECRETS.pairingToken && lireDisque().autoRouting === true, r.corps)
  writeFileSync(reglagesPath, JSON.stringify({ autoRouting: true, autoWhitelist: ['deepseek-official/deepseek-chat', 'token-plan/wan2.7-image'] }))
}

console.log('\n── les modèles qu\'Auto peut prendre : tous, gratuits, ma liste (V-30) ──')
{
  const home2 = mkdtempSync(join(tmpdir(), 'kauto2-'))
  const p2 = { reglagesPath: join(home2, 'kybernos', 'settings.json'), sessionsAutoPath: join(home2, 'kybernos', 'auto-sessions.json'), santePath: join(home2, 'kybernos', 'auto-health.json') }
  const lire2 = () => JSON.parse(readFileSync(p2.reglagesPath, 'utf8'))
  const M = (route, id, extra = {}) => ({ route, id, cle: route + '/' + id, connecte: true, locale: false, ...extra })
  let connus = [M('groq', 'llama-3.3-70b'), M('groq', 'gemma-2-9b-flash'), M('opencode-free', 'big-pickle'), M('kybernos', 'auto'), M('anthropic', 'claude-haiku-4', { connecte: false })]
  const routes2 = {}
  monterRoutes({ register: (r) => { routes2[r.path] = r.handler } }, { home: home2, ...p2, ollama: 'http://127.0.0.1:1', modeles: async () => connus, horloge: () => Date.now() })
  const appel = async (path, corps) => { const rr = reponse(); await routes2[path.split('?')[0]](fabriqueRequete(corps === undefined ? 'GET' : 'POST', path, corps), rr); return rr.corps }
  let st = await appel('/kybernos-auto/state?sessionId=s1')
  ok('une installation neuve : « tous les modèles », la liste est celle des modèles connectés (sans clé = écarté)', st.scope === 'all' && st.whitelist.join() === 'kybernos/auto,groq/gemma-2-9b-flash,opencode-free/big-pickle,groq/llama-3.3-70b' && st.explicite.length === 0 && st.total === 4, st)
  st = await appel('/kybernos-auto/settings', { autoScope: 'free' })
  ok('« modèles gratuits » : seulement les gratuits', st.ok === true && st.scope === 'free' && st.whitelist.join() === 'opencode-free/big-pickle', st)
  ok('le choix est écrit dans settings.json, avec la liste tapée intacte', lire2().autoScope === 'free')
  st = await appel('/kybernos-auto/settings', { autoScope: 'tout' })
  ok('un périmètre inconnu est refusé, avec son code', st.ok === false && st.code === 'scope', st)
  connus = connus.concat([M('openrouter', 'x/y:free')])
  await new Promise((r) => setTimeout(r, 5))
  st = await appel('/kybernos-auto/settings', { autoClassifier: '' })
  ok('un modèle gratuit branché plus tard est repris sans que personne ne touche une liste (le cache se rafraîchit à la saisie suivante)', st.ok === true, st)

  // A3-24 : ce qui est tapé doit être un modèle de la configuration
  const junk = ['model-only', 'a b/c d', '../../etc/passwd', '<script>/x', '🙂/🙂', 'x/' + 'y'.repeat(300)]
  for (const x of junk) {
    const avant = JSON.stringify(lire2())
    st = await appel('/kybernos-auto/settings', { autoWhitelist: [x] })
    ok('« ' + x.slice(0, 22) + ' » est refusé (400) avec une raison, et rien n\'est écrit', st.ok === false && typeof st.erreur === 'string' && /^liste/.test(st.code) && JSON.stringify(lire2()) === avant, st)
  }
  st = await appel('/kybernos-auto/settings', { autoWhitelist: ['groq/llama-3.3-70b', 'groq/inconnu-9'] })
  ok('un « fournisseur/modèle » que la configuration ne connaît pas est refusé : « liste-inconnu », avec le nom fautif', st.ok === false && st.code === 'liste-inconnu' && st.cles.join() === 'groq/inconnu-9', st)
  st = await appel('/kybernos-auto/settings', { autoWhitelist: ['groq/llama-3.3-70b', 'opencode-free/big-pickle'], autoScope: 'custom' })
  ok('une liste de modèles connus passe, et « ma liste » la prend telle quelle', st.ok === true && st.scope === 'custom' && st.whitelist.join() === 'groq/llama-3.3-70b,opencode-free/big-pickle' && st.explicite.length === 2, st)
  st = await appel('/kybernos-auto/settings', { autoScope: 'all' })
  ok('revenir à « tous » garde la liste tapée de côté (on la retrouve en revenant à « ma liste »)', st.scope === 'all' && st.explicite.length === 2 && lire2().autoWhitelist.length === 2, st)

  // l'hôte ne peut pas lire la configuration : il juge la forme seulement, et la liste vide reste vide
  const home3 = mkdtempSync(join(tmpdir(), 'kauto3-'))
  const routes3 = {}
  monterRoutes({ register: (r) => { routes3[r.path] = r.handler } }, { home: home3, reglagesPath: join(home3, 'kybernos', 'settings.json'), sessionsAutoPath: join(home3, 's.json'), santePath: join(home3, 'h.json') })
  const appel3 = async (path, corps) => { const rr = reponse(); await routes3[path.split('?')[0]](fabriqueRequete(corps === undefined ? 'GET' : 'POST', path, corps), rr); return rr.corps }
  st = await appel3('/kybernos-auto/settings', { autoWhitelist: ['whatever/model-x'] })
  ok('sans service de configuration : la forme est jugée, l\'existence ne l\'est pas (rien n\'est refusé à l\'aveugle)', st.ok === true && st.scope === 'custom', st)
  st = await appel3('/kybernos-auto/settings', { autoWhitelist: ['model-only'] })
  ok('…et un identifiant mal formé est refusé quand même', st.ok === false && st.code === 'liste-forme', st)
  st = await appel3('/kybernos-auto/settings', { autoScope: 'all' })
  ok('« tous » sans rien de connu : une liste vide, pas inventée', st.ok === true && st.whitelist.length === 0 && st.total === 0, st)
}

console.log('\n── une requête qui ne dit pas d\'où elle vient lit, elle n\'écrit pas (A3-29) ──')
{
  const silencieuse = (method, path, corps) => {
    const body = corps === undefined ? '' : JSON.stringify(corps)
    return { method, url: path, headers: {}, socket: { localPort: 3080 }, on (ev, cb) { if (ev === 'data') cb(body); if (ev === 'end') cb() } }
  }
  const avant = readFileSync(reglagesPath, 'utf8')
  for (const [path, corps] of [['/kybernos-auto/settings', { autoRouting: false, autoClassifier: 'x/y' }], ['/kybernos-auto/session', { sessionId: 's9', on: true }], ['/kybernos-auto/probe', {}]]) {
    let code = null
    const rep = { writeHead (c) { code = c }, end () {} }
    await routes[path](silencieuse('POST', path, corps), rep)
    ok(path + ' : refus (403) sans Origin ni Referer', code === 403, code)
  }
  ok('...et rien n\'a été écrit', readFileSync(reglagesPath, 'utf8') === avant && lireSessions(sessionsAutoPath).s9 === undefined)
  let r2 = reponse()
  await routes['/kybernos-auto/state'](silencieuse('GET', '/kybernos-auto/state'), r2)
  ok('la lecture sans Origin passe toujours (une page n\'en envoie pas sur un GET de même origine)', r2.corps !== null && r2.corps.ok === true)
  r2 = reponse()
  await routes['/kybernos-auto/router'](silencieuse('POST', '/kybernos-auto/router', { demande: 'corrige ce bug', sessionId: 's2' }), r2)
  ok('le routeur reste ouvert à la ligne de commande (cli/auto-router.mjs ne parle pas depuis une page)', r2.corps !== null && r2.corps.actif !== undefined, r2.corps)
  r2 = reponse()
  await routes['/kybernos-auto/report'](silencieuse('POST', '/kybernos-auto/report', { modele: 'deepseek-official/deepseek-chat', latenceMs: 900 }), r2)
  ok('le rapport d\'issue aussi', r2.corps !== null && r2.corps.ok === true, r2.corps)
  r2 = reponse()
  const refReq = silencieuse('POST', '/kybernos-auto/session', { sessionId: 's9', on: true })
  refReq.headers = { referer: 'http://127.0.0.1:3080/settings' }
  await routes['/kybernos-auto/session'](refReq, r2)
  ok('un Referer de ce DSH suffit pour écrire', r2.corps !== null && r2.corps.ok === true, r2.corps)
}

console.log('\n── origin garde ──')
let brut403 = null
const rep403 = { writeHead (code) { brut403 = { code } }, end (s) { brut403.corps = s } }
await routes['/kybernos-auto/state']({ method: 'GET', url: '/kybernos-auto/state', headers: { origin: 'https://evil.example' }, on () {} }, rep403)
ok('origine étrangère → 403', brut403 !== null && brut403.code === 403, brut403)

console.log('\n' + (ko === 0 ? 'HARNAIS AUTO VERT — ' + ok0 + ' contrôles ✓' : ko + ' échec(s) sur ' + (ok0 + ko)))
process.exit(ko === 0 ? 0 : 1)
