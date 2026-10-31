// test-tables-front.mjs — the pure part of the tables template's client (templates/tables/public/js/model.mjs): what a value looks like, who may do what, the board, the forms, the
// way the door's errors are read, the relations drawing, the hash route. No DOM, no network: Node runs the module as the browser does.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as m from './templates/tables/public/js/model.mjs'

let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }

const stages = { key: 'stage', type: 'choice', label: 'Stage', options: [{ key: 'lead', label: 'Lead', color: 'blue' }, { key: 'won', label: 'Won', color: 'green' }, { key: 'lost', label: 'Lost' }] }
const contacts = {
  key: 'contacts', label: 'Contacts', title: 'name', count: 3,
  fields: [
    { key: 'name', type: 'text', label: 'Name', required: true },
    { key: 'email', type: 'email', label: 'Email' },
    { key: 'stage', ...stages },
    { key: 'since', type: 'date', label: 'Customer since' },
    { key: 'spend', type: 'money', label: 'Spend', currency: 'GBP' },
    { key: 'company', type: 'relation', label: 'Company', to: 'companies' },
    { key: 'note', type: 'longtext', label: 'Note' },
    { key: 'owner', type: 'person', label: 'Owner' },
  ],
}
const companies = {
  key: 'companies', label: 'Companies', title: 'name', count: 1,
  fields: [{ key: 'name', type: 'text', label: 'Name', required: true }, { key: 'people', type: 'relation', label: 'People', to: 'contacts', many: true }, { key: 'gone', type: 'relation', label: 'Archive', to: 'secret' }],
}
const rec = (id, values, at = '2026-10-29T10:00:00.000Z') => ({ id, values, rev: 1, created: { by: 'person', at }, modified: { by: 'person', at } })
const OWNER = { role: 'owner' }
const MEMBER = { role: 'editor' }

ok('the owner may do everything, a member only what the door granted', () => {
  assert.equal(m.isOwner(OWNER), true)
  assert.equal(m.isOwner(MEMBER), false)
  assert.equal(m.isOwner(null), false)
  assert.equal(m.canCreate(OWNER, contacts), true)
  assert.equal(m.canCreate(MEMBER, contacts), false, 'no `can` means no right to add')
  assert.equal(m.canCreate(MEMBER, { ...contacts, can: { create: true, update: false } }), true)
  assert.equal(m.canArchive(OWNER), true)
  assert.equal(m.canArchive(MEMBER), false, 'a member never archives')
  const writer = { ...contacts, can: { create: true, update: true } }
  const reader = { key: 'x', type: 'text', label: 'X', access: 'read' }
  const writable = { key: 'y', type: 'text', label: 'Y', access: 'write' }
  assert.equal(m.canUpdateField(MEMBER, writer, writable), true)
  assert.equal(m.canUpdateField(MEMBER, writer, reader), false, 'a read-only field stays read-only')
  assert.equal(m.canUpdateField(MEMBER, { ...writer, can: { create: true, update: false } }, writable), false)
  assert.equal(m.canUpdateField(OWNER, contacts, reader), true)
})

ok('the add form offers the writable fields, never a person field', () => {
  assert.deepEqual(m.formFields(OWNER, contacts).map((f) => f.key), ['name', 'email', 'stage', 'since', 'spend', 'company', 'note'])
  const member = { ...contacts, can: { create: true, update: false }, fields: contacts.fields.map((f) => ({ ...f, access: f.key === 'email' ? 'read' : 'write' })) }
  assert.deepEqual(m.formFields(MEMBER, member).map((f) => f.key), ['name', 'stage', 'since', 'spend', 'company', 'note'], 'the read-only email is not offered')
  assert.deepEqual(m.formFields(MEMBER, contacts), [], 'a member who cannot add gets no form')
})

ok('values are worded for a person, in English, with no time zone in the way', () => {
  assert.equal(m.fmtDay('2026-10-29'), 'Oct 29, 2026')
  assert.equal(m.fmtDay('2026-01-05'), 'Jan 5, 2026')
  assert.equal(m.fmtDay('soon'), 'soon', 'what is not a date is left as it is')
  assert.equal(m.fmtStamp('2026-10-29T14:05:09.000Z'), 'Oct 29, 2026, 14:05 UTC')
  assert.equal(m.fmtStamp('nope'), 'nope')
  assert.equal(m.fmtMoney(24.5, 'GBP'), '£24.50')
  assert.equal(m.fmtMoney(1200, 'EUR', 0), '€1,200')
  assert.equal(m.fmtMoney(5, undefined), '5.00', 'no currency, a plain figure')
  assert.equal(m.fmtMoney(5, 'ZZZZ'), '5.00', 'a bad code does not throw')
  assert.equal(m.fmtNumber(1234.5), '1,234.5')
  assert.equal(m.fmtNumber(3, 2), '3.00')
  assert.equal(m.fmtSize(512), '512 B')
  assert.equal(m.fmtSize(2048), '2.0 KB')
  assert.equal(m.fmtSize(5 * 1024 * 1024), '5.0 MB')
  assert.equal(m.fmtSize(-1), '')
  assert.equal(m.singular('Customers'), 'customer')
  assert.equal(m.singular('Companies'), 'company')
  assert.equal(m.singular('Sample requests'), 'sample request')
  assert.equal(m.singular('Movies'), 'movie')
  assert.equal(m.singular('Status'), 'status', 'a word that only ends in s is not stripped')
  assert.equal(m.singular('Inventory'), 'inventory')
  assert.equal(m.currencySymbol('GBP'), '£')
  assert.equal(m.currencySymbol(undefined), '')
  assert.equal(m.currencySymbol('nope'), '')
  assert.equal(m.plural(1, 'row', 'rows'), '1 row')
  assert.equal(m.plural(0, 'row', 'rows'), '0 rows')
  assert.equal(m.initials('Ada Lovelace'), 'AL')
  assert.equal(m.initials('mila9@example.test'), 'ME')
  assert.equal(m.initials(''), '?')
  assert.equal(m.byWords('person'), 'the owner')
  assert.equal(m.byWords('member:abc'), 'a team member')
  assert.equal(m.byWords('who-knows'), '', 'an unknown author is not invented')
})

ok('a record is titled by its title field, else by a short mark of its id', () => {
  assert.equal(m.titleOf(contacts, rec('rec_0123456789', { name: 'Ada' })), 'Ada')
  assert.equal(m.titleOf(contacts, rec('rec_0123456789', { name: '  ' })), 'Untitled 6789')
  assert.equal(m.titleOf({ ...contacts, title: null }, rec('rec_0123456789', { name: 'Ada' })), 'Untitled 6789', 'a title the actor may not see is not shown')
  assert.equal(m.titleOf({ ...contacts, title: 'n' }, rec('r1', { n: 7 })), '7')
})

ok('describe: each type draws as plain data, empty and checked values included', () => {
  const field = (k) => contacts.fields.find((f) => f.key === k)
  assert.deepEqual(m.describe(field('name'), '', undefined), { kind: 'empty' })
  assert.deepEqual(m.describe(field('name'), null, undefined), { kind: 'empty' })
  assert.deepEqual(m.describe(field('stage'), 'won'), { kind: 'pill', label: 'Won', color: 'green' })
  assert.deepEqual(m.describe(field('stage'), 'lost'), { kind: 'pill', label: 'Lost', color: 'gray' }, 'an option with no colour is grey')
  assert.deepEqual(m.describe(field('stage'), 'old'), { kind: 'pill', label: 'old', color: 'gray' }, 'an option that left the list still shows')
  assert.deepEqual(m.describe(field('spend'), 10), { kind: 'text', text: '£10.00' })
  assert.deepEqual(m.describe(field('since'), '2026-10-29'), { kind: 'text', text: 'Oct 29, 2026' })
  assert.deepEqual(m.describe({ key: 'ok', type: 'checkbox', label: 'OK' }, false), { kind: 'bool', value: false })
  assert.deepEqual(m.describe({ key: 'w', type: 'url', label: 'Site' }, 'https://a.example/x'), { kind: 'link', text: 'https://a.example/x', href: 'https://a.example/x' })
  assert.equal(m.describe({ key: 'w', type: 'url', label: 'Site' }, 'javascript:alert(1)').kind, 'text', 'only http(s) becomes a link')
  assert.deepEqual(m.describe({ key: 'm', type: 'multichoice', label: 'Tags', options: [{ key: 'a', label: 'A', color: 'red' }] }, ['a', 'b']), { kind: 'pills', items: [{ label: 'A', color: 'red' }, { label: 'b', color: 'gray' }] })
  const titles = { c1: 'Fenwick Roasters' }
  assert.deepEqual(m.describe(field('company'), 'c1', (o, id) => (o === 'companies' ? titles[id] ?? null : null)), { kind: 'refs', object: 'companies', items: [{ id: 'c1', title: 'Fenwick Roasters' }] })
  assert.deepEqual(m.describe(field('company'), 'zz', () => null).items, [{ id: 'zz', title: null }], 'a record this actor cannot read has no title')
})

ok('search finds a record by any visible value, option label or linked title', () => {
  const resolve = (o, id) => (id === 'c1' ? 'Fenwick Roasters' : null)
  const r = rec('r1', { name: 'Ada', stage: 'won', company: 'c1', email: 'ada@example.test' })
  assert.ok(m.searchText(contacts, r, resolve).includes('fenwick roasters'))
  assert.ok(m.searchText(contacts, r, resolve).includes('won'))
  const rows = [r, rec('r2', { name: 'Grace', stage: 'lead' })]
  assert.deepEqual(m.filterRecords(contacts, rows, { q: 'FENWICK' }, resolve).map((x) => x.id), ['r1'])
  assert.deepEqual(m.filterRecords(contacts, rows, { q: '  ' }, resolve).map((x) => x.id), ['r1', 'r2'], 'a blank search keeps everything')
  assert.deepEqual(m.filterRecords(contacts, rows, { field: contacts.fields[2], value: 'lead' }, resolve).map((x) => x.id), ['r2'])
  assert.deepEqual(m.filterRecords(contacts, rows, { q: 'zzz' }, resolve), [])
})

ok('table columns put the title first and leave out what does not fit a cell', () => {
  const keys = m.columnsOf(contacts).map((f) => f.key)
  assert.equal(keys[0], 'name')
  assert.ok(!keys.includes('note'), 'long text stays in the detail')
  const wide = { ...contacts, fields: Array.from({ length: 14 }, (_, i) => ({ key: 'f' + i, type: 'text', label: 'F' + i })), title: 'f3' }
  assert.equal(m.columnsOf(wide).length, m.MAX_COLUMNS)
  assert.equal(m.columnsOf(wide)[0].key, 'f3')
  assert.deepEqual(m.slotsFor(contacts), { name: 't', stage: 'b', company: 'm', spend: 'a', email: 'o', since: 'o', note: 'o', owner: 'o' })
})

ok('sorting is stated: newest first, or A to Z by title', () => {
  const rows = [rec('r1', { name: 'beta' }, '2026-10-01T00:00:00.000Z'), rec('r2', { name: 'Alpha' }, '2026-10-03T00:00:00.000Z'), rec('r3', { name: 'gamma' }, '2026-10-02T00:00:00.000Z')]
  assert.deepEqual(m.sortRecords(contacts, rows, 'new').map((r) => r.id), ['r2', 'r3', 'r1'])
  assert.deepEqual(m.sortRecords(contacts, rows, 'az').map((r) => r.id), ['r2', 'r1', 'r3'], 'case does not decide the order')
  assert.deepEqual(rows.map((r) => r.id), ['r1', 'r2', 'r3'], 'the list given is left alone')
})

ok('the board has one column per option, in order, and a last one only when a row has no value', () => {
  const rows = [rec('r1', { stage: 'won' }), rec('r2', { stage: 'lead' }), rec('r3', { stage: 'won' })]
  const cols = m.groupBoard(stages, rows)
  assert.deepEqual(cols.map((c) => c.key), ['lead', 'won', 'lost'])
  assert.deepEqual(cols.map((c) => c.records.length), [1, 2, 0], 'an empty column is kept: a card can be dropped there')
  assert.deepEqual(cols.map((c) => c.color), ['blue', 'green', 'gray'])
  const withNone = m.groupBoard(stages, [...rows, rec('r4', {}), rec('r5', { stage: 'retired' })])
  assert.equal(withNone.at(-1).label, 'No stage')
  assert.deepEqual(withNone.at(-1).records.map((r) => r.id), ['r4', 'r5'], 'a value that is no option anymore lands with the rows that have none')
  assert.equal(m.choiceFields(contacts).length, 1)
})

ok('a form reads typed text into values, and says what is wrong where', () => {
  const fields = m.formFields(OWNER, contacts)
  const good = m.readForm(fields, { name: ' Ada ', email: 'ada@example.test', stage: 'won', since: '2026-10-29', spend: '1 200,50', company: 'c1', note: '' })
  assert.deepEqual(good.errors, {})
  assert.deepEqual(good.values, { name: 'Ada', email: 'ada@example.test', stage: 'won', since: '2026-10-29', spend: 1200.5, company: 'c1' }, 'empty is not sent; a comma decimal is understood')
  const bad = m.readForm(fields, { name: '', email: 'ada@', stage: 'nope', spend: 'lots', since: '' })
  assert.deepEqual(Object.keys(bad.errors).sort(), ['email', 'name', 'spend', 'stage'])
  assert.equal(bad.errors.name, 'Name is required.')
  assert.equal(bad.errors.email, 'Enter a full email address, like name@company.com.')
  assert.equal(bad.errors.spend, 'Enter an amount, for example 24.50.')
  assert.equal(bad.errors.stage, 'Choose one of the options.')
  assert.equal(m.readForm([{ key: 'ok', type: 'checkbox', label: 'OK' }], {}).values.ok, false, 'an unchecked box is a false, not a gap')
  assert.deepEqual(m.readForm([{ key: 'u', type: 'url', label: 'U' }], { u: 'example.com' }).errors, { u: 'Start with http:// or https://.' })
  assert.deepEqual(m.readForm([{ key: 'p', type: 'phone', label: 'P' }], { p: 'abc' }).errors, { p: 'Enter a phone number, like +44 20 7946 0000.' })
  assert.deepEqual(m.readForm([{ key: 'r', type: 'relation', label: 'Company', to: 'c', required: true }], {}).errors, { r: 'Choose a company.' })
  assert.deepEqual(m.readForm([{ key: 'r', type: 'relation', label: 'People', to: 'c', many: true }], { r: ['a', 'b'] }).values, { r: ['a', 'b'] })
  assert.deepEqual(m.readForm([{ key: 'p', type: 'money', label: 'Total', required: true }, { key: 'q', type: 'number', label: 'Qty', required: true }], {}).errors, { p: 'Enter an amount, for example 24.50.', q: 'Enter a number.' })
  assert.deepEqual(m.readForm([{ key: 'f', type: 'attachment', label: 'Files', required: true, maxBytes: 10 }], {}).errors, { f: 'Add at least one file.' })
  assert.equal(m.parseNumber('1e5'), null, 'no exponent')
  assert.equal(m.parseNumber('-3.5'), -3.5)
  assert.equal(m.parseNumber('.5'), 0.5)
  assert.equal(m.parseNumber(''), null)
})

ok('each type has the control a person expects', () => {
  const control = (type, extra = {}) => m.controlOf({ key: 'k', type, label: 'K', ...extra })
  assert.equal(control('text'), 'text')
  assert.equal(control('longtext'), 'textarea')
  assert.equal(control('money'), 'money')
  assert.equal(control('phone'), 'tel')
  assert.equal(control('choice', { options: stages.options }), 'choice')
  assert.equal(control('choice', { options: Array.from({ length: 9 }, (_, i) => ({ key: 'o' + i, label: 'O' + i })) }), 'select', 'a long list is a select, not a row of buttons')
  assert.equal(control('relation', { to: 'x', many: true }), 'links')
  assert.equal(control('relation', { to: 'x' }), 'link')
  assert.equal(control('attachment'), 'file')
})

ok('the door and the edge answers are read as sentences, field errors first', () => {
  const a = m.readAnswer(400, { ok: false, error: 'invalid', message: 'x', errors: [{ path: 'set.email', code: 'format', message: 'must be a valid email address' }, { path: 'set.email', code: 'x', message: 'second is ignored' }, { path: 'elsewhere', code: 'x', message: 'not a field' }] })
  assert.deepEqual(a.fields, { email: 'Must be a valid email address.' })
  assert.equal(a.message, 'Some fields need a look.')
  assert.equal(m.readAnswer(401, {}).message, 'Your session ended. Sign in again.')
  assert.equal(m.readAnswer(429, { error: 'rate-limited', retryAfterSec: 30 }).message, 'Too many tries. Try again in 30 seconds.')
  assert.equal(m.readAnswer(429, { retryAfterSec: 600 }).message, 'Too many tries. Try again in 10 minutes.')
  assert.equal(m.readAnswer(429, null).message, 'Too many tries. Try again in a little while.')
  assert.equal(m.readAnswer(403, { error: 'forbidden', reason: 'owner-only' }).message, 'Only the owner can do that.')
  assert.equal(m.readAnswer(403, { error: 'forbidden' }).message, 'You do not have access to that.')
  assert.equal(m.readAnswer(413, {}).message, 'That file is too large.')
  assert.equal(m.readAnswer(404, {}).message, 'That was not found. It may have been removed.')
  assert.equal(m.readAnswer(409, { message: 'the row changed meanwhile' }).message, 'The row changed meanwhile.')
  assert.equal(m.readAnswer(500, 'garbage').message, 'That did not work. Try again.')
  assert.equal(m.readAnswer(0, null).message, 'The server cannot be reached. Check your connection and try again.')
})

ok('the relations graph keeps only the links this actor can follow', () => {
  const g = m.relationGraph([contacts, companies])
  assert.deepEqual(g.nodes.map((n) => [n.key, n.links]), [['contacts', ['Company']], ['companies', ['People']]], 'the link to a table the actor cannot see is not drawn')
  assert.deepEqual(g.edges, [{ a: 'companies', b: 'contacts', aEnd: '1', bEnd: 'many', fields: ['Company', 'People'] }], 'a field and its inverse are one line: one company, many contacts')
  const lone = m.relationGraph([{ ...contacts, fields: [contacts.fields[5]] }, { key: 'companies', label: 'Companies', count: 0, fields: [{ key: 'self', type: 'relation', label: 'Parent', to: 'companies' }] }])
  assert.deepEqual(lone.edges, [{ a: 'companies', b: 'contacts', aEnd: '1', bEnd: 'many', fields: ['Company'] }], 'with no inverse field the other end is « many »; a table linked to itself is not drawn')
  assert.deepEqual(m.linksOf([contacts, companies], 'companies').map((l) => [l.field, l.text]), [
    ['People', 'Each row in Companies can link to several rows in Contacts.'],
    ['Company', 'Each row in Contacts links to one row in Companies.'],
  ], 'the links that start at the table come first, then the ones that end there')
  assert.equal(m.linksOf([contacts], 'nope').length, 0)
  assert.equal(m.linksOf([contacts], 'contacts').length, 0, 'a link to a table that is not there is not listed')
})

ok('the drawing places every table once, inside its box, and the lines meet the borders', () => {
  const tables = Array.from({ length: 5 }, (_, i) => ({ key: 't' + i, label: 'T' + i, count: i, links: ['A', 'B'] }))
  for (const n of [1, 2, 3, 5]) {
    const lay = m.layoutGraph(tables.slice(0, n))
    assert.equal(lay.nodes.length, n)
    for (const b of lay.nodes) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= lay.width && b.y + b.h <= lay.height, 'box ' + b.key + ' stays inside the drawing (n=' + n + ')')
    }
    const boxes = lay.nodes
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]; const b = boxes[j]
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'boxes do not overlap (n=' + n + ')')
    }
  }
  assert.equal(m.layoutGraph(Array.from({ length: m.MAX_DRAWN + 1 }, (_, i) => ({ key: 'k' + i, links: [] }))).nodes.length, 0, 'too many tables are listed, not drawn')
  assert.equal(m.layoutGraph([]).nodes.length, 0)
  const p = m.edgePoints({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 })
  assert.deepEqual(p, { from: { x: 100, y: 25 }, to: { x: 300, y: 25 } })
  assert.deepEqual(m.along({ x: 0, y: 0 }, { x: 10, y: 0 }, 4, 3), { x: 4, y: 3 }, 'a label sits along the line and to its side')
  assert.deepEqual(m.along({ x: 10, y: 0 }, { x: 0, y: 0 }, 4, 3), { x: 6, y: 3 }, 'the label stays on the lower side whichever end it is for')
  assert.deepEqual(m.along({ x: 0, y: 0 }, { x: 0, y: 10 }, 4, 3), { x: 3, y: 4 }, 'a vertical line takes it on the right')
  assert.deepEqual(m.along({ x: 0, y: 0 }, { x: 10, y: 0 }, 4, 3, { x: 0, y: -5 }), { x: 4, y: 3 }, 'away from a box above it: below the line')
  assert.deepEqual(m.along({ x: 0, y: 0 }, { x: 10, y: 0 }, 4, 3, { x: 0, y: 5 }), { x: 4, y: -3 }, 'away from a box below it: above the line, never under the box')
  assert.deepEqual(m.along({ x: 5, y: 5 }, { x: 5, y: 5 }, 4, 3), { x: 5, y: 5 }, 'two equal points do not divide by zero')
  const ring = m.ringOrder(['o', 'c', 'p', 's'].map((key) => ({ key })), [{ a: 'c', b: 'o' }, { a: 'o', b: 'p' }, { a: 'c', b: 's' }])
  assert.deepEqual(ring.map((n) => n.key), ['o', 'c', 's', 'p'], 'linked tables sit side by side on the ring: no line crosses the middle here')
  assert.deepEqual(m.ringOrder([], []), [])
  assert.equal(m.nodeHeight({ links: [] }), 40, 'a table with no link is a header only')
  assert.equal(m.nodeHeight({ links: ['a', 'b', 'c', 'd'] }), 44 + 3 * 24, 'at most three links are listed in a box')
})

ok('the hash route round-trips and lands on something the actor can see', () => {
  assert.deepEqual(m.parseRoute('#/shop/orders/board'), { slug: 'shop', object: 'orders', view: 'board' })
  assert.deepEqual(m.parseRoute('#/shop'), { slug: 'shop', object: '', view: 'table' })
  assert.deepEqual(m.parseRoute(''), { slug: '', object: '', view: 'table' })
  assert.deepEqual(m.parseRoute('#/a%20b/c%2Fd/nonsense'), { slug: 'a b', object: 'c/d', view: 'table' })
  assert.deepEqual(m.parseRoute('#/%E0%A4%A/x'), { slug: '', object: 'x', view: 'table' }, 'a broken escape does not throw')
  assert.equal(m.routeHash({ slug: 'a b', object: 'c/d', view: 'relations' }), '#/a%20b/c%2Fd/relations')
  assert.equal(m.routeHash({ slug: 'shop', object: 'orders', view: 'table' }), '#/shop/orders')
  const apps = [{ slug: 'shop', objects: [contacts, { ...companies, fields: [companies.fields[0]] }] }]
  assert.deepEqual(m.settleRoute(apps, { slug: '', object: '', view: 'table' }), { slug: 'shop', object: 'contacts', view: 'table' })
  assert.deepEqual(m.settleRoute(apps, { slug: 'shop', object: 'ghost', view: 'board' }), { slug: 'shop', object: 'contacts', view: 'board' })
  assert.deepEqual(m.settleRoute(apps, { slug: 'shop', object: 'companies', view: 'board' }), { slug: 'shop', object: 'companies', view: 'table' }, 'no choice field, no board')
  assert.equal(m.settleRoute([], { slug: 'x', object: '', view: 'table' }), null)
  assert.deepEqual(m.settleRoute([{ slug: 'empty', objects: [] }], { slug: 'empty', object: '', view: 'board' }), { slug: 'empty', object: '', view: 'table' })
})

ok('the page and the server agree on the shortest password', () => {
  const server = /export const MIN_PASSWORD = (\d+)/.exec(readFileSync(new URL('./templates/tables/app.mjs', import.meta.url), 'utf8'))
  assert.ok(server !== null, 'app.mjs exports MIN_PASSWORD')
  assert.equal(m.MIN_PASSWORD, Number(server[1]))
})

console.log(count + ' checks passed')
