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

const bundles = readdirSync(join(REPO, BASE_BUNDLES)).filter((d) => statSync(join(REPO, BASE_BUNDLES, d)).isDirectory())
verifie('every bundle has a package.json', bundles.every((d) => existsSync(join(REPO, BASE_BUNDLES, d, 'package.json'))))

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
for (const rel of ['scripts/patches.json', 'scripts/lifecycle-packages.json', 'dsh-compat.json']) {
  verifie(`repo-root file exists: ${rel}`, existsSync(join(REPO, rel)))
}

// 3. every dir declared to the robot exists under packages/
const declared = JSON.parse(readFileSync(join(REPO, 'scripts', 'lifecycle-packages.json'), 'utf8')).packages
verifie('every lifecycle package dir exists under packages/', declared.every((p) => existsSync(join(REPO, BASE_BUNDLES, p.dir))), declared.filter((p) => !existsSync(join(REPO, BASE_BUNDLES, p.dir))).map((p) => p.dir).join(', '))

console.log(`\nLAYOUT — ${total} checks, ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)
