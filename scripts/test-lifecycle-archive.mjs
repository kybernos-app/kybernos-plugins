#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// The update path of an ARCHIVE install: install a release, update it from a newer one, refuse a bad one.
//
// Measured on 2026-10-08 in isolated labs (throw-away HOME/DSH_HOME, network denied):
//   1. updating from a NEW extraction folder printed "success" while 28 of 30 bundles kept loading from the old folder;
//   2. the Suite panel's "Update now" extracted the archive into a temp folder, linked the profile into it, then deleted it:
//      dangling links, `dsh plugin install` crashed for good, and the robot could not repair it;
//   3. the folder handed by ./kybernos-install and ./kybernos-update was never checked against its manifest;
//   4. an archive FILE was extracted over the installed folder BEFORE being verified: a tampered or truncated archive of the
//      same name was "refused" but had already replaced the live install.
//
// Hermetic: no real dsh, npm, pnpm or network. The CLI scenarios run the real robot (scripts/dsh-lifecycle.mjs, copied into
// synthetic packages) against small fake `dsh`/`npm`/`pnpm` executables, in a temp HOME. POSIX only (the fakes are shebang scripts).
//
//   node scripts/test-lifecycle-archive.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as paquet from './paquet.mjs'
import * as moteur from './lifecycle-engine.mjs'
const alignerLiens = moteur.alignerLiens
const verif = (dossier) => (typeof paquet.verifierDossier === 'function' ? paquet.verifierDossier(dossier) : { ok: false, ecarts: [], enTrop: [], manifest: null })
const lienReprenable = (...a) => (typeof moteur.lienReprenable === 'function' ? moteur.lienReprenable(...a) : undefined)

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let ko = 0
let n = 0
const ok = (titre, cond, detail = '') => {
  n += 1
  console.log(`${cond ? '✓' : '✗'} ${titre}${cond || detail === '' ? '' : ' — ' + String(detail).slice(0, 300)}`)
  if (!cond) ko += 1
}

const RACINE = realpathSync(mkdtempSync(join(tmpdir(), 'kb-archive-')))
const ecrire = (chemin, contenu) => { mkdirSync(dirname(chemin), { recursive: true }); writeFileSync(chemin, contenu) }
const lireJson = (chemin) => JSON.parse(readFileSync(chemin, 'utf8'))

// ── a synthetic release: the real robot + its import closure, three or four tiny bundles, a manifest ──────────────────────
const PLATEFORME = 'test'
function fabriquerPaquet (dossier, version, dirs) {
  const robot = paquet.fermetureModules(REPO, ['scripts/dsh-lifecycle.mjs'])
  for (const chemin of robot) { mkdirSync(dirname(join(dossier, chemin)), { recursive: true }); cpSync(join(REPO, chemin), join(dossier, chemin)) }
  ecrire(join(dossier, 'scripts', 'patches.json'), '[]\n')
  ecrire(join(dossier, 'scripts', 'lifecycle-packages.json'), JSON.stringify({ packages: dirs.map((d) => ({ dir: d, nom: '@local/' + d })) }, null, 2) + '\n')
  ecrire(join(dossier, 'dsh-compat.json'), JSON.stringify({ dsh: { min: '0.1.0', max: '9.9.9', testees: ['0.2.0-rc.2'] } }, null, 2) + '\n')
  for (const d of dirs) {
    ecrire(join(dossier, 'packages', d, 'package.json'), JSON.stringify({ name: '@local/' + d, version, type: 'module' }) + '\n')
    ecrire(join(dossier, 'packages', d, 'index.js'), `export const name = '${d}'\nexport const release = '${version}'\n`)
  }
  ecrire(join(dossier, 'VERSION'), version + '\n')
  const liste = readdirRecursif(dossier).filter((c) => c !== 'manifest.json')
  const manifest = paquet.construireManifest({ liste, lire: (c) => readFileSync(join(dossier, c)), version, plateforme: PLATEFORME, compat: null })
  ecrire(join(dossier, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return dossier
}
function readdirRecursif (dossier, prefixe = '') {
  const sortie = []
  for (const e of readdirSync(join(dossier, prefixe), { withFileTypes: true })) {
    const rel = prefixe === '' ? e.name : prefixe + '/' + e.name
    if (e.isDirectory()) sortie.push(...readdirRecursif(dossier, rel)); else sortie.push(rel)
  }
  return sortie
}
const NOMS_1 = ['kybernos-alpha', 'kybernos-beta', 'kybernos-gamma']
const NOMS_2 = [...NOMS_1, 'kybernos-delta']

// ═════════════════════════════════════════════════════════════════════════
// A. the engine: which existing links does an install/update re-point?
// ═════════════════════════════════════════════════════════════════════════
console.log('A. links left by an earlier install')
{
  const vieux = fabriquerPaquet(join(RACINE, 'unit', 'vieux'), '1.0.0', NOMS_1)
  const depot = join(RACINE, 'unit', 'depot-dev')
  mkdirSync(join(depot, '.git'), { recursive: true })
  mkdirSync(join(depot, 'packages', 'kybernos-alpha'), { recursive: true })
  const dossierSimple = join(RACINE, 'unit', 'autre-dossier')
  mkdirSync(join(dossierSimple, 'packages', 'kybernos-alpha'), { recursive: true })
  const fs = { existe: existsSyncSafe, lire: (p) => readFileSync(p, 'utf8') }
  function existsSyncSafe (p) { return existsSync(p) }
  const lien = (racine, dir) => 'link:' + join(racine, 'packages', dir)

  ok('a link into a folder extracted from an earlier Kybernos archive may be re-pointed', lienReprenable({ fs, actuel: lien(vieux, 'kybernos-alpha'), dir: 'kybernos-alpha' }) === true)
  ok('a link to a folder that no longer exists may be re-pointed (nothing left to protect)', lienReprenable({ fs, actuel: lien(join(RACINE, 'unit', 'disparu'), 'kybernos-alpha'), dir: 'kybernos-alpha' }) === true)
  ok('a developer checkout (a git tree) is left alone', lienReprenable({ fs, actuel: lien(depot, 'kybernos-alpha'), dir: 'kybernos-alpha' }) === false)
  ok('any folder that is not an archive extraction is left alone', lienReprenable({ fs, actuel: lien(dossierSimple, 'kybernos-alpha'), dir: 'kybernos-alpha' }) === false)
  ok('a registry version or a malformed link is not a link to re-point', lienReprenable({ fs, actuel: '^1.2.3', dir: 'kybernos-alpha' }) === false && lienReprenable({ fs, actuel: 'link:/nowhere/else', dir: 'kybernos-alpha' }) === false && lienReprenable({ fs, actuel: undefined, dir: 'kybernos-alpha' }) === false)

  const profil = join(RACINE, 'unit', 'profil')
  const neuf = join(RACINE, 'unit', 'neuf')
  mkdirSync(neuf, { recursive: true })
  const ecritures = []
  const fsProfil = { ...fs, lire: (p) => (p === join(profil, 'package.json') ? JSON.stringify({ name: 'p', dependencies: { '@local/kybernos-alpha': lien(vieux, 'kybernos-alpha'), '@local/kybernos-beta': lien(depot, 'kybernos-alpha'), '@local/kybernos-gamma': lien(join(RACINE, 'unit', 'disparu'), 'kybernos-gamma') }, dsh: { profile: { bundles: [] } } }) : fs.lire(p)), ecrire: (p, c) => ecritures.push([p, c]) }
  const paquets = [{ dir: 'kybernos-alpha', nom: '@local/kybernos-alpha' }, { dir: 'kybernos-beta', nom: '@local/kybernos-beta' }, { dir: 'kybernos-gamma', nom: '@local/kybernos-gamma' }]
  const rapports = []
  alignerLiens({ fs: fsProfil, profilDir: profil, repoDir: neuf, packages: paquets })
  let deps = JSON.parse(ecritures.pop()[1]).dependencies
  ok('by default nothing is re-pointed (satellites / safe-mode only toggle bundles)', deps['@local/kybernos-alpha'] === lien(vieux, 'kybernos-alpha') && deps['@local/kybernos-gamma'] === lien(join(RACINE, 'unit', 'disparu'), 'kybernos-gamma'))
  alignerLiens({ fs: fsProfil, profilDir: profil, repoDir: neuf, packages: paquets, reprendre: true, rapporter: (nom) => rapports.push(nom) })
  deps = JSON.parse(ecritures.pop()[1]).dependencies
  ok('install/update re-points the archive link and the dangling one to the new folder', deps['@local/kybernos-alpha'] === lien(neuf, 'kybernos-alpha') && deps['@local/kybernos-gamma'] === lien(neuf, 'kybernos-gamma'), JSON.stringify(deps))
  ok('…but not the developer checkout', deps['@local/kybernos-beta'] === lien(depot, 'kybernos-alpha'))
  ok('…and it says which ones it moved', rapports.length === 2 && rapports.includes('@local/kybernos-alpha') && rapports.includes('@local/kybernos-gamma'), JSON.stringify(rapports))
}

// ═════════════════════════════════════════════════════════════════════════
// B. a folder extracted from an archive is checked against its own manifest
// ═════════════════════════════════════════════════════════════════════════
console.log('B. the manifest of an extracted folder')
{
  const dossier = fabriquerPaquet(join(RACINE, 'manifest', 'p'), '1.0.0', NOMS_1)
  const v = typeof paquet.verifierDossier === 'function' ? verif(dossier) : null
  ok('an intact folder passes and its manifest is returned', v !== null && v.ok === true && v.manifest?.version === '1.0.0')
  appendTexte(join(dossier, 'packages', 'kybernos-alpha', 'index.js'), '// one byte more\n')
  const modifie = verif(dossier)
  ok('one modified file is an error that names the file', modifie?.ok === false && modifie.ecarts.some((e) => e.type === 'modifie' && e.chemin === 'packages/kybernos-alpha/index.js'), JSON.stringify(modifie))
  rmSync(join(dossier, 'packages', 'kybernos-beta', 'index.js'))
  ok('a missing file is an error too', verif(dossier)?.ecarts.some((e) => e.type === 'manquant') === true)
  const propre = fabriquerPaquet(join(RACINE, 'manifest', 'q'), '1.0.0', NOMS_1)
  ecrire(join(propre, 'packages', 'kybernos-alpha', 'cache.bin'), 'left by DSH')
  ecrire(join(propre, 'packages', 'kybernos-alpha', '.DS_Store'), 'finder')
  const extra = verif(propre)
  ok('a file the manifest does not know is reported, not fatal (a folder that has been in use); OS noise is not even reported', extra?.ok === true && extra.enTrop.length === 1 && extra.enTrop[0].endsWith('cache.bin'), JSON.stringify(extra))
  ok('a folder without a manifest of ours (a development checkout) is not subject to it', verif(join(RACINE, 'manifest'))?.manifest === null && paquet.lireManifestDuDossier?.(join(RACINE, 'manifest')) === null)
  ok('the install name comes from the manifest and is a safe folder name', paquet.nomInstallation?.({ version: '1.0.0-beta.5', plateforme: 'mac' }) === 'kybernos-dsh-1.0.0-beta.5-mac' && paquet.nomInstallation?.({ version: '../../x', plateforme: 'mac' }) === null)
}
function appendTexte (chemin, texte) { writeFileSync(chemin, readFileSync(chemin, 'utf8') + texte) }

// ═════════════════════════════════════════════════════════════════════════
// C. the real robot, end to end, against fake dsh/npm/pnpm
// ═════════════════════════════════════════════════════════════════════════
if (process.platform === 'win32') {
  console.log('C. skipped on Windows (the fake dsh/npm/pnpm are shebang scripts)')
} else {
  console.log('C. install, update, panel flow, refusal (real robot, fake dsh)')
  const BIN = join(RACINE, 'bin')
  const FAKE_PREFIX = join(RACINE, 'npm-prefix')
  mkdirSync(FAKE_PREFIX, { recursive: true })
  const fake = (nom, corps) => { const f = join(BIN, nom); ecrire(f, `#!/usr/bin/env node\n${corps}\n`); chmodSync(f, 0o755) }
  fake('dsh', `
const fs = require('fs'), path = require('path')
const profile = path.join(process.env.DSH_HOME, 'profiles', 'web')
const a = process.argv.slice(2)
if (a[0] === '--version') { console.log('0.2.0-rc.2'); process.exit(0) }
if (a[0] === 'plugin') {            // like pnpm: every link: dependency must exist, node_modules is rebuilt from them
  const pj = path.join(profile, 'package.json')
  fs.mkdirSync(profile, { recursive: true })
  if (!fs.existsSync(pj)) fs.writeFileSync(pj, JSON.stringify({ name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }, null, 2) + '\\n')
  const p = JSON.parse(fs.readFileSync(pj, 'utf8'))
  let bad = 0
  for (const [k, v] of Object.entries(p.dependencies || {})) {
    if (!String(v).startsWith('link:')) continue
    const dest = path.join(profile, 'node_modules', k)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.rmSync(dest, { force: true })
    if (!fs.existsSync(v.slice(5))) { console.error('Error: cannot resolve profile bundle ' + k); bad += 1; continue }
    fs.symlinkSync(v.slice(5), dest)
  }
  fs.writeFileSync(path.join(profile, 'pnpm-lock.yaml'), '# lock\\n')
  process.exit(bad === 0 ? 0 : 1)
}
if (a[0] === 'web') {               // the boot check: every bundle of the profile must load
  console.log('dsh web: http://127.0.0.1:1')
  const p = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'))
  for (const b of p.dsh.profile.bundles) {
    if (!b.startsWith('@local/')) continue
    try { const dir = path.join(profile, 'node_modules', b); const src = fs.readFileSync(path.join(dir, 'index.js'), 'utf8'); if (src.includes('THROW_AT_LOAD')) throw new Error('boom'); console.log('loaded ' + b + ' ' + JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version) } catch (e) { console.log(b + ' did not activate: ' + e.message) }
  }
  setInterval(() => {}, 1000)
}`)
  fake('npm', `
const a = process.argv.slice(2).join(' ')
if (a.startsWith('prefix -g')) { console.log(process.env.FAKE_NPM_PREFIX); process.exit(0) }
if (a.startsWith('root -g')) { console.log(require('path').join(process.env.FAKE_NPM_PREFIX, 'lib', 'node_modules')); process.exit(0) }
process.exit(1)`)
  fake('pnpm', `console.log('11.0.0')`)

  const HOME = join(RACINE, 'home')
  const DSH_HOME = join(HOME, '.dsh')
  const TMP = join(RACINE, 'tmp')
  mkdirSync(TMP, { recursive: true })
  const PROFIL = join(DSH_HOME, 'profiles', 'web')
  const env = { PATH: BIN + ':' + dirname(process.execPath) + ':/usr/bin:/bin', HOME, DSH_HOME, TMPDIR: TMP, FAKE_NPM_PREFIX: FAKE_PREFIX, LANG: 'C' }
  const lancer = (dossierPaquet, args) => spawnSync(process.execPath, [join(dossierPaquet, 'scripts', 'dsh-lifecycle.mjs'), ...args, '--port', '9519'], { env, encoding: 'utf8', timeout: 120000, cwd: RACINE })
  const sortie = (r) => (r.stdout || '') + (r.stderr || '')
  const liens = () => Object.fromEntries(Object.entries(lireJson(join(PROFIL, 'package.json')).dependencies).filter(([, v]) => v.startsWith('link:')).map(([k, v]) => [k, v.slice(5)]))
  const tousVers = (racine) => { const l = liens(); return Object.keys(l).length > 0 && Object.values(l).every((v) => v.startsWith(racine + '/') && existsSync(v)) }
  const photos = () => (existsSync(join(DSH_HOME, 'lifecycle', 'photos')) ? readdirSync(join(DSH_HOME, 'lifecycle', 'photos')).length : 0)
  const paquets = () => (existsSync(join(DSH_HOME, 'kybernos', 'paquets')) ? readdirSync(join(DSH_HOME, 'kybernos', 'paquets')) : [])

  const v1 = fabriquerPaquet(join(RACINE, 'pkgs', 'v1'), '1.0.0', NOMS_1)
  const v2 = fabriquerPaquet(join(RACINE, 'pkgs', 'v2'), '1.1.0', NOMS_2)

  // 1. install, then update from ANOTHER folder
  let r = lancer(v1, ['install', '--source', v1])
  ok('install from the first release works', r.status === 0 && tousVers(v1), sortie(r).slice(-400))
  r = lancer(v2, ['upgrade', '--source', v2])
  ok('update from a NEW folder exits 0…', r.status === 0, sortie(r).slice(-400))
  ok('…and the profile now loads EVERY bundle from the new folder, including the added one (not 3 of 4 from the old folder)', tousVers(v2) && Object.keys(liens()).length === 4, JSON.stringify(liens()))
  ok('…the old folder is untouched (it is what a rollback goes back to)', verif(v1).ok === true)
  ok('…and the robot says it moved the links', /ré-pointé/.test(sortie(r)), sortie(r).slice(-300))

  // 2. idempotence
  const avantPj = readFileSync(join(PROFIL, 'package.json'), 'utf8')
  const avantLock = readFileSync(join(PROFIL, 'pnpm-lock.yaml'), 'utf8')
  r = lancer(v2, ['upgrade', '--source', v2])
  ok('running the same update twice exits 0 and changes nothing in the profile', r.status === 0 && readFileSync(join(PROFIL, 'package.json'), 'utf8') === avantPj && readFileSync(join(PROFIL, 'pnpm-lock.yaml'), 'utf8') === avantLock, sortie(r).slice(-300))
  ok('…and does not claim to have moved any link the second time', /ré-pointé/.test(sortie(r)) === false)

  // 3. the Suite panel: the archive is extracted under the system temp folder, the robot runs from there, the folder is then deleted
  const v3tmp = join(TMP, 'kybernos-update-abc', 'contenu')
  fabriquerPaquet(v3tmp, '1.2.0', NOMS_2)
  r = lancer(v3tmp, ['upgrade', '--source', v3tmp])
  ok('panel flow (source under the temp folder) exits 0', r.status === 0, sortie(r).slice(-400))
  rmSync(join(TMP, 'kybernos-update-abc'), { recursive: true, force: true })     // what the hub does in `finally`
  const stable = join(DSH_HOME, 'kybernos', 'paquets', 'kybernos-dsh-1.2.0-' + PLATEFORME)
  ok('…the profile is linked into a STABLE copy that survives the temp folder being deleted', tousVers(stable), JSON.stringify(liens()))
  ok('…that copy is a verified copy of the release', existsSync(stable) && verif(stable).ok === true)
  r = lancer(v2, ['verify'])
  ok('…and the DSH boot check still passes afterwards (no skipped bundle)', r.status === 0, sortie(r).slice(-300))

  // 4. repairing the damage the old panel flow left behind: links to a folder that is gone
  const pj = lireJson(join(PROFIL, 'package.json'))
  pj.dependencies['@local/kybernos-delta'] = 'link:' + join(TMP, 'kybernos-update-gone', 'contenu', 'packages', 'kybernos-delta')
  pj.dependencies['@local/kybernos-alpha'] = 'link:' + join(TMP, 'kybernos-update-gone', 'contenu', 'packages', 'kybernos-alpha')
  writeFileSync(join(PROFIL, 'package.json'), JSON.stringify(pj, null, 2) + '\n')
  r = lancer(v2, ['upgrade', '--source', v2])
  ok('a profile left with links to a deleted folder is repaired by the next update', r.status === 0 && tousVers(v2), sortie(r).slice(-400))

  // 5. a developer's checkout linked in the profile is never taken over
  const dev = join(RACINE, 'dev-checkout')
  ecrire(join(dev, 'packages', 'kybernos-gamma', 'index.js'), 'export const name = "dev"\n')
  ecrire(join(dev, 'packages', 'kybernos-gamma', 'package.json'), '{"name":"@local/kybernos-gamma","version":"0.0.0-dev"}\n')
  mkdirSync(join(dev, '.git'), { recursive: true })
  const pj2 = lireJson(join(PROFIL, 'package.json'))
  pj2.dependencies['@local/kybernos-gamma'] = 'link:' + join(dev, 'packages', 'kybernos-gamma')
  writeFileSync(join(PROFIL, 'package.json'), JSON.stringify(pj2, null, 2) + '\n')
  r = lancer(v2, ['upgrade', '--source', v2])
  ok('a link to a developer checkout survives an update', r.status === 0 && liens()['@local/kybernos-gamma'] === join(dev, 'packages', 'kybernos-gamma'), sortie(r).slice(-300))

  // 6. a tampered folder is refused before anything is touched
  const mauvais = join(RACINE, 'pkgs', 'v2-mauvais')
  cpSync(v2, mauvais, { recursive: true })
  appendTexte(join(mauvais, 'packages', 'kybernos-alpha', 'index.js'), 'console.log("not what was shipped")\n')
  const pjAvant = readFileSync(join(PROFIL, 'package.json'), 'utf8')
  const photosAvant = photos()
  r = lancer(mauvais, ['upgrade', '--source', mauvais])
  ok('a folder with one modified file is refused (exit 1) and the file is named', r.status === 1 && /modifie : packages\/kybernos-alpha\/index.js/.test(sortie(r)), sortie(r).slice(-300))
  ok('…the profile is byte-identical and no safety photo was even taken', readFileSync(join(PROFIL, 'package.json'), 'utf8') === pjAvant && photos() === photosAvant)

  const abime = join(RACINE, 'pkgs', 'v2-manifeste-abime')
  cpSync(v2, abime, { recursive: true })
  writeFileSync(join(abime, 'manifest.json'), '{"nom": "kybernos-dsh", "fichiers": [')
  r = lancer(abime, ['upgrade', '--source', abime])
  ok('a folder whose manifest.json is present but unreadable is refused, not mistaken for a development checkout', r.status === 1 && /illisible/.test(sortie(r)) && readFileSync(join(PROFIL, 'package.json'), 'utf8') === pjAvant, sortie(r).slice(-300))

  // 7. an archive FILE: installed from a tarball, then a tampered and a truncated one of the SAME name are refused
  const nom = 'kybernos-dsh-1.1.0-' + PLATEFORME
  const dossierTar = join(RACINE, 'tar')
  mkdirSync(join(dossierTar, 'bon'), { recursive: true })
  mkdirSync(join(dossierTar, 'mauvais'), { recursive: true })
  const tar = (dossier, dest) => spawnSync('tar', ['-czf', dest, '-C', dossier, '.'], { encoding: 'utf8' })
  tar(v2, join(dossierTar, 'bon', nom + '.tar.gz'))
  tar(mauvais, join(dossierTar, 'mauvais', nom + '.tar.gz'))
  r = lancer(v2, ['upgrade', '--source', join(dossierTar, 'bon', nom + '.tar.gz')])
  const installe = join(DSH_HOME, 'kybernos', 'paquets', nom)
  ok('an archive file is verified, installed under paquets/<name> and linked', r.status === 0 && tousVersOuDev(installe), sortie(r).slice(-400))
  function tousVersOuDev (racine) { const l = liens(); return Object.entries(l).filter(([k]) => k !== '@local/kybernos-gamma').every(([, v]) => v.startsWith(racine + '/') && existsSync(v)) }
  r = lancer(v2, ['upgrade', '--source', join(dossierTar, 'mauvais', nom + '.tar.gz')])
  ok('a TAMPERED archive of the same name is refused (exit 1)', r.status === 1 && /modifie/.test(sortie(r)), sortie(r).slice(-300))
  ok('…and the LIVE installed folder is still the genuine one (it used to be replaced before the check)', existsSync(installe) && verif(installe).ok === true)
  const octets = readFileSync(join(dossierTar, 'bon', nom + '.tar.gz'))
  writeFileSync(join(dossierTar, 'mauvais', nom + '.tar.gz'), octets.subarray(0, Math.floor(octets.length / 2)))
  r = lancer(v2, ['upgrade', '--source', join(dossierTar, 'mauvais', nom + '.tar.gz')])
  ok('a TRUNCATED archive of the same name is refused (exit 1)', r.status === 1, sortie(r).slice(-300))
  ok('…and the LIVE installed folder is still complete and linked', existsSync(installe) && verif(installe).ok === true && tousVersOuDev(installe))
  ok('…and no half-extracted staging folder is left behind', paquets().every((x) => x.startsWith('.etape-') === false && x.includes('.avant-') === false), JSON.stringify(paquets()))
  // 8. going back to an OLDER release by hand is allowed (a rollback is a legitimate need) but never silent
  r = lancer(v1, ['upgrade', '--source', v1])
  ok('running an OLDER release’s update over a newer install works but says it is a version step back', r.status === 0 && /plus ANCIENNE/.test(sortie(r)) && /1\.0\.0/.test(sortie(r)) && /1\.1\.0/.test(sortie(r)), sortie(r).slice(-500))
  r = lancer(v2, ['upgrade', '--source', v2])
  ok('…and the newer release goes forward again without a warning', r.status === 0 && /plus ANCIENNE/.test(sortie(r)) === false, sortie(r).slice(-300))

  writeFileSync(join(dossierTar, 'bon', '..tar.gz'), octets)
  ok('an archive whose NAME would resolve to the paquets folder itself is refused before anything is deleted', lancer(v2, ['upgrade', '--source', join(dossierTar, 'bon', '..tar.gz')]).status === 1 && existsSync(installe) && verif(installe).ok === true)
}

rmSync(RACINE, { recursive: true, force: true })
console.log(`\n${n - ko}/${n} passed`)
process.exit(ko === 0 ? 0 : 1)
