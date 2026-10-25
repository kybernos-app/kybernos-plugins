#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// dsh-lifecycle — the garage robot (CLI). See docs/handoff/lifecycle/DESIGN.md
//
//   node scripts/dsh-lifecycle.mjs doctor [--json]     state, never writes
//   node scripts/dsh-lifecycle.mjs install              adds the plugin to a profile
//   node scripts/dsh-lifecycle.mjs upgrade [version] [--force] [--dry]
//   node scripts/dsh-lifecycle.mjs rollback [--photo <folder>]
//   node scripts/dsh-lifecycle.mjs uninstall            removes the links + bundle (keeps the rest)
//   node scripts/dsh-lifecycle.mjs verify [--url <url>] real boot only
//
// Invariants held by the unit harness + the e2e tests:
//   step 1 = compatibility · photo before any write · journal after
//   everything · boot failure → automatic rollback.
// Exit: 0 = 🟢/success, 1 = 🟠/failure (readable, never a bare stack trace).
// ═══════════════════════════════════════════════════════════════════════════

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, rmSync, statSync, symlinkSync, realpathSync, renameSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditerSurfaces } from '../packages/kybernos-maintenance/surfaces.mjs'
import { FICHIER_ETAT, normaliser as normaliserEtatBoot, entrerSafe, sortirSafe, recommandation as recommandationBoot } from '../packages/kybernos-hub/boot-guard.mjs'
// One installer at a time: the lock file the Suite panel reads to know that an installer runs, even after DSH was killed (see install-lock.mjs).
import { fichierVerrou, libererVerrou, lireVerrou, prendreVerrou } from '../packages/kybernos-hub/install-lock.mjs'
import { pidSurPort, demarrageProcessus, famille, nomSuperviseur, planRelance, instructionsRedemarrage } from './plateforme.mjs'
import {
  etatDoctor, testerCompatibilite, lireCompat, comparerVersions, versionDuGlobal, versionDuPlugin,
  photographier, restaurerPhoto, journaliser, lireJournal, alignerPins, alignerLiens, activesResolues, desactivesAEcrire,
  planUpgrade, inspecterFraicheur, motifDeRetrait
} from './lifecycle-engine.mjs'
// Checking a received archive: the package manifest is the only
// authority on what was delivered (see scripts/paquet.mjs).
import { verifierManifest, cheminer, LIRE_SATELLITES, TOUS_LES_SATELLITES, lireManifestDuDossier, verifierDossier, nomInstallation } from './paquet.mjs'
// The rule for an installation's bases (profile, global engine, pinned project)
// lives in ONE module, proven by test-racine-dsh.mjs.
import { basesPossibles } from './racine-dsh.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
// REPO is no longer a constant: `--source` can point at the folder extracted
// from a received archive. ICI stays the folder of the robot's scripts (patches.json
// and lifecycle-packages.json are ALWAYS read from there, never from the source).
let REPO = resolve(ICI, '..')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFIL_DIR = process.env.KBLIFE_PROFIL || join(DSH_HOME, 'profiles', 'web')

// ── The REFERENCE engine: a pinned tree, in a folder of our own ─────────────
// Measured on 23/09/2026, isolated lab: `npm i -g @deepseek-ai/dsh@X`
// does NOT pin the tree. The packages our patches target are not direct
// dependencies of the engine; they arrive through transitive ranges and
// npm takes the most recent one that satisfies — 0.1.7-rc.1 the evening this machine
// carried 0.1.7-alpha.1. Two new machines therefore do not get the same engine, and
// two patches out of four do not fit on the tester's machine.
// The only MEASURED way to pin the tree: `overrides` + `npm install` in
// a project (6/6 packages at the wanted version, fingerprint identical to the one here).
// The binary is then linked into the GLOBAL prefix, already on the PATH: the tester's
// gesture does not change.
const MOTEUR_DIR = join(DSH_HOME, 'kybernos', 'moteur')
/** The packages whose content decides whether our patches fit. */
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
// KYBERNOS_PACKAGES_FILE: test hook (replacement package list). Never set in normal use.
const PACKAGES = JSON.parse(readFileSync(process.env.KYBERNOS_PACKAGES_FILE || join(ICI, 'lifecycle-packages.json'), 'utf8')).packages

// ── Model 3: activation of the satellites ───────────────────────────────────
// A satellite is ACTIVE if it is listed in `~/.dsh/kybernos/satellites-actives.json`
// (a plain array of @local/… names). If the file is absent → EVERYTHING is
// active (historical behaviour, no regression for an existing install).
// The core (`socle`, tier 1, mandatory) is ALWAYS active, whatever happens.
const SATELLITES_ACTIVES_FICHIER = join(DSH_HOME, 'kybernos', 'satellites-actives.json')
function lireSatellitesActives () {
  try {
    const brut = JSON.parse(readFileSync(SATELLITES_ACTIVES_FICHIER, 'utf8'))
    const manifeste = LIRE_SATELLITES(REPO)
    if (manifeste === null) return null
    // The core is always active, even if the file does not list it.
    const socle = (manifeste.socle?.bundles ?? []).map((b) => b.nom)
    const satellites = manifeste.satellites?.bundles ?? []
    // A "default-active" satellite (added after the file was written) stays on.
    const liste = activesResolues({ brut, satellites, socle })
    if (liste === null) return null
    // A package that satellites.json does not manage is neither core nor satellite: it
    // stays active. Without this, creating the activation file removed it.
    const geres = new Set([...socle, ...satellites.map((b) => b.nom)])
    const nonGeres = PACKAGES.map((p) => p.nom).filter((n) => typeof n === 'string' && !geres.has(n))
    return [...new Set([...liste, ...nonGeres])]
  } catch (e) {
    return null
  }
}
const ACTIVES = lireSatellitesActives()
const PACKAGES_ACTIFS = ACTIVES === null ? PACKAGES : PACKAGES.filter((p) => ACTIVES.includes(p.nom))
let COMPAT_CHEMIN = join(REPO, 'dsh-compat.json')

const ALLOW_SCRIPTS = '--allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs'
const horodatage = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace('Z', '')

// Orphaned locks: a `dsh plugin install` killed mid-run leaves
// `package.json.lock` on disk and EVERY following install dies on the
// atomic-write timeout. Nobody holds it → we remove it. (Measured when this was
// written: the lock was lying around and the robot's pnpm failed silently.)
// « Nobody holds it » has to be true: while ANOTHER installer holds the installation lock (see install-lock.mjs) its `dsh plugin install` may be the one that wrote
// package.json.lock, and removing it under it made two installers pull the lock from each other (L3-85). Every order that gets here took the installation lock
// first, so this only ever stands down when that lock is somebody else's.
const VERROU_INSTALLATION = fichierVerrou(DSH_HOME)
const installateurAutre = () => { const v = lireVerrou({ fichier: VERROU_INSTALLATION }); return v.etat === 'tenu' && v.verrou.pid !== process.pid ? v.verrou : null }
const nettoyerVerrousOrphelins = () => {
  const verrou = join(PROFIL_DIR, 'package.json.lock')
  const autre = installateurAutre()
  if (autre !== null) { console.log('  ⏳ package.json.lock left alone: another installer (pid ' + autre.pid + ') holds the installation lock'); return }
  try { if (existsSync(verrou)) { rmSync(verrou); console.log('  🧹 orphaned lock removed (' + verrou + ')') } } catch (e) { /* nothing */ }
}

// Link a binary built in OUR tree into npm's GLOBAL prefix: that folder is already
// on the tester's PATH, so their gesture (`dsh web`) does not change. We do not assume the PATH already
// points there (same trap as before: « engine in place » followed by « no readable engine »). Returns the link made, or null
// when npm does not say where the prefix is. `echouer(message)` interrupts (or throws) depending on the caller.
async function lierDansLePrefixe (vrai, nom, echouer) {
  const p = await execReel(['npm', 'prefix', '-g'])
  const prefixe = (p.sortie || '').trim()
  if (p.code !== 0 || prefixe === '') return null
  const win = famille() === 'windows'
  const bin = win ? prefixe : join(prefixe, 'bin')
  mkdirSync(bin, { recursive: true })
  const lien = join(bin, win ? nom + '.cmd' : nom)
  rmSync(lien, { force: true })
  if (existsSync(vrai) === false) echouer('🔴 the ' + nom + ' binary is not where npm installed it: ' + vrai)
  if (win) {
    // Windows: a symbolic link needs privileges; a relay that calls
    // the real .cmd by ABSOLUTE path works without assuming anything.
    writeFileSync(lien, '@echo off\r\ncall "' + vrai + '" %*\r\n')
  } else {
    symlinkSync(vrai, lien)
  }
  const sepPath = win ? ';' : ':'
  const actuel = process.env.PATH || ''
  if (!actuel.split(sepPath).includes(bin)) process.env.PATH = bin + sepPath + actuel
  return lien
}

// DSH installs a profile's plugins with `pnpm` (`spawn pnpm ENOENT` otherwise) and the site only promises Node and git:
// on a machine without pnpm, the installation put the engine in place then stopped halfway (« pnpm was not found »).
// We put it in place like the engine: in OUR tree (npm), linked into the global prefix, never more than one extra gesture.
async function assurerPnpm () {
  const present = await execReel(['pnpm', '--version'], REPO, 30000)
  if (present.code === 0) return
  console.log('  ⬇ pnpm is not on this machine (DSH needs it to install plugins): npm is putting it in place …')
  const dossier = join(dirname(MOTEUR_DIR), 'outils', 'pnpm')
  mkdirSync(dossier, { recursive: true })
  writeFileSync(join(dossier, 'package.json'), JSON.stringify({ name: 'kybernos-outils-pnpm', version: '1.0.0', private: true, dependencies: { pnpm: '^11' } }, null, 2) + '\n')
  const r = await execReel(['npm', 'install', '--no-audit', '--no-fund'], dossier, 600000)
  const vrai = join(dossier, 'node_modules', '.bin', famille() === 'windows' ? 'pnpm.cmd' : 'pnpm')
  if (r.code !== 0 || existsSync(vrai) === false) {
    throw new Error('pnpm is missing and npm could not put it in place (' + (r.delaiDepasse === true ? 'timed out' : (r.err || r.sortie || 'code ' + r.code).slice(0, 300)) + '). Install it yourself (npm install -g pnpm), then run this again.')
  }
  const lien = await lierDansLePrefixe(vrai, 'pnpm', (m) => { throw new Error(m) })
  const apres = await execReel(['pnpm', '--version'], REPO, 30000)
  if (apres.code !== 0) throw new Error('pnpm was put in place' + (lien === null ? '' : ' (' + lien + ')') + ' but does not answer: open a NEW terminal, then run this again.')
  console.log('  ✓ pnpm ' + apres.sortie.trim() + ' in place' + (lien === null ? '' : ' (linked in ' + lien + ')'))
}

// pnpm install with VISIBLE output: a silent failure is a failure that gets
// mistaken for a broken boot. The exit code is the only truth.
const installerProfil = async () => {
  nettoyerVerrousOrphelins()
  await assurerPnpm()
  const r = await execReel(['dsh', 'plugin', '--profile', 'web', 'install'], REPO)
  if (r.code !== 0) {
    console.log(r.sortie.slice(0, 800))
    console.log(r.err.slice(0, 800))
    throw new Error('installing the profile (pnpm) failed — see above')
  }
  return r
}

// ── the real environment, injected into the engine ─────────────────────────
const fsReel = {
  existe: existsSync,
  lire: (p) => readFileSync(p, 'utf8'),
  ecrire: (p, c) => writeFileSync(p, c),
  creerRep: (p) => mkdirSync(p, { recursive: true }),
  lister: (p) => readdirSync(p),
  copier: (src, dst) => { cpSync(src, dst) },
}
// ── launching an external binary, Windows included ────────────────────────
// Measured on 23/09/2026, windows-latest runner, fresh machine: `npm` is
// `npm.cmd` there, and `execFile('npm', …)` fails — the installation stopped dead on
// « cannot read the published versions (npm view @deepseek-ai/dsh dist-tags
// failed) », without any version being read. Same trap for `dsh`, which is
// `dsh.cmd`. So we go through the platform shell, quoting the arguments
// that contain a space: « C:\Users\Jean Dupont\… » is a real case for a
// Windows tester, and a path split in two would fail the same step.
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
      // A timeout gives a non-zero code AND EMPTY streams: without this
      // flag, the failure was shown as « npm failed: » — a message that explains
      // nothing. Measured on 23/09/2026 on a cold windows-latest runner.
      delaiDepasse: err ? (err.killed === true || err.signal === 'SIGTERM') : false,
      delaiMs,
      sortie: String(stdout || ''),
      err: String(stderr || ''),
    }))
})
const horlogeReelle = () => Date.now()

// ── the installed global: where the packages the patches modify live ──────
// We no longer hard-code /opt/homebrew here: `npm root -g` says where the
// engine is, and each patch script receives that path through `--dsh`.
let RACINE_CACHE = null

/**
 * The engine that the `dsh` binary of the PATH REALLY launches, or `null`.
 *
 * Distinct from `moteurEpinglé` — and it is THIS one that must be authoritative. A
 * rollback puts the link back on the old engine while leaving the new folder under
 * MOTEUR_DIR: taking « the most recent » then read a tree nobody was
 * running. Measured on 23/09/2026 in the lab: after a failed upgrade to
 * 0.1.7-alpha.2, the doctor announced « models-header applied » and the
 * rollback put the patches back in the alpha.2 tree — while `dsh`
 * was launching alpha.1, without the patch.
 */
const moteurDuLien = async () => {
  const p = await execReel(['npm', 'prefix', '-g'])
  const prefixe = String(p.sortie || '').trim()
  if (p.code !== 0 || prefixe === '') return null
  // BOTH SIDES are resolved: on macOS `/tmp` is a link to
  // `/private/tmp`, and comparing a resolved path (the `dsh` link) to a raw
  // path (our home) gives « .. » every time — measured on 23/09/2026, the
  // lab then fell back on « the most recent » instead of the engine that was launched.
  let racineMoteur = MOTEUR_DIR
  try { racineMoteur = realpathSync(MOTEUR_DIR) } catch (e) { /* fresh home: as is */ }
  // Windows: our installer writes a `dsh.cmd` relay (no symbolic link).
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

/** The pinned engine already in place (the most recent), or `null`. */
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
  // 1) what the `dsh` binary REALLY launches (order matters: see
  //    `moteurDuLien`, which exists because of a lying rollback);
  const duLien = await moteurDuLien()
  if (duLien !== null) {
    RACINE_CACHE = duLien.dsh
    return RACINE_CACHE
  }
  // 2) failing that, the most recent PINNED engine in our home: it is the one
  //    our patches know about, and the one the `dsh` binary launches.
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

// ── does the server serve the engine that is ON DISK? ──────────────────────
// Blind spot measured on 2026-09-22: after the upgrade to 0.1.7, the server already
// running (started 4 h earlier) kept serving 0.1.6 from its
// memory. The mix gives « 1 entry did not activate · …-jobs: waiting for
// service: jobs ». Neither the doctor (it only read the disk) nor the Settings page
// (it reads `dsh --version`, so the disk too) could say so.
const mtime = (chemin) => {
  try { return statSync(chemin).mtimeMs } catch (e) { return null }
}

const mesurerFraicheur = async () => {
  // Portable: each OS has its own plan (lsof here, netstat -ano elsewhere), and the
  // verdict says by which source it measured — or that none answered.
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

// ── the versions actually published (measured, not guessed) ────────────────
// A package without a target version makes pnpm fail with ERR_PNPM_NO_MATCHING_VERSION
// (measured on 2026-09-22: agent-team-web-profile, merged upstream into
// agent-team-profile in 0.1.7). We query the registry package by package, in
// parallel; a package that was not measured keeps the historical behaviour (pinned).
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

// ── the engine patches: applied THEN verified ──────────────────────────────
// A patch that no longer applies is a feature lost silently:
// that is exactly what a version upgrade produces. We verify it with its
// own `--check` and, if it does not apply, we refuse to continue (the
// calling wrapper puts the photo back).
// The root the patch scripts expect: a folder that CARRIES the
// target (`node_modules/<target>`). Since 0.1.7, the global may ship the
// packages differently: measured on 23/09/2026 on this machine, the profile does have
// `node_modules/@deepseek-ai` (40 packages) but NONE of the four we patch —
// they live in the global package, under
// `…/@deepseek-ai/dsh/node_modules/@deepseek-ai/<short>`. So we resolve by TARGET,
// once for each patch, and never with a single root.
// One source of truth: `racineQuiPorte`.

// The root that CARRIES this patch's target, or null if this engine does not
// ship it at all. Measured on 23/09/2026 on a fresh engine: two of our
// four patches have no installed target — that is not a regression,
// it is a patch that does not apply.
// The bases tried are those of `racine-dsh.mjs` (`basesPossibles`), the
// SAME rule the patch scripts use: the profile, the engine
// folder, the npm prefix, and the root of a pinned project (the packages are hoisted there,
// so three levels above the engine — being off by one level is paid for with a « not applicable » on all four patches).
const racineQuiPorte = async (cible) => {
  const globale = await racineGlobale()
  const candidats = [PROFIL_DIR].concat(basesPossibles(globale))
  for (const c of candidats) if (existsSync(join(c, 'node_modules', cible)) === true) return c
  return null
}

// Undo the patches we have just applied. The scripts keep a copy of the
// previous state (`.kybernos-*.orig`) and know how to remove themselves (`--revert`): we use that
// instead of believing that the profile photo covers the engine.
// Measured on 23/09/2026 in the lab: after a « your machine is back to
// how it was », the engine STILL carried 10 markers of our pins patch
// — the photo only covers the profile, and a tester would have kept a
// half-patched engine with nothing saying so.
const annulerRetouches = async (resultats) => {
  const posees = resultats.filter((r) => r.applicable === true && r.conforme === true)
  if (posees.length === 0) return
  console.log('     ↩ removing ' + posees.length + ' patch(es) already applied')
  for (const r of posees) {
    const sortie = await execReel(['node', join(ICI, r.script), '--revert', ...avecDsh(r.racine)], REPO)
    console.log('       ' + (sortie.code === 0 ? '↩ ' + r.id + ' removed' : '⚠ ' + r.id + ' NOT removed — to undo by hand in ' + r.racine))
  }
}

const poserPatchs = async ({ tolerance = false } = {}) => {
  const resultats = []
  const versionMoteur = await versionDuGlobal({ exec: execReel })
  for (const p of PATCHES) {
    // ── a REMOVED patch is no longer applied (P3) ──────────────────────────
    // Removing an entry from `patches.json` would leave the patch APPLIED on
    // machines where it already is, with nothing able to undo it (the
    // rollback reads this same file). So we keep the entry, marked `retire`:
    // the robot no longer applies it, and it undoes it where it is still lying around.
    const motifRetrait = motifDeRetrait(p, versionMoteur)
    if (motifRetrait !== null) {
      const racineRetiree = await racineQuiPorte(p.cible)
      if (racineRetiree !== null) {
        const verif = await execReel(['node', join(ICI, p.script), '--check', ...avecDsh(racineRetiree)], REPO)
        if (verif.code === 0) {
          await execReel(['node', join(ICI, p.script), '--revert', ...avecDsh(racineRetiree)], REPO)
          console.log(`     ↩ ${p.id} — removed (${motifRetrait})`)
        } else {
          console.log(`     · ${p.id} — removed, absent (${motifRetrait})`)
        }
      } else {
        console.log(`     · ${p.id} — removed, no target on this engine (${motifRetrait})`)
      }
      resultats.push({ id: p.id, conforme: true, applicable: false, retire: true, racine: racineRetiree, script: p.script })
      continue
    }
    const racineCible = await racineQuiPorte(p.cible)
    if (racineCible === null) {
      console.log(`     · ${p.id} — not applicable (${p.cible} is not shipped by this engine)`)
      resultats.push({ id: p.id, conforme: true, applicable: false })
      continue
    }
    const pose = await execReel(['node', join(ICI, p.script), ...avecDsh(racineCible)], REPO)
    const verif = await execReel(['node', join(ICI, p.script), '--check', ...avecDsh(racineCible)], REPO)
    const conforme = pose.code === 0 && verif.code === 0
    // We SAY which copy we wrote to: without this line, a « ✓ » does not say
    // what it measured (P1 of the plan).
    console.log(`     ${conforme ? '✓' : '✗'} ${p.id}  [${racineCible}]`)
    if (!conforme) {
      // The WHY, right away: without it the next session reruns the same
      // 4-minute execution to learn the same thing.
      const detail = (pose.err || pose.sortie || verif.err || '').trim().split('\n').filter((l) => l.trim() !== '').slice(-2)
      for (const l of detail) console.log('       ' + l)
    }
    resultats.push({ id: p.id, conforme, applicable: true, racine: racineCible, script: p.script })
  }
  const perdues = resultats.filter((x) => x.conforme === false)
  if (perdues.length > 0 && tolerance === false) {
    await annulerRetouches(resultats)
    throw new Error('patch(es) that cannot be applied on this engine: ' + perdues.map((x) => x.id).join(', '))
  }
  return resultats
}

const args = process.argv.slice(2)
// --migrer-depuis <checkout>: re-points the links of an old repository to this one (explicit, never silent).
const ANCIENS_DEPOTS = args.flatMap((a, i) => (a === '--migrer-depuis' && typeof args[i + 1] === 'string' ? [resolve(args[i + 1])] : []))
const ordre = args[0] || 'doctor'
const opts = {
  force: args.includes('--force'),
  dry: args.includes('--dry'),
  json: args.includes('--json'),
  port: Number((args.indexOf('--port') >= 0 ? args[args.indexOf('--port') + 1] : undefined) || process.env.KB_PORT || 3080),
  photo: (args[args.indexOf('--photo') + 1] !== undefined && args.indexOf('--photo') >= 0) ? args[args.indexOf('--photo') + 1] : null,
  url: (args[args.indexOf('--url') + 1] !== undefined && args.indexOf('--url') >= 0) ? args[args.indexOf('--url') + 1] : null,
  // `--source <path>`: the folder (or archive) the plugin comes from.
  source: args.indexOf('--source') >= 0 ? args[args.indexOf('--source') + 1] : null,
  // `--restart` (English, the spelling of the hints and the docs); `--relancer`, its former French name, is still accepted.
  relancer: args.includes('--restart') || args.includes('--relancer'),
  // The target version is the first FREE argument. The values of the options
  // are not: without this skip, `--source dist/x.tar.gz` made
  // npm look for a package named after a file path.
  versionCible: (() => {
    const aParametre = new Set(['--source', '--port', '--photo', '--url', '--ref', '--migrer-depuis'])
    const ordres = new Set(['doctor', 'install', 'upgrade', 'rollback', 'uninstall', 'verify', 'bootstrap', 'satellites', 'safe-mode'])
    for (let i = 0; i < args.length; i++) {
      if (aParametre.has(args[i])) { i += 1; continue }
      if (args[i].startsWith('-')) continue
      if (ordres.has(args[i])) continue
      return args[i]
    }
    return null
  })()
}

/** The port the GUI serves on: it determines which process to query. */
const portGui = opts.port

const quitter = (code, ...messages) => { for (const m of messages) console.log(m); process.exit(code) }
const journalOp = (op) => journaliser({ fs: fsReel, journal: JOURNAL, op })
// Links left by an earlier Kybernos archive install (or pointing at a folder that is gone) are re-pointed by install/upgrade only.
const liensReprise = []
const rapporterLien = (nom, ancien) => { liensReprise.push({ nom, racine: String(ancien).slice('link:'.length).replace(/[\\/](?:packages[\\/])?[^\\/]+$/, '') }) }
const versionDuDossier = (dossier) => { try { return readFileSync(join(dossier, 'VERSION'), 'utf8').trim() || null } catch (e) { return null } }
const direLiensReprise = () => {
  if (liensReprise.length === 0) return
  console.log('     ↪ ' + liensReprise.length + ' link(s) of an earlier installation re-pointed to ' + REPO)
  // A signed catalogue never offers an older suite, but a person can run an older archive's launcher: say so instead of doing it silently.
  const nouvelle = versionDuDossier(REPO)
  for (const racine of new Set(liensReprise.map((l) => l.racine))) {
    const ancienne = versionDuDossier(racine)
    if (nouvelle !== null && ancienne !== null && comparerVersions(nouvelle, ancienne) < 0) {
      console.log('     ⚠ suite ' + nouvelle + ' is OLDER than the one that was linked (' + ancienne + '): this is a version downgrade, not an update')
    }
  }
  liensReprise.length = 0
}

// ── boot check: what the user sees ────────────────────────────────────────
// Without --url: HOST check — the robot starts a DSH on a free port
// and reads its output; a « did not activate » warning or a crash = failure.
// With --url: full boot-check on the real page (Failed card, surfaces).
// What a failing boot looks like in DSH's output. A line that matches is a failure of THIS boot; whether it is the suite's doing is decided
// by comparing with the same check made before anything was written (`avant`): a warning that was already there (a third-party plugin,
// a provider registered twice: the owner's own profile prints one at every start) is not ours and must not roll an install back.
const MOTIF_ECHEC_BOOT = /did not activate|startup failed|Error:/i
const lignesEnEchec = (sortie) => [...new Set(String(sortie).split('\n').map((l) => l.trim()).filter((l) => l !== '' && MOTIF_ECHEC_BOOT.test(l)))]

async function verifierBoot (url, { avant = null } = {}) {
  if (url !== null && url !== undefined) {
    const r = await execReel(['node', join(ICI, 'boot-check.mjs')], process.env)
    return { ok: r.code === 0, sortie: r.sortie + r.err, code: r.code }
  }
  const fs = await import('node:fs')
  const port = 0
  let sortie = ''
  // `dsh` is not an executable on Windows but a shim put in place by `npm i -g`:
  // `dsh.cmd`. Measured on 23/09/2026, windows-latest runner: `spawn('dsh', …)`
  // returns « Error: spawn dsh ENOENT » (errno -4058) — same class as `npm.cmd`.
  const binaire = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const win = process.platform === 'win32'
  // And it has to go through the SHELL: since the CVE-2024-27980 fix, Node
  // refuses to launch a .cmd or a .bat directly and returns « Error: spawn EINVAL »
  // (errno -4071) — measured on 23/09/2026, windows-latest runner, on `dsh.cmd`.
  // It is the same rule as `execReel`. The throw is SYNCHRONOUS: an `error`
  // handler does not see it, hence the try/catch — a binary that refuses to start
  // must show in the verdict, never kill the robot in the middle of an installation.
  let proc = null
  try {
    proc = (await import('node:child_process')).spawn(binaire, ['web', '--no-open', '--port', String(port)], {
      cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], detached: false, windowsHide: true, shell: win
    })
  } catch (e) {
    return { ok: false, sortie: binaire + ' could not start: ' + e.message, code: -1 }
  }
  // A missing binary must show in the verdict, never kill the robot: without this
  // handler, Node throws « Unhandled 'error' event » and the whole installation
  // fails on an optional boot check.
  proc.on('error', (e) => { sortie += binaire + ' not found: ' + e.message })
  proc.stdout.on('data', (d) => { sortie += d })
  proc.stderr.on('data', (d) => { sortie += d })
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
  let pret = null
  const demarrage = new Promise((res) => { pret = res })
  const t = setInterval(() => { if (/dsh web: http/.test(sortie)) { clearInterval(t); pret() } }, 250)
  await Promise.race([demarrage, attendre(25000)])
  clearInterval(t)
  // wait for the end of the boot (the warnings arrive after the URL)
  await attendre(3000)
  const tuable = proc
  const mort = new Promise((res) => tuable.on('exit', res))
  tuable.kill()
  await Promise.race([mort, attendre(5000)])
  const s = String(sortie)
  const echecs = lignesEnEchec(s)
  const nouveaux = avant === null ? echecs : echecs.filter((l) => !avant.has(l))
  const ko = nouveaux.length > 0
  return { ok: !ko, sortie: s, code: ko ? 1 : 0, echecs, nouveaux }
}

/** The boot check made BEFORE the first write: the set of failure lines that exist without us (null when there is no profile yet). */
async function etatDeDepartDuBoot () {
  if (opts.url !== null || !existsSync(join(PROFIL_DIR, 'package.json'))) return null
  console.log('  🔎 reference start (what already fails before us will not be held against us)…')
  const depart = await verifierBoot(null)
  if (depart.echecs.length > 0) {
    console.log('     ℹ ' + depart.echecs.length + ' failure line(s) already there before the installation, not blamed on the plugin:')
    for (const l of depart.echecs.slice(0, 3)) console.log('       · ' + l.slice(0, 200))
  }
  return new Set(depart.echecs)
}
const direEchecBoot = (boot) => {
  for (const l of boot.nouveaux.slice(0, 4)) console.log('     · ' + l.slice(0, 220))
}

// ── DOCTOR: read, never write ─────────────────────────────────────────────
// ── RESTART DSH: the only gesture that loads a plugin's HOST code ─────────
// A page reload is not enough (the client yes; the host, no). The
// robot runs in a console, OUTSIDE DSH: it can therefore stop and
// restart it — but only when asked to (`--restart --force`),
// because it is the tester's DSH that gets shut down.
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

async function relancerDsh (port) {
  const trouve = await pidSurPort(port)
  const plan = planRelance(famille(), { port, pid: trouve.valeur })
  if (plan.arreter !== null) {
    console.log('  ⏹ stopping DSH (pid ' + plan.arreter.pid + ')…')
    try { process.kill(Number(plan.arreter.pid), 'SIGTERM') } catch (e) { /* already dead: good */ }
    for (let i = 0; i < 40; i++) { await attendre(250); if ((await pidSurPort(port)).valeur === null) break }
  }
  console.log('  ▶ restarting: ' + plan.demarrer.cmd + ' ' + plan.demarrer.args.join(' ') + ' (detached)')
  const enfant = spawn(plan.demarrer.cmd, plan.demarrer.args, { cwd: REPO, detached: true, stdio: 'ignore' })
  enfant.unref()
  for (let i = 0; i < 60; i++) {
    await attendre(500)
    const p = await pidSurPort(port)
    if (p.valeur !== null && String(p.valeur) !== String(trouve.valeur)) return { ok: true, pid: p.valeur }
  }
  return { ok: false, raison: 'no server answered on port ' + port + ' within 30 s' }
}

// ── THE SOURCE: the repository, a folder, or the archive received by the tester ──
// A received archive is only used after its fingerprints are verified:
// a single difference and we refuse — installing a package we could not
// verify is installing whatever someone put in its place.
//
// Measured on 2026-10-08 (isolated benches, throwaway profile):
//   · an archive received as a FILE was extracted DIRECTLY into `paquets/<name>` (after an rmSync) BEFORE being verified: a
//     tampered or truncated archive of the same name was « refused » but had already replaced the live installation (the
//     profile's links point there). Now: extraction into a staging folder, verification, THEN swap.
//   · the FOLDER passed by `kybernos-install` / `kybernos-update` was never verified, despite what their headers say.
//   · the Suite panel extracts the archive into a TEMPORARY folder then deletes it: the profile's new links
//     pointed into the void and `dsh plugin install` then crashed for good. An archive folder located under the system
//     temporary folder is therefore copied (verified, by swap) into `paquets/` before being linked.
const PAQUETS_DIR = join(DSH_HOME, 'kybernos', 'paquets')
const NOM_SUR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

/** Is this folder under the system temporary folder (hence meant to disappear)? */
const dossierVolatil = (chemin) => {
  try {
    const tmp = realpathSync(tmpdir())
    const c = realpathSync(chemin)
    return c === tmp || c.startsWith(tmp.endsWith(sep) ? tmp : tmp + sep)
  } catch (e) { return false }
}

const pidVivant = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

/** Picks up what a robot killed mid-extraction or mid-swap left behind in `paquets/`. */
const remettreEnOrdrePaquets = () => {
  if (existsSync(PAQUETS_DIR) === false) return
  for (const nom of readdirSync(PAQUETS_DIR)) {
    const etape = /^\.etape-(\d+)-/.exec(nom)
    if (etape !== null && pidVivant(Number(etape[1])) === false) { rmSync(join(PAQUETS_DIR, nom), { recursive: true, force: true }); continue }
    const avant = /^(.+)\.avant-(\d+)$/.exec(nom)
    if (avant !== null && pidVivant(Number(avant[2])) === false) {
      // Killed between the two renames: the live installation was left aside. Put it back.
      if (existsSync(join(PAQUETS_DIR, avant[1])) === false) renameSync(join(PAQUETS_DIR, nom), join(PAQUETS_DIR, avant[1]))
      else rmSync(join(PAQUETS_DIR, nom), { recursive: true, force: true })
    }
  }
}

/** Swaps `etape` (already verified) for `paquets/<name>`: the old one stays aside until the new one is in place. */
const poserDansPaquets = (etape, nom) => {
  const cible = join(PAQUETS_DIR, nom)
  const avant = cible + '.avant-' + process.pid
  if (existsSync(cible)) renameSync(cible, avant)
  try { renameSync(etape, cible) } catch (e) {
    if (existsSync(avant)) renameSync(avant, cible)
    throw e
  }
  rmSync(avant, { recursive: true, force: true })
  return cible
}

const refuserArchive = (verdict, etape) => {
  console.log('🔴 archive NOT conforming — ' + verdict.ecarts.length + ' discrepancy(ies):')
  for (const e of verdict.ecarts.slice(0, 20)) console.log('   · ' + ({ manquant: 'missing', modifie: 'modified', 'en-trop': 'extra' }[e.type] ?? e.type) + ': ' + e.chemin)
  if (etape !== null) rmSync(etape, { recursive: true, force: true })
  quitter(1, '   nothing was installed (nor changed). Ask whoever sent you the archive for a new one.')
}

async function preparerSource () {
  if (opts.source === null) return { chemin: REPO, manifest: null }
  const chemin = resolve(opts.source)
  if (!existsSync(chemin)) quitter(1, '🔴 source not found: ' + chemin)
  if (statSync(chemin).isDirectory()) {
    const manifest = lireManifestDuDossier(chemin)
    if (manifest === null && existsSync(join(chemin, 'manifest.json'))) {
      // A PRESENT but unreadable manifest is not « no manifest »: otherwise damaging it would be enough to escape verification.
      try { JSON.parse(readFileSync(join(chemin, 'manifest.json'), 'utf8')) } catch (e) {
        quitter(1, '🔴 the manifest.json of ' + chemin + ' is unreadable — I refuse to install a folder I cannot verify.')
      }
    }
    if (manifest === null) {
      // A development repository (or any folder that does not come from an archive) has no manifest: nothing to replay.
      REPO = chemin
      COMPAT_CHEMIN = join(REPO, 'dsh-compat.json')
      console.log('  Source: folder ' + REPO)
      return { chemin: REPO, manifest: null }
    }
    const verdict = verifierDossier(chemin, manifest)
    if (!verdict.ok) refuserArchive(verdict, null)
    if (verdict.enTrop.length > 0) console.log('  ⚠ ' + verdict.enTrop.length + ' file(s) not in the manifest in ' + chemin + ' (e.g. ' + verdict.enTrop.slice(0, 3).join(', ') + ') — ignored')
    REPO = chemin
    if (dossierVolatil(chemin)) {
      const nom = nomInstallation(manifest)
      if (nom === null) quitter(1, '🔴 the manifest of ' + chemin + ' does not give a safe installation name — I refuse.')
      remettreEnOrdrePaquets()
      mkdirSync(PAQUETS_DIR, { recursive: true })
      const etape = join(PAQUETS_DIR, '.etape-' + process.pid + '-' + Date.now())
      cpSync(chemin, etape, { recursive: true })
      const copie = verifierDossier(etape, manifest)
      if (!copie.ok) refuserArchive(copie, etape)
      REPO = poserDansPaquets(etape, nom)
      console.log('  Source: temporary folder ' + chemin + ' → copied into ' + REPO + ' (it will disappear, the installation will not)')
    } else {
      console.log('  Source: folder ' + REPO)
    }
    COMPAT_CHEMIN = join(REPO, 'dsh-compat.json')
    console.log('  ' + manifest.total.fichiers + ' files verified, version ' + manifest.version)
    return { chemin: REPO, manifest }
  }
  const nom = basename(chemin).replace(/\.tar\.gz$/, '')
  if (NOM_SUR.test(nom) === false || nom.includes('..')) quitter(1, '🔴 archive name refused: ' + basename(chemin))
  remettreEnOrdrePaquets()
  mkdirSync(PAQUETS_DIR, { recursive: true })
  // Never directly in `paquets/<name>`: that installation may be the one that is running.
  const etape = join(PAQUETS_DIR, '.etape-' + process.pid + '-' + Date.now())
  mkdirSync(etape, { recursive: true })
  // Windows trap (no. 3 of AGENTS.md): an archive path as a file argument
  // would make « D: » be read as a remote host — file NAME + cwd of the folder.
  // The backslashes of the -C target are also eaten by the GNU tar of
  // Git-for-Windows: slashes everywhere (run 36993946467).
  const detar = await execReel(['tar', '-xzf', basename(chemin), '-C', etape.split(sep).join('/')],
    dirname(chemin))
  if (detar.code !== 0) {
    rmSync(etape, { recursive: true, force: true })
    quitter(1, '🔴 archive unreadable: ' + (detar.err || detar.sortie).slice(0, 300) + '\n   nothing was installed (nor changed).')
  }
  let manifest = null
  try { manifest = JSON.parse(readFileSync(join(etape, 'manifest.json'), 'utf8')) } catch (e) {
    rmSync(etape, { recursive: true, force: true })
    quitter(1, '🔴 no manifest.json in ' + chemin + ' — I refuse to install an archive that cannot be verified.')
  }
  const verdict = verifierManifest({ manifest, lire: (c) => readFileSync(join(etape, c)), presents: cheminer(etape, etape, '') })
  if (!verdict.ok) refuserArchive(verdict, etape)
  const dossier = poserDansPaquets(etape, nom)
  console.log('  Source: archive ' + nom + ' — ' + manifest.total.fichiers + ' files verified, version ' + manifest.version)
  REPO = dossier
  COMPAT_CHEMIN = join(REPO, 'dsh-compat.json')
  return { chemin: REPO, manifest }
}

// The engine version to put in place: we read the published tags LIVE and
// pin a precise version. Never `latest`, never a range: that is
// exactly the defect the probe of 23/09/2026 showed (latest = 0.1.5-rc.3
// while alpha = 0.1.7-alpha.2 — installing latest would have REGRESSED the engine).
async function chaineDAssurer () {
  if (opts.versionCible !== null) {
    console.log('  (version asked for explicitly: ' + opts.versionCible + ')')
    return opts.versionCible
  }
  const relever = async (quoi) => {
    const r = await execReel(['npm', 'view', '@deepseek-ai/dsh', quoi, '--json'])
    if (r.code !== 0) {
      const detail = (r.err || r.sortie || '').trim()
      quitter(1, '🔴 cannot read the published versions (`npm view @deepseek-ai/dsh ' + quoi + '` failed):\n' +
        (detail === '' ? '   npm said nothing — is it installed and on the PATH?' : '   ' + detail.slice(0, 300)) +
        '\n   Nothing was installed. Check your connection and npm, then run this again.')
    }
    try { return JSON.parse(r.sortie) } catch (e) { quitter(1, '🔴 unreadable npm output for ' + quoi) }
  }
  const tags = await relever('dist-tags') || {}
  const zone = lireCompat({ fs: fsReel, chemin: COMPAT_CHEMIN })?.dsh ?? null
  const dedans = (v) => zone === null || zone.min === undefined ||
    (comparerVersions(v, zone.min) >= 0 && comparerVersions(v, zone.max) <= 0)
  const ligne = 'alpha ' + (tags.alpha ?? '—') + ' · next ' + (tags.next ?? '—') + ' · latest ' + (tags.latest ?? '—')
  // The choice MUST stay inside the proven range. Measured on 23/09/2026: `alpha`
  // was 0.1.7-alpha.2, one notch ABOVE the tested max — the robot would thus have
  // put an engine in place, then refused its own installation, every time, on
  // every fresh machine. A tag outside the range is not a choice.
  for (const canal of ['alpha', 'next', 'latest']) {
    if (tags[canal] !== undefined && dedans(tags[canal])) {
      console.log('  (read live — ' + ligne + ' → pinning ' + tags[canal] + ', inside the tested range)')
      return tags[canal]
    }
  }
  const versions = await relever('versions') || []
  const candidates = (Array.isArray(versions) ? versions : []).filter(dedans).sort(comparerVersions)
  const choix = candidates[candidates.length - 1]
  if (choix === undefined) {
    quitter(1, '🔴 no published version is inside the tested range' +
      (zone === null ? '' : ' (' + zone.min + ' … ' + zone.max + ')') + '.\n' +
      '   Read: ' + ligne + '.\n' +
      '   Two ways out: wait for a tested version, or force with --force after reading what the range says.')
  }
  console.log('  (read live — ' + ligne + ' · no alpha/next/latest tag is inside the tested range' +
    (zone === null ? '' : ' ' + zone.min + ' … ' + zone.max) + ' → pinning the highest tested: ' + choix + ')')
  return choix
}

async function installerMoteur (cible, opts = {}) {
  // `tolere`: throw instead of exiting. The installation has nothing to put back
  // before having written, so it may exit; the upgrade, though, has
  // already taken a photo and MUST go through its `catch` to restore it.
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
  console.log('  ⬇ npm install @deepseek-ai/dsh@' + cible + ' pinned (' + PAQUETS_EPINGLES.length + ' sub-packages) …')
  console.log('     (reference tree in ' + projet + ')')
  // `--allow-scripts` is refused for a project installation (measured:
  // « EALLOWSCRIPTS — not allowed in project-scoped installs »). npm settles
  // for a warning, and the engine runs without these post-install scripts.
  // 10 minutes: `npm install` on a cold Windows (or a beta tester's
  // connection) goes well beyond 3 minutes. Measured on 23/09/2026: the
  // windows-latest runner was cut at 180 s, with empty streams.
  const r = await execReel(['npm', 'install', '--no-audit', '--no-fund'], projet, 600000)
  if (r.code !== 0) {
    const cause = r.delaiDepasse === true
      ? 'timed out (' + Math.round(r.delaiMs / 1000) + ' s) — slow network or cold machine, run it again'
      : 'code ' + r.code + ' · ' + (r.err || r.sortie || '(npm said nothing)').slice(0, 400)
    echouer('🔴 npm failed: ' + cause)
  }
  const moteur = join(projet, 'node_modules', '@deepseek-ai', 'dsh')
  if (existsSync(moteur) === false) echouer('🔴 npm did not put @deepseek-ai/dsh in ' + projet)

  // The binary is linked into the GLOBAL prefix (see `lierDansLePrefixe`).
  const vrai = join(projet, 'node_modules', '.bin', famille() === 'windows' ? 'dsh.cmd' : 'dsh')
  const lien = await lierDansLePrefixe(vrai, 'dsh', echouer)
  if (lien !== null) {
    // The engine has just CHANGED: everything resolved before (patch root,
    // surface audit) designated the old tree.
    RACINE_CACHE = null
    console.log('  (dsh linked in ' + lien + ')')
  }
  const vu = await versionDuGlobal({ exec: execReel })
  if (vu === null) {
    echouer('🔴 engine ' + cible + ' is in place, but `dsh` still does not answer.\n' +
      '   Open a NEW terminal (the PATH of this one predates the installation), then run it again:\n' +
      '     ' + (famille() === 'windows' ? 'kybernos-install' : './kybernos-install'))
  }
  console.log('  ✓ engine ' + vu + ' in place and reachable' + (vu === cible ? '' : ' (⚠ expected ' + cible + ')'))
}

// ── One installer at a time ──────────────────────────────────────────────────
// The orders that change the profile take the installation lock before touching anything (the source is verified and copied by `preparerSource` right after) and give it
// back when the process ends, however it ends: `quitter`, an error, SIGINT or SIGTERM. A lock held by a live process refuses the order with a sentence, since two robots
// writing the same profile is what the lock exists to prevent; a lock whose process is gone is stale and is taken over. The Suite panel reads this file to know that an
// installer runs, even when the DSH that started it was killed and the robot went on as an orphan. `--dry` writes nothing and takes nothing.
if (['install', 'upgrade', 'bootstrap', 'rollback', 'uninstall'].includes(ordre) && opts.dry !== true) {
  const genre = ordre === 'upgrade' ? (opts.source !== null ? 'suite' : 'engine') : ordre
  const pris = prendreVerrou({ fichier: VERROU_INSTALLATION, genre, source: opts.source === null ? null : resolve(opts.source) })
  if (pris.ok !== true) {
    const qui = pris.verrou === null || pris.verrou === undefined ? '' : ' (pid ' + pris.verrou.pid + ', started ' + new Date(pris.verrou.debut).toISOString() + ', ' + pris.verrou.genre + ')'
    quitter(1, '🟠 another installation is already running' + qui + '. Wait for it to end, then run this again. Nothing was changed.\n   (If you are sure it is gone, delete ' + VERROU_INSTALLATION + '.)')
  }
  if (pris.sansVerrou === true) console.log('  ⚠ the installation lock could not be written (' + pris.detail + '): going on without it')
  else {
    process.on('exit', () => libererVerrou({ fichier: VERROU_INSTALLATION }))
    // A signal gives the lock back and is then re-sent to ourselves with its default action, so the parent still sees « killed by SIGTERM » (its time limit, a kill) and not a
    // plain exit code: the Suite panel words a killed installer differently from one that refused (L3-88). SIGKILL cannot be caught: its lock is found stale by the next reader.
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { libererVerrou({ fichier: VERROU_INSTALLATION }); process.kill(process.pid, signal) })
  }
}

const source = await preparerSource()

if (ordre === 'satellites') {
  // Model 3: satellite management. List, activate, deactivate.
  //   satellites --liste                → current state (active/inactive)
  //   satellites --activer <name> [...] → activates these satellites
  //   satellites --desactiver <name>... → deactivates them
  //   satellites --tout                 → activates everything (reset)
  const manifeste = LIRE_SATELLITES(REPO)
  if (manifeste === null) quitter(1, '✗ docs/beta/satellites.json unreadable')
  const tous = TOUS_LES_SATELLITES(REPO)
  const socle = (manifeste.socle?.bundles ?? []).map((b) => b.nom)
  // An ABSENT activation file means "everything is active" (see lireSatellitesActives).
  // Returning [] here made `--desactiver x` on a fresh install write "0 active": it
  // switched EVERY satellite off instead of just x.
  // Packages the manifest does not manage (neither socle nor satellite) stay on.
  const nonGeres = PACKAGES.map((p) => p.nom).filter((n) => typeof n === 'string' && !tous.some((s) => s.nom === n) && !socle.includes(n))
  const lireActives = () => {
    try {
      const brut = JSON.parse(readFileSync(SATELLITES_ACTIVES_FICHIER, 'utf8'))
      const liste = activesResolues({ brut, satellites: manifeste.satellites?.bundles ?? [], socle })
      if (liste !== null) return liste.filter((n) => !socle.includes(n))
    } catch (e) { /* absent or unreadable: fall through */ }
    return tous.map((s) => s.nom).filter((n) => !socle.includes(n))
  }
  // Write the activation file AND bring the profile in line with it, otherwise the
  // change only shows up at the next install/upgrade. Needs a DSH restart to apply.
  const ecrireActives = (liste) => {
    mkdirSync(join(DSH_HOME, 'kybernos'), { recursive: true })
    writeFileSync(SATELLITES_ACTIVES_FICHIER, JSON.stringify({ actives: liste, desactives: desactivesAEcrire({ liste, satellites: manifeste.satellites?.bundles ?? [] }), maj: new Date().toISOString() }, null, 2) + '\n')
    if (existsSync(join(PROFIL_DIR, 'package.json'))) {
      alignerLiens({ fs: fsReel, profilDir: PROFIL_DIR, repoDir: REPO, anciensDepots: ANCIENS_DEPOTS, packages: PACKAGES, actives: [...new Set([...socle, ...liste, ...nonGeres])] })
      console.log('  Profile updated. Restart DSH to apply (a satellite never installed before needs ./kybernos-update to be linked).')
    }
  }
  const argsSat = args.filter((a, i) => i > 0 && !a.startsWith('--') && args[i - 1] !== '--liste')
  if (args.includes('--liste') || args.length === 1) {
    const actives = lireActives()
    const actifsSet = new Set([...socle, ...actives])
    console.log('Kybernos satellites — activation state')
    console.log('')
    console.log('CORE (always on)')
    for (const s of (manifeste.socle?.bundles ?? [])) {
      console.log('  ✓ ' + s.nom.padEnd(28) + ' tier ' + s.tier + '  ' + s.role)
    }
    console.log('')
    console.log('SATELLITES')
    for (const s of (manifeste.satellites?.bundles ?? [])) {
      const actif = actifsSet.has(s.nom)
      console.log('  ' + (actif ? '✓' : '·') + ' ' + s.nom.padEnd(28) + ' tier ' + s.tier + '  ' + (actif ? 'ACTIVE' : 'inactive') + '  ' + s.role)
    }
    console.log('')
    console.log('Activation file: ' + SATELLITES_ACTIVES_FICHIER)
    process.exit(0)
  }
  if (args.includes('--tout')) {
    ecrireActives(tous.map((s) => s.nom))
    console.log('✓ all satellites activated (' + tous.length + ')')
    process.exit(0)
  }
  if (args.includes('--activer')) {
    const noms = argsSat.filter((a) => tous.some((s) => s.nom === a || s.dir === a))
    if (noms.length === 0) quitter(1, '✗ --activer expects at least one satellite name')
    const actuelles = lireActives()
    const nouvelles = [...new Set([...actuelles, ...noms.map((n) => tous.find((s) => s.nom === n || s.dir === n).nom)])]
    ecrireActives(nouvelles)
    console.log('✓ activated: ' + noms.join(', '))
    console.log('  total active: ' + nouvelles.length + ' satellite(s)')
    process.exit(0)
  }
  if (args.includes('--desactiver')) {
    const noms = argsSat.filter((a) => tous.some((s) => s.nom === a || s.dir === a))
    if (noms.length === 0) quitter(1, '✗ --desactiver expects at least one satellite name')
    const nomsComplets = noms.map((n) => tous.find((s) => s.nom === n || s.dir === n).nom)
    // The core is never switched off
    const interdits = nomsComplets.filter((n) => socle.includes(n))
    if (interdits.length > 0) quitter(1, '✗ the core cannot be switched off: ' + interdits.join(', '))
    const actuelles = lireActives()
    const nouvelles = actuelles.filter((n) => !nomsComplets.includes(n))
    ecrireActives(nouvelles)
    console.log('✓ deactivated: ' + noms.join(', '))
    console.log('  total active: ' + nouvelles.length + ' satellite(s)')
    process.exit(0)
  }
  quitter(1, 'Usage: satellites [--liste | --tout | --activer <name>… | --desactiver <name>…]')
}

if (ordre === 'safe-mode') {
  // Safe mode = the socle only. Same activation file as `satellites`, plus a saved
  // copy of what was active so `off` restores exactly that.
  //   safe-mode            → status (same as `status`)
  //   safe-mode on         → photo, keep only the socle, remember the previous list
  //   safe-mode off        → restore the previous list
  // Takes effect at the next DSH restart.
  const manifeste = LIRE_SATELLITES(REPO)
  if (manifeste === null) quitter(1, '✗ docs/beta/satellites.json unreadable')
  const tous = TOUS_LES_SATELLITES(REPO)
  const socle = (manifeste.socle?.bundles ?? []).map((b) => b.nom)
  const fichierEtat = join(DSH_HOME, 'kybernos', FICHIER_ETAT)
  const lireEtat = () => { try { return normaliserEtatBoot(JSON.parse(readFileSync(fichierEtat, 'utf8'))) } catch (e) { return normaliserEtatBoot(null) } }
  const ecrireEtat = (etat) => { mkdirSync(dirname(fichierEtat), { recursive: true }); writeFileSync(fichierEtat, JSON.stringify(etat, null, 2) + '\n') }
  const ecrireActivesSafe = (liste) => {
    mkdirSync(join(DSH_HOME, 'kybernos'), { recursive: true })
    writeFileSync(SATELLITES_ACTIVES_FICHIER, JSON.stringify({ actives: liste, desactives: desactivesAEcrire({ liste, satellites: manifeste.satellites?.bundles ?? [] }), maj: new Date().toISOString() }, null, 2) + '\n')
  }
  // Absent file = everything active (historical behaviour), so "before" is the full list.
  const activesCourantes = () => {
    try {
      const brut = JSON.parse(readFileSync(SATELLITES_ACTIVES_FICHIER, 'utf8'))
      const liste = activesResolues({ brut, satellites: manifeste.satellites?.bundles ?? [], socle })
      if (liste !== null) return liste.filter((n) => !socle.includes(n))
    } catch (e) { /* absent */ }
    return tous.map((s) => s.nom).filter((n) => !socle.includes(n))
  }
  const sous = args[1] && !args[1].startsWith('-') ? args[1] : 'status'
  const etat = lireEtat()
  if (sous === 'status') {
    const reco = recommandationBoot(etat)
    console.log('Safe mode : ' + (etat.safe.actif ? 'ON since ' + etat.safe.depuis + ' (' + etat.safe.activesAvant.length + ' satellite(s) to restore)' : 'off'))
    console.log('Boots     : ' + (etat.demarrages.length === 0 ? 'none recorded yet' : etat.demarrages.slice(-5).map((d) => d.gui).join(' → ')))
    console.log('Verdict   : ' + reco.mode + ' — ' + reco.raison)
    // The browser names the bundles DSH failed to activate. Turn that into the most
    // precise action: a failing satellite is switched off alone; a failing socle
    // bundle cannot be set aside (it IS the socle), so the way back is the photo.
    const suspects = reco.suspects ?? []
    const enSocle = suspects.filter((n) => socle.includes(n))
    const satellites = suspects.filter((n) => !socle.includes(n)).map((n) => tous.find((s) => s.nom === n)?.dir).filter(Boolean)
    if (suspects.length > 0) console.log('Suspects  : ' + suspects.map((n) => n + (socle.includes(n) ? ' (socle)' : '')).join(', '))
    if (satellites.length > 0) console.log('→ switch the failing satellite(s) off, nothing else: node scripts/dsh-lifecycle.mjs satellites --desactiver ' + satellites.join(' '))
    if (enSocle.length > 0) console.log('→ a socle bundle is failing, safe mode cannot set it aside. Go back to the last safety photo: node scripts/dsh-lifecycle.mjs rollback')
    if (reco.mode === 'safe-recommande' && suspects.length === 0) console.log('→ run: node scripts/dsh-lifecycle.mjs safe-mode on')
    process.exit(0)
  }
  if (sous === 'on') {
    if (etat.safe.actif) quitter(0, 'Safe mode is already on.')
    const avant = activesCourantes()
    if (opts.dry) quitter(0, 'DRY: would keep only the socle (' + socle.length + ') and remember ' + avant.length + ' satellite(s).')
    let plugin = 'unknown'
    try { plugin = await versionDuPlugin({ exec: execReel, repoDir: REPO }) } catch (e) { /* best effort */ }
    await photoAvantTout({ global: '(safe-mode)', plugin })
    ecrireEtat(entrerSafe(etat, { activesAvant: avant, date: new Date().toISOString() }))
    ecrireActivesSafe([])
    alignerLiens({ fs: fsReel, profilDir: PROFIL_DIR, repoDir: REPO, anciensDepots: ANCIENS_DEPOTS, packages: PACKAGES, actives: socle })
    journalOp({ date: new Date().toISOString(), quoi: 'safe-mode', de: 'normal', vers: 'safe', resultat: 'succes', raison: 'safe-mode on (' + avant.length + ' satellite(s) set aside)' })
    quitter(0, '✓ Safe mode ON: only the socle will load (' + socle.length + ' bundle(s)); ' + avant.length + ' satellite(s) set aside.', '  Restart DSH to apply. To come back: node scripts/dsh-lifecycle.mjs safe-mode off')
  }
  if (sous === 'off') {
    if (!etat.safe.actif) quitter(0, 'Safe mode is not on.')
    const { etat: propre, aRestaurer } = sortirSafe(etat)
    if (opts.dry) quitter(0, 'DRY: would restore ' + aRestaurer.length + ' satellite(s).')
    ecrireActivesSafe(aRestaurer)
    const nonGeres = PACKAGES.map((p) => p.nom).filter((n) => typeof n === 'string' && !tous.some((s) => s.nom === n) && !socle.includes(n))
    alignerLiens({ fs: fsReel, profilDir: PROFIL_DIR, repoDir: REPO, anciensDepots: ANCIENS_DEPOTS, packages: PACKAGES, actives: [...new Set([...socle, ...aRestaurer, ...nonGeres])] })
    ecrireEtat(propre)
    journalOp({ date: new Date().toISOString(), quoi: 'safe-mode', de: 'safe', vers: 'normal', resultat: 'succes', raison: 'safe-mode off (' + aRestaurer.length + ' satellite(s) restored)' })
    quitter(0, '✓ Safe mode OFF: ' + aRestaurer.length + ' satellite(s) restored.', '  Restart DSH to apply.')
  }
  quitter(64, 'Usage: safe-mode [status | on | off] [--dry]')
}

if (ordre === 'doctor') {
  const etat = await etatDoctor({ fs: fsReel, exec: execReel, profilDir: PROFIL_DIR, repoDir: REPO, packages: PACKAGES_ACTIFS, patches: PATCHES, compatChemin: COMPAT_CHEMIN })
  const verresPatchs = []
  const racine = await racineGlobale()
  const retirees = []
  const versionMoteur = etat.global ?? await versionDuGlobal({ exec: execReel })
  for (const p of PATCHES) {
    const r = await execReel(['node', join(ICI, p.script), '--check', ...avecDsh(racine)], REPO)
    // A REMOVED patch is expected to be ABSENT: that it is still applied is
    // a discrepancy (the installation did not follow), not a success to count.
    const motifRetrait = motifDeRetrait(p, versionMoteur)
    if (motifRetrait !== null) {
      retirees.push({ id: p.id, motif: motifRetrait, encorePosee: r.code === 0 })
      if (r.code === 0) etat.problemes.push(`patch « ${p.id} » is removed but still applied in the engine — run the installation again to remove it`)
      continue
    }
    verresPatchs.push({ id: p.id, pose: r.code === 0 })
    if (r.code !== 0) etat.problemes.push(`patch « ${p.id} » is not applied in the engine`)
  }
  etat.retirees = retirees
  // Does the running server serve the engine that is on disk? A server
  // older than the last installation serves the old version from its
  // memory — that mix is what displayed « Failed to load plugins ».
  const fraicheur = await mesurerFraicheur()
  etat.fraicheur = fraicheur
  if (fraicheur.perime === true) etat.problemes.push(fraicheur.raison)
  // ── the engine SURFACES ──────────────────────────────────────────────────
  // An « applied » patch does not say its anchor still exists: the upgrade
  // 0.1.6 → 0.1.7 broke four contracts silently (settings.get,
  // AgentPreset.path, the arity of sessionVisible/deriveFlat, renamed
  // icons). So we audit the contracts at every doctor, and we also flag
  // what the engine now ships natively (duplicate or capability not
  // mounted). `--ref <root>` measures the « absent » probes on a bare bench.
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
  // The server record goes into the JSON: the scenario acceptance run (§15 G)
  // compares `doctor --json` from one machine to another, so it needs the pid,
  // the dates AND the source that measured.
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
  console.log(`\n  DSH engine: ${etat.global ?? 'absent (not on the PATH)'}   Plugin: ${etat.plugin}`)
  console.log(`  Status: ${etat.couleur === 'verte' ? '🟢 all good' : '🟠 needs attention'}`)
  // The PREFLIGHT: what is available HERE, and by what we measured. A
  // tester on Windows must be able to read it — not assume it is `lsof`.
  const fam = famille()
  const par = []
  if (fraicheur.sourcePid !== null && fraicheur.sourcePid !== undefined) par.push(fraicheur.sourcePid)
  if (fraicheur.sourceDemarrage !== null && fraicheur.sourceDemarrage !== undefined) par.push(fraicheur.sourceDemarrage)
  console.log(`  Platform: ${process.platform} (${fam}) — supervision ${nomSuperviseur(fam)}` +
    (par.length === 0 ? ' — server measured by no source' : ' — server measured via ' + par.join(' + ')))
  console.log(`  Server: ${fraicheur.verdict === 'frais' ? '✓ started after the installation' : (fraicheur.perime === true ? '✗ started before the installation' : '○ ' + fraicheur.raison)}`)
  if (etat.problemes.length > 0) { console.log('  Problems:'); for (const p of etat.problemes) console.log('    · ' + p) }
  console.log(`  Patches: ${verresPatchs.filter((p) => p.pose).length}/${verresPatchs.length} applied`)
  for (const r of retirees) {
    console.log(`    · ${r.id} — removed${r.encorePosee ? ' (STILL APPLIED: run the installation again)' : ''} (${r.motif})`)
  }
  console.log(`  Surfaces: ${etat.surfaces.conformes}/${etat.surfaces.total} engine contracts compliant` +
    (etat.surfaces.mesureesSurVierge > 0 ? ` (${etat.surfaces.mesureesSurVierge} measured on a clean backup)` : '') +
    (etat.surfaces.aVerifier.length > 0 ? ` — ${etat.surfaces.aVerifier.length} to check on a bare engine (--ref <root>)` : ''))
  const livres = etat.surfaces.natifs.filter((n) => n.livre)
  if (livres.length > 0) console.log(`  Native: ${livres.length} capabilities shipped by the engine — ${livres.map((n) => n.quoi.split(' ')[0] + ' ' + n.paquet.replace(/^dsh-(experimental-)?/, '')).join(' ; ')}`)
  for (const d of etat.surfaces.doublons) console.log(`    ↳ ${d}`)
  const j = lireJournal({ fs: fsReel, journal: JOURNAL, limite: 3 })
  if (j.length > 0) console.log(`  Last operation: ${j[0].quoi} ${j[0].de} → ${j[0].vers} (${j[0].resultat})`)
  process.exit(etat.couleur === 'verte' ? 0 : 1)
}

// ── the gate: gesture no. 1 of install AND upgrade ───────────────────────
async function porteCompat (cible) {
  if (cible === null || cible === undefined) {
    quitter(1, '🔴 no readable DSH engine (`dsh --version` does not answer).\n' +
      '   Put it in place first — `./kybernos-install` does that — then run this again.')
  }
  const compat = lireCompat({ fs: fsReel, chemin: COMPAT_CHEMIN })
  const v = testerCompatibilite({ cible, compat, force: opts.force })
  if (v.verdict === 'refuse') quitter(1, '\n🔴 ' + v.raison)
  if (v.avertissement) console.log('\n🟠 ' + v.raison)
  return v
}

async function photoAvantTout (versions) {
  const photo = await photographier({ fs: fsReel, profilDir: PROFIL_DIR, photosDir: PHOTOS_DIR, horodatage: horodatage(), versions, horloge: horlogeReelle })
  console.log('  📸 safety photo: ' + photo.dossier)
  return photo
}

// ── INSTALL: graft the plugin onto a profile ──────────────────────────────
// The body of the installation, extracted so it can be called by `install` AND by
// `bootstrap`: both beta scenarios end with the same gesture.
async function faireInstall () {
  const cible = await versionDuGlobal({ exec: execReel })
  await porteCompat(cible)
  if (opts.dry) {
    quitter(0, '\n  (dry-run: source ' + REPO + ', engine ' + cible + ' — nothing was changed)\n' +
      instructionsRedemarrage(famille(), portGui))
  }
  const versions = { global: cible, plugin: await versionDuPlugin({ exec: execReel, repoDir: REPO }) }
  const bootAvant = await etatDeDepartDuBoot()
  const photo = await photoAvantTout(versions)
  // On a NEW machine, the profile does not exist yet: `alignerLiens` and
  // `poserPatchs` write INTO it (package.json, cordis.patch.yml). The
  // historical order (link -> patch -> install) only worked because the
  // profile already existed. Measured on 23/09/2026 in isolated scenario B: ENOENT
  // package.json from `alignerLiens`. So we first ask DSH to create the
  // profile (194 ms on a bare HOME), then we fill it.
  // One way out for every step below that can fail for reasons nobody controls (pnpm: no network, a registry that is down, a
  // full disk, a store in use; a patch that no longer fits): put the photo back, say it in words, journal it. Before this, a
  // pnpm failure escaped as a raw stack trace with the links already written to package.json, no restore and no journal line.
  const abandonner = async (e) => {
    const date = new Date().toISOString()
    console.log('  ❌ ' + e.message)
    console.log('  ↩ back to the state before the photo')
    await restaurerPhoto({ fs: fsReel, photosDir: PHOTOS_DIR, photoDossier: photo.dossier, profilDir: PROFIL_DIR })
    await journalOp({ date, quoi: 'plugin', de: '—', vers: versions.plugin, resultat: 'echec', raison: e.message, photo: photo.dossier })
    quitter(1, '\n🔴 installation interrupted before the end — your machine is back to how it was. Nothing changed.')
  }
  if (!existsSync(join(PROFIL_DIR, 'package.json'))) {
    console.log('  🧱 the profile does not exist yet — DSH creates it (the normal case of a new machine)…')
    try { await installerProfil() } catch (e) { await abandonner(e) }
  }
  console.log('  🔗 linking the repository packages to the profile…')
  alignerLiens({ fs: fsReel, profilDir: PROFIL_DIR, repoDir: REPO, anciensDepots: ANCIENS_DEPOTS, packages: PACKAGES, actives: ACTIVES, reprendre: true, rapporter: rapporterLien })
  direLiensReprise()
  console.log('  📦 installing the profile (pnpm)…')
  try { await installerProfil() } catch (e) { await abandonner(e) }
  // The patches touch the `@deepseek-ai/*` packages of the PROFILE (the global
  // installation only carries the `dsh` package since 0.1.7). Applying them before the profile
  // pnpm amounts to patching an empty folder: measured on 23/09/2026 in
  // isolated scenario B — `queue-move` and `model-search` ✗ on a fresh engine, ✓ on
  // a machine where the profile is already populated. So we patch AFTER the installation
  // that makes them present.
  console.log('  🧶 re-applying the engine patches…')
  try {
    await poserPatchs()
  } catch (e) {
    // A patch that cannot be applied is a feature lost: we do not continue
    // and we do not leave a stack trace to the tester either.
    await abandonner(e)
  }
  console.log('  🔎 checking the boot…')
  const boot = await verifierBoot(opts.url, { avant: bootAvant })
  const date = new Date().toISOString()
  if (!boot.ok) {
    console.log('  ❌ the boot fails — back to the state before the photo')
    direEchecBoot(boot)
    await restaurerPhoto({ fs: fsReel, photosDir: PHOTOS_DIR, photoDossier: photo.dossier, profilDir: PROFIL_DIR })
    await poserPatchs({ tolerance: true })
    await journalOp({ date, quoi: 'plugin', de: '—', vers: versions.plugin, resultat: 'echec', raison: 'boot failed, photo put back', photo: photo.dossier })
    quitter(1, '\n🔴 the installation failed — your machine is back to how it was. Nothing changed.')
  }
  await journalOp({ date, quoi: 'plugin', de: '—', vers: versions.plugin, resultat: 'reussi', raison: 'installation', photo: photo.dossier })
  if (opts.relancer) {
    if (!opts.force) quitter(1, '\n  --restart shuts down the DSH that is running. Add --force if that is what you want.')
    const suite = await relancerDsh(portGui)
    if (!suite.ok) {
      await journalOp({ date, quoi: 'plugin', de: '—', vers: versions.plugin, resultat: 'reussi', raison: 'installation, restart failed: ' + suite.raison, photo: photo.dossier })
      quitter(1, '\n🟠 the plugin is installed, but the restart failed: ' + suite.raison +
        '\n   Start DSH yourself (`dsh web --port ' + portGui + '`), then reload the page.')
    }
    quitter(0, '\n🟢 installation succeeded, DSH restarted (pid ' + suite.pid + '). Reload the DSH page to see Kybernos.\n' +
      '   (page closed? `dsh web --port ' + portGui + '` opens your browser already signed in.)')
  }
  quitter(0, '\n🟢 installation succeeded.\n' + instructionsRedemarrage(famille(), portGui))
}

if (ordre === 'install') await faireInstall()

// ── BOOTSTRAP: the TWO entry points of the beta, in a single order ────────
//   A. the tester already has DSH → we do not touch the engine, we graft the plugin;
//   B. the machine is bare        → we first put the engine in place, pinned.
// The decision is MEASURED (`dsh --version`), not asked: a tester must not
// have to know which case they are in.
if (ordre === 'bootstrap') {
  const global = await versionDuGlobal({ exec: execReel })
  console.log('\n  Scenario ' + (global === null ? 'B — this machine does not have DSH yet' : 'A — DSH ' + global + ' is already installed'))
  if (global === null) {
    const cible = await chaineDAssurer()
    const serv = await pidSurPort(portGui)
    if (serv.valeur !== null) {
      // D7: refusal, then THE EXACT COMMAND. Never sudo, never escalation.
      quitter(1, '🔴 a DSH server answers on port ' + portGui + ' (pid ' + serv.valeur + ') although `dsh` is not on the PATH.\n' +
        '   I do not touch an installation I cannot read. If it is yours, put the engine in place yourself:\n' +
        '     npm i -g @deepseek-ai/dsh@' + cible + ' ' + ALLOW_SCRIPTS + '\n' +
        '   (note that `npm i -g` alone does not pin the sub-packages the plugin patches:\n' +
        '    the robot puts a pinned tree in ' + MOTEUR_DIR + ')')
    }
    if (opts.dry) {
      quitter(0, '\n  (dry-run: engine ' + cible + ' would be put in place, then the plugin — nothing was changed)\n' +
        instructionsRedemarrage(famille(), portGui))
    }
    await installerMoteur(cible)
  } else if (opts.dry) {
    quitter(0, '\n  (dry-run: the plugin would be grafted onto engine ' + global + ' — nothing was changed)\n' +
      instructionsRedemarrage(famille(), portGui))
  }
  await faireInstall()
}

// ── UPGRADE: the 8 gestures ──────────────────────────────────────────────
if (ordre === 'upgrade') {
  const depuis = await versionDuGlobal({ exec: execReel })
  const cible = opts.versionCible || depuis
  const v = await porteCompat(cible)
  const versions = { global: cible, plugin: await versionDuPlugin({ exec: execReel, repoDir: REPO }) }
  const plan = planUpgrade({ cible, depuis, compatVerdict: v.verdict, aDesBundles: true })
  console.log('\n  Plan : ' + plan.join(' → '))
  if (opts.dry) quitter(0, '\n  (dry-run: nothing was changed)')

  const bootAvant = await etatDeDepartDuBoot()
  const photo = await photoAvantTout({ global: depuis, plugin: versions.plugin })
  const date = new Date().toISOString()
  try {
    if (plan.includes('remplacer-moteur')) {
      console.log(`  🔄 DSH engine ${depuis} → ${cible}…`)
      // Through the same path as the installation — pinned tree in the home, then
      // link in the prefix. Measured on 23/09/2026: `npm i -g` here failed with
      // EEXIST on `prefix/bin/dsh` (the link OUR installation had just
      // put in place), so the FIRST engine upgrade was dead for every
      // tester — and, even when it succeeded, it would not have put in place any of the pinned
      // sub-packages that the plugin patches.
      await installerMoteur(cible, { tolere: true })
    }
    console.log('  📝 aligning the settings sheet (@deepseek-ai pins → ' + cible + ')…')
    const pkgProfil = JSON.parse(fsReel.lire(join(PROFIL_DIR, 'package.json')))
    const nomsDsh = Object.keys(pkgProfil.dependencies || {}).filter((k) => k.startsWith('@deepseek-ai/'))
    const publiees = await versionsPubliees(nomsDsh)
    const alignement = alignerPins({ fs: fsReel, profilDir: PROFIL_DIR, cible, disponibles: publiees })
    for (const r of alignement.retires) {
      console.log(`     ⚠ ${r.nom} is not published in ${cible} (latest: ${r.derniere ?? 'unknown'}) — removed from the profile`)
    }
    for (const b of alignement.bundlesRetires) console.log(`       ↳ bundle removed: ${b}`)
    alignerLiens({ fs: fsReel, profilDir: PROFIL_DIR, repoDir: REPO, anciensDepots: ANCIENS_DEPOTS, packages: PACKAGES, actives: ACTIVES, reprendre: true, rapporter: rapporterLien })
    direLiensReprise()
    console.log('  🧶 re-applying the engine patches…')
    await poserPatchs()
    console.log('  📦 installing the profile (pnpm)…')
    await installerProfil()
    console.log('  🔎 checking the boot…')
    const boot = await verifierBoot(opts.url, { avant: bootAvant })
    if (!boot.ok) { direEchecBoot(boot); throw new Error('boot failed') }
    await journalOp({ date, quoi: 'moteur', de: depuis, vers: cible, resultat: 'reussi', photo: photo.dossier })
    quitter(0, `\n🟢 update succeeded: engine ${depuis} → ${cible}, plugin ${versions.plugin}. Reload the DSH page.`)
  } catch (e) {
    console.log('\n  ❌ ' + (e.message || e) + ' — back to the photo')
    await restaurerPhoto({ fs: fsReel, photosDir: PHOTOS_DIR, photoDossier: photo.dossier, profilDir: PROFIL_DIR })
    // the engine AND the patches go back to the original version
    if (depuis !== cible) {
      // Back to the previous engine through the same path (pinned tree + link).
      try { await installerMoteur(depuis, { tolere: true }) } catch (e) { console.log('  ⚠ engine rollback ' + depuis + ': ' + (e.message || e)) }
    }
    await poserPatchs({ tolerance: true })
    // The same pnpm that just failed may fail again (no network): the profile files are already back from the photo, so say so
    // and finish the journal instead of dying here with a stack trace.
    try { await installerProfil() } catch (e2) { console.log('  ⚠ putting the profile back in order (pnpm) failed too: ' + (e2.message || e2) + ' — package.json and the lockfile are the photo\'s; run again when pnpm answers') }
    await journalOp({ date, quoi: 'moteur', de: cible, vers: depuis, resultat: 'retour-arriere', raison: String(e.message || e).slice(0, 200), photo: photo.dossier })
    quitter(1, '\n🟠 the update failed — your machine is back to how it was. Nothing changed.')
  }
}

// ── ROLLBACK: the emergency button ─────────────────────────────────────────
if (ordre === 'rollback') {
  const avant = await versionDuGlobal({ exec: execReel })
  const r = await restaurerPhoto({ fs: fsReel, photosDir: PHOTOS_DIR, photoDossier: opts.photo, profilDir: PROFIL_DIR })
  console.log('  📸 photo restored: ' + r.dossier + ' (' + r.recopies.join(', ') + ')')
  try { await installerProfil() } catch (e) { console.log('  ⚠ pnpm failed after the restore: ' + (e.message || e) + ' — package.json, the lockfile and cordis.patch.yml are the photo\'s; run again when pnpm answers') }
  await poserPatchs({ tolerance: true })
  const apres = await versionDuGlobal({ exec: execReel })
  await journalOp({ date: new Date().toISOString(), quoi: 'moteur', de: avant, vers: apres, resultat: 'retour-arriere', raison: 'rollback requested', photo: r.dossier })
  quitter(0, '\n🟢 rollback done. Reload the DSH page.')
}

// ── UNINSTALL: remove cleanly, without breaking the rest ───────────────────
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
  console.log('  🧹 links and bundles removed from the profile (the rest is intact)')
  await journalOp({ date: new Date().toISOString(), quoi: 'plugin', de: versions.plugin, vers: '—', resultat: 'reussi', raison: 'uninstallation', photo: photo.dossier })
  quitter(0, '\n🟢 plugin removed. Run `dsh plugin --profile web install` to finish.')
}

// ── VERIFY: boot only ─────────────────────────────────────────────────────
if (ordre === 'verify') {
  const boot = await verifierBoot(opts.url)
  quitter(boot.ok ? 0 : 1, boot.ok ? '\n🟢 the boot is healthy.' : '\n🔴 the boot fails.\n' + boot.sortie.slice(0, 600))
}

quitter(64, 'Usage: dsh-lifecycle.mjs doctor|install|upgrade|rollback|uninstall|verify [--force] [--dry] [--restart] [--json] [--url <url>] [version]')