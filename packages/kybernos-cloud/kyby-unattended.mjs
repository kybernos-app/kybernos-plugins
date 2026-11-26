// Which turns of Kaby's chat run with nobody there to answer. Kaby wakes by itself through an ordinary automation (kybernos-plugin, « Réveil de Kaby »): the automation owns the rhythm, the
// time box, « when I write in its chat » and the Stop button. What stays here is the one thing only this package can do: the tool gate. During such a turn a question cannot be answered,
// so what the person's standing permission (kyby-mandate.mjs) does not cover is refused outright, and a question or a schedule is never offered.
//
// An automation's run is told apart by the request id of its message (`kb-task-…`, the engine keeps it as `source.rpcId` on the claimed message): no flag, no file, no seam between bundles.
// The run lasts until a LATER turn claims its inbox (the person's message, started behind it): from then on the chat is theirs again.
// Pure and dependency-free, so it is tested without DSH. Nothing here throws into a turn.

/** The request id every automation run's message carries (kybernos-plugin/automation-run-guard.mjs `RUN_REQUEST_PREFIX`). */
export const RUN_PREFIX = 'kb-task-'
/** The tools refused outright during such a turn: nobody can answer a question, and a schedule would be a standing action the person did not sign. */
export const UNATTENDED_NEVER = Object.freeze(['ask_user_question', 'schedule_create', 'schedule_update'])
/** The file of Kaby's list, in its own workspace. */
export const TODO_FILE = 'todo.md'
export const LIST_HEAD = '[YOUR LIST]'
export const LIST_TAIL = '[/YOUR LIST]'
/** The block of Kaby's system prompt about its list: two lines, in every turn of its own chat. What an automation asks Kaby to do with it is that automation's prompt, never this block. */
export const LIST_TEXT = [
  LIST_HEAD,
  'Your list is the file ' + TODO_FILE + ' in your workspace, one point per line ("- [ ]" open, "- [x]" done): when the person asks you to add a point to your list, add it there. An automation of theirs may wake you to work on it.',
  LIST_TAIL
].join('\n')

const MAX_RUNS = 200

export function createUnattended () {
  /** session id -> the turn of the automation's run. */
  const runs = new Map()
  return {
    /**
     * A turn of a session claimed one message. `message` is the engine's: a message that carries an automation's request id marks the turn as unattended; the first claim of any
     * other message after it, by a later turn, says the person is back.
     */
    noteClaim (sid, turn, message) {
      try {
        if (typeof sid !== 'string' || sid === '') return
        const source = message !== null && typeof message === 'object' ? message.source : null
        const rpc = source !== null && typeof source === 'object' ? source.rpcId : undefined
        if (typeof rpc === 'string' && rpc.startsWith(RUN_PREFIX)) {
          runs.delete(sid)
          runs.set(sid, { turn: Number.isFinite(turn) ? turn : null })
          if (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value)
          return
        }
        const run = runs.get(sid)
        if (run === undefined) return
        if (run.turn === null || (Number.isFinite(turn) && turn > run.turn)) runs.delete(sid)
      } catch (e) { /* a note is never worth a turn */ }
    },
    /** Is this session in a turn started by an automation? The gate and the journal ask this. */
    isRun (sid) { return typeof sid === 'string' && runs.has(sid) }
  }
}
