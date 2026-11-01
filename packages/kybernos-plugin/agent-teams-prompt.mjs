// The block of the system prompt that says several Agent Teams can work in one chat, and how. The protocol itself is the `kyber-selection`
// skill (section 6); this block only names the teams that exist and points to it, so a plain chat knows it may run more than one team and
// counts the roster's seats first. It carries ids only (a team's mission is the person's text, and the skill reads it when it is needed),
// it says nothing with fewer than two teams or without the skill, and it is the same text from one step to the next (the prompt stays cacheable).
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dshHomeSync } from './dsh-home.mjs'

export const TEAMS_CHUNK_NAME = 'kybernos:agent-teams'
export const TEAMS_CHUNK_ORDER = 140          // after the automations block (139), before the workspace instructions (150)
export const TEAMS_MIN = 2                    // one team needs no coordination
export const TEAMS_LISTED_MAX = 12
const TEAMS_REREAD_MS = 5000                  // a few files read at most this often, not at every step of every chat
const TEAM_ID = /^[a-z0-9][a-z0-9-]{0,62}$/
const HEAD = '[KYBERNOS AGENT TEAMS]'

/** Ids of the Agent Teams under a kybers root: a folder with a `kyber.yml`, a plain name, never `default` (the base persona). */
export const listTeams = (kybersRoot) => {
  let names = []
  try { names = readdirSync(kybersRoot) } catch (e) { return [] }
  return names.filter((name) => {
    if (!TEAM_ID.test(name) || name === 'default') return false
    try { return statSync(join(kybersRoot, name)).isDirectory() && (existsSync(join(kybersRoot, name, 'kyber.yml')) || existsSync(join(kybersRoot, name, 'kyber.yaml'))) } catch (e) { return false }
  }).sort()
}

/** The block for these team ids, or '' when there is nothing to coordinate. */
export const renderTeamsBlock = (ids) => {
  if (!Array.isArray(ids) || ids.length < TEAMS_MIN) return ''
  const shown = ids.slice(0, TEAMS_LISTED_MAX)
  const more = ids.length - shown.length
  return [
    HEAD + ' Agent Teams on this machine: ' + shown.join(', ') + (more > 0 ? ' and ' + String(more) + ' more' : '') + '.',
    'Several teams can work side by side in one chat. Only the Team Lead, the chat\'s own agent, spawns teammates, from one roster that every team shares; a teammate cannot spawn another.',
    'When you run more than one team: a seat is never given back, so count the seats before you spawn and say how many are left; name each member <team>-<role>; begin each board task with [<team>]. Load the kyber-selection skill (section 6) first.',
  ].join('\n')
}

/**
 * `promptFor()` for the block. Reads `<DSH home>/kybers` and `<DSH home>/skills/kyber-selection` at most every few seconds; never throws.
 * @param {{ home?: string, now?: () => number }} [options] `home` overrides the DSH home (tests), `now` the clock.
 */
export const createAgentTeamsPrompt = (options = {}) => {
  const now = typeof options.now === 'function' ? options.now : Date.now
  let at = -Infinity
  let text = ''
  return () => {
    try {
      const t = now()
      if (t - at < TEAMS_REREAD_MS) return text
      at = t
      const home = typeof options.home === 'string' && options.home !== '' ? options.home : dshHomeSync()
      text = existsSync(join(home, 'skills', 'kyber-selection', 'SKILL.md')) ? renderTeamsBlock(listTeams(join(home, 'kybers'))) : ''
    } catch (e) { text = '' }
    return text
  }
}
