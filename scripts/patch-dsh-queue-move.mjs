// ── File d'attente : rejouer le patch du réordonnancement après une mise à jour ─
//
// DSH ne sait pas réordonner sa propre file : `updateQueue` n'accepte que
// edit / remove / steer, et le contrat est une union fermée recopiée dans trois
// codecs (hôte, contrôleur, client navigateur). Personne ne peut donc ajouter ce
// verbe depuis un plugin : la fonctionnalité vit dans les paquets installés —
// six fichiers décrits dans docs/handoff/file-attente-reorder/PATCH.md — qu'une
// mise à jour de DSH réécrit sans rien dire.
//
// Les diffs exacts vivent dans le dépôt, un par version de DSH :
//
//   scripts/dsh-queue-move.patch      produit contre 0.1.6-alpha.2
//   scripts/dsh-queue-move-017.patch  produit contre 0.1.7-alpha.1
//
// Ce script les repose, de façon IDEMPOTENTE, en choisissant la variante d'après
// la version détectée de l'installation visée. `--check` dit l'état sans écrire ;
// après une pose, le même contrôle que la suite est rejoué
// (scripts/check-queue-move.mjs, 56 assertions).
//
// Le patch s'applique dans un bac hors dépôt (copie temporaire des six
// fichiers) puis les fichiers obtenus sont recopiés en place : `git apply` ne
// raisonne en chemins purs que hors dépôt — dans un dépôt, il saute
// silencieusement tout chemin hors de son sous-dossier courant (l'installation
// DSH vit dans le dépôt Homebrew, sur cette machine).
//
// Usage :
//   node scripts/patch-dsh-queue-move.mjs                 # applique (idempotent)
//   node scripts/patch-dsh-queue-move.mjs --check         # vérifie, n'écrit rien
//   node scripts/patch-dsh-queue-move.mjs --revert        # retire le patch
//   node scripts/patch-dsh-queue-move.mjs --dsh <racine>  # une autre installation
//
// La variante du diff est choisie sur la version détectée (`package.json` de la
// racine visée) : 0.1.7 → `-017.patch`, 0.1.6 → le diff d'origine.
//
// Après une pose : redémarrer DSH (l'hôte charge ses paquets au démarrage) puis
// recharger la page de la GUI (la sonde de capacité est mise en cache par page).
//
// Sortie : 0 = conforme après l'opération ; 1 = écart (--check), conflit ou échec.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { racineDeclaree, resoudreCopie, refuserRacine, versionDuMoteur } from './racine-dsh.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CONTROLE = join(HERE, 'check-queue-move.mjs')
const BACKUP_SUFFIX = '.kybernos-queue-move.orig'
/**
 * Les variantes du diff, du plus récent au plus ancien. Une mise à jour de DSH
 * réécrit les six fichiers et déplace le voisinage des coutures (le bloc CSS de
 * QueueDock et l'union du codec embarqué ont bougé entre 0.1.6 et 0.1.7) : il
 * faut donc un diff par version cible. `motif` accepte les correctifs de la même
 * branche ; faute de correspondance, on retombe sur la dernière variante et on
 * le dit (le contrôle tranche).
 */
const VARIANTES = [
  { pour: '0.2.0-rc.2', fichier: 'dsh-queue-move-020rc2.patch', motif: /^0\.2\.0(?:[.-]|$)/ },
  { pour: '0.1.7-rc.2', fichier: 'dsh-queue-move-017rc2.patch', motif: /^0\.1\.7-rc(?:[.-]|$)/ },
  // alpha.2 : la ligne css$6 de QueueDock a dérivé entre alpha.1 et alpha.2
  // (run 36994264618 : le diff 017 ne s'appliquait plus en CI). Fusion 3 voies —
  // base alpha.1 patchée, cible alpha.2 — zéro conflit, 56/56 au contrôle.
  { pour: '0.1.7-alpha.2', fichier: 'dsh-queue-move-017a2.patch', motif: /^0\.1\.7-alpha(?:[.-]|$)/ },
  { pour: '0.1.7-alpha.1', fichier: 'dsh-queue-move-017.patch', motif: /^0\.1\.7(?:[.-]|$)/ },
  { pour: '0.1.6-alpha.2', fichier: 'dsh-queue-move.patch', motif: /^0\.1\.6(?:[.-]|$)/ },
]

const args = process.argv.slice(2)
const CHECK = args.indexOf('--check') >= 0
const REVERT = args.indexOf('--revert') >= 0

const sh = (cmd, argv, cwd) => spawnSync(cmd, argv, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const dit = (texte) => console.log(texte)
const erreur = (texte) => console.error(texte)

// ── Où vit l'installation à patcher ─────────────────────────────────────────
// La racine est DÉCLARÉE (`--dsh <dossier>`), jamais devinée : voir
// `racine-dsh.mjs` pour la raison (une sonde depuis le dépôt et un défaut
// Homebrew faisaient écrire dans une copie que DSH ne charge pas, et le « ✓ »
// local restait vert). On vérifie ici la cible déclarée dans `patches.json` :
// le robot ne nous appelle que sur une racine qui la porte.
const CIBLE = '@deepseek-ai/dsh-api-session-controller'
const racine = racineDeclaree(args)
const resolution = resoudreCopie(racine, CIBLE)
if (resolution.copie === null) refuserRacine(resolution.motif, 'patch-dsh-queue-move.mjs')
if (sh('git', ['--version'], ROOT).status !== 0) {
  erreur('✗ git est requis pour appliquer le diff')
  process.exit(1)
}

/** La version du MOTEUR visé : c'est elle qui choisit la variante. */
const version = versionDuMoteur(resolution.moteur) ?? '?'
const variante = VARIANTES.find((v) => v.motif.test(version)) ?? VARIANTES[VARIANTES.length - 1]
const PATCH = join(HERE, variante.fichier)
/** La version contre laquelle le diff retenu a été produit : avertissement, pas refus. */
const PATCH_POUR = variante.pour
if (existsSync(PATCH) !== true) {
  erreur('✗ diff introuvable pour DSH ' + version + ' : ' + PATCH)
  process.exit(1)
}

/** Les fichiers visés, lus dans le diff lui-même (aucune liste à tenir à jour). */
const fichiers = readFileSync(PATCH, 'utf8').split('\n')
  .filter((ligne) => ligne.startsWith('diff --git ') === true)
  .map((ligne) => {
    const trouve = /^diff --git a\/(\S+) b\//.exec(ligne)
    return trouve === null ? null : trouve[1]
  })
  .filter((rel) => rel !== null)
if (fichiers.length === 0) {
  erreur('✗ diff illisible (aucun « diff --git ») : ' + PATCH)
  process.exit(1)
}
/** Les chemins du diff sont relatifs à la BASE qui porte les paquets
 * (`node_modules/@deepseek-ai/…`) — dans une installation par projet, ce n'est
 * PAS le dossier du moteur mais la racine du projet (mesuré le 23/09/2026). */
const cible = (rel) => join(resolution.base, rel)

// ── Le bac hors dépôt : les six fichiers copiés, prêts à être patchés ───────
const bac = mkdtempSync(join(tmpdir(), 'kybernos-queue-move-'))
process.on('exit', () => {
  try {
    rmSync(bac, { recursive: true, force: true })
  } catch {}
})
const manquants = fichiers.filter((rel) => existsSync(cible(rel)) !== true)
if (manquants.length > 0) {
  erreur('✗ fichier visé absent — rien n’a été écrit : ' + manquants.join(', '))
  process.exit(1)
}
for (const rel of fichiers) {
  mkdirSync(dirname(join(bac, rel)), { recursive: true })
  copyFileSync(cible(rel), join(bac, rel))
}

// ── L'état, vu par git dans le bac, sans rien écrire ────────────────────────
const gitApply = (options) => {
  const argv = ['apply', '--check']
  if (options.reverse === true) argv.push('-R')
  if (options.context !== undefined) argv.push('-C' + String(options.context))
  argv.push('-p1')
  if (options.rel !== undefined) argv.push('--include=' + options.rel)
  argv.push(PATCH)
  const r = sh('git', argv, bac)
  const detail = String(r.stderr || r.stdout || '').trim()
  // Un chemin sauté signifie qu'on applique depuis un dépôt : jamais un succès.
  if (detail.indexOf('Skipped patch') >= 0) return { ok: false, detail: 'chemin sauté par git (bac dans un dépôt ?)' }
  return { ok: r.status === 0, detail: detail }
}

/** 'pose' (déjà là), 'a-poser' (absent), ou 'conflit' (les deux échouent). */
const etatGlobal = (() => {
  if (gitApply({}).ok === true) return { etat: 'a-poser', context: undefined, detail: '' }
  if (gitApply({ reverse: true }).ok === true) return { etat: 'pose', context: undefined, detail: '' }
  const avant = gitApply({ context: 1 })
  if (avant.ok === true) return { etat: 'a-poser', context: 1, detail: 'contexte réduit à 1 ligne' }
  const arriere = gitApply({ reverse: true, context: 1 })
  if (arriere.ok === true) return { etat: 'pose', context: 1, detail: 'contexte réduit à 1 ligne' }
  return { etat: 'conflit', context: undefined, detail: arriere.detail || avant.detail }
})()

/** Les deux moitiés, sondées par leur code et non par la position des lignes. */
const SONDES = {
  // Le moteur de l'hôte et son contrat de fil : c'est la moitié qui pourrait
  // arriver en amont dans DSH.
  hote: [
    ['dsh-agent-loop/lib/index.js', 'move(messageId, beforeId)'],
    ['dsh-api-session-controller/lib/index.js', 'queue-move-across-lanes'],
    ['dsh-api-session-controller/lib/typert.host.js', 'literal("move")'],
  ],
  // Le navigateur : les deux copies du codec distant et le geste lui-même.
  client: [
    ['dsh-api-session-controller/lib/typert.remote-client.js', 'literal("move")'],
    ['dsh-api-remotes/lib/client.js', 'literal("move")'],
    ['dsh-client-ui-conversation/lib/client.js', 'queueMoveSupported'],
  ],
}
const sonder = (groupe) => SONDES[groupe].map(([rel, aiguille]) => {
  const fichier = cible('node_modules/@deepseek-ai/' + rel)
  const texte = existsSync(fichier) === true ? readFileSync(fichier, 'utf8') : ''
  return { rel: rel, aiguille: aiguille, present: texte.indexOf(aiguille) >= 0 }
})
const hote = sonder('hote')
const client = sonder('client')
const hoteOk = hote.every((sonde) => sonde.present === true)
const clientOk = client.every((sonde) => sonde.present === true)
/** Posé par un autre chemin (DSH a bougé les lignes) mais les deux moitiés sont là. */
const poseParCanaris = etatGlobal.etat === 'conflit' && hoteOk === true && clientOk === true
const moitieHote = etatGlobal.etat === 'conflit' && hoteOk === true && clientOk === false

// ── Rapport ─────────────────────────────────────────────────────────────────
dit('patch réordonnancement — ' + racine)
dit('  version DSH : ' + version + (version === PATCH_POUR ? '' : ' (diff produit pour ' + PATCH_POUR + ')'))
dit('  diff        : ' + variante.fichier + (version === PATCH_POUR ? '' : ' — repli : aucune variante pour ' + version))
if (etatGlobal.etat === 'pose') dit('  ✓ le diff est posé' + (etatGlobal.detail === '' ? '' : ' (' + etatGlobal.detail + ')'))
else if (etatGlobal.etat === 'a-poser') dit('  · le diff est absent (à poser)' + (etatGlobal.detail === '' ? '' : ' — ' + etatGlobal.detail))
else if (poseParCanaris === true) dit('  ✓ les deux moitiés répondent, mais le diff ne s’applique plus à l’identique (lignes décalées)')
else if (moitieHote === true) dit('  ✗ moitié hôte seule : l’hôte connaît « move », le navigateur ne l’offre pas')
else dit('  ✗ conflit : le diff ne s’applique ni ne se retire')
for (const rel of fichiers) {
  const enArriere = gitApply({ reverse: true, rel: rel, context: 1 }).ok
  const enAvant = gitApply({ rel: rel, context: 1 }).ok
  dit('    ' + (enArriere === true ? '✓' : enAvant === true ? '·' : '✗') + ' ' + rel + (enArriere === true ? ' — posé' : enAvant === true ? ' — à poser' : ' — conflit'))
}
if (etatGlobal.etat === 'conflit' && etatGlobal.detail !== '') dit('  détail git : ' + etatGlobal.detail.split('\n')[0])
if (moitieHote === true) {
  for (const sonde of client.filter((s) => s.present === false)) dit('    manque : ' + sonde.rel + ' → ' + sonde.aiguille)
}

// ── Les écritures ───────────────────────────────────────────────────────────
const sauvegarder = () => {
  for (const rel of fichiers) {
    const fichier = cible(rel)
    if (existsSync(fichier + BACKUP_SUFFIX) !== true) copyFileSync(fichier, fichier + BACKUP_SUFFIX)
  }
}
const restaurer = () => {
  for (const rel of fichiers) {
    const fichier = cible(rel)
    if (existsSync(fichier + BACKUP_SUFFIX) === true) copyFileSync(fichier + BACKUP_SUFFIX, fichier)
  }
}
/** Le bac a été patché : on recopie ses six fichiers en place. */
const poserDansLaRacine = () => {
  for (const rel of fichiers) copyFileSync(join(bac, rel), cible(rel))
}
const lancerDansLeBac = (context, reverse) => {
  const argv = ['apply']
  if (reverse === true) argv.push('-R')
  if (context !== undefined) argv.push('-C' + String(context))
  argv.push('-p1', PATCH)
  return sh('git', argv, bac)
}
/** Une faute de syntaxe casserait le paquet : on parse avant de rendre la main. */
const syntaxeOk = () => {
  for (const rel of fichiers) {
    const r = sh('node', ['--check', cible(rel)], ROOT)
    if (r.status !== 0) {
      erreur('✗ syntaxe invalide : ' + rel)
      erreur(String(r.stderr || '').split('\n').slice(0, 6).join('\n'))
      return false
    }
  }
  return true
}
const rejouerLeControle = () => {
  if (existsSync(CONTROLE) !== true) {
    dit('  (pas de contrôle local : ' + CONTROLE + ')')
    return 0
  }
  const r = sh('node', [CONTROLE, '--dsh', racine], ROOT)
  const sortie = String(r.stdout || '').trim().split('\n')
  dit('  ' + sortie.slice(-1)[0])
  if (r.status !== 0) erreur(String(r.stderr || '').trim())
  return r.status === 0 ? 0 : 1
}

if (CHECK === true) {
  const conforme = etatGlobal.etat === 'pose' || poseParCanaris === true
  dit(conforme === true ? '✓ patch conforme' : '✗ patch incomplet')
  process.exit(conforme === true ? 0 : 1)
}

if (REVERT === true) {
  if (poseParCanaris === true) {
    erreur('✗ lignes décalées : le retrait à l’identique est impossible — rien touché')
    process.exit(1)
  }
  if (etatGlobal.etat !== 'pose') {
    dit('· rien à retirer (le diff n’est pas posé)')
    process.exit(0)
  }
  const retrait = lancerDansLeBac(etatGlobal.context, true)
  if (retrait.status !== 0) {
    erreur('✗ retrait impossible : ' + String(retrait.stderr || '').trim().split('\n')[0])
    process.exit(1)
  }
  sauvegarder()
  poserDansLaRacine()
  if (syntaxeOk() !== true) {
    restaurer()
    erreur('✗ syntaxe invalide après retrait — fichiers restaurés')
    process.exit(1)
  }
  dit('✓ patch retiré')
  process.exit(0)
}

if (etatGlobal.etat === 'pose') {
  dit('· déjà posé, rien à faire')
  process.exit(0)
}
if (poseParCanaris === true) {
  dit('· les deux moitiés répondent (lignes décalées) — rien à faire')
  process.exit(0)
}
if (etatGlobal.etat === 'conflit') {
  erreur(moitieHote === true
    ? '✗ l’hôte connaît déjà « move » mais la moitié navigateur manque : le diff doit être réadapté à cette version.'
    : '✗ le diff ne s’applique pas : DSH a changé ces fichiers. Produire scripts/dsh-queue-move-<version>.patch et l’ajouter à VARIANTES (PATCH.md liste les coutures) — le diff choisi ici est ' + variante.fichier + '.')
  process.exit(1)
}

const pose = lancerDansLeBac(etatGlobal.context, false)
if (pose.status !== 0) {
  erreur('✗ application impossible : ' + String(pose.stderr || '').trim().split('\n')[0])
  process.exit(1)
}
sauvegarder()
poserDansLaRacine()
if (syntaxeOk() !== true) {
  restaurer()
  erreur('✗ syntaxe invalide après patch — fichiers restaurés')
  process.exit(1)
}
dit('✓ patch appliqué' + (etatGlobal.context === undefined ? '' : ' (contexte réduit)') + ' — sauvegardes : *' + BACKUP_SUFFIX)
const controle = rejouerLeControle()
if (controle !== 0) {
  restaurer()
  erreur('✗ le contrôle de bout en bout est rouge — fichiers restaurés (un patch non prouvé ne reste pas)')
  process.exit(1)
}
dit('→ redémarrer DSH, puis recharger la page de la GUI')
process.exit(0)
