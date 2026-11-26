#!/usr/bin/env node
// Unit tests for quota-collectors.mjs (header parsing, reset durations, zero-cost local CLI collectors).
// Usage: node packages/kybernos-workers/test-quota-collectors.mjs

import assert from 'node:assert/strict'
import {
  collectAllQuotas,
  collectQuotaForInstance,
  parseNativePercentLines,
  parseRateLimitHeaders,
  parseResetTime
} from './quota-collectors.mjs'
import { createRuntimeState, recordQuotaUpdate } from './runtime-router.mjs'

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed += 1
  console.log('  ✓ ' + name)
}

const T0 = new Date('2026-11-25T20:00:00.000Z')

console.log('── reset time & header parsers ──')
await test('parseResetTime handles Go durations, relative seconds, epoch seconds, and ISO dates', () => {
  assert.equal(parseResetTime('2h30m', T0), '2026-11-25T22:30:00.000Z')
  assert.equal(parseResetTime('90', T0), '2026-11-25T20:01:30.000Z')
  assert.equal(parseResetTime(String(Math.floor(T0.getTime() / 1000) + 600), T0), '2026-11-25T20:10:00.000Z')
  assert.equal(parseResetTime('2026-11-26T00:00:00Z', T0), '2026-11-26T00:00:00.000Z')
  assert.equal(parseResetTime('', T0), null)
})

await test('parseRateLimitHeaders extracts Anthropic unified 5h/7d and standard x-ratelimit windows', () => {
  const anth = parseRateLimitHeaders({
    'Anthropic-Ratelimit-Unified-5h-Utilization': '0.34',
    'Anthropic-Ratelimit-Unified-5h-Reset': '2h36m',
    'Anthropic-Ratelimit-Unified-7d-Utilization': '0.42',
    'Anthropic-Ratelimit-Unified-7d-Reset': '6d5h'
  }, T0)
  assert.equal(anth.windows.length, 2)
  assert.equal(anth.windows[0].key, '5h')
  assert.equal(anth.windows[0].remainingPct, 66)
  assert.equal(anth.windows[1].key, 'weekly')
  assert.equal(anth.windows[1].remainingPct, 58)

  const oai = parseRateLimitHeaders({
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '91',
    'x-ratelimit-reset-requests': '45s',
    'retry-after': '120'
  }, T0)
  assert.equal(oai.windows[0].key, 'requests')
  assert.equal(oai.windows[0].remainingPct, 91)
  assert.equal(oai.cooldownUntil, '2026-11-25T20:02:00.000Z')
})

await test('parseNativePercentLines extracts explicit percentages without inventing unprinted windows', () => {
  const wins = parseNativePercentLines('Weekly limit remaining: 58%\nFive hour limit remaining: 66%\n')
  assert.equal(wins.length, 2)
  assert.equal(wins.find((w) => w.key === 'weekly').remainingPct, 58)
  assert.equal(wins.find((w) => w.key === '5h').remainingPct, 66)
  const used = parseNativePercentLines('Session usage: 80% used')
  assert.equal(used[0].remainingPct, 20)
  assert.equal(parseNativePercentLines('Logged in using ChatGPT').length, 0)
})

console.log('── zero-cost per-driver collectors ──')
await test('Codex, Claude, Antigravity, Gemini report honest billingMode and authRequired without calling LLMs', async () => {
  const io = {
    cleDansEnv: async (names) => names.includes('GEMINI_API_KEY'),
    executer: async (bin, args, opts) => {
      if (bin === 'codex' && args[0] === 'login') {
        assert.equal(opts.extraEnv?.CODEX_HOME, '~/.codex-work')
        return { code: 0, sortie: 'Logged in using ChatGPT\n' }
      }
      if (bin === 'claude' && args[0] === 'auth') {
        return { code: 0, sortie: JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' }) }
      }
      if (bin === 'agy' && args[0] === 'models') {
        return { code: 1, sortie: 'Error: Sign in required' }
      }
      return { code: 1, sortie: '' }
    }
  }

  const codex = await collectQuotaForInstance({ id: 'codex-work', driverId: 'codex', label: 'Codex Work', shadowHomePath: '~/.codex-work' }, { io, now: T0 })
  assert.equal(codex.billingMode, 'subscription')
  assert.equal(codex.authRequired, false)
  assert.equal(codex.windows.length, 0)

  const claude = await collectQuotaForInstance({ id: 'claude-main', driverId: 'claude-code', label: 'Claude Code' }, { io, now: T0 })
  assert.equal(claude.billingMode, 'subscription')
  assert.equal(claude.authRequired, false)

  const ag = await collectQuotaForInstance({ id: 'ag-miled', driverId: 'antigravity', label: 'antigravity-miled' }, { io, now: T0 })
  assert.equal(ag.authRequired, true)
  assert.match(ag.authMessage, /Sign in with Google to see Antigravity limits/i)

  const gem = await collectQuotaForInstance({ id: 'gemini-main', driverId: 'gemini', label: 'Gemini' }, { io, now: T0 })
  assert.equal(gem.billingMode, 'api-key')
  assert.equal(gem.authRequired, false)
})

await test('collectAllQuotas preserves existing header windows when CLI confirms auth without printing percentages', async () => {
  const runtime = createRuntimeState()
  recordQuotaUpdate(runtime, 'codex-work', {
    driverId: 'codex',
    label: 'Codex Work',
    billingMode: 'subscription',
    windows: [{ key: 'monthly', label: 'Monthly', remainingPct: 91, source: 'headers' }]
  }, T0)
  const harness = {
    instances: [
      { id: 'codex-work', driverId: 'codex', label: 'Codex Work', enabled: true },
      { id: 'ag-miled', driverId: 'antigravity', label: 'antigravity-miled', enabled: true }
    ]
  }
  const io = {
    executer: async (bin) => (bin === 'codex' ? { code: 0, sortie: 'Logged in using ChatGPT' } : { code: 1, sortie: 'not authenticated' })
  }
  const res = await collectAllQuotas({ harness, runtime, io, now: T0 })
  assert.equal(res.ok, true)
  assert.equal(res.probed, 2)
  assert.equal(runtime.quotas.get('codex-work').windows[0].remainingPct, 91)
  assert.equal(runtime.quotas.get('ag-miled').authRequired, true)
})

console.log(`\n${passed}/${passed} quota-collectors tests passed`)
