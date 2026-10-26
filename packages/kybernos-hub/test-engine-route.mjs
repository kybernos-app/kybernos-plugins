// POST /kybernos-hub/engine: the DSH engine put back inside the zone this plugin was tested with, in one click (no terminal).
// Every side effect is injected (the robot, the zone, the hosting): nothing here installs anything.
//   node packages/kybernos-hub/test-engine-route.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monterSuite } from './hub-host.mjs'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'
import { comparerVersions, versionDansZone } from './suite-host.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const embarque = JSON.parse(readFileSync(join(ICI, 'catalog.json'), 'utf8'))
// The route needs the signed session as well as the Origin (L3-14): the Suite panel's own request carries both.
sessionSource.secret = () => SESSION_SECRET
let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total += 1; if (cond) console.log('  ✓ ' + nom); else { echecs += 1; console.log('  ✗ ' + nom + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }
const ZONE = { min: '0.1.6-alpha.2', max: '0.2.1-alpha.2' }
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('the zone check')
ok('versions compare segment by segment, a pre-release comes before its release', comparerVersions('0.1.10', '0.1.7') > 0 && comparerVersions('0.2.1-alpha.2', '0.2.1-alpha.4') < 0 && comparerVersions('0.2.0', '0.2.0-rc.2') > 0)
ok('a tested version is inside', versionDansZone('0.2.1-alpha.2', ZONE) && versionDansZone('0.1.7-rc.2', ZONE) && versionDansZone('0.1.6-alpha.2', ZONE))
ok('anything above the max or below the min is outside', !versionDansZone('0.2.1-alpha.4', ZONE) && !versionDansZone('0.3.0', ZONE) && !versionDansZone('0.1.5', ZONE))
ok('anything that is not a plain version is refused, and an unknown zone refuses everything',
  !versionDansZone('', ZONE) && !versionDansZone('latest', ZONE) && !versionDansZone('0.2.1-alpha.2; rm -rf /', ZONE) && !versionDansZone('../0.2.1', ZONE) && !versionDansZone(null, ZONE) &&
  !versionDansZone('0.2.1-alpha.2', null) && !versionDansZone('0.2.1-alpha.2', {}) && !versionDansZone('0.2.1-alpha.2', { min: 1, max: 2 }))

console.log('the route')
{
  let lancements = []
  let issue = { code: 0, sortie: 'ok' }
  let attente = null
  const deps = (over = {}) => ({
    catalogue: embarque, hub: { etat: () => ({ ok: true }) },
    lireActivation: () => null, ecrireActivation: () => {}, relancer: async () => ({ ok: true }),
    executer: async (argv) => { lancements.push(argv); if (attente !== null) await attente; return issue },
    zoneMoteur: () => ZONE, hebergement: () => ({ heberge: false, raison: null }), ...over
  })
  const monter = (d) => { const r = {}; monterSuite({ register: (x) => { r[x.path] = x.handler } }, d); return r }
  const faux = (methode, corps, entetes = {}) => {
    const req = Object.assign((async function * () { if (corps !== undefined) yield Buffer.from(JSON.stringify(corps)) })(), { method: methode, headers: { origin: 'http://127.0.0.1:3080', cookie: sessionCookie('127.0.0.1:3080'), 'content-type': 'application/json', ...entetes }, socket: { localPort: 3080 } })
    return { req, res: { code: null, body: null, writeHead (c) { this.code = c }, end (b) { this.body = b === undefined ? null : JSON.parse(b) } } }
  }
  const appeler = async (r, chemin, methode, corps, entetes) => { const { req, res } = faux(methode, corps, entetes); await r[chemin](req, res); return res }
  const E = '/kybernos-hub/engine'

  let r = monter(deps())
  ok('the route is registered', typeof r[E] === 'function')
  ok('it needs an explicit confirmation', (await appeler(r, E, 'POST', { version: '0.2.1-alpha.2' })).code === 400)
  ok('it is strict same-origin', (await appeler(r, E, 'POST', { confirm: true, version: '0.2.1-alpha.2' }, { origin: 'http://evil.example' })).code === 403)
  ok('it takes a POST only', (await appeler(r, E, 'GET')).code === 405)
  ok('it takes JSON only', (await appeler(r, E, 'POST', { confirm: true, version: '0.2.1-alpha.2' }, { 'content-type': 'text/plain' })).code === 415)
  for (const v of [undefined, '', 'latest', '0.2.1-alpha.2; rm -rf /', '../x', 42]) {
    const x = await appeler(r, E, 'POST', { confirm: true, version: v })
    ok('a bad version is a 400 and nothing runs (' + JSON.stringify(v) + ')', x.code === 400 && x.body.error === 'bad-version' && lancements.length === 0, x.body)
  }
  for (const v of ['0.2.1-alpha.4', '0.3.0', '0.1.5']) {
    const x = await appeler(r, E, 'POST', { confirm: true, version: v })
    ok('a version outside the tested zone is a 409 and nothing runs (' + v + ')', x.code === 409 && x.body.error === 'outside-tested-zone' && lancements.length === 0, x.body)
  }
  r = monter(deps({ zoneMoteur: () => null }))
  ok('an unknown zone refuses every version', (await appeler(r, E, 'POST', { confirm: true, version: '0.2.1-alpha.2' })).body.error === 'outside-tested-zone' && lancements.length === 0)
  r = monter(deps({ zoneMoteur: () => { throw new Error('unreadable') } }))
  ok('a zone that cannot be read refuses, it does not throw', (await appeler(r, E, 'POST', { confirm: true, version: '0.2.1-alpha.2' })).code === 409 && lancements.length === 0)
  r = monter({ catalogue: embarque, hub: { etat: () => ({ ok: true }) }, lireActivation: () => null, ecrireActivation: () => {}, executer: async () => ({ code: 0 }), relancer: async () => ({ ok: true }) })
  ok('a hub without a zone answers 404 (not available)', (await appeler(r, E, 'POST', { confirm: true, version: '0.2.1-alpha.2' })).code === 404)
  r = monter(deps({ hebergement: () => ({ heberge: true, raison: 'coolify' }) }))
  let x = await appeler(r, E, 'POST', { confirm: true, version: '0.2.1-alpha.2' })
  ok('a hosted instance is rebuilt, never patched: 409 hosted-instance and nothing runs', x.code === 409 && x.body.error === 'hosted-instance' && lancements.length === 0, x.body)

  // the happy path, followed on the shared status route
  r = monter(deps())
  let gate = null
  attente = new Promise((res) => { gate = res })
  x = await appeler(r, E, 'POST', { confirm: true, version: '0.2.1-alpha.2' })
  ok('a tested version is accepted: 202 and the robot is told exactly « upgrade <version> »', x.code === 202 && x.body.ok === true && lancements.length === 1 && JSON.stringify(lancements[0]) === JSON.stringify(['upgrade', '0.2.1-alpha.2']), { code: x.code, lancements })
  let st = await appeler(r, '/kybernos-hub/update/status', 'GET')
  ok('while it runs the status says installing, for the engine', st.body.etat === 'installation' && st.body.moteur === true && st.body.version === '0.2.1-alpha.2', st.body)
  x = await appeler(r, E, 'POST', { confirm: true, version: '0.2.1-alpha.2' })
  ok('a second click while it runs is a 409 busy and runs nothing more', x.code === 409 && x.body.error === 'busy' && lancements.length === 1)
  gate(); await attendre(20)
  st = await appeler(r, '/kybernos-hub/update/status', 'GET')
  ok('when the robot succeeds the status says done and asks for the restart', st.body.etat === 'termine' && st.body.relanceRequise === true && st.body.moteur === true && st.body.version === '0.2.1-alpha.2', st.body)

  // failure: the robot's own rollback leaves the machine as it was; the answer says so and does not leak a stack
  attente = null
  issue = { code: 1, sortie: 'x'.repeat(2000) + 'boot failed' }
  r = monter(deps())
  await appeler(r, E, 'POST', { confirm: true, version: '0.1.7-rc.2' })
  await attendre(20)
  st = await appeler(r, '/kybernos-hub/update/status', 'GET')
  ok('a failed robot is reported as a failure with a short detail', st.body.etat === 'echec' && st.body.erreur === 'engine-update-failed' && st.body.detail.length <= 400 && st.body.detail.endsWith('boot failed'), st.body)
  x = await appeler(r, E, 'POST', { confirm: true, version: '0.1.7-rc.2' })
  ok('and the route is free again after a failure', x.code === 202)
  await attendre(20)
  r = monter(deps({ executer: async () => { throw new Error('robot missing') } }))
  await appeler(r, E, 'POST', { confirm: true, version: '0.2.1-alpha.2' })
  await attendre(20)
  st = await appeler(r, '/kybernos-hub/update/status', 'GET')
  ok('a robot that cannot even start is a failure, not a crash', st.body.etat === 'echec' && /robot missing/.test(st.body.detail), st.body)
}

console.log('\n' + (total - echecs) + '/' + total + (echecs === 0 ? ' ✓' : ' ✗ ' + echecs + ' failure(s)'))
process.exit(echecs === 0 ? 0 : 1)
