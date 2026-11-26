// Plugin conformance check (docs/dev/plugin-contract.md, section 11): one report, the same checks for the
// modules of this repository and for a stranger's folder, and it never repairs anything.
//
//   node scripts/plugin-check.mjs <folder>
//
// exit 0 = no FAIL, exit 1 = at least one FAIL, exit 2 = usage (no argument, two arguments, a path that does
// not exist, a file). The page it documents is docs/dev/sector-bundles.md ("Build a theme").
//
// Read-only by construction: it reads the folder, the manifest schema and its rules (scripts/plugin-manifest.mjs
// on scripts/schema-subset.mjs), the registry's data-package rules (packages/kybernos-registry/registry.mjs), the
// owners' own point validators, the grep-level scan (scripts/plugin-scan.mjs) and the repository guard's file
// rules (scripts/garde-depot.mjs). It imports no file of the checked folder, it makes no request, and it changes
// nothing on disk: two runs on the same folder print the same bytes. Every check id below is owned by this tool
// and is the closed vocabulary the page and the fixtures name (contract sentence 3 of the batch):
//
//   manifest.present, manifest.json, manifest.schema, manifest.rules, manifest.points, package.data,
//   point.<point-name> (one per extends, in manifest order), code.scan, claims.unique, help.card,
//   compat.zone, hygiene, archive
//
// What it does not do, said here so no reader invents it: archives are not read (phase B: signed archive and
// hashes), a folder point is checked from the files it ships and never against a host, and the hygiene pass
// sees what scripts/garde-depot.mjs exports - a secret-looking FILE NAME is that module's private rule and is
// therefore not covered here (docs/dev/sector-bundles.md, "Not built").
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, validate } from './schema-subset.mjs'
import { SCHEMA_FILE, manifestErrors } from './plugin-manifest.mjs'
import { DOMAIN_POINT, TEAM_POINT, AUTOMATION_POINT } from '../packages/kybernos-plugin/domain-pack.mjs'
import { THEME_POINT } from '../packages/kybernos-theme/themes-catalogue.mjs'
import { validateTeamSkill } from '../packages/kybernos-skills/team-skills.mjs'
import { PRESET_POINT } from '../packages/kybernos-dashboards/preset-point.mjs'
import { DB_TEMPLATE_POINT } from '../packages/kybernos-db/template.mjs'
import { LIMITS, dataPackageProblems, readBounded } from '../packages/kybernos-registry/registry.mjs'
import { compareVersions, satisfies } from '../packages/kybernos-registry/version.mjs'
import { scanText, uncovered } from './plugin-scan.mjs'
import { isScanned, isThemeCover, looksLikeJpeg, warningsOf } from './garde-depot.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = resolve(REPO, 'packages')
const SCHEMA = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'))
/** The most messages one line prints: a validator's list is bounded, so the report cannot run away. */
const MAX_ERRORS = 6
/** The biggest text file the scan opens: the repository guard's own cap (scripts/garde-depot.mjs), so a module's client.js is read and a picture is not. */
const MAX_TEXT_BYTES = 4 * 1024 * 1024
/** The column the check ids are padded to, as the frozen sample of the batch prints them. */
const ID_COLUMN = 20

const tidy = (v, max = 200) => (typeof v === 'string' ? Array.from(v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim()).slice(0, max).join('') : '')
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const lstat = (path) => { try { return lstatSync(path) } catch (e) { return null } }
const readJsonBounded = (file, max) => {
  const r = readBounded(file, max)
  if (r.error !== undefined) return { error: r.error }
  try { return { value: JSON.parse(r.text) } } catch (e) { return { error: 'is not valid JSON' } }
}

// ── the point table: what the repository declares, joined with the validator its owner exports ────────────────
/**
 * The owners that export a point object (the core, the theme styles, the dashboards and the databases), and the skills owner, which exports its RULES but not its point
 * object (SKILL_POINT stays module-private in packages/kybernos-skills/index.js). The four-line adapter below is
 * the shape wrapper that file applies, never a second copy of the rules.
 */
const validateSkillContribution = (contribution) => {
  const r = validateTeamSkill(contribution)
  if (r.ok === true) return { ok: true, value: { name: contribution.name, version: r.version, files: contribution.files.map((f) => f.path), description: r.description } }
  return { ok: false, errors: [r.reason + (r.file === undefined ? '' : ': ' + r.file)] }
}
export const OWNER_VALIDATORS = {
  'kybernos/core#domain-pack': DOMAIN_POINT.validate,
  'kybernos/theme#theme': THEME_POINT.validate,
  'kybernos/core#team-template': TEAM_POINT.validate,
  'kybernos/core#automation-template': AUTOMATION_POINT.validate,
  'kybernos/skills#skill': validateSkillContribution,
  'kybernos/dashboards#preset': PRESET_POINT.validate,
  'kybernos/db#template': DB_TEMPLATE_POINT.validate,
}

/**
 * The points this repository declares, from `packages/<dir>/plugin.json` `provides[]` (the declaration of
 * record, `packages/kybernos-plugin/test-domain-pack.mjs`), each joined with the validator its owner exports.
 * A declared point no owner exports a validator for stays in the table with `validate: null`, so the report can
 * say SKIP and why instead of pretending.
 * @returns {Map<string, { ref: string, owner: string, version: string, files: string, validate: Function|null }>}
 */
export function declaredPoints (repo = REPO) {
  const out = new Map()
  let dirs = []
  try { dirs = readdirSync(join(repo, 'packages')).sort() } catch (e) { return out }
  for (const dir of dirs) {
    const r = readJsonBounded(join(repo, 'packages', dir, 'plugin.json'), LIMITS.manifest)
    if (r.error !== undefined || !plain(r.value)) continue
    const owner = typeof r.value.id === 'string' ? r.value.id : null
    if (owner === null || !Array.isArray(r.value.provides)) continue
    for (const p of r.value.provides) {
      if (!plain(p) || typeof p.name !== 'string') continue
      const ref = owner + '#' + p.name
      if (out.has(ref)) continue
      out.set(ref, { ref, owner, version: typeof p.version === 'string' ? p.version : '0.0', files: p.files === 'folder' ? 'folder' : 'json', validate: OWNER_VALIDATORS[ref] || null })
    }
  }
  return out
}

// ── one folder, walked once ────────────────────────────────────────────────────────────────────────────────────
const SKIP_DIR = /^(node_modules|\.git)$/
const TEST_FILE = /^(test|check)[-_.]|\.test\.m?js$|^lib-.*test/
const PAGE_DIR = /(^|\/)(client|src|widget|technique)\//

/** Every file of the plugin, relative to its root: the root files and the folders its `extends` name, never another one. */
export function pluginTree (folder, declared) {
  const files = []
  const walk = (base, prefix) => {
    let entries = []
    try { entries = readdirSync(base).sort() } catch (e) { return }
    for (const entry of entries) {
      const rel = prefix === '' ? entry : prefix + '/' + entry
      const path = join(base, entry)
      const st = lstat(path)
      if (st === null) continue
      if (st.isSymbolicLink()) { files.push({ rel, size: 0, link: true }); continue }
      if (st.isDirectory()) { if (!SKIP_DIR.test(entry)) walk(path, rel); continue }
      if (st.isFile()) files.push({ rel, size: st.size })
    }
  }
  for (const entry of readdirSync(folder).sort()) {
    if (SKIP_DIR.test(entry)) continue
    const st = lstat(join(folder, entry))
    if (st === null) continue
    if (st.isSymbolicLink()) { files.push({ rel: entry, size: 0, link: true }); continue }
    if (st.isDirectory()) { if (declared.indexOf(entry) >= 0) walk(join(folder, entry), entry); continue }
    if (st.isFile()) files.push({ rel: entry, size: st.size })
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return files
}

/** The immediate sub-folders of the folder that no `extends` names: a folder is not a check, so the report says SKIP and its name. */
export function unknownFolders (folder, declared) {
  const out = []
  let entries = []
  try { entries = readdirSync(folder).sort() } catch (e) { return out }
  for (const entry of entries) {
    if (SKIP_DIR.test(entry) || declared.indexOf(entry) >= 0) continue
    const st = lstat(join(folder, entry))
    if (st !== null && st.isDirectory()) out.push(entry)
  }
  return out
}

/** A folder contribution read whole: `{ name, files: [{ path, content }] }`, or `{ name, errors }`. The bounds are the registry's. */
function readContribution (base, name) {
  const files = []
  const errors = []
  let bytes = 0
  let stop = false
  const walk = (dir, prefix, depth) => {
    let entries = []
    try { entries = readdirSync(dir).sort() } catch (e) { errors.push(prefix + 'cannot be listed'); stop = true; return }
    for (const entry of entries) {
      if (stop || errors.length >= MAX_ERRORS) { stop = true; return }
      const rel = prefix + entry
      const path = join(dir, entry)
      const st = lstat(path)
      if (st === null) continue
      if (st.isSymbolicLink()) { errors.push(rel + ' is a symbolic link'); continue }
      if (st.isDirectory()) {
        if (depth >= LIMITS.folderDepth) { errors.push(rel + ' is deeper than ' + LIMITS.folderDepth + ' folders'); continue }
        walk(path, rel + '/', depth + 1)
        continue
      }
      if (!st.isFile()) { errors.push(rel + ' is not a file'); continue }
      if (files.length >= LIMITS.folderFiles) { errors.push('holds more than ' + LIMITS.folderFiles + ' files'); stop = true; return }
      const r = readBounded(path, LIMITS.file)
      if (r.error !== undefined) { errors.push(rel + ' ' + r.error); continue }
      bytes += Buffer.byteLength(r.text, 'utf8')
      if (bytes > LIMITS.folderBytes) { errors.push('holds more than ' + Math.round(LIMITS.folderBytes / 1024) + ' KiB of files'); stop = true; return }
      files.push({ path: rel, content: r.text })
    }
  }
  walk(join(base, name), '', 1)
  if (errors.length > 0) return { name, errors }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { name, files }
}

// ── the checks, one line each ─────────────────────────────────────────────────────────────────────────────────
const line = (id, status, message) => ({ id, status, message })
const errorsOf = (v) => (plain(v) && Array.isArray(v.errors) ? v.errors.slice(0, MAX_ERRORS).map((x) => tidy(String(x))).join('; ') : 'was refused')

/** The context a manifest is judged in: the first-party one of scripts/test-layout.mjs for a module here, an outsider's for a folder. */
export function contextOf (folder) {
  const real = resolve(folder)
  if (dirname(real) === PACKAGES) {
    let zone = null
    try { zone = JSON.parse(readFileSync(join(REPO, 'dsh-compat.json'), 'utf8')).dsh } catch (e) { zone = null }
    const pj = readJsonBounded(join(folder, 'package.json'), LIMITS.manifest)
    return { firstParty: true, dir: basename(real), suiteZone: zone === undefined ? null : zone, packageJson: pj.error === undefined && plain(pj.value) ? pj.value : undefined, fileExists: (rel) => existsSync(join(folder, rel)) }
  }
  return {}
}

/** `package.data`: a data package says nothing that could make DSH load or run it. */
function packageDataLine (folder, raw) {
  if (!plain(raw) || raw.kind !== 'data') return line('package.data', 'SKIP', 'a code module: its package.json is what DSH loads, and the lifecycle robot checks it')
  const pj = readJsonBounded(join(folder, 'package.json'), LIMITS.manifest)
  if (pj.error !== undefined) return line('package.data', 'FAIL', 'package.json ' + pj.error + ': a data plugin needs one')
  if (!plain(pj.value)) return line('package.data', 'FAIL', 'package.json is not an object')
  const problems = dataPackageProblems(pj.value, folder)
  if (problems.length > 0) return line('package.data', 'FAIL', problems.slice(0, MAX_ERRORS).map((x) => tidy(x)).join(' | '))
  return line('package.data', 'PASS', 'no code to load, no install script, no bin')
}

/** `manifest.points`: every extended point is opened by an owner, at a version the declared range accepts. */
function pointsLine (raw, points) {
  const extendsList = plain(raw) && Array.isArray(raw.extends) ? raw.extends : []
  if (!plain(raw) || (raw.kind !== 'data' && extendsList.length === 0)) return line('manifest.points', 'SKIP', 'no extends: a code module contributes nothing to a point')
  const opened = []
  const owners = []
  const refused = []
  for (const ext of extendsList) {
    const ref = plain(ext) && typeof ext.point === 'string' ? ext.point : ''
    const point = points.get(ref)
    if (point === undefined) { refused.push('extends "' + tidy(ref, 120) + '": no module of this repository opens it'); continue }
    const range = plain(ext) && typeof ext.range === 'string' ? ext.range : ''
    if (!satisfies(point.version + '.0', range)) { refused.push('extends "' + tidy(ref, 120) + '" ' + tidy(range, 20) + ': the owner is at ' + point.version); continue }
    opened.push(ref)
    if (owners.indexOf(point.owner) < 0) owners.push(point.owner)
  }
  if (refused.length > 0) return line('manifest.points', 'FAIL', refused.slice(0, MAX_ERRORS).join(' | '))
  const plugins = plain(raw.requires) && plain(raw.requires.plugins) ? raw.requires.plugins : {}
  const covered = owners.every((owner) => owner === raw.id || typeof plugins[owner] === 'string')
  return line('manifest.points', 'PASS', 'extends ' + extendsList.length + ' points, every one opened, ranges satisfied' + (covered ? ', requires.plugins covers their owners' : ''))
}

/** One `point.<name>` line per `extends`, in manifest order. */
function pointLines (folder, raw, points) {
  const out = []
  const extendsList = plain(raw) && Array.isArray(raw.extends) ? raw.extends : []
  for (const ext of extendsList) {
    if (!plain(ext) || typeof ext.point !== 'string') continue
    const ref = ext.point
    const id = 'point.' + (ref.indexOf('#') >= 0 ? ref.slice(ref.indexOf('#') + 1) : ref)
    const point = points.get(ref)
    // An unopened point already failed manifest.points: no check is named after a point that does not exist.
    if (point === undefined) continue
    if (typeof point.validate !== 'function') { out.push(line(id, 'SKIP', ref + ' is opened, but its validator is not importable from here: checked when the plugin is installed')); continue }
    const dir = typeof ext.dir === 'string' ? ext.dir : null
    if (dir === null || dir === '') { out.push(line(id, 'SKIP', 'extends ' + ref + ' without a dir: nothing to read')); continue }
    const target = resolve(folder, dir)
    if (target !== resolve(folder) && !target.startsWith(resolve(folder) + sep)) { out.push(line(id, 'FAIL', tidy(dir, 80) + ': the folder escapes the plugin')); continue }
    const st = lstat(target)
    if (st === null) { out.push(line(id, 'SKIP', dir + '/: no such folder, nothing contributed (the registry reports it when the plugin is installed)')); continue }
    if (st.isSymbolicLink() || !st.isDirectory()) { out.push(line(id, 'FAIL', tidy(dir, 80) + ': not a folder')); continue }
    let entries = []
    try { entries = readdirSync(target).sort() } catch (e) { out.push(line(id, 'FAIL', dir + '/ cannot be listed')); continue }
    if (point.files === 'folder') { out.push(folderPointLine(id, target, dir, entries, point)); continue }
    const names = entries.filter((f) => /\.json$/.test(f))
    if (names.length === 0) { out.push(line(id, 'SKIP', dir + '/: no .json file, nothing contributed')); continue }
    const failures = []
    const kept = []
    for (const file of names) {
      const r = readBounded(join(target, file), LIMITS.file)
      if (r.error !== undefined) { failures.push(dir + '/' + file + ': ' + r.error); continue }
      let rawContribution = null
      try { rawContribution = JSON.parse(r.text) } catch (e) { failures.push(dir + '/' + file + ': is not valid JSON'); continue }
      let v = null
      try { v = point.validate(rawContribution, file.replace(/\.json$/, '')) } catch (e) { v = { ok: false, errors: ['the check itself failed'] } }
      if (plain(v) && v.ok === true) kept.push(dir + '/' + file)
      else failures.push(dir + '/' + file + ': ' + errorsOf(v))
    }
    out.push(failures.length > 0 ? line(id, 'FAIL', failures.join(' | ')) : line(id, 'PASS', kept.join(', ')))
  }
  return out
}

/** A folder point (one immediate sub-folder per contribution): each folder is kept whole or refused whole. */
function folderPointLine (id, target, dir, entries, point) {
  const folders = []
  const failures = []
  for (const entry of entries) {
    const st = lstat(join(target, entry))
    if (st === null) continue
    if (st.isSymbolicLink()) { failures.push(dir + '/' + tidy(entry, 80) + ' is a symbolic link'); continue }
    if (!st.isDirectory()) continue
    folders.push(entry)
  }
  if (folders.length > 0) {
    const kept = []
    for (const name of folders) {
      const contribution = readContribution(target, name)
      if (contribution.errors !== undefined) { failures.push(dir + '/' + name + ': ' + contribution.errors.slice(0, MAX_ERRORS).join('; ')); continue }
      let v = null
      try { v = point.validate(contribution, name) } catch (e) { v = { ok: false, errors: ['the check itself failed'] } }
      if (plain(v) && v.ok === true) kept.push(dir + '/' + name)
      else failures.push(dir + '/' + name + ': ' + errorsOf(v))
    }
    if (failures.length > 0) return line(id, 'FAIL', failures.join(' | '))
    return line(id, 'PASS', kept.join(', '))
  }
  if (failures.length > 0) return line(id, 'FAIL', failures.join(' | '))
  return line(id, 'SKIP', dir + '/: no folder, nothing contributed')
}

/** `code.scan`: the grep-level scan of the folder's own .js, held to the permissions the manifest declares. */
function codeLine (folder, tree, raw) {
  const host = []
  const page = []
  for (const f of tree) {
    if (!/\.m?js$/.test(f.rel) || TEST_FILE.test(basename(f.rel)) || /\.min\.js$/.test(f.rel) || f.link === true) continue
    const text = readText(folder, f)
    if (text === null) continue
    if (PAGE_DIR.test(f.rel) || (f.rel.endsWith('.js') && basename(f.rel) !== 'index.js')) page.push({ rel: f.rel, text })
    else host.push({ rel: f.rel, text })
  }
  if (host.length + page.length === 0) return line('code.scan', 'PASS', 'no .js in the folder: nothing to declare')
  const permissions = plain(raw) && Array.isArray(raw.permissions) ? raw.permissions.filter((p) => typeof p === 'string') : []
  const gaps = uncovered(scanText({ host, page }), permissions)
  if (gaps.length > 0) return line('code.scan', 'FAIL', gaps.slice(0, MAX_ERRORS).join(' | '))
  return line('code.scan', 'PASS', 'the declarations cover what the scan sees')
}

/** `claims.unique`: a claim is made once, and by one module. */
function claimsLine (raw) {
  const claims = plain(raw) && plain(raw.claims) ? raw.claims : null
  const own = []
  if (claims !== null) for (const key of ['cssPrefix', 'routePrefixes', 'slotIds']) {
    const v = claims[key]
    for (const x of Array.isArray(v) ? v : typeof v === 'string' ? [v] : []) if (typeof x === 'string') own.push([key, x])
  }
  if (own.length === 0) return line('claims.unique', 'SKIP', 'not applicable: a data theme declares no CSS prefix, route or slot')
  const seen = new Set()
  for (const [key, x] of own) {
    if (seen.has(key + ' ' + x)) return line('claims.unique', 'FAIL', 'claims.' + key + ' lists "' + tidy(x, 80) + '" twice')
    seen.add(key + ' ' + x)
  }
  let dirs = []
  try { dirs = readdirSync(PACKAGES).sort() } catch (e) { dirs = [] }
  let others = 0
  for (const dir of dirs) {
    const r = readJsonBounded(join(PACKAGES, dir, 'plugin.json'), LIMITS.manifest)
    if (r.error !== undefined || !plain(r.value)) continue
    if (r.value.id === raw.id) continue // the folder being checked, whether it is that module or a copy of it
    others += 1
    if (!plain(r.value.claims)) continue
    for (const [key, x] of own) {
      const theirs = r.value.claims[key]
      for (const y of Array.isArray(theirs) ? theirs : typeof theirs === 'string' ? [theirs] : []) {
        if (y === x) return line('claims.unique', 'FAIL', 'claims.' + key + ' "' + tidy(x, 80) + '" is also claimed by ' + tidy(String(r.value.id), 80))
      }
    }
  }
  return line('claims.unique', 'PASS', own.length + ' claim(s), unique among ' + others + ' other declared module(s)')
}

/** `help.card`: the file the manifest names is there (its content belongs to test-help-card.mjs). */
function helpLine (folder, raw) {
  const rel = plain(raw) && typeof raw.help === 'string' ? raw.help : ''
  if (rel === '') return line('help.card', 'SKIP', 'not a module of the Suite (no help key)')
  const r = readBounded(join(folder, rel), LIMITS.manifest)
  if (r.error === 'is missing') return line('help.card', 'FAIL', tidy(rel, 80) + ' is missing')
  if (r.error !== undefined) return line('help.card', 'FAIL', tidy(rel, 80) + ' ' + r.error)
  return line('help.card', 'PASS', tidy(rel, 80) + ' present (what it says is test-help-card.mjs)')
}

/** `compat.zone`: a plugin's DSH zone lies inside the suite's. */
function compatLine (raw) {
  const zone = plain(raw) && plain(raw.requires) && plain(raw.requires.dsh) ? raw.requires.dsh : null
  if (zone === null) return line('compat.zone', 'SKIP', plain(raw) && raw.kind === 'data' ? 'no requires.dsh in a data theme' : 'no requires.dsh: a module of the Suite lives inside the suite zone (dsh-compat.json)')
  let suite = null
  try { suite = JSON.parse(readFileSync(join(REPO, 'dsh-compat.json'), 'utf8')).dsh } catch (e) { suite = null }
  const min = typeof zone.min === 'string' ? zone.min : ''
  const max = typeof zone.max === 'string' ? zone.max : ''
  const inside = suite !== null && typeof suite.min === 'string' && typeof suite.max === 'string' && min !== '' && max !== '' && compareVersions(min, max) <= 0 && compareVersions(min, suite.min) >= 0 && compareVersions(max, suite.max) <= 0
  if (inside) return line('compat.zone', 'PASS', 'requires.dsh ' + tidy(min, 20) + ' to ' + tidy(max, 20) + ' lies inside the suite zone')
  return line('compat.zone', 'FAIL', 'requires.dsh ' + tidy(min, 20) + ' to ' + tidy(max, 20) + ' lies outside the suite zone of dsh-compat.json')
}

/** The text of one file of the tree, or null: a link, a file over the guard's cap or an unreadable file is not text. */
function readText (folder, f) {
  if (f.size > MAX_TEXT_BYTES) return null
  try { return readFileSync(join(folder, f.rel), 'utf8') } catch (e) { return null }
}

/** `hygiene`: what the repository guard refuses or warns about, refused here for a bundle a stranger installs. */
function hygieneLine (folder, tree) {
  const problems = []
  let cover = false
  for (const f of tree) {
    if (f.link === true) { problems.push(f.rel + ' is a symbolic link'); continue }
    if (isThemeCover(f.rel, f.size)) {
      // the one picture a theme may carry: its cover, a small JPEG
      let head = Buffer.alloc(0)
      try { head = readFileSync(join(folder, f.rel)).subarray(0, 3) } catch (e) { head = Buffer.alloc(0) }
      if (!looksLikeJpeg(head)) problems.push('cover.jpg is not a JPEG')
      else cover = true
      continue
    }
    if (!isScanned(f.rel, f.size)) { problems.push('a file the repository guard does not read (media but a small cover.jpg, a lock file, vendored code or over 4 MB): ' + f.rel); continue }
    const text = readText(folder, f)
    if (text === null) { problems.push(f.rel + ' cannot be read'); continue }
    for (const w of warningsOf(f.rel, text)) problems.push(w)
  }
  if (problems.length > 0) return line('hygiene', 'FAIL', problems.slice(0, MAX_ERRORS).join(' | '))
  return line('hygiene', 'PASS', tree.length + ' files, no media' + (cover ? ' but its cover picture' : '') + ', no personal path')
}

function headerOf (raw) {
  return {
    id: plain(raw) && typeof raw.id === 'string' ? raw.id : '?',
    version: plain(raw) && typeof raw.version === 'string' ? raw.version : '?',
    kind: plain(raw) && typeof raw.kind === 'string' ? raw.kind : '?',
    points: plain(raw) && Array.isArray(raw.extends) ? raw.extends.length : 0,
    pricing: plain(raw) && (raw.pricing === 'free' || raw.pricing === 'paid') ? raw.pricing : '?',
  }
}

/**
 * The whole report of one folder. Reads only: no change on disk, no request, no import of the folder.
 * @param {string} folder        the folder to check, as the person typed it
 * @param {object} [opts]
 * @param {Map} [opts.points]    the point table (`declaredPoints()` by default; the test injects one to exercise the SKIP path)
 * @returns {{ label: string, header: object|null, lines: object[], pass: number, fail: number, skip: number, exitCode: number }}
 */
export function checkFolder (folder, opts = {}) {
  const label = String(folder).replace(/[\\/]+$/, '') || String(folder)
  const points = opts.points === undefined ? declaredPoints() : opts.points
  const lines = []
  const done = (header, list) => ({ label, header, lines: list, pass: list.filter((l) => l.status === 'PASS').length, fail: list.filter((l) => l.status === 'FAIL').length, skip: list.filter((l) => l.status === 'SKIP').length, exitCode: list.some((l) => l.status === 'FAIL') ? 1 : 0 })
  const tail = (raw) => {
    const declared = plain(raw) && Array.isArray(raw.extends) ? raw.extends.filter((e) => plain(e) && typeof e.dir === 'string' && e.dir !== '').map((e) => e.dir.split('/')[0]) : []
    const tree = pluginTree(folder, declared)
    const list = [codeLine(folder, tree, raw), claimsLine(raw), helpLine(folder, raw), compatLine(raw), hygieneLine(folder, tree), line('archive', 'SKIP', 'not built (phase B: signed archive and hashes)')]
    if (plain(raw) && raw.kind === 'data') for (const name of unknownFolders(folder, declared)) list.push(line(name + '/', 'SKIP', 'not declared by extends; not part of the plugin'))
    return list
  }

  const man = readBounded(join(folder, 'plugin.json'), LIMITS.manifest)
  if (man.error !== undefined) return done(null, [line('manifest.present', 'FAIL', 'plugin.json ' + man.error)])
  lines.push(line('manifest.present', 'PASS', 'plugin.json found'))
  let raw = null
  try { raw = JSON.parse(man.text) } catch (e) { return done(null, lines.concat([line('manifest.json', 'FAIL', 'plugin.json is not valid JSON')])) }
  lines.push(line('manifest.json', 'PASS', 'plugin.json is valid JSON'))
  const shape = describe(validate(SCHEMA, raw))
  if (shape.length > 0) {
    // The shape is the premise of the rules and of the point checks: the report says so instead of printing a
    // vacuous PASS, and the checks that read the folder on their own still run.
    lines.push(line('manifest.schema', 'FAIL', shape.slice(0, MAX_ERRORS).map((x) => tidy(x)).join('; ')))
    lines.push(line('manifest.rules', 'SKIP', 'the shape is wrong: the rules assume it'))
    lines.push(line('manifest.points', 'SKIP', 'the shape is wrong: what it extends cannot be read'))
    lines.push(packageDataLine(folder, raw))
    return done(headerOf(raw), lines.concat(tail(raw)))
  }
  lines.push(line('manifest.schema', 'PASS', 'plugin.schema.json, subset interpreter: no fault'))
  const rules = manifestErrors(raw, contextOf(folder))
  if (rules.length > 0) lines.push(line('manifest.rules', 'FAIL', rules.slice(0, MAX_ERRORS).map((x) => tidy(x)).join('; ')))
  else lines.push(line('manifest.rules', 'PASS', 'ids, reserved namespaces, version, claims: no fault'))
  lines.push(pointsLine(raw, points))
  lines.push(packageDataLine(folder, raw))
  return done(headerOf(raw), lines.concat(pointLines(folder, raw, points), tail(raw)))
}

/** The report as text: the same folder always prints the same bytes. */
export function render (result) {
  const out = ['plugin-check v1 — ' + result.label]
  if (result.header !== null) out.push('plugin: ' + result.header.id + ' ' + result.header.version + ' (' + result.header.kind + ', ' + result.header.points + ' points, ' + result.header.pricing + ')')
  const pad = (id) => { const col = id.padEnd(ID_COLUMN); return col + (id.length >= ID_COLUMN ? ' ' : '') }
  for (const l of result.lines) if (l.status !== 'SKIP') out.push('  ' + l.status + '  ' + pad(l.id) + l.message)
  for (const l of result.lines) if (l.status === 'SKIP') out.push('  ' + l.status + '  ' + pad(l.id) + l.message)
  out.push('summary: ' + result.pass + ' pass, ' + result.fail + ' fail, ' + result.skip + ' skip — exit ' + result.exitCode)
  return out.join('\n') + '\n'
}

// ── command line ─────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const usage = 'usage: node scripts/plugin-check.mjs <folder>'
  if (args.length !== 1) { console.error(usage); process.exit(2) }
  const st = lstat(args[0])
  if (st === null || !st.isDirectory()) { console.error(usage); process.exit(2) }
  const result = checkFolder(args[0])
  process.stdout.write(render(result))
  process.exit(result.exitCode)
}
