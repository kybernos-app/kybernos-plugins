// computer-identity.mjs: what a cloud computer is when its environment does not say (a pooled computer, handed its identity at the claim). Pure file and string work, no DSH.
//
//   node kybernos-cloud/test-computer-identity.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanIdentity, identityFile, identityOf, readIdentity, shellExports, writeIdentity } from './computer-identity.mjs'

const here = dirname(fileURLToPath(import.meta.url))
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const GOOD = { api: 'https://api.example.test', computer_id: 'cmp-01a1590d', token: 'kyd_' + 'a'.repeat(40), model: 'deepseek-v4.1-flash' }
const home = mkdtempSync(join(tmpdir(), 'kb-identity-'))

// The cloud image keeps a byte-for-byte copy (bundles do not import each other, the image ships files one by one): this is what lets the two part.
assert.equal(
  readFileSync(join(here, 'computer-identity.mjs'), 'utf8'),
  readFileSync(join(here, '..', '..', 'services', 'computer-image', 'computer-identity.mjs'), 'utf8'),
  'services/computer-image/computer-identity.mjs must be a byte-for-byte copy of this bundle\'s'
)
ok('the image\'s copy is byte-identical')

// ── what is a valid identity ────────────────────────────────────────────────────────────
assert.deepEqual(cleanIdentity(GOOD), GOOD)
assert.deepEqual(cleanIdentity({ ...GOOD, api: 'https://api.example.test/' }), GOOD, 'a trailing slash is dropped')
assert.equal(cleanIdentity({ ...GOOD, model: '' }).model, 'auto', 'no model: the platform\'s auto')
assert.equal(cleanIdentity({ ...GOOD, api: 'http://127.0.0.1:8087' }).api, 'http://127.0.0.1:8087', 'http for a loopback address')
assert.equal(cleanIdentity({ ...GOOD, api: 'http://localhost:3000' }) !== null, true)
for (const bad of [
  { ...GOOD, api: 'http://api.example.test' },               // plain http to anything but a loopback address
  { ...GOOD, api: 'https://api.example.test/v1' },           // an origin, not a path
  { ...GOOD, api: 'https://user:pw@api.example.test' },      // no credentials in the address
  { ...GOOD, api: 'https://api.example.test:99999999' },
  { ...GOOD, computer_id: 'a b' }, { ...GOOD, computer_id: '' }, { ...GOOD, computer_id: 'x'.repeat(65) },
  { ...GOOD, token: 'short' }, { ...GOOD, token: "kyd_'; touch /tmp/x; '" + 'a'.repeat(20) }, { ...GOOD, token: 'kyd_ with space ' + 'a'.repeat(20) },
  { ...GOOD, model: 'a b' }, { ...GOOD, model: '$(id)' },
  null, 'x', [], 42
]) assert.equal(cleanIdentity(bad), null, JSON.stringify(bad))
assert.deepEqual(Object.keys(cleanIdentity({ ...GOOD, extra: 'x', password: 'y' })).sort(), ['api', 'computer_id', 'model', 'token'], 'only the four fields are kept')
ok('only an origin, an id, a token and a model of the closed alphabets are an identity; nothing else is kept')

// ── the volume ───────────────────────────────────────────────────────────────────────────
assert.equal(readIdentity(home), null, 'none yet')
assert.equal(writeIdentity(home, { ...GOOD, token: 'bad token' }), false, 'an invalid identity is not written')
assert.equal(existsSync(identityFile(home)), false)
assert.equal(writeIdentity(home, GOOD, new Date('2026-10-20T10:00:00Z')), true)
assert.deepEqual(readIdentity(home), GOOD)
assert.equal(statSync(identityFile(home)).mode & 0o777, 0o600, 'the file is the owner\'s only')
assert.equal(statSync(dirname(identityFile(home))).mode & 0o777, 0o700)
assert.deepEqual(readdirSync(dirname(identityFile(home))).filter((f) => f.endsWith('.tmp')), [], 'no temporary file is left')
assert.equal(JSON.parse(readFileSync(identityFile(home), 'utf8')).claimed_at, '2026-10-20T10:00:00.000Z')
writeFileSync(identityFile(home), '{ not json')
assert.equal(readIdentity(home), null, 'an unreadable file is no identity')
writeFileSync(identityFile(home), JSON.stringify({ ...GOOD, token: 'nope' }))
assert.equal(readIdentity(home), null, 'a file that holds an invalid identity is no identity')
ok('written atomically as 0600, read back, and a damaged file is none')

// ── who the machine is ───────────────────────────────────────────────────────────────────
writeIdentity(home, GOOD)
const env = (extra = {}) => ({ KYBERNOS_API: 'https://api.example.test', ...extra })
assert.equal(identityOf(env(), home).source, 'volume')
assert.deepEqual(identityOf(env(), home), { source: 'volume', id: GOOD.computer_id, token: GOOD.token, api: GOOD.api, model: GOOD.model })
const old = identityOf(env({ KYBERNOS_COMPUTER_ID: 'cmp-env', KYBERNOS_COMPUTER_TOKEN: 'kyd_from_env_0123456789', KYBERNOS_COMPUTER_MODEL: 'glm' }), home)
assert.deepEqual(old, { source: 'env', id: 'cmp-env', token: 'kyd_from_env_0123456789', api: 'https://api.example.test', model: 'glm' }, 'the environment wins')
assert.equal(identityOf(env({ KYBERNOS_COMPUTER_ID: 'cmp-env' }), home).source, 'volume', 'half an identity in the environment is none')
assert.equal(identityOf(env(), mkdtempSync(join(tmpdir(), 'kb-identity-empty-'))).source, null, 'unclaimed: not a computer')
assert.equal(identityOf(env(), '').source, null)
assert.equal(identityOf({}, home).source, 'volume')
ok('the environment wins, then the volume, else it is not a computer')

// ── the lines a shell evaluates ──────────────────────────────────────────────────────────
assert.equal(shellExports(env({ KYBERNOS_COMPUTER_ID: 'cmp-env', KYBERNOS_COMPUTER_TOKEN: 'kyd_from_env_0123456789' }), home), '', 'a machine made the old way gets nothing')
assert.equal(shellExports(env(), mkdtempSync(join(tmpdir(), 'kb-identity-empty-'))), '', 'nor an unclaimed one')
const lines = shellExports({}, home)
assert.deepEqual(lines.split('\n').map((l) => l.split('=')[0]), ['export KYBERNOS_API', 'export KYBERNOS_COMPUTER_ID', 'export KYBERNOS_COMPUTER_TOKEN', 'export KYBERNOS_COMPUTER_MODEL'])
assert.equal(shellExports(env({ KYBERNOS_COMPUTER_MODEL: 'already' }), home).includes('KYBERNOS_COMPUTER_MODEL'), false, 'a variable that is set is not overridden')
const shown = execFileSync('sh', ['-c', `${lines}\nprintf '%s|%s|%s|%s' "$KYBERNOS_API" "$KYBERNOS_COMPUTER_ID" "$KYBERNOS_COMPUTER_TOKEN" "$KYBERNOS_COMPUTER_MODEL"`], { encoding: 'utf8', env: {} })
assert.equal(shown, [GOOD.api, GOOD.computer_id, GOOD.token, GOOD.model].join('|'))
// A file somebody edited by hand to carry a command is no identity at all, so no line is printed for the shell.
const marker = join(home, 'pwned')
mkdirSync(dirname(identityFile(home)), { recursive: true })
writeFileSync(identityFile(home), JSON.stringify({ ...GOOD, token: `kyd_aaaaaaaaaaaaaaaaaaaaaaaa'; touch ${marker}; echo '`, model: 'x' }))
assert.equal(shellExports({}, home), '')
assert.equal(existsSync(marker), false)
ok('the lines are exactly the four values, never override the environment, and a tampered file prints nothing')

rmSync(home, { recursive: true, force: true })
console.log(`\n${pass} verifications OK`)
