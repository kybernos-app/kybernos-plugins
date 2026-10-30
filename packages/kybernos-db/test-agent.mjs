// kybernos-db agent: the tools an agent has, the approval cards, the prompt block and the service that finds the db a call means.
// Hermetic: every database lives in a temp folder; « today » and the clock are fixed.
//
//   node packages/kybernos-db/test-agent.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SECTION_MAX_CHARS, renderBlock } from './agent/context.mjs'
import { cardFor, protectedCard } from './agent/cards.mjs'
import { makeService } from './agent/service.mjs'
import { BATCH_MAX, LIST_DEFAULT, LIST_MAX, NAMES, approvalGate, tools } from './agent/tools.mjs'
import { fieldLine, protectionWord, typeWord } from './agent/words.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }

const root = mkdtempSync(join(tmpdir(), 'kb-db-agent-'))
let n = 0
const clock = () => { let t = Date.UTC(2026, 9, 30, 9, 0, 0); return () => (t += 1) }
const sequence = () => { let i = 0; return (len) => { i += 1; return Uint8Array.from({ length: len }, (_, k) => (i * 31 + k * 7 + 1) & 255) } }
const service = () => makeService({ dir: join(root, 's' + (n++)), ports: { now: clock(), random: sequence() } })
const toolbox = (svc) => Object.fromEntries(tools(svc, { today: () => '2026-10-30' }).map((t) => [t.name, t]))
const text = (r) => r.map((p) => p.text).join('\n')

const TASKS = {
  key: 'task', label: 'Tasks', title: 'name',
  fields: [
    { key: 'name', type: 'text', label: 'Name', required: true },
    { key: 'status', type: 'choice', label: 'Status', options: [{ key: 'todo', label: 'To do' }, { key: 'doing', label: 'Doing' }, { key: 'done', label: 'Done' }] },
    { key: 'due', type: 'date', label: 'Due' },
    { key: 'email', type: 'email', label: 'Email', protection: 'personal' },
    { key: 'cost', type: 'money', label: 'Cost', currency: 'EUR', protection: 'sensitive' },
    { key: 'token', type: 'text', label: 'Token', protection: 'secret' },
  ],
}
const ASK_FIELDS = ['email', 'cost', 'token']

/** A service with one db, one object and three tasks; returns the pieces. */
async function seeded () {
  const svc = service()
  const T = toolbox(svc)
  const made = await T.db_create.execute({ name: 'Home' })
  assert.equal(made.ok, true)
  const def = await T.object_define.execute({ key: TASKS.key, label: TASKS.label, title: TASKS.title, fields: TASKS.fields })
  assert.equal(def.ok, true, JSON.stringify(def))
  const made3 = await T.records_create.execute({
    object: 'task',
    records: [
      { name: 'Pay the rent', status: 'todo', due: '2026-10-31', email: 'landlord@example.com', cost: 950, token: 'sk-live-123456' },
      { name: 'Call the dentist', status: 'doing', due: '2026-11-04' },
      { name: 'File the taxes', status: 'done', due: '2026-10-01' },
    ],
  })
  assert.equal(made3.ok, true, JSON.stringify(made3))
  return { svc, T, db: made.db, ids: made3.created.map((r) => r.id) }
}

// ---------------------------------------------------------------- words
await ok('a field is described in both languages, with its type, requirement and protection', () => {
  const f = { key: 'status', type: 'choice', label: 'Status', required: true, protection: 'personal', options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] }
  assert.equal(fieldLine(f, 'en'), 'Status (choice: A, B, required, personal)')
  assert.equal(fieldLine(f, 'fr'), 'Status (choix: A, B, obligatoire, personnel)')
  assert.equal(fieldLine({ key: 'p', type: 'relation', label: 'Project', to: 'project', many: true, protection: 'normal' }, 'en'), 'Project (link → project (many))')
  assert.equal(fieldLine({ key: 'c', type: 'money', label: 'Cost', currency: 'EUR', protection: 'normal' }, 'fr'), 'Cost (montant EUR)')
  assert.equal(typeWord('nope', 'en'), 'nope')
  assert.equal(protectionWord('secret', 'fr'), 'secret')
})

// ---------------------------------------------------------------- the service
await ok('a call finds the only db, and is told what to do when there is none or several', async () => {
  const svc = service()
  assert.equal(svc.resolve().code, 'no_db')
  const a = svc.create({ name: 'A', by: 'agent' })
  assert.equal(a.ok, true)
  assert.equal(svc.resolve().db.info().name, 'A')
  const b = svc.create({ name: 'B', by: 'agent' })
  const r = svc.resolve()
  assert.equal(r.code, 'which_db')
  assert.ok(r.message.includes(a.db.info().id) && r.message.includes(b.db.info().id), 'the message names every db')
  assert.equal(svc.resolve(b.db.info().id).db.info().name, 'B')
  assert.equal(svc.resolve('nope').code, 'unknown_db')
  assert.equal(svc.resolve('01ARYZ6S410000000000000000').code, 'unknown_db')
  assert.deepEqual(svc.snapshot().map((d) => d.name).sort(), ['A', 'B'])
  svc.close()
})

await ok('a db that is already open is the same object, and a new service over the folder sees the dbs', async () => {
  const dir = join(root, 'reopen')
  const first = makeService({ dir, ports: { now: clock(), random: sequence() } })
  const a = first.create({ name: 'Keep', by: 'agent' })
  const id = a.db.info().id
  assert.equal(first.byId(id).db, first.byId(id).db)
  first.close()
  const second = makeService({ dir })
  assert.deepEqual(second.list().map((d) => d.id), [id])
  assert.equal(second.resolve().db.info().name, 'Keep')
  second.close()
})

// ---------------------------------------------------------------- the tools: structure
await ok('the tools are the thirteen named, each with strict parameters and a render that never throws', async () => {
  const T = toolbox(service())
  assert.deepEqual(Object.keys(T), NAMES)
  assert.equal(new Set(Object.keys(T)).size, 13)
  for (const t of Object.values(T)) {
    assert.equal(typeof t.description, 'string')
    assert.ok(t.description.length > 40, t.name + ' describes itself')
    assert.equal(t.parameters.type, 'object')
    assert.equal(t.parameters.additionalProperties, false, t.name + ' refuses unknown arguments')
    for (const key of t.parameters.required || []) assert.ok(key in t.parameters.properties, t.name + ' requires a known property: ' + key)
    for (const value of [{ ok: true }, { ok: false, error: 'x', detail: 'y' }, { ok: false }]) assert.equal(typeof text(t.output.render({}, value)), 'string')
  }
})

await ok('db_list reads an empty folder, then every db with its objects, fields and views', async () => {
  const svc = service()
  const T = toolbox(svc)
  assert.deepEqual(await T.db_list.execute(), { ok: true, dbs: [], unreadable: [] })
  assert.equal(text(T.db_list.output.render({}, await T.db_list.execute())), 'No database yet.')
  await T.db_create.execute({ name: 'Home' })
  await T.object_define.execute({ key: 'task', label: 'Tasks', fields: TASKS.fields })
  await T.view_save.execute({ object: 'task', view: { name: 'Board', kind: 'board' } })
  const r = await T.db_list.execute()
  assert.equal(r.dbs.length, 1)
  const [obj] = r.dbs[0].objects
  assert.equal(obj.key, 'task')
  assert.equal(obj.title, 'name', 'the first field names a record when none is given')
  assert.deepEqual(obj.fields.map((f) => f.key), TASKS.fields.map((f) => f.key))
  assert.deepEqual(obj.fields.find((f) => f.key === 'status').options.map((o) => o.key), ['todo', 'doing', 'done'])
  assert.equal(obj.fields.find((f) => f.key === 'token').protection, 'secret')
  assert.deepEqual(obj.views.map((v) => v.name), ['Board'])
  assert.ok(text(T.db_list.output.render({}, r)).includes('task [6 fields]'))
})

await ok('db_create refuses a bad name and tells the id of the new db', async () => {
  const T = toolbox(service())
  const bad = await T.db_create.execute({ name: '' })
  assert.equal(bad.ok, false)
  assert.ok(bad.error && bad.detail)
  assert.equal((await T.db_create.execute({})).ok, false)
  assert.equal((await T.db_create.execute(null)).ok, false, 'null arguments are an answer, not a throw')
  const good = await T.db_create.execute({ name: 'Shop' })
  assert.equal(good.db.name, 'Shop')
  assert.match(good.db.id, /^[0-9A-HJKMNP-TV-Z]{26}$/)
})

await ok('object_define needs a db, refuses what the engine refuses and a duplicate key', async () => {
  const svc = service()
  const T = toolbox(svc)
  const none = await T.object_define.execute({ key: 'task', label: 'Tasks', fields: TASKS.fields })
  assert.equal(none.error, 'no_db')
  await T.db_create.execute({ name: 'Home' })
  const empty = await T.object_define.execute({ key: 'task', label: 'Tasks', fields: [] })
  assert.equal(empty.ok, false)
  assert.ok(Array.isArray(empty.errors) && empty.errors.length >= 1, 'the reasons come back')
  const badKey = await T.object_define.execute({ key: 'Task!', label: 'Tasks', fields: TASKS.fields })
  assert.equal(badKey.ok, false)
  assert.equal((await T.object_define.execute({ key: 'task', label: 'Tasks', fields: TASKS.fields })).ok, true)
  const again = await T.object_define.execute({ key: 'task', label: 'Tasks', fields: TASKS.fields })
  assert.equal(again.error, 'exists')
  const two = service()
  const T2 = toolbox(two)
  two.create({ name: 'A', by: 'agent' }); two.create({ name: 'B', by: 'agent' })
  assert.equal((await T2.object_define.execute({ key: 'task', label: 'Tasks', fields: TASKS.fields })).error, 'which_db')
})

await ok('field_add adds a field, refuses a required one on a table with records, and a duplicate', async () => {
  const { T } = await seeded()
  const added = await T.field_add.execute({ object: 'task', field: { key: 'notes', type: 'longtext', label: 'Notes' } })
  assert.equal(added.ok, true)
  assert.equal(added.field.protection, 'normal')
  const required = await T.field_add.execute({ object: 'task', field: { key: 'owner', type: 'text', label: 'Owner', required: true } })
  assert.equal(required.error, 'needs-default')
  assert.equal((await T.field_add.execute({ object: 'task', field: { key: 'notes', type: 'text', label: 'Again' } })).error, 'exists')
  assert.equal((await T.field_add.execute({ object: 'nope', field: { key: 'x', type: 'text', label: 'X' } })).error, 'unknown_object')
  assert.equal((await T.field_add.execute({ object: 'task', field: { key: 'x', type: 'madeup', label: 'X' } })).ok, false)
})

await ok('relation_add links two objects, and says which one is missing', async () => {
  const { T } = await seeded()
  assert.equal((await T.relation_add.execute({ object: 'task', key: 'project', label: 'Project', to: 'project' })).error, 'unknown_object')
  assert.equal((await T.object_define.execute({ key: 'project', label: 'Projects', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }] })).ok, true)
  const one = await T.relation_add.execute({ object: 'task', key: 'project', label: 'Project', to: 'project' })
  assert.equal(one.ok, true)
  assert.equal(one.field.type, 'relation')
  assert.equal(one.field.many, false)
  const many = await T.relation_add.execute({ object: 'project', key: 'tasks', label: 'Tasks', to: 'task', many: true })
  assert.equal(many.field.many, true)
  assert.equal((await T.relation_add.execute({ object: 'nope', key: 'x', label: 'X', to: 'task' })).error, 'unknown_object')
  assert.equal((await T.relation_add.execute({ object: 'task', key: 'project', label: 'Again', to: 'project' })).error, 'exists')
})

await ok('a link can name itself from the other side, the name can change, and a record cannot link to nothing', async () => {
  const { T, svc } = await seeded()
  await T.object_define.execute({ key: 'customer', label: 'Customers', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }] })
  const rel = await T.relation_add.execute({ object: 'task', key: 'customer', label: 'Customer', to: 'customer', inverse: 'Tasks for them' })
  assert.equal(rel.ok, true)
  assert.equal(rel.field.inverse, 'Tasks for them')
  assert.equal((await T.relation_add.execute({ object: 'task', key: 'other', label: 'Other', to: 'customer', inverse: '  ' })).ok, false, 'an empty name is refused')
  const renamed = await T.field_update.execute({ object: 'task', key: 'customer', inverse: 'Their tasks' })
  assert.equal(renamed.ok && renamed.applied, true)
  assert.equal(renamed.field.inverse, 'Their tasks')
  assert.equal((await T.field_update.execute({ object: 'task', key: 'name', inverse: 'x' })).ok, false, 'only a link has one')
  const before = svc.resolve().db.count('task')
  const ghost = await T.records_create.execute({ object: 'task', records: [{ name: 'Orphan', customer: '01ARYZ6S410000000000000009' }] })
  assert.equal(JSON.stringify(ghost).includes('no such Customers record'), true, JSON.stringify(ghost))
  assert.equal(svc.resolve().db.count('task'), before, 'nothing was written for the refused record')
})

await ok('field_update relabels, raises a protection and adds choices; it never lowers or removes', async () => {
  const { T } = await seeded()
  const label = await T.field_update.execute({ object: 'task', key: 'due', label: 'Due date' })
  assert.equal(label.applied, true)
  assert.equal(label.field.label, 'Due date')
  const same = await T.field_update.execute({ object: 'task', key: 'due', label: 'Due date' })
  assert.equal(same.ok, true)
  assert.equal(same.applied, false, 'no change is not a new version')
  const raise = await T.field_update.execute({ object: 'task', key: 'name', protection: 'personal' })
  assert.equal(raise.field.protection, 'personal')
  const lower = await T.field_update.execute({ object: 'task', key: 'cost', protection: 'normal' })
  assert.equal(lower.error, 'agent_cannot_lower')
  assert.match(lower.detail, /only the person/)
  const choices = await T.field_update.execute({ object: 'task', key: 'status', options: [{ key: 'todo', label: 'To do' }, { key: 'doing', label: 'Doing' }, { key: 'done', label: 'Done' }, { key: 'later', label: 'Later' }] })
  assert.equal(choices.field.options.length, 4)
  const removed = await T.field_update.execute({ object: 'task', key: 'status', options: [{ key: 'todo', label: 'To do' }] })
  assert.equal(removed.ok, false)
  assert.equal((await T.field_update.execute({ object: 'task', key: 'nope', label: 'X' })).error, 'unknown_field')
  const retype = await T.field_update.execute({ object: 'task', key: 'due', type: 'text' })
  assert.equal(retype.ok, false, 'a type is not a thing the tool changes: nothing is asked of it')
  assert.ok(retype.error && retype.detail)
})

// ---------------------------------------------------------------- the tools: views
await ok('view_save creates a view for Kaby, then changes it keeping what is not named and who made it', async () => {
  const { T } = await seeded()
  const created = await T.view_save.execute({
    object: 'task',
    view: { name: 'Open', kind: 'table', state: { flt: { conj: 'and', items: [{ k: 'status', op: 'isnot', v: 'done' }] }, sorts: [{ k: 'due', dir: 'asc' }] } },
  })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(created.created, true)
  assert.equal(created.view.owner, 'kaby')
  assert.equal(created.view.state.sorts.length, 1)
  const changed = await T.view_save.execute({ object: 'task', view: { id: created.view.id, name: 'Still open', kind: 'table', state: { hidden: ['cost'] } } })
  assert.equal(changed.ok, true, JSON.stringify(changed))
  assert.equal(changed.created, false)
  assert.equal(changed.applied, true)
  assert.equal(changed.view.name, 'Still open')
  assert.deepEqual(changed.view.state.hidden, ['cost'])
  assert.equal(changed.view.state.flt.items.length, 1, 'the filter was not named, so it stays')
  assert.equal(changed.view.state.sorts.length, 1, 'the sort stays')
  const unchanged = await T.view_save.execute({ object: 'task', view: { id: created.view.id, name: 'Still open', kind: 'table' } })
  assert.equal(unchanged.applied, false)
})

await ok('view_save makes a gallery of cards with a cover picture, and refuses a cover on another kind', async () => {
  const { T } = await seeded()
  const gallery = await T.view_save.execute({ object: 'task', view: { name: 'Gallery', kind: 'cards', cover: true } })
  assert.equal(gallery.ok, true, JSON.stringify(gallery))
  assert.equal(gallery.view.cover, true)
  const plain = await T.view_save.execute({ object: 'task', view: { name: 'Cards', kind: 'cards', cover: false } })
  assert.equal(plain.ok, true, JSON.stringify(plain))
  assert.equal(plain.view.cover, undefined, 'only a cover that is on is stored')
  const bad = await T.view_save.execute({ object: 'task', view: { name: 'Table', kind: 'table', cover: true } })
  assert.equal(bad.ok, false)
  assert.ok(JSON.stringify(bad).includes('cover'), JSON.stringify(bad))
})

await ok('view_save makes a map placed by the two number fields it names, or by the ones named like a latitude and a longitude, and refuses one with no place to put records', async () => {
  const { T, svc } = await seeded()
  const db = svc.resolve().db
  const f = (key, type, label) => ({ key, type, label })
  assert.equal(db.addObject({ key: 'place', label: 'Places', title: 'name', fields: [f('name', 'text', 'Name'), f('altitude', 'number', 'Altitude'), f('latitude', 'number', 'Latitude'), f('longitude', 'number', 'Longitude')] }, 'agent').ok, true)
  assert.equal(db.addObject({ key: 'thing', label: 'Things', title: 'name', fields: [f('name', 'text', 'Name'), f('size', 'number', 'Size')] }, 'agent').ok, true)
  const guessed = await T.view_save.execute({ object: 'place', view: { name: 'Map', kind: 'map' } })
  assert.equal(guessed.ok, true, JSON.stringify(guessed))
  assert.deepEqual([guessed.view.kind, guessed.view.lat, guessed.view.lng], ['map', 'latitude', 'longitude'])
  const named = await T.view_save.execute({ object: 'place', view: { name: 'Odd map', kind: 'map', lat: 'altitude', lng: 'latitude' } })
  assert.deepEqual([named.ok, named.view.lat, named.view.lng], [true, 'altitude', 'latitude'])
  const refused = await T.view_save.execute({ object: 'thing', view: { name: 'Map', kind: 'map' } })
  assert.equal(refused.ok, false)
  assert.ok(JSON.stringify(refused).includes('lat'), JSON.stringify(refused))
  const wrong = await T.view_save.execute({ object: 'place', view: { name: 'Bad', kind: 'map', lat: 'name', lng: 'latitude' } })
  assert.equal(wrong.ok, false)
})

await ok('a view the person made keeps its owner when Kaby changes it', async () => {
  const { T, svc } = await seeded()
  const db = svc.resolve().db
  const mine = db.saveView('task', { name: 'Mine', kind: 'table', owner: 'me' }, 'person')
  assert.equal(mine.view.owner, 'me')
  const changed = await T.view_save.execute({ object: 'task', view: { id: mine.view.id, name: 'Mine, sorted', kind: 'table', state: { sorts: [{ k: 'name', dir: 'desc' }] } } })
  assert.equal(changed.view.owner, 'me')
})

await ok('view_save refuses a filter on an unknown field, an unknown object and a view of another object', async () => {
  const { T } = await seeded()
  const bad = await T.view_save.execute({ object: 'task', view: { name: 'Bad', kind: 'table', state: { flt: { conj: 'and', items: [{ k: 'nope', op: 'is', v: 'x' }] } } } })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors && bad.errors.length >= 1)
  assert.equal((await T.view_save.execute({ object: 'nope', view: { name: 'X', kind: 'table' } })).error, 'unknown_object')
  assert.equal((await T.view_save.execute({ object: 'task', view: { name: 'X', kind: 'pie' } })).ok, false)
  assert.equal((await T.view_save.execute({ object: 'task' })).ok, false, 'no view is an answer, not a throw')
  const cal = await T.view_save.execute({ object: 'task', view: { name: 'Calendar', kind: 'calendar' } })
  assert.equal(cal.view.date, 'due', 'a calendar takes the first date field')
  const board = await T.view_save.execute({ object: 'task', view: { name: 'Board', kind: 'board' } })
  assert.equal(board.view.by, 'status')
})

// ---------------------------------------------------------------- the tools: records
await ok('records_create lists what was created and what was refused with the reason', async () => {
  const { T } = await seeded()
  const r = await T.records_create.execute({
    object: 'task',
    records: [{ name: 'Fine' }, { name: '' }, { name: 'Bad date', due: '30/10/2026' }, { name: 'Unknown', nope: 1 }, { name: 'Bad choice', status: 'maybe' }, { name: 'Number text', cost: '12' }],
  })
  assert.equal(r.ok, false)
  assert.equal(r.created.length, 1)
  assert.deepEqual(r.failed.map((f) => f.index), [1, 2, 3, 4, 5])
  for (const f of r.failed) assert.ok(f.error && f.detail, 'every refusal has a code and a reason')
  assert.equal((await T.records_create.execute({ object: 'task', records: [] })).error, 'invalid')
  assert.equal((await T.records_create.execute({ object: 'task', records: Array.from({ length: BATCH_MAX + 1 }, (_, i) => ({ name: 'n' + i })) })).error, 'invalid')
  assert.equal((await T.records_create.execute({ object: 'task' })).error, 'invalid')
  assert.equal((await T.records_create.execute({ object: 'nope', records: [{ name: 'x' }] })).error, 'unknown_object')
  const wrongType = await T.records_create.execute({ object: 'task', records: ['not a map', null, 5] })
  assert.equal(wrongType.created.length, 0)
  assert.equal(wrongType.failed.length, 3)
  assert.match(text(T.records_create.output.render({}, r)), /1 record\(s\) created, 5 refused/)
})

await ok('a protected field comes back masked and a secret one not at all; the agent cannot read it by asking nicely', async () => {
  const { T, ids } = await seeded()
  const list = await T.records_list.execute({ object: 'task' })
  assert.equal(list.total, 3)
  const rent = list.records.find((r) => r.values.name === 'Pay the rent')
  assert.equal(rent.values.email, '•••• .com')
  assert.equal(rent.values.cost, '••••')
  assert.ok(!('token' in rent.values), 'a secret field is not even a key')
  assert.deepEqual(list.masked, ['email', 'cost'])
  assert.deepEqual(list.hidden, ['token'])
  const dentist = list.records.find((r) => r.values.name === 'Call the dentist')
  assert.equal(dentist.values.email, null, 'an empty protected field is shown empty, not masked')
  assert.ok(!JSON.stringify(list).includes('landlord@example.com'))
  assert.ok(!JSON.stringify(list).includes('sk-live'))
  const got = await T.records_get.execute({ object: 'task', id: ids[0] })
  assert.equal(got.record.values.email, '•••• .com')
  assert.deepEqual(got.hidden, ['token'])
  const reveal = await T.records_get.execute({ object: 'task', id: ids[0], reveal: ['email', 'cost', 'token', 'name', 'nope'] })
  assert.equal(reveal.record.values.email, 'landlord@example.com')
  assert.equal(reveal.record.values.cost, 950)
  assert.ok(!('token' in reveal.record.values), 'a secret field is never revealed, even when named')
  assert.deepEqual(reveal.hidden, ['token'])
  assert.deepEqual(reveal.masked, [])
})

await ok('a protected attachment field is protected for the agent like any other: masked, not searchable, asked before it is written; a secret one is not even a key', async () => {
  const svc = service()
  const T = toolbox(svc)
  assert.equal((await T.db_create.execute({ name: 'Papers' })).ok, true)
  const def = await T.object_define.execute({ key: 'doc', label: 'Documents', title: 'name', fields: [
    { key: 'name', type: 'text', label: 'Name', required: true },
    { key: 'files', type: 'attachment', label: 'Files' },
    { key: 'scan', type: 'attachment', label: 'ID scan', protection: 'sensitive' },
    { key: 'vault', type: 'attachment', label: 'Vault', protection: 'secret' },
  ] })
  assert.equal(def.ok, true, JSON.stringify(def))
  const db = svc.resolve().db
  const put = (name, text) => db.attach(Buffer.from(text), { name, type: 'application/pdf' }).file
  const made = db.create('doc', { name: 'Pack', files: [put('brief.pdf', 'a')], scan: [put('passport-scan.pdf', 'b')], vault: [put('seed-phrase.pdf', 'c')] }, 'person')
  assert.equal(made.ok, true, JSON.stringify(made))
  const list = await T.records_list.execute({ object: 'doc' })
  const row = list.records[0]
  assert.equal(row.values.files[0].name, 'brief.pdf', 'a normal attachment field is read as it is')
  assert.equal(row.values.scan, '••••', 'a protected one is masked: neither the names nor the sizes leave')
  assert.ok(!('vault' in row.values), 'a secret one is not even a key')
  assert.deepEqual([list.masked, list.hidden], [['scan'], ['vault']])
  const said = JSON.stringify(list)
  assert.ok(!said.includes('passport-scan') && !said.includes('seed-phrase'), 'no name of a protected file is said')
  assert.equal((await T.records_list.execute({ object: 'doc', q: 'brief' })).total, 1)
  assert.equal((await T.records_list.execute({ object: 'doc', q: 'passport' })).total, 0, 'the name of a protected file is not searchable')
  assert.equal((await T.records_list.execute({ object: 'doc', q: 'seed-phrase' })).total, 0)
  const got = await T.records_get.execute({ object: 'doc', id: row.id, reveal: ['scan', 'vault'] })
  assert.equal(got.record.values.scan[0].name, 'passport-scan.pdf', 'what the person allowed is read in clear')
  assert.ok(!('vault' in got.record.values))
  const gate = (name, args) => approvalGate(svc, { name, arguments: args })
  assert.match(gate('records_update', { object: 'doc', updates: [{ id: row.id, values: { scan: null } }] }).reason, /write protected fields/, 'writing a protected attachment field asks the person')
  assert.equal(gate('records_update', { object: 'doc', updates: [{ id: row.id, values: { files: null } }] }), null, 'a normal one does not')
  assert.match(gate('records_get', { object: 'doc', id: row.id, reveal: ['scan'] }).reason, /read protected fields/)
})

await ok('records_list filters, searches, sorts and pages on the fields the agent can read', async () => {
  const { T } = await seeded()
  const open = await T.records_list.execute({ object: 'task', filter: { conj: 'and', items: [{ k: 'status', op: 'isnot', v: 'done' }] }, sorts: [{ k: 'due', dir: 'desc' }] })
  assert.deepEqual(open.records.map((r) => r.values.name), ['Call the dentist', 'Pay the rent'])
  const soon = await T.records_list.execute({ object: 'task', filter: { conj: 'and', items: [{ k: 'due', op: 'within', v: 'next7' }] } })
  assert.deepEqual(soon.records.map((r) => r.values.name), ['Pay the rent', 'Call the dentist'], 'relative dates use today, which the caller fixes (2026-10-30)')
  const past = await T.records_list.execute({ object: 'task', filter: { conj: 'and', items: [{ k: 'due', op: 'within', v: 'past30' }] } })
  assert.deepEqual(past.records.map((r) => r.values.name), ['File the taxes'])
  const found = await T.records_list.execute({ object: 'task', q: 'DENTIST' })
  assert.deepEqual(found.records.map((r) => r.values.name), ['Call the dentist'])
  assert.equal((await T.records_list.execute({ object: 'task', q: 'landlord' })).total, 0, 'a protected value is not searchable')
  assert.equal((await T.records_list.execute({ object: 'task', q: 'sk-live' })).total, 0, 'a secret value is not searchable')
  const page = await T.records_list.execute({ object: 'task', limit: 2, offset: 1, sorts: [{ k: 'name', dir: 'asc' }] })
  assert.equal(page.total, 3)
  assert.equal(page.count, 2)
  assert.deepEqual(page.records.map((r) => r.values.name), ['File the taxes', 'Pay the rent'])
  const one = await T.records_list.execute({ object: 'task', limit: 0 })
  assert.equal(one.count, 1, 'a limit under one is one')
  assert.equal(LIST_DEFAULT < LIST_MAX, true)
  const bigDb = await T.records_create.execute({ object: 'task', records: Array.from({ length: 30 }, (_, i) => ({ name: 'x' + i })) })
  assert.equal(bigDb.ok, true)
  assert.equal((await T.records_list.execute({ object: 'task' })).count, LIST_DEFAULT)
  assert.equal((await T.records_list.execute({ object: 'task', limit: 1000 })).count, 33)
  assert.match(text(T.records_list.output.render({}, page)), /^2 of 3 record\(s\)/)
})

await ok('a filter or a sort on a field the agent cannot read in clear is refused, not silently ignored', async () => {
  const { T } = await seeded()
  const byEmail = await T.records_list.execute({ object: 'task', filter: { conj: 'and', items: [{ k: 'email', op: 'is', v: 'landlord@example.com' }] } })
  assert.equal(byEmail.error, 'invalid_filter')
  assert.ok(byEmail.errors.length >= 1)
  assert.equal((await T.records_list.execute({ object: 'task', filter: { conj: 'and', items: [{ k: 'token', op: 'nempty' }] } })).error, 'invalid_filter')
  assert.equal((await T.records_list.execute({ object: 'task', sorts: [{ k: 'cost', dir: 'asc' }] })).error, 'invalid_sorts')
  assert.equal((await T.records_list.execute({ object: 'task', filter: 'oops' })).error, 'invalid_filter')
  assert.equal((await T.records_list.execute({ object: 'task', sorts: 'oops' })).error, 'invalid_sorts')
  const revealed = await T.records_list.execute({ object: 'task', reveal: ['cost'], sorts: [{ k: 'cost', dir: 'desc' }] })
  assert.equal(revealed.ok, true, 'once the person allowed the clear value, the field can be sorted on')
  assert.equal(revealed.records[0].values.cost, 950)
})

await ok('records_list can apply a saved view, whose filter and sorts the call may override', async () => {
  const { T } = await seeded()
  const v = await T.view_save.execute({ object: 'task', view: { name: 'Open', kind: 'table', state: { flt: { conj: 'and', items: [{ k: 'status', op: 'isnot', v: 'done' }] }, sorts: [{ k: 'due', dir: 'desc' }] } } })
  const viaView = await T.records_list.execute({ object: 'task', view: v.view.id })
  assert.deepEqual(viaView.records.map((r) => r.values.name), ['Call the dentist', 'Pay the rent'])
  const overridden = await T.records_list.execute({ object: 'task', view: v.view.id, sorts: [{ k: 'name', dir: 'asc' }] })
  assert.deepEqual(overridden.records.map((r) => r.values.name), ['Call the dentist', 'Pay the rent'])
  const all = await T.records_list.execute({ object: 'task', view: v.view.id, filter: { conj: 'and', items: [] } })
  assert.equal(all.total, 3, 'an empty filter of the call replaces the view’s')
  assert.equal((await T.records_list.execute({ object: 'task', view: 'nope' })).error, 'unknown_view')
  // a view sorted on a protected field still lists: the sort is dropped rather than leaking an order
  const sneaky = await T.view_save.execute({ object: 'task', view: { name: 'By cost', kind: 'table', state: { sorts: [{ k: 'cost', dir: 'asc' }] } } })
  const listed = await T.records_list.execute({ object: 'task', view: sneaky.view.id })
  assert.equal(listed.ok, true)
})

await ok('records_update changes the named fields only, reports each refusal, and cannot change a deleted record', async () => {
  const { T, ids } = await seeded()
  const r = await T.records_update.execute({ object: 'task', updates: [{ id: ids[1], values: { status: 'done' } }, { id: ids[2], values: { due: 'soon' } }, { id: 'nope', values: { name: 'x' } }, 'junk'] })
  assert.equal(r.ok, false)
  assert.equal(r.updated.length, 1)
  assert.equal(r.updated[0].values.status, 'done')
  assert.equal(r.updated[0].values.name, 'Call the dentist', 'the fields not named are kept')
  assert.deepEqual(r.failed.map((f) => f.index), [1, 2, 3])
  assert.equal(r.failed[2].error, 'invalid')
  assert.equal((await T.records_delete.execute({ object: 'task', ids: [ids[1]] })).done, 1)
  const gone = await T.records_update.execute({ object: 'task', updates: [{ id: ids[1], values: { name: 'back' } }] })
  assert.equal(gone.failed[0].error, 'deleted')
  const cleared = await T.records_update.execute({ object: 'task', updates: [{ id: ids[0], values: { due: null } }] })
  assert.equal(cleared.updated[0].values.due, null)
  assert.equal((await T.records_update.execute({ object: 'task', updates: [] })).error, 'invalid')
})

await ok('records_delete hides records and records_restore brings them back; neither does anything twice', async () => {
  const { T, ids } = await seeded()
  const del = await T.records_delete.execute({ object: 'task', ids: [ids[0], ids[1]] })
  assert.deepEqual([del.ok, del.done], [true, 2])
  assert.equal((await T.records_delete.execute({ object: 'task', ids: [ids[0]] })).done, 0, 'deleting a deleted record changes nothing')
  assert.equal((await T.records_list.execute({ object: 'task' })).total, 1)
  const trash = await T.records_list.execute({ object: 'task', deleted: true })
  assert.equal(trash.total, 2)
  assert.ok(trash.records.every((r) => r.deleted !== undefined), 'a deleted record says who deleted it and when')
  const back = await T.records_restore.execute({ object: 'task', ids: [ids[0], ids[2]] })
  assert.deepEqual([back.ok, back.done], [true, 1], 'restoring a live record changes nothing')
  assert.equal((await T.records_list.execute({ object: 'task' })).total, 2)
  const bad = await T.records_delete.execute({ object: 'task', ids: ['nope', ids[2]] })
  assert.equal(bad.ok, false)
  assert.equal(bad.done, 1)
  assert.equal(bad.failed[0].index, 0)
  assert.equal((await T.records_delete.execute({ object: 'task', ids: [] })).error, 'invalid')
  assert.equal((await T.records_get.execute({ object: 'task', id: 'nope' })).error, 'missing')
})

await ok('everything the agent writes is journalled as « agent », and the db still verifies', async () => {
  const { svc, ids } = await seeded()
  const db = svc.resolve().db
  const rec = db.get('task', ids[0])
  assert.equal(rec.created.by, 'agent')
  const journal = db.journal()
  assert.ok(journal.length >= 3 && journal.every((op) => op.by === 'agent'), 'no operation is attributed to anyone else')
  assert.deepEqual(db.verify(), { ok: true, problems: [] })
})

// ---------------------------------------------------------------- the cards
await ok('the card of a new table lists every field in both languages, and none is made for a call the engine refuses', async () => {
  const card = cardFor('object_define', { key: 'task', label: 'Tasks', fields: TASKS.fields }, [], 'Home')
  assert.match(card.en, /^Add the table “Tasks” to “Home”:/)
  assert.match(card.en, /· Name \(text, required\) — title/)
  assert.match(card.en, /· Email \(email, personal\)/)
  assert.match(card.en, /· Token \(text, secret\)/)
  assert.match(card.fr, /^Ajouter la table “Tasks” à “Home” :/)
  assert.match(card.fr, /· Email \(e-mail, personnel\)/)
  assert.equal(cardFor('object_define', { key: 'Bad key', label: 'x', fields: [] }, [], 'Home'), null)
  assert.equal(cardFor('db_create', { name: 'Shop' }, null, '').en, 'Create the database “Shop”: an empty file on this computer.')
  assert.equal(cardFor('db_create', { name: '' }, null, ''), null)
  assert.equal(cardFor('records_create', {}, [], ''), null)
  assert.equal(cardFor('object_define', null, [], ''), null)
})

await ok('the cards for a field, a link and a change say what is before and after', async () => {
  const { svc } = await seeded()
  const objects = svc.resolve().db.objects()
  const field = cardFor('field_add', { object: 'task', field: { key: 'notes', type: 'longtext', label: 'Notes' } }, objects, 'Home')
  assert.match(field.en, /^Add the field Notes \(long text\) to the table “Tasks”\. Existing rows stay empty/)
  assert.match(field.fr, /^Ajouter le champ Notes \(texte long\) à la table “Tasks”\. Les lignes existantes/)
  assert.equal(cardFor('field_add', { object: 'task', field: { key: 'name', type: 'text', label: 'Dup' } }, objects, ''), null, 'a duplicate is refused, not asked')
  assert.equal(cardFor('field_add', { object: 'nope', field: { key: 'a', type: 'text', label: 'A' } }, objects, ''), null)
  const objectsWithProject = [...objects, { key: 'project', label: 'Projects', title: 'name', fields: [{ key: 'name', type: 'text', label: 'Name', required: true, protection: 'normal' }] }]
  const link = cardFor('relation_add', { object: 'task', key: 'project', label: 'Project', to: 'project' }, objectsWithProject, 'Home')
  assert.match(link.en, /Link the table “Tasks” to the table “Projects”/)
  assert.match(link.en, /each row has at most one “Projects”/)
  const many = cardFor('relation_add', { object: 'task', key: 'project', label: 'Project', to: 'project', many: true }, objectsWithProject, 'Home')
  assert.match(many.fr, /plusieurs “Projects”/)
  assert.equal(cardFor('relation_add', { object: 'task', key: 'project', label: 'Project', to: 'nope' }, objects, ''), null)
  const named = cardFor('relation_add', { object: 'task', key: 'project', label: 'Project', to: 'project', inverse: 'Their tasks' }, objectsWithProject, 'Home')
  assert.match(named.en, /“Projects” seen from the other side as “Their tasks”/)
  assert.match(named.fr, /“Projects” vu de l’autre côté sous le nom “Their tasks”/)
  assert.equal(cardFor('relation_add', { object: 'task', key: 'project', label: 'Project', to: 'project', inverse: ' ' }, objectsWithProject, 'Home'), null, 'an empty name is refused, not asked')
  const change = cardFor('field_update', { object: 'task', key: 'cost', label: 'Price', protection: 'secret', options: [] }, objects, 'Home')
  assert.match(change.en, /name: “Cost” → “Price”/)
  assert.match(change.en, /protection: sensitive → secret/)
  assert.match(change.fr, /protection : sensible → secret/)
  const choices = cardFor('field_update', { object: 'task', key: 'status', options: [{ key: 'todo', label: 'To do' }, { key: 'later', label: 'Later' }] }, objects, 'Home')
  assert.match(choices.en, /choices added: Later/)
  assert.equal(cardFor('field_update', { object: 'task', key: 'cost', label: 'Cost' }, objects, ''), null, 'nothing changes: nothing to ask')
})

await ok('the card of a protected read or write names the fields and the table', () => {
  const obj = { label: 'Tasks' }
  const fields = [{ label: 'Email' }, { label: 'Cost' }]
  assert.equal(protectedCard('write', fields, obj).en, 'The agent wants to write protected fields (“Email”, “Cost”) of the table “Tasks”. Allow it?')
  assert.match(protectedCard('reveal', fields, obj).en, /read protected fields .* in clear\. Allow it\?$/)
  assert.match(protectedCard('reveal', fields, obj).fr, /lire en clair des champs protégés/)
})

// ---------------------------------------------------------------- the approval
await ok('the approval asks for a change of structure, with its card, and for nothing a read tool does', async () => {
  const { svc } = await seeded()
  const ask = (name, args) => approvalGate(svc, { name, arguments: args })
  const def = ask('object_define', { key: 'project', label: 'Projects', fields: [{ key: 'name', type: 'text', label: 'Name' }] })
  assert.equal(def.kind, 'ask')
  assert.equal(def.reason, def.displayReason.en)
  assert.match(def.displayReason.fr, /^Ajouter la table “Projects” à “Home”/)
  assert.equal(ask('db_create', { name: 'Shop' }).kind, 'ask')
  assert.equal(ask('field_add', { object: 'task', field: { key: 'notes', type: 'text', label: 'Notes' } }).kind, 'ask')
  assert.equal(ask('field_update', { object: 'task', key: 'cost', protection: 'secret' }).kind, 'ask')
  for (const name of ['db_list', 'view_save', 'records_delete', 'records_restore']) assert.equal(ask(name, { object: 'task', ids: [], view: {} }), null, name + ' asks nothing')
  assert.equal(ask('records_list', { object: 'task' }), null)
  assert.equal(ask('records_create', { object: 'task', records: [{ name: 'a' }] }), null, 'writing normal fields asks nothing')
  assert.equal(ask('records_update', { object: 'task', updates: [{ id: 'x', values: { status: 'done' } }] }), null)
})

await ok('the approval asks when a protected field is written or read in clear, and names only those fields', async () => {
  const { svc } = await seeded()
  const ask = (name, args) => approvalGate(svc, { name, arguments: args })
  const write = ask('records_create', { object: 'task', records: [{ name: 'a', email: 'a@b.c' }, { name: 'b', cost: 3 }] })
  assert.equal(write.kind, 'ask')
  assert.match(write.displayReason.en, /“Email”, “Cost”/)
  assert.ok(!write.displayReason.en.includes('“Name”'))
  assert.equal(ask('records_update', { object: 'task', updates: [{ id: 'x', values: { token: 's' } }] }).kind, 'ask', 'a secret field can be written with approval')
  const reveal = ask('records_get', { object: 'task', id: 'x', reveal: ['email', 'name', 'token'] })
  assert.equal(reveal.kind, 'ask')
  assert.match(reveal.displayReason.en, /“Email”/)
  assert.ok(!reveal.displayReason.en.includes('“Token”'), 'a secret field cannot be revealed, so it is not asked for')
  assert.equal(ask('records_list', { object: 'task', reveal: ['name'] }), null, 'revealing a normal field asks nothing')
  assert.equal(ask('records_list', { object: 'task', reveal: ['token'] }), null, 'revealing only a secret field asks nothing: nothing will be revealed')
  assert.equal(ask('records_list', { object: 'task', reveal: ['cost'] }).kind, 'ask')
})

await ok('the approval never puts a question the engine would refuse, and ignores what it does not know', async () => {
  const { svc } = await seeded()
  const ask = (name, args) => approvalGate(svc, { name, arguments: args })
  assert.equal(ask('field_update', { object: 'task', key: 'cost', protection: 'normal' }), null, 'lowering a protection is refused, not asked')
  assert.equal(ask('field_add', { object: 'task', field: { key: 'name', type: 'text', label: 'Dup' } }), null)
  assert.equal(ask('records_create', { object: 'nope', records: [{ a: 1 }] }), null)
  assert.equal(ask('records_create', { object: 'task', records: 'oops' }), null)
  assert.equal(ask('records_update', { object: 'task', updates: [null, 3] }), null)
  assert.equal(ask('object_define', { db: 'nope', key: 'a', label: 'A', fields: [{ key: 'n', type: 'text', label: 'N' }] }), null, 'no such db: the tool says so')
  assert.equal(approvalGate(svc, { name: 'contacts_upsert', arguments: {} }), null, 'another plugin’s tool is not ours to judge')
  assert.equal(approvalGate(svc, null), null)
  assert.equal(approvalGate(svc, { name: 'field_add' }), null, 'no arguments is not a throw')
  assert.equal(approvalGate(service(), { name: 'object_define', arguments: { key: 'a', label: 'A', fields: [] } }), null, 'no db yet')
})

// ---------------------------------------------------------------- the prompt block
await ok('the prompt block is empty with no db, names every db, object and field, and is the same text each time', async () => {
  assert.equal(renderBlock([]), '')
  assert.equal(renderBlock(null), '')
  const { svc } = await seeded()
  const a = renderBlock(svc.snapshot())
  const b = renderBlock(svc.snapshot())
  assert.equal(a, b, 'no clock, no counter: the prompt prefix stays cacheable')
  assert.match(a, /Database “Home” \(db [0-9A-Z]{26}\):/)
  assert.match(a, /task “Tasks” — name \(text, required\), status \(choice: todo\|doing\|done\), due \(date\)/)
  assert.match(a, /email \(email, personal\), cost \(money, sensitive\), token \(text, secret\)/)
  assert.match(a, /never with SQL or files/)
  assert.ok(!a.includes('landlord'), 'the block carries the structure, never a value')
})

await ok('a long block is cut at a line with a pointer to db_list', async () => {
  const objects = Array.from({ length: 60 }, (_, i) => ({ key: 'obj' + i, label: 'Object ' + i, title: 'name', fields: Array.from({ length: 12 }, (_, j) => ({ key: 'field_' + j, type: 'text', label: 'F', required: false, protection: 'normal' })) }))
  const block = renderBlock([{ id: '01ARYZ6S410000000000000000', name: 'Big', objects }])
  assert.ok(block.length <= SECTION_MAX_CHARS, 'the block fits its budget: ' + block.length)
  assert.ok(block.endsWith('db_list lists every database, object and field.'))
  const lines = block.split('\n').slice(2, -1)
  assert.ok(lines.length > 5 && lines.every((l) => /^  obj\d+ “Object \d+” — .*\)$/.test(l)), 'it is cut between lines, never inside one')
  assert.equal(renderBlock([{ id: 'x', name: 'Empty', objects: [] }]).includes('no object yet'), true)
})

await ok('each db is one folder of the dbs folder, and a second service sees what the first wrote', async () => {
  const { svc } = await seeded()
  assert.equal(readdirSync(svc.dir).length, 1)
  const again = makeService({ dir: svc.dir })
  assert.equal(again.resolve().db.list('task').length, 3)
  again.close()
})

console.log('\nkybernos-db agent: ' + count + ' checks passed')
