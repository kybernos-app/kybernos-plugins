#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// session-titre — nomme une session DSH depuis la ligne de commande.
//
// DEUX CHOSES SÉPARÉES, depuis le 2026-09-22 :
//   • le TITRE ne porte plus AUCUN emoji (règle utilisateur) ;
//   • la CATÉGORIE (fonctionnalité, correctif, ui, doc…) part dans le registre
//     du plugin kybernos-sessions (~/.dsh/kybernos/categories.json, écrit par
//     la route POST /kybernos-sessions/categories), et c'est elle que la liste
//     des chats rend en icône SVG — variée, sans emoji dans le texte.
//
// POURQUOI CE DÉTOUR PAR LA GUI : il n'existe pas de route HTTP publique pour
// renommer une session depuis l'extérieur (le serveur est protégé par le jeton
// et la barrière d'origine). Mais la page ouverte SAIT le faire : elle appelle
//     POST /api/session/rename  { method: "session/rename",
//       payload: { args: { request: { sessionId, title } } } }
// Deux chemins, donc :
//   • --match "<bout de titre>"  : on clique « Rename » sur la ligne voulue et
//     on valide — c'est le chemin sûr, sans identifiant à chercher ;
//   • --id / --current           : on rejoue l'appel directement dans la page.
// L'identifiant de session est lu sur la ligne (`data-row-key="session:<id>"`),
// c'est la clé du registre de catégories.
//
// Usage
//   node scripts/session-titre.mjs --list
//   node scripts/session-titre.mjs "Refonte des pilules" --cat ui --match "Kybernos"
//   node scripts/session-titre.mjs "Refonte des pilules" --cat ui --current
//   node scripts/session-titre.mjs "Refonte des pilules" --cat ui --id session-xxxx
//   node scripts/session-titre.mjs "Recap final du chantier" --cat ui --recap --current
//   Options : --dry · --verbeux · --cdp <url> · --host <127.0.0.1:3080>
//
// `--recap` est le nommage de FIN de chantier : il est refusé si le réglage
// « Rename Chat session after each recap » est à NON (~/.dsh/kybernos/settings.json).
// Le nommage INITIAL (sans --recap) n'est jamais bloqué par ce réglage.
//
// Sortie : SILENCIEUSE quand tout va bien (l'utilisateur n'a pas à lire
// « j'ai renommé la session »). `--verbeux` rend le détail, les erreurs vont sur
// stderr avec un code de sortie non nul.
//
// Catégories : fonctionnalite · correctif · ui · doc · integration · donnees ·
//              nettoyage · question   (l'ancien emoji est accepté comme alias)
// ═══════════════════════════════════════════════════════════════════════════

import { CATEGORIES, ALIAS, slugDe, emojiDansTitre, normaliserTitre, decouperArgs, recapAutorise, verdictCategorie } from './titre-session.mjs'

const args = process.argv.slice(2)
const VALEURS = ['match', 'id', 'cdp', 'host', 'cat']
const option = (nom, defaut) => {
  const i = args.indexOf('--' + nom)
  return i >= 0 && args[i + 1] !== undefined && args[i + 1].startsWith('--') === false ? args[i + 1] : defaut
}
const drapeau = (nom) => args.includes('--' + nom)
const positionnels = decouperArgs(args, VALEURS)
const titre = positionnels[0]

const CDP = option('cdp', process.env.KB_CDP || 'http://127.0.0.1:9333')
const HOTE = option('host', '127.0.0.1:3080')
const MATCH = option('match', null)
const ID = option('id', null)
const CAT = option('cat', null)
const VERBEUX = drapeau('verbeux')
// La session DE CET AGENT, telle que DSH la donne à son shell. Elle sert de
// garde-fou : `--current` est une notion de NAVIGATEUR (localStorage
// « dsh.sessions.current »), pas d'agent. Le 22/09 à 16:13, une session qui
// travaillait sur les « Pins » a appelé `--current` alors que la page ouverte
// était CELLE-CI : elle a renommé ce chat-là. Un titre faux écrit en silence
// coûte plus cher qu'un refus.
const MOI = String(process.env.DSH_SESSION_ID || '')

const mourir = (msg) => { console.error('✗ ' + msg); process.exit(1) }
const dire = (msg) => { if (VERBEUX) console.log('· ' + msg) }

// ── Gardes AVANT toute connexion ─────────────────────────────────────────
// Un refus ne doit pas dépendre d'un navigateur ouvert : « titre manquant » ou
// « catégorie inconnue » se disent sans toucher au CDP. Le portillon de fin de
// chantier non plus (il lit un fichier de réglages).
let SLUG = null
if (drapeau('list') === false) {
if (titre === undefined) mourir('titre manquant. Exemple : session-titre.mjs "Refonte des pilules" --cat ui --match "bout de titre"')
if (emojiDansTitre(titre)) {
  mourir('le titre ne doit plus porter d’emoji (ils sont devenus des icônes SVG, choisies par --cat).\n  Reçu : ' + titre + '\n  Attendu : "Refonte des pilules" --cat ui')
}
const categorie = verdictCategorie(CAT)
if (categorie.ok !== true) mourir(categorie.motif)
SLUG = categorie.slug
if (drapeau('recap') && recapAutorise() === false) {
  dire('re-titrage de fin de chantier désactivé (Kybernos Settings) — rien changé')
  process.exit(0)
}
}

// ── Connexion à la page de la GUI (celle du Chrome de debug) ───────────────
// Le Chrome de debug peut avoir plusieurs fenêtres de la GUI, dont certaines
// avec la barre latérale fermée : on prend celle qui REND le plus de lignes de
// session, pas la première venue.
// Le `.catch` doit envelopper le fetch LUI-MÊME : accroché après `.json()`, il
// ne voyait jamais le refus de connexion (fetch rejette avant), et l'outil
// sortait sur une pile d'exception au lieu de dire quoi faire.
const lireCibles = async () => {
  try {
    const r = await fetch(CDP + '/json/list')
    return await r.json()
  } catch (e) {
    const cause = e && e.cause && e.cause.code ? e.cause.code : String((e && e.message) || e)
    mourir('Chrome de debug injoignable sur ' + CDP + ' (' + cause + ').\n' +
      '  Ouvre la GUI dans le navigateur de debug, ou passe --cdp <url> (le Chrome de preuve : KB_CDP=http://127.0.0.1:9345).')
  }
}
const cibles = await lireCibles()
const pages = cibles.filter((t) => t.type === 'page' && new RegExp('^https?://' + HOTE.replace('.', '\\.') + '(/|\\?|$)').test(t.url) && t.webSocketDebuggerUrl)
if (pages.length === 0) mourir('aucune page ' + HOTE + ' ouverte — ouvre la GUI dans le navigateur de debug, ou passe --cdp')

const connecter = async (cible) => {
  const socket = new WebSocket(cible.webSocketDebuggerUrl)
  await new Promise((res, rej) => { socket.addEventListener('open', res); socket.addEventListener('error', () => rej(new Error('WebSocket refusé'))) }).catch((e) => mourir(e.message))
  let n = 0
  const attente = new Map()
  socket.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id !== undefined && attente.has(m.id)) { attente.get(m.id)(m); attente.delete(m.id) }
  })
  const evalc = async (expression) => {
    const r = await new Promise((res) => { const id = ++n; attente.set(id, res); socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })) })
    if (r.result && r.result.exceptionDetails) return undefined
    return r.result && r.result.result ? r.result.result.value : undefined
  }
  return { socket, evalc }
}

let page = pages[0]
let choix = await connecter(page)
if (pages.length > 1) {
  let meilleur = await choix.evalc(`document.querySelectorAll('[class*="sessionRow"]').length`)
  meilleur = typeof meilleur === 'number' ? meilleur : 0
  for (const cible of pages.slice(1)) {
    const essai = await connecter(cible)
    const n = await essai.evalc(`document.querySelectorAll('[class*="sessionRow"]').length`)
    if (typeof n === 'number' && n > meilleur) { choix.socket.close(); meilleur = n; page = cible; choix = essai } else essai.socket.close()
  }
}
const ws = choix.socket
const evaluer = choix.evalc
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Lecture de la liste ───────────────────────────────────────────────────
// Le titre ne porte plus d'emoji : la catégorie vient du registre, rendue en
// icône SVG (`aria-label` = « UI/design — travail non committé »). On lit donc
// la ligne en trois morceaux : le texte visible, la catégorie de l'icône, et
// l'identifiant de session (`data-row-key`), clé du registre.
const LISTE = `[...document.querySelectorAll('[class*="sessionRow"]')].map(r => {
  const t = r.querySelector('[class*="title"]')
  if (t === null) return null
  const ico = t.querySelector('.kbs-titre-ico')
  const porte = r.getAttribute('data-row-key') !== null ? r : r.closest('[data-row-key]')
  const cle = porte === null ? '' : String(porte.getAttribute('data-row-key') || '')
  const i = cle.indexOf('session:')
  return { titre: t.textContent || '', ico: ico === null ? null : ico.getAttribute('aria-label'), id: i === -1 ? '' : cle.slice(i + 8) }
}).filter(x => x !== null && x.titre !== '')`
const lignes = await evaluer(LISTE)
if (Array.isArray(lignes) === false || lignes.length === 0) mourir('aucune ligne de session rendue dans les ' + pages.length + ' fenêtre(s) ' + HOTE + ' — la barre latérale est fermée (bouton « Open sidebar »). Ouvre-la, ou vise une session précise avec --id.')
// Titre comparable : sans pictogramme résiduel ni espaces de tête (les titres
// déjà nommés avant cette règle en portent encore un).
const normaliser = normaliserTitre

if (drapeau('list') || args.length === 0) {
  console.log('Sessions visibles dans ' + HOTE + ' :')
  lignes.forEach((l, i) => console.log('  ' + i + '. ' + (l.ico === null ? '' : '[' + l.ico + '] ') + l.titre.trim() + (l.id === '' ? '' : '   ' + l.id)))
  const courant = await evaluer(`(() => { try { return JSON.parse(localStorage.getItem('dsh.sessions.current') || 'null') } catch (e) { return null } })()`)
  if (courant !== null) console.log('\nSession ouverte dans cette page : ' + courant.sessionId)
  ws.close()
  process.exit(0)
}

// Enregistre la catégorie dans le registre du plugin, par la route du host :
// la ligne de session s'habille alors du bon SVG, sans emoji dans le titre.
const enregistrerCat = async (sessionId) => {
  if (sessionId === undefined || sessionId === null || sessionId === '') {
    console.error('⚠ identifiant de session introuvable sur la ligne (data-row-key absent) — catégorie NON enregistrée : l’icône restera provisoire')
    return false
  }
  const corps = JSON.stringify({ session: sessionId, cat: SLUG, titre })
  const code = await evaluer(`(async () => {
    const r = await fetch('/kybernos-sessions/categories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(corps)} })
    return r.status
  })()`)
  if (String(code) !== '200') { console.error('⚠ registre de catégories : HTTP ' + code + ' — l’icône restera provisoire'); return false }
  dire(CATEGORIES[SLUG] + ' → registre (' + sessionId + ')')
  return true
}

const confirmer = async (sessionId, avant) => {
  const apres = await evaluer(LISTE)
  const gagne = Array.isArray(apres) && apres.some((l) => normaliser(l.titre) === normaliser(titre))
  if (gagne) { dire('« ' + String(avant).trim() + ' » → « ' + titre + ' »'); ws.close(); process.exit(0) }
  console.error('✗ renommage non constaté dans la liste pour « ' + titre + ' »')
  ws.close()
  process.exit(1)
}

// ── Chemin direct : on rejoue l'appel de la GUI ───────────────────────────
if (ID !== null || drapeau('current')) {
  let sessionId = ID
  if (sessionId === null) {
    const courant = await evaluer(`(() => { try { return JSON.parse(localStorage.getItem('dsh.sessions.current') || 'null') } catch (e) { return null } })()`)
    if (!courant || !courant.sessionId) mourir('session courante inconnue (localStorage dsh.sessions.current) — utilise --id ou --match')
    sessionId = courant.sessionId
    // La garde : « courante » veut dire « ouverte dans CE navigateur », pas
    // « la mienne ». Si DSH m'a donné l'identifiant de MA session et qu'il
    // diffère, c'est qu'on visait la page de quelqu'un d'autre — on refuse.
    if (MOI !== '' && sessionId !== MOI) {
      mourir('--current désigne ' + sessionId + ', qui n’est PAS la session de cet agent (' + MOI + ').\n  « courante » est une notion de navigateur : la page ouverte peut être celle d’un autre chat.\n  Pour renommer la mienne : --id ' + MOI + '\n  Pour renommer une autre : --id ' + sessionId + ' (ou --match "<bout de titre>")')
    }
  } else if (MOI !== '' && sessionId !== MOI) {
    console.error('⚠ --id ' + sessionId + ' n’est pas la session de cet agent (' + MOI + ') — je renomme la session demandée')
  }
  if (drapeau('dry')) { console.log('· [dry] ' + sessionId + ' → « ' + titre + ' » [' + SLUG + ']'); ws.close(); process.exit(0) }
  await enregistrerCat(sessionId)
  const appel = JSON.stringify({ type: 'client-request', rpcId: (globalThis.crypto ? crypto.randomUUID() : String(Date.now())), method: 'session/rename', payload: { args: { request: { sessionId, title: titre } } } })
  const res = await evaluer(`(async () => {
    const r = await fetch('/api/session/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(appel)} })
    return r.status + ' ' + (await r.text()).slice(0, 200)
  })()`)
  if (String(res).startsWith('2') === false) mourir('appel direct refusé : ' + res)
  await attendre(600)
  await confirmer(sessionId, ID === null ? '(session ouverte)' : ID)
}

// ── Chemin GUI : clic « Rename » sur la ligne voulue ──────────────────────
if (MATCH === null) mourir('précise la session : --match "<bout de titre>" (ou --current / --id)')
const candidates = lignes.filter((l) => l.titre.includes(MATCH))
if (candidates.length === 0) mourir('aucune session dont le titre contient « ' + MATCH + ' »')
// Plusieurs LIGNES pour un même chat, c'est normal : la barre latérale affiche
// les épinglés ET la liste du dossier, donc le même titre apparaît deux fois.
// Ce qui ne l'est pas, c'est de viser DEUX sessions différentes : là, « je
// prends la première » écrivait un titre faux, en silence. On refuse.
const identifiants = []
for (const c of candidates) if (c.id !== '' && identifiants.indexOf(c.id) === -1) identifiants.push(c.id)
if (identifiants.length > 1) {
  console.error('✗ ' + identifiants.length + ' sessions DIFFÉRENTES contiennent « ' + MATCH + ' » :')
  candidates.forEach((c) => console.error('   · ' + c.titre.trim() + (c.id === '' ? '' : '   ' + c.id)))
  console.error('  Précise le bout de titre, ou passe --id <identifiant>. Refusé : un titre faux écrit en silence coûte plus cher qu’un refus.')
  ws.close()
  process.exit(1)
}
if (identifiants.length === 1 && MOI !== '' && identifiants[0] !== MOI) {
  console.error('✗ --match tombe sur ' + identifiants[0] + ', qui n’est PAS la session de cet agent (' + MOI + ') : « ' + String(candidates[0].titre).trim() + ' »')
  console.error('  Un fragment de titre se retrouve vite dans plusieurs chats (surtout après un renommage) : c’est ainsi que ce chat-ci a été renommé trois fois par un autre chantier le 22/09.')
  console.error('  Renomme la tienne avec --id ' + MOI + ', ou vise explicitement l’autre avec --id ' + identifiants[0] + '.')
  ws.close()
  process.exit(1)
}
if (candidates.length > 1 && identifiants.length === 1) {
  console.error('· ' + candidates.length + ' lignes pour le même chat (épinglé + liste) — même session, je continue')
}

const avant = candidates[0].titre
if (drapeau('dry')) { console.log('· [dry] « ' + avant.trim() + ' » → « ' + titre + ' » [' + SLUG + ']'); ws.close(); process.exit(0) }
const AVANT_NORM = normaliser(avant)

// 1. Ouvrir le menu d'actions de la ligne si besoin, puis cliquer « Rename ».
const ouvert = await evaluer(`(() => {
  const item = [...document.querySelectorAll('[class*="itemWrap"],[role="menuitem"]')].find(e => e.offsetParent !== null && (e.textContent||'').trim() === 'Rename')
  if (item === undefined) {
    const r = [...document.querySelectorAll('[class*="sessionRow"]')].find(x => {
      const t = x.querySelector('[class*="title"]')
      if (t === null) return false
      return String(t.textContent || '').replace(/^[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D\s]+/u, '').trim() === ${JSON.stringify(AVANT_NORM)}
    })
    if (r === undefined) return 'ligne perdue'
    r.querySelector('button[aria-label^="Session actions"]').click()
    return 'menu ouvert'
  }
  return 'menu déjà ouvert'
})()`)
if (ouvert === 'ligne perdue') mourir('la ligne a disparu entre la lecture et le clic')
await attendre(400)
const clic = await evaluer(`(() => {
  const item = [...document.querySelectorAll('[class*="itemWrap"],[role="menuitem"]')].find(e => e.offsetParent !== null && (e.textContent||'').trim() === 'Rename')
  if (item === undefined) return 'entrée Rename introuvable'
  ;(item.querySelector('button,[role="button"]') || item).click()
  return 'ok'
})()`)
if (clic !== 'ok') mourir(clic)
await attendre(500)

// 2. Écrire la nouvelle valeur (setter natif : React écoute `input`) puis Entrée.
const champ = `[...document.querySelectorAll('input')].find(e => e.offsetParent !== null && (/rename/i.test(e.className || '') || e.closest('[class*="sessionRow"]')))`
const ecrit = await evaluer(`(() => {
  const i = ${champ}
  if (i === undefined) return 'champ de renommage introuvable'
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(i, ${JSON.stringify(titre)})
  i.dispatchEvent(new Event('input', { bubbles: true }))
  i.focus()
  for (const t of ['keydown', 'keypress', 'keyup']) i.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
  return 'ok'
})()`)
if (ecrit !== 'ok') mourir(ecrit)
await attendre(900)

// 3. Enregistrer la catégorie (la ligne porte l'identifiant) puis vérifier.
await enregistrerCat(candidates[0].id)
await attendre(400)
await confirmer(candidates[0].id, avant)
