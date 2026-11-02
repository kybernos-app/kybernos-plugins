// Publishing side of the theme gallery (see packages/kybernos-theme/themes-catalogue.mjs for the trust chain and
// docs/dev/theme-gallery.md for the whole story).
//
//   node scripts/themes-catalogue.mjs build [--bump]
//       Reads catalog/themes/<id>.json (one theme per file) and catalog/themes/_catalogue.json ({ seq, publishedAt }),
//       checks every theme with the same rules the host applies, and writes the SHIPPED catalogue:
//       packages/kybernos-theme/gallery.json. --bump first raises `seq` by one and sets `publishedAt` to now.
//   node scripts/themes-catalogue.mjs sign --key <private-key-file> [--out <dir>] [--pub <themes-pubkey.json>]
//       The same document, signed: <dir>/themes.catalog.json and <dir>/themes.catalog.json.sig (default dir: catalog/).
//       The signed catalogue is checked against the embedded key (or --pub) before it is called good.
//       Commit them: the gallery asks for them on `main` (themes-catalogue.mjs DEFAULT_URL).
//   node scripts/themes-catalogue.mjs verify <themes.catalog.json> <themes.catalog.json.sig> [--pub <themes-pubkey.json>]
//       Replays what the gallery does with a downloaded catalogue. Exit 0 = accepted.
//   node scripts/themes-catalogue.mjs keygen --out <private-key-file> [--embed]
//       Makes the Ed25519 pair for THEMES. The private key goes to the file you name (mode 0600, never overwritten) and
//       must live OUTSIDE this repository. --embed writes the public key to packages/kybernos-theme/themes-pubkey.json.
//       This is deliberately NOT the Suite's release key: a key that signs community themes must not also sign the Suite.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KIND, SCHEMA, evaluate, sanitizeTheme } from '../packages/kybernos-theme/themes-catalogue.mjs'
import { genererCles, octetsDe, signer } from '../packages/kybernos-hub/catalogue-publication.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '..')
export const SOURCES = join(REPO, 'catalog', 'themes')
export const SHIPPED = join(REPO, 'packages', 'kybernos-theme', 'gallery.json')
export const KEYS_FILE = join(REPO, 'packages', 'kybernos-theme', 'themes-pubkey.json')
export const OUT_DIR = join(REPO, 'catalog')

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')

/** The themes of the sources folder, checked with the host's own rules. Throws a readable error on the first problem. */
export function readSources(dir = SOURCES) {
  const themes = []
  const seen = new Set()
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('_')).sort()) {
    let raw
    try { raw = readJson(join(dir, name)) } catch (e) { throw new Error(name + ': not valid JSON') }
    const v = sanitizeTheme(raw)
    if (v.ok !== true) throw new Error(name + ': ' + v.error)
    if (name !== v.theme.id + '.json') throw new Error(name + ': the file must be called ' + v.theme.id + '.json')
    if (seen.has(v.theme.id)) throw new Error(name + ': duplicate id')
    seen.add(v.theme.id)
    themes.push(v.theme)
  }
  return themes
}

/** The catalogue document for these sources: what is shipped, and what is signed. */
export function buildDocument({ dir = SOURCES } = {}) {
  const manifest = readJson(join(dir, '_catalogue.json'))
  if (!Number.isInteger(manifest.seq) || manifest.seq < 0) throw new Error('_catalogue.json: seq must be a whole number')
  if (typeof manifest.publishedAt !== 'string' || Number.isNaN(Date.parse(manifest.publishedAt))) throw new Error('_catalogue.json: publishedAt must be a date')
  return { schema: SCHEMA, kind: KIND, publishedAt: manifest.publishedAt, seq: manifest.seq, themes: readSources(dir) }
}

export const readKeys = (file = KEYS_FILE) => { try { const j = readJson(file); return Array.isArray(j.keys) ? j.keys : [] } catch (e) { return [] } }

const value = (args, flag) => { const i = args.indexOf(flag); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined }

async function main(args) {
  const [command] = args
  if (command === 'build') {
    if (args.includes('--bump')) {
      const file = join(SOURCES, '_catalogue.json')
      const m = readJson(file)
      writeJson(file, { seq: m.seq + 1, publishedAt: new Date().toISOString() })
    }
    const doc = buildDocument()
    writeJson(SHIPPED, doc)
    console.log('shipped catalogue: ' + doc.themes.length + ' themes, seq ' + doc.seq + ' → ' + SHIPPED)
    return 0
  }
  if (command === 'sign') {
    const keyFile = value(args, '--key')
    if (keyFile === undefined) throw new Error('sign needs --key <private-key-file>')
    const outDir = resolve(value(args, '--out') ?? OUT_DIR)
    const bytes = octetsDe(buildDocument())
    const signature = signer(bytes, readFileSync(keyFile, 'utf8'))
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'themes.catalog.json'), bytes)
    writeFileSync(join(outDir, 'themes.catalog.json.sig'), signature + '\n')
    // The same check the gallery will make, with the key that is embedded: refuse to call a catalogue good when it would not be accepted.
    const pub = value(args, '--pub')
    const check = evaluate({ bytes, signature, keys: readKeys(pub === undefined ? KEYS_FILE : pub) })
    if (check.ok !== true) throw new Error('signed, but the embedded themes key does not accept it (' + check.error + '): did you run keygen --embed with this key?')
    console.log('signed with key ' + check.key + ': ' + join(outDir, 'themes.catalog.json') + ' (+ .sig)')
    return 0
  }
  if (command === 'verify') {
    const [, docFile, sigFile] = args
    if (docFile === undefined || sigFile === undefined) throw new Error('verify needs <themes.catalog.json> <themes.catalog.json.sig>')
    const pub = value(args, '--pub')
    const verdict = evaluate({ bytes: readFileSync(docFile), signature: readFileSync(sigFile, 'utf8'), keys: readKeys(pub === undefined ? KEYS_FILE : pub) })
    if (verdict.ok !== true) { console.error('refused: ' + verdict.error + (verdict.detail ? ' (' + verdict.detail + ')' : '')); return 1 }
    console.log('accepted: ' + verdict.doc.themes.length + ' themes, seq ' + verdict.doc.seq + ', key ' + verdict.key)
    return 0
  }
  if (command === 'keygen') {
    const out = value(args, '--out')
    if (out === undefined) throw new Error('--out <private-key-file> expected')
    if (existsSync(out)) throw new Error('refusing to overwrite ' + out)
    if (resolve(out).startsWith(REPO + '/')) throw new Error('the private key must live OUTSIDE this repository')
    const c = genererCles()
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(out, c.privatePem, { mode: 0o600 })
    chmodSync(out, 0o600)
    console.log('private key written to ' + out + ' (mode 0600): keep it, back it up, never commit it')
    console.log('key id ' + c.keyId)
    if (args.includes('--embed')) {
      writeJson(KEYS_FILE, { keys: [{ keyId: c.keyId, pem: c.publicPem }] })
      console.log('public key embedded in ' + KEYS_FILE)
    } else console.log(c.publicPem)
    return 0
  }
  console.error('usage: node scripts/themes-catalogue.mjs build [--bump] | sign --key <file> [--out <dir>] | verify <doc> <sig> [--pub <file>] | keygen --out <file> [--embed]')
  return 2
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error('themes-catalogue: ' + (e && e.message ? e.message : e)); process.exit(1) })
}
