// The online Suite catalogue: a signed release document, verified before it is believed, and the CLI that publishes it.
// No network, no DSH: keys are generated here, the CLI runs on a temp folder.
//   node packages/kybernos-hub/test-catalogue-distant.mjs
import { execFile } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { archivePour, catalogueEffectif, comparerVersions, evaluer, formeDuDocument, lireDocument, verifierSignature } from './catalogue-distant.mjs'
import { assemblerRelease, decrireArchive, genererCles, idDeCle, octetsDe, signer } from './catalogue-publication.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const CLI = join(ICI, '..', '..', 'scripts', 'catalog-release.mjs')
const embarque = JSON.parse(readFileSync(join(ICI, 'catalog.json'), 'utf8'))
let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total += 1; if (cond) console.log('  ✓ ' + nom); else { echecs += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 220) : '')) } }
const cli = (args) => new Promise((resolve) => execFile(process.execPath, [CLI, ...args], (e, out, err) => resolve({ code: e ? e.code : 0, out: String(out), err: String(err) })))

const A = genererCles()
const B = genererCles()
const archive = { mac: { nom: 'kybernos-1.1.0-mac.tar.gz', url: 'https://github.com/o/r/releases/download/v1.1.0/kybernos-1.1.0-mac.tar.gz', sha256: 'a'.repeat(64), taille: 4096 } }
const release = (v, over = {}) => assemblerRelease({ catalogue: embarque, versionSuite: v, archives: archive, publieLe: '2026-10-05T12:00:00Z', ...over })
const sigue = (doc, k = A) => { const octets = octetsDe(doc); return { octets, signature: signer(octets, k.privatePem) } }
const cles = [{ keyId: A.keyId, pem: A.publicPem }]

console.log('versions')
ok('numbers compare as numbers, a release beats its own pre-release', comparerVersions('1.0.0-beta.10', '1.0.0-beta.2') === 1 && comparerVersions('1.0.0', '1.0.0-rc.9') === 1 && comparerVersions('1.0.0-beta.1', '1.0.0-beta.1') === 0 && comparerVersions('0.9.9', '1.0.0') === -1 && comparerVersions('1.0', '1.0.0') === 0)

console.log('the document')
const bon = release('1.1.0')
ok('a release derived from the repo’s catalogue has an acceptable shape', formeDuDocument(bon) === null, formeDuDocument(bon))
const casse = (mut) => { const d = JSON.parse(JSON.stringify(bon)); mut(d); return formeDuDocument(d) }
ok('wrong schema, bad date, bad suite version', casse((d) => { d.schema = 1 }) === 'schema' && casse((d) => { d.publieLe = 'yesterday' }) === 'publieLe' && casse((d) => { d.suite.version = 'latest' }) === 'suite.version')
ok('an archive must be https, named safely, hashed with SHA-256 and sized', casse((d) => { d.suite.archives.mac.url = 'http://x/y' }) === 'archive.mac' && casse((d) => { d.suite.archives.mac.url = 'https://u:p@x/y' }) === 'archive.mac' && casse((d) => { d.suite.archives.mac.nom = '../../etc/passwd' }) === 'archive.mac' && casse((d) => { d.suite.archives.mac.sha256 = 'abc' }) === 'archive.mac' && casse((d) => { d.suite.archives.mac.taille = 0 }) === 'archive.mac' && casse((d) => { d.suite.archives.mac.taille = 10 ** 10 }) === 'archive.mac' && casse((d) => { d.suite.archives.beos = d.suite.archives.mac }) === 'archive.plateforme')
ok('modules: unique safe ids, names, a known family, bilingual promise and notes', casse((d) => { d.catalogue.modules[1].id = d.catalogue.modules[0].id }) === 'module.id' && casse((d) => { d.catalogue.modules[0].id = '../x' }) === 'module.id' && casse((d) => { d.catalogue.modules[0].famille = 'nope' }).startsWith('module.famille.') && casse((d) => { d.catalogue.modules[0].promesse = { fr: 'x' } }).startsWith('module.') && casse((d) => { d.catalogue.modules[0].notes = [{ fr: 'only french notes here' }] }).startsWith('module.notes.') && casse((d) => { d.catalogue.modules = [] }) === 'catalogue')
ok('the family colour must be a hex colour (it ends up in a style attribute)', casse((d) => { d.catalogue.familles[0].couleur = 'red;background:url(x)' }) === 'familles')
ok('not an object, not JSON, empty and too big are all refused without throwing', formeDuDocument(null) === 'not-an-object' && formeDuDocument([]) === 'not-an-object' && lireDocument(Buffer.from('{nope')).erreur === 'json' && lireDocument(Buffer.alloc(0)).erreur === 'taille' && lireDocument(Buffer.alloc(2 * 1024 * 1024)).erreur === 'taille' && lireDocument('text').erreur === 'taille')

console.log('the signature')
const { octets, signature } = sigue(bon)
ok('the signature of the exact bytes verifies and names the key', verifierSignature({ octets, signature, cles }) === A.keyId)
ok('one changed byte breaks it', verifierSignature({ octets: Buffer.concat([octets, Buffer.from(' ')]), signature, cles }) === null && verifierSignature({ octets: Buffer.from(octets.toString().replace('1.1.0', '1.1.1')), signature, cles }) === null)
ok('a key that did not sign it, no key, a short or garbage signature all verify nothing', verifierSignature({ octets, signature, cles: [{ keyId: B.keyId, pem: B.publicPem }] }) === null && verifierSignature({ octets, signature, cles: [] }) === null && verifierSignature({ octets, signature: 'AAAA', cles }) === null && verifierSignature({ octets, signature: '!!!', cles }) === null && verifierSignature({ octets, signature: undefined, cles }) === null && verifierSignature({ octets, signature, cles: [{ keyId: 'x', pem: 'not a key' }] }) === null)
ok('key rotation: either of two trusted keys is enough', verifierSignature({ octets, signature, cles: [{ keyId: B.keyId, pem: B.publicPem }, ...cles] }) === A.keyId)
const nue = generateKeyPairSync('ed25519')
ok('the key id is stable and short', idDeCle(A.publicPem) === A.keyId && /^[0-9a-f]{12}$/.test(A.keyId) && A.keyId !== B.keyId && sign(null, octets, nue.privateKey).length === 64)

console.log('the verdict')
const v110 = evaluer({ octets, signature, cles, versionSuite: '1.0.0-beta.1' })
ok('signed, well-formed and newer: accepted, flagged as an update', v110.ok === true && v110.plusRecent === true && v110.cle === A.keyId && v110.doc.suite.version === '1.1.0')
ok('the same suite version is accepted but is not "newer"', evaluer({ octets, signature, cles, versionSuite: '1.1.0' }).plusRecent === false)
ok('an OLDER release, genuinely signed, is refused: a replay is a rollback', evaluer({ octets, signature, cles, versionSuite: '1.2.0' }).erreur === 'plus-ancien')
ok('unsigned or badly signed: refused BEFORE anything is parsed', evaluer({ octets, signature: '', cles, versionSuite: '1.0.0' }).erreur === 'signature' && evaluer({ octets: Buffer.from('{"schema":2'), signature, cles, versionSuite: '1.0.0' }).erreur === 'signature')
ok('no trusted key installed: refused, and nothing is believed', evaluer({ octets, signature, cles: [], versionSuite: '1.0.0' }).erreur === 'pas-de-cle')
const mal = octetsDe({ ...bon, schema: 9 })
ok('a signed document of the wrong shape is refused too (a signature is not a licence to be malformed)', evaluer({ octets: mal, signature: signer(mal, A.privatePem), cles, versionSuite: '1.0.0' }).erreur === 'forme')

console.log('the catalogue the panel shows')
ok('with a signed newer release, its catalogue and its source', catalogueEffectif({ embarque, evaluation: v110 }).source === 'signe' && catalogueEffectif({ embarque, evaluation: v110 }).suite.plusRecent === true && catalogueEffectif({ embarque, evaluation: v110 }).modules.length === embarque.modules.length)
ok('with nothing or a refusal, the shipped one', catalogueEffectif({ embarque, evaluation: null }).source === 'embarque' && catalogueEffectif({ embarque, evaluation: { ok: false, erreur: 'signature' } }).source === 'embarque' && catalogueEffectif({ embarque, evaluation: undefined }).modules === embarque.modules)
ok('the archive for a platform, or null', archivePour(v110.doc, 'mac').nom === 'kybernos-1.1.0-mac.tar.gz' && archivePour(v110.doc, 'linux') === null && archivePour(null, 'mac') === null)
ok('release notes ride along when given, and only then', release('1.1.0', { notes: { 'kybernos-auto': [{ fr: 'Sonde avant routage.', en: 'Probe before routing.' }] } }).catalogue.modules.find((m) => m.id === 'kybernos-auto').notes.length === 1 && release('1.1.0').catalogue.modules.every((m) => m.notes === undefined))

console.log('the publishing CLI')
const tmp = mkdtempSync(join(tmpdir(), 'kb-release-'))
const cle = join(tmp, 'keys', 'private.pem')
let r = await cli(['keygen', '--out', cle])
ok('keygen writes the private key with mode 0600 and prints the public one', r.code === 0 && existsSync(cle) && (statSync(cle).mode & 0o777) === 0o600 && /BEGIN PUBLIC KEY/.test(r.out) && /key id [0-9a-f]{12}/.test(r.out), r)
r = await cli(['keygen', '--out', cle])
ok('it never overwrites a private key', r.code === 1 && /refusing to overwrite/.test(r.err))
r = await cli(['keygen', '--out', join(ICI, '..', '..', 'oops.pem')])
ok('it refuses to put the private key inside this repository', r.code === 1 && /OUTSIDE this repository/.test(r.err) && !existsSync(join(ICI, '..', '..', 'oops.pem')))
const pubPem = /(-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----)/.exec((await cli(['keygen', '--out', join(tmp, 'k2.pem')])).out)[1] + '\n'
const k2 = join(tmp, 'k2.pem')
const pubFichier = join(tmp, 'pub.json')
writeFileSync(pubFichier, JSON.stringify({ cles: [{ keyId: idDeCle(pubPem), pem: pubPem }] }))
const fauxArchive = join(tmp, 'kybernos-1.1.0-mac.tar.gz')
writeFileSync(fauxArchive, 'not really a tarball, but bytes')
r = await cli(['build', '--key', k2, '--out', join(tmp, 'out'), '--archive', 'mac=' + fauxArchive + '=https://github.com/o/r/releases/download/v1.1.0/kybernos-1.1.0-mac.tar.gz', '--version', '1.1.0', '--pub', pubFichier])
ok('build signs, writes the two files and replays the panel’s check', r.code === 0 && /signed and verified/.test(r.out) && existsSync(join(tmp, 'out', 'catalog.release.json')) && existsSync(join(tmp, 'out', 'catalog.release.json.sig')), r)
const docPublie = readFileSync(join(tmp, 'out', 'catalog.release.json'))
const sigPubliee = readFileSync(join(tmp, 'out', 'catalog.release.json.sig'), 'utf8')
const dec = decrireArchive({ plateforme: 'mac', fichier: fauxArchive, url: 'https://x/y', octets: readFileSync(fauxArchive) })
ok('the archive’s SHA-256 and size are the real ones', JSON.parse(docPublie).suite.archives.mac.sha256 === createHash('sha256').update(readFileSync(fauxArchive)).digest('hex') && JSON.parse(docPublie).suite.archives.mac.taille === statSync(fauxArchive).size && dec.mac.nom === 'kybernos-1.1.0-mac.tar.gz')
ok('the published pair is accepted by the panel’s own verdict', evaluer({ octets: docPublie, signature: sigPubliee, cles: JSON.parse(readFileSync(pubFichier, 'utf8')).cles, versionSuite: '1.0.0-beta.1' }).ok === true)
r = await cli(['verify', join(tmp, 'out', 'catalog.release.json'), join(tmp, 'out', 'catalog.release.json.sig'), '--pub', pubFichier])
ok('verify accepts the published pair', r.code === 0 && /accepted/.test(r.out), r)
writeFileSync(join(tmp, 'tampered.json'), docPublie.toString().replace('"1.1.0"', '"9.9.9"'))
r = await cli(['verify', join(tmp, 'tampered.json'), join(tmp, 'out', 'catalog.release.json.sig'), '--pub', pubFichier])
ok('verify refuses a tampered document', r.code === 1 && /refused: signature/.test(r.out), r)
r = await cli(['build', '--key', k2, '--out', join(tmp, 'out2'), '--archive', 'mac=' + fauxArchive + '=https://x/y', '--pub', join(tmp, 'nokey.json')])
ok('build refuses to call a release good when the embedded key would not accept it', r.code === 1 && /does not accept/.test(r.out), r)
r = await cli(['frobnicate'])
ok('an unknown command is a clear error', r.code === 1 && /commands:/.test(r.err))

console.log('\n' + (total - echecs) + '/' + total + ' passed')
process.exit(echecs === 0 ? 0 : 1)
