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
const paquets = JSON.parse(readFileSync(join(ICI, 'lifecycle-packages.json'), 'utf8')).packages.filter((p) => p.nom)
const sats = JSON.parse(readFileSync(join(REPO, 'docs/beta/satellites.json'), 'utf8'))
const socle = sats.socle.bundles.map((b) => b.nom)
const tous = [...sats.socle.bundles, ...sats.satellites.bundles].map((b) => b.nom)
writeFileSync(join(PROFIL, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web', private: true,
  dependencies: Object.fromEntries(paquets.map((p) => [p.nom, 'link:' + dossierBundle(REPO, p.dir)])),
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', ...paquets.map((p) => p.nom)] } }
}, null, 2))
writeFileSync(join(PROFIL, 'pnpm-lock.yaml'), '# fake\n')
writeFileSync(join(PROFIL, 'cordis.patch.yml'), '[]\n')

const cli = (...a) => {
  try { return { code: 0, out: execFileSync('node', [join(ICI, 'dsh-lifecycle.mjs'), 'safe-mode', ...a], { env: { ...process.env, DSH_HOME: HOME }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }) } } catch (e) { return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') } }
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

  console.log('── on --dry ──')
  r = cli('on', '--dry')
  ok('dry run changes nothing', r.code === 0 && /DRY/.test(r.out) && bundles().length === paquets.length + 1 && !existsSync(join(HOME, 'kybernos', 'boot-state.json')), r.out)

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
  ok('state is clean', etat().safe.actif === false && etat().demarrages.length === 0)
  r = cli('off')
  ok('off twice is a no-op', r.code === 0 && /not on/.test(r.out))
  r = cli('bogus')
  ok('unknown subcommand → exit 64 with usage', r.code === 64 && /Usage/.test(r.out), r.out)
} finally {
  rmSync(HOME, { recursive: true, force: true })
}
console.log(`\nSAFE MODE — ${total} assertions, ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)
