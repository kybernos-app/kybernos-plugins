// Is the active Kybernos space a team? The answer belongs to @local/kybernos-cloud, which knows the account and its spaces; this bundle
// only asks, through the seam that bundle publishes (`globalThis[Symbol.for('kybernos.space')]`, a frozen `{ version, isTeam() }`).
// Bundles ship one by one and cannot import each other: this file is the reader half, the writer half is kybernos-cloud/team-space.mjs
// (scripts/test-team-memory-cut.mjs runs both together).
//
// Read at call time, never cached or captured at load: the bundles may load in any order, and the person can switch space in the middle
// of a session (the next prompt assembly and the next tool call see it). Synchronous, because a system-prompt callback is.
//
//   no seam            there is no Kybernos Cloud bundle, so no account and no team: behaviour unchanged (false);
//   isTeam() === false the active space is personal, or the person is not connected (false);
//   anything else      a team space, a seam that cannot answer, a seam that throws: fail closed (true).
export const SPACE_SEAM = Symbol.for('kybernos.space')

/** The one sentence a lesson tool answers in a team space. */
export const TEAM_SPACE_REFUSAL = 'Personal memory is off in a team space; to share a lesson with the team, the person uses "Propose to team".'

export const inTeamSpace = (host = globalThis) => {
  try {
    const seam = host[SPACE_SEAM]
    if (seam === undefined || seam === null) return false
    return typeof seam.isTeam !== 'function' || seam.isTeam() !== false
  } catch (e) {
    return true
  }
}

// What a call names when it reaches the person's memory by the side door. Matched against the call's arguments as text, whatever the tool (a shell
// command, a file path, a URL): the lessons CLI, the lessons files, the account's state and settings files, and the loopback routes of the pages.
const SIDE_DOORS = [
  /memory\.cjs/,
  /lessons(?:\.archive)?\.jsonl/,
  /kybers[\\/]+[^\\/\s"']+[\\/]+memory/,
  /kybernos-(?:cloud|memory)[\w.-]*\.json/,
  /(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/kybernos-(?:cloud|memory|search)\//,
]

/** Does this tool call (`{ name, arguments }`) name one of them? Never throws. */
export const touchesPersonalMemory = (exec) => {
  try {
    const args = exec !== null && typeof exec === 'object' ? exec.arguments : undefined
    const text = typeof args === 'string' ? args : JSON.stringify(args === undefined ? null : args)
    return SIDE_DOORS.some((door) => door.test(text))
  } catch (e) {
    return false
  }
}
