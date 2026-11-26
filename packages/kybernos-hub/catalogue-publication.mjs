// What a release is made of, and how it is signed: the pure half of scripts/catalog-release.mjs (the publishing CLI). It lives in the bundle,
// not in scripts/, so the tests that play it ship with the bundle without importing a file the archive does not carry.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { basename } from 'node:path'

/** Pure. The id the panel and the logs use for a public key: the first 12 hex digits of the SHA-256 of its DER. */
export const idDeCle = (pem) => createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 12)

/** Pure. A fresh Ed25519 pair as PEM text. */
export function genererCles () {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pem = publicKey.export({ type: 'spki', format: 'pem' })
  return { privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicPem: pem, keyId: idDeCle(pem) }
}

/** Pure. The release document for a catalogue, a suite version and the archives built for it ({ plateforme: { nom, url, sha256, taille } }). */
export function assemblerRelease ({ catalogue, versionSuite, archives, notes = {}, publieLe = new Date().toISOString() }) {
  return {
    schema: 2,
    publieLe,
    suite: { version: versionSuite, archives },
    catalogue: {
      schema: catalogue.schema,
      familles: catalogue.familles,
      modules: catalogue.modules.map((m) => (Array.isArray(notes[m.id]) && notes[m.id].length > 0 ? { ...m, notes: notes[m.id] } : m))
    }
  }
}

/** Pure. The bytes that get signed (and published): the document, pretty-printed, newline-terminated. */
export const octetsDe = (doc) => Buffer.from(JSON.stringify(doc, null, 2) + '\n', 'utf8')

/** Pure. Ed25519 signature of `octets`, base64. */
export const signer = (octets, privatePem) => sign(null, octets, createPrivateKey(privatePem)).toString('base64')

/** Pure. { plateforme: { nom, url, sha256, taille } } from the bytes of each archive. */
export const decrireArchive = ({ plateforme, fichier, url, octets }) => ({ [plateforme]: { nom: basename(fichier), url, sha256: createHash('sha256').update(octets).digest('hex'), taille: octets.length } })
