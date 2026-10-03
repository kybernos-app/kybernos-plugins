// scripts/build.mjs — produit `client/client.js`.
//
//   1. bundle `mermaid` (ESM npm) en IIFE autonome, sans dépendance externe
//      → vendor/mermaid.iife.js (reproductible, vendoré pour rester hors ligne)
//   2. concatène l'en-tête du chargeur de modules DSH + le bundle + la fabrique
//      du plugin (src/plugin.js)
//
// Usage : node scripts/build.mjs
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require_ = createRequire(import.meta.url)

// Mermaid et esbuild ne sont pas des dépendances de ce paquet (il reste
// installable hors ligne) : on résout depuis les zones connues de la machine.
const CANDIDATE_DIRS = [
  process.env.DSH_MERMAID_DEPS,
  root,
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

const mermaidPkgPath = resolveOrNull('mermaid/package.json')
if (!mermaidPkgPath) {
  console.error('[build] mermaid introuvable. Installe-le ou pointe DSH_MERMAID_DEPS vers un dossier qui le contient.')
  process.exit(1)
}
const esbuildPath = resolveOrNull('esbuild')
if (!esbuildPath) {
  console.error('[build] esbuild introuvable. Installe-le ou pointe DSH_MERMAID_DEPS vers un dossier qui le contient.')
  process.exit(1)
}

const mermaidVersion = JSON.parse(readFileSync(mermaidPkgPath, 'utf8')).version
const resolveDir = dirname(mermaidPkgPath)
const esbuild = require_(esbuildPath)

mkdirSync(join(root, 'vendor'), { recursive: true })

const result = await esbuild.build({
  stdin: {
    contents: "import mermaid from 'mermaid'\nexport default mermaid\n",
    resolveDir,
    sourcefile: 'dsh-mermaid-entry.mjs',
    loader: 'js'
  },
  bundle: true,
  format: 'iife',
  globalName: '__DSH_MERMAID_NS',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
  logLevel: 'warning'
})

const mermaidBundle = result.outputFiles[0].text
const vendorPath = join(root, 'vendor', 'mermaid.iife.js')
writeFileSync(
  vendorPath,
  `/* mermaid ${mermaidVersion} — MIT — bundle IIFE généré par scripts/build.mjs ; ne pas éditer. */\n${mermaidBundle}\n`
)

const pluginBody = readFileSync(join(root, 'src', 'plugin.js'), 'utf8')

const assembled = `// @local/dsh-mermaid — bundle client GÉNÉRÉ par scripts/build.mjs (ne pas éditer).
// mermaid ${mermaidVersion} (MIT) — voir vendor/NOTICES.md.
window.__ModuleLoader__.load({
  id: '@local/dsh-mermaid',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports
    try {
${indent(mermaidBundle, '      ')}
      var mermaid = (typeof __DSH_MERMAID_NS !== 'undefined' && __DSH_MERMAID_NS && (__DSH_MERMAID_NS.default || __DSH_MERMAID_NS)) || null
      if (!mermaid || typeof mermaid.render !== 'function') {
        throw new Error('[dsh-mermaid] API mermaid absente du bundle vendoré')
      }
      var plugin = (function (mermaid) {
${indent(pluginBody, '        ')}
      })(mermaid)
      exports.name = plugin.name
      exports.inject = plugin.inject
      exports.apply = plugin.apply
    } catch (error) {
      // Une exception ici casserait TOUTE l'entrée (« Failed to load plugins »)
      // et laisserait la GUI inutilisable : on dégrade, plugin désactivé.
      console.error('[dsh-mermaid] évaluation impossible — plugin désactivé', error)
    }
    return module.exports
  }
})
`

function indent(text, prefix) {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join('\n')
}

mkdirSync(join(root, 'client'), { recursive: true })
const outPath = join(root, 'client', 'client.js')
writeFileSync(outPath, assembled)

// Vérification syntaxique immédiate : un bundle cassé ne doit jamais être installé.
execFileSync(process.execPath, ['--check', outPath], { stdio: 'inherit' })

const size = (readFileSync(outPath).length / 1048576).toFixed(2)
console.log(`[build] mermaid ${mermaidVersion} → vendor/mermaid.iife.js`)
console.log(`[build] client/client.js — ${size} Mo, syntaxe OK`)
if (!existsSync(join(root, 'client', 'client.js'))) process.exit(1)