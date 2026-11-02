#!/usr/bin/env node
/** The chat Journal's story (journal-story.mjs): the pure derivation from one chat's durable events. Nothing invented, nothing worded: the page words what it gets.
 *  Usage: node packages/kybernos-plugin/test-journal-story.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { classifyTool, deriveStory } from './journal-story.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

let seq = 0
const T0 = 1_800_000_000_000
const ev = (type, at, data) => { seq += 1; return { type: type, seq: seq, time: T0 + at, data: data } }
const user = (at, text, source) => ev('user/message', at, { role: 'user', content: [{ type: 'text', text: text }], source: source })
const call = (at, callId, name, args) => ev('tool/call', at, { turn: 1, step: 1, callId: callId, name: name, arguments: JSON.stringify(args) })
const result = (at, callId, text, isError) => ev('tool/result', at, { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, source: { kind: 'tool', callId: callId }, content: [{ type: 'text', text: text }], isError: isError === true } })
const reply = (at, text, usage, provider, model) => ev('assistant/message', at, { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: text }], source: { kind: 'model', provider: provider, model: model } }, usage: usage })
const MIN = 60_000

// ── what a tool name is ─────────────────────────────────────────────────────────────────
assert.deepEqual(classifyTool('GMAIL_SEND_EMAIL').connector, { id: 'gmail', name: 'GMAIL', action: 'send email', via: 'composio' })
assert.equal(classifyTool('mcp__playwright-mcp__browser_navigate').connector.id, 'playwright-mcp')
assert.equal(classifyTool('mcp__playwright-mcp__browser_navigate').connector.action, 'navigate')
assert.equal(classifyTool('bash').group, 'command')
assert.equal(classifyTool('edit').group, 'edit')
assert.equal(classifyTool('skill').kind, 'skill')
assert.equal(classifyTool('memory_write').op, 'write')
assert.equal(classifyTool('memory_search').op, 'read')
assert.equal(classifyTool('ask_user_question').kind, 'handover')
assert.equal(classifyTool('workflow').kind, 'crew-call')
assert.equal(classifyTool(null).kind, 'work')
ok('a tool name is a connector (Composio or MCP), a command, a skill, a memory, a handover or plain work')

// ── a small chat: message, work, connector error then retry, handover, output, reply ────
const events = [
  ev('turn/start', 0, { turn: 1 }),
  ev('model/selection', 1, { provider: 'zai', model: 'glm-5.3' }),
  user(2, 'Send the offer to three recruiters', { kind: 'user' }),
  call(10, 'c1', 'bash', { command: 'ls' }), result(12, 'c1', 'a b'),
  call(13, 'c2', 'read', { path: '/x/offer.md' }), result(14, 'c2', 'text'),
  call(15, 'c3', 'edit', { path: '/x/offer.md' }), result(16, 'c3', 'Error: no match', true),
  call(20, 'c4', 'GMAIL_SEND_EMAIL', { to: 'a@b.c' }), result(21, 'c4', 'HTTP 429 rate limit', true),
  call(30, 'c5', 'GMAIL_SEND_EMAIL', { to: 'a@b.c' }), result(34, 'c5', 'Sent. See https://mail.google.com/mail/u/0/#sent/abc.'),
  call(40, 'c6', 'ask_user_question', { questions: [{ header: 'Go?', id: 'go', question: 'Send the offer?', options: [{ label: 'Send' }, { label: 'Cancel' }] }] }),
  result(40 + 4 * MIN, 'c6', JSON.stringify({ answers: [{ id: 'go', selected: ['Send'], custom: null }] })),
  call(5 * MIN, 'c7', 'skill', { name: 'contract-pack' }), result(5 * MIN + 2000, 'c7', '<skill_content name="contract-pack">…'),
  call(5 * MIN + 3000, 'c8', 'memory_write', { content: 'Offers go out on weekday mornings' }), result(5 * MIN + 3200, 'c8', 'Memory saved.'),
  call(5 * MIN + 4000, 'c9', 'present', { files: [{ path: '/x/offer.pdf', description: 'The offer' }] }), result(5 * MIN + 4100, 'c9', 'Presented /x/offer.pdf'),
  ev('deliverables/presented', 5 * MIN + 4100, { turn: 1, callId: 'c9', files: [{ path: '/x/offer.pdf', description: 'The offer' }] }),
  reply(5 * MIN + 5000, 'Done: three offers sent.', { inputTokens: 1000, outputTokens: 200, totalTokens: 1200, cacheReadTokens: 800 }, 'zai', 'glm-5.3'),
  ev('turn/end', 5 * MIN + 6000, { turn: 1, reason: { kind: 'completed' } }),
]
const costOf = (provider, model, usage) => (provider === 'zai' ? (usage.input + usage.output) / 1e6 : null)
const st = deriveStory(events, { sessionId: 'session-1', costOf: costOf, runs: [] })
const kinds = st.moments.map((m) => m.kind)
assert.deepEqual(kinds, ['model', 'message', 'work', 'connector', 'connector', 'handover', 'skill', 'memory', 'output', 'reply'])
ok('the moments come in order: the 3 plain tool calls fold into ONE work moment, the rest stay one each')

const work = st.moments[2]
assert.equal(work.total, 3)
assert.deepEqual(work.counts, { command: 1, edit: 1, read: 1, web: 0, crew: 0, other: 0 })
assert.equal(work.failed, 1)
assert.equal(work.items.length, 3)
assert.equal(work.items[1].target, '/x/offer.md')
ok('a work group counts its commands, files edited and read, and the calls that failed (a failed edit does not become an error of the chat)')

const [bad, good] = [st.moments[3], st.moments[4]]
assert.equal(bad.status, 'error')
assert.equal(bad.recovered, true)
assert.equal(good.status, 'ok')
assert.equal(good.durMs, 4)
assert.deepEqual(good.links, ['https://mail.google.com/mail/u/0/#sent/abc'])
assert.equal(st.stats.errors, 1)
assert.equal(st.stats.openErrors, 0)
ok('a connector call that failed and was repeated with success is « recovered »: counted as an error, not left open')

const ho = st.moments[5]
assert.equal(ho.source, 'question')
assert.equal(ho.text, 'Send the offer?')
assert.deepEqual(ho.options, ['Send', 'Cancel'])
assert.equal(ho.outcome, 'answered')
assert.equal(ho.waitMs, 4 * MIN)
assert.deepEqual(ho.answers[0].selected, ['Send'])
assert.deepEqual(ho.approvers, [{ who: null, role: null, device: null, state: 'answered', at: T0 + 40 + 4 * MIN, signed: false }])
assert.equal(st.stats.waitingMs, 4 * MIN)
ok('a handover keeps its question, its options, the answer and how long it waited; the approver is unnamed because the log does not say who')

assert.equal(st.moments[6].op, 'use')
assert.equal(st.moments[6].subject, 'contract-pack')
assert.equal(st.moments[7].op, 'write')
ok('a skill use and a memory write are moments of their own, with their subject')

assert.deepEqual(st.deliverables.map((d) => [d.kind, d.name]), [['link', 'mail.google.com'], ['file', 'offer.pdf']])
assert.equal(st.moments[8].files.length, 1)
ok('deliverables are the files presented (once, even when `present` and its event both say so) and the links a connector returned')

const lone = deriveStory([call(0, 'p', 'present', { files: [{ path: '/y/a.html', description: 'A' }] })], { sessionId: 's', runs: [] })
assert.deepEqual(lone.moments.map((m) => m.kind), ['output'])
assert.equal(lone.deliverables[0].name, 'a.html')
ok('a `present` call with no deliverables event still yields its output, once')

assert.equal(st.stats.tokens.input, 1000)
assert.equal(st.stats.tokens.cacheRead, 800)
assert.ok(Math.abs(st.stats.costEur - 0.0012) < 1e-9)
assert.equal(st.models[0].model, 'glm-5.3')
assert.equal(st.series.length, 1)
ok('tokens and cost come from the assistant messages, priced by the callback')

assert.equal(st.stats.activeMs, 5 * MIN + 6000)
ok('the active time is the time of the turns')

// ── an unpriced model is « unknown », never zero ─────────────────────────────────────────
const free = deriveStory([reply(1, 'hi', { inputTokens: 10, outputTokens: 5 }, 'mystery', 'x')], { sessionId: 's', costOf: costOf, runs: [] })
assert.equal(free.stats.costEur, null)
assert.equal(free.stats.unpriced, 1)
ok('a model with no price leaves the cost null (« — »), never 0')

// ── a chat left open for days did not run for days ───────────────────────────────────────
const idle = deriveStory([ev('turn/start', 0, {}), ev('turn/end', 2 * MIN, {}), ev('turn/start', 3 * 24 * 60 * MIN, {}), ev('turn/end', 3 * 24 * 60 * MIN + MIN, {})], { sessionId: 's', runs: [] })
assert.equal(idle.stats.activeMs, 3 * MIN)
const seed = deriveStory([ev('x/a', 0, {}), ev('x/b', MIN, {}), ev('x/c', 8 * 24 * 60 * MIN, {})], { sessionId: 's', runs: [] })
assert.equal(seed.stats.activeMs, MIN)
ok('days of silence are not counted as work (with turns, and without them: gaps over ten minutes are dropped)')

// ── a turn still open is running ─────────────────────────────────────────────────────────
const live = deriveStory([ev('turn/start', 0, {}), user(5, 'go', {})], { sessionId: 's', runs: [] })
assert.equal(live.chat.running, true)
assert.equal(st.chat.running, false)
ok('a turn with no end means the chat is running')

// ── a handover nobody has answered, and a permission decided ─────────────────────────────
const wait = deriveStory([call(0, 'q', 'ask_user_question', { questions: [{ question: 'Publish?' }] })], { sessionId: 's', runs: [] })
assert.equal(wait.moments[0].outcome, 'waiting')
assert.equal(wait.stats.handoversWaiting, 1)
const perm = deriveStory([
  ev('approval/asked', 0, { id: 'a1', toolName: 'mcp__playwright-mcp__browser_navigate', callId: 'k', reason: 'may change something outside this session' }),
  ev('approval/decided', 2000, { id: 'a1', outcome: 'allowed-once' }),
], { sessionId: 's', runs: [] })
assert.equal(perm.moments[0].source, 'permission')
assert.equal(perm.moments[0].outcome, 'allowed')
assert.equal(perm.moments[0].waitMs, 2000)
assert.equal(perm.moments[0].approvers[0].who, null)
const named = deriveStory([
  ev('approval/asked', 0, { id: 'a1', toolName: 'x', callId: 'k', reason: 'r' }),
  ev('approval/decided', 2000, { id: 'a1', outcome: 'allowed-once', by: 'Amira', device: 'MacBook Pro' }),
], { sessionId: 's', runs: [] })
assert.deepEqual([named.moments[0].approvers[0].who, named.moments[0].approvers[0].device], ['Amira', 'MacBook Pro'])
ok('an unanswered question is « waiting »; a permission keeps who and which computer decided when the log says so, and null when it does not')

const refused = deriveStory([call(0, 'q', 'ask_user_question', { questions: [{ question: 'Send?' }] }), result(10, 'q', JSON.stringify({ answers: [{ id: 'x', selected: ['Refuse'] }] }))], { sessionId: 's', runs: [] })
assert.equal(refused.moments[0].outcome, 'denied')
ok('a refusing answer is « denied »')

// ── crews come from the runs ─────────────────────────────────────────────────────────────
const runs = [
  { runId: 'r1', name: 'Research', startedAt: T0 + 1000, endedAt: T0 + 61000, stopReason: 'completed', declaredFrom: 'meta.phases', totals: { durationMs: 60000, failed: 0, tokens: 5000, costEur: 0.4 }, members: [{ label: 'Scout', phase: 'search', outcome: 'completed', durationMs: 30000, childId: 'ch1', actual: { provider: 'zai', model: 'glm-5.3', tokens: 3000, costEur: 0.25 } }] },
  { runId: 'r2', name: 'Build', startedAt: T0 + 30000, endedAt: null, totals: { durationMs: null, failed: 0 }, members: [] },
  { runId: 'r3', name: 'Broken', startedAt: T0 + 90000, endedAt: T0 + 100000, totals: { durationMs: 10000, failed: 1 }, members: [] },
]
const withCrews = deriveStory([user(0, 'go', {})], { sessionId: 's', runs: runs, costOf: costOf })
assert.deepEqual(withCrews.crews.map((c) => [c.name, c.state]), [['Research', 'done'], ['Build', 'running'], ['Broken', 'failed']])
assert.equal(withCrews.crews[0].members[0].model, 'glm-5.3')
assert.equal(withCrews.moments.filter((m) => m.kind === 'crew').length, 3)
assert.equal(withCrews.stats.errors, 1)
assert.ok(Math.abs(withCrews.stats.costEur - 0.4) < 1e-9)
assert.equal(withCrews.stats.tokens.crews, 5000)
ok('each run is a crew moment with its members, its real model and its cost; a failed run is an error of the chat')

// ── an automation chat, and garbage in the log ──────────────────────────────────────────
const auto = deriveStory([user(0, 'Tick', { kind: 'user', rpcId: 'kb-task-st-abc-1' }), user(MIN, 'Tick', { kind: 'user', rpcId: 'kb-task-st-abc-2' })], { sessionId: 's', runs: [] })
assert.deepEqual(auto.trigger, { kind: 'automation', rpcId: 'kb-task-st-abc-1' })
assert.equal(auto.moments.every((m) => m.automation === true), true)
const sys = deriveStory([user(0, '<system-reminder>be nice</system-reminder>', {}), user(1, 'real', {})], { sessionId: 's', runs: [] })
assert.equal(sys.moments.length, 1)
assert.equal(sys.chat.userMessage, 'real')
const junk = deriveStory([null, 7, 'x', { type: 'tool/call' }, { type: 'tool/result', data: {} }, ev('tool/call', 1, { name: null })], { sessionId: 's', runs: [] })
assert.equal(junk.moments.length, 0)
assert.equal(deriveStory(undefined, undefined).moments.length, 0)
ok('an automation chat says so; system reminders are not messages; malformed events are skipped without a throw')

// ── what the person said, and what only came in as a `user` message ─────────────────────
const ctx = deriveStory([
  user(0, 'Please plan the launch', { kind: 'user' }),
  user(1, 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.', { kind: 'runtime-context', form: 'snapshot' }),
  user(2, 'Time sampled while preparing turn 1, step 1: 2026-10-31T13:56:21+01:00', { kind: 'time-context', form: 'snapshot' }),
  user(3, 'background job bash-65bfb883 (bash: lsof -p 1) finished [status: completed]', { kind: 'tool-jobs' }),
  user(4, 'Background subagent 7a0d0681 finished.', { kind: 'subagent-settled' }),
  user(5, 'Thanks, and now the budget', {}),
  user(6, '[SCHEDULE REMINDER BATCH] This is a scheduled message from the user', { kind: 'schedule' }),
], { sessionId: 's', runs: [] })
const said = ctx.moments.filter((m) => m.kind === 'message')
assert.deepEqual(said.map((m) => m.text), ['Please plan the launch', 'Thanks, and now the budget', '[SCHEDULE REMINDER BATCH] This is a scheduled message from the user'])
assert.deepEqual(said.map((m) => m.automation), [false, false, true])
assert.equal(ctx.chat.messages, 3)
ok('the runtime context, the time sample, a finished job and a crew report are not the person\'s messages; a scheduled reminder is an automation tick')

// ── size: long texts are cut, a huge chat is capped ─────────────────────────────────────
const big = deriveStory([call(0, 'b', 'GMAIL_SEND_EMAIL', { body: 'x'.repeat(5000) }), result(1, 'b', 'y'.repeat(5000))], { sessionId: 's', runs: [] })
assert.ok(big.moments[0].input.length <= 800 && big.moments[0].output.length <= 800)
const many = []
for (let i = 0; i < 1500; i += 1) many.push(user(i, 'm' + i, {}))
const capped = deriveStory(many, { sessionId: 's', runs: [] })
assert.equal(capped.moments.length, 1200)
assert.equal(capped.droppedMoments, 300)
assert.equal(capped.moments[1199].text, 'm1499')
ok('texts are cut at 800 characters; a chat of 1500 moments keeps the latest 1200 and says it dropped 300')

console.log('\n' + pass + ' groups passed')
