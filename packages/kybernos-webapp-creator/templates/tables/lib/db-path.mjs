// db-path.mjs — where kybernos-db is read from. Pure: the file test is injected.
//
// A built app carries its own copy, `vendor/kybernos-db/` (scripts/build-tables-app.mjs); inside this repository the template runs against `packages/kybernos-db/`. The vendored
// copy wins, so a built app never depends on what sits around it.
import { join } from 'node:path'

export const ENTRY = 'api.mjs'

/** The folders to try, best first, from the folder of lib/. */
export const candidates = (libDir) => [join(libDir, '..', 'vendor', 'kybernos-db'), join(libDir, '..', '..', '..', '..', 'kybernos-db')]

/** The first folder that holds the door (`api.mjs`), or null. */
export const pickDb = (libDir, exists) => candidates(libDir).find((dir) => exists(join(dir, ENTRY))) ?? null
