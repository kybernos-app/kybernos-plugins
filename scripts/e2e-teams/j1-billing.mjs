// J1 — opening a team's DSH and billing. A goes Personal → T1 → T2 → Personal (each is a DSH of its own, which the tab follows) and sends a message in each. The recorded model requests
// must carry the right workspace header and the server's own usage read must show the cost in the right workspace only. Every DSH answers one space for good, so nothing here
// races a switch: the claim-time switch, the turn guard and the deferred switch of option 2 are retired (docs/dev/team-profiles-cadrage.md, step 5), and so are their sections of this journey.
import { openGui, recorder, sleep, mainCalls, chatCalls } from './common.mjs'

export const run = async (ctx) => {
  const { check, note, finish, rec } = recorder(ctx, 'J1')
  const S = ctx.server
  ctx.as('a')
  const A = await ctx.sessionOf('a')
  const P = await ctx.personalId('a')
  const { t1, t2 } = ctx.ids
  const name = { [P]: 'Personal', [t1]: 'T1', [t2]: 'T2' }
  // each call is worth 0.001 + 0.0004 USD at the stand-in model's price (0.50 / 2.00 per million tokens)
  await ctx.engine({ text: 'Answer from the stand-in model.', prompt: 2000, completion: 200 })
  const usageNow = async (ws) => {
    const r = await S.call('GET', `/v1/workspaces/${ws}/llm/usage?group_by=model`, { cookie: A.cookie })
    const rows = r.status === 200 ? r.body.rows : []
    return { calls: rows.reduce((n, x) => n + x.calls, 0), cost: rows.reduce((n, x) => n + Number(x.cost_usd), 0) }
  }
  const runStart = Date.now()
  const before = { [P]: await usageNow(P), [t1]: await usageNow(t1), [t2]: await usageNow(t2) }

  const g = await openGui(ctx.hostA)
  try {
    await sleep(2500)
    await g.selectModel('GLM')

    // ── 1. the plain round: wait for the switch to be applied, then send ───────────────────────────────────────────────────────────────────
    console.log('\n1. Personal → T1 → T2 → Personal, one message each (each space is a DSH of its own)')
    const sent = []
    const order = [P, t1, t2, P]
    const label = { [P]: /Personal/, [t1]: /E2E Alpha/, [t2]: /E2E Beta/ }
    for (const [i, target] of order.entries()) {
      const tClick = Date.now()
      await g.goTo(target, label[target])
      const applied = Date.now() - tClick
      await sleep(600)
      await g.selectModel('GLM')
      const tSend = await g.send(`J1 round ${i} in ${name[target]}`)
      await g.until(() => ctx.rows(tSend).filter((r) => r.path === '/v1/chat/completions').length >= 1, 12000, 100)
      await sleep(2500) // the title and classification calls come a moment after
      const calls = chatCalls(ctx.rows(tSend))
      const mains = mainCalls(ctx.rows(tSend))
      sent.push({ target, calls: calls.length, headers: [...new Set(calls.map((c) => c.workspace))] })
      check(`round ${i} in ${name[target]}: every model request of the turn carries the workspace header of ${name[target]}`,
        calls.length >= 1 && calls.every((c) => c.workspace === target), { calls: calls.length, headers: calls.map((c) => (c.workspace || '-').slice(0, 8)), want: target.slice(0, 8) })
      check(`round ${i}: the message text really reached the model`, mains.some((m) => (m.body || '').includes(`J1 round ${i} in ${name[target]}`)))
      note(`round ${i}: ${name[target]}'s DSH was on screen after ${applied} ms`)
      await ctx.shot(g, `j1-round-${i}`)
    }

    // ── 2. the server's own read: the cost is in the right workspace only ──────────────────────────────────────────────────────────────────
    console.log('\n2. the server\'s usage read per workspace (a call is a model request the server accepted)')
    await sleep(1200)
    const after = { [P]: await usageNow(P), [t1]: await usageNow(t1), [t2]: await usageNow(t2) }
    const expectedCalls = {}
    for (const r of ctx.rows(runStart).filter((r) => r.method === 'POST' && r.path === '/v1/chat/completions' && r.status === 200)) expectedCalls[r.workspace] = (expectedCalls[r.workspace] || 0) + 1
    for (const ws of [P, t1, t2]) {
      const dCalls = after[ws].calls - before[ws].calls
      note(`${name[ws]}: +${dCalls} calls, +${(after[ws].cost - before[ws].cost).toFixed(6)} USD on the server; the proxy saw ${expectedCalls[ws] || 0} accepted requests with this header during the run`)
      check(`${name[ws]}: the server counted at least the calls of its own rounds and none other`, dCalls >= 1, { dCalls, expected: expectedCalls[ws] })
    }
    const sumDelta = [P, t1, t2].reduce((n, ws) => n + (after[ws].calls - before[ws].calls), 0)
    const proxyOK = Object.values(expectedCalls).reduce((n, v) => n + v, 0)
    check('the three workspaces together hold exactly the accepted requests the proxy saw (nothing billed twice, nothing lost)', sumDelta === proxyOK, { sumDelta, proxyOK })
    for (const ws of [P, t1, t2]) check(`${name[ws]}: server calls equal the proxy's accepted requests carrying ${name[ws]}'s header`, (after[ws].calls - before[ws].calls) === (expectedCalls[ws] || 0), { server: after[ws].calls - before[ws].calls, proxy: expectedCalls[ws] || 0 })
  } finally { await g.close() }
  return finish()
}
