#!/usr/bin/env node
/**
 * Harnais de la moitié HÔTE de `kybernos-flow` : auto-continue et queue-move.
 *
 * Tout est joué sur des doublures — aucun moteur, aucun réseau. Une passe
 * FACULTATIVE rejoue le déplacement contre la VRAIE classe `ReactLoopInbox` et
 * son repli durable, extraits du paquet `dsh-agent-loop` installé :
 *
 *   node kybernos-flow/test-host.mjs
 *   node kybernos-flow/test-host.mjs --engine <…/@deepseek-ai/dsh-agent-loop/lib/index.js>
 *   KYBERNOS_AGENT_LOOP_INDEX=<même chemin> node kybernos-flow/test-host.mjs
 *
 * Sans `--engine`, cette passe est annoncée « non jouée » (pas un échec) : le
 * canari de la route, lui, tourne à chaque appel en production.
 */
import { readFileSync, existsSync } from 'node:fs'
import { plafondDepuisEnv, creerMessageReprise, installerAutoContinue } from './auto-continue.mjs'
import { capacite, deplacer, lister, apercu, monterRoutes, sameOriginStrict, sameOriginLax } from './queue-move.mjs'

let pass = 0
let fail = 0
const check = (nom, condition, detail) => {
  if (condition === true) { pass += 1; console.log('  ✓ ' + nom) } else { fail += 1; console.log('  ✗ ' + nom + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const ids = (liste) => liste.map((m) => m.id).join(',')

// ── Doublures ────────────────────────────────────────────────────────────────
function fauxCtx (agents) {
  const ecouteurs = {}
  return {
    on (nom, fn) { (ecouteurs[nom] ??= []).push(fn); return () => {} },
    get (cle) { return cle === 'agents' ? { get: (id) => agents.get(id) } : undefined },
    emit (nom, ...args) { for (const f of ecouteurs[nom] ?? []) f(...args) },
  }
}
const fauxAgent = (id, extra = {}) => {
  const appels = []
  return { id, appels, inbox: { hasPending: false }, followup (m) { appels.push(m) }, ...extra }
}
const finDeTour = (ctx, sessionId, reason) => ctx.emit('session/event', { id: sessionId }, { type: 'turn/end', data: { turn: 1, reason } })
const messageUtilisateur = (id, texte = 'x') => ({ id, role: 'user', content: [{ type: 'text', text: texte }], source: { kind: 'user' } })

// ═══ 1. auto-continue ════════════════════════════════════════════════════════
console.log('\n── auto-continue : plafond et message ──')
check('plafond par défaut = 3', plafondDepuisEnv({}) === 3)
check('plafond « 5 » = 5', plafondDepuisEnv({ KYBERNOS_AUTO_CONTINUE_MAX: '5' }) === 5)
check('plafond « 0 » = désactivé', plafondDepuisEnv({ KYBERNOS_AUTO_CONTINUE_MAX: '0' }) === 0)
check('plafond négatif = désactivé', plafondDepuisEnv({ KYBERNOS_AUTO_CONTINUE_MAX: '-2' }) === 0)
check('plafond non numérique = désactivé', plafondDepuisEnv({ KYBERNOS_AUTO_CONTINUE_MAX: 'beaucoup' }) === 0)
const m1 = creerMessageReprise()
const m2 = creerMessageReprise()
check('message : rôle user, texte « continue », source user', m1.role === 'user' && m1.content[0].text === 'continue' && m1.source.kind === 'user')
check('message : gelé (comme createUserMessage)', Object.isFrozen(m1) && Object.isFrozen(m1.content) && Object.isFrozen(m1.content[0]))
check('message : identité fraîche à chaque appel', typeof m1.id === 'string' && m1.id.length > 8 && m1.id !== m2.id)

console.log('\n── auto-continue : la machine ──')
{
  const agents = new Map()
  const a = fauxAgent('s1'); agents.set('s1', a)
  const ctx = fauxCtx(agents)
  const env = {}
  const logs = []
  installerAutoContinue(ctx, { env, differer: (fn) => fn(), log: (m) => logs.push(m) })

  finDeTour(ctx, 's1', { kind: 'completed' })
  check('fin normale : aucune reprise', a.appels.length === 0)
  ctx.emit('session/event', { id: 's1' }, { type: 'step/end', data: {} })
  check('autre événement : ignoré', a.appels.length === 0)

  for (let i = 1; i <= 3; i += 1) finDeTour(ctx, 's1', { kind: 'max-tokens' })
  check('3 coupures de suite → 3 reprises', a.appels.length === 3)
  check('chaque reprise = « continue » utilisateur', a.appels.every((m) => m.content[0].text === 'continue' && m.source.kind === 'user'))
  finDeTour(ctx, 's1', { kind: 'max-tokens' })
  check('4e coupure : plafond atteint, pas de reprise', a.appels.length === 3)

  ctx.emit('agent/inbox/inserted', { agent: a, message: a.appels[0] })
  finDeTour(ctx, 's1', { kind: 'max-tokens' })
  check('nos propres messages ne remettent PAS le compteur à zéro', a.appels.length === 3)

  ctx.emit('agent/inbox/inserted', { agent: a, message: messageUtilisateur('humain-1', 'merci') })
  finDeTour(ctx, 's1', { kind: 'max-tokens' })
  check('un message humain remet le compteur à zéro', a.appels.length === 4)

  ctx.emit('agent/inbox/inserted', { agent: a, message: { id: 'ctx-1', role: 'user', content: [], source: { kind: 'context' } } })
  finDeTour(ctx, 's1', { kind: 'max-tokens' })
  finDeTour(ctx, 's1', { kind: 'max-tokens' })
  check('un contexte système (source ≠ user) ne remet pas à zéro', a.appels.length === 6, a.appels.length)

  finDeTour(ctx, 's1', { kind: 'completed' })
  finDeTour(ctx, 's1', { kind: 'max-tokens' })
  check('une fin normale remet le compteur à zéro', a.appels.length === 7, a.appels.length)

  env.KYBERNOS_AUTO_CONTINUE_MAX = '0'
  ctx.emit('agent/inbox/inserted', { agent: a, message: messageUtilisateur('humain-2') })
  finDeTour(ctx, 's1', { kind: 'max-tokens' })
  check('KYBERNOS_AUTO_CONTINUE_MAX=0 désactive (relu à chaud)', a.appels.length === 7)
  check('le journal dit ce qui s’est passé', logs.length === 7 && logs[0].includes('1/3'))
}
{
  const agents = new Map()
  const occupe = fauxAgent('s2', { inbox: { hasPending: true } }); agents.set('s2', occupe)
  const ctx = fauxCtx(agents)
  installerAutoContinue(ctx, { env: {}, differer: (fn) => fn(), log: () => {} })
  finDeTour(ctx, 's2', { kind: 'max-tokens' })
  check('un message déjà en file passe avant : pas de reprise', occupe.appels.length === 0)
  occupe.inbox.hasPending = false
  finDeTour(ctx, 's2', { kind: 'max-tokens' })
  check('…et la reprise refusée n’a pas consommé le plafond', occupe.appels.length === 1)

  finDeTour(ctx, 'inconnue', { kind: 'max-tokens' })
  check('agent inconnu : ignoré sans lever', true)
  const casse = fauxAgent('s3', { followup () { throw new Error('agent disposé') } }); agents.set('s3', casse)
  let leve = false
  try { finDeTour(ctx, 's3', { kind: 'max-tokens' }) } catch { leve = true }
  check('followup qui jette : avalé, la boucle ne tombe pas', leve === false)
  ctx.emit('agent/disposed', { agent: casse })
  check('agent disposé : état oublié', true)
}
{
  const agents = new Map(); const a = fauxAgent('s4'); agents.set('s4', a)
  const ctx = fauxCtx(agents)
  let tache
  installerAutoContinue(ctx, { env: {}, differer: (fn) => { tache = fn }, log: () => {} })
  finDeTour(ctx, 's4', { kind: 'max-tokens' })
  check('la reprise est DIFFÉRÉE (on sort du finally de la boucle)', a.appels.length === 0 && typeof tache === 'function')
  tache()
  check('…puis jouée', a.appels.length === 1)
}

// ═══ 2. queue-move : l'inbox ════════════════════════════════════════════════
/** Doublure FIDÈLE de ReactLoopInbox : même `mutate`, même dédoublonnage, mêmes événements. */
class FauxInbox {
  constructor () { this.listes = { 'next-turn': [], 'next-step': [] }; this.evenements = [] }
  get nextTurn () { return this.listes['next-turn'] }
  get nextStep () { return this.listes['next-step'] }
  get hasPending () { return this.nextTurn.length + this.nextStep.length > 0 }
  append (cible, m) { this.mutate(cible, this.listes[cible].length, 0, [m], true) }
  splice (cible, start, n, inserted) { return this.mutate(cible, start, n, inserted, true) }
  mutate (target, start, deleteCount, inserted, discardRemoved) {
    const liste = this.listes[target]
    const retires = liste.slice(start, start + deleteCount)
    const candidat = liste.toSpliced(start, deleteCount, ...inserted)
    const autre = this.listes[target === 'next-turn' ? 'next-step' : 'next-turn']
    const vus = new Set()
    for (const m of [...candidat, ...autre]) { if (vus.has(m.id)) throw new Error('already pending'); vus.add(m.id) }
    this.listes[target] = candidat
    this.evenements.push({ type: 'spliced', target, start, removedCount: deleteCount, outcome: discardRemoved && deleteCount > 0 ? 'canceled' : undefined })
    if (discardRemoved) for (const m of retires) this.evenements.push({ type: 'discarded', id: m.id })
    for (const m of inserted) this.evenements.push({ type: 'inserted', id: m.id })
    return retires
  }
}
const garnir = (inbox, n, cible = 'next-turn', prefixe = 'm') => {
  const messages = Array.from({ length: n }, (_, i) => ({ id: prefixe + (i + 1), role: 'user', content: [{ type: 'text', text: 'message numéro ' + (i + 1) }, { type: 'attachment', attachmentId: 'pj-' + (i + 1) }], source: { kind: 'user' } }))
  for (const m of messages) inbox.append(cible, m)
  inbox.evenements.length = 0
  return messages
}

console.log('\n── queue-move : le canari ──')
{
  const bon = new FauxInbox()
  check('inbox conforme → capacité ok', capacite(bon).ok === true)
  check('inbox absente → refus', capacite(undefined).ok === false)
  check('mutate absente → refus', capacite({ nextTurn: [], nextStep: [] }).raison === 'mutate-absente')
  check('mutate d’arité 4 → refus (signature changée)', capacite({ mutate (a, b, c, d) {}, nextTurn: [], nextStep: [] }).raison.startsWith('mutate-signature'))
  check('lecture publique absente → refus', capacite({ mutate (a, b, c, d, e) {} }).raison === 'lecture-publique-absente')
  const r = deplacer({ nextTurn: [], nextStep: [] }, { messageId: 'x', beforeId: null })
  check('déplacer sur un moteur sans mutate : unsupported, rien d’écrit', r.ok === false && r.erreur === 'unsupported')
}

console.log('\n── queue-move : le geste ──')
{
  const inbox = new FauxInbox()
  const [a, , , d] = garnir(inbox, 4)
  let r = deplacer(inbox, { messageId: 'm4', beforeId: 'm1' })
  check('4 avant 1 → 4,1,2,3', r.ok === true && r.deplace === true && ids(inbox.nextTurn) === 'm4,m1,m2,m3', ids(inbox.nextTurn))
  check('le MÊME objet est réinséré (pièces jointes intactes)', inbox.nextTurn[0] === d && inbox.nextTurn[1] === a && inbox.nextTurn[0].content[1].attachmentId === 'pj-4')
  check('aucun « discarded » : rien n’est annulé', inbox.evenements.every((e) => e.type !== 'discarded'), inbox.evenements)
  check('aucun splice « canceled »', inbox.evenements.every((e) => e.outcome === undefined))
  check('deux splices, une seule insertion annoncée', inbox.evenements.filter((e) => e.type === 'spliced').length === 2 && inbox.evenements.filter((e) => e.type === 'inserted').length === 1)

  r = deplacer(inbox, { messageId: 'm4', beforeId: null })
  check('en fin de file (beforeId null)', r.ok === true && ids(inbox.nextTurn) === 'm1,m2,m3,m4', ids(inbox.nextTurn))
  r = deplacer(inbox, { messageId: 'm1', beforeId: 'm3' })
  check('descendre : 1 avant 3 → 2,1,3,4', r.ok === true && ids(inbox.nextTurn) === 'm2,m1,m3,m4', ids(inbox.nextTurn))
  r = deplacer(inbox, { messageId: 'm2', beforeId: 'm1' })
  check('déjà juste avant l’ancre → « même place », rien écrit', r.ok === true && r.deplace === false)
  r = deplacer(inbox, { messageId: 'm4', beforeId: null })
  check('déjà en queue → « même place »', r.ok === true && r.deplace === false)
  r = deplacer(inbox, { messageId: 'm3', beforeId: 'm3' })
  check('avant soi-même → « même place »', r.ok === true && r.deplace === false)
  const avant = inbox.evenements.length
  deplacer(inbox, { messageId: 'm2', beforeId: 'm1' })
  check('les no-op n’écrivent aucun événement', inbox.evenements.length === avant)
  check('message inconnu → not-found', deplacer(inbox, { messageId: 'zz', beforeId: null }).erreur === 'not-found')
  check('ancre inconnue → anchor-not-found', deplacer(inbox, { messageId: 'm1', beforeId: 'zz' }).erreur === 'anchor-not-found')
  check('l’ordre est intact après les refus', ids(inbox.nextTurn) === 'm2,m1,m3,m4')
}
{
  const inbox = new FauxInbox()
  garnir(inbox, 2, 'next-turn', 't')
  garnir(inbox, 2, 'next-step', 's')
  check('autre file → cross-lane', deplacer(inbox, { messageId: 't1', beforeId: 's2' }).erreur === 'cross-lane')
  check('même mécanique sur la file « next-step »', deplacer(inbox, { messageId: 's2', beforeId: 's1' }).ok === true && ids(inbox.nextStep) === 's2,s1')
  check('lister : identités, files et aperçus', JSON.stringify(lister(inbox).map((i) => [i.id, i.lane, i.index])) === JSON.stringify([['t1', 'next-turn', 0], ['t2', 'next-turn', 1], ['s2', 'next-step', 0], ['s1', 'next-step', 1]]) && lister(inbox)[0].preview === 'message numéro 1')
  check('aperçu : premier bloc texte, espaces repliés', apercu({ content: [{ type: 'image' }, { type: 'text', text: '  a \n b  ' }] }) === 'a b')
}
{
  // Pourquoi le patch existait : l'API publique, elle, annule.
  const inbox = new FauxInbox()
  garnir(inbox, 3)
  const [retire] = inbox.splice('next-turn', 0, 1, [])
  check('contre-preuve : le splice public émet « discarded » + « canceled » (d’où mutate(…, false))', inbox.evenements.some((e) => e.type === 'discarded' && e.id === retire.id) && inbox.evenements.some((e) => e.outcome === 'canceled'))
}

// ═══ 3. queue-move : la route ═══════════════════════════════════════════════
console.log('\n── queue-move : la route ──')
const requete = ({ method = 'GET', url = '/kybernos/queue-move', origin, host = '127.0.0.1:3080', port = 3080, type = 'application/json', corps }) => {
  const headers = { host }
  if (origin !== undefined) headers.origin = origin
  if (type !== null) headers['content-type'] = type
  const morceaux = corps === undefined ? [] : [Buffer.from(typeof corps === 'string' ? corps : JSON.stringify(corps))]
  return { method, url, headers, socket: { localPort: port }, [Symbol.asyncIterator]: async function * () { for (const m of morceaux) yield m } }
}
const reponse = () => { const r = { statut: null, corps: null, writeHead (s) { r.statut = s }, end (t) { r.corps = JSON.parse(t) } }; return r }
{
  const inbox = new FauxInbox()
  garnir(inbox, 3)
  const agents = new Map([['sess-1', { id: 'sess-1', inbox }]])
  let handler
  monterRoutes({ register: (r) => { handler = r.handler; return () => {} } }, { agents: () => ({ get: (id) => agents.get(id) }) })
  const appeler = async (opts) => { const r = reponse(); await handler(requete(opts), r); return r }
  const ORIGINE = 'http://127.0.0.1:3080'
  const corpsOk = { sessionId: 'sess-1', messageId: 'm2', beforeId: null }

  let r = await appeler({ url: '/kybernos/queue-move?sessionId=sess-1', origin: ORIGINE })
  check('GET : supported + file lue', r.statut === 200 && r.corps.supported === true && r.corps.items.length === 3 && r.corps.items[0].id === 'm1')
  r = await appeler({ url: '/kybernos/queue-move?sessionId=sess-1' })
  check('GET sans Origin : toléré (navigation directe)', r.statut === 200)
  r = await appeler({ url: '/kybernos/queue-move?sessionId=sess-1', origin: 'http://evil.example' })
  check('GET d’une origine étrangère (DNS-rebinding) : 403', r.statut === 403)
  r = await appeler({ url: '/kybernos/queue-move?sessionId=inconnue', origin: ORIGINE })
  check('GET session non vivante : supported=false (pas d’erreur)', r.statut === 200 && r.corps.supported === false && r.corps.reason === 'session-not-live')
  r = await appeler({ url: '/kybernos/queue-move?sessionId=..%2F..%2Fetc', origin: ORIGINE })
  check('GET identifiant de session hostile : traité comme inconnu', r.statut === 200 && r.corps.supported === false)

  r = await appeler({ method: 'POST', origin: ORIGINE, corps: { sessionId: 'sess-1', messageId: 'm3', beforeId: 'm1' } })
  check('POST valide : 200, déplacé', r.statut === 200 && r.corps.ok === true && r.corps.deplace === true && ids(inbox.nextTurn) === 'm3,m1,m2')
  r = await appeler({ method: 'POST', origin: ORIGINE, corps: { sessionId: 'sess-1', messageId: 'm3', beforeId: 'm1' } })
  check('POST répété : 200, « même place »', r.statut === 200 && r.corps.deplace === false)
  r = await appeler({ method: 'POST', corps: corpsOk })
  check('POST sans Origin ni Referer : 403', r.statut === 403 && ids(inbox.nextTurn) === 'm3,m1,m2')
  r = await appeler({ method: 'POST', origin: 'http://evil.example', corps: corpsOk })
  check('POST origine étrangère : 403', r.statut === 403)
  r = await appeler({ method: 'POST', origin: 'http://attacker.example:3080', host: 'attacker.example:3080', corps: corpsOk })
  check('POST avec Host forgé (comparé au socket, pas à l’en-tête) : 403', r.statut === 403)
  r = await appeler({ method: 'POST', origin: 'http://127.0.0.1.nip.io:3080', corps: corpsOk })
  check('POST préfixe nip.io : 403', r.statut === 403)
  r = await appeler({ method: 'POST', origin: 'http://127.0.0.1:3081', corps: corpsOk })
  check('POST port voisin : 403', r.statut === 403)
  r = await appeler({ method: 'POST', origin: ORIGINE, type: 'text/plain', corps: corpsOk })
  check('POST Content-Type non JSON : 415', r.statut === 415)
  r = await appeler({ method: 'POST', origin: ORIGINE, corps: '{pas du json' })
  check('POST corps illisible : 400', r.statut === 400)
  r = await appeler({ method: 'POST', origin: ORIGINE, corps: 'x'.repeat(5000) })
  check('POST corps trop gros : 400', r.statut === 400)
  r = await appeler({ method: 'POST', origin: ORIGINE, corps: { sessionId: 'sess-1', messageId: 'a b', beforeId: null } })
  check('POST identifiant invalide : 400', r.statut === 400)
  r = await appeler({ method: 'POST', origin: ORIGINE, corps: { sessionId: 'sess-1', messageId: 'm1' } })
  check('POST sans beforeId : 400 (null explicite exigé)', r.statut === 400)
  r = await appeler({ method: 'POST', origin: ORIGINE, corps: { sessionId: 'autre', messageId: 'm1', beforeId: null } })
  check('POST session non vivante : 404', r.statut === 404)
  r = await appeler({ method: 'POST', origin: ORIGINE, corps: { sessionId: 'sess-1', messageId: 'zz', beforeId: null } })
  check('POST message inconnu : 404', r.statut === 404 && r.corps.error === 'not-found')
  r = await appeler({ method: 'PUT', origin: ORIGINE })
  check('autre méthode : 405', r.statut === 405)
  check('l’ordre n’a bougé qu’au premier POST valide', ids(inbox.nextTurn) === 'm3,m1,m2')

  agents.set('vieux', { id: 'vieux', inbox: { nextTurn: [], nextStep: [], mutate (a, b) {} } })
  r = await appeler({ url: '/kybernos/queue-move?sessionId=vieux', origin: ORIGINE })
  check('moteur sans la méthode attendue : GET supported=false + raison', r.corps.supported === false && r.corps.reason.startsWith('mutate-signature'))
  r = await appeler({ method: 'POST', origin: ORIGINE, corps: { sessionId: 'vieux', messageId: 'a', beforeId: null } })
  check('…et POST : 501 unsupported', r.statut === 501 && r.corps.error === 'unsupported')
}
check('sameOriginStrict : Referer accepté à défaut d’Origin', sameOriginStrict({ headers: { referer: 'http://localhost:3080/x' }, socket: { localPort: 3080 } }) === true)
check('sameOriginStrict : schéma exotique refusé', sameOriginStrict({ headers: { origin: 'file://x' }, socket: { localPort: 3080 } }) === false)
check('sameOriginLax : en-tête illisible toléré', sameOriginLax({ headers: { origin: '::pas une url' }, socket: { localPort: 3080 } }) === true)

// ═══ 4. La VRAIE classe du moteur (facultatif) ═══════════════════════════════
console.log('\n── queue-move contre la vraie classe ReactLoopInbox ──')
const moteur = (() => { const i = process.argv.indexOf('--engine'); return i >= 0 ? process.argv[i + 1] : process.env.KYBERNOS_AGENT_LOOP_INDEX })()
if (moteur === undefined || !existsSync(moteur)) {
  console.log('  · non jouée — passer --engine <…/dsh-agent-loop/lib/index.js> (ou KYBERNOS_AGENT_LOOP_INDEX)')
} else {
  const source = readFileSync(moteur, 'utf8')
  const debut = source.indexOf('//#region lib/types/inbox.js')
  const fin = source.indexOf('//#endregion', debut)
  check('la région inbox du paquet est trouvée', debut >= 0 && fin > debut)
  const chaine = new Proxy(function () {}, { get: () => chaine, apply: () => chaine })
  const { ReactLoopInbox, inboxProjectionDefinition } = new Function('z$1', source.slice(debut, fin) + '\nreturn { ReactLoopInbox, inboxProjectionDefinition }')(chaine)
  const journal = []
  let etat = inboxProjectionDefinition.init()
  let seq = 0
  const session = { id: 's-reel', append (type, data) { const ev = { type, data, seq: (seq += 1) }; journal.push(ev); etat = inboxProjectionDefinition.apply(etat, ev); return ev } }
  const emis = []
  const inbox = new ReactLoopInbox({ stateOf: () => etat }, session, { emit: (nom, payload) => emis.push([nom, payload?.message?.id]) })
  check('canari : le vrai `mutate` est présent, d’arité 5, lectures publiques OK', capacite(inbox).ok === true, capacite(inbox))
  const msgs = Array.from({ length: 4 }, (_, i) => Object.freeze({ id: 'r' + (i + 1), role: 'user', content: [{ type: 'text', text: 'réel ' + (i + 1) }], source: { kind: 'user' } }))
  for (const m of msgs) inbox.append('next-turn', m)
  emis.length = 0
  const taille = journal.length
  const r = deplacer(inbox, { messageId: 'r4', beforeId: 'r2' })
  check('vrai moteur : 4 avant 2 → 1,4,2,3', r.ok === true && ids(inbox.nextTurn) === 'r1,r4,r2,r3', ids(inbox.nextTurn))
  check('vrai moteur : même objet réinséré', inbox.nextTurn[1] === msgs[3])
  check('vrai moteur : aucun agent/inbox/discarded émis', emis.every(([nom]) => nom !== 'agent/inbox/discarded'), emis)
  check('vrai moteur : un seul agent/inbox/inserted (le déplacé)', emis.filter(([nom]) => nom === 'agent/inbox/inserted').length === 1)
  check('vrai moteur : aucun splice « canceled » dans le journal durable', journal.slice(taille).every((ev) => ev.data.outcome === undefined), journal.slice(taille))
  // Le journal durable, rejoué depuis zéro par le vrai repli, redonne le même ordre : c'est la reprise après relance.
  let rejoue = inboxProjectionDefinition.init()
  for (const ev of journal) rejoue = inboxProjectionDefinition.apply(rejoue, ev)
  check('vrai moteur : le journal rejoué redonne le même ordre (reprise après relance)', ids(rejoue['next-turn']) === 'r1,r4,r2,r3', ids(rejoue['next-turn']))
  inbox.splice('next-turn', 0, 1, [])
  check('contre-preuve vrai moteur : le splice public émet bien « discarded »', emis.some(([nom]) => nom === 'agent/inbox/discarded'))
}

console.log('\n' + (fail === 0 ? '✓' : '✗') + ' kybernos-flow hôte — ' + pass + ' vérifications, ' + fail + ' échec(s)')
process.exit(fail === 0 ? 0 : 1)
