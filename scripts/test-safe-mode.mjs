// End-to-end test of `dsh-lifecycle.mjs safe-mode` against a throwaway DSH_HOME.
// Real CLI, real files, fake profile: nothing outside the temp folder is touched.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dossierBundle } from './bundles.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(ICI, '..')
let total = 0; let echecs = 0
const ok = (nom, cond, detail = '') => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')) } }

const HOME = mkdtempSync(join(tmpdir(), 'kb-safe-'))
const PROFIL = join(HOME, 'profiles', 'web')
mkdirSync(PROFIL, { recursive: true })
// Every real bundle is managed now; the "unmanaged package" safety net is exercised with a synthetic one.
const reels = JSON.parse(readFileSync(join(ICI, 'lifecycle-packages.json'), 'utf8')).packages.filter((p) => p.nom)
const paquets = [...reels, { dir: 'kybernos-libre', nom: '@local/kybernos-libre' }]
const FICHIER_PAQUETS = join(HOME, 'paquets-test.json')
const sats = JSON.parse(readFileSync(join(REPO, 'docs/beta/satellites.json'), 'utf8'))
const socle = sats.socle.bundles.map((b) => b.nom)
const tous = [...sats.socle.bundles, ...sats.satellites.bundles].map((b) => b.nom)
writeFileSync(join(PROFIL, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web', private: true,
  dependencies: Object.fromEntries(paquets.map((p) => [p.nom, 'link:' + dossierBundle(REPO, p.dir)])),
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', ...paquets.map((p) => p.nom)] } }
}, null, 2))
writeFileSync(FICHIER_PAQUETS, JSON.stringify({ packages: paquets }))
writeFileSync(join(PROFIL, 'pnpm-lock.yaml'), '# fake\n')
writeFileSync(join(PROFIL, 'cordis.patch.yml'), '[]\n')

const cli = (...a) => {
  try { return { code: 0, out: execFileSync('node', [join(ICI, 'dsh-lifecycle.mjs'), 'safe-mode', ...a], { env: { ...process.env, DSH_HOME: HOME, KYBERNOS_PACKAGES_FILE: FICHIER_PAQUETS }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }) } } catch (e) { return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') } }
}
const cliSat = (...a) => {
  try { return { code: 0, out: execFileSync('node', [join(ICI, 'dsh-lifecycle.mjs'), 'satellites', ...a], { env: { ...process.env, DSH_HOME: HOME, KYBERNOS_PACKAGES_FILE: FICHIER_PAQUETS }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }) } } catch (e) { return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') } }
}
const profil = () => JSON.parse(readFileSync(join(PROFIL, 'package.json'), 'utf8'))
const bundles = () => profil().dsh.profile.bundles
const etat = () => JSON.parse(readFileSync(join(HOME, 'kybernos', 'boot-state.json'), 'utf8'))
const actives = () => JSON.parse(readFileSync(join(HOME, 'kybernos', 'satellites-actives.json'), 'utf8')).actives

try {
  console.log('── status on a fresh home ──')
  let r = cli()
  ok('status works and says off', r.code === 0 && /Safe mode : off/.test(r.out), r.out)
  ok('hub is declared in the socle', socle.includes('@local/kybernos-hub'))

  console.log('── status turns the failing bundles named by the browser into an action ──')
  mkdirSync(join(HOME, 'kybernos'), { recursive: true })
  const casseEtat = (noms) => ({ version: 1, demarrages: [{ id: 'a', date: 'd', gui: 'broken', echouees: noms }, { id: 'b', date: 'd', gui: 'broken', echouees: noms }], safe: { actif: false, depuis: null, activesAvant: [] } })
  writeFileSync(join(HOME, 'kybernos', 'boot-state.json'), JSON.stringify(casseEtat(['@local/kybernos-models'])))
  r = cli('status')
  ok('a failing satellite → switch THAT satellite off', /Suspects\s+: @local\/kybernos-models/.test(r.out) && /satellites --desactiver kybernos-models/.test(r.out) && !/safe-mode on/.test(r.out), r.out)
  writeFileSync(join(HOME, 'kybernos', 'boot-state.json'), JSON.stringify(casseEtat(['@local/kybernos-theme'])))
  r = cli('status')
  ok('a failing socle bundle → rollback to the photo, not safe mode', /\(socle\)/.test(r.out) && /rollback/.test(r.out) && !/desactiver/.test(r.out), r.out)
  writeFileSync(join(HOME, 'kybernos', 'boot-state.json'), JSON.stringify({ version: 1, demarrages: [{ id: 'a', date: 'd', gui: 'loading' }, { id: 'b', date: 'd', gui: 'loading' }], safe: { actif: false, depuis: null, activesAvant: [] } }))
  r = cli('status')
  ok('failures with no named bundle → plain safe mode advice', /safe-mode on/.test(r.out) && !/Suspects/.test(r.out), r.out)
  rmSync(join(HOME, 'kybernos', 'boot-state.json'))

  // A profile written by an older robot already carries a null bundle: it must be cleaned, not kept.
  const pk = profil(); pk.dsh.profile.bundles.push(null); writeFileSync(join(PROFIL, 'package.json'), JSON.stringify(pk, null, 2))
  cliSat('--desactiver', 'kybernos-language'); cliSat('--activer', 'kybernos-language')
  ok('an existing null in dsh.profile.bundles is cleaned', bundles().every((b) => typeof b === 'string'), JSON.stringify(bundles().filter((b) => typeof b !== 'string')))
  rmSync(join(HOME, 'kybernos', 'satellites-actives.json'), { force: true })
  const nonGeres = paquets.map((p) => p.nom).filter((n) => !tous.includes(n))
  ok('fixture check: some packages are managed by neither socle nor satellites (kybernos-libre)', nonGeres.includes('@local/kybernos-libre'), nonGeres.join())
  console.log('── satellites --desactiver: one satellite, and the profile follows ──')
  r = cliSat('--desactiver', 'kybernos-language')
  ok('deactivating one satellite exits 0', r.code === 0, r.out)
  ok('it is out of the profile', !bundles().includes('@local/kybernos-language'))
  ok('an unmanaged package (kybernos-libre) is NOT dropped when the activation file appears', bundles().includes('@local/kybernos-libre'), bundles().join())
  ok('no null entry in dsh.profile.bundles', bundles().every((b) => typeof b === 'string'))
  ok('the OTHER satellites stay (absent file used to mean "0 active")', tous.filter((n) => n !== '@local/kybernos-language').every((n) => bundles().includes(n)), bundles().join())
  ok('activation file lists all but that one', actives().length === tous.length - socle.length - 1 && !actives().includes('@local/kybernos-language'), JSON.stringify(actives()))
  r = cliSat('--activer', 'kybernos-language')
  ok('re-activating puts it back in the profile', bundles().includes('@local/kybernos-language') && actives().includes('@local/kybernos-language'), r.out)
  rmSync(join(HOME, 'kybernos', 'satellites-actives.json'))

  console.log('── on --dry ──')
  r = cli('on', '--dry')
  ok('dry run changes nothing', r.code === 0 && /DRY/.test(r.out) && bundles().length === paquets.length + 1 && !existsSync(join(HOME, 'kybernos', 'boot-state.json')), r.out + ' | bundles=' + bundles().length + ' expected=' + (paquets.length + 1) + ' missing=' + ['@deepseek-ai/dsh-base', ...paquets.map((p) => p.nom)].filter((b) => !bundles().includes(b)).join(','))

  console.log('── on ──')
  r = cli('on')
  ok('on exits 0', r.code === 0, r.out)
  ok('profile keeps only the socle (plus the engine bundle)', bundles().filter((b) => b.startsWith('@local/')).every((b) => socle.includes(b)) && socle.every((b) => bundles().includes(b)), bundles().join())
  ok('every non-socle satellite is out of the profile', tous.filter((n) => !socle.includes(n)).every((n) => !bundles().includes(n)))
  ok('the engine bundles are untouched', bundles().includes('@deepseek-ai/dsh-base'))
  ok('state says safe, and remembers the satellites set aside', etat().safe.actif === true && etat().safe.activesAvant.length === tous.length - socle.length, JSON.stringify(etat().safe))
  ok('activation file is empty of satellites', actives().length === 0)
  ok('a safety photo of the profile was taken before any write', readdirSync(join(HOME, 'lifecycle', 'photos')).length === 1)
  ok('the journal recorded the operation', existsSync(join(HOME, 'lifecycle', 'journal.jsonl')) && /safe-mode/.test(readFileSync(join(HOME, 'lifecycle', 'journal.jsonl'), 'utf8')))
  r = cli('on')
  ok('on twice is a no-op and keeps the first saved list', r.code === 0 && /already on/.test(r.out) && etat().safe.activesAvant.length === tous.length - socle.length, r.out)
  r = cli('status')
  ok('status says ON', /Safe mode : ON/.test(r.out), r.out)

  console.log('── off ──')
  r = cli('off')
  ok('off exits 0', r.code === 0, r.out)
  ok('every satellite is back in the profile', tous.every((n) => bundles().includes(n)), bundles().join())
  ok('safe-mode off also brings back the unmanaged packages (kybernos-libre)', nonGeres.every((n) => bundles().includes(n)), bundles().join())
  ok('state is clean', etat().safe.actif === false && etat().demarrages.length === 0)
  r = cli('off')
  ok('off twice is a no-op', r.code === 0 && /not on/.test(r.out))

  console.log('── a satellite added to the manifest after the activation file was written ──')
  // Regression: a file written before kybernos-flow & co. were declared listed only the old
  // satellites; the new ones were read as "off" and dropped from the user's profile.
  const nouveaux = sats.satellites.bundles.filter((b) => b.defaut === 'actif').map((b) => b.nom)
  const anciens = sats.satellites.bundles.filter((b) => b.defaut !== 'actif').map((b) => b.nom)
  ok('fixture check: the manifest marks some satellites "actif par défaut"', nouveaux.length >= 9 && anciens.length >= 3, String(nouveaux.length))
  const sansLanguage = anciens.filter((n) => n !== '@local/kybernos-language')
  mkdirSync(join(HOME, 'kybernos'), { recursive: true })
  writeFileSync(join(HOME, 'kybernos', 'satellites-actives.json'), JSON.stringify({ actives: sansLanguage, maj: 'legacy' }))   // no `desactives` key: written by an older robot
  r = cliSat('--liste')
  ok('legacy file: every new satellite reads as ACTIF', nouveaux.every((n) => new RegExp(n.replace(/[/@]/g, '.') + '\\s+tier \\d+\\s+ACTIF').test(r.out)), r.out.split('\n').filter((l) => /inactif/.test(l)).join(' | '))
  ok('legacy file: a satellite the user left out stays inactif', /kybernos-language\s+tier \d+\s+inactif/.test(r.out), r.out)
  r = cliSat('--desactiver', 'kybernos-slides')
  ok('deactivating a default-on satellite works', r.code === 0, r.out)
  const brutApres = JSON.parse(readFileSync(join(HOME, 'kybernos', 'satellites-actives.json'), 'utf8'))
  ok('it is recorded in `desactives` (else the next read would switch it back on)', Array.isArray(brutApres.desactives) && brutApres.desactives.includes('@local/kybernos-slides'), JSON.stringify(brutApres.desactives))
  r = cliSat('--liste')
  ok('slides is inactif, the other new satellites are still ACTIF', /kybernos-slides\s+tier \d+\s+inactif/.test(r.out) && /kybernos-flow\s+tier \d+\s+ACTIF/.test(r.out), r.out)
  ok('and slides is out of the profile while flow is in', !bundles().includes('@local/kybernos-slides') && bundles().includes('@local/kybernos-flow'), bundles().join())
  r = cli('on'); const avantSafe = etat().safe.activesAvant
  ok('safe mode keeps the exact list (flow in, slides out)', avantSafe.includes('@local/kybernos-flow') && !avantSafe.includes('@local/kybernos-slides'), JSON.stringify(avantSafe))
  ok('safe mode leaves only the socle', bundles().filter((b) => b.startsWith('@local/')).every((b) => socle.includes(b) || b === '@local/kybernos-libre'), bundles().join())
  r = cli('off')
  ok('off brings flow back and leaves slides off', bundles().includes('@local/kybernos-flow') && !bundles().includes('@local/kybernos-slides'), bundles().join())
  r = cliSat('--activer', 'kybernos-slides')
  ok('re-activating slides puts it back', bundles().includes('@local/kybernos-slides'))
  r = cli('bogus')
  ok('unknown subcommand → exit 64 with usage', r.code === 64 && /Usage/.test(r.out), r.out)
} finally {
  rmSync(HOME, { recursive: true, force: true })
}
console.log(`\nSAFE MODE — ${total} assertions, ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)
