// Update detection: pure composition + reading the published VERSION
// (local server, no real network).  node test-update.mjs
import { createServer } from 'node:http'

let ok = 0
let ko = 0
const verifie = (nom, cond, detail) => {
  if (cond) { ok += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

let corps = '1.0.0-beta.2\n'
let statut = 200
const serveur = createServer((req, res) => { res.writeHead(statut, { 'content-type': 'text/plain' }); res.end(corps) })
await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
process.env.KYBERNOS_VERSION_URL = 'http://127.0.0.1:' + serveur.address().port + '/VERSION'
const { composerMaj, lirePackDistant, comparerVersions, mesurerMaj } = await import('./index.js')

console.log('reading the published VERSION')
let p = await lirePackDistant(true)
verifie('version read, reachable', p.joignable === true && p.latest === '1.0.0-beta.2', p)
corps = '1.0.0-beta.9\n'
p = await lirePackDistant(false)
verifie('the one-hour cache is served without a new call', p.latest === '1.0.0-beta.2', p)
p = await lirePackDistant(true)
verifie('"force" bypasses the cache', p.latest === '1.0.0-beta.9', p)
corps = '<html>404</html>'
p = await lirePackDistant(true)
verifie('content that is not a version is rejected', p.joignable === false && p.latest === null, p)
corps = '1.0.0\n'; statut = 404
p = await lirePackDistant(true)
verifie('a 404 response is never mistaken for a version', p.joignable === false && p.latest === null, p)
statut = 200
serveur.close()
p = await lirePackDistant(true)
verifie('unreachable server: joignable=false, without throwing', p.joignable === false && p.latest === null, p)

console.log('composing the response')
const moteurRien = { global: '0.2.0-rc.2', distant: { derniere: '0.2.0-rc.2' }, maj: { niveau: 'Aucune', cible: null, note: 'x' } }
let r = composerMaj({ pack: { joignable: true, latest: '1.0.0-beta.2' }, installee: '1.0.0-beta.1', etat: moteurRien, git: false, quand: 'T' })
verifie('newer pack: announced first', r.pending !== null && r.pending.kind === 'kybernos' && r.pending.cible === '1.0.0-beta.2' && r.pack.disponible === true, r.pending)
r = composerMaj({ pack: { joignable: true, latest: '1.0.0-beta.1' }, installee: '1.0.0-beta.1', etat: moteurRien, git: false, quand: 'T' })
verifie('pack up to date and engine with no upgrade: nothing to announce', r.pending === null && r.pack.disponible === false, r.pending)
r = composerMaj({ pack: { joignable: true, latest: '0.9.0' }, installee: '1.0.0-beta.1', etat: moteurRien, git: false, quand: 'T' })
verifie('a published version that is OLDER is not an update', r.pending === null, r.pending)
r = composerMaj({ pack: { joignable: false, latest: null }, installee: '1.0.0-beta.1', etat: moteurRien, git: false, quand: 'T' })
verifie('repository unreachable: no made-up alert', r.pending === null && r.pack.joignable === false, r)
r = composerMaj({ pack: { joignable: true, latest: '2.0.0' }, installee: null, etat: moteurRien, git: false, quand: 'T' })
verifie('installed version unreadable: nothing is announced', r.pending === null, r.pending)
const moteurPossible = { global: '0.2.0-rc.2', distant: { derniere: '0.2.0' }, maj: { niveau: 'Possible', cible: '0.2.0', note: 'ok' } }
r = composerMaj({ pack: { joignable: true, latest: '1.0.0-beta.1' }, installee: '1.0.0-beta.1', etat: moteurPossible, git: true, quand: 'T' })
verifie('recommended engine upgrade: announced', r.pending !== null && r.pending.kind === 'moteur' && r.pending.cible === '0.2.0' && r.pending.requis === false && r.pack.git === true, r.pending)
const moteurRequis = { global: '0.1.0', distant: { derniere: '0.2.0' }, maj: { niveau: 'Requise', cible: '0.2.0-rc.2', note: 'min' } }
r = composerMaj({ pack: { joignable: true, latest: '1.0.0-beta.1' }, installee: '1.0.0-beta.1', etat: moteurRequis, git: false, quand: 'T' })
verifie('engine below the minimum: marked required', r.pending !== null && r.pending.requis === true, r.pending)
const moteurHors = { global: '0.2.0-rc.2', distant: { derniere: '0.2.1-alpha.1' }, maj: { niveau: 'Aucune', cible: null, note: 'hors zone' } }
r = composerMaj({ pack: { joignable: true, latest: '1.0.0-beta.1' }, installee: '1.0.0-beta.1', etat: moteurHors, git: false, quand: 'T' })
verifie('engine published OUTSIDE the supported range: never offered', r.pending === null && r.moteur.latest === '0.2.1-alpha.1', r)
verifie('comparerVersions : beta.10 > beta.2', comparerVersions('1.0.0-beta.2', '1.0.0-beta.10') < 0)

console.log('the route\'s measure, end to end (engine measure stubbed, everything else real)')
// A regression guard: `existsSync` was used here without being imported, so GET /kybernos-maintenance/update answered 500 on every
// machine and no update was ever announced. The pure composition above never reaches that line; this does.
const serveur2 = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('99.0.0\n') })
await new Promise((r) => serveur2.listen(0, '127.0.0.1', r))
process.env.KYBERNOS_VERSION_URL = 'http://127.0.0.1:' + serveur2.address().port + '/VERSION'
const mesure = await mesurerMaj(true, { etat: async () => moteurRien }).catch((e) => ({ ok: false, erreur: String(e && e.message) }))
verifie('mesurerMaj answers instead of throwing', mesure.ok === true, mesure)
verifie('it reads this checkout\'s VERSION and says whether a git checkout', typeof mesure.pack?.installee === 'string' && typeof mesure.pack?.git === 'boolean', mesure.pack)
serveur2.close()

console.log('the switch « Check for updates automatically » (A6-14, A6-26)')
{
  const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { lireReglage, ecrireReglage, repondreMaj } = await import('./index.js')
  const dossier = mkdtempSync(join(tmpdir(), 'kb-upd-'))
  const fichier = join(dossier, 'kybernos', 'update-check.json')
  verifie('no file: ON by default (a security fix has to be announced)', lireReglage(fichier).autoCheck === true)
  ecrireReglage(false, fichier)
  verifie('written OFF, it reads OFF, and the file holds nothing else', lireReglage(fichier).autoCheck === false && JSON.stringify(Object.keys(JSON.parse(readFileSync(fichier, 'utf8')))) === '["autoCheck"]')
  writeFileSync(fichier, '{broken')
  verifie('an unreadable file reads ON, not an error', lireReglage(fichier).autoCheck === true)
  verifie('a value that is not exactly true is written OFF', ecrireReglage('yes', fichier).autoCheck === false && lireReglage(fichier).autoCheck === false)
  let appels = 0
  let derniere = null
  const mesurer = async (force) => { appels += 1; derniere = force; return { ok: true, force } }
  const off = () => ({ autoCheck: false })
  const on = () => ({ autoCheck: true })
  let r = await repondreMaj('/kybernos-maintenance/update?auto=1', { reglage: off, mesurer })
  verifie('OFF: the scheduled check answers « disabled » and asks nobody', r.ok === true && r.desactive === true && appels === 0, [r, appels])
  r = await repondreMaj('/kybernos-maintenance/update?auto=1&force=1', { reglage: off, mesurer })
  verifie('...even when forced: only the person\'s own button forces', r.desactive === true && appels === 0)
  r = await repondreMaj('/kybernos-maintenance/update', { reglage: off, mesurer })
  verifie('OFF: « Check now » (no auto) still measures: it is the person\'s action', r.ok === true && r.desactive === undefined && appels === 1, [r, appels])
  r = await repondreMaj('/kybernos-maintenance/update?force=1', { reglage: off, mesurer })
  verifie('...and forced', appels === 2 && derniere === true, [appels, derniere])
  r = await repondreMaj('/kybernos-maintenance/update?auto=1', { reglage: on, mesurer })
  verifie('ON: the scheduled check measures', appels === 3 && derniere === false && r.desactive === undefined, [appels, derniere])
  r = await repondreMaj('/kybernos-maintenance/update?auto=10', { reglage: off, mesurer })
  verifie('only auto=1 is the scheduled check (auto=10 is not)', appels === 4, appels)
}

console.log('\n' + ok + ' ✓  ' + ko + ' ✗')
process.exit(ko === 0 ? 0 : 1)
