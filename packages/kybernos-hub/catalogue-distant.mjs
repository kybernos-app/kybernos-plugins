// The online Suite catalogue: a signed release document, verified before anything in it is believed.
//
// What is published (GitHub Releases of the open-core repo, three files):
//   · catalog.release.json      the release document (below), byte for byte as signed;
//   · catalog.release.json.sig  its Ed25519 signature, base64;
//   · the archive(s) it names   one per platform, with their SHA-256 and size written INSIDE the signed document.
//
// The trust chain is short on purpose: the public key embedded in this bundle (catalog-pubkey.json) verifies the signature, the
// signature covers the SHA-256 of the archive, the archive's own manifest covers every file in it (checked by the lifecycle
// robot). A document that is unsigned, badly signed, malformed, or OLDER than the suite already here (a replayed old release) is
// refused. Nothing here touches the network or the disk: the caller injects them, which is also what makes it testable.
import { createPublicKey, verify } from 'node:crypto'

export const TAILLE_MAX_DOC = 1024 * 1024
export const TAILLE_MAX_ARCHIVE = 300 * 1024 * 1024
/** Where `latest` points on GitHub Releases; the setting `catalogueUrl` overrides it. */
export const URL_PAR_DEFAUT = 'https://github.com/platonai-net/kybernos-plugins/releases/latest/download/catalog.release.json'

const NOM_MODULE = /^[a-z0-9][a-z0-9-]*$/
const NOM_FICHIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/
const SHA256 = /^[0-9a-f]{64}$/
const PLATEFORMES = ['mac', 'linux', 'windows']

/** Pure. "1.0.0-beta.2" vs "1.0.0-beta.10" → -1 | 0 | 1. Numbers compare as numbers, a release beats its own pre-release. */
export const comparerVersions = (a, b) => {
  const decouper = (v) => {
    const [noyau, pre = ''] = String(v ?? '').split('-', 2)
    return { n: noyau.split('.').map((x) => parseInt(x, 10) || 0), pre: pre === '' ? [] : pre.split('.') }
  }
  const x = decouper(a)
  const y = decouper(b)
  for (let i = 0; i < Math.max(x.n.length, y.n.length); i += 1) {
    const d = (x.n[i] ?? 0) - (y.n[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0
  if (x.pre.length === 0) return 1
  if (y.pre.length === 0) return -1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) { const d = parseInt(p, 10) - parseInt(q, 10); if (d !== 0) return d < 0 ? -1 : 1 } else if (pn !== qn) return pn ? -1 : 1
    else if (p !== q) return p < q ? -1 : 1
  }
  return 0
}

const texte = (v, max = 400) => typeof v === 'string' && v.length > 0 && v.length <= max
const bil = (o, max = 600) => o !== null && typeof o === 'object' && texte(o.fr, max) && texte(o.en, max)
const urlHttps = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && x.username === '' && x.password === '' } catch (e) { return false } }

/** Pure. The shape of one release document. Returns null when it is acceptable, else the first thing wrong. */
export function formeDuDocument (doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return 'not-an-object'
  if (doc.schema !== 2) return 'schema'
  if (!texte(doc.publieLe, 40) || Number.isNaN(Date.parse(doc.publieLe))) return 'publieLe'
  const suite = doc.suite
  if (suite === null || typeof suite !== 'object' || !texte(suite.version, 60) || !/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(suite.version)) return 'suite.version'
  if (suite.archives === null || typeof suite.archives !== 'object' || Array.isArray(suite.archives)) return 'suite.archives'
  for (const [plateforme, a] of Object.entries(suite.archives)) {
    if (PLATEFORMES.indexOf(plateforme) < 0) return 'archive.plateforme'
    if (a === null || typeof a !== 'object' || !NOM_FICHIER.test(String(a.nom)) || !urlHttps(a.url) || !SHA256.test(String(a.sha256)) ||
        !Number.isInteger(a.taille) || a.taille < 1 || a.taille > TAILLE_MAX_ARCHIVE) return 'archive.' + plateforme
  }
  const cat = doc.catalogue
  if (cat === null || typeof cat !== 'object' || cat.schema !== 1 || !Array.isArray(cat.familles) || !Array.isArray(cat.modules) || cat.modules.length === 0 || cat.modules.length > 200) return 'catalogue'
  for (const f of cat.familles) if (f === null || typeof f !== 'object' || !NOM_MODULE.test(String(f.id)) || !texte(f.fr, 80) || !texte(f.en, 80) || !/^#[0-9a-fA-F]{6}$/.test(String(f.couleur))) return 'familles'
  const ids = new Set()
  for (const m of cat.modules) {
    if (m === null || typeof m !== 'object' || !NOM_MODULE.test(String(m.id)) || ids.has(m.id)) return 'module.id'
    ids.add(m.id)
    if (!texte(m.nom, 120) || !texte(m.version, 60) || !texte(m.famille, 40) || !bil(m.promesse)) return 'module.' + m.id
    if (!cat.familles.some((f) => f.id === m.famille)) return 'module.famille.' + m.id
    if (m.notes !== undefined && (!Array.isArray(m.notes) || m.notes.length > 30 || !m.notes.every((n) => bil(n)))) return 'module.notes.' + m.id
  }
  return null
}

/** Pure. Bytes → the release document, or why not. The document is parsed ONLY after its size is checked. */
export function lireDocument (octets) {
  if (!Buffer.isBuffer(octets) || octets.length === 0 || octets.length > TAILLE_MAX_DOC) return { ok: false, erreur: 'taille' }
  let doc
  try { doc = JSON.parse(octets.toString('utf8')) } catch (e) { return { ok: false, erreur: 'json' } }
  const faute = formeDuDocument(doc)
  return faute === null ? { ok: true, doc } : { ok: false, erreur: 'forme', detail: faute }
}

/** Pure. Does `signature` (base64) sign exactly `octets` under one of the trusted keys ({ keyId, pem })? Returns the key id or null. */
export function verifierSignature ({ octets, signature, cles }) {
  const sig = Buffer.from(String(signature ?? '').trim(), 'base64')
  if (sig.length !== 64) return null
  for (const c of Array.isArray(cles) ? cles : []) {
    try { if (verify(null, octets, createPublicKey(c.pem), sig)) return String(c.keyId ?? '') } catch (e) { /* a key that does not parse verifies nothing */ }
  }
  return null
}

/**
 * Pure. The verdict on a downloaded release: signature first (nothing is parsed from an unsigned file), then shape, then age.
 * `versionSuite` = the suite already on this machine. `plusRecent` is true only for a STRICTLY newer suite.
 * @returns {{ ok: true, doc, cle: string, plusRecent: boolean } | { ok: false, erreur: string, detail?: string }}
 */
export function evaluer ({ octets, signature, cles, versionSuite }) {
  if (!Array.isArray(cles) || cles.length === 0) return { ok: false, erreur: 'pas-de-cle' }
  if (!Buffer.isBuffer(octets) || octets.length === 0 || octets.length > TAILLE_MAX_DOC) return { ok: false, erreur: 'taille' }
  const cle = verifierSignature({ octets, signature, cles })
  if (cle === null) return { ok: false, erreur: 'signature' }
  const lu = lireDocument(octets)
  if (!lu.ok) return lu
  const c = comparerVersions(lu.doc.suite.version, versionSuite)
  // An older release, even a genuine one, is a rollback: refused rather than shown.
  if (c < 0) return { ok: false, erreur: 'plus-ancien', detail: lu.doc.suite.version }
  return { ok: true, doc: lu.doc, cle, plusRecent: c > 0 }
}

/** Pure. The catalogue the panel shows: the signed one when there is one at least as recent, else the shipped one. */
export function catalogueEffectif ({ embarque, evaluation }) {
  if (evaluation !== null && evaluation !== undefined && evaluation.ok === true) {
    return { ...evaluation.doc.catalogue, source: 'signe', suite: { version: evaluation.doc.suite.version, publieLe: evaluation.doc.publieLe, plusRecent: evaluation.plusRecent } }
  }
  return { ...embarque, source: 'embarque' }
}

/** Pure. The archive to download for this platform, from a verified document; null when the release has none for it. */
export const archivePour = (doc, plateforme) => (doc?.suite?.archives?.[plateforme] ?? null)
