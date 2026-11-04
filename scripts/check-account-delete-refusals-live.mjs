#!/usr/bin/env node
// Case J03-04 of docs/tests/user-journey: deleting an account on a DISPOSABLE replica of the server, the four outcomes and the two refusals that come before them.
// The phone app has no deletion control of its own: its account menu opens the server's account page, whose « Delete my account » card calls `POST /v1/me/delete`. This plays that call
// with made-up accounts and quotes what the server answers, so the words the page shows for each refusal can be compared with them.
//
//   node scripts/check-account-delete-refusals-live.mjs --api http://localhost:8891 --control http://127.0.0.1:8892 --state <replica-state.json>
//
// Played: the phrase missing (400, nothing changed), a wrong password (401), the person owns a team that has another member (409 owns_workspaces), a team plan still paid (409
// active_subscription), the only owner of the platform (409 last_platform_owner, needs --state: the replica's made-up owner, never printed), then a plain account (200, and the sign-in is
// refused afterwards). Refuses any address that is not loopback. Exit 0 when every check passed, 1 when one failed, 2 on a wrong call, 3 when the replica is not there.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isLoopback, ownerCookie } from './replica-owner-settings.mjs'
import { makeClient, signUp } from './check-stripe-replica-money.mjs'

const PHRASE = 'DELETE MY ACCOUNT'
const PASSWORD = 'correct horse battery staple'

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : '' }
  const api = (opt('--api') || '').replace(/\/$/, '')
  const control = (opt('--control') || '').replace(/\/$/, '')
  if (!api || !control) { console.error('usage: check-account-delete-refusals-live --api <loopback url> --control <loopback url> [--state <replica-state.json>]'); process.exit(2) }
  if (!isLoopback(api) || !isLoopback(control)) { console.error('check-account-delete-refusals-live: both addresses must be loopback (a replica, never a real server)'); process.exit(2) }
  const c = makeClient(api, control)
  try { await fetch(api + '/.well-known/kybernos-server.json') } catch { console.error('no replica answers at ' + api); process.exit(3) }

  const results = []
  const said = {}
  const check = async (id, title, fn) => {
    try { const detail = await fn(); results.push({ id, ok: true }); console.log(`  ok ${id} ${title}${detail ? ' (' + detail + ')' : ''}`) } catch (e) {
      if (e && e.skip) { results.push({ id, ok: null }); console.log(`  - ${id} ${title}: skipped, ${e.message}`) } else { results.push({ id, ok: false }); console.log(`  FAIL ${id} ${title}: ${String(e.message || e).slice(0, 300)}`) }
    }
  }
  const must = (ok, msg) => { if (!ok) throw new Error(msg) }
  const skip = (msg) => { const e = new Error(msg); e.skip = true; throw e }
  const del = (cookie, json) => c.call('POST', '/v1/me/delete', { cookie, json })
  const idOf = async (cookie) => (await c.call('GET', '/v1/me', { cookie })).body?.id ?? (await c.call('GET', '/v1/me', { cookie })).body?.user?.id
  const quote = (r) => `${r.status} ${r.body?.error ?? ''}: “${String(r.body?.message ?? '').slice(0, 160)}”`

  console.log('J03-04 deleting an account, on the replica')

  const alice = await signUp(c, 'del-a')
  await check('D1', 'the phrase missing: refused, nothing changed', async () => {
    const r = await del(alice.cookie, { password: PASSWORD, confirm: 'delete my account' })
    must(r.status === 400, `status ${r.status}`)
    must((await c.call('GET', '/v1/me', { cookie: alice.cookie })).status === 200, 'the session did not survive the refusal')
    said.D1 = quote(r)
    return quote(r)
  })
  await check('D2', 'a wrong password: refused, nothing changed', async () => {
    const r = await del(alice.cookie, { password: PASSWORD + 'x', confirm: PHRASE })
    must(r.status === 401 && r.body?.error === 'invalid_password', `status ${r.status} ${r.body?.error}`)
    said.D2 = quote(r)
    return quote(r)
  })

  await check('D3', 'the owner of a team that has another member is refused (owns_workspaces) and the team is named', async () => {
    const mate = await signUp(c, 'del-m')
    const mateId = await idOf(mate.cookie)
    const team = (await c.call('POST', '/v1/workspaces', { cookie: alice.cookie, json: { name: 'Delete refusal team' } })).body?.id
    must(team, 'no team was made')
    const added = await c.call('POST', `/v1/workspaces/${team}/members`, { cookie: alice.cookie, json: { user_id: mateId, role: 'member' } })
    must(added.status === 200, `member not added: ${added.status}`)
    const r = await del(alice.cookie, { password: PASSWORD, confirm: PHRASE })
    must(r.status === 409 && r.body?.error === 'owns_workspaces', `status ${r.status} ${r.body?.error}`)
    must(JSON.stringify(r.body?.workspaces ?? []).includes('Delete refusal team'), 'the team is not named')
    said.D3 = quote(r) + ' workspaces=' + JSON.stringify(r.body.workspaces)
    alice.team = team
    return quote(r)
  })

  await check('D4', 'a team plan still paid is refused (active_subscription) and says where it is cancelled', async () => {
    const bob = await signUp(c, 'del-b')
    const ws = (await c.call('POST', '/v1/workspaces', { cookie: bob.cookie, json: { name: 'Delete paid team' } })).body?.id
    must(ws, 'no team was made')
    const sess = await c.call('POST', `/v1/workspaces/${ws}/billing/checkout`, { cookie: bob.cookie, json: { plan: 'team', component: 'band:0', quantity: 2, currency: 'USD', interval: 'year' } })
    must(sess.status === 200, `checkout ${sess.status}`)
    const paid = await c.ctl('/__/stripe/pay', { session_id: sess.body.session_id })
    must(paid.status === 200, `stand-in pay ${paid.status}`)
    const r = await del(bob.cookie, { password: PASSWORD, confirm: PHRASE })
    must(r.status === 409 && r.body?.error === 'active_subscription', `status ${r.status} ${r.body?.error}`)
    must(JSON.stringify(r.body?.workspaces ?? []).includes('Delete paid team'), 'the team is not named')
    said.D4 = quote(r) + ' workspaces=' + JSON.stringify(r.body.workspaces)
    return quote(r)
  })

  await check('D5', 'the last owner of the platform is refused (last_platform_owner)', async () => {
    const stateFile = opt('--state')
    if (!stateFile) skip('no --state: the replica\'s owner was not used')
    const owner = JSON.parse(readFileSync(stateFile, 'utf8')).owner
    if (!owner) skip('the replica was not seeded with an owner')
    const cookie = await ownerCookie(api, owner)
    // The owner has a second factor: the page asks for its code too; the server reads the same fields.
    const { totp } = await import('./replica-owner-settings.mjs')
    const r = await del(cookie, { password: owner.password, confirm: PHRASE, code: totp(owner.totp_secret) })
    must(r.status === 409 && r.body?.error === 'last_platform_owner', `status ${r.status} ${r.body?.error}`)
    said.D5 = quote(r)
    return quote(r)
  })

  await check('D6', 'a plain account is deleted, and cannot sign in afterwards', async () => {
    const carol = await signUp(c, 'del-c')
    const r = await del(carol.cookie, { password: PASSWORD, confirm: PHRASE })
    must(r.status === 200 && r.body?.deleted === true, `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
    const again = await c.call('POST', '/api/auth/sign-in/email', { json: { email: carol.email, password: PASSWORD } })
    must(again.status !== 200, 'the deleted account can still sign in')
    return `then sign-in ${again.status}`
  })

  const failed = results.filter((r) => r.ok === false).length
  console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed} failed, ${results.filter((r) => r.ok === null).length} skipped`)
  process.exit(failed === 0 ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((e) => { console.error(String(e.message || e)); process.exit(1) })
