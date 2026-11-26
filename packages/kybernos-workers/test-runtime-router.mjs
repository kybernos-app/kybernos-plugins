#!/usr/bin/env node
// Unit tests for runtime-router.mjs (quota tracking, deterministic smart routing,
// cache-friendly stable prefixes, handoff capsules, and 0600 bounded runs.json ledger).
// Usage: node packages/kybernos-workers/test-runtime-router.mjs

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_RUNS,
  buildHandoffCapsule,
  buildStableContextPacket,
  computeHeadroom,
  createRuntimeState,
  exportRuntimeStore,
  readRunsFile,
  recordQuotaUpdate,
  recordRateLimit,
  recordRunFinish,
  recordRunStart,
  runsPath,
  runtimeSnapshot,
  selectWorkerInstance,
  writeRunsFile
} from './runtime-router.mjs'

let passed = 0
const test = (name, fn) => {
  fn()
  passed += 1
  console.log('  ✓ ' + name)
}

const T0 = new Date('2026-11-25T18:00:00.000Z')
const harness = {
  version: 1,
  revision: 3,
  instances: [
    { id: 'codex-work', driverId: 'codex', label: 'Codex Work', enabled: true, active: true },
    { id: 'codex-personal', driverId: 'codex', label: 'Codex Personal', enabled: true, active: true },
    { id: 'claude-main', driverId: 'claude-code', label: 'Claude Code', enabled: true, active: true },
    { id: 'gemini-api', driverId: 'gemini', label: 'Gemini API', enabled: true, active: true },
    { id: 'ag-miled', driverId: 'antigravity', label: 'Antigravity', enabled: true, active: true }
  ],
  roleEngines: {
    coder: { workerId: 'kybernos', delegateWorkers: ['codex-work', 'codex-personal', 'claude-main', 'gemini-api'] }
  }
}

console.log('── quota & headroom ──')
test('computeHeadroom returns the tightest non-auth window and never invents numbers for auth-required', () => {
  const st = createRuntimeState()
  const q1 = recordQuotaUpdate(st, 'codex-work', {
    driverId: 'codex',
    billingMode: 'subscription',
    windows: [
      { key: '5h', label: '5h', remainingPct: 66, source: 'native' },
      { key: 'weekly', label: 'Weekly', remainingPct: 58, source: 'native' }
    ]
  }, T0)
  assert.equal(computeHeadroom(q1.quota), 58)
  const q2 = recordQuotaUpdate(st, 'ag-miled', {
    driverId: 'antigravity',
    authRequired: true,
    authMessage: 'Sign in with Google to see Antigravity limits.',
    windows: [{ key: 'weekly', label: 'Weekly', remainingPct: 90, source: 'auth-required' }]
  }, T0)
  assert.equal(q2.quota.windows[0].remainingPct, null)
  assert.equal(computeHeadroom(q2.quota), null)
})

console.log('── pinned vs smart routing ──')
test('pinned worker NEVER silently switches when exhausted or cooling down; returns suggested alternative', () => {
  const st = createRuntimeState()
  recordQuotaUpdate(st, 'claude-main', { billingMode: 'subscription', windows: [{ key: 'session', remainingPct: 0, source: 'native' }] }, T0)
  recordQuotaUpdate(st, 'codex-work', { billingMode: 'subscription', windows: [{ key: 'monthly', remainingPct: 91, source: 'native' }] }, T0)
  const res = selectWorkerInstance({ harness, runtime: st, requestedWorkerId: 'claude-main', includeBuiltin: false, now: T0 })
  assert.equal(res.ok, false)
  assert.equal(res.error, 'quota-exhausted')
  assert.equal(res.pinnedWorkerId, 'claude-main')
  assert.equal(res.suggestedAlternative, 'codex-work')
})

test('auto mode prefers cache-affinity when warm and headroom > 20%', () => {
  const st = createRuntimeState()
  recordQuotaUpdate(st, 'codex-work', { billingMode: 'subscription', windows: [{ key: '5h', remainingPct: 45, source: 'native' }] }, T0)
  recordQuotaUpdate(st, 'codex-personal', { billingMode: 'subscription', windows: [{ key: '5h', remainingPct: 95, source: 'native' }] }, T0)
  // Warm codex-work for (session-1, repo-a)
  const run = recordRunStart(st, { sessionId: 'session-1', workKey: 'repo-a', workerId: 'codex-work', driverId: 'codex', contextPrefixHash: 'abc123' }, T0)
  recordRunFinish(st, { runId: run.run.runId, status: 'ok', inputTokens: 10000, cacheReadTokens: 8500, outputTokens: 500 }, new Date(T0.getTime() + 5000))
  const pick = selectWorkerInstance({ harness, runtime: st, requestedWorkerId: 'auto', roleId: 'coder', sessionId: 'session-1', workKey: 'repo-a', includeBuiltin: false, now: new Date(T0.getTime() + 6000) })
  assert.equal(pick.ok, true)
  assert.equal(pick.selectedId, 'codex-work')
  assert.equal(pick.reason, 'cache-affinity')
})

test('auto mode leaves warm worker once headroom drops <= 20% and picks least-loaded / highest headroom', () => {
  const st = createRuntimeState()
  recordQuotaUpdate(st, 'codex-work', { billingMode: 'subscription', windows: [{ key: '5h', remainingPct: 18, source: 'native' }] }, T0)
  recordQuotaUpdate(st, 'codex-personal', { billingMode: 'subscription', windows: [{ key: '5h', remainingPct: 88, source: 'native' }] }, T0)
  recordQuotaUpdate(st, 'gemini-api', { billingMode: 'api-key', windows: [{ key: 'daily', remainingPct: 88, source: 'local-estimate' }] }, T0)
  const run = recordRunStart(st, { sessionId: 'session-1', workKey: 'repo-a', workerId: 'codex-work', driverId: 'codex' }, T0)
  recordRunFinish(st, { runId: run.run.runId, status: 'ok' }, new Date(T0.getTime() + 1000))
  const pick = selectWorkerInstance({ harness, runtime: st, requestedWorkerId: 'auto', roleId: 'coder', sessionId: 'session-1', workKey: 'repo-a', includeBuiltin: false, now: new Date(T0.getTime() + 2000) })
  assert.equal(pick.ok, true)
  // Both codex-personal (subscription) and gemini-api (api-key) have 88%, subscription wins!
  assert.equal(pick.selectedId, 'codex-personal')
})

test('429 rate-limit puts worker in cooldown and routes subsequent auto requests elsewhere', () => {
  const st = createRuntimeState()
  recordQuotaUpdate(st, 'codex-work', { billingMode: 'subscription', windows: [{ key: '5h', remainingPct: 90, source: 'native' }] }, T0)
  recordQuotaUpdate(st, 'codex-personal', { billingMode: 'subscription', windows: [{ key: '5h', remainingPct: 60, source: 'native' }] }, T0)
  recordRateLimit(st, { workerId: 'codex-work', cooldownSeconds: 300 }, T0)
  const pick = selectWorkerInstance({ harness, runtime: st, requestedWorkerId: 'auto', roleId: 'coder', includeBuiltin: false, now: new Date(T0.getTime() + 1000) })
  assert.equal(pick.ok, true)
  assert.equal(pick.selectedId, 'codex-personal')
})

test('least-loaded takes precedence over busy worker', () => {
  const st = createRuntimeState()
  recordQuotaUpdate(st, 'codex-work', { billingMode: 'subscription', maxParallel: 2, windows: [{ key: '5h', remainingPct: 95, source: 'native' }] }, T0)
  recordQuotaUpdate(st, 'codex-personal', { billingMode: 'subscription', maxParallel: 2, windows: [{ key: '5h', remainingPct: 70, source: 'native' }] }, T0)
  recordQuotaUpdate(st, 'claude-main', { billingMode: 'subscription', windows: [{ key: '5h', remainingPct: 10, source: 'native' }] }, T0)
  recordQuotaUpdate(st, 'gemini-api', { billingMode: 'api-key', windows: [{ key: '5h', remainingPct: 50, source: 'local-estimate' }] }, T0)
  recordRunStart(st, { workerId: 'codex-work', driverId: 'codex' }, T0)
  const pick = selectWorkerInstance({ harness, runtime: st, requestedWorkerId: 'auto', roleId: 'coder', includeBuiltin: false, now: T0 })
  assert.equal(pick.ok, true)
  assert.equal(pick.selectedId, 'codex-personal')
  assert.equal(pick.reason, 'least-loaded')
})

console.log('── cache-friendly stable prefix & handoff capsule ──')
test('buildStableContextPacket produces byte-identical static prefix hash across task deltas and file ordering', () => {
  const p1 = buildStableContextPacket({
    repoRules: 'No engine patches.\r\nEnglish only.',
    architecture: 'Plugin seam architecture.',
    pinnedFiles: [{ path: 'b.mjs', summary: 'B' }, { path: 'a.mjs', summary: 'A' }],
    taskDelta: 'Fix bug #1'
  })
  const p2 = buildStableContextPacket({
    repoRules: 'No engine patches.\nEnglish only.',
    architecture: 'Plugin seam architecture.',
    pinnedFiles: [{ path: 'a.mjs', summary: 'A' }, { path: 'b.mjs', summary: 'B' }],
    taskDelta: 'Fix bug #2 with different delta'
  })
  assert.equal(p1.prefixHash, p2.prefixHash)
  assert.equal(p1.staticPrefix, p2.staticPrefix)
  assert.notEqual(p1.fullPacket, p2.fullPacket)
  assert.ok(p1.fullPacket.endsWith('Fix bug #1'))
})

test('buildHandoffCapsule builds a compact deterministic summary for worker switching', () => {
  const h = buildHandoffCapsule({
    fromWorkerId: 'codex-work',
    toWorkerId: 'claude-main',
    goal: 'Finish Phase 2 tests',
    completedSteps: ['Created runtime-router.mjs'],
    modifiedFiles: ['b.mjs', 'a.mjs'],
    nextStep: 'Wire Journal integration'
  })
  assert.deepEqual(h.capsule.modifiedFiles, ['a.mjs', 'b.mjs'])
  assert.match(h.text, /\[HANDOFF codex-work -> claude-main\]/)
  assert.match(h.text, /Modified files: a\.mjs, b\.mjs/)
})

console.log('── 0600 bounded RunBinding ledger ──')
test('runs.json writes atomically with mode 0600, bounds to MAX_RUNS, and snapshots by session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-runs-'))
  try {
    const file = runsPath(dir)
    const st = createRuntimeState()
    for (let i = 0; i < MAX_RUNS + 15; i += 1) {
      const r = recordRunStart(st, { runId: 'r-' + i, sessionId: i % 2 === 0 ? 's-even' : 's-odd', workerId: 'codex-work', driverId: 'codex' }, T0)
      recordRunFinish(st, { runId: r.run.runId, status: 'ok', inputTokens: 1000, cacheReadTokens: 800, outputTokens: 100 }, new Date(T0.getTime() + 1000))
    }
    assert.equal(st.runs.length, MAX_RUNS)
    writeRunsFile(file, exportRuntimeStore(st, T0), T0)
    const mode = statSync(file).mode & 0o777
    assert.equal(mode, 0o600)
    const loaded = readRunsFile(file, T0)
    assert.equal(loaded.ok, true)
    assert.equal(loaded.store.runs.length, MAX_RUNS)
    assert.equal(loaded.store.runs[0].runId, 'r-15')
    assert.equal(loaded.store.runs[0].cacheHitPct, 80)

    const snap = runtimeSnapshot(createRuntimeState(loaded.store), { harness, sessionId: 's-even', now: T0 })
    assert.equal(snap.ok, true)
    assert.ok(snap.runs.every((r) => r.sessionId === 's-even'))
    assert.ok(snap.quotas.some((q) => q.workerId === 'codex-work'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

console.log(`\n${passed}/${passed} runtime-router tests passed`)
