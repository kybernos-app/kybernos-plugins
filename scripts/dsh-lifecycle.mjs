#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// dsh-lifecycle — le robot garagiste (CLI). Voir docs/handoff/lifecycle/DESIGN.md
//
//   node scripts/dsh-lifecycle.mjs doctor [--json]     état, n'écrit jamais
//   node scripts/dsh-lifecycle.mjs install              ajoute le plugin à un profil
//   node scripts/dsh-lifecycle.mjs upgrade [version] [--force] [--dry]
//   node scripts/dsh-lifecycle.mjs rollback [--photo <dossier>]
//   node scripts/dsh-lifecycle.mjs uninstall            retire liens+bundle (garder le reste)
//   node scripts/dsh-lifecycle.mjs verify [--url <url>] boot réel seulement
//
// Invariants tenus par le harnais unitaire + les e2e :
//   geste n°1 = compatibilité · photo avant toute écriture · journal après
//   tout · échec boot → rollback automatique.
// Sortie : 0 = 🟢/succès, 1 = 🟠/échec (lisible, jamais de stack trace nue).
// ═══════════════════════════════════════════════════════════════════════════

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, rmSync, statSync, symlinkSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditerSurfaces } from '../packages/kybernos-maintenance/surfaces.mjs'
import { pidSurPort, demarrageProcessus, famille, nomSuperviseur, planRelance, instructionsRedemarrage } from './plateforme.mjs'
import {
  etatDoctor, testerCompatibilite, lireCompat, comparerVersions, versionDuGlobal, versionDuPlugin,
  photographier, restaurerPhoto, journaliser, lireJournal, alignerPins, alignerLiens,
  planUpgrade, ecrireLisezMoi, inspecterFraicheur
} from './lifecycle-engine.mjs'
// La vérification d'une archive reçue : le manifeste du paquet est la seule
// autorité sur ce qui a été livré (voir scripts/paquet.mjs).
import { verifierManifest, cheminer, LIRE_SATELLITES, TOUS_LES_SATELLITES, verifierSatellite } from './paquet.mjs'
// La règle des bases d'une installation (profil, moteur global, projet épinglé)
// vit dans UN seul module, éprouvé par test-racine-dsh.mjs.
import { basesPossibles } from './racine-dsh.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
// REPO n'est plus une constante : `--source` peut désigner le dossier extrait
// d'une archive reçue. ICI reste le dossier des scripts du robot (patches.json
// et lifecycle-packages.json se lisent TOUJOURS là, jamais dans la source).
let REPO = resolve(ICI, '..')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFIL_DIR = process.env.KBLIFE_PROFIL || join(DSH_HOME, 'profiles', 'web')

// ── Le moteur de RÉFÉRENCE : un arbre épinglé, dans un dossier à nous ───────
// Mesure du 23/09/2026, laboratoire isolé : `npm i -g @deepseek-ai/dsh@X`
// n'épingle PAS l'arbre. Les paquets que nos retouches visent ne sont pas des
// dépendances directes du moteur ; ils arrivent par des plages transitives et
// npm prend le plus récent qui satisfait — 0.1.7-rc.1 le soir où cette machine
// portait 0.1.7-alpha.1. Deux machines neuves n'ont donc pas le même moteur, et
// deux retouches sur quatre ne rentrent pas chez le testeur.
// La seule façon MESURÉE d'épingler l'arbre : `overrides` + `npm install` dans
// un projet (6/6 paquets à la version voulue, empreinte identique à celle d'ici).
// Le binaire est ensuite lié dans le préfixe GLOBAL, déjà sur le PATH : le geste
// du testeur ne change pas.
const MOTEUR_DIR = join(DSH_HOME, 'kybernos', 'moteur')
/** Les paquets dont le contenu décide si nos retouches rentrent. */
const PAQUETS_EPINGLES = [
  'dsh-agent-loop',
  'dsh-api-remotes',
  'dsh-api-session-controller',
  'dsh-client-ui-conversation',
  'dsh-client-ui-model-selection',
  'dsh-client-ui-primitives',
  'dsh-client-ui-settings-models',
  'dsh-client-ui-workspace',
]
const CYCLE_DIR = join(DSH_HOME, 'lifecycle')
const PHOTOS_DIR = join(CYCLE_DIR, 'photos')
const JOURNAL = join(CYCLE_DIR, 'journal.jsonl')
const PATCHES = JSON.parse(readFileSync(join(ICI, 'patches.json'), 'utf8'))
const PACKAGES = JSON.parse(readFileSync(join(ICI, 'lifecycle-packages.json'), 'utf8')).packages

// ── Modèle 3 : activation des satellites ────────────────────────────────────
// Un satellite est ACTIVÉ s'il est listé dans `~/.dsh/kybernos/satellites-actives.json`
// (un simple tableau de noms @local/…). Si le fichier est absent → TOUT est
// activé (comportement historique, aucune régression pour un install existant).
// Le socle (tier 1, obligatoire) est TOUJOURS activé, quoi qu'il arrive.
const SATELLITES_ACTIVES_FICHIER = join(DSH_HOME, 'kybernos', 'satellites-actives.json')
function lireSatellitesActives () {
  try {
    const brut = JSON.parse(readFileSync(SATELLITES_ACTIVES_FICHIER, 'utf8'))
    const liste = Array.isArray(brut) ? brut : Array.isArray(brut?.actives) ? brut.actives : null
    if (liste === null) return null
    const manifeste = LIRE_SATELLITES(REPO)
    if (manifeste === null) return null
    // Le socle est toujours actif, même si le fichier ne le liste pas.
    const socle = (manifeste.socle?.bundles ?? []).map((b) => b.nom)
    return [...new Set([...socle, ...liste])]
  } catch (e) {
    return null
  }
}
const ACTIVES = lireSatellitesActives()
const PACKAGES_ACTIFS = ACTIVES === null ? PACKAGES : PACKAGES.filter((p) => ACTIVES.includes(p.nom))
let COMPAT_CHEMIN = join(REPO, 'dsh-compat.json')

const ALLOW_SCRIPTS = '--allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs'
const horodatage = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace('Z', '')

// Verrous orphelins : un `dsh plugin install` tué en pleine course laisse
// `package.json.lock` sur disque et TOUT install suivant meurt sur le timeout
// atomic-write. Personne ne le détient → on le retire. (Mesuré ce jour : le
// verrou traînait et le pnpm du robot échouait en silence.)
const nettoyerVerrousOrphelins = () => {
  const verrou = join(PROFIL_DIR, 'package.json.lock')
  try { if (existsSync(verrou)) { rmSync(verrou); console.log('  🧹 verrou orphelin retiré (' + verrou + ')') } } catch (e) { /* rien */ }
}

// install pnpm avec sortie VISIBLE : un échec muet est un échec qu'on
// confond avec un boot cassé. Le code de sortie est la seule vérité.
const installerProfil = async () => {
  nettoyerVerrousOrphelins()
  const r = await execReel(['dsh', 'plugin', '--profile', 'web', 'install'], REPO)
  if (r.code !== 0) {
    console.log(r.sortie.slice(0, 800))
    console.log(r.err.slice(0, 800))
    throw new Error('l\'installation du profil (pnpm) a échoué — voir ci-dessus')
  }
  return r
}

// ── l'environnement réel, injecté dans le moteur ───────────────────────────
const fsReel = {
  existe: existsSync,
  lire: (p) => readFileSync(p, 'utf8'),
  ecrire: (p, c) => writeFileSync(p, c),
  creerRep: (p) => mkdirSync(p, { recursive: true }),
  lister: (p) => readdirSync(p),
  copier: (src, dst) => { cpSync(src, dst) },
}
// ── lancer un binaire externe, y compris sur Windows ──────────────────────
// Mesure du 23/09/2026, coureur windows-latest, machine neuve : `npm` y est
// `npm.cmd`, et `execFile('npm', …)` echoue — l'installation s'arretait net sur
// « impossible de lire les versions publiees (npm view @deepseek-ai/dsh dist-tags
// a echoue) », sans qu'aucune version ne soit lue. Meme piege pour `dsh`, qui est
// `dsh.cmd`. On passe donc par le shell de la plateforme, en citant les arguments
// qui contiennent un espace : « C:\Users\Jean Dupont\… » est un cas reel chez un
// testeur Windows, et un chemin coupe en deux ferait echouer la meme etape.
const citerArg = (a) => {
  const s = String(a)
  return /[\s"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
const execReel = (cmd, cwd, delaiMs = 180000) => new Promise((res) => {
  const win = process.platform === 'win32'
  const prog = win && /^(npm|npx|pnpm|dsh)$/.test(cmd[0]) ? cmd[0] + '.cmd' : cmd[0]
  execFile(prog, cmd.slice(1).map(citerArg), { cwd, encoding: 'utf8', timeout: delaiMs, shell: win, windowsHide: true },
    (err, stdout, stderr) => res({
      code: err ? (err.code ?? 1) : 0,
      // Un depassement de delai rend un code non nul ET des flux VIDES : sans ce
      // drapeau, l'echec s'affichait « npm a echoue : » — un message qui n'explique
      // rien. Mesure du 23/09/2026 sur un coureur windows-latest a froid.
      delaiDepasse: err ? (err.killed === true || err.signal === 'SIGTERM') : false,
      delaiMs,
      sortie: String(stdout || ''),
      err: String(stderr || ''),
    }))
})
const horlogeReelle = () => Date.now()

// ── le global installé : où vivent les paquets que les retouches modifient ──
// On ne code plus /opt/homebrew en dur ici : `npm root -g` dit où est le
// moteur, et chaque script de retouche reçoit ce chemin par `--dsh`.
let RACINE_CACHE = null

/**
 * Le moteur que le binaire `dsh` du PATH lance VRAIMENT, ou `null`.
 *
 * Distinct de `moteurEpinglé` — et c'est LUI qui doit faire foi. Un retour
 * arrière repose le lien sur l'ancien moteur en laissant le nouveau dossier sous
 * MOTEUR_DIR : prendre « le plus récent » lisait alors un arbre que personne ne
 * lançait. Mesuré le 23/09/2026 au laboratoire : après l'échec d'une montée en
 * 0.1.7-alpha.2, le doctor annonçait « models-header posée » et le retour
 * arrière reposait les retouches dans l'arbre alpha.2 — pendant que `dsh`
 * lançait alpha.1, sans la retouche.
 */
const moteurDuLien = async () => {
  const p = await execReel(['npm', 'prefix', '-g'])
  const prefixe = String(p.sortie || '').trim()
  if (p.code !== 0 || prefixe === '') return null
  // LES DEUX CÔTÉS sont résolus : sur macOS `/tmp` est un lien vers
  // `/private/tmp`, et comparer un chemin résolu (le lien `dsh`) à un chemin
  // brut (notre foyer) donne « .. » à tous les coups — mesuré le 23/09/2026, le
  // laboratoire retombait alors sur « le plus récent » au lieu du moteur lancé.
  let racineMoteur = MOTEUR_DIR
  try { racineMoteur = realpathSync(MOTEUR_DIR) } catch (e) { /* foyer neuf : tel quel */ }
  // Windows : notre poseur écrit un relais `dsh.cmd` (pas de lien symbolique).
  for (const nom of ['dsh', 'dsh.cmd']) {
    let cible = null
    try { cible = realpathSync(join(prefixe, 'bin', nom)) } catch (e) { continue }
    const relatif = relative(racineMoteur, cible)
    if (relatif === '' || relatif.startsWith('..')) continue
    const version = relatif.split(sep)[0]
    const dsh = join(MOTEUR_DIR, version, 'node_modules', '@deepseek-ai', 'dsh')
    if (existsSync(dsh) === true) return { version, projet: join(MOTEUR_DIR, version), dsh }
  }
  return null
}

/** Le moteur épinglé déjà posé (le plus récent), ou `null`. */
const moteurEpinglé = () => {
  const versions = existsSync(MOTEUR_DIR) === false ? [] : readdirSync(MOTEUR_DIR).filter((v) => v[0] !== '.' && v[0] !== '@')
  versions.sort((a, b) => comparerVersions(b, a))
  for (const v of versions) {
    const dsh = join(MOTEUR_DIR, v, 'node_modules', '@deepseek-ai', 'dsh')
    if (existsSync(dsh) === true) return { version: v, projet: join(MOTEUR_DIR, v), dsh }
  }
  return null
}

const racineGlobale = async () => {
  if (RACINE_CACHE !== null) return RACINE_CACHE
  // 1) ce que le binaire `dsh` lance VRAIMENT (l'ordre compte : voir
  //    `moteurDuLien`, qui existe à cause d'un retour arrière menteur) ;
  const duLien = await moteurDuLien()
  if (duLien !== null) {
    RACINE_CACHE = duLien.dsh
    return RACINE_CACHE
  }
  // 2) à défaut, le moteur ÉPINGLÉ le plus récent de notre foyer : c'est celui
  //    que nos retouches connaissent, et celui que le binaire `dsh` lance.
  const epingle = moteurEpinglé()
  if (epingle !== null) {
    RACINE_CACHE = epingle.dsh
    return RACINE_CACHE
  }
  const r = await execReel(['npm', 'root', '-g'])
  const racine = String(r.sortie || '').trim()
  RACINE_CACHE = racine === '' ? null : join(racine, '@deepseek-ai', 'dsh')
  return RACINE_CACHE
}
const avecDsh = (racine, extra = []) => (racine === null ? extra : extra.concat(['--dsh', racine]))

// ── le serveur sert-il le moteur qui est SUR LE DISQUE ? ───────────────────
// Angle mort mesuré le 2026-09-22 : après la montée en 0.1.7, le serveur déjà
// en cours (démarré 4 h plus tôt) a continué de servir le 0.1.6 depuis sa
// mémoire. Le mélange donne « 1 entry did not activate · …-jobs: waiting for
// service: jobs ». Ni le doctor (il ne lisait que le disque) ni la page Réglages
// (elle lit `dsh --version`, donc le disque aussi) ne pouvaient le dire.
const mtime = (chemin) => {
  try { return statSync(chemin).mtimeMs } catch (e) { return null }
}

const mesurerFraicheur = async () => {
  // Portable : chaque OS a son plan (lsof ici, netstat -ano ailleurs), et le
  // verdict dit par quelle source il a mesuré — ou qu'aucune n'a répondu.
  const trouve = await pidSurPort(portGui)
  const pid = trouve.valeur
  if (pid === null || pid === undefined) {
    return Object.assign(inspecterFraicheur({ demarrageServeur: null, installation: null }), { sourcePid: trouve.source, sourceDemarrage: null })
  }
  const quand = await demarrageProcessus(pid)
  const demarrageServeur = quand.valeur
  const racine = await racineGlobale()
  const dates = [
    racine === null ? null : mtime(join(racine, 'package.json')),
    mtime(join(PROFIL_DIR, 'node_modules', '.modules.yaml')),
    mtime(join(PROFIL_DIR, 'pnpm-lock.yaml')),
  ].filter((d) => d !== null)
  const installation = dates.length === 0 ? null : Math.max(...dates)
  return Object.assign(inspecterFraicheur({ demarrageServeur, installation }), {
    pid, demarrageServeur, installation, sourcePid: trouve.source, sourceDemarrage: quand.source,
  })
}

// ── les versions réellement publiées (mesure, pas devinette) ───────────────
// Un paquet sans version cible fait échouer pnpm en ERR_PNPM_NO_MATCHING_VERSION
// (mesuré le 2026-09-22 : agent-team-web-profile, fusionné en amont dans
// agent-team-profile en 0.1.7). On interroge le registre paquet par paquet, en
// parallèle ; un paquet non mesuré garde le comportement historique (épinglé).
const versionsPubliees = async (noms) => {
  const paires = await Promise.all(noms.map(async (nom) => {
    const r = await execReel(['npm', 'view', nom, 'versions', '--json'])
    if (r.code !== 0) return [nom, null]
    let v = null
    try { v = JSON.parse(r.sortie) } catch (e) { v = null }
    if (typeof v === 'string') v = [v]
    return [nom, Array.isArray(v) ? v : null]
  }))
  const mesure = {}
  for (const [nom, v] of paires) if (Array.isArray(v)) mesure[nom] = v
  return mesure
}

// ── les retouches du moteur : posées PUIS vérifiées ────────────────────────
// Une retouche qui ne se pose plus est une fonctionnalité perdue en silence :
// c'est exactement ce que produit une montée de version. On la vérifie par son
// propre `--check` et, si elle ne se pose pas, on refuse de continuer (l'appel
// enveloppant remet la photo).
// La racine que les scripts de retouche attendent : un dossier qui PORTE la
// cible (`node_modules/<cible>`). Depuis 0.1.7, le global peut livrer les
// paquets autrement : mesuré le 23/09/2026 sur cette machine, le profil a bien
// `node_modules/@deepseek-ai` (40 paquets) mais AUCUN des quatre qu'on retouche —
// ils vivent dans le paquet global, sous
// `…/@deepseek-ai/dsh/node_modules/@deepseek-ai/<court>`. C'est donc par CIBLE
// qu'on résout, une fois pour chaque retouche, et jamais une racine unique.
// Une seule source de vérité : `racineQuiPorte`.

// La racine qui PORTE la cible de cette retouche, ou null si ce moteur ne la
// livre pas du tout. Mesure du 23/09/2026 sur un moteur neuf : deux de nos
// quatre retouches n'ont aucune cible installée — ce n'est pas une régression,
// c'est une retouche qui ne s'applique pas.
// Les bases essayées sont celles de `racine-dsh.mjs` (`basesPossibles`), la
// MÊME règle que celle qu'utilisent les scripts de retouche : le profil, le
// dossier du moteur, le préfixe npm, et la racine d'un projet épinglé (les
// paquets y sont remontés, donc trois crans au-dessus du moteur — l'erreur d'un
// cran se paie par un « non applicable » sur les quatre retouches).
const racineQuiPorte = async (cible) => {
  const globale = await racineGlobale()
  const candidats = [PROFIL_DIR].concat(basesPossibles(globale))
  for (const c of candidats) if (existsSync(join(c, 'node_modules', cible)) === true) return c
  return null
}

// Annuler les retouches qu'on vient de poser. Les scripts gardent une copie
// d'avant (`.kybernos-*.orig`) et savent se retirer (`--revert`) : on s'en sert
// au lieu de croire que la photo du profil couvre le moteur.
// Mesure du 23/09/2026 au laboratoire : après un « ta machine est revenue à
// l'état d'avant », le moteur portait ENCORE 10 marqueurs de notre retouche
// d'épingles — la photo ne couvre que le profil, et un testeur aurait gardé un
// moteur à moitié retouché sans que rien ne le dise.
const annulerRetouches = async (resultats) => {
  const posees = resultats.filter((r) => r.applicable === true && r.conforme === true)
  if (posees.length === 0) return
  console.log('     ↩ on retire ' + posees.length + ' retouche(s) déjà posée(s)')
  for (const r of posees) {
    const sortie = await execReel(['node', join(ICI, r.script), '--revert', ...avecDsh(r.racine)], REPO)
    console.log('       ' + (sortie.code === 0 ? '↩ ' + r.id + ' retirée' : '⚠ ' + r.id + ' NON retirée — à reprendre à la main dans ' + r.racine))
  }
}

const poserPatchs = async ({ tolerance = false } = {}) => {
  const resultats = []
  for (const p of PATCHES) {
    // ── une retouche RETIRÉE ne se pose plus (P3) ──────────────────────────
    // Retirer une entrée de `patches.json` laisserait la retouche POSÉE sur les
    // machines où elle l'est déjà, sans que rien ne sache la défaire (le
    // rollback lit ce même fichier). On garde donc l'entrée, marquée `retire` :
    // le robot ne la pose plus, et il la défait là où elle traîne.
    if (p.retire !== undefined) {
      const racineRetiree = await racineQuiPorte(p.cible)
      if (racineRetiree !== null) {
        const verif = await execReel(['node', join(ICI, p.script), '--check', ...avecDsh(racineRetiree)], REPO)
        if (verif.code === 0) {
          await execReel(['node', join(ICI, p.script), '--revert', ...avecDsh(racineRetiree)], REPO)
          console.log(`     ↩ ${p.id} — retirée (${p.retire})`)
        } else {
          console.log(`     · ${p.id} — retirée, absente (${p.retire})`)
        }
      } else {
        console.log(`     · ${p.id} — retirée, sans cible sur ce moteur (${p.retire})`)
      }
      resultats.push({ id: p.id, conforme: true, applicable: false, retire: true, racine: racineRetiree, script: p.script })
      continue
    }
    const racineCible = await racineQuiPorte(p.cible)
    if (racineCible === null) {
      console.log(`     · ${p.id} — non applicable (${p.cible} n'est pas livré par ce moteur)`)
      resultats.push({ id: p.id, conforme: true, applicable: false })
      continue
    }
    const pose = await execReel(['node', join(ICI, p.script), ...avecDsh(racineCible)], REPO)
    const verif = await execReel(['node', join(ICI, p.script), '--check', ...avecDsh(racineCible)], REPO)
    const conforme = pose.code === 0 && verif.code === 0
    // On DIT sur quelle copie on a écrit : sans cette ligne, un « ✓ » ne dit pas
    // ce qu'il a mesuré (P1 du plan).
    console.log(`     ${conforme ? '✓' : '✗'} ${p.id}  [${racineCible}]`)
    if (!conforme) {
      // Le POURQUOI, tout de suite : sans ça la prochaine session refait la
      // meme execution de 4 minutes pour apprendre la meme chose.
      const detail = (pose.err || pose.sortie || verif.err || '').trim().split('\n').filter((l) => l.trim() !== '').slice(-2)
      for (const l of detail) console.log('       ' + l)
    }
    resultats.push({ id: p.id, conforme, applicable: true, racine: racineCible, script: p.script })
  }
  const perdues = resultats.filter((x) => x.conforme === false)
  if (perdues.length > 0 && tolerance === false) {
    await annulerRetouches(resultats)
    throw new Error('retouche(s) non posable(s) sur ce moteur : ' + perdues.map((x) => x.id).join(', '))
  }
  return resultats
}

const args = process.argv.slice(2)
const ordre = args[0] || 'doctor'
const opts = {
  force: args.includes('--force'),
  dry: args.includes('--dry'),
  json: args.includes('--json'),
  port: Number((args.indexOf('--port') >= 0 ? args[args.indexOf('--port') + 1] : undefined) || process.env.KB_PORT || 3080),
  photo: (args[args.indexOf('--photo') + 1] !== undefined && args.indexOf('--photo') >= 0) ? args[args.indexOf('--photo') + 1] : null,
  url: (args[args.indexOf('--url') + 1] !== undefined && args.indexOf('--url') >= 0) ? args[args.indexOf('--url') + 1] : null,
  // `--source <chemin>` : le dossier (ou l'archive) d'où vient le plugin.
  source: args.indexOf('--source') >= 0 ? args[args.indexOf('--source') + 1] : null,
  relancer: args.includes('--relancer'),
  // La version cible est le premier argument LIBRE. Les valeurs des options
  // n'en sont pas : sans ce saut, `--source dist/x.tar.gz` faisait chercher à
  // npm un paquet nommé d'après un chemin de fichier.
  versionCible: (() => {
    const aParametre = new Set(['--source', '--port', '--photo', '--url', '--ref'])
    const ordres = new Set(['doctor', 'install', 'upgrade', 'rollback', 'uninstall', 'verify', 'bootstrap', 'satellites'])
    for (let i = 0; i < args.length; i++) {
      if (aParametre.has(args[i])) { i += 1; continue }
      if (args[i].startsWith('-')) continue
      if (ordres.has(args[i])) continue
      return args[i]
    }
    return null
  })()
}

/** Le port que sert la GUI : c'est lui qui porte le processus à interroger. */
const portGui = opts.port

const quitter = (code, ...messages) => { for (const m of messages) console.log(m); process.exit(code) }
const journalOp = (op) => journaliser({ fs: fsReel, journal: JOURNAL, op })

// ── vérification boot : ce que l'utilisateur voit ─────────────────────────
// Sans --url : vérification HOST — le robot démarre un DSH sur un port libre
// et lit sa sortie ; un warning « did not activate » ou un crash = échec.
// Avec --url : boot-check complet sur la vraie page (carte Failed, surfaces).
async function verifierBoot (url) {
  if (url !== null && url !== undefined) {
    const r = await execReel(['node', join(ICI, 'boot-check.mjs')], process.env)
    return { ok: r.code === 0, sortie: r.sortie + r.err, code: r.code }
  }
  const fs = await import('node:fs')
  const port = 0
  let sortie = ''
  // `dsh` n'est pas un executable sur Windows mais un shim pose par `npm i -g` :
  // `dsh.cmd`. Mesure du 23/09/2026, coureur windows-latest : `spawn('dsh', …)`
  // rend « Error: spawn dsh ENOENT » (errno -4058) — meme classe que `npm.cmd`.
  const binaire = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const win = process.platform === 'win32'
  // Et il faut passer par le SHELL : depuis le correctif CVE-2024-27980, Node
  // refuse de lancer un .cmd ou un .bat directement et rend « Error: spawn EINVAL »
  // (errno -4071) — mesure du 23/09/2026, coureur windows-latest, sur `dsh.cmd`.
  // C'est la meme regle que `execReel`. Le throw est SYNCHRONE : un gestionnaire
  // `error` ne le voit pas, d'ou le try/catch — un binaire qui refuse de partir
  // doit se lire dans le verdict, jamais tuer le robot en pleine installation.
  let proc = null
  try {
    proc = (await import('node:child_process')).spawn(binaire, ['web', '--no-open', '--port', String(port)], {
      cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], detached: false, windowsHide: true, shell: win
    })
  } catch (e) {
    return { ok: false, sortie: binaire + ' n a pas pu demarrer : ' + e.message, code: -1 }
  }
  // Un binaire absent doit se LIRE dans le verdict, jamais tuer le robot : sans ce
  // gestionnaire, Node renverse « Unhandled 'error' event » et toute l'installation
  // echoue sur une verification de boot facultative.
  proc.on('error', (e) => { sortie += binaire + ' introuvable : ' + e.message })
  proc.stdout.on('data', (d) => { sortie += d })
  proc.stderr.on('data', (d) => { sortie += d })
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
  let pret = null
  const demarrage = new Promise((res) => { pret = res })
  const t = setInterval(() => { if (/dsh web: http/.test(sortie)) { clearInterval(t); pret() } }, 250)
  await Promise.race([demarrage, attendre(25000)])
  clearInterval(t)
  // attendre la fin du boot (les warnings arrivent après l'URL)
  await attendre(3000)
  const tuable = proc
  const mort = new Promise((res) => tuable.on('exit', res))
  tuable.kill()
  await Promise.race([mort, attendre(5000)])
  const s = String(sortie)
  const ko = /did not activate|startup failed|Error:/i.test(s)
  return { ok: !ko, sortie: s, code: ko ? 1 : 0 }
}

// ── DOCTOR : lire, ne jamais écrire ───────────────────────────────────────
// ── REDÉMARRER DSH : le seul geste qui charge le code HÔTE d'un plugin ────
// Un rechargement de page ne suffit pas (le client, oui ; l'hôte, non). Le
// robot tourne dans une console, HORS de DSH : il peut donc arrêter et
// relancer — mais seulement si on le lui demande (`--relancer --force`),
// parce que c'est le DSH du testeur qu'on éteint.
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

async function relancerDsh (port) {
  const trouve = await pidSurPort(port)
  const plan = planRelance(famille(), { port, pid: trouve.valeur })
  if (plan.arreter !== null) {
    console.log('  ⏹ arrêt de DSH (pid ' + plan.arreter.pid + ')…')
    try { process.kill(Number(plan.arreter.pid), 'SIGTERM') } catch (e) { /* déjà mort : tant mieux */ }
    for (let i = 0; i < 40; i++) { await attendre(250); if ((await pidSurPort(port)).valeur === null) break }
  }
  console.log('  ▶ redémarrage : ' + plan.demarrer.cmd + ' ' + plan.demarrer.args.join(' ') + ' (détaché)')
  const enfant = spawn(plan.demarrer.cmd, plan.demarrer.args, { cwd: REPO, detached: true, stdio: 'ignore' })
  enfant.unref()
  for (let i = 0; i < 60; i++) {
    await attendre(500)
    const p = await pidSurPort(port)
    if (p.valeur !== null && String(p.valeur) !== String(trouve.valeur)) return { ok: true, pid: p.valeur }
  }
  return { ok: false, raison: 'aucun serveur n\'a répondu sur le port ' + port + ' dans les 30 s' }
}

// ── LA SOURCE : le dépôt, un dossier, ou l'archive reçue par le testeur ───
// Une archive reçue n'est utilisée qu'après vérification de ses empreintes :
// une seule différence et on refuse — installer un paquet qu'on n'a pas pu
// vérifier, c'est installer ce que quelqu'un a mis à la place.
async function preparerSource () {
  if (opts.source === null) return { origine: 'dépôt', chemin: REPO, manifest: null }
  const chemin = resolve(opts.source)
  if (!existsSync(chemin)) quitter(1, '🔴 source introuvable : ' + chemin)
  if (statSync(chemin).isDirectory()) {
    REPO = chemin
    COMPAT_CHEMIN = join(REPO, 'dsh-compat.json')
    console.log('  Source : dossier ' + REPO)
    return { origine: 'dossier', chemin: REPO, manifest: null }
  }
  const nom = chemin.split('/').pop().replace(/\.tar\.gz$/, '')
  const etape = join(DSH_HOME, 'kybernos', 'paquets', nom)
  rmSync(etape, { recursive: true, force: true })
  mkdirSync(etape, { recursive: true })
  // Piège Windows (n°3 de AGENTS.md) : un chemin d'archive en argument fichier
  // ferait lire « D: » comme un hôte distant — NOM du fichier + cwd du dossier.
  // Les antislashs de la cible -C sont aussi mangés par le tar GNU de
  // Git-for-Windows : slashes partout (run 36993946467).
  const detar = await execReel(['tar', '-xzf', basename(chemin), '-C', etape.split(sep).join('/')],
    dirname(chemin))
  if (detar.code !== 0) quitter(1, '🔴 archive illisible : ' + (detar.err || detar.sortie).slice(0, 300))
  let manifest = null
  try { manifest = JSON.parse(readFileSync(join(etape, 'manifest.json'), 'utf8')) } catch (e) {
    quitter(1, '🔴 aucun manifest.json dans ' + chemin + ' — je refuse d\'installer une archive non vérifiable.')
  }
  const verdict = verifierManifest({ manifest, lire: (c) => readFileSync(join(etape, c)), presents: cheminer(etape, etape, '') })
  if (!verdict.ok) {
    console.log('🔴 archive NON conforme — ' + verdict.ecarts.length + ' écart(s) :')
    for (const e of verdict.ecarts.slice(0, 20)) console.log('   · ' + e.type + ' : ' + e.chemin)
    quitter(1, '   rien n\'a été installé. Redemande l\'archive à qui te l\'a envoyée.')
  }
  console.log('  Source : archive ' + nom + ' — ' + manifest.total.fichiers + ' fichiers vérifiés, version ' + manifest.version)
  REPO = etape
  COMPAT_CHEMIN = join(REPO, 'dsh-compat.json')
  return { origine: 'archive', chemin: REPO, manifest }
}

// La version du moteur à poser : on lit les étiquettes publiées EN DIRECT et on
// épingle une version précise. Jamais `latest`, jamais un intervalle : c'est
// exactement le défaut que la sonde du 23/09/2026 a montré (latest = 0.1.5-rc.3
// alors que alpha = 0.1.7-alpha.2 — installer latest aurait RÉGRESSÉ le moteur).
async function chaineDAssurer () {
  if (opts.versionCible !== null) {
    console.log('  (version demandée explicitement : ' + opts.versionCible + ')')
    return opts.versionCible
  }
  const relever = async (quoi) => {
    const r = await execReel(['npm', 'view', '@deepseek-ai/dsh', quoi, '--json'])
    if (r.code !== 0) {
      const detail = (r.err || r.sortie || '').trim()
      quitter(1, '🔴 impossible de lire les versions publiées (`npm view @deepseek-ai/dsh ' + quoi + '` a échoué) :\n' +
        (detail === '' ? '   npm n\'a rien répondu — est-il installé et sur le PATH ?' : '   ' + detail.slice(0, 300)) +
        '\n   Rien n\'a été installé. Vérifie ta connexion et npm, puis relance.')
    }
    try { return JSON.parse(r.sortie) } catch (e) { quitter(1, '🔴 sortie npm illisible pour ' + quoi) }
  }
  const tags = await relever('dist-tags') || {}
  const zone = lireCompat({ fs: fsReel, chemin: COMPAT_CHEMIN })?.dsh ?? null
  const dedans = (v) => zone === null || zone.min === undefined ||
    (comparerVersions(v, zone.min) >= 0 && comparerVersions(v, zone.max) <= 0)
  const ligne = 'alpha ' + (tags.alpha ?? '—') + ' · next ' + (tags.next ?? '—') + ' · latest ' + (tags.latest ?? '—')
  // Le choix DOIT rester dans la zone éprouvée. Mesuré le 23/09/2026 : `alpha`
  // valait 0.1.7-alpha.2, un cran AU-DESSUS du max testé — le robot aurait donc
  // posé un moteur, puis refusé sa propre installation, à chaque fois, sur
  // toute machine neuve. Une étiquette hors zone n'est pas un choix.
  for (const canal of ['alpha', 'next', 'latest']) {
    if (tags[canal] !== undefined && dedans(tags[canal])) {
      console.log('  (relevé en direct — ' + ligne + ' → on épingle ' + tags[canal] + ', dans la zone éprouvée)')
      return tags[canal]
    }
  }
  const versions = await relever('versions') || []
  const candidates = (Array.isArray(versions) ? versions : []).filter(dedans).sort(comparerVersions)
  const choix = candidates[candidates.length - 1]
  if (choix === undefined) {
    quitter(1, '🔴 aucune version publiée n\'est dans la zone éprouvée' +
      (zone === null ? '' : ' (' + zone.min + ' … ' + zone.max + ')') + '.\n' +
      '   Relevé : ' + ligne + '.\n' +
      '   Deux issues : attends une version testée, ou force avec --force après avoir lu ce que la zone dit.')
  }
  console.log('  (relevé en direct — ' + ligne + ' · aucune étiquette alpha/next/latest n\'est dans la zone éprouvée' +
    (zone === null ? '' : ' ' + zone.min + ' … ' + zone.max) + ' → on épingle la plus haute testée : ' + choix + ')')
  return choix
}

async function installerMoteur (cible, opts = {}) {
  // `tolere` : lever au lieu de sortir. L'installation n'a rien à remettre en
  // place avant d'avoir écrit, donc elle peut sortir ; la mise à jour, elle, a
  // déjà pris une photo et DOIT passer par son `catch` pour la restaurer.
  const echouer = (message) => {
    if (opts.tolere === true) throw new Error(message)
    quitter(1, message)
  }
  const projet = join(MOTEUR_DIR, cible)
  mkdirSync(projet, { recursive: true })
  const manifeste = {
    name: 'kybernos-moteur',
    version: '1.0.0',
    private: true,
    dependencies: { '@deepseek-ai/dsh': cible },
    overrides: Object.fromEntries(PAQUETS_EPINGLES.map((p) => ['@deepseek-ai/' + p, cible])),
  }
  writeFileSync(join(projet, 'package.json'), JSON.stringify(manifeste, null, 2) + '\n')
  console.log('  ⬇ npm install @deepseek-ai/dsh@' + cible + ' épinglé (' + PAQUETS_EPINGLES.length + ' sous-paquets) …')
  console.log('     (arbre de référence dans ' + projet + ')')
  // `--allow-scripts` est refusé pour une installation de projet (mesuré :
  // « EALLOWSCRIPTS — not allowed in project-scoped installs »). npm se contente
  // d'un avertissement, et le moteur tourne sans ces scripts post-installation.
  // 10 minutes : `npm install` sur un Windows a froid (ou une connexion de
  // beta-testeur) depasse largement les 3 minutes. Mesure du 23/09/2026 : le
  // coureur windows-latest a ete coupe a 180 s, avec des flux vides.
  const r = await execReel(['npm', 'install', '--no-audit', '--no-fund'], projet, 600000)
  if (r.code !== 0) {
    const cause = r.delaiDepasse === true
      ? 'delai depasse (' + Math.round(r.delaiMs / 1000) + ' s) — reseau lent ou machine froide, relance'
      : 'code ' + r.code + ' · ' + (r.err || r.sortie || '(npm n\'a rien dit)').slice(0, 400)
    echouer('🔴 npm a échoué : ' + cause)
  }
  const moteur = join(projet, 'node_modules', '@deepseek-ai', 'dsh')
  if (existsSync(moteur) === false) echouer('🔴 npm n\'a pas posé @deepseek-ai/dsh dans ' + projet)

  // Le binaire est lié dans le préfixe GLOBAL : c'est ce dossier qui est déjà
  // sur le PATH du testeur, donc son geste (`dsh web`) ne change pas. On ne
  // suppose pas que le PATH y pointe déjà (même piège qu'avant : « moteur posé »
  // suivi de « aucun moteur lisible »).
  const p = await execReel(['npm', 'prefix', '-g'])
  const prefixe = (p.sortie || '').trim()
  if (p.code === 0 && prefixe !== '') {
    const win = famille() === 'windows'
    const bin = win ? prefixe : join(prefixe, 'bin')
    mkdirSync(bin, { recursive: true })
    const vrai = join(projet, 'node_modules', '.bin', win ? 'dsh.cmd' : 'dsh')
    const lien = join(bin, win ? 'dsh.cmd' : 'dsh')
    rmSync(lien, { force: true })
    if (existsSync(vrai) === false) echouer('🔴 le binaire dsh n\'est pas là où npm a installé : ' + vrai)
    if (win) {
      // Windows : un lien symbolique demande des droits ; un relais qui appelle
      // le vrai .cmd par chemin ABSOLU marche sans rien supposer.
      writeFileSync(lien, '@echo off\r\ncall "' + vrai + '" %*\r\n')
    } else {
      symlinkSync(vrai, lien)
    }
    const sep = win ? ';' : ':'
    const actuel = process.env.PATH || ''
    if (!actuel.split(sep).includes(bin)) process.env.PATH = bin + sep + actuel
    // Le moteur vient de CHANGER : tout ce qui a été résolu avant (racine des
    // retouches, audit des surfaces) désignait l'ancien arbre.
    RACINE_CACHE = null
    console.log('  (dsh lié dans ' + lien + ')')
  }
  const vu = await versionDuGlobal({ exec: execReel })
  if (vu === null) {
    echouer('🔴 le moteur ' + cible + ' est posé, mais `dsh` ne répond toujours pas.\n' +
      '   Ouvre un NOUVEAU terminal (le PATH de celui-ci date d\'avant l\'installation), puis relance :\n' +
      '     ' + (famille() === 'windows' ? 'kybernos-install' : './kybernos-install'))
  }
  console.log('  ✓ moteur ' + vu + ' posé et joignable' + (vu === cible ? '' : ' (⚠ attendu ' + cible + ')'))
}

const source = await preparerSource()

if (ordre === 'satellites') {
  // Modèle 3 : gestion des satellites. Lister, activer, désactiver.
  //   satellites --liste                → état actuel (actifs/inactifs)
  //   satellites --activer <nom> [...]  → active ces satellites
  //   satellites --desactiver <nom>...  → les désactive
  //   satellites --tout                 → active tout (réinitialise)
  const manifeste = LIRE_SATELLITES(REPO)
  if (manifeste === null) quitter(1, '✗ docs/beta/satellites.json illisible')
  const tous = TOUS_LES_SATELLITES(REPO)
  const socle = (manifeste.socle?.bundles ?? []).map((b) => b.nom)
  const lireActives = () => {
    try {
      const brut = JSON.parse(readFileSync(SATELLITES_ACTIVES_FICHIER, 'utf8'))
      return Array.isArray(brut) ? brut : Array.isArray(brut?.actives) ? brut.actives : []
    } catch (e) { return [] }
  }
  const ecrireActives = (liste) => {
    mkdirSync(join(DSH_HOME, 'kybernos'), { recursive: true })
    writeFileSync(SATELLITES_ACTIVES_FICHIER, JSON.stringify({ actives: liste, maj: new Date().toISOString() }, null, 2) + '\n')
  }
  const argsSat = args.filter((a, i) => i > 0 && !a.startsWith('--') && args[i - 1] !== '--liste')
  if (args.includes('--liste') || args.length === 1) {
    const actives = lireActives()
    const actifsSet = new Set([...socle, ...actives])
    console.log('Satellites Kybernos — état d\'activation')
    console.log('')
    console.log('SOCLE (toujours actif)')
    for (const s of (manifeste.socle?.bundles ?? [])) {
      console.log('  ✓ ' + s.nom.padEnd(28) + ' tier ' + s.tier + '  ' + s.role)
    }
    console.log('')
    console.log('SATELLITES')
    for (const s of (manifeste.satellites?.bundles ?? [])) {
      const actif = actifsSet.has(s.nom)
      console.log('  ' + (actif ? '✓' : '·') + ' ' + s.nom.padEnd(28) + ' tier ' + s.tier + '  ' + (actif ? 'ACTIF' : 'inactif') + '  ' + s.role)
    }
    console.log('')
    console.log('Fichier d\'activation : ' + SATELLITES_ACTIVES_FICHIER)
    process.exit(0)
  }
  if (args.includes('--tout')) {
    ecrireActives(tous.map((s) => s.nom))
    console.log('✓ tous les satellites activés (' + tous.length + ')')
    process.exit(0)
  }
  if (args.includes('--activer')) {
    const noms = argsSat.filter((a) => tous.some((s) => s.nom === a || s.dir === a))
    if (noms.length === 0) quitter(1, '✗ --activer attend au moins un nom de satellite')
    const actuelles = lireActives()
    const nouvelles = [...new Set([...actuelles, ...noms.map((n) => tous.find((s) => s.nom === n || s.dir === n).nom)])]
    ecrireActives(nouvelles)
    console.log('✓ activés : ' + noms.join(', '))
    console.log('  total actif : ' + nouvelles.length + ' satellite(s)')
    process.exit(0)
  }
  if (args.includes('--desactiver')) {
    const noms = argsSat.filter((a) => tous.some((s) => s.nom === a || s.dir === a))
    if (noms.length === 0) quitter(1, '✗ --desactiver attend au moins un nom de satellite')
    const nomsComplets = noms.map((n) => tous.find((s) => s.nom === n || s.dir === n).nom)
    // Le socle ne se désactive jamais
    const interdits = nomsComplets.filter((n) => socle.includes(n))
    if (interdits.length > 0) quitter(1, '✗ le socle ne se désactive pas : ' + interdits.join(', '))
    const actuelles = lireActives()
    const nouvelles = actuelles.filter((n) => !nomsComplets.includes(n))
    ecrireActives(nouvelles)
    console.log('✓ désactivés : ' + noms.join(', '))
    console.log('  total actif : ' + nouvelles.length + ' satellite(s)')
    process.exit(0)
  }
  quitter(1, 'Usage : satellites [--liste | --tout | --activer <nom>… | --desactiver <nom>…]')
}

if (ordre === 'doctor') {
  const etat = await etatDoctor({ fs: fsReel, exec: execReel, profilDir: PROFIL_DIR, repoDir: REPO, packages: PACKAGES_ACTIFS, patches: PATCHES, compatChemin: COMPAT_CHEMIN })
  const verresPatchs = []
  const racine = await racineGlobale()
  const retirees = []
  for (const p of PATCHES) {
    const r = await execReel(['node', join(ICI, p.script), '--check', ...avecDsh(racine)], REPO)
    // Une retouche RETIRÉE est attendue ABSENTE : qu'elle soit encore posée est
    // un écart (l'installation n'a pas suivi), pas un succès à compter.
    if (p.retire !== undefined) {
      retirees.push({ id: p.id, motif: p.retire, encorePosee: r.code === 0 })
      if (r.code === 0) etat.problemes.push(`la retouche « ${p.id} » est retirée mais encore posée dans le moteur — relance l'installation pour la retirer`)
      continue
    }
    verresPatchs.push({ id: p.id, pose: r.code === 0 })
    if (r.code !== 0) etat.problemes.push(`la retouche « ${p.id} » n'est pas posée dans le moteur`)
  }
  etat.retirees = retirees
  // Le serveur qui tourne sert-il le moteur qui est sur le disque ? Un serveur
  // plus ancien que la dernière installation sert l'ancienne version depuis sa
  // mémoire — c'est ce mélange qui affichait « Failed to load plugins ».
  const fraicheur = await mesurerFraicheur()
  etat.fraicheur = fraicheur
  if (fraicheur.perime === true) etat.problemes.push(fraicheur.raison)
  // ── les SURFACES du moteur ───────────────────────────────────────────────
  // Une retouche « posée » ne dit pas que son ancre existe encore : la montée
  // 0.1.6 → 0.1.7 a cassé quatre contrats en silence (settings.get,
  // AgentPreset.path, l'arité de sessionVisible/deriveFlat, des icônes
  // renommées). On audite donc les contrats à chaque doctor, et on signale
  // aussi ce que le moteur livre désormais en natif (doublon ou capacité non
  // montée). `--ref <racine>` mesure les sondes « absent » sur un banc nu.
  const iRef = args.indexOf('--ref')
  const audit = auditerSurfaces(racine, { racineVierge: iRef >= 0 ? args[iRef + 1] : null })
  etat.surfaces = {
    conformes: audit.sondes.filter((s) => s.ok).length,
    total: audit.sondes.length,
    mesureesSurVierge: audit.sondes.filter((s) => s.sur === 'vierge').length,
    ruptures: audit.ruptures,
    aVerifier: audit.aVerifier,
    doublons: audit.doublons,
    natifs: audit.natifs
  }
  for (const r of audit.ruptures) etat.problemes.push(r)
  etat.couleur = etat.problemes.length === 0 ? 'verte' : 'orange'
  // La fiche du serveur entre dans le JSON : la recette des scénarios (§15 G)
  // compare `doctor --json` d'une machine à l'autre, elle a donc besoin du pid,
  // des dates ET de la source qui a mesuré.
  etat.plateforme = { os: process.platform, famille: famille(), supervision: nomSuperviseur(famille()) }
  etat.serveur = {
    pid: fraicheur.pid ?? null,
    demarrageServeur: fraicheur.demarrageServeur ?? null,
    installation: fraicheur.installation ?? null,
    sourcePid: fraicheur.sourcePid ?? null,
    sourceDemarrage: fraicheur.sourceDemarrage ?? null,
    verdict: fraicheur.verdict ?? null,
    perime: fraicheur.perime ?? null,
    raison: fraicheur.raison ?? null,
  }
  if (opts.json) { console.log(JSON.stringify({ ...etat, patches: verresPatchs })); process.exit(etat.couleur === 'verte' ? 0 : 1) }
  console.log(`\n  Moteur DSH : ${etat.global ?? 'absent (pas sur le PATH)'}   Plugin : ${etat.plugin}`)
  console.log(`  État : ${etat.couleur === 'verte' ? '🟢 tout va bien' : '🟠 à corriger'}`)
  // Le PREFLIGHT : ce qui est disponible ICI, et par quoi on a mesuré. Un
  // testeur sous Windows doit pouvoir le lire — pas supposer que c'est `lsof`.
  const fam = famille()
  const par = []
  if (fraicheur.sourcePid !== null && fraicheur.sourcePid !== undefined) par.push(fraicheur.sourcePid)
  if (fraicheur.sourceDemarrage !== null && fraicheur.sourceDemarrage !== undefined) par.push(fraicheur.sourceDemarrage)
  console.log(`  Plateforme : ${process.platform} (${fam}) — supervision ${nomSuperviseur(fam)}` +
    (par.length === 0 ? ' — serveur mesuré par aucune source' : ' — serveur mesuré via ' + par.join(' + ')))
  console.log(`  Serveur : ${fraicheur.verdict === 'frais' ? '✓ postérieur à l\'installation' : (fraicheur.perime === true ? '✗ antérieur à l\'installation' : '○ ' + fraicheur.raison)}`)
  if (etat.problemes.length > 0) { console.log('  Problèmes :'); for (const p of etat.problemes) console.log('    · ' + p) }
  console.log(`  Retouches : ${verresPatchs.filter((p) => p.pose).length}/${verresPatchs.length} posées`)
  for (const r of retirees) {
    console.log(`    · ${r.id} — retirée${r.encorePosee ? ' (ENCORE POSÉE : relance l\'installation)' : ''} (${r.motif})`)
  }
  console.log(`  Surfaces  : ${etat.surfaces.conformes}/${etat.surfaces.total} contrats du moteur conformes` +
    (etat.surfaces.mesureesSurVierge > 0 ? ` (${etat.surfaces.mesureesSurVierge} mesurés sur une sauvegarde vierge)` : '') +
    (etat.surfaces.aVerifier.length > 0 ? ` — ${etat.surfaces.aVerifier.length} à vérifier sur un moteur nu (--ref <racine>)` : ''))
  const livres = etat.surfaces.natifs.filter((n) => n.livre)
  if (livres.length > 0) console.log(`  Natif     : ${livres.length} capacités livrées par le moteur — ${livres.map((n) => n.quoi.split(' ')[0] + ' ' + n.paquet.replace(/^dsh-(experimental-)?/, '')).join(' ; ')}`)
  for (const d of etat.surfaces.doublons) console.log(`    ↳ ${d}`)
  const j = lireJournal({ fs: fsReel, journal: JOURNAL, limite: 3 })
  if (j.length > 0) console.log(`  Dernière opération : ${j[0].quoi} ${j[0].de} → ${j[0].vers} (${j[0].resultat})`)
  process.exit(etat.couleur === 'verte' ? 0 : 1)
}

// ── la porte : geste n°1 de install ET upgrade ────────────────────────────
async function porteCompat (cible) {
  if (cible === null || cible === undefined) {
    quitter(1, '🔴 aucun moteur DSH lisible (`dsh --version` ne répond pas).\n' +
      '   Pose-le d\'abord — `./kybernos-install` s\'en charge — puis relance.')
  }
  const compat = lireCompat({ fs: fsReel, chemin: COMPAT_CHEMIN })
  const v = testerCompatibilite({ cible, compat, force: opts.force })
  if (v.verdict === 'refuse') quitter(1, '\n🔴 ' + v.raison)
  if (v.avertissement) console.log('\n🟠 ' + v.raison)
  return v
}

async function photoAvantTout (versions) {
  const photo = await photographier({ fs: fsReel, profilDir: PROFIL_DIR, photosDir: PHOTOS_DIR, horodatage: horodatage(), versions, horloge: horlogeReelle })
  console.log('  📸 photo de sécurité : ' + photo.dossier)
  return photo
}

// ── INSTALL : greffer le plugin sur un profil ─────────────────────────────
// Le corps de l'installation, extrait pour être appelé par `install` ET par
// `bootstrap` : les deux scénarios de la bêta finissent par le même geste.
async function faireInstall () {
  const cible = await versionDuGlobal({ exec: execReel })
  await porteCompat(cible)
  if (opts.dry) {
    quitter(0, '\n  (dry-run : source ' + REPO + ', moteur ' + cible + ' — rien n\'a été modifié)\n' +
      instructionsRedemarrage(famille(), portGui))
  }
  const versions = { global: cible, plugin: await versionDuPlugin({ exec: execReel, repoDir: REPO }) }
  const photo = await photoAvantTout(versions)
  // Sur une machine NEUVE, le profil n'existe pas encore : `alignerLiens` et
  // `poserPatchs` ecrivent DEDANS (package.json, cordis.patch.yml). L'ordre
  // historique (lier -> patcher -> installer) marchait seulement parce que le
  // profil existait deja. Mesure du 23/09/2026 en scenario B isole : ENOENT
  // package.json des `alignerLiens`. On demande donc d'abord a DSH de creer le
  // profil (194 ms sur un HOME nu), puis on le remplit.
  if (!existsSync(join(PROFIL_DIR, 'package.json'))) {
    console.log('  🧱 le profil n\'existe pas encore — DSH le crée (cas normal d\'une machine neuve)…')
    await installerProfil()
  }
  console.log('  🔗 liaison des paquets du dépôt vers le profil…')
  alignerLiens({ fs: fsReel, profilDir: PROFIL_DIR, repoDir: REPO, packages: PACKAGES, actives: ACTIVES })
  console.log('  📦 installation du profil (pnpm)…')
  await installerProfil()
  // Les retouches touchent les paquets `@deepseek-ai/*` du PROFIL (l'installation
  // globale ne porte que le paquet `dsh` depuis 0.1.7). Les poser avant le pnpm
  // du profil revient a patcher un dossier vide : mesure du 23/09/2026 en
  // scenario B isole — `queue-move` et `model-search` ✗ sur un moteur neuf, ✓ sur
  // une machine ou le profil est deja peuple. On patche donc APRES l'installation
  // qui les rend presents.
  console.log('  🧶 re-pose des retouches du moteur…')
  try {
    await poserPatchs()
  } catch (e) {
    // Une retouche non posable est une fonctionnalite perdue : on ne continue
    // pas et on ne laisse pas non plus une stack trace au testeur.
    const date = new Date().toISOString()
    console.log('  ❌ ' + e.message)
    console.log('  ↩ retour à l\'état d\'avant la photo')
    await restaurerPhoto({ fs: fsReel, photosDir: PHOTOS_DIR, photoDossier: photo.dossier, profilDir: PROFIL_DIR })
    await journalOp({ date, quoi: 'plugin', de: '—', vers: versions.plugin, resultat: 'echec', raison: e.message, photo: photo.dossier })
    quitter(1, '\n🔴 installation interrompue avant la fin — ta machine est revenue à l\'état d\'avant. Rien n\'a changé.')
  }
  console.log('  🔎 vérification du boot…')
  const boot = await verifierBoot(opts.url)
  const date = new Date().toISOString()
  if (!boot.ok) {
    console.log('  ❌ le boot échoue — retour à l\'état d\'avant la photo')
    await restaurerPhoto({ fs: fsReel, photosDir: PHOTOS_DIR, photoDossier: photo.dossier, profilDir: PROFIL_DIR })
    await poserPatchs({ tolerance: true })
    await journalOp({ date, quoi: 'plugin', de: '—', vers: versions.plugin, resultat: 'echec', raison: 'boot échoué, photo remise', photo: photo.dossier })
    quitter(1, '\n🔴 l\'installation a échoué — ta machine est revenue à l\'état d\'avant. Rien n\'a changé.')
  }
  await journalOp({ date, quoi: 'plugin', de: '—', vers: versions.plugin, resultat: 'reussi', raison: 'installation', photo: photo.dossier })
  if (opts.relancer) {
    if (!opts.force) quitter(1, '\n  --relancer éteint le DSH qui tourne. Ajoute --force si c\'est bien ce que tu veux.')
    const suite = await relancerDsh(portGui)
    if (!suite.ok) {
      await journalOp({ date, quoi: 'plugin', de: '—', vers: versions.plugin, resultat: 'reussi', raison: 'installation, redémarrage raté : ' + suite.raison, photo: photo.dossier })
      quitter(1, '\n🟠 le plugin est installé, mais le redémarrage a échoué : ' + suite.raison +
        '\n   Relance DSH toi-même, puis recharge la page.')
    }
    quitter(0, '\n🟢 installation réussie, DSH redémarré (pid ' + suite.pid + '). Recharge la page DSH pour voir Kybernos.')
  }
  quitter(0, '\n🟢 installation réussie.\n' + instructionsRedemarrage(famille(), portGui))
}

if (ordre === 'install') await faireInstall()

// ── BOOTSTRAP : les DEUX entrées de la bêta, dans un seul ordre ───────────
//   A. le testeur a déjà DSH → on ne touche pas au moteur, on greffe le plugin ;
//   B. la machine est nue     → on pose d'abord le moteur, épinglé.
// La décision est MESURÉE (`dsh --version`), pas demandée : un testeur ne doit
// pas avoir à savoir dans quel cas il est.
if (ordre === 'bootstrap') {
  const global = await versionDuGlobal({ exec: execReel })
  console.log('\n  Scénario ' + (global === null ? 'B — la machine n\'a pas encore DSH' : 'A — DSH ' + global + ' est déjà installé'))
  if (global === null) {
    const cible = await chaineDAssurer()
    const serv = await pidSurPort(portGui)
    if (serv.valeur !== null) {
      // D7 : refus, puis LA COMMANDE EXACTE. Jamais de sudo, jamais d'escalade.
      quitter(1, '🔴 un serveur DSH répond sur le port ' + portGui + ' (pid ' + serv.valeur + ') alors que `dsh` n\'est pas sur le PATH.\n' +
        '   Je ne touche pas à une installation que je ne sais pas lire. Si c\'est bien la tienne, pose le moteur toi-même :\n' +
        '     npm i -g @deepseek-ai/dsh@' + cible + ' ' + ALLOW_SCRIPTS + '\n' +
        '   (et sache qu\'à lui seul, `npm i -g` n\'épingle pas les sous-paquets que le plugin retouche :\n' +
        '    le robot pose, lui, un arbre épinglé dans ' + MOTEUR_DIR + ')')
    }
    if (opts.dry) {
      quitter(0, '\n  (dry-run : le moteur ' + cible + ' serait posé, puis le plugin — rien n\'a été modifié)\n' +
        instructionsRedemarrage(famille(), portGui))
    }
    await installerMoteur(cible)
  } else if (opts.dry) {
    quitter(0, '\n  (dry-run : le plugin serait greffé sur le moteur ' + global + ' — rien n\'a été modifié)\n' +
      instructionsRedemarrage(famille(), portGui))
  }
  await faireInstall()
}

// ── UPGRADE : les 8 gestes ───────────────────────────────────────────────
if (ordre === 'upgrade') {
  const depuis = await versionDuGlobal({ exec: execReel })
  const cible = opts.versionCible || depuis
  const v = await porteCompat(cible)
  const versions = { global: cible, plugin: await versionDuPlugin({ exec: execReel, repoDir: REPO }) }
  const plan = planUpgrade({ cible, depuis, compatVerdict: v.verdict, aDesBundles: true })
  console.log('\n  Plan : ' + plan.join(' → '))
  if (opts.dry) quitter(0, '\n  (dry-run : rien n\'a été modifié)')

  const photo = await photoAvantTout({ global: depuis, plugin: versions.plugin })
  const date = new Date().toISOString()
  try {
    if (plan.includes('remplacer-moteur')) {
      console.log(`  🔄 moteur DSH ${depuis} → ${cible}…`)
      // Par le même chemin que l'installation — arbre épinglé dans le foyer, puis
      // lien dans le préfixe. Mesuré le 23/09/2026 : `npm i -g` ici échouait en
      // EEXIST sur `prefix/bin/dsh` (le lien que NOTRE installation venait de
      // poser), donc la PREMIÈRE mise à jour de moteur était morte pour tout
      // testeur — et, même réussie, elle n'aurait posé aucun des sous-paquets
      // épinglés que le plugin retouche.
      await installerMoteur(cible, { tolere: true })
    }
    console.log('  📝 alignement de la fiche de réglages (pins @deepseek-ai → ' + cible + ')…')
    const pkgProfil = JSON.parse(fsReel.lire(join(PROFIL_DIR, 'package.json')))
    const nomsDsh = Object.keys(pkgProfil.dependencies || {}).filter((k) => k.startsWith('@deepseek-ai/'))
    const publiees = await versionsPubliees(nomsDsh)
    const alignement = alignerPins({ fs: fsReel, profilDir: PROFIL_DIR, cible, disponibles: publiees })
    for (const r of alignement.retires) {
      console.log(`     ⚠ ${r.nom} n'est pas publié en ${cible} (dernière : ${r.derniere ?? 'inconnue'}) — retiré du profil`)
    }
    for (const b of alignement.bundlesRetires) console.log(`       ↳ bundle retiré : ${b}`)
    alignerLiens({ fs: fsReel, profilDir: PROFIL_DIR, repoDir: REPO, packages: PACKAGES, actives: ACTIVES })
    console.log('  🧶 re-pose des retouches du moteur…')
    await poserPatchs()
    console.log('  📦 installation du profil (pnpm)…')
    await installerProfil()
    console.log('  🔎 vérification du boot…')
    const boot = await verifierBoot(opts.url)
    if (!boot.ok) throw new Error('boot échoué')
    await journalOp({ date, quoi: 'moteur', de: depuis, vers: cible, resultat: 'reussi', photo: photo.dossier })
    quitter(0, `\n🟢 mise à jour réussie : moteur ${depuis} → ${cible}, plugin ${versions.plugin}. Recharge la page DSH.`)
  } catch (e) {
    console.log('\n  ❌ ' + (e.message || e) + ' — retour à la photo')
    await restaurerPhoto({ fs: fsReel, photosDir: PHOTOS_DIR, photoDossier: photo.dossier, profilDir: PROFIL_DIR })
    // le moteur ET les retouches reviennent à la version d'origine
    if (depuis !== cible) {
      // Retour au moteur d'avant par le même chemin (arbre épinglé + lien).
      try { await installerMoteur(depuis, { tolere: true }) } catch (e) { console.log('  ⚠ retour du moteur ' + depuis + ' : ' + (e.message || e)) }
    }
    await poserPatchs({ tolerance: true })
    await installerProfil()
    await journalOp({ date, quoi: 'moteur', de: cible, vers: depuis, resultat: 'retour-arriere', raison: String(e.message || e).slice(0, 200), photo: photo.dossier })
    quitter(1, '\n🟠 la mise à jour a échoué — ta machine est revenue à l\'état d\'avant. Rien n\'a changé.')
  }
}

// ── ROLLBACK : le bouton d'urgence ─────────────────────────────────────────
if (ordre === 'rollback') {
  const avant = await versionDuGlobal({ exec: execReel })
  const r = await restaurerPhoto({ fs: fsReel, photosDir: PHOTOS_DIR, photoDossier: opts.photo, profilDir: PROFIL_DIR })
  console.log('  📸 photo restaurée : ' + r.dossier + ' (' + r.recopies.join(', ') + ')')
  await installerProfil()
  await poserPatchs({ tolerance: true })
  const apres = await versionDuGlobal({ exec: execReel })
  await journalOp({ date: new Date().toISOString(), quoi: 'moteur', de: avant, vers: apres, resultat: 'retour-arriere', raison: 'rollback demandé', photo: r.dossier })
  quitter(0, '\n🟢 retour arrière terminé. Recharge la page DSH.')
}

// ── UNINSTALL : retirer proprement, sans casser le reste ───────────────────
if (ordre === 'uninstall') {
  const versions = { global: await versionDuGlobal({ exec: execReel }), plugin: await versionDuPlugin({ exec: execReel, repoDir: REPO }) }
  const photo = await photoAvantTout(versions)
  const pkg = JSON.parse(fsReel.lire(join(PROFIL_DIR, 'package.json')))
  for (const p of PACKAGES) {
    delete pkg.dependencies?.[p.nom]
    const i = pkg.dsh?.profile?.bundles?.indexOf(p.nom) ?? -1
    if (i >= 0) pkg.dsh.profile.bundles.splice(i, 1)
  }
  fsReel.ecrire(join(PROFIL_DIR, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  console.log('  🧹 liens et bundles retirés du profil (le reste est intact)')
  await journalOp({ date: new Date().toISOString(), quoi: 'plugin', de: versions.plugin, vers: '—', resultat: 'reussi', raison: 'désinstallation', photo: photo.dossier })
  quitter(0, '\n🟢 plugin retiré. Relance dsh plugin --profile web install pour finaliser.')
}

// ── VERIFY : boot seul ────────────────────────────────────────────────────
if (ordre === 'verify') {
  const boot = await verifierBoot(opts.url)
  quitter(boot.ok ? 0 : 1, boot.ok ? '\n🟢 le boot est sain.' : '\n🔴 le boot échoue.\n' + boot.sortie.slice(0, 600))
}

quitter(64, 'Usage : dsh-lifecycle.mjs doctor|install|upgrade|rollback|uninstall|verify [--force] [--dry] [--json] [--url <url>] [version]')