// J9 — a team's own DSH (docs/dev/team-profiles-cadrage.md). Account A's personal DSH starts the DSH of T1 and the DSH of T2 (the call the account menu makes); both stay alive at the same
// time next to the personal one. A message typed in each of the three is billed to its own space only, from its first request, and the server's usage read agrees. A team's DSH answers
// its team for good (no other space, nothing that belongs to the account), stopping one leaves the others running, and an account that is not in a team cannot open its DSH.
import { openGui, recorder, sleep, chatCalls } from './common.mjs'

export const run = async (ctx) => {
  const { check, note, finish, rec } = recorder(ctx, 'J9')
  const S = ctx.server
  ctx.as('a')
  const A = await ctx.sessionOf('a')
  const B = await ctx.sessionOf('b')
  const P = await ctx.personalId('a')
  const { t1, t2 } = ctx.ids
  const name = { [P]: 'Personal', [t1]: 'T1', [t2]: 'T2' }
  await ctx.engine({ text: 'Answer from the stand-in model.', prompt: 2000, completion: 200 })
  const usageNow = async (ws) => {
    const r = await S.call('GET', `/v1/workspaces/${ws}/llm/usage?group_by=model`, { cookie: A.cookie })
    const rows = r.status === 200 ? r.body.rows : []
    return { calls: rows.reduce((n, x) => n + x.calls, 0) }
  }
  const runStart = Date.now()
  const before = { [P]: await usageNow(P), [t1]: await usageNow(t1), [t2]: await usageNow(t2) }
  const personal = ctx.hostOf('a')

  // ── 1. both team DSH start, next to the personal one ─────────────────────────────────────────────────────────────────────────────────────
  console.log('\n1. A\'s personal DSH starts the DSH of T1 and of T2')
  const T1 = await ctx.teamOf('a', t1)
  check('T1\'s DSH started (or was found) and answered an address', T1.open.ok === true && typeof T1.open.url === 'string' && typeof T1.open.signed_url === 'string', T1.open)
  const T2 = await ctx.teamOf('a', t2)
  check('T2\'s DSH started too', T2.open.ok === true, T2.open)
  if (T1.open.ok !== true || T2.open.ok !== true) { note('the team DSH did not start: nothing more can be played'); return finish() }
  note(`T1 on :${T1.open.port}, T2 on :${T2.open.port}, personal on ${ctx.hostA}`)
  check('they are two different processes on two different ports in the team range', T1.open.port !== T2.open.port && [T1.open.port, T2.open.port].every((p) => p >= 3300 && p <= 3399), [T1.open.port, T2.open.port])
  const listed = await personal('GET', '/kybernos-cloud/team-dsh/list')
  const ids = (listed.teams || []).filter((x) => x.running === true).map((x) => x.team_id)
  check('the personal DSH lists both as running', ids.includes(t1) && ids.includes(t2), listed)
  const status = { [P]: (await personal('GET', '/kybernos-cloud/status')).state, [t1]: (await T1.call('GET', '/kybernos-cloud/status')).state, [t2]: (await T2.call('GET', '/kybernos-cloud/status')).state }
  check('each DSH answers its own space: T1\'s names T1, T2\'s names T2, the personal one names Personal', status[t1].active_workspace_id === t1 && status[t2].active_workspace_id === t2 && status[P].active_workspace_id === P, [status[t1].active_workspace_id, status[t2].active_workspace_id, status[P].active_workspace_id].map((x) => (x || '-').slice(0, 8)))
  check('a team\'s DSH knows it is one (team_dsh), the personal one does not', status[t1].team_dsh === t1 && status[t2].team_dsh === t2 && !status[P].team_dsh, [status[t1].team_dsh, status[P].team_dsh])
  const away = await T1.call('POST', '/kybernos-cloud/space/active', { workspace_id: P })
  check('T1\'s DSH refuses to move to another space', away.ok === false && away.error === 'espace_fixe', away)
  const kyber = await T1.call('GET', '/kybernos-cloud/kyber')
  check('what belongs to the account stays out of a team\'s DSH (Kaby answers personal_only)', kyber.status === 403 && kyber.error === 'personal_only', kyber)
  const members = (await S.call('GET', `/v1/workspaces/${t2}/members`, { cookie: A.cookie })).body
  const bIn = (Array.isArray(members) ? members : members.members || []).some((m) => (m.user_id || m.id) === B.id)
  if (bIn) note('B is a member of T2: the refusal for a non-member is not played')
  else {
    const hostB = ctx.hostOf('b')
    const refused = await hostB('POST', '/kybernos-cloud/team-dsh/open', { workspace_id: t2 })
    check('B, who is not in T2, cannot open its DSH', refused.ok === false, refused)
    ctx.as('a')
  }

  // ── 2. a message in each DSH is billed to its own space ──────────────────────────────────────────────────────────────────────────────────
  console.log('\n2. one message typed in T1\'s DSH, one in T2\'s, one in the personal one')
  const rounds = [[t1, T1, /E2E Alpha/], [t2, T2, /E2E Beta/], [P, null, /Personal/]]
  for (const [ws, team, label] of rounds) {
    const host = team !== null ? team.host : ctx.as('a')
    if (team !== null) process.env.DSH_HOME = ctx.homeOfTeam('a', ws)
    const g = await openGui(host)
    try {
      await sleep(2500)
      const card = await g.card()
      check(`${name[ws]}'s page: the card names ${name[ws]}`, card !== null && label.test(card.text.slice(0, 60)), card)
      if (ws === t1) {
        const rows = await g.spaceRowsAny()
        note('T1\'s page lists ' + rows.length + ' space(s) in its menu: ' + rows.map((r) => r.name).join(', '))
      }
      await g.selectModel('GLM')
      const tSend = await g.send(`J9 round in ${name[ws]}`)
      await g.until(() => ctx.rows(tSend).filter((r) => r.path === '/v1/chat/completions').length >= 1, 15000, 100)
      await sleep(2500)
      const calls = chatCalls(ctx.rows(tSend))
      check(`${name[ws]}'s DSH: every model request of the turn carries ${name[ws]}'s workspace header, from the first one`, calls.length >= 1 && calls.every((c) => c.workspace === ws), { calls: calls.length, headers: calls.map((c) => (c.workspace || '-').slice(0, 8)), want: ws.slice(0, 8) })
      await ctx.shot(g, `j9-${name[ws]}`)
    } finally { await g.close() }
  }

  // ── 3. the server's own read ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n3. the server\'s usage read per workspace')
  await sleep(1200)
  const after = { [P]: await usageNow(P), [t1]: await usageNow(t1), [t2]: await usageNow(t2) }
  const accepted = {}
  for (const r of ctx.rows(runStart).filter((r) => r.method === 'POST' && r.path === '/v1/chat/completions' && r.status === 200)) accepted[r.workspace] = (accepted[r.workspace] || 0) + 1
  for (const ws of [P, t1, t2]) check(`${name[ws]}: the server counted exactly the accepted requests that carried ${name[ws]}'s header`, after[ws].calls - before[ws].calls === (accepted[ws] || 0) && (accepted[ws] || 0) >= 1, { server: after[ws].calls - before[ws].calls, proxy: accepted[ws] || 0 })

  // ── 4. stopping one leaves the others ────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n4. stop T2\'s DSH')
  ctx.as('a')
  const stopped = await personal('POST', '/kybernos-cloud/team-dsh/stop', { workspace_id: t2 })
  check('T2\'s DSH stopped', stopped.ok === true, stopped)
  await sleep(1500)
  const left = await personal('GET', '/kybernos-cloud/team-dsh/list')
  const leftIds = (left.teams || []).filter((x) => x.running === true).map((x) => x.team_id)
  check('the registry lists T1 and no longer T2', leftIds.includes(t1) && !leftIds.includes(t2), left)
  const stillT1 = await T1.call('GET', '/kybernos-cloud/status').catch(() => null)
  check('T1\'s DSH is still answering', stillT1 !== null && stillT1.ok === true && stillT1.state.active_workspace_id === t1, stillT1 && stillT1.status)
  await personal('POST', '/kybernos-cloud/team-dsh/stop', { workspace_id: t1 })
  rec.ports = { t1: T1.open.port, t2: T2.open.port }
  return finish()
}
