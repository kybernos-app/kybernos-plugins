// ═══════════════════════════════════════════════════════
// moteur.mjs — the DSH engine's own modules, found at run time.
//
// A provider needs four modules of the engine it runs inside: @deepseek-ai/dsh-subagent (the run-handle helpers),
// @deepseek-ai/dsh-subprocess, @deepseek-ai/dsh-brand and @deepseek-ai/schemastery (its config schema).
//
// A package linked from a checkout cannot `import` them the usual way: Node resolves a bare name from the package's REAL
// path, which is the checkout, and the checkout has no node_modules. (On the author's machine these providers only worked
// through hand-made symlinks in an untracked node_modules that pointed into one engine install; on any other machine the
// import failed.) So they are looked up from where the engine is — the copy the running engine uses, which also keeps one
// instance of each module in the process.
//
// Starting points, most trustworthy first:
//   1. KB_MOTEUR            an explicit override (a developer's own engine, the tests)
//   2. the running `dsh`    process.argv[1], symlinks resolved: the engine that loaded this plugin
//   3. an official provider the profile already has (@deepseek-ai/dsh-subagent-codex or -claude-code): it sees the engine
//   4. the profile itself   <DSH_HOME>/profiles/<DSH_PROFILE|web>/package.json
//   5. this package         a checkout that ran `npm install`
// No @deepseek-ai/* import here: this file is what finds them.
// ═══════════════════════════════════════════════════════

import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const reel = (chemin) => { try { return realpathSync(chemin) } catch { return null } }

/** The files to resolve a bare name FROM, in order, without duplicates. */
export function pointsDeDepart ({ env = process.env, argv1 = process.argv[1], ici = import.meta.url } = {}) {
  const home = env.DSH_HOME || join(homedir(), '.dsh')
  const profil = join(home, 'profiles', env.DSH_PROFILE || 'web', 'package.json')
  const points = []
  const ajouter = (chemin) => { if (typeof chemin === 'string' && chemin !== '' && !points.includes(chemin)) points.push(chemin) }
  if (typeof env.KB_MOTEUR === 'string' && env.KB_MOTEUR !== '') ajouter(join(env.KB_MOTEUR, 'noop.js'))
  if (typeof argv1 === 'string' && argv1 !== '') ajouter(reel(argv1))
  for (const officiel of ['@deepseek-ai/dsh-subagent-codex', '@deepseek-ai/dsh-subagent-claude-code']) {
    try { ajouter(createRequire(profil).resolve(officiel)) } catch { /* not installed in this profile */ }
  }
  ajouter(profil)
  try { ajouter(fileURLToPath(ici)) } catch { /* not a file URL */ }
  return points
}

/** Imports `nom` from the first starting point that holds it. Resolves { module, chemin }; throws when none does. */
export async function importerDepuis (points, nom) {
  for (const depart of points) {
    let chemin
    try { chemin = createRequire(depart).resolve(nom) } catch { continue }
    return { module: await import(pathToFileURL(chemin).href), chemin }
  }
  throw new Error(`dsh-subagent-maison: cannot find ${nom} — looked from ${points.length === 0 ? 'nowhere' : points.join(', ')}. Run it inside DSH, or set KB_MOTEUR to a folder whose node_modules holds the engine.`)
}

/**
 * The four modules a provider uses. The schema and brand modules are looked up from the engine's own subagent package first,
 * so the classes are the very ones the engine validates and brands with.
 * @returns {{ subagent: object, subprocess: object, brand: object, z: any }}
 */
export async function chargerMoteur (options) {
  const points = pointsDeDepart(options)
  const sub = await importerDepuis(points, '@deepseek-ai/dsh-subagent')
  const depuisSub = [sub.chemin, ...points]
  const [subprocess, brand, schema] = await Promise.all([
    importerDepuis(points, '@deepseek-ai/dsh-subprocess'),
    importerDepuis(depuisSub, '@deepseek-ai/dsh-brand'),
    importerDepuis(depuisSub, '@deepseek-ai/schemastery')
  ])
  return { subagent: sub.module, subprocess: subprocess.module, brand: brand.module, z: schema.module.default ?? schema.module }
}
