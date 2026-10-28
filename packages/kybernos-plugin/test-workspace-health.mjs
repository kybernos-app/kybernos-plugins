// the workspaces-health rows (bêta 93953fad): one row per registered workspace, exists read, never guessed.
//   node packages/kybernos-plugin/test-workspace-health.mjs
import assert from 'node:assert/strict'
import { requestedWorkspaceId, workspaceHealthRows } from './workspace-health.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

{
  const rows = workspaceHealthRows(
    [{ id: 'w1', path: '/there' }, { id: 'w2', path: '/gone' }],
    (p) => p === '/there')
  assert.deepEqual(rows, [
    { workspaceId: 'w1', path: '/there', exists: true },
    { workspaceId: 'w2', path: '/gone', exists: false }
  ])
  ok('a live folder says exists true, a gone one false — in the registry order')
}

{
  const rows = workspaceHealthRows([null, { id: 'w3' }, { id: 'w4', path: '' }, 'x', { path: '/no-id' }], () => true)
  assert.equal(rows.length, 5, 'one row per entry, even a malformed one: the page counts them')
  assert.deepEqual(rows[0], { workspaceId: '', path: '', exists: false })
  assert.deepEqual(rows[1], { workspaceId: 'w3', path: '', exists: false }, 'a workspace without a path is never « there »')
  assert.deepEqual(rows[2], { workspaceId: 'w4', path: '', exists: false }, 'an empty path is never « there »')
  assert.deepEqual(rows[3], { workspaceId: '', path: '', exists: false })
  assert.deepEqual(rows[4], { workspaceId: '', path: '/no-id', exists: true }, 'a workspace without an id keeps its path, and says no id')
  ok('a malformed workspace makes a quiet row, never a throw and never an invented « exists »')
}

{
  const rows = workspaceHealthRows([{ id: 'a', path: '/x' }], () => { throw new Error('EACCES') })
  assert.deepEqual(rows, [{ workspaceId: 'a', path: '/x', exists: false }])
  ok('a path test that throws reads as « gone », not as a crash')
}

{
  assert.deepEqual(workspaceHealthRows(null, () => true), [])
  assert.deepEqual(workspaceHealthRows(undefined, () => true), [])
  assert.deepEqual(workspaceHealthRows([{ id: 'b', path: '/y' }], null), [{ workspaceId: 'b', path: '/y', exists: false }])
  ok('no list, and no path test, are answered without a throw')
}

{
  const seen = []
  workspaceHealthRows([{ id: 'c', path: '/z' }], (p) => { seen.push(p); return true })
  assert.deepEqual(seen, ['/z'])
  ok('the path test receives the path itself')
}

{
  const known = (id) => ['ws-a', '7f0e2c11-9a1b-4c3d-8e2f-123456789abc'].indexOf(id) >= 0
  assert.equal(requestedWorkspaceId('ws-a', known), 'ws-a')
  assert.equal(requestedWorkspaceId('  7f0e2c11-9a1b-4c3d-8e2f-123456789abc  ', known), '7f0e2c11-9a1b-4c3d-8e2f-123456789abc')
  assert.equal(requestedWorkspaceId('ws-gone', known), null, 'a workspace the registry no longer has is ignored, never forwarded')
  assert.equal(requestedWorkspaceId('', known), null)
  assert.equal(requestedWorkspaceId(null, known), null)
  assert.equal(requestedWorkspaceId(42, known), null)
  assert.equal(requestedWorkspaceId({ id: 'ws-a' }, known), null)
  assert.equal(requestedWorkspaceId('ws-a; rm -rf /', known), null, 'a shape that is not an id is refused before any lookup')
  assert.equal(requestedWorkspaceId('ws-a', null), null)
  assert.equal(requestedWorkspaceId('ws-a', () => { throw new Error('registry down') }), null)
  ok('the workspace a new session lands in: honoured when known, else the engine default — never an error')
}

console.log('workspace health — ' + pass + ' ok')
