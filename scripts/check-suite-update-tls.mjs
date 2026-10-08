#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Live probe (NOT run in CI): the Suite's online update, over a REAL TLS connection, against a local server.
//
//   · a local https server on 127.0.0.1 with a throw-away self-signed certificate (needs `openssl`; skipped without it);
//   · a throw-away Ed25519 key pair generated here (the production key is never read, nothing is embedded anywhere);
//   · the client half runs in a CHILD process, with NODE_EXTRA_CA_CERTS pointing at that certificate for that process only;
//   · the real packages/kybernos-hub code does the work: rafraichir() for the signed catalogue, mettreAJour() for the archive.
//
// It checks that a tampered, wrongly signed, truncated, oversized, replayed (older) or downgrading answer is refused,
// that nothing reaches the cache or the robot when it is, and that the genuine answer goes through.
//
//   node scripts/check-suite-update-tls.mjs [--port 9516]
// Exit 0 = every expectation held (or openssl missing: skipped), 1 = one did not.
// ═══════════════════════════════════════════════════════════════════════════
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluer } from '../packages/kybernos-hub/catalogue-distant.mjs'
import { assemblerRelease, genererCles, octetsDe, signer } from '../packages/kybernos-hub/catalogue-publication.mjs'
import { mettreAJour, rafraichir } from '../packages/kybernos-hub/suite-host.mjs'
import { creerTelechargeurs } from '../packages/kybernos-hub/telechargement.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const HUB = join(ICI, '..', 'packages', 'kybernos-hub')
const INSTALLE = '1.0.0-beta.4'

// ───────────────────────────── client half (child process) ─────────────────────────────
if (process.argv.includes('--client')) {
  const base = process.env.KB_TLS_BASE
  const cles = JSON.parse(process.env.KB_TLS_KEYS)
  const sortie = []
  const dire = (o) => sortie.push(o)
  const t = creerTelechargeurs()                       // production settings: https only, no plain-http door
  for (const variante of JSON.parse(process.env.KB_TLS_DOCS)) {
    const cache = []
    const r = await rafraichir({ url: base + '/' + variante + '/catalog.release.json', cles, versionSuite: INSTALLE, telecharger: t.telecharger, ecrireCache: (x) => cache.push(x) })
    dire({ cas: 'doc:' + variante, ok: r.ok === true, erreur: r.erreur ?? null, etat: r.etat ?? null, suite: r.suite ?? null, cache: cache.length })
  }
  if (process.env.NODE_EXTRA_CA_CERTS === undefined) { console.log(JSON.stringify(sortie)); process.exit(0) }     // the control run stops here: it cannot trust the server
  // the update itself, from the genuine signed document, with each kind of archive on the wire
  const octets = Buffer.from(await (await fetch(base + '/ok/catalog.release.json')).arrayBuffer())
  const signature = (await (await fetch(base + '/ok/catalog.release.json.sig')).text())
  const evaluation = evaluer({ octets, signature, cles, versionSuite: INSTALLE })
  for (const nom of JSON.parse(process.env.KB_TLS_ARCHIVES)) {
    const doc = JSON.parse(JSON.stringify(evaluation.doc))
    for (const p of Object.keys(doc.suite.archives)) doc.suite.archives[p].url = base + '/archives/' + nom
    const appels = []
    const tt = creerTelechargeurs()
    const r = await mettreAJour({
      evaluation: { ...evaluation, doc }, plateforme: process.env.KB_TLS_PLATEFORME, racineDev: false,
      telechargerVers: tt.telechargerVers, extraire: tt.extraire, nettoyer: tt.nettoyer, progres: () => {},
      executer: async (racine) => { appels.push(racine); return { code: 0, sortie: 'robot would run here' } },
    })
    dire({ cas: 'archive:' + nom, ok: r.ok === true, erreur: r.error ?? null, robot: appels.length, tmpLaisse: tt.dossierTemporaire() !== null })
  }
  // a plain-http archive URL and a redirect that downgrades the transport
  const doc2 = JSON.parse(JSON.stringify(evaluation.doc))
  for (const p of Object.keys(doc2.suite.archives)) doc2.suite.archives[p].url = process.env.KB_TLS_HTTP + '/archives/ok.tar.gz'
  const r2 = await mettreAJour({ evaluation: { ...evaluation, doc: doc2 }, plateforme: process.env.KB_TLS_PLATEFORME, racineDev: false, telechargerVers: t.telechargerVers, extraire: t.extraire, nettoyer: t.nettoyer, progres: () => {}, executer: async () => ({ code: 0, sortie: '' }) })
  dire({ cas: 'archive:http-url', ok: r2.ok === true, erreur: r2.error ?? null, robot: 0 })
  console.log(JSON.stringify(sortie))
  process.exit(0)
}

// ───────────────────────────── orchestrator ─────────────────────────────
const portArg = process.argv.indexOf('--port')
const PORT = portArg >= 0 ? Number(process.argv[portArg + 1]) : 9516
let ko = 0
let n = 0
const ok = (titre, cond, detail = '') => { n += 1; console.log(`${cond ? '✓' : '✗'} ${titre}${cond || detail === '' ? '' : ' — ' + String(detail).slice(0, 300)}`); if (!cond) ko += 1 }

const tmp = mkdtempSync(join(tmpdir(), 'kb-tls-'))
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }) } catch (e) { console.log('skipped: openssl is not available'); process.exit(0) }
const cle = join(tmp, 'key.pem')
const cert = join(tmp, 'cert.pem')
execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', cle, '-out', cert, '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })

const A = genererCles()                                  // the key the client trusts
const B = genererCles()                                  // a key nobody trusts
const embarque = JSON.parse(readFileSync(join(HUB, 'catalog.json'), 'utf8'))

// the genuine archive: small, real tar.gz holding what extraire() looks for
const src = join(tmp, 'src')
mkdirSync(join(src, 'scripts'), { recursive: true })
writeFileSync(join(src, 'scripts', 'dsh-lifecycle.mjs'), 'console.log("robot")\n')
writeFileSync(join(src, 'manifest.json'), '{}\n')
writeFileSync(join(src, 'VERSION'), '1.0.0-beta.5\n')
execFileSync('tar', ['-czf', join(tmp, 'ok.tar.gz'), '-C', src, '.'])
const bon = readFileSync(join(tmp, 'ok.tar.gz'))
const tamper = Buffer.from(bon); tamper[Math.floor(bon.length / 2)] ^= 0x01     // one flipped bit, same length
const tronque = bon.subarray(0, Math.floor(bon.length / 2))
const trop = Buffer.concat([bon, Buffer.alloc(4096, 7)])

const plateformes = ['mac', 'linux', 'windows']
const archives = (version = '1.0.0-beta.5') => Object.fromEntries(plateformes.map((p) => [p, { nom: 'kybernos-dsh-' + version + '-' + p + '.tar.gz', url: 'https://127.0.0.1:' + PORT + '/archives/ok.tar.gz', sha256: createHash('sha256').update(bon).digest('hex'), taille: bon.length }]))
const release = (version, over = {}) => assemblerRelease({ catalogue: embarque, versionSuite: version, archives: archives(version), publieLe: '2026-10-08T12:00:00Z', ...over })
const signe = (doc, k = A) => { const o = octetsDe(doc); return { doc: o, sig: signer(o, k.privatePem) } }
const genuine = signe(release('1.0.0-beta.5'))
const variantes = {
  ok: genuine,
  tampered: { doc: Buffer.from(genuine.doc.toString().replace('1.0.0-beta.5', '9.9.9-evil')), sig: genuine.sig },          // signed bytes changed
  wrongkey: signe(release('1.0.0-beta.5'), B),                                                                              // signed by a key nobody trusts
  'trunc-doc': { doc: genuine.doc.subarray(0, Math.floor(genuine.doc.length / 2)), sig: genuine.sig },                       // document cut in half
  'trunc-sig': { doc: genuine.doc, sig: genuine.sig.slice(0, 30) },                                                          // signature cut
  garbage: { doc: genuine.doc, sig: '!!! not base64 !!!' },
  older: signe(release('1.0.0-beta.3')),                                                                                    // genuinely signed, but older than what is installed
  same: signe(release(INSTALLE)),
  huge: { doc: Buffer.alloc(2 * 1024 * 1024, 32), sig: genuine.sig },
  nosig: { doc: genuine.doc, sig: null },
}
const archivesServies = { 'ok.tar.gz': bon, 'tampered.tar.gz': tamper, 'truncated.tar.gz': tronque, 'oversize.tar.gz': trop }

const serveur = https.createServer({ key: readFileSync(cle), cert: readFileSync(cert) }, (req, res) => {
  const chemin = req.url.split('?')[0].split('/').filter(Boolean)
  const envoyer = (corps) => { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(corps) }
  if (chemin[0] === 'archives' && archivesServies[chemin[1]] !== undefined) return envoyer(archivesServies[chemin[1]])
  const v = variantes[chemin[0]]
  if (v !== undefined && chemin[1] === 'catalog.release.json') return envoyer(v.doc)
  if (v !== undefined && chemin[1] === 'catalog.release.json.sig') { if (v.sig === null) { res.writeHead(404); return res.end('no') } return envoyer(v.sig) }
  if (chemin[0] === 'redir-http') { res.writeHead(302, { location: 'http://127.0.0.1:' + (PORT + 1) + '/ok/' + chemin[1] }); return res.end() }
  res.writeHead(404); res.end('no')
})
const clair = http.createServer((req, res) => { res.writeHead(200); res.end(variantes.ok.doc) })      // the plain-http door a downgrading redirect would use
await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r))
await new Promise((r) => clair.listen(PORT + 1, '127.0.0.1', r))

// Asynchronous on purpose: the https server lives in THIS process and must keep answering while the client runs.
const client = async (avecCa) => {
  const env = { ...process.env, KB_TLS_BASE: 'https://127.0.0.1:' + PORT, KB_TLS_HTTP: 'http://127.0.0.1:' + (PORT + 1), KB_TLS_PLATEFORME: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux', KB_TLS_KEYS: JSON.stringify([{ keyId: A.keyId, pem: A.publicPem }]), KB_TLS_DOCS: JSON.stringify([...Object.keys(variantes), 'redir-http']), KB_TLS_ARCHIVES: JSON.stringify(['ok.tar.gz', 'tampered.tar.gz', 'truncated.tar.gz', 'oversize.tar.gz']) }
  if (avecCa) env.NODE_EXTRA_CA_CERTS = cert; else delete env.NODE_EXTRA_CA_CERTS
  const r = await new Promise((fin) => {
    const enfant = spawn(process.execPath, [fileURLToPath(import.meta.url), '--client'], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 })
    let stdout = ''
    let stderr = ''
    enfant.stdout.on('data', (d) => { stdout += d })
    enfant.stderr.on('data', (d) => { stderr += d })
    enfant.on('close', (status, signal) => fin({ status, signal, stdout, stderr }))
  })
  try { return JSON.parse(r.stdout.trim().split('\n').pop()) } catch (e) { return { erreur: 'client exit ' + r.status + ' signal ' + r.signal + ' ' + (r.stdout + r.stderr).slice(-400) } }
}

const sansCa = await client(false)
const avecCa = await client(true)
serveur.close(); clair.close()

console.log('TLS is verified')
ok('without trusting the certificate, the catalogue is NOT fetched (a network error, nothing cached)', Array.isArray(sansCa) && sansCa.filter((c) => c.cas.startsWith('doc:')).every((c) => c.ok === false && c.erreur === 'reseau' && c.cache === 0), JSON.stringify(sansCa).slice(0, 300))
if (!Array.isArray(avecCa)) { ok('the client ran', false, JSON.stringify(avecCa)); process.exit(1) }
const cas = Object.fromEntries(avecCa.map((c) => [c.cas, c]))
console.log('the signed catalogue')
ok('genuine, newer, signed by the trusted key: accepted, cached once, flagged as new', cas['doc:ok'].ok === true && cas['doc:ok'].etat === 'nouveau' && cas['doc:ok'].cache === 1, JSON.stringify(cas['doc:ok']))
ok('a document changed by one byte after signing: refused (signature), nothing cached', cas['doc:tampered'].ok === false && cas['doc:tampered'].erreur === 'signature' && cas['doc:tampered'].cache === 0, JSON.stringify(cas['doc:tampered']))
ok('signed by a key nobody trusts: refused (signature)', cas['doc:wrongkey'].erreur === 'signature' && cas['doc:wrongkey'].cache === 0)
ok('a truncated document: refused', cas['doc:trunc-doc'].ok === false && cas['doc:trunc-doc'].cache === 0, JSON.stringify(cas['doc:trunc-doc']))
ok('a truncated or garbage signature: refused', cas['doc:trunc-sig'].erreur === 'signature' && cas['doc:garbage'].erreur === 'signature')
ok('no signature file at all: refused (HTTP error), nothing cached', cas['doc:nosig'].ok === false && cas['doc:nosig'].cache === 0, JSON.stringify(cas['doc:nosig']))
ok('a document over the size cap: refused before it is parsed', cas['doc:huge'].ok === false && cas['doc:huge'].cache === 0, JSON.stringify(cas['doc:huge']))
ok('a genuinely signed OLDER release (a replay, a downgrade) is refused', cas['doc:older'].ok === false && cas['doc:older'].erreur === 'plus-ancien' && cas['doc:older'].cache === 0, JSON.stringify(cas['doc:older']))
ok('the same version as installed is accepted but is not offered as an update', cas['doc:same'].ok === true && cas['doc:same'].etat === 'a-jour', JSON.stringify(cas['doc:same']))
ok('a redirect that downgrades to plain http is refused', cas['doc:redir-http'].ok === false && cas['doc:redir-http'].cache === 0, JSON.stringify(cas['doc:redir-http']))
console.log('the archive')
ok('the genuine archive goes through to the robot, once, and its temp folder is cleaned up', cas['archive:ok.tar.gz'].ok === true && cas['archive:ok.tar.gz'].robot === 1 && cas['archive:ok.tar.gz'].tmpLaisse === false, JSON.stringify(cas['archive:ok.tar.gz']))
ok('one flipped bit: digest mismatch, the robot is never run, temp folder cleaned up', cas['archive:tampered.tar.gz'].erreur === 'digest-mismatch' && cas['archive:tampered.tar.gz'].robot === 0 && cas['archive:tampered.tar.gz'].tmpLaisse === false, JSON.stringify(cas['archive:tampered.tar.gz']))
ok('a truncated archive: refused, robot never run', cas['archive:truncated.tar.gz'].ok === false && cas['archive:truncated.tar.gz'].robot === 0 && cas['archive:truncated.tar.gz'].tmpLaisse === false, JSON.stringify(cas['archive:truncated.tar.gz']))
ok('more bytes than the signed size: cut off while streaming, robot never run', cas['archive:oversize.tar.gz'].ok === false && cas['archive:oversize.tar.gz'].erreur === 'trop-gros' && cas['archive:oversize.tar.gz'].robot === 0 && cas['archive:oversize.tar.gz'].tmpLaisse === false, JSON.stringify(cas['archive:oversize.tar.gz']))
ok('an archive URL in plain http is refused', cas['archive:http-url'].ok === false && cas['archive:http-url'].erreur === 'url' && cas['archive:http-url'].robot === 0, JSON.stringify(cas['archive:http-url']))

rmSync(tmp, { recursive: true, force: true })
console.log(`\n${n - ko}/${n} passed`)
process.exit(ko === 0 ? 0 : 1)
