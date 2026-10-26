// ── Packaging the plugin for the beta testers ───────────────────────────────
//
// A tester receives ONE archive. It carries: the plugin's bundles, the lifecycle
// robot (the scripts it runs, nothing more), the DSH compatibility range, and a
// manifest that lists every file with its fingerprint. `--verifier` replays the
// fingerprints on a received archive: that is what lets us say « the archive is
// intact », not « it looks complete ».
//
// What does NOT go in: `docs/` (171 MB of mockups), the tests, the work-in-progress
// scripts. The content is DERIVED from two sources of truth of the repository —
// `scripts/lifecycle-packages.json` (which bundles) and `scripts/patches.json`
// (which patch scripts) — never from a `cp -r` of the folder, otherwise the package
// grows with every file forgotten in the repository.
//
// Usage:
//   node scripts/paquet.mjs --liste                       # what would go in
//   node scripts/paquet.mjs --construire [--sortie dist] [--plateforme mac]
//   node scripts/paquet.mjs --verifier <archive.tar.gz>   # fingerprints replayed
//
// Exit: 0 = conforming; 1 = discrepancy, unreadable archive or empty content.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { famille } from './plateforme.mjs'
import { dossierBundle, cheminBundle } from './bundles.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(ICI, '..')

// The robot is what RUNS at the tester's: the list is written by hand,
// and a file added to the robot does not get into the package by accident.
export const SCRIPTS_DU_ROBOT = [
  'scripts/dsh-lifecycle.mjs',
  'scripts/lifecycle-engine.mjs',
  'scripts/plateforme.mjs',
  'scripts/dsh-relance.mjs',
  'scripts/kybernos-open.mjs',
  'scripts/lifecycle-packages.json',
  'scripts/patches.json',
  'dsh-compat.json',
]

// The launchers: what the tester runs. They are at the ROOT of the archive,
// not in scripts/ — the folder they have just extracted is the one they open.
export const LANCEURS = ['kybernos-install', 'kybernos-update', 'kybernos-install.cmd', 'kybernos-update.cmd']

export const FICHIERS_DE_SERVICE = ['VERSION', 'manifest.json']

// The Apache-2.0 licence asks that a redistribution carries the licence and the NOTICE, and the
// third-party licence texts NOTICE points to. The archive redistributes the code and the vendored
// libraries, so these travel with it (they used to be left out).
export const FICHIERS_DE_LICENCE = ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES', 'TRADEMARK.md']

// ── the manifest, computed without touching the disk (so it can be tested) ──
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

// ── the verification, in all three directions ──────────────────────────────
// A MODIFIED file, a MISSING file, an EXTRA file: all three are discrepancies,
// and all three are reported.
//
// `manifest.json` is the one exception: it cannot carry its own fingerprint (it
// would be written before being computed). It is therefore ignored in the
// « extra » check — otherwise every freshly built archive would be declared
// faulty because of its own manifest.
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

// ── the files a patch script depends on, DERIVED from its source ───────────
// A patch script does not live alone: it reads a diff (`join(HERE, '….patch')`),
// runs a check (`join(HERE, 'check-….mjs')`) and imports shared modules
// (`from './racine-dsh.mjs'`). Measured on 23/09/2026: the archive carried NONE
// of these files — queue-move did not even have its diff — so scenario B could
// not succeed, and the defect only showed at the tester's. We derive them from
// the source rather than from a hand-written list: a fifth fix gets in by
// itself, and `test-paquet.mjs` checks that every derived path really exists.
export const dependancesDesPatchs = (racine, patches) => {
  const trouves = new Set()
  const liste = Array.isArray(patches) ? patches : patches.patches ?? []
  const motifs = [
    /join\(HERE,\s*'([^']+)'/g, // a diff, a check, a bundle
    /from\s+'\.\/([^']+)'/g, // a shared module
    /fichier:\s*'([^']+\.patch)'/g, // a variant of a diff
  ]
  for (const patch of liste) {
    if (typeof patch.script !== 'string') continue
    let source = ''
    try { source = readFileSync(join(racine, 'scripts', basename(patch.script)), 'utf8') } catch (e) { continue }
    for (const motif of motifs) for (const m of source.matchAll(motif)) trouves.add('scripts/' + m[1])
  }
  return [...trouves].sort()
}

// ── the real content: derived from the repository's sources of truth ───────
// ── the robot's module graph travels WHOLE ──────────────────────────────────
// Pre-flight P7 found the defect in a second: `dsh-lifecycle.mjs` imports
// `./paquet.mjs`, which the robot's list did not carry — so the archive did not
// start at the tester's (`ERR_MODULE_NOT_FOUND`) while every test of the
// repository was green (they read the repository, where the file is there).
// Same class as the lesson of 23/09 about patch files. So we no longer list:
// we FOLLOW the relative imports, transitively.
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

// ── noise does not go to the tester ────────────────────────────────────────
// Measured on 23/09/2026: a build from the working tree embedded THREE `.DS_Store`
// and a 1 MB `test/harness.bundle.js` — both git-ignored, hence absent from a
// build from a clean revision. Noise is recognised by its name (always true,
// without git) and, for the rest, by what git ignores (measured with git when
// it is there).
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
  // The robot AND its module graph: a forgotten entry only shows at the
  // tester's, on a new machine (measured by pre-flight P7).
  const graphe = fermetureModules(racine, SCRIPTS_DU_ROBOT.filter((c) => c.endsWith('.mjs')))
  const liste = new Set([...SCRIPTS_DU_ROBOT, ...LANCEURS, ...FICHIERS_DE_LICENCE, ...graphe])
  for (const patch of Array.isArray(patches) ? patches : patches.patches ?? []) {
    if (typeof patch.script === 'string') liste.add('scripts/' + basename(patch.script))
  }
  // Unconditionally: a derived file that is ABSENT must make the build fail
  // by naming it (guard further down), not disappear silently from the archive.
  for (const dependance of dependancesDesPatchs(racine, patches)) liste.add(dependance)
  for (const p of paquets.packages) {
    for (const chemin of cheminer(dossierBundle(racine, p.dir))) liste.add(chemin)
  }
  return [...liste].sort().filter((chemin) => estBruit(chemin) === false)
}

// Every file of a folder, as paths RELATIVE to the repository. Neither `node_modules`
// nor `.git`: a bundle carries none, and they weigh hundreds of MB.
export const cheminer = (dossier, racine = REPO, prefixe = relative(REPO, dossier)) => {
  const trouves = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    if (entree.name === 'node_modules' || entree.name === '.git') continue
    const complet = join(dossier, entree.name)
    const relatif = join(prefixe, entree.name)
    if (entree.isDirectory()) trouves.push(...cheminer(complet, racine, relatif))
    // Paths normalised to « / »: on Windows, `join` gives « \ » and the file
    // lists (manifest, satellites) had to stay replayable identically on the
    // three platforms (run 36992900469: the « dsh-mermaid/… » assertions
    // failed on the windows-latest runner).
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

// ── is the tree clean ON WHAT WE SHIP? ─────────────────────────────────────
// The archive is built from the working tree: a shipped file that is modified
// and not committed therefore travels as it is to the tester. Measured on
// 23/09/2026 — the package carried a `scripts/dsh-pins-client.js` that
// another chat was in the middle of writing. Only the SHIPPED files count: a
// draft in `docs/` does not prevent packaging.
export const fichiersSales = (liste, exec) => {
  let sortie
  try { sortie = exec(['git', 'status', '--porcelain', '--', ...liste]) } catch (e) { return [] }
  if (typeof sortie !== 'string' || sortie.trim() === '') return []
  // Porcelain v1 format: TWO status columns then the path. The first
  // attempt stripped « non-spaces » — the status starting with a space
  // (« M file »), the expression did not bite and the guard let
  // EVERYTHING through: measured on 23/09/2026, the archive was built on 9
  // dirty shipped files without a word. So we cut by position, not by class.
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
      '✗ ' + sales.length + ' shipped file' + (sales.length === 1 ? ' is' : 's are') + ' modified but not committed:',
      ...sales.map((s) => '  · ' + s),
      '  The archive is built from the working tree: this work in progress would go to the tester as it is',
      '  (measured on 2026-09-23: a scripts/dsh-pins-client.js written by another chat travelled in the archive).',
      '  Two ways out — commit these files, or build from a clean revision:',
      '    git worktree add /tmp/kb-propre HEAD',
      '    (cd /tmp/kb-propre && node scripts/paquet.mjs --construire --sortie <dist>)',
    ].join('\n'),
  }

// ── command line ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// Model 3 — archives per satellite (29/09/2026)
//
// A satellite = a @local/* bundle independent of the base. The reference
// manifest is `docs/beta/satellites.json`: base (tier 1, mandatory) +
// satellites (tier 2/3, switched on one by one).
//
// Two outputs:
//   · `--satellite <name>`  → builds the archive of THAT satellite alone
//   · `--liste-satellites`  → shows the manifest, what can be switched on
//
// A satellite contains ONLY its bundle folder + its cordis.patch.yml.
// It does not embed the robot, nor the launchers, nor the engine patches: those
// live in the base archive. A satellite is installed by
// `dsh plugin install` of the bundle, not by the full robot.
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

/** Content of a satellite: its bundle folder + its patches. Nothing else. */
export const listerContenuSatellite = (racine, satellite) => {
  const liste = new Set()
  for (const chemin of cheminer(dossierBundle(racine, satellite.dir))) liste.add(chemin)
  const patchPath = join(dossierBundle(racine, satellite.dir), 'cordis.patch.yml')
  if (existsSync(patchPath)) liste.add(cheminBundle(satellite.dir) + '/cordis.patch.yml')
  return [...liste].sort().filter((c) => estBruit(c) === false)
}

/** The manifest of a satellite, same format as the manifest of the full archive. */
export const construireManifestSatellite = ({ liste, lire, version, plateforme, compat, satellite, horloge }) => {
  const m = construireManifest({ liste, lire, version, plateforme, compat, horloge })
  m.satellite = { nom: satellite.nom, dir: satellite.dir, tier: satellite.tier, obligatoire: satellite.obligatoire, lib_vendor: satellite.lib_vendor ?? null }
  return m
}

/**
 * Activation verdict: what is shipped vs. what is activated.
 * A satellite `obligatoire: true` that is absent = ERROR (the master needs it).
 * A satellite `obligatoire: false` that is absent = WARNING (switched off, normal).
 */
export const verifierSatellite = ({ manifeste, actives = [] }) => {
  const problemes = []
  const avertissements = []
  const actifs = new Set(actives)
  for (const s of (manifeste.socle?.bundles ?? [])) {
    if (s.obligatoire !== true) continue
    if (!actifs.has(s.nom)) {
      problemes.push({ type: 'socle_absent', nom: s.nom, raison: 'mandatory but missing from the activation' })
    }
  }
  for (const s of (manifeste.satellites?.bundles ?? [])) {
    if (!actifs.has(s.nom)) {
      if (s.obligatoire === true) {
        problemes.push({ type: 'satellite_obligatoire_absent', nom: s.nom, raison: 'mandatory but missing' })
      } else {
        avertissements.push({ type: 'satellite_desactive', nom: s.nom, raison: 'switched off — normal for an optional satellite' })
      }
    }
  }
  return { ok: problemes.length === 0, problemes, avertissements, actives: [...actifs] }
}
// Importing it from a test must NOT trigger the CLI. We compare the ABSOLUTE
// path of the running script with that of THIS module — not just its base name,
// otherwise a test named paquet.mjs would trigger the CLI too.
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
  // `listerContenu` drops noise by its name; git drops what it ignores.
  const execGit = (argv, entree) => execFileSync(argv[0], argv.slice(1), { cwd: REPO, encoding: 'utf8', input: entree === undefined ? '' : entree })
  const contenu = exclureIgnores(listerContenu(REPO), execGit)

  // A derived file that does not exist: we SAY so, we do not build. Without
  // this guard, `--liste` died on an unreadable statSync and `--construire`
  // produced an archive that would only fail at the tester's.
  const manquants = contenu.filter((chemin) => existsSync(join(REPO, chemin)) !== true)
  if (manquants.length > 0) {
    console.error('✗ ' + manquants.length + ' file' + (manquants.length === 1 ? '' : 's') + ' of the package ' + (manquants.length === 1 ? 'is' : 'are') + ' missing from the repository:')
    for (const chemin of manquants) console.error('  · ' + chemin)
    process.exit(1)
  }

  // ── Model 3: archives per satellite ──────────────────────────────────────
  if (args.includes('--liste-satellites')) {
    const manifeste = LIRE_SATELLITES(REPO)
    if (manifeste === null) { console.error('✗ docs/beta/satellites.json unreadable'); process.exit(1) }
    console.log('Kybernos satellites — version ' + version)
    console.log('')
    console.log('BASE (always shipped, mandatory)')
    for (const s of (manifeste.socle?.bundles ?? [])) {
      console.log('  · ' + s.nom.padEnd(28) + ' tier ' + s.tier + '  ' + String(s.poids_ko).padStart(6) + ' KB  ' + s.role)
    }
    console.log('')
    console.log('SATELLITES (switched on one by one)')
    for (const s of (manifeste.satellites?.bundles ?? [])) {
      const lib = s.lib_vendor ? '  [lib: ' + s.lib_vendor + ']' : ''
      console.log('  · ' + s.nom.padEnd(28) + ' tier ' + s.tier + '  ' + String(s.poids_ko).padStart(6) + ' KB' + lib)
      console.log('    ' + s.role)
    }
    process.exit(0)
  }

  if (args.includes('--satellite')) {
    const nomSat = args[args.indexOf('--satellite') + 1]
    if (nomSat === undefined) { console.error('--satellite expects a bundle name (e.g. dsh-mermaid)'); process.exit(1) }
    const sat = trouverSatellite(REPO, nomSat)
    if (sat === null) {
      console.error('✗ unknown satellite: ' + nomSat)
      console.error('  known: ' + TOUS_LES_SATELLITES(REPO).map((s) => s.dir).join(', '))
      process.exit(1)
    }
    const contenu = exclureIgnores(listerContenuSatellite(REPO, sat), execGit)
    const manquants = contenu.filter((c) => existsSync(join(REPO, c)) !== true)
    if (manquants.length > 0) {
      console.error('✗ ' + manquants.length + ' file' + (manquants.length === 1 ? '' : 's') + ' missing for ' + sat.dir + ':')
      for (const c of manquants) console.error('  · ' + c)
      process.exit(1)
    }
    if (args.includes('--liste')) {
      let octets = 0
      for (const c of contenu) octets += statSync(join(REPO, c)).size
      console.log('Satellite ' + sat.nom + ' (' + sat.dir + ') — ' + version + ' / ' + plate)
      for (const c of contenu) console.log('  · ' + c)
      console.log('  ' + contenu.length + ' files, ' + (octets / 1048576).toFixed(2) + ' MB')
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
      // Windows trap, measured (run 36993274567): `tar -czf D:\…` reads « D: » as a
      // remote host (« Cannot connect to D: »). Pass the file NAME,
      // with the output folder as cwd.
      execFileSync('tar', ['-czf', nomArchive, '-C', etape, '.'], { stdio: 'inherit', cwd: sortie })
      rmSync(etape, { recursive: true, force: true })
      const poids = statSync(archive).size
      console.log('Satellite archive: ' + archive)
      console.log('  ' + manifest.total.fichiers + ' files + VERSION + manifest.json')
      console.log('  tier ' + sat.tier + (sat.lib_vendor ? '  [lib: ' + sat.lib_vendor + ']' : ''))
      console.log('  ' + (poids / 1048576).toFixed(2) + ' MB — fingerprints can be replayed with --verifier')
      process.exit(0)
    }
  }

  if (args.includes('--liste')) {
    let octets = 0
    for (const chemin of contenu) octets += statSync(join(REPO, chemin)).size
    console.log('Package kybernos-dsh ' + version + ' — platform ' + plate)
    for (const chemin of contenu) console.log('  · ' + chemin)
    console.log('  ' + contenu.length + ' files, ' + (octets / 1048576).toFixed(2) + ' MB')
    console.log('  plus ' + FICHIERS_DE_SERVICE.join(' and ') + ' (written into the archive)')
    process.exit(0)
  }

  if (args.includes('--construire')) {
    // Refuse BEFORE any write: a dirty archive cannot be taken back, it is
    // already at the tester's.
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
      // Windows command scripts leave in CRLF: cmd.exe parses a `.cmd` with
      // Unix line endings wrongly and ends up running its own text as
      // commands. Measured on 23/09/2026, windows-latest runner: 535,576
      // lines of « 'Ouvre' is not recognized as an internal or external
      // command » in a loop while the installer was not running — the shipped
      // archive carried 0 CRLF. The repository keeps LF (macOS, Linux, git): it is
      // the shipped ARTEFACT that must be Windows.
      if (/\.(cmd|bat)$/i.test(chemin)) {
        writeFileSync(cible, readFileSync(cible, 'utf8').replace(/\r?\n/g, '\r\n'))
      }
    }
    // VERSION is written BEFORE the manifest and it is listed in it: it is a file
    // like any other, it must be verifiable. `manifest.json` is the only one that
    // cannot be (it cannot carry its own fingerprint).
    writeFileSync(join(etape, 'VERSION'), version + '\n')
    const manifest = construireManifest({
      liste: [...contenu, 'VERSION'],
      lire: (chemin) => readFileSync(join(etape, chemin)),
      version, plateforme: plate, compat: lireCompat(REPO),
    })
    writeFileSync(join(etape, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    const nomArchive = 'kybernos-dsh-' + version + '-' + plate + '.tar.gz'
    const archive = join(sortie, nomArchive)
    // `tar` rather than a library: present on macOS, Linux and Windows 10+.
    // Same trap as the satellites: the file NAME, not the absolute path
    // (« tar: Cannot connect to D: » on the windows-latest runner).
    execFileSync('tar', ['-czf', nomArchive, '-C', etape, '.'], { stdio: 'inherit', cwd: sortie })
    rmSync(etape, { recursive: true, force: true })
    const poids = statSync(archive).size
    console.log('Archive: ' + archive)
    console.log('  ' + manifest.total.fichiers + ' files of the repository + VERSION + manifest.json')
    console.log('  ' + (poids / 1048576).toFixed(2) + ' MB — fingerprints to replay with --verifier')
    process.exit(0)
  }

  if (args.includes('--verifier')) {
    const archive = args[args.indexOf('--verifier') + 1]
    if (archive === undefined) { console.error('--verifier expects an archive path'); process.exit(1) }
    const etape = join(sortie, 'verif-' + plate)
    rmSync(etape, { recursive: true, force: true })
    mkdirSync(etape, { recursive: true })
    // Windows traps (run 36993946467): the archive path as a file argument
    // would make « D: » be read as a remote host (NAME + cwd), and the
    // backslashes of the -C target are eaten as escape sequences by
    // the GNU tar of Git-for-Windows — slashes everywhere for the folder.
    execFileSync('tar', ['-xzf', basename(resolve(REPO, archive)), '-C', etape.split(sep).join('/')],
      { cwd: dirname(resolve(REPO, archive)) })
    let manifest
    try { manifest = JSON.parse(readFileSync(join(etape, 'manifest.json'), 'utf8')) } catch (e) {
      console.error('No readable manifest.json in ' + archive); process.exit(1)
    }
    const presents = cheminer(etape, etape, '')
    const verdict = verifierManifest({
      manifest,
      presents,
      lire: (chemin) => readFileSync(join(etape, chemin)),
    })
    rmSync(etape, { recursive: true, force: true })
    if (verdict.ok) console.log('✓ archive intact — ' + manifest.total.fichiers + ' files, ' + manifest.total.octets + ' bytes')
    else {
      console.log('✗ ' + verdict.ecarts.length + ' discrepanc' + (verdict.ecarts.length === 1 ? 'y' : 'ies') + ' over ' + manifest.total.fichiers + ' files:')
      const QUOI = { manquant: 'missing', modifie: 'modified', 'en-trop': 'extra' } // the types are data (tests read them); say them in English
      for (const e of verdict.ecarts.slice(0, 20)) console.log('  · ' + (QUOI[e.type] ?? e.type) + ': ' + e.chemin)
    }
    process.exit(verdict.ok ? 0 : 1)
  }

  console.log('Usage: --liste | --construire [--sortie dist] [--plateforme mac] | --verifier <archive>')
  console.log('       --liste-satellites | --satellite <name> [--liste | --construire]')
  process.exit(1)
}
