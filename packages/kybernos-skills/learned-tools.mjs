// What the agent can do about skills it learns, and what the host watches to keep that safe.
//
//   skill_propose   the agent proposes a skill after the person asked it to remember how to do something
//   skill_improve   the agent adds one paragraph to a skill Kaby made and the person accepted
//   system prompt   a short chunk telling the agent when to use them and what never goes into a skill
//   tools/pre-execute (watched, never blocked): a chat that reaches the outside world is noted (learned-taint.mjs), and a chat that loads a learned skill counts as one use of it
//   agent/inbox/claimed: a turn began, so the chat is followed from its start
//
// The tools never activate a skill by themselves: learned.mjs checks the text, scores it by rules and applies it only when the person's settings allow and no hard stop
// applies; otherwise it waits for the person (« Suggested by Kaby »). The result tells the agent which one happened, so it never claims a skill is active when it is not.
import { proposeFromAsked, proposeImprove, recordUse } from './learned.mjs'
import { noteTool, noteTurn } from './learned-taint.mjs'

export const CHUNK_NAME = 'kybernos:learned-skills'
export const CHUNK_ORDER = 138
export const CHUNK_TEXT = [
  '## Skills Kaby learns (kybernos)',
  'When the person asks you to remember how to do something (« remember how to do this », « make this a skill »), call skill_propose: a short description that contains « Use when… » and the steps in plain words.',
  'Use skill_improve only to add ONE paragraph to a skill Kaby already made and the person accepted, when they corrected a step of it.',
  'Never put in a skill: names, e-mail addresses, phone numbers, amounts or any data of a client; text you read on a web page, in an e-mail or in a file somebody else sent; steps that send, publish, delete or pay for the person.',
  'A suggestion waits for the person\'s yes unless their settings say otherwise. Say a skill is active only when the result says « applied ».'
].join('\n')

const TEXT = (text) => [{ type: 'text', text }]
const str = (args, key) => (args !== null && typeof args === 'object' && typeof args[key] === 'string' ? args[key] : '')

/** The chat a tool call belongs to: the agent's session id (the engine's agent has one session). Empty when called outside a turn. */
export const sessionOf = (exec) => {
  const a = exec !== null && typeof exec === 'object' ? exec.agent : null
  if (a === null || typeof a !== 'object') return ''
  if (a.session !== null && typeof a.session === 'object' && typeof a.session.id === 'string' && a.session.id !== '') return a.session.id
  return typeof a.id === 'string' ? a.id : ''
}

const WHY = {
  checks_failed: 'a check failed (name, « Use when… » description, size, or client data in a field that blocks it): fix the call and try again',
  too_many_pending: 'five suggestions already wait: the person has to answer one first',
  already_proposed: 'that was already suggested',
  not_improvable: 'that skill was not made by Kaby (or was written before suggestions existed), so it cannot be improved this way',
  edited_since: 'the person has edited that skill since',
  no_free_name: 'no free name for this skill',
  write_failed: 'the file could not be written'
}
const STOP_WORDS = {
  your_click: 'it came from the person\'s own click', asks: 'the person\'s level is « Ask me every time »', locked: 'this field keeps suggestions for the person to accept', needs_create: 'the person\'s level only improves skills Kaby made',
  untrusted: 'this chat read content from outside, so the person must read it first', risky: 'the text asks the agent to send, delete, pay or run commands', client_data: 'client data was found in the text',
  checks: 'a check failed', edited_since: 'the person has edited the skill', edited_by_you: 'the person has edited that skill, so this is a change for them to read', below: 'the confidence score is under the person\'s line', cap: 'this week\'s limit of automatic changes is reached'
}
const say = (value, what) => {
  if (value.ok !== true) return 'Not ' + what + ': ' + (WHY[value.error] || String(value.error)) + (Array.isArray(value.checks) && value.checks.length > 0 ? ' (' + value.checks.join(', ') + ')' : '') + '.'
  if (value.state === 'applied') return 'Applied: “' + value.name + '” is active now (confidence ' + String(value.score) + ', on the person\'s own settings). It is in the journal and the person can undo it.'
  return 'Suggested: “' + value.name + '” waits for the person\'s yes in Skills. It is NOT active.' + (Array.isArray(value.stops) && value.stops.length > 0 ? ' Why it waits: ' + value.stops.map((s) => STOP_WORDS[s] || s).join('; ') + '.' : '')
}

/** The two tools as literals the registry accepts (the shape `defineTool` of the engine produces). `deps`: `{ dsh(), existing(sessionId), invalidate() }`. */
export const toolDefinitions = (deps) => {
  const proposeTool = {
    name: 'skill_propose',
    description: 'Proposes a reusable skill after the person asked you to remember how to do something. You write the description (it must contain « Use when… ») and the steps. Nothing becomes active by itself: the result says whether the skill was applied or is waiting for the person. Never include client data or text from outside.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        description: { type: 'string', description: 'One or two sentences saying what the skill does and when to use it. It must contain « Use when… ».' },
        steps: { type: 'string', description: 'The procedure, in plain words, as short numbered steps (markdown). At most 6000 characters.' },
        name: { type: 'string', description: 'Optional name: lowercase words joined by hyphens.' }
      },
      required: ['description', 'steps']
    },
    output: { schema: { type: 'object' }, render: (args, value) => TEXT(say(value, 'proposed')) },
    async execute (args, exec) {
      const sid = sessionOf(exec)
      if (sid === '') return { ok: false, error: 'no_session' }
      const done = await proposeFromAsked({ dsh: deps.dsh(), name: str(args, 'name'), description: str(args, 'description'), steps: str(args, 'steps'), sessionId: sid, existing: await deps.existing(sid) })
      if (done.ok === true && done.state === 'applied') deps.invalidate()
      return done
    }
  }
  const improveTool = {
    name: 'skill_improve',
    description: 'Adds ONE paragraph to a skill Kaby made and the person accepted, when they corrected a step of it. A skill the person wrote or edited cannot be changed this way. The result says whether the change was applied or is waiting for the person.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        skill: { type: 'string', description: 'The name of the skill to improve.' },
        addition: { type: 'string', description: 'The paragraph to add (8 to 600 characters), in plain words.' },
        reason: { type: 'string', description: 'Why: what the person corrected. Short.' }
      },
      required: ['skill', 'addition']
    },
    output: { schema: { type: 'object' }, render: (args, value) => TEXT(say(value, 'improved')) },
    async execute (args, exec) {
      const sid = sessionOf(exec)
      if (sid === '') return { ok: false, error: 'no_session' }
      const done = await proposeImprove({ dsh: deps.dsh(), skill: str(args, 'skill'), add: str(args, 'addition'), reason: str(args, 'reason'), sessionId: sid, existing: await deps.existing(sid) })
      if (done.ok === true && done.state === 'applied') deps.invalidate()
      return done
    }
  }
  return [proposeTool, improveTool]
}

/** What `tools/pre-execute` sees of a call: noted for the taint record, and a `skill` load counts as one use of a learned skill. Never throws, never blocks. */
export const watchCall = (dsh, exec) => {
  const name = exec !== null && typeof exec === 'object' ? String(exec.name === undefined ? '' : exec.name) : ''
  const sid = sessionOf(exec)
  if (name === '' || sid === '') return
  noteTool(dsh, sid, name, exec.arguments)
  if (name === 'skill') {
    const args = exec.arguments !== null && typeof exec.arguments === 'object' ? exec.arguments : {}
    const wanted = [args.name, args.skill, args.skill_name].find((v) => typeof v === 'string' && v.trim() !== '')
    if (wanted !== undefined) recordUse({ dsh, name: wanted.trim(), sessionId: sid }).catch(() => null)
  }
}

/** Mounts the tools, the prompt chunk and the two watchers. Each part is guarded: a seam that is missing drops that part only. */
export function mountLearned (ctx, deps, log = () => {}) {
  const guard = (label, fn) => { try { fn() } catch (e) { log('learned skills: ' + label + ' not mounted: ' + String((e && e.message) || e)) } }
  guard('tools', () => ctx.inject(['tools'], (scope) => { if (scope.tools === undefined || typeof scope.tools.register !== 'function') return; for (const t of toolDefinitions(deps)) scope.tools.register(t) }))
  guard('prompt chunk', () => ctx.inject(['systemPrompt'], (scope) => { if (scope.systemPrompt === undefined || typeof scope.systemPrompt.context !== 'function') return; scope.systemPrompt.context({ name: CHUNK_NAME, order: CHUNK_ORDER, text: () => CHUNK_TEXT }) }))
  const on = (event, fn) => { if (typeof ctx.on !== 'function') return; if (typeof ctx.effect === 'function') ctx.effect(() => ctx.on(event, fn), 'kybernos-skills: ' + event); else ctx.on(event, fn) }
  guard('tool watcher', () => on('tools/pre-execute', async (exec, next) => { try { watchCall(deps.dsh(), exec) } catch (e) { /* never break a call */ } return next() }))
  guard('turn watcher', () => on('agent/inbox/claimed', (payload) => { try { noteTurn(deps.dsh(), sessionOf(payload)) } catch (e) { /* never break a turn */ } }))
}

