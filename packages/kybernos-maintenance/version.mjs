// The semver of the shipped Kybernos plugin set, for the About page.
//
// scripts/paquet.mjs writes a VERSION file at the root of every archive it
// builds, and the repo root is two levels above this bundle, so the file is
// there on a tester's machine even though there is no git checkout. A value
// that is not a semver (empty file, garbage) is refused: the page then falls
// back to the git hash the host already measures, it never makes a version up.
import { readFileSync } from 'node:fs'

export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** The trimmed content of `chemin` when it is a semver, otherwise null (also when unreadable). */
export function lireVersion (chemin, lire = readFileSync) {
  try {
    const v = String(lire(chemin, 'utf8')).trim()
    return SEMVER.test(v) ? v : null
  } catch (e) { return null }
}
