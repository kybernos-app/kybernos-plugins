// ── The root of the patches: DECLARED, never guessed ─────────────────────────
//
// Doctrine (lot P1 of the plan of 23/09/2026): a patch script has no right to
// SEARCH for its installation. It writes where it is told to, or it refuses.
//
// Why this is a rule and not a convenience: measured on 23/09/2026, a
// `require.resolve` probe launched from the repository and a `/opt/homebrew/...`
// default made the development machine answer « 4/4 applied » while sometimes
// writing into a copy that DSH **does not load**. A green « ✓ » can therefore
// measure an installation other than the tester's. The only source of truth is
// the lifecycle robot: it alone knows which copy is loaded by the DSH that is
// running (`racineQuiPorte`), and it passes it with `--dsh`.
//
// Calling contract:
//   node scripts/patch-dsh-<id>.mjs [--check|--revert] --dsh <ROOT>
// where ROOT is a folder that CARRIES the target, in one of the three shapes
// measured on DSH 0.1.7:
//   · the profile          ~/.dsh/profiles/web   → node_modules/<pkg>
//   · the global package   …/@deepseek-ai/dsh    → node_modules/@deepseek-ai/<short>
//   · the npm prefix       …/lib/node_modules    → @deepseek-ai/dsh/node_modules/@deepseek-ai/<short>
//
// Direct usage (to know what a script would aim at, without writing anything):
//   node scripts/racine-dsh.mjs --dsh <ROOT> [--pkg @deepseek-ai/dsh-client-ui-workspace]
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Reading text, injectable so that the resolution stays testable dry. */
export const lireTexte = (chemin) => readFileSync(chemin, 'utf8')

/** The `--dsh <R>` of the arguments, resolved to absolute. `null` when it is not there. */
export const racineDeclaree = (args) => {
  const i = args.indexOf('--dsh')
  const valeur = i >= 0 ? args[i + 1] : undefined
  if (typeof valeur !== 'string') return null
  if (valeur.trim() === '' || valeur.startsWith('--') === true) return null
  return resolve(valeur)
}

/**
 * The BASES to try: a folder B such that `B/node_modules/@deepseek-ai/<pkg>`
 * is the copy of the package. All derived from R — no guessing.
 */
export const basesPossibles = (racine) => {
  const bases = [racine]
  // PROJECT installation (reference pinned by `overrides`): the root is
  // `…/<project>/node_modules/@deepseek-ai/dsh`, the packages are hoisted, so
  // the base that carries them is the project root, two levels above
  // `node_modules`.
  if (basename(dirname(racine)) === '@deepseek-ai') bases.push(dirname(dirname(dirname(racine))))
  // npm prefix: the root is `…/lib/node_modules`, the engine is inside it.
  bases.push(join(racine, '@deepseek-ai', 'dsh'))
  return bases
}

/** The folder of the `dsh` package (the one whose VERSION is read), seen from the base. */
export const moteurSous = (base, existe = existsSync, lire = lireTexte) => {
  const sous = join(base, 'node_modules', '@deepseek-ai', 'dsh')
  if (existe(sous) === true) return sous
  // The base IS the `dsh` package (global installation: the sub-packages are
  // nested inside it). We do not confuse it with a profile: we read its name.
  try {
    if (JSON.parse(lire(join(base, 'package.json'))).name === '@deepseek-ai/dsh') return base
  } catch (e) { /* not a readable manifest: it is not the engine */ }
  return null
}

/** The engine version, or `null`: the caller SAYS it did not read it. */
export const versionDuMoteur = (moteur, lire = lireTexte) => {
  if (moteur === null) return null
  try {
    const v = JSON.parse(lire(join(moteur, 'package.json'))).version
    return typeof v === 'string' && v !== '' ? v : null
  } catch (e) { return null }
}

/**
 * Pure: returns `{ copie, base, moteur, motif }`.
 * - `copie`  : the folder of the package to patch;
 * - `base`   : the folder that CARRIES `node_modules/@deepseek-ai/*` — it is the one
 *   that gives the relative paths (`base` + `node_modules/@deepseek-ai/…`);
 * - `moteur` : the folder of the `dsh` package — it gives the VERSION, and
 *   that is a different question from the first (measured on 23/09/2026: in a
 *   project installation, the packages are hoisted to the project level, so
 *   the base and the engine are NOT the same folder).
 * `motif` is only filled in when `copie` is `null`, and it says WHY.
 */
export const resoudreCopie = (racine, pkg, existe = existsSync, lire = lireTexte) => {
  if (racine === null) {
    return {
      copie: null,
      motif: 'no root declared: this script requires --dsh <folder of the DSH engine>.\n' +
        '      The lifecycle robot always passes it (it alone knows which copy DSH loads);\n' +
        '      by hand, aim at the profile: --dsh ~/.dsh/profiles/web',
    }
  }
  // An engine root: either a folder that carries the packages (profile,
  // npm prefix), or the `dsh` package itself (whose sub-packages can be
  // nested OR hoisted to the project level).
  const porteLeMoteur = existe(join(racine, 'node_modules', '@deepseek-ai')) === true ||
    existe(join(racine, 'package.json')) === true
  if (porteLeMoteur !== true) {
    return { copie: null, motif: racine + ' carries neither node_modules/@deepseek-ai nor package.json — it is not a DSH engine root' }
  }
  for (const base of basesPossibles(racine)) {
    const copie = join(base, 'node_modules', pkg)
    if (existe(copie) === true) return { copie, base, moteur: moteurSous(base, existe, lire), motif: null }
  }
  return {
    copie: null,
    motif: pkg + ' is not installed in any of the expected copies under ' + racine + ':\n      ' +
      basesPossibles(racine).map((b) => join(b, 'node_modules', pkg)).join('\n      '),
  }
}

/** Refuses, saying so, and exits with 2 (1 = a measured discrepancy; 2 = unable to write). */
export const refuserRacine = (motif, script) => {
  console.error('✗ ' + script + ': ' + motif)
  process.exit(2)
}

// ── Direct entry point: we SAY what the root carries, we write nothing ───────
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const iPkg = args.indexOf('--pkg')
  const pkg = iPkg >= 0 && args[iPkg + 1] !== undefined ? args[iPkg + 1] : '@deepseek-ai/dsh-client-ui-workspace'
  const racine = racineDeclaree(args)
  const { copie, motif } = resoudreCopie(racine, pkg)
  if (copie === null) {
    console.error('✗ ' + pkg + ' — ' + motif)
    process.exit(2)
  }
  console.log('✓ ' + pkg)
  console.log('  root: ' + racine)
  console.log('  copy: ' + copie)
}
