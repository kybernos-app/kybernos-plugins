// The real member cap of a team, for the « n / cap » seats of the Crew view (GET /kybernos/team-cap).
//
// Two engines, two places (measured 2026-11-18):
//   · DSH up to 0.2.2-rc.1: the team service (`agentTeams`) carries `maxMembers` (raised to 16 by the profile);
//   · DSH 0.2.2-rc.2 and later: the team service takes only `maxTasks` and `defaultEnabled` (a row that still sets `maxMembers`
//     does not activate), teammates are subagents, and the cap is the subagent runtime's `maxActiveSubagents`
//     (Settings > Plugins > Subagent, default 8, a live value read with `.get()`).
// Reading is DEFENSIVE and never invents a number: a missing service, a replaced config or a non-numeric value gives `null`, and
// the page then draws no denominator. The team service is asked first, so on the older engine nothing changes.

export const capFromValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) === true && value >= 1) return Math.floor(value)
  if (typeof value === 'string' && /^[0-9]+$/.test(value) === true) {
    const n = Number(value)
    if (Number.isFinite(n) === true && n >= 1) return Math.floor(n)
  }
  return null
}

const objectOrNull = (o) => (o !== null && o !== undefined && typeof o === 'object' ? o : null)

/** `maxMembers` of the team service: its roster, its config, the service itself or the roster's config. */
export const capFromTeamService = (svc) => {
  const service = objectOrNull(svc)
  if (service === null) return null
  const roster = objectOrNull(service.roster)
  const config = objectOrNull(service.config)
  const rosterConfig = roster === null ? null : objectOrNull(roster.config)
  const candidates = [
    roster === null ? null : roster.maxMembers,
    config === null ? null : config.maxMembers,
    service.maxMembers,
    rosterConfig === null ? null : rosterConfig.maxMembers
  ]
  for (let i = 0; i < candidates.length; i += 1) {
    const cap = capFromValue(candidates[i])
    if (cap !== null) return cap
  }
  return null
}

/** `maxActiveSubagents` of the subagent runtime: a plain number, or a live value with `.get()`. */
export const capFromSubagentService = (svc) => {
  const service = objectOrNull(svc)
  const config = service === null ? null : objectOrNull(service.config)
  if (config === null) return null
  const value = config.maxActiveSubagents
  try {
    return capFromValue(value !== null && value !== undefined && typeof value.get === 'function' ? value.get() : value)
  } catch (e) { return null }
}

/**
 * @param {{ get: (name: string) => unknown, bound?: unknown }} source `get` is `ctx.get`; `bound` is the team service bound at boot.
 * @returns {number | null}
 */
export const readTeamCap = ({ get, bound }) => {
  const asked = (name) => { try { return get(name) } catch (e) { return null } }
  const steps = [
    () => capFromTeamService(asked('agentTeams')),
    () => capFromTeamService(bound),
    // some compositions register the service under the plugin's id
    () => capFromTeamService(asked('agent-team')),
    () => capFromSubagentService(asked('subagents'))
  ]
  for (const step of steps) {
    try {
      const cap = step()
      if (cap !== null) return cap
    } catch (e) { /* this source is unusable: try the next one */ }
  }
  return null
}
