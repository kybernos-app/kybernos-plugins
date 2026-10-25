import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MARKER, isEmptyPatch, seedClaudeProvider } from './provider-seed.mjs'

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
rmSync(dir, { recursive: true, force: true })
console.log('provider seed: no key writes nothing, an empty layer is seeded without the key, a layer with entries is kept: all checks pass')
