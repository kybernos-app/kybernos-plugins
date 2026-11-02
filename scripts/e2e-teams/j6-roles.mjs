// J6 — roles. B (member) has no « Manage » and no « Add credits »; A (owner) does; B promoted to admin gets them; back to member they go again.
// « Add credits » is offered when the team's pool is used up: T3 is filled by one big model call of A's (the stand-in bills the tokens it is told to).
import { openGui, recorder, sleep, mainCalls } from './common.mjs'
import { cookieDeSession } from '../cdp-lib.mjs'

export const run = async (ctx) => {
  const { check, note, finish } = recorder(ctx, 'J6')
  const S = ctx.server
  const A = await ctx.sessionOf('a')
  const B = await ctx.sessionOf('b')
  const t3 = ctx.acc.teams.t3 && ctx.acc.teams.t3.id
  if (!t3) throw new Error('T3 (E2E Delta) is not in accounts.json')
  // B must be a member of T3 (the setup leaves him out of it)
  const inT3 = (await S.call('GET', `/v1/workspaces/${t3}/members`, { cookie: A.cookie })).body
  if (!(Array.isArray(inT3) ? inT3 : inT3.members || []).some((m) => (m.user_id || m.id) === B.id)) await S.call('POST', `/v1/workspaces/${t3}/members`, { cookie: A.cookie, json: { user_id: B.id, role: 'member' } })
  const refresh = (who) => { const host = ctx.as(who); const ck = cookieDeSession(host); return fetch('http://' + host + '/kybernos-cloud/refresh', { method: 'POST', headers: { 'content-type': 'application/json', cookie: ck.nom + '=' + ck.valeur, origin: 'http://' + host }, body: '{}' }).then((r) => r.json()) }
  const poolOf = async (cookie) => { const b = (await S.call('GET', `/v1/workspaces/${t3}/llm/budget`, { cookie })).body.windows; return b.filter((w) => w.kind === 'pool').map((w) => `${w.window_seconds}:${w.used_percent}${w.exhausted ? '!' : ''}`) }
  const menuFacts = async (g) => {
    await g.openMenu(); await sleep(900)
    const facts = {
      manage: await g.exists('[data-kb="menu-plan-manage"]'), credits: await g.exists('[data-kb="menu-plan-credits"]'),
      card: await g.text('[data-kb="menu-plan-card"]'), role: (await g.spaceRows()).find((r) => r.current)?.sub,
    }
    return facts
  }

  // 1. fill the pool of T3 with one big call of A's
  console.log('\n1. T3 is filled by one big model call of A\'s')
  await ctx.engine({ text: 'POOLFILL', prompt: 4000000, completion: 5 })
  const gA = await openGui(ctx.as('a'))
  let factsA = null, factsA0 = null
  try {
    await sleep(2500)
    await refresh('a')
    await gA.goTo(t3, /E2E Delta/)
    factsA0 = await menuFacts(gA)
    note('A (owner) in T3 before the pool is used: ' + JSON.stringify({ manage: factsA0.manage, credits: factsA0.credits, role: factsA0.role }))
    check('A (owner), pool not used up: « Manage » is there, « Add credits » is not', factsA0.manage === true && factsA0.credits === false, factsA0)
    await ctx.shot(gA, 'j6-owner-normal')
    await gA.closeMenu()
    await gA.selectModel('GLM')
    const t = await gA.send('J6 fill the pool of T3')
    await gA.until(() => mainCalls(ctx.rows(t)).length >= 1, 15000, 100)
    await sleep(3000)
    await ctx.engine({ text: 'Answer from the stand-in model.', prompt: 50, completion: 5 })
    const pool = await poolOf(A.cookie)
    note('T3 pool windows (seconds:percent, ! = used up): ' + pool.join('  '))
    check('the 5-hour pool of T3 is used up', pool.some((p) => p.startsWith('18000:100!')), pool)
    await sleep(2500)
    await gA.reload(); await sleep(2000)
    factsA = await menuFacts(gA)
    note('A (owner), pool used up: ' + JSON.stringify({ manage: factsA.manage, credits: factsA.credits }))
    check('A (owner), pool used up: « Manage » and « Add credits » are both offered', factsA.manage === true && factsA.credits === true, factsA)
    await ctx.shot(gA, 'j6-owner-full')
    if (factsA.credits) {
      await gA.press('[data-kb="menu-plan-credits"]'); await sleep(2500)
      const dlg = await gA.exists('[data-kb="upgrade-dialog"]')
      const opened = await gA.val('(window.__kbOpened || []).length')
      note('pressing « Add credits » (A): dialog=' + dlg + ', windows opened=' + opened + ', text=' + JSON.stringify((await gA.text('[data-kb="upgrade-dialog"]')) || '').slice(0, 200))
      await ctx.shot(gA, 'j6-owner-credits')
      await gA.key('Escape', 'Escape', 27); await sleep(500)
    }
  } finally { await gA.close() }

  // 2. B as member, then admin, then member again
  console.log('\n2. B\'s menu in T3 as a member, as an admin, as a member again')
  const gB = await openGui(ctx.as('b'))
  try {
    await sleep(2500)
    await refresh('b')
    await gB.goTo(t3, /E2E Delta/)
    const fm = await menuFacts(gB)
    note('B (member), pool used up: ' + JSON.stringify({ manage: fm.manage, credits: fm.credits, role: fm.role, card: fm.card }))
    check('B (member), pool used up: no « Manage » and no « Add credits »', fm.manage === false && fm.credits === false, fm)
    check('B (member) sees the team\'s bar (the pool state) and his own', /Team/.test(fm.card || '') && /You/.test(fm.card || ''), fm.card)
    await ctx.shot(gB, 'j6-member-full')
    await gB.closeMenu()
    const mem = (await S.call('GET', `/v1/workspaces/${t3}/members`, { cookie: A.cookie })).body
    const row = (Array.isArray(mem) ? mem : mem.members).find((m) => (m.user_id || m.id) === B.id)
    const promote = await S.call('PATCH', `/v1/workspaces/${t3}/members/${B.id}`, { cookie: A.cookie, json: { role: 'admin' } })
    check('A made B an admin of T3', promote.status === 200, promote.status)
    await refresh('b'); await gB.reload(); await sleep(2500)
    const fa = await menuFacts(gB)
    note('B (admin), pool used up: ' + JSON.stringify({ manage: fa.manage, credits: fa.credits, role: fa.role }))
    check('B (admin), pool used up: « Manage » and « Add credits » appear', fa.manage === true && fa.credits === true, fa)
    await ctx.shot(gB, 'j6-admin-full')
    await gB.closeMenu()
    await S.call('PATCH', `/v1/workspaces/${t3}/members/${B.id}`, { cookie: A.cookie, json: { role: 'member' } })
    await refresh('b'); await gB.reload(); await sleep(2500)
    const fb = await menuFacts(gB)
    check('B (member again): both are gone', fb.manage === false && fb.credits === false, fb)
  } finally { await gB.close() }
  return finish()
}
