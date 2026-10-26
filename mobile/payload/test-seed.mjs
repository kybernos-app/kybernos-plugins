import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MARKER, isEmptyPatch, seedClaudeProvider, seedFirstWorkspace } from './seed.mjs'

const dir = mkdtempSync(join(tmpdir(), 'seed-'))
const patch = join(dir, 'cordis.patch.yml')
const KEY = 'sk-ant-test-0123456789abcdefghij'

assert.equal(isEmptyPatch(''), true)
assert.equal(isEmptyPatch('# comment\n[]\n'), true)
assert.equal(isEmptyPatch('# c\n- id: x\n  config: {}\n'), false)

writeFileSync(patch, '# Your patch layer\n[]\n')
assert.equal(seedClaudeProvider({ patchFile: patch, env: {} }), 'no-key', 'no key, nothing written')
assert.equal(readFileSync(patch, 'utf8'), '# Your patch layer\n[]\n')
assert.equal(seedClaudeProvider({ patchFile: patch, env: { ANTHROPIC_API_KEY: '' } }), 'no-key')

assert.equal(seedClaudeProvider({ patchFile: patch, env: { ANTHROPIC_API_KEY: KEY } }), 'seeded')
const text = readFileSync(patch, 'utf8')
assert.ok(text.startsWith(MARKER))
assert.ok(text.includes('apiKeyEnv: ANTHROPIC_API_KEY') && text.includes('provider: claude') && text.includes('claude-haiku-5-5'))
assert.ok(!text.includes(KEY) && !text.includes('sk-ant-test'), 'the key itself is never written')

assert.equal(seedClaudeProvider({ patchFile: patch, env: { ANTHROPIC_API_KEY: KEY } }), 'kept', 'a layer with entries is left alone (seeding twice changes nothing)')
writeFileSync(patch, '- id: agent-default-model\n  config:\n    provider: other\n')
assert.equal(seedClaudeProvider({ patchFile: patch, env: { ANTHROPIC_API_KEY: KEY } }), 'kept', 'the user layer is theirs')
assert.equal(readFileSync(patch, 'utf8'), '- id: agent-default-model\n  config:\n    provider: other\n')

rmSync(patch); assert.equal(seedClaudeProvider({ patchFile: patch, env: { ANTHROPIC_API_KEY: KEY } }), 'seeded', 'a missing file counts as empty')
// the first workspace: a fresh install gets the app's own folder as its first workspace, in the layout DSH keeps; an existing store is never touched
const ws = join(dir, 'home', 'data', '.dsh', 'storages', 'workspace.json')
const folder = join(dir, 'Documents', 'Kybernos')
assert.equal(seedFirstWorkspace({ file: ws, folder, id: 'w-1', now: new Date('2026-10-26T12:00:00Z') }), 'seeded')
const doc = JSON.parse(readFileSync(ws, 'utf8'))
assert.deepEqual(doc.unit, { name: 'workspace', version: 2 })
assert.deepEqual(doc.global, { initialized: true, workspaceIds: ['w-1'], archivedSessionIds: [], pinnedSessionIds: [] })
assert.deepEqual(doc.tables.workspaces['w-1'], { path: folder, title: 'Kybernos', sessionIds: [], createdAt: '2026-10-26T12:00:00.000Z', updatedAt: '2026-10-26T12:00:00.000Z' })
writeFileSync(ws, '{"mine":true}')
assert.equal(seedFirstWorkspace({ file: ws, folder }), 'kept', 'a store that exists is the person\u2019s, with or without workspaces')
assert.equal(readFileSync(ws, 'utf8'), '{"mine":true}')
const none = join(dir, 'other', 'workspace.json')
assert.equal(seedFirstWorkspace({ file: none, folder: undefined }), 'kept', 'no folder, nothing to offer')
assert.equal(seedFirstWorkspace({ file: none, folder: '' }), 'kept')
assert.equal(existsSync(none), false)
assert.notEqual(seedFirstWorkspace({ file: join(dir, 'x', 'y', 'workspace.json'), folder }), 'kept', 'the missing folders of the path are made')
rmSync(dir, { recursive: true, force: true })
console.log('seeds: no key writes nothing, an empty layer is seeded without the key, a layer with entries is kept; the first workspace is written once, in the layout of DSH, and never over a store that exists: all checks pass')
