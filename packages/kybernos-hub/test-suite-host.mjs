// Suite panel — host logic and routes, played without DSH, a disk or a network.
//   node packages/kybernos-hub/test-suite-host.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activesResolues, basculer, charge, desactivesAEcrire, installer, lireActivation } from './suite-host.mjs'
import { monterSuite } from './hub-host.mjs'
import * as moteur from '../../scripts/lifecycle-engine.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const catalogue = JSON.parse(readFileSync(join(ICI, 'catalog.json'), 'utf8'))
let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + detail : '')) } }

const nomDe = (id) => catalogue.modules.find((m) => m.id === id).nom
const satellites = catalogue.modules.filter((m) => !m.socle).map((m) => ({ nom: m.nom, defaut: m.defaut }))
const socle = catalogue.modules.filter((m) => m.socle).map((m) => m.nom)

console.log('── catalogue ──')
ok('25 modules, ids unique', catalogue.modules.length === 25 && new Set(catalogue.modules.map((m) => m.id)).size === 25)
ok('every module belongs to a declared family', catalogue.modules.every((m) => catalogue.familles.some((f) => f.id === m.famille)))
ok('every module has a promise in fr and en', catalogue.modules.every((m) => m.promesse.fr.length > 10 && m.promesse.en.length > 10))
ok('hub and core are in the socle', catalogue.modules.find((m) => m.id === 'kybernos-hub').socle && catalogue.modules.find((m) => m.id === 'kybernos-plugin').socle)

console.log('── activation: same rule as the lifecycle robot ──')
{
  const cas = [
    { brut: null }, { brut: [] }, { brut: { actives: [nomDe('kybernos-auto')] } },
    { brut: { actives: [nomDe('kybernos-models')], desactives: [nomDe('kybernos-flow')] } }, { brut: { actives: socle } }
  ]
  const pareil = cas.every((c) => JSON.stringify(activesResolues({ ...c, satellites, socle })) === JSON.stringify(moteur.activesResolues({ ...c, satellites, socle })))
  ok('activesResolues agrees with scripts/lifecycle-engine.mjs on 5 shapes of file', pareil)
  const liste = [nomDe('kybernos-models')]
  ok('desactivesAEcrire agrees with the robot', JSON.stringify(desactivesAEcrire({ liste, satellites })) === JSON.stringify(moteur.desactivesAEcrire({ liste, satellites })))
  ok('no file → everything is on', lireActivation({ catalogue, brut: null }).actifs.length === 25)
  const legacy = lireActivation({ catalogue, brut: { actives: [nomDe('kybernos-models')] } }).actifs
  ok('legacy file (predates the new satellites): flow stays ON', legacy.includes(nomDe('kybernos-flow')))
}

console.log('── payload ──')
{
  const p = charge({ catalogue, brut: { actives: [nomDe('kybernos-models')], desactives: [nomDe('kybernos-slides')] }, etatHub: { ok: true } })
  ok('payload carries 25 modules', p.ok === true && p.modules.length === 25)
  ok('a switched-off module reads voulu=false', p.modules.find((m) => m.id === 'kybernos-slides').voulu === false)
  ok('the socle always reads voulu=true', p.modules.filter((m) => m.socle).every((m) => m.voulu === true))
  ok('catalogue source is labelled as embedded', p.catalogue.source === 'embarque')
}

console.log('── switching ──')
{
  const off = basculer({ catalogue, brut: null, id: 'kybernos-slides', actif: false })
  ok('switching slides off writes it in desactives', off.ok && off.ecrit.desactives.includes(nomDe('kybernos-slides')) && !off.ecrit.actives.includes(nomDe('kybernos-slides')))
  const on = basculer({ catalogue, brut: off.ecrit, id: 'kybernos-slides', actif: true })
  ok('switching it back on clears it from desactives', on.ok && !on.ecrit.desactives.includes(nomDe('kybernos-slides')) && on.ecrit.actives.includes(nomDe('kybernos-slides')))
  ok('the socle cannot be switched off', basculer({ catalogue, brut: null, id: 'kybernos-hub', actif: false }).error === 'socle-cannot-be-switched')
  ok('an unknown id is refused', basculer({ catalogue, brut: null, id: 'nope', actif: true }).error === 'unknown-module')
  ok('a hostile id (path, flag) is refused', ['../x', '--force', 'a b', '', null, 42].every((id) => basculer({ catalogue, brut: null, id, actif: true }).ok === false))
}

console.log('── install ──')
{
  let ecrit = null
  let argv = null
  const r = await installer({ catalogue, brut: { actives: [] }, id: 'dsh-mermaid', ecrire: (o) => { ecrit = o }, executer: async (a) => { argv = a; return { code: 0, sortie: 'ok' } } })
  ok('install activates the module, then runs the robot', r.ok === true && r.relanceRequise === true && ecrit.actives.includes(nomDe('dsh-mermaid')) && argv[0] === 'install')
  ok('install never asks the robot to restart DSH', !argv.includes('--relancer'))
  const refus = await installer({ catalogue, brut: null, id: 'dsh-mermaid', ecrire: () => {}, executer: async () => ({ code: 1, sortie: 'a\nb\nboot check failed' }) })
  ok('a refusing robot is reported with its last lines', refus.ok === false && refus.error === 'robot-refused' && refus.detail.includes('boot check failed'))
  const casse = await installer({ catalogue, brut: null, id: 'dsh-mermaid', ecrire: () => {}, executer: async () => { throw new Error('robot introuvable') } })
  ok('a robot that cannot start is reported, not thrown', casse.ok === false && casse.error === 'robot-failed')
  const ecritureKO = await installer({ catalogue, brut: null, id: 'dsh-mermaid', ecrire: () => { throw new Error('EACCES') }, executer: async () => ({ code: 0 }) })
  ok('a failed activation write stops before the robot', ecritureKO.error === 'activation-write-failed')
}

console.log('── routes ──')
const routes = {}
const hub = { etat: () => ({ ok: true }) }
let ecritures = []
let robots = []
let relances = 0
const deps = {
  catalogue, hub,
  lireActivation: () => null,
  ecrireActivation: (o) => { ecritures.push(o) },
  executer: async (a) => { robots.push(a); return { code: 0, sortie: '' } },
  relancer: async () => { relances++; return { ok: true } }
}
monterSuite({ register: (r) => { routes[r.path] = r.handler } }, deps)
const faux = (methode, corps, entetes = {}) => {
  const req = Object.assign((async function * () { if (corps !== undefined) yield Buffer.from(JSON.stringify(corps)) })(), {
    method: methode,
    headers: { origin: 'http://127.0.0.1:3080', 'content-type': 'application/json', ...entetes },
    socket: { localPort: 3080 }
  })
  const res = { code: null, body: null, writeHead (c) { this.code = c }, end (b) { this.body = b === undefined ? null : JSON.parse(b) } }
  return { req, res }
}
const appeler = async (chemin, methode, corps, entetes) => { const { req, res } = faux(methode, corps, entetes); await routes[chemin](req, res); return res }
{
  const s = await appeler('/kybernos-hub/suite', 'GET')
  ok('GET /suite answers 200 with the catalogue', s.code === 200 && s.body.modules.length === 25)
  ok('POST on /suite is refused', (await appeler('/kybernos-hub/suite', 'POST', {})).code === 405)
  ok('a foreign origin cannot switch a module', (await appeler('/kybernos-hub/module', 'POST', { id: 'kybernos-slides', action: 'desactiver' }, { origin: 'http://evil.example' })).code === 403)
  ok('a request with no origin cannot switch a module (strict)', (await appeler('/kybernos-hub/module', 'POST', { id: 'kybernos-slides', action: 'desactiver' }, { origin: undefined, referer: undefined })).code === 403)
  ok('a non-JSON body is refused', (await appeler('/kybernos-hub/module', 'POST', { id: 'x' }, { 'content-type': 'text/plain' })).code === 415)
  const off = await appeler('/kybernos-hub/module', 'POST', { id: 'kybernos-slides', action: 'desactiver' })
  ok('desactiver writes the activation file', off.code === 200 && ecritures.length === 1 && ecritures[0].desactives.includes(nomDe('kybernos-slides')))
  ok('the socle answers 403', (await appeler('/kybernos-hub/module', 'POST', { id: 'kybernos-hub', action: 'desactiver' })).code === 403)
  ok('an unknown module answers 404', (await appeler('/kybernos-hub/module', 'POST', { id: 'nope', action: 'activer' })).code === 404)
  ok('an unknown action answers 400', (await appeler('/kybernos-hub/module', 'POST', { id: 'kybernos-slides', action: 'rm' })).code === 400)
  const inst = await appeler('/kybernos-hub/module', 'POST', { id: 'dsh-mermaid', action: 'installer' })
  ok('installer runs the robot once and asks for a relaunch', inst.code === 200 && inst.body.relanceRequise === true && robots.length === 1)
  ok('relaunch without confirmation does nothing', (await appeler('/kybernos-hub/relaunch', 'POST', {})).code === 400 && relances === 0)
  ok('relaunch with confirmation runs once', (await appeler('/kybernos-hub/relaunch', 'POST', { confirm: true })).code === 200 && relances === 1)
  ok('a foreign origin cannot relaunch DSH', (await appeler('/kybernos-hub/relaunch', 'POST', { confirm: true }, { origin: 'http://evil.example' })).code === 403 && relances === 1)
}
{
  // two installs at once: the second is told to wait, the robot runs once
  let liberer
  const bloque = new Promise((r) => { liberer = r })
  const r2 = {}
  let n = 0
  monterSuite({ register: (r) => { r2[r.path] = r.handler } }, { ...deps, executer: async () => { n++; await bloque; return { code: 0, sortie: '' } } })
  const a = faux('POST', { id: 'dsh-mermaid', action: 'installer' }); const pa = r2['/kybernos-hub/module'](a.req, a.res)
  await new Promise((r) => setTimeout(r, 10))
  const b = faux('POST', { id: 'dsh-db-viewer', action: 'installer' }); await r2['/kybernos-hub/module'](b.req, b.res)
  ok('a second install while one runs answers 409', b.res.code === 409 && n === 1)
  liberer(); await pa
  const c = faux('POST', { id: 'dsh-media-player', action: 'activer' }); await r2['/kybernos-hub/module'](c.req, c.res)
  ok('the lock is released afterwards', c.res.code === 200)
}

console.log('\nSUITE HOST — ' + total + ' assertions, ' + echecs + ' failure(s)')
process.exit(echecs === 0 ? 0 : 1)
