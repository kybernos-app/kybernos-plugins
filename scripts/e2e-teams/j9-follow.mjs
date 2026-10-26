// J9 — the active team follows the chat (option 2). A chat in a team's folder is billed to that team, every other chat to Personal; a switch is refused while a reply runs.
// Every case is played on the real page with the recording proxy in front of the replica, and the server's own usage read is compared with what the proxy saw:
//   1. an old T1 chat continued after switching to T2 is billed to T1 (header AND the server's usage read);
//   2. the first message of a new chat in T2's folder, typed while T1 is active (the page is not asked to follow: the host's claim-time switch alone), is billed to T2;
//   2b. the same with Personal active: the personal memory is not in the first request of a team chat (the host writes the chat's team before the step's system prompt is assembled);
//   3. a switch click while a turn is running is refused with one sentence, and nothing of that turn is billed to two teams;
//   4. a chat of another team opened while a turn runs shows the notice and the switch happens by itself when the turn ends;
//   5. a chat in an arbitrary (non-team) folder is billed to Personal.
// Then the invariant over the whole journey: every agent request carries the header of the team that owns the folder of its chat.
import { openGui, recorder, sleep, mainCalls, chatCalls, cwdOf, cwdOrWhy } from './common.mjs'
import { cookieDeSession } from '../cdp-lib.mjs'

export const run = async (ctx) => {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase() // chat titles are the stand-in's reply: unique per run
  const { check, note, finish, rec } = recorder(ctx, 'J9')
  const S = ctx.server
  ctx.as('a')
  const A = await ctx.sessionOf('a')
  const P = await ctx.personalId('a')
  const { t1, t2 } = ctx.ids
  const name = { [P]: 'Personal', [t1]: 'T1', [t2]: 'T2' }
  const idOf = { P, t1, t2 }
  const personalGroup = String(process.env.KB_WORKTREE || '').split('/').filter(Boolean).pop() || ''
  const ck = cookieDeSession(ctx.hostA)
  const hostCall = (method, path, body) => fetch('http://' + ctx.hostA + path, { method, headers: { 'content-type': 'application/json', cookie: ck.nom + '=' + ck.valeur, origin: 'http://' + ctx.hostA }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json())
  const hostSwitch = (id) => hostCall('POST', '/kybernos-cloud/space/active', { workspace_id: id })
  const hostBusy = () => hostCall('GET', '/kybernos-cloud/space/busy')
  const hostActive = async () => (await hostCall('GET', '/kybernos-cloud/status')).state.active_workspace_id
  // each call is worth 0.001 + 0.0004 USD at the stand-in model's price
  const usageNow = async (ws) => {
    const r = await S.call('GET', `/v1/workspaces/${ws}/llm/usage?group_by=model`, { cookie: A.cookie })
    const rows = r.status === 200 ? r.body.rows : []
    return { calls: rows.reduce((n, x) => n + x.calls, 0), cost: rows.reduce((n, x) => n + Number(x.cost_usd), 0) }
  }
  const has = (calls, word) => calls.filter((c) => (c.body || '').includes(word)).length
  const usageAll = async () => ({ [P]: await usageNow(P), [t1]: await usageNow(t1), [t2]: await usageNow(t2) })
  const deltas = (a, b) => Object.fromEntries([P, t1, t2].map((ws) => [name[ws], b[ws].calls - a[ws].calls]))
  // a scripted answer (the proxy makes it itself, to hold a turn) never reaches the replica, so the server never bills it
  const acceptedBy = (rows) => { const out = {}; for (const r of rows.filter((x) => x.method === 'POST' && x.path === '/v1/chat/completions' && x.status === 200 && x.scripted !== true)) out[name[r.workspace] || r.workspace] = (out[name[r.workspace] || r.workspace] || 0) + 1; return out }

  const runStart = Date.now()
  await ctx.engine({ text: 'Answer from the stand-in model.', prompt: 2000, completion: 200 })
  const g = await openGui(ctx.hostA)
  const sameCalls = (x, y) => JSON.stringify(Object.entries(x).filter(([, v]) => v > 0).sort()) === JSON.stringify(Object.entries(y).filter(([, v]) => v > 0).sort())
  const turn = async (text) => {
    await g.selectModel('GLM')
    const t = await g.send(text)
    await g.until(() => mainCalls(ctx.rows(t)).length >= 1, 15000, 50)
    await sleep(2500)
    const rows = ctx.rows(t)
    return { chats: chatCalls(rows), mains: mainCalls(rows), t }
  }
  const cardText = async () => (((await g.card()) || {}).text || '')
  const settled = (re) => g.until(async () => { const c = await g.card(); return c && !c.switching && re.test(c.text.slice(0, 60)) }, 15000, 50)
  /** Opens an old chat from the sidebar: the group of its folder is opened first when it is folded (the sidebar keeps the active team's folder open only). */
  const openChat = async (title, group) => {
    if ((await g.leaf(title)) === null) { await g.pressText(group); await sleep(800) }
    const ok = await g.until(() => g.pressText(title), 8000, 300)
    await sleep(300)
    return ok === true
  }

  try {
    await sleep(2500)
    await g.selectModel('GLM')

    // ── setup: one real chat in each place ─────────────────────────────────────────────────────────────────────────────────────────────────
    console.log('\n0. one chat in T1\'s folder, one in T2\'s, one in the personal workspace')
    await ctx.engine({ text: 'FOLLOWT1' + tag, prompt: 2000, completion: 200 })
    await g.goTo(t1, /E2E Alpha/)
    const c1 = await turn('J9 first message in T1')
    await ctx.engine({ text: 'FOLLOWT2' + tag, prompt: 2000, completion: 200 })
    await g.goTo(t2, /E2E Beta/)
    const c2 = await turn('J9 first message in T2')
    await ctx.engine({ text: 'FOLLOWPERS' + tag, prompt: 2000, completion: 200 })
    await g.goTo(P, /Personal/)
    const c3 = await turn('J9 first message in Personal')
    check('the three chats were billed to the team of their own folder', c1.chats.every((c) => c.workspace === t1) && c2.chats.every((c) => c.workspace === t2) && c3.chats.every((c) => c.workspace === P), { t1: c1.chats.map((c) => name[c.workspace]), t2: c2.chats.map((c) => name[c.workspace]), p: c3.chats.map((c) => name[c.workspace]) })
    await ctx.engine({ text: 'Answer from the stand-in model.', prompt: 2000, completion: 200 })

    // ── 1. an old T1 chat, continued while T2 is active ──────────────────────────────────────────────────────────────────────────────────────
    console.log('\n1. the T1 chat is opened again while T2 is active, and continued')
    await g.goTo(t2, /E2E Beta/)
    const before1 = await usageAll()
    const tMark1 = Date.now()
    check('the T1 chat could be opened from the sidebar', await openChat('FOLLOWT1' + tag, 'E2E Alpha'))
    const followed1 = await settled(/E2E Alpha/)
    note('click → the card says E2E Alpha, « Switching… » cleared after ' + (followed1 ? (Date.now() - tMark1) + ' ms' : 'NEVER'))
    check('the card follows: T1 is active (no click on a team, no new chat)', !!followed1 && (await hostActive()) === t1)
    const o1 = await turn('J9 continued in the T1 chat')
    check('every request of the continued chat carries T1 (proxy)', o1.chats.length > 0 && o1.chats.every((c) => c.workspace === t1), o1.chats.map((c) => name[c.workspace]))
    check('the chat works in T1\'s folder', ctx.ownerOfCwd(cwdOf(o1.mains[0])) === 't1', cwdOrWhy(o1.mains[0]))
    await sleep(1200)
    const after1 = await usageAll()
    const seen1 = acceptedBy(ctx.rows(tMark1))
    note('server usage read: ' + JSON.stringify(deltas(before1, after1)) + '; the proxy saw ' + JSON.stringify(seen1))
    check('the server billed T1 and nobody else, call for call as the proxy saw (usage read)', sameCalls(deltas(before1, after1), seen1) && deltas(before1, after1).T1 >= 1 && deltas(before1, after1).T2 === 0 && deltas(before1, after1).Personal === 0, { server: deltas(before1, after1), proxy: seen1 })
    await ctx.shot(g, 'j9-1-t1-continued')

    // ── 2. the first message of a new chat in T2's folder, T1 being active ───────────────────────────────────────────────────────────────────
    console.log('\n2. a NEW chat in T2\'s folder while T1 is active: the page is not asked to follow (the chat does not change), the host\'s claim-time switch is')
    check('the T2 chat could be opened from the sidebar', await openChat('FOLLOWT2' + tag, 'E2E Beta'))
    await settled(/E2E Beta/)
    const pressedNew = await g.val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^New chat/.test((x.innerText || '').trim())); if (b) b.click(); return !!b })()`)
    await sleep(1500)
    check('« New chat » opened a blank chat in T2\'s folder (it inherits the folder on screen)', pressedNew === true)
    const sw = await hostSwitch(t1)
    check('(a script makes T1 active behind the page: no reply runs, so the host allows it)', sw.ok === true && (await hostActive()) === t1, sw)
    await sleep(1500)
    const before2 = await usageAll()
    const tMark2 = Date.now()
    const o2 = await turn('J9 the first message of a new chat in T2\'s folder')
    check('its requests carry T2 (the host switched at claim time and held the first request)', o2.chats.length > 0 && o2.chats.every((c) => c.workspace === t2), o2.chats.map((c) => name[c.workspace]))
    check('and the chat works in T2\'s folder', ctx.ownerOfCwd(cwdOf(o2.mains[0])) === 't2', cwdOrWhy(o2.mains[0]))
    const first2 = o2.mains[0]
    note('Enter → the first request left after ' + (first2 ? first2.t0 - o2.t : '?') + ' ms')
    await sleep(1200)
    const after2 = await usageAll()
    check('the server billed T2 and nobody else (usage read)', sameCalls(deltas(before2, after2), acceptedBy(ctx.rows(tMark2))) && deltas(before2, after2).T2 >= 1 && deltas(before2, after2).T1 === 0, { server: deltas(before2, after2), proxy: acceptedBy(ctx.rows(tMark2)) })
    check('the host now says T2 is active', (await hostActive()) === t2)

    // ── 2b. Personal is active, the chat is a team's: the personal memory must not travel in its first request ────────────────────────────────────────
    console.log('\n2b. the same with PERSONAL active: the host writes the chat\'s team before the system prompt of the step is assembled, so the personal memory is cut')
    const WORD = 'OCELOT' + tag
    const made = await hostCall('POST', '/kybernos-cloud/memory/add', { content: `My J9 word is ${WORD}.`, kind: 'fact', source: 'manual' })
    check('(a personal memory holding a word is made through the memory route)', made.ok === true, made)
    await sleep(1500)
    // The control comes FIRST: in a personal chat, right now, the word reaches the model. Without it an absence below would only say the memory was not loaded yet.
    await g.goTo(P, /Personal/)
    const ctl = await turn('J9 what is my J9 word? (control, in a personal chat)')
    check('control: in a personal chat the personal memory word does reach the model (the memory is loaded: an absence below means something)', has(ctl.mains, WORD) >= 1, { mains: ctl.mains.length })
    check('(the control chat is billed to Personal)', ctl.chats.every((c) => c.workspace === P))
    check('the T2 chat could be opened from the sidebar again', await openChat('FOLLOWT2' + tag, 'E2E Beta'))
    await settled(/E2E Beta/)
    const pressedNew2 = await g.val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^New chat/.test((x.innerText || '').trim())); if (b) b.click(); return !!b })()`)
    await sleep(1500)
    check('« New chat » opened another blank chat in T2\'s folder', pressedNew2 === true)
    const swP = await hostSwitch(P)
    check('(a script makes Personal active behind the page)', swP.ok === true && (await hostActive()) === P, swP)
    await sleep(1500)
    const o2b = await turn('J9 what is my J9 word?')
    check('its requests carry T2', o2b.chats.length > 0 && o2b.chats.every((c) => c.workspace === t2), o2b.chats.map((c) => name[c.workspace]))
    check('and the chat works in T2\'s folder', ctx.ownerOfCwd(cwdOf(o2b.mains[0])) === 't2', cwdOrWhy(o2b.mains[0]))
    check('the personal memory word is in NO request of that turn (agent, title, classification): the cut was in place for the very first request', has(o2b.chats, WORD) === 0, { calls: o2b.chats.length, withWord: has(o2b.chats, WORD) })

    // ── 3. a switch click while a turn is running ──────────────────────────────────────────────────────────────────────────────────────────
    console.log('\n3. a click on another team while a turn runs (its first answer is held 7 s): refused, nothing billed to two teams')
    await settled(/E2E Beta/)
    const before3 = await usageAll()
    const tMark3 = Date.now()
    await ctx.script([{ name: 'memory_search', arguments: { q: 'anything' } }], 7000)
    await g.selectModel('GLM')
    const tTurn = await g.send('J9 a turn that stays running')
    const running = await g.until(async () => { const b = await hostBusy(); return b && b.busy === true ? b : null }, 8000, 100)
    check('(a reply is running in T2: the host says so)', !!running && running.running.space_id === t2, running)
    await g.pickSpace(t1)
    const flash = await g.until(() => g.text('[data-kb="foot-flash"]'), 4000, 50)
    check('the click is refused with one plain sentence naming the team the reply runs in', typeof flash === 'string' && flash.includes('A reply is still running in E2E Beta. Switching waits for it or stop it first.'), flash)
    await g.closeMenu()
    check('T2 is still active, the card did not move', (await hostActive()) === t2 && /E2E Beta/.test(await cardText()), await cardText())
    const refusal = await hostSwitch(t1)
    check('a script calling the same route meets the same refusal (turn_running)', refusal.ok === false && refusal.error === 'turn_running', refusal)
    await ctx.shot(g, 'j9-3-refused')
    await g.until(async () => mainCalls(ctx.rows(tTurn)).length >= 2, 25000, 100)
    await sleep(3000)
    const turn3 = mainCalls(ctx.rows(tTurn)).map((c) => name[c.workspace] || c.workspace)
    note('the turn that was running while the click was refused sent ' + turn3.length + ' agent requests: ' + turn3.join(' then '))
    check('every request of that turn carries T2: nothing was billed to two teams', turn3.length >= 2 && new Set(turn3).size === 1 && turn3[0] === 'T2', turn3)
    const after3 = await usageAll()
    check('the server billed T2 only (usage read)', sameCalls(deltas(before3, after3), acceptedBy(ctx.rows(tMark3))) && deltas(before3, after3).T1 === 0 && deltas(before3, after3).Personal === 0, { server: deltas(before3, after3), proxy: acceptedBy(ctx.rows(tMark3)) })
    check('the reply ended: the host says nobody is busy', (await hostBusy()).busy === false)
    await g.goTo(t1, /E2E Alpha/)
    check('and the same click now switches', (await hostActive()) === t1)

    // ── 4. a chat of another team opened while a turn runs: the notice, then the switch by itself ───────────────────────────────────────────
    console.log('\n4. a T2 chat opened while a T1 turn runs: the notice, then the switch happens by itself when the turn ends')
    await settled(/E2E Alpha/)
    const before4 = await usageAll()
    const tMark4 = Date.now()
    await ctx.script([{ name: 'memory_search', arguments: { q: 'anything' } }], 7000)
    await g.selectModel('GLM')
    const tTurn4 = await g.send('J9 another turn that stays running')
    await g.until(async () => { const b = await hostBusy(); return b && b.busy === true }, 8000, 100)
    check('(a reply is running in T1)', (await hostBusy()).running.space_id === t1)
    check('the T2 chat could be opened from the sidebar', await openChat('FOLLOWT2' + tag, 'E2E Beta'))
    const notice = await g.until(() => g.text('[data-kb="cue-mismatch"]'), 5000, 50)
    check('the notice says what is going on, where the person types', typeof notice === 'string' && notice === 'This chat belongs to E2E Beta; E2E Alpha stays active until the reply ends.', notice)
    check('T1 is still active while the reply runs', (await hostActive()) === t1 && /E2E Alpha/.test(await cardText()))
    await ctx.shot(g, 'j9-4-notice')
    await g.until(async () => mainCalls(ctx.rows(tTurn4)).length >= 2, 25000, 100)
    const lastEnd = Math.max(...ctx.rows(tTurn4).map((r) => r.t1 || 0))
    const byItself = await g.until(async () => /E2E Beta/.test((await cardText()).slice(0, 60)) && (await hostActive()) === t2, 20000, 50)
    note('the last reply request ended at +' + (lastEnd - tTurn4) + ' ms; the card said E2E Beta ' + (byItself ? (Date.now() - lastEnd) + ' ms later' : 'NEVER'))
    check('the switch happens by itself when the turn ends (no click on a team)', !!byItself)
    await settled(/E2E Beta/)
    check('and the notice is gone', (await g.text('[data-kb="cue-mismatch"]')) === null)
    const turn4 = mainCalls(ctx.rows(tTurn4)).map((c) => name[c.workspace] || c.workspace)
    check('the T1 turn itself was billed to T1 only', turn4.length >= 2 && new Set(turn4).size === 1 && turn4[0] === 'T1', turn4)
    const o4 = await turn('J9 typed in the T2 chat after the switch')
    check('a message in the T2 chat now carries T2', o4.chats.length > 0 && o4.chats.every((c) => c.workspace === t2), o4.chats.map((c) => name[c.workspace]))
    await sleep(1200)
    const after4 = await usageAll()
    check('the server billed T1 for the turn and T2 for the message, call for call as the proxy saw', sameCalls(deltas(before4, after4), acceptedBy(ctx.rows(tMark4))) && deltas(before4, after4).T1 >= 2 && deltas(before4, after4).T2 >= 1, { server: deltas(before4, after4), proxy: acceptedBy(ctx.rows(tMark4)) })

    // ── 5. a chat in an arbitrary folder ───────────────────────────────────────────────────────────────────────────────────────────────────
    console.log('\n5. a chat in a folder that is no team\'s, opened while T2 is active')
    const before5 = await usageAll()
    const tMark5 = Date.now()
    check('the personal chat could be opened from the sidebar', await openChat('FOLLOWPERS' + tag, personalGroup))
    const toPersonal = await settled(/Personal/)
    check('the card follows: Personal is active', !!toPersonal && (await hostActive()) === P, await cardText())
    const o5 = await turn('J9 continued in the personal chat')
    check('its requests carry Personal', o5.chats.length > 0 && o5.chats.every((c) => c.workspace === P), o5.chats.map((c) => name[c.workspace]))
    check('and the chat works in a folder that is no team\'s', ctx.ownerOfCwd(cwdOf(o5.mains[0])) === 'P', cwdOrWhy(o5.mains[0]))
    await sleep(1200)
    const after5 = await usageAll()
    check('the server billed Personal and nobody else (usage read)', sameCalls(deltas(before5, after5), acceptedBy(ctx.rows(tMark5))) && deltas(before5, after5).Personal >= 1 && deltas(before5, after5).T1 === 0 && deltas(before5, after5).T2 === 0, { server: deltas(before5, after5), proxy: acceptedBy(ctx.rows(tMark5)) })

    // ── the invariant over the whole journey ───────────────────────────────────────────────────────────────────────────────────────────────
    console.log('\nthe invariant: every agent request carries the header of the team that owns the folder of its chat')
    const all = mainCalls(ctx.rows(runStart))
    const wrong = all.filter((c) => idOf[ctx.ownerOfCwd(cwdOf(c))] !== c.workspace)
    check(`all ${all.length} agent requests of the journey (T1: ${all.filter((c) => c.workspace === t1).length}, T2: ${all.filter((c) => c.workspace === t2).length}, Personal: ${all.filter((c) => c.workspace === P).length}) are billed to the owner of their chat's folder`, all.length >= 8 && wrong.length === 0, wrong.map((c) => ({ header: name[c.workspace], folder: (cwdOf(c) || '').split('/').slice(-2).join('/') })))
    rec.requests = { agent: all.length, wrong: wrong.length }
  } finally { await g.close() }
  return finish()
}
