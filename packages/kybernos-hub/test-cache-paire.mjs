// L2-04: the cache of the signed online catalogue is two files; a failure while writing the pair must leave « no cache », never « tampered ».
// Real files in a temp folder; a failing step is injected through the `fs` seam of cache-paire.mjs.
//   node packages/kybernos-hub/test-cache-paire.mjs
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ecrirePaire, lirePaire } from './cache-paire.mjs'
import { evaluerCache, rafraichir } from './suite-host.mjs'
import { assemblerRelease, genererCles, octetsDe, signer } from './catalogue-publication.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const embarque = JSON.parse(readFileSync(join(ICI, 'catalog.json'), 'utf8'))
let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total += 1; if (cond) console.log('  ✓ ' + nom); else { echecs += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 240) : '')) } }

const K = genererCles()
const cles = [{ keyId: K.keyId, pem: K.publicPem }]
const archives = { mac: { nom: 'kybernos-1.1.0-mac.tar.gz', url: 'https://github.com/o/r/releases/download/v1.1.0/kybernos-1.1.0-mac.tar.gz', sha256: 'b'.repeat(64), taille: 5000 } }
const publier = (version) => {
  const octets = octetsDe(assemblerRelease({ catalogue: embarque, versionSuite: version, archives, publieLe: '2026-10-05T12:00:00Z' }))
  return { octets, signature: signer(octets, K.privatePem) + '\n' }
}
const v110 = publier('1.1.0')
const v120 = publier('1.2.0')
const URL = 'https://github.com/o/r/releases/latest/download/catalog.release.json'

const dossier = () => mkdtempSync(join(tmpdir(), 'kb-hub-cache-'))
const verdict = (cache) => evaluerCache({ lireCache: () => lirePaire(cache), cles, versionSuite: '1.0.0' })
const fsReel = { mkdirSync, writeFileSync, renameSync, rmSync }
/** The real file system, except that the call number `n` of `op` throws. */
const defaillant = (op, n = 1) => {
  let vu = 0
  return { ...fsReel, [op]: (...args) => { vu += 1; if (vu === n) throw new Error('ENOSPC: ' + op + ' #' + n); return fsReel[op](...args) } }
}

console.log('the pair')
{
  const cache = join(dossier(), 'kybernos', 'catalogue-distant.json')
  ecrirePaire(cache, v110)
  ok('a pair is written and verifies', verdict(cache)?.ok === true && verdict(cache).doc.suite.version === '1.1.0')
  ok('no temporary file is left behind', readdirSync(dirname(cache)).sort().join() === 'catalogue-distant.json,catalogue-distant.json.sig')
  ecrirePaire(cache, v120)
  ok('a second pair replaces it', verdict(cache)?.doc.suite.version === '1.2.0')
  ok('absent or half a pair reads as no cache', lirePaire(join(dossier(), 'rien.json')) === null)
}

console.log('a failure while the pair is replaced')
for (const [nom, op, n] of [
  ['the signature cannot be renamed into place (disk full, volume unmounted)', 'renameSync', 2],
  ['the bytes cannot be renamed into place', 'renameSync', 1],
]) {
  const cache = join(dossier(), 'catalogue-distant.json')
  ecrirePaire(cache, v110)
  let jete = false
  try { ecrirePaire(cache, v120, defaillant(op, n)) } catch { jete = true }
  const apres = verdict(cache)
  ok(nom + ': the failure is reported', jete === true)
  ok(nom + ': the next start sees no cache (null), never « signature »', apres === null, apres)
  ok(nom + ': nothing but the (absent) pair in the folder', readdirSync(dirname(cache)).every((f) => !f.includes('.tmp-')) && !existsSync(cache + '.sig'))
}

console.log('a failure before anything is replaced')
{
  const cache = join(dossier(), 'catalogue-distant.json')
  ecrirePaire(cache, v110)
  let jete = false
  try { ecrirePaire(cache, v120, defaillant('writeFileSync', 2)) } catch { jete = true }
  ok('the failure is reported', jete === true)
  ok('the previous pair is still there and still verifies', verdict(cache)?.ok === true && verdict(cache).doc.suite.version === '1.1.0')
  ok('the temporary files are removed', readdirSync(dirname(cache)).every((f) => !f.includes('.tmp-')))
}

console.log('through the refresh')
{
  const cache = join(dossier(), 'catalogue-distant.json')
  ecrirePaire(cache, v110)
  const r = await rafraichir({
    url: URL, cles, versionSuite: '1.0.0',
    telecharger: async (u) => (u.endsWith('.sig') ? Buffer.from(v120.signature) : v120.octets),
    ecrireCache: (c) => ecrirePaire(cache, c, defaillant('renameSync', 2)),
  })
  ok('a refresh whose cache write fails answers « cache »', r.ok === false && r.erreur === 'cache')
  ok('and the next panel read is « no cache », not « signature »', verdict(cache) === null, verdict(cache))
}

console.log('wiring')
{
  const source = readFileSync(join(ICI, 'index.js'), 'utf8')
  ok('index.js writes and reads the cache through the pair, not through two separate writes', /ecrireCache: \(paire\) => ecrirePaire\(cache, paire\)/.test(source) && /lireCache: \(\) => lirePaire\(cache\)/.test(source) && !/ecrireAtomique\(cache/.test(source))
}

console.log('\n' + (total - echecs) + '/' + total + ' passed')
process.exit(echecs === 0 ? 0 : 1)
