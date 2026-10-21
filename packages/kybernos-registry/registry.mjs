// The plugin registry (docs/dev/plugin-contract.md, sections 5, 6, 14 and 17): reads the Kybernos plugins DSH has installed, checks them, and gives the
// owner of an extension point what they contribute. Pure Node (fs, path), no DSH service: testable on a temp folder.
//
// The installing is DSH's own (its plugin manager: an npm name, a GitHub address, a tarball or a local directory, pnpm in the profile). This registry only
// READS what it left, never installs, never runs, never imports:
//   <profile>/package.json                    `dependencies` (what is installed, and from where) and `dsh.profile.bundles` (what is selected)
//   <profile>/node_modules/<name>/plugin.json the manifest of a Kybernos plugin (a package without one is not ours and is left alone)
//   <package>/<extends[].dir>/*.json          the contributions of a DATA plugin, one file each, checked by the point's own validator
//   <stateFile>                                { consented: { "<id>": true } }: the person has read and accepted the instructions a plugin brings
//
// A data plugin is a DSH bundle whose patch is EMPTY (no entry names a module, so DSH loads no JavaScript), or a plain dependency. Anything that could make
// DSH load or run something of its own (a client entry, an install script, a bin, a patch with entries) makes it invalid. A symbolic link is followed only at
// the top, to the profile's own store or to the folder the person linked (`link:`/`file:`), and never inside a package. A folder that fails any check is
// listed as `invalid` with its reasons and left out; scanning can never throw to the caller.
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { manifestErrors } from './manifest.mjs'
import { compareVersions, satisfies } from './version.mjs'

export const LIMITS = { manifest: 64 * 1024, file: 256 * 1024, files: 32, plugins: 64, perPlugin: 64, profile: 1024 * 1024, patch: 16 * 1024 }
/** What a plugin can be, in the order the card says it: only one is `ok`. */
export const STATUSES = ['ok', 'disabled', 'needs-consent', 'needs-dsh', 'needs-kybernos', 'missing-dependency', 'incompatible-point', 'revoked', 'invalid']

const NPM_NAME = /^(@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,63}$/
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

const readJson = (path, max) => { const r = readBounded(path, max); if (r.error !== undefined) return { error: r.error }; try { return { value: JSON.parse(r.text) } } catch (e) { return { error: 'is not valid JSON' } } }
/** Where a dependency came from: a folder the person pointed at (`file:`, `link:`, a path), or anything DSH fetched (a registry, GitHub, a tarball). */
const sourceOf = (spec) => (/^(file:|link:|\/|\.{1,2}\/)/.test(spec) ? 'local' : 'unlisted')

/**
 * What could make DSH load or run something of a "data" package on its own. Returns the reasons (empty = a data package is what it says).
 * The patch must be an empty list (`[]`, comments allowed): an entry that names a module is code DSH would load. A browser entry, an install script, a
 * command or any other `dsh` key is refused for the same reason.
 */
export function dataPackageProblems (pkg, packageDir) {
  const out = []
  const dsh = plain(pkg.dsh) ? pkg.dsh : {}
  for (const k of Object.keys(dsh)) if (k !== 'bundle') out.push('package.json dsh.' + k + ' would make DSH load code')
  if (plain(dsh.bundle)) {
    for (const k of Object.keys(dsh.bundle)) if (k !== 'patch') out.push('package.json dsh.bundle.' + k + ' is not allowed in a data plugin')
    if (typeof dsh.bundle.patch === 'string') {
      if (!/^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]{1,120}$/.test(dsh.bundle.patch)) out.push('dsh.bundle.patch is not a path inside the package')
      else {
        const r = readBounded(join(packageDir, dsh.bundle.patch), LIMITS.patch)
        if (r.error !== undefined) out.push('the patch ' + r.error)
        else if (r.text.replace(/#[^\n]*/g, '').replace(/\s+/g, '') !== '[]' && r.text.replace(/#[^\n]*/g, '').trim() !== '') out.push('the patch names modules DSH would load: a data plugin has an empty patch')
      }
    } else if (dsh.bundle.patch !== undefined) out.push('dsh.bundle.patch is not a path')
  }
  if (plain(pkg.scripts)) for (const k of ['preinstall', 'install', 'postinstall', 'prepare']) if (pkg.scripts[k] !== undefined) out.push('package.json scripts.' + k + ' would run on install')
  if (pkg.bin !== undefined) out.push('package.json bin would put a command on the path')
  return out
}

/**
 * The Kybernos plugins DSH installed in `profileDir`, as records `{ id, package, spec, source, level, selected, hasBundle, folder, manifest, errors, info }`.
 * `manifest` is set only when the manifest and the package passed every check. A package without a `plugin.json` is not a Kybernos plugin: it is not listed.
 */
export function scanProfile (profileDir) {
  const records = []
  const read = readJson(join(profileDir, 'package.json'), LIMITS.profile)
  if (read.error !== undefined || !plain(read.value)) return records
  const deps = plain(read.value.dependencies) ? read.value.dependencies : {}
  const bundles = Array.isArray(read.value.dsh?.profile?.bundles) ? read.value.dsh.profile.bundles : []
  for (const name of Object.keys(deps).sort()) {
    if (records.length >= LIMITS.plugins) break
    if (!NPM_NAME.test(name) || name.startsWith('@local/') || name.startsWith('@deepseek-ai/')) continue // our own modules and the engine's are not plugins of this kind
    const rec = readPackage(profileDir, name, typeof deps[name] === 'string' ? deps[name] : '', bundles.includes(name))
    if (rec !== null) records.push(rec)
  }
  return records
}

function readPackage (profileDir, name, spec, selected) {
  const modules = join(profileDir, 'node_modules')
  const link = join(modules, ...name.split('/'))
  if (lstat(link) === null) return null
  const source = sourceOf(spec)
  const rec = { id: null, package: name, spec: tidy(spec, 120), source, level: source === 'local' ? 'local' : 'unlisted', selected, hasBundle: false, folder: link, manifest: null, errors: [], info: {} }
  let real
  try { real = realpathSync(link) } catch (e) { return null }
  let store
  try { store = realpathSync(modules) } catch (e) { return null }
  // pnpm links an installed package into its store (inside node_modules); only a folder the person deliberately linked may lead anywhere else
  if (!real.startsWith(store + sep) && source !== 'local') { rec.id = name; rec.errors.push('resolves outside the profile'); return rec }
  const m = readBounded(join(real, 'plugin.json'), LIMITS.manifest)
  if (m.error === 'is missing') return null // not a Kybernos plugin
  rec.id = name
  if (m.error !== undefined) { rec.errors.push('plugin.json ' + m.error); return rec }
  let raw
  try { raw = JSON.parse(m.text) } catch (e) { rec.errors.push('plugin.json is not valid JSON'); return rec }
  if (!plain(raw)) { rec.errors.push('plugin.json is not an object'); return rec }
  if (typeof raw.id === 'string' && OWNER.test(raw.id)) rec.id = raw.id
  rec.info = { name: tidy(raw.name?.en, 40), version: tidy(raw.version, 40) }
  const pj = readJson(join(real, 'package.json'), LIMITS.manifest)
  const pkg = pj.error === undefined && plain(pj.value) ? pj.value : null
  rec.hasBundle = pkg !== null && plain(pkg.dsh?.bundle) && pkg.dsh.bundle.patch !== undefined
  const errors = manifestErrors(raw, { local: source === 'local', ...(raw.kind === 'code' && pkg !== null ? { packageJson: pkg } : {}) })
  if (errors.length === 0) {
    if (raw.kind === 'data') errors.push(...(pkg === null ? ['package.json ' + (pj.error ?? 'is not an object')] : dataPackageProblems(pkg, real)))
    else if (pkg !== null && pkg.name !== name) errors.push('the package is "' + String(pkg.name) + '" but was installed as "' + name + '"')
  }
  rec.errors = errors.slice(0, 8)
  if (errors.length === 0) rec.manifest = raw
  return rec
}

const pointRef = (def) => def.owner + '#' + def.name

/**
 * @param {object} o
 * @param {string} o.profileDir     the DSH profile whose installed packages are read (<DSH home>/profiles/web)
 * @param {string} o.stateFile      where the person's acceptances are kept
 * @param {string|null} [o.kybernosVersion]   the suite's version, when known (`requires.kybernos` is not enforced without it)
 * @param {string|null} [o.dshVersion]        DSH's version, when known (`requires.dsh` is not enforced without it)
 * @param {number} [o.ttlMs]        how long a scan is reused (a folder dropped in shows up after at most this long)
 * @param {() => number} [o.now]
 */
export function createRegistry ({ profileDir, stateFile, kybernosVersion = null, dshVersion = null, ttlMs = 2000, now = Date.now }) {
  const points = new Map()
  const listeners = new Set()
  let cache = null
  let cachedAt = 0
  const warned = new Set()

  const readState = () => {
    const r = readBounded(stateFile, 64 * 1024)
    if (r.error !== undefined) return { consented: {} }
    try {
      const j = JSON.parse(r.text)
      const consented = {}
      if (plain(j) && plain(j.consented)) for (const [k, v] of Object.entries(j.consented)) if (OWNER.test(k) && v === true) consented[k] = true
      return { consented }
    } catch (e) { return { consented: {} } }
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
    if (m.kind === 'data') {
      for (const e of m.extends ?? []) {
        const p = points.get(e.point)
        if (p === undefined) return { status: 'missing-dependency', reason: 'extends ' + e.point + ', which is not available' }
        if (!satisfies(p.version + '.0', e.range)) return { status: 'incompatible-point', reason: e.point + ' is version ' + p.version + ', this plugin wants ' + e.range }
      }
    }
    return null
  }

  /** The contributions of one extension: the files of its folder, each through the point's validator. */
  function readExtension (rec, ext, point) {
    const out = { contributions: [], rejected: [] }
    if (ext.dir === undefined) return out
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
      if (v !== null && typeof v === 'object' && v.ok === true) out.contributions.push({ plugin: rec.id, level: rec.level, class: point.class, file: ext.dir + '/' + f, value: v.value })
      else out.rejected.push({ file: f, errors: Array.isArray(v?.errors) ? v.errors.slice(0, 6).map((x) => tidy(String(x), 200)) : ['was refused'] })
    }
    return out
  }

  function load () {
    if (cache !== null && now() - cachedAt < ttlMs) return cache
    const state = readState()
    const plugins = []
    const contributions = new Map()
    const seen = new Map()
    for (const rec of scanProfile(profileDir)) {
      // A plain dependency has no switch in DSH: it is on. A bundle is on when DSH has it selected (the person's own switch in DSH's plugin page).
      const on = rec.hasBundle ? rec.selected : true
      if (rec.manifest !== null && seen.has(rec.id)) { rec.manifest = null; rec.errors = ['the id "' + rec.id + '" is already provided by the package "' + seen.get(rec.id) + '"'] }
      const base = { id: rec.id, package: rec.package, spec: rec.spec, source: rec.source, level: rec.level, enabled: on, consented: state.consented[rec.id] === true, errors: rec.errors, name: rec.info.name || rec.package, version: rec.info.version || null }
      if (rec.manifest === null) { plugins.push({ ...base, status: 'invalid', reason: rec.errors[0] ?? 'cannot be read', extends: [] }); warnOnce(rec.package, rec.errors); continue }
      seen.set(rec.id, rec.package)
      const m = rec.manifest
      const detail = { ...base, description: m.description.en, name: m.name.en, kind: m.kind, version: m.version, pricing: m.pricing, license: m.license, author: m.author, permissions: m.permissions ?? [], requires: m.requires, extends: [] }
      const why = problem(m)
      if (why !== null) { plugins.push({ ...detail, ...why }); continue }
      // What the person has to accept before an instruction reaches their agents: any point of the instruction class this plugin contributes to.
      const brings = m.kind === 'data' && m.extends.some((e) => points.get(e.point)?.class === 'instruction')
      const status = !on ? 'disabled' : brings && !base.consented ? 'needs-consent' : 'ok'
      for (const e of m.extends ?? []) {
        if (status !== 'ok' || m.kind !== 'data') { detail.extends.push({ point: e.point, contributions: 0, rejected: [] }); continue }
        const r = readExtension({ ...rec, folder: rec.folder }, e, points.get(e.point))
        for (const c of r.contributions) { if (!contributions.has(e.point)) contributions.set(e.point, []); contributions.get(e.point).push(c) }
        detail.extends.push({ point: e.point, contributions: r.contributions.length, rejected: r.rejected })
        for (const x of r.rejected) warnOnce(rec.package + ':' + x.file, x.errors)
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
    /** Every Kybernos plugin DSH has installed, with its status (never throws). */
    plugins: () => { try { return load().plugins.map((p) => ({ ...p })) } catch (e) { return [] } },
    /** What the enabled, valid plugins contribute to one point ("owner/name#point"): `[{ plugin, level, class, file, value }]`. */
    contributions: (ref) => { try { return (load().contributions.get(ref) ?? []).map((c) => ({ ...c })) } catch (e) { return [] } },
    /** Records that the person has read and accepted (or withdrawn) what a plugin brings. Returns false for an id nobody installed. Switching a plugin on or off is DSH's. */
    setConsent: (id, accepted) => {
      if (!OWNER.test(String(id)) || typeof accepted !== 'boolean') return false
      cache = null
      if (!load().plugins.some((p) => p.id === id && p.status !== 'invalid')) return false
      const state = readState()
      if (accepted) state.consented[id] = true
      else delete state.consented[id]
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
