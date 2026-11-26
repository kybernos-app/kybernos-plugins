// Updating THIS cloud computer (computer-update.mjs): where it applies, how the platform's answer is read, what a refusal looks like. Nothing leaves the machine: the platform is a fake.
//   node packages/kybernos-cloud/test-computer-update.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createComputerUpdate, UPDATE_REFUSALS } from './computer-update.mjs'

let passed = 0
const ok = (name) => { passed += 1; console.log('  ✓ ' + name) }

const ME = '3f0c2a52-8d2f-4a35-9c11-0a5e6f6a7b01'

/** A fake platform: `routes` answers `METHOD path`; the computer is `self` (null = not a cloud computer). */
const world = (routes, self = { id: ME, token: 'kyd_computer-token' }) => {
  const calls = []
  const u = createComputerUpdate({
    computerSelf: () => self,
    apiCall: async (path, o) => {
      calls.push({ path, method: o.method, token: o.token, body: o.body })
      const a = routes[o.method + ' ' + path]
      return a === undefined ? { status: 404, body: { error: 'not_found' } } : typeof a === 'function' ? a() : a
    }
  })
  return { u, calls }
}

{
  // Off a cloud computer nothing is asked and nothing is offered: no identity, or an id with no token to speak with.
  for (const self of [null, { id: '', token: '' }, { id: ME, token: '' }, { id: '', token: 'kyd_x' }]) {
    const w = world({}, self)
    assert.deepEqual(await w.u.state(), { ok: true, applicable: false })
    assert.deepEqual(await w.u.start(), { ok: false, error: 'not_a_computer' })
    assert.deepEqual(w.calls, [], 'a laptop never reaches the platform for this')
  }
  ok('a DSH that is not a cloud computer is told « not applicable » and asks nobody')
}

{
  // The state: read with the computer's own token on its own route, and only a closed set of fields goes on — never an image.
  const w = world({ 'GET /v1/computer/update': { status: 200, body: { update: { supported: true, available: true, updating: false, target: 'a40ecd18', image: 'registry.fly.io/secret:1' } } } })
  const s = await w.u.state()
  assert.deepEqual(s, { ok: true, applicable: true, supported: true, available: true, updating: false, target: 'a40ecd18' })
  assert.ok(!('image' in s))
  assert.deepEqual(w.calls, [{ path: '/v1/computer/update', method: 'GET', token: 'kyd_computer-token', body: undefined }], 'one call, the computer\'s own token, its own route: it lists nothing and names nothing')
  ok('the state is read with the computer\'s own token on its own route, and only a closed set of fields is passed on')
}

{
  // A target that is not a short opaque name is dropped.
  const w = world({ 'GET /v1/computer/update': { status: 200, body: { update: { supported: true, available: false, updating: true, target: '<script>' } } } })
  assert.deepEqual(await w.u.state(), { ok: true, applicable: true, supported: true, available: false, updating: true, target: null })
  ok('a target that is not a short hex name is dropped')
}

{
  // Each way it cannot say is a code and never an offer.
  const down = await world({ 'GET /v1/computer/update': { status: 0, body: null } }).u.state()
  assert.deepEqual(down, { ok: true, applicable: true, supported: false, available: false, updating: false, error: 'server_unreachable' })
  const broken = await world({ 'GET /v1/computer/update': { status: 500, body: { error: 'boom' } } }).u.state()
  assert.deepEqual(broken, { ok: true, applicable: true, supported: false, available: false, updating: false, error: 'unavailable' })
  const refused = await world({ 'GET /v1/computer/update': { status: 403, body: { error: 'computer_route_not_allowed' } } }).u.state()
  assert.equal(refused.available, false); assert.equal(refused.error, 'unavailable')
  const unsupported = await world({ 'GET /v1/computer/update': { status: 200, body: { update: { supported: false, available: false, updating: false, target: null } } } }).u.state()
  assert.equal(unsupported.supported, false)
  ok('a platform that cannot say, or refuses, is a code and never an offer')
}

{
  // The press: 202 is started; every refusal is a closed code, never the platform's words; what the body says is never sent.
  const w = world({ 'POST /v1/computer/update': { status: 202, body: { started: true } } })
  assert.deepEqual(await w.u.start(), { ok: true, started: true })
  assert.deepEqual(w.calls, [{ path: '/v1/computer/update', method: 'POST', token: 'kyd_computer-token', body: {} }])
  for (const code of UPDATE_REFUSALS) {
    const r = await world({ 'POST /v1/computer/update': { status: 409, body: { error: code, message: 'Words of the platform.' } } }).u.start()
    assert.deepEqual(r, { ok: false, error: code, status: 409 })
  }
  const odd = await world({ 'POST /v1/computer/update': { status: 403, body: { error: 'something_new', message: 'Registry address registry.fly.io/x' } } }).u.start()
  assert.deepEqual(odd, { ok: false, error: 'refused', status: 403 })
  assert.equal((await world({ 'POST /v1/computer/update': { status: 0, body: null } }).u.start()).error, 'server_unreachable')
  ok('the press is a 202 with the computer\'s token; each refusal is a closed code and the platform\'s words never pass')
}

{
  // The routes are in the table with the guards a write has: same origin strictly and the signed session; the read only the same-origin rule.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8')
  assert.ok(/path: '\/kybernos-cloud\/computer\/update', method: 'GET', guarded: true, run: \(\) => computerUpdate\.state\(\)/.test(src))
  assert.ok(/path: '\/kybernos-cloud\/computer\/update\/start', method: 'POST', guarded: true, strict: true, session: true, run: \(\) => computerUpdate\.start\(\)/.test(src))
  ok('the two routes are in the table, the write under the strict origin and the signed session')
}

console.log('\n' + passed + ' checks passed')
