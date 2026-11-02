// Which kind of space the person is in, decided from the connection state alone: no network, no await, so a system-prompt
// callback (synchronous, run at every assembly) and a tool can ask it at any moment.
//
// A TEAM space is every connected space that is not the person's own. The rule is deliberately one-sided: only a record that says
// `personal: true` (a required boolean of the server's Workspace) is personal, and everything the code cannot read as that is a
// team. The caller of `spaceKind` then CUTS what is personal (the account memory, the local lessons, the capture): wrongly cutting
// a personal space costs a memory that does not show up; wrongly keeping it in a team would put a personal memory in front of the
// model of a team conversation.
//
//   'none'      not connected to the cloud: no space, no team, nothing changes for the caller;
//   'personal'  connected, the active space is the person's own, and the model route names that same space;
//   'team'      connected, and the active space is another one — or cannot be told (no active space in the list, a list that is
//               missing, a state file that is there but unreadable) — or the model route still names another space than the
//               active one (a catalogue import that failed, a read that wrote an old choice back): the chat is billed where the
//               ROUTE says, so the route disagreeing is a doubt. Fail closed.
//
// The seam below is how the other bundles ask (kybernos-memory cannot import this file: bundles ship one by one). Same shape as
// `kybernos.cloud` and `kybernos.trustedAuthority`: a frozen object on globalThis under a registered symbol, read at call time so
// the load order of the bundles does not matter.

export const SPACE_SEAM = Symbol.for('kybernos.space')

/** What the state reader answers when the connection file EXISTS but cannot be read now (a write caught half way, bad rights, damaged JSON). */
export const UNREADABLE = Object.freeze({ unreadable: true })

/**
 * @param state the connection state, `null` when there is none, or UNREADABLE
 * @param activeId the id of the active space as the host derives it (espaceActif), `null` when none
 */
export const spaceKind = (state, activeId) => {
  if (state === UNREADABLE) return 'team'
  if (state === null || state === undefined || typeof state !== 'object' || Array.isArray(state)) return 'none'
  if (typeof state.token !== 'string' || state.token === '') return 'none'
  const spaces = Array.isArray(state.workspaces) ? state.workspaces : []
  const space = typeof activeId === 'string' && activeId !== '' ? spaces.find((w) => w !== null && typeof w === 'object' && w.id === activeId) : undefined
  if (space === undefined || space.personal !== true) return 'team'
  // The space the imported model route names (`models.workspace`, written with the route); none recorded is no doubt.
  const routed = state.models !== null && typeof state.models === 'object' && typeof state.models.workspace === 'string' ? state.models.workspace : ''
  return routed !== '' && routed !== activeId ? 'team' : 'personal'
}

/**
 * Publishes the seam: `isTeam()` is true in a team space and in doubt, false in a personal space and when not connected.
 * `readKind` is the host's own reader (it reads the state file each time, so a switch is seen at the very next assembly).
 */
export const publishSpaceSeam = (readKind, target = globalThis) => {
  try {
    target[SPACE_SEAM] = Object.freeze({
      version: 1,
      isTeam: () => { try { const kind = readKind(); return kind !== 'personal' && kind !== 'none' } catch (e) { return true } },
    })
  } catch (e) { /* a frozen global: the other bundles read "no seam" as "no teams" */ }
}
