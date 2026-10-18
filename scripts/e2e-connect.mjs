#!/usr/bin/env node
// Connects a SANDBOX DSH to one of the made-up accounts of a local replica through the device flow, without a browser: DSH starts a pairing,
// the account approves it on the server's own route (what the activation page does when its button is pressed), DSH polls until « connected ».
// Environment: DSH_HOME of the sandbox (source scripts/sandbox/env.sh), KB_E2E_* of scripts/lib-e2e-server.mjs.
//   node scripts/e2e-connect.mjs --dsh 127.0.0.1:3098 --account a
import { cookieDeSession } from './cdp-lib.mjs'
import { makeServer, readAccounts } from './lib-e2e-server.mjs'

const args = process.argv.slice(2)
const arg = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d)
const dsh = arg('--dsh'), who = arg('--account')
if (!dsh || !who) { console.error('usage: --dsh host:port --account a|b'); process.exit(2) }
if (/:(3080)$/.test(dsh)) { console.error('refusing to touch the real DSH on :3080'); process.exit(3) }
const ck = cookieDeSession(dsh)
if (ck === null) { console.error('no browser-session secret for this DSH_HOME'); process.exit(3) }
const dshCall = async (method, path) => {
  const r = await fetch('http://' + dsh + path, { method, headers: { 'content-type': 'application/json', cookie: ck.nom + '=' + ck.valeur, origin: 'http://' + dsh }, body: method === 'GET' ? undefined : '{}' })
  return r.json()
}
const s = makeServer()
const acc = readAccounts(s.e)[who]
if (!acc) { console.error('no such account in accounts.json'); process.exit(2) }
if ((await dshCall('GET', '/kybernos-cloud/status')).connected === true) { console.log('already connected: nothing to do'); process.exit(0) }
const started = await dshCall('POST', '/kybernos-cloud/start')
if (!started.ok || !started.pairing) { console.error('could not start the pairing: ' + JSON.stringify(started).slice(0, 200)); process.exit(1) }
const u = new URL(started.pairing.activation_url)
const session = await s.signIn(acc.email, acc.password)
const approved = await s.call('POST', '/v1/device/approve', { cookie: session.cookie, json: { device_id: u.searchParams.get('deviceId'), user_code: started.pairing.user_code } })
if (approved.status !== 200) { console.error('approve ' + approved.status + ' ' + JSON.stringify(approved.body).slice(0, 200)); process.exit(1) }
let last = null
for (let i = 0; i < 20; i += 1) {
  last = await dshCall('POST', '/kybernos-cloud/poll')
  if (last.connected === true) break
  await new Promise((r) => setTimeout(r, 1000))
}
const st = await dshCall('GET', '/kybernos-cloud/status')
console.log('connected:', st.connected === true, '| account', who, '| plan', st.state && st.state.user && st.state.user.plan)
process.exit(st.connected === true ? 0 : 1)
