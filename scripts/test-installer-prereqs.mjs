// The installer's prerequisites: DSH installs a profile's plugins with `pnpm`, and the site promises only Node and git.
//
//   node scripts/test-installer-prereqs.mjs
//
// Found by the acceptance run of 2026-10-08, scenario B (a machine with no DSH) in a throw-away HOME: the engine was put
// in place, then `dsh plugin install` died on « spawn pnpm ENOENT » and the installer stopped in the middle. The real
// run (npm and a registry) is not for CI; what is pinned here is the wiring that fixed it.
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./dsh-lifecycle.mjs', import.meta.url), 'utf8')
const profil = SRC.slice(SRC.indexOf('const installerProfil = async () => {'), SRC.indexOf('// ── l\'environnement réel, injecté dans le moteur'))
check('installerProfil provides pnpm before it asks DSH to install the profile', profil.indexOf('await assurerPnpm()') >= 0 && profil.indexOf('await assurerPnpm()') < profil.indexOf("['dsh', 'plugin', '--profile', 'web', 'install']"))
const pnpm = SRC.slice(SRC.indexOf('async function assurerPnpm'), SRC.indexOf('// install pnpm avec sortie VISIBLE'))
check('it first asks whether pnpm answers, and does nothing when it does', /execReel\(\['pnpm', '--version'\][^)]*\)\s*\n\s*if \(present\.code === 0\) return/.test(pnpm))
check('otherwise it installs pnpm with npm in the installer\'s own tree and links it where dsh is linked', pnpm.includes("['npm', 'install'") && pnpm.includes("lierDansLePrefixe(vrai, 'pnpm'"))
check('a pnpm that cannot be provided stops with a sentence that says what to do', pnpm.includes('npm install -g pnpm'))
check('the engine and pnpm share one way to link into the global prefix', SRC.includes('async function lierDansLePrefixe') && (SRC.match(/await lierDansLePrefixe\(/g) || []).length === 2)

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
