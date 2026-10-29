// The three business points (kybernos/contacts#schema, kybernos/catalog#type, kybernos/pipeline#flow) across the repository: the checks the three
// plugins share are really the same text, the points they declare are the ones they export, the real registry accepts a theme that extends them
// (and says why when it cannot), and `plugin-check` reads a business theme and fails each broken variant on its own point.
//
// Hermetic: temp folders only. A test may reach across bundles; the plugins' code never does.
//
//   node scripts/test-business-points.mjs
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRegistry } from '../packages/kybernos-registry/registry.mjs'
import { CONTACTS_POINT, CONTACTS_POINT_REF } from '../packages/kybernos-contacts/contacts-schema.mjs'
import { CATALOG_POINT, CATALOG_POINT_REF } from '../packages/kybernos-catalog/catalog-type.mjs'
import { PIPELINE_POINT, PIPELINE_POINT_REF } from '../packages/kybernos-pipeline/pipeline-flow.mjs'
import { checkFolder, declaredPoints } from './plugin-check.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE = join(REPO, 'docs', 'dev', 'templates', 'acme-garden-shop')
const PLUGINS = [
  { dir: 'kybernos-contacts', file: 'contacts-schema.mjs', point: CONTACTS_POINT, ref: CONTACTS_POINT_REF, name: 'schema' },
  { dir: 'kybernos-catalog', file: 'catalog-type.mjs', point: CATALOG_POINT, ref: CATALOG_POINT_REF, name: 'type' },
  { dir: 'kybernos-pipeline', file: 'pipeline-flow.mjs', point: PIPELINE_POINT, ref: PIPELINE_POINT_REF, name: 'flow' },
]
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const source = (p) => readFileSync(join(REPO, 'packages', p.dir, p.file), 'utf8')
const between = (text, from, to) => { const i = text.indexOf(from); const j = text.indexOf(to, i); return i < 0 || j < 0 ? null : text.slice(i, j + to.length) }

ok('the shared checks are the same text in the three plugins (and the field checks in the two that have fields)', () => {
  const A = PLUGINS.map((p) => between(source(p), '// ── shared checks: the SAME text', '// ── end of the shared checks ──'))
  assert.ok(A.every((x) => x !== null && x.length > 800), 'the marked block is there in each file')
  assert.equal(A[1], A[0], 'catalog drifted from contacts')
  assert.equal(A[2], A[0], 'pipeline drifted from contacts')
  const B = PLUGINS.slice(0, 2).map((p) => between(source(p), '// ── shared checks for fields', '// ── end of the shared checks for fields'))
  assert.ok(B.every((x) => x !== null && x.length > 800))
  assert.equal(B[1], B[0], 'the field checks drifted between contacts and catalog')
  assert.equal(between(source(PLUGINS[2]), '// ── shared checks for fields', '// ──'), null, 'the pipeline has no fields: no copy of their checks')
})

ok('the way each plugin tells its point to the registry is the same text in the three hosts, and it names only its own point', () => {
  const hosts = PLUGINS.map((p) => readFileSync(join(REPO, 'packages', p.dir, 'index.js'), 'utf8'))
  const telling = hosts.map((t, i) => between(t, '// ── telling the registry', '// ── end of the telling'))
  assert.ok(telling.every((x) => x !== null && x.length > 900), 'the marked block is there in each host')
  const own = (text, i) => text.replace(new RegExp(PLUGINS[i].point.name === 'schema' ? 'CONTACTS_POINT' : PLUGINS[i].point.name === 'type' ? 'CATALOG_POINT' : 'PIPELINE_POINT', 'g'), 'THE_POINT')
  assert.equal(own(telling[1], 1), own(telling[0], 0), 'catalog drifted from contacts')
  assert.equal(own(telling[2], 2), own(telling[0], 0), 'pipeline drifted from contacts')
  hosts.forEach((t, i) => {
    assert.match(t, /^export function apply \(ctx, options\)/m)
    for (const other of PLUGINS.filter((_, j) => j !== i)) assert.doesNotMatch(t, new RegExp(other.point.owner.replace('/', '\\/')), PLUGINS[i].dir + ' does not name ' + other.dir)
  })
})

ok('the plugins do not import one another, nor the core: each reaches the others through the registry seam only', () => {
  for (const p of PLUGINS) {
    for (const f of [p.file, 'index.js', 'client.js']) {
      const imports = [...readFileSync(join(REPO, 'packages', p.dir, f), 'utf8').matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
      assert.ok(imports.every((x) => x.startsWith('./') || x.startsWith('node:')), p.dir + '/' + f + ' imports ' + imports.filter((x) => !x.startsWith('./') && !x.startsWith('node:')).join(', '))
    }
  }
})

ok('what each plugin declares in plugin.json is what its module exports, and plugin-check can see the validator', () => {
  const declared = declaredPoints(REPO)
  for (const p of PLUGINS) {
    const pj = JSON.parse(readFileSync(join(REPO, 'packages', p.dir, 'plugin.json'), 'utf8'))
    assert.equal(pj.provides.length, 1)
    assert.deepEqual([pj.id + '#' + pj.provides[0].name, pj.provides[0].version, pj.provides[0].kind, pj.provides[0].class], [p.ref, p.point.version, p.point.kind, p.point.class])
    assert.equal(p.point.owner + '#' + p.point.name, p.ref)
    assert.equal(p.point.name, p.name)
    const entry = declared.get(p.ref)
    assert.ok(entry !== undefined, p.ref + ' is declared')
    assert.equal(entry.validate, p.point.validate, 'plugin-check uses the same check as the registry')
    assert.deepEqual(pj.requires.plugins, { 'kybernos/core': '^1.0' })
    assert.equal(pj.suite.default, 'off')
    assert.deepEqual(pj.claims.routePrefixes, ['/' + p.dir])
  }
})

ok('plugin-check reads the business starter: every business point passes, and nothing else is asked of it', () => {
  const r = checkFolder(TEMPLATE)
  assert.equal(r.exitCode, 0, JSON.stringify(r.lines.filter((l) => l.status === 'FAIL')))
  assert.deepEqual(r.lines.filter((l) => l.status === 'FAIL'), [])
  assert.deepEqual(r.lines.filter((l) => /^point\./.test(l.id)).map((l) => [l.id, l.status]), [['point.schema', 'PASS'], ['point.type', 'PASS'], ['point.flow', 'PASS']])
  assert.equal(r.lines.find((l) => l.id === 'manifest.points').status, 'PASS')
  assert.match(r.lines.find((l) => l.id === 'manifest.points').message, /requires\.plugins covers their owners/)
})

ok('each broken variant fails on its own point, and on nothing else', () => {
  const expected = { '01-contacts-bad-kind': 'point.schema', '02-catalog-card-unknown-field': 'point.type', '03-pipeline-one-stage': 'point.flow' }
  const found = readdirSync(join(TEMPLATE, 'broken')).sort()
  assert.deepEqual(found, Object.keys(expected).sort(), 'the table and the folder agree')
  for (const [name, id] of Object.entries(expected)) {
    const r = checkFolder(join(TEMPLATE, 'broken', name))
    assert.equal(r.exitCode, 1, name)
    assert.deepEqual(r.lines.filter((l) => l.status === 'FAIL').map((l) => l.id), [id], name)
  }
})

ok('the real registry: a business theme is refused until the owners tell their points, then accepted, with the bad file left out and its reason given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-business-points-'))
  try {
    const profileDir = join(dir, 'profile')
    const folder = join(profileDir, 'node_modules', '@acme', 'kybernos-garden-shop')
    mkdirSync(folder, { recursive: true })
    cpSync(TEMPLATE, folder, { recursive: true, filter: (src) => !src.includes('/broken') })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dependencies: { '@acme/kybernos-garden-shop': '1.0.0' }, dsh: { profile: { bundles: ['@acme/kybernos-garden-shop'] } } }))
    writeFileSync(join(folder, 'catalog', 'bad.json'), JSON.stringify({ id: 'bad', label: { en: 'Bad' }, plural: { en: 'Bads' }, statuses: [], icon: 'rocket' }))
    const registry = createRegistry({ profileDir, stateFile: join(dir, 'state.json'), kybernosVersion: '0.1.1', ttlMs: 0 })
    const me = () => registry.plugins().find((p) => p.id === 'acme/garden-shop')
    assert.equal(me().status, 'missing-dependency', 'no owner has told its point yet')
    assert.match(me().reason, /needs kybernos\/(contacts|catalog|pipeline), which is not available/)
    registry.definePoint(CONTACTS_POINT)
    registry.definePoint(CATALOG_POINT)
    assert.equal(me().status, 'missing-dependency', 'two of three is not enough')
    registry.definePoint(PIPELINE_POINT)
    registry.definePoint(PIPELINE_POINT) // told again at each question: nothing changes
    assert.equal(me().status, 'ok', me().reason + ' — an inert point needs no consent')
    const byPoint = (ref) => me().extends.find((e) => e.point === ref)
    assert.deepEqual([CONTACTS_POINT_REF, CATALOG_POINT_REF, PIPELINE_POINT_REF].map((r) => byPoint(r).contributions), [1, 1, 1])
    const rejected = byPoint(CATALOG_POINT_REF).rejected
    assert.ok(rejected.some((r) => r.file === 'bad.json' && /icon: one of/.test(r.errors.join(' | ')) && /statuses: a list of 1 to 12/.test(r.errors.join(' | '))), JSON.stringify(rejected))
    const plant = registry.contributions(CATALOG_POINT_REF)
    assert.deepEqual(plant.map((c) => [c.plugin, c.file, c.class]), [['acme/garden-shop', 'catalog/plant.json', 'inert']])
    assert.deepEqual(plant[0].value.card.flag, { field: 'stock', label: { en: 'Only {n} left', fr: 'Plus que {n}' }, lte: 5 })
    assert.deepEqual(registry.contributions(PIPELINE_POINT_REF)[0].value.stages.map((s) => s.key), ['new', 'paid', 'packed', 'shipped'])
    assert.equal(registry.contributions(CONTACTS_POINT_REF)[0].value.types[1].kind, 'company')
    // a point of an older owner than the theme wants is said, not guessed
    const strict = createRegistry({ profileDir, stateFile: join(dir, 'state2.json'), kybernosVersion: '0.1.1', ttlMs: 0 })
    strict.definePoint({ ...CONTACTS_POINT, ownerVersion: '0.9.0' }); strict.definePoint(CATALOG_POINT); strict.definePoint(PIPELINE_POINT)
    assert.match(strict.plugins().find((p) => p.id === 'acme/garden-shop').reason, /needs kybernos\/contacts \^1\.0 \(this is 0\.9\.0\)/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

ok('the starter holds no media, no personal path, and no code', () => {
  const walk = (base) => readdirSync(base, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(base, e.name)) : [join(base, e.name)]))
  for (const f of walk(TEMPLATE)) {
    assert.match(f, /\.(json|md|yml)$/, f + ' is text')
    assert.doesNotMatch(readFileSync(f, 'utf8'), /\/Users\//, f)
  }
})

console.log('\n' + count + ' checks passed')
