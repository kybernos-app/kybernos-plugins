// The core no longer carries the call: the Call / Video buttons of a team member go through the
// seam of @local/kybernos-call (`window.__KB_CALL__`), and are hidden without it.
//
// The real helpers are cut out of client.js (so what runs here is what ships) and run in a fake
// browser; the rest is checked on the text, because the member card is one huge template.
//
//   node packages/kybernos-plugin/test-call-seam.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(join(here, 'client.js'), 'utf8')
const host = readFileSync(join(here, 'index.js'), 'utf8')

console.log('the call is gone from the core')
for (const gone of ['LivekitClient', "'/call/token'", "'/call/status'", 'kbCallOuvre', 'kbCallPanneau', 'KB_CALL_JS', 'unpkg.com/livekit']) {
  assert.equal(client.includes(gone), false, 'client.js still has ' + gone)
}
for (const gone of ['kbCallMint', 'kbCallAgentStart', 'kbCallUtterance', '/kybernos/call/', 'livekit-client.js', 'appel-venv', "'appel'"]) {
  assert.equal(host.includes(gone), false, 'index.js still has ' + gone)
}
ok('client.js and index.js have no call code, no call route and no LiveKit SDK route left')

console.log('the seam')
const start = client.indexOf('const kbCallSeam = () => {')
const end = client.indexOf('seam.open({ sessionId: sessionId, kyberId: kyberId, roleId: roleId, name: name, mode: mode, voice: voice })')
assert.ok(start > 0 && end > start, 'the seam helpers are in client.js')
const helpers = client.slice(start, client.indexOf('}', client.indexOf('\n      }', end)) + 1)
const run = (windowObj, extra = {}) => {
  const opened = []
  const ctx = vm.createContext(Object.assign({ window: windowObj, kybernosOpened: opened, kyberId: 'team-1', rootId: 'root-1', kbCurrentSessionId: () => 'session-aaaaaaaa' }, extra))
  vm.runInContext(helpers + '\nglobalThis.kbCallSeam = kbCallSeam; globalThis.kbOpenCall = kbOpenCall', ctx)
  return { ctx, opened }
}
{
  const { ctx } = run({})
  assert.equal(ctx.kbCallSeam(), null)
  assert.doesNotThrow(() => ctx.kbOpenCall('m1', 'Alice', 'voice'))
  ok('without the bundle there is no seam, and a click does nothing (no error)')
}
{
  const calls = []
  const { ctx } = run({ __KB_CALL__: { open: (o) => calls.push(o) } })
  assert.notEqual(ctx.kbCallSeam(), null)
  ctx.kbOpenCall('m1', 'Alice', 'video')
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { sessionId: 'session-aaaaaaaa', kyberId: 'team-1', roleId: 'm1', name: 'Alice', mode: 'video', voice: null })
  ok('with the bundle, the click opens a call with the current session, the team, the member and the mode (no voice chosen: null)')
  ctx.kbOpenCall('m1', 'Alice', 'voice', { id: 'edge::fr-FR-DeniseNeural', name: 'Denise', custom: false, engine: 'edge', voice: 'fr-FR-DeniseNeural', lang: 'fr', engineName: 'Edge' })
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].voice)), { engine: 'edge', voice: 'fr-FR-DeniseNeural', lang: 'fr' })
  ctx.kbOpenCall('m1', 'Alice', 'voice', { id: 'v-123', name: 'My recording', custom: true, engine: null, voice: null, lang: null })
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2].voice)), { custom: true, id: 'v-123', name: 'My recording', rootId: 'root-1' })
  ok('the member\'s voice goes with the call: its engine, voice and language, or a recording by its id and project (the host reads the recording itself: no audio goes through the page)')
}
{
  const calls = []
  const { ctx } = run({ __KB_CALL__: { open: (o) => calls.push(o) } }, { kbCurrentSessionId: () => { throw new Error('no session') } })
  ctx.kbOpenCall('m1', 'Alice', 'voice')
  assert.equal(calls[0].sessionId, null)
  ok('outside a session the call still opens, with no session (the voice works, nothing is sent to a thread)')
  const bad = run({ __KB_CALL__: {} })
  assert.equal(bad.ctx.kbCallSeam(), null)
  ok('a seam without open() counts as no seam')
}

console.log('the buttons')
assert.equal((client.match(/hasCall: kbCallSeam\(\) !== null/g) ?? []).length, 1)
assert.equal((client.match(/style: \{ display: r\.hasCall === true \? "" : "none" \} \}, \[h\('button', \{ type: "button", className: "kbm-ico-btn", "aria-label": r\.(voice|video)CallLabel/g) ?? []).length, 2)
assert.ok(client.includes('callVoice: () => kbOpenCall(id, rs.name, \'voice\', activeVoice)'))
assert.ok(client.includes('callVideo: () => kbOpenCall(id, rs.name, \'video\', activeVoice)'))
ok('both buttons are hidden unless the seam exists, and both call it with their mode')

console.log('\nkybernos core ↔ kybernos-call seam: ' + pass + ' checks')
