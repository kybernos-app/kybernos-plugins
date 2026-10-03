// ═══════════════════════════════════════════════════════════════════════════
// lifecycle-engine — le cœur PUR du robot garagiste.
//
// Aucun accès disque/réseau direct : `fs` (lire/ecrire/existe/creerRep/copier),
// `exec` (async (cmd) => {code, sortie}) et l'horloge sont INJECTÉS. Le harnais
// unitaire (test-lifecycle-engine.mjs) teste ces fonctions sur des fixtures ;
// le CLI (dsh-lifecycle.mjs) leur passe le vrai disque.
//
// Invariants (DESIGN.md) : compat = geste n°1 ; photo avant toute écriture ;
// journal après toute opération ; la fiche suit toujours le global ; échec de
// boot → rollback automatique.
// ═══════════════════════════════════════════════════════════════════════════

import { join } from 'node:path'
import { dossierBundle } from './bundles.mjs'

export const DEPUIS_VERS = { obligatoire: true } // chaque journal dit « de X vers Y »

// ── horodatage canonique (injectable pour les tests) ──────────────────────
export const maintenant = (horloge) => new Date(horloge ? horloge() : Date.now())

// ── 1. compatibilité (le geste n°1 de TOUTE opération) ────────────────────

export function lireCompat ({ fs, chemin }) {
  try { return JSON.parse(fs.lire(chemin)) } catch (e) { return { dsh: {} } }
}

// Comparaison de versions SEGMENT PAR SEGMENT, jamais alphabétique : « 0.1.10 »
// est postérieur à « 0.1.7 », alors que la comparaison de chaînes dit le
// contraire — une porte qui refuse la bonne version (ou pire, laisse passer une
// version jamais testée) est un piège à retardement. Règles : segments
// numériques comparés comme des nombres, une version sans préfixe (`rc`) passe
// après la même avec préfixe (`alpha`), et à défaut on compare les préfixes
// alphabétiquement (alpha < beta < rc, ce qui est l'ordre semver habituel).
export function comparerVersions (a, b) {
  const decouper = (v) => {
    const [noyau, ...reste] = String(v).split('-')
    return { nombres: noyau.split('.').map((n) => parseInt(n, 10) || 0), pre: reste.join('-') }
  }
  const x = decouper(a)
  const y = decouper(b)
  const n = Math.max(x.nombres.length, y.nombres.length)
  for (let i = 0; i < n; i += 1) {
    const dx = x.nombres[i] ?? 0
    const dy = y.nombres[i] ?? 0
    if (dx !== dy) return dx < dy ? -1 : 1
  }
  if (x.pre === y.pre) return 0
  if (x.pre === '') return 1
  if (y.pre === '') return -1
  const seg = (p) => p.split('.')
  const px = seg(x.pre)
  const py = seg(y.pre)
  const m = Math.max(px.length, py.length)
  for (let i = 0; i < m; i += 1) {
    const sx = px[i]
    const sy = py[i]
    if (sx === undefined) return -1
    if (sy === undefined) return 1
    const nx = /^\d+$/.test(sx)
    const ny = /^\d+$/.test(sy)
    if (nx && ny) { if (Number(sx) !== Number(sy)) return Number(sx) < Number(sy) ? -1 : 1; continue }
    if (nx !== ny) return nx ? -1 : 1 // un numéro de préfixe passe avant un mot
    if (sx !== sy) return sx < sy ? -1 : 1
  }
  return 0
}

// ── 1bis. le serveur est-il plus VIEUX que l'installation ? ────────────────
// L'angle mort mesuré le 2026-09-22 : après une montée de version, le serveur
// déjà en cours continue de servir l'ANCIEN moteur depuis sa mémoire, alors que
// les fichiers sont neufs. Le mélange donne « Failed to load plugins — 1 entry
// did not activate · …-jobs: waiting for service: jobs », et rien dans le robot
// ne le disait : ni le doctor (il ne regardait que le disque), ni la page
// Réglages (elle lisait `dsh --version`, c'est-à-dire le disque aussi).
//
// La règle est pure ici — comparer deux instants — et l'appelant fournit les
// mesures (démarrage du processus qui tient le port, dernière écriture de
// l'installation). Une tolérance absorbe les quelques secondes qui séparent
// l'écriture des fichiers du démarrage légitime du serveur.
export function inspecterFraicheur ({ demarrageServeur, installation, toleranceMs = 10000 }) {
  if (!Number.isFinite(demarrageServeur)) return { verdict: 'inconnu', perime: false, raison: 'serveur illisible (aucun processus sur le port ?)' }
  if (!Number.isFinite(installation)) return { verdict: 'inconnu', perime: false, raison: 'date d\'installation illisible' }
  const retardMs = installation - demarrageServeur
  if (retardMs > toleranceMs) {
    return {
      verdict: 'perime', perime: true, retardMs,
      raison: `le serveur a démarré AVANT la dernière installation (${Math.round(retardMs / 1000)} s plus tôt) : il sert encore l'ancien moteur en mémoire — redémarre DSH`
    }
  }
  return { verdict: 'frais', perime: false, retardMs, raison: 'le serveur est postérieur à la dernière installation' }
}

export function testerCompatibilite ({ cible, compat, force = false }) {
  const zone = compat.dsh || {}
  const min = zone.min
  const max = zone.max
  const testees = Array.isArray(zone.testees) ? zone.testees : []
  if (min === undefined && max === undefined) return { verdict: 'inconnu', bloquant: false, raison: 'aucune zone de compatibilité déclarée — installation autorisée' }
  if (cible === undefined || cible === null || cible === '') return { verdict: 'refuse', bloquant: true, raison: 'version cible inconnue' }
  const horsZone = (min !== undefined && comparerVersions(cible, min) < 0) || (max !== undefined && comparerVersions(cible, max) > 0)
  if (!horsZone) return { verdict: 'ok', bloquant: false, raison: `DSH ${cible} est dans la zone testée (${min} … ${max})` }
  if (force) return { verdict: 'force', bloquant: false, raison: `DSH ${cible} n'a jamais été testé avec ce plugin (zone ${min} … ${max}) — forcé par --force`, avertissement: true }
  return {
    verdict: 'refuse', bloquant: true,
    raison: `DSH ${cible} n'a jamais été testé avec ce plugin (zone testée : ${min} … ${max}). Rien n'a été modifié. Relance avec --force pour essayer quand même.`
  }
}

/**
 * Pure. Pourquoi une retouche n'est PLUS posée sur ce moteur, ou null si elle l'est.
 * Deux formes dans `patches.json` :
 *   · `retire: "motif"` — retirée partout (le robot la défait où elle traîne) ;
 *   · `retire_depuis_moteur: "0.2.0-rc.2"` (+ `retire_motif`) — retirée seulement à
 *     partir de cette version du moteur : les moteurs plus anciens de la zone de
 *     compatibilité la gardent, car la migration vers le plugin n'y a pas été mesurée.
 * Version moteur inconnue (null) : on ne retire rien, on ne devine pas.
 */
export function motifDeRetrait (entree, versionMoteur) {
  if (entree === null || typeof entree !== 'object') return null
  if (entree.retire !== undefined) return String(entree.retire)
  const seuil = entree.retire_depuis_moteur
  if (typeof seuil === 'string' && typeof versionMoteur === 'string' && versionMoteur !== '' && comparerVersions(versionMoteur, seuil) >= 0) {
    return typeof entree.retire_motif === 'string' && entree.retire_motif !== '' ? entree.retire_motif : 'plus nécessaire depuis le moteur ' + seuil
  }
  return null
}

// ── 2. versions ───────────────────────────────────────────────────────────

export async function versionDuGlobal ({ exec }) {
  const r = await exec(['dsh', '--version'])
  const v = String(r.sortie || '').trim().split('\n').pop() || ''
  // `dsh` absent => la commande echoue : on rend NULL, jamais une chaine vide.
  // Mesure du 23/09/2026 : une chaine vide est un faux « installe » pour tout
  // test `=== null`, donc `bootstrap` croyait DSH present sur une machine nue et
  // ne posait JAMAIS le moteur — le scenario B etait indetectable.
  if (r.code !== 0 || v === '') return null
  return v
}

export async function versionDuPlugin ({ exec, repoDir }) {
  const r = await exec(['git', 'rev-parse', '--short', 'HEAD'], repoDir)
  return String(r.sortie || '').trim() || 'inconnu'
}

// ── 3. doctor — lire sans écrire ──────────────────────────────────────────

export async function etatDoctor ({ fs, exec, profilDir, repoDir, packages = [], patches = [], compatChemin }) {
  const global = await versionDuGlobal({ exec })
  const plugin = await versionDuPlugin({ exec, repoDir })
  const compat = lireCompat({ fs, chemin: compatChemin })
  // Un profil qui n'existe pas encore n'est PAS une erreur : c'est l'etat exact
  // d'une machine nue, ou DSH vient d'etre pose mais n'a jamais tourne. Le lire
  // sans garde faisait planter le doctor sur `node:fs:539` (ENOENT package.json)
  // — mesure du 23/09/2026 sur un profil jetable.
  const profilAbsent = typeof fs.existe === 'function' && !fs.existe(join(profilDir, 'package.json'))
  // `global === null` = pas de moteur joignable. Declare tot : les pins, la
  // compatibilite ET les problemes s'en servent.
  const moteurAbsent = global === null
  const pkgProfil = profilAbsent ? { dependencies: {}, dsh: {} } : JSON.parse(fs.lire(join(profilDir, 'package.json')))
  const deps = pkgProfil.dependencies || {}
  const bundles = pkgProfil.dsh?.profile?.bundles || []

  // pins @deepseek-ai : tous à la même version que le global ?
  const pins = Object.entries(deps).filter(([k]) => k.startsWith('@deepseek-ai/'))
  const pinsDivergents = pins.filter(([, v]) => v !== global).map(([k, v]) => `${k} ${v} ≠ ${global}`)
  const alignePins = pinsDivergents.length === 0

  // liens @local/* : présents et déclarés en bundle ?
  const attends = packages.map((p) => p.nom)
  const liensManquants = attends.filter((n) => !(deps[n] || '').startsWith('link:'))
  const bundlesManquants = attends.filter((n) => !bundles.includes(n))

  // Sans moteur lisible, la compatibilite n'a pas de cible : on ne fait pas
  // dire a un comparateur ce qu'il ne peut pas savoir.
  const compatVerdict = moteurAbsent ? { verdict: 'inconnu', bloquant: false, raison: 'moteur absent' } : testerCompatibilite({ cible: global, compat })

  const problemes = []
  if (moteurAbsent) {
    problemes.push('le moteur DSH n\'est pas joignable (`dsh` absent du PATH) : lance `./kybernos-install`, il le pose et le vérifie')
  } else if (profilAbsent) {
    // Une seule phrase, celle du geste a faire — pas onze « paquet non lie ».
    problemes.push('aucun profil DSH : lance `dsh web` une fois (il le cree), puis rappelle doctor')
  }
  // Sans profil, ces trois constats sont TOUS vrais et aucun n'est utile : ils
  // noieraient la seule phrase qui dit quoi faire (dix lignes pour un geste).
  if (!profilAbsent && !moteurAbsent) {
    if (!alignePins) problemes.push(`le profil épinglé des paquets DSH à une autre version que le moteur (${pinsDivergents[0] || 'divergence'})`)
    for (const l of liensManquants) problemes.push(`le paquet ${l} n'est pas lié au profil`)
    for (const b of bundlesManquants) problemes.push(`le bundle ${b} n'est pas déclaré dans le profil`)
  }
  if (compatVerdict.verdict === 'refuse') problemes.push(compatVerdict.raison)

  const couleur = problemes.length === 0 ? 'verte' : 'orange'
  return { global, plugin, moteur: moteurAbsent ? 'absent' : 'present', profil: profilAbsent ? 'absent' : 'present', alignePins, pinsDivergents, liensManquants, bundlesManquants, compatVerdict, problemes, couleur, patches }
}

// ── 4. le plan (l'ordre des gestes, écrit noir sur blanc) ─────────────────

export function planUpgrade ({ cible, depuis, compatVerdict, aDesBundles }) {
  if (compatVerdict === 'refuse') return ['compatibilite']
  const plan = ['compatibilite', 'photo']
  if (cible !== depuis) plan.push('remplacer-moteur', 'aligner-fiche')
  else plan.push('aligner-fiche')
  plan.push('re-patcher')
  if (aDesBundles) plan.push('ajouter-bundles')
  plan.push('verifier-boot')
  plan.push('journal')
  return plan
}

// ── 5. photo / restauration ──────────────────────────────────────────────

export async function photographier ({ fs, profilDir, photosDir, horodatage, versions, exec, horloge }) {
  const dossier = join(photosDir, horodatage)
  fs.creerRep(dossier)
  const fichiers = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml']
  for (const f of fichiers) {
    try { fs.copier(join(profilDir, f), join(dossier, f)) } catch (e) { /* absent : la photo n'invente rien */ }
  }
  fs.ecrire(join(dossier, 'versions.txt'), `moteur ${versions.global}\nplugin ${versions.plugin}\ndate ${maintenant(horloge).toISOString()}\n`)
  fs.ecrire(join(dossier, 'LISEZ-MOI.txt'), ecrireLisezMoi({ photo: dossier, versions, date: maintenant(horloge).toISOString() }))
  return { dossier, fichiers }
}

export function ecrireLisezMoi ({ photo, versions, date }) {
  return [
    `Photo de sécurité prise le ${date}.`,
    `Moteur DSH : ${versions.global} · Plugin : ${versions.plugin}`,
    '',
    'Pour revenir à cet état (une seule commande, depuis le dépôt dsh-kybernos) :',
    `  node scripts/dsh-lifecycle.mjs rollback --photo ${photo}`,
    '',
    'Ou à la main : recopier package.json, pnpm-lock.yaml et cordis.patch.yml de ce',
    'dossier vers ~/.dsh/profiles/web/, puis : dsh plugin --profile web install',
    'puis rejouer les patchs (scripts/patch-dsh-*.mjs).'
  ].join('\n')
}

export async function restaurerPhoto ({ fs, photosDir, photoDossier, profilDir }) {
  const dossier = photoDossier || photoLaPlusRecente({ fs, photosDir })
  if (dossier === null) throw new Error('aucune photo à restaurer dans ' + photosDir)
  const fichiers = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml']
  const recopies = []
  for (const f of fichiers) {
    try {
      const contenu = fs.lire(join(dossier, f))
      fs.ecrire(join(profilDir, f), contenu)
      recopies.push(f)
    } catch (e) { /* absent de la photo : ne pas écraser ce qui existe */ }
  }
  return { dossier, recopies }
}

export function photoLaPlusRecente ({ fs, photosDir }) {
  try {
    const dossiers = fs.lister(photosDir).sort()
    return dossiers.length === 0 ? null : join(photosDir, dossiers[dossiers.length - 1])
  } catch (e) { return null }
}

// ── 6. journal — chaque opération dit DE → VERS et le résultat ────────────

export async function journaliser ({ fs, journal, op }) {
  const ligne = JSON.stringify({
    date: op.date, quoi: op.quoi, de: op.de ?? '—', vers: op.vers ?? '—',
    resultat: op.resultat, raison: op.raison ?? '', photo: op.photo ?? ''
  })
  const existant = (() => { try { return fs.lire(journal) } catch (e) { return '' } })()
  fs.ecrire(journal, (existant.length > 0 ? existant.replace(/\n$/, '') + '\n' : '') + ligne + '\n')
}

export function lireJournal ({ fs, journal, limite = 20 }) {
  try {
    const brut = fs.lire(journal)
    return brut.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l)).reverse().slice(0, limite)
  } catch (e) { return [] }
}

// ── 7. alignement de la fiche (LE geste qui a manqué le 2026-09-22) ───────

// `disponibles` : { '@deepseek-ai/<paquet>': ['0.1.6-alpha.2', …] } — les
// versions RÉELLEMENT publiées, mesurées par l'appelant (npm view). Sans cette
// mesure, l'alignement épinglait la cible sur des paquets qui n'existent pas :
// le 2026-09-22, `dsh-experimental-agent-team-web-profile` (dernière version
// 0.1.6-alpha.2, fusionnée en amont dans `dsh-experimental-agent-team-profile`)
// a fait échouer le pnpm du profil en ERR_PNPM_NO_MATCHING_VERSION — l'upgrade
// entier est parti en rollback pour un paquet qui n'aurait pas dû être épinglé.
//
// Règle : publie la cible → on épingle la cible ; ne la publie pas → on RETIRE
// la dépendance ET son bundle (la garder dans une version antérieure remet
// exactement le graphe client incohérent qui a cassé le boot du matin). Un
// paquet sans mesure (`disponibles[nom]` absent) garde le comportement
// historique : épinglé à la cible.
export function alignerPins ({ fs, profilDir, cible, disponibles = {} }) {
  const pkg = JSON.parse(fs.lire(join(profilDir, 'package.json')))
  const deps = pkg.dependencies || {}
  const alignes = []
  const retires = []
  for (const k of Object.keys(deps)) {
    if (!k.startsWith('@deepseek-ai/')) continue
    const versions = disponibles[k]
    if (Array.isArray(versions) && !versions.includes(cible)) {
      delete deps[k]
      retires.push({ nom: k, derniere: versions.length > 0 ? versions[versions.length - 1] : null })
      continue
    }
    deps[k] = cible
    alignes.push(k)
  }
  const bundles = pkg.dsh && pkg.dsh.profile ? pkg.dsh.profile.bundles : null
  const bundlesRetires = []
  if (Array.isArray(bundles)) {
    for (const r of retires) {
      const i = bundles.indexOf(r.nom)
      if (i >= 0) { bundles.splice(i, 1); bundlesRetires.push(r.nom) }
    }
  }
  fs.ecrire(join(profilDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  return { pkg, alignes, retires, bundlesRetires }
}

export function alignerLiens ({ fs, profilDir, repoDir, packages, actives = null, anciensDepots = [] }) {
  const pkg = JSON.parse(fs.lire(join(profilDir, 'package.json')))
  pkg.dependencies = pkg.dependencies || {}
  pkg.dsh = pkg.dsh || {}
  pkg.dsh.profile = pkg.dsh.profile || {}
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []
  // `actives` (Modèle 3) : si fourni, on ne lie QUE les paquets dont le nom est
  // dans cette liste. `null` = comportement historique (tout lier), pour ne pas
  // casser les appels existants. Un satellite désactivé n'est ni lié ni poussé
  // dans dsh.profile.bundles — il ne sera pas chargé au boot.
  // An entry without a `nom` cannot be linked: skip it. It used to push `undefined`,
  // which JSON turned into a `null` in dsh.profile.bundles — DSH logged
  // "skipping profile bundle null" at every boot.
  // Profiles written before this fix may already carry a null: drop non-strings.
  pkg.dsh.profile.bundles = (pkg.dsh.profile.bundles ?? []).filter((b) => typeof b === 'string')
  const nommes = packages.filter((p) => typeof p.nom === 'string' && p.nom !== '')
  const aLier = actives === null ? nommes : nommes.filter((p) => actives.includes(p.nom))
  for (const p of aLier) {
    const attendu = 'link:' + dossierBundle(repoDir, p.dir)
    const actuel = pkg.dependencies[p.nom]
    // Missing or non-link entry: set it. A link that is exactly the old flat
    // layout (`<repo>/<dir>`) is re-pointed to `<repo>/packages/<dir>`, otherwise
    // a profile installed before the move would break on update. Any other link
    // (a developer's own checkout, say) is left alone unless its repo is listed
    // in `anciensDepots`.
    // `anciensDepots` : checkouts d'où l'on MIGRE sur demande explicite (--migrer-depuis).
    // Un lien vers l'un d'eux (à plat ou dans packages/) est re-pointé vers ce dépôt-ci ;
    // sans cette demande, il reste intact — jamais de migration silencieuse.
    const ancienLien = actuel === 'link:' + join(repoDir, p.dir) ||
      anciensDepots.some((d) => actuel === 'link:' + join(d, p.dir) || actuel === 'link:' + join(d, 'packages', p.dir))
    if (!actuel || !actuel.startsWith('link:') || ancienLien) pkg.dependencies[p.nom] = attendu
    if (!pkg.dsh.profile.bundles.includes(p.nom)) pkg.dsh.profile.bundles.push(p.nom)
  }
  // Un satellite RETIRÉ de l'activation : on le sort aussi de dsh.profile.bundles
  // et de dependencies, sinon il reste chargé au boot alors qu'on veut le
  // débrancher. On ne touche qu'aux noms qu'on connaît (dans `packages`).
  if (actives !== null) {
    const connus = new Set(packages.map((p) => p.nom))
    const actifsSet = new Set(aLier.map((p) => p.nom))
    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((n) => !connus.has(n) || actifsSet.has(n))
    for (const nom of connus) {
      if (!actifsSet.has(nom) && pkg.dependencies[nom] !== undefined) delete pkg.dependencies[nom]
    }
  }
  fs.ecrire(join(profilDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  return pkg
}

export function verifierBundles ({ fs, profilDir, packages }) {
  const pkg = JSON.parse(fs.lire(join(profilDir, 'package.json')))
  const deps = pkg.dependencies || {}
  const bundles = pkg.dsh?.profile?.bundles || []
  return packages.filter((p) => !bundles.includes(p.nom) || !(deps[p.nom] || '').startsWith('link:'))
}
// ── Activation des satellites : les nouveaux arrivent ALLUMÉS ───────────────
// Le fichier `satellites-actives.json` ne liste que les satellites ACTIFS. Un
// satellite ajouté au manifeste APRÈS l'écriture du fichier n'y figure donc pas,
// et serait lu comme « désactivé » : c'est ce qui a débranché kybernos-flow (et
// huit autres) chez le premier utilisateur qui avait déjà un fichier.
// Règle : un satellite marqué `"defaut": "actif"` dans le manifeste est actif
// SAUF s'il a été désactivé explicitement (liste `desactives` du fichier).
// Rend null si le fichier est illisible ou absent (l'appelant garde alors son
// comportement « tout actif »).
export function activesResolues ({ brut, satellites, socle }) {
  const liste = Array.isArray(brut) ? brut : Array.isArray(brut?.actives) ? brut.actives : null
  if (liste === null) return null
  const desactives = new Set(Array.isArray(brut?.desactives) ? brut.desactives : [])
  const parDefaut = satellites.filter((s) => s.defaut === 'actif' && !desactives.has(s.nom)).map((s) => s.nom)
  return [...new Set([...socle, ...liste, ...parDefaut])]
}

// Ce qu'il faut écrire dans `desactives` : les satellites « actif par défaut »
// que l'on vient d'éteindre (sans ça, la lecture suivante les rallumerait).
export function desactivesAEcrire ({ liste, satellites }) {
  const actifs = new Set(liste)
  return satellites.filter((s) => s.defaut === 'actif' && !actifs.has(s.nom)).map((s) => s.nom)
}
