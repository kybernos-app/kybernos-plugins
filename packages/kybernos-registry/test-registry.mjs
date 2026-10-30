// The registry: what it reads of a DSH profile, the statuses, the contributions, the person's acceptance, and what a hostile package cannot do.
//   node packages/kybernos-registry/test-registry.mjs
// Hermetic: temp folders only. The profile built here has the shape DSH's own plugin manager leaves (checked on a real install, 2026-10-21): package.json with
// `dependencies` and `dsh.profile.bundles`, and node_modules/<name>/ holding the package (a copy for file:, a link into .pnpm for a registry install).
// The point's validator is a stand-in; the real one (domain packs) runs in kybernos-plugin/test-domain-pack.mjs.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIMITS, createRegistry, dataPackageProblems, readBounded, scanProfile } from './registry.mjs'
import { manifestErrors } from './manifest.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const warnings = []
console.warn = (m) => { warnings.push(String(m)) }
let failed = 0
const check = (name, ok, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!ok) failed += 1 }
const write = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data)) }
const rmDir = (path) => { for (const n of readdirSync(path)) unlinkSync(join(path, n)); rmdirSync(path) }

const manifest = (over = {}) => ({
  contract: 1, id: 'acme/vet', kind: 'data', version: '0.1.0',
  name: { en: 'Veterinary clinic' }, description: { en: 'A pack for veterinary clinics.' },
  author: { id: 'acme', name: 'Acme' }, license: 'CC-BY-4.0', pricing: 'free',
  requires: { kybernos: '^0.1', plugins: { 'kybernos/core': '^1.0' } },
  extends: [{ point: 'kybernos/core#domain-pack', range: '^1.0', dir: 'domains' }],
  ...over
})
const pack = (id) => ({ v: 1, id, name: { en: 'Vet' } })
const validate = (raw, fileId) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['a pack is an object'] }
  const extra = Object.keys(raw).filter((k) => !['v', 'id', 'name'].includes(k))
  if (extra.length > 0) return { ok: false, errors: ['unknown key "' + extra[0] + '"'] }
  if (raw.v !== 1 || raw.id !== fileId) return { ok: false, errors: ['v or id'] }
  return { ok: true, value: { v: 1, id: raw.id, name: { en: String(raw.name?.en) } } }
}
const INSTRUCTION = { owner: 'kybernos/core', ownerVersion: '1.0.0', name: 'domain-pack', version: '1.0', kind: 'data', class: 'instruction', validate }
const INERT = { owner: 'kybernos/dashboards', ownerVersion: '1.0.0', name: 'preset', version: '1.0', kind: 'data', class: 'inert', validate }
// A folder point, as a pack ships skills: one folder per skill, `SKILL.md` and the files beside it. The real rules live in kybernos-skills/team-skills.mjs.
const skillEnvelope = (raw, folder) => {
  if (raw === null || typeof raw !== 'object' || raw.name !== folder || !Array.isArray(raw.files)) return { ok: false, errors: ['an envelope { name, files } is expected'] }
  if (raw.name === 'boom') throw new Error('a validator of the test, throwing')
  if (!raw.files.some((f) => f.path === 'SKILL.md')) return { ok: false, errors: ['SKILL.md is missing'] }
  return { ok: true, value: { id: folder, files: raw.files.map((f) => f.path), texts: Object.fromEntries(raw.files.map((f) => [f.path, f.content])) } }
}
const SKILL = { owner: 'kybernos/skills', ownerVersion: '1.0.0', name: 'skill', version: '1.0', kind: 'data', class: 'instruction', files: 'folder', max: 32, validate: skillEnvelope }
const THEME = { owner: 'kybernos/theme', ownerVersion: '1.0.0', name: 'theme', version: '1.0', kind: 'data', class: 'inert', validate }
const TEAM = { owner: 'kybernos/core', ownerVersion: '1.0.0', name: 'team-template', version: '1.0', kind: 'data', class: 'instruction', validate }
const AUTOMATION = { owner: 'kybernos/core', ownerVersion: '1.0.0', name: 'automation-template', version: '1.0', kind: 'data', class: 'instruction', validate }
const DATA_PKG = (name) => ({ name, version: '0.1.0', dsh: { bundle: { patch: './cordis.patch.yml' } } })

/** A DSH profile on disk. `install(name, files, { spec, selected, asLink, outside })` does what `dsh plugin add` leaves. */
const fresh = (opts = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-registry-'))
  const profileDir = join(dir, 'profile')
  mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
  const profile = { dependencies: {}, dsh: { profile: { bundles: [] } } }
  const save = () => writeFileSync(join(profileDir, 'package.json'), JSON.stringify(profile))
  save()
  let clock = 1000
  const registry = createRegistry({ profileDir, stateFile: join(dir, 'plugins-state.json'), kybernosVersion: '0.1.1', ttlMs: 0, now: () => clock++, ...opts })
  registry.definePoint(INSTRUCTION)
  const install = (name, files, { spec = '1.0.0', selected = true, asLink = false, outside = null } = {}) => {
    const real = outside ?? (asLink ? join(profileDir, 'node_modules', '.pnpm', name.replace('/', '+') + '@1.0.0', 'node_modules', name) : join(profileDir, 'node_modules', name))
    for (const [rel, data] of Object.entries(files)) write(join(real, rel), data)
    if (asLink || outside !== null) {
      mkdirSync(dirname(join(profileDir, 'node_modules', name)), { recursive: true })
      symlinkSync(real, join(profileDir, 'node_modules', name))
    }
    profile.dependencies[name] = spec
    if (selected) profile.dsh.profile.bundles.push(name)
    save()
    return real
  }
  const setSelected = (name, on) => { profile.dsh.profile.bundles = profile.dsh.profile.bundles.filter((x) => x !== name); if (on) profile.dsh.profile.bundles.push(name); save() }
  return { dir, profileDir, registry, install, setSelected, stateFile: join(dir, 'plugins-state.json') }
}
const vetFiles = (id = 'vet', over = {}) => ({ 'plugin.json': manifest(over), 'package.json': DATA_PKG('kybernos-plugin-vet'), 'cordis.patch.yml': '# a data plugin: nothing is loaded\n[]\n', 'domains/vet.json': pack(id) })
const get = (reg, id = 'acme/vet') => reg.plugins().find((p) => p.id === id)

console.log('a data plugin DSH installed, end to end')
{
  const { registry, install, setSelected, stateFile } = fresh()
  check('a profile with nothing installed gives an empty list', registry.plugins().length === 0)
  install('kybernos-plugin-vet', vetFiles(), { spec: '^1.0.0' })
  const p = get(registry)
  check('it is found by its manifest, not by its folder: id, package, level, source', p !== undefined && p.package === 'kybernos-plugin-vet' && p.level === 'unlisted' && p.source === 'unlisted' && p.kind === 'data', p)
  check('selected in DSH, but it brings instructions: it waits for the person\'s acceptance and contributes nothing', p.enabled === true && p.status === 'needs-consent' && registry.contributions('kybernos/core#domain-pack').length === 0, p.status)
  check('the person accepts: it is ok and contributes', registry.setConsent('acme/vet', true) === true && get(registry).status === 'ok' && registry.contributions('kybernos/core#domain-pack').length === 1)
  const got = registry.contributions('kybernos/core#domain-pack')[0]
  check('a contribution says where it came from', got.plugin === 'acme/vet' && got.level === 'unlisted' && got.class === 'instruction' && got.file === 'domains/vet.json' && got.value.id === 'vet', got)
  check('the acceptance is kept in a file only its owner reads', (statSync(stateFile).mode & 0o777) === 0o600 && JSON.parse(readFileSync(stateFile, 'utf8')).consented['acme/vet'] === true)
  setSelected('kybernos-plugin-vet', false)
  check('switched off in DSH (the native switch): disabled, nothing contributed', get(registry).status === 'disabled' && registry.contributions('kybernos/core#domain-pack').length === 0)
  setSelected('kybernos-plugin-vet', true)
  check('switched on again: still accepted, contributes at once', get(registry).status === 'ok' && registry.contributions('kybernos/core#domain-pack').length === 1)
  check('acceptance withdrawn', registry.setConsent('acme/vet', false) === true && get(registry).status === 'needs-consent' && registry.contributions('kybernos/core#domain-pack').length === 0)
  check('an unknown or invalid plugin cannot be accepted', registry.setConsent('acme/nobody', true) === false && registry.setConsent('x', true) === false && registry.setConsent('acme/vet', 'yes') === false)
  const other = createRegistry({ profileDir: fresh().profileDir, stateFile, ttlMs: 0 })
  check('a registry on another profile knows nothing of it', other.plugins().length === 0)
}

console.log('inert data needs no acceptance; a plain dependency has no switch in DSH')
{
  const { registry, install } = fresh()
  registry.definePoint(INERT)
  install('kybernos-plugin-presets', {
    'plugin.json': manifest({ id: 'acme/presets', requires: { kybernos: '^0.1', plugins: { 'kybernos/dashboards': '^1.0' } }, extends: [{ point: 'kybernos/dashboards#preset', range: '^1.0', dir: 'presets' }] }),
    'package.json': { name: 'kybernos-plugin-presets', version: '1.0.0' }, 'presets/p1.json': pack('p1')
  }, { selected: false })
  const p = get(registry, 'acme/presets')
  check('a package with no dsh.bundle is a plain dependency: always on, and an inert point asks nothing', p.status === 'ok' && p.enabled === true && p.errors.length === 0, p)
  check('it contributes at once', registry.contributions('kybernos/dashboards#preset').length === 1)
}

console.log('where it came from sets the level')
{
  const a = fresh()
  const outside = join(a.dir, 'my-checkout', 'kybernos-plugin-vet')
  a.install('kybernos-plugin-vet', vetFiles('vet', { id: 'local/vet', author: { id: 'local', name: 'Me' } }), { spec: 'link:../../my-checkout/kybernos-plugin-vet', outside })
  const p = get(a.registry, 'local/vet')
  check('a link: to a folder of the person\'s own is Local, and may use the local namespace', p?.level === 'local' && p.source === 'local' && p.errors.length === 0, p)
  const b = fresh()
  b.install('kybernos-plugin-vet', vetFiles('vet', { id: 'local/vet', author: { id: 'local', name: 'Me' } }), { spec: '1.2.0' })
  check('the local namespace is refused to something DSH fetched', b.registry.plugins()[0].status === 'invalid' && /reserved for a folder/.test(b.registry.plugins()[0].errors.join()), b.registry.plugins()[0])
  const c = fresh()
  c.install('kybernos-plugin-vet', vetFiles('vet', { id: 'kybernos/vet', author: { id: 'kybernos', name: 'Kybernos' }, name: { en: 'x', fr: 'x' }, description: { en: 'y', fr: 'y' } }), { spec: 'file:/somewhere/else' })
  check('the kybernos namespace is ours: refused even from a local folder', c.registry.plugins()[0].status === 'invalid' && /reserved/.test(c.registry.plugins()[0].errors.join()), c.registry.plugins()[0])
  const d = fresh()
  d.install('kybernos-plugin-vet', vetFiles(), { spec: 'github:acme/kybernos-plugin-vet#v1', asLink: true })
  check('a registry or GitHub install links into the profile\'s own store: followed, and Unlisted', d.registry.plugins()[0].status === 'needs-consent' && d.registry.plugins()[0].level === 'unlisted', d.registry.plugins()[0])
  const e = fresh()
  e.install('kybernos-plugin-vet', vetFiles(), { spec: '1.0.0', outside: join(e.dir, 'elsewhere', 'x') })
  check('a link that leaves the profile without being a link: install is refused', e.registry.plugins()[0].status === 'invalid' && /outside the profile/.test(e.registry.plugins()[0].errors.join()), e.registry.plugins()[0])
}

console.log('a data plugin cannot make DSH load or run anything')
{
  const bad = (name, pkg, patch, reasonRe) => {
    const f = fresh()
    f.install('kybernos-plugin-vet', { ...vetFiles(), 'package.json': pkg, 'cordis.patch.yml': patch })
    const p = f.registry.plugins()[0]
    check(name, p.status === 'invalid' && reasonRe.test(p.errors.join(' | ')), p.errors)
  }
  bad('a patch that names a module is code DSH would load', DATA_PKG('kybernos-plugin-vet'), '- insert:\n    - id: evil\n      name: "./evil.js"\n', /patch names modules/)
  bad('a browser entry (dsh.client) would load code in the page', { ...DATA_PKG('kybernos-plugin-vet'), dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', immediately: true } } }, '[]', /dsh\.client would make DSH load code/)
  bad('an install script would run on install', { ...DATA_PKG('kybernos-plugin-vet'), scripts: { postinstall: 'node steal.js' } }, '[]', /scripts\.postinstall/)
  bad('a bin puts a command on the path', { ...DATA_PKG('kybernos-plugin-vet'), bin: { vet: 'cli.js' } }, '[]', /bin would put/)
  bad('a patch path that leaves the package', { ...DATA_PKG('kybernos-plugin-vet'), dsh: { bundle: { patch: '../../x.yml' } } }, '[]', /not a path inside/)
  bad('another key of dsh.bundle', { ...DATA_PKG('kybernos-plugin-vet'), dsh: { bundle: { patch: './cordis.patch.yml', extra: 1 } } }, '[]', /dsh\.bundle\.extra/)
  const a = fresh()
  a.install('kybernos-plugin-vet', { ...vetFiles(), 'cordis.patch.yml': '# nothing\n\n[]  # empty\n' })
  check('an empty patch, with comments, is what a data plugin has', a.registry.plugins()[0].status === 'needs-consent' && a.registry.plugins()[0].errors.length === 0, a.registry.plugins()[0].errors)
  const b = fresh()
  b.install('kybernos-plugin-vet', { ...vetFiles(), 'cordis.patch.yml': '' })
  check('an empty file is an empty patch too', b.registry.plugins()[0].errors.length === 0)
  check('dataPackageProblems on its own: a clean package has none', dataPackageProblems({ name: 'x' }, '/nowhere').length === 0)
  const c = fresh()
  const real = c.install('kybernos-plugin-vet', vetFiles())
  writeFileSync(join(real, 'cordis.patch.yml'), '- insert: [{ id: a, name: b }]')
  check('a patch edited after the install is judged at the next scan', c.registry.plugins()[0].status === 'invalid')
}

console.log('statuses: the first thing wrong, in the contract\'s order')
{
  const f = fresh({ dshVersion: '0.2.1-rc.2' })
  const put = (name, id, over) => { f.install(name, { ...vetFiles('vet', { id, ...over }), 'package.json': DATA_PKG(name) }); f.registry.setConsent(id, true) }
  put('kybernos-plugin-fine', 'acme/fine', {})
  put('kybernos-plugin-future', 'acme/future', { requires: { kybernos: '^9.0', plugins: { 'kybernos/core': '^1.0' } } })
  put('kybernos-plugin-olddsh', 'acme/olddsh', { requires: { dsh: { min: '0.1.0', max: '0.1.5' }, kybernos: '^0.1', plugins: { 'kybernos/core': '^1.0' } } })
  put('kybernos-plugin-nopoint', 'acme/nopoint', { extends: [{ point: 'kybernos/core#team-template', range: '^1.0', dir: 'domains' }] })
  put('kybernos-plugin-wrongmajor', 'acme/wrongmajor', { extends: [{ point: 'kybernos/core#domain-pack', range: '^2.0', dir: 'domains' }] })
  put('kybernos-plugin-optnopoint', 'acme/optnopoint', { requires: { kybernos: '^0.1' }, extends: [{ point: 'kybernos/core#team-template', range: '^1.0', dir: 'domains', optional: true }] })
  put('kybernos-plugin-optwrongmajor', 'acme/optwrongmajor', { requires: { kybernos: '^0.1' }, extends: [{ point: 'kybernos/core#domain-pack', range: '^2.0', dir: 'domains', optional: true }] })
  put('kybernos-plugin-needscore', 'acme/needscore', { requires: { plugins: { 'kybernos/core': '^3.0' } } })
  put('kybernos-plugin-needsother', 'acme/needsother', { requires: { plugins: { 'kybernos/core': '^1.0', 'kybernos/dashboards': '^1.0' } } })
  const st = (id) => f.registry.plugins().find((p) => p.id === id)
  check('fine is ok', st('acme/fine').status === 'ok')
  check('a plugin that needs a newer Kybernos says so', st('acme/future').status === 'needs-kybernos' && /\^9\.0.*0\.1\.1/.test(st('acme/future').reason), st('acme/future'))
  check('a plugin outside DSH\'s version range says so (the version is known here)', st('acme/olddsh').status === 'needs-dsh', st('acme/olddsh'))
  check('an extension of a point nobody defined is a missing dependency', st('acme/nopoint').status === 'missing-dependency' && /team-template/.test(st('acme/nopoint').reason))
  check('a point of another major is an incompatible point', st('acme/wrongmajor').status === 'incompatible-point')
  check('an OPTIONAL extension of a point nobody defined leaves the plugin ok, with nothing read and the reason noted', st('acme/optnopoint').status === 'ok' && st('acme/optnopoint').extends[0].contributions === 0 && /not available/.test(st('acme/optnopoint').extends[0].skipped), st('acme/optnopoint'))
  check('an OPTIONAL extension of a point of another major leaves the plugin ok too', st('acme/optwrongmajor').status === 'ok' && st('acme/optwrongmajor').extends[0].contributions === 0, st('acme/optwrongmajor'))
  check('the right owner at the wrong version is a missing dependency', st('acme/needscore').status === 'missing-dependency' && /\^3\.0/.test(st('acme/needscore').reason))
  check('an owner nobody provides is a missing dependency', st('acme/needsother').status === 'missing-dependency')
  check('only the plugins that are fine contribute', f.registry.contributions('kybernos/core#domain-pack').map((c) => c.plugin).join() === 'acme/fine', f.registry.contributions('kybernos/core#domain-pack').map((c) => c.plugin))
  const g = fresh()
  g.install('kybernos-plugin-olddsh', { ...vetFiles('vet', { requires: { dsh: { min: '0.1.0', max: '0.1.5' }, kybernos: '^0.1', plugins: { 'kybernos/core': '^1.0' } } }), 'package.json': DATA_PKG('kybernos-plugin-olddsh') })
  check('DSH\'s version is not judged while it is unknown', g.registry.plugins()[0].status === 'needs-consent')
}

console.log('what is not a plugin of ours is left alone, and what is wrong is listed')
{
  const f = fresh()
  f.install('left-pad', { 'package.json': { name: 'left-pad', version: '1.0.0' }, 'index.js': 'module.exports = 1' })
  f.install('@acme/other', { 'package.json': { name: '@acme/other', version: '1.0.0' } })
  const modules = join(f.profileDir, 'node_modules')
  write(join(modules, '@local', 'kybernos-hub', 'plugin.json'), '{}')
  const profile = JSON.parse(readFileSync(join(f.profileDir, 'package.json'), 'utf8'))
  Object.assign(profile.dependencies, { '@local/kybernos-hub': 'link:../../x', '@deepseek-ai/dsh': '1.0.0', 'Not A Name': '1', ghost: '1' })
  writeFileSync(join(f.profileDir, 'package.json'), JSON.stringify(profile))
  check('packages without a plugin.json, our own modules, the engine, bad names and missing folders are not listed', f.registry.plugins().length === 0, f.registry.plugins())
  const bad = (name, content, re) => { const g = fresh(); g.install('kybernos-plugin-x', { 'plugin.json': content, 'package.json': DATA_PKG('kybernos-plugin-x'), 'cordis.patch.yml': '[]' }); const p = g.registry.plugins()[0]; check(name, p.status === 'invalid' && re.test(p.errors.join(' | ')), p.errors) }
  bad('not JSON', '{ nope', /not valid JSON/)
  bad('not an object', '[]', /not an object/)
  bad('an unknown key (no scripts, no postinstall)', JSON.stringify({ ...manifest(), scripts: { postinstall: 'rm -rf /' } }), /not a known key/)
  bad('a data plugin cannot ask for exec', JSON.stringify(manifest({ permissions: ['exec'] })), /permissions/)
  const codeManifest = (over = {}) => ({ contract: 1, id: 'acme/code', kind: 'code', version: '1.0.0', name: { en: 'Code' }, description: { en: 'A code plugin.' }, author: { id: 'acme', name: 'Acme' }, license: 'MIT', pricing: 'free', package: 'kybernos-plugin-code', entry: { host: 'index.js' }, requires: { dsh: { min: '0.1.0', max: '0.3.0' } }, permissions: ['exec'], ...over })
  const c = fresh()
  c.install('kybernos-plugin-code', { 'plugin.json': codeManifest(), 'package.json': { name: 'kybernos-plugin-code', version: '1.0.0', exports: { '.': './index.js' }, dsh: { bundle: { patch: './p.yml' } } }, 'p.yml': '- insert: [{ id: x, name: "kybernos-plugin-code" }]' })
  const cp = c.registry.plugins()[0]
  check('a code plugin DSH installed is listed with what it declares, never as safe data: unlisted, on because DSH selected it, nothing contributed', cp.kind === 'code' && cp.level === 'unlisted' && cp.status === 'ok' && cp.permissions.join() === 'exec' && cp.errors.length === 0, cp)
  const d = fresh()
  d.install('kybernos-plugin-code', { 'plugin.json': codeManifest({ package: 'another-name' }), 'package.json': { name: 'kybernos-plugin-code', version: '1.0.0', exports: { '.': './index.js' } } })
  check('a code plugin whose manifest names another package is refused', d.registry.plugins()[0].status === 'invalid')
  const e = fresh()
  e.install('kybernos-plugin-a', vetFiles('vet', { id: 'acme/same' }))
  e.install('kybernos-plugin-b', { ...vetFiles('vet', { id: 'acme/same' }), 'package.json': DATA_PKG('kybernos-plugin-b') })
  const same = e.registry.plugins()
  check('two packages claiming one id: the first keeps it, the second is refused and says why', same.filter((p) => p.status !== 'invalid').length === 1 && same.some((p) => p.status === 'invalid' && /already provided by the package "kybernos-plugin-a"/.test(p.errors.join())), same.map((p) => p.package + ':' + p.status))
}

console.log('a hostile package')
{
  const outside = (f) => { const o = join(f.dir, 'outside'); write(join(o, 'stolen.json'), pack('stolen')); return o }
  const a = fresh()
  const real = a.install('kybernos-plugin-vet', vetFiles())
  a.registry.setConsent('acme/vet', true)
  rmDir(join(real, 'domains'))
  symlinkSync(outside(a), join(real, 'domains'))
  check('a contributions folder that is a symbolic link is not followed', get(a.registry).status === 'ok' && a.registry.contributions('kybernos/core#domain-pack').length === 0 && /not a folder of this plugin/.test(JSON.stringify(get(a.registry).extends[0].rejected)))
  const b = fresh()
  const r2 = b.install('kybernos-plugin-vet', vetFiles())
  b.registry.setConsent('acme/vet', true)
  symlinkSync(join(outside(b), 'stolen.json'), join(r2, 'domains', 'stolen.json'))
  check('a contribution file that is a symbolic link is not read', b.registry.contributions('kybernos/core#domain-pack').length === 1 && /symbolic link/.test(JSON.stringify(get(b.registry).extends[0].rejected)))
  const c = fresh()
  const r3 = c.install('kybernos-plugin-vet', vetFiles())
  unlinkSync(join(r3, 'plugin.json'))
  symlinkSync(join(outside(c), 'stolen.json'), join(r3, 'plugin.json'))
  check('a manifest that is a symbolic link is not read', c.registry.plugins().length === 1 && c.registry.plugins()[0].status === 'invalid' && /symbolic link/.test(c.registry.plugins()[0].errors.join()), c.registry.plugins())
  const d = fresh()
  const r4 = d.install('kybernos-plugin-vet', vetFiles())
  d.registry.setConsent('acme/vet', true)
  write(join(r4, 'domains', 'big.json'), '{"v":1,"id":"big","name":{"en":"x"},"pad":"' + 'x'.repeat(LIMITS.file) + '"}')
  write(join(r4, 'domains', 'proto.json'), '{"v":1,"id":"proto","__proto__":{"polluted":true},"name":{"en":"x"}}')
  const rej = get(d.registry).extends[0].rejected
  check('a contribution over the size bound is refused unread', rej.some((x) => x.file === 'big.json' && /larger than/.test(x.errors[0])), rej)
  check('a __proto__ key is refused by the check and pollutes nothing', rej.some((x) => x.file === 'proto.json') && ({}).polluted === undefined)
  const e = fresh()
  const r5 = e.install('kybernos-plugin-vet', vetFiles())
  e.registry.setConsent('acme/vet', true)
  for (let n = 0; n < 40; n += 1) write(join(r5, 'domains', 'f' + String(n).padStart(2, '0') + '.json'), pack('f' + String(n).padStart(2, '0')))
  const rj = get(e.registry).extends[0]
  check('no more files than the point allows are read', rj.contributions === LIMITS.files && rj.rejected.some((x) => /holds more than/.test(x.errors[0])), rj.contributions)
  const g = fresh()
  g.install('kybernos-plugin-big', { 'plugin.json': '{"pad":"' + 'x'.repeat(LIMITS.manifest) + '"}', 'package.json': DATA_PKG('kybernos-plugin-big') })
  check('a manifest over the size bound is not parsed', g.registry.plugins()[0].status === 'invalid' && /larger than/.test(g.registry.plugins()[0].errors[0]))
  const h = fresh()
  h.install('kybernos-plugin-esc', vetFiles('vet', { extends: [{ point: 'kybernos/core#domain-pack', range: '^1.0', dir: '../../outside' }] }))
  check('a dir that tries to leave the package is refused by the manifest check', h.registry.plugins()[0].status === 'invalid')
  check('readBounded refuses a directory and a missing file', readBounded(a.dir, 100).error === 'is not a file' && readBounded(join(a.dir, 'nope'), 100).error === 'is missing')
}

console.log('nothing in a package is ever run')
{
  const f = fresh()
  const marker = join(f.dir, 'RAN')
  const real = f.install('kybernos-plugin-vet', vetFiles())
  f.registry.setConsent('acme/vet', true)
  for (const rel of ['index.js', 'client.js', 'install.mjs', 'domains/hook.js', 'domains/hook.mjs']) write(join(real, rel), "import { writeFileSync } from 'node:fs'; writeFileSync(" + JSON.stringify(marker) + ", 'ran')")
  f.registry.plugins(); f.registry.contributions('kybernos/core#domain-pack')
  check('a script in the package is never imported', existsSync(marker) === false)
  const sources = ['registry.mjs', 'host.mjs', 'manifest.mjs', 'schema-subset.mjs', 'version.mjs', 'index.js'].map((n) => [n, readFileSync(join(HERE, n), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')])
  const forbidden = /\bimport\s*\(|\beval\s*\(|new\s+Function\b|child_process|\brequire\s*\(|\bvm\./
  check('the registry\'s own code has no dynamic import, eval, Function, vm or child_process', sources.every(([n, s]) => !forbidden.test(s)), sources.filter(([n, s]) => forbidden.test(s)).map(([n]) => n))
  check('scanProfile never throws on a profile that is missing, a file, or has no package.json', scanProfile(join(f.dir, 'nope')).length === 0 && scanProfile(join(f.dir, 'plugins-state.json')).length === 0 && scanProfile(f.dir).length === 0)
  write(join(f.dir, 'broken', 'package.json'), '{ nope')
  check('a profile package.json that is not JSON gives an empty list', scanProfile(join(f.dir, 'broken')).length === 0)
}

console.log('points, and the scan lifetime')
{
  const { registry } = fresh()
  const bad = (d) => { try { registry.definePoint(d); return false } catch (e) { return /a point needs/.test(e.message) } }
  check('a point without a validator, a code point, or a bad id is refused', bad({ ...INSTRUCTION, validate: undefined }) && bad({ ...INSTRUCTION, kind: 'code' }) && bad({ ...INSTRUCTION, owner: 'nope' }) && bad({ ...INSTRUCTION, version: '1' }) && bad({ ...INSTRUCTION, class: 'safe' }))
  registry.definePoint({ ...INSTRUCTION, version: '1.1' })
  check('defining a point again replaces it', registry.points().filter((p) => p.id === 'kybernos/core#domain-pack').length === 1 && registry.points()[0].version === '1.1')
  let checked = 0
  const counting = { ...INSTRUCTION, validate: (...a) => { checked += 1; return validate(...a) } }
  const g = fresh({ ttlMs: 60000 })
  g.registry.definePoint(counting)
  g.install('kybernos-plugin-vet', vetFiles())
  g.registry.refresh()
  g.registry.setConsent('acme/vet', true)
  g.registry.contributions('kybernos/core#domain-pack')
  const n = checked
  g.registry.definePoint(counting)
  g.registry.contributions('kybernos/core#domain-pack'); g.registry.plugins()
  check('the same definition told again keeps the scan (an owner may say it at every question)', n > 0 && checked === n, { n, checked })
  let clock = 0
  const h = fresh({ ttlMs: 2000, now: () => clock })
  h.registry.plugins()
  h.install('kybernos-plugin-vet', vetFiles())
  const soon = h.registry.plugins().length
  clock = 2500
  const later = h.registry.plugins().length
  h.install('kybernos-plugin-vet2', { ...vetFiles('vet', { id: 'acme/vet2' }), 'package.json': DATA_PKG('kybernos-plugin-vet2') })
  const cached = h.registry.plugins().length
  h.registry.refresh()
  check('a package installed later shows after the scan lifetime, not before; refresh() forgets the scan at once', soon === 0 && later === 1 && cached === 1 && h.registry.plugins().length === 2, { soon, later, cached })
  const x = fresh()
  x.registry.definePoint({ ...INSTRUCTION, validate: () => { throw new Error('boom') } })
  x.install('kybernos-plugin-vet', vetFiles())
  x.registry.setConsent('acme/vet', true)
  check('a validator that throws is a refused file, not an error', get(x.registry).extends[0].rejected[0].errors[0] === 'the check itself failed')
}

console.log('what a plugin brings is readable before it is accepted')
{
  const { registry, install } = fresh()
  install('kybernos-plugin-vet', vetFiles())
  const before = registry.preview('acme/vet')
  check('preview shows the checked files of a plugin that is not accepted yet, and contributes nothing', before !== null && before[0].class === 'instruction' && before[0].files[0].value.id === 'vet' && registry.contributions('kybernos/core#domain-pack').length === 0, before)
  check('preview says what the check refused', (() => { const f = fresh(); const r = f.install('kybernos-plugin-vet', vetFiles()); write(join(r, 'domains', 'bad.json'), { v: 1, id: 'bad', name: { en: 'x' }, cron: '*' }); return f.registry.preview('acme/vet')[0].rejected.some((x) => x.file === 'bad.json') })())
  check('preview is null for an unknown plugin, an invalid one, and a code plugin', registry.preview('acme/nobody') === null && (() => { const f = fresh(); f.install('kybernos-plugin-vet', { ...vetFiles(), 'package.json': { ...DATA_PKG('kybernos-plugin-vet'), bin: { x: 'x.js' } } }); return f.registry.preview('acme/vet') === null })())
}

console.log('drafts: what the AI prepared, not installed')
{
  const dir = mkdtempSync(join(tmpdir(), 'kb-drafts-'))
  const draftsDir = join(dir, 'drafts')
  const f = fresh({ draftsDir })
  check('no drafts folder gives an empty list', f.registry.drafts().length === 0)
  const draft = (name, files) => { for (const [rel, data] of Object.entries(files)) write(join(draftsDir, name, rel), data) }
  draft('cabinet-notes', { ...vetFiles('vet', { id: 'local/cabinet-notes', author: { id: 'local', name: 'Me' } }), 'package.json': DATA_PKG('kybernos-plugin-cabinet-notes') })
  draft('broken', { 'plugin.json': manifest({ id: 'local/broken', author: { id: 'local', name: 'Me' }, permissions: ['exec'] }), 'package.json': DATA_PKG('kybernos-plugin-broken'), 'cordis.patch.yml': '[]' })
  draft('not-a-plugin', { 'readme.txt': 'hello' })
  draft('Bad Name', { 'plugin.json': manifest() })
  write(join(dir, 'outside', 'plugin.json'), manifest({ id: 'local/out', author: { id: 'local', name: 'Me' } }))
  symlinkSync(join(dir, 'outside'), join(draftsDir, 'linked'))
  const list = f.registry.drafts()
  const ok1 = list.find((d) => d.name === 'cabinet-notes')
  check('a good draft is listed with the path the installer takes, its id and what it is', ok1?.ok === true && ok1.id === 'local/cabinet-notes' && ok1.path.endsWith('cabinet-notes') && ok1.package === 'kybernos-plugin-cabinet-notes' && ok1.kind === 'data' && ok1.installed === false, ok1)
  check('a draft that fails the checks is listed with its reasons, so the AI can fix it', list.find((d) => d.name === 'broken')?.ok === false && /permissions/.test(list.find((d) => d.name === 'broken').errors.join()), list.find((d) => d.name === 'broken'))
  check('a folder that is not a plugin, a bad folder name and a link out of the drafts folder are not listed', list.map((d) => d.name).sort().join() === 'broken,cabinet-notes', list.map((d) => d.name))
  f.install('kybernos-plugin-cabinet-notes', { ...vetFiles('vet', { id: 'local/cabinet-notes', author: { id: 'local', name: 'Me' } }), 'package.json': DATA_PKG('kybernos-plugin-cabinet-notes') }, { spec: 'file:/x/cabinet-notes' })
  check('a draft already installed says so', f.registry.drafts().find((d) => d.name === 'cabinet-notes').installed === true)
}

console.log('what is logged')
{
  const { install, registry } = fresh()
  const real = install('kybernos-plugin-vet', vetFiles())
  registry.setConsent('acme/vet', true)
  write(join(real, 'domains', 'bad.json'), '{ nope')
  registry.plugins()
  const before = warnings.length
  registry.plugins(); registry.plugins(); registry.contributions('kybernos/core#domain-pack')
  check('a refused file is logged once per registry, not at every scan', before >= 1 && warnings.length === before, { before, after: warnings.length })
}

console.log('one plugin ships five folders: each point reads its own, nothing runs')
{
  const f = fresh()
  for (const p of [SKILL, THEME, TEAM, AUTOMATION]) f.registry.definePoint(p)
  const marker = join(f.dir, 'RAN')
  const real = f.install('kybernos-plugin-vertical', {
    'plugin.json': manifest({
      id: 'acme/vertical',
      requires: { kybernos: '^0.1', plugins: { 'kybernos/core': '^1.0', 'kybernos/theme': '^1.0', 'kybernos/skills': '^1.0' } },
      extends: [
        { point: 'kybernos/core#domain-pack', range: '^1.0', dir: 'domains' },
        { point: 'kybernos/theme#theme', range: '^1.0', dir: 'themes' },
        { point: 'kybernos/skills#skill', range: '^1.0', dir: 'skills' },
        { point: 'kybernos/core#team-template', range: '^1.0', dir: 'teams' },
        { point: 'kybernos/core#automation-template', range: '^1.0', dir: 'automations' }
      ]
    }),
    'package.json': DATA_PKG('kybernos-plugin-vertical'),
    'cordis.patch.yml': '[]\n',
    'domains/clinic.json': pack('clinic'),
    'themes/clinic.json': pack('clinic'),
    'skills/consultation/SKILL.md': '---\nname: consultation\ndescription: d\n---\n',
    'skills/consultation/hook.mjs': 'import { writeFileSync } from "node:fs"\nwriteFileSync(' + JSON.stringify(marker) + ', "ran")\n',
    'skills/broken/notes.md': 'x\n',
    'teams/clinic.json': pack('clinic'),
    'automations/reminder.json': pack('reminder')
  })
  f.registry.setConsent('acme/vertical', true)
  const p = get(f.registry, 'acme/vertical')
  const refs = ['kybernos/core#domain-pack', 'kybernos/theme#theme', 'kybernos/skills#skill', 'kybernos/core#team-template', 'kybernos/core#automation-template']
  const each = refs.map((ref) => f.registry.contributions(ref))
  check('one plugin ships five folders: each point reads its own, nothing runs', p.status === 'ok' && p.extends.length === 5 &&
    each.every((c) => c.length === 1 && c[0].plugin === 'acme/vertical') &&
    each.map((c) => c[0].file).join() === 'domains/clinic.json,themes/clinic.json,skills/consultation,teams/clinic.json,automations/reminder.json' &&
    existsSync(join(real, 'skills', 'consultation', 'hook.mjs')) === true, { status: p.status, files: each.map((c) => c[0]?.file) })
  check('a script kept in a skill folder is read as text, never run', existsSync(marker) === false)
  const skills = p.extends.find((e) => e.point === 'kybernos/skills#skill')
  check('a skill folder without SKILL.md is skipped with its error list while the four other points still contribute', skills.contributions === 1 && skills.rejected.some((x) => x.file === 'skills/broken' && /SKILL.md is missing/.test(x.errors.join())) && p.extends.filter((e) => e.point !== 'kybernos/skills#skill').every((e) => e.contributions === 1 && e.rejected.length === 0), skills)
  let again = null
  try { again = createRegistry({ profileDir: f.profileDir, stateFile: f.stateFile, ttlMs: 0 }); again.plugins() } catch (e) { again = null }
  check('an invalid contribution never throws to the caller: a fresh registry on the same profile answers', again !== null && again.plugins().length === 1)
}

console.log('a skill folder is one contribution, its files kept whole')
{
  const f = fresh()
  f.registry.definePoint(SKILL)
  f.install('kybernos-plugin-skills', {
    'plugin.json': manifest({ id: 'acme/skills', requires: { kybernos: '^0.1', plugins: { 'kybernos/skills': '^1.0' } }, extends: [{ point: 'kybernos/skills#skill', range: '^1.0', dir: 'skills' }] }),
    'package.json': DATA_PKG('kybernos-plugin-skills'),
    'cordis.patch.yml': '[]\n',
    'skills/consultation/SKILL.md': '---\nname: consultation\ndescription: d\n---\n',
    'skills/consultation/reference.md': 'one\ntwo\n',
    'skills/consultation/examples/sub/note.md': 'x\n',
    'skills/triage/SKILL.md': '---\nname: triage\ndescription: d\n---\n'
  })
  f.registry.setConsent('acme/skills', true)
  const c = f.registry.contributions('kybernos/skills#skill')
  check('a skill folder is one contribution, its files kept whole', c.length === 2 && c[0].file === 'skills/consultation' && c[0].value.id === 'consultation' &&
    c[0].value.files.join() === 'SKILL.md,examples/sub/note.md,reference.md' && c[0].value.texts['reference.md'] === 'one\ntwo\n' && c[1].value.id === 'triage', c)
  const preview = f.registry.preview('acme/skills')
  check('what the person reads before accepting shows the same folder, whole', preview !== null && preview[0].files.length === 2 && preview[0].files[0].file === 'skills/consultation' && preview[0].files[0].value.files.length === 3, preview)
}

console.log('a folder point refuses what it cannot trust, with its error list')
{
  const f = fresh()
  f.registry.definePoint(SKILL)
  const real = f.install('kybernos-plugin-badskills', {
    'plugin.json': manifest({ id: 'acme/badskills', requires: { kybernos: '^0.1', plugins: { 'kybernos/skills': '^1.0' } }, extends: [{ point: 'kybernos/skills#skill', range: '^1.0', dir: 'skills' }] }),
    'package.json': DATA_PKG('kybernos-plugin-badskills'),
    'cordis.patch.yml': '[]\n',
    'skills/good/SKILL.md': '---\nname: good\ndescription: d\n---\n',
    'skills/README.md': 'a stray file at the root of the folder\n',
    'skills/.hidden/SKILL.md': '---\nname: hidden\ndescription: d\n---\n',
    'skills/noskillmd/notes.md': 'x\n',
    'skills/boom/SKILL.md': '---\nname: boom\ndescription: d\n---\n',
    'skills/deep/a/b/c/d/SKILL.md': '---\nname: deep\ndescription: d\n---\n',
    'skills/big/notes.md': 'x'.repeat(LIMITS.file + 1),
    'skills/linked/SKILL.md': '---\nname: linked\ndescription: d\n---\n'
  })
  mkdirSync(join(f.dir, 'elsewhere'), { recursive: true })
  write(join(f.dir, 'elsewhere', 'stolen.md'), 'x\n')
  symlinkSync(join(f.dir, 'elsewhere', 'stolen.md'), join(real, 'skills', 'linked', 'stolen.md'))
  symlinkSync(join(f.dir, 'elsewhere'), join(real, 'skills', 'elsewhere'))
  for (let n = 0; n < LIMITS.folderFiles + 1; n += 1) write(join(real, 'skills', 'many', 'f' + String(n).padStart(2, '0') + '.md'), 'x\n')
  for (let n = 0; n < 5; n += 1) write(join(real, 'skills', 'huge', 'h' + n + '.md'), 'x'.repeat(250 * 1024))
  f.registry.setConsent('acme/badskills', true)
  const p = get(f.registry, 'acme/badskills')
  const rej = p.extends[0].rejected
  const has = (file, re) => rej.some((x) => x.file === file && re.test(x.errors.join(' ')))
  check('a folder point refuses what it cannot trust, with its error list', has('skills/README.md', /is not a folder/) && has('skills/.hidden', /is not a valid folder name/) &&
    has('skills/noskillmd', /SKILL.md is missing/) && has('skills/boom', /the check itself failed/) && has('skills/elsewhere', /is a symbolic link/), rej)
  check('a link inside a contribution refuses the contribution, not just the file', has('skills/linked', /is a symbolic link/) && p.extends[0].contributions === 1)
  check('a file over a bound, too many files or a folder too deep refuses the contribution', has('skills/big', /larger than/) && has('skills/many', /holds more than 50 files/) && has('skills/huge', /holds more than 1024 KiB/) && has('skills/deep', /deeper than 4 folders/), rej)
  check('only the folder that passes its check contributes', f.registry.contributions('kybernos/skills#skill').map((x) => x.value.id).join() === 'good')
}

console.log('a point says whether its contributions are files or folders')
{
  const { registry } = fresh()
  const theme = { owner: 'kybernos/theme', ownerVersion: '1.0.0', name: 'theme', version: '1.0', kind: 'data', class: 'inert', validate }
  registry.definePoint(theme)
  const json = registry.points().find((p) => p.id === 'kybernos/theme#theme')
  registry.definePoint({ ...theme, files: 'folder' })
  const folder = registry.points().find((p) => p.id === 'kybernos/theme#theme')
  let message = ''
  try { registry.definePoint({ ...theme, name: 'other', files: 'folders' }) } catch (e) { message = e.message }
  check('a point says whether its contributions are files or folders', json?.files === 'json' && folder?.files === 'folder' && /a point needs/.test(message), { json: json?.files, folder: folder?.files, message })
}

console.log('a folder contribution cannot be checked by a JSON schema')
{
  const withPoint = (provided) => manifest({ provides: [provided] })
  const point = (over) => ({ name: 'skill', version: '1.0', kind: 'data', class: 'instruction', validator: 'builtin', ...over })
  const folder = manifestErrors(withPoint(point({ files: 'folder' })), {})
  const withSchema = manifestErrors(withPoint(point({ files: 'folder', schema: 'skills.schema.json' })), {})
  const asCode = manifestErrors(withPoint({ name: 'skill', version: '1.0', kind: 'code', files: 'folder' }), {})
  const json = manifestErrors(withPoint({ name: 'skill', version: '1.0', kind: 'data', class: 'inert', schema: 'skills.schema.json' }), {})
  check('a folder contribution cannot be checked by a JSON schema', folder.length === 0 && /a folder contribution cannot be checked by a JSON schema/.test(withSchema.join(' | ')) &&
    /files describes a data point/.test(asCode.join(' | ')) && json.length === 0, { folder, withSchema, asCode, json })
}

console.log('the schema a person reads is the schema the registry runs')
{
  check('docs/dev/schemas/plugin.schema.json and the bundle\'s copy are identical', readFileSync(join(HERE, '..', '..', 'docs', 'dev', 'schemas', 'plugin.schema.json'), 'utf8') === readFileSync(join(HERE, 'plugin.schema.json'), 'utf8'))
}

console.log(failed === 0 ? '\nREGISTRY OK' : '\nREGISTRY: ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
