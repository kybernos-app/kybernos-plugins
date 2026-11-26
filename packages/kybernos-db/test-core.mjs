// kybernos-db core: runs the shared JSON cases (vectors/) against core/, plus the checks a JSON case cannot make (the fixtures are sound, the core touches no disk,
// network or clock, calendar days agree with Date, the order does not depend on the order records arrive in).
//
//   node packages/kybernos-db/test-core.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as core from './core/index.mjs'
import { runVectors } from './vectors/run.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const read = (p) => JSON.parse(readFileSync(here + p, 'utf8'))
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }

const SUITES = ['values', 'fields', 'filter', 'sort', 'query', 'views', 'rights', 'ops']
const data = { fixtures: read('vectors/fixtures.json'), suites: Object.fromEntries(SUITES.map((s) => [s, read('vectors/' + s + '.json')])) }

ok('every suite file names itself and holds cases', () => {
  for (const s of SUITES) {
    assert.equal(data.suites[s].suite, s)
    assert.ok(data.suites[s].cases.length > 0, s)
    const names = data.suites[s].cases.map((c) => c.name)
    assert.equal(new Set(names).size, names.length, s + ' has two cases with one name')
  }
})

const report = runVectors(core, data, { freeze: true })
for (const s of SUITES) {
  const p = report.perSuite[s]
  ok('vectors/' + s + '.json: ' + p.total + ' cases' + (p.failed ? ', ' + p.failed + ' FAILED' : ''), () => {})
}
if (report.failures.length) {
  for (const f of report.failures) console.log('FAIL', f.suite + ' / ' + f.name + '\n     expected ' + JSON.stringify(f.expected) + '\n     actual   ' + JSON.stringify(f.actual))
  throw new Error(report.failures.length + ' of ' + report.total + ' shared cases failed')
}
console.log('digest', report.digest, '(' + report.total + ' cases)')

ok('profiles: a good list is copied whole, every refusal names its place, and the helpers answer from the grants', () => {
  const objects = [{ key: 'order', fields: [{ key: 'title' }, { key: 'value' }] }, { key: 'contact', fields: [{ key: 'name' }, { key: 'email' }, { key: 'phone' }] }]
  const good = [{ id: 'member', label: ' Team member ', grants: [{ object: 'order', do: ['update', 'read'] }, { object: 'contact', do: ['read'], fields: { email: 'read' } }] }]
  const r = core.normalizeProfiles(good, objects)
  assert.ok(r.ok, JSON.stringify(r.errors))
  assert.deepEqual(r.profiles, [{ id: 'member', label: 'Team member', grants: [{ object: 'order', do: ['read', 'update'] }, { object: 'contact', do: ['read'], fields: { email: 'read' } }] }], 'verbs in their order, label trimmed')
  assert.equal(core.normalizeProfiles([], objects).ok, true)
  assert.equal(core.normalizeProfiles(good).ok, true, 'without the objects only the shape is checked')
  const bad = (list, code) => { const e = core.normalizeProfiles(list, objects); assert.equal(e.ok, false); assert.ok(e.errors.some((x) => x.code === code), code + ' in ' + JSON.stringify(e.errors)) }
  const one = (patch) => [{ id: 'member', label: 'M', grants: [{ object: 'order', do: ['read'] }], ...patch }]
  bad('nope', 'shape')
  bad([null], 'shape')
  bad(one({ id: 'Member' }), 'id')
  bad(one({ id: 'owner' }), 'reserved')
  bad([...one({}), ...one({})], 'duplicate')
  bad(one({ label: '' }), 'label')
  bad(one({ grants: 'x' }), 'grants')
  bad(one({ grants: [{ object: 'order', do: [] }] }), 'do')
  bad(one({ grants: [{ object: 'order', do: ['read', 'delete'] }] }), 'never-delete')
  bad(one({ grants: [{ object: 'order', do: ['read', 'fly'] }] }), 'do')
  bad(one({ grants: [{ object: 'order', do: ['read'] }, { object: 'order', do: ['read'] }] }), 'duplicate')
  bad(one({ grants: [{ object: 'order', do: ['read'], fields: { title: 'maybe' } }] }), 'access')
  bad(one({ grants: [{ object: 'order', do: ['read'], fields: { nope: 'read' } }] }), 'unknown-field')
  bad(one({ grants: [{ object: 'nope', do: ['read'] }] }), 'unknown-object')
  bad(one({ extra: 1 }), 'unknown-key')
  const profile = r.profiles[0]
  assert.equal(core.profileOf(r.profiles, 'member'), profile)
  assert.equal(core.profileOf(r.profiles, 'owner'), undefined)
  assert.equal(core.grantOf(profile, 'order').object, 'order')
  assert.equal(core.grantOf(profile, 'invoice'), undefined)
  assert.equal(core.grantUpdates(core.grantOf(profile, 'order')), true)
  assert.equal(core.grantUpdates(core.grantOf(profile, 'contact')), false)
  assert.equal(core.grantUpdates({ do: ['read'], fields: { stock: 'write' } }), true, 'one writable field is enough to edit a row')
  const access = (object, key, protection) => core.fieldAccess(profile, object, { key, protection })
  assert.equal(access('order', 'title'), 'write')
  assert.equal(access('contact', 'name'), 'read')
  assert.equal(access('contact', 'email', 'personal'), 'read')
  assert.equal(access('contact', 'phone', 'personal'), 'hidden')
  assert.equal(access('contact', 'iban', 'sensitive'), 'hidden')
  assert.equal(access('order', 'token', 'secret'), 'hidden')
  assert.equal(access('invoice', 'total'), 'hidden')
  const named = { ...profile, grants: [{ object: 'order', do: ['update'], fields: { token: 'write', iban: 'write' } }] }
  assert.equal(core.fieldAccess(named, 'order', { key: 'token', protection: 'secret' }), 'hidden', 'a profile cannot give a secret field')
  assert.equal(core.fieldAccess(named, 'order', { key: 'iban', protection: 'sensitive' }), 'hidden', 'nor a sensitive one')
})

ok('the same cases give the same digest twice, and with a different order of suites', () => {
  assert.equal(runVectors(core, data).digest, report.digest)
  const reversed = { fixtures: data.fixtures, suites: Object.fromEntries(SUITES.slice().reverse().map((s) => [s, data.suites[s]])) }
  assert.equal(runVectors(core, reversed).digest, report.digest)
})

const fx = data.fixtures
const alias = fx.alias
const unalias = (x) => (typeof x === 'string' ? alias[x] || x : Array.isArray(x) ? x.map(unalias) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, unalias(v)])) : x)

ok('the fixture fields are what normalizeField would give', () => {
  for (const obj of Object.values(fx.objects)) {
    for (const field of obj.fields) {
      const r = core.normalizeField(field)
      assert.ok(r.ok, obj.key + '.' + field.key + ': ' + JSON.stringify(r.errors))
      assert.deepEqual(r.field, field, obj.key + '.' + field.key)
    }
    assert.ok(obj.fields.some((f) => f.key === obj.title), obj.key + ' has its title field')
  }
})

ok('every fixture value is already canonical', () => {
  for (const [key, records] of Object.entries(fx.records)) {
    for (const rec of unalias(records)) {
      assert.ok(core.isUlid(rec.id), rec.id)
      for (const [k, v] of Object.entries(rec.values)) {
        const field = fx.objects[key].fields.find((f) => f.key === k)
        assert.ok(field, key + ' has no field ' + k)
        const r = core.normalizeValue(field, v)
        assert.ok(r.ok, rec.id + '.' + k + ': ' + JSON.stringify(r))
        assert.deepEqual(r.value, v, rec.id + '.' + k)
      }
    }
  }
})

ok('normalizeValue is idempotent on every value the cases accept', () => {
  for (const c of data.suites.values.cases) {
    const input = JSON.parse(JSON.stringify(c.input === undefined ? null : c.input).replace(/"#[A-Z]\d+"/g, (m) => JSON.stringify(alias[JSON.parse(m)])))
    const first = core.normalizeValue(c.field, input)
    if (first.ok) assert.deepEqual(core.normalizeValue(c.field, first.value), first, c.name)
  }
})

ok('the core touches no disk, no network and no clock', () => {
  const banned = [/\bimport\s+[^'"]*from\s+['"]node:/, /\brequire\s*\(/, /\bfetch\s*\(/, /\bprocess\./, /\bglobalThis\b/, /\bwindow\b/, /\bdocument\./, /Date\.now/, /new Date\b/, /\bDate\(/, /Math\.random/, /performance\.now/, /localeCompare/, /toLocale/, /\bIntl\b/, /setTimeout/]
  for (const f of readdirSync(here + 'core')) {
    const code = readFileSync(here + 'core/' + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    for (const re of banned) assert.ok(!re.test(code), f + ' uses ' + re)
    for (const m of code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) assert.match(m[1], /^\.\/[a-z]+\.mjs$/, f + ' imports ' + m[1])
  }
})

ok('calendar days agree with Date for every day from 1900 to 2200', () => {
  const start = Date.UTC(1900, 0, 1) / 86400000
  const end = Date.UTC(2200, 11, 31) / 86400000
  for (let n = start; n <= end; n++) {
    const text = new Date(n * 86400000).toISOString().slice(0, 10)
    assert.equal(core.dayNumber(text), n, text)
    assert.equal(core.fromDayNumber(n), text)
  }
})

ok('days that do not exist are refused, leap days follow the Gregorian rule', () => {
  for (const bad of ['2026-02-29', '1900-02-29', '2100-02-29', '2026-04-31', '2026-00-10', '2026-13-01', '2026-01-00', '2026-1-01', '26-01-01', '2026-01-01T00:00', ' 2026-01-01', 20260101, null, undefined]) assert.equal(core.dayNumber(bad), null, String(bad))
  for (const good of ['2024-02-29', '2000-02-29', '0000-01-01', '9999-12-31']) assert.notEqual(core.dayNumber(good), null, good)
  assert.equal(core.addDays('2026-10-30', 2), '2026-11-01')
  assert.equal(core.addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(core.addDays('2024-03-01', -1), '2024-02-29')
  assert.equal(core.addDays('nope', 1), null)
})

ok('ids: ULIDs are 26 Crockford characters with a timestamp that fits 48 bits', () => {
  for (const good of ['01JBTASK000000000000000001', '7ZZZZZZZZZZZZZZZZZZZZZZZZZ', '00000000000000000000000000']) assert.ok(core.isUlid(good), good)
  for (const bad of ['8ZZZZZZZZZZZZZZZZZZZZZZZZZ', '01JBTASK00000000000000000', '01JBTASK0000000000000000011', '01jbtask000000000000000001', '01JBTASI000000000000000001', '01JBTASO000000000000000001', '01JBTASU000000000000000001', 5, null]) assert.ok(!core.isUlid(bad), String(bad))
})

ok('timestamps are UTC with milliseconds and a real day and time', () => {
  for (const good of ['2026-10-30T09:15:00.000Z', '2024-02-29T23:59:59.999Z']) assert.ok(core.isTimestamp(good), good)
  for (const bad of ['2026-10-30T09:15:00Z', '2026-10-30 09:15:00.000Z', '2026-10-30T09:15:00.000+01:00', '2026-02-30T09:15:00.000Z', '2026-10-30T24:00:00.000Z', '2026-10-30T09:60:00.000Z', 5]) assert.ok(!core.isTimestamp(bad), String(bad))
})

ok('folding and ordering text does not depend on a locale', () => {
  assert.equal(core.fold('Éclair'), 'eclair')
  assert.equal(core.fold('ÉCLAIR'), core.fold('éclair'))
  assert.equal(core.fold('écran'), 'ecran')
  const words = ['zèbre', 'Zebra', 'écran', 'Eclair', 'eclair', 'Ecran', 'a', 'B', 'b']
  const once = words.slice().sort(core.compareText)
  assert.deepEqual(words.slice().reverse().sort(core.compareText), once)
  assert.equal(core.compareText('a', 'a'), 0)
  assert.ok(core.compareText('eclair', 'Eclair') !== 0)
})

ok('a board needs a choice field, a calendar a date field and a map two number fields', () => {
  const fields = fx.objects.task.fields
  const noteFields = fx.objects.note.fields
  const placeFields = fx.objects.place.fields
  for (const kind of core.VIEW_KINDS) assert.ok(core.kindAvailable(kind === 'map' ? placeFields.concat(fields) : fields, kind), kind)
  assert.ok(core.kindAvailable(noteFields, 'table') && core.kindAvailable(noteFields, 'cards'))
  assert.ok(!core.kindAvailable(noteFields, 'board') && !core.kindAvailable(noteFields, 'calendar') && !core.kindAvailable(noteFields, 'map'))
  assert.ok(!core.kindAvailable(fields, 'map'), 'the task has one number field')
  assert.deepEqual(core.mapFields(placeFields), { lat: 'latitude', lng: 'longitude' }, 'named like a latitude and a longitude')
  assert.deepEqual(core.mapFields([{ key: 'x', type: 'number' }, { key: 'y', type: 'number' }]), { lat: 'x', lng: 'y' }, 'else the first two')
  assert.deepEqual(core.mapFields(noteFields), { lat: undefined, lng: undefined })
})

ok('the order of the result does not depend on the order the records arrive in', () => {
  const records = unalias(fx.records.task)
  const fields = fx.objects.task.fields
  const ctx = { today: fx.today, me: fx.me, label: (f, v) => unalias(fx.labels)[v] }
  const labels = Object.fromEntries(Object.entries(fx.labels).map(([k, v]) => [alias[k] || k, v]))
  ctx.label = (f, v) => labels[v]
  const queries = [
    { sorts: [{ k: 'status', dir: 'asc' }] },
    { sorts: [{ k: 'estimate', dir: 'desc' }] },
    { sorts: [{ k: 'tags', dir: 'asc' }, { k: 'title', dir: 'desc' }] },
    { flt: { conj: 'and', items: [{ k: 'assignee', op: 'is', v: '@me' }] }, sorts: [{ k: 'due', dir: 'asc' }] },
    { q: 'a' },
  ]
  for (const q of queries) {
    const ids = (rows) => core.queryRecords(rows, { fields, ...q }, ctx).map((r) => r.id)
    const expected = ids(records)
    assert.deepEqual(ids(records.slice().reverse()), expected, JSON.stringify(q))
    assert.deepEqual(ids([...records.slice(3), ...records.slice(0, 3)]), expected, JSON.stringify(q))
  }
})

ok('the functions leave their arguments alone (the cases run on frozen data) and return fresh objects', () => {
  const flt = { conj: 'and', items: [{ k: 'status', op: 'is', v: 'todo' }] }
  const prepared = core.prepareFilter(flt, fx.objects.task.fields)
  assert.notEqual(prepared, flt)
  assert.notEqual(prepared.items[0], flt.items[0])
  const view = { id: 'v', name: 'V', kind: 'table', owner: 'me', fav: false, state: { flt, sorts: [], hidden: [] } }
  const repaired = core.repairView(view, fx.objects.task.fields, 'title')
  assert.notEqual(repaired.state, view.state)
})

ok('a protection can only go up for an agent: every pair', () => {
  const agent = { kind: 'agent', role: 'owner' }
  for (const from of core.PROTECTION) {
    for (const to of core.PROTECTION) {
      const r = core.can(agent, 'field.protect', { field: { protection: from }, to })
      assert.equal(r.effect, core.protectionRank(to) >= core.protectionRank(from) ? 'allow' : 'deny', from + ' → ' + to)
    }
  }
})

ok('every action has an answer for every actor (no throw, always an effect)', () => {
  for (const actor of [{ kind: 'person', role: 'owner' }, { kind: 'agent', role: 'owner' }, { kind: 'agent', role: 'member' }, null, 5, {}]) {
    for (const action of [...core.ACTIONS, 'nope']) {
      for (const resource of [undefined, null, {}, { field: null }, { field: { protection: 'secret' } }]) {
        assert.ok(['allow', 'ask', 'deny'].includes(core.can(actor, action, resource).effect))
      }
    }
  }
})

console.log('\n' + count + ' checks, ' + report.total + ' shared cases passed')
