// Which session each task of the assistants' door ran in (door-sessions.mjs): remembered on the volume, bounded, never fatal.
//   node packages/kybernos-cloud/test-door-sessions.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDoorSessions, KEEP_MS, MAX_TASKS } from './door-sessions.mjs'

let passed = 0
const check = async (name, fn) => { await fn(); passed += 1; console.log('  ✓ ' + name) }
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const fresh = (clock = { t: 1_795_200_000_000 }) => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-door-sessions-'))
  const file = join(dir, 'kybernos', 'door-sessions.json')
  return { clock, file, d: createDoorSessions({ file: () => file, now: () => clock.t }) }
}

await check('a task is remembered with its session, in a file only its owner reads, and survives a new instance (a restart)', () => {
  const { d, file, clock } = fresh()
  assert.equal(d.sessionOf(id(1)), null, 'nothing yet')
  assert.equal(d.note(id(1), 'sess-1'), true)
  assert.equal(d.sessionOf(id(1)), 'sess-1')
  assert.equal(statSync(file).mode & 0o777, 0o600)
  const restarted = createDoorSessions({ file: () => file, now: () => clock.t })
  assert.equal(restarted.sessionOf(id(1)), 'sess-1')
  assert.equal(restarted.sessionOf(id(2)), null)
})

await check('the same task asked again replaces its line, and another task keeps its own', () => {
  const { d, file } = fresh()
  d.note(id(1), 'sess-a'); d.note(id(2), 'sess-b'); d.note(id(1), 'sess-c')
  assert.equal(d.sessionOf(id(1)), 'sess-c')
  assert.equal(d.sessionOf(id(2)), 'sess-b')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).items.length, 2)
})

await check('what is not a task id or a session id is never written, and nothing else is read back', () => {
  const { d, file } = fresh()
  for (const [job, session] of [['not-an-id', 'sess'], [id(1), ''], [id(1), 'a/b'], [id(1), '../x'], [id(1), 'x'.repeat(81)], [null, 'sess'], [id(1), null], [123, 'sess']]) {
    assert.equal(d.note(job, session), false, JSON.stringify([job, session]))
  }
  assert.equal(d.sessionOf('not-an-id'), null)
  assert.equal(d.sessionOf(undefined), null)
  // A file edited by hand with a line that is not valid: that line is « no memory », the others stay.
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify({ items: [{ job: id(1), session: '../etc', at: 1 }, { job: id(2), session: 'sess-ok', at: Date.now() }, null, 'x'] }))
  assert.equal(d.sessionOf(id(1)), null)
  assert.equal(d.sessionOf(id(2)), 'sess-ok')
})

await check('seven days and the 300 most recent tasks: older ones are forgotten', () => {
  const { d, clock } = fresh()
  d.note(id(1), 'old')
  clock.t += KEEP_MS - 1000
  assert.equal(d.sessionOf(id(1)), 'old')
  clock.t += 2000
  assert.equal(d.sessionOf(id(1)), null, 'over seven days')
  const many = fresh()
  for (let i = 1; i <= MAX_TASKS + 5; i += 1) many.d.note(id(i), 'sess-' + i)
  assert.equal(many.d.sessionOf(id(1)), null, 'past the 300 most recent')
  assert.equal(many.d.sessionOf(id(MAX_TASKS + 5)), 'sess-' + (MAX_TASKS + 5))
  assert.equal(JSON.parse(readFileSync(many.file, 'utf8')).items.length, MAX_TASKS)
})

await check('a file that cannot be read or written is « no memory », never an error: the task still runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-door-sessions-'))
  const broken = join(dir, 'broken.json')
  writeFileSync(broken, '{ not json')
  const d1 = createDoorSessions({ file: () => broken })
  assert.equal(d1.sessionOf(id(1)), null)
  assert.equal(d1.note(id(1), 'sess'), true, 'a broken file is written over')
  assert.equal(d1.sessionOf(id(1)), 'sess')
  // A path that cannot be a file (its parent is a file): the write says no, and the read says nothing.
  const blocked = createDoorSessions({ file: () => join(broken, 'inside', 'x.json') })
  assert.equal(blocked.note(id(1), 'sess'), false)
  assert.equal(blocked.sessionOf(id(1)), null)
})

console.log('\n' + passed + ' checks passed')
