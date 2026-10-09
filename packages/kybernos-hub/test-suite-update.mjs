// The Suite's online catalogue and its whole-suite update: refresh, cached verdict, status, the update itself and its routes.
// Every side effect is injected (network, disk, robot): nothing here downloads, writes outside memory or installs anything.
//   node packages/kybernos-hub/test-suite-update.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monterSuite } from './hub-host.mjs'
import { detecterHebergement, etatDistant, evaluerCache, mettreAJour, plateformeDe, rafraichir } from './suite-host.mjs'
import { evaluer } from './catalogue-distant.mjs'
import { assemblerRelease, genererCles, octetsDe, signer } from './catalogue-publication.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const embarque = JSON.parse(readFileSync(join(ICI, 'catalog.json'), 'utf8'))
let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total += 1; if (cond) console.log('  ✓ ' + nom); else { echecs += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 240) : '')) } }

const K = genererCles()
const AUTRE = genererCles()
const cles = [{ keyId: K.keyId, pem: K.publicPem }]
const archives = { mac: { nom: 'kybernos-1.1.0-mac.tar.gz', url: 'https://github.com/o/r/releases/download/v1.1.0/kybernos-1.1.0-mac.tar.gz', sha256: 'b'.repeat(64), taille: 5000 } }
const publier = (version, k = K, over = {}) => {
  const octets = octetsDe(assemblerRelease({ catalogue: embarque, versionSuite: version, archives, publieLe: '2026-10-05T12:00:00Z', ...over }))
  return { octets, signature: signer(octets, k.privatePem) + '\n' }
}
const URL = 'https://github.com/o/r/releases/latest/download/catalog.release.json'
const reseau = (rel) => async (url) => { if (rel === null) throw new Error('getaddrinfo ENOTFOUND'); return url.endsWith('.sig') ? Buffer.from(rel.signature) : rel.octets }

console.log('refresh')
{
  let appels = 0
  let cache = null
  const base = { url: URL, cles, versionSuite: '1.0.0-beta.1', ecrireCache: (c) => { cache = c } }
  let r = await rafraichir({ ...base, cles: [], telecharger: async () => { appels += 1; return Buffer.alloc(0) } })
  ok('no trusted key: nothing is asked of the network', r.erreur === 'pas-de-cle' && appels === 0)
  for (const url of ['http://x/y', 'ftp://x/y', '', undefined, 'not a url']) { r = await rafraichir({ ...base, url, telecharger: async () => { appels += 1; return Buffer.alloc(0) } }); if (r.erreur !== 'url' || appels !== 0) break }
  ok('only an https URL is ever fetched', r.erreur === 'url' && appels === 0)
  r = await rafraichir({ ...base, telecharger: reseau(null) })
  ok('a network failure is reported, the cache untouched', r.ok === false && r.erreur === 'reseau' && cache === null)
  const bon = publier('1.1.0')
  r = await rafraichir({ ...base, telecharger: reseau(bon) })
  ok('a signed newer release is accepted and cached: bytes and signature', r.ok === true && r.etat === 'nouveau' && r.suite === '1.1.0' && cache.octets.equals(bon.octets) && cache.signature === bon.signature)
  cache = null
  r = await rafraichir({ ...base, versionSuite: '1.1.0', telecharger: reseau(bon) })
  ok('the same suite version: up to date, still cached', r.ok === true && r.etat === 'a-jour' && cache !== null)
  cache = null
  r = await rafraichir({ ...base, telecharger: reseau(publier('1.1.0', AUTRE)) })
  ok('signed by a key nobody trusts: refused, cache untouched', r.erreur === 'signature' && cache === null)
  r = await rafraichir({ ...base, telecharger: async (u) => (u.endsWith('.sig') ? Buffer.from(bon.signature) : Buffer.from(bon.octets.toString().replace('1.1.0', '9.9.9'))) })
  ok('a document altered in transit: refused, cache untouched', r.erreur === 'signature' && cache === null)
  r = await rafraichir({ ...base, versionSuite: '2.0.0', telecharger: reseau(bon) })
  ok('a genuine but OLDER release (a replay) is refused, cache untouched', r.erreur === 'plus-ancien' && cache === null)
  r = await rafraichir({ ...base, telecharger: async (u) => { if (u.endsWith('.sig')) throw new Error('404'); return bon.octets } })
  ok('a missing signature file is a network error, never an acceptance', r.ok === false && cache === null)
  r = await rafraichir({ ...base, telecharger: reseau(bon), ecrireCache: () => { throw new Error('EACCES') } })
  ok('a cache that cannot be written is reported', r.erreur === 'cache')
}

console.log('the cached verdict')
{
  const bon = publier('1.1.0')
  const v = evaluerCache({ lireCache: () => bon, cles, versionSuite: '1.0.0' })
  ok('a good cache is re-verified and flagged newer', v.ok === true && v.plusRecent === true)
  ok('a cache edited on disk stops verifying', evaluerCache({ lireCache: () => ({ octets: Buffer.from(bon.octets.toString().replace('1.1.0', '1.1.1')), signature: bon.signature }), cles, versionSuite: '1.0.0' }).erreur === 'signature')
  ok('no cache, an unreadable cache: nothing, no throw', evaluerCache({ lireCache: () => null, cles, versionSuite: '1.0.0' }) === null && evaluerCache({ lireCache: () => { throw new Error('x') }, cles, versionSuite: '1.0.0' }) === null)
  ok('the key being removed after the fact makes the cache untrusted', evaluerCache({ lireCache: () => bon, cles: [], versionSuite: '1.0.0' }).erreur === 'pas-de-cle')
}

console.log('what the panel is told')
{
  const ev = evaluer({ ...publier('1.1.0'), cles, versionSuite: '1.0.0' })
  const base = { evaluation: ev, cle: true, urlConfiguree: true, plateforme: 'mac', racineDev: false }
  ok('an update can be applied from here', etatDistant(base).miseAJour.possible === true && etatDistant(base).plusRecent === true && etatDistant(base).suite === '1.1.0')
  ok('each reason it cannot', etatDistant({ ...base, cle: false }).miseAJour.raison === 'no-key' && etatDistant({ ...base, evaluation: null }).miseAJour.raison === 'no-release' && etatDistant({ ...base, evaluation: { ok: false, erreur: 'signature' } }).evaluation === 'signature' && etatDistant({ ...base, evaluation: { ...ev, plusRecent: false } }).miseAJour.raison === 'up-to-date' && etatDistant({ ...base, plateforme: 'linux' }).miseAJour.raison === 'no-archive-for-platform' && etatDistant({ ...base, racineDev: true }).miseAJour.raison === 'development-checkout')
  ok('platform names', plateformeDe('darwin') === 'mac' && plateformeDe('win32') === 'windows' && plateformeDe('linux') === 'linux' && plateformeDe('freebsd') === 'linux')
}

console.log('a hosted instance (a server, a container) is rebuilt, not patched')
{
  const aucun = () => false
  const dockerenv = (p) => p === '/.dockerenv'
  const H = (env, existe = aucun) => detecterHebergement({ env, existe })
  ok('a plain local machine is not hosted', H({ PATH: '/usr/bin', HOME: '/Users/x' }).heberge === false && H({}).raison === null)
  ok('KYBERNOS_HOSTED=1 / true / yes forces it on', ['1', 'true', 'YES', ' true '].every((v) => H({ KYBERNOS_HOSTED: v }).heberge === true && H({ KYBERNOS_HOSTED: v }).raison === 'env'))
  ok('KYBERNOS_HOSTED=0 / false / no forces it off, even inside a container (a local DSH that runs in Docker)', ['0', 'false', 'no'].every((v) => H({ KYBERNOS_HOSTED: v, COOLIFY_FQDN: 'x' }, dockerenv).heberge === false))
  ok('the Kybernos gate variables mean hosted', H({ KYBERNOS_PUBLIC_HOST: 'dsh.example.com' }).raison === 'gate' && H({ KYBERNOS_GATE_PASSWORD: 'x' }).raison === 'gate')
  ok('an empty or blank variable does not', H({ KYBERNOS_PUBLIC_HOST: '', KYBERNOS_GATE_PASSWORD: '   ' }).heberge === false)
  ok('the COOLIFY_* variables that Coolify puts in a container mean hosted', H({ COOLIFY_FQDN: 'dsh.example.com' }).raison === 'coolify' && H({ COOLIFY_URL: 'x' }).heberge === true)
  ok('the marker file of Docker means hosted', H({}, dockerenv).raison === 'container')
  ok('an unreadable marker, a missing env or a missing probe never throw', H({}, () => { throw new Error('EACCES') }).heberge === false && detecterHebergement({ env: null, existe: undefined }).heberge === false)

  const ev = evaluer({ ...publier('1.1.0'), cles, versionSuite: '1.0.0' })
  const base = { evaluation: ev, cle: true, urlConfiguree: true, plateforme: 'mac', racineDev: false }
  const heberge = { heberge: true, raison: 'coolify' }
  ok('hosted: the update cannot be applied here, and the reason says so', etatDistant({ ...base, hebergement: heberge }).miseAJour.possible === false && etatDistant({ ...base, hebergement: heberge }).miseAJour.raison === 'hosted-instance')
  ok('hosted wins over a development checkout (the image of a hosted instance is often built from a git clone: it must not be told to git pull inside a container)', etatDistant({ ...base, racineDev: true, hebergement: heberge }).miseAJour.raison === 'hosted-instance')
  ok('the panel is told whether the instance is hosted, and why', etatDistant({ ...base, hebergement: heberge }).hebergement.heberge === true && etatDistant({ ...base, hebergement: heberge }).hebergement.raison === 'coolify' && etatDistant(base).hebergement.heberge === false)
  ok('a hosted instance that is up to date still says up-to-date (the reason that matters most)', etatDistant({ ...base, evaluation: { ...ev, plusRecent: false }, hebergement: heberge }).miseAJour.raison === 'up-to-date')
  const log = []
  const r0 = await mettreAJour({ evaluation: ev, plateforme: 'mac', racineDev: false, hebergement: heberge, telechargerVers: async () => { log.push('download') }, extraire: async () => { log.push('extract') }, executer: async () => { log.push('robot'); return { code: 0 } }, nettoyer: async () => {}, progres: () => {} })
  ok('mettreAJour refuses on a hosted instance before downloading or running anything', r0.ok === false && r0.error === 'hosted-instance' && log.length === 0, JSON.stringify([r0, log]))
}

console.log('the update itself')
{
  const ev = evaluer({ ...publier('1.1.0'), cles, versionSuite: '1.0.0' })
  const monde = (over = {}) => {
    const log = []
    return { log, args: {
      evaluation: ev, plateforme: 'mac', racineDev: false,
      telechargerVers: async (url, o) => { log.push('download ' + url.split('/').pop() + ' max=' + o.max); return { fichier: '/tmp/x/archive.tar.gz', sha256: 'b'.repeat(64), taille: 5000 } },
      extraire: async (f) => { log.push('extract ' + f.split('/').pop()); return '/tmp/x/contenu/kybernos' },
      executer: async (racine) => { log.push('robot ' + racine.split('/').pop()); return { code: 0, sortie: 'ok' } },
      nettoyer: async () => { log.push('cleanup') },
      progres: (e) => { log.push('→' + e) }, ...over
    } }
  }
  let m = monde()
  let r = await mettreAJour(m.args)
  ok('success: download, verify, extract, robot, cleanup — in that order — and a restart is asked for', r.ok === true && r.relanceRequise === true && r.version === '1.1.0' && m.log.join(' | ') === '→telechargement | download kybernos-1.1.0-mac.tar.gz max=5000 | →extraction | extract archive.tar.gz | →installation | robot kybernos | cleanup', m.log)
  m = monde({ racineDev: true }); r = await mettreAJour(m.args)
  ok('a development checkout (a git working tree) is never replaced by an archive', r.error === 'development-checkout' && m.log.length === 0)
  m = monde({ evaluation: null }); r = await mettreAJour(m.args)
  ok('nothing verified, nothing to do', r.error === 'nothing-to-update' && m.log.length === 0)
  m = monde({ evaluation: { ...ev, plusRecent: false } }); r = await mettreAJour(m.args)
  ok('already up to date: nothing to do', r.error === 'nothing-to-update')
  m = monde({ plateforme: 'linux' }); r = await mettreAJour(m.args)
  ok('no archive for this platform', r.error === 'no-archive-for-platform' && m.log.length === 0)
  m = monde({ telechargerVers: async () => ({ fichier: '/tmp/a', sha256: 'c'.repeat(64), taille: 5000 }) }); r = await mettreAJour(m.args)
  ok('a wrong SHA-256 stops everything: no extraction, no robot, the folder is cleaned', r.error === 'digest-mismatch' && m.log.every((l) => !/extract|robot/.test(l)) && m.log.includes('cleanup'), m.log)
  m = monde({ telechargerVers: async () => ({ fichier: '/tmp/a', sha256: 'b'.repeat(64), taille: 4999 }) }); r = await mettreAJour(m.args)
  ok('a wrong size stops everything too', r.error === 'digest-mismatch' && m.log.every((l) => !/robot/.test(l)))
  m = monde({ executer: async () => ({ code: 1, sortie: 'a\nb\nboot check failed' }) }); r = await mettreAJour(m.args)
  ok('a refusing robot (it rolled back by itself) is reported with its last lines, and no restart is asked', r.ok === false && r.error === 'robot-refused' && r.detail.includes('boot check failed') && r.relanceRequise === undefined && m.log.includes('cleanup'))
  m = monde({ extraire: async () => { throw Object.assign(new Error('no manifest'), { code: 'bad-archive' }) } }); r = await mettreAJour(m.args)
  ok('a bad archive is reported with its code, and the robot never runs', r.error === 'bad-archive' && m.log.every((l) => !/robot/.test(l)))
  m = monde({ telechargerVers: async () => { throw Object.assign(new Error('too big'), { code: 'trop-gros' }) } }); r = await mettreAJour(m.args)
  ok('a download that fails is reported, never thrown', r.error === 'trop-gros' && m.log.includes('cleanup'))
  m = monde({ nettoyer: async () => { throw new Error('EBUSY') } }); r = await mettreAJour(m.args)
  ok('a clean-up that fails does not turn a success into a failure', r.ok === true)
}

console.log('the routes')
{
  const bon = publier('1.1.0')
  let cache = null
  let appelsReseau = 0
  const deps = (over = {}) => ({
    catalogue: embarque, hub: { etat: () => ({ ok: true }) },
    lireActivation: () => null, ecrireActivation: () => {}, executer: async () => ({ code: 0, sortie: '' }), relancer: async () => ({ ok: true }),
    cles: () => cles, versionSuite: () => '1.0.0-beta.1', urlCatalogue: () => URL,
    lireCache: () => cache, ecrireCache: (c) => { cache = c },
    telecharger: async (u) => { appelsReseau += 1; return u.endsWith('.sig') ? Buffer.from(bon.signature) : bon.octets },
    telechargerVers: async () => ({ fichier: '/tmp/a', sha256: 'b'.repeat(64), taille: 5000 }), extraire: async () => '/tmp/x', executerArchive: async () => ({ code: 0, sortie: '' }), nettoyer: async () => {},
    racineDev: () => false, plateforme: 'mac', ...over
  })
  const monter = (d) => { const r = {}; monterSuite({ register: (x) => { r[x.path] = x.handler } }, d); return r }
  const faux = (methode, corps, entetes = {}) => {
    const req = Object.assign((async function * () { if (corps !== undefined) yield Buffer.from(JSON.stringify(corps)) })(), { method: methode, headers: { origin: 'http://127.0.0.1:3080', 'content-type': 'application/json', ...entetes }, socket: { localPort: 3080 } })
    return { req, res: { code: null, body: null, writeHead (c) { this.code = c }, end (b) { this.body = b === undefined ? null : JSON.parse(b) } } }
  }
  const appeler = async (r, chemin, methode, corps, entetes) => { const { req, res } = faux(methode, corps, entetes); await r[chemin](req, res); return res }

  let r = monter(deps())
  let s = await appeler(r, '/kybernos-hub/suite', 'GET')
  ok('with no release cached the panel gets the shipped catalogue, and is told what is missing', s.body.catalogue.source === 'embarque' && s.body.distant.miseAJour.raison === 'no-release' && s.body.distant.cle === true && s.body.modules.length === embarque.modules.length)
  let g = await appeler(r, '/kybernos-hub/catalogue/refresh', 'POST', {})
  ok('refresh asks the network and caches a verified release', g.code === 200 && g.body.etat === 'nouveau' && cache !== null && appelsReseau === 2, g.body)
  s = await appeler(r, '/kybernos-hub/suite', 'GET')
  ok('the panel now shows the signed catalogue, its suite version, and that an update is possible', s.body.catalogue.source === 'signe' && s.body.catalogue.suite.version === '1.1.0' && s.body.distant.miseAJour.possible === true && s.body.distant.derniere.etat === 'nouveau')
  ok('refresh needs a strict same-origin JSON POST', (await appeler(r, '/kybernos-hub/catalogue/refresh', 'POST', {}, { origin: 'http://evil.example' })).code === 403 && (await appeler(r, '/kybernos-hub/catalogue/refresh', 'POST', {}, { 'content-type': 'text/plain' })).code === 415 && (await appeler(r, '/kybernos-hub/catalogue/refresh', 'GET')).code === 405)
  cache = null
  r = monter(deps({ cles: () => [] }))
  g = await appeler(r, '/kybernos-hub/catalogue/refresh', 'POST', {})
  ok('refresh with no trusted key is a clean 400 and no network call', g.code === 400 && g.body.erreur === 'pas-de-cle' && appelsReseau === 2)
  r = monter(deps({ telecharger: async () => { throw new Error('offline') } }))
  g = await appeler(r, '/kybernos-hub/catalogue/refresh', 'POST', {})
  ok('refresh while offline is a 502, not a crash', g.code === 502 && g.body.erreur === 'reseau')
  r = monter({ catalogue: embarque, hub: { etat: () => ({ ok: true }) }, lireActivation: () => null, ecrireActivation: () => {}, executer: async () => ({ code: 0 }), relancer: async () => ({ ok: true }) })
  ok('a deps object with no online half serves the shipped catalogue and answers 404 on the online routes', (await appeler(r, '/kybernos-hub/suite', 'GET')).body.distant === null && (await appeler(r, '/kybernos-hub/catalogue/refresh', 'POST', {})).code === 404 && (await appeler(r, '/kybernos-hub/update', 'POST', { confirm: true })).code === 404)

  // update
  cache = bon
  r = monter(deps())
  ok('update needs an explicit confirmation', (await appeler(r, '/kybernos-hub/update', 'POST', {})).code === 400)
  ok('update is strict same-origin too', (await appeler(r, '/kybernos-hub/update', 'POST', { confirm: true }, { origin: 'http://evil.example' })).code === 403)
  let netAvant = appelsReseau
  r = monter(deps({ racineDev: () => true, hebergement: () => ({ heberge: true, raison: 'coolify' }) }))
  let u = await appeler(r, '/kybernos-hub/update', 'POST', { confirm: true })
  ok('on a hosted instance the answer is 409 hosted-instance, even when it is also a git checkout, and nothing is downloaded', u.code === 409 && u.body.error === 'hosted-instance' && appelsReseau === netAvant, JSON.stringify(u.body))
  u = await appeler(r, '/kybernos-hub/suite', 'GET')
  ok('the panel route tells the client the instance is hosted', u.body.distant.hebergement.heberge === true && u.body.distant.miseAJour.raison === 'hosted-instance')
  r = monter(deps({ racineDev: () => true }))
  u = await appeler(r, '/kybernos-hub/update', 'POST', { confirm: true })
  ok('from a development checkout the answer is 409 and the reason, before anything runs', u.code === 409 && u.body.error === 'development-checkout')
  r = monter(deps({ plateforme: 'linux' }))
  ok('a release with no archive for this platform: 409', (await appeler(r, '/kybernos-hub/update', 'POST', { confirm: true })).body.error === 'no-archive-for-platform')
  cache = null
  r = monter(deps())
  ok('with no verified release: 409', (await appeler(r, '/kybernos-hub/update', 'POST', { confirm: true })).body.error === 'no-release')

  cache = bon
  let liberer
  const bloque = new Promise((x) => { liberer = x })
  const robots = []
  r = monter(deps({ executerArchive: async (racine) => { robots.push(racine); await bloque; return { code: 0, sortie: 'done' } } }))
  u = await appeler(r, '/kybernos-hub/update', 'POST', { confirm: true })
  ok('a valid update answers 202 at once and starts', u.code === 202 && u.body.ok === true)
  await new Promise((x) => setTimeout(x, 20))
  let st = await appeler(r, '/kybernos-hub/update/status', 'GET')
  ok('the status says which step it is on', st.code === 200 && st.body.etat === 'installation' && st.body.version === '1.1.0', st.body)
  ok('while it runs nothing else may run: a second update, a refresh and an install all answer 409', (await appeler(r, '/kybernos-hub/update', 'POST', { confirm: true })).code === 409 && (await appeler(r, '/kybernos-hub/catalogue/refresh', 'POST', {})).code === 409 && (await appeler(r, '/kybernos-hub/module', 'POST', { id: 'dsh-mermaid', action: 'installer' })).code === 409)
  liberer()
  await new Promise((x) => setTimeout(x, 20))
  st = await appeler(r, '/kybernos-hub/update/status', 'GET')
  ok('it ends as "termine" and asks for a restart; the lock is released', st.body.etat === 'termine' && st.body.relanceRequise === true && (await appeler(r, '/kybernos-hub/module', 'POST', { id: 'dsh-mermaid', action: 'activer' })).code === 200 && robots.length === 1)
  r = monter(deps({ executerArchive: async () => ({ code: 1, sortie: 'a\nrolled back' }) }))
  await appeler(r, '/kybernos-hub/update', 'POST', { confirm: true })
  await new Promise((x) => setTimeout(x, 20))
  st = await appeler(r, '/kybernos-hub/update/status', 'GET')
  ok('a refused install ends as "echec" with the robot’s last lines', st.body.etat === 'echec' && st.body.erreur === 'robot-refused' && /rolled back/.test(st.body.detail), st.body)
  ok('status before any update is idle', (await appeler(monter(deps()), '/kybernos-hub/update/status', 'GET')).body.etat === 'idle' && (await appeler(r, '/kybernos-hub/update/status', 'POST', {})).code === 405)
}

console.log('\n' + (total - echecs) + '/' + total + ' passed')
process.exit(echecs === 0 ? 0 : 1)
