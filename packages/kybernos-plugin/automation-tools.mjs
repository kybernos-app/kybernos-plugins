// Agent tools for automations: Kaby proposes an automation (it waits for Add), binds an automation to the chat it was made in, and sets a reminder (an automation that runs once in
// this chat). The rules are in automation-suggest.mjs, automation-remind.mjs and in the tasks route (`suggest`, `bind-home`, `remind`); these tools only hand the call to the route's
// own code, with the chat's id taken from the engine, never from the model.

export const CHUNK_NAME = 'kybernos:automations'
export const CHUNK_ORDER = 139
export const PROMPT = [
  'Automations (Kybernos): use automation_suggest to PROPOSE an automation you noticed the person needs. It is stored switched off and waits for the person\'s Add: say it is suggested, never that it is running.',
  'Give the proof you measured (how many times, over what period, where you saw it) and the apps it needs (Composio toolkit slugs such as gmail or googlecalendar).',
  'When the person asks you in a chat to create an automation, after you saved it call automation_home with its id so that its runs happen in this chat.',
  'When the person asks to be reminded of something at a time (“remind me…”, “in 10 minutes”, “tomorrow at 9”), call automation_remind with what you will tell them (message) and either at (a date-time) or in_minutes. It is stored as a one-time automation that posts in this chat and shows with their automations. schedule_create is refused: never use it for a reminder.',
  'After automation_remind answers, say it in one short sentence with the time. Do not repeat the details, and never say the reminder already ran.',
  'Use memory_suggest for a fact about the person you SAW several times (give the count and where), and instructions_suggest for ONE short section of custom instructions. Both wait for the person\'s Add; neither is saved before.',
  'To propose a dashboard call kybernos_dashboard with suggested: true and a one-sentence proof: it is kept aside until the person adds it, and it is not opened for them.',
  'Never put in a suggestion a name, an e-mail address, a phone number, an amount or any data of a client: it is refused. Write patterns, not people.',
  'An automation never sends, deletes, pays or publishes on its own: write prompts that prepare drafts and ask first.',
  'When the same need, chore or correction comes back with measured evidence, call initiative_record once: it parks the entry in the initiative queue, where it waits for the person\'s decision on the Automations page. An initiative never creates, schedules or switches on an automation.',
  'The next action of an initiative is a draft: it prepares text or a plan, it never sends, publishes, deletes or pays.',
  'Call initiative_list to read what still waits. Never say an initiative was added, is active or ran unless the queue says so.'
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
  'task not found': 'no automation has that id',
  'personal data': 'the text contains an address, a phone number or a secret: write patterns, not people',
  'too long': 'the text is too long',
  empty: 'the text is empty',
  'already waiting': 'that was already suggested',
  'too many waiting': 'too many suggestions of that kind already wait: the person has to answer some first',
  'empty title': 'the title is empty',
  'no evidence': 'an initiative needs what you measured: a count of at least 1 and where you saw it, without names',
  'unknown risk': 'risk must be low, medium or high',
  'unknown reversibility': 'reversibility must be trivial, easy or hard',
  'next action must be a draft': 'the next action of an initiative is a draft: it prepares text or a plan, it never sends, publishes, deletes or pays',
  'empty next action': 'say in one line what the draft would prepare',
  'already queued': 'an initiative with that title already waits',
  'already added': 'the person already added that initiative: nothing to propose again',
  'needs new evidence': 'that one was dropped before: bring it back only with a higher count',
  'too many initiatives': 'eight initiatives already wait: the person has to answer some first',
  'message required': 'say what to remind the person of',
  'time required': 'give either at or in_minutes',
  'one time only': 'give at or in_minutes, not both',
  'invalid minutes': 'in_minutes must be a number from 1 to 527040',
  'invalid one-off date': 'at must look like 2026-11-03T23:07',
  'that date is in the past': 'that time has already passed',
  'too far ahead': 'a reminder can be one year ahead at most',
  'too many reminders waiting': 'twenty-five reminders already wait: some have to run or be deleted first',
  'no chat': 'a reminder is made from a chat'
}

/** When a reminder comes, in the words of its own zone: “3 Nov, 23:07”. Empty when the date cannot be read. */
const whenText = (task) => {
  try {
    const at = new Date(task.nextRun)
    const tz = task.schedule !== null && typeof task.schedule === 'object' && typeof task.schedule.tz === 'string' ? task.schedule.tz : undefined
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  } catch (e) { return '' }
}

/** The pending initiatives in one bounded sentence: it says what waits, never that something ran. `cap` is the queue's own bound when the caller has one. */
const initiativeListText = (items, cap) => {
  const bound = typeof cap === 'number' && cap > 0 ? cap : 8
  const list = Array.isArray(items) ? items.slice(0, bound) : []
  if (list.length === 0) return 'The initiative queue is empty: nothing waits for the person.'
  const one = (i) => {
    const item = i !== null && typeof i === 'object' ? i : {}
    const title = typeof item.title === 'string' ? Array.from(item.title).slice(0, 120).join('') : ''
    return '“' + title + '” (' + (typeof item.risk === 'string' ? item.risk : 'unknown') + ' risk, ' + (typeof item.reversibility === 'string' ? item.reversibility : 'unknown') + ' to undo)'
  }
  return 'Waiting for the person (' + list.length + (list.length >= bound ? ', full' : '') + '): ' + list.map(one).join('; ') + '. Nothing ran.'
}
const say = (value, what) => (value !== null && typeof value === 'object' && value.ok === true
  ? (what === 'memory' || what === 'instructions'
    ? 'Suggested: it waits for the person\'s Add in ' + (what === 'memory' ? 'Memory' : 'Custom instructions') + '. It is NOT saved yet.'
    : what === 'suggest'
    ? 'Suggested: “' + String(value.task.name) + '” waits for the person\'s Add in Automations. It is switched OFF and will not run before that.'
    : what === 'initiative'
    ? 'Recorded in the initiative queue: it waits for the person to answer on the Automations page. Nothing ran.'
    : what === 'initiative list'
    ? initiativeListText(value.items, value.cap)
    : what === 'remind'
    ? (value.existed === true ? 'Already set: ' : 'Reminder set: ') + '“' + String(value.task.name) + '”' + (whenText(value.task) !== '' ? ', ' + whenText(value.task) : '') + ', in this chat. It is one of the person\'s automations; it has not run yet.'
    : 'Bound: the runs of “' + String(value.task.name) + '” will happen in this chat.')
  : 'Not done: ' + (value !== null && typeof value === 'object' ? (WHY[value.error] || String(value.error)) : 'no answer') + '.')

/** The tools as literals the registry accepts. `deps`: `{ tasks(body), ledger?, initiative? }`, the tasks route's own handler, the suggestions ledger and the initiative queue (without them, only the two automation tools). */
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
  const remindTool = {
    name: 'automation_remind',
    description: 'Reminds the person of something at a time, in this chat. Stored as an automation that runs once (one line in their Automations), not as a native scheduled task: use it for every “remind me” request. Give either at or in_minutes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message: { type: 'string', description: 'What you will tell the person when it is time, written to yourself, for example "Remind the person to call the plumber." 8000 characters at most.' },
        name: { type: 'string', description: 'A short title (120 characters at most). Optional: the start of the message is used.' },
        at: { type: 'string', description: 'The date and time, for example "2026-11-03T23:07". In the machine\'s time zone unless it ends with Z or an offset such as +01:00.' },
        in_minutes: { type: 'number', description: 'Instead of at: how many minutes from now (1 to 527040).' },
        timezone: { type: 'string', description: 'An IANA time zone such as Europe/Paris for at. Optional: the machine\'s own is used.' }
      },
      required: ['message']
    },
    output: { schema: { type: 'object' }, render: (args, value) => TEXT(say(value, 'remind')) },
    async execute (args, exec) {
      const sid = sessionOf(exec)
      if (sid === '') return { ok: false, error: 'no chat' }
      const a = args !== null && typeof args === 'object' ? args : {}
      return deps.tasks({ action: 'remind', sessionId: sid, args: { message: str(a, 'message'), name: str(a, 'name'), at: str(a, 'at'), in_minutes: a.in_minutes, timezone: str(a, 'timezone') } })
    }
  }
  const tools = [suggestTool, homeTool, remindTool]
  if (deps.ledger !== undefined && deps.ledger !== null && typeof deps.ledger.add === 'function') {
    tools.push({
      name: 'memory_suggest',
      description: 'Proposes a fact about the person as a memory. It waits for their Add in Memory; nothing is saved before. Give what you measured (how many times, over what period, where). No names, addresses, numbers or client data.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', description: 'One fact, 500 characters at most, a pattern and not a person.' },
          n: { type: 'number', description: 'How many times you saw it.' },
          span: { type: 'string', description: 'Over what period, for example "60 days".' },
          where: { type: 'string', description: 'Where you saw it, for example "Gmail › Sent". No names.' }
        },
        required: ['text']
      },
      output: { schema: { type: 'object' }, render: (args, value) => TEXT(say(value, 'memory')) },
      async execute (args) { return deps.ledger.add('memory', { text: str(args, 'text'), n: args !== null && typeof args === 'object' ? args.n : undefined, span: str(args, 'span'), where: str(args, 'where') }) }
    })
    tools.push({
      name: 'instructions_suggest',
      description: 'Proposes ONE short section for the person\'s custom instructions (how to write, what never to do). It waits for their Add in Custom instructions. A new proposal replaces the previous one.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', description: 'The section, 1500 characters at most, plain sentences addressed to the agent. No names, addresses, numbers or client data.' } },
        required: ['text']
      },
      output: { schema: { type: 'object' }, render: (args, value) => TEXT(say(value, 'instructions')) },
      async execute (args) { return deps.ledger.add('instructions', { text: str(args, 'text') }) }
    })
  }
  if (deps.initiative !== undefined && deps.initiative !== null && typeof deps.initiative.add === 'function') {
    tools.push({
      name: 'initiative_record',
      description: 'Parks one initiative in the initiative queue, with the evidence you measured. It waits for the person\'s decision on the Automations page; nothing runs before, and its next action is a draft.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'A pattern, 120 characters at most: what keeps coming back. No names, no addresses, no numbers.' },
          n: { type: 'number', description: 'How many times you saw it (at least 1).' },
          span: { type: 'string', description: 'Over what period, for example "60 days".' },
          where: { type: 'string', description: 'Where you saw it, for example "Gmail › Contact form". No names.' },
          risk: { type: 'string', enum: ['low', 'medium', 'high'], description: 'What it would cost the person if the draft were wrong.' },
          reversibility: { type: 'string', enum: ['trivial', 'easy', 'hard'], description: 'How hard it is to undo the work the draft prepares.' },
          summary: { type: 'string', description: 'One line: what the draft would prepare. It never sends, publishes, deletes or pays.' }
        },
        required: ['title', 'n', 'where', 'risk', 'reversibility', 'summary']
      },
      output: { schema: { type: 'object' }, render: (args, value) => TEXT(say(value, 'initiative')) },
      async execute (args) {
        return deps.initiative.add({
          title: str(args, 'title'),
          n: args !== null && typeof args === 'object' ? args.n : undefined,
          span: str(args, 'span'),
          where: str(args, 'where'),
          risk: str(args, 'risk'),
          reversibility: str(args, 'reversibility'),
          nextAction: { kind: 'draft', summary: str(args, 'summary') }
        })
      }
    })
    tools.push({
      name: 'initiative_list',
      description: 'Reads what still waits in the initiative queue, with its evidence. It says what waits for the person; nothing has run.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { status: { type: 'string', enum: ['proposed', 'asked', 'added', 'dropped'], description: 'Optional: only entries in that state. Omit for what still waits.' } }
      },
      output: { schema: { type: 'object' }, render: (args, value) => TEXT(say(value, 'initiative list')) },
      async execute (args) {
        const status = str(args, 'status')
        const listed = await deps.initiative.list(status === '' ? undefined : status)
        const items = Array.isArray(listed) ? listed : []
        const cap = typeof deps.initiative.cap === 'number' ? deps.initiative.cap : undefined
        return cap === undefined ? { ok: true, items } : { ok: true, items, cap }
      }
    })
  }
  return tools
}

/** Mounts the tools and the prompt chunk. Each part is guarded: a seam that is missing drops that part only (a bundle never stops DSH from starting). */
export function mountAutomationTools (ctx, deps, log = () => {}) {
  const guard = (label, fn) => { try { fn() } catch (e) { log('automation tools: ' + label + ' not mounted: ' + String((e && e.message) || e)) } }
  guard('tools', () => ctx.inject(['tools'], (scope) => { if (scope.tools === undefined || typeof scope.tools.register !== 'function') return; for (const t of toolDefinitions(deps)) scope.tools.register(t) }))
  guard('prompt chunk', () => ctx.inject(['systemPrompt'], (scope) => { if (scope.systemPrompt === undefined || typeof scope.systemPrompt.context !== 'function') return; scope.systemPrompt.context({ name: CHUNK_NAME, order: CHUNK_ORDER, interpolate: false, text: () => PROMPT }) }))
}
