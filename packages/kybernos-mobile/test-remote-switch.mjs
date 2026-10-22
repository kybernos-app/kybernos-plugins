// The one switch of the phone link (2026-10-22): ON by default = « ready to pair » (nothing can reach this computer until a phone is linked), OFF cuts every link, withdraws a pairing
// and refuses a new one, and the choice survives a restart. A stand-in WebSocket and a stand-in server: no relay, no network.
//   cd packages/kybernos-mobile && node test-remote-switch.mjs
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRemote } from './remote-host.mjs'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (detail ? ' - ' + detail : '')); if (!cond) fail++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 3000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(20) } }

const dir = mkdtempSync(join(tmpdir(), 'kb-mobile-switch-'))
// one phone linked already (what a restart finds on disk)
writeFileSync(join(dir, 'devices.json'), JSON.stringify({ v: 1, devices: [{ id: 'd_1', sid: 'sid-1', phoneId: 'phone-key', label: 'Test phone', createdAt: 1, lastSeenAt: 1 }] }), { mode: 0o600 })
// a minimal identity so that reading it does not matter: the manager makes one when the file is unreadable
const sockets = []
class FakeSocket {
  constructor (url) { this.url = url; this.readyState = 0; this.closedBy = null; sockets.push(this) }
  send () {}
  close (code) { this.closedBy = code; this.readyState = 3; if (typeof this.onclose === 'function') this.onclose({}) }
}
const calls = []
const make = () => createRemote({
  dir,
  cloud: () => ({ call: async (path, options) => { calls.push((options && options.method ? options.method : 'GET') + ' ' + path); if (/\/ticket$/u.test(path)) return { status: 200, body: { host_ticket: 't', relay_ws: 'ws://relay.test/' + path.split('/')[4] } }; if (path === '/v1/remote/devices') return { status: 200, body: { configured: true, entitled: true, max_devices: 4 } }; if (path === '/v1/remote/pairings') return { status: 200, body: { sid: 'sid-p', phone_url: 'http://x/#y', relay_ws: 'ws://relay.test/p', host_ticket: 'tp', pairing_id: 'pid-1' } }; return { status: 200, body: {} } } }),
  WebSocket: FakeSocket,
  fetch: globalThis.fetch,
  local: () => ({ base: 'http://127.0.0.1:1', cookie: 'x=y' }),
  label: () => 'Test computer',
  tuning: { retryMinMs: 50, retryMaxMs: 100 },
})

let remote = make()
try {
  await remote.start()
  const first = await remote.status()
  ok('ON by default: the status says so', first.enabled === true)
  ok('and the linked phone\'s link is opened (that is what makes it reachable)', (await until(() => sockets.length === 1)) !== null)
  ok('nothing is written for a default: no settings file yet', !existsSync(join(dir, 'settings.json')))

  // a pairing in progress is withdrawn when the switch goes off
  const started = await remote.pair()
  ok('while ON a pairing starts', started.ok === true, JSON.stringify(started))
  ok('and is in the status', (await remote.status()).pairing !== null)

  const off = await remote.setEnabled(false)
  ok('turning it off answers enabled false', off.ok === true && off.enabled === false)
  const afterOff = await remote.status()
  ok('the status says off, with no link and no pairing', afterOff.enabled === false && afterOff.relay === 'idle' && afterOff.pairing === null)
  ok('the linked phone stays listed, offline (off is not removing it)', afterOff.devices.length === 1 && afterOff.devices[0].online === false)
  ok('every socket was closed', (await until(() => sockets.every((s) => s.readyState === 3))) !== null)
  ok('the server was told the pairing is withdrawn', calls.some((c) => c.startsWith('DELETE /v1/remote/pairings/')))
  const askedBefore = calls.filter((c) => c === 'POST /v1/remote/pairings').length
  const refused = await remote.pair()
  ok('while OFF a new pairing is refused, and the server is not even asked', refused.ok === false && refused.error === 'disabled' && calls.filter((c) => c === 'POST /v1/remote/pairings').length === askedBefore)
  ok('turning it off twice changes nothing', (await remote.setEnabled(false)).enabled === false)

  const saved = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
  ok('the choice is kept on disk, privately', saved.enabled === false && (statSync(join(dir, 'settings.json')).mode & 0o777) === 0o600)

  // a restart keeps it off: nothing is opened
  remote.stop()
  const socketsBefore = sockets.length
  remote = make()
  await remote.start()
  await sleep(150)
  const restarted = await remote.status()
  ok('after a restart it is still off, and no link was opened', restarted.enabled === false && sockets.length === socketsBefore && restarted.relay === 'idle')
  ok('and still refuses a pairing', (await remote.pair()).error === 'disabled')

  // turning it on opens the linked phone's link again
  const on = await remote.setEnabled(true)
  ok('turning it on answers enabled true', on.ok === true && on.enabled === true)
  ok('the linked phone\'s link is opened again, by itself', (await until(() => sockets.length === socketsBefore + 1)) !== null)
  ok('a pairing works again', (await remote.pair()).ok === true)
  ok('and the status is on', (await remote.status()).enabled === true)
  ok('the choice is kept as on too', JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).enabled === true)

  // an unreadable settings file means the default, not a refusal
  remote.stop()
  writeFileSync(join(dir, 'settings.json'), 'not json')
  remote = make()
  await remote.start()
  ok('a damaged settings file reads as the default: ON', (await remote.status()).enabled === true)

  // the manager that was never started answers « off », never throws
  const cold = make()
  ok('a manager that is not running refuses the switch', (await cold.setEnabled(true)).error === 'off')
} catch (e) {
  console.log('FAIL exception - ' + (e && e.stack ? e.stack : e))
  fail++
} finally {
  remote.stop()
  rmSync(dir, { recursive: true, force: true })
  ok('the test left no temp folder behind', !existsSync(dir))
}
process.exit(fail ? 1 : 0)
