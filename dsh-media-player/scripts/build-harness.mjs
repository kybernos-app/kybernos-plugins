// scripts/build-harness.mjs — bundle du banc d'essai (test/harness.bundle.js).
//
// Le banc d'essai charge le VRAI client/client.js dans Chromium, avec un faux
// chargeur de modules DSH et un faux contexte de plugin ; il lui faut un vrai
// React/ReactDOM, fournis par esbuild depuis une zone connue de la machine
// (ce paquet reste sans dépendance : ce script ne tourne que pour les tests).
//
// Usage : node scripts/build-harness.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require_ = createRequire(import.meta.url)

const CANDIDATE_DIRS = [
  process.env.DSH_MEDIA_PLAYER_DEPS,
  root,
  '/Users/miled/dyad-apps/platon',
  join(process.env.HOME ?? '', '.dsh/profiles/web')
].filter(Boolean)

function resolveOrNull(id) {
  for (const dir of CANDIDATE_DIRS) {
    try {
      return require_.resolve(id, { paths: [dir] })
    } catch {
      /* candidat suivant */
    }
  }
  return null
}

const esbuildPath = resolveOrNull('esbuild')
if (esbuildPath === null) {
  console.error('[build-harness] esbuild introuvable. Installe-le ou pointe DSH_MEDIA_PLAYER_DEPS vers un dossier qui le contient.')
  process.exit(1)
}

const reactPkg = resolveOrNull('react/package.json')
const reactDomPkg = resolveOrNull('react-dom/package.json')
if (reactPkg === null || reactDomPkg === null) {
  console.error('[build-harness] react/react-dom introuvables. Installe-les ou pointe DSH_MEDIA_PLAYER_DEPS vers un dossier qui les contient.')
  process.exit(1)
}
// esbuild résout depuis le dossier de l'entrée : on lui donne la zone où
// react/react-dom ont été trouvés (une seule zone pour les deux).
const nodeModulesDir = dirname(dirname(reactPkg))
const esbuild = require_(esbuildPath)
const out = join(root, 'test', 'harness.bundle.js')

await esbuild.build({
  entryPoints: [join(root, 'test', 'driver.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile: out,
  nodePaths: [nodeModulesDir],
  logLevel: 'warning'
})

const reactVersion = JSON.parse(readFileSync(reactPkg, 'utf8')).version
console.log(`[build-harness] react ${reactVersion} via ${nodeModulesDir}`)

// Vérification syntaxique du driver bundlé avant de lancer le navigateur.
execFileSync(process.execPath, ['--check', out], { stdio: 'inherit' })
if (!existsSync(out)) process.exit(1)
console.log('[build-harness] test/harness.bundle.js — OK')
