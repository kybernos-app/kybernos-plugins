// The goal of a session, from the engine's own journal events.
//
// The engine keeps a session's goal in the session log (`goal/change`, version 1: a full snapshot after every change, a tombstone for
// `clear`) and counts the rounds as the `user/message` events that come from the goal. The Goals tab of a project lists the goals of its
// chats, also those of chats that are not open in the running DSH, so it reads that log rather than asking the live goal service.
//
// Pure: events in, the current goal (or null) out. The engine's own replay is strict (it refuses a malformed log); this one is lenient on
// purpose: a record it does not understand is skipped, never a reason to hide the other goals of the project.

/** The longest objective / blocker text handed to the page (the row clips it again). */
export const GOAL_TEXT_MAX = 600

const PHASES = ['active', 'paused', 'blocked', 'complete']

const clip = (value, max) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > max ? text.slice(0, max) : text
}
const nonNegative = (value) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null)

/**
 * The current goal of a session, or null (none ever set, or cleared since).
 * @param events the session's events, in order: { type, data }
 * @returns null | { id, objective, phase, roundsStarted, maxGoalRounds, blockedReason, createdAt, updatedAt }
 */
export function goalFromEvents(events) {
  if (Array.isArray(events) === false) return null
  let goal = null
  for (const event of events) {
    if (event === null || event === undefined || typeof event !== 'object') continue
    const data = event.data
    if (data === null || data === undefined || typeof data !== 'object') continue
    if (event.type === 'goal/change') {
      if (data.kind !== 'goal/change') continue
      if (data.operation === 'clear') { goal = null; continue }
      const snap = data.goal
      if (snap === null || snap === undefined || typeof snap !== 'object') continue
      const objective = clip(snap.objective, GOAL_TEXT_MAX)
      if (objective === '' || PHASES.indexOf(snap.phase) < 0 || typeof snap.id !== 'string' || snap.id === '') continue
      const reason = snap.blockedReason !== null && snap.blockedReason !== undefined && typeof snap.blockedReason === 'object' ? clip(snap.blockedReason.message, 300) : ''
      goal = {
        id: snap.id,
        objective: objective,
        phase: snap.phase,
        roundsStarted: nonNegative(data.roundsStarted) === null ? 0 : data.roundsStarted,
        maxGoalRounds: typeof snap.maxGoalRounds === 'number' && snap.maxGoalRounds > 0 ? snap.maxGoalRounds : null,
        blockedReason: snap.phase === 'blocked' && reason !== '' ? reason : null,
        createdAt: nonNegative(data.createdAt),
        updatedAt: nonNegative(data.updatedAt),
      }
      continue
    }
    // A round the goal started: the next goal-sourced message of the goal that is current.
    if (event.type === 'user/message' && goal !== null) {
      const source = data.source
      if (source !== null && source !== undefined && typeof source === 'object' && source.kind === 'goal' && source.goalId === goal.id && source.round === goal.roundsStarted + 1) {
        goal.roundsStarted = source.round
      }
    }
  }
  return goal
}

/** Active first, then blocked, paused, complete; inside a phase the goal running in this DSH first (it has no date), then the most recently changed. */
export function sortGoals(goals) {
  const order = ['active', 'blocked', 'paused', 'complete']
  const rank = (g) => { const i = order.indexOf(g.phase); return i < 0 ? order.length : i }
  return goals.slice().sort((a, b) => (rank(a) - rank(b)) || ((b.live === true ? 1 : 0) - (a.live === true ? 1 : 0)) || ((b.updatedAt === null || b.updatedAt === undefined ? 0 : b.updatedAt) - (a.updatedAt === null || a.updatedAt === undefined ? 0 : a.updatedAt)))
}
