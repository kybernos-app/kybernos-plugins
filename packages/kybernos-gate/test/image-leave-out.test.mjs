// The hosted image leaves the phone-only bundles out (docker/leave-out-phone-only.mjs): without it a build from a checkout that has them fails at the install's boot check.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { leaveOut, PHONE_ONLY } from '../docker/leave-out-phone-only.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-leave-out-'))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  for (const dir of ['kybernos-no-process', 'kybernos-cloud']) { mkdirSync(join(root, 'packages', dir), { recursive: true }); writeFileSync(join(root, 'packages', dir, 'package.json'), '{}') }
  cpSync(join(repo, 'scripts', 'lifecycle-packages.json'), join(root, 'scripts', 'lifecycle-packages.json'))
  return root
}
const rowsOf = (root) => JSON.stringify(JSON.parse(readFileSync(join(root, 'scripts', 'lifecycle-packages.json'), 'utf8')))

test('the phone-only folder and its lifecycle row go, the others stay', () => {
  const root = fresh()
  assert.ok(rowsOf(root).includes('kybernos-no-process'), 'the repository still lists it (else this test proves nothing)')
  const left = leaveOut(root)
  assert.deepEqual(left, ['kybernos-no-process'])
  assert.equal(existsSync(join(root, 'packages', 'kybernos-no-process')), false)
  assert.equal(existsSync(join(root, 'packages', 'kybernos-cloud')), true)
  assert.equal(rowsOf(root).includes('kybernos-no-process'), false)
  assert.ok(rowsOf(root).includes('kybernos-cloud'), 'the other rows are kept')
})

test('a second run, or a tree that never had the bundle, changes nothing', () => {
  const root = fresh()
  leaveOut(root)
  const once = rowsOf(root)
  assert.deepEqual(leaveOut(root), [])
  assert.equal(rowsOf(root), once)
  assert.deepEqual(leaveOut(mkdtempSync(join(tmpdir(), 'kb-leave-out-empty-'))), [])
})

test('the Dockerfile runs it before the install', () => {
  const docker = readFileSync(join(here, '..', 'docker', 'Dockerfile'), 'utf8')
  const at = docker.indexOf('leave-out-phone-only.mjs /opt/kybernos-plugins')
  const install = docker.indexOf('./kybernos-install')
  assert.ok(at > 0 && install > at, 'leave-out-phone-only.mjs runs on /opt/kybernos-plugins before ./kybernos-install')
  assert.ok(PHONE_ONLY.length >= 1)
})
