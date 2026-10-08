// ── Le paquetage du plugin pour les bêta-testeurs ───────────────────────────
//
// Un testeur reçoit UNE archive. Elle porte : les bundles du plugin, le robot
// de cycle de vie (les scripts qu'il exécute, rien de plus), la plage de
// compatibilité DSH, et un manifeste qui liste chaque fichier avec son
// empreinte. `--verifier` rejoue les empreintes sur une archive reçue : c'est ce
// qui permet de dire « l'archive est intacte », pas « elle a l'air complète ».
//
// Ce qui n'entre PAS : `docs/` (171 Mo de maquettes), les tests, les scripts de
// chantier. Le contenu est DÉRIVÉ de deux sources de vérité du dépôt —
// `scripts/lifecycle-packages.json` (quels bundles) et `scripts/patches.json`
// (quels scripts de retouche) — jamais d'un `cp -r` du dossier, sinon le paquet
// grossit à chaque fichier oublié dans le dépôt.
//
// Usage :
//   node scripts/paquet.mjs --liste                       # ce qui entrerait
//   node scripts/paquet.mjs --construire [--sortie dist] [--plateforme mac]
//   node scripts/paquet.mjs --verifier <archive.tar.gz>   # empreintes rejouées
//
// Sortie : 0 = conforme ; 1 = écart, archive illisible ou contenu vide.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { famille } from './plateforme.mjs'
import { dossierBundle, cheminBundle } from './bundles.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(ICI, '..')

// Le robot est ce qui TOURNE chez le testeur : la liste est écrite à la main,
// et un fichier ajouté au robot ne rentre pas dans le paquet par accident.
export const SCRIPTS_DU_ROBOT = [
  'scripts/dsh-lifecycle.mjs',
  'scripts/lifecycle-engine.mjs',
  'scripts/plateforme.mjs',
  'scripts/dsh-relance.mjs',
  'scripts/lifecycle-packages.json',
  'scripts/patches.json',
  'dsh-compat.json',
]

// Les lanceurs : ce que le testeur exécute. Ils sont à la RACINE de l'archive,
// pas dans scripts/ — c'est le dossier qu'il vient d'extraire qu'il ouvre.
export const LANCEURS = ['kybernos-install', 'kybernos-update', 'kybernos-install.cmd', 'kybernos-update.cmd']

export const FICHIERS_DE_SERVICE = ['VERSION', 'manifest.json']

// The Apache-2.0 licence asks that a redistribution carries the licence and the NOTICE, and the
// third-party licence texts NOTICE points to. The archive redistributes the code and the vendored
// libraries, so these travel with it (they used to be left out).
export const FICHIERS_DE_LICENCE = ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES', 'TRADEMARK.md']

// ── le manifeste, calculé sans toucher au disque (donc éprouvable) ──────────
export const hacher = (tampon) => createHash('sha256').update(tampon).digest('hex')

export const construireManifest = ({ liste, lire, hacherFichier = hacher, version, plateforme, compat, horloge = () => new Date().toISOString() }) => {
  const fichiers = [...liste].sort().map((chemin) => {
    const tampon = lire(chemin)
    return { chemin, octets: tampon.length, sha256: hacherFichier(tampon) }
  })
  return {
    nom: 'kybernos-dsh',
    version: String(version),
    plateforme: String(plateforme),
    creeLe: horloge(),
    dsh: compat,
    fichiers,
    total: { fichiers: fichiers.length, octets: fichiers.reduce((n, f) => n + f.octets, 0) },
  }
}

// ── la vérification, dans les trois sens ───────────────────────────────────
// Un fichier MODIFIÉ, un fichier MANQUANT, un fichier EN TROP : les trois sont
// des écarts, et les trois se disent.
//
// `manifest.json` est la seule exception : il ne peut pas porter sa propre
// empreinte (il serait écrit avant d'être calculé). Il est donc ignoré dans le
// contrôle « en trop » — sans quoi toute archive fraîchement construite serait
// déclarée fautive à cause de son propre manifeste.
export const FICHIERS_IGNORES = ['manifest.json']

export const verifierManifest = ({ manifest, lire, hacherFichier = hacher, presents, ignorer = FICHIERS_IGNORES }) => {
  const ecarts = []
  const connus = new Set(manifest.fichiers.map((f) => f.chemin))
  const toleres = new Set(ignorer)
  for (const attendu of manifest.fichiers) {
    let tampon = null
    try { tampon = lire(attendu.chemin) } catch (e) { ecarts.push({ chemin: attendu.chemin, type: 'manquant' }); continue }
    const obtenu = hacherFichier(tampon)
    if (obtenu !== attendu.sha256) ecarts.push({ chemin: attendu.chemin, type: 'modifie', attendu: attendu.sha256, obtenu })
  }
  for (const chemin of presents ?? []) {
    if (connus.has(chemin) || toleres.has(chemin)) continue
    ecarts.push({ chemin, type: 'en-trop' })
  }
  return { ok: ecarts.length === 0, ecarts }
}

// ── les fichiers dont un script de retouche dépend, DÉRIVÉS de son source ───
// Un script de retouche ne vit pas seul : il lit un diff (`join(HERE, '….patch')`),
// lance un contrôle (`join(HERE, 'check-….mjs')`) et importe des modules
// partagés (`from './racine-dsh.mjs'`). Mesure du 23/09/2026 : l'archive ne
// portait AUCUN de ces fichiers — queue-move n'avait même pas son diff — donc le
// scénario B ne pouvait pas aboutir, et le défaut ne se voyait que chez le
// testeur. On les dérive du source plutôt que d'une liste à la main : un
// cinquième correctif entre tout seul, et `test-paquet.mjs` vérifie que chaque
// chemin dérivé existe vraiment.
export const dependancesDesPatchs = (racine, patches) => {
  const trouves = new Set()
  const liste = Array.isArray(patches) ? patches : patches.patches ?? []
  const motifs = [
    /join\(HERE,\s*'([^']+)'/g, // un diff, un contrôle, un bundle
    /from\s+'\.\/([^']+)'/g, // un module partagé
    /fichier:\s*'([^']+\.patch)'/g, // une variante de diff
  ]
  for (const patch of liste) {
    if (typeof patch.script !== 'string') continue
    let source = ''
    try { source = readFileSync(join(racine, 'scripts', basename(patch.script)), 'utf8') } catch (e) { continue }
    for (const motif of motifs) for (const m of source.matchAll(motif)) trouves.add('scripts/' + m[1])
  }
  return [...trouves].sort()
}

// ── le contenu réel : dérivé des sources de vérité du dépôt ────────────────
// ── le graphe de modules du robot voyage ENTIER ─────────────────────────────
// Le pré-vol P7 a trouvé le défaut en une seconde : `dsh-lifecycle.mjs` importe
// `./paquet.mjs`, que la liste du robot ne portait pas — l'archive ne démarrait
// donc PAS chez le testeur (`ERR_MODULE_NOT_FOUND`), alors que toutes les
// épreuves du dépôt étaient vertes (elles lisent le dépôt, où le fichier est là).
// Même classe que la leçon du 23/09 sur les fichiers de retouche. On ne liste
// donc plus : on SUIT les imports relatifs, transitivement.
export const importsRelatifs = (racine, chemin) => {
  let texte
  try { texte = readFileSync(join(racine, chemin), 'utf8') } catch (e) { return [] }
  const trouves = new Set()
  const motif = /(?:^|[\s;{(])import\s*(?:[^'"]*?from\s*)?['"](\.[^'"]*)['"]/g
  const dynamique = /import\(\s*['"](\.[^'"]*)['"]\s*\)/g
  for (const m of texte.matchAll(motif)) trouves.add(m[1])
  for (const m of texte.matchAll(dynamique)) trouves.add(m[1])
  return [...trouves]
}

export const fermetureModules = (racine, entrees) => {
  const vus = new Set()
  const pile = [...entrees]
  while (pile.length > 0) {
    const chemin = pile.pop()
    if (vus.has(chemin) === true) continue
    if (existsSync(join(racine, chemin)) !== true) continue
    vus.add(chemin)
    for (const relatif of importsRelatifs(racine, chemin)) {
      const cible = relative(racine, resolve(join(racine, dirname(chemin)), relatif))
      if (cible.startsWith('..') === false && existeFichier(racine, cible)) pile.push(cible)
    }
  }
  return [...vus]
}

const existeFichier = (racine, chemin) => {
  try { return statSync(join(racine, chemin)).isFile() === true } catch (e) { return false }
}

// ── le bruit ne part pas chez le testeur ────────────────────────────────────
// Mesuré le 23/09/2026 : une construction depuis l'arbre de travail embarquait
// TROIS `.DS_Store` et un `test/harness.bundle.js` d'1 Mo — les deux git-ignorés,
// donc absents d'une construction depuis une révision propre. Le bruit se
// reconnaît à son nom (toujours vrai, sans git) et, pour le reste, à ce que git
// ignore (mesuré avec git quand il est là).
export const estBruit = (chemin) => {
  const base = basename(chemin)
  return base === '.DS_Store' || base === 'Thumbs.db' || base === 'desktop.ini' ||
    base.startsWith('._') || String(chemin).split('/').includes('.git')
}

export const exclureIgnores = (liste, exec) => {
  let sortie
  try { sortie = exec(['git', 'check-ignore', '--stdin'], liste.join('\n') + '\n') } catch (e) { return liste }
  if (typeof sortie !== 'string' || sortie.trim() === '') return liste
  const ignores = new Set(sortie.split('\n').map((l) => l.trim()).filter((l) => l !== ''))
  return liste.filter((c) => ignores.has(c) === false)
}

// ── a folder extracted from an archive is checked against ITS OWN manifest ──
// `kybernos-install` / `kybernos-update` are run from the extracted folder, so that folder is what gets installed. Until
// 2026-10-08 only a `.tar.gz` handed to `--source` was verified; the folder the launchers pass was trusted blindly although their
// header said the fingerprints are checked (a flipped byte in one bundle file sailed through).
// Returns the manifest when the folder carries one of ours, else null (a development checkout has none).
export const lireManifestDuDossier = (dossier) => {
  try {
    const m = JSON.parse(readFileSync(join(dossier, 'manifest.json'), 'utf8'))
    return m !== null && typeof m === 'object' && m.nom === 'kybernos-dsh' && Array.isArray(m.fichiers) ? m : null
  } catch (e) { return null }
}

/**
 * Replays the manifest over a folder. A modified or missing file is an error. A file the manifest does not know is only REPORTED
 * (`enTrop`): DSH and the OS leave things in a folder that has been in use (.DS_Store, a cache), and refusing to update because
 * of one would block the update for no gain. `estBruit` names are not even reported.
 */
export const verifierDossier = (dossier, manifest = lireManifestDuDossier(dossier)) => {
  if (manifest === null) return { ok: true, manifest: null, ecarts: [], enTrop: [] }
  const v = verifierManifest({ manifest, lire: (c) => readFileSync(join(dossier, c)), presents: cheminer(dossier, dossier, '').filter((c) => estBruit(c) === false) })
  return { ok: v.ecarts.every((e) => e.type === 'en-trop'), manifest, ecarts: v.ecarts.filter((e) => e.type !== 'en-trop'), enTrop: v.ecarts.filter((e) => e.type === 'en-trop').map((e) => e.chemin) }
}

/** The name an archive's content is installed under (a folder name, nothing else), from its manifest; null when it is not a safe name. */
export const nomInstallation = (manifest) => {
  const nom = 'kybernos-dsh-' + String(manifest?.version) + '-' + String(manifest?.plateforme)
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(nom) ? nom : null
}

export const listerContenu = (racine) => {
  const paquets = JSON.parse(readFileSync(join(racine, 'scripts', 'lifecycle-packages.json'), 'utf8'))
  const patches = JSON.parse(readFileSync(join(racine, 'scripts', 'patches.json'), 'utf8'))
  // Le robot ET son graphe de modules : une entrée oubliée ne se voit que chez
  // le testeur, sur une machine neuve (mesuré par le pré-vol P7).
  const graphe = fermetureModules(racine, SCRIPTS_DU_ROBOT.filter((c) => c.endsWith('.mjs')))
  const liste = new Set([...SCRIPTS_DU_ROBOT, ...LANCEURS, ...FICHIERS_DE_LICENCE, ...graphe])
  for (const patch of Array.isArray(patches) ? patches : patches.patches ?? []) {
    if (typeof patch.script === 'string') liste.add('scripts/' + basename(patch.script))
  }
  // Sans condition : un fichier dérivé ABSENT doit faire échouer la construction
  // en le nommant (garde plus bas), pas disparaître en silence de l'archive.
  for (const dependance of dependancesDesPatchs(racine, patches)) liste.add(dependance)
  for (const p of paquets.packages) {
    for (const chemin of cheminer(dossierBundle(racine, p.dir))) liste.add(chemin)
  }
  return [...liste].sort().filter((chemin) => estBruit(chemin) === false)
}

// Tous les fichiers d'un dossier, en chemins RELATIFS au dépôt. Ni `node_modules`
// ni `.git` : un bundle n'en porte pas, et ils pèsent des centaines de Mo.
export const cheminer = (dossier, racine = REPO, prefixe = relative(REPO, dossier)) => {
  const trouves = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    if (entree.name === 'node_modules' || entree.name === '.git') continue
    const complet = join(dossier, entree.name)
    const relatif = join(prefixe, entree.name)
    if (entree.isDirectory()) trouves.push(...cheminer(complet, racine, relatif))
    // Chemins normalisés en « / » : sur Windows, `join` rend des « \ » et les
    // listes de fichiers (manifeste, satellites) devaient rester rejouables
    // identiques sur les trois plateformes (run 36992900469 : les assertions
    // « dsh-mermaid/… » échouaient sur le coureur windows-latest).
    else if (entree.isFile()) trouves.push(relatif.split(sep).join('/'))
  }
  return trouves
}

const lireCompat = (racine) => {
  try { return JSON.parse(readFileSync(join(racine, 'dsh-compat.json'), 'utf8')) } catch (e) { return null }
}

const lireVersion = (racine) => {
  try {
    const v = readFileSync(join(racine, 'VERSION'), 'utf8').trim()
    return v === '' ? null : v
  } catch (e) { return null }
}

// ── l'arbre est-il propre SUR CE QU'ON LIVRE ? ──────────────────────────────
// L'archive se construit depuis l'arbre de travail : un fichier livré modifié
// et non commité voyage donc tel quel chez le testeur. Mesuré le 23/09/2026 —
// le paquet a emporté un `scripts/dsh-pins-client.js` en cours d'écriture par
// un autre chat. Seuls les fichiers LIVRÉS comptent : un brouillon dans `docs/`
// n'empêche pas de paqueter.
export const fichiersSales = (liste, exec) => {
  let sortie
  try { sortie = exec(['git', 'status', '--porcelain', '--', ...liste]) } catch (e) { return [] }
  if (typeof sortie !== 'string' || sortie.trim() === '') return []
  // Format porcelain v1 : DEUX colonnes d'état puis le chemin. Le premier
  // essai retirait « des non-espaces » — le statut commençant par une espace
  // (« M fichier »), l'expression ne mordait pas et la garde laissait passer
  // TOUT : mesuré le 23/09/2026, l'archive s'est construite sur 9 fichiers
  // livrés sales sans un mot. On tranche donc par position, pas par classe.
  return sortie.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '')
    .map((l) => l.slice(2).trim())
    .map((l) => (l.includes(' -> ') ? l.split(' -> ').pop().trim() : l))
    .map((l) => (l.startsWith('"') && l.endsWith('"') ? l.slice(1, -1) : l))
    .filter((l) => liste.includes(l))
}

export const verdictArbrePropre = (sales) => sales.length === 0
  ? { ok: true, message: '' }
  : {
    ok: false,
    message: [
      '✗ ' + sales.length + ' fichier(s) LIVRÉS sont modifiés sans être commités :',
      ...sales.map((s) => '  · ' + s),
      '  L\'archive se construit depuis l\'arbre de travail : ce travail en cours partirait tel quel chez le testeur',
      '  (mesuré le 23/09/2026 : un scripts/dsh-pins-client.js écrit par un autre chat a voyagé dans l\'archive).',
      '  Deux sorties — committer ces fichiers, ou construire depuis une révision propre :',
      '    git worktree add /tmp/kb-propre HEAD',
      '    (cd /tmp/kb-propre && node scripts/paquet.mjs --construire --sortie <dist>)',
    ].join('\n'),
  }

// ── ligne de commande ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// Modèle 3 — archives par satellite (29/09/2026)
//
// Un satellite = un bundle @local/* indépendant du socle. Le manifeste de
// référence est `docs/beta/satellites.json` : socle (tier 1, obligatoire) +
// satellites (tier 2/3, activables un par un).
//
// Deux sorties :
//   · `--satellite <nom>`  → construit l'archive de CE satellite seul
//   · `--liste-satellites` → montre le manifeste, ce qui est activable
//
// Un satellite ne contient QUE son dossier de bundle + son cordis.patch.yml.
// Il n'embarque pas le robot, pas les lances, pas les patches moteur : ceux-ci
// vivent dans l'archive du socle. L'installation d'un satellite se fait par
// `dsh plugin install` du bundle, pas par le robot complet.
// ═══════════════════════════════════════════════════════════════════════════

export const LIRE_SATELLITES = (racine) => {
  try {
    return JSON.parse(readFileSync(join(racine, 'docs/beta/satellites.json'), 'utf8'))
  } catch (e) {
    return null
  }
}

export const TOUS_LES_SATELLITES = (racine) => {
  const m = LIRE_SATELLITES(racine)
  if (m === null) return []
  return [...(m.socle?.bundles ?? []), ...(m.satellites?.bundles ?? [])]
}

export const trouverSatellite = (racine, nomOuDir) => {
  return TOUS_LES_SATELLITES(racine).find((s) => s.nom === nomOuDir || s.dir === nomOuDir || s.nom === '@local/' + nomOuDir) ?? null
}

/** Contenu d'un satellite : son dossier de bundle + ses patchs. Rien d'autre. */
export const listerContenuSatellite = (racine, satellite) => {
  const liste = new Set()
  for (const chemin of cheminer(dossierBundle(racine, satellite.dir))) liste.add(chemin)
  const patchPath = join(dossierBundle(racine, satellite.dir), 'cordis.patch.yml')
  if (existsSync(patchPath)) liste.add(cheminBundle(satellite.dir) + '/cordis.patch.yml')
  return [...liste].sort().filter((c) => estBruit(c) === false)
}

/** Le manifeste d'un satellite, même format que le manifeste de l'archive complète. */
export const construireManifestSatellite = ({ liste, lire, version, plateforme, compat, satellite, horloge }) => {
  const m = construireManifest({ liste, lire, version, plateforme, compat, horloge })
  m.satellite = { nom: satellite.nom, dir: satellite.dir, tier: satellite.tier, obligatoire: satellite.obligatoire, lib_vendor: satellite.lib_vendor ?? null }
  return m
}

/**
 * Verdict d'activation : ce qui est livré vs. ce qui est activé.
 * Un satellite `obligatoire: true` absent = ERREUR (le master en a besoin).
 * Un satellite `obligatoire: false` absent = AVERTISSEMENT (débranché, normal).
 */
export const verifierSatellite = ({ manifeste, actives = [] }) => {
  const problemes = []
  const avertissements = []
  const actifs = new Set(actives)
  for (const s of (manifeste.socle?.bundles ?? [])) {
    if (s.obligatoire !== true) continue
    if (!actifs.has(s.nom)) {
      problemes.push({ type: 'socle_absent', nom: s.nom, raison: 'obligatoire mais absent de l\'activation' })
    }
  }
  for (const s of (manifeste.satellites?.bundles ?? [])) {
    if (!actifs.has(s.nom)) {
      if (s.obligatoire === true) {
        problemes.push({ type: 'satellite_obligatoire_absent', nom: s.nom, raison: 'obligatoire mais absent' })
      } else {
        avertissements.push({ type: 'satellite_desactive', nom: s.nom, raison: 'débranché — normal pour un satellite optionnel' })
      }
    }
  }
  return { ok: problemes.length === 0, problemes, avertissements, actives: [...actifs] }
}
// L'import par un test ne doit PAS déclencher le CLI. On compare le chemin
// ABSOLU du script exécuté à celui de CE module — pas juste son nom de base,
// sinon un test nommé paquet.mjs déclencherait le CLI lui aussi.
const estPrincipal = () => {
  if (process.argv[1] === undefined) return false
  try {
    const moi = fileURLToPath(import.meta.url)
    return resolve(process.argv[1]) === moi
  } catch (e) {
    return false
  }
}

if (estPrincipal()) {
  const args = process.argv.slice(2)
  const option = (nom, defaut) => {
    const i = args.indexOf(nom)
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : defaut
  }
  const plate = option('--plateforme', famille())
  const sortie = resolve(REPO, option('--sortie', 'dist'))
  const version = option('--version', lireVersion(REPO) ?? ('0.0.0-dev+' + new Date().toISOString().slice(0, 10)))
  // `listerContenu` écarte le bruit par son nom ; git écarte ce qu'il ignore.
  const execGit = (argv, entree) => execFileSync(argv[0], argv.slice(1), { cwd: REPO, encoding: 'utf8', input: entree === undefined ? '' : entree })
  const contenu = exclureIgnores(listerContenu(REPO), execGit)

  // Un fichier dérivé qui n'existe pas : on le DIT, on ne construit pas. Sans
  // cette garde, `--liste` mourait sur un statSync illisible et `--construire`
  // produisait une archive qui n'échouerait que chez le testeur.
  const manquants = contenu.filter((chemin) => existsSync(join(REPO, chemin)) !== true)
  if (manquants.length > 0) {
    console.error('✗ ' + manquants.length + ' fichier(s) du paquet sont absents du dépôt :')
    for (const chemin of manquants) console.error('  · ' + chemin)
    process.exit(1)
  }

  // ── Modèle 3 : archives par satellite ─────────────────────────────────────
  if (args.includes('--liste-satellites')) {
    const manifeste = LIRE_SATELLITES(REPO)
    if (manifeste === null) { console.error('✗ docs/beta/satellites.json illisible'); process.exit(1) }
    console.log('Satellites Kybernos — version ' + version)
    console.log('')
    console.log('SOCLE (toujours livré, obligatoire)')
    for (const s of (manifeste.socle?.bundles ?? [])) {
      console.log('  · ' + s.nom.padEnd(28) + ' tier ' + s.tier + '  ' + String(s.poids_ko).padStart(6) + ' Ko  ' + s.role)
    }
    console.log('')
    console.log('SATELLITES (activables un par un)')
    for (const s of (manifeste.satellites?.bundles ?? [])) {
      const lib = s.lib_vendor ? '  [lib: ' + s.lib_vendor + ']' : ''
      console.log('  · ' + s.nom.padEnd(28) + ' tier ' + s.tier + '  ' + String(s.poids_ko).padStart(6) + ' Ko' + lib)
      console.log('    ' + s.role)
    }
    process.exit(0)
  }

  if (args.includes('--satellite')) {
    const nomSat = args[args.indexOf('--satellite') + 1]
    if (nomSat === undefined) { console.error('--satellite attend un nom de bundle (ex: dsh-mermaid)'); process.exit(1) }
    const sat = trouverSatellite(REPO, nomSat)
    if (sat === null) {
      console.error('✗ satellite inconnu : ' + nomSat)
      console.error('  connus : ' + TOUS_LES_SATELLITES(REPO).map((s) => s.dir).join(', '))
      process.exit(1)
    }
    const contenu = exclureIgnores(listerContenuSatellite(REPO, sat), execGit)
    const manquants = contenu.filter((c) => existsSync(join(REPO, c)) !== true)
    if (manquants.length > 0) {
      console.error('✗ ' + manquants.length + ' fichier(s) absents pour ' + sat.dir + ' :')
      for (const c of manquants) console.error('  · ' + c)
      process.exit(1)
    }
    if (args.includes('--liste')) {
      let octets = 0
      for (const c of contenu) octets += statSync(join(REPO, c)).size
      console.log('Satellite ' + sat.nom + ' (' + sat.dir + ') — ' + version + ' / ' + plate)
      for (const c of contenu) console.log('  · ' + c)
      console.log('  ' + contenu.length + ' fichiers, ' + (octets / 1048576).toFixed(2) + ' Mo')
      process.exit(0)
    }
    if (args.includes('--construire')) {
      const sales = fichiersSales(contenu, (argv) => execFileSync(argv[0], argv.slice(1), { cwd: REPO, encoding: 'utf8' }))
      const verdictPropre = verdictArbrePropre(sales)
      if (verdictPropre.ok !== true) { console.error(verdictPropre.message); process.exit(2) }
      const etape = join(sortie, 'sat-' + sat.dir + '-' + plate)
      rmSync(etape, { recursive: true, force: true })
      mkdirSync(etape, { recursive: true })
      for (const c of contenu) {
        const cible = join(etape, c)
        mkdirSync(dirname(cible), { recursive: true })
        cpSync(join(REPO, c), cible)
        if (/\.(cmd|bat)$/i.test(c)) writeFileSync(cible, readFileSync(cible, 'utf8').replace(/\r?\n/g, '\r\n'))
      }
      writeFileSync(join(etape, 'VERSION'), version + '\n')
      const manifest = construireManifestSatellite({
        liste: [...contenu, 'VERSION'],
        lire: (c) => readFileSync(join(etape, c)),
        version, plateforme: plate, compat: lireCompat(REPO), satellite: sat,
      })
      writeFileSync(join(etape, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
      const nomArchive = 'kybernos-dsh-' + sat.dir + '-' + version + '-' + plate + '.tar.gz'
      const archive = join(sortie, nomArchive)
      // Piège Windows mesuré (run 36993274567) : `tar -czf D:\…` lit « D: »
      // comme un hôte distant (« Cannot connect to D: »). Passer le NOM du
      // fichier, avec le dossier de sortie en cwd.
      execFileSync('tar', ['-czf', nomArchive, '-C', etape, '.'], { stdio: 'inherit', cwd: sortie })
      rmSync(etape, { recursive: true, force: true })
      const poids = statSync(archive).size
      console.log('Archive satellite : ' + archive)
      console.log('  ' + manifest.total.fichiers + ' fichiers + VERSION + manifest.json')
      console.log('  tier ' + sat.tier + (sat.lib_vendor ? '  [lib: ' + sat.lib_vendor + ']' : ''))
      console.log('  ' + (poids / 1048576).toFixed(2) + ' Mo — empreintes rejouables avec --verifier')
      process.exit(0)
    }
  }

  if (args.includes('--liste')) {
    let octets = 0
    for (const chemin of contenu) octets += statSync(join(REPO, chemin)).size
    console.log('Paquet kybernos-dsh ' + version + ' — plateforme ' + plate)
    for (const chemin of contenu) console.log('  · ' + chemin)
    console.log('  ' + contenu.length + ' fichiers, ' + (octets / 1048576).toFixed(2) + ' Mo')
    console.log('  plus ' + FICHIERS_DE_SERVICE.join(' et ') + ' (écrits dans l\'archive)')
    process.exit(0)
  }

  if (args.includes('--construire')) {
    // Refus AVANT toute écriture : une archive sale ne se rattrape pas, elle est
    // déjà chez le testeur.
    const sales = fichiersSales(contenu, (argv) => execFileSync(argv[0], argv.slice(1), { cwd: REPO, encoding: 'utf8' }))
    const verdictPropre = verdictArbrePropre(sales)
    if (verdictPropre.ok !== true) { console.error(verdictPropre.message); process.exit(2) }
    const etape = join(sortie, 'etape-' + plate)
    rmSync(etape, { recursive: true, force: true })
    mkdirSync(etape, { recursive: true })
    for (const chemin of contenu) {
      const cible = join(etape, chemin)
      mkdirSync(dirname(cible), { recursive: true })
      cpSync(join(REPO, chemin), cible)
      // Les scripts de commandes Windows partent en CRLF : cmd.exe analyse un
      // `.cmd` en fins de ligne Unix de travers et finit par executer son propre
      // texte comme des commandes. Mesure du 23/09/2026, coureur windows-latest :
      // 535 576 lignes de « 'Ouvre' is not recognized as an internal or external
      // command » en boucle pendant que l'installateur ne tournait pas — l'archive
      // livree portait 0 CRLF. Le depot garde le LF (macOS, Linux, git) : c'est
      // l'ARTEFACT livre qui doit etre Windows.
      if (/\.(cmd|bat)$/i.test(chemin)) {
        writeFileSync(cible, readFileSync(cible, 'utf8').replace(/\r?\n/g, '\r\n'))
      }
    }
    // VERSION est écrit AVANT le manifeste et il y est listé : c'est un fichier
    // comme un autre, il doit être vérifiable. `manifest.json` est le seul à ne
    // pas pouvoir l'être (il ne peut pas porter sa propre empreinte).
    writeFileSync(join(etape, 'VERSION'), version + '\n')
    const manifest = construireManifest({
      liste: [...contenu, 'VERSION'],
      lire: (chemin) => readFileSync(join(etape, chemin)),
      version, plateforme: plate, compat: lireCompat(REPO),
    })
    writeFileSync(join(etape, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    const nomArchive = 'kybernos-dsh-' + version + '-' + plate + '.tar.gz'
    const archive = join(sortie, nomArchive)
    // `tar` plutôt qu'une bibliothèque : présent sur macOS, Linux et Windows 10+.
    // Même piège que les satellites : le NOM du fichier, pas le chemin absolu
    // (« tar: Cannot connect to D: » sur le coureur windows-latest).
    execFileSync('tar', ['-czf', nomArchive, '-C', etape, '.'], { stdio: 'inherit', cwd: sortie })
    rmSync(etape, { recursive: true, force: true })
    const poids = statSync(archive).size
    console.log('Archive : ' + archive)
    console.log('  ' + manifest.total.fichiers + ' fichiers du dépôt + VERSION + manifest.json')
    console.log('  ' + (poids / 1048576).toFixed(2) + ' Mo — empreintes à rejouer avec --verifier')
    process.exit(0)
  }

  if (args.includes('--verifier')) {
    const archive = args[args.indexOf('--verifier') + 1]
    if (archive === undefined) { console.error('--verifier attend un chemin d\'archive'); process.exit(1) }
    const etape = join(sortie, 'verif-' + plate)
    rmSync(etape, { recursive: true, force: true })
    mkdirSync(etape, { recursive: true })
    // Pièges Windows (run 36993946467) : le chemin de l'archive en argument
    // fichier ferait lire « D: » comme un hôte distant (NOM + cwd), et les
    // antislashs de la cible -C sont mangés comme séquences d'échappement par
    // le tar GNU de Git-for-Windows — slashes partout pour le dossier.
    execFileSync('tar', ['-xzf', basename(resolve(REPO, archive)), '-C', etape.split(sep).join('/')],
      { cwd: dirname(resolve(REPO, archive)) })
    let manifest
    try { manifest = JSON.parse(readFileSync(join(etape, 'manifest.json'), 'utf8')) } catch (e) {
      console.error('Aucun manifest.json lisible dans ' + archive); process.exit(1)
    }
    const presents = cheminer(etape, etape, '')
    const verdict = verifierManifest({
      manifest,
      presents,
      lire: (chemin) => readFileSync(join(etape, chemin)),
    })
    rmSync(etape, { recursive: true, force: true })
    if (verdict.ok) console.log('✓ archive intacte — ' + manifest.total.fichiers + ' fichiers, ' + manifest.total.octets + ' octets')
    else {
      console.log('✗ ' + verdict.ecarts.length + ' écart(s) sur ' + manifest.total.fichiers + ' fichiers :')
      for (const e of verdict.ecarts.slice(0, 20)) console.log('  · ' + e.type + ' : ' + e.chemin)
    }
    process.exit(verdict.ok ? 0 : 1)
  }

  console.log('Usage : --liste | --construire [--sortie dist] [--plateforme mac] | --verifier <archive>')
  console.log('        --liste-satellites | --satellite <nom> [--liste | --construire]')
  process.exit(1)
}
