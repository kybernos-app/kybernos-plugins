// Publishing side of the local-models catalogue (see packages/kybernos-modeles-locaux/modeles-catalogue.mjs for the trust chain).
//
//   node scripts/modeles-locaux-catalogue.mjs draft [--limit N] [--html <file>]
//       Looks at the Ollama library (newest first) and prints the models that are NOT in catalog/local-models/ yet, as
//       ready-to-edit sources with a size and a RAM floor ESTIMATED from the parameter count. A person curates: nothing
//       reaches the catalogue until a file is written in catalog/local-models/ (this command writes nothing).
//   node scripts/modeles-locaux-catalogue.mjs build [--bump]
//       Reads catalog/local-models/<name>_<tag>.json (one model per file) and catalog/local-models/_catalogue.json
//       ({ seq, publishedAt }), checks every model with the same rules the host applies, and writes the SHIPPED catalogue:
//       packages/kybernos-modeles-locaux/catalogue.json. --bump first raises `seq` by one and sets `publishedAt` to now.
//   node scripts/modeles-locaux-catalogue.mjs sign --key <private-key-file> [--out <dir>] [--pub <models-pubkey.json>]
//       The same document, signed: <dir>/local-models.catalog.json and <dir>/local-models.catalog.json.sig (default dir:
//       catalog/). Checked against the embedded key (or --pub) before it is called good. Commit them: the page asks for
//       them on `main` (modeles-catalogue.mjs DEFAULT_URL), so a new model reaches every install without a release.
//   node scripts/modeles-locaux-catalogue.mjs verify <local-models.catalog.json> <...json.sig> [--pub <models-pubkey.json>]
//       Replays what the page does with a downloaded catalogue. Exit 0 = accepted.
//   node scripts/modeles-locaux-catalogue.mjs keygen --out <private-key-file> [--embed]
//       Makes the Ed25519 pair for LOCAL MODELS. The private key goes to the file you name (mode 0600, never overwritten)
//       and must live OUTSIDE this repository. --embed writes the public key to packages/kybernos-modeles-locaux/models-pubkey.json.
//       Deliberately NOT the Suite's release key nor the themes' key: a key that signs what gets pulled onto a machine must
//       not also sign anything else.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KIND, SCHEMA, evaluate, sanitizeModel } from '../packages/kybernos-modeles-locaux/modeles-catalogue.mjs'
import { genererCles, octetsDe, signer } from '../packages/kybernos-hub/catalogue-publication.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '..')
export const SOURCES = join(REPO, 'catalog', 'local-models')
export const SHIPPED = join(REPO, 'packages', 'kybernos-modeles-locaux', 'catalogue.json')
export const KEYS_FILE = join(REPO, 'packages', 'kybernos-modeles-locaux', 'models-pubkey.json')
export const OUT_DIR = join(REPO, 'catalog')
export const LIBRARY_URL = 'https://ollama.com/library?sort=newest'

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const writeJson = (file, v) => writeFileSync(file, JSON.stringify(v, null, 2) + '\n')
/** The file a model lives in: its id with the colon turned into an underscore (a colon is not a file name everywhere). */
export const fileOf = (id) => id.replace(':', '_') + '.json'

/** The models of the sources folder, checked with the host's own rules. Throws a readable error on the first problem. */
export function readSources(dir = SOURCES) {
  const models = []
  const seen = new Set()
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('_')).sort()) {
    let raw
    try { raw = readJson(join(dir, name)) } catch (e) { throw new Error(name + ': not valid JSON') }
    const v = sanitizeModel(raw)
    if (v.ok !== true) throw new Error(name + ': ' + v.error)
    if (name !== fileOf(v.model.id)) throw new Error(name + ': the file must be called ' + fileOf(v.model.id))
    if (seen.has(v.model.id)) throw new Error(name + ': duplicate id')
    seen.add(v.model.id)
    models.push(v.model)
  }
  return models
}

/** The catalogue document for these sources: what is shipped, and what is signed. */
export function buildDocument({ dir = SOURCES } = {}) {
  const manifest = readJson(join(dir, '_catalogue.json'))
  if (!Number.isInteger(manifest.seq) || manifest.seq < 0) throw new Error('_catalogue.json: seq must be a whole number')
  if (typeof manifest.publishedAt !== 'string' || Number.isNaN(Date.parse(manifest.publishedAt))) throw new Error('_catalogue.json: publishedAt must be a date')
  const models = readSources(dir).sort((a, b) => a.ordre - b.ordre || (a.id < b.id ? -1 : 1))
  return { schema: SCHEMA, kind: KIND, publishedAt: manifest.publishedAt, seq: manifest.seq, models }
}

export const readKeys = (file = KEYS_FILE) => { try { const j = readJson(file); return Array.isArray(j.keys) ? j.keys : [] } catch (e) { return [] } }

const value = (args, flag) => { const i = args.indexOf(flag); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined }

// ── draft: what the Ollama library has that the catalogue does not ───────────────────────────────────────────────
const entities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }

/** Pure. The library page → [{ name, description, capabilities, sizes, pulls, updated }]. Unknown markup yields nothing, never a throw. */
export function parseLibrary(html) {
  const out = []
  for (const block of String(html).split('<li ').slice(1)) {
    const name = /href="\/library\/([a-z0-9][a-z0-9._-]*)"/.exec(block)
    if (name === null) continue
    const desc = /<p class="max-w-lg[^"]*">([\s\S]*?)<\/p>/.exec(block)
    const spans = [...block.matchAll(/<span\s+class="inline-flex[^"]*"[^>]*>\s*([A-Za-z0-9.]+)\s*<\/span>/g)].map((m) => m[1])
    const capabilities = spans.filter((s) => /^[a-z]+$/.test(s) && !/^\d/.test(s) && s !== 'b')
    const sizes = spans.filter((s) => /^\d+(\.\d+)?[bm]$/i.test(s) || /^e\d+b$/i.test(s)).map((s) => s.toLowerCase())
    const pulls = /<span\s*>([\d.]+[KMB]?)<\/span>\s*<span class="hidden sm:flex">&nbsp;Pulls/.exec(block)
    const when = /title="([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(block)
    const updated = when !== null && MONTHS[when[1]] !== undefined
      ? when[3] + '-' + String(MONTHS[when[1]]).padStart(2, '0') + '-' + String(Number(when[2])).padStart(2, '0') : null
    out.push({ name: name[1], description: desc === null ? '' : entities(desc[1]).replace(/\s+/g, ' ').trim(), capabilities, sizes, pulls: pulls === null ? null : pulls[1], updated })
  }
  return out
}

/** Pure. A first guess at the Q4 file size (GB) and the RAM floor from the parameter count: 0.6 GB per billion, floors 4/8/16/32/64/128. */
export function estimate(size) {
  const m = /^(?:e)?(\d+(?:\.\d+)?)([bm])$/i.exec(size)
  if (m === null) return null
  const billions = Number(m[1]) / (m[2].toLowerCase() === 'm' ? 1000 : 1)
  const tailleGo = Math.round(billions * 0.6 * 10) / 10
  const need = tailleGo * 1.25
  const ramMin = [4, 8, 16, 32, 64, 128].find((r) => need <= r) ?? 128
  return { tailleGo, ramMin }
}

/** Pure. Candidates the catalogue does not hold, as source skeletons a person completes (desc, score, ordre are theirs to write). */
export function candidates(library, known, { limit = 20 } = {}) {
  const have = new Set(known)
  const out = []
  for (const m of library) {
    if (m.capabilities.includes('cloud') || m.capabilities.includes('embedding')) continue // not a chat model that runs here
    for (const size of m.sizes) {
      const e = estimate(size)
      if (e === null) continue
      const id = m.name + ':' + size
      if (have.has(id)) continue
      const badges = []
      if (m.capabilities.includes('vision')) badges.push('Vision')
      if (m.capabilities.includes('tools')) badges.push('Tools')
      if (m.capabilities.includes('thinking')) badges.push('Thinking')
      if (m.capabilities.includes('audio')) badges.push('Audio')
      out.push({
        id, famille: m.name[0] ?? 'x', initiale: (m.name[0] ?? 'x').toUpperCase() + (m.name[1] ?? ''), tailleGo: e.tailleGo, ramMin: e.ramMin, score: null,
        input: m.capabilities.includes('vision') ? ['text', 'image'] : ['text'], badges,
        desc: { fr: 'À rédiger : ' + m.description.slice(0, 100), en: 'To write: ' + m.description.slice(0, 100) },
        ajoute: m.updated ?? new Date().toISOString().slice(0, 10), ordre: 1000,
        _estime: 'tailleGo et ramMin sont ESTIMÉS (0,6 Go par milliard de paramètres) : à mesurer avant de publier ; retirer ce champ',
      })
      if (out.length >= limit) return out
    }
  }
  return out
}

async function main(args) {
  const [command] = args
  if (command === 'draft') {
    const limit = Number(value(args, '--limit') ?? 20)
    const htmlFile = value(args, '--html')
    const html = htmlFile !== undefined ? readFileSync(htmlFile, 'utf8') : await (await fetch(LIBRARY_URL, { signal: AbortSignal.timeout(20000) })).text()
    const library = parseLibrary(html)
    if (library.length === 0) throw new Error('the library page has no model I can read: its markup changed, fix parseLibrary')
    const known = readSources().map((m) => m.id)
    const list = candidates(library, known, { limit })
    console.error(library.length + ' models read on the library page, ' + known.length + ' in the catalogue, ' + list.length + ' candidates (estimates: to be measured)')
    console.log(JSON.stringify(list, null, 2))
    return 0
  }
  if (command === 'build') {
    if (args.includes('--bump')) {
      const file = join(SOURCES, '_catalogue.json')
      const m = readJson(file)
      writeJson(file, { seq: m.seq + 1, publishedAt: new Date().toISOString() })
    }
    const doc = buildDocument()
    writeJson(SHIPPED, doc)
    console.log('shipped catalogue: ' + doc.models.length + ' models, seq ' + doc.seq + ' → ' + SHIPPED)
    return 0
  }
  if (command === 'sign') {
    const keyFile = value(args, '--key')
    if (keyFile === undefined) throw new Error('sign needs --key <private-key-file>')
    const outDir = resolve(value(args, '--out') ?? OUT_DIR)
    const bytes = octetsDe(buildDocument())
    const signature = signer(bytes, readFileSync(keyFile, 'utf8'))
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'local-models.catalog.json'), bytes)
    writeFileSync(join(outDir, 'local-models.catalog.json.sig'), signature + '\n')
    // The same check the page will make, with the key that is embedded: refuse to call a catalogue good when it would not be accepted.
    const pub = value(args, '--pub')
    const check = evaluate({ bytes, signature, keys: readKeys(pub === undefined ? KEYS_FILE : pub) })
    if (check.ok !== true) throw new Error('signed, but the embedded models key does not accept it (' + check.error + '): did you run keygen --embed with this key?')
    console.log('signed with key ' + check.key + ': ' + join(outDir, 'local-models.catalog.json') + ' (+ .sig)')
    return 0
  }
  if (command === 'verify') {
    const [, docFile, sigFile] = args
    if (docFile === undefined || sigFile === undefined) throw new Error('verify needs <local-models.catalog.json> <local-models.catalog.json.sig>')
    const pub = value(args, '--pub')
    const verdict = evaluate({ bytes: readFileSync(docFile), signature: readFileSync(sigFile, 'utf8'), keys: readKeys(pub === undefined ? KEYS_FILE : pub) })
    if (verdict.ok !== true) { console.error('refused: ' + verdict.error + (verdict.detail ? ' (' + verdict.detail + ')' : '')); return 1 }
    console.log('accepted: ' + verdict.doc.models.length + ' models, seq ' + verdict.doc.seq + ', key ' + verdict.key)
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
  console.error('usage: node scripts/modeles-locaux-catalogue.mjs draft [--limit N] [--html <file>] | build [--bump] | sign --key <file> [--out <dir>] | verify <doc> <sig> [--pub <file>] | keygen --out <file> [--embed]')
  return 2
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error('modeles-locaux-catalogue: ' + (e && e.message ? e.message : e)); process.exit(1) })
}
