#!/usr/bin/env node
// Step 10 of the teams plan, SETUP half: two made-up accounts (A, B) and four team workspaces on a LOCAL replica, every team on the Team plan with seats, both
// personal workspaces on the Plus plan (the Free allowance is a few cents: a run would spend it in one turn), and A's invitation of B into T1 left PENDING
// (the link is in the replica's test mailbox, for the join journey to paste).
// Environment: see scripts/lib-e2e-server.mjs. Credentials are generated and kept only in $KB_E2E_DIR/accounts.json (mode 0600); nothing secret is printed.
// Idempotent: a step already recorded in accounts.json is not played again.
//   node scripts/e2e-teams-setup.mjs [--seats 3]
import { makeServer, env, fresh, readAccounts, writeAccounts } from './lib-e2e-server.mjs'

const args = process.argv.slice(2)
const seats = Number(args.indexOf('--seats') >= 0 ? args[args.indexOf('--seats') + 1] : 3)
const e = env()
const s = makeServer(e)
const must = (what, r, ok = [200, 201]) => { if (!ok.includes(r.status)) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body }

const acc = readAccounts(e)
for (const k of ['a', 'b']) {
  if (acc[k]) continue
  acc[k] = { ...fresh(k) }
  await s.signUp(acc[k].email, acc[k].password, acc[k].name)
  acc[k].id = (await s.signIn(acc[k].email, acc[k].password)).id
  writeAccounts(acc, e)
  console.log(`account ${k.toUpperCase()} created (credentials in accounts.json, mode 0600)`)
}
const A = await s.signIn(acc.a.email, acc.a.password)
const owner = await s.ownerSession()
acc.teams = acc.teams || {}
for (const [key, name, n] of [['t1', 'E2E Alpha', seats], ['t2', 'E2E Beta', seats], ['t3', 'E2E Delta', 2], ['t4', 'E2E Epsilon', seats]]) {
  if (acc.teams[key]) continue
  const w = must('create ' + name, await s.call('POST', '/v1/workspaces', { cookie: A.cookie, json: { name } }))
  acc.teams[key] = { id: w.id, name }
  must('grant the Team plan to ' + name, await owner.admin('PUT', `/v1/admin/billing/workspaces/${w.id}/subscription`, { plan: 'team', component: 'seats', quantity: n, replace: true }))
  writeAccounts(acc, e)
  console.log(`team ${key} = ${name} created on the Team plan with ${n} seats`)
}
for (const k of ['a', 'b']) {
  if (acc[k].personal) continue
  const U = await s.signIn(acc[k].email, acc[k].password)
  const list = must('workspaces of ' + k, await s.call('GET', '/v1/workspaces', { cookie: U.cookie }))
  acc[k].personal = (Array.isArray(list) ? list : list.workspaces).find((w) => w.personal === true).id
  must('grant the Plus plan to the personal workspace of ' + k, await owner.admin('PUT', `/v1/admin/billing/workspaces/${acc[k].personal}/subscription`, { plan: 'solo', component: 'solo', replace: true }))
  writeAccounts(acc, e)
  console.log(`personal workspace of ${k.toUpperCase()} on the Plus plan`)
}
if (!acc.invited) {
  // A invites B into T1 (a member). The link lands in the test mailbox; it is NOT accepted here.
  const inv = must('invite B', await s.call('POST', `/v1/workspaces/${acc.teams.t1.id}/invitations`, { cookie: A.cookie, json: { email: acc.b.email, role: 'member' } }))
  const mail = await s.mail(acc.b.email)
  if (!(typeof mail.text === 'string' && /\/invitations\/accept\?token=/.test(mail.text))) throw new Error('the invitation e-mail holds no link')
  acc.invited = inv.id || true
  writeAccounts(acc, e)
  console.log('invitation sent to B, link in the mailbox: yes')
}
console.log('setup complete')
