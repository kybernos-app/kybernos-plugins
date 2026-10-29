// The theme installer (A6-theme-installer, docs/tests/A6-theme-installer-strategy.md): the signed catalogue, the plan, the
// record, the route body — and the applier the page carries in `// KB-TH-CORE` (client.js).
//
//   node packages/kybernos-plugin/test-theme-installer.mjs
//
// The page's applier is imported from the real client.js source, the way scripts/test-onboarding.mjs extracts KB-OB-CORE: what
// is tested is the code the browser runs, not a copy of it.
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as T from './theme-installer.mjs'
import { dataPackageProblems } from '../kybernos-registry/registry.mjs' // a test may reach across bundles; the code never does

const here = fileURLToPath(new URL('.', import.meta.url))
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const okA = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
const fresh = (prefix) => mkdtempSync(join(tmpdir(), prefix))

/* ── the keys and the documents the contract signs (plugin-contract.md §9-10) ── */
const pair = () => { const kp = generateKeyPairSync('ed25519'); return { kp, pem: kp.publicKey.export({ format: 'pem', type: 'spki' }) } }
const acme = pair()
const reviewer = pair()
const official = pair()
const stranger = pair()
const sigOf = (p, message) => sign(null, Buffer.from(String(message)), p.kp.privateKey).toString('base64')
const shaOf = (b) => createHash('sha256').update(b).digest('hex')
const ARCHIVE = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.alloc(96, 9)])
const HASH = shaOf(ARCHIVE)
const authorMsg = (id, version, hash) => 'kybernos-plugin-v1\n' + id + '\n' + version + '\n' + hash
const reviewMsg = (id, version, hash) => 'kybernos-plugin-review-v1\n' + id + '\n' + version + '\n' + hash + '\nverified'
const entryOf = (id, author = acme, rev = reviewer, hash = HASH, version = '1.0.0') => ({
  version,
  manifest: { id, kind: 'data', name: { en: 'Clinic' } },
  archive: { url: 'https://example.invalid/vet.tgz', sha256: hash, size: ARCHIVE.length },
  authorSig: sigOf(author, authorMsg(id, version, hash)),
  ...(rev === null ? {} : { review: sigOf(rev, reviewMsg(id, version, hash)) }),
})
const docOf = (over = {}) => Object.assign({
  schema: 1,
  kind: 'kybernos-plugin-catalogue',
  catalogue: { id: 'official', name: 'Kybernos', seq: 7, publishedAt: '2026-10-27T00:00:00Z' },
  authors: { acme: { keys: [{ keyId: 'a1', pem: acme.pem }] } },
  reviewers: [{ keyId: 'r1', pem: reviewer.pem }],
  plugins: [{ id: 'acme/vet', versions: [entryOf('acme/vet')] }],
  revoked: [],
  revokedKeys: [],
}, over)
const bytesOf = (doc) => Buffer.from(JSON.stringify(doc))
const CAT_KEYS = [{ keyId: 'k1', pem: official.pem }]
const signed = (doc, p = official) => sigOf(p, bytesOf(doc))

/* ═══ the catalogue ═══════════════════════════════════════════════════════ */
ok('a valid signed catalogue is accepted, and its key id comes back', () => {
  const doc = docOf()
  const r = T.verifyCatalogue({ bytes: bytesOf(doc), signature: signed(doc), keys: CAT_KEYS, floor: null })
  assert.equal(r.ok, true)
  assert.equal(r.doc.catalogue.seq, 7)
  assert.equal(r.key, 'k1')
})
ok('the signature is checked BEFORE the document is parsed', () => {
  // A body that is not JSON at all, with no signature: `signature` — never `json`, which would mean it was parsed.
  assert.equal(T.verifyCatalogue({ bytes: Buffer.from('not json at all'), signature: '', keys: CAT_KEYS, floor: null }).error, 'signature')
  // And a signed non-JSON body reaches the parser and says so.
  const junk = Buffer.from('{oops')
  assert.equal(T.verifyCatalogue({ bytes: junk, signature: sigOf(official, junk), keys: CAT_KEYS, floor: null }).error, 'json')
})
ok('a tampered byte breaks the signature', () => {
  const doc = docOf()
  const b = bytesOf(doc)
  b[b.length - 3] = b[b.length - 3] === 0x7d ? 0x20 : 0x7d
  assert.equal(T.verifyCatalogue({ bytes: b, signature: signed(doc), keys: CAT_KEYS, floor: null }).error, 'signature')
})
ok('a document signed by a key nobody pinned is refused, and no key is named `no-key`', () => {
  const doc = docOf()
  assert.equal(T.verifyCatalogue({ bytes: bytesOf(doc), signature: signed(doc, stranger), keys: CAT_KEYS, floor: null }).error, 'signature')
  assert.equal(T.verifyCatalogue({ bytes: bytesOf(doc), signature: signed(doc), keys: [], floor: null }).error, 'no-key')
})
ok('an older seq than the cached copy is a replay (`older`)', () => {
  const doc = docOf()
  assert.equal(T.verifyCatalogue({ bytes: bytesOf(doc), signature: signed(doc), keys: CAT_KEYS, floor: { seq: 7 } }).ok, true)
  assert.equal(T.verifyCatalogue({ bytes: bytesOf(doc), signature: signed(doc), keys: CAT_KEYS, floor: { seq: 8 } }).error, 'older')
})
ok('the shape is checked after the signature: kind, schema, seq, duplicate', () => {
  const bad = (doc) => { const b = bytesOf(doc); return T.verifyCatalogue({ bytes: b, signature: sigOf(official, b), keys: CAT_KEYS, floor: null }).error }
  assert.equal(bad(docOf({ kind: 'something-else' })), 'kind')
  assert.equal(bad(docOf({ schema: 2 })), 'schema')
  assert.equal(bad(docOf({ catalogue: { id: 'official', seq: 0 } })), 'seq')
  assert.equal(bad(docOf({ plugins: [{ id: 'acme/vet', versions: [] }, { id: 'acme/vet', versions: [] }] })), 'duplicate')
  assert.equal(bad(docOf({ plugins: [{ id: 'acme/vet', versions: [entryOf('acme/vet'), entryOf('acme/vet')] }] })), 'duplicate')
  assert.equal(bad(docOf({ plugins: [{ id: 'not an owner', versions: [] }] })), 'schema')
})
ok('a document over the cap is refused before anything else (`size`)', () => {
  const big = Buffer.alloc(T.MAX_DOC_BYTES + 1, 0x20)
  assert.equal(T.verifyCatalogue({ bytes: big, signature: 'x', keys: CAT_KEYS, floor: null }).error, 'size')
})
ok('verifyCatalogue never throws on garbage', () => {
  for (const junk of [null, undefined, 'x', 42, {}, { bytes: 'x' }, { bytes: Buffer.from('{}'), signature: 42, keys: 'x' }]) {
    const r = T.verifyCatalogue(junk)
    assert.equal(typeof r, 'object')
    assert.equal(r.ok, false)
    assert.equal(typeof r.error, 'string')
  }
})

/* ═══ one entry, one archive ══════════════════════════════════════════════ */
const entryArgs = (over = {}) => Object.assign({ id: 'acme/vet', version: '1.0.0', entry: entryOf('acme/vet'), catalogueKey: 'k1', keys: [{ keyId: 'a1', pem: acme.pem }], reviewerKeys: [{ keyId: 'r1', pem: reviewer.pem }], officialKeys: ['k1'] }, over)
ok('an author- and reviewer-signed entry is Verified, on its own hash', () => {
  const r = T.verifyEntry(entryArgs())
  assert.equal(r.ok, true)
  assert.equal(r.level, 'verified')
  assert.equal(r.sha256, HASH)
})
ok('the kybernos namespace, signed by an official key of the source, is Official', () => {
  const r = T.verifyEntry(entryArgs({ id: 'kybernos/vet', entry: entryOf('kybernos/vet') }))
  assert.equal(r.level, 'official')
  // the same entry from a source whose key is not official falls back to what the signatures earn
  assert.equal(T.verifyEntry(entryArgs({ id: 'kybernos/vet', entry: entryOf('kybernos/vet'), catalogueKey: 'k2' })).level, 'verified')
})
ok('an author-only entry is Community, and a source is never inherited from another version', () => {
  const r = T.verifyEntry(entryArgs({ catalogueKey: 'k2', entry: entryOf('acme/vet', acme, null) }))
  assert.equal(r.ok, true)
  assert.equal(r.level, 'community')
})
ok('an author signature made for another version is refused (`signature`)', () => {
  const entry = Object.assign({}, entryOf('acme/vet'), { authorSig: sigOf(acme, authorMsg('acme/vet', '0.9.0', HASH)) })
  assert.equal(T.verifyEntry(entryArgs({ entry })).error, 'signature')
})
ok('a missing hash is `hash`, a yanked version is `yanked`', () => {
  const noHash = Object.assign({}, entryOf('acme/vet'), { archive: { url: 'https://example.invalid/v.tgz', sha256: 'zz', size: 3 } })
  assert.equal(T.verifyEntry(entryArgs({ entry: noHash })).error, 'hash')
  assert.equal(T.verifyEntry(entryArgs({ entry: Object.assign({}, entryOf('acme/vet'), { yanked: true }) })).error, 'yanked')
})
ok('the archive is hashed and compared before the signatures are read', () => {
  const good = T.verifyArchive(Object.assign({ bytes: ARCHIVE }, entryArgs()))
  assert.equal(good.ok, true)
  assert.equal(good.level, 'verified')
  assert.equal(T.verifyArchive(Object.assign({ bytes: Buffer.concat([ARCHIVE, Buffer.from([0])]) }, entryArgs())).error, 'hash')
  const over = Object.assign({}, entryOf('acme/vet'), { archive: { url: 'https://example.invalid/v.tgz', sha256: HASH, size: T.IMPORT_MAX + 1 } })
  assert.equal(T.verifyArchive(Object.assign({ bytes: ARCHIVE }, entryArgs({ entry: over }))).error, 'size')
})
ok('revocation is read before an offer, never after an install', () => {
  const doc = docOf({ revoked: [{ id: 'acme/vet', versions: ['1.0.0'], reason: 'a defect', at: '2026-10-27', action: 'disable' }] })
  assert.deepEqual(T.revocationOf(doc, 'acme/vet', '1.0.0'), { revoked: true, reason: 'a defect', action: 'disable' })
  assert.equal(T.revocationOf(doc, 'acme/vet', '1.1.0').revoked, false)
  assert.equal(T.revocationOf(docOf({ revoked: [{ id: 'acme/vet', reason: 'warned', action: 'warn' }] }), 'acme/vet', '1.0.0').action, 'warn')
  assert.equal(T.revocationOf(null, 'acme/vet', '1.0.0').revoked, false)
})

/* ═══ the plan ════════════════════════════════════════════════════════════ */
const PACK = {
  v: 1, id: 'clinic', order: 50, accent: '#1B7F76', icon: 'heart', name: { en: 'Clinic' }, tagline: { en: 'Care' }, keywords: [],
  home: ['doc', 'sheet'], menu: { labels: { tasks: { en: 'Visits' } }, hide: ['documents'] }, mode: 'bureau', agents: { preset: 'prudent' },
  goals: [
    { id: 'recall', name: { en: 'Recall' }, skills: [{ source: 'kybernos', name: 'patient-reminders' }], teams: ['clinic-assist'], automations: [{ id: 'daily-recall', name: { en: 'Daily recall' }, prompt: { en: 'Draft only.' }, cron: '0 8 * * *' }] },
    { id: 'quiet', name: { en: 'Quiet hours' } },
  ],
}
const PREVIEW = [
  { point: 'kybernos/core#domain-pack', class: 'instruction', files: [{ file: 'domains/clinic.json', value: PACK }], rejected: [] },
  { point: 'kybernos/theme#theme', class: 'inert', files: [{ file: 'themes/clinic.json', value: { id: 'clinic-style', name: 'Clinic style', settings: { acc: '#1B7F76' } } }], rejected: [{ file: 'themes/bad.json', errors: ['accessibility setting in a catalogue theme: cbSafe'] }] },
  { point: 'kybernos/skills#skill', class: 'instruction', files: [{ file: 'skills/vet-notes', value: { name: 'vet-notes' } }], rejected: [] },
  { point: 'kybernos/core#team-template', class: 'instruction', files: [{ file: 'teams/assist.json', value: { id: 'assist', name: { en: 'Assist' } } }], rejected: [] },
  { point: 'kybernos/core#automation-template', class: 'instruction', files: [{ file: 'automations/recall.json', value: { id: 'recall-template', name: { en: 'Recall' } } }], rejected: [] },
]
ok('the plan cites every item with its file, and shows the two folders it cannot install yet', () => {
  const p = T.planTheme(PREVIEW)
  assert.equal(p.ok, true)
  assert.equal(p.id, 'clinic') // no plugin id given: only the field can be named
  assert.equal(T.planTheme(PREVIEW, 'acme/vet').id, 'acme/vet')
  assert.equal(T.planTheme(PREVIEW, '').id, 'clinic')
  assert.deepEqual([p.style.id, p.style.file], ['clinic-style', 'themes/clinic.json'])
  assert.deepEqual([p.pack.id, p.pack.file], ['clinic', 'domains/clinic.json'])
  assert.deepEqual(p.pack.words.menu.labels.tasks, { en: 'Visits' })
  assert.deepEqual(p.pack.words.home, ['doc', 'sheet'])
  assert.deepEqual(p.kit.skills.map((s) => [s.name, s.source, s.goal, s.file]), [['patient-reminders', 'kybernos', 'recall', 'domains/clinic.json']])
  assert.deepEqual(p.kit.teams.map((t) => [t.id, t.source, t.value === null, t.file]), [['clinic-assist', 'pack', true, 'domains/clinic.json'], ['assist', 'template', false, 'teams/assist.json']])
  assert.deepEqual(p.kit.automations.map((a) => [a.id, a.cron, a.file]), [['daily-recall', '0 8 * * *', 'domains/clinic.json']])
  assert.deepEqual(p.notInstallable.map((x) => [x.kind, x.file, typeof x.why === 'string']), [['skill', 'skills/vet-notes', true], ['automation', 'automations/recall.json', true]])
  assert.deepEqual(p.rejected.map((r) => r.file), ['themes/bad.json'])
  for (const item of [p.style, p.pack].concat(p.kit.skills, p.kit.teams, p.kit.automations)) assert.ok(typeof item.file === 'string' && item.file !== '', 'every item cites its file: ' + JSON.stringify(item))
})
ok('the plan is deterministic: the same preview gives byte-identical JSON', () => {
  assert.equal(JSON.stringify(T.planTheme(PREVIEW)), JSON.stringify(T.planTheme(PREVIEW)))
})
ok('a plan without a pack, with two packs, two styles, or a bad style id is refused', () => {
  assert.equal(T.planTheme([]).error, 'no-pack')
  assert.equal(T.planTheme([PREVIEW[1]]).error, 'no-pack')
  assert.equal(T.planTheme(PREVIEW.concat([PREVIEW[0]])).error, 'ambiguous')
  assert.equal(T.planTheme(PREVIEW.concat([PREVIEW[1]])).error, 'ambiguous')
  const badStyle = [{ point: 'kybernos/theme#theme', class: 'inert', files: [{ file: 'themes/x.json', value: { id: 'Not A Preset' } }], rejected: [] }, PREVIEW[0]]
  assert.equal(T.planTheme(badStyle).error, 'style')
  assert.equal(T.planTheme(null).error, 'schema')
})
ok('a theme without a style is a plan with no style, not an error', () => {
  const p = T.planTheme([PREVIEW[0]])
  assert.equal(p.ok, true)
  assert.equal(p.style, null)
})

/* ═══ the pre-install pre-check agrees with the registry's table (the anti-drift gate) ═══ */
ok('dataPluginProblems and the registry\'s dataPackageProblems agree on five fixtures', () => {
  const dir = fresh('a6-d6-')
  try {
    const cases = [
      { name: 'good', pkg: { name: '@acme/vet', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }, patch: '[]\n' },
      { name: 'client', pkg: { name: '@acme/vet', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' }, client: './client.js' } }, patch: '[]\n' },
      { name: 'scripts', pkg: { name: '@acme/vet', version: '1.0.0', scripts: { postinstall: 'node x.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }, patch: '[]\n' },
      { name: 'bin', pkg: { name: '@acme/vet', version: '1.0.0', bin: { vet: './x.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }, patch: '[]\n' },
      { name: 'patch-names', pkg: { name: '@acme/vet', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }, patch: '- id: x\n  insert: []\n' },
      { name: 'no-patch', pkg: { name: '@acme/vet', version: '1.0.0', dsh: {} }, patch: '[]\n' },
    ]
    for (const c of cases) {
      const d = join(dir, c.name)
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'cordis.patch.yml'), c.patch)
      writeFileSync(join(d, 'package.json'), JSON.stringify(c.pkg))
      const mine = T.dataPluginProblems(c.pkg, d)
      const theirs = dataPackageProblems(c.pkg, d)
      const bad = (x) => Array.isArray(x) && x.length > 0
      assert.equal(bad(mine), bad(theirs), 'the installer and the registry disagree on ' + c.name + ': ' + JSON.stringify({ mine, theirs }))
      if (c.name === 'good') assert.equal(bad(mine), false, JSON.stringify(mine))
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

/* ═══ the record file ═════════════════════════════════════════════════════ */
ok('the record file round-trips, atomically, mode 0600, one version', () => {
  const dir = fresh('a6-rec-')
  try {
    assert.deepEqual(T.readThemes(dir), { v: 1, active: null, records: [], sources: [], dropped: [] })
    const w = T.writeThemes(dir, { active: 'acme/vet', records: [{ id: 'acme/vet', version: '1.0.0', level: 'local', applied: { style: { id: 'vet', fingerprint: 'f' } } }], sources: [{ url: 'https://example.invalid/c.json' }] })
    assert.equal(w.ok, true)
    const read = T.readThemes(dir)
    assert.equal(read.v, 1)
    assert.equal(read.active, 'acme/vet')
    assert.equal(read.records.length, 1)
    assert.deepEqual(read.records[0].applied, { style: { id: 'vet', fingerprint: 'f' } })
    assert.equal(read.sources.length, 1)
    assert.equal(statSync(join(dir, 'themes.json')).mode & 0o777, 0o600)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('a corrupt, too-new or oversized file reads as empty and never throws', () => {
  const dir = fresh('a6-rec-')
  try {
    writeFileSync(join(dir, 'themes.json'), '{not json')
    assert.deepEqual(T.readThemes(dir).records, [])
    writeFileSync(join(dir, 'themes.json'), JSON.stringify({ v: 2, records: [{ id: 'acme/vet' }] }))
    assert.deepEqual(T.readThemes(dir).records, [])
    writeFileSync(join(dir, 'themes.json'), 'x'.repeat(T.THEMES_MAX_BYTES + 1))
    assert.deepEqual(T.readThemes(dir).records, [])
    assert.deepEqual(T.readThemes('/no/such/folder').records, [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('an unknown key in a record is dropped with a named line, not obeyed', () => {
  const dir = fresh('a6-rec-')
  try {
    writeFileSync(join(dir, 'themes.json'), JSON.stringify({ v: 1, active: null, records: [{ id: 'acme/vet', secret: 'x' }], sources: [] }))
    const read = T.readThemes(dir)
    assert.equal(read.records.length, 1)
    assert.equal(read.records[0].secret, undefined)
    assert.ok(read.dropped.indexOf('records[0].secret') >= 0, JSON.stringify(read.dropped))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('at most 8 records and no http source', () => {
  const dir = fresh('a6-rec-')
  try {
    const nine = []
    for (let i = 0; i < 9; i++) nine.push({ id: 'acme/t' + i })
    assert.equal(T.writeThemes(dir, { records: nine }).error, 'records')
    const w = T.writeThemes(dir, { records: [{ id: 'acme/vet' }], sources: [{ url: 'http://example.invalid/c.json' }, { url: 'https://example.invalid/c.json' }] })
    assert.equal(w.ok, true)
    assert.deepEqual(T.readThemes(dir).sources.map((s) => s.url), ['https://example.invalid/c.json'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

/* ═══ the route body ══════════════════════════════════════════════════════ */
const portsOK = () => ({ sameOrigin: () => true, session: () => true, registry: null })
ok('the guards run in the order of every write route: method, origin, session, cap, action', () => {
  const dir = fresh('a6-rt-')
  try {
    const store = { dir }
    assert.equal(T.handleThemes(store, { method: 'GET' }, portsOK()).status, 200)
    assert.equal(T.handleThemes(store, { method: 'PUT' }, portsOK()).status, 405)
    assert.equal(T.handleThemes(store, { method: 'POST', body: { action: 'source-add', url: 'https://example.invalid/c.json' } }, Object.assign(portsOK(), { sameOrigin: () => false })).status, 403)
    assert.equal(T.handleThemes(store, { method: 'POST', body: { action: 'source-add', url: 'https://example.invalid/c.json' } }, Object.assign(portsOK(), { session: () => ({ status: 401, error: 'sign-in required' }) })).status, 401)
    assert.equal(T.handleThemes(store, { method: 'POST', body: { action: 'x', pad: 'y'.repeat(300000) } }, portsOK()).status, 413)
    assert.equal(T.handleThemes(store, { method: 'POST', body: { action: 'nope' } }, portsOK()).status, 400)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('stage refuses a folder that is not a theme, a code plugin, a path going up, a package that loads code', () => {
  const dir = fresh('a6-rt-')
  try {
    const store = { dir }
    const stage = (folder) => T.handleThemes(store, { method: 'POST', body: { action: 'stage', folder } }, portsOK())
    assert.equal(stage(dir).body.error, 'not-a-theme')
    assert.equal(stage('../..').status, 400)
    // F-2: the symlink guard is lstat-based, so a link to a real folder is refused instead of silently followed.
    const linked = join(dir, 'linked')
    try { symlinkSync(dir, linked); assert.deepEqual([stage(linked).status, stage(linked).body.reason], [400, 'the folder is a symbolic link']) } catch (e) { if (e.code !== 'EPERM') throw e }
    const code = join(dir, 'code')
    mkdirSync(code)
    writeFileSync(join(code, 'plugin.json'), JSON.stringify({ contract: 1, id: 'acme/code', kind: 'code', version: '1.0.0' }))
    assert.equal(stage(code).body.error, 'code-plugin')
    const pkg = join(dir, 'pkg')
    mkdirSync(pkg)
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify({ contract: 1, id: 'acme/pkg', kind: 'data', version: '1.0.0' }))
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@acme/pkg', version: '1.0.0', scripts: { postinstall: 'node x.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    writeFileSync(join(pkg, 'cordis.patch.yml'), '[]\n')
    const refused = stage(pkg)
    assert.equal(refused.body.error, 'package')
    assert.ok(Array.isArray(refused.body.problems))
    const good = join(dir, 'good')
    mkdirSync(good)
    writeFileSync(join(good, 'plugin.json'), JSON.stringify({ contract: 1, id: 'acme/good', kind: 'data', version: '1.0.0' }))
    writeFileSync(join(good, 'package.json'), JSON.stringify({ name: '@acme/good', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    writeFileSync(join(good, 'cordis.patch.yml'), '[]\n')
    const accepted = stage(good)
    assert.equal(accepted.status, 200)
    assert.deepEqual([accepted.body.stage.id, accepted.body.stage.level], ['acme/good', 'local'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('stage refuses a package with no bundle patch, before DSH is asked: its manager would roll it back as not-bundle', () => {
  const dir = fresh('a6-rt-')
  try {
    const store = { dir }
    const plain = join(dir, 'plain')
    mkdirSync(plain)
    writeFileSync(join(plain, 'plugin.json'), JSON.stringify({ contract: 1, id: 'acme/plain', kind: 'data', version: '1.0.0' }))
    writeFileSync(join(plain, 'package.json'), JSON.stringify({ name: '@acme/plain', version: '1.0.0' }))
    const r = T.handleThemes(store, { method: 'POST', body: { action: 'stage', folder: plain } }, portsOK())
    assert.equal(r.status, 400)
    assert.equal(r.body.error, 'package')
    assert.match(r.body.reason, /only as a bundle/)
    assert.match(r.body.reason, /cordis\.patch\.yml/)
    // the helper alone: a patch path passes, anything else is named
    assert.equal(T.bundleProblem({ name: 'x', dsh: { bundle: { patch: './cordis.patch.yml' } } }), null)
    for (const bad of [{ name: 'x' }, { dsh: {} }, { dsh: { bundle: {} } }, { dsh: { bundle: { patch: 3 } } }, null, 'text']) assert.equal(typeof T.bundleProblem(bad), 'string', JSON.stringify(bad))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('the starter theme is installable: no problem for the registry, the pre-check, or DSH\'s bundle rule', () => {
  const starter = join(here, '..', '..', 'docs', 'dev', 'templates', 'acme-vet-clinic')
  const pkg = JSON.parse(readFileSync(join(starter, 'package.json'), 'utf8'))
  assert.deepEqual(T.dataPluginProblems(pkg, starter), [])
  assert.deepEqual(dataPackageProblems(pkg, starter), [])
  assert.equal(T.bundleProblem(pkg), null)
  assert.equal(readFileSync(join(starter, pkg.dsh.bundle.patch), 'utf8').replace(/#[^\n]*/g, '').replace(/\s+/g, ''), '[]')
})
ok('a record is written, read back, and forgetting it twice is a no-op', () => {
  const dir = fresh('a6-rt-')
  try {
    const store = { dir }
    const write = T.handleThemes(store, { method: 'POST', body: { action: 'record', id: 'acme/vet', applied: { style: { id: 'vet', fingerprint: 'f' } } } }, portsOK())
    assert.equal(write.status, 200)
    assert.equal(T.readThemes(dir).records.length, 1)
    assert.equal(T.handleThemes(store, { method: 'GET' }, portsOK()).body.installed[0].id, 'acme/vet')
    assert.equal(T.handleThemes(store, { method: 'POST', body: { action: 'forget', id: 'acme/vet' } }, portsOK()).status, 200)
    assert.equal(T.readThemes(dir).records.length, 0)
    const again = T.handleThemes(store, { method: 'POST', body: { action: 'forget', id: 'acme/vet' } }, portsOK())
    assert.equal(again.status, 200)
    assert.equal(again.body.already, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('the sources are https only, at most three, and a source with no pinned key is refused as unverifiable', () => {
  const dir = fresh('a6-rt-')
  try {
    const store = { dir }
    const add = (url) => T.handleThemes(store, { method: 'POST', body: { action: 'source-add', url } }, portsOK())
    assert.equal(add('http://example.invalid/c.json').status, 400)
    assert.equal(add('https://a.invalid/c.json').status, 200)
    assert.equal(add('https://a.invalid/c.json').body.already, true)
    assert.equal(add('https://b.invalid/c.json').status, 200)
    assert.equal(add('https://c.invalid/c.json').status, 200)
    assert.equal(add('https://d.invalid/c.json').body.error, 'too-many-sources')
    const get = T.handleThemes(store, { method: 'GET' }, portsOK())
    assert.equal(get.body.sources.length, 3)
    assert.deepEqual(get.body.refused.map((r) => r.error), ['no-key', 'no-key', 'no-key'])
    assert.equal(T.handleThemes(store, { method: 'POST', body: { action: 'source-remove', url: 'https://a.invalid/c.json' } }, portsOK()).body.removed, true)
    assert.equal(T.readThemes(dir).sources.length, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('a verified catalogue behind a pinned key answers its entries through the GET', () => {
  const dir = fresh('a6-rt-')
  try {
    const store = { dir }
    const doc = docOf()
    T.handleThemes(store, { method: 'POST', body: { action: 'source-add', url: 'https://a.invalid/c.json', key: { keyId: 'k1', pem: official.pem } } }, portsOK())
    const ports = Object.assign(portsOK(), { catalogues: [{ source: 'https://a.invalid/c.json', bytes: bytesOf(doc), signature: signed(doc) }] })
    const get = T.handleThemes(store, { method: 'GET' }, ports)
    assert.equal(get.body.themes.length, 1)
    assert.deepEqual([get.body.themes[0].id, get.body.themes[0].version, get.body.themes[0].source], ['acme/vet', '1.0.0', 'https://a.invalid/c.json'])
    assert.deepEqual(get.body.refused, [])
    const tampered = Object.assign(portsOK(), { catalogues: [{ source: 'https://a.invalid/c.json', bytes: Buffer.from(JSON.stringify(doc) + ' '), signature: signed(doc) }] })
    assert.equal(T.handleThemes(store, { method: 'GET' }, tampered).body.refused[0].error, 'signature')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('the level is computed by verifyEntry, never copied from the document (F-25)', () => {
  const dir = fresh('a6-trust-')
  try {
    const store = { dir }
    // The person's OWN source, pinned with ITS OWN key (TOFU): the document signs itself `level: 'official'` and the manifest
    // claims every trust word it likes. `official` needs the `kybernos/` namespace AND a shipped official key — none ships.
    const claim = { level: 'official', manifest: { level: 'official', trust: 'official', official: true } }
    const doc = docOf({ catalogue: { id: 'self', name: 'A catalogue someone added', seq: 1, publishedAt: '2026-10-28T00:00:00Z' }, authors: { kybernos: { keys: [{ keyId: 'a1', pem: acme.pem }] } }, plugins: [{ id: 'kybernos/medecin', versions: [entryOf('kybernos/medecin')] }] })
    doc.plugins[0].versions[0].level = claim.level
    Object.assign(doc.plugins[0].versions[0].manifest, claim.manifest)
    T.handleThemes(store, { method: 'POST', body: { action: 'source-add', url: 'https://self.invalid/c.json', key: { keyId: 'k1', pem: official.pem } } }, portsOK())
    const get = T.handleThemes(store, { method: 'GET' }, Object.assign(portsOK(), { catalogues: [{ source: 'https://self.invalid/c.json', bytes: bytesOf(doc), signature: signed(doc) }] }))
    assert.equal(get.body.themes.length, 1)
    assert.equal(get.body.themes[0].level, 'verified', 'the author and the reviewer signed this entry')
    assert.equal(JSON.stringify(get.body.themes[0]).indexOf('official'), -1, 'no trust word of the document survives')
    assert.equal(T.OFFICIAL_KEYS.length, 0, 'no placeholder official key ships')
    // An author signature that does not verify is refused with the verifier's own code: proof that verifyEntry ran.
    const forged = docOf({ plugins: [{ id: 'acme/vet', versions: [entryOf('acme/vet', stranger)] }] })
    const refused = T.handleThemes(store, { method: 'GET' }, Object.assign(portsOK(), { catalogues: [{ source: 'https://self.invalid/c.json', bytes: bytesOf(forged), signature: signed(forged) }] }))
    assert.equal(refused.body.themes.length, 0)
    assert.equal(refused.body.refused[0].error, 'signature')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('the production path calls the verifiers, and reads no level from the document', () => {
  const installer = readFileSync(join(here, 'theme-installer.mjs'), 'utf8')
  const route = readFileSync(join(here, 'index.js'), 'utf8')
  const view = installer.slice(installer.indexOf('const catalogueView ='), installer.indexOf('const readAll ='))
  assert.ok(/verifyEntry\s*\(/.test(view), 'catalogueView calls verifyEntry')
  assert.ok(/verifyArchive\s*\(/.test(route), 'the route caller runs verifyArchive on the fetched archive')
  assert.ok(!/newest\.level/.test(installer) && !/\.level\s*===/.test(installer), 'no level is copied from the document')
  assert.ok(/fetchCatalogueSources\s*\(/.test(route) && /themeTarget\s*\(/.test(route), 'the route passes the fetched sources, and resolves the install target from them')
})
ok('the install action stages only bytes whose verdict names them, and never unbounded', () => {
  const dir = fresh('a6-inst-')
  try {
    const store = { dir }
    const entry = entryOf('acme/vet')
    const keys = [{ keyId: 'a1', pem: acme.pem }]
    const reviewerKeys = [{ keyId: 'r1', pem: reviewer.pem }]
    const verdict = T.verifyArchive({ bytes: ARCHIVE, id: 'acme/vet', version: '1.0.0', entry, catalogueKey: 'k1', keys, reviewerKeys, officialKeys: [] })
    assert.deepEqual([verdict.ok, verdict.level, verdict.sha256], [true, 'verified', HASH])
    const install = (ports) => T.handleThemes(store, { method: 'POST', body: { action: 'install', id: 'acme/vet', version: '1.0.0' } }, Object.assign(portsOK(), ports))
    const staged = install({ archive: { id: 'acme/vet', version: '1.0.0', bytes: ARCHIVE, verified: verdict } })
    assert.equal(staged.status, 200)
    assert.equal(staged.body.ok, true)
    assert.equal(staged.body.sha256, HASH)
    assert.ok(staged.body.path.indexOf(join(dir, 'plugin-imports')) === 0 && staged.body.path.endsWith('.tgz'))
    assert.equal(readFileSync(staged.body.path).equals(ARCHIVE), true, 'the staged file is exactly the verified bytes')
    const other = T.verifyArchive({ bytes: Buffer.from('other'), id: 'acme/vet', version: '1.0.0', entry, catalogueKey: 'k1', keys, reviewerKeys, officialKeys: [] })
    assert.equal(install({ archive: { id: 'acme/vet', version: '1.0.0', bytes: ARCHIVE, verified: other } }).body.error, 'unverified')
    assert.equal(install({}).body.error, 'no-archive')
    assert.equal(T.handleThemes(store, { method: 'POST', body: { action: 'install', id: 'nope' } }, portsOK()).status, 400)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('the bounded transport refuses http, oversize and a missing signature, and never throws', async () => {
  const seen = []
  const fake = (url) => {
    seen.push(url)
    if (url === 'https://a.invalid/c.json') return Promise.resolve(new Response(bytesOf(docOf()), { status: 200 }))
    if (url === 'https://a.invalid/c.json.sig') return Promise.resolve(new Response(signed(docOf()), { status: 200 }))
    if (url === 'https://big.invalid/c.json') return Promise.resolve(new Response(Buffer.alloc(T.MAX_DOC_BYTES + 1, 0x20), { status: 200 }))
    if (url === 'https://nosig.invalid/c.json') return Promise.resolve(new Response(bytesOf(docOf()), { status: 200 }))
    if (url === 'https://arc.invalid/a.tgz') return Promise.resolve(new Response(ARCHIVE, { status: 200 }))
    if (url === 'https://huge.invalid/a.tgz') return Promise.resolve(new Response(Buffer.alloc(T.IMPORT_MAX + 1), { status: 200 }))
    return Promise.resolve(new Response('', { status: 404 }))
  }
  const out = await T.fetchCatalogueSources([
    { url: 'http://insecure.invalid/c.json' },
    { url: 'https://a.invalid/c.json' },
    { url: 'https://big.invalid/c.json' },
    { url: 'https://nosig.invalid/c.json' },
    { url: 'https://dead.invalid/c.json' },
  ], { fetch: fake, timeoutMs: 1000 })
  assert.deepEqual(out.map((r) => r.error ?? 'ok'), ['download', 'ok', 'size', 'signature', 'download'])
  assert.equal(out[1].bytes.equals(bytesOf(docOf())), true)
  assert.equal(seen.indexOf('http://insecure.invalid/c.json'), -1, 'an http address is never requested')
  assert.deepEqual([(await T.fetchArchiveBytes('https://arc.invalid/a.tgz', { fetch: fake, timeoutMs: 1000 })).ok, (await T.fetchArchiveBytes('https://huge.invalid/a.tgz', { fetch: fake, timeoutMs: 1000 })).error], [true, 'size'])
  assert.equal((await T.fetchArchiveBytes('http://insecure.invalid/a.tgz', { fetch: fake, timeoutMs: 1000 })).error, 'download')
})
ok('plan answers from the registry seam, and says so when there is none', () => {
  const dir = fresh('a6-rt-')
  try {
    const store = { dir }
    assert.equal(T.handleThemes(store, { method: 'POST', body: { action: 'plan', id: 'acme/vet' } }, portsOK()).body.error, 'no-registry')
    const registry = { preview: (id) => (id === 'acme/vet' ? PREVIEW : null) }
    const ports = Object.assign(portsOK(), { registry })
    const planned = T.handleThemes(store, { method: 'POST', body: { action: 'plan', id: 'acme/vet' } }, ports)
    assert.equal(planned.status, 200)
    // the plan is named by the PLUGIN (`acme/vet`): the page consents, records and removes by that id, never by the field's own id
    assert.equal(planned.body.plan.id, 'acme/vet')
    assert.equal(planned.body.plan.pack.id, 'clinic')
    assert.equal(T.handleThemes(store, { method: 'POST', body: { action: 'plan', id: 'acme/none' } }, ports).body.error, 'unknown-plugin')
    assert.equal(T.handleThemes(store, { method: 'POST', body: { action: 'plan', id: 'nope' } }, ports).status, 400)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
ok('handleThemes never throws on garbage, and always answers a numeric status', () => {
  const dir = fresh('a6-rt-')
  try {
    const store = { dir }
    for (const junk of [null, undefined, {}, [], 'x', 42, { method: 42 }, { method: 'POST' }, { method: 'POST', body: 'x' }, { method: 'POST', body: { action: 'record' } }, { method: 'POST', body: { action: 'forget', id: '../x' } }, { method: 'GET', body: { action: 1 } }]) {
      const a = T.handleThemes(store, junk, portsOK())
      assert.equal(typeof a, 'object')
      assert.equal(typeof a.status, 'number')
      assert.equal(typeof a.body, 'object')
    }
    assert.equal(T.handleThemes(store, null, null).status, 405)
    assert.equal(T.handleThemes(null, { method: 'GET' }, portsOK()).status, 200)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

/* ═══ the applier the page carries (// KB-TH-CORE in client.js) ════════════ */
const src = readFileSync(join(here, 'client.js'), 'utf8')
const core = src.match(/\/\/ KB-TH-CORE-BEGIN([\s\S]*?)\/\/ KB-TH-CORE-END/)
const page = src.match(/const KbThemesView = /) !== null
ok('the page block is marked in client.js, so the tests run the browser\'s own code', () => {
  assert.notEqual(core, null)
  assert.equal(page, true)
})
const coreMod = await import('data:text/javascript,' + encodeURIComponent(core[1] + '\nexport { kbThApply, kbThRemove, kbThFingerprint, kbThLabel, kbThManagerIssue }'))
const PLAN = T.planTheme(PREVIEW)
/** A fake profile: the lookups answer what `seen` says, the writes are recorded, nothing leaves the process. */
const fake = (seen) => {
  const calls = []
  const ports = {
    get: async (path) => {
      calls.push({ m: 'GET', path })
      if (path.indexOf('/kybernos-skills/skills') === 0) return { ok: true, skills: (seen.skills || []).map((n) => ({ name: n })) }
      if (path.indexOf('/kybernos/load') === 0) return { ok: true, roots: [{ kybers: (seen.teams || []).map((id) => ({ id })) }] }
      if (path.indexOf('/kybernos/onboarding') === 0) return { ok: true, profil: seen.profil || '', goals: seen.goals || [] }
      return { ok: true }
    },
    post: async (path, body) => {
      calls.push({ m: 'POST', path, body })
      if (path.indexOf('/kybernos/tasks') === 0 && body !== null && body.action === 'list') return { ok: true, tasks: (seen.tasks || []).map((n) => ({ name: n })) }
      // a theme that does not carry the skill in its own folder (the host answers no-skill): the skill goes the usual way
      if (path === '/kybernos/themes' && body !== null && body.action === 'skill') return seen.ownSkills === true ? { ok: true, action: 'created' } : { ok: false, error: 'no-skill' }
      return { ok: true }
    },
    team: (item) => ({ name: item.id, id: item.id, home: true }),
    style: async (input) => { calls.push({ m: 'STYLE', input }); return seen.noSeam === true ? { ok: false } : { ok: true, id: input } },
  }
  return { calls, ports }
}
const TICKS = { style: true, goals: ['recall'], skills: ['patient-reminders'], teams: ['clinic-assist', 'assist'], automations: ['daily-recall'] }
await okA('a skill the theme carries in its own folder is installed by the host from there, and the usual route is not asked', async () => {
  const f = fake({ ownSkills: true })
  const r = await coreMod.kbThApply(PLAN, TICKS, f.ports)
  const posts = f.calls.filter((c) => c.m === 'POST')
  assert.equal(r.ok, true)
  assert.equal(r.added, 6, JSON.stringify(r))
  assert.equal(r.failed, 0)
  assert.deepEqual(posts.filter((c) => c.path === '/kybernos/themes').map((c) => c.body), [{ action: 'skill', id: PLAN.id, name: 'patient-reminders' }])
  assert.equal(posts.filter((c) => c.path.indexOf('/kybernos/domain/skill') === 0).length, 0)
})
await okA('the applier writes the field, the kit and the look once, in the routes\' order, and counts 6', async () => {
  const f = fake({})
  const r = await coreMod.kbThApply(PLAN, TICKS, f.ports)
  assert.equal(r.ok, true)
  assert.equal(r.already, false)
  assert.equal(r.added, 6, JSON.stringify(r))
  const posts = f.calls.filter((c) => c.m === 'POST')
  const order = ['/kybernos-registry/consent', '/kybernos/onboarding', '/kybernos/domain/skill', '/kybernos/create', '/kybernos/tasks']
  let at = -1
  for (const want of order) {
    const i = posts.findIndex((c, j) => j > at && c.path.indexOf(want) === 0)
    assert.ok(i >= 0, 'missing or out of order: ' + want + ' ' + JSON.stringify(posts.map((c) => c.path)))
    at = i
  }
  const auto = posts.find((c) => c.path.indexOf('/kybernos/tasks') === 0 && c.body.action === 'create')
  assert.equal(auto.body.task.active, false)
  assert.equal(auto.body.task.approvals, 'ask')
  assert.equal(auto.body.task.name, 'Daily recall')
  const consent = posts.find((c) => c.path.indexOf('/kybernos-registry/consent') === 0)
  assert.deepEqual(consent.body, { id: 'clinic', accepted: true })
  const domain = posts.find((c) => c.path.indexOf('/kybernos/onboarding') === 0)
  assert.deepEqual([domain.body.action, domain.body.profil, domain.body.goals], ['domain', 'clinic', ['recall']])
  assert.equal(f.calls.filter((c) => c.m === 'STYLE').length, 1)
  assert.equal(f.calls.find((c) => c.m === 'STYLE').input, 'clinic-style')
})
await okA('the applier writes nothing outside the routes of this batch: no session, memory or workspace', async () => {
  const f = fake({})
  await coreMod.kbThApply(PLAN, TICKS, f.ports)
  assert.deepEqual(f.calls.filter((c) => /sessions|memory|workspaces/.test(c.path)), [])
  const allowed = ['/kybernos-registry/consent', '/kybernos/onboarding', '/kybernos/themes', '/kybernos/domain/skill', '/kybernos-skills/install', '/kybernos/create', '/kybernos/tasks'] // /kybernos/themes: a skill the shipped theme carries
  for (const c of f.calls.filter((c) => c.m === 'POST')) assert.ok(allowed.some((p) => c.path.indexOf(p) === 0), 'an unexpected path: ' + c.path)
})
await okA('a replay is a no-op: already true, not one write', async () => {
  const f = fake({ skills: ['patient-reminders'], teams: ['clinic-assist', 'assist'], tasks: ['Daily recall'], profil: 'clinic', goals: ['recall'] })
  const r = await coreMod.kbThApply(PLAN, TICKS, f.ports)
  assert.equal(r.already, true)
  assert.equal(r.added, 0)
  assert.equal(f.calls.filter((c) => c.m === 'STYLE' || (c.m === 'POST' && c.body.action !== 'list')).length, 0)
})
await okA('nothing un-ticked is written, and the unticked items are reported', async () => {
  const f = fake({})
  const r = await coreMod.kbThApply(PLAN, { style: false, goals: [], skills: [], teams: [], automations: [] }, f.ports)
  assert.equal(r.added, 0)
  assert.equal(r.skipped.length, 4)
  assert.equal(f.calls.filter((c) => c.m === 'STYLE' || (c.m === 'POST' && c.body.action !== 'list')).length, 0)
})
await okA('a goal whose kit is fully un-ticked is not chosen', async () => {
  const f = fake({})
  const r = await coreMod.kbThApply(PLAN, Object.assign({}, TICKS, { skills: [], teams: [], automations: [] }), f.ports)
  // 'recall' is the only goal, and everything it brings is un-ticked: it is not chosen, so the field is not written at all.
  assert.equal(r.domain, 'skipped')
  assert.deepEqual(f.calls.filter((c) => c.m === 'POST' && c.path.indexOf('/kybernos/onboarding') === 0), [])
  assert.equal(r.added, 1, 'only the look applies')
})
await okA('an absent seam degrades: the kit applies and the report says the style did not', async () => {
  const f = fake({ noSeam: true })
  const r = await coreMod.kbThApply(PLAN, TICKS, f.ports)
  assert.equal(r.style, 'unavailable')
  assert.equal(r.ok, true)
  assert.equal(r.added, 5)
})
await okA('a failing step is counted and does not stop the next one', async () => {
  const calls = []
  const ports = {
    get: async () => ({ ok: true }),
    post: async (path, body) => {
      calls.push(path)
      if (path.indexOf('/kybernos-registry/consent') === 0) return { ok: false }
      if (path.indexOf('/kybernos/domain/skill') === 0 || path === '/kybernos/themes') return { ok: false }
      return { ok: true }
    },
    team: (item) => ({ name: item.id, id: item.id }),
    style: async () => ({ ok: true }),
  }
  const r = await coreMod.kbThApply(PLAN, TICKS, ports)
  assert.equal(r.ok, true)
  assert.ok(r.failed >= 2, JSON.stringify(r))
  assert.ok(calls.indexOf('/kybernos/create') >= 0, 'a failure did not stop the next step')
  assert.ok(calls.some((p) => p.indexOf('/kybernos/tasks') === 0))
})
await okA('the applier never throws, whatever it is handed', async () => {
  for (const plan of [null, undefined, {}, { pack: null }]) {
    const r = await coreMod.kbThApply(plan, TICKS, null)
    assert.equal(typeof r, 'object')
    assert.equal(r.ok, false)
  }
  // A plan it cannot act on and no ports at all: it degrades instead of throwing, and says what it could not do.
  const r = await coreMod.kbThApply({ pack: { id: 'x' }, kit: 'no' }, TICKS, null)
  assert.equal(r.ok, true)
  assert.equal(r.added, 0)
  assert.equal(r.style, 'unavailable')
  assert.ok(r.failed >= 1)
})

/* ═══ removal: restore only what the person has not changed ═══════════════ */
const RECORD = { id: 'acme/vet', applied: { style: { id: 'clinic-style', fingerprint: 'f1' }, domain: { profil: 'clinic', goals: ['recall'] }, kit: { skills: ['patient-reminders'], teams: ['clinic-assist'], automations: ['daily-recall'] } }, before: { style: 'neutral', domain: { profil: 'sante', goals: [] } } }
const remover = () => {
  const calls = []
  return { calls, ports: {
    post: async (path, body) => { calls.push({ m: 'POST', path, body }); return { ok: true } },
    style: async (input) => { calls.push({ m: 'STYLE', input }); return { ok: true, id: 'neutral' } },
  } }
}
await okA('removal restores the previous look and field, and never deletes a kit item', async () => {
  const a = remover()
  const r = await coreMod.kbThRemove(RECORD, { style: { id: 'clinic-style', fingerprint: 'f1' }, domain: { profil: 'clinic', goals: ['recall'] } }, a.ports)
  assert.equal(r.ok, true)
  assert.deepEqual(r.kept, { skills: 1, teams: 1, automations: 1 })
  assert.deepEqual([r.restored.style, r.restored.domain], [true, true])
  assert.equal(a.calls.filter((c) => c.m === 'STYLE').length, 1)
  assert.equal(a.calls.find((c) => c.m === 'STYLE').input, 'neutral')
  const dom = a.calls.find((c) => c.m === 'POST')
  assert.deepEqual([dom.path, dom.body.action, dom.body.profil], ['/kybernos/onboarding', 'domain', 'sante'])
  assert.deepEqual(a.calls.filter((c) => /delete|remove|sessions|memory|workspaces/.test(c.path)), [])
})
await okA('a look the person changed since is not overwritten; the field still comes back', async () => {
  const b = remover()
  const r = await coreMod.kbThRemove(RECORD, { style: { id: 'someone-else', fingerprint: 'f2' }, domain: { profil: 'clinic', goals: [] } }, b.ports)
  assert.equal(r.restored.style, false)
  assert.equal(b.calls.filter((c) => c.m === 'STYLE').length, 0)
  assert.equal(r.restored.domain, true)
  assert.equal(b.calls.filter((c) => c.m === 'POST').length, 1)
})
await okA('a field the person changed since is not overwritten', async () => {
  const c = remover()
  const r = await coreMod.kbThRemove(RECORD, { style: { id: 'clinic-style', fingerprint: 'f1' }, domain: { profil: 'autre', goals: [] } }, c.ports)
  assert.equal(r.restored.domain, false)
  assert.deepEqual(c.calls.filter((c) => c.m === 'POST'), [])
})
await okA('kbThFingerprint sorts keys and is stable; kbThLabel reads a pack text', async () => {
  assert.equal(coreMod.kbThFingerprint({ b: 1, a: 2 }), coreMod.kbThFingerprint({ a: 2, b: 1 }))
  assert.equal(coreMod.kbThFingerprint({ a: [1, { c: 2, b: 1 }] }), '{"a":[1,{"b":1,"c":2}]}')
  assert.equal(coreMod.kbThLabel({ fr: 'Visites', en: 'Visits' }), 'Visits')
  assert.equal(coreMod.kbThLabel('plain'), 'plain')
  assert.equal(coreMod.kbThLabel(null), '')
})
await okA('the applier hands the style port the settings bag too: a theme\'s own style is not a gallery id', async () => {
  const seen = []
  const f = fake({})
  f.ports.style = async (input, bag) => { seen.push({ input, bag }); return { ok: true, id: input } }
  const plan = Object.assign({}, PLAN, { style: Object.assign({}, PLAN.style, { settings: { acc: '#1B7F76' } }) })
  const r = await coreMod.kbThApply(plan, TICKS, f.ports)
  assert.equal(r.style, 'applied')
  assert.deepEqual(seen, [{ input: plan.style.id, bag: { acc: '#1B7F76' } }])
  const bare = Object.assign({}, PLAN, { style: Object.assign({}, PLAN.style, { settings: null }) })
  const f2 = fake({}); const seen2 = []
  f2.ports.style = async (input, bag) => { seen2.push(bag); return { ok: true } }
  await coreMod.kbThApply(bare, TICKS, f2.ports)
  assert.deepEqual(seen2, [null])
})
ok('kbThManagerIssue reads DSH\'s refusals as refusals: an object that says not-bundle is not an install (it used to pass as "not null")', () => {
  const issue = coreMod.kbThManagerIssue
  assert.equal(issue({ application: 'applied' }), 'ok')
  assert.equal(issue({}), 'ok')
  assert.equal(issue({ ok: true, value: { application: 'applied' } }), 'ok')
  assert.equal(issue({ ok: true, value: { application: 'restart-required', restartReason: 'no-hmr' } }), 'restart')
  // what the manager really returns for a package without a bundle patch: the failure folded into the result
  assert.equal(issue({ ok: true, value: { error: { code: 'not-bundle' }, application: 'failed' } }), 'not-bundle')
  assert.equal(issue({ error: { code: 'not-bundle' } }), 'not-bundle')
  assert.equal(issue({ error: { code: 'already-installed' } }), 'already')
  assert.equal(issue({ error: { code: 'invalid-spec' } }), 'refused')
  assert.equal(issue({ error: { code: 'incompatible-version' }, application: 'failed' }), 'refused')
  assert.equal(issue({ ok: false, error: 'x' }), 'refused')
  assert.equal(issue({ ok: true, value: { ok: false } }), 'refused')
  assert.equal(issue({ application: 'failed' }), 'failed')
  assert.equal(issue({ application: 'cancelled' }), 'cancelled')
  for (const none of [null, undefined, 'applied', 3, [], [{ application: 'applied' }]]) assert.equal(issue(none), 'no-answer', JSON.stringify(none))
})
ok('the page reads the manager\'s answer instead of "not null", and the Themes cards keep their actions visible', () => {
  const stage = src.slice(src.indexOf('const stageWith = async'), src.indexOf('const toggle = (kind, value)'))
  assert.match(stage, /kbThManagerIssue\(installed\)/)
  assert.doesNotMatch(stage, /installed === null/)
  assert.match(stage, /kbThFreshRegistry\(\)[\s\S]*openPlan/) // the registry scan is reused for two seconds: ask for a fresh one before reading the plan
  const seam = src.slice(src.indexOf('const kbThSeamInstall = async'), src.indexOf('const kbThSeamRemove = async'))
  assert.match(seam, /kbThManagerIssue\(installed\)/)
  assert.doesNotMatch(seam, /installed === null/)
  assert.doesNotMatch(src.slice(src.indexOf('const kbThRemoveTheme = async'), src.indexOf('// A catalogue theme\'s archive is NOT fetched here')), /removeBundle\(record\.id\)\)\s*!==\s*null/)
  // the team list hides a `.kbg-card`'s description and actions: the Themes gallery uses cards of its own, so no rule of the team list reaches them
  const view = src.slice(src.indexOf('const KbThemesView = () =>'), src.indexOf('// ── Skills and Connectors: one page each'))
  assert.doesNotMatch(view, /kbg-card/)
  assert.match(view, /className: 'kbgal-card'/)
  assert.doesNotMatch(src, /\[data-kb-page="themes"\] \.kbg-card/, 'the old overrides are gone with the cards they served')
})

console.log('\n' + count + ' checks passed')
