// The catalogue of local models: a document of models an Ollama install can pull, and the rules that decide whether to believe it.
//
// Two sources, the same chain of trust as the theme gallery (packages/kybernos-theme/themes-catalogue.mjs) and the Suite's
// catalogue (packages/kybernos-hub/catalogue-distant.mjs):
//   · the SHIPPED catalogue, catalogue.json, part of this bundle: it reaches the machine inside the signed Suite archive, so it
//     needs no signature of its own and works with no network;
//   · the ONLINE catalogue, local-models.catalog.json + local-models.catalog.json.sig: an Ed25519 signature over the exact
//     bytes of the document. The public key lives in this bundle (models-pubkey.json). A document that is unsigned, signed by
//     a key nobody trusts, malformed, or OLDER than the one already known (a replayed old catalogue is a rollback) is
//     refused, and nothing is parsed before the signature verifies.
//
// An entry is DATA that ends up in a command line (`ollama pull <id>`): the id is held to the library's own shape
// (lower-case name, one tag), so a signed catalogue still cannot carry a path, a flag or a second argument.
//
// Pure: no network, no disk. The caller injects them (modeles-distant.mjs), which is also what makes it testable.
import { createPublicKey, verify } from 'node:crypto'

export const KIND = 'kybernos-local-models'
export const SCHEMA = 1
export const MAX_DOC_BYTES = 256 * 1024
export const MAX_MODELS = 120
/** `name:tag`, as the Ollama library writes them (qwen3.5:9b, gemma4:e4b). No namespace, no path, no flag. */
export const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,48}:[a-z0-9][a-z0-9._-]{0,32}$/
export const INPUTS = Object.freeze(['text', 'image', 'audio'])
export const BADGES = Object.freeze(['Vision', 'Tools', 'Thinking', 'Audio', 'Code', 'Embedding'])
/** Where `main` of the open-core repo publishes it; the setting `modelesCatalogueUrl` overrides it ('' turns the online catalogue off). */
export const DEFAULT_URL = 'https://raw.githubusercontent.com/kybernos-app/kybernos-plugins/main/catalog/local-models.catalog.json'
export const LIMITS = { score: 80, desc: 140 }

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (error) => ({ ok: false, error })
const line = (v, max) => {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return t === '' || t.length > max ? null : t
}
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))

/** One catalogue entry. { ok, model } with a clean copy, or { ok:false, error } naming the first thing wrong. */
export function sanitizeModel(raw) {
  if (!plain(raw)) return fail('not an object')
  if (typeof raw.id !== 'string' || !MODEL_ID_RE.test(raw.id)) return fail('invalid id')
  if (typeof raw.famille !== 'string' || !/^[a-z]$/.test(raw.famille)) return fail('invalid famille')
  if (typeof raw.initiale !== 'string' || !/^[A-Za-z0-9]{1,3}$/.test(raw.initiale)) return fail('invalid initiale')
  if (raw.tailleGo !== null && !(typeof raw.tailleGo === 'number' && Number.isFinite(raw.tailleGo) && raw.tailleGo > 0 && raw.tailleGo <= 1000)) return fail('invalid tailleGo')
  if (!Number.isInteger(raw.ramMin) || raw.ramMin < 1 || raw.ramMin > 1024) return fail('invalid ramMin')
  let score = null
  if (raw.score !== null && raw.score !== undefined) {
    score = line(raw.score, LIMITS.score)
    if (score === null) return fail('invalid score')
  }
  if (!Array.isArray(raw.input) || raw.input.length === 0 || raw.input.length > INPUTS.length || raw.input.some((x) => INPUTS.indexOf(x) < 0) || new Set(raw.input).size !== raw.input.length) return fail('invalid input')
  if (!Array.isArray(raw.badges) || raw.badges.length > 6 || raw.badges.some((x) => BADGES.indexOf(x) < 0) || new Set(raw.badges).size !== raw.badges.length) return fail('invalid badges')
  if (!plain(raw.desc)) return fail('invalid desc')
  const fr = line(raw.desc.fr, LIMITS.desc)
  const en = line(raw.desc.en, LIMITS.desc)
  if (fr === null || en === null) return fail('invalid desc')
  if (!isDay(raw.ajoute)) return fail('invalid ajoute')
  if (!Number.isInteger(raw.ordre) || raw.ordre < 0 || raw.ordre > 100000) return fail('invalid ordre')
  return {
    ok: true,
    model: {
      id: raw.id, famille: raw.famille, initiale: raw.initiale, tailleGo: raw.tailleGo, ramMin: raw.ramMin, score,
      input: raw.input.slice(), badges: raw.badges.slice(), desc: { fr, en }, ajoute: raw.ajoute, ordre: raw.ordre,
    },
  }
}

/** The shape of a whole catalogue document. { ok, doc } with a clean copy, or { ok:false, error, detail? }. */
export function sanitizeDocument(doc) {
  if (!plain(doc)) return fail('not-an-object')
  if (doc.schema !== SCHEMA) return fail('schema')
  if (doc.kind !== KIND) return fail('kind')
  if (typeof doc.publishedAt !== 'string' || doc.publishedAt.length > 40 || Number.isNaN(Date.parse(doc.publishedAt))) return fail('publishedAt')
  if (!Number.isInteger(doc.seq) || doc.seq < 0 || doc.seq > 1000000000) return fail('seq')
  if (!Array.isArray(doc.models) || doc.models.length > MAX_MODELS) return fail('models')
  const seen = new Set()
  const models = []
  for (const m of doc.models) {
    const v = sanitizeModel(m)
    if (v.ok !== true) return { ok: false, error: 'model', detail: (plain(m) && typeof m.id === 'string' ? m.id + ': ' : '') + v.error }
    if (seen.has(v.model.id)) return { ok: false, error: 'model', detail: 'duplicate id ' + v.model.id }
    seen.add(v.model.id)
    models.push(v.model)
  }
  models.sort((a, b) => a.ordre - b.ordre || (a.id < b.id ? -1 : 1))
  return { ok: true, doc: { schema: SCHEMA, kind: KIND, publishedAt: doc.publishedAt, seq: doc.seq, models } }
}

/** Bytes → the document, or why not. The document is parsed ONLY after its size is checked. */
export function readDocument(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_DOC_BYTES) return fail('size')
  let doc
  try { doc = JSON.parse(bytes.toString('utf8')) } catch (e) { return fail('json') }
  return sanitizeDocument(doc)
}

/**
 * Does `signature` (base64) sign exactly `bytes` under one of the trusted keys ({ keyId, pem })?
 * Returns the key id, or null. (Same primitive as the Suite's and the themes' catalogues; a bundle cannot import another
 * bundle's file, so the few lines are here.)
 */
export function verifySignature({ bytes, signature, keys }) {
  const sig = Buffer.from(String(signature === undefined || signature === null ? '' : signature).trim(), 'base64')
  if (sig.length !== 64) return null
  for (const k of Array.isArray(keys) ? keys : []) {
    try { if (verify(null, bytes, createPublicKey(k.pem), sig)) return String(k.keyId === undefined ? '' : k.keyId) } catch (e) { /* a key that does not parse verifies nothing */ }
  }
  return null
}

/**
 * The verdict on a downloaded catalogue: signature first (nothing is parsed from an unsigned file), then shape, then age.
 * `floor` = { seq } of the newest catalogue already known (shipped or cached): an older one, even a genuine one, is a
 * rollback and is refused; the same age is fine.
 * @returns {{ ok: true, doc, key: string } | { ok: false, error: string, detail?: string }}
 */
export function evaluate({ bytes, signature, keys, floor }) {
  if (!Array.isArray(keys) || keys.length === 0) return fail('no-key')
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_DOC_BYTES) return fail('size')
  const key = verifySignature({ bytes, signature, keys })
  if (key === null) return fail('signature')
  const read = readDocument(bytes)
  if (read.ok !== true) return read
  if (floor !== undefined && floor !== null && read.doc.seq < floor.seq) return { ok: false, error: 'older', detail: 'seq ' + read.doc.seq + ' < ' + floor.seq }
  return { ok: true, doc: read.doc, key }
}

/** The catalogue to show: the signed one when it is at least as recent as the shipped one, else the shipped one. */
export function effective({ shipped, evaluation }) {
  if (evaluation !== null && evaluation !== undefined && evaluation.ok === true && evaluation.doc.seq >= shipped.seq) {
    return { source: 'signed', publishedAt: evaluation.doc.publishedAt, seq: evaluation.doc.seq, models: evaluation.doc.models }
  }
  return { source: 'shipped', publishedAt: shipped.publishedAt, seq: shipped.seq, models: shipped.models }
}
