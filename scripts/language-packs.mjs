// Publishing side of the ready-made language packs (see packages/kybernos-plugin/i18n-packs.mjs for the trust chain).
//
//   node scripts/language-packs.mjs export --lang es [--home <DSH home>] [--include-unhashed]
//       Builds catalog/languages/<lang>.pack.json from a language the host's translation job produced in <DSH home>
//       (default: $DSH_HOME or ~/.dsh), `<home>/kybernos/i18n/<lang>.json`. Only texts the job wrote (they carry the hash of
//       their source and went through the quality checks) go in; --include-unhashed adds the older ones. Nothing is signed or
//       published by this command: a person reads the pack first.
//   node scripts/language-packs.mjs index [--bump]
//       Writes catalog/languages/languages.catalog.json from the packs in that folder: sha256, size, counts, one `seq` for the
//       set (every pack file carries it). --bump first raises the set's seq and stamps publishedAt.
//   node scripts/language-packs.mjs sign --key <private-key-file> [--pub <languages-pubkey.json>]
//       Signs the index: catalog/languages/languages.catalog.json.sig, checked against the embedded key before it is called good.
//   node scripts/language-packs.mjs verify <index> <sig> [--pub <file>]    what a machine does with a downloaded index.
//   node scripts/language-packs.mjs keygen --out <private-key-file> [--embed]
//       The Ed25519 pair for LANGUAGE PACKS (private key outside this repository, mode 0600, never overwritten; --embed writes
//       the public half to packages/kybernos-plugin/languages-pubkey.json). Not the Suite's key, not the themes', not the models'.
//
// Commit catalog/languages/ and push `main`: installs read the index from there (DEFAULT_BASE of i18n-packs.mjs).
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INDEX_FILE, KIND_INDEX, KIND_PACK, SCHEMA, evaluateIndex, sanitizePack } from '../packages/kybernos-plugin/i18n-packs.mjs'
import { createI18nStore } from '../packages/kybernos-plugin/i18n-store.mjs'
import { holds } from '../packages/kybernos-plugin/i18n-job.mjs'
import { genererCles, octetsDe, signer } from '../packages/kybernos-hub/catalogue-publication.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '..')
export const OUT = join(REPO, 'catalog', 'languages')
export const KEYS_FILE = join(REPO, 'packages', 'kybernos-plugin', 'languages-pubkey.json')
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'))
const writeJson = (f, v) => writeFileSync(f, JSON.stringify(v, null, 2) + '\n')
const value = (args, flag) => { const i = args.indexOf(flag); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined }
export const readKeys = (file = KEYS_FILE) => { try { const j = readJson(file); return Array.isArray(j.keys) ? j.keys : [] } catch (e) { return [] } }
const sha256 = (b) => createHash('sha256').update(b).digest('hex')

/** Pure. A pack document from what the store holds for a language. */
export function buildPack(pack, { includeUnhashed = false } = {}) {
  const out = { schema: SCHEMA, kind: KIND_PACK, lang: pack.id, seq: 0, label: pack.label, kb: {}, dsh: {}, src: {} }
  let skipped = 0
  for (const [sec, prefix] of [['kb', 'kb:'], ['dsh', 'dsh:']]) {
    for (const k of Object.keys(pack[sec]).sort()) {
      const v = pack[sec][k]
      if (!holds(v)) { skipped += 1; continue }
      const h = pack.src[prefix + k]
      if (h === undefined && !includeUnhashed) { skipped += 1; continue }
      out[sec][k] = v
      if (h !== undefined) out.src[prefix + k] = h
    }
  }
  return { pack: out, skipped }
}

/** Pure. The index document for packs read from a folder: [{ file, bytes }] → { doc, rewrites: [{ file, bytes }] } (every pack carries the set's seq). */
export function buildIndex(files, { seq, publishedAt }) {
  const packs = []
  const rewrites = []
  for (const f of files) {
    const doc = JSON.parse(f.bytes.toString('utf8'))
    doc.seq = seq
    const bytes = Buffer.from(JSON.stringify(doc, null, 2) + '\n', 'utf8')
    const v = sanitizePack(doc, { lang: doc.lang, seq })
    if (v.ok !== true) throw new Error(f.file + ': ' + v.error + (v.detail ? ' (' + v.detail + ')' : ''))
    rewrites.push({ file: f.file, bytes })
    packs.push({ lang: doc.lang, label: v.pack.label, file: f.file, sha256: sha256(bytes), size: bytes.length, seq, counts: { kb: Object.keys(v.pack.kb).length, dsh: Object.keys(v.pack.dsh).length }, reviewed: doc.reviewed === true })
  }
  packs.sort((a, b) => (a.lang < b.lang ? -1 : 1))
  return { doc: { schema: SCHEMA, kind: KIND_INDEX, publishedAt, seq, packs }, rewrites }
}

async function main(args) {
  const [command] = args
  const dir = resolve(value(args, '--dir') ?? OUT)
  if (command === 'export') {
    const lang = value(args, '--lang')
    if (lang === undefined) throw new Error('export needs --lang <id>')
    const home = value(args, '--home') ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const store = createI18nStore({ dir: join(home, 'kybernos', 'i18n') })
    const have = store.read(lang)
    if (have === null) throw new Error('no ' + lang + ' in ' + join(home, 'kybernos', 'i18n'))
    const { pack, skipped } = buildPack(have, { includeUnhashed: args.includes('--include-unhashed') })
    mkdirSync(dir, { recursive: true })
    const file = join(dir, lang + '.pack.json')
    writeJson(file, pack)
    console.log(lang + ': ' + Object.keys(pack.kb).length + ' Kybernos + ' + Object.keys(pack.dsh).length + ' DSH texts → ' + file + (skipped > 0 ? ' (' + skipped + ' left out: no source hash, or a test mark)' : ''))
    return 0
  }
  if (command === 'index') {
    const manifestFile = join(dir, '_catalogue.json')
    let manifest = { seq: 0, publishedAt: new Date(0).toISOString() }
    if (existsSync(manifestFile)) manifest = readJson(manifestFile)
    if (args.includes('--bump')) manifest = { seq: manifest.seq + 1, publishedAt: new Date().toISOString() }
    const names = readdirSync(dir).filter((n) => /^[a-z]{2,3}(?:-[A-Za-z0-9]{1,8})?\.pack\.json$/.test(n)).sort()
    if (names.length === 0) throw new Error('no *.pack.json in ' + dir)
    const { doc, rewrites } = buildIndex(names.map((n) => ({ file: n, bytes: readFileSync(join(dir, n)) })), manifest)
    for (const r of rewrites) writeFileSync(join(dir, r.file), r.bytes)
    writeFileSync(join(dir, INDEX_FILE), octetsDe(doc))
    writeJson(manifestFile, manifest)
    console.log('index: ' + doc.packs.length + ' packs, seq ' + doc.seq + ' → ' + join(dir, INDEX_FILE))
    return 0
  }
  if (command === 'sign') {
    const keyFile = value(args, '--key')
    if (keyFile === undefined) throw new Error('sign needs --key <private-key-file>')
    const bytes = readFileSync(join(dir, INDEX_FILE))
    const signature = signer(bytes, readFileSync(keyFile, 'utf8'))
    writeFileSync(join(dir, INDEX_FILE + '.sig'), signature + '\n')
    const pub = value(args, '--pub')
    const check = evaluateIndex({ bytes, signature, keys: readKeys(pub === undefined ? KEYS_FILE : pub) })
    if (check.ok !== true) throw new Error('signed, but the embedded languages key does not accept it (' + check.error + '): did you run keygen --embed with this key?')
    console.log('signed with key ' + check.key + ': ' + join(dir, INDEX_FILE + '.sig'))
    return 0
  }
  if (command === 'verify') {
    const [, idx, sig] = args
    if (idx === undefined || sig === undefined) throw new Error('verify needs <index> <sig>')
    const pub = value(args, '--pub')
    const v = evaluateIndex({ bytes: readFileSync(idx), signature: readFileSync(sig, 'utf8'), keys: readKeys(pub === undefined ? KEYS_FILE : pub) })
    if (v.ok !== true) { console.error('refused: ' + v.error + (v.detail ? ' (' + v.detail + ')' : '')); return 1 }
    console.log('accepted: ' + v.doc.packs.length + ' packs, seq ' + v.doc.seq + ', key ' + v.key)
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
    if (args.includes('--embed')) { writeJson(KEYS_FILE, { keys: [{ keyId: c.keyId, pem: c.publicPem }] }); console.log('public key embedded in ' + KEYS_FILE) } else console.log(c.publicPem)
    return 0
  }
  console.error('usage: node scripts/language-packs.mjs export --lang <id> [--home <dir>] [--include-unhashed] | index [--bump] | sign --key <file> | verify <index> <sig> | keygen --out <file> [--embed]')
  return 2
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error('language-packs: ' + (e && e.message ? e.message : e)); process.exit(1) })
}
