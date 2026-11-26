// kybernos-db import: how a cell becomes a value, and the `records_import` tool that writes a prepared file (data-feed skill).
// Hermetic: every database and every import file lives in a temp folder; « today » and the clock are fixed.
//
//   node packages/kybernos-db/test-import.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IMPORT_KIND, coerceCell, coerceRows, dateOrderOf, decimalOf, parseDate, parseImport, parseNumber, planColumns } from './agent/import.mjs'
import { makeService } from './agent/service.mjs'
import { approvalGate, tools } from './agent/tools.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }

const root = mkdtempSync(join(tmpdir(), 'kb-db-import-'))
const imports = join(root, 'imports')
mkdirSync(imports, { recursive: true })
let n = 0
const clock = () => { let t = Date.UTC(2026, 9, 30, 9, 0, 0); return () => (t += 1) }
const sequence = () => { let i = 0; return (len) => { i += 1; return Uint8Array.from({ length: len }, (_, k) => (i * 31 + k * 7 + 1) & 255) } }
const service = () => makeService({ dir: join(root, 's' + (n++)), ports: { now: clock(), random: sequence() } })
const toolbox = (svc) => Object.fromEntries(tools(svc, { today: () => '2026-10-30', importsDir: imports }).map((t) => [t.name, t]))

const num = (raw, decimal) => { const r = parseNumber(raw, decimal); return r.ok ? r.value : r.code }
const date = (raw, order) => { const r = parseDate(raw, order); return r.ok ? r.value : r.code }

// ---------------------------------------------------------------- numbers
await ok('numbers in the shapes people write them', () => {
  assert.equal(num('1234.5'), 1234.5)
  assert.equal(num('1,234.50'), 1234.5)
  assert.equal(num('1 234,50'), 1234.5)
  assert.equal(num('1 234,50'), 1234.5)
  assert.equal(num('1.234,50'), 1234.5)
  assert.equal(num('$12.50'), 12.5)
  assert.equal(num('12,50 €'), 12.5)
  assert.equal(num('EUR 12.50'), 12.5)
  assert.equal(num('12.50 USD'), 12.5)
  assert.equal(num('(1 200)'), -1200)
  assert.equal(num('-3'), -3)
  assert.equal(num('−3,5'), -3.5)
  assert.equal(num('3-'), -3)
  assert.equal(num('12%'), 12)
  assert.equal(num('1,234,567'), 1234567)
  assert.equal(num('1.234.567'), 1234567)
  assert.equal(num(42), 42)
  assert.equal(num('0'), 0)
})

await ok('« 1,234 » is a thousand unless the column says the comma is the decimal mark', () => {
  assert.equal(num('1,234'), 1234)
  assert.equal(num('1,234', ','), 1.234)
  assert.equal(num('1.234'), 1.234)
  assert.equal(num('1.234', ','), 1234)
  assert.equal(num('12,5'), 12.5)
})

await ok('what is not a number is refused, not guessed', () => {
  for (const bad of ['abc', '12abc', '1.2.3,4', '--3', '', '€', '12 apples', 'NaN', 'Infinity']) assert.equal(num(bad), 'type', bad)
  assert.equal(parseNumber(Infinity).ok, false)
  assert.equal(parseNumber(true).ok, false)
})

await ok('the decimal mark of a column is deduced only when its values settle it', () => {
  assert.equal(decimalOf(['1,50', '2,25', '10,00']), ',')
  assert.equal(decimalOf(['1.50', '2.25']), '.')
  assert.equal(decimalOf(['1,234', '2,500']), null)
  assert.equal(decimalOf(['1,234.50', '999.99']), '.')
  assert.equal(decimalOf(['1.234,50', '9,99']), ',')
  assert.equal(decimalOf(['1,234,567']), '.')
  assert.equal(decimalOf([12, 'x']), null)
})

// ---------------------------------------------------------------- dates
await ok('dates in the shapes people write them', () => {
  assert.equal(date('2026-01-05'), '2026-01-05')
  assert.equal(date('2026-1-5'), '2026-01-05')
  assert.equal(date('2026-01-05T10:30:00Z'), '2026-01-05')
  assert.equal(date('2026-01-05 10:30'), '2026-01-05')
  assert.equal(date('2026/01/05'), '2026-01-05')
  assert.equal(date('13/01/2026'), '2026-01-13')
  assert.equal(date('01/13/2026'), '2026-01-13')
  assert.equal(date('05/01/2026', 'dmy'), '2026-01-05')
  assert.equal(date('05/01/2026', 'mdy'), '2026-05-01')
  assert.equal(date('5.1.2026', 'dmy'), '2026-01-05')
  assert.equal(date('05-01-26', 'dmy'), '2026-01-05')
  assert.equal(date('5 Jan 2026'), '2026-01-05')
  assert.equal(date('5 janvier 2026'), '2026-01-05')
  assert.equal(date('5 déc. 2026'), '2026-12-05')
  assert.equal(date('January 5, 2026'), '2026-01-05')
  assert.equal(date('Sept 3 2026'), '2026-09-03')
  assert.equal(date('1 de agosto 2026'.replace(' de', '')), '2026-08-01')
})

await ok('a date that could be read two ways is refused until the order is told; an impossible one is always refused', () => {
  assert.equal(date('05/01/2026'), 'ambiguous')
  assert.equal(date('31/02/2026', 'dmy'), 'format')
  assert.equal(date('2026-13-01'), 'format')
  assert.equal(date('yesterday'), 'format')
  assert.equal(date(45000), 'type')
  assert.equal(dateOrderOf(['13/01/2026', '05/01/2026']), 'dmy')
  assert.equal(dateOrderOf(['01/13/2026', '05/01/2026']), 'mdy')
  assert.equal(dateOrderOf(['05/01/2026', '06/02/2026']), null)
  assert.equal(dateOrderOf(['13/01/2026', '01/13/2026']), null)
  assert.equal(dateOrderOf(['2026-01-05']), null)
})

// ---------------------------------------------------------------- the other cells
const STATUS = { key: 'status', type: 'choice', label: 'Status', options: [{ key: 'paid', label: 'Paid' }, { key: 'pending', label: 'Pending' }, { key: 'refunded', label: 'Refunded' }] }
await ok('yes and no, in several languages; an empty cell is unchecked', () => {
  const f = { key: 'paid', type: 'checkbox', label: 'Paid' }
  for (const yes of ['yes', 'Yes', 'OUI', 'true', '1', 'x', '✓', 'Si', 'Vrai', true, 1]) assert.equal(coerceCell(f, yes).value, true, String(yes))
  for (const no of ['no', 'Non', 'false', '0', '', null, undefined, false, 0]) assert.equal(coerceCell(f, no).value, false, String(no))
  assert.equal(coerceCell(f, 'peut-être').ok, false)
  assert.equal(coerceCell(f, 2).ok, false)
})

await ok('a choice is found by key or label, in any case and any accent; the strangers are counted', () => {
  const accented = { key: 'cat', type: 'choice', label: 'Category', options: [{ key: 'lighting', label: 'Éclairage' }, { key: 'furniture', label: 'Mobilier' }] }
  assert.equal(coerceCell(accented, 'éclairage').value, 'lighting')
  assert.equal(coerceCell(accented, 'ECLAIRAGE').value, 'lighting')
  assert.equal(coerceCell(accented, 'furniture').value, 'furniture')
  assert.equal(coerceCell(accented, '  Mobilier ').value, 'furniture')
  const unknown = new Map()
  assert.equal(coerceCell(accented, 'Jardin', {}, unknown).code, 'option')
  coerceCell(accented, 'Jardin', {}, unknown)
  assert.deepEqual([...unknown], [['Jardin', 2]])
  assert.equal(coerceCell(accented, '').value, null)
  const multi = { key: 'tags', type: 'multichoice', label: 'Tags', options: [{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }] }
  assert.deepEqual(coerceCell(multi, 'alpha; Beta|alpha').value, ['a', 'b'])
  assert.equal(coerceCell(multi, 'alpha, gamma').code, 'option')
  assert.equal(coerceCell(multi, ' ; ').value, null)
})

await ok('texts are trimmed, numbers become texts, and a field a cell cannot fill says so', () => {
  const t = { key: 'name', type: 'text', label: 'Name' }
  assert.equal(coerceCell(t, '  Ada ').value, 'Ada')
  assert.equal(coerceCell(t, 42).value, '42')
  assert.equal(coerceCell(t, '   ').value, null)
  for (const type of ['person', 'relation', 'attachment']) assert.equal(coerceCell({ key: 'x', type, label: 'X' }, 'a').code, 'unsupported')
})

// ---------------------------------------------------------------- the file
const header = (columns, rows) => ({ kind: IMPORT_KIND, version: 1, id: 'sales-test', source: 'sales.csv', format: 'csv', sheet: null, columns, rows, created: '2026-10-30T09:00:00.000Z' })
const fileText = (columns, rows, first = 2) => [JSON.stringify(header(columns, rows.length)), ...rows.map((c, i) => JSON.stringify({ r: first + i, c }))].join('\n') + '\n'

await ok('the prepared file is read strictly', () => {
  const good = parseImport(fileText(['A', 'B'], [['1', '2'], ['3', '4']]))
  assert.equal(good.ok, true)
  assert.deepEqual(good.rows.map((r) => r.r), [2, 3])
  assert.equal(parseImport('').code, 'empty')
  assert.equal(parseImport('nope\n').code, 'format')
  assert.equal(parseImport(JSON.stringify({ kind: 'other', version: 1, columns: [] }) + '\n').code, 'format')
  assert.equal(parseImport(JSON.stringify({ ...header(['A'], 0), version: 2 }) + '\n').code, 'format')
  assert.equal(parseImport(JSON.stringify(header(['A'], 1)) + '\n{"r":2}\n').code, 'format')
  assert.equal(parseImport(JSON.stringify(header(['A'], 1)) + '\nnot json\n').code, 'format')
})

const ORDERS = {
  key: 'order', label: 'Orders', title: 'ref',
  fields: [
    { key: 'ref', type: 'text', label: 'Reference', required: true },
    { key: 'day', type: 'date', label: 'Date' },
    { key: 'customer', type: 'text', label: 'Customer' },
    { key: 'email', type: 'email', label: 'Email', protection: 'personal' },
    { key: 'amount', type: 'money', label: 'Amount', currency: 'EUR' },
    { key: 'qty', type: 'number', label: 'Quantity' },
    STATUS,
    { key: 'paid', type: 'checkbox', label: 'Paid' },
    { key: 'owner', type: 'person', label: 'Owner' },
  ],
}
const COLUMNS = ['Order', 'Date', 'Customer', 'Email', 'Total', 'Qty', 'Status', 'Paid']
const MAP = { Order: 'ref', Date: 'day', Customer: 'customer', Total: 'amount', Qty: 'qty', Status: 'status', Paid: 'paid' }

await ok('the columns are checked against the file and the object before a row is read', () => {
  const head = header(COLUMNS, 0)
  const obj = ORDERS
  assert.equal(planColumns(head, obj, MAP).ok, true)
  assert.equal(planColumns(head, obj, {}).code, 'invalid')
  assert.equal(planColumns(head, obj, { Nope: 'ref' }).code, 'unknown_column')
  assert.equal(planColumns(head, obj, { Order: 'nope' }).code, 'unknown_field')
  assert.equal(planColumns(head, obj, { Order: 'owner' }).code, 'unsupported')
  assert.equal(planColumns(head, obj, { Order: 'ref', Customer: 'ref' }).code, 'duplicate')
  assert.equal(planColumns(head, { ...obj, fields: [{ key: 'k', type: 'text', label: 'K', protection: 'secret' }] }, { Order: 'k' }).code, 'secret')
  const told = planColumns(head, obj, { Total: { field: 'amount', decimal: ',' }, Date: { field: 'day', dateOrder: 'mdy' }, Qty: 'qty' }, { decimal: '.', dateOrder: 'dmy' })
  assert.deepEqual(told.plan.map((p) => [p.column, p.decimal, p.dateOrder]), [['Total', ',', 'dmy'], ['Date', '.', 'mdy'], ['Qty', '.', 'dmy']])
})

await ok('rows are coerced field by field, and the engine\'s own checks apply (a bad e-mail, a missing required value)', () => {
  const head = header(COLUMNS, 3)
  const plan = planColumns(head, ORDERS, { ...MAP, Email: 'email' }, { decimal: ',', dateOrder: 'dmy' }).plan
  const rows = [
    { r: 2, c: ['A-1', '05/01/2026', 'Ada', 'ada@example.com', '1 249,50', '2', 'paid', 'oui'] },
    { r: 3, c: ['A-2', '13/01/2026', 'Bob', 'not-an-email', '10,00', '1', 'Pending', 'non'] },
    { r: 4, c: [null, '14/01/2026', 'Cy', null, 'abc', '1', 'Gone', 'non'] },
  ]
  const out = coerceRows(rows, plan)
  assert.deepEqual(out.rows[0].values, { ref: 'A-1', day: '2026-01-05', customer: 'Ada', email: 'ada@example.com', amount: 1249.5, qty: 2, status: 'paid', paid: true })
  assert.equal(out.rows[1].error.field, 'email')
  assert.equal(out.rows[1].error.code, 'format')
  assert.equal(out.rows[2].error.field, 'ref')
  assert.equal(out.rows[2].error.code, 'required')
  assert.ok(out.reasons['Total: not a number'] >= 1)
  assert.deepEqual(out.unknownChoices, { status: [{ value: 'Gone', rows: 1 }] })
})

// ---------------------------------------------------------------- the tool
const write = (id, columns, rows) => { writeFileSync(join(imports, id + '.jsonl'), fileText(columns, rows)); return id }
const sale = (i, over = {}) => ['A-' + String(i).padStart(4, '0'), '0' + (1 + (i % 9)) + '/01/2026', 'Customer ' + (i % 7), 'c' + i + '@example.com', String(10 + i) + ',50', String(1 + (i % 3)), ['Paid', 'Pending', 'Refunded'][i % 3], i % 2 ? 'yes' : 'no'].map((v, k) => (over[k] === undefined ? v : over[k]))

async function ready () {
  const svc = service()
  const T = toolbox(svc)
  assert.equal((await T.db_create.execute({ name: 'Shop' })).ok, true)
  const def = await T.object_define.execute({ key: ORDERS.key, label: ORDERS.label, title: ORDERS.title, fields: ORDERS.fields })
  assert.equal(def.ok, true, JSON.stringify(def))
  return { svc, T }
}
const total = async (T) => (await T.records_list.execute({ object: 'order', limit: 1 })).total

await ok('a dry run writes nothing and says what would happen', async () => {
  const { T } = await ready()
  const id = write('dry-run-one', COLUMNS, [sale(1), sale(2), sale(3, { 4: 'x1' })])
  const r = await T.records_import.execute({ object: 'order', import: id, columns: MAP, decimal: ',', dateOrder: 'dmy', dryRun: true })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.dryRun, true)
  assert.deepEqual([r.rows, r.valid, r.refused, r.created, r.updated], [3, 2, 1, 2, 0])
  assert.equal(r.refusedRows[0].row, 4)
  assert.equal(r.refusedRows[0].column, 'Total')
  assert.deepEqual(r.ignoredColumns, ['Email'])
  assert.equal(r.preview.length, 2)
  assert.equal(r.preview[0].amount, 11.5)
  assert.equal(await total(T), 0, 'nothing was written')
})

await ok('rows are written, converted, and the engine stores what was asked', async () => {
  const { T } = await ready()
  const id = write('write-all-one', COLUMNS, [sale(1), sale(2), sale(3)])
  const r = await T.records_import.execute({ object: 'order', import: id, columns: { ...MAP, Email: 'email' }, decimal: ',', dateOrder: 'dmy' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual([r.created, r.updated, r.unchanged, r.refused], [3, 0, 0, 0])
  const list = await T.records_list.execute({ object: 'order' })
  assert.equal(list.total, 3)
  const first = list.records[0].values
  assert.deepEqual([first.ref, first.day, first.amount, first.qty, first.status, first.paid], ['A-0001', '2026-01-02', 11.5, 2, 'pending', true])
  assert.match(first.email, /^••••/, 'a protected field stays masked when read back')
})

await ok('any refused row stops the whole import unless the person\'s agent says to skip it', async () => {
  const { T } = await ready()
  const id = write('some-refused-one', COLUMNS, [sale(1), sale(2, { 6: 'Lost' }), sale(3)])
  const stopped = await T.records_import.execute({ object: 'order', import: id, columns: MAP, decimal: ',', dateOrder: 'dmy' })
  assert.equal(stopped.ok, false)
  assert.equal(stopped.error, 'rows_refused')
  assert.equal(stopped.refused, 1)
  assert.deepEqual(stopped.unknownChoices, { status: [{ value: 'Lost', rows: 1 }] })
  assert.equal(await total(T), 0)
  const skipped = await T.records_import.execute({ object: 'order', import: id, columns: MAP, decimal: ',', dateOrder: 'dmy', skipRefused: true })
  assert.equal(skipped.ok, true, JSON.stringify(skipped))
  assert.deepEqual([skipped.created, skipped.refused], [2, 1])
  assert.equal(await total(T), 2)
})

await ok('a key makes the load repeatable: same file twice adds nothing, a changed row updates its record', async () => {
  const { T } = await ready()
  const rows = [sale(1), sale(2), sale(3)]
  const first = await T.records_import.execute({ object: 'order', import: write('key-first-one', COLUMNS, rows), columns: MAP, decimal: ',', dateOrder: 'dmy', key: 'ref' })
  assert.deepEqual([first.created, first.updated, first.unchanged], [3, 0, 0], JSON.stringify(first))
  const again = await T.records_import.execute({ object: 'order', import: write('key-again-one', COLUMNS, rows), columns: MAP, decimal: ',', dateOrder: 'dmy', key: 'ref' })
  assert.deepEqual([again.created, again.updated, again.unchanged], [0, 0, 3])
  const changed = [sale(1), sale(2, { 4: '99,00', 6: 'Refunded' }), sale(4)]
  const dry = await T.records_import.execute({ object: 'order', import: write('key-change-one', COLUMNS, changed), columns: MAP, decimal: ',', dateOrder: 'dmy', key: 'ref', dryRun: true })
  assert.deepEqual([dry.created, dry.updated, dry.unchanged], [1, 1, 1])
  assert.equal(await total(T), 3, 'the dry run wrote nothing')
  const real = await T.records_import.execute({ object: 'order', import: 'key-change-one', columns: MAP, decimal: ',', dateOrder: 'dmy', key: 'ref' })
  assert.deepEqual([real.created, real.updated, real.unchanged], [1, 1, 1])
  const list = await T.records_list.execute({ object: 'order' })
  assert.equal(list.total, 4)
  const two = list.records.find((r) => r.values.ref === 'A-0002').values
  assert.deepEqual([two.amount, two.status], [99, 'refunded'])
})

await ok('two rows of one file with the same key: the last one wins, and one record is made', async () => {
  const { T } = await ready()
  const id = write('key-twice-one', COLUMNS, [sale(1), sale(1, { 4: '77,00' })])
  const r = await T.records_import.execute({ object: 'order', import: id, columns: MAP, decimal: ',', dateOrder: 'dmy', key: 'ref' })
  assert.deepEqual([r.created, r.updated], [1, 0], JSON.stringify(r))
  const list = await T.records_list.execute({ object: 'order' })
  assert.deepEqual([list.total, list.records[0].values.amount], [1, 77])
})

await ok('a key must be a plain field of the mapping, and an empty key is refused', async () => {
  const { T } = await ready()
  const id = write('key-bad-one', COLUMNS, [sale(1), sale(2, { 0: '' })])
  const base = { object: 'order', import: id, columns: { ...MAP, Email: 'email' }, decimal: ',', dateOrder: 'dmy' }
  assert.equal((await T.records_import.execute({ ...base, key: 'nope' })).error, 'invalid_key')
  assert.equal((await T.records_import.execute({ ...base, key: 'email' })).error, 'invalid_key', 'a protected field is never a key')
  assert.equal((await T.records_import.execute({ ...base, key: 'owner' })).error, 'invalid_key')
  const r = await T.records_import.execute({ ...base, key: 'ref', dryRun: true })
  assert.ok(r.refusedRows.length >= 1)
})

await ok('the call is refused when the file, the mapping or the object does not fit', async () => {
  const { T } = await ready()
  const id = write('fits-nothing-one', COLUMNS, [sale(1)])
  const base = { object: 'order', import: id, columns: MAP }
  assert.equal((await T.records_import.execute({ ...base, import: 'no-such-file' })).error, 'unknown_import')
  for (const bad of ['../etc/passwd', '..', 'a/b', 'UPPER-CASE', 'x', '', 12, null]) assert.equal((await T.records_import.execute({ ...base, import: bad })).error, 'invalid', String(bad))
  assert.equal((await T.records_import.execute({ ...base, object: 'nope' })).error, 'unknown_object')
  assert.equal((await T.records_import.execute({ ...base, columns: { Order: 'owner' } })).error, 'unsupported')
  assert.equal((await T.records_import.execute({ ...base, columns: { Date: 'day' } })).error, 'missing_required', 'the required reference has no column')
  assert.equal((await T.records_import.execute({ ...base, columns: { Nope: 'ref' } })).error, 'unknown_column')
  writeFileSync(join(imports, 'broken-file-one.jsonl'), 'garbage\n')
  assert.equal((await T.records_import.execute({ ...base, import: 'broken-file-one' })).error, 'format')
  const none = Object.fromEntries(tools(service(), {}).map((t) => [t.name, t]))
  await none.db_create.execute({ name: 'X' })
  await none.object_define.execute({ key: 'order', label: 'Orders', fields: [{ key: 'ref', type: 'text', label: 'R' }] })
  assert.equal((await none.records_import.execute({ object: 'order', import: id, columns: { Order: 'ref' } })).error, 'unavailable')
})

await ok('an ambiguous date and a wrong decimal are caught by the dry run, not stored', async () => {
  const { T } = await ready()
  const id = write('ambiguous-one', COLUMNS, [sale(1), sale(2)])
  const r = await T.records_import.execute({ object: 'order', import: id, columns: MAP, decimal: ',', dryRun: true })
  assert.equal(r.refused, 2)
  assert.match(Object.keys(r.reasons)[0], /Date: ambiguous date/)
  const fixed = await T.records_import.execute({ object: 'order', import: id, columns: { ...MAP, Date: { field: 'day', dateOrder: 'dmy' } }, decimal: ',', dryRun: true })
  assert.equal(fixed.refused, 0)
})

await ok('filling a protected field asks the person; a dry run asks nothing', async () => {
  const { svc } = await ready()
  const call = (extra) => ({ name: 'records_import', arguments: { object: 'order', import: 'any-file-one', columns: { Email: 'email', Order: 'ref' }, ...extra } })
  const asked = approvalGate(svc, call({}))
  assert.equal(asked.kind, 'ask')
  assert.match(asked.reason, /email|Email/)
  assert.equal(approvalGate(svc, call({ dryRun: true })), null)
  assert.equal(approvalGate(svc, call({ columns: { Order: 'ref', Total: { field: 'amount' } } })), null, 'normal fields ask nothing')
  assert.equal(approvalGate(svc, call({ columns: { Email: { field: 'email', decimal: ',' } } })).kind, 'ask', 'the long form of a column asks too')
  assert.equal(approvalGate(svc, call({ columns: 'nope' })), null)
  assert.equal(approvalGate(svc, { name: 'records_import', arguments: { object: 'nope', columns: { A: 'b' } } }), null)
})

await ok('a few thousand rows load in a few seconds and DSH stays responsive in between', async () => {
  const { T } = await ready()
  const rows = Array.from({ length: 3000 }, (_, i) => sale(i + 1))
  const id = write('three-thousand', COLUMNS, rows)
  let ticks = 0
  const timer = setInterval(() => { ticks++ }, 5)
  const started = Date.now()
  const r = await T.records_import.execute({ object: 'order', import: id, columns: MAP, decimal: ',', dateOrder: 'dmy', key: 'ref', skipRefused: true })
  const took = Date.now() - started
  clearInterval(timer)
  assert.equal(r.created + r.refused, 3000, JSON.stringify({ ...r, preview: undefined }))
  assert.ok(r.created > 2000)
  assert.ok(took < 20000, 'took ' + took + ' ms')
  assert.ok(ticks >= 3, 'the event loop turned during the import (' + ticks + ' ticks in ' + took + ' ms)')
  console.log('     3000 rows with a key in ' + took + ' ms, ' + r.created + ' created, ' + r.refused + ' refused')
})

console.log('\n' + count + ' checks passed')
