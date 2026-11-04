#!/usr/bin/env node
// Cases J10-02 (models) and J12-10 (quote) of docs/tests/user-journey, and the base of J08-02, J11-06 and J12-07: what a call costs, recomputed by hand from the price of the model, and compared with every place the server says it.
// The expected value comes from the model's price (the replica's stand-in model « glm »: 0.50 USD per million tokens in, 2.00 out), never from the screen. The places compared: what the call itself reports (usage),
// the usage rows of the workspace (`GET /llm/usage`), the credit balance of the workspace (`GET /plan`, the welcome credit being spent) and the budget window (`GET /llm/budget`).
//
//   node scripts/audit-consumption.mjs --scenario quote --api http://localhost:8841 --control http://127.0.0.1:8842     (J12-10: the price of a cloud computer, 72 choices, against Fly's public grid x 4; the region's own factor is private, so it is INFERRED and must fit all 72)
//   node scripts/audit-consumption.mjs --scenario pots --api http://localhost:8841 --control http://127.0.0.1:8842     (J08-02: a Plus plan with a welcome credit; the windows, the order of payment, the credit)
//   node scripts/audit-consumption.mjs --scenario models --api http://localhost:8841 --control http://127.0.0.1:8842 [--price-in 0.50 --price-out 2.00]
//
// The replica must give a new person a welcome credit (`node scripts/replica-owner-settings.mjs ... welcome_credit_cents=2000`, or `bash scripts/user-journey-acceptance.sh --keep`). Loopback only.
// Exit 0 when every place agrees to the nano-dollar, 1 otherwise, 2 on a refusal.
import { pathToFileURL } from 'node:url'
import { isLoopback } from './replica-owner-settings.mjs'
import { makeClient, signUp } from './check-stripe-replica-money.mjs'

/** Cost in nano-dollars of a call: tokens x USD per million = nano-dollars exactly (1 USD per million tokens is 1,000 nano-dollars a token). Integers in, integer out. */
export function nanoCost (prompt, completion, priceIn, priceOut) {
  return Math.round(prompt * priceIn * 1000 + completion * priceOut * 1000)
}
export const usdToNano = (s) => Math.round(Number(s) * 1e9)

/** Fly's public grid (fly.io/docs/about/pricing, 2026-10) and the platform's factor: what a month costs a person, whole dollars, rounded up. `regionFactor` applies to the CPU and the memory only. */
export function quoteUsd (cpus, gb, disk, hours, regionFactor, factor = 4) {
  const base = { 1: [2.19, 256], 2: [4.39, 512] }[cpus]
  const whole = (base[0] + ((gb * 1024 - base[1]) / 1024) * 6) * regionFactor
  const awake = hours === null ? 1 : Math.min(1, hours / 720)
  return Math.ceil((whole * awake + disk * 0.15) * factor - 1e-9)
}

async function quote (c) {
  const results = []
  const check = (id, ok, detail) => { results.push({ id, ok }); console.log(`  ${ok ? '✓' : '✗'} ${id}${detail ? ' — ' + detail : ''}`) }
  const person = await signUp(c, 'quo')
  const ws = (await c.call('POST', '/v1/workspaces', { cookie: person.cookie, json: { name: 'Quote team' } })).body.id
  const co = await c.call('POST', `/v1/workspaces/${ws}/billing/checkout`, { cookie: person.cookie, json: { plan: 'team', component: 'band:0', quantity: 2, currency: 'USD', interval: 'year' } })
  await c.ctl('/__/stripe/pay', { session_id: co.body.session_id })
  const shapes = { '1x1g': [1, 1], '1x2g': [1, 2], '2x4g': [2, 4] }
  const asked = []
  for (const [sh, [cpus, gb]] of Object.entries(shapes)) for (const disk of [2, 10, 25, 50]) for (const [mode, hours] of [['always', null], ['sleep', 10], ['sleep', 50], ['sleep', 200], ['sleep', 720]]) {
    const r = await c.call('GET', `/v1/workspaces/${ws}/computers/quote?shape=${sh}&disk_gb=${disk}&mode=${mode}` + (hours === null ? '' : `&hours=${hours}`), { cookie: person.cookie })
    asked.push({ sh, cpus, gb, disk, mode, hours, status: r.status, price: r.body && r.body.price_usd, charged: r.body && r.body.charged, included: r.body && r.body.included })
  }
  check('Q1 every choice is answered', asked.every((a) => a.status === 200 && Number.isInteger(a.price)), `${asked.length} choices, ${asked.filter((a) => a.status !== 200).length} refused`)
  // the region's factor is private: find the one factor (0.9 to 1.6, step 0.001) under which Fly's grid x 4 gives every quote, and report how well the best one fits
  let best = { f: 1, ok: -1 }
  for (let f = 0.9; f <= 1.6; f += 0.001) { const ok = asked.filter((a) => a.price === quoteUsd(a.cpus, a.gb, a.disk, a.hours, f)).length; if (ok > best.ok) best = { f, ok } }
  check('Q2 one region factor explains every quote (the formula has the right shape in size, volume and hours)', best.ok === asked.length, `best factor ${best.f.toFixed(3)} fits ${best.ok} of ${asked.length}`)
  const at = (sh, disk, mode, hours) => asked.find((a) => a.sh === sh && a.disk === disk && a.mode === mode && a.hours === hours).price
  check('Q3 a bigger machine, a bigger volume or more awake hours never costs less', asked.every((a) => {
    const order = ['1x1g', '1x2g', '2x4g']
    const next = order[order.indexOf(a.sh) + 1]
    return (next === undefined || at(next, a.disk, a.mode, a.hours) >= a.price) && (a.disk === 50 || at(a.sh, [2, 10, 25, 50][[2, 10, 25, 50].indexOf(a.disk) + 1], a.mode, a.hours) >= a.price)
  }) && asked.filter((a) => a.mode === 'sleep').every((a, i, all) => true), 'sizes and volumes checked in order')
  check('Q4 always on costs the same as a sleeping computer awake the whole month', asked.filter((a) => a.mode === 'always').every((a) => a.price === at(a.sh, a.disk, 'sleep', 720)), 'always = 720 awake hours')
  check('Q5 nothing is charged by asking', asked.every((a) => a.charged === false), 'charged false on all')
  const tooMany = await c.call('GET', `/v1/workspaces/${ws}/computers/quote?shape=1x1g&mode=sleep&hours=900`, { cookie: person.cookie })
  check('Q6 more than a month of hours is refused, not priced', tooMany.status === 400, `answered ${tooMany.status}`)
  return results
}

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

/** J08-02 (Models pot, over HTTP): which money pays a call, in which order, and what each place shows. The Cloud and Connectors pots are metered by the server's own `test/pot-meter.test.ts` and `test/computers-meter.test.ts`. */
async function pots (c, priceIn, priceOut) {
  const results = []
  const notes = []
  const check = (id, ok, detail) => { results.push({ id, ok }); console.log(`  ${ok ? '✓' : '✗'} ${id}${detail ? ' — ' + detail : ''}`) }
  const person = await signUp(c, 'pots')
  const ws = (await c.call('GET', '/v1/workspaces', { cookie: person.cookie })).body.workspaces.find((w) => w.personal).id
  const key = (await c.call('POST', '/v1/keys', { cookie: person.cookie, json: { name: 'pots', workspace_id: ws } })).body.key
  const get = async (path) => (await c.call('GET', `/v1/workspaces/${ws}${path}`, { cookie: person.cookie })).body
  const co = await c.call('POST', `/v1/workspaces/${ws}/billing/checkout`, { cookie: person.cookie, json: { plan: 'solo', component: 'solo', quantity: 1, currency: 'USD', interval: 'year' } })
  if (co.status !== 200) { console.error(`audit-consumption: the Plus checkout answered ${co.status}`); process.exit(2) }
  await c.ctl('/__/stripe/pay', { session_id: co.body.session_id })
  const plan = await get('/plan')
  if (plan.level !== 'Plus') { console.error(`audit-consumption: the plan is « ${plan.level} » after payment`); process.exit(2) }
  if (!(Number(plan.credit_balance_usd) > 0)) { console.error('audit-consumption: no welcome credit; set welcome_credit_cents on the replica first'); process.exit(2) }

  // P1 the plan route against the published offers: three budgets, and each window a share of the Models budget (the launch files write 8.5, 12.5 and 25 percent)
  const offers = (await c.call('GET', '/v1/offers')).body
  const level = offers.plans.find((p) => p.key === 'solo').components.find((x) => x.key === 'solo')
  const wantWindows = new Map([[18000, 0.085], [86400, 0.125], [604800, 0.25], [2592000, 1]].map(([sec, share]) => [sec, Number(level.budgets.models) * share]))
  const shown = new Map(plan.allowances.map((a) => [a.window_seconds, Number(a.limit_usd)]))
  check('P1 the plan shows the offers\' three budgets', JSON.stringify(plan.budgets) === JSON.stringify(level.budgets), JSON.stringify(plan.budgets))
  check('P2 each window is its share of the Models budget', [...wantWindows].every(([sec, usd]) => Math.abs((shown.get(sec) ?? -1) - usd) < 0.0006), [...wantWindows].map(([sec, usd]) => `${sec / 3600}h ${shown.get(sec)} of ${usd.toFixed(3)}`).join('; '))

  const call = async (p, o) => {
    await c.ctl('/__/engine/reply', { text: 'ok', prompt: p, completion: o })
    return c.call('POST', '/v1/chat/completions', { headers: { authorization: `Bearer ${key}` }, json: { model: 'glm', messages: [{ role: 'user', content: 'hello' }], max_tokens: 50 } })
  }
  const credit = async () => usdToNano((await get('/plan')).credit_balance_usd)
  const windows = async () => (await get('/llm/budget')).windows
  const spentIn = (ws2, sec) => Number(ws2.find((w) => w.window_seconds === sec).spent_usd)
  const priceNano = (p, o) => nanoCost(p, o, priceIn, priceOut)

  // P3 a call inside every window is paid by the plan: the windows move together and the credit does not move
  const c0 = await credit()
  const small = await call(1000, 500)
  const w1 = await windows()
  const billedSmall = spentIn(w1, 2592000)
  const multiple = billedSmall * 1e9 / priceNano(1000, 500)
  check('P3 a call inside the windows is paid by the plan: every window shows it, the credit does not move', small.status === 200 && w1.every((w) => Math.abs(Number(w.spent_usd) - billedSmall) < 0.0006) && (await credit()) === c0, `windows show ${billedSmall} dollars, credit ${c0 / 1e9} before and after`)
  check('P4 what the window shows is the price times one whole multiple', Number.isInteger(Math.round(multiple * 100) / 100) && multiple >= 1, `${multiple.toFixed(3)} times the price by hand`)

  // P5 a call that crosses the 5-hour window is still wholly the plan's (overshoot is accepted by the design), and the credit is still untouched
  const bigIn = Math.ceil(((wantWindows.get(18000) - billedSmall) / multiple) * 1e9 / (priceIn * 1000)) + 200000
  const big = await call(bigIn, 10)
  const w2 = await windows()
  const short = w2.find((w) => w.window_seconds === 18000)
  check('P5 the call that crosses the 5-hour window is wholly the plan\'s: the credit does not move', big.status === 200 && Number(short.spent_usd) > Number(short.limit_usd) && (await credit()) === c0, `5 h window ${short.spent_usd} of ${short.limit_usd}, credit ${(await credit()) / 1e9}`)

  // P8 the published tariffs of the two other pots carry the same multiple as the model bill: the provider costs are the owner's settings of the launch (0.0005 an action, 0.0092 an awake hour, 0.55 a month asleep: the server tests set the same three)
  const tariffs = offers.tariffs || {}
  const asked = [['connector_action', 0.0005], ['cloud_hour_awake', 0.0092], ['cloud_month_asleep', 0.55]].map(([k, provider]) => [k, Number((tariffs[k] || {}).usd) / provider])
  check('P8 the connector action, the awake hour and the sleeping month are published at the same multiple as a model call', asked.every(([, m]) => Math.abs(m - multiple) < 0.01), asked.map(([k, m]) => `${k} ${m.toFixed(3)}`).join('; ') + `; models ${multiple.toFixed(3)}`)

  // P6 what happens next is a DECISION of the product (2026-10-23, reservations.ts): a used-up plan window is lifted by the credit, short ones too. Measured, and reported when it makes paid credit go
  // first while the month's budget is unspent.
  const month0 = spentIn(w2, 2592000)
  const c1 = await credit()
  const next = await call(1000, 500)
  const w3 = await windows()
  const paidByCredit = c1 - (await credit())
  const month1 = spentIn(w3, 2592000)
  check('P6 the next call is answered', next.status === 200, `answered ${next.status}`)
  check('P7 the call that follows is paid by the credit by exactly its price times the multiple', Math.abs(paidByCredit / 1e9 - billedSmall) < 0.0006, `credit down ${paidByCredit / 1e9}, one call is ${billedSmall}`)
  const monthLeft = Number(level.budgets.models) - month1
  if (paidByCredit > 0 && monthLeft > 0) notes.push(`once the 5-hour window is full the credit pays, while ${monthLeft.toFixed(2)} of the month's ${level.budgets.models} dollars of Models budget are unspent (the 30-day window moved ${(month1 - month0).toFixed(4)}): the short windows are lifted by credit, as reservations.ts says (2026-10-23), while ADR 0059 §11 and ADR 0066 (« window >= 28 days ») still say they are not`)
  const lifted = w3.filter((w) => w.lifted_by_topup).map((w) => `${w.window_seconds / 3600}h`)
  notes.push(`windows shown as « lifted by credit »: ${lifted.join(', ') || 'none'}`)
  for (const n of notes) console.log('  · ' + n)
  return results
}

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n, d = '') => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
  const api = opt('--api').replace(/\/$/, '')
  const control = opt('--control').replace(/\/$/, '')
  const scenario = opt('--scenario')
  if (!api || !control || !scenario) { console.error('usage: audit-consumption --scenario models|quote|pots --api <loopback url> --control <loopback url> [--price-in 0.50 --price-out 2.00]'); process.exit(2) }
  if (!isLoopback(api) || !isLoopback(control)) { console.error('audit-consumption: both addresses must be loopback (a replica, never a real server)'); process.exit(2) }
  if (!['models', 'quote', 'pots'].includes(scenario)) { console.error(`audit-consumption: scenario « ${scenario} » is not built (models, quote, pots; the Cloud and Connectors pots are metered by the server's own test/pot-meter.test.ts and test/computers-meter.test.ts)`); process.exit(2) }
  const client = makeClient(api, control)
  let results
  if (scenario === 'quote') { console.log('J12-10 what a cloud computer costs a month, by hand from Fly\'s grid'); results = await quote(client) } else if (scenario === 'pots') {
    console.log('J08-02 which money pays a model call, in which order, on a Plus plan with a welcome credit')
    results = await pots(client, Number(opt('--price-in', '0.50')), Number(opt('--price-out', '2.00')))
  } else {
    console.log('J10-02 what a model call costs, by hand and in every place the server says it')
    results = await models(client, api, control, Number(opt('--price-in', '0.50')), Number(opt('--price-out', '2.00')))
  }
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((e) => { console.error(String(e.message || e)); process.exit(1) })
