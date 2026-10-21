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

// 7. every module of the Suite draws a glyph of its own, and the hub knows how to draw it: two cards with the same
//    glyph look identical side by side (« not every plugin has an icon »), and an unknown name falls back to the cube.
{
  const catalogue = JSON.parse(readFileSync(join(REPO, BASE_BUNDLES, 'kybernos-hub', 'catalog.json'), 'utf8'))
  const client = readFileSync(join(REPO, BASE_BUNDLES, 'kybernos-hub', 'client.js'), 'utf8')
  const dessins = client.slice(client.indexOf('const GLYPHES = {'), client.indexOf('const ICONES = {'))
  const connus = new Set([...dessins.matchAll(/^\s+(\w+):'/gm)].map((m) => m[1]))
  const parGlyphe = new Map()
  for (const m of catalogue.modules) parGlyphe.set(m.glyphe, [...(parGlyphe.get(m.glyphe) || []), m.id || m.dir])
  const partages = [...parGlyphe].filter(([, l]) => l.length > 1).map(([g, l]) => `${g}: ${l.join(' + ')}`)
  verifie('every Suite module has a glyph the hub can draw', catalogue.modules.every((m) => connus.has(m.glyphe)), catalogue.modules.filter((m) => !connus.has(m.glyphe)).map((m) => `${m.id || m.dir} → ${m.glyphe}`).join(', '))
  verifie('no two Suite modules share a glyph', partages.length === 0, partages.join(' · '))
}

// 8. every module of the Suite has a manifest (docs/dev/plugin-contract.md): valid, in agreement with its package.json, and with a `suite` block that
//    says what docs/beta/satellites.json says. Only the modules declared to the robot are held to it: a bundle that is not declared is already reported above.
{
  const { manifestErrors, setErrors } = await import('./plugin-manifest.mjs')
  const zone = JSON.parse(readFileSync(join(REPO, 'dsh-compat.json'), 'utf8')).dsh
  const parDir = new Map([...sats.socle.bundles.map((b) => [b.dir, { ...b, noyau: true }]), ...sats.satellites.bundles.map((b) => [b.dir, { ...b, noyau: false }])])
  const manifestes = []
  const fautes = []
  for (const p of declared) {
    const fichier = join(REPO, BASE_BUNDLES, p.dir, 'plugin.json')
    if (!existsSync(fichier)) { fautes.push(p.dir + ': no plugin.json'); continue }
    let m
    try { m = JSON.parse(readFileSync(fichier, 'utf8')) } catch (e) { fautes.push(p.dir + ': plugin.json is not JSON'); continue }
    manifestes.push(m)
    const ctx = { firstParty: true, dir: p.dir, suiteZone: zone, packageJson: JSON.parse(readFileSync(join(REPO, BASE_BUNDLES, p.dir, 'package.json'), 'utf8')), fileExists: (rel) => existsSync(join(REPO, BASE_BUNDLES, p.dir, rel)) }
    for (const f of manifestErrors(m, ctx)) fautes.push(p.dir + ': ' + f)
    const s = parDir.get(p.dir)
    if (s !== undefined && m.suite !== undefined) {
      if ((m.suite.core === true) !== s.noyau) fautes.push(p.dir + ': suite.core is ' + (m.suite.core === true) + ' but satellites.json ' + (s.noyau ? 'lists it in the socle' : 'does not list it in the socle'))
      const voulu = s.noyau || s.defaut === 'actif' ? 'on' : 'off'
      if (m.suite.default !== voulu) fautes.push(p.dir + ': suite.default is "' + m.suite.default + '" but satellites.json says "' + voulu + '"')
    }
  }
  verifie('every module of the Suite has a valid plugin.json (docs/dev/plugin-contract.md)', fautes.length === 0, fautes.slice(0, 6).join(' · ') + (fautes.length > 6 ? ' · +' + (fautes.length - 6) + ' more' : ''))
  verifie('the manifests agree as a set (ids, claims, dependencies)', setErrors(manifestes).length === 0, setErrors(manifestes).slice(0, 4).join(' · '))
}

console.log(`\nLAYOUT — ${total} checks, ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)
