#!/usr/bin/env node
// Case J08-06 of docs/tests/user-journey: what the server does with money that goes the wrong way, played on a DISPOSABLE replica through its Stripe stand-in (no card is typed anywhere: the stand-in's `pay` completes a checkout).
// The expected values are the ones docs/runbooks/billing.md « Money given back » states: a retried event changes nothing; a PARTIAL refund leaves the credit; a FULL refund or a dispute takes back what was not spent
// (audit `topup.revoke`); a refund of a SUBSCRIPTION invoice changes nothing; a failed renewal puts the plan past due and a paid one puts it back.
//
//   node scripts/check-stripe-replica-money.mjs --api http://localhost:8841 --control http://127.0.0.1:8842 [--state <replica-state.json>]
//
// With --state the owner's audit trail is read too (`topup.revoke`); without it those checks are skipped, not passed. Refuses an address that is not loopback. Exit 0 when every check passed, 1 otherwise, 2 on a refusal.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isLoopback, ownerCookie } from './replica-owner-settings.mjs'

const PASSWORD = 'correct horse battery staple'

export function makeClient (api, control) {
  let n = 0
  const stamp = Math.floor(Math.random() * 200)
  const ip = () => `198.${18 + (stamp % 2)}.${(stamp + Math.floor(n / 250)) % 250}.${(n++ % 250) + 1}`
  const cookieOf = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ')
  const call = async (method, path, { json, cookie, headers } = {}) => {
    const r = await fetch(api + path, { method, redirect: 'manual', headers: { origin: api, 'x-test-ip': ip(), ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(headers || {}) }, body: json !== undefined ? JSON.stringify(json) : undefined })
    const text = await r.text()
    let body = null
    try { body = JSON.parse(text) } catch { body = null }
    return { status: r.status, body, text, headers: r.headers, cookie: cookieOf(r) }
  }
  const ctl = async (path, json) => {
    const r = await fetch(control + path, { method: json === undefined ? 'GET' : 'POST', headers: json === undefined ? {} : { 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) })
    const text = await r.text()
    let body = null
    try { body = JSON.parse(text) } catch { body = null }
    return { status: r.status, body, text }
  }
  return { call, ctl }
}

export async function signUp ({ call, ctl }, label) {
  const email = `money-${label}-${Date.now().toString(36)}@replica.test`
  const made = await call('POST', '/api/auth/sign-up/email', { json: { email, password: PASSWORD, name: 'Money Person' } })
  if (made.status !== 200) throw new Error(`sign-up ${made.status} ${made.text.slice(0, 120)}`)
  const otp = (await ctl(`/__/code?to=${encodeURIComponent(email)}`)).body?.code
  const ver = await call('POST', '/api/auth/email-otp/verify-email', { json: { email, otp } })
  if (ver.status !== 200) throw new Error(`verify-email ${ver.status}`)
  const sign = await call('POST', '/api/auth/sign-in/email', { json: { email, password: PASSWORD } })
  if (sign.status !== 200) throw new Error(`sign-in ${sign.status}`)
  return { email, cookie: sign.cookie }
}

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : '' }
  const api = (opt('--api') || '').replace(/\/$/, '')
  const control = (opt('--control') || '').replace(/\/$/, '')
  if (!api || !control) { console.error('usage: check-stripe-replica-money --api <loopback url> --control <loopback url> [--state <replica-state.json>]'); process.exit(2) }
  if (!isLoopback(api) || !isLoopback(control)) { console.error('check-stripe-replica-money: both addresses must be loopback (a replica, never a real server)'); process.exit(2) }
  const c = makeClient(api, control)
  const results = []
  const check = async (id, title, fn) => {
    try { const detail = await fn(); results.push({ id, ok: true, title, detail }); console.log(`  ✓ ${id} ${title}${detail ? ' — ' + detail : ''}`) } catch (e) {
      if (e && e.skip) { results.push({ id, ok: null, title, detail: e.message }); console.log(`  - ${id} ${title} — skipped: ${e.message}`) } else { results.push({ id, ok: false, title, detail: String(e.message || e) }); console.log(`  ✗ ${id} ${title} — ${String(e.message || e).slice(0, 300)}`) }
    }
  }
  const must = (ok, msg) => { if (!ok) throw new Error(msg) }
  const skip = (msg) => { const e = new Error(msg); e.skip = true; throw e }

  const person = await signUp(c, 'a')
  const ws = (await c.call('POST', '/v1/workspaces', { cookie: person.cookie, json: { name: 'Money team' } })).body?.id
  must(ws, 'no workspace was created')
  const plan = async () => (await c.call('GET', `/v1/workspaces/${ws}/plan`, { cookie: person.cookie })).body
  const balance = async () => (await plan())?.credit_balance_credits
  const checkout = async (json) => { const r = await c.call('POST', `/v1/workspaces/${ws}/billing/checkout`, { cookie: person.cookie, json }); must(r.status === 200, `checkout ${r.status} ${r.text.slice(0, 160)}`); return r.body.session_id }
  const pay = async (session_id) => { const r = await c.ctl('/__/stripe/pay', { session_id }); must(r.status === 200, `pay ${r.status} ${r.text.slice(0, 120)}`); return r }
  const topup = async (qty) => { const before = await balance(); const sid = await checkout({ plan: 'topup', component: 'pack', quantity: qty, currency: 'USD' }); await pay(sid); return { sid, before, after: await balance() } }
  let ownerSession = null
  if (opt('--state')) { const owner = JSON.parse(readFileSync(opt('--state'), 'utf8')).owner; if (owner) ownerSession = await ownerCookie(api, owner).catch(() => null) }
  const revokes = async () => {
    if (!ownerSession) skip('no --state: the audit trail was not read')
    const r = await c.call('GET', `/v1/admin/audit?subject_type=workspace&subject_id=${ws}`, { cookie: ownerSession })
    must(r.status === 200, `audit ${r.status}`)
    const rows = r.body?.entries || r.body?.items || r.body?.events || (Array.isArray(r.body) ? r.body : [])
    return rows.filter((x) => /topup\.revoke/.test(JSON.stringify(x))).length
  }

  console.log('J08-06 money that goes the wrong way, on the replica')
  let sub = null
  await check('M1', 'a team plan is paid and active', async () => {
    const sid = await checkout({ plan: 'team', component: 'band:0', quantity: 2, currency: 'USD', interval: 'year' })
    await pay(sid)
    const p = await plan()
    must(p && /active|trialing/i.test(JSON.stringify(p.status ?? p.subscription_status ?? p)), `plan after payment: ${JSON.stringify(p).slice(0, 200)}`)
    sub = (await c.ctl('/__/stripe')).body?.subscriptions?.slice(-1)[0] ?? null
    return `status ${p.status ?? 'see detail'}`
  })

  let first = null
  await check('M2', 'a top-up credits the workspace once', async () => {
    first = await topup(10)
    must(first.after > first.before, `balance ${first.before} -> ${first.after}`)
    return `balance ${first.before} -> ${first.after}`
  })
  await check('M3', 'the same event delivered again changes nothing', async () => {
    const r = await c.ctl('/__/stripe/redeliver', {})
    must(r.body?.outcome === 'duplicate', `redelivery ${r.text.slice(0, 160)}`)
    const now = await balance()
    must(now === first.after, `balance moved ${first.after} -> ${now}`)
    return 'outcome duplicate, balance unchanged'
  })
  await check('M4', 'a PARTIAL refund leaves the credit and writes no topup.revoke', async () => {
    const before = await balance()
    const rv0 = ownerSession ? await revokes() : 0
    const r = await c.ctl('/__/stripe/refund', { session_id: first.sid, full: false })
    must(r.status === 200, `refund ${r.status} ${r.text.slice(0, 160)}`)
    const after = await balance()
    must(after === before, `balance moved ${before} -> ${after}`)
    if (ownerSession) must((await revokes()) === rv0, 'a topup.revoke was written for a partial refund')
    return `balance ${before} -> ${after}`
  })
  await check('M5', 'a FULL refund takes back what was not spent and the audit says topup.revoke', async () => {
    const t = await topup(10)
    must(t.after > t.before, `top-up credited nothing ${t.before} -> ${t.after}`)
    const rv0 = ownerSession ? await revokes() : 0
    const r = await c.ctl('/__/stripe/refund', { session_id: t.sid })
    must(r.status === 200, `refund ${r.status} ${r.text.slice(0, 160)}`)
    const after = await balance()
    must(after < t.after, `the credit stayed after a full refund: ${t.after} -> ${after}`)
    must(after === t.before, `expected the balance before the top-up (${t.before}), got ${after}`)
    if (ownerSession) must((await revokes()) === rv0 + 1, 'no new topup.revoke in the audit trail')
    return `balance ${t.after} -> ${after}`
  })
  await check('M6', 'a dispute takes back what was not spent (audit topup.revoke)', async () => {
    const t = await topup(10)
    const rv0 = ownerSession ? await revokes() : 0
    const r = await c.ctl('/__/stripe/dispute', { session_id: t.sid })
    must(r.status === 200, `dispute ${r.status} ${r.text.slice(0, 160)}`)
    const after = await balance()
    must(after === t.before, `expected ${t.before} after the dispute, got ${after} (was ${t.after})`)
    if (ownerSession) must((await revokes()) === rv0 + 1, 'no new topup.revoke in the audit trail')
    return `balance ${t.after} -> ${after}`
  })
  await check('M7', 'a refund event delivered twice revokes once', async () => {
    const t = await topup(10)
    await c.ctl('/__/stripe/refund', { session_id: t.sid })
    const once = await balance()
    const again = await c.ctl('/__/stripe/redeliver', {})
    const twice = await balance()
    must(twice === once, `balance moved ${once} -> ${twice} after the redelivery (${again.text.slice(0, 80)})`)
    return `balance ${once}, unchanged after the retry`
  })
  await check('M8', 'a failed renewal puts the plan past due and a paid one puts it back', async () => {
    if (!sub) skip('the stand-in listed no subscription')
    const down = await c.ctl('/__/stripe/subscription', { subscription_id: sub.id, status: 'past_due' })
    must(down.status === 200, `past_due ${down.status} ${down.text.slice(0, 160)}`)
    const p1 = await plan()
    must(/past_due/i.test(JSON.stringify(p1)), `plan not past due: ${JSON.stringify(p1).slice(0, 220)}`)
    const up = await c.ctl('/__/stripe/subscription', { subscription_id: sub.id, status: 'active', paid: true })
    must(up.status === 200, `active ${up.status} ${up.text.slice(0, 160)}`)
    const p2 = await plan()
    must(!/past_due/i.test(JSON.stringify(p2)), `plan still past due: ${JSON.stringify(p2).slice(0, 220)}`)
    return 'past_due, then active'
  })
  await check('M9', 'a webhook with a bad signature is refused and changes nothing', async () => {
    const before = await balance()
    const r = await c.call('POST', '/v1/billing/webhook', { json: { id: 'evt_forged', type: 'checkout.session.completed', data: { object: {} } }, headers: { 'stripe-signature': 't=1,v1=00' } })
    must(r.status === 400 || r.status === 401 || r.status === 403, `a forged event answered ${r.status}`)
    must((await balance()) === before, 'the balance moved after a forged event')
    return `answered ${r.status}`
  })
  await check('M10', 'a subscription cancelled by the buyer ends at the period end and the plan says so', async () => {
    if (!sub) skip('the stand-in listed no subscription')
    const r = await c.ctl('/__/stripe/subscription', { subscription_id: sub.id, cancel_at_period_end: true })
    must(r.status === 200, `cancel_at_period_end ${r.status} ${r.text.slice(0, 160)}`)
    const p = await plan()
    must(/cancel/i.test(JSON.stringify(p)), `the plan does not say it will end: ${JSON.stringify(p).slice(0, 220)}`)
    return 'the plan says it will end'
  })

  const failed = results.filter((r) => r.ok === false).length
  const skipped = results.filter((r) => r.ok === null).length
  console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed} failed, ${skipped} skipped`)
  process.exit(failed === 0 ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((e) => { console.error(String(e.message || e)); process.exit(1) })
