// J5 — usage states. The owner (A) sets a tiny cap on every member of T1 (PUT .../llm/member-limits) and drives B (a member), then A, through normal, 75 % and full with
// the stand-in model (it bills the tokens it is told to). What DSH shows (the footer card, the menu rows, the plan card, the notice) is compared with what the server says.
import { openGui, recorder, sleep, mainCalls, chatCalls } from './common.mjs'

const CAP_USD = 0.04
const WINDOW = 18000 // 5 hours
export const run = async (ctx) => {
  const { check, note, finish, rec } = recorder(ctx, 'J5')
  const S = ctx.server
  const A = await ctx.sessionOf('a')
  // The team the journey plays in: T1 by default. A run spends 5-hour allowance for good (a second run in the same five hours finds the member already near the plan's limit,
  // where a cap changes nothing): KB_E2E_J5_TEAM=t2 plays it in another team.
  const teamKey = process.env.KB_E2E_J5_TEAM || 't1'
  const t1 = ctx.acc.teams[teamKey].id
  const tName = ctx.acc.teams[teamKey].name

  const budget = async (cookie) => { const r = await S.call('GET', `/v1/workspaces/${t1}/llm/budget`, { cookie }); return r.body.windows }
  const own5h = (ws) => ws.find((w) => w.kind === 'member' && w.window_seconds === WINDOW)
  const snapshot = async (g) => {
    await g.closeMenu(); await sleep(300)
    // the card re-reads the quota every two minutes and when the window comes back into view; a headless page never gets the second signal, so the page's own event stands in for the tick
    await g.val(`window.dispatchEvent(new Event('kybernos-cloud:quota-read'))`)
    await sleep(1500)
    const card = await g.val(`(() => { const c = document.querySelector('[data-kb="workspace-card"]'); if (!c) return null; const u = c.querySelector('[data-kb="workspace-card-usage"]'); const m = u ? (u.innerText || '').match(/(\\d+)\\s*%/) : null; return { text: (c.innerText || '').replace(/\\s+/g, ' ').trim(), pct: m ? Number(m[1]) : null, title: u ? (u.getAttribute('title') || (u.querySelector('[title]') || { getAttribute: () => null }).getAttribute('title')) : null } })()`)
    const notice = await g.text('[data-kb="quota-notice"]')
    await g.openMenu(); await sleep(900)
    const row = (await g.spaceRowsAny()).find((r) => r.id === t1) || null
    await g.closeMenu(); await g.openMenu(); await sleep(500)
    const plan = await g.val(`(() => { const c = document.querySelector('[data-kb="menu-plan-card"]'); if (!c) return null; return { rows: Array.from(c.querySelectorAll('[data-kb="menu-plan-window"]')).map((r) => ({ win: r.getAttribute('data-win'), level: r.getAttribute('data-level'), percent: Number(r.getAttribute('data-percent')), note: (r.querySelector('.kbfp-mwinnote') || { innerText: '' }).innerText.trim() })), manage: !!c.querySelector('[data-kb="menu-plan-manage"]'), credits: !!document.querySelector('[data-kb="menu-plan-credits"]') } })()`)
    await g.closeMenu()
    return { card, notice, row, plan }
  }
  const yourFive = (snap) => (snap.plan ? snap.plan.rows.filter((r) => r.win === 'you').find((r) => /5 hours/.test(r.note) || /Back in/.test(r.note) || /cap/.test(r.note)) : null)

  // The cap: a few cents per member over 5 hours, on top of what the member already spent in that window (what is spent counts, so a second run starts from the same low percent).
  const setCap = async (who) => {
    const U = await ctx.sessionOf(who)
    const spent = Number(own5h(await budget(U.cookie)).spent_usd)
    const cap = Math.max(CAP_USD, spent * 5)
    const planLimit = Number(own5h(await budget(U.cookie)).limit_usd)
    if (cap >= planLimit) { note(`NOT RUN for ${who}: the 5-hour spend (${spent.toFixed(3)}) is too high for a cap below the plan's ${planLimit} to apply; use a fresh replica or KB_E2E_J5_TEAM`); return null }
    const put = await S.call('PUT', `/v1/workspaces/${t1}/llm/member-limits`, { cookie: A.cookie, json: { user_id: U.id, window_seconds: WINDOW, limit_usd: cap.toFixed(6) } })
    check(`the owner set a 5-hour cap of ${cap.toFixed(4)} USD on ${who === 'a' ? 'A herself' : 'B'} (already spent: ${spent.toFixed(4)})`, put.status === 200 || put.status === 204, put.status)
    return { cap, id: U.id }
  }
  const liftCap = async (id) => S.call('DELETE', `/v1/workspaces/${t1}/llm/member-limits?user_id=${id}&window_seconds=${WINDOW}`, { cookie: A.cookie })

  const play = async (who, label) => {
    console.log(`\n${label}`)
    const capped = await setCap(who)
    if (capped === null) return
    const CAP = capped.cap
    const cookie = (await ctx.sessionOf(who)).cookie
    const host = ctx.as(who)
    const g = await openGui(host)
    const states = []
    try {
      await sleep(2500)
      await g.goTo(t1, new RegExp(tName))
      await g.selectModel('GLM')
      const perTurn = async (targetPct, kOverride) => {
        // how much to add so that this person's 5-hour window reaches targetPct of the cap, spread over the calls one turn makes
        const w0 = own5h(await budget(cookie))
        const spent = Number(w0.spent_usd)
        const need = Math.max(0.0001, CAP * (targetPct / 100) - spent)
        const k = kOverride || ctx.calls || 4
        const perCall = need / k
        const prompt = Math.max(10, Math.round((perCall - 5 * 2e-6) / 0.5e-6))
        await ctx.engine({ text: 'Answer from the stand-in model.', prompt, completion: 5 })
        const before = chatCalls(ctx.rows(0)).length
        const t = await g.send(`J5 ${who} turn to ${targetPct}%`)
        await g.until(() => chatCalls(ctx.rows(t)).length >= 1, 15000, 100)
        await sleep(4500)
        ctx.calls = Math.max(1, chatCalls(ctx.rows(t)).filter((c) => c.status === 200).length)
        const w1 = own5h(await budget(cookie))
        return { spentBefore: spent, w: w1, accepted: chatCalls(ctx.rows(t)).filter((c) => c.status === 200).length, refused: chatCalls(ctx.rows(t)).filter((c) => c.status !== 200).length }
      }
      const settle = async (percent) => { // DSH refreshes after a turn: wait for the card to show what the server says
        const end = Date.now() + 25000
        let snap = null, lag = 0
        const t0 = Date.now()
        while (Date.now() < end) {
          snap = await snapshot(g)
          const y = yourFive(snap)
          if (y && Math.abs(y.percent - percent) <= 1) { lag = Date.now() - t0; break }
          await sleep(1500)
        }
        return { snap, lag }
      }

      // two cheap turns to learn how many model requests a turn makes in an established chat (the first turn of a chat also makes the title and classification requests);
      // the targets below are spread over the steady number
      await ctx.engine({ text: 'Answer from the stand-in model.', prompt: 100, completion: 5 })
      let firstCalls = 0
      for (const label of ['first', 'second']) {
        const tc = await g.send(`J5 ${who} calibration ${label}`)
        await g.until(() => chatCalls(ctx.rows(tc)).length >= 1, 15000, 100)
        await sleep(4500)
        const n = Math.max(1, chatCalls(ctx.rows(tc)).filter((c) => c.status === 200).length)
        if (label === 'first') firstCalls = n; else ctx.calls = n
      }
      note(`${who}: the first turn of a chat makes ${firstCalls} model requests, the next ones ${ctx.calls}`)

      let w = own5h(await budget(cookie))
      note(`${who}: window 5 h at the start: ${w.used_percent}% of ${w.limit_usd} (scope ${w.scope})`)
      check(`${who}: the server says the 5-hour limit is the cap (scope team, ${CAP.toFixed(4)})`, w.scope === 'team' && Math.abs(Number(w.limit_usd) - CAP) < 1e-6, { scope: w.scope, limit: w.limit_usd })
      const s0 = await settle(w.used_percent)
      states.push({ state: 'start', server: w.used_percent, ...s0 })
      const y0 = yourFive(s0.snap)
      check(`${who} start: the plan card shows the capped window with the server's percent and says where the cap was set`, !!y0 && Math.abs(y0.percent - w.used_percent) <= 1 && /cap set in/.test(y0.note), y0)
      check(`${who} start: no « Back in » anywhere while there is room`, !/Back in/.test(JSON.stringify(s0.snap)), s0.snap.plan)
      await ctx.shot(g, `j5-${who}-0-start`)

      // normal: well under 75 %
      const r1 = await perTurn(Math.min(45, w.used_percent + 25))
      const s1 = await settle(r1.w.used_percent)
      states.push({ state: 'normal', server: r1.w.used_percent, ...s1 })
      const y1 = yourFive(s1.snap)
      note(`${who} normal: server ${r1.w.used_percent}%; plan card ${y1 ? y1.percent + '% (' + y1.level + ') "' + y1.note + '"' : 'none'}; footer ${s1.snap.card && s1.snap.card.pct}% title ${JSON.stringify(s1.snap.card && s1.snap.card.title)}; row ${s1.snap.row && s1.snap.row.pct}%; DSH matched after ${s1.lag} ms`)
      check(`${who} normal (${r1.w.used_percent}%): the plan card's bar equals the server's percent, level ok, the cap is named`, !!y1 && Math.abs(y1.percent - r1.w.used_percent) <= 1 && y1.level === 'ok' && /cap set in/.test(y1.note), y1)
      check(`${who} normal: no « Back in » anywhere`, !/Back in/.test(JSON.stringify(s1.snap)))
      if (who === 'b') check('b normal: the footer card (a member sees his own window) reads the server\'s percent', s1.snap.card && Math.abs(s1.snap.card.pct - r1.w.used_percent) <= 1, s1.snap.card)
      await ctx.shot(g, `j5-${who}-1-normal`)

      // 75 % and more: small steps (a turn makes a varying number of requests), until the window is at 75 % or more and not yet used up
      let r2 = null
      for (let i = 0; i < 6; i += 1) {
        const cur = own5h(await budget(cookie)).used_percent
        if (cur >= 75 && cur < 100) break
        r2 = await perTurn(Math.min(82, cur + 22))
        if (r2.w.used_percent >= 100) break
      }
      r2 = { w: own5h(await budget(cookie)) }
      const s2 = await settle(r2.w.used_percent)
      states.push({ state: 'near', server: r2.w.used_percent, ...s2 })
      const y2 = yourFive(s2.snap)
      note(`${who} near: server ${r2.w.used_percent}%; plan card ${y2 ? y2.percent + '% (' + y2.level + ') "' + y2.note + '"' : 'none'}; footer ${s2.snap.card && s2.snap.card.pct}% title ${JSON.stringify(s2.snap.card && s2.snap.card.title)}; row ${s2.snap.row && s2.snap.row.pct}%`)
      check(`${who} near (${r2.w.used_percent}%): the server is at 75 % or more and not used up`, r2.w.used_percent >= 75 && r2.w.used_percent < 100, r2.w.used_percent)
      check(`${who} near: the plan card's bar is at that percent, level near, the cap is named, no « Back in »`, !!y2 && Math.abs(y2.percent - r2.w.used_percent) <= 1 && y2.level === 'near' && /cap set in/.test(y2.note) && !/Back in/.test(y2.note), y2)
      check(`${who} near: the meter's own sentence (its title) says the percent and where the cap was set, and no time`, who === 'a' ? true : !!(s2.snap.card && s2.snap.card.title) && new RegExp(String(r2.w.used_percent)).test(s2.snap.card.title) && /cap set in/.test(s2.snap.card.title) && !/back in|comes back/i.test(s2.snap.card.title), s2.snap.card && s2.snap.card.title)
      await ctx.shot(g, `j5-${who}-2-near`)

      // full
      const r3 = await perTurn(135)
      const s3 = await settle(100)
      states.push({ state: 'full', server: r3.w.used_percent, exhausted: r3.w.exhausted, ...s3 })
      const y3 = yourFive(s3.snap)
      note(`${who} full: server ${r3.w.used_percent}% exhausted=${r3.w.exhausted}; plan card ${y3 ? y3.percent + '% (' + y3.level + ') "' + y3.note + '"' : 'none'}; footer ${s3.snap.card && s3.snap.card.pct}% title ${JSON.stringify(s3.snap.card && s3.snap.card.title)}; row ${s3.snap.row && s3.snap.row.pct}%`)
      check(`${who} full: the server says the window is used up and gives the time it opens again`, r3.w.exhausted === true && !!r3.w.resets_at, r3.w)
      const soonMin = r3.w.resets_at ? Math.round((Date.parse(r3.w.resets_at) - Date.now()) / 60000) : null
      check(`${who} full: the plan card says « Back in about … » (the server: ${soonMin} min) and names the cap`, !!y3 && y3.level === 'full' && y3.percent === 100 && /Back in about/.test(y3.note) && /cap set in/.test(y3.note), y3)
      check(`${who} full: the footer card reads 100 % and its sentence says it comes back in about …`, s3.snap.card && s3.snap.card.pct === 100 && /comes back in about/.test(s3.snap.card.title || ''), s3.snap.card)
      check(`${who} full: the team's row in the menu reads 100 %`, who === 'b' ? !!s3.snap.row && Number(s3.snap.row.pct) === 100 : true, s3.snap.row)
      if (who === 'a') note(`a (owner) near: the footer meter shows the TEAM pool (${s2.snap.card && s2.snap.card.pct}%), so the owner's own capped window at ${r2.w.used_percent}% is flagged only inside the menu's plan card`)
      await ctx.shot(g, `j5-${who}-3-full`)

      // a message sent now is refused by the server and DSH says why
      await g.selectModel('GLM')
      const t = await g.send(`J5 ${who} after the cap`)
      await g.until(() => chatCalls(ctx.rows(t)).length >= 1, 15000, 100)
      await sleep(3500)
      const refused = chatCalls(ctx.rows(t))
      const noticeNow = await g.text('[data-kb="quota-notice"]')
      const bodyText = (await g.body()).replace(/\n+/g, ' | ')
      const turnError = (bodyText.match(/This turn failed[^|]*\|?[^|]*\|?[^|]*/) || [''])[0]
      note(`${who} after the cap: statuses ${[...new Set(refused.map((c) => c.status))].join(',')}; the page says ${JSON.stringify(turnError.slice(0, 160))}`)
      note(`${who} after the cap: the quota notice says ${JSON.stringify(noticeNow)}`)
      check(`${who}: a message sent when the window is used up is refused by the server (not billed) and the page shows it`, refused.length > 0 && refused.every((c) => c.status >= 400) && /fail|exhaust|quota/i.test(bodyText), { statuses: refused.map((c) => c.status) })
      check(`${who}: the quota notice says what stopped him, that it comes back in about …, and where the cap was set`, typeof noticeNow === 'string' && /comes back in about/.test(noticeNow) && /cap set in/.test(noticeNow), noticeNow)
      await ctx.shot(g, `j5-${who}-4-refused`)
    } finally { await g.close(); await liftCap(capped.id) }
    rec[who] = states.map((s) => ({ state: s.state, server: s.server, lag: s.lag }))
  }
  await play('b', 'B (a member): the cap reaches him')
  ctx.calls = undefined
  await play('a', 'A (the owner): an owner-set cap reaches an owner')
  return finish()
}
