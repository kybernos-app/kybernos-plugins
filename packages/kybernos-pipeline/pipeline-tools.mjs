// kybernos-pipeline — the two tools the agent gets, and the gate that makes one of them ask. Pure: the host logic comes in as `host` (pipeline-host.mjs).
//
//   pipeline_list  free. The boards, or the columns and cards of one board. It only reads.
//   pipeline_move  moves a card to another stage. It asks the person EVERY time (DSH's own approval card, through a `tools/pre-execute` gate) and
//                  leaves one `move` line in the journal of the base, actor `agent`.
//
// Neither tool sends anything or calls the network. The definitions are the literal shape `defineTool` produces, so this file imports nothing from the engine.

export const LIST_TOOL = 'pipeline_list'
export const MOVE_TOOL = 'pipeline_move'

const TEXT = (text) => [{ type: 'text', text }]
const say = (value) => {
  if (value === null || typeof value !== 'object') return String(value)
  if (value.ok !== true) return 'Pipeline: ' + String(value.error) + (value.detail !== undefined ? ' (' + String(value.detail) + ')' : '')
  return JSON.stringify(value, null, 2)
}

/** The tool definitions, in the engine's literal shape. `host` is `createPipelineHost(...)`. */
export function toolDefinitions (host) {
  const list = {
    name: LIST_TOOL,
    description: 'Reads the Pipeline boards. Without arguments it lists the boards (flow key, name, stages, number of cards). With `flow` it returns the board: for each stage its name, number of cards, total value and up to 100 cards (id, title, subtitle, value, linked contact and item). `stage` keeps one column, `q` keeps the cards whose title or subtitle contains the text. It changes nothing.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        flow: { type: 'string', description: 'The key of a board, as listed when called without arguments.' },
        stage: { type: 'string', description: 'Only this stage (a stage key).' },
        q: { type: 'string', description: 'Only the cards whose title or subtitle contains this text.' },
      },
    },
    output: { schema: { type: 'object' }, render: (args, value) => TEXT(say(value)) },
    async execute (args) { return host.agentList(args) },
  }
  const move = {
    name: MOVE_TOOL,
    description: 'Moves one Pipeline card to another stage of its board. The person is asked to approve each move, and the move is written in the journal as made by the agent. The card goes to the end of the new column. Use pipeline_list first to get the card id and the stage keys.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        card: { type: 'integer', description: 'The id of the card, from pipeline_list.' },
        stage: { type: 'string', description: 'The key of the stage to move it to.' },
      },
      required: ['card', 'stage'],
    },
    output: { schema: { type: 'object' }, render: (args, value) => TEXT(say(value)) },
    async execute (args) { return host.agentMove(args) },
  }
  return [list, move]
}

/**
 * The handler of `tools/pre-execute`: every call of `pipeline_move` is put to the person (`ask`, in both languages) and nothing else is touched.
 * It never throws, and it fails closed: if the card cannot be described, the person is still asked, with a plain sentence.
 */
export function approvalGate (host) {
  return async (exec, next) => {
    let mine = false
    try { mine = exec !== null && typeof exec === 'object' && exec.name === MOVE_TOOL } catch (e) { mine = false }
    if (!mine) return next()
    let said = { en: 'Move a Pipeline card?', fr: 'Déplacer une carte Pipeline ?' }
    try { said = host.describeMove(exec.arguments) } catch (e) { /* the plain sentence above */ }
    return { kind: 'ask', reason: said.en, displayReason: { en: said.en, fr: said.fr } }
  }
}
