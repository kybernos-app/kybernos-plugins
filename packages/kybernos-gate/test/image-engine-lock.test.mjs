// The hosted image installs a DSH version that has a folder in docker/engine-locks/ from that lock (docker/Dockerfile), so a computer built tomorrow runs the engine the maintainer adopted, not the newest package inside DSH's `~` ranges.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const locks = join(here, '..', 'docker', 'engine-locks')
const dockerfile = readFileSync(join(here, '..', 'docker', 'Dockerfile'), 'utf8')
const versions = readdirSync(locks, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
const read = (version, file) => JSON.parse(readFileSync(join(locks, version, file), 'utf8'))

test('there is at least one lock, and the Dockerfile installs from it', () => {
  assert.ok(versions.length >= 1)
  assert.ok(dockerfile.includes('COPY --chown=node:node engine-locks /tmp/engine-locks'))
  assert.ok(/npm ci /u.test(dockerfile), 'the locked version is installed with npm ci')
  assert.ok(dockerfile.includes('/tmp/engine-locks/${DSH_VER}/package-lock.json'), 'the lock is picked by DSH_VER')
})

for (const version of versions) {
  test('lock ' + version + ': it pins DSH to its own folder name, with every package resolved and checked', () => {
    const pkg = read(version, 'package.json')
    const lock = read(version, 'package-lock.json')
    assert.equal(pkg.dependencies['@deepseek-ai/dsh'], version, 'package.json asks for exactly this DSH')
    assert.equal(lock.packages['node_modules/@deepseek-ai/dsh'].version, version, 'the lock holds exactly this DSH')
    const real = Object.entries(lock.packages).filter(([path, entry]) => path !== '' && !entry.link)
    assert.ok(real.length > 300, 'a full tree, not a stub')
    assert.deepEqual(real.filter(([, entry]) => typeof entry.integrity !== 'string').map(([path]) => path), [], 'every package carries its integrity hash')
    assert.deepEqual(real.filter(([, entry]) => typeof entry.resolved === 'string' && !entry.resolved.startsWith('https://registry.npmjs.org/')).map(([path]) => path), [], 'every package comes from the public registry')
  })
  test('lock ' + version + ': no personal path and no secret in the files', () => {
    for (const file of ['package.json', 'package-lock.json']) assert.ok(!/\/Users\/|\/home\/|_authToken|npm_[A-Za-z0-9]{20}/u.test(readFileSync(join(locks, version, file), 'utf8')), file)
  })
}
