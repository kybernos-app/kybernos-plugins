// render-profile.sh: the model route of a computer, rendered from the environment into the profile. A pool slot renders it before it has a token (the route names the key, never holds
// it), and the file is written only when what it holds changes: a write is a hot reload of DSH, which took 9 s on a small machine at Fly (measured, 2026-10-20).
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'render-profile.sh')
const SEED = '- id: permission\n  config:\n    defaultPreset: danger-full-access\n'

const fresh = () => {
  const home = mkdtempSync(join(tmpdir(), 'kb-render-'))
  mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
  writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), SEED)
  return home
}
const run = (home, env) => spawnSync('sh', [script], { env: { PATH: process.env.PATH, DSH_HOME: home, ...env }, encoding: 'utf8' })
const file = (home) => join(home, 'profiles', 'web', 'cordis.patch.yml')
const API = 'https://api.example.test'

test('a computer with its token gets the route, and what was in the profile stays', () => {
  const home = fresh()
  const out = run(home, { KYBERNOS_API: API, KYBERNOS_COMPUTER_TOKEN: 'kyd_token_0123456789abcdef', KYBERNOS_COMPUTER_MODEL: 'glm-5.3' })
  assert.equal(out.status, 0)
  const text = readFileSync(file(home), 'utf8')
  assert.ok(text.startsWith(SEED))
  assert.match(text, /baseURL: https:\/\/api\.example\.test\/v1/)
  assert.match(text, /apiKeyEnv: KYBERNOS_COMPUTER_TOKEN/)
  assert.match(text, /- id: glm-5\.3/)
  assert.equal(text.includes('kyd_token'), false, 'the key is named, never written')
})

test('a pool slot, with no token yet, gets the same route: the claim then changes nothing in the profile', () => {
  const home = fresh()
  const slot = { KYBERNOS_API: API, KYBERNOS_POOL_SLOT: 'slot-1', KYBERNOS_COMPUTER_MODEL: 'glm-5.3' }
  assert.equal(run(home, slot).status, 0)
  const before = readFileSync(file(home), 'utf8')
  assert.match(before, /apiKeyEnv: KYBERNOS_COMPUTER_TOKEN/)
  // The claim: the same address and model, now with a token. Nothing is written (no hot reload of DSH).
  const mtime = statSync(file(home)).mtimeMs
  const claimed = run(home, { ...slot, KYBERNOS_COMPUTER_TOKEN: 'kyd_token_0123456789abcdef' })
  assert.equal(claimed.status, 0)
  assert.equal(readFileSync(file(home), 'utf8'), before)
  assert.equal(statSync(file(home)).mtimeMs, mtime, 'the file was not touched')
})

test('a changed model is written (and only then), and a block that was there is replaced, not doubled', () => {
  const home = fresh()
  const slot = { KYBERNOS_API: API, KYBERNOS_POOL_SLOT: 'slot-1', KYBERNOS_COMPUTER_MODEL: 'glm-5.3' }
  run(home, slot)
  run(home, { ...slot, KYBERNOS_COMPUTER_MODEL: 'deepseek-v4.1-flash' })
  const text = readFileSync(file(home), 'utf8')
  assert.equal(text.split('# kybernos-computer:begin').length - 1, 1)
  assert.match(text, /- id: deepseek-v4\.1-flash/)
  assert.equal(text.includes('glm-5.3'), false)
})

test('no platform address, or a machine that is neither a computer nor a slot, gets no route and an unchanged profile', () => {
  const home = fresh()
  assert.equal(run(home, { KYBERNOS_POOL_SLOT: 'slot-1' }).status, 0)
  assert.equal(readFileSync(file(home), 'utf8'), SEED)
  assert.equal(run(home, { KYBERNOS_API: API }).status, 0)
  assert.equal(readFileSync(file(home), 'utf8'), SEED)
  // A model name that is not one falls back to `auto`.
  run(home, { KYBERNOS_API: API, KYBERNOS_POOL_SLOT: 's', KYBERNOS_COMPUTER_MODEL: 'a b; rm -rf /' })
  assert.match(readFileSync(file(home), 'utf8'), /- id: auto/)
  // No profile yet: nothing to do, and no failure.
  assert.equal(spawnSync('sh', [script], { env: { PATH: process.env.PATH, DSH_HOME: join(home, 'nowhere') }, encoding: 'utf8' }).status, 0)
})
