import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { seedWorkspace } from '../docker/seed-workspace.mjs'

const EMPTY = { unit: { name: 'workspace', version: 2 }, global: { initialized: true, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [] }, tables: { workspaces: {} } }
const fileWith = (doc) => { const f = join(mkdtempSync(join(tmpdir(), 'kb-ws-')), 'workspace.json'); writeFileSync(f, typeof doc === 'string' ? doc : JSON.stringify(doc)); return f }
const read = (f) => JSON.parse(readFileSync(f, 'utf8'))

test('the empty file DSH creates at first start gets one workspace', () => {
  const f = fileWith(EMPTY)
  assert.equal(seedWorkspace(f, '/home/node/workspace'), true)
  const doc = read(f)
  assert.equal(doc.global.workspaceIds.length, 1)
  const ws = doc.tables.workspaces[doc.global.workspaceIds[0]]
  assert.equal(ws.path, '/home/node/workspace')
  assert.equal(ws.title, 'workspace')
  assert.deepEqual(ws.sessionIds, [])
  assert.equal(doc.global.initialized, true, 'the rest of the file is kept')
})

test('a second run changes nothing', () => {
  const f = fileWith(EMPTY)
  seedWorkspace(f, '/home/node/workspace')
  const once = readFileSync(f, 'utf8')
  assert.equal(seedWorkspace(f, '/home/node/other'), false)
  assert.equal(readFileSync(f, 'utf8'), once)
})

test('a file that already has a workspace, another version, or no layout at all is left alone', () => {
  const withOne = { ...EMPTY, global: { ...EMPTY.global, workspaceIds: ['a'] }, tables: { workspaces: { a: { path: '/x' } } } }
  for (const doc of [withOne, { ...EMPTY, unit: { name: 'workspace', version: 3 } }, { ...EMPTY, unit: { name: 'other', version: 2 } }, {}, [], 'not json', '']) {
    const f = fileWith(doc)
    const before = readFileSync(f, 'utf8')
    assert.equal(seedWorkspace(f, '/home/node/workspace'), false)
    assert.equal(readFileSync(f, 'utf8'), before)
  }
})

test('a missing file does not throw', () => {
  assert.equal(seedWorkspace(join(tmpdir(), 'kb-ws-missing', 'workspace.json'), '/x'), false)
})

test('run as a script it seeds and says so; with no arguments it does nothing', () => {
  const f = fileWith(EMPTY)
  const script = new URL('../docker/seed-workspace.mjs', import.meta.url).pathname
  assert.match(execFileSync('node', [script, f, '/home/node/workspace'], { encoding: 'utf8' }), /first workspace: \/home\/node\/workspace/)
  assert.equal(execFileSync('node', [script], { encoding: 'utf8' }), '')
})
