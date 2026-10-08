// Layout test: bundles live in packages/<name>/. Code that computes the repo root
// from its own location must climb exactly two levels, and the files it then
// reads must exist. Born from a real regression: kybernos-maintenance used
// resolve(dir, '..') and silently read nothing after the move to packages/.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE_BUNDLES } from './bundles.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let echecs = 0
let total = 0
const verifie = (nom, ok, detail = '') => { total++; if (ok) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')) } }

const dossiers = readdirSync(join(REPO, BASE_BUNDLES)).filter((d) => statSync(join(REPO, BASE_BUNDLES, d)).isDirectory())
const aPackageJson = (...chemin) => existsSync(join(REPO, BASE_BUNDLES, ...chemin, 'package.json'))
const sousDossiers = (d) => readdirSync(join(REPO, BASE_BUNDLES, d)).filter((f) => statSync(join(REPO, BASE_BUNDLES, d, f)).isDirectory())
// A container (dsh-subagent-maison: one shared core and one package per provider) has no package.json of
// its own; the packages nested in it do. Everything else directly under packages/ is a bundle.
const conteneurs = dossiers.filter((d) => !aPackageJson(d) && sousDossiers(d).some((f) => aPackageJson(d, f)))
const bundles = dossiers.filter((d) => !conteneurs.includes(d))
verifie('every bundle has a package.json', bundles.every((d) => aPackageJson(d)), bundles.filter((d) => !aPackageJson(d)).join(', '))
verifie('every package nested in a container has a package.json', conteneurs.every((d) => sousDossiers(d).every((f) => aPackageJson(d, f))), conteneurs.flatMap((d) => sousDossiers(d).filter((f) => !aPackageJson(d, f)).map((f) => d + '/' + f)).join(', '))

// 1. No bundle-level file may take "one level up" as the repo root.
const suspects = []
for (const d of bundles) {
  const dir = join(REPO, BASE_BUNDLES, d)
  for (const f of readdirSync(dir)) {
    if (!/\.(m?js)$/.test(f)) continue
    const src = readFileSync(join(dir, f), 'utf8')
    if (/const\s+REPO\s*=\s*resolve\(\s*\w+\s*,\s*'\.\.'\s*\)/.test(src)) suspects.push(`${d}/${f}`)
  }
}
verifie('no bundle computes the repo root with a single ".."', suspects.length === 0, suspects.join(', '))

// 2. kybernos-maintenance reads these repo-root files: they must exist from where it looks.
const maint = readFileSync(join(REPO, BASE_BUNDLES, 'kybernos-maintenance', 'index.js'), 'utf8')
const m = maint.match(/const REPO = resolve\(ICI((?:\s*,\s*'\.\.')+)\)/)
const niveaux = m ? (m[1].match(/'\.\.'/g) || []).length : -1
verifie('kybernos-maintenance climbs two levels to the repo root', niveaux === 2, `found ${niveaux}`)
for (const rel of ['scripts/lifecycle-packages.json', 'dsh-compat.json', 'VERSION']) {
  verifie(`repo-root file exists: ${rel}`, existsSync(join(REPO, rel)))
}

// 3. every dir declared to the robot exists under packages/
const declared = JSON.parse(readFileSync(join(REPO, 'scripts', 'lifecycle-packages.json'), 'utf8')).packages
verifie('every lifecycle package dir exists under packages/', declared.every((p) => existsSync(join(REPO, BASE_BUNDLES, p.dir))), declared.filter((p) => !existsSync(join(REPO, BASE_BUNDLES, p.dir))).map((p) => p.dir).join(', '))

// 4. every DSH bundle (package.json has a `dsh` field) is declared to the robot
//    AND in the satellites manifest — otherwise it can never be installed.
//    Packages without `dsh` (e.g. messaging, a standalone daemon) are not bundles.
const sats = JSON.parse(readFileSync(join(REPO, 'docs', 'beta', 'satellites.json'), 'utf8'))
const dansManifeste = new Set([...sats.socle.bundles, ...sats.satellites.bundles].map((b) => b.dir))
const dansRobot = new Set(declared.filter((p) => typeof p.nom === 'string').map((p) => p.dir))
const dsh = bundles.filter((d) => JSON.parse(readFileSync(join(REPO, BASE_BUNDLES, d, 'package.json'), 'utf8')).dsh !== undefined)
verifie('every DSH bundle is declared to the robot with a name', dsh.every((d) => dansRobot.has(d)), dsh.filter((d) => !dansRobot.has(d)).join(', '))
verifie('every DSH bundle is in satellites.json', dsh.every((d) => dansManifeste.has(d)), dsh.filter((d) => !dansManifeste.has(d)).join(', '))
verifie('satellites.json lists only existing bundles', [...dansManifeste].every((d) => bundles.includes(d)))
const ordre = new Set([...sats.ordre_montage.socle, ...sats.ordre_montage.satellites])
const noms = [...sats.socle.bundles, ...sats.satellites.bundles].map((b) => b.nom)
verifie('ordre_montage mounts every satellite', sats.satellites.bundles.map((b) => b.nom).every((n) => ordre.has(n)), sats.satellites.bundles.map((b) => b.nom).filter((n) => !ordre.has(n)).join(', '))

// 5. the hot-file list of the session guard points at files that exist (relative to the repo root,
//    which is also the git root: a stale flat path silently disables the guard).
const garde = readFileSync(join(REPO, BASE_BUNDLES, 'kybernos-sessions', 'garde.mjs'), 'utf8')
const bloc = garde.slice(garde.indexOf('export const FICHIERS_CHAUDS = ['), garde.indexOf(']', garde.indexOf('export const FICHIERS_CHAUDS = [')))
const chauds = [...bloc.matchAll(/^\s*'([^']+)',/gm)].map((m) => m[1])
verifie('garde: hot-file list is not empty', chauds.length >= 10, String(chauds.length))
verifie('garde: every hot file exists', chauds.every((f) => existsSync(join(REPO, f))), chauds.filter((f) => !existsSync(join(REPO, f))).join(', '))
verifie('garde: launchd plist points at an existing garde.mjs', existsSync(join(REPO, 'packages', 'kybernos-sessions', 'garde.mjs')) && /join\(racine, 'packages', 'kybernos-sessions', 'garde\.mjs'\)/.test(garde))

// 6. the Suite catalogue shipped in the hub is DERIVED from the three sources of truth;
//    a stale copy would show the wrong modules in the panel.
{
  const { catalogueDuDepot, FICHIER_CATALOGUE } = await import('./build-catalog.mjs')
  let attendu = null
  let erreur = ''
  try { attendu = JSON.stringify(catalogueDuDepot(), null, 2) + '\n' } catch (e) { erreur = String(e.message) }
  verifie('the Suite catalogue can be built from the repo (every bundle has a family and a promise)', attendu !== null, erreur)
  verifie('packages/kybernos-hub/catalog.json is up to date (node scripts/build-catalog.mjs)', attendu !== null && existsSync(FICHIER_CATALOGUE) && readFileSync(FICHIER_CATALOGUE, 'utf8') === attendu)
}

console.log(`\nLAYOUT — ${total} checks, ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)
