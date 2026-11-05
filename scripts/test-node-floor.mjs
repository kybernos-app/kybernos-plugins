// The Node floor of the engine says the same thing everywhere a person or a machine reads it.
//
//   node scripts/test-node-floor.mjs
//
// DSH 0.2.2 needs Node 24.9 or later (its own `engines`). Found on 2026-11-05: the installers said « DSH declares none », the docs said
// « Node 22 or later », the Linux arm64 script installed Node 22 and the hosted image was built on node:22, while the engine range of
// dsh-compat.json already ended on a 0.2.2 version. The one source is `dsh.node` in dsh-compat.json; this test pins the others to it.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const compat = JSON.parse(read('dsh-compat.json'))
const floor = compat.dsh.node
check('dsh-compat.json declares the floor: a version and the first engine it applies to', typeof floor?.min === 'string' && /^\d+\.\d+\.\d+$/.test(floor.min) && typeof floor.from === 'string', floor)
const [major, minor] = (floor?.min ?? '0.0.0').split('.')
const short = major + '.' + minor // « 24.9 »

const doc = (rel) => read(rel)
check('README.md names the floor and no older Node', doc('README.md').includes('Node.js ' + short + ' or later') && !/Node\.js 22 or later/.test(doc('README.md')))
check('docs/install.md names the floor (the table and the troubleshooting line) and no older Node', (doc('docs/install.md').match(new RegExp('(version|Node\\.js) ' + short.replace('.', '\\.') + ' or later', 'g')) || []).length === 2 && !/(version|Node\.js) 22 or later/.test(doc('docs/install.md')))

const sh = doc('scripts/install-linux-arm64.sh')
check('the Linux arm64 script asks for the floor, downloads that major and checks the floor again after the download',
  sh.includes('a>' + major + '||(a===' + major + '&&b>=' + minor + ')') && sh.includes('latest-v' + major + '.x') && sh.includes('node-v' + major + '\\.') && sh.includes('older than ' + short + '"'))
check('the headless check judges Node against the same floor', doc('scripts/check-headless-linux.mjs').includes('Number(v[1]) < ' + major) && doc('scripts/check-headless-linux.mjs').includes('older than ' + short))

const image = doc('packages/kybernos-gate/docker/Dockerfile')
check('the hosted image is built on the floor\'s Node major', image.includes('FROM node:' + major + '-slim'), image.match(/^FROM .*/m)?.[0])
const dshVer = /^ARG DSH_VER=(\S+)/m.exec(image)?.[1]
const hasLock = (() => { try { return JSON.parse(read('packages/kybernos-gate/docker/engine-locks/' + dshVer + '/package.json')).dependencies['@deepseek-ai/dsh'] === dshVer } catch (e) { return false } })()
check('the image\'s default engine is one dsh-compat.json tested and has an engine lock', typeof dshVer === 'string' && compat.dsh.testees.includes(dshVer) && hasLock, dshVer)

for (const rel of ['kybernos-install', 'kybernos-install.cmd']) {
  check(rel + ' no longer says DSH declares no minimum, and points at dsh-compat.json', !/DSH declares none/.test(doc(rel)) && /dsh-compat\.json/.test(doc(rel)))
}

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
