// ── The theme installer, host half: a signed catalogue, a plan, a record, one route body ────────────────────────────────
//
// A THEME is the installable sector unit (docs/tests/A6-theme-installer-strategy.md): a data package (`plugin.json`, an empty
// `package.json` patch, `domains/`, `themes/`, `skills/`, `teams/`, `automations/`). This file is the deterministic half of
// installing one. It installs nothing itself: the package enters the profile through DSH's own manager, and its content is
// applied through the routes that already exist (the client's applier, `KB-TH-CORE` in client.js). Here live only:
//
//   verifyCatalogue  a catalogue document is signed AS A WHOLE: nothing is parsed before its signature verifies
//   verifyEntry      one entry: the author's signature, the reviewer's countersignature, and the level they earn
//   verifyArchive    the archived bytes: hashed, compared to the entry, then the same two signatures
//   planTheme        the one plan screen: the style, the field (its words), the kit, each item citing its file
//   dataPluginProblems  the pre-install pre-check, which must agree with the registry's own table (registry.mjs)
//   readThemes / writeThemes   <DSH home>/kybernos/themes.json: one bounded file, atomic, 0600
//   handleThemes     the body of /kybernos/themes: method, origin, session, then one action
//
// `handleThemes` is pure over its ports and synchronous, so a test drives it without a socket: the catalogue bytes reach it
// through `ports.catalogues`, the archive bytes through `ports.archive`. The BOUNDED transport that produces them lives at the
// bottom of this file (`fetchCatalogueSources`, `fetchArchiveBytes`, the few lines copied from
// `packages/kybernos-hub/telechargement.mjs`, as A6:43 freezes), and `index.js` — the one caller — runs it before the route
// body. With no key pinned a source is REFUSED as unverifiable rather than trusted (A6's AMBIGUITY 5, ratified M4: no
// placeholder official key ships).
//
// The catalogue document (docs/dev/plugin-contract.md §9-10):
//   { schema: 1, kind: 'kybernos-plugin-catalogue',
//     catalogue: { id, name, seq, publishedAt },
//     authors: { <author id>: { keys: [{ keyId, pem }] } },
//     reviewers: [{ keyId, pem }],
//     plugins: [{ id, versions: [{ version, manifest, archive: { url, sha256, size }, authorSig, review?, yanked? }] }],
//     revoked: [{ id, versions, sha256?, reason, at, action: 'disable'|'warn' }], revokedKeys: [] }
//
// The two signed messages are the contract's, word for word (`plugin-contract.md:438-440`):
//   kybernos-plugin-v1\n<id>\n<version>\n<sha256>
//   kybernos-plugin-review-v1\n<id>\n<version>\n<sha256>\nverified
import { createHash, verify as verifySignature } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readSample } from './themes-shipped.mjs'

export const CATALOGUE_KIND = 'kybernos-plugin-catalogue'
export const CATALOGUE_SCHEMA = 1
/** The catalogue document is read whole and never larger than this. */
export const MAX_DOC_BYTES = 512 * 1024
/** The sources are configuration: a bounded list of https addresses. */
export const MAX_SOURCES = 3
/** The archive DSH's manager is handed: the bound the registry's import route already uses (host.mjs:65). */
export const IMPORT_MAX = 8 * 1024 * 1024
/** The install record: one bounded file. */
export const RECORDS_MAX = 8
export const THEMES_MAX_BYTES = 256 * 1024
/** A write body: the plan screen sends ticks and ids, never a document. */
export const BODY_MAX = 64 * 1024
/**
 * The keys `official` requires: the Kybernos namespace AND one of these ids (A6's AMBIGUITY 5, ratified M4). The list ships
 * EMPTY on purpose — no placeholder official key exists — so a source the person pinned, however it signs itself, can earn
 * `verified` at best. A key here is a release decision, never a string a document may claim.
 */
export const OFFICIAL_KEYS = Object.freeze([])
/** The transport bounds: a document and its signature are small; an archive is the registry's import bound. */
export const SOURCE_TIMEOUT_MS = 8000
export const ARCHIVE_TIMEOUT_MS = 60000
const SIGNATURE_MAX_BYTES = 8 * 1024
/** How many verified archives stay beside the record for DSH's manager (the registry's own housekeeping count). */
export const ARCHIVES_KEEP = 20

const OWNER = /^[a-z][a-z0-9-]{1,31}\/[a-z][a-z0-9-]{1,39}$/
const PRESET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const HEX64 = /^[0-9a-f]{64}$/i
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v) => (typeof v === 'string' ? v : null)
const list = (v) => (Array.isArray(v) ? v : [])
const tidy = (v, max) => String(v === undefined || v === null ? '' : v).slice(0, max)
const hashOf = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** The bytes of a document or an archive, however they were handed in (a Buffer, a typed array, a string). */
const asBytes = (v) => {
  try {
    if (Buffer.isBuffer(v)) return v
    if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
    if (typeof v === 'string') return Buffer.from(v, 'utf8')
  } catch (e) { /* not bytes */ }
  return null
}

/** One key as `{ keyId, pem }`, or null: a catalogue key is a public key and a name, nothing else. */
const keyOf = (k) => (plain(k) && typeof k.keyId === 'string' && k.keyId !== '' && typeof k.pem === 'string' && k.pem.includes('PUBLIC KEY') ? { keyId: k.keyId, pem: k.pem } : null)
const keysOf = (v) => list(v).map(keyOf).filter((k) => k !== null)

/** Does `signature` (base64) verify `message` against ANY of `keys`? Returns the keyId that verified, or null. Never throws. */
const signedBy = (message, signature, keys) => {
  if (typeof signature !== 'string' || signature === '' || signature.length > 4096) return null
  let raw = null
  try { raw = Buffer.from(signature, 'base64') } catch (e) { return null }
  if (raw === null || raw.length === 0 || raw.length > 512) return null
  for (const k of keys) {
    try {
      if (verifySignature(null, message, k.pem, raw) === true) return k.keyId
    } catch (e) { /* a key that is not a key verifies nothing */ }
  }
  return null
}

/**
 * A catalogue document, verified before it is parsed: `{ ok: true, doc, key }` or `{ ok: false, error }`. Never throws.
 * `keys` is the pinned key list `[{ keyId, pem }]`; `floor` is the copy already cached `{ seq }` (a document that goes
 * backwards is a replay). Errors: `size`, `no-key`, `signature`, `json`, `schema`, `kind`, `seq`, `older`, `duplicate`.
 */
export function verifyCatalogue (input) {
  try {
    const opts = plain(input) ? input : {}
    const bytes = asBytes(opts.bytes)
    if (bytes === null || bytes.length === 0) return { ok: false, error: 'size' }
    if (bytes.length > MAX_DOC_BYTES) return { ok: false, error: 'size' }
    const keys = keysOf(opts.keys)
    if (keys.length === 0) return { ok: false, error: 'no-key' }
    // The signature comes first: nothing below this line runs on an unverified byte.
    const key = signedBy(bytes, opts.signature, keys)
    if (key === null) return { ok: false, error: 'signature' }
    let doc = null
    try { doc = JSON.parse(bytes.toString('utf8')) } catch (e) { return { ok: false, error: 'json' } }
    if (!plain(doc) || typeof doc.schema !== 'number') return { ok: false, error: 'schema' }
    if (doc.schema !== CATALOGUE_SCHEMA) return { ok: false, error: 'schema' }
    if (doc.kind !== CATALOGUE_KIND) return { ok: false, error: 'kind' }
    const cat = doc.catalogue
    if (!plain(cat) || typeof cat.id !== 'string' || cat.id === '' || cat.id.length > 64) return { ok: false, error: 'schema' }
    if (!Number.isInteger(cat.seq) || cat.seq < 1) return { ok: false, error: 'seq' }
    if (Array.isArray(doc.plugins) === false) return { ok: false, error: 'schema' }
    const seen = new Set()
    for (const p of doc.plugins) {
      if (!plain(p) || typeof p.id !== 'string' || !OWNER.test(p.id) || Array.isArray(p.versions) === false) return { ok: false, error: 'schema' }
      if (seen.has(p.id)) return { ok: false, error: 'duplicate' }
      seen.add(p.id)
      const versions = new Set()
      for (const v of p.versions) {
        if (!plain(v) || typeof v.version !== 'string' || v.version === '') return { ok: false, error: 'schema' }
        if (versions.has(v.version)) return { ok: false, error: 'duplicate' }
        versions.add(v.version)
      }
    }
    const floor = plain(opts.floor) && Number.isInteger(opts.floor.seq) ? opts.floor.seq : null
    if (floor !== null && cat.seq < floor) return { ok: false, error: 'older' }
    return { ok: true, doc, key }
  } catch (e) {
    return { ok: false, error: 'json' }
  }
}

/**
 * One catalogue entry, verified: `{ ok: true, sha256, level }` or `{ ok: false, error }`. The level is computed HERE, once
 * (A6's INT4): `official` (the `kybernos` namespace signed by one of `officialKeys`), `verified` (the author AND the reviewer
 * countersigned the same hash), `community` (the author's signature only). A level is never inherited from another version.
 * Errors: `hash`, `signature`, `yanked`, `schema`.
 */
export function verifyEntry (input) {
  try {
    const opts = plain(input) ? input : {}
    const id = text(opts.id)
    const version = text(opts.version)
    const entry = plain(opts.entry) ? opts.entry : null
    if (id === null || version === null || entry === null) return { ok: false, error: 'schema' }
    if (entry.yanked === true) return { ok: false, error: 'yanked' }
    const archive = plain(entry.archive) ? entry.archive : null
    const sha256 = archive !== null ? text(archive.sha256) : null
    if (sha256 === null || HEX64.test(sha256) === false) return { ok: false, error: 'hash' }
    const hash = sha256.toLowerCase()
    const authorSig = signedBy('kybernos-plugin-v1\n' + id + '\n' + version + '\n' + hash, entry.authorSig, keysOf(opts.keys))
    if (authorSig === null) return { ok: false, error: 'signature' }
    const reviewer = signedBy('kybernos-plugin-review-v1\n' + id + '\n' + version + '\n' + hash + '\nverified', entry.review, keysOf(opts.reviewerKeys))
    const official = id.startsWith('kybernos/') && list(opts.officialKeys).indexOf(text(opts.catalogueKey)) >= 0
    const level = official ? 'official' : reviewer !== null ? 'verified' : 'community'
    return { ok: true, sha256: hash, level }
  } catch (e) {
    return { ok: false, error: 'schema' }
  }
}

/**
 * The archived bytes of an entry: hashed, compared to the entry's own hash and bound, then the same two signatures
 * (`verifyEntry`). `{ ok: true, sha256, level }` or `{ ok: false, error }`; a wrong hash is `hash`, an archive over the
 * import bound is `size`.
 */
export function verifyArchive (input) {
  try {
    const opts = plain(input) ? input : {}
    const bytes = asBytes(opts.bytes)
    if (bytes === null) return { ok: false, error: 'size' }
    const entry = plain(opts.entry) ? opts.entry : null
    if (entry === null || plain(entry.archive) === false) return { ok: false, error: 'hash' }
    const size = Number.isInteger(entry.archive.size) ? entry.archive.size : null
    if (size !== null && size > IMPORT_MAX) return { ok: false, error: 'size' }
    if (bytes.length > IMPORT_MAX) return { ok: false, error: 'size' }
    const sha256 = hashOf(bytes)
    const want = text(entry.archive.sha256)
    if (want === null || want.toLowerCase() !== sha256) return { ok: false, error: 'hash' }
    return verifyEntry({ id: opts.id, version: opts.version, entry, catalogueKey: opts.catalogueKey, keys: opts.keys, reviewerKeys: opts.reviewerKeys, officialKeys: opts.officialKeys })
  } catch (e) {
    return { ok: false, error: 'hash' }
  }
}

/**
 * Revocation is evaluated BEFORE an offer, never after an install (`plugin-contract.md:451-456`): what the verified document
 * says about one theme at one version. `{ revoked: true, reason, action }` when the list or a revoked key names it,
 * `{ revoked: false }` otherwise. A revoked key disables everything that key signed.
 */
export function revocationOf (doc, id, version) {
  try {
    if (!plain(doc)) return { revoked: false }
    const revokedKeys = list(doc.revokedKeys).map((k) => (typeof k === 'string' ? k : plain(k) ? text(k.keyId) : null)).filter((k) => k !== null)
    for (const r of list(doc.revoked)) {
      if (!plain(r) || text(r.id) !== id) continue
      const versions = list(r.versions).map((v) => String(v))
      if (versions.length > 0 && versions.indexOf(String(version)) < 0) continue
      return { revoked: true, reason: tidy(r.reason, 200), action: r.action === 'warn' ? 'warn' : 'disable' }
    }
    if (revokedKeys.length > 0) return { revoked: false, revokedKeys }
    return { revoked: false }
  } catch (e) {
    return { revoked: false }
  }
}

/** The one-line reason a contributed `skills/` folder or `automations/` template is shown but not installed (INT9). */
const WHY_NOT_SKILL = 'a contributed skill folder has no install route yet (A2 reads it, writes nothing)'
const WHY_NOT_AUTOMATION = 'an automation template carries steps, not the prompt a task needs'

/**
 * The plan of one preview, as the one screen shows it: `{ ok, id, style, pack, kit: { skills, teams, automations },
 * notInstallable, rejected }`, or `{ ok: false, error }` (`no-pack`, `ambiguous`, `style`, `schema`). Every item carries the
 * file it comes from; deterministic (same preview, same JSON); never invents a datum.
 */
export function planTheme (preview, pluginId = null) {
  try {
    if (Array.isArray(preview) === false) return { ok: false, error: 'schema' }
    const packs = []
    const styles = []
    const teamTemplates = []
    const skillFolders = []
    const autoTemplates = []
    const rejected = []
    for (const ext of preview) {
      if (!plain(ext)) continue
      const point = text(ext.point) ?? ''
      for (const r of list(ext.rejected)) if (plain(r)) rejected.push({ point, file: tidy(r.file, 200), errors: list(r.errors).map((x) => tidy(x, 200)) })
      for (const f of list(ext.files)) {
        if (!plain(f) || !plain(f.value)) continue
        const file = tidy(f.file, 200)
        if (point === 'kybernos/core#domain-pack') packs.push({ file, value: f.value })
        else if (point === 'kybernos/theme#theme') styles.push({ file, value: f.value })
        else if (point === 'kybernos/core#team-template') teamTemplates.push({ file, value: f.value })
        else if (point === 'kybernos/skills#skill') skillFolders.push({ file, value: f.value })
        else if (point === 'kybernos/core#automation-template') autoTemplates.push({ file, value: f.value })
      }
    }
    if (packs.length === 0) return { ok: false, error: 'no-pack' }
    if (packs.length > 1) return { ok: false, error: 'ambiguous' }
    if (styles.length > 1) return { ok: false, error: 'ambiguous' }
    const packFile = packs[0].file
    const pack = packs[0].value
    if (typeof pack.id !== 'string' || pack.id === '') return { ok: false, error: 'schema' }
    let style = null
    if (styles.length === 1) {
      const v = styles[0].value
      if (typeof v.id !== 'string' || PRESET_ID.test(v.id) === false) return { ok: false, error: 'style' }
      style = { id: v.id, name: plain(v.name) ? v.name : text(v.name), settings: plain(v.settings) ? v.settings : null, file: styles[0].file }
    }
    const goals = list(pack.goals).filter(plain)
    const kit = { skills: [], teams: [], automations: [] }
    const seen = { skill: new Set(), team: new Set(), packTeam: new Set(), automation: new Set() }
    for (const g of goals) {
      if (typeof g.id !== 'string') continue
      for (const s of list(g.skills)) {
        if (!plain(s) || typeof s.name !== 'string') continue
        const k = String(s.source ?? '') + ' ' + s.name
        if (seen.skill.has(k)) continue
        seen.skill.add(k)
        kit.skills.push({ name: s.name, source: typeof s.source === 'string' ? s.source : 'kybernos', goal: g.id, file: packFile })
      }
      for (const t of list(g.teams)) {
        if (typeof t !== 'string' || seen.packTeam.has(t)) continue
        seen.packTeam.add(t)
        kit.teams.push({ id: t, value: null, goal: g.id, source: 'pack', file: packFile })
      }
      for (const a of list(g.automations)) {
        if (!plain(a) || typeof a.id !== 'string' || seen.automation.has(a.id)) continue
        seen.automation.add(a.id)
        kit.automations.push({ id: a.id, name: plain(a.name) ? a.name : text(a.name), prompt: plain(a.prompt) ? a.prompt : text(a.prompt), cron: text(a.cron), goal: g.id, source: 'pack', file: packFile })
      }
    }
    for (const t of teamTemplates) {
      const id = typeof t.value.id === 'string' ? t.value.id : t.file.replace(/^.*\//, '').replace(/\.json$/, '')
      if (id === '' || seen.team.has(id)) continue
      seen.team.add(id)
      kit.teams.push({ id, value: t.value, goal: null, source: 'template', file: t.file })
    }
    const notInstallable = []
    for (const s of skillFolders) notInstallable.push({ kind: 'skill', id: typeof s.value.name === 'string' ? s.value.name : s.file.replace(/^.*\//, ''), file: s.file, why: WHY_NOT_SKILL })
    for (const a of autoTemplates) notInstallable.push({ kind: 'automation', id: typeof a.value.id === 'string' ? a.value.id : a.file.replace(/^.*\//, ''), file: a.file, why: WHY_NOT_AUTOMATION })
    return {
      ok: true,
      // The PLUGIN's id (`acme/vet-clinic`): the page consents, records and removes by it. The field's own id is `pack.id`; without a plugin id (a bare
      // preview) the plan can only name the field.
      id: typeof pluginId === 'string' && pluginId !== '' ? pluginId : pack.id,
      style,
      pack: {
        id: pack.id,
        name: plain(pack.name) || text(pack.name) !== null ? pack.name : null,
        file: packFile,
        words: {
          name: plain(pack.name) ? pack.name : text(pack.name),
          tagline: plain(pack.tagline) ? pack.tagline : text(pack.tagline),
          menu: plain(pack.menu) ? pack.menu : null,
          home: list(pack.home).filter((h) => typeof h === 'string'),
        },
        goals: goals.map((g) => ({ id: g.id, name: plain(g.name) ? g.name : text(g.name) })),
      },
      kit,
      notInstallable,
      rejected,
    }
  } catch (e) {
    return { ok: false, error: 'schema' }
  }
}

/**
 * The pre-install pre-check: what could make DSH load or run something of a package that says it is data. It answers the same
 * verdicts as the registry's own `dataPackageProblems` (registry.mjs:54-76) — D6 is the anti-drift gate, and it reddens the day
 * the registry's table changes. Empty array = a data package is what it says.
 */
export function dataPluginProblems (pkg, packageDir) {
  const out = []
  try {
    const d = plain(pkg) ? pkg : {}
    const dsh = plain(d.dsh) ? d.dsh : {}
    for (const k of Object.keys(dsh)) if (k !== 'bundle') out.push('package.json dsh.' + k + ' would make DSH load code')
    if (plain(dsh.bundle)) {
      for (const k of Object.keys(dsh.bundle)) if (k !== 'patch') out.push('package.json dsh.bundle.' + k + ' is not allowed in a data plugin')
      if (typeof dsh.bundle.patch === 'string') {
        if (!/^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]{1,120}$/.test(dsh.bundle.patch)) out.push('dsh.bundle.patch is not a path inside the package')
        else {
          let t = null
          try {
            const p = join(packageDir, dsh.bundle.patch)
            if (statSync(p).size > 256 * 1024) out.push('the patch is larger than 256 KiB')
            else t = readFileSync(p, 'utf8')
          } catch (e) { t = null }
          if (t === null) out.push('the patch is missing')
          else if (t.replace(/#[^\n]*/g, '').replace(/\s+/g, '') !== '[]' && t.replace(/#[^\n]*/g, '').trim() !== '') out.push('the patch names modules DSH would load: a data plugin has an empty patch')
        }
      } else if (dsh.bundle.patch !== undefined) out.push('dsh.bundle.patch is not a path')
    }
    if (plain(d.scripts)) for (const k of ['preinstall', 'install', 'postinstall', 'prepare']) if (d.scripts[k] !== undefined) out.push('package.json scripts.' + k + ' would run on install')
    if (d.bin !== undefined) out.push('package.json bin would put a command on the path')
  } catch (e) { /* an unreadable package is refused by the caller's own read */ }
  return out
}

/**
 * Why DSH's manager would refuse this package, or null. The manager installs a package ONLY as a bundle (`dsh.bundle.patch`); a package without one is rolled back
 * (`not-bundle`) after pnpm ran, and the page used to go on to ask for a plan of a package that was never there (`unknown-plugin`). A data theme is a bundle whose patch
 * is empty, so the rule costs it one file. `dataPluginProblems` already checks that the patch, when there is one, is empty and inside the package.
 */
export function bundleProblem (pkg) {
  const dsh = plain(pkg) && plain(pkg.dsh) ? pkg.dsh : {}
  if (plain(dsh.bundle) && typeof dsh.bundle.patch === 'string') return null
  return 'DSH installs a package only as a bundle: package.json needs "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } and a cordis.patch.yml that holds []'
}

// ── the install record ──────────────────────────────────────────────────────
const themesPath = (dir) => join(dir, 'themes.json')
const emptyRecord = () => ({ v: 1, active: null, records: [], sources: [], dropped: [] })
const RECORD_KEYS = ['id', 'version', 'level', 'source', 'applied', 'before', 'at']
const SOURCE_KEYS = ['url', 'keyId', 'pem', 'seq']

/** One record, known keys only: an unknown key is DROPPED and named, never obeyed. */
const cleanRecord = (r, at, dropped) => {
  if (!plain(r) || typeof r.id !== 'string' || OWNER.test(r.id) === false) return null
  const out = { id: r.id }
  for (const k of RECORD_KEYS) if (k !== 'id' && r[k] !== undefined) out[k] = r[k]
  for (const k of Object.keys(r)) if (k !== 'id' && RECORD_KEYS.indexOf(k) < 0) dropped.push('records[' + at + '].' + tidy(k, 40))
  return out
}

/** One source, known keys only: https, bounded. An http or oversized address is not a source. */
const cleanSource = (s, at, dropped) => {
  if (!plain(s) || typeof s.url !== 'string' || /^https:\/\/[^\s]{1,2000}$/.test(s.url) === false) return null
  const out = { url: s.url }
  for (const k of SOURCE_KEYS) if (k !== 'url' && s[k] !== undefined) out[k] = s[k]
  for (const k of Object.keys(s)) if (k !== 'url' && SOURCE_KEYS.indexOf(k) < 0) dropped.push('sources[' + at + '].' + tidy(k, 40))
  return out
}

/**
 * `<dir>/themes.json` as `{ v, active, records, sources, dropped }`. A corrupt, oversized or too-new file reads as empty and is
 * never thrown on; an unknown key is dropped with a named line. Never throws.
 */
export function readThemes (dir) {
  const empty = emptyRecord()
  try {
    if (typeof dir !== 'string' || dir === '') return empty
    const p = themesPath(dir)
    if (statSync(p).size > THEMES_MAX_BYTES) return empty
    const j = JSON.parse(readFileSync(p, 'utf8'))
    if (!plain(j) || j.v !== 1) return empty
    const out = emptyRecord()
    out.active = typeof j.active === 'string' && OWNER.test(j.active) ? j.active : null
    for (const r of list(j.records).slice(0, RECORDS_MAX)) {
      const c = cleanRecord(r, out.records.length, out.dropped)
      if (c !== null) out.records.push(c)
    }
    for (const s of list(j.sources).slice(0, MAX_SOURCES)) {
      const c = cleanSource(s, out.sources.length, out.dropped)
      if (c !== null) out.sources.push(c)
    }
    return out
  } catch (e) { return empty }
}

/**
 * Writes the record file atomically (a temporary beside it, then a rename), mode 0600, bounded. `{ ok: true }` or
 * `{ ok: false, error }`: `size` (over the cap), `records` (over 8), `dir`.
 */
export function writeThemes (dir, value) {
  try {
    if (typeof dir !== 'string' || dir === '') return { ok: false, error: 'dir' }
    const v = plain(value) ? value : {}
    const records = list(v.records).slice(0, RECORDS_MAX)
    if (list(v.records).length > RECORDS_MAX) return { ok: false, error: 'records' }
    const sources = list(v.sources).slice(0, MAX_SOURCES)
    const dropped = []
    const out = { v: 1, active: typeof v.active === 'string' && OWNER.test(v.active) ? v.active : null, records: [], sources: [] }
    for (const r of records) {
      const c = cleanRecord(r, out.records.length, dropped)
      if (c !== null) out.records.push(c)
    }
    for (const s of sources) {
      const c = cleanSource(s, out.sources.length, dropped)
      if (c !== null) out.sources.push(c)
    }
    const body = JSON.stringify(out, null, 2) + '\n'
    if (Buffer.byteLength(body, 'utf8') > THEMES_MAX_BYTES) return { ok: false, error: 'size' }
    const p = themesPath(dir)
    mkdirSync(dirname(p), { recursive: true, mode: 0o700 })
    const tmp = p + '.tmp-' + process.pid
    writeFileSync(tmp, body, { mode: 0o600 })
    renameSync(tmp, p)
    try { chmodSync(p, 0o600) } catch (e) { /* an exotic filesystem keeps the mode it has */ }
    return { ok: true, dropped }
  } catch (e) {
    return { ok: false, error: 'write' }
  }
}

/** The record of one theme id, or null. */
export const recordOf = (store, id) => readThemes(plain(store) ? store.dir : '').records.find((r) => r.id === id) ?? null

// ── the route body ──────────────────────────────────────────────────────────

/** A folder the person points at, checked without leaving the folder: `null` or the reason it cannot be read. */
const folderProblem = (folder) => {
  if (typeof folder !== 'string' || folder === '' || folder.length > 400) return 'a folder path is expected'
  if (folder.indexOf('\u0000') >= 0) return 'the path holds a NUL byte'
  if (folder.split(/[\\/]+/).indexOf('..') >= 0) return 'the path goes up its own tree'
  if (folder.startsWith('/') === false && /^[A-Za-z]:[\\/]/.test(folder) === false) return 'an absolute path is expected'
  try {
    const st = lstatSync(folder) // lstat, not stat: stat FOLLOWS a link, so isSymbolicLink() would never be true (F-2)
    if (st.isSymbolicLink()) return 'the folder is a symbolic link'
    if (!st.isDirectory()) return 'this is not a folder'
  } catch (e) { return 'the folder cannot be read' }
  return null
}

/**
 * The author keys a signed catalogue names for one plugin id (`<author>/<name>`): the document is signed as a whole, so what it
 * says about its own authors is attested by the key the person pinned. An author the document does not name has no key, and
 * its entries cannot verify — refused as `signature`, never trusted.
 */
const authorKeysOf = (doc, id) => {
  const owner = String(id).split('/')[0]
  const authors = plain(doc.authors) ? doc.authors : {}
  const author = plain(authors[owner]) ? authors[owner] : null
  return author === null ? [] : keysOf(author.keys)
}

/**
 * The catalogue entries the caller already fetched, verified: `{ themes, refused, entries }`. Nothing is parsed before its
 * signature; every offered entry goes through `verifyEntry`, so the level comes from the signatures and never from a field the
 * document wrote about itself (F-25). `entries` keeps what the archive check needs (`archive.url` and the key lists).
 */
const catalogueView = (sources, catalogues) => {
  const themes = []
  const refused = []
  const entries = []
  const fetched = list(catalogues).filter(plain)
  for (const s of sources) {
    const pinned = typeof s.pem === 'string' && s.pem !== '' ? [{ keyId: typeof s.keyId === 'string' ? s.keyId : 'pinned', pem: s.pem }] : []
    if (pinned.length === 0) { refused.push({ source: s.url, error: 'no-key', reason: 'unverifiable source — not installable' }); continue }
    const got = fetched.find((c) => c.source === s.url) ?? null
    if (got === null) { refused.push({ source: s.url, error: 'no-byte', reason: 'not read yet — refresh' }); continue }
    if (typeof got.error === 'string') { refused.push({ source: s.url, error: tidy(got.error, 20), reason: 'the catalogue could not be read' }); continue }
    const doc = verifyCatalogue({ bytes: got.bytes, signature: got.signature, keys: pinned, floor: Number.isInteger(s.seq) ? { seq: s.seq } : null })
    if (doc.ok !== true) { refused.push({ source: s.url, error: doc.error, reason: 'the catalogue was refused' }); continue }
    const reviewerKeys = keysOf(doc.doc.reviewers)
    for (const p of doc.doc.plugins) {
      const versions = list(p.versions)
      const newest = versions.length > 0 ? versions[versions.length - 1] : null
      if (newest === null) continue
      const version = String(newest.version)
      const rev = revocationOf(doc.doc, p.id, version)
      if (rev.revoked === true && rev.action === 'disable') { refused.push({ source: s.url, error: 'revoked', reason: rev.reason, id: p.id, version }); continue }
      const keys = authorKeysOf(doc.doc, p.id)
      // The level is COMPUTED here, once (A6's INT4): official needs the namespace AND a shipped official key, verified needs
      // the reviewer's countersignature, community is the author's signature alone. A self-pinned source can never mint more.
      const verified = verifyEntry({ id: p.id, version, entry: newest, catalogueKey: doc.key, keys, reviewerKeys, officialKeys: OFFICIAL_KEYS })
      if (verified.ok !== true) { refused.push({ source: s.url, error: verified.error, reason: 'the entry was refused', id: p.id, version }); continue }
      const m = plain(newest.manifest) ? newest.manifest : {}
      themes.push({
        id: p.id,
        version,
        source: s.url,
        catalogueKey: doc.key,
        level: verified.level,
        name: plain(m.name) || typeof m.name === 'string' ? m.name : null,
        description: plain(m.description) || typeof m.description === 'string' ? m.description : null,
        author: plain(m.author) || typeof m.author === 'string' ? m.author : null,
        licence: typeof m.license === 'string' ? m.license : null,
        points: list(m.extends).map((e) => tidy(plain(e) ? e.point : '', 64)).filter((x) => x !== ''),
        permissions: list(m.permissions).map((x) => tidy(x, 64)),
        archive: plain(newest.archive) ? { url: tidy(newest.archive.url, 2000), sha256: tidy(newest.archive.sha256, 64), size: Number.isInteger(newest.archive.size) ? newest.archive.size : null } : null,
        revoked: rev.revoked === true ? { reason: rev.reason, action: rev.action } : null,
      })
      entries.push({ id: p.id, version, entry: newest, catalogueKey: doc.key, keys, reviewerKeys, officialKeys: OFFICIAL_KEYS })
    }
  }
  return { themes, refused, entries }
}

/**
 * The verified entry an install targets, and the key lists its archive must verify against: `{ ok, id, version, entry,
 * catalogueKey, keys, reviewerKeys, officialKeys, archive }` or `{ ok: false, error }`. The caller (index.js) fetches the
 * archive from `archive.url`; it never takes an address from the page.
 */
export function themeTarget (dir, catalogues, id, version) {
  try {
    if (typeof id !== 'string' || OWNER.test(id) === false) return { ok: false, error: 'id' }
    const view = catalogueView(readThemes(dir).sources, catalogues)
    const found = view.entries.find((e) => e.id === id && (version === undefined || version === null || version === '' || e.version === String(version))) ?? null
    if (found === null) return { ok: false, error: 'unknown-theme' }
    const archive = plain(found.entry.archive) ? found.entry.archive : null
    if (archive === null || typeof archive.url !== 'string') return { ok: false, error: 'no-archive' }
    return { ok: true, id: found.id, version: found.version, entry: found.entry, catalogueKey: found.catalogueKey, keys: found.keys, reviewerKeys: found.reviewerKeys, officialKeys: found.officialKeys, archive }
  } catch (e) { return { ok: false, error: 'schema' } }
}

/** The archive file the manager is pointed at: its name is ours (no header, no client string), bounded and gzip-named. */
const archivePath = (dir, id, version) => {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const name = String(id).replace(/[^a-z0-9-]+/gi, '-') + '-' + String(version).replace(/[^0-9A-Za-z.+-]+/g, '-') + '.tgz'
  return join(dir, 'plugin-imports', stamp + '-' + name.slice(0, 160))
}

/**
 * Keeps the VERIFIED archive where DSH's manager can read it (the folder the registry's import route already uses), atomic and
 * 0600, and prunes the oldest. `{ ok: true, path }` or `{ ok: false, error }`.
 */
const writeArchive = (dir, id, version, bytes) => {
  try {
    if (typeof dir !== 'string' || dir === '') return { ok: false, error: 'dir' }
    const folder = join(dir, 'plugin-imports')
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    const p = archivePath(dir, id, version)
    const tmp = p + '.tmp-' + process.pid
    writeFileSync(tmp, bytes, { mode: 0o600 })
    renameSync(tmp, p)
    try {
      const old = readdirSync(folder).filter((f) => /\.tgz$/.test(f)).sort().slice(0, -ARCHIVES_KEEP)
      for (const f of old) rmSync(join(folder, f), { force: true })
    } catch (e) { /* housekeeping only */ }
    return { ok: true, path: p }
  } catch (e) { return { ok: false, error: 'write' } }
}

/** The GET of the one read: the bounded sources, the installed records, the verified catalogue entries and the refused lines. */
const readAll = (dir, ports) => {
  const store = readThemes(dir)
  const view = catalogueView(store.sources, ports.catalogues)
  let plugins = []
  try { if (plain(ports.registry) && typeof ports.registry.plugins === 'function') plugins = list(ports.registry.plugins()).map((p) => (plain(p) ? { id: p.id, name: p.name, version: p.version, level: p.level, status: p.status, source: p.source, author: p.author ?? null, license: p.license ?? null } : null)).filter((p) => p !== null) } catch (e) { plugins = [] }
  return {
    ok: true,
    v: 1,
    active: store.active,
    sources: store.sources.map((s) => ({ url: s.url, keyId: typeof s.keyId === 'string' ? s.keyId : null, pinned: typeof s.pem === 'string' && s.pem !== '', seq: Number.isInteger(s.seq) ? s.seq : null })),
    installed: store.records,
    themes: view.themes,
    // The themes the product ships (themes-shipped.mjs): what a card shows, never the folder on this computer
    shipped: list(ports.shipped).filter(plain).map((t) => { const { folder, ...rest } = t; return rest }),
    next: list(ports.next).filter(plain).map((n) => ({ id: n.id, name: n.name, cover: n.cover === true })),
    plugins,
    refused: view.refused,
    dropped: store.dropped,
  }
}

/**
 * `handleThemes({ dir }, request, ports)` → `{ status, body }`: the body of `/kybernos/themes`, pure over its ports and
 * synchronous, never throwing on garbage. Method first (405), origin second (403), signed session third (401/403/503), the body
 * cap (413), then one action: `stage`, `plan`, `install`, `record`, `forget`, `source-add`, `source-remove`, `refresh`. Unknown is
 * 400.
 *
 * Ports: `sameOrigin(req)` → boolean; `session(req)` → `true` or `{ status, error }`; `registry` (the seam, or null);
 * `catalogues` → `[{ source, bytes, signature }]` already fetched; `archive` → `{ id, version, entry, catalogueKey, keys,
 * reviewerKeys, officialKeys, bytes }` already fetched for `install` (the caller owns the transport, so this file never fetches).
 */
export function handleThemes (store, request, ports) {
  const answer = (status, body) => ({ status, body: plain(body) ? body : { ok: false, error: 'internal error' } })
  try {
    const req = plain(request) ? request : {}
    const method = typeof req.method === 'string' ? req.method.toUpperCase() : ''
    if (method !== 'GET' && method !== 'POST') return answer(405, { ok: false, error: 'GET or POST expected' })
    const p = plain(ports) ? ports : {}
    if (typeof p.sameOrigin === 'function' && p.sameOrigin(req) !== true) return answer(403, { ok: false, error: 'origin refused' })
    const dir = plain(store) && typeof store.dir === 'string' ? store.dir : ''
    if (method === 'GET') return answer(200, readAll(dir, p))
    const session = typeof p.session === 'function' ? p.session(req) : true
    if (session !== true) {
      const status = plain(session) && typeof session.status === 'number' ? session.status : 403
      return answer(status, { ok: false, error: plain(session) && typeof session.error === 'string' ? session.error : 'sign-in required' })
    }
    const body = plain(req.body) ? req.body : null
    if (body === null) return answer(400, { ok: false, error: 'an object body is expected' })
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > BODY_MAX) return answer(413, { ok: false, error: 'request body too large' })
    const action = text(body.action) ?? ''
    if (action === 'stage') {
      let folder = text(body.folder) ?? ''
      let level = 'local'
      if (body.shipped !== undefined) {
        // A shipped theme: the page names it, the host owns the path (ports.shipped, themes-shipped.mjs), so no path comes from the page
        const hit = list(p.shipped).find((t) => plain(t) && typeof t.folder === 'string' && t.id === body.shipped)
        if (hit === undefined) return answer(400, { ok: false, error: 'not-shipped', reason: 'no shipped theme has this id' })
        folder = hit.folder
        level = 'included'
      }
      const bad = folderProblem(folder)
      if (bad !== null) return answer(400, { ok: false, error: 'path', reason: bad })
      let manifest = null
      try { manifest = JSON.parse(readFileSync(join(folder, 'plugin.json'), 'utf8')) } catch (e) { manifest = null }
      if (!plain(manifest)) return answer(400, { ok: false, error: 'not-a-theme', reason: 'this folder holds no plugin.json' })
      if (manifest.kind === 'code') return answer(400, { ok: false, error: 'code-plugin', reason: 'only data themes install here; a code plugin is DSH’s Plugins page' })
      let pkg = null
      try { pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) } catch (e) { pkg = null }
      const problems = dataPluginProblems(pkg, folder)
      if (problems.length > 0) return answer(400, { ok: false, error: 'package', reason: problems[0], problems })
      const notBundle = bundleProblem(pkg)
      if (notBundle !== null) return answer(400, { ok: false, error: 'package', reason: notBundle, problems: [notBundle] })
      const id = typeof manifest.id === 'string' && OWNER.test(manifest.id) ? manifest.id : null
      if (id === null) return answer(400, { ok: false, error: 'not-a-theme', reason: 'plugin.json holds no author/name id' })
      return answer(200, { ok: true, stage: { id, version: text(manifest.version), name: plain(manifest.name) ? manifest.name : null, level, path: folder } })
    }
    if (action === 'plan') {
      const id = text(body.id) ?? ''
      if (OWNER.test(id) === false) return answer(400, { ok: false, error: 'id' })
      const reg = plain(p.registry) ? p.registry : null
      if (reg === null || typeof reg.preview !== 'function') return answer(200, { ok: false, error: 'no-registry' })
      let preview = null
      try { preview = reg.preview(id) } catch (e) { preview = null }
      if (preview === null) return answer(200, { ok: false, error: 'unknown-plugin' })
      const plan = planTheme(preview, id)
      return answer(200, plan.ok === true ? { ok: true, plan } : { ok: false, error: plan.error })
    }
    // The archive half of the click: the caller (index.js) fetched the bytes AND ran `verifyArchive` on them before handing
    // them over — hash compared to the entry, author and reviewer signatures checked (F-26). This body refuses a port whose
    // verdict does not name these exact bytes, checks the gzip shape, then stages the VERIFIED bytes for DSH's manager. The page
    // never hashes, never writes a path and never picks the address.
    if (action === 'install') {
      const id = text(body.id) ?? ''
      if (OWNER.test(id) === false) return answer(400, { ok: false, error: 'id' })
      const got = plain(p.archive) ? p.archive : null
      if (got === null || got.id !== id) return answer(200, { ok: false, error: 'no-archive' })
      const bytes = asBytes(got.bytes)
      if (bytes === null) return answer(200, { ok: false, error: 'download' })
      const verdict = plain(got.verified) ? got.verified : null
      if (verdict === null || verdict.ok !== true || verdict.sha256 !== hashOf(bytes)) return answer(200, { ok: false, error: 'unverified' })
      if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return answer(200, { ok: false, error: 'archive' })
      const staged = writeArchive(dir, id, String(got.version), bytes)
      if (staged.ok !== true) return answer(500, { ok: false, error: staged.error })
      return answer(200, { ok: true, id, version: String(got.version), sha256: verdict.sha256, level: verdict.level, path: staged.path })
    }
    // The sample rows of a SHIPPED theme go into the business base through its seam (`ports.business`): the host knows the folder, the page names the
    // theme. The base checks every row and seeds one theme once (`skipped` the second time); a theme from elsewhere has no route here.
    if (action === 'seed') {
      const id = text(body.id) ?? ''
      if (OWNER.test(id) === false) return answer(400, { ok: false, error: 'id' })
      const hit = list(p.shipped).find((x) => plain(x) && typeof x.folder === 'string' && x.id === id)
      const data = hit === undefined ? null : readSample(hit.folder)
      if (data === null) return answer(200, { ok: false, error: 'no-sample' })
      const base = plain(p.business) && typeof p.business.seed === 'function' ? p.business : null
      if (base === null) return answer(200, { ok: false, error: 'base_missing' })
      let r = null
      try { r = base.seed(data, { theme: id, actor: 'theme' }) } catch (e) { r = null }
      if (!plain(r)) return answer(200, { ok: false, error: 'failed' })
      return answer(200, r.ok === true ? { ok: true, skipped: r.skipped === true, counts: plain(r.counts) ? r.counts : null } : { ok: false, error: text(r.error) ?? 'failed', detail: tidy(r.detail, 200) })
    }
    // A skill the SHIPPED theme carries in its own folder (`skills/<name>/SKILL.md`): the host copies it into the person's skills with the careful
    // seeding every shipped skill goes through (`ports.skill`, injected by index.js); the page names the theme and the skill, never a path.
    if (action === 'skill') {
      const id = text(body.id) ?? ''
      const name = text(body.name) ?? ''
      if (OWNER.test(id) === false || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) === false || name.length > 64) return answer(400, { ok: false, error: 'id' })
      const hit = list(p.shipped).find((x) => plain(x) && typeof x.folder === 'string' && x.id === id)
      if (hit === undefined || typeof p.skill !== 'function') return answer(200, { ok: false, error: 'no-skill' })
      let r = null
      try { r = p.skill(hit.folder, name) } catch (e) { r = null }
      return answer(200, plain(r) && r.ok === true ? { ok: true, action: text(r.action) ?? 'created' } : { ok: false, error: 'no-skill' })
    }
    if (action === 'record') {
      const id = text(body.id) ?? ''
      if (OWNER.test(id) === false) return answer(400, { ok: false, error: 'id' })
      const store1 = readThemes(dir)
      const rec = { id }
      for (const k of ['version', 'level', 'source', 'applied', 'before']) if (body[k] !== undefined) rec[k] = body[k]
      rec.at = new Date().toISOString()
      const records = store1.records.filter((r) => r.id !== id)
      records.push(rec)
      const written = writeThemes(dir, { active: body.active !== undefined ? body.active : id, records, sources: store1.sources })
      return written.ok === true ? answer(200, { ok: true, record: rec, records: records.length }) : answer(500, { ok: false, error: written.error })
    }
    if (action === 'forget') {
      const id = text(body.id) ?? ''
      if (OWNER.test(id) === false) return answer(400, { ok: false, error: 'id' })
      const store1 = readThemes(dir)
      const records = store1.records.filter((r) => r.id !== id)
      if (records.length === store1.records.length) return answer(200, { ok: true, already: true })
      const active = store1.active === id ? (records.length > 0 ? records[records.length - 1].id : null) : store1.active
      const written = writeThemes(dir, { active, records, sources: store1.sources })
      return written.ok === true ? answer(200, { ok: true, removed: true }) : answer(500, { ok: false, error: written.error })
    }
    if (action === 'source-add') {
      const url = text(body.url) ?? ''
      if (/^https:\/\/[^\s]{1,2000}$/.test(url) === false) return answer(400, { ok: false, error: 'an https address is expected' })
      const store1 = readThemes(dir)
      if (store1.sources.some((s) => s.url === url)) return answer(200, { ok: true, already: true, sources: store1.sources.length })
      if (store1.sources.length >= MAX_SOURCES) return answer(400, { ok: false, error: 'too-many-sources', reason: 'at most ' + MAX_SOURCES + ' sources' })
      const src = { url }
      if (plain(body.key) && typeof body.key.pem === 'string' && typeof body.key.keyId === 'string') { src.keyId = body.key.keyId; src.pem = body.key.pem }
      const written = writeThemes(dir, { active: store1.active, records: store1.records, sources: store1.sources.concat([src]) })
      return written.ok === true ? answer(200, { ok: true, sources: store1.sources.length + 1 }) : answer(500, { ok: false, error: written.error })
    }
    if (action === 'source-remove') {
      const url = text(body.url) ?? ''
      const store1 = readThemes(dir)
      const sources = store1.sources.filter((s) => s.url !== url)
      if (sources.length === store1.sources.length) return answer(200, { ok: true, already: true })
      const written = writeThemes(dir, { active: store1.active, records: store1.records, sources })
      return written.ok === true ? answer(200, { ok: true, removed: true }) : answer(500, { ok: false, error: written.error })
    }
    if (action === 'refresh') return answer(200, readAll(dir, p))
    return answer(400, { ok: false, error: 'unknown action' })
  } catch (e) {
    return answer(500, { ok: false, error: 'internal error' })
  }
}

// ── the transport: the few lines of `packages/kybernos-hub/telechargement.mjs` this bundle copies (A6:43) ────────────────
// A bundle cannot import another bundle's file, so the bounded rules are re-stated here: https only (a redirect must not
// downgrade it), a size cap enforced WHILE reading (never after a full download), a deadline, and a document parsed only
// once its own size is within the bound. Nothing here is trusted: the bytes still go through `verifyCatalogue`/`verifyEntry`.
const openBounded = async (url, ms, fetchImpl) => {
  let u = null
  try { u = new URL(url) } catch (e) { return null }
  if (u.protocol !== 'https:') return null
  const rep = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(ms), headers: { accept: '*/*' } })
  if (rep.ok !== true) return null
  if (typeof rep.url === 'string' && rep.url !== '') { try { if (new URL(rep.url).protocol !== 'https:') return null } catch (e) { return null } }
  if (rep.body === null || rep.body === undefined) return null
  return rep
}

/** The body, read in chunks and refused the moment it passes `max`: an oversized document is never buffered whole. */
const readCapped = async (rep, max) => {
  const reader = rep.body.getReader()
  const chunks = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.length
    if (n > max) { try { await reader.cancel() } catch (e) { /* closing anyway */ } const e = new Error('size'); e.code = 'size'; throw e }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/**
 * The declared sources, fetched: `[{ source, bytes, signature }]` or `[{ source, error }]` per source, never a throw. The
 * signature is the document's sibling `<url>.sig` (a bare base64 body, or `{ "signature": "…" }`), so a source is a pair of
 * addresses the person added, not one. The caller passes the result to `handleThemes` as `ports.catalogues`.
 */
export async function fetchCatalogueSources (sources, opts = {}) {
  const fetchImpl = typeof opts.fetch === 'function' ? opts.fetch : fetch
  const timeout = Number.isInteger(opts.timeoutMs) ? opts.timeoutMs : SOURCE_TIMEOUT_MS
  const wanted = list(sources).filter((s) => plain(s) && typeof s.url === 'string')
  // In parallel: three dead addresses must cost one deadline, not three (the page waits on this read).
  const one = async (s) => {
    try {
      const doc = await openBounded(s.url, timeout, fetchImpl)
      if (doc === null) return { source: s.url, error: 'download' }
      const bytes = await readCapped(doc, MAX_DOC_BYTES)
      const sig = await openBounded(s.url + '.sig', timeout, fetchImpl)
      if (sig === null) return { source: s.url, error: 'signature' }
      const raw = (await readCapped(sig, SIGNATURE_MAX_BYTES)).toString('utf8').trim()
      let signature = raw
      try { const j = JSON.parse(raw); if (plain(j) && typeof j.signature === 'string') signature = j.signature.trim() } catch (e) { /* a bare base64 body */ }
      if (signature === '') return { source: s.url, error: 'signature' }
      return { source: s.url, bytes, signature }
    } catch (e) { return { source: s.url, error: e !== null && e !== undefined && e.code === 'size' ? 'size' : 'download' } }
  }
  return Promise.all(wanted.map(one))
}

/**
 * An archive the verified entry points at, under the import bound: `{ ok: true, bytes }` or `{ ok: false, error }` (`download`,
 * `size`). The URL is the one the signed catalogue carries, never one the page sent; `verifyArchive` still hashes these bytes.
 */
export async function fetchArchiveBytes (url, opts = {}) {
  const fetchImpl = typeof opts.fetch === 'function' ? opts.fetch : fetch
  const timeout = Number.isInteger(opts.timeoutMs) ? opts.timeoutMs : ARCHIVE_TIMEOUT_MS
  try {
    const rep = await openBounded(url, timeout, fetchImpl)
    if (rep === null) return { ok: false, error: 'download' }
    return { ok: true, bytes: await readCapped(rep, IMPORT_MAX) }
  } catch (e) { return { ok: false, error: e !== null && e !== undefined && e.code === 'size' ? 'size' : 'download' } }
}
