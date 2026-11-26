// What a task run for an outside assistant shows of its own work (2026-11-20). The door used to answer « pending » for minutes and then give Kaby's own account of what it did. The gate
// of the computer (`turnGate`) sees every tool call of the task, the calls of the agents of its team included, and writes one short line for each: who made it, which tool, and a label that
// is a name and never a content: the file a call writes, the skill it opens, the description a team member was given, the model of a picture, the first word of a command.
// A team member is « Agent n » (n = the order in which the agents make their first call): the engine does not say which description a session was made for, and a name guessed from the order
// was measured wrong on a real task (the Designer's picture was shown as the Strategist's). The names the team was given are not lost: the `subagent` line of the task carries each description.
// What a line never carries: a command beyond its first word, a file's text, a search query, an address, a prompt, a message. The lines go to the platform as events of the task (the runner
// posts them), where only the person who made the task reads the labels.
//
// Pure: `createStepLog()` holds one task's lines; the host decides when to note one.

/** The most lines kept for one task; the next ones are counted, not kept. */
export const MAX_STEPS = 150
/** Coordination calls that say nothing about the work: they are not lines. */
const QUIET = new Set(['todo_write', 'wait_agent', 'list_agents', 'list_subagent_models', 'team_task_get', 'ask_user_question', 'send_message', 'interrupt_agent'])
const TOOL = /^[a-z0-9_.:-]{1,40}$/

/** One line of text with no control characters, at most `n` characters. */
export const clean = (v, n) => {
  if (typeof v !== 'string') return ''
  let out = ''
  for (const ch of v) {
    const k = ch.codePointAt(0)
    out += k < 32 || (k >= 127 && k <= 159) || k === 8232 || k === 8233 ? ' ' : ch
    if (out.length > n * 2) break
  }
  return out.replace(/\s+/gu, ' ').trim().slice(0, n)
}
const baseName = (p) => {
  const s = clean(p, 400)
  const i = s.lastIndexOf('/')
  return clean(i >= 0 ? s.slice(i + 1) : s, 80)
}
const firstWord = (command) => {
  const w = clean(command, 200).split(' ')[0] || ''
  return baseName(w).replace(/^[(&|]+|[;&|)(]+$/gu, '').slice(0, 24)
}
const arg = (args, ...names) => {
  if (args === null || typeof args !== 'object') return undefined
  for (const n of names) if (typeof args[n] === 'string' && args[n].trim() !== '') return args[n]
  return undefined
}

/**
 * The line a call becomes: `{ tool, label, path? }`. `tool` is a closed code (the tool's own name); `label` is a name, at most 80 characters, or empty; `path` is only given for a call that
 * writes a file, the file's own path, so that the door can say which files the task made.
 */
export function describeCall (name, args) {
  const raw = clean(String(name || ''), 60).toLowerCase()
  const tool = TOOL.test(raw) ? raw : 'tool'
  let label = ''
  let path
  switch (tool) {
    case 'write':
    case 'edit':
    case 'multi_edit': {
      const p = arg(args, 'file_path', 'path', 'filePath')
      label = p === undefined ? '' : baseName(p)
      if (p !== undefined) path = clean(p, 200)
      break
    }
    case 'read':
    case 'read_image':
    case 'notebook_edit':
      label = baseName(arg(args, 'file_path', 'path', 'filePath') || '')
      break
    case 'skill':
      label = clean(arg(args, 'name', 'skill') || '', 60)
      break
    case 'subagent':
    case 'subagent_fork':
      label = clean(arg(args, 'description') || '', 60)
      break
    case 'team_task_create':
      label = clean(arg(args, 'title', 'subject', 'description') || '', 60)
      break
    case 'create_image': {
      const model = clean(arg(args, 'model') || '', 40)
      const size = clean(arg(args, 'size') || '', 12)
      label = [model, size].filter((x) => x !== '').join(' ')
      break
    }
    case 'bash':
      label = firstWord(arg(args, 'command') || '')
      break
    case 'connections_execute':
      label = clean(arg(args, 'tool_slug') || '', 60)
      break
    default:
      label = ''
  }
  return { tool, label, ...(path === undefined ? {} : { path }) }
}

/** The lines of one task. `note` is called by the gate for each call; `since` is what the runner posts. */
export function createStepLog () {
  const steps = []
  let dropped = 0
  const agents = new Map()
  let made = 0
  return {
    /**
     * One call. `agentId` is the session that made it, `rootId` the task's own session (the one that was asked): a call of another session is a team member's, « Agent n » in the order the agents
     * make their first call (never a name taken from a description: which description a session was made for is not known here).
     */
    note (agentId, rootId, name, args) {
      const line = describeCall(name, args)
      if (QUIET.has(line.tool)) return null
      let agent = 0
      let who = 'Kaby'
      if (typeof agentId === 'string' && agentId !== rootId) {
        let known = agents.get(agentId)
        if (known === undefined) {
          const n = (made += 1)
          known = { n, who: `Agent ${n}` }
          agents.set(agentId, known)
          if (agents.size > 40) agents.delete(agents.keys().next().value)
        }
        agent = known.n
        who = known.who
      }
      const step = { agent, who, tool: line.tool, ...(line.label === '' ? {} : { label: line.label }), ...(line.path === undefined ? {} : { path: line.path }) }
      if (steps.length >= MAX_STEPS) { dropped += 1; return null }
      steps.push(step)
      return step
    },
    /** The lines from number `from` on, and how many there are. */
    since (from) {
      const n = Number.isInteger(from) && from > 0 ? from : 0
      return { steps: steps.slice(n), total: steps.length, dropped }
    }
  }
}
