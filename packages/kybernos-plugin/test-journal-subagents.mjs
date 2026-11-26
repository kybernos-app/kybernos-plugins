#!/usr/bin/env node
/** The sub-agents of a chat in the Journal (journal-subagents.mjs): found by the header of their own session logs, counted as one crew with their real models, tokens and cost.
 *  Usage: node packages/kybernos-plugin/test-journal-subagents.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { deriveStory } from './journal-story.mjs'
import { bareId, childStory, findSubagentChildren, headerOf, subagentRun } from './journal-subagents.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const T0 = 1_800_000_000_000
const MIN = 60_000
const root = mkdtempSync(join(tmpdir(), 'kb-subagents-'))
try {
  // A log is written the way the engine writes it: the header in a first frame, the events in the next ones.
  const write = (ws, id, header, lines, mtimeMs) => {
    const dir = join(root, ws, id)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'session.v4.jsonl.zstd')
    const frames = [zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session', version: 4, id: id, createdAt: header.createdAt, ...header }) + '\n'))]
    for (const l of lines) frames.push(zstdCompressSync(Buffer.from(l.map((e) => JSON.stringify(e)).join('\n') + '\n')))
    writeFileSync(file, Buffer.concat(frames))
    const at = new Date(mtimeMs)
    utimesSync(file, at, at)
    return file
  }
  const descriptor = (at, label, provider, model) => ({ type: 'subagent/descriptor', seq: 0, time: T0 + at, data: { version: 3, mode: 'continuable', provider: 'spawn', label: label, agentProvider: provider, agentModel: model } })
  const turn = (type, at) => ({ type: type, seq: 1, time: T0 + at, data: { turn: 1 } })

  const CHAT = '11111111-1111-4111-8111-111111111111'
  write('ws', CHAT, { createdAt: T0 }, [[turn('turn/start', 0)]], T0 + 30 * MIN)
  // Two sub-agents of the chat (one names it with the `session-` prefix, the engine writes both forms), one of them started a third.
  const A = '22222222-2222-4222-8222-222222222222'
  const B = '33333333-3333-4333-8333-333333333333'
  const C = '44444444-4444-4444-8444-444444444444'
  write('ws', A, { createdAt: T0 + MIN, parentSession: 'session-' + CHAT, origin: 'subagent', delegationDepth: 1, agentPreset: 'standard' }, [[descriptor(MIN, 'Researcher', 'zai', 'glm-5.3'), turn('turn/start', MIN + 1), turn('turn/end', 6 * MIN)]], T0 + 6 * MIN)
  write('ws', B, { createdAt: T0 + 2 * MIN, parentSession: CHAT, origin: 'subagent', delegationDepth: 1, agentPreset: 'standard' }, [[descriptor(2 * MIN, 'Writer', 'openai', 'gpt-x'), turn('turn/start', 2 * MIN + 1)]], T0 + 3 * MIN)
  write('ws', C, { createdAt: T0 + 3 * MIN, parentSession: A, origin: 'subagent', delegationDepth: 2, agentPreset: 'standard' }, [[descriptor(3 * MIN, 'Checker', 'zai', 'glm-5.3'), turn('turn/end', 4 * MIN)]], T0 + 4 * MIN)
  // Not ours: a sub-agent of another chat, a session of its own, and an old child that cannot belong to this chat (written before it started).
  write('ws', '55555555-5555-4555-8555-555555555555', { createdAt: T0 + MIN, parentSession: '99999999-9999-4999-8999-999999999999', origin: 'subagent', delegationDepth: 1 }, [[descriptor(MIN, 'Other', 'zai', 'glm-5.3')]], T0 + 5 * MIN)
  write('ws2', '66666666-6666-4666-8666-666666666666', { createdAt: T0 - 3600_000 * 5, parentSession: CHAT, origin: 'subagent', delegationDepth: 1 }, [[descriptor(0, 'Stale', 'zai', 'glm-5.3')]], T0 - 3600_000 * 5)
  // A log that is not a log.
  mkdirSync(join(root, 'ws', 'junk'), { recursive: true })
  writeFileSync(join(root, 'ws', 'junk', 'session.v4.jsonl.zstd'), 'not zstd')

  assert.equal(bareId('session-abc'), 'abc')
  assert.equal(bareId('abc'), 'abc')
  assert.equal(bareId(''), null)
  assert.equal(headerOf(join(root, 'ws', A, 'session.v4.jsonl.zstd')).parentSession, 'session-' + CHAT)
  assert.equal(headerOf(join(root, 'ws', 'junk', 'session.v4.jsonl.zstd')), null)
  ok('the header is read from the first frame of a log; a file that is not a log gives null')

  const kids = findSubagentChildren(root, 'session-' + CHAT, { since: T0 })
  assert.deepEqual(kids.map((k) => [k.id, k.depth]), [[A, 1], [B, 1], [C, 2]])
  assert.equal(kids.some((k) => k.id === '55555555-5555-4555-8555-555555555555'), false)
  assert.equal(kids.some((k) => k.id === '66666666-6666-4666-8666-666666666666'), false)
  ok('the sub-agents of a chat are found with or without the `session-` prefix, a nested one at depth 2; another chat\'s, and one older than the chat, are not')

  assert.deepEqual(findSubagentChildren(root, CHAT, { since: T0, exclude: [B] }).map((k) => k.id), [A, C])
  assert.deepEqual(findSubagentChildren(root, 'nobody', { since: T0 }), [])
  assert.deepEqual(findSubagentChildren(join(root, 'absent'), CHAT, {}), [])
  ok('a child already counted elsewhere is left out; an unknown chat and a missing folder give nothing')

  // What the Journal gets of each one.
  const evs = (at, label, provider, model, end) => [descriptor(at, label, provider, model), turn('turn/start', at + 1)].concat(end === true ? [turn('turn/end', at + 5 * MIN)] : [])
  const done = childStory(evs(MIN, 'Researcher', 'zai', 'glm-5.3', true))
  assert.deepEqual([done.label, done.provider, done.model, done.finished, done.endedAt - done.startedAt], ['Researcher', 'zai', 'glm-5.3', true, 5 * MIN])
  assert.equal(childStory(evs(MIN, 'Writer', 'openai', 'gpt-x', false)).finished, false)
  assert.deepEqual(childStory([]), { label: null, provider: null, model: null, startedAt: null, endedAt: null, finished: false })
  ok('a child\'s story: who it was, when, whether it finished; an empty log says nothing')

  // The crew: real tokens and cost add up; a child with no readable fact still shows the model it was started on and counts nothing.
  const rows = [
    { id: A, depth: 1, story: done, fact: { provider: 'zai', model: 'glm-5.3', tokens: 1000, usage: { input: 800, output: 200, cacheRead: 0, cacheWrite: 0 }, costEur: 0.01, source: 'sessionLog.requestContext' } },
    { id: C, depth: 2, story: childStory(evs(3 * MIN, 'Checker', 'zai', 'glm-5.3', true)), fact: { provider: 'zai', model: 'glm-5.3', tokens: 500, usage: null, costEur: 0.005, source: 'sessionLog.requestContext' } },
    { id: B, depth: 1, story: childStory(evs(2 * MIN, 'Writer', 'openai', 'gpt-x', false)), fact: null },
  ]
  const run = subagentRun(rows, T0 + 60 * MIN)
  assert.equal(run.runId, 'subagents')
  assert.equal(run.members.length, 3)
  assert.equal(run.totals.tokens, 1500)
  assert.ok(Math.abs(run.totals.costEur - 0.015) < 1e-9)
  assert.equal(run.totals.completed, 2)
  assert.equal(run.members[1].phase, 'level 2')
  assert.deepEqual([run.members[2].actual.provider, run.members[2].actual.model, run.members[2].actual.tokens, run.members[2].actual.costEur], ['openai', 'gpt-x', null, null])
  assert.equal(run.members[2].outcome, null)
  assert.equal(run.endedAt, T0 + 8 * MIN)  // the Writer stopped writing long ago: the crew is over, not « running »
  assert.equal(subagentRun(rows, T0 + 3 * MIN + 30_000).endedAt, null)  // 90 s after the Writer's last line: still running
  assert.equal(subagentRun([], T0), null)
  ok('the crew adds the real tokens and cost; an unreadable child keeps its model and counts nothing; a child silent for ten minutes is not running')

  // And the story takes it like any crew: members, models, the tokens and the cost of the chat.
  const story = deriveStory([turn('turn/start', 0), turn('turn/end', 10 * MIN)], { sessionId: 's', runs: [run], costOf: () => null })
  assert.equal(story.crews.length, 1)
  assert.equal(story.crews[0].name, 'Sub-agents')
  assert.deepEqual(story.crews[0].members.map((m) => [m.label, m.model]), [['Researcher', 'glm-5.3'], ['Checker', 'glm-5.3'], ['Writer', 'gpt-x']])
  assert.equal(story.stats.tokens.crews, 1500)
  assert.ok(Math.abs(story.stats.costEur - 0.015) < 1e-9)
  ok('the Journal story shows the sub-agents as a crew and adds their tokens and cost to the chat\'s')

  console.log('\n' + pass + ' checks passed')
} finally {
  rmSync(root, { recursive: true, force: true })
}
