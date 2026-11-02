// The person seam: who is signed in on this computer, for the chat Journal's record of who decided.
//   node packages/kybernos-cloud/test-person-seam.mjs
// What is proven: it answers null when signed out, the name (else the address) and the computer's label when signed in, never the id, the plan or the token, flattened and cut,
// and the seam is frozen with only `read`.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const home = mkdtempSync(join(tmpdir(), 'kb-person-seam-'))
const stateFile = join(home, 'kybernos-cloud.json')
process.env.HOME = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.KYBERNOS_CLOUD_STATE = stateFile
delete process.env.KYBERNOS_SERVERS_FILE

const TOKEN = 'kyd_' + 's'.repeat(40)
const { publishPersonSeam, PERSON_SEAM } = await import('./index.js')
const target = {}
publishPersonSeam(target)
const seam = target[PERSON_SEAM]
check('the seam is published, frozen, with only `read`', seam !== undefined && Object.isFrozen(seam) && Object.keys(seam).sort().join(',') === 'read,version' && typeof seam.read === 'function')
check('signed out (no file): null', seam.read() === null)

const write = (state) => writeFileSync(stateFile, JSON.stringify(state) + '\n', { mode: 0o600 })
write({ token: '', user: { name: 'Ada', email: 'ada@example.com' } })
check('a file with no token is not a connection: null', seam.read() === null)

write({ token: TOKEN, user: { id: 'u_123', name: 'Ada Lovelace', email: 'ada@example.com', plan: 'pro' }, device_label: 'Ada\'s MacBook' })
let r = seam.read()
check('signed in: the name and the label of this computer', r !== null && r.name === 'Ada Lovelace' && r.device === 'Ada\'s MacBook', JSON.stringify(r))
check('nothing else leaves: no id, no plan, no address, no token', JSON.stringify(r).includes('u_123') === false && JSON.stringify(r).includes('pro') === false && JSON.stringify(r).includes('example.com') === false && JSON.stringify(r).includes(TOKEN) === false && Object.keys(r).sort().join(',') === 'device,name')

write({ token: TOKEN, user: { name: '  ', email: 'grace@example.com' } })
r = seam.read()
check('no name: the address the account was made with stands in', r !== null && r.name === 'grace@example.com' && r.device === null, JSON.stringify(r))

write({ token: TOKEN, user: { name: 'Line\nbreak and\ttabs   spaced', email: 'x@y.z' }, device_label: 'z'.repeat(300) })
r = seam.read()
check('a name is one line; a long label is cut to 80', r !== null && r.name === 'Line break and tabs spaced' && r.device.length === 80, JSON.stringify(r))

write({ token: TOKEN })
check('connected but nobody to name: null', seam.read() === null)

writeFileSync(stateFile, '{ not json')
check('a damaged file never throws: null', seam.read() === null)

console.log(failed === 0 ? '\nperson seam: all checks passed' : '\nperson seam: ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
