#!/usr/bin/env node
// The phone link and the plan, on the disposable server replica of the user-journey recette (J04-03). The owner decided on 2026-10-15 that the phone link is open to Free accounts too and that a
// subscriber must not have less than a free account (the server's `billing/features.ts` says so; its unit test covers the `403 remote_not_in_plan` answer for a plan that does not list it).
// So this check pins what a person lives: a Free account can start a pairing, a Plus account can too and has at least the same number of phones, and a plan that ends takes nothing away.
// Money moves only through the replica's payment stand-in (`/__/stripe/pay`, `/__/stripe/subscription`); no card is typed.
//
//   source "$KB_E2E_DIR/env.sh" && node scripts/check-remote-plan-gate-live.mjs
//
// The replica must be started with REMOTE_PHONE_URL set (scripts/user-journey-acceptance.sh does it); without it every route answers 503 remote_disabled and the check says so (exit 3).
// It signs up its own made-up accounts (never the recette's), and starts a pairing only to withdraw it: nothing is confirmed, no phone is linked. Exit 0 pass, 1 fail, 3 wrong environment.
import { env as serverEnv, fresh, makeServer } from './lib-e2e-server.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, saw) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (saw === undefined ? '' : ' — ' + JSON.stringify(saw).slice(0, 300))) } }

let S
try { S = makeServer(serverEnv()) } catch (e) { console.log('wrong environment: ' + e.message); process.exit(3) }
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(S.e.api)) { console.log('refusing to run on ' + S.e.api + ': it signs up accounts and moves money through the stand-in, so it runs on the disposable replica only'); process.exit(3) }
try { if (!(await fetch(S.e.api + '/.well-known/kybernos-server.json')).ok) throw new Error('not ok') } catch (e) { console.log('wrong environment: the replica does not answer at ' + S.e.api); process.exit(3) }

const post = (path, json) => S.control(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })
const must = (r, what) => { if (!(r.status >= 200 && r.status < 300)) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); return r.body }
const person = async (label) => {
  const p = fresh(label)
  await S.signUp(p.email, p.password, p.name)
  const s = await S.signIn(p.email, p.password)
  const list = must(await S.call('GET', '/v1/workspaces', { cookie: s.cookie }), 'workspaces')
  return { ...p, cookie: s.cookie, personal: list.workspaces.find((w) => w.personal).id }
}
const pair = (who) => S.call('POST', '/v1/remote/pairings', { cookie: who.cookie, json: { computer_label: 'Journey Mac' } })
const devices = (who) => S.call('GET', '/v1/remote/devices', { cookie: who.cookie })
const subOf = async (ws) => ((await S.control('/__/stripe')).subscriptions || []).filter((x) => x.metadata && x.metadata.workspace_id === ws).at(-1) || null
const planOf = async (who) => (await S.call('GET', `/v1/workspaces/${who.personal}/plan`, { cookie: who.cookie })).body

console.log('── Free ──')
const me = await person('gate')
const first = await devices(me)
check('the list answers a Free account: entitled, with a number of phones', first.status === 200 && first.body && first.body.entitled === true && Number.isInteger(first.body.max_devices) && first.body.max_devices >= 1, first.body)
const freeMax = first.body && first.body.max_devices
const open1 = await pair(me)
if (open1.status === 503) { console.log('wrong environment: the replica has no phone link (REMOTE_PHONE_URL unset): ' + JSON.stringify(open1.body)); process.exit(3) }
check('a Free account starts a pairing (201, an object back)', open1.status === 201 && open1.body && typeof open1.body === 'object', open1)
const id1 = open1.body && (open1.body.pairing_id || open1.body.id || open1.body.sid)
if (id1) await S.call('DELETE', `/v1/remote/pairings/${id1}`, { cookie: me.cookie })

console.log('── Plus ──')
const co = must(await S.call('POST', `/v1/workspaces/${me.personal}/billing/checkout`, { cookie: me.cookie, json: { plan: 'solo', component: 'solo', currency: 'USD', quantity: 1, interval: 'month' } }), 'checkout')
const paid = await post('/__/stripe/pay', { session_id: co.session_id })
check('the stand-in delivers the payment (200)', paid.delivered === 200, paid)
let plan = null
for (let i = 0; i < 20; i++) { plan = await planOf(me); if (plan && plan.status !== 'free') break; await sleep(250) }
check('the plan applies', plan !== null && plan.status !== 'free', plan && plan.status)
const open = await devices(me)
check('the list says entitled, with at least as many phones as a Free account', open.status === 200 && open.body && open.body.entitled === true && open.body.max_devices >= freeMax, open.body)
const started = await pair(me)
check('a Plus account starts a pairing (201)', started.status === 201 && started.body && typeof started.body === 'object', started)
const pairId = started.body && (started.body.pairing_id || started.body.id || started.body.sid)
if (pairId) await S.call('DELETE', `/v1/remote/pairings/${pairId}`, { cookie: me.cookie })

console.log('── the plan ends ──')
const sub = await subOf(me.personal)
const ended = sub === null ? null : await post('/__/stripe/subscription', { subscription_id: sub.id, status: 'canceled' })
check('the provider ends the subscription (webhook delivered, every event answered 200)', ended !== null && ended.delivered !== null && typeof ended.delivered === 'object' && Object.values(ended.delivered).length > 0 && Object.values(ended.delivered).every((v) => v === 200), ended)
let back = null
for (let i = 0; i < 20; i++) { back = await planOf(me); if (back && back.status === 'free') break; await sleep(250) }
check('the account is Free again', back !== null && back.status === 'free', back && back.status)
const after = await pair(me)
check('the phone link stays: a new pairing starts (a free account keeps it)', after.status === 201, after)
const idA = after.body && (after.body.pairing_id || after.body.id || after.body.sid)
if (idA) await S.call('DELETE', `/v1/remote/pairings/${idA}`, { cookie: me.cookie })
const list = await devices(me)
check('the list still says entitled, with the Free number of phones', list.status === 200 && list.body && list.body.entitled === true && list.body.max_devices === freeMax, list.body)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
