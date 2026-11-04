#!/usr/bin/env node
// Cases J10-02 (models) of docs/tests/user-journey, and the base of J08-02, J11-06 and J12-07: what a call costs, recomputed by hand from the price of the model, and compared with every place the server says it.
// The expected value comes from the model's price (the replica's stand-in model « glm »: 0.50 USD per million tokens in, 2.00 out), never from the screen. The places compared: what the call itself reports (usage),
// the usage rows of the workspace (`GET /llm/usage`), the credit balance of the workspace (`GET /plan`, the welcome credit being spent) and the budget window (`GET /llm/budget`).
//
//   node scripts/audit-consumption.mjs --scenario models --api http://localhost:8841 --control http://127.0.0.1:8842 [--price-in 0.50 --price-out 2.00]
//
// The replica must give a new person a welcome credit (`node scripts/replica-owner-settings.mjs ... welcome_credit_cents=2000`, or `bash scripts/user-journey-acceptance.sh --keep`). Loopback only.
// Exit 0 when every place agrees to the nano-dollar, 1 otherwise, 2 on a refusal.
import { pathToFileURL } from 'node:url'
import { isLoopback } from './replica-owner-settings.mjs'
import { makeClient, signUp } from './test-stripe-replica-money.mjs'

/** Cost in nano-dollars of a call: tokens x USD per million = nano-dollars exactly (1 USD per million tokens is 1,000 nano-dollars a token). Integers in, integer out. */
export function nanoCost (prompt, completion, priceIn, priceOut) {
  return Math.round(prompt * priceIn * 1000 + completion * priceOut * 1000)
}
export const usdToNano = (s) => Math.round(Number(s) * 1e9)

async function models (c, api, control, priceIn, priceOut) {
  const results = []
  const check = (id, ok, detail) => { results.push({ id, ok }); console.log(`  ${ok ? '✓' : '✗'} ${id}${detail ? ' — ' + detail : ''}`) }
  const person = await signUp(c, 'cons')
  const ws = (await c.call('GET', '/v1/workspaces', { cookie: person.cookie })).body.workspaces.find((w) => w.personal).id
  const key = (await c.call('POST', '/v1/keys', { cookie: person.cookie, json: { name: 'consumption', workspace_id: ws } })).body.key
  const plan = async () => (await c.call('GET', `/v1/workspaces/${ws}/plan`, { cookie: person.cookie })).body
  const before = await plan()
  if (!(Number(before.credit_balance_usd) > 0)) { console.error('audit-consumption: the new person has no welcome credit; set welcome_credit_cents on the replica first'); process.exit(2) }
  const balanceBefore = usdToNano(before.credit_balance_usd)
  const usageBefore = (await c.call('GET', `/v1/workspaces/${ws}/llm/usage?group_by=model`, { cookie: person.cookie })).body.rows || []
  const callsBefore = usageBefore.reduce((a, r) => a + r.calls, 0)

  // a mix of sizes: tiny, ordinary, long, output-heavy, input-heavy
  const calls = [[1, 1], [1000, 500], [20000, 3000], [150, 4000], [100000, 20]]
  let reportedPrompt = 0
  let reportedCompletion = 0
  for (const [p, o] of calls) {
    await c.ctl('/__/engine/reply', { text: 'ok', prompt: p, completion: o })
    const r = await c.call('POST', '/v1/chat/completions', { headers: { authorization: `Bearer ${key}` }, json: { model: 'glm', messages: [{ role: 'user', content: 'hello' }], max_tokens: 50 } })
    if (r.status !== 200) { check('call', false, `a call answered ${r.status} ${r.text.slice(0, 120)}`); return results }
    reportedPrompt += r.body.usage.prompt_tokens
    reportedCompletion += r.body.usage.completion_tokens
  }
  check('M1 the answers report the tokens the engine reported', reportedPrompt === calls.reduce((a, x) => a + x[0], 0) && reportedCompletion === calls.reduce((a, x) => a + x[1], 0), `${reportedPrompt} in, ${reportedCompletion} out`)
  const wantNano = calls.reduce((a, [p, o]) => a + nanoCost(p, o, priceIn, priceOut), 0)

  const rows = (await c.call('GET', `/v1/workspaces/${ws}/llm/usage?group_by=model`, { cookie: person.cookie })).body.rows || []
  const glm = rows.find((r) => r.key === 'glm') || { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: '0' }
  check('M2 the usage rows count the calls and the tokens', glm.calls - callsBefore === calls.length && glm.prompt_tokens === reportedPrompt && glm.completion_tokens === reportedCompletion, `${glm.calls - callsBefore} calls, ${glm.prompt_tokens} in, ${glm.completion_tokens} out`)
  // What a customer is billed is the provider's cost times the owner's private multiple (ADR 0059; cost.ts `billedNano`): a whole number, the SAME in every place and for every size of call.
  const rowNano = usdToNano(glm.cost_usd)
  const ratio = rowNano / wantNano
  check('M3 the usage rows cost the price times one whole multiple', Number.isInteger(Math.round(ratio * 1e6) / 1e6) && ratio >= 1, `rows ${rowNano} nano-dollars, price by hand ${wantNano}, multiple ${ratio.toFixed(4)}`)

  const after = await plan()
  const spent = balanceBefore - usdToNano(after.credit_balance_usd)
  check('M4 the credit balance went down by the amount the usage rows show', Math.abs(spent - rowNano) <= 10 * calls.length, `credit ${before.credit_balance_usd} -> ${after.credit_balance_usd}, down ${spent} nano-dollars, rows ${rowNano}`)

  // the multiple does not depend on the size of the call: two more calls, one small and one large, each measured alone against the balance
  const alone = []
  for (const [p, o] of [[40000, 100], [500, 20000]]) {
    const b0 = usdToNano((await plan()).credit_balance_usd)
    await c.ctl('/__/engine/reply', { text: 'ok', prompt: p, completion: o })
    await c.call('POST', '/v1/chat/completions', { headers: { authorization: `Bearer ${key}` }, json: { model: 'glm', messages: [{ role: 'user', content: 'hello' }], max_tokens: 50 } })
    const b1 = usdToNano((await plan()).credit_balance_usd)
    alone.push((b0 - b1) / nanoCost(p, o, priceIn, priceOut))
  }
  check('M7 the multiple is the same for an input-heavy and an output-heavy call', Math.abs(alone[0] - alone[1]) < 0.05 && Math.abs(alone[0] - ratio) < 0.05, `multiples ${alone.map((x) => x.toFixed(3)).join(' and ')} against ${ratio.toFixed(3)}`)

  // the price list people can read (GET /v1/models) against what they are billed
  const list = (await c.call('GET', '/v1/models', { headers: { authorization: `Bearer ${key}` } })).body.data || []
  const entry = list.find((m) => m.id === 'glm') || {}
  const shownIn = entry.pricing && Number(entry.pricing.input_usd_per_million)
  check('M8 the price list the API shows is the price that is billed', Math.abs(ratio - 1) < 0.01, `GET /v1/models shows ${shownIn} USD per million in; a call is billed ${ratio.toFixed(2)} times that price`)

  const budget = (await c.call('GET', `/v1/workspaces/${ws}/llm/budget`, { cookie: person.cookie })).body
  const windows = (budget && budget.windows) || []
  const exhausted = windows.filter((w) => w.exhausted)
  check('M5 no window is used up by a call this small', exhausted.length === 0, `${windows.length} window(s): ${windows.map((w) => `${w.kind}/${w.window_seconds}s spent ${w.spent_usd} of ${w.limit_usd}`).join('; ') || 'none'}`)
  const spentInWindows = windows.map((w) => usdToNano(w.spent_usd)).filter((n) => n > 0)
  if (spentInWindows.length) check('M6 a window that counts it shows the same spend', spentInWindows.every((n) => Math.abs(n - rowNano) <= 10 * calls.length), `windows show ${spentInWindows.join(', ')} nano-dollars`)
  else console.log('  · no window shows a spend: the call was paid by the welcome credit only')
  return results
}

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n, d = '') => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
  const api = opt('--api').replace(/\/$/, '')
  const control = opt('--control').replace(/\/$/, '')
  const scenario = opt('--scenario')
  if (!api || !control || !scenario) { console.error('usage: audit-consumption --scenario models --api <loopback url> --control <loopback url> [--price-in 0.50 --price-out 2.00]'); process.exit(2) }
  if (!isLoopback(api) || !isLoopback(control)) { console.error('audit-consumption: both addresses must be loopback (a replica, never a real server)'); process.exit(2) }
  if (scenario !== 'models') { console.error(`audit-consumption: scenario « ${scenario} » is not built yet (models only; pots, connectors, computer and quote are J08-02, J11-06, J12-07, J12-10)`); process.exit(2) }
  console.log('J10-02 what a model call costs, by hand and in every place the server says it')
  const results = await models(makeClient(api, control), api, control, Number(opt('--price-in', '0.50')), Number(opt('--price-out', '2.00')))
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((e) => { console.error(String(e.message || e)); process.exit(1) })
