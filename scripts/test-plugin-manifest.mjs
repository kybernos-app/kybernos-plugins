// The plugin manifest validator (docs/dev/plugin-contract.md, section 4) and the schema subset it runs on.
//   node scripts/test-plugin-manifest.mjs
// Hermetic: reads the schema and the contract document, nothing else.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAMILLES } from './build-catalog.mjs'
import { describe, unsupportedKeywords, validate } from './schema-subset.mjs'
import { firstPartyId, manifestErrors, setErrors } from './plugin-manifest.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
const ok = (name, cond, detail) => { if (cond) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }
const clone = (x) => JSON.parse(JSON.stringify(x))

console.log('the schema subset')
{
  const bad = (schema, value) => validate(schema, value).length > 0
  ok('type, enum, const', bad({ type: 'string' }, 1) && bad({ enum: ['a'] }, 'b') && bad({ const: 1 }, 2) && !bad({ enum: ['a'] }, 'a'))
  ok('string bounds and pattern', bad({ maxLength: 2 }, 'abc') && bad({ minLength: 1 }, '') && bad({ pattern: '^a$' }, 'b') && !bad({ pattern: '^a$' }, 'a'))
  ok('a multi-line value does not slip past an anchored pattern', bad({ pattern: '^a$' }, 'a\n'))
  ok('array bounds, items, uniqueItems', bad({ maxItems: 1 }, [1, 2]) && bad({ items: { type: 'string' } }, [1]) && bad({ uniqueItems: true }, [1, 1]))
  ok('required, additionalProperties false, propertyNames', bad({ required: ['a'] }, {}) && bad({ additionalProperties: false, properties: { a: true } }, { b: 1 }) && bad({ propertyNames: { pattern: '^a' } }, { b: 1 }))
  ok('allOf, anyOf, oneOf, not', bad({ anyOf: [{ type: 'string' }, { type: 'number' }] }, null) && bad({ oneOf: [{ type: 'number' }, { minimum: 0 }] }, 1) && bad({ not: { type: 'string' } }, 'x') && bad({ allOf: [{ type: 'string' }, { maxLength: 1 }] }, 'ab'))
  ok('if / then / else', bad({ if: { const: 1 }, then: { type: 'string' } }, 1) && !bad({ if: { const: 1 }, then: { type: 'string' } }, 2) && bad({ if: { const: 1 }, else: { const: 5 } }, 2))
  ok('$ref to a place in the same document', bad({ $defs: { n: { type: 'number' } }, properties: { a: { $ref: '#/$defs/n' } } }, { a: 'x' }))
  ok('an unsupported keyword throws instead of passing', (() => { try { validate({ patternProperties: {} }, {}); return false } catch (e) { return /unsupported keyword/.test(e.message) } })())
  ok('a remote $ref throws', (() => { try { validate({ $ref: 'https://example.com/x.json' }, {}); return false } catch (e) { return /local references/.test(e.message) } })())
  ok('the reasons are readable', describe(validate({ properties: { a: { maxLength: 1 } } }, { a: 'xx' })).join() === '/a is longer than 1')
}

// ── manifests ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const platform = {
  contract: 1, id: 'kybernos/dashboards', kind: 'code', version: '0.1.0',
  name: { en: 'Dashboards', fr: 'Tableaux de bord' },
  description: { en: 'Dashboards built and changed by chat, from your own sources.', fr: 'Des tableaux de bord construits par chat, depuis vos propres sources.' },
  icon: 'dashboard', family: 'data',
  author: { id: 'kybernos', name: 'Kybernos', url: 'https://kybernos.app' },
  license: 'Apache-2.0', pricing: 'free',
  package: '@local/kybernos-dashboards', entry: { host: 'index.js', client: 'client.js' },
  requires: { dsh: { min: '0.1.6-alpha.2', max: '0.2.1-rc.2' } },
  provides: [
    { name: 'preset', version: '1.0', kind: 'data', class: 'inert', schema: 'schemas/preset.schema.json' },
    { name: 'http-source', version: '1.0', kind: 'data', class: 'inert', schema: 'schemas/http-source.schema.json' },
    { name: 'source', version: '1.0', kind: 'code' }
  ],
  permissions: ['ui.slot:sidebar.right.pane.tab', 'host.routes:/kybernos-dashboards:write', 'fs.write:dsh-home', 'net:localhost'],
  claims: { cssPrefix: 'kbd', routePrefixes: ['/kybernos-dashboards'], slotIds: ['dashboards'] },
  help: 'help.json', suite: { default: 'on' }
}
const shop = {
  contract: 1, id: 'acme/shop-dashboards', kind: 'data', version: '1.2.0',
  name: { en: 'Shop dashboards' }, description: { en: 'Sales, orders and stock dashboards for an Acme Shop store.' },
  icon: 'icon.webp', family: 'data',
  author: { id: 'acme', name: 'Acme Software', url: 'https://acme.example' },
  license: 'LicenseRef-Acme-EULA', pricing: 'paid',
  commerce: {
    model: 'key', product: 'shop-dashboards-pro',
    unlocks: { en: 'Live data from your store, refreshed every 15 minutes.' },
    worksWithout: { en: 'The dashboards open on sample data, and you can import a CSV by hand.' },
    key: { label: { en: 'Acme Shop API key' }, hosts: ['api.acme-shop.example'], getUrl: 'https://acme.example/keys', format: '^ak_[A-Za-z0-9]{32}$' }
  },
  requires: { kybernos: '^0.1', plugins: { 'kybernos/dashboards': '^1.0' } },
  tested: { kybernos: ['0.1.1'] },
  extends: [{ point: 'kybernos/dashboards#preset', range: '^1.0', dir: 'presets' }, { point: 'kybernos/dashboards#http-source', range: '^1.0', dir: 'sources' }],
  permissions: ['net:api.acme-shop.example', 'secrets.own'],
  update: { catalogue: 'https://acme.example/kybernos/catalogue.json', auth: 'key' }
}
const vet = {
  contract: 1, id: 'acme/vet-clinic', kind: 'data', version: '0.3.0',
  name: { en: 'Veterinary clinic', fr: 'Clinique vétérinaire' }, description: { en: 'A domain pack for veterinary clinics: goals, skills, reminders.' },
  author: { id: 'acme', name: 'Acme Software' }, license: 'CC-BY-4.0', pricing: 'free',
  requires: { kybernos: '^0.1', plugins: { 'kybernos/core': '^1.0' } }, extends: [{ point: 'kybernos/core#domain-pack', range: '^1.0', dir: 'domains' }]
}
const phone = {
  contract: 1, id: 'kybernos/mobile', kind: 'code', version: '0.1.0',
  name: { en: 'Phone', fr: 'Téléphone' },
  description: { en: 'DSH on a narrow screen, and on a paid plan a QR code that links a phone.', fr: 'DSH sur petit écran et, avec un forfait payant, un QR code qui relie un téléphone.' },
  author: { id: 'kybernos', name: 'Kybernos' }, license: 'Apache-2.0', pricing: 'paid',
  commerce: { model: 'account', product: 'phone-link', unlocks: { en: 'The end-to-end encrypted phone link.' }, worksWithout: { en: 'DSH is fully usable on a narrow screen.' } },
  package: '@local/kybernos-mobile', entry: { host: 'index.js', client: 'client.js' }, requires: { kybernos: '>=0.1.0' }, help: 'help.json', suite: { default: 'on' }
}
const first = { firstParty: true }
const accepts = { platform: [platform, first], shop: [shop, {}], vet: [vet, {}], phone: [phone, first] }

console.log('valid manifests')
for (const [name, [m, ctx]] of Object.entries(accepts)) { const e = manifestErrors(m, ctx); ok(name + ' is accepted', e.length === 0, e) }

console.log('the manifests printed in the contract document')
{
  const doc = readFileSync(join(REPO, 'docs', 'dev', 'plugin-contract.md'), 'utf8')
  const blocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((b) => JSON.parse(b[1])).filter((j) => j.contract === 1)
  ok('the document shows three manifests', blocks.length === 3, blocks.map((b) => b.id))
  for (const b of blocks) { const e = manifestErrors(b, { firstParty: b.author.id === 'kybernos' }); ok('the document\'s ' + b.id + ' is accepted', e.length === 0, e) }
}

console.log('broken manifests are refused, each for its own reason')
const refused = (name, base, ctx, edit, reason) => {
  const m = clone(base)
  edit(m)
  const e = manifestErrors(m, ctx)
  ok(name, e.length > 0 && (reason === undefined || e.some((x) => reason.test(x))), e.slice(0, 3))
}
refused('a data plugin with exec', vet, {}, (m) => { m.permissions = ['exec'] }, /permissions\/0/)
refused('a data plugin with an entry', vet, {}, (m) => { m.package = '@local/x'; m.entry = { host: 'i.js' } })
refused('a data plugin that extends nothing', vet, {}, (m) => { delete m.extends }, /"extends" is required/)
refused('a data extension without dir', vet, {}, (m) => { delete m.extends[0].dir }, /"dir" is required/)
refused('paid without commerce', shop, {}, (m) => { delete m.commerce }, /"commerce" is required/)
refused('free with commerce', vet, {}, (m) => { m.commerce = clone(shop.commerce) })
refused('the key model without a key block', shop, {}, (m) => { delete m.commerce.key }, /"key" is required/)
refused('the account model with a key block', phone, first, (m) => { m.commerce.key = clone(shop.commerce.key) })
refused('paid without worksWithout', shop, {}, (m) => { delete m.commerce.worksWithout }, /"worksWithout" is required/)
refused('worksWithout that repeats unlocks', shop, {}, (m) => { m.commerce.worksWithout = clone(m.commerce.unlocks) }, /repeats/)
refused('an id in capitals', vet, {}, (m) => { m.id = 'Acme/Vet' })
refused('an id without a namespace', vet, {}, (m) => { m.id = 'vet-clinic' })
refused('an author that is not the namespace', vet, {}, (m) => { m.author.id = 'other' }, /namespace/)
refused('a code plugin with neither a DSH zone nor a suite block', platform, first, (m) => { delete m.suite; delete m.requires.dsh; m.requires.kybernos = '^0.1' })
refused('a code plugin without a package', platform, first, (m) => { delete m.package })
refused('a kybernos plugin without French', platform, first, (m) => { delete m.name.fr }, /"fr" is required/)
refused('an unknown permission word', platform, first, (m) => { m.permissions.push('root') })
refused('net: followed by a star', platform, first, (m) => { m.permissions.push('net:*') })
refused('a range with ||', shop, {}, (m) => { m.requires.plugins['kybernos/dashboards'] = '^1 || ^2' })
refused('an http homepage', platform, first, (m) => { m.homepage = 'http://example.com' })
refused('an unknown top-level key', platform, first, (m) => { m.scripts = { postinstall: 'x' } }, /not a known key/)
refused('a DSH zone without a max', platform, first, (m) => { delete m.requires.dsh.max })
refused('a name without English', vet, {}, (m) => { m.name = { fr: 'x' } })
refused('markup in a description', vet, {}, (m) => { m.description = { en: '<b>hi</b>' } })
refused('an icon path that escapes', shop, {}, (m) => { m.icon = '../x.webp' })
refused('a contract the host does not know', vet, {}, (m) => { m.contract = 2 })
refused('a data point without a class', platform, first, (m) => { delete m.provides[0].class })
refused('a code point with a class', platform, first, (m) => { m.provides[2].class = 'inert' })
refused('a description over 240 characters', vet, {}, (m) => { m.description = { en: 'x'.repeat(241) } })

console.log('the rules a schema cannot say')
refused('the kybernos namespace outside this repository', platform, {}, () => {}, /reserved for the modules of this repository/)
refused('the dsh namespace', vet, {}, (m) => { m.id = 'dsh/vet'; m.author.id = 'dsh' }, /reserved for the engine/)
refused('the local namespace on a plugin that is not a local folder', vet, {}, (m) => { m.id = 'local/vet'; m.author.id = 'local' }, /reserved for a folder/)
ok('the local namespace on a local folder is accepted', manifestErrors({ ...clone(vet), id: 'local/vet', author: { id: 'local', name: 'Me' } }, { local: true }).length === 0)
refused('a suite block on an outsider', shop, {}, (m) => { m.suite = { default: 'on' } })
refused('extending a point of a plugin you do not require', shop, {}, (m) => { delete m.requires.plugins['kybernos/dashboards']; m.requires.kybernos = '^0.1' }, /not in requires\.plugins/)
refused('a route permission outside the claimed prefixes', platform, first, (m) => { m.claims.routePrefixes = ['/other'] }, /claims\.routePrefixes/)
refused('a key host that is not a net: permission', shop, {}, (m) => { m.permissions = ['secrets.own'] }, /net: permissions/)
refused('a key format that nests quantifiers', shop, {}, (m) => { m.commerce.key.format = '^(a+)+$' }, /not linear-time/)
refused('a key format that is not a regular expression', shop, {}, (m) => { m.commerce.key.format = '^(' }, /not a valid regular expression/)
refused('engine.patch from outside the kybernos namespace', vet, {}, (m) => { m.permissions = ['engine.patch'] })
refused('a first-party zone wider than the suite zone', platform, { firstParty: true, suiteZone: { min: '0.2.0-rc.2', max: '0.2.1-rc.2' } }, () => {}, /outside the zone of dsh-compat/)
refused('a tested DSH version outside the zone', platform, { firstParty: true, suiteZone: { min: '0.1.6-alpha.2', max: '0.2.1-rc.2' } }, (m) => { m.tested = { dsh: ['0.3.0'] } }, /tested\.dsh/)
refused('a zone whose min is above its max', platform, first, (m) => { m.requires.dsh = { min: '0.2.1-rc.2', max: '0.1.6-alpha.2' } }, /min is above max/)
refused('a provides list that repeats a point', platform, first, (m) => { m.provides.push(clone(m.provides[2])) }, /twice/)
refused('a first-party module without a help card', platform, first, (m) => { delete m.help }, /help card/)
refused('a version that differs from package.json', platform, { firstParty: true, packageJson: { name: '@local/kybernos-dashboards', version: '0.2.0', exports: { '.': './index.js', './client': './client.js' } } }, () => {}, /differs from package\.json/)
refused('an entry that is not the package export', platform, { firstParty: true, packageJson: { name: '@local/kybernos-dashboards', version: '0.1.0', exports: { '.': './main.js', './client': './client.js' } } }, () => {}, /"\." export/)
refused('a file the manifest names but the folder lacks', platform, { firstParty: true, fileExists: (rel) => rel !== 'help.json' }, () => {}, /does not exist/)
refused('an id that does not follow the folder', platform, { firstParty: true, dir: 'kybernos-other' }, () => {}, /should be "kybernos\/other"/)
ok('firstPartyId maps the folders', firstPartyId('kybernos-plugin') === 'kybernos/core' && firstPartyId('kybernos-hub') === 'kybernos/hub' && firstPartyId('dsh-mermaid') === 'kybernos/dsh-mermaid' && firstPartyId('kybernos-modeles-locaux') === 'kybernos/modeles-locaux')

console.log('the schema and the rest of the repository')
{
  const schema = JSON.parse(readFileSync(join(REPO, 'docs', 'dev', 'schemas', 'plugin.schema.json'), 'utf8'))
  ok('the families of the schema are the families of the Suite catalogue', JSON.stringify(schema.properties.family.enum) === JSON.stringify(FAMILLES.map((f) => f.id)), schema.properties.family.enum)
  ok('the schema uses only what the subset interpreter supports, in every branch', unsupportedKeywords(schema).length === 0, unsupportedKeywords(schema))
  ok('a schema outside the subset is found out', unsupportedKeywords({ properties: { a: { patternProperties: {} } } }).join() === '/properties/a/patternProperties')
}

console.log('rules across a set')
{
  const a = clone(shop)
  const b = clone(shop); b.id = 'acme/other'
  ok('a repeated id', setErrors([shop, clone(shop)]).some((e) => /twice/.test(e)))
  ok('two plugins claiming one CSS prefix', setErrors([platform, { ...clone(platform), id: 'kybernos/other' }]).some((e) => /cssPrefix "kbd"/.test(e)))
  ok('a route prefix claimed twice', setErrors([platform, { ...clone(platform), id: 'kybernos/other', claims: { routePrefixes: ['/kybernos-dashboards'] } }]).some((e) => /routePrefixes/.test(e)))
  ok('the same plugin repeating its own claim is not a clash', setErrors([platform]).length === 0)
  const c1 = { ...clone(vet), id: 'acme/a', requires: { plugins: { 'acme/b': '^1' } } }
  const c2 = { ...clone(vet), id: 'acme/b', requires: { plugins: { 'acme/a': '^1' } } }
  ok('a dependency cycle', setErrors([c1, c2]).some((e) => /cycle/.test(e)))
  const chain = ['a', 'b', 'c', 'd', 'e'].map((n, i, all) => ({ ...clone(vet), id: 'acme/' + n + 'x', requires: i < all.length - 1 ? { plugins: { ['acme/' + all[i + 1] + 'x']: '^1' } } : { kybernos: '^0.1' } }))
  ok('a chain of five plugins is too deep', setErrors(chain).some((e) => /longer than 4/.test(e)))
  ok('a dependency outside the set is a runtime status, not a fault', setErrors([a]).length === 0 && setErrors([b]).length === 0)
}

console.log('\nPLUGIN MANIFEST — ' + pass + ' ok, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
