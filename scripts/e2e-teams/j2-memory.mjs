// J2 — memory. A personal memory holding a canary word is made through the real memory route. In a team chat no recorded request body may contain it and the
// memory and lesson tools must refuse; in a personal chat it is there. The switch in the middle of a session is played in both directions.
import { openGui, recorder, sleep, mainCalls, chatCalls, flatten, bodyOf, cwdOf } from './common.mjs'
import { cookieDeSession } from '../cdp-lib.mjs'

const CANARY = 'ZEBRA-7731'

export const run = async (ctx) => {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase() // chat titles are the stand-in's reply: unique per run so a sidebar press cannot hit an older chat
  const { check, note, finish, rec } = recorder(ctx, 'J2')
  const S = ctx.server
  ctx.as('a')
  const A = await ctx.sessionOf('a')
  const P = await ctx.personalId('a')
  const { t1 } = ctx.ids
  await ctx.engine({ text: 'Answer from the stand-in model.', prompt: 50, completion: 5 })
  const ck = cookieDeSession(ctx.hostA)
  const host = (method, path, body) => fetch('http://' + ctx.hostA + path, { method, headers: { 'content-type': 'application/json', cookie: ck.nom + '=' + ck.valeur, origin: 'http://' + ctx.hostA }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json())
  const serverMemories = async () => { const r = await S.call('GET', '/v1/memories', { cookie: A.cookie }); const list = Array.isArray(r.body) ? r.body : r.body.memories || r.body.items || []; return list }

  // 1. the memory, through the host's real route (the person's own hand)
  console.log('\n1. the personal memory')
  const before = await serverMemories()
  if (before.some((m) => String(m.content).includes(CANARY))) note('the canary memory already exists on the server (an earlier run): reused')
  else {
    const made = await host('POST', '/kybernos-cloud/memory/add', { content: `My lucky code word is ${CANARY}.`, kind: 'fact', source: 'manual' })
    check('the memory route accepted the canary', made.ok === true, made)
    const afterAdd = await serverMemories()
    check('the server now holds it (and only it was added)', afterAdd.length === before.length + 1 && afterAdd.some((m) => String(m.content).includes(CANARY)), { before: before.length, after: afterAdd.length })
  }
  await sleep(1500)

  const g = await openGui(ctx.hostA)
  // one message in the chat on screen; resolves the model requests the turn caused
  const turn = async (text) => {
    await g.selectModel('GLM')
    const t = await g.send(text)
    await g.until(() => mainCalls(ctx.rows(t)).length >= 1, 15000, 100)
    await sleep(2500)
    const rows = ctx.rows(t)
    return { rows, chats: chatCalls(rows), mains: mainCalls(rows), t }
  }
  const has = (calls, word) => calls.filter((c) => (c.body || '').includes(word)).length
  try {
    await sleep(2500)
    // 2. a personal chat
    console.log('\n2. a personal chat')
    await g.goTo(P, /Personal/)
    const p1 = await turn('J2 personal: what is my lucky code word?')
    check('personal chat: the canary is in the body of the model request', has(p1.mains, CANARY) >= 1, { mains: p1.mains.length })
    check('personal chat: every request carries the personal workspace', p1.chats.every((c) => c.workspace === P))

    ctx.script([{ name: 'memory_search', arguments: { q: 'lucky code word' } }])
    const p2 = await turn('J2 personal tool: look up my lucky code word with memory_search')
    const toolsP = p2.mains.flatMap((m) => (bodyOf(m)?.messages || []).filter((x) => x.role === 'tool').map((x) => (typeof x.content === 'string' ? x.content : JSON.stringify(x.content))))
    check('personal chat: memory_search answers with the canary', toolsP.some((t) => t.includes(CANARY)), toolsP.map((t) => t.slice(0, 120)))

    // 3. a team chat
    console.log('\n3. a team chat (T1)')
    await g.goTo(t1, /E2E Alpha/)
    const memBefore = (await serverMemories()).length
    const tm1 = await turn('J2 team: what is my lucky code word?')
    check('team chat: no request body of the turn contains the canary (agent, title and classification calls)', has(tm1.chats, CANARY) === 0, { calls: tm1.chats.length, withCanary: has(tm1.chats, CANARY) })
    check('team chat: every request carries T1', tm1.chats.length > 0 && tm1.chats.every((c) => c.workspace === t1))
    check('team chat: the OFF marker leads the request (system role)', tm1.mains.some((m) => (bodyOf(m)?.messages || []).some((x) => x.role === 'system' && flatten({ body: JSON.stringify({ messages: [x] }) }).includes('KYBERNOS MEMORY OFF'))), tm1.mains.length)

    ctx.script([
      { name: 'memory_search', arguments: { q: 'lucky code word ZEBRA' } },
      { name: 'memory_write', arguments: { content: 'ZEBRA-9904 written from a team chat', kind: 'fact' } },
      { name: 'lesson_search', arguments: { q: 'ZEBRA' } },
      { name: 'lesson_write', arguments: { text: 'ZEBRA-9904 lesson written from a team chat' } },
    ])
    const tm2 = await turn('J2 team tools: call the memory and lesson tools')
    const toolMsgs = tm2.mains.flatMap((m) => (bodyOf(m)?.messages || []).filter((x) => x.role === 'tool').map((x) => (typeof x.content === 'string' ? x.content : JSON.stringify(x.content))))
    note('team tool results: ' + JSON.stringify([...new Set(toolMsgs)].map((t) => t.slice(0, 140))))
    check('team chat: the four tools answered (one result each)', new Set(toolMsgs).size >= 1 && toolMsgs.length >= 4, toolMsgs.length)
    check('team chat: none of the tool results contains the canary', toolMsgs.every((t) => !t.includes(CANARY)))
    check('team chat: every tool result is a refusal', toolMsgs.length >= 4 && toolMsgs.every((t) => /team|Propose/i.test(t)), toolMsgs.map((t) => t.slice(0, 100)))
    await sleep(1500)
    const memAfter = await serverMemories()
    check('team chat: nothing was written to the personal memory on the server (tool, capture)', memAfter.length === memBefore && !memAfter.some((m) => String(m.content).includes('ZEBRA-9904')), { before: memBefore, after: memAfter.length })

    // 4. the switch in the middle of a session, both ways. A person does it by switching (a new chat opens) and then going back to the old chat in the sidebar.
    console.log('\n4. a chat that began in one space is opened again from the sidebar while the OTHER space is active (the active team follows the chat)')
    const sectionStart = Date.now()
    const goTo = (id, label) => g.goTo(id, label)
    // the sidebar folds the folders that are not the active team's: the personal workspace's group is named after the checkout the sandbox serves
    const personalGroup = String(process.env.KB_WORKTREE || '').split('/').filter(Boolean).pop() || ''
    const reopen = async (title, group) => {
      if ((await g.leaf(title)) === null) { await g.pressText(group); await sleep(800) }
      const ok = await g.until(() => g.pressText(title), 8000, 300)
      await sleep(1500)
      await g.until(async () => { const c = await g.card(); return c && !c.switching }, 15000, 100)
      return ok === true
    }
    // a personal chat, opened again while a team is active: it follows to Personal, it is billed to Personal and it is the person's own chat, so the canary may reach the model
    await ctx.engine({ text: 'PERSONALBORN' + tag, prompt: 50, completion: 5 })
    await goTo(P, /Personal/)
    const m1 = await turn('J2 mid-session one (personal): my lucky code word?')
    check('personal chat: the first message carries the canary', has(m1.mains, CANARY) >= 1)
    await goTo(t1, /E2E Alpha/)
    const opened1 = await reopen('PERSONALBORN' + tag, personalGroup)
    check('personal chat: it could be opened again from the sidebar while T1 is active', opened1 === true)
    check('the card says Personal: the active team followed the chat', /Personal/.test(((await g.card()) || {}).text || ''), await g.card())
    const m2 = await turn('J2 mid-session two (the same personal chat): my lucky code word?')
    check('personal chat, continued while T1 was active: every request is billed to Personal (the chat\'s folder is no team\'s)', m2.chats.length > 0 && m2.chats.every((c) => c.workspace === P), m2.chats.map((c) => c.workspace))
    check('personal chat: the canary reaches the model (it is the person\'s own chat)', has(m2.mains, CANARY) >= 1)
    // a team chat, opened again while Personal is active: it follows to the team, billed to the team, never a canary
    await ctx.engine({ text: 'TEAMBORN' + tag, prompt: 50, completion: 5 })
    await goTo(P, /Personal/) // leave the team first: choosing the team already on screen would keep the old chat
    await goTo(t1, /E2E Alpha/)
    const n1 = await turn('J2 born in the team: my lucky code word?')
    check('born in the team: no canary, billed to T1', has(n1.chats, CANARY) === 0 && n1.chats.every((c) => c.workspace === t1))
    await goTo(P, /Personal/)
    const opened2 = await reopen('TEAMBORN' + tag, 'E2E Alpha')
    check('team chat: it could be opened again from the sidebar while Personal is active', opened2 === true)
    check('the card says E2E Alpha: the active team followed the chat', /E2E Alpha/.test(((await g.card()) || {}).text || ''), await g.card())
    const n2 = await turn('J2 born in the team, continued while Personal was active: my lucky code word?')
    check('team chat, continued while Personal was active: every request is billed to T1', n2.chats.length > 0 && n2.chats.every((c) => c.workspace === t1), n2.chats.map((c) => c.workspace))
    check('team chat: the canary does not reach the model', has(n2.chats, CANARY) === 0, { calls: n2.chats.length })
    note('the continued team chat\'s folder is ' + (cwdOf(n2.mains[0]) || '?'))
    // the invariant of the whole section: nothing billed to a team carries the personal memory
    const teamRows = ctx.rows(sectionStart).filter((r) => r.method === 'POST' && r.path === '/v1/chat/completions' && r.workspace !== P)
    check('across this whole section, no request billed to a team carries the canary (' + teamRows.length + ' requests)', teamRows.length > 0 && has(teamRows, CANARY) === 0, { teamRows: teamRows.length, withCanary: has(teamRows, CANARY) })
    // 5. the one door left: a lesson the team approved reaches the team's chats (B's here) and never a personal chat
    console.log('\n5. a team lesson, written by A in T1, in B\'s chats')
    const B = await ctx.sessionOf('b')
    const mem = (await S.call('GET', `/v1/workspaces/${t1}/members`, { cookie: A.cookie })).body
    if (!(Array.isArray(mem) ? mem : mem.members || []).some((m) => (m.user_id || m.id) === B.id)) await S.call('POST', `/v1/workspaces/${t1}/members`, { cookie: A.cookie, json: { user_id: B.id, role: 'member' } })
    const hostFor = (who) => { const h = ctx.as(who); const c = cookieDeSession(h); return (method, path, body) => fetch('http://' + h + path, { method, headers: { 'content-type': 'application/json', cookie: c.nom + '=' + c.valeur, origin: 'http://' + h }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json()) }
    const hostB = hostFor('b')
    await hostB('POST', '/kybernos-cloud/refresh')
    const hostA = hostFor('a')
    ctx.as('a')
    await hostA('POST', '/kybernos-cloud/space/active', { workspace_id: t1 })
    const added = await hostA('POST', '/kybernos-cloud/team/lessons/add', { text: `Team rule ${tag}: always end a reply with the word ahoy.` })
    check('A (owner) proposed a team lesson through the page\'s own route and it is approved', added.ok === true && added.lesson && added.lesson.status === 'approved', added)
    const gB = await openGui(ctx.as('b'))
    try {
      await sleep(2500)
      await gB.goTo(t1, /E2E Alpha/); await sleep(1500)
      await gB.selectModel('GLM')
      const tb = await gB.send('J2 lesson probe in the team')
      await gB.until(() => mainCalls(ctx.rows(tb)).length >= 1, 15000, 100); await sleep(2000)
      check('B\'s team chat: the approved lesson is in the request', has(mainCalls(ctx.rows(tb)), `Team rule ${tag}`) >= 1)
      await gB.goTo(ctx.acc.b.personal, /Personal/); await sleep(1500)
      await gB.selectModel('GLM')
      const tp = await gB.send('J2 lesson probe in personal')
      await gB.until(() => mainCalls(ctx.rows(tp)).length >= 1, 15000, 100); await sleep(2000)
      check('B\'s personal chat: the team lesson is not in the request', has(chatCalls(ctx.rows(tp)), `Team rule ${tag}`) === 0)
    } finally { await gB.close() }
    await ctx.shot(g, 'j2-end')
  } finally { await g.close() }
  return finish()
}
