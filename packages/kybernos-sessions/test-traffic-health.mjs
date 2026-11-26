// test-traffic-health.mjs — the free health verdict, and the rule that our own gateway is never pinged.
// Run: node packages/kybernos-sessions/test-traffic-health.mjs
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_EXCLUDED, excludedFrom, filterProbeable, providerOf, readTrafficFile, trafficHealth
} from './traffic-health.mjs'

let pass = 0
const fails = []
const ok = (label, cond) => { if (cond) { pass += 1 } else { fails.push(label) } }
const eq = (label, a, b) => ok(label + ' — ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b))

// ── who is never probed ─────────────────────────────────────────────────────────────────────────────────────────
eq('providerOf reads the route', providerOf('kybernos/gpt-6-luna'), 'kybernos')
eq('providerOf on a bare id', providerOf('gpt-6-luna'), '')
ok('our own gateway is excluded by default', DEFAULT_EXCLUDED.includes('kybernos'))
ok('an operator can extend the list', excludedFrom({ KB_NO_PROBE_PROVIDERS: 'zai-coding-cn, opencode-go ,' }).has('opencode-go'))
ok('an empty environment adds nothing', excludedFrom({}).size === 1)

{
  const { probe, skipped } = filterProbeable(
    ['kybernos/minimax-m3', 'opencode-go/deepseek-v4.1-flash', 'kybernos/gpt-6-luna', '', 42, 'xiaomi-token-plan-ams/mimo-v2.6-pro'],
    new Set(['kybernos'])
  )
  eq('the paid gateway is left alone', skipped.map((s) => s.cle), ['kybernos/minimax-m3', 'kybernos/gpt-6-luna'])
  eq('the others are still probed', probe, ['opencode-go/deepseek-v4.1-flash', 'xiaomi-token-plan-ams/mimo-v2.6-pro'])
  ok('the reason is said', skipped.every((s) => s.raison === 'exclu-kybernos'))
  eq('a shapeless entry is dropped, not thrown', filterProbeable([null, {}, 7], new Set()).probe, [])
}

// ── the verdict from real traffic ───────────────────────────────────────────────────────────────────────────────
{
  const now = 1_800_000_000_000
  const events = [
    { type: 'llm', kind: 'answer', at: now - 1000, provider: 'opencode-go', model: 'deepseek-v4.1-flash', input: 100, output: 10, cache: 900 },
    { type: 'llm', kind: 'answer', at: now - 500, provider: 'opencode-go', model: 'deepseek-v4.1-flash', input: 50, output: 5, cache: 0 },
    { type: 'llm', kind: 'answer', at: now - 800, provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.6-pro', input: 10, output: 1, cache: 0 },
    { type: 'llm', kind: 'retry', at: now - 100, provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.6-pro', error: 'RATE_LIMIT' },
    { type: 'llm', kind: 'retry', at: now - 2000, provider: 'zai-coding-cn', model: 'glm-5.3-flash', error: 'TIMEOUT' },
    { type: 'tool', kind: 'call', at: now - 100, tool: 'bash' },
    // outside the window: proves the cutoff
    { type: 'llm', kind: 'answer', at: now - 48 * 3600 * 1000, provider: 'old/model', model: 'gone', input: 1, output: 1, cache: 0 }
  ]
  const v = trafficHealth(events, { now })
  const byCle = Object.fromEntries(v.modeles.map((m) => [m.cle, m]))
  eq('a model that answered is ok, with its tokens', { state: byCle['opencode-go/deepseek-v4.1-flash'].state, calls: byCle['opencode-go/deepseek-v4.1-flash'].calls, tokens: byCle['opencode-go/deepseek-v4.1-flash'].tokens }, { state: 'ok', calls: 2, tokens: 1065 })
  eq('a retry after the last answer makes it suspect', byCle['xiaomi-token-plan-ams/mimo-v2.6-pro'].state, 'suspect')
  eq('a retry alone is suspect, not down', byCle['zai-coding-cn/glm-5.3-flash'].state, 'suspect')
  ok('a model outside the window is not counted', byCle['old/gone'] === undefined)
  eq('the counts add up', { total: v.total, sains: v.sains, suspects: v.suspects }, { total: 3, sains: 1, suspects: 2 })
  ok('silence is not a failure', v.tousEnEchec === false)
  eq('the window is reported', v.fenetreHeures, 24)
}

{
  const now = 1_800_000_000_000
  const empty = trafficHealth([], { now })
  eq('no traffic at all: nothing to accuse', { total: empty.total, sains: empty.sains, tousEnEchec: empty.tousEnEchec }, { total: 0, sains: 0, tousEnEchec: false })
  const onlyRetries = trafficHealth([
    { type: 'llm', kind: 'retry', at: now - 10, provider: 'p', model: 'm', error: 'SERVER' }
  ], { now })
  ok('every model suspect is a general failure', onlyRetries.tousEnEchec === true)
}

// ── reading the journal, tolerantly ─────────────────────────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'kb-trafic-'))
  try {
    const file = join(dir, 'events.jsonl')
    writeFileSync(file, '{"type":"llm","kind":"answer","at":1,"provider":"p","model":"m"}\n{"torn":')
    const rows = readTrafficFile(file, { readFile: (f) => readFileSync(f, 'utf8') })
    ok('a torn tail line is skipped, not fatal', rows.length === 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
  ok('a missing file is an empty read', readTrafficFile('/nope/never.jsonl', { readFile: () => { throw new Error('ENOENT') } }).length === 0)
  ok('a valid read keeps the last lines', readTrafficFile('x', { readFile: () => '{"a":1}\n{"b":2}\n{"c":3}', maxLines: 2 }).length === 2)
}

console.log((fails.length === 0 ? '✓ ' : '✗ ') + pass + ' passed' + (fails.length === 0 ? '' : ', ' + fails.length + ' failed'))
for (const f of fails) console.log('   ✗ ' + f)
process.exit(fails.length === 0 ? 0 : 1)
