// The agent tools of the automations: automation_suggest (a proposal that waits for Add) and automation_home (the runs happen in this chat).
import { toolDefinitions, mountAutomationTools, sessionOf, CHUNK_NAME, PROMPT } from './automation-tools.mjs'

let fails = 0
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label) }

const calls = []
const deps = { tasks: async (body) => { calls.push(body); return body.action === 'suggest' ? { ok: true, task: { name: body.task.name } } : (body.id === 'nope' ? { ok: false, error: 'task not found' } : { ok: true, task: { name: 'Weekly' } }) } }
const [suggest, home] = toolDefinitions(deps)

eq('the two tools are named', [suggest.name, home.name], ['automation_suggest', 'automation_home'])
eq('a tool schema is strict', [suggest.parameters.additionalProperties, home.parameters.additionalProperties], [false, false])
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

// mounting: both parts guarded
const registered = []
const chunks = []
mountAutomationTools({ inject: (names, fn) => fn(names[0] === 'tools' ? { tools: { register: (t) => registered.push(t.name) } } : { systemPrompt: { context: (c) => chunks.push(c) } }) }, deps)
eq('the tools are registered', registered, ['automation_suggest', 'automation_home'])
eq('the prompt chunk is added once, literal, with the rules', [chunks.length, chunks[0].name, chunks[0].interpolate, chunks[0].text()], [1, CHUNK_NAME, false, PROMPT])
const logged = []
mountAutomationTools({ inject: () => { throw new Error('no seam') } }, deps, (m) => logged.push(m))
eq('a missing seam drops the part and logs, never throws', logged.length, 2)
mountAutomationTools({ inject: (names, fn) => fn({}) }, deps)
eq('a scope without a registry is ignored', true, true)
eq('the prompt says a suggestion is off and never to send alone', PROMPT.includes('switched off') && PROMPT.includes('never sends, deletes, pays or publishes'), true)

console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
