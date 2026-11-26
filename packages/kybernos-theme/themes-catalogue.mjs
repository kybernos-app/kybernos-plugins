// The theme gallery's catalogue: a document of themes, and the rules that decide whether to believe it.
//
// Two sources, like the Suite's catalogue (packages/kybernos-hub/catalogue-distant.mjs):
//   · the SHIPPED catalogue, gallery.json, part of this bundle: it reaches the machine inside the signed
//     Suite archive, so it needs no signature of its own and works with no network;
//   · the ONLINE catalogue, themes.catalog.json + themes.catalog.json.sig: an Ed25519 signature over the
//     exact bytes of the document. The public key lives in this bundle (themes-pubkey.json). A document
//     that is unsigned, signed by a key nobody trusts, malformed, or OLDER than the one already known
//     (a replayed old catalogue is a rollback) is refused, and nothing is parsed before the signature
//     verifies.
//
// A theme is data (see preset-store.mjs): a bag of known settings. This module adds the rules of a
// catalogue entry: an id, a name, an author, a description in two languages, a version, and settings
// that NEVER carry the accessibility group (contrast, colour-blind palette, big targets are the
// person's own business, not a style someone else can publish).
//
// Pure: no network, no disk. The caller injects them (themes-gallery.mjs), which is also what makes it testable.
import { createPublicKey, verify } from 'node:crypto'
import { A11Y_KEYS, sanitizePreset, tidyText } from './preset-store.mjs'

export const KIND = 'kybernos-themes'
export const SCHEMA = 1
export const MAX_DOC_BYTES = 1024 * 1024
export const MAX_THEMES = 200
export const THEME_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
/** Where `main` of the open-core repo publishes it; the setting `themesCatalogueUrl` overrides it ('' turns the online catalogue off). */
export const DEFAULT_URL = 'https://raw.githubusercontent.com/kybernos-app/kybernos-plugins/main/catalog/themes.catalog.json'
/**
 * The settings a document may NOT carry, from the settings vocabulary itself (preset-store.mjs): one frozen list
 * for the catalogue, the import entry and the point below — mirrored by PRESET_GROUPS.a11y in client.js
 * (test-client.mjs fails when the two lists drift).
 */
export { A11Y_KEYS }
export const LIMITS = { name: 40, author: 60, description: 200 }

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v, max) => {
  if (typeof v !== 'string') return null
  const t = tidyText(v)
  return t === '' || t.length > max ? null : t
}
const fail = (error) => ({ ok: false, error })

/** One catalogue entry. { ok, theme } with a clean copy, or { ok:false, error } naming the first thing wrong. */
export function sanitizeTheme(raw) {
  if (!plain(raw)) return fail('not an object')
  if (typeof raw.id !== 'string' || !THEME_ID_RE.test(raw.id)) return fail('invalid id')
  const name = text(raw.name, LIMITS.name)
  if (name === null) return fail('invalid name')
  const author = text(raw.author, LIMITS.author)
  if (author === null) return fail('invalid author')
  if (!plain(raw.description)) return fail('invalid description')
  const fr = text(raw.description.fr, LIMITS.description)
  const en = text(raw.description.en, LIMITS.description)
  if (fr === null || en === null) return fail('invalid description')
  if (!Number.isInteger(raw.v) || raw.v < 1 || raw.v > 1000000) return fail('invalid version')
  if (!plain(raw.settings)) return fail('settings missing')
  // Refused, not trimmed: a theme that carries accessibility settings is a publishing mistake somebody should see.
  for (const k of A11Y_KEYS) if (Object.prototype.hasOwnProperty.call(raw.settings, k)) return fail('accessibility setting in a catalogue theme: ' + k)
  const p = sanitizePreset({ id: raw.id, name, source: 'gallery', settings: raw.settings })
  if (p.ok !== true) return fail('settings: ' + p.error)
  return { ok: true, theme: { id: raw.id, v: raw.v, name, author, description: { fr, en }, settings: p.preset.settings } }
}

// ── The point of the plugin contract (docs/dev/plugin-contract.md): a pack contributes `themes/<id>.json` ──
/** The version of this bundle as a point owner: a pack saying `requires: { "kybernos/theme": "^1.0" }` is judged against it, not against the release. */
export const OWNER_VERSION = '1.0.0'
/**
 * One contributed theme file for the registry: the rules that matter for a PUBLISHED document — the accessibility
 * refusal, the settings vocabulary through the store's own `sanitizePreset`, and `id === fileId` (as a domain pack
 * must be named after its file). A pack's file is the light `{ id, name, settings }`; a full catalogue entry passes
 * as a superset (`sanitizePreset` keeps author, gid and v), because the card metadata is a gallery concern.
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function validateTheme(raw, fileId) {
  if (!plain(raw)) return { ok: false, errors: ['a theme is a JSON object'] }
  const errors = []
  if (plain(raw.settings)) for (const k of A11Y_KEYS) if (Object.prototype.hasOwnProperty.call(raw.settings, k)) errors.push('accessibility setting: ' + k)
  if (typeof raw.id !== 'string' || raw.id !== fileId) errors.push('id: "' + String(raw.id) + '" is not the file name "' + String(fileId) + '"')
  const p = sanitizePreset(raw, () => 0)
  if (p.ok !== true) errors.push(p.error)
  if (errors.length > 0) return { ok: false, errors }
  const value = { id: p.preset.id, name: p.preset.name, settings: p.preset.settings }
  // The catalogue link a gallery theme carries travels too, and only when it is valid (sanitizePreset decided).
  for (const k of ['author', 'gid', 'v']) if (p.preset[k] !== undefined) value[k] = p.preset[k]
  return { ok: true, value }
}
/** What the registry is told about this point (the owner calls `definePoint` with it, guarded). Data, inert: a theme is settings, never CSS and never a prompt. */
export const THEME_POINT = { owner: 'kybernos/theme', ownerVersion: OWNER_VERSION, name: 'theme', version: '1.0', kind: 'data', class: 'inert', validate: validateTheme }

/** The shape of a whole catalogue document. { ok, doc } with a clean copy, or { ok:false, error, detail? }. */
export function sanitizeDocument(doc) {
  if (!plain(doc)) return fail('not-an-object')
  if (doc.schema !== SCHEMA) return fail('schema')
  if (doc.kind !== KIND) return fail('kind')
  if (typeof doc.publishedAt !== 'string' || doc.publishedAt.length > 40 || Number.isNaN(Date.parse(doc.publishedAt))) return fail('publishedAt')
  if (!Number.isInteger(doc.seq) || doc.seq < 0 || doc.seq > 1000000000) return fail('seq')
  if (!Array.isArray(doc.themes) || doc.themes.length > MAX_THEMES) return fail('themes')
  const seen = new Set()
  const themes = []
  for (const t of doc.themes) {
    const v = sanitizeTheme(t)
    if (v.ok !== true) return { ok: false, error: 'theme', detail: (plain(t) && typeof t.id === 'string' ? t.id + ': ' : '') + v.error }
    if (seen.has(v.theme.id)) return { ok: false, error: 'theme', detail: 'duplicate id ' + v.theme.id }
    seen.add(v.theme.id)
    themes.push(v.theme)
  }
  return { ok: true, doc: { schema: SCHEMA, kind: KIND, publishedAt: doc.publishedAt, seq: doc.seq, themes } }
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
 * Returns the key id, or null. (Same primitive as the Suite's catalogue; a bundle cannot import
 * another bundle's file, so the few lines are here.)
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
 * The verdict on a downloaded catalogue: signature first (nothing is parsed from an unsigned file), then
 * shape, then age. `floor` = { seq } of the newest catalogue already known (shipped or cached): an older
 * one, even a genuine one, is a rollback and is refused; the same age is fine.
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
    return { source: 'signed', publishedAt: evaluation.doc.publishedAt, seq: evaluation.doc.seq, themes: evaluation.doc.themes }
  }
  return { source: 'shipped', publishedAt: shipped.publishedAt, seq: shipped.seq, themes: shipped.themes }
}
