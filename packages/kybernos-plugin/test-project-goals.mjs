#!/usr/bin/env node
/** The Goals tab of a project shows the goals the engine kept in the session logs (2026-10-23), not only those of agents running in this DSH.
 *   - goalFromEvents reads the `goal/change` events (snapshots, `clear` tombstones) and counts the rounds the goal started;
 *   - the project-data route adds the saved goals of the project's sessions to the live ones, once per session, from a cache keyed by the log's size.
 *  Usage: node packages/kybernos-plugin/test-project-goals.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { goalFromEvents, sortGoals, GOAL_TEXT_MAX } from './project-goals.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const change = (goal, extra) => ({ type: 'goal/change', data: Object.assign({ kind: 'goal/change', version: 1, operation: 'create', goal: goal, roundsStarted: 0, createdAt: 1000, updatedAt: 1000 }, extra) })
const snap = (extra) => Object.assign({ id: 'g1', revision: 1, objective: 'Ship the beta', phase: 'active', maxGoalRounds: 8 }, extra)
const round = (goalId, n) => ({ type: 'user/message', data: { source: { kind: 'goal', goalId: goalId, revision: 1, round: n } } })

// ── the pure reader ──────────────────────────────────────────────────────────────────────────────
assert.equal(goalFromEvents([]), null)
assert.equal(goalFromEvents(null), null)
assert.equal(goalFromEvents([{ type: 'user/message', data: { source: { kind: 'user' } } }]), null)
ok('no goal event: no goal')

let g = goalFromEvents([change(snap()), round('g1', 1), round('g1', 2)])
assert.deepEqual(g, { id: 'g1', objective: 'Ship the beta', phase: 'active', roundsStarted: 2, maxGoalRounds: 8, blockedReason: null, createdAt: 1000, updatedAt: 1000 })
ok('a goal and the rounds it started')

g = goalFromEvents([change(snap()), round('g1', 1), round('g1', 3), round('other', 2), { type: 'user/message', data: { source: { kind: 'user' } } }])
assert.equal(g.roundsStarted, 1)
ok('only the next round of the current goal counts (a gap, another goal or a human message do not)')

g = goalFromEvents([change(snap()), change(snap({ revision: 2, objective: 'Ship the beta and the docs', phase: 'paused' }), { operation: 'edit', roundsStarted: 2, updatedAt: 3000 })])
assert.equal(g.objective, 'Ship the beta and the docs')
assert.equal(g.phase, 'paused')
assert.equal(g.roundsStarted, 2)
assert.equal(g.updatedAt, 3000)
ok('the last snapshot wins')

g = goalFromEvents([change(snap({ phase: 'blocked', blockedReason: { code: 'provider-limit', message: 'The provider refused: quota reached' } }))])
assert.equal(g.phase, 'blocked')
assert.equal(g.blockedReason, 'The provider refused: quota reached')
g = goalFromEvents([change(snap({ phase: 'complete' }))])
assert.equal(g.phase, 'complete')
assert.equal(g.blockedReason, null)
ok('a blocked goal says why, a completed one is kept')

g = goalFromEvents([change(snap()), { type: 'goal/change', data: { kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'g1', revision: 1 }, clearedAt: 2000 } }])
assert.equal(g, null)
g = goalFromEvents([change(snap()), { type: 'goal/change', data: { kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'g1', revision: 1 }, clearedAt: 2000 } }, change(snap({ id: 'g2', objective: 'Another one' }), { createdAt: 5000, updatedAt: 5000 })])
assert.equal(g.id, 'g2')
assert.equal(g.roundsStarted, 0)
ok('a cleared goal is gone, and a new one after it starts from zero')

assert.equal(goalFromEvents([change(snap({ objective: '   ' }))]), null)
assert.equal(goalFromEvents([change(snap({ phase: 'nonsense' }))]), null)
assert.equal(goalFromEvents([change(snap({ id: '' }))]), null)
assert.equal(goalFromEvents([{ type: 'goal/change', data: { kind: 'other' } }, { type: 'goal/change' }, null, 'x', { type: 'goal/change', data: { kind: 'goal/change', operation: 'create', goal: null } }]), null)
g = goalFromEvents([change(snap()), change(snap({ revision: 2, phase: 'nonsense' }), { operation: 'edit' })])
assert.equal(g.revision, undefined)
assert.equal(g.objective, 'Ship the beta')
ok('a record it does not understand is skipped, never a failure, and never replaces a good goal')

assert.equal(goalFromEvents([change(snap({ objective: 'x'.repeat(2000) }))]).objective.length, GOAL_TEXT_MAX)
ok('a long objective is cut')

const order = sortGoals([
  { phase: 'complete', updatedAt: 9 }, { phase: 'paused', updatedAt: 5 }, { phase: 'active', updatedAt: 1 }, { phase: 'blocked', updatedAt: 3 }, { phase: 'active', updatedAt: 7 }, { phase: 'active', updatedAt: null },
])
assert.deepEqual(order.map((x) => x.phase + ':' + x.updatedAt), ['active:7', 'active:1', 'active:null', 'blocked:3', 'paused:5', 'complete:9'])
assert.deepEqual(sortGoals([{ phase: 'active', updatedAt: 9 }, { phase: 'active', updatedAt: null, live: true }]).map((x) => x.live === true), [true, false])
ok('active first, then blocked, paused, complete; the latest change first')

// ── the tab, in the source ───────────────────────────────────────────────────────────────────────
{
  const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  const i = client.indexOf("if (tab === kbt('kbui.objectifs')) {\n          // The goals of the project's chats")
  const j = client.indexOf("if (tab === 'Deliverables') {", i)
  assert.ok(i > 0 && j > i, 'the Goals tab was found')
  const tab = client.slice(i, j)
  assert.ok(tab.includes('Type /goal followed by what you want done') && tab.includes('Tape /goal suivi de ce que tu veux obtenir'))
  assert.ok(tab.includes("'data-kb': 'project-goals-empty'") || tab.includes("kb: 'project-goals-empty'"))
  ok('the empty state says how to set a goal: /goal, in a chat of the project')
  for (const hook of ['project-goal-row', 'project-goal-phase', 'project-goal-blocked', 'openSession(g.sessionId)']) assert.ok(tab.includes(hook), hook)
  assert.ok(tab.includes("word: kbe('Blocked'") && tab.includes("word: kbe('Done'") && tab.includes("word: kbe('Paused'") && tab.includes("word: kbe('Active'"))
  ok('a goal row says its phase, why it is blocked, which chat it is in, and opens that chat')
  assert.ok(client.includes("React.useEffect(() => { if (tab === kbt('kbui.objectifs')) kbProjRefresh(projSidKey, projSids) }, [tab, projSidKey])"))
  assert.ok(/const kbProjRefresh = \(key, sids\) => \{[^]*kbProjCache\[key\] = res; kbBumpProj\(\)/.test(client))
  ok('opening the Goals tab asks the host again, keeping the old answer on screen until the new one lands')
}

// ── the route, through the real apply() ──────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'kb-goals-'))
const copy = join(scratch, 'plugin')
mkdirSync(copy, { recursive: true })
for (const file of readdirSync(here)) {
  if (file === 'client.js' || file.startsWith('test-') || statSync(join(here, file)).isFile() === false) continue
  copyFileSync(join(here, file), join(copy, file))
}
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DSH_HOME: process.env.DSH_HOME }
process.env.HOME = join(scratch, 'home')
process.env.USERPROFILE = process.env.HOME
process.env.DSH_HOME = join(scratch, 'dsh')
mkdirSync(process.env.DSH_HOME, { recursive: true })
const disposers = []
try {
  const mod = await import(pathToFileURL(join(copy, 'index.js')).href)
  const fillers = Array.from({ length: 12 }, (_, i) => 'session-fill-' + i)
  const logs = {
    'session-live': [change(snap({ id: 'old', objective: 'Stale saved goal' }))],
    'session-saved': [change(snap({ objective: 'Migrate the billing' })), round('g1', 1)],
    'session-cleared': [change(snap()), { type: 'goal/change', data: { kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'g1', revision: 1 }, clearedAt: 2 } }],
    'session-none': [{ type: 'user/message', data: { source: { kind: 'user' } } }],
    'session-sub': [change(snap({ objective: 'A sub-agent inherited goal' }))],
    'session-bad': null,
    'session-huge': [change(snap({ objective: 'Too big to read' }))],
    'session-late': [change(snap({ id: 'late', objective: 'Late in the list', phase: 'blocked', blockedReason: { code: 'x-y', message: 'Waiting for a key' } }), { updatedAt: 4000 })],
  }
  for (const f of fillers) logs[f] = []
  const sizes = { 'session-huge': 64 * 1024 * 1024 }
  const headers = { 'session-sub': { delegationDepth: 1 } }
  const opened = []
  const persistence = {
    stat: async (id) => ({ size: sizes[id] === undefined ? 1000 : sizes[id] }),
    open: async (id) => {
      opened.push(id)
      if (logs[id] === null || logs[id] === undefined) throw new Error('unreadable')
      return { header: headers[id] || {}, read: async () => ({ events: logs[id] }), close: async () => {} }
    },
  }
  const liveView = { objective: 'Running now', phase: 'active', roundsStarted: 3, maxGoalRounds: 10 }
  const agents = { get: (sid) => (sid === 'session-live' ? { id: sid } : null), currentInitiator: () => null }
  const goals = { get: (agent) => (agent !== null && agent.id === 'session-live' ? liveView : null) }
  const registered = {}
  const webServer = { register: (r) => { registered[r.path] = r.handler; return () => { delete registered[r.path] } } }
  const services = { fs: {}, webServer, sessionPersistence: persistence, agents, goals }
  mod.apply({ get: (n) => services[n], inject: () => {}, effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d }, on: () => {} })

  const PORT = 3080
  const post = async (sessionIds) => {
    const handler = registered['/kybernos/project-data']
    assert.ok(handler !== undefined, 'the route is registered')
    const res = { code: 0, raw: null, writeHead (c) { this.code = c }, end (p) { this.raw = p === undefined ? null : String(p) } }
    const body = JSON.stringify({ sessionIds: sessionIds })
    await handler({ method: 'POST', url: '/kybernos/project-data', headers: { origin: 'http://127.0.0.1:' + PORT, host: '127.0.0.1:' + PORT, 'content-type': 'application/json' }, socket: { localPort: PORT }, async *[Symbol.asyncIterator] () { yield Buffer.from(body) } }, res)
    return JSON.parse(res.raw)
  }

  const ids = ['session-live', 'session-saved', 'session-cleared', 'session-none', 'session-sub', 'session-bad', 'session-huge'].concat(fillers.slice(0, 5)).concat(['session-late'])
  assert.ok(ids.indexOf('session-late') >= 12, 'the late session is past the 12 the documents pass reads')
  let r = await post(ids)
  assert.equal(r.ok, true)
  const bySession = {}
  for (const x of r.goals) bySession[x.sessionId] = x
  assert.deepEqual(Object.keys(bySession).sort(), ['session-late', 'session-live', 'session-saved'])
  ok('the route lists the live goal and the saved goals; cleared, none, sub-agent, unreadable and oversized sessions give none')
  assert.equal(bySession['session-live'].objective, 'Running now')
  assert.equal(bySession['session-live'].live, true)
  assert.equal(r.goals.filter((x) => x.sessionId === 'session-live').length, 1)
  ok('a goal the running DSH knows is the live one, not the old saved copy')
  assert.equal(bySession['session-saved'].objective, 'Migrate the billing')
  assert.equal(bySession['session-saved'].roundsStarted, 1)
  assert.equal(bySession['session-saved'].maxGoalRounds, 8)
  assert.equal(bySession['session-saved'].live, false)
  assert.equal(bySession['session-late'].phase, 'blocked')
  assert.equal(bySession['session-late'].blockedReason, 'Waiting for a key')
  assert.equal(bySession['session-late'].updatedAt, 4000)
  ok('a saved goal carries its phase, rounds, blocker and date')
  assert.deepEqual(r.goals.map((x) => x.sessionId), ['session-live', 'session-saved', 'session-late'])
  ok('active goals first, then the blocked one')
  assert.ok(r.warnings.some((w) => w.indexOf('goal unreadable') >= 0))
  ok('an unreadable log is noted, not fatal')

  assert.equal(opened.filter((x) => x === 'session-late').length, 1)
  opened.length = 0
  r = await post(ids)
  assert.equal(opened.indexOf('session-late'), -1, 'the late session is not read again while its log has the same size')
  assert.equal(r.goals.some((x) => x.sessionId === 'session-late'), true)
  sizes['session-late'] = 2000
  logs['session-late'] = [change(snap({ id: 'late', objective: 'Late, now done', phase: 'complete' }), { updatedAt: 6000 })]
  r = await post(ids)
  assert.equal(opened.filter((x) => x === 'session-late').length, 1)
  assert.equal(r.goals.find((x) => x.sessionId === 'session-late').objective, 'Late, now done')
  ok('a log that did not grow is not read again; one that grew is')
} finally {
  for (const d of disposers) { try { d() } catch (e) { /* best effort */ } }
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  rmSync(scratch, { recursive: true, force: true })
}
console.log('\n' + pass + ' verifications OK')
// The plugin may leave timers running (bridge tick, trim): the test is over.
process.exit(0)
