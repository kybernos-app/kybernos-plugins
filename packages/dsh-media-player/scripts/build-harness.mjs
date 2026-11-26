// scripts/build-harness.mjs — bundle of the test bench (test/harness.bundle.js).
//
// The bench loads the REAL client/client.js in Chromium, with a fake DSH module
// loader and a fake plugin context; it needs a real React/ReactDOM, provided by
// esbuild from a known area of the machine (this package stays dependency-free:
// this script only runs for the tests).
//
// Usage: node scripts/build-harness.mjs
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
  join(process.env.HOME ?? '', '.dsh/profiles/web')
].filter(Boolean)

function resolveOrNull(id) {
  for (const dir of CANDIDATE_DIRS) {
    try {
      return require_.resolve(id, { paths: [dir] })
    } catch {
      /* next candidate */
    }
  }
  return null
}

const esbuildPath = resolveOrNull('esbuild')
if (esbuildPath === null) {
  console.error('[build-harness] esbuild not found. Install it or point DSH_MEDIA_PLAYER_DEPS at a folder that holds it.')
  process.exit(1)
}

const reactPkg = resolveOrNull('react/package.json')
const reactDomPkg = resolveOrNull('react-dom/package.json')
if (reactPkg === null || reactDomPkg === null) {
  console.error('[build-harness] react/react-dom not found. Install them or point DSH_MEDIA_PLAYER_DEPS at a folder that holds them.')
  process.exit(1)
}
// esbuild resolves from the folder of the entry: we give it the area where
// react/react-dom were found (one area for both).
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

// Syntax check of the bundled driver before the browser is started.
execFileSync(process.execPath, ['--check', out], { stdio: 'inherit' })
if (!existsSync(out)) process.exit(1)
console.log('[build-harness] test/harness.bundle.js — OK')
