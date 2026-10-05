// Publishing side of the signed Suite catalogue (see packages/kybernos-hub/catalogue-distant.mjs for the trust chain).
//
//   node scripts/catalog-release.mjs keygen --out <private-key-file> [--embed]
//       Makes the Ed25519 key pair. The PRIVATE key goes to the file you name (mode 0600, never overwritten) and must live OUTSIDE
//       this repository. --embed writes the public key to packages/kybernos-hub/catalog-pubkey.json, the one the panel trusts.
//   node scripts/catalog-release.mjs build --key <private-key-file> --out <dir> --archive <plateforme>=<file>=<https-url> [...]
//                                          [--notes <file.json>] [--version <suite version>] [--pub <catalog-pubkey.json>]
//       Writes <dir>/catalog.release.json and <dir>/catalog.release.json.sig: the catalogue derived from the repo, the SHA-256 and size of
//       each archive, signed. Upload those two files and the archives to a GitHub release.
//   node scripts/catalog-release.mjs verify <catalog.release.json> <catalog.release.json.sig> [--pub <catalog-pubkey.json>]
//       Replays what the panel does with a downloaded release. Exit 0 = accepted.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalogueDuDepot } from './build-catalog.mjs'
import { evaluer } from '../packages/kybernos-hub/catalogue-distant.mjs'
import { assemblerRelease, decrireArchive, genererCles, octetsDe, signer } from '../packages/kybernos-hub/catalogue-publication.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(ICI, '..')
export const FICHIER_CLES = join(REPO, 'packages', 'kybernos-hub', 'catalog-pubkey.json')

export const lireCles = (fichier = FICHIER_CLES) => { try { const j = JSON.parse(readFileSync(fichier, 'utf8')); return Array.isArray(j.cles) ? j.cles : [] } catch (e) { return [] } }

const valeurs = (args, drapeau) => { const out = []; for (let i = 0; i < args.length; i += 1) if (args[i] === drapeau && i + 1 < args.length) out.push(args[i + 1]); return out }
const valeur = (args, drapeau) => valeurs(args, drapeau)[0]

async function principal (args) {
  const [commande] = args
  if (commande === 'keygen') {
    const sortie = valeur(args, '--out')
    if (sortie === undefined) throw new Error('--out <private-key-file> expected')
    if (existsSync(sortie)) throw new Error('refusing to overwrite ' + sortie)
    if (resolve(sortie).startsWith(REPO + '/')) throw new Error('the private key must live OUTSIDE this repository')
    const c = genererCles()
    mkdirSync(dirname(resolve(sortie)), { recursive: true })
    writeFileSync(sortie, c.privatePem, { mode: 0o600 })
    chmodSync(sortie, 0o600)
    console.log('private key written to ' + sortie + ' (mode 0600): keep it, back it up, never commit it')
    console.log('key id ' + c.keyId + '\n' + c.publicPem)
    if (args.includes('--embed')) {
      writeFileSync(FICHIER_CLES, JSON.stringify({ cles: [{ keyId: c.keyId, pem: c.publicPem }] }, null, 2) + '\n')
      console.log('public key embedded in ' + FICHIER_CLES)
    }
    return 0
  }
  if (commande === 'build') {
    const cle = valeur(args, '--key')
    const sortie = valeur(args, '--out')
    const specs = valeurs(args, '--archive')
    if (cle === undefined || sortie === undefined || specs.length === 0) throw new Error('build needs --key, --out and at least one --archive <plateforme>=<file>=<https-url>')
    const archives = {}
    for (const spec of specs) {
      const [plateforme, fichier, ...reste] = spec.split('=')
      Object.assign(archives, decrireArchive({ plateforme, fichier, url: reste.join('='), octets: readFileSync(fichier) }))
    }
    const notesFichier = valeur(args, '--notes')
    const notes = notesFichier === undefined ? {} : JSON.parse(readFileSync(notesFichier, 'utf8'))
    const versionSuite = valeur(args, '--version') ?? readFileSync(join(REPO, 'VERSION'), 'utf8').trim()
    const doc = assemblerRelease({ catalogue: catalogueDuDepot(), versionSuite, archives, notes })
    const octets = octetsDe(doc)
    const signature = signer(octets, readFileSync(cle, 'utf8'))
    mkdirSync(sortie, { recursive: true })
    writeFileSync(join(sortie, 'catalog.release.json'), octets)
    writeFileSync(join(sortie, 'catalog.release.json.sig'), signature + '\n')
    // Replay what the panel does: a release that this repo's own embedded key refuses must not be uploaded.
    const verdict = evaluer({ octets, signature, cles: lireCles(valeur(args, '--pub') ?? FICHIER_CLES), versionSuite: '0.0.0' })
    console.log(verdict.ok ? '✓ signed and verified with key ' + verdict.cle + ' (suite ' + versionSuite + ', ' + doc.catalogue.modules.length + ' modules)' : '✗ the embedded public key does not accept this signature (' + verdict.erreur + ')')
    return verdict.ok ? 0 : 1
  }
  if (commande === 'verify') {
    const [, fichier, sigFichier] = args
    if (fichier === undefined || sigFichier === undefined) throw new Error('verify <catalog.release.json> <catalog.release.json.sig>')
    const v = evaluer({ octets: readFileSync(fichier), signature: readFileSync(sigFichier, 'utf8'), cles: lireCles(valeur(args, '--pub') ?? FICHIER_CLES), versionSuite: valeur(args, '--since') ?? '0.0.0' })
    console.log(v.ok ? '✓ accepted: signed by key ' + v.cle + ', suite ' + v.doc.suite.version : '✗ refused: ' + v.erreur + (v.detail ? ' (' + v.detail + ')' : ''))
    return v.ok ? 0 : 1
  }
  throw new Error('commands: keygen | build | verify')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal(process.argv.slice(2)).then((c) => process.exit(c)).catch((e) => { console.error('catalog-release: ' + (e && e.message ? e.message : e)); process.exit(1) })
}
