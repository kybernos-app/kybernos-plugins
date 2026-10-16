// Which folder a new Agent Team is written to. No I/O: index.js lists the roots (rootsFor) and hands them here, so the rule
// can be tested without a host.
//
// A team made from the Teams page goes to the project the person works in (the `workspace` root: <project>/kybers), where
// they can commit it. A team installed by the first-run starter kit does not: a welcome screen must not change the
// `git status` of a project (A6-24, `?? kybers/`), so the kit asks for DSH's own home (the `installed` root, ~/.dsh/kybers).

/**
 * The root a team is written to (`{ id, path }`), or null when there is no root at all.
 * @param {Array<{ id: string, path: string }>} roots every root the host knows, in its own order
 * @param {{ home?: boolean }} [want] `home: true` = DSH's own home when it has one
 */
export const kyberTarget = (roots, want) => {
  const list = Array.isArray(roots) ? roots.filter((r) => r !== null && typeof r === 'object' && typeof r.path === 'string' && r.path !== '') : []
  const byId = (id) => list.find((r) => r.id === id)
  if (want !== null && want !== undefined && want.home === true) {
    const home = byId('installed')
    if (home !== undefined) return home
  }
  const workspace = byId('workspace')
  if (workspace !== undefined) return workspace
  return list.length > 0 ? list[0] : null
}
