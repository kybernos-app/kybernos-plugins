#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// garde — le « hook agent » d'isolation.
//
//   node kybernos-sessions/garde.mjs [--nom <slug>] [--but "<phrase>"] [--isoler]
//
// À appeler AVANT LA PREMIÈRE ÉCRITURE DE FICHIER d'un chantier (règle dans
// ~/.dsh/AGENTS.md). Décision, puis action :
//   • dossier déjà un worktree             → exit 0 : déjà isolé, travaille ici ;
//   • hors git, non partagé                → exit 0 : rien à isoler ;
//   • hors git, PARTAGÉ                    → exit 0 : pas d'arbre possible,
//                                            mais AVERTIT (voir « ordre » plus bas) ;
//   • dossier non partagé                  → exit 0 : travaille en place ;
//   • partagé + un arbre libre du même nom → exit 2 : RÉUTILISE-le, rien créé ;
//   • partagé, sans arbre, sans --isoler   → exit 0 : travaille en place ;
//   • partagé + --isoler                   → exit 2 : arbre créé (ou réutilisé).
//
// RÉSERVATION D'UN FICHIER CHAUD — le point de collision que la garde de dossier
// ne peut PAS voir (elle mesure le partage d'un dossier sur 1 h, pas « ce
// fichier est en train d'être écrit ») :
//   node kybernos-sessions/garde.mjs --claim client.js    → exit 0 : réservé 180 s
//                                                         → exit 4 : déjà pris ailleurs
//   node kybernos-sessions/garde.mjs --release client.js  → exit 0 : libéré
// Sans cette réservation, « un seul écrivain par fichier chaud » restait un vœu.
//
// VEILLE DE PUBLICATION — le second étage, pour la révision INTERMÉDIAIRE :
//   node kybernos-sessions/garde.mjs --veille [--interval 1000] [--une-fois]
//
// Le code client d'un bundle local est servi À CHAUD depuis le disque : toute
// révision qui passe par le fichier est vue par les pages ouvertes. Une écriture
// en plusieurs passes (ou deux écrivains, ou une écriture interrompue) publie
// donc une révision QUI NE PARSE PAS, et l'entrée entière échoue au boot —
// « Failed to load plugins @local/kybernos ». Constaté le 23/09/2026.
//
// La veille garde une copie de la dernière révision VERTE de chaque fichier
// chaud (~/.dsh/kybernos/last-good/) et, dès qu'une révision ne parse plus,
// remet la verte en place dans la seconde. Elle ne juge pas l'intention : elle
// protège la GUI SERVIE. Le journal (~/.dsh/kybernos/veille-bundle.log) dit
// quelle révision a été remplacée ; l'écrivain, lui, doit relire son fichier
// (le garde-fou de version du système de fichiers le lui impose de toute façon).
//
// Le verdict « parse » est rendu par `--input-type=module`, PAS par
// `node --check <fichier>.js` : mesuré le 23/09/2026 sur Node 26.7.0, ce dernier
// rend 0 (`= {{{`, `= = 1`) sur un bundle client cassé. `--check` (sans veille)
// passe la même porte à la demande, pour ne pas livrer une révision illisible.
//
// POURQUOI « en place » par défaut : un worktree ne peut pas être rattaché au
// chat EN COURS — la session et la GUI servent le checkout principal
// (`<checkout>/plugins/…`). Créer un arbre à chaque écriture produisait des
// arbres morts : deux constatés le 21/09/2026, propres, à 0 commit d'avance, et
// un troisième déjà signalé « resté, redondant » la veille. L'arbre n'a de sens
// que pour un PROCHAIN chat ouvert dedans : il se réserve donc explicitement
// (--isoler), et il est marqué, réutilisé et ramassable (`reclaim`).
//
// Les quick talks (aucune écriture) n'appellent jamais la garde.
// ═══════════════════════════════════════════════════════════════════════════

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { etatGit, isoler, repartitionParDossier, slugsDeChemin, sondeIsolation } from './index.js'

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut
}
const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const chemin = process.cwd()
const sessionsHome = join(home, 'sessions')
// Le nom doit être STABLE pour le même chat, sinon la réutilisation ne peut pas
// reconnaître l'arbre réservé au tour précédent et en fabrique un second. Sans
// `DSH_SESSION_ID` (session non-DSH), on ne peut pas distinguer deux chats : on
// dérive du DOSSIER plutôt que de retomber sur une constante globale — l'ancien
// `s-chantier` faisait collisionner toutes les sessions sur le même arbre.
const sessionCourte = String(process.env.DSH_SESSION_ID || '').replace(/[^a-z0-9]/gi, '').slice(0, 8)
const dossierCourt = createHash('sha1').update(process.cwd()).digest('hex').slice(0, 8)
const nom = arg('--nom') || ('s-' + (sessionCourte || 'd' + dossierCourt))
const but = arg('--but')
const demande = process.argv.includes('--isoler') || process.env.KYBERNOS_ISOLATE === '1'

// décision pure (exportable/testable) : ce dossier est-il partagé à 1 h ?
//
// Le slug du magasin est DÉCODÉ depuis les noms réels, jamais construit à la
// main : DSH encode les caractères spéciaux (`~0020` pour une espace), et un slug
// naïf faisait répondre « non partagé » — donc « travaille en place » — sur un
// dossier réellement occupé.
export function decider (cheminCourant, sessionsHome, fenetreMs = 3600 * 1000, horloge = Date.now) {
  const r = repartitionParDossier(sessionsHome, fenetreMs, horloge())
  const slugs = slugsDeChemin(sessionsHome, cheminCourant)
  const sessionsActives = slugs.reduce((n, s) => n + (r[s] || { sessionsActives: 0 }).sessionsActives, 0)
  return { slug: slugs[0] || null, slugs, partage: sessionsActives >= 2, sessionsActives }
}

// ── Fichiers chauds : réservation par FICHIER, pas par dossier ───────────────
// `decider` ci-dessus mesure le PARTAGE d'un dossier sur 1 h : il ne peut pas
// dire « client.js est en train d'être écrit ». Or c'est LA collision constatée
// les 22-23/09/2026 (trois sessions sur un seul checkout, point de collision
// kybernos-plugin/client.js, 1 Mo / ~13 000 lignes). Sans réservation par
// fichier, « un seul écrivain par fichier chaud » restait un vœu.
// Tous les bundles clients du dépôt sont servis à chaud depuis le disque : un
// filet qui ne couvrirait que `kybernos-plugin` laisserait dix bundles cassables
// sans veille. Mesuré le 23/09/2026 : le bandeau de santé vit dans
// `kybernos-sessions/client.js`, donc dans un fichier chaud, lui aussi.
export const FICHIERS_CHAUDS = [
  'packages/kybernos-plugin/client.js',
  'packages/kybernos-plugin/index.js',
  'packages/kybernos-sessions/client.js',
  'packages/kybernos-models/client.js',
  'packages/kybernos-theme/client.js',
  'packages/kybernos-slash/client.js',
  'packages/kybernos-skills/client.js',
  'packages/kybernos-composio/client.js',
  'packages/kybernos-cloud/client.js',
  'packages/kybernos-maintenance/client.js',
  'packages/kybernos-relance/client.js',
  'packages/kybernos-flow/client.js',
  // Ajouté le 24/09/2026 : le panneau « Briques » vit dans un bundle client
  // servi à chaud, comme les autres. Il manquait à cette liste — la garde
  // répondait « pas un fichier chaud connu », donc personne ne le réservait.
  'packages/kybernos-bricks/client.js',
  // Recette 03/10 : bundles clients apparus depuis — la suite worktrees (C1b)
  // les réclamait, la garde les ignorait (« pas un fichier chaud connu »).
  'packages/kybernos-auto/client.js',
  'packages/kybernos-computers/client.js',
  'packages/kybernos-language/client.js',
  'packages/kybernos-miniapps/client.js',
  'packages/kybernos-modeles-locaux/client.js',
  'packages/kybernos-modeleur/client.js',
  'packages/kybernos-refs/client.js',
  'packages/kybernos-slides/client.js',
  'packages/kybernos-changes/client.js',
]
export const TTL_CLAIM_MS = 180 * 1000

// Pure : les réservations encore vivantes. Une réservation périmée est ignorée —
// un chat tué sans libérer ne doit pas bloquer le suivant indéfiniment (même
// choix que `dsh-relance-claims.json`, 180 s).
export function claimsVivants (claims, maintenant = Date.now()) {
  const c = claims && typeof claims === 'object' ? claims : {}
  const out = {}
  for (const f of Object.keys(c)) {
    const v = c[f]
    if (v && typeof v.expire === 'number' && v.expire > maintenant) out[f] = v
  }
  return out
}

// Pure : le détenteur d'un fichier chaud quand ce n'est PAS nous (null sinon).
export function claimConcurrent (claims, fichier, session, maintenant = Date.now()) {
  const v = claimsVivants(claims, maintenant)[fichier]
  if (!v) return null
  return String(v.session || '') === String(session || '') ? null : v
}

// ── Verdict d'une passe de veille (pur, donc testable sans disque) ───────────
// Ce qu'on fait d'une révision : la PUBLIER (elle parse), la REMPLACER par la
// dernière verte connue (elle ne parse plus et il existe un filet), ou la
// SIGNALER seulement (elle ne parse plus et il n'y a aucun filet : on ne peut
// pas inventer une version valide).
export function verdictRevision ({ parseOk, filetOk }) {
  if (parseOk === true) return 'publier'
  return filetOk === true ? 'remplacer' : 'signaler'
}

const SNAPSHOTS = () => join(home, 'kybernos', 'last-good')
const JOURNAL = () => join(home, 'kybernos', 'veille-bundle.log')
// Le nom garde les caractères lisibles (`-`, `.`, `_`) et ne remplace que ce qui
// sépare : le filet de `kybernos-plugin/client.js` s'appelle
// `kybernos-plugin__client.js`, donc lisible dans un `ls last-good`.
const nomSnapshot = (rel) => rel.replace(/[^a-zA-Z0-9._-]+/g, '__')
// `node --check <fichier>.js` NE SUFFIT PAS pour ces bundles — mesuré le
// 23/09/2026 sur Node 26.7.0 : il rend 0 sur `export const vert = {{{` et sur
// `export const a = = 1` (la passe CommonJS avale l'erreur), alors que le même
// contenu en `.mjs` rend 1. Un bundle client est un MODULE : on valide donc en
// forçant le mode module par l'entrée standard (aucun fichier temporaire, et le
// verdict ne dépend pas de l'extension).
const parsee = (f) => {
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '--check', '-'], {
      input: readFileSync(f), stdio: ['pipe', 'ignore', 'ignore'],
    })
    return r.status === 0
  } catch (e) { return false }
}
const journaliser = (ligne) => {
  try {
    mkdirSync(dirname(JOURNAL()), { recursive: true })
    appendFileSync(JOURNAL(), new Date().toISOString() + '  ' + ligne + '\n')
  } catch (e) { /* journal indisponible : la veille continue */ }
}

// Signature de contenu : c'est ELLE qui évite de revalider 1 Mo par seconde.
// Un `mtime` seul se ferait piéger par une écriture de même taille dans la même
// milliseconde ; le hachage lit le fichier (1,4 Mo/s, négligeable) mais ne
// relance plus un processus node ni ne recopie le filet tant que rien n'a changé.
const signature = (f) => createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 16)

/**
 * Une passe de veille sur les fichiers chauds d'un dossier. Ne bloque pas, ne
 * lève pas : une veille ne doit jamais faire échouer un chantier.
 * @param {Map<string,string>} memo signatures déjà jugées (évite le travail à vide)
 * @returns {{ publies: string[], remplaces: string[], signales: string[] }}
 */
export function passeVeille (dossier, fichiers = FICHIERS_CHAUDS, memo = new Map()) {
  const out = { publies: [], remplaces: [], signales: [] }
  const snap = SNAPSHOTS()
  try { mkdirSync(snap, { recursive: true }) } catch (e) { /* pas de filet possible */ }
  for (const rel of fichiers) {
    const cible = join(dossier, rel)
    let sig = null
    try { sig = signature(cible) } catch (e) { continue }
    // Rien n'a bougé depuis la dernière passe jugée : on ne refait ni la
    // validation (un processus node et 1 Mo à parser), ni la copie du filet.
    if (memo.get(rel) === sig) continue
    const filet = join(snap, nomSnapshot(rel))
    const filetOk = existsSync(filet) === true && parsee(filet) === true
    const verdict = verdictRevision({ parseOk: parsee(cible), filetOk })
    if (verdict === 'publier') {
      try { copyFileSync(cible, filet); memo.set(rel, sig) } catch (e) { /* filet non écrit */ }
      out.publies.push(rel)
      continue
    }
    if (verdict === 'remplacer') {
      try {
        copyFileSync(filet, cible)
        memo.delete(rel) // la remise en place change le contenu : on rejugera
        out.remplaces.push(rel)
        journaliser('REMPLACÉ ' + rel + ' — révision illisible, dernière verte remise en place')
      } catch (e) { out.signales.push(rel) }
      continue
    }
    memo.set(rel, sig) // une seule ligne de journal par révision illisible
    out.signales.push(rel)
    journaliser('SIGNALÉ ' + rel + ' — révision illisible et AUCUN filet vert connu')
  }
  return out
}

/**
 * Boucle de veille. `--une-fois` sert aux tests (une passe, puis rendu la main).
 */
export function veille (options = {}) {
  const dossier = options.dossier || chemin
  const interval = Number(options.interval || 1000)
  const uneFois = options.uneFois === true
  const fichiers = options.fichiers || FICHIERS_CHAUDS
  const memo = new Map()
  let arret = false
  const passe = () => {
    const r = passeVeille(dossier, fichiers, memo)
    if (options.verbeux === true && (r.publies.length > 0 || r.remplaces.length > 0)) {
      console.log('  ' + new Date().toISOString() + '  vertes=' + r.publies.length
        + ' remplacées=' + r.remplaces.length + ' sans filet=' + r.signales.length)
    }
    return r
  }
  passe()
  if (uneFois === true) return
  console.log('veille de publication : ' + fichiers.join(', ') + ' (toutes les ' + interval + ' ms)')
  console.log('  filets : ' + SNAPSHOTS())
  console.log('  journal : ' + JOURNAL())
  const timer = setInterval(passe, interval)
  const finir = () => { arret = true; clearInterval(timer); process.exit(0) }
  process.on('SIGINT', finir)
  process.on('SIGTERM', finir)
  void arret
}

// ── Veille PERMANENTE (LaunchAgent, pour survivre à la fermeture des chats) ──
// Mesuré : la veille en job de fond meurt avec la session — donc pile au moment
// où plus personne ne surveille. Le LaunchAgent, lui, démarre au login et
// redémarre tout seul (`KeepAlive`), comme `com.kybernos.dsh-relance`.
export const LABEL_VEILLE = 'com.kybernos.dsh-veille-bundle'
const cheminPlist = () => join(homedir(), 'Library', 'LaunchAgents', LABEL_VEILLE + '.plist')
const uid = String(process.getuid === undefined ? '' : process.getuid())

/**
 * Plist de la veille. Chemin du bundle FIGÉ (comme les autres agents Kybernos) :
 * un dépôt déplacé demande une réinstallation, ce que `--install` refait.
 */
export function plistVeille (racine, intervalle = 1000, noeud = process.execPath, journal = join(home, 'logs')) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL_VEILLE}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${noeud}</string>
    <string>${join(racine, 'packages', 'kybernos-sessions', 'garde.mjs')}</string>
    <string>--veille</string>
    <string>--interval</string>
    <string>${String(intervalle)}</string>
    <string>--dossier</string>
    <string>${racine}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>DSH_HOME</key>
    <string>${home}</string>
  </dict>

  <key>StandardOutPath</key>
  <string>${join(journal, 'veille-bundle.out.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(journal, 'veille-bundle.err.log')}</string>

  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`
}

/** Pose (ou retire) la veille permanente. Rend un compte-rendu, ne lève pas. */
export function agentVeille (action, racine = chemin, intervalle = 1000) {
  const p = cheminPlist()
  const launchctl = (args) => spawnSync('launchctl', args, { encoding: 'utf8' })
  if (action === 'install') {
    try {
      mkdirSync(dirname(p), { recursive: true })
      mkdirSync(join(home, 'logs'), { recursive: true })
      writeFileSync(p, plistVeille(racine, intervalle))
    } catch (e) { return { ok: false, quoi: 'écriture du plist', erreur: e.message } }
    launchctl(['bootout', 'gui/' + uid, p])
    const r = launchctl(['bootstrap', 'gui/' + uid, p])
    if (r.status !== 0) return { ok: false, quoi: 'bootstrap launchctl', erreur: (r.stderr || '').trim() || ('code ' + String(r.status)) }
    return { ok: true, quoi: 'veille permanente installée', plist: p }
  }
  if (action === 'uninstall') {
    launchctl(['bootout', 'gui/' + uid, p])
    if (existsSync(p)) {
      try { rmSync(p) } catch (e) { return { ok: false, quoi: 'retrait du plist', erreur: e.message } }
    }
    return { ok: true, quoi: 'veille permanente retirée', plist: p }
  }
  // 'etat' : ce que launchd en dit, et ce que la veille a fait.
  const r = launchctl(['print', 'gui/' + uid + '/' + LABEL_VEILLE])
  const vivante = r.status === 0
  let dernier = []
  try {
    dernier = readFileSync(JOURNAL(), 'utf8').trim().split('\n').slice(-5)
  } catch (e) { dernier = [] }
  return { ok: true, quoi: vivante ? 'veille permanente chargée' : 'veille permanente ABSENTE', plist: p, journal: dernier }
}

const moiSession = process.env.DSH_SESSION_ID || ('pid-' + process.pid)
const CLAIMS = join(home, 'kybernos', 'hot-claims.json')

const lireClaims = () => {
  try {
    const j = JSON.parse(readFileSync(CLAIMS, 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch (e) { return {} }
}

// Best effort assumé : une réservation ne doit JAMAIS faire échouer un chantier.
const ecrireClaims = (c) => {
  try {
    mkdirSync(dirname(CLAIMS), { recursive: true })
    writeFileSync(CLAIMS, JSON.stringify(claimsVivants(c), null, 2) + '\n')
  } catch (e) { /* disque plein, droits… : on continue sans réservation */ }
}

// Accepte le chemin complet ou le seul nom (« client.js ») : au clavier, on écrit
// le nom, et un chemin exact exigé serait une friction qui fait abandonner la
// règle. Mais plusieurs bundles portent désormais un `client.js` : `--claim
// client.js` ne peut plus désigner « le premier qui correspond » — il doit
// refuser et nommer les candidats (une réservation posée sur le mauvais bundle
// ne protège rien).
export const resoudreChaud = (saisie) => {
  if (!saisie) return { ambigu: [] }
  const s = String(saisie).replace(/^\.\//u, '')
  const exact = FICHIERS_CHAUDS.filter((f) => f === s)
  if (exact.length === 1) return { fichier: exact[0] }
  const parNom = FICHIERS_CHAUDS.filter((f) => f.endsWith('/' + s))
  if (parNom.length === 1) return { fichier: parNom[0] }
  return { ambigu: parNom }
}

// ne s'exécute qu'invoqué directement (l'import pour les tests ne fait rien)
const direct = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())

const main = async () => {
  // ── Porte de publication (--check) ────────────────────────────────────────
  // À passer AVANT d'annoncer qu'une modification du bundle est prête : c'est le
  // même verdict que la veille, mais à la demande. Sort en 1 si un fichier chaud
  // ne parse pas (la veille, elle, le remplacerait).
  if (process.argv.includes('--check')) {
    const dossierCheck = arg('--dossier', chemin)
    let casses = 0
    for (const rel of FICHIERS_CHAUDS) {
      const f = join(dossierCheck, rel)
      if (existsSync(f) !== true) { console.log('· absent : ' + rel); continue }
      const bon = parsee(f)
      if (bon === false) casses += 1
      console.log((bon ? '✓ ' : '✗ ') + rel + (bon ? ' parse (module)' : ' NE PARSE PAS — ne pas livrer en l\'état'))
    }
    process.exit(casses === 0 ? 0 : 1)
  }

  // ── Veille de publication (--veille) ──────────────────────────────────────
  // Avant tout le reste : elle boucle, elle ne prend aucune décision de chantier.
  if (process.argv.includes('--veille')) {
    const dossierVeille = arg('--dossier', chemin)
    const intervalle = arg('--interval', '1000')
    // Cycle de vie de la veille PERMANENTE (elle survit aux chats).
    const cycle = ['--install', '--uninstall', '--etat'].find((f) => process.argv.includes(f))
    if (cycle !== undefined) {
      const r = agentVeille(cycle.slice(2), dossierVeille, Number(intervalle))
      if (r.ok !== true) {
        console.log('✗ ' + r.quoi + ' : ' + String(r.erreur || 'échec'))
        process.exit(1)
      }
      console.log('✓ ' + r.quoi)
      console.log('  plist   : ' + r.plist)
      if (r.journal !== undefined) {
        console.log('  journal : ' + (r.journal.length === 0 ? '(aucune ligne — rien à réparer)' : ''))
        for (const l of r.journal) console.log('    ' + l)
      }
      process.exit(0)
    }
    veille({
      dossier: dossierVeille,
      interval: intervalle,
      uneFois: process.argv.includes('--une-fois'),
      verbeux: process.argv.includes('--verbeux'),
    })
    return
  }

  // ── Réservation d'un fichier chaud (--claim / --release) ───────────────────
  const demandeClaim = arg('--claim')
  const demandeRelease = arg('--release')
  if (demandeClaim || demandeRelease) {
    const demande = demandeClaim || demandeRelease
    const cible = resoudreChaud(demande)
    if (cible.fichier === undefined) {
      if (cible.ambigu.length > 1) {
        console.log('✗ « ' + demande + ' » désigne ' + cible.ambigu.length + ' fichiers chauds — nomme le bundle :')
        for (const c of cible.ambigu) console.log('  · ' + c)
      } else {
        console.log('✗ « ' + demande + ' » n\'est pas un fichier chaud connu.')
        console.log('  connus : ' + FICHIERS_CHAUDS.join(', '))
      }
      process.exit(3)
    }
    const f = cible.fichier
    const claims = lireClaims()
    if (demandeRelease) {
      const v = claims[f]
      if (v && String(v.session || '') === moiSession) delete claims[f]
      ecrireClaims(claims)
      console.log('✓ réservation libérée : ' + f)
      process.exit(0)
    }
    const conc = claimConcurrent(claims, f, moiSession)
    if (conc !== null) {
      const restant = Math.max(0, Math.round(((conc.expire || 0) - Date.now()) / 1000))
      console.log('⚠ ' + f + ' est DÉJÀ réservé par un autre chat : ' + (conc.session || '?') + ' (' + restant + ' s restantes)')
      console.log('  Un seul écrivain par fichier chaud : n\'écris pas dedans maintenant.')
      console.log('  Attends la libération, ou demande à ce chat de la rendre :')
      console.log('  node kybernos-sessions/garde.mjs --release ' + f)
      process.exit(4)
    }
    claims[f] = { session: moiSession, debut: Date.now(), expire: Date.now() + TTL_CLAIM_MS }
    ecrireClaims(claims)
    console.log('✓ réservé ' + (TTL_CLAIM_MS / 1000) + ' s : ' + f)
    console.log('  Renouvelle avec --claim avant expiration si l\'écriture dure.')
    process.exit(0)
  }

  // Le point de collision RÉEL, dit AVANT la décision d'isolation : la garde de
  // dossier ne le voit pas.
  const vivants = claimsVivants(lireClaims())
  const conflits = FICHIERS_CHAUDS.filter((f) => claimConcurrent(vivants, f, moiSession) !== null)
  if (conflits.length > 0) {
    for (const f of conflits) {
      const v = claimConcurrent(vivants, f, moiSession)
      const restant = Math.max(0, Math.round(((v.expire || 0) - Date.now()) / 1000))
      console.log('⚠ fichier chaud DÉJÀ réservé : ' + f + ' — ' + (v.session || '?') + ' (' + restant + ' s)')
    }
    console.log('  N\'écris pas dedans : attends, ou prends un autre périmètre.')
  } else if (Object.keys(vivants).length > 0) {
    console.log('✓ fichier(s) chaud(s) réservé(s) par toi : ' + Object.keys(vivants).join(', '))
  }

  const g = await etatGit(chemin)

  // Le PARTAGE se teste AVANT le constat git. Hors git il n'existe aucune
  // isolation possible : l'avertissement est alors la SEULE protection, et
  // l'ancien ordre (`!g.git` en premier) la sautait exactement dans ce cas —
  // il répondait « rien à isoler, travaille en place », le message le plus
  // rassurant du lot, à un dossier que 13 sessions se partageaient.
  // Constaté le 22/09/2026 : /Users/me/projects/testing, 72 sessions,
  // 13 actives à l'heure, une en train d'écrire pendant qu'on écrivait.
  const d = decider(chemin, sessionsHome)

  if (!g.git) {
    if (d.partage) {
      console.log('⚠ hors git ET dossier PARTAGÉ — aucune isolation possible ici')
      console.log('  ' + d.sessionsActives + ' session(s) active(s) dans l\'heure sur ce dossier.')
      console.log('  Aucun arbre n\'est possible (pas de dépôt) : n\'écris QUE dans un')
      console.log('  sous-dossier à toi, et ne touche pas aux fichiers de la racine.')
    } else {
      console.log('✓ hors git — rien à isoler, travaille en place')
    }
    process.exit(0)
  }
  if (g.worktree) { console.log('✓ déjà isolé (worktree) — travaille ici'); process.exit(0) }
  if (!d.partage) { console.log('✓ dossier non partagé — travaille en place'); process.exit(0) }

  const s = await sondeIsolation({ chemin, nom, sessionsHome })
  if (s.dejaIsole) { console.log('✓ déjà isolé — travaille ici'); process.exit(0) }

  if (s.reutilisable) {
    console.log('⚠ dossier partagé — un arbre d\'isolation LIBRE existe déjà, réutilisé :')
    console.log('  ' + s.cible)
    console.log('  branche : ' + s.branche)
    console.log('  → ouvre le PROCHAIN chat dans ce dossier ; n\'en crée pas un second.')
    process.exit(2)
  }

  if (!demande) {
    console.log('✓ dossier partagé — un worktree ne peut pas être rattaché à CE chat')
    console.log('  (la session et la GUI servent le checkout principal : les éditions')
    console.log('  faites dans un arbre n\'apparaîtraient pas). Travaille en place.')
    console.log('  Pour réserver un arbre au PROCHAIN chat :')
    console.log('  node kybernos-sessions/garde.mjs --isoler [--nom <slug>] [--but "<phrase>"]')
    process.exit(0)
  }

  if (!s.ok) {
    console.log('✗ isolation demandée mais impossible : ' + s.erreur)
    if (s.cible) console.log('  cible : ' + s.cible)
    console.log('  → committe (ou nettoie l\'arbre) puis relance.')
    process.exit(3)
  }

  const r = await isoler({ chemin, nom, but, exec: true, sessionsHome })
  if (r.ok !== true) { console.log('✗ isolation refusée : ' + r.erreur); process.exit(3) }
  console.log('⚠ dossier partagé — worktree ' + (r.reutilise ? 'réutilisé' : 'créé') + ' :')
  console.log('  ' + r.cible)
  console.log('  branche : ' + r.branche)
  console.log('  → ouvre le PROCHAIN chat dans ce dossier pour qu\'il y soit isolé.')
  process.exit(2)
}

if (direct) main()
