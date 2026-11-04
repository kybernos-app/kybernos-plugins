// The agent tools of the automations: automation_suggest (a proposal that waits for Add), automation_home (the runs happen in this chat) and automation_remind (a reminder: an automation that runs once, in this chat).
import { toolDefinitions, mountAutomationTools, sessionOf, CHUNK_NAME, PROMPT } from './automation-tools.mjs'

let fails = 0
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label) }

const calls = []
const deps = { tasks: async (body) => { calls.push(body); return body.action === 'suggest' ? { ok: true, task: { name: body.task.name } } : (body.id === 'nope' ? { ok: false, error: 'task not found' } : { ok: true, task: { name: 'Weekly' } }) } }
const [suggest, home] = toolDefinitions(deps)

const [, , remind] = toolDefinitions(deps)
eq('the three tools are named', [suggest.name, home.name, remind.name], ['automation_suggest', 'automation_home', 'automation_remind'])
eq('a tool schema is strict', [suggest.parameters.additionalProperties, home.parameters.additionalProperties, remind.parameters.additionalProperties], [false, false, false])
eq('the chat is the agent\'s session, else the agent', [sessionOf({ agent: { session: { id: 's1' }, id: 'a1' } }), sessionOf({ agent: { id: 'a1' } }), sessionOf({}), sessionOf(null)], ['s1', 'a1', '', ''])

const res = await suggest.execute({ name: 'N', prompt: 'P', cron: '0 8 * * 1', timezone: 'Europe/Paris', needs: ['gmail'], proof: { n: 14, span: '60 days' } }, {})
eq('suggest asks the route to SUGGEST (never to create), with the schedule, the needs and the proof', JSON.stringify(calls[0]), JSON.stringify({ action: 'suggest', task: { name: 'N', prompt: 'P', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, needs: ['gmail'] }, proof: { n: 14, span: '60 days' } }))
eq('...and says it waits and is off', suggest.output.render({}, res)[0].text.includes('waits for the person') && suggest.output.render({}, res)[0].text.includes('OFF'), true)
await suggest.execute({ name: 'N2', prompt: 'P', cron: '0 9 * * *' }, {})
eq('no timezone, no needs, no proof: only what was given', JSON.stringify(calls[1]), JSON.stringify({ action: 'suggest', task: { name: 'N2', prompt: 'P', schedule: { mode: 'cron', cron: '0 9 * * *' } }, proof: null }))
eq('a refusal of the route is said in words', suggest.output.render({}, { ok: false, error: 'already exists' })[0].text, 'Not done: an automation with that name already exists.')

eq('home needs a chat: outside a turn it is refused', await home.execute({ task_id: 't1' }, {}), { ok: false, error: 'no chat' })
await home.execute({ task_id: 't1' }, { agent: { session: { id: 'sess-9' } } })
eq('home binds the id of the chat the engine says, not one the model writes', JSON.stringify(calls[2]), JSON.stringify({ action: 'bind-home', id: 't1', sessionId: 'sess-9' }))
eq('...and says the runs will happen in this chat', home.output.render({}, { ok: true, task: { name: 'Weekly' } })[0].text, 'Bound: the runs of “Weekly” will happen in this chat.')

// the reminder: the engine names the chat, the route decides
eq('a reminder needs a chat: outside a turn it is refused, and the route is not called', [await remind.execute({ message: 'Call', in_minutes: 5 }, {}), calls.length], [{ ok: false, error: 'no chat' }, 3])
await remind.execute({ message: 'Call', in_minutes: 5, name: 'N', at: '', timezone: '' }, { agent: { session: { id: 'sess-9' } } })
eq('remind hands the route the engine\'s chat id and the words, not a chat id of the model\'s', JSON.stringify(calls[3]), JSON.stringify({ action: 'remind', sessionId: 'sess-9', args: { message: 'Call', name: 'N', at: '', in_minutes: 5, timezone: '' } }))
eq('...and says what was set, in this chat, and that it has not run', remind.output.render({}, { ok: true, task: { name: 'Call the plumber', nextRun: '2026-11-03T22:07:00.000Z', schedule: { tz: 'Europe/Paris' } } })[0].text, 'Reminder set: “Call the plumber”, 3 Nov, 23:07, in this chat. It is one of the person\'s automations; it has not run yet.')
eq('a refusal of the route is said in words the agent can act on', remind.output.render({}, { ok: false, error: 'too far ahead' })[0].text, 'Not done: a reminder can be one year ahead at most.')
eq('the prompt names the tool, the refusal of schedule_create, and the one short sentence', PROMPT.includes('automation_remind') && PROMPT.includes('schedule_create is refused') && PROMPT.includes('one short sentence'), true)

// the two suggestion tools need the ledger
eq('without a ledger there are only the three automation tools', toolDefinitions(deps).length, 3)
const ledgerCalls = []
const withLedger = toolDefinitions(Object.assign({}, deps, { ledger: { add: async (kind, raw) => { ledgerCalls.push([kind, raw]); return raw.text.includes('@') ? { ok: false, error: 'personal data' } : { ok: true, item: { id: 's1' } } } } }))
eq('with it there are five', withLedger.map((t) => t.name), ['automation_suggest', 'automation_home', 'automation_remind', 'memory_suggest', 'instructions_suggest'])
const [, , , memory, instr] = withLedger
const m = await memory.execute({ text: 'Clients are private individuals', n: 14, span: '60 days', where: 'Gmail' }, {})
eq('memory_suggest hands the text and its proof to the ledger as a memory', JSON.stringify(ledgerCalls[0]), JSON.stringify(['memory', { text: 'Clients are private individuals', n: 14, span: '60 days', where: 'Gmail' }]))
eq('...and says it waits in Memory, not saved', memory.output.render({}, m)[0].text, 'Suggested: it waits for the person\'s Add in Memory. It is NOT saved yet.')
await instr.execute({ text: 'Write in French' }, {})
eq('instructions_suggest sends the text as an instructions suggestion', JSON.stringify(ledgerCalls[1]), JSON.stringify(['instructions', { text: 'Write in French' }]))
eq('...and says it waits in Custom instructions', instr.output.render({}, { ok: true })[0].text, 'Suggested: it waits for the person\'s Add in Custom instructions. It is NOT saved yet.')
eq('a text with an address is refused in words the agent can act on', memory.output.render({}, await memory.execute({ text: 'writes to a@b.co' }, {}))[0].text, 'Not done: the text contains an address, a phone number or a secret: write patterns, not people.')
eq('the prompt names both tools and the no-personal-data rule', PROMPT.includes('memory_suggest') && PROMPT.includes('instructions_suggest') && PROMPT.includes('Never put in a suggestion a name'), true)

// mounting: both parts guarded
const registered = []
const chunks = []
mountAutomationTools({ inject: (names, fn) => fn(names[0] === 'tools' ? { tools: { register: (t) => registered.push(t.name) } } : { systemPrompt: { context: (c) => chunks.push(c) } }) }, deps)
eq('the tools are registered', registered, ['automation_suggest', 'automation_home', 'automation_remind'])
eq('the prompt chunk is added once, literal, with the rules', [chunks.length, chunks[0].name, chunks[0].interpolate, chunks[0].text()], [1, CHUNK_NAME, false, PROMPT])
const logged = []
mountAutomationTools({ inject: () => { throw new Error('no seam') } }, deps, (m) => logged.push(m))
eq('a missing seam drops the part and logs, never throws', logged.length, 2)
mountAutomationTools({ inject: (names, fn) => fn({}) }, deps)
eq('a scope without a registry is ignored', true, true)
eq('the prompt says a suggestion is off and never to send alone', PROMPT.includes('switched off') && PROMPT.includes('never sends, deletes, pays or publishes'), true)

console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
