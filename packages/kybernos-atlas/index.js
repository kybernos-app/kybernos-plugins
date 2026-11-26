// kybernos-atlas: host half.
//
// Atlas is read-only and lives entirely in the client: it reads the routes the
// other Kybernos plugins already serve (same origin) and the DSH workspace store,
// then draws them. There is nothing for the host to do, so no route is added and
// nothing new is exposed. The file is still required by the bundle manifest.
export const name = 'kybernos-atlas'

export function apply () {}
