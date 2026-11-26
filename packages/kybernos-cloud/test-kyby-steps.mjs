// What a task shows of its own work (kyby-steps.mjs): one line per call, a name and never a content, the team members numbered in the order they start (never named after a guess), a cap, and the lines read from a number on.
import assert from 'node:assert/strict'
import { MAX_STEPS, clean, createStepLog, describeCall } from './kyby-steps.mjs'

let checks = 0
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1 }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks += 1 }

// A line of text: no control character, collapsed, cut.
eq(clean('a\u0000b\n\tc  d', 20), 'a b c d', 'controls and runs of spaces become one space')
eq(clean('x'.repeat(500), 10), 'xxxxxxxxxx', 'cut at the limit')
eq(clean(42, 10), '', 'not a string is nothing')
eq(clean(String.fromCharCode(97, 8232, 98, 8233, 99), 10), 'a b c', 'the two line separators of Unicode are spaces too')

// A call becomes a name, never a content.
eq(describeCall('write', { file_path: '/home/node/maison/index.html', content: '<html>SECRET-TEXT</html>' }), { tool: 'write', label: 'index.html', path: '/home/node/maison/index.html' }, 'a file written: its name and path, never its text')
eq(describeCall('edit', { path: '/a/b/c.md', old_string: 'x', new_string: 'SECRET' }), { tool: 'edit', label: 'c.md', path: '/a/b/c.md' })
eq(describeCall('read', { file_path: '/etc/hosts' }), { tool: 'read', label: 'hosts' }, 'a file read: only its name, and no path')
eq(describeCall('bash', { command: 'curl -H "Authorization: Bearer sk-SECRET" https://x.example/y' }), { tool: 'bash', label: 'curl' }, 'a command: its first word only')
eq(describeCall('bash', { command: '/usr/bin/python3 -c "print(1)"' }), { tool: 'bash', label: 'python3' }, 'the program, not its folder')
eq(describeCall('bash', {}), { tool: 'bash', label: '' })
eq(describeCall('bash', { command: 'pwd; ls' }), { tool: 'bash', label: 'pwd' }, 'the first word, without the sign that ends it')
eq(describeCall('bash', { command: '(cd /x && ls)' }), { tool: 'bash', label: 'cd' }, 'a bracket is not part of a name')
eq(describeCall('skill', { name: 'webapp-brief' }), { tool: 'skill', label: 'webapp-brief' })
eq(describeCall('subagent', { description: 'Strategist: positioning brief', prompt: 'SECRET PROMPT' }), { tool: 'subagent', label: 'Strategist: positioning brief' }, 'a team member: its description, never its prompt')
eq(describeCall('create_image', { prompt: 'SECRET PROMPT', model: 'flux-klein', size: '1024x1024' }), { tool: 'create_image', label: 'flux-klein 1024x1024' }, 'a picture: the model and the size, never the prompt')
eq(describeCall('create_image', { prompt: 'x' }), { tool: 'create_image', label: '' })
eq(describeCall('connections_execute', { tool_slug: 'GMAIL_SEND_EMAIL', arguments: { to: 'a@b.c', body: 'SECRET' } }), { tool: 'connections_execute', label: 'GMAIL_SEND_EMAIL' }, 'an app action: its slug, never its arguments')
eq(describeCall('grep', { pattern: 'SECRET QUERY' }), { tool: 'grep', label: '' }, 'a search: no query')
eq(describeCall('web_fetch', { url: 'https://secret.example/?token=1' }), { tool: 'web_fetch', label: '' }, 'an address is never kept')
eq(describeCall('Weird Name!', {}), { tool: 'tool', label: '' }, 'a name that is not a code is « tool »')
eq(describeCall('mcp__Gmail__Send', {}).tool, 'mcp__gmail__send', 'lower case')
ok(JSON.stringify(describeCall('write', { file_path: '/p/' + 'x'.repeat(900), content: 'SECRET' })).length < 400, 'a path is cut')

// The log: Kaby's own calls, then a team. A member is « Agent n », whatever descriptions were given: which description a session was made for is not known.
const log = createStepLog()
const ROOT = 's-root'
eq(log.note(ROOT, ROOT, 'skill', { name: 'webapp-brief' }), { agent: 0, who: 'Kaby', tool: 'skill', label: 'webapp-brief' })
eq(log.note(undefined, ROOT, 'read', { file_path: '/x/y.md' }).who, 'Kaby', 'no agent id is the task itself')
log.note(ROOT, ROOT, 'subagent', { description: 'Strategist' })
log.note(ROOT, ROOT, 'subagent', { description: 'Copywriter' })
log.note(ROOT, ROOT, 'subagent', { description: 'Designer' })
eq(log.note('child-1', ROOT, 'write', { file_path: '/w/brief.md' }), { agent: 1, who: 'Agent 1', tool: 'write', label: 'brief.md', path: '/w/brief.md' }, 'the first agent that makes a call is Agent 1, not the first description given')
eq(log.note('child-2', ROOT, 'bash', { command: 'ls' }).who, 'Agent 2')
eq(log.note('child-1', ROOT, 'read', { file_path: '/w/brief.md' }).who, 'Agent 1', 'an agent keeps its number')
eq(log.note('child-3', ROOT, 'create_image', { model: 'flux-klein', size: '1024x1024' }).who, 'Agent 3')
eq(log.note('child-4', ROOT, 'bash', { command: 'ls' }).who, 'Agent 4')
eq(log.note('child-4', ROOT, 'bash', { command: 'ls' }).agent, 4)
eq(log.since(0).steps.filter((s) => s.tool === 'subagent').map((s) => s.label), ['Strategist', 'Copywriter', 'Designer'], 'the team the task was given is in its own subagent lines')

// What says nothing about the work is no line.
for (const quiet of ['todo_write', 'wait_agent', 'list_agents', 'send_message', 'ask_user_question']) eq(log.note(ROOT, ROOT, quiet, {}), null, quiet + ' is no line')

// Reading from a number on.
const all = log.since(0)
eq(all.total, 11, 'eleven lines were noted')
eq(all.steps.length, 11)
eq(log.since(9).steps.map((s) => s.who), ['Agent 4', 'Agent 4'], 'from line 9 on')
eq(log.since(11).steps, [], 'nothing new')
eq(log.since(-3).steps.length, 11, 'a number that makes no sense reads from the start')
eq(log.since('x').steps.length, 11)

// The cap: the next lines are counted, not kept.
const small = createStepLog()
for (let i = 0; i < MAX_STEPS + 25; i += 1) small.note(ROOT, ROOT, 'bash', { command: 'echo ' + i })
const capped = small.since(0)
eq(capped.total, MAX_STEPS)
eq(capped.dropped, 25)

// The roster of agents is bounded.
const many = createStepLog()
for (let i = 1; i <= 45; i += 1) many.note('c' + i, ROOT, 'bash', { command: 'ls' })
eq(many.note('c45', ROOT, 'bash', { command: 'ls' }).who, 'Agent 45', 'the agent that was last seen is still known')

console.log(`kyby-steps: ${checks} ok`)
