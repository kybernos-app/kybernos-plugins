// The embedded console (Account, Referral, Team settings) is drawn for ONE active workspace and follows it.
//   node packages/kybernos-plugin/test-frame-follows-space.mjs
//
// The fault this pins: the frame's address carries `ws=<active workspace>` read when the frame was made, and the frame was keyed on the page and the console's address alone.
// A pairing that ended just after the page opened (or an active space changed from the Cloud card) left that frame on the team it opened with, while the next frame of the
// same app opened on the new one: Account said one team, Team settings another, and « Add credits » went to a third place than the page on screen.
//
// The test cuts the shipped code out of client.js and runs it, so what is proven is the code, not a copy.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const between = (a, b, from = 0) => {
  const i = source.indexOf(a, from)
  const j = i < 0 ? -1 : source.indexOf(b, i)
  return i < 0 || j < 0 ? null : source.slice(i, j + b.length)
}

// 1. What a frame is drawn for includes the workspace.
const identitySrc = between('const frameIdentity = () => ', "+ kbServer.workspace\n")
check('the identity of a frame is defined once, where the test expects it', identitySrc !== null)
if (identitySrc === null) {
  console.log('\nthe frame has no identity that includes the workspace: it is not redrawn when the active space changes')
  process.exit(1)
}
const identityOf = (kbServer) => new Function('kbServer', identitySrc.replace('const frameIdentity = ', 'return ').replace(/\n$/, ''))(kbServer)()
const A = { api: 'http://s', console: 'http://s/workspace-console', computer: false, workspace: '' }
check('a pairing that ends after the frame opened (no workspace, then the active one) is a different identity', identityOf(A) !== identityOf({ ...A, workspace: 'W1' }))
check('two active workspaces are two identities', identityOf({ ...A, workspace: 'W1' }) !== identityOf({ ...A, workspace: 'W2' }))
check('the same state is the same identity', identityOf({ ...A, workspace: 'W1' }) === identityOf({ ...A, workspace: 'W1' }))

// 2. The frame is a new document for another workspace.
check(
  "the iframe's key carries the workspace",
  /key: page \+ '\|' \+ kbServer\.console \+ '\|' \+ kbServer\.workspace, 'data-kb': 'ws-console'/.test(source),
)

// 3. A switch made FROM the frame is what the frame already shows: it marks the identity as seen, so that it is not redrawn (no reload, no lost page).
check(
  'a switch of space made from the frame marks the new identity as seen',
  source.includes("if (ok) { kbServer.workspace = id; seenServer.current = frameIdentity(); prevenirCarte() }"),
)
check(
  'a team made from the frame does the same',
  source.includes("if (ok && actif !== null) { kbServer.workspace = actif; seenServer.current = frameIdentity(); prevenirCarte() }"),
)

// 4. The re-read: redraws for another workspace, and asks the console again only for another server.
const againSrc = between('const serverOf = (identity) =>', "window.addEventListener('focus', again)")
check('the re-read is where the test expects it', againSrc !== null)
const run = (seenWorkspace, nowWorkspace, nowServer = 'http://s') => {
  const calls = { bump: 0, reach: [], probe: 0 }
  const kbServer = { api: nowServer, console: nowServer + '/workspace-console', computer: false, workspace: nowWorkspace }
  const seenServer = { current: [A.api, A.console, 'false', seenWorkspace].join('|') }
  const body = againSrc.replace("window.addEventListener('focus', again)", '').replace('seenServer.current = frameIdentity()\n', '')
  const make = new Function(
    'kbServer', 'seenServer', 'frameIdentity', 'kbServerLoad', 'bumpRev', 'setReach', 'probe', 'vivant',
    `let vivant_ = vivant; ${body.replace('let vivant = true', '')} return again`,
  )
  const frameIdentity = () => [kbServer.api, kbServer.console, String(kbServer.computer), kbServer.workspace].join('|')
  const again = make(kbServer, seenServer, frameIdentity, () => Promise.resolve(), () => { calls.bump += 1 }, (v) => calls.reach.push(v), () => { calls.probe += 1 }, true)
  return { again, calls, seenServer }
}
{
  const t = run('', 'W1')
  await t.again()
  check('another workspace redraws the frame (one bump)', t.calls.bump === 1)
  check('and does not ask the console again (the server is the same)', t.calls.probe === 0 && t.calls.reach.length === 0)
  check('and is remembered, so the next look is quiet', t.seenServer.current.endsWith('|W1'))
}
{
  const t = run('W1', 'W1')
  await t.again()
  check('the same workspace changes nothing', t.calls.bump === 0 && t.calls.probe === 0)
}
{
  const t = run('W1', 'W1', 'http://other')
  await t.again()
  check('another server redraws the frame and asks its console again', t.calls.bump === 1 && t.calls.probe === 1)
}
check(
  'the Cloud card changing the active space is listened to, and the listener is removed',
  source.includes("window.addEventListener('kybernos-cloud:space-changed', again)") &&
    source.includes("window.removeEventListener('kybernos-cloud:space-changed', again)"),
)

if (failed > 0) {
  console.log('\n' + failed + ' check(s) failed')
  process.exit(1)
}
console.log('\nall checks OK')
