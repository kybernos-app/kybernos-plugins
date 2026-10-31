// test-tables-freeze.mjs — the freeze of the tables template (templates/tables/lib/freeze.mjs): which requests count as writes, and a state that lives in a file in the data folder, so
// that it survives a restart and is never claimed when it could not be saved. Needs node:fs only; the routes themselves are exercised over http by scripts/check-publish.mjs.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FREEZE_FILE, FREEZE_PATH, isWrite, makeFreeze } from './templates/tables/lib/freeze.mjs'

let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const root = mkdtempSync(join(tmpdir(), 'kb-tables-freeze-'))
const T0 = Date.UTC(2026, 9, 31, 9, 0, 0)

try {
  ok('a write is any method that changes something, and the owner\'s link, which makes a session', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(isWrite(method, '/api/apps/shop/write'), true, method)
    for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(isWrite(method, '/api/apps/shop/records'), false, method)
    assert.equal(isWrite('GET', '/health'), false, 'the health check is a read')
    assert.equal(isWrite('GET', '/open'), true, 'the link that opens the owner writes a session')
    assert.equal(isWrite('GET', '/invite'), false, 'reading an invitation writes nothing')
    assert.equal(FREEZE_PATH, '/api/freeze')
  })

  ok('a new data folder is not frozen, and says nothing', () => {
    const dir = mkdtempSync(join(root, 'a-'))
    const lines = []
    const f = makeFreeze({ dir, now: () => T0, log: (m) => lines.push(m) })
    assert.equal(f.frozen(), false)
    assert.deepEqual(lines, [])
    assert.equal(existsSync(join(dir, FREEZE_FILE)), false)
  })

  ok('freezing writes the state to a private file; a restart (a new instance on the same folder) is still frozen', () => {
    const dir = mkdtempSync(join(root, 'b-'))
    const lines = []
    const f = makeFreeze({ dir, now: () => T0, log: (m) => lines.push(m) })
    assert.deepEqual(f.set(true), { ok: true, frozen: true })
    assert.equal(f.frozen(), true)
    const file = join(dir, FREEZE_FILE)
    assert.equal(statSync(file).mode & 0o777, 0o600, 'only the app reads it')
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { frozen: true, at: '2026-10-31T09:00:00.000Z' })
    assert.equal(existsSync(file + '.tmp'), false, 'no half-written file is left')
    const after = makeFreeze({ dir, log: (m) => lines.push(m) })
    assert.equal(after.frozen(), true, 'the machine restarted while frozen and comes back frozen')
    assert.ok(lines.some((l) => /stays so/.test(l)), 'and the log says it')
  })

  ok('lifting the freeze removes the file; a restart is then not frozen', () => {
    const dir = mkdtempSync(join(root, 'c-'))
    const f = makeFreeze({ dir })
    f.set(true)
    assert.deepEqual(f.set(false), { ok: true, frozen: false })
    assert.equal(f.frozen(), false)
    assert.equal(existsSync(join(dir, FREEZE_FILE)), false)
    assert.equal(makeFreeze({ dir }).frozen(), false)
  })

  ok('asking for the state already in force is a yes that changes nothing', () => {
    const dir = mkdtempSync(join(root, 'd-'))
    const f = makeFreeze({ dir })
    assert.deepEqual(f.set(false), { ok: true, frozen: false })
    f.set(true)
    const before = readFileSync(join(dir, FREEZE_FILE), 'utf8')
    assert.deepEqual(f.set(true), { ok: true, frozen: true })
    assert.equal(readFileSync(join(dir, FREEZE_FILE), 'utf8'), before, 'the file is not rewritten')
  })

  ok('a state that cannot be saved is an error and the state does not change', () => {
    const lines = []
    const f = makeFreeze({ dir: join(root, 'does-not-exist'), log: (m) => lines.push(m) })
    assert.deepEqual(f.set(true), { ok: false, error: 'unsaved' })
    assert.equal(f.frozen(), false, 'it never claims a freeze that a restart would lose')
    assert.ok(lines.some((l) => /could not be saved/.test(l)))
    assert.equal(lines.join('\n').includes(root), false, 'no path in the log')
  })

  ok('a leftover file of any content means frozen: it was written by the app, and unknown is safer frozen', () => {
    const dir = mkdtempSync(join(root, 'e-'))
    writeFileSync(join(dir, FREEZE_FILE), 'not json at all')
    assert.equal(makeFreeze({ dir }).frozen(), true)
  })
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('\ntables template, freeze: ' + count + ' checks passed')
