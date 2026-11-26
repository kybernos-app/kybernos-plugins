// A registered workspace whose folder is gone, as one row per workspace. Pure: the registry's workspaces
// and a path test are given, so the rule is tested without an engine, a profile or a filesystem.
// (bêta 93953fad, 28/10: the repository had been renamed and sessions kept failing their file tools with a
// raw `rg` error; the page could not tell, the browser having no filesystem of its own.)
export const workspaceHealthRows = (workspaces, exists) => {
  const test = typeof exists === 'function' ? exists : () => false
  return (Array.isArray(workspaces) ? workspaces : []).map((w) => {
    const p = w !== null && w !== undefined && typeof w.path === 'string' ? w.path : ''
    let found = false
    try { found = p !== '' && test(p) === true } catch (e) { found = false }
    const id = w !== null && w !== undefined && w.id !== null && w.id !== undefined ? String(w.id) : ''
    return { workspaceId: id, path: p, exists: found }
  })
}

/** The workspace a new session must land in, or null for « the engine's own default ». Pure: the id the
 *  client named and a membership test are given. A malformed, empty or unknown id is IGNORED — a chat
 *  must never fail because the workspace it named is gone (bêta a1e9eec2, 28/10). */
export const requestedWorkspaceId = (want, known) => {
  if (typeof want !== 'string') return null
  const id = want.trim()
  if (id === '' || /^[A-Za-z0-9_.:-]{1,120}$/.test(id) !== true) return null
  try { return typeof known === 'function' && known(id) === true ? id : null } catch (e) { return null }
}
