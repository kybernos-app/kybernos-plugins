// The plugin registry (docs/dev/plugin-contract.md, sections 5, 6 and 14): reads the data plugins installed on this computer, checks them, and
// gives the owner of an extension point what they contribute. Pure Node (fs, path), no DSH service: testable on a temp folder.
//
//   <root>/<author>/<name>/plugin.json        the manifest of a DATA plugin (kind "data"); its `extends` name the points it contributes to
//   <root>/<author>/<name>/<dir>/*.json       the contributions, one file each, checked by the point's own validator
//   <stateFile>                                { enabled: { "<id>": true } }: a plugin seen for the first time is OFF until the person switches it on
//
// What is NEVER done here: nothing in a plugin folder is executed, imported, fetched or followed (a symbolic link is refused, a file is read as
// bounded text and parsed as JSON, nothing else). A folder that fails any check is listed as `invalid` with its reasons and left out; scanning
// can never throw to the caller. Phase 2 of the contract: only `local/<name>` folders are read (a folder placed on this computer); a plugin
// of another author comes with the signed catalogue (phase 3), so it is listed as invalid until then.
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { manifestErrors } from './manifest.mjs'
import { compareVersions, satisfies } from './version.mjs'

export const LIMITS = { manifest: 64 * 1024, file: 256 * 1024, files: 32, plugins: 64, perPlugin: 64 }
/** What a plugin can be, in the order the card says it: only one is `ok`. */
export const STATUSES = ['ok', 'disabled', 'needs-dsh', 'needs-kybernos', 'missing-dependency', 'incompatible-point', 'revoked', 'invalid']

const AUTHOR = /^[a-z][a-z0-9-]{1,31}$/
const NAME = /^[a-z][a-z0-9-]{1,39}$/
const OWNER = /^[a-z][a-z0-9-]{1,31}\/[a-z][a-z0-9-]{1,39}$/
const POINT = /^[a-z][a-z0-9-]{1,31}$/
const POINT_VERSION = /^\d+\.\d+$/

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
const lstat = (path) => { try { return lstatSync(path) } catch (e) { return null } }
/** A line of text from a file nobody vouches for: printable, bounded, so it can be shown and logged without surprise. */
const tidy = (v, max = 60) => (typeof v === 'string' ? Array.from(v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim()).slice(0, max).join('') : '')

/** Reads one file as bounded text. `{ text }` or `{ error }`. A symbolic link, a directory or a file over the bound is an error, never read. */
export function readBounded (path, max) {
  const st = lstat(path)
  if (st === null) return { error: 'is missing' }
  if (st.isSymbolicLink()) return { error: 'is a symbolic link' }
  if (!st.isFile()) return { error: 'is not a file' }
  if (st.size > max) return { error: 'is larger than ' + Math.round(max / 1024) + ' KiB' }
  try { return { text: readFileSync(path, 'utf8') } } catch (e) { return { error: 'cannot be read' } }
}

/** The folders under `root`, as records `{ id, author, name, folder, manifest, errors }`. `manifest` is set only when the manifest passed every check. */
export function scanFolder (root) {
  const records = []
  let authors = []
  try { authors = readdirSync(root, { withFileTypes: true }).sort(byName) } catch (e) { return records }
  for (const a of authors) {
    if (!a.isDirectory() || !AUTHOR.test(a.name)) continue // a symbolic link to a folder is not a directory here; stray files and dot folders are not plugins
    let names = []
    try { names = readdirSync(join(root, a.name), { withFileTypes: true }).sort(byName) } catch (e) { continue }
    for (const n of names) {
      if (records.length >= LIMITS.plugins) return records
      if (n.isSymbolicLink() || (n.isDirectory() && NAME.test(n.name)) === false) { if (n.isSymbolicLink() && NAME.test(n.name)) records.push({ id: a.name + '/' + n.name, author: a.name, name: n.name, folder: join(root, a.name, n.name), manifest: null, errors: ['the folder is a symbolic link'], info: {} }); continue }
      records.push(readRecord(root, a.name, n.name))
    }
  }
  return records
}

function readRecord (root, author, name) {
  const id = author + '/' + name
  const folder = join(root, author, name)
  const rec = { id, author, name, folder, manifest: null, errors: [], info: {} }
  const read = readBounded(join(folder, 'plugin.json'), LIMITS.manifest)
  if (read.error !== undefined) { rec.errors.push('plugin.json ' + read.error); return rec }
  let raw
  try { raw = JSON.parse(read.text) } catch (e) { rec.errors.push('plugin.json is not valid JSON'); return rec }
  if (!plain(raw)) { rec.errors.push('plugin.json is not an object'); return rec }
  rec.info = { name: tidy(raw.name?.en, 40), version: tidy(raw.version, 40) }
  const errors = manifestErrors(raw, { local: author === 'local' })
  if (errors.length === 0) {
    if (raw.id !== id) errors.push('the manifest id "' + raw.id + '" is not the folder "' + id + '"')
    if (raw.kind !== 'data') errors.push('a code plugin cannot be loaded from this folder: code plugins are the modules of the suite')
    if (author !== 'local') errors.push('only "local" folders can be read for now: a plugin of another author arrives with the signed catalogue')
  }
  rec.errors = errors.slice(0, 8)
  if (errors.length === 0) rec.manifest = raw
  return rec
}

const pointRef = (def) => def.owner + '#' + def.name

/**
 * @param {object} o
 * @param {string} o.root           folder of the installed plugins (<DSH home>/kybernos/plugins)
 * @param {string} o.stateFile      where the on/off choices are kept
 * @param {string|null} [o.kybernosVersion]   the suite's version, when known (`requires.kybernos` is not enforced without it)
 * @param {string|null} [o.dshVersion]        DSH's version, when known (`requires.dsh` is not enforced without it)
 * @param {number} [o.ttlMs]        how long a scan is reused (a folder dropped in shows up after at most this long)
 * @param {() => number} [o.now]
 */
export function createRegistry ({ root, stateFile, kybernosVersion = null, dshVersion = null, ttlMs = 2000, now = Date.now }) {
  const points = new Map()
  const listeners = new Set()
  let cache = null
  let cachedAt = 0
  const warned = new Set()

  const readState = () => {
    const r = readBounded(stateFile, 64 * 1024)
    if (r.error !== undefined) return { enabled: {} }
    try {
      const j = JSON.parse(r.text)
      const enabled = {}
      if (plain(j) && plain(j.enabled)) for (const [k, v] of Object.entries(j.enabled)) if (OWNER.test(k) && v === true) enabled[k] = true
      return { enabled }
    } catch (e) { return { enabled: {} } }
  }
  const writeState = (state) => {
    mkdirSync(dirname(stateFile), { recursive: true, mode: 0o700 })
    const tmp = stateFile + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, stateFile)
    try { chmodSync(stateFile, 0o600) } catch (e) { /* exotic filesystem */ }
  }
  const emit = () => { for (const fn of [...listeners]) { try { fn() } catch (e) { /* a listener cannot break the registry */ } } }

  /** The owner's point: `{ owner, ownerVersion, name, version "1.0", kind "data", class, validate(raw, fileId) → { ok, value } | { ok:false, errors }, max? }`. Idempotent. */
  function definePoint (def) {
    if (!plain(def) || !OWNER.test(String(def.owner)) || !POINT.test(String(def.name)) || !POINT_VERSION.test(String(def.version)) || def.kind !== 'data' ||
        !['inert', 'instruction'].includes(def.class) || typeof def.validate !== 'function') throw new Error('registry: a point needs owner, name, version "x.y", kind "data", class and validate()')
    const ownerVersion = /^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(String(def.ownerVersion)) ? String(def.ownerVersion) : '0.0.0'
    const next = { owner: def.owner, ownerVersion, name: def.name, version: def.version, kind: 'data', class: def.class, validate: def.validate, max: Number.isInteger(def.max) && def.max > 0 && def.max <= LIMITS.perPlugin ? def.max : LIMITS.files }
    const prev = points.get(pointRef(def))
    // Owners may call this at every request (their own bundle may mount before or after this one): the same definition changes nothing and keeps the scan.
    if (prev !== undefined && Object.keys(next).every((k) => prev[k] === next[k])) return
    points.set(pointRef(def), next)
    cache = null
  }

  /** Why a plugin cannot be `ok`, if it cannot: `{ status, reason }` or null. The first thing wrong, in the order of the contract's statuses. */
  function problem (m) {
    if (m.requires.kybernos !== undefined && kybernosVersion !== null && !satisfies(kybernosVersion, m.requires.kybernos)) return { status: 'needs-kybernos', reason: 'needs Kybernos ' + m.requires.kybernos + ' (this is ' + kybernosVersion + ')' }
    if (m.requires.dsh !== undefined && dshVersion !== null && (compareVersions(dshVersion, m.requires.dsh.min) < 0 || compareVersions(dshVersion, m.requires.dsh.max) > 0)) return { status: 'needs-dsh', reason: 'needs DSH ' + m.requires.dsh.min + ' to ' + m.requires.dsh.max + ' (this is ' + dshVersion + ')' }
    const owners = new Map()
    for (const p of points.values()) owners.set(p.owner, p.ownerVersion)
    for (const [dep, range] of Object.entries(m.requires.plugins ?? {})) {
      if (!owners.has(dep)) return { status: 'missing-dependency', reason: 'needs ' + dep + ', which is not available' }
      if (!satisfies(owners.get(dep), range)) return { status: 'missing-dependency', reason: 'needs ' + dep + ' ' + range + ' (this is ' + owners.get(dep) + ')' }
    }
    for (const e of m.extends ?? []) {
      const p = points.get(e.point)
      if (p === undefined) return { status: 'missing-dependency', reason: 'extends ' + e.point + ', which is not available' }
      if (!satisfies(p.version + '.0', e.range)) return { status: 'incompatible-point', reason: e.point + ' is version ' + p.version + ', this plugin wants ' + e.range }
    }
    return null
  }

  /** The contributions of one extension: the files of its folder, each through the point's validator. */
  function readExtension (rec, ext, point) {
    const out = { contributions: [], rejected: [] }
    const dir = join(rec.folder, ext.dir)
    const st = lstat(dir)
    if (st === null || st.isSymbolicLink() || !st.isDirectory()) { out.rejected.push({ file: ext.dir, errors: ['is not a folder of this plugin'] }); return out }
    let files = []
    try { files = readdirSync(dir).filter((f) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.json$/.test(f)).sort() } catch (e) { out.rejected.push({ file: ext.dir, errors: ['cannot be listed'] }); return out }
    if (files.length > point.max) { out.rejected.push({ file: ext.dir, errors: ['holds more than ' + point.max + ' files: only the first ' + point.max + ' are read'] }); files = files.slice(0, point.max) }
    for (const f of files) {
      const r = readBounded(join(dir, f), LIMITS.file)
      if (r.error !== undefined) { out.rejected.push({ file: f, errors: [r.error] }); continue }
      let raw
      try { raw = JSON.parse(r.text) } catch (e) { out.rejected.push({ file: f, errors: ['is not valid JSON'] }); continue }
      let v
      try { v = point.validate(raw, f.replace(/\.json$/, '')) } catch (e) { v = { ok: false, errors: ['the check itself failed'] } }
      if (v !== null && typeof v === 'object' && v.ok === true) out.contributions.push({ plugin: rec.id, level: 'local', class: point.class, file: ext.dir + '/' + f, value: v.value })
      else out.rejected.push({ file: f, errors: Array.isArray(v?.errors) ? v.errors.slice(0, 6).map((x) => tidy(String(x), 200)) : ['was refused'] })
    }
    return out
  }

  function load () {
    if (cache !== null && now() - cachedAt < ttlMs) return cache
    const state = readState()
    const plugins = []
    const contributions = new Map()
    for (const rec of scanFolder(root)) {
      const base = { id: rec.id, level: 'local', enabled: state.enabled[rec.id] === true, errors: rec.errors, name: rec.info.name || rec.name, version: rec.info.version || null, folder: rec.name }
      if (rec.manifest === null) { plugins.push({ ...base, status: 'invalid', reason: rec.errors[0] ?? 'cannot be read', extends: [] }); warnOnce(rec.id, rec.errors); continue }
      const m = rec.manifest
      const detail = { ...base, name: m.name.en, description: m.description.en, version: m.version, kind: m.kind, pricing: m.pricing, license: m.license, author: m.author, permissions: m.permissions ?? [], requires: m.requires, extends: [] }
      const why = problem(m)
      if (why !== null) { plugins.push({ ...detail, ...why }); continue }
      let status = base.enabled ? 'ok' : 'disabled'
      for (const e of m.extends) {
        const point = points.get(e.point)
        if (status !== 'ok') { detail.extends.push({ point: e.point, contributions: 0, rejected: [] }); continue }
        const r = readExtension(rec, e, point)
        for (const c of r.contributions) { if (!contributions.has(e.point)) contributions.set(e.point, []); contributions.get(e.point).push(c) }
        detail.extends.push({ point: e.point, contributions: r.contributions.length, rejected: r.rejected })
        for (const x of r.rejected) warnOnce(rec.id + ':' + x.file, x.errors)
      }
      plugins.push({ ...detail, status })
    }
    cache = { plugins, contributions }
    cachedAt = now()
    return cache
  }
  function warnOnce (key, errors) {
    const line = key + ': ' + errors.join('; ')
    if (warned.has(line)) return
    warned.add(line)
    console.warn('[kybernos-registry] left out: ' + line)
  }

  return {
    version: 1,
    definePoint,
    /** The points owners have defined, without their functions. */
    points: () => [...points.values()].map((p) => ({ id: pointRef(p), owner: p.owner, name: p.name, version: p.version, kind: p.kind, class: p.class, contributions: (load().contributions.get(pointRef(p)) ?? []).length })),
    /** Every plugin folder found, with its status (never throws). */
    plugins: () => { try { return load().plugins.map((p) => ({ ...p })) } catch (e) { return [] } },
    /** What the enabled, valid plugins contribute to one point ("owner/name#point"): `[{ plugin, level, class, file, value }]`. */
    contributions: (ref) => { try { return (load().contributions.get(ref) ?? []).map((c) => ({ ...c })) } catch (e) { return [] } },
    /** Switches a plugin on or off. Returns false for an id nobody installed. */
    setEnabled: (id, on) => {
      if (!OWNER.test(String(id)) || typeof on !== 'boolean') return false
      cache = null
      if (!load().plugins.some((p) => p.id === id)) return false
      const state = readState()
      if (on) state.enabled[id] = true
      else delete state.enabled[id]
      writeState(state)
      cache = null
      emit()
      return true
    },
    /** Forgets the last scan: the next question reads the folder again. */
    refresh: () => { cache = null; emit() },
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
  }
}
