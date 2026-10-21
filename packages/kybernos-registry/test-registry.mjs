// The registry: the folder scan, the statuses, the contributions, the on/off choice, and what a hostile plugin folder cannot do.
//   node packages/kybernos-registry/test-registry.mjs
// Hermetic: temp folders only. The point's validator here is a stand-in; the real one (domain packs) is run in kybernos-plugin/test-domain-pack.mjs.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIMITS, createRegistry, readBounded, scanFolder } from './registry.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const warnings = []
console.warn = (m) => { warnings.push(String(m)) }
let failed = 0
const check = (name, ok, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!ok) failed += 1 }
const tmp = () => mkdtempSync(join(tmpdir(), 'kb-registry-'))
const write = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data)) }

const manifest = (over = {}) => ({
  contract: 1, id: 'local/vet', kind: 'data', version: '0.1.0',
  name: { en: 'Veterinary clinic' }, description: { en: 'A pack for veterinary clinics.' },
  author: { id: 'local', name: 'Me' }, license: 'CC-BY-4.0', pricing: 'free',
  requires: { kybernos: '^0.1', plugins: { 'kybernos/core': '^1.0' } },
  extends: [{ point: 'kybernos/core#domain-pack', range: '^1.0', dir: 'domains' }],
  ...over
})
const pack = (id) => ({ v: 1, id, name: { en: 'Vet' } })
/** The stand-in validator: known keys only, the id is the file name, a returned value is a fresh object (never the parsed one). */
const validate = (raw, fileId) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['a pack is an object'] }
  const extra = Object.keys(raw).filter((k) => !['v', 'id', 'name'].includes(k))
  if (extra.length > 0) return { ok: false, errors: ['unknown key "' + extra[0] + '"'] }
  if (raw.v !== 1 || raw.id !== fileId) return { ok: false, errors: ['v or id'] }
  return { ok: true, value: { v: 1, id: raw.id, name: { en: String(raw.name?.en) } } }
}
const DEFINE = { owner: 'kybernos/core', ownerVersion: '1.0.0', name: 'domain-pack', version: '1.0', kind: 'data', class: 'instruction', validate }

const fresh = (opts = {}) => {
  const dir = tmp()
  const root = join(dir, 'plugins')
  mkdirSync(root, { recursive: true })
  const stateFile = join(dir, 'plugins-state.json')
  let clock = 1000
  const registry = createRegistry({ root, stateFile, kybernosVersion: '0.1.1', ttlMs: 0, now: () => clock++, ...opts })
  registry.definePoint(DEFINE)
  return { dir, root, stateFile, registry }
}
const only = (reg) => reg.plugins().find((p) => p.id === 'local/vet')

console.log('a plugin folder, end to end')
{
  const { root, stateFile, registry } = fresh()
  check('an empty folder gives an empty list', registry.plugins().length === 0)
  write(join(root, 'local', 'vet', 'plugin.json'), manifest())
  write(join(root, 'local', 'vet', 'domains', 'vet.json'), pack('vet'))
  write(join(root, 'local', 'vet', 'domains', 'bad.json'), { v: 1, id: 'bad', name: { en: 'x' }, cron: '* * * * *' })
  write(join(root, 'local', 'vet', 'domains', 'notes.txt'), 'not a contribution')
  const p = only(registry)
  check('seen for the first time: it is off', p !== undefined && p.status === 'disabled' && p.enabled === false && p.level === 'local')
  check('nothing is contributed while it is off', registry.contributions('kybernos/core#domain-pack').length === 0)
  check('it is switched on', registry.setEnabled('local/vet', true) === true && only(registry).status === 'ok' && only(registry).enabled === true)
  const got = registry.contributions('kybernos/core#domain-pack')
  check('its valid file is contributed, with where it came from', got.length === 1 && got[0].plugin === 'local/vet' && got[0].level === 'local' && got[0].class === 'instruction' && got[0].file === 'domains/vet.json' && got[0].value.id === 'vet', got)
  const ext = only(registry).extends[0]
  check('the file the check refused is listed with its reason, and the .txt is ignored', ext.contributions === 1 && ext.rejected.length === 1 && ext.rejected[0].file === 'bad.json' && /unknown key "cron"/.test(ext.rejected[0].errors[0]), ext)
  check('the choice is kept in a file only its owner reads', (statSync(stateFile).mode & 0o777) === 0o600 && JSON.parse(readFileSync(stateFile, 'utf8')).enabled['local/vet'] === true)
  const again = createRegistry({ root, stateFile, kybernosVersion: '0.1.1', ttlMs: 0 })
  again.definePoint(DEFINE)
  check('a new process finds it still on', again.plugins().find((x) => x.id === 'local/vet').status === 'ok')
  check('the value handed out is a copy: changing it does not change the next answer', (() => { registry.contributions('kybernos/core#domain-pack')[0].value.name.en = 'changed'; return true })() && registry.contributions('kybernos/core#domain-pack')[0].value.name.en === 'Vet')
  check('off again: nothing contributed, the choice forgotten', registry.setEnabled('local/vet', false) === true && registry.contributions('kybernos/core#domain-pack').length === 0 && JSON.parse(readFileSync(stateFile, 'utf8')).enabled['local/vet'] === undefined)
  check('an unknown plugin cannot be switched', registry.setEnabled('local/nobody', true) === false && registry.setEnabled('not an id', true) === false && registry.setEnabled('local/vet', 'yes') === false)
  check('the points are listed with their counts', (registry.setEnabled('local/vet', true), registry.points().some((x) => x.id === 'kybernos/core#domain-pack' && x.contributions === 1 && x.class === 'instruction')))
}

console.log('a folder dropped in later shows up after the scan lifetime, not before')
{
  let clock = 0
  const { root, registry } = fresh({ ttlMs: 2000, now: () => clock })
  registry.plugins()
  write(join(root, 'local', 'vet', 'plugin.json'), manifest())
  const soon = registry.plugins().length
  clock = 2500
  check('within the lifetime the last scan is reused, after it the folder is read again', soon === 0 && registry.plugins().length === 1)
  registry.refresh()
  clock = 2600
  check('refresh() forgets the scan at once', registry.plugins().length === 1)
}

console.log('statuses: the first thing wrong, in the contract\'s order')
{
  const { root, registry } = fresh()
  const put = (name, m, files = true) => { write(join(root, 'local', name, 'plugin.json'), m); if (files) write(join(root, 'local', name, 'domains', name + '.json'), pack(name)); registry.setEnabled('local/' + name, true) }
  const st = (name) => registry.plugins().find((p) => p.id === 'local/' + name)
  put('fine', manifest({ id: 'local/fine' }))
  put('future', manifest({ id: 'local/future', requires: { kybernos: '^9.0', plugins: { 'kybernos/core': '^1.0' } } }))
  put('olddsh', manifest({ id: 'local/olddsh', requires: { dsh: { min: '0.1.0', max: '0.1.5' }, kybernos: '^0.1', plugins: { 'kybernos/core': '^1.0' } } }))
  put('nopoint', manifest({ id: 'local/nopoint', extends: [{ point: 'kybernos/core#team-template', range: '^1.0', dir: 'domains' }] }))
  put('wrongmajor', manifest({ id: 'local/wrongmajor', extends: [{ point: 'kybernos/core#domain-pack', range: '^2.0', dir: 'domains' }] }))
  put('needscore', manifest({ id: 'local/needscore', requires: { plugins: { 'kybernos/core': '^3.0' } } }))
  put('needsother', manifest({ id: 'local/needsother', requires: { plugins: { 'kybernos/core': '^1.0', 'kybernos/dashboards': '^1.0' } } }))
  check('fine is ok', st('fine').status === 'ok')
  check('a plugin that needs a newer Kybernos says so', st('future').status === 'needs-kybernos' && /\^9\.0.*0\.1\.1/.test(st('future').reason), st('future'))
  check('DSH is not judged without a known DSH version', st('olddsh').status === 'ok')
  check('DSH is judged when its version is known', (() => { const r = fresh({ dshVersion: '0.2.1-rc.2' }); r.registry.setEnabled; write(join(r.root, 'local', 'olddsh', 'plugin.json'), manifest({ id: 'local/olddsh', requires: { dsh: { min: '0.1.0', max: '0.1.5' }, kybernos: '^0.1', plugins: { 'kybernos/core': '^1.0' } } })); write(join(r.root, 'local', 'olddsh', 'domains', 'olddsh.json'), pack('olddsh')); return r.registry.plugins()[0].status === 'needs-dsh' })())
  check('an extension of a point nobody defined is a missing dependency', st('nopoint').status === 'missing-dependency' && /team-template/.test(st('nopoint').reason), st('nopoint'))
  check('a point of another major is an incompatible point', st('wrongmajor').status === 'incompatible-point', st('wrongmajor'))
  check('a plugin of the right owner but the wrong version is a missing dependency', st('needscore').status === 'missing-dependency' && /\^3\.0/.test(st('needscore').reason), st('needscore'))
  check('an owner nobody provides is a missing dependency', st('needsother').status === 'missing-dependency')
  check('only the plugins that are fine contribute (fine, and olddsh while DSH\'s version is unknown)', registry.contributions('kybernos/core#domain-pack').map((c) => c.plugin).join() === 'local/fine,local/olddsh', registry.contributions('kybernos/core#domain-pack').map((c) => c.plugin))
}

console.log('a folder that cannot be a plugin is listed as invalid, never an error')
{
  const { root, registry } = fresh()
  const bad = (name, content) => write(join(root, 'local', name, 'plugin.json'), content)
  bad('notjson', '{ nope')
  bad('array', '[]')
  bad('unknownkey', { ...manifest({ id: 'local/unknownkey' }), scripts: { postinstall: 'rm -rf /' } })
  bad('wrongid', manifest({ id: 'local/other' }))
  bad('code', { ...manifest({ id: 'local/code', kind: 'code' }), package: '@local/x', entry: { host: 'index.js' }, extends: undefined })
  bad('exec', manifest({ id: 'local/exec', permissions: ['exec'] }))
  write(join(root, 'local', 'nomanifest', 'readme.txt'), 'hello')
  write(join(root, 'acme', 'vet', 'plugin.json'), manifest({ id: 'acme/vet', author: { id: 'acme', name: 'Acme' } }))
  write(join(root, 'kybernos', 'sneaky', 'plugin.json'), manifest({ id: 'kybernos/sneaky', author: { id: 'kybernos', name: 'Kybernos' }, name: { en: 'Sneaky', fr: 'Sournois' }, description: { en: 'Claims our namespace.', fr: 'Prend notre espace.' } }))
  const by = (id) => registry.plugins().find((p) => p.id === id)
  const why = (id) => (by(id)?.errors ?? []).join(' | ')
  check('not JSON', by('local/notjson').status === 'invalid' && /not valid JSON/.test(why('local/notjson')))
  check('not an object', by('local/array').status === 'invalid')
  check('an unknown key is refused (no postinstall, no scripts)', by('local/unknownkey').status === 'invalid' && /not a known key/.test(why('local/unknownkey')), why('local/unknownkey'))
  check('an id that is not the folder', by('local/wrongid').status === 'invalid' && /is not the folder/.test(why('local/wrongid')), why('local/wrongid'))
  check('a code plugin is not loaded from this folder', by('local/code').status === 'invalid', why('local/code'))
  check('a data plugin cannot ask for exec', by('local/exec').status === 'invalid' && /permissions/.test(why('local/exec')), why('local/exec'))
  check('a folder with no manifest', by('local/nomanifest').status === 'invalid' && /is missing/.test(why('local/nomanifest')))
  check('another author is not read before the signed catalogue exists', by('acme/vet').status === 'invalid' && /only "local" folders/.test(why('acme/vet')), why('acme/vet'))
  check('the kybernos namespace cannot be claimed from a folder', by('kybernos/sneaky').status === 'invalid' && /reserved/.test(why('kybernos/sneaky')), why('kybernos/sneaky'))
  check('an invalid plugin can never be switched on into contributing', (registry.setEnabled('local/wrongid', true), registry.contributions('kybernos/core#domain-pack').length === 0))
  check('every one of them was listed, none threw', registry.plugins().length === 9)
}

console.log('a hostile folder')
{
  const { dir, root, registry } = fresh()
  const outside = join(dir, 'outside')
  write(join(outside, 'stolen.json'), pack('stolen'))
  write(join(root, 'local', 'vet', 'plugin.json'), manifest())
  // a symbolic link as the contributions folder, as a contribution file, and as the whole plugin folder
  symlinkSync(outside, join(root, 'local', 'vet', 'domains'))
  registry.setEnabled('local/vet', true)
  check('a contributions folder that is a symbolic link is not followed', only(registry).status === 'ok' && registry.contributions('kybernos/core#domain-pack').length === 0 && /not a folder of this plugin/.test(JSON.stringify(only(registry).extends[0].rejected)))
  const { root: root2, registry: registry2 } = fresh()
  write(join(root2, 'local', 'vet', 'plugin.json'), manifest())
  mkdirSync(join(root2, 'local', 'vet', 'domains'), { recursive: true })
  symlinkSync(join(outside, 'stolen.json'), join(root2, 'local', 'vet', 'domains', 'stolen.json'))
  registry2.setEnabled('local/vet', true)
  check('a contribution file that is a symbolic link is not read', registry2.contributions('kybernos/core#domain-pack').length === 0 && /symbolic link/.test(JSON.stringify(only(registry2).extends[0].rejected)))
  const { root: root3, registry: registry3 } = fresh()
  mkdirSync(join(root3, 'local'), { recursive: true })
  symlinkSync(join(dir, 'outside'), join(root3, 'local', 'linked'))
  check('a plugin folder that is a symbolic link is refused', registry3.plugins().length === 1 && registry3.plugins()[0].status === 'invalid' && /symbolic link/.test(registry3.plugins()[0].errors[0]))
  const { root: root4, registry: registry4 } = fresh()
  write(join(root4, 'local', 'vet', 'plugin.json'), manifest())
  write(join(root4, 'local', 'vet', 'domains', 'vet.json'), '{"v":1,"id":"vet","name":{"en":"x"},' + '"pad":"' + 'x'.repeat(LIMITS.file) + '"}')
  write(join(root4, 'local', 'vet', 'domains', 'proto.json'), '{"v":1,"id":"proto","__proto__":{"polluted":true},"name":{"en":"x"}}')
  registry4.setEnabled('local/vet', true)
  const r4 = only(registry4).extends[0]
  check('a contribution over the size bound is refused unread', r4.rejected.some((x) => x.file === 'vet.json' && /larger than/.test(x.errors[0])), r4.rejected.map((x) => x.file + ':' + x.errors[0]))
  check('a file that smuggles a __proto__ key is refused by the check, and nothing is polluted', r4.rejected.some((x) => x.file === 'proto.json') && ({}).polluted === undefined, r4.rejected.map((x) => x.file))
  const { root: rootN, registry: registryN } = fresh()
  write(join(rootN, 'local', 'vet', 'plugin.json'), manifest())
  for (let i = 0; i < 40; i += 1) write(join(rootN, 'local', 'vet', 'domains', 'f' + String(i).padStart(2, '0') + '.json'), pack('f' + String(i).padStart(2, '0')))
  registryN.setEnabled('local/vet', true)
  const rN = only(registryN).extends[0]
  check('no more files than the point allows are read', rN.contributions === LIMITS.files && rN.rejected.some((x) => /holds more than/.test(x.errors[0])), { read: rN.contributions })
  const big = join(root4, 'local', 'big', 'plugin.json')
  write(big, '{"pad":"' + 'x'.repeat(LIMITS.manifest) + '"}')
  check('a manifest over the size bound is not parsed', registry4.plugins().find((p) => p.id === 'local/big').status === 'invalid' && /larger than/.test(registry4.plugins().find((p) => p.id === 'local/big').errors[0]))
  check('a dir that tries to leave the plugin is refused by the manifest check', (() => { const { root: r5, registry: g5 } = fresh(); write(join(r5, 'local', 'esc', 'plugin.json'), manifest({ id: 'local/esc', extends: [{ point: 'kybernos/core#domain-pack', range: '^1.0', dir: '../../outside' }] })); const e = g5.plugins().find((p) => p.id === 'local/esc'); return e.status === 'invalid' })())
  check('readBounded refuses a directory and a missing file', readBounded(root, 100).error === 'is not a file' && readBounded(join(root, 'nope'), 100).error === 'is missing')
}

console.log('nothing in a plugin folder is ever run')
{
  const { dir, root, registry } = fresh()
  const marker = join(dir, 'RAN')
  write(join(root, 'local', 'vet', 'plugin.json'), manifest())
  write(join(root, 'local', 'vet', 'domains', 'vet.json'), pack('vet'))
  for (const f of ['index.js', 'client.js', 'install.mjs', 'domains/hook.js', 'domains/hook.mjs']) write(join(root, 'local', 'vet', f), "import { writeFileSync } from 'node:fs'; writeFileSync(" + JSON.stringify(marker) + ", 'ran')")
  registry.setEnabled('local/vet', true)
  registry.plugins(); registry.contributions('kybernos/core#domain-pack')
  check('a script next to the manifest is never imported', existsSync(marker) === false)
  const sources = ['registry.mjs', 'host.mjs', 'manifest.mjs', 'schema-subset.mjs', 'version.mjs', 'index.js'].map((f) => [f, readFileSync(join(HERE, f), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')])
  const forbidden = /\bimport\s*\(|\beval\s*\(|new\s+Function\b|child_process|\brequire\s*\(|\bvm\./
  check('the registry\'s own code has no dynamic import, eval, Function, vm or child_process', sources.every(([f, s]) => !forbidden.test(s)), sources.filter(([f, s]) => forbidden.test(s)).map(([f]) => f))
  check('scanFolder alone never throws on a root that is a file or missing', scanFolder(join(dir, 'plugins-state.json')).length === 0 && scanFolder(join(dir, 'nope')).length === 0)
}

console.log('points')
{
  const { registry } = fresh()
  const bad = (d) => { try { registry.definePoint(d); return false } catch (e) { return /a point needs/.test(e.message) } }
  check('a point without a validator, a code point, or a bad id is refused', bad({ ...DEFINE, validate: undefined }) && bad({ ...DEFINE, kind: 'code' }) && bad({ ...DEFINE, owner: 'nope' }) && bad({ ...DEFINE, version: '1' }) && bad({ ...DEFINE, class: 'safe' }))
  registry.definePoint({ ...DEFINE, version: '1.1' })
  check('defining a point again replaces it', registry.points().filter((p) => p.id === 'kybernos/core#domain-pack').length === 1 && registry.points()[0].version === '1.1')
  check('a validator that throws is a refused file, not an error', (() => { const { root, registry: r } = fresh(); r.definePoint({ ...DEFINE, validate: () => { throw new Error('boom') } }); write(join(root, 'local', 'vet', 'plugin.json'), manifest()); write(join(root, 'local', 'vet', 'domains', 'vet.json'), pack('vet')); r.setEnabled('local/vet', true); return only(r).extends[0].rejected[0].errors[0] === 'the check itself failed' })())
}

console.log('what is logged')
{
  const { root, registry } = fresh()
  write(join(root, 'local', 'vet', 'plugin.json'), manifest())
  write(join(root, 'local', 'vet', 'domains', 'bad.json'), '{ nope')
  registry.setEnabled('local/vet', true)
  registry.plugins()
  const before = warnings.length
  registry.plugins(); registry.plugins(); registry.contributions('kybernos/core#domain-pack')
  check('a refused file is logged once per registry, not at every scan', before >= 1 && warnings.length === before, { before, after: warnings.length })
}

console.log('the schema a person reads is the schema the registry runs')
{
  const docs = readFileSync(join(HERE, '..', '..', 'docs', 'dev', 'schemas', 'plugin.schema.json'), 'utf8')
  const mine = readFileSync(join(HERE, 'plugin.schema.json'), 'utf8')
  check('docs/dev/schemas/plugin.schema.json and the bundle\'s copy are identical', docs === mine)
}

console.log(failed === 0 ? '\nREGISTRY OK' : '\nREGISTRY: ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
