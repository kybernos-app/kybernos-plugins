// The gateway watcher (remote widget / télécommande bridge) talks to a gateway that only the OLD stack has. It must never default to a
// host: with a pairing token but no `gatewayBase`, it stays inactive and sends nothing; a base written on purpose still works.
//   node packages/kybernos-plugin/test-gateway-optin.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGatewayWatcher } from './gateway-watcher.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const dir = mkdtempSync(join(tmpdir(), 'kb-gw-'))
const settingsPath = join(dir, 'settings.json')
const make = (settings, extra = {}) => {
  writeFileSync(settingsPath, JSON.stringify(settings))
  const sent = []
  const journal = []
  const w = createGatewayWatcher({ settingsPath, stateDir: join(dir, 'state'), log: (m) => journal.push(String(m)), fetchImpl: async (url) => { sent.push(String(url)); return new Response('{"ok":true,"cursor":"0","items":[]}', { status: 200, headers: { 'content-type': 'application/json' } }) }, reactivationMs: 0, ...extra })
  return { w, sent, journal }
}
const settle = () => new Promise((r) => setTimeout(r, 300))

console.log('a pairing token alone')
{
  const { w, sent, journal } = make({ pairingToken: 'kya-' + 'a'.repeat(40) })
  const started = w.demarrer()
  await settle()
  check('does not start: there is no gateway to talk to by default', started === false && w.etat().actif === false, JSON.stringify([started, w.etat().actif]))
  check('and nothing leaves the machine', sent.length === 0, JSON.stringify(sent))
  check('the journal says why', journal.some((l) => /gatewayBase/.test(l)), JSON.stringify(journal))
  w.arreter()
}

console.log('a gateway written on purpose')
{
  const { w, sent } = make({ pairingToken: 'kya-' + 'a'.repeat(40), gatewayBase: 'http://127.0.0.1:9/' }, { delaiPollMs: 50 })
  const started = w.demarrer()
  await settle()
  check('starts, and calls exactly the base it was given', started === true && sent.length > 0 && sent.every((u) => u.startsWith('http://127.0.0.1:9/')), JSON.stringify([started, sent]))
  w.arreter()
}

rmSync(dir, { recursive: true, force: true })
console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)
