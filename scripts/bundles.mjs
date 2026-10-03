// Where bundles live inside the repo. Single source of truth for the robot,
// the packager and the tests: change BASE_BUNDLES here, nowhere else.
import { join } from 'node:path'

export const BASE_BUNDLES = 'packages'

/** Absolute folder of a bundle (`dir` is the bare bundle id, e.g. "kybernos-theme"). */
export const dossierBundle = (racine, dir) => join(racine, BASE_BUNDLES, dir)

/** Repo-relative POSIX path of a bundle folder, as written in archive manifests. */
export const cheminBundle = (dir) => BASE_BUNDLES + '/' + dir
