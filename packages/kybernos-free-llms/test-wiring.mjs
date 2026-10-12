// The wiring of the `opencode-free` route to the gateway this bundle mounts: the address it points at and the key
// it names. Pure, so each rule is proven here without a host or a network call.
//
//   node packages/kybernos-free-llms/test-wiring.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GATEWAY_PATH, DEFAULT_PORT, FREE_TIER_KEY, loopbackPortOf, gatewayBase, routeNeedsRepair, ensureFreeKey,
} from './wiring.mjs'
import { BASE_URL, CREDENTIAL_REF, buildProfile } from './profile.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
const here = dirname(fileURLToPath(import.meta.url))

// ── the address ──────────────────────────────────────────────
await ok('the gateway address is DSH\'s own web server, on the port it reports', () => {
  assert.equal(gatewayBase({ serverPort: 3081 }), 'http://127.0.0.1:3081' + GATEWAY_PATH)
})

await ok('the order is: the server\'s port, DSH_PORT, a loopback Host header, DSH\'s default', () => {
  assert.equal(gatewayBase({ serverPort: 4000, envPort: '3081', hostHeader: '127.0.0.1:3090' }), 'http://127.0.0.1:4000/free-llms/v1')
  assert.equal(gatewayBase({ envPort: '3081', hostHeader: '127.0.0.1:3090' }), 'http://127.0.0.1:3081/free-llms/v1')
  assert.equal(gatewayBase({ hostHeader: '127.0.0.1:3090' }), 'http://127.0.0.1:3090/free-llms/v1')
  assert.equal(gatewayBase({}), 'http://127.0.0.1:' + DEFAULT_PORT + '/free-llms/v1')
  assert.equal(gatewayBase(), 'http://127.0.0.1:' + DEFAULT_PORT + '/free-llms/v1')
})

await ok('a port that is not a port is ignored, never written into the address', () => {
  for (const bad of [0, -1, 70000, 'abc', '', null, undefined, 3080.5]) {
    assert.equal(gatewayBase({ serverPort: bad, envPort: bad }), 'http://127.0.0.1:' + DEFAULT_PORT + '/free-llms/v1', String(bad))
  }
})

await ok('a public Host header says nothing about DSH\'s own port', () => {
  assert.equal(loopbackPortOf('kybernos.example.com:443'), null)
  assert.equal(loopbackPortOf('kybernos.example.com'), null)
  assert.equal(loopbackPortOf('127.0.0.1.evil.example:3080'), null)
  assert.equal(loopbackPortOf('127.0.0.1:3080'), 3080)
  assert.equal(loopbackPortOf('localhost:3081'), 3081)
  assert.equal(loopbackPortOf('[::1]:3082'), 3082)
  assert.equal(loopbackPortOf('127.0.0.1'), null, 'no port: not a port')
  assert.equal(loopbackPortOf(undefined), null)
})

await ok('the profile\'s default address is the gateway, never the proof-of-concept port', () => {
  assert.equal(BASE_URL, 'http://127.0.0.1:' + DEFAULT_PORT + GATEWAY_PATH)
  assert.equal(buildProfile({ models: ['a-free'] }).baseURL, BASE_URL)
  assert.equal(buildProfile({ models: ['a-free'], baseURL: gatewayBase({ serverPort: 3081 }) }).baseURL, 'http://127.0.0.1:3081/free-llms/v1')
  assert.doesNotMatch(readFileSync(join(here, 'profile.mjs'), 'utf8'), /8848/, 'the proof-of-concept port is not written into the route')
})

await ok('index.js writes the route with the real address and stores the key (drift guard)', () => {
  const source = readFileSync(join(here, 'index.js'), 'utf8')
  assert.match(source, /buildProfile\(\{ models, baseURL \}\)/, 'the route carries the address of DSH\'s web server')
  assert.match(source, /ensureFreeKey\(service\('credentials'\), CREDENTIAL_REF\)/, 'the key the route names is stored')
  assert.match(source, /routeNeedsRepair\(state, base\)/, 'a route an earlier version wrote is repaired at boot')
})

// ── the repair decision ──────────────────────────────────────
await ok('a wired route written for another address (or by an earlier version) is repaired once', () => {
  const base = 'http://127.0.0.1:3080/free-llms/v1'
  assert.equal(routeNeedsRepair({ wired: true }, base), true, 'an earlier version recorded no address')
  assert.equal(routeNeedsRepair({ wired: true, routeBase: 'http://127.0.0.1:8848/v1' }, base), true)
  assert.equal(routeNeedsRepair({ wired: true, routeBase: base }, base), false, 'already right: left alone')
  assert.equal(routeNeedsRepair({ wired: false }, base), false, 'a person who turned it off keeps it off')
  assert.equal(routeNeedsRepair(null, base), false)
})

// ── the key ──────────────────────────────────────────────────
const fakeCredentials = ({ configured = false, writable = true, failOn = null } = {}) => {
  const calls = { describe: [], set: [] }
  return {
    calls,
    describe: async (ref) => { calls.describe.push(ref); if (failOn === 'describe') throw new Error('boom'); return { configured, writable } },
    set: async (ref, value) => { calls.set.push([ref, value]); if (failOn === 'set') throw new Error('boom') },
  }
}

await ok('the free tier\'s marker is stored when nothing resolves the key', async () => {
  const cred = fakeCredentials()
  assert.equal(await ensureFreeKey(cred, CREDENTIAL_REF), 'stored')
  assert.deepEqual(cred.calls.set, [[CREDENTIAL_REF, FREE_TIER_KEY]])
  assert.equal(FREE_TIER_KEY, 'public')
})

await ok('a key that is already there is never overwritten', async () => {
  const cred = fakeCredentials({ configured: true })
  assert.equal(await ensureFreeKey(cred, CREDENTIAL_REF), 'present')
  assert.deepEqual(cred.calls.set, [], 'a person\'s own key stays theirs')
})

await ok('a store that cannot be written, or is missing, fails closed without throwing', async () => {
  assert.equal(await ensureFreeKey(fakeCredentials({ writable: false }), CREDENTIAL_REF), 'read_only')
  assert.equal(await ensureFreeKey(null, CREDENTIAL_REF), 'unavailable')
  assert.equal(await ensureFreeKey({ describe: async () => ({}) }, CREDENTIAL_REF), 'unavailable')
  assert.equal(await ensureFreeKey(fakeCredentials({ failOn: 'describe' }), CREDENTIAL_REF), 'failed')
  assert.equal(await ensureFreeKey(fakeCredentials({ failOn: 'set' }), CREDENTIAL_REF), 'failed')
})

console.log(`\n${count} tests passed`)
