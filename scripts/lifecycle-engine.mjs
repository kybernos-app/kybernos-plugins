// ═══════════════════════════════════════════════════════════════════════════
// lifecycle-engine — the PURE core of the garage robot.
//
// No direct disk/network access: `fs` (lire/ecrire/existe/creerRep/copier),
// `exec` (async (cmd) => {code, sortie}) and the clock are INJECTED. The unit
// harness (test-lifecycle-engine.mjs) tests these functions on fixtures;
// the CLI (dsh-lifecycle.mjs) hands them the real disk.
//
// Invariants (DESIGN.md): compatibility = first gesture; photo before any write;
// journal after every operation; the profile file always follows the global; boot
// failure → automatic rollback.
// ═══════════════════════════════════════════════════════════════════════════

import { join } from 'node:path'
import { dossierBundle } from './bundles.mjs'

export const DEPUIS_VERS = { obligatoire: true } // every journal line says « from X to Y »

// ── canonical timestamp (injectable for tests) ──────────────────────────
export const maintenant = (horloge) => new Date(horloge ? horloge() : Date.now())

// ── 1. compatibility (the first gesture of EVERY operation) ───────────────

export function lireCompat ({ fs, chemin }) {
  try { return JSON.parse(fs.lire(chemin)) } catch (e) { return { dsh: {} } }
}

// Version comparison SEGMENT BY SEGMENT, never alphabetical: « 0.1.10 »
// is later than « 0.1.7 », whereas string comparison says the opposite — a gate
// that refuses the right version (or worse, lets a never-tested version through)
// is a time bomb. Rules: numeric segments are compared as numbers, a version
// without a prefix (`rc`) comes after the same one with a prefix (`alpha`), and
// otherwise the prefixes are compared alphabetically (alpha < beta < rc, the
// usual semver order).
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
    if (nx !== ny) return nx ? -1 : 1 // a numeric prefix comes before a word
    if (sx !== sy) return sx < sy ? -1 : 1
  }
  return 0
}

// ── 1bis. is the server OLDER than the installation? ───────────────────────
// The blind spot measured on 2026-09-22: after a version upgrade, the server that
// is already running keeps serving the OLD engine from its memory while the
// files are new. The mix gives « Failed to load plugins — 1 entry did not activate
// · …-jobs: waiting for service: jobs », and nothing in the robot said so: neither
// the doctor (it only looked at the disk) nor the Settings page (it read
// `dsh --version`, that is, the disk too).
//
// The rule is pure here — compare two instants — and the caller supplies the
// measurements (start of the process that holds the port, last write of the
// installation). A tolerance absorbs the few seconds between the files being
// written and the legitimate start of the server.
export function inspecterFraicheur ({ demarrageServeur, installation, toleranceMs = 10000 }) {
  if (!Number.isFinite(demarrageServeur)) return { verdict: 'inconnu', perime: false, raison: 'server unreadable (no process on the port?)' }
  if (!Number.isFinite(installation)) return { verdict: 'inconnu', perime: false, raison: 'installation date unreadable' }
  const retardMs = installation - demarrageServeur
  if (retardMs > toleranceMs) {
    return {
      verdict: 'perime', perime: true, retardMs,
      raison: `the server started BEFORE the last installation (${Math.round(retardMs / 1000)} s earlier): it is still serving the old engine from memory — restart DSH`
    }
  }
  return { verdict: 'frais', perime: false, retardMs, raison: 'the server started after the last installation' }
}

export function testerCompatibilite ({ cible, compat, force = false }) {
  const zone = compat.dsh || {}
  const min = zone.min
  const max = zone.max
  const testees = Array.isArray(zone.testees) ? zone.testees : []
  if (min === undefined && max === undefined) return { verdict: 'inconnu', bloquant: false, raison: 'no compatibility range declared — installation allowed' }
  if (cible === undefined || cible === null || cible === '') return { verdict: 'refuse', bloquant: true, raison: 'target version unknown' }
  const horsZone = (min !== undefined && comparerVersions(cible, min) < 0) || (max !== undefined && comparerVersions(cible, max) > 0)
  if (!horsZone) return { verdict: 'ok', bloquant: false, raison: `DSH ${cible} is inside the tested range (${min} … ${max})` }
  if (force) return { verdict: 'force', bloquant: false, raison: `DSH ${cible} has never been tested with this plugin (range ${min} … ${max}) — forced by --force`, avertissement: true }
  return {
    verdict: 'refuse', bloquant: true,
    raison: `DSH ${cible} has never been tested with this plugin (tested range: ${min} … ${max}). Nothing was changed. Run again with --force to try anyway.`
  }
}

/**
 * Pure. Why a patch is NO LONGER applied on this engine, or null when it is.
 * Two forms in `patches.json`:
 *   · `retire: "reason"` — removed everywhere (the robot undoes it wherever it lingers);
 *   · `retire_depuis_moteur: "0.2.0-rc.2"` (+ `retire_motif`) — removed only from
 *     that engine version on: older engines of the compatibility range keep it,
 *     because the migration to the plugin was not measured there.
 * Unknown engine version (null): nothing is removed, no guessing.
 */
export function motifDeRetrait (entree, versionMoteur) {
  if (entree === null || typeof entree !== 'object') return null
  if (entree.retire !== undefined) return String(entree.retire)
  const seuil = entree.retire_depuis_moteur
  if (typeof seuil === 'string' && typeof versionMoteur === 'string' && versionMoteur !== '' && comparerVersions(versionMoteur, seuil) >= 0) {
    return typeof entree.retire_motif === 'string' && entree.retire_motif !== '' ? entree.retire_motif : 'no longer needed since engine ' + seuil
  }
  return null
}

// ── 2. versions ───────────────────────────────────────────────────────────

export async function versionDuGlobal ({ exec }) {
  const r = await exec(['dsh', '--version'])
  const v = String(r.sortie || '').trim().split('\n').pop() || ''
  // `dsh` absent => the command fails: return NULL, never an empty string.
  // Measured on 23/09/2026: an empty string is a false « installed » for any
  // `=== null` test, so `bootstrap` believed DSH was present on a bare machine and
  // NEVER put the engine in place — scenario B was undetectable.
  if (r.code !== 0 || v === '') return null
  return v
}

export async function versionDuPlugin ({ exec, repoDir }) {
  const r = await exec(['git', 'rev-parse', '--short', 'HEAD'], repoDir)
  return String(r.sortie || '').trim() || 'inconnu'
}

// ── 3. doctor — read without writing ──────────────────────────────────────

export async function etatDoctor ({ fs, exec, profilDir, repoDir, packages = [], patches = [], compatChemin }) {
  const global = await versionDuGlobal({ exec })
  const plugin = await versionDuPlugin({ exec, repoDir })
  const compat = lireCompat({ fs, chemin: compatChemin })
  // A profile that does not exist yet is NOT an error: it is the exact state
  // of a bare machine, or one where DSH has just been put in place but has never
  // run. Reading it without a guard made the doctor crash on `node:fs:539`
  // (ENOENT package.json) — measured on 23/09/2026 on a throwaway profile.
  const profilAbsent = typeof fs.existe === 'function' && !fs.existe(join(profilDir, 'package.json'))
  // `global === null` = no reachable engine. Declared early: the pins, the
  // compatibility AND the problems all use it.
  const moteurAbsent = global === null
  const pkgProfil = profilAbsent ? { dependencies: {}, dsh: {} } : JSON.parse(fs.lire(join(profilDir, 'package.json')))
  const deps = pkgProfil.dependencies || {}
  const bundles = pkgProfil.dsh?.profile?.bundles || []

  // @deepseek-ai pins: all at the same version as the global?
  const pins = Object.entries(deps).filter(([k]) => k.startsWith('@deepseek-ai/'))
  const pinsDivergents = pins.filter(([, v]) => v !== global).map(([k, v]) => `${k} ${v} ≠ ${global}`)
  const alignePins = pinsDivergents.length === 0

  // @local/* links: present and declared as a bundle?
  const attends = packages.map((p) => p.nom)
  const liensManquants = attends.filter((n) => !(deps[n] || '').startsWith('link:'))
  const bundlesManquants = attends.filter((n) => !bundles.includes(n))

  // Without a readable engine, compatibility has no target: we do not make a
  // comparator say what it cannot know.
  const compatVerdict = moteurAbsent ? { verdict: 'inconnu', bloquant: false, raison: 'engine absent' } : testerCompatibilite({ cible: global, compat })

  const problemes = []
  if (moteurAbsent) {
    problemes.push('the DSH engine is not reachable (`dsh` is not on the PATH): run `./kybernos-install`, it puts it in place and checks it')
  } else if (profilAbsent) {
    // A single sentence, the one for the gesture to make — not eleven « package not linked ».
    problemes.push('no DSH profile: run `dsh web` once (it creates it), then run doctor again')
  }
  // Without a profile, these three findings are ALL true and none is useful: they
  // would drown the only sentence that says what to do (ten lines for one gesture).
  if (!profilAbsent && !moteurAbsent) {
    if (!alignePins) problemes.push(`the profile pins the DSH packages to another version than the engine (${pinsDivergents[0] || 'divergence'})`)
    for (const l of liensManquants) problemes.push(`the package ${l} is not linked to the profile`)
    for (const b of bundlesManquants) problemes.push(`the bundle ${b} is not declared in the profile`)
  }
  if (compatVerdict.verdict === 'refuse') problemes.push(compatVerdict.raison)

  const couleur = problemes.length === 0 ? 'verte' : 'orange'
  return { global, plugin, moteur: moteurAbsent ? 'absent' : 'present', profil: profilAbsent ? 'absent' : 'present', alignePins, pinsDivergents, liensManquants, bundlesManquants, compatVerdict, problemes, couleur, patches }
}

// ── 4. the plan (the order of the gestures, written in black and white) ───

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

// ── 5. photo / restore ───────────────────────────────────────────────────

export async function photographier ({ fs, profilDir, photosDir, horodatage, versions, exec, horloge }) {
  const dossier = join(photosDir, horodatage)
  fs.creerRep(dossier)
  const fichiers = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml']
  for (const f of fichiers) {
    try { fs.copier(join(profilDir, f), join(dossier, f)) } catch (e) { /* absent: the photo invents nothing */ }
  }
  fs.ecrire(join(dossier, 'versions.txt'), `engine ${versions.global}\nplugin ${versions.plugin}\ndate ${maintenant(horloge).toISOString()}\n`)
  fs.ecrire(join(dossier, 'README.txt'), ecrireLisezMoi({ photo: dossier, versions, date: maintenant(horloge).toISOString() }))
  return { dossier, fichiers }
}

export function ecrireLisezMoi ({ photo, versions, date }) {
  return [
    `Safety photo taken on ${date}.`,
    `DSH engine: ${versions.global} · Plugin: ${versions.plugin}`,
    '',
    'To come back to this state (one command, from the folder you installed Kybernos from):',
    `  node scripts/dsh-lifecycle.mjs rollback --photo ${photo}`,
    '',
    'Or by hand: copy package.json, pnpm-lock.yaml and cordis.patch.yml from this',
    'folder to ~/.dsh/profiles/web/, then: dsh plugin --profile web install',
    'then replay the patches (scripts/patch-dsh-*.mjs).'
  ].join('\n')
}

export async function restaurerPhoto ({ fs, photosDir, photoDossier, profilDir }) {
  const dossier = photoDossier || photoLaPlusRecente({ fs, photosDir })
  if (dossier === null) throw new Error('no photo to restore in ' + photosDir)
  const fichiers = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml']
  const recopies = []
  for (const f of fichiers) {
    try {
      const contenu = fs.lire(join(dossier, f))
      fs.ecrire(join(profilDir, f), contenu)
      recopies.push(f)
    } catch (e) { /* absent from the photo: do not overwrite what exists */ }
  }
  return { dossier, recopies }
}

export function photoLaPlusRecente ({ fs, photosDir }) {
  try {
    const dossiers = fs.lister(photosDir).sort()
    return dossiers.length === 0 ? null : join(photosDir, dossiers[dossiers.length - 1])
  } catch (e) { return null }
}

// ── 6. journal — each operation says FROM → TO and the result ─────────────

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

// ── 7. aligning the profile file (THE gesture that was missed on 2026-09-22) ──

// `disponibles`: { '@deepseek-ai/<package>': ['0.1.6-alpha.2', …] } — the versions
// ACTUALLY published, measured by the caller (npm view). Without this
// measurement, the alignment pinned the target on packages that do not exist:
// on 2026-09-22, `dsh-experimental-agent-team-web-profile` (last version
// 0.1.6-alpha.2, merged upstream into `dsh-experimental-agent-team-profile`)
// made the profile's pnpm fail with ERR_PNPM_NO_MATCHING_VERSION — the whole
// upgrade went to rollback for a package that should not have been pinned.
//
// Rule: it publishes the target → pin the target; it does not → REMOVE the
// dependency AND its bundle (keeping it at an earlier version brings back exactly
// the inconsistent client graph that broke the morning's boot). A package with no
// measurement (`disponibles[nom]` absent) keeps the historical behaviour: pinned
// to the target.
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

/**
 * Pure. Is this existing `link:` worth re-pointing at the folder being installed? Two cases, both measured on 2026-10-08:
 *   · the link points at a folder that no longer exists (an update that ran from a temp folder and cleaned it up): nothing
 *     is left to protect, and keeping it makes `dsh plugin install` crash for good;
 *   · the link points into a folder extracted from an EARLIER Kybernos archive (its root carries the archive's manifest.json
 *     and no .git): an update is exactly the act of moving to the new folder. Before this, the update printed "success" and
 *     28 of 30 bundles kept loading from the old folder.
 * A developer's checkout (a git tree, or any folder that is not an archive extraction) is never touched.
 */
export function lienReprenable ({ fs, actuel, dir }) {
  if (typeof actuel !== 'string' || !actuel.startsWith('link:') || typeof dir !== 'string' || dir === '') return false
  const cible = actuel.slice('link:'.length)
  const fin = new RegExp('[\\\\/](?:packages[\\\\/])?' + dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$').exec(cible)
  if (fin === null) return false
  const racine = cible.slice(0, fin.index)
  if (typeof fs.existe !== 'function') return false
  if (!fs.existe(cible)) return true
  if (racine === '' || fs.existe(join(racine, '.git'))) return false
  try { return JSON.parse(fs.lire(join(racine, 'manifest.json'))).nom === 'kybernos-dsh' } catch (e) { return false }
}

export function alignerLiens ({ fs, profilDir, repoDir, packages, actives = null, anciensDepots = [], reprendre = false, rapporter = null }) {
  const pkg = JSON.parse(fs.lire(join(profilDir, 'package.json')))
  pkg.dependencies = pkg.dependencies || {}
  pkg.dsh = pkg.dsh || {}
  pkg.dsh.profile = pkg.dsh.profile || {}
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []
  // `actives` (Model 3): if given, ONLY the packages whose name is in this list
  // are linked. `null` = historical behaviour (link everything), so as not to
  // break existing calls. A disabled satellite is neither linked nor pushed
  // into dsh.profile.bundles — it will not be loaded at boot.
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
    // `anciensDepots`: checkouts we MIGRATE from on explicit request (--migrer-depuis).
    // A link to one of them (flat or in packages/) is re-pointed to this repository;
    // without that request it stays intact — never a silent migration.
    const ancienLien = actuel === 'link:' + join(repoDir, p.dir) ||
      anciensDepots.some((d) => actuel === 'link:' + join(d, p.dir) || actuel === 'link:' + join(d, 'packages', p.dir))
    // `reprendre` : install/upgrade only (the act of moving to this folder). `satellites` and `safe-mode` only toggle bundles.
    const perime = reprendre === true && ancienLien === false && actuel !== attendu && lienReprenable({ fs, actuel, dir: p.dir })
    if (perime && typeof rapporter === 'function') rapporter(p.nom, actuel, attendu)
    if (!actuel || !actuel.startsWith('link:') || ancienLien || perime) pkg.dependencies[p.nom] = attendu
    if (!pkg.dsh.profile.bundles.includes(p.nom)) pkg.dsh.profile.bundles.push(p.nom)
  }
  // A satellite REMOVED from the activation is also taken out of dsh.profile.bundles
  // and of dependencies, otherwise it stays loaded at boot when we want it
  // unplugged. We only touch the names we know (in `packages`).
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
// ── Satellite activation: new ones arrive ON ────────────────────────────────
// The file `satellites-actives.json` only lists the ACTIVE satellites. A
// satellite added to the manifest AFTER the file was written is therefore not in it,
// and would be read as « disabled »: that is what unplugged kybernos-flow (and
// eight others) for the first user who already had a file.
// Rule: a satellite marked `"defaut": "actif"` in the manifest is active
// UNLESS it was explicitly disabled (the file's `desactives` list).
// Returns null if the file is unreadable or absent (the caller then keeps its
// « everything active » behaviour).
export function activesResolues ({ brut, satellites, socle }) {
  const liste = Array.isArray(brut) ? brut : Array.isArray(brut?.actives) ? brut.actives : null
  if (liste === null) return null
  const desactives = new Set(Array.isArray(brut?.desactives) ? brut.desactives : [])
  const parDefaut = satellites.filter((s) => s.defaut === 'actif' && !desactives.has(s.nom)).map((s) => s.nom)
  return [...new Set([...socle, ...liste, ...parDefaut])]
}

// What has to be written in `desactives`: the « active by default » satellites
// that were just switched off (without it, the next read would turn them back on).
export function desactivesAEcrire ({ liste, satellites }) {
  const actifs = new Set(liste)
  return satellites.filter((s) => s.defaut === 'actif' && !actifs.has(s.nom)).map((s) => s.nom)
}
