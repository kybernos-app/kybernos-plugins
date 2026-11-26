// kybernos-db, the template format (template.mjs): what a theme may tell the Tables bundle about a ready database, in what words, and what is refused. Pure: no disk,
// no network. The shipped themes are checked on the real files, so a template that drifts from the engine's rules fails here.
//
//   node packages/kybernos-db/test-template.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DB_TEMPLATE_POINT, LIMITS, TEMPLATE_POINT_REF, buildStructure, languagesOf, pick, resolveTemplate, validateSample, validateTemplate } from './template.mjs'

let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const clone = (v) => structuredClone(v)

const L = (en, fr) => (fr === undefined ? { en } : { en, fr })
const TEMPLATE = {
  id: 'garden-shop',
  name: L('Garden shop', 'Jardinerie'),
  objects: [
    { key: 'contact', label: L('Contacts', 'Contacts'), title: 'name', fields: [
      { key: 'name', type: 'text', required: true, label: L('Name', 'Nom') },
      { key: 'email', type: 'email', protection: 'personal', label: L('Email') },
      { key: 'boss', type: 'relation', to: 'contact', label: L('Boss', 'Chef'), inverse: L('Team', 'Équipe') },
      { key: 'photo', type: 'attachment', label: L('Photo'), maxBytes: 100000 },
    ] },
    { key: 'order', label: L('Orders', 'Commandes'), title: 'ref', fields: [
      { key: 'ref', type: 'text', label: L('Reference', 'Référence') },
      { key: 'stage', type: 'choice', label: L('Stage', 'Étape'), options: [{ key: 'new', label: L('New', 'Nouvelle'), color: 'blue' }, { key: 'sent', label: L('Sent') }] },
      { key: 'total', type: 'money', currency: 'EUR', label: L('Total') },
      { key: 'buyer', type: 'relation', to: 'contact', label: L('Buyer', 'Acheteur') },
      { key: 'due', type: 'date', label: L('Due', 'Échéance') },
    ] },
  ],
  views: [
    { object: 'order', id: 'order-board', name: L('Pipeline'), kind: 'board', by: 'stage', fav: true },
    { object: 'order', id: 'order-calendar', name: L('Calendar', 'Calendrier'), kind: 'calendar', date: 'due' },
    { object: 'contact', id: 'contact-list', name: L('All'), kind: 'table' },
  ],
}
const SAMPLE = {
  rows: {
    contact: [
      { ref: 'ana', values: { name: 'Ana', email: 'ana@example.com', photo: [{ photo: 'garden-shop/portrait-01' }] } },
      { ref: 'bo', values: { name: 'Bo', boss: { ref: 'ana' } } },
    ],
    order: [{ values: { ref: 'A-1', stage: 'new', total: 12.5, buyer: { ref: 'bo' } } }],
  },
}
const errorsOf = (r) => (r.ok ? [] : r.errors)
const refused = (raw, pattern, fileId) => { const r = validateTemplate(raw, fileId); assert.equal(r.ok, false, 'should be refused: ' + pattern); assert.ok(r.errors.some((e) => pattern.test(e)), pattern + ' not in ' + JSON.stringify(r.errors)) }

ok('a sound template is accepted and handed back as a copy', () => {
  const r = validateTemplate(TEMPLATE, 'garden-shop')
  assert.deepEqual(errorsOf(r), [])
  assert.deepEqual(r.value, TEMPLATE)
  assert.notEqual(r.value, TEMPLATE)
  assert.equal(validateTemplate(TEMPLATE).ok, true, 'the file name is optional')
})

ok('the point is data, inert, named by its owner, and its validator is the one exported', () => {
  assert.equal(TEMPLATE_POINT_REF, 'kybernos/db#template')
  assert.equal(DB_TEMPLATE_POINT.owner, 'kybernos/db')
  assert.equal(DB_TEMPLATE_POINT.name, 'template')
  assert.equal(DB_TEMPLATE_POINT.kind, 'data')
  assert.equal(DB_TEMPLATE_POINT.class, 'inert')
  assert.equal(DB_TEMPLATE_POINT.validate, validateTemplate)
  assert.equal(DB_TEMPLATE_POINT.max, LIMITS.files)
  assert.ok(Object.isFrozen(DB_TEMPLATE_POINT))
})

ok('the shape is closed: unknown keys, a wrong id, a wrong file name, no objects', () => {
  refused('x', /JSON object/)
  refused({ ...clone(TEMPLATE), extra: 1 }, /unknown key "extra"/)
  refused({ ...clone(TEMPLATE), id: 'Garden Shop' }, /^id:/)
  refused(clone(TEMPLATE), /must be the name of its file/, 'other')
  refused({ ...clone(TEMPLATE), objects: [] }, /objects: a list of 1 to/)
  refused({ ...clone(TEMPLATE), objects: Array.from({ length: LIMITS.objects + 1 }, () => clone(TEMPLATE.objects[0])) }, /objects: a list of 1 to/)
  const t = clone(TEMPLATE); t.objects[0].extra = true
  refused(t, /objects\[0\]: unknown key "extra"/)
})

ok('every label is a pair with English, in known languages, short and without markup', () => {
  const noName = clone(TEMPLATE); delete noName.name
  refused(noName, /name: an object/)
  const noEn = clone(TEMPLATE); noEn.name = { fr: 'Jardinerie' }
  refused(noEn, /name\.en: required/)
  const odd = clone(TEMPLATE); odd.objects[0].label = { en: 'Contacts', xx: 'Kontakte' }
  refused(odd, /unknown language "xx"/)
  const markup = clone(TEMPLATE); markup.objects[1].fields[0].label = L('<b>Ref</b>')
  refused(markup, /no < >/)
  const long = clone(TEMPLATE); long.views[0].name = L('x'.repeat(61))
  refused(long, /views\[0\]\.name\.en: a text of 1 to 60/)
  const option = clone(TEMPLATE); option.objects[1].fields[1].options[0].label = L('')
  refused(option, /options\[0\]\.label\.en/)
})

ok('the structure is checked as the store checks it, in each language the template speaks', () => {
  const noTitle = clone(TEMPLATE); noTitle.objects[0].title = 'missing'
  refused(noTitle, /title/)
  const badField = clone(TEMPLATE); badField.objects[1].fields[2].currency = 'euros'
  refused(badField, /currency/)
  const dup = clone(TEMPLATE); dup.objects.push(clone(TEMPLATE.objects[0]))
  refused(dup, /objects\[2\]\.key|share this key|duplicate/)
  const tooLongFr = clone(TEMPLATE); tooLongFr.objects[0].fields[0].label = { en: 'Name', fr: 'x'.repeat(81) }
  refused(tooLongFr, /fr/)
})

ok('a link must point at an object of the template and cannot be required', () => {
  const t = clone(TEMPLATE); t.objects[1].fields[3].to = 'ghost'
  refused(t, /links to "ghost", which is not an object of the template/)
  const req = clone(TEMPLATE); req.objects[1].fields[3].required = true
  refused(req, /a link cannot be required/)
})

ok('profiles are optional, checked against the objects, and kept as plain strings in a language', () => {
  const t = clone(TEMPLATE)
  t.profiles = [{ id: 'member', label: L('Team member', 'Membre'), grants: [{ object: 'contact', do: ['read', 'update'], fields: { name: 'read' } }, { object: 'order', do: ['read'] }] }]
  assert.equal(validateTemplate(t).ok, true, JSON.stringify(validateTemplate(t).errors))
  const fr = buildStructure(t, 'fr')
  assert.deepEqual(fr.errors, [])
  assert.deepEqual(fr.profiles, [{ id: 'member', label: 'Membre', grants: [{ object: 'contact', do: ['read', 'update'], fields: { name: 'read' } }, { object: 'order', do: ['read'] }] }])
  assert.equal(buildStructure(t, 'en').profiles[0].label, 'Team member')
  assert.deepEqual(buildStructure(TEMPLATE, 'en').profiles, [], 'none shipped, none made')
  const ghost = clone(t); ghost.profiles[0].grants[0].object = 'ghost'
  refused(ghost, /profiles\.0\.grants\.0\.object: no such table in this app: ghost/)
  const field = clone(t); field.profiles[0].grants[0].fields.nope = 'read'
  refused(field, /no such field in this table/)
  const del = clone(t); del.profiles[0].grants[0].do = ['read', 'delete']
  refused(del, /a member never deletes/)
  const owner = clone(t); owner.profiles[0].id = 'owner'
  refused(owner, /built in/)
  const unlabelled = clone(t); unlabelled.profiles[0].label = { fr: 'Membre' }
  refused(unlabelled, /profiles\[0\]\.label/)
  const loose = clone(t); loose.profiles[0].extra = 1
  refused(loose, /unknown key|not a property here/)
  const many = clone(t); many.profiles = Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i, label: L('P'), grants: [] }))
  refused(many, /profiles: a list of at most/)
})

ok('a view must belong to an object, be sound for it and have an id of its own', () => {
  const orphan = clone(TEMPLATE); orphan.views[0].object = 'ghost'
  refused(orphan, /views\[0\]\.object: not an object/)
  const board = clone(TEMPLATE); board.views[0].by = 'total'
  refused(board, /by/)
  const twice = clone(TEMPLATE); twice.views[2].id = 'order-board'
  refused(twice, /"order-board" appears twice/)
  const many = clone(TEMPLATE); many.views = Array.from({ length: LIMITS.views + 1 }, (_, i) => ({ object: 'contact', id: 'v' + i, name: L('V'), kind: 'table' }))
  refused(many, /views: a list of at most/)
  const noViews = clone(TEMPLATE); delete noViews.views
  assert.equal(validateTemplate(noViews).ok, true, 'views are optional')
})

ok('the template in a language: its labels, options and inverse names are plain strings, English where a language is missing', () => {
  const fr = resolveTemplate(TEMPLATE, 'fr')
  assert.equal(fr.name, 'Jardinerie')
  assert.equal(fr.objects[0].label, 'Contacts')
  assert.equal(fr.objects[0].fields[1].label, 'Email', 'no French given: English')
  assert.equal(fr.objects[0].fields[2].inverse, 'Équipe')
  assert.equal(fr.objects[1].fields[1].options[0].label, 'Nouvelle')
  assert.equal(fr.objects[1].fields[1].options[1].label, 'Sent')
  assert.equal(fr.views[1].name, 'Calendrier')
  const es = resolveTemplate(TEMPLATE, 'es')
  assert.equal(es.name, 'Garden shop')
  assert.equal(pick(L('A', 'B'), 'fr'), 'B')
  assert.equal(pick(L('A', 'B'), 'ar'), 'A')
  assert.equal(pick(undefined, 'en'), '')
  assert.deepEqual(languagesOf(TEMPLATE).sort(), ['en', 'fr'])
  assert.deepEqual(languagesOf({ name: L('x') }), ['en'])
})

ok('the built structure is normalized for the store (defaults filled) and says what is wrong', () => {
  const built = buildStructure(TEMPLATE, 'en')
  assert.deepEqual(built.errors, [])
  assert.equal(built.objects[0].fields[0].protection, 'normal')
  assert.equal(built.objects[0].fields[1].protection, 'personal')
  assert.equal(built.objects[1].fields[2].precision, 2)
  assert.equal(built.name, 'Garden shop')
  assert.ok(buildStructure({ ...clone(TEMPLATE), objects: [{ key: 'x', label: L('X'), fields: [] }] }, 'en').errors.length > 0)
})

ok('a sample is checked against the structure: objects, fields, refs, links, pictures', () => {
  const good = validateSample(SAMPLE, TEMPLATE)
  assert.deepEqual(errorsOf(good), [])
  const bad = (sample, pattern) => { const r = validateSample(sample, TEMPLATE); assert.equal(r.ok, false, String(pattern)); assert.ok(r.errors.some((e) => pattern.test(e)), pattern + ' not in ' + JSON.stringify(r.errors)) }
  bad('x', /JSON object/)
  bad({ rows: 1 }, /rows: an object/)
  bad({ rows: {}, extra: 1 }, /unknown key/)
  bad({ rows: { ghost: [] } }, /rows\.ghost: not an object/)
  bad({ rows: { contact: 1 } }, /a list of at most/)
  bad({ rows: { contact: [{ values: { ghost: 1 } }] } }, /no such field/)
  bad({ rows: { contact: [{ ref: 'a b', values: {} }] } }, /\.ref:/)
  bad({ rows: { contact: [{ ref: 'a', values: {} }, { ref: 'a', values: {} }] } }, /appears twice/)
  bad({ rows: { contact: [{ values: { boss: { ref: 'nobody' } } }] } }, /no "nobody" among the contact rows/)
  bad({ rows: { contact: [{ values: { boss: 'ana' } }] } }, /a link is \{ ref \}/)
  bad({ rows: { contact: [{ values: { name: { ref: 'x' } } }] } }, /a \{ ref \} goes in a link field/)
  bad({ rows: { contact: [{ values: { name: { photo: 'garden-shop/x' } } }] } }, /a \{ photo \} goes in an attachment field/)
  bad({ rows: { contact: [{ values: { photo: [{ photo: '../../etc/passwd' }] } }] } }, /a photo is "<theme folder>\/<name>"/)
  bad({ rows: { contact: [{ values: { photo: 'garden-shop/x' } }] } }, /holds a list of \{ photo \}/)
  bad({ rows: { contact: Array.from({ length: LIMITS.rowsPerObject + 1 }, () => ({ values: {} })) } }, /a list of at most/)
})

ok('the shipped themes carry a template and a sample that the format accepts', () => {
  const themes = join(dirname(fileURLToPath(import.meta.url)), '..', 'kybernos-plugin', 'themes')
  const dirs = readdirSync(themes).filter((d) => { try { return readdirSync(join(themes, d, 'db')).length > 0 } catch (e) { return false } })
  assert.ok(dirs.length >= 3, 'the three first themes ship a database: ' + dirs.join(','))
  for (const dir of dirs) {
    const raw = JSON.parse(readFileSync(join(themes, dir, 'db', dir + '.json'), 'utf8'))
    const t = validateTemplate(raw, dir)
    assert.deepEqual(errorsOf(t), [], dir)
    for (const lang of languagesOf(raw)) assert.deepEqual(buildStructure(raw, lang).errors, [], dir + ' in ' + lang)
    const sample = JSON.parse(readFileSync(join(themes, dir, 'demo', 'db-sample.json'), 'utf8'))
    assert.deepEqual(errorsOf(validateSample(sample, raw)), [], dir + ' sample')
  }
})

console.log('\nkybernos-db template: ' + count + ' checks passed')
