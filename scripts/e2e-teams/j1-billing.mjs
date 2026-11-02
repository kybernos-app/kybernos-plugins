// J1 — switching and billing. A switches Personal → T1 → T2 → Personal and sends a message each time. The recorded model requests must carry the right
// workspace header, the server's own usage read must show the cost in the right workspace only, and the delay between a click and the first request that
// carries the new header is measured (a message sent immediately after the click included). Since option 2 (« the active team follows the chat »): a request is billed to the team that
// OWNS THE FOLDER of its chat, whatever team was just chosen, a switch is refused while a reply runs, and the turn that straddles a switch is billed to one team.
import { openGui, recorder, sleep, mainCalls, chatCalls, cwdOf } from './common.mjs'
import { cookieDeSession } from '../cdp-lib.mjs'

export const run = async (ctx) => {
  const { check, note, finish, rec } = recorder(ctx, 'J1')
  const S = ctx.server
  ctx.as('a')
  const A = await ctx.sessionOf('a')
  const P = await ctx.personalId('a')
  const { t1, t2 } = ctx.ids
  const name = { [P]: 'Personal', [t1]: 'T1', [t2]: 'T2' }
  // the rule: a chat in a team's folder bills that team, every other chat bills Personal
  const ownerName = { P: 'Personal', t1: 'T1', t2: 'T2' }
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
    console.log('\n1. Personal → T1 → T2 → Personal, one message each (after the card stops saying « Switching… »)')
    const sent = []
    const order = [P, t1, t2, P]
    for (const [i, target] of order.entries()) {
      const tClick = Date.now()
      let applied = null
      if (i > 0 || (await g.cardName()) !== 'Personal') {
        const pressed = await g.pickSpace(target)
        check(`switch ${i}: the row of ${name[target]} was pressed`, pressed === true)
        await g.until(() => g.card().then((c) => c && c.switching), 1500, 20)
        applied = await g.until(async () => { const c = await g.card(); return c && !c.switching ? Date.now() - tClick : null }, 15000, 40)
      }
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
      if (applied !== null) note(`round ${i}: click → « Switching… » cleared after ${applied} ms`)
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

    // ── 3. a message sent right after the click ────────────────────────────────────────────────────────────────────────────────────────────
    console.log('\n3. a message sent d ms after the click on a row (the card still says « Switching… » for ~2 s)')
    const trials = []
    let current = P
    const delays = [0, 60, 150, 300, 450, 600, 900, 1500]
    for (const [i, d] of delays.entries()) {
      const to = current === t1 ? t2 : t1 // alternate between the two teams, starting from Personal → T1
      await g.closeMenu()
      const row = await g.prepareRow(to)
      await sleep(400)
      const pos = await g.composerPos()
      const tClick = Date.now()
      await g.press(row, 3000)
      if (d > 0) await sleep(d)
      const tSend = await g.sendFast(d >= 500 ? ((await g.composerPos()) || pos) : pos, `J1 quick ${i} d=${d}`)
      await g.until(() => ctx.rows(tSend).filter((r) => r.path === '/v1/chat/completions').length >= 1, 12000, 50)
      await sleep(1500)
      const calls = chatCalls(ctx.rows(tSend))
      const first = calls[0]
      const main = mainCalls(ctx.rows(tSend))[0]
      const landedIn = main ? cwdOf(main) : null
      trials.push({ d, to: name[to], header: first ? name[first.workspace] || first.workspace : null, typedAfterClick: tSend - tClick, requestAfterClick: first ? first.t0 - tClick : null, cwd: landedIn && landedIn.split('/').slice(-2).join('/'), owner: ownerName[ctx.ownerOfCwd(landedIn)] || null })
      await g.until(async () => { const c = await g.card(); return c && !c.switching }, 15000, 100)
      await sleep(1500)
      current = to
    }
    for (const t of trials) note(`d=${t.d} ms: target ${t.to}, the request carried ${t.header} (folder ${t.cwd}, owned by ${t.owner}; Enter ${t.typedAfterClick} ms after the click, request at ${t.requestAfterClick} ms)`)
    const wrong = trials.filter((t) => t.header !== t.owner)
    check('a message sent at any delay after the click carries the header of the team that OWNS THE FOLDER of its chat (the old chat before the new one opens, the new one after)', wrong.length === 0, wrong)
    note(`${trials.filter((t) => t.owner !== t.to).length} of ${trials.length} messages were typed in the OLD chat (its folder is not the team just chosen): they were billed to the old chat's team, not to the new one`)
    rec.trials = trials

    // ── 3b. the route itself: pre-type a message, switch through the host (no click, so the focus stays in the composer), press Enter X ms later ──
    console.log('\n3b. the host switches (POST space/active, not awaited); Enter X ms later in the composer that already holds the text')
    const ck = cookieDeSession(ctx.hostA)
    const hostSwitch = (id) => fetch('http://' + ctx.hostA + '/kybernos-cloud/space/active', { method: 'POST', headers: { 'content-type': 'application/json', cookie: ck.nom + '=' + ck.valeur, origin: 'http://' + ctx.hostA }, body: JSON.stringify({ workspace_id: id }) }).then((r) => r.json()).then(() => Date.now())
    const raw = []
    let here = current
    for (const [i, x] of [0, 100, 250, 500, 800, 1200, 1600, 2200].entries()) {
      const to = here === t1 ? t2 : t1
      await g.closeMenu()
      await g.send(`J1 raw ${i} x=${x}`, { enter: false })
      const t0 = Date.now()
      const answered = hostSwitch(to)
      if (x > 0) await sleep(x)
      const tEnter = Date.now()
      await g.key('Enter', 'Enter', 13)
      await g.until(() => ctx.rows(tEnter).filter((r) => r.path === '/v1/chat/completions').length >= 1, 12000, 50)
      const first = chatCalls(ctx.rows(tEnter))[0]
      const tAnswer = await answered
      const firstMain = mainCalls(ctx.rows(tEnter))[0]
      raw.push({ x, to: name[to], header: first ? name[first.workspace] || first.workspace : null, owner: ownerName[ctx.ownerOfCwd(firstMain ? cwdOf(firstMain) : null)] || null, enterAfterSwitch: tEnter - t0, requestAfterSwitch: first ? first.t0 - t0 : null, hostAnswered: tAnswer - t0 })
      await sleep(2500)
      here = to
    }
    for (const t of raw) note(`X=${t.x} ms: target ${t.to}; the first request carried ${t.header} (Enter ${t.enterAfterSwitch} ms after the switch started, request left at ${t.requestAfterSwitch} ms; the host answered at ${t.hostAnswered} ms)`)
    const stale = raw.filter((t) => t.header !== t.owner)
    check('whatever the delay, the request carries the header of the team that owns the folder of the chat it was typed in (the host switches back at claim time when the chat is another team\'s)', stale.length === 0, raw)
    note(`${raw.filter((t) => t.owner !== t.to).length} of ${raw.length} messages were typed in a chat that is not the team just switched to: billed to the chat's own team (not to the team the script switched to)`)
    rec.raw = raw

    // ── 4. a switch in the middle of a turn ────────────────────────────────────────────────────────────────────────────────────────────────
    // The model's first answer is held for 3 s (a scripted tool call), the host switches meanwhile: the turn's second request carries which team?
    console.log('\n4. the team is switched while a turn waits for its model')
    await g.reload()
    await g.goTo(t1, /E2E Alpha/)
    await ctx.script([{ name: 'memory_search', arguments: { q: 'anything' } }], 3000)
    await g.selectModel('GLM')
    const tTurn = await g.send('J1 a turn that straddles a switch')
    await g.until(() => ctx.rows(tTurn).length > 0 && chatCalls(ctx.rows(tTurn)).length >= 1, 10000, 50)
    await sleep(600)
    const refusal = await fetch('http://' + ctx.hostA + '/kybernos-cloud/space/active', { method: 'POST', headers: { 'content-type': 'application/json', cookie: ck.nom + '=' + ck.valeur, origin: 'http://' + ctx.hostA }, body: JSON.stringify({ workspace_id: t2 }) }).then((r) => r.json())
    check('the switch asked while the turn waits for its model is REFUSED by the host: turn_running', refusal.ok === false && refusal.error === 'turn_running', refusal)
    await g.until(() => mainCalls(ctx.rows(tTurn)).length >= 2, 20000, 100)
    await sleep(1500)
    const straddle = mainCalls(ctx.rows(tTurn)).map((c) => name[c.workspace] || c.workspace)
    note(`a turn that began in T1 and was switched to T2 while it waited: its requests carried ${straddle.join(' then ')}`)
    rec.straddle = straddle
    check('a turn that begins in one team and is switched while it waits is billed to one team only', new Set(straddle).size === 1, straddle)
  } finally { await g.close() }
  return finish()
}
