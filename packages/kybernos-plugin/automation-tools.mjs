// Agent tools for automations: Kaby proposes an automation (it waits for Add) and binds an automation to the chat it was made in. The rules are in automation-suggest.mjs
// and in the tasks route (`suggest`, `bind-home`); these tools only hand the call to the route's own code, with the chat's id taken from the engine, never from the model.

export const CHUNK_NAME = 'kybernos:automations'
export const CHUNK_ORDER = 139
export const PROMPT = [
  'Automations (Kybernos): use automation_suggest to PROPOSE an automation you noticed the person needs. It is stored switched off and waits for the person\'s Add: say it is suggested, never that it is running.',
  'Give the proof you measured (how many times, over what period, where you saw it) and the apps it needs (Composio toolkit slugs such as gmail or googlecalendar).',
  'When the person asks you in a chat to create an automation, after you saved it call automation_home with its id so that its runs happen in this chat.',
  'An automation never sends, deletes, pays or publishes on its own: write prompts that prepare drafts and ask first.'
].join('\n')

const TEXT = (text) => [{ type: 'text', text }]
const str = (args, key) => (args !== null && typeof args === 'object' && typeof args[key] === 'string' ? args[key] : '')

/** The chat a tool call belongs to: the agent's session id. Empty when called outside a turn. */
export const sessionOf = (exec) => {
  const a = exec !== null && typeof exec === 'object' ? exec.agent : null
  if (a === null || typeof a !== 'object') return ''
  if (a.session !== null && typeof a.session === 'object' && typeof a.session.id === 'string' && a.session.id !== '') return a.session.id
  return typeof a.id === 'string' ? a.id : ''
}

const WHY = {
  'already exists': 'an automation with that name already exists',
  'too many suggestions waiting': 'eight suggestions already wait: the person has to answer some first',
  'frequent schedule': 'that schedule runs more often than every 5 minutes',
  'task not found': 'no automation has that id'
}
const say = (value, what) => (value !== null && typeof value === 'object' && value.ok === true
  ? (what === 'suggest'
    ? 'Suggested: “' + String(value.task.name) + '” waits for the person\'s Add in Automations. It is switched OFF and will not run before that.'
    : 'Bound: the runs of “' + String(value.task.name) + '” will happen in this chat.')
  : 'Not done: ' + (value !== null && typeof value === 'object' ? (WHY[value.error] || String(value.error)) : 'no answer') + '.')

/** The two tools as literals the registry accepts. `deps`: `{ tasks(body) }`, the tasks route's own handler. */
export const toolDefinitions = (deps) => {
  const suggestTool = {
    name: 'automation_suggest',
    description: 'Proposes an automation to the person. It is stored switched off and waits for their Add; nothing runs before. Give the proof you measured and the apps it needs.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'A short name (120 characters at most).' },
        prompt: { type: 'string', description: 'What the automation does each time, as short numbered steps. It prepares drafts and asks before anything leaves. 8000 characters at most.' },
        cron: { type: 'string', description: 'Five-field cron expression, for example "0 8 * * 1" for Mondays at 08:00. Not more often than every 5 minutes.' },
        timezone: { type: 'string', description: 'An IANA time zone such as Europe/Paris. Optional: the machine\'s own is used.' },
        needs: { type: 'array', items: { type: 'string' }, description: 'Composio toolkit slugs the automation needs, for example ["gmail", "googlecalendar"].' },
        proof: {
          type: 'object',
          additionalProperties: false,
          properties: {
            n: { type: 'number', description: 'How many times you saw the need.' },
            span: { type: 'string', description: 'Over what period, for example "60 days".' },
            where: { type: 'string', description: 'Where you saw it, for example "Gmail › Contact form". No names.' },
            note: { type: 'string', description: 'One short sentence, no names, no amounts.' }
          }
        }
      },
      required: ['name', 'prompt', 'cron']
    },
    output: { schema: { type: 'object' }, render: (args, value) => TEXT(say(value, 'suggest')) },
    async execute (args, exec) {
      const tz = str(args, 'timezone')
      return deps.tasks({
        action: 'suggest',
        task: Object.assign({ name: str(args, 'name'), prompt: str(args, 'prompt'), schedule: Object.assign({ mode: 'cron', cron: str(args, 'cron') }, tz !== '' ? { tz } : {}) }, Array.isArray(args.needs) ? { needs: args.needs } : {}),
        proof: args !== null && typeof args === 'object' && args.proof !== null && typeof args.proof === 'object' ? args.proof : null
      })
    }
  }
  const homeTool = {
    name: 'automation_home',
    description: 'After you saved an automation at the person\'s request in this chat, call this with its id so that its runs happen in this chat instead of opening a new one each time.',
    parameters: { type: 'object', additionalProperties: false, properties: { task_id: { type: 'string', description: 'The id of the automation (the "id" field of its entry in tasks.json).' } }, required: ['task_id'] },
    output: { schema: { type: 'object' }, render: (args, value) => TEXT(say(value, 'home')) },
    async execute (args, exec) {
      const sid = sessionOf(exec)
      if (sid === '') return { ok: false, error: 'no chat' }
      return deps.tasks({ action: 'bind-home', id: str(args, 'task_id'), sessionId: sid })
    }
  }
  return [suggestTool, homeTool]
}

/** Mounts the tools and the prompt chunk. Each part is guarded: a seam that is missing drops that part only (a bundle never stops DSH from starting). */
export function mountAutomationTools (ctx, deps, log = () => {}) {
  const guard = (label, fn) => { try { fn() } catch (e) { log('automation tools: ' + label + ' not mounted: ' + String((e && e.message) || e)) } }
  guard('tools', () => ctx.inject(['tools'], (scope) => { if (scope.tools === undefined || typeof scope.tools.register !== 'function') return; for (const t of toolDefinitions(deps)) scope.tools.register(t) }))
  guard('prompt chunk', () => ctx.inject(['systemPrompt'], (scope) => { if (scope.systemPrompt === undefined || typeof scope.systemPrompt.context !== 'function') return; scope.systemPrompt.context({ name: CHUNK_NAME, order: CHUNK_ORDER, interpolate: false, text: () => PROMPT }) }))
}
