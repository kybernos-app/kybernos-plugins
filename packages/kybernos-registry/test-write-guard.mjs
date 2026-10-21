// The one route of this bundle that WRITES (the person's acceptance of a plugin) needs DSH's signed session as well as the right Origin.
// DSH serves plugin routes before its own login and an Origin header is forgeable by any local program: a bare `curl -X POST` must not accept a plugin's instructions for the person.
//
// In this order: no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no cookie (what a local program sends) ·
// the right Origin and a forged cookie · the right Origin and the real cookie (the Plugins page). The reads are left as they were.
//   node packages/kybernos-registry/test-write-guard.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

const root = mkdtempSync(join(tmpdir(), 'kybernos-registry-guard-'))
process.env.HOME = root; process.env.USERPROFILE = root; process.env.DSH_HOME = join(root, 'dsh')
delete globalThis[Symbol.for('kybernos.registry')]
sessionSource.secret = () => SESSION_SECRET

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const stateFile = join(root, 'dsh', 'kybernos', 'plugins-state.json')
const profile = join(root, 'dsh', 'profiles', 'web')
const dir = join(profile, 'node_modules', 'kybernos-plugin-vet')
mkdirSync(join(dir, 'domains'), { recursive: true })
writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'kybernos-plugin-vet': '1.0.0' }, dsh: { profile: { bundles: ['kybernos-plugin-vet'] } } }))
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'kybernos-plugin-vet', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
  contract: 1, id: 'acme/vet', kind: 'data', version: '0.1.0', name: { en: 'Vet' }, description: { en: 'A pack.' }, author: { id: 'acme', name: 'Acme' }, license: 'MIT', pricing: 'free',
  requires: { kybernos: '>=0.1.0', plugins: { 'kybernos/core': '^1.0' } }, extends: [{ point: 'kybernos/core#domain-pack', range: '^1.0', dir: 'domains' }]
}))

const mod = await import('./index.js')
const registered = new Map()
mod.apply({ get: (n) => (n === 'webServer' ? { register: ({ path, handler }) => { registered.set(path, handler); return () => {} } } : undefined), inject: () => {}, effect: (fn) => { void fn() } })
mod.ensureRegistry().definePoint({ owner: 'kybernos/core', ownerVersion: '1.0.0', name: 'domain-pack', version: '1.0', kind: 'data', class: 'instruction', validate: () => ({ ok: true, value: {} }) })
const hit = async (path, method, headers, body) => {
  const r = { status: 0, writeHead(s) { this.status = s }, end() {} }
  const req = { method, url: path, headers: { host: '127.0.0.1:3080', ...headers }, socket: { localPort: 3080 }, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)) } }
  await registered.get(path.split('?')[0])(req, r)
  return r.status
}

const WRITES = mod.ROUTES.filter((r) => r.method === 'POST')
assert.equal(WRITES.length, 2, 'the two writes of this bundle (consent, import) are under the rule')
assert.ok(WRITES.every((r) => r.session === true), 'every POST route is marked session: true')
assert.ok(mod.ROUTES.filter((r) => r.method === 'GET').every((r) => r.session !== true), 'the reads are not')
ok('ROUTES: the POST route needs the session, the GET routes do not')

const ARCHIVE = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.alloc(64, 1)])
const importsDir = join(root, 'dsh', 'kybernos', 'plugin-imports')
for (const w of WRITES) {
  const isImport = w.path.endsWith('/import')
  const body = isImport ? ARCHIVE : { id: 'acme/vet', accepted: true }
  const named = isImport ? { 'x-filename': 'acme-vet-1.0.0.tgz' } : {}
  const send = (headers, b = body) => hit(w.path, 'POST', { ...headers, ...named }, b)
  assert.equal(await send({}), 403, w.path + ': no Origin and no cookie')
  assert.equal(await send({ ...browserHeaders(), origin: 'http://evil.example' }), 403, w.path + ': a foreign Origin, even with the real cookie')
  assert.equal(await send({ origin: 'http://127.0.0.1:3080' }), 401, w.path + ': the right Origin and no cookie')
  assert.equal(await send({ origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }), 401, w.path + ': the right Origin and a forged cookie')
  assert.equal(existsSync(isImport ? importsDir : stateFile), false, w.path + ': nothing was written by the refused requests')
  if (isImport) {
    assert.equal(await send(browserHeaders(), Buffer.from('not an archive, just text of some length to pass the size floor')), 400, w.path + ': text is not a gzip archive')
    assert.equal(await hit(w.path, 'POST', { ...browserHeaders(), 'x-filename': '../evil.tgz' }, ARCHIVE), 400, w.path + ': a file name that is not plain is refused')
    assert.equal(await hit(w.path, 'POST', { ...browserHeaders(), 'x-filename': 'run.sh' }, ARCHIVE), 400, w.path + ': only .tgz and .tar.gz')
    assert.equal(await send(browserHeaders(), Buffer.alloc(8 * 1024 * 1024 + 1, 0)), 413, w.path + ': larger than 8 MB')
    assert.equal(existsSync(importsDir) && readdirSync(importsDir).length > 0, false, w.path + ': refused archives were not kept')
  } else {
    assert.equal(await send(browserHeaders(), { id: 'acme/nobody', accepted: true }), 404, w.path + ': an unknown plugin is 404 even for the real session')
    assert.equal(await send(browserHeaders(), { id: 'acme/vet' }), 400, w.path + ': a body without `accepted` is 400')
  }
  assert.equal(await send(browserHeaders()), 200, w.path + ': the right Origin and the real cookie')
  assert.equal(existsSync(isImport ? importsDir : stateFile), true, w.path + ': the real pair wrote')
  if (isImport) assert.equal((statSync(join(importsDir, readdirSync(importsDir)[0])).mode & 0o777), 0o600, w.path + ': the kept archive is private')
  ok(w.path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · nothing written · the real pair 200')
}
assert.equal(await hit('/kybernos-registry/state', 'GET', {}), 200, 'a read needs no header')
assert.equal(await hit('/kybernos-registry/drafts', 'GET', {}), 200, 'the drafts are a read')
assert.equal(await hit('/kybernos-registry/state', 'GET', { origin: 'http://evil.example' }), 403, 'a read from a foreign Origin is still refused')
ok('the reads keep their rule: answered with no header, refused from a foreign Origin')

rmSync(root, { recursive: true, force: true })
console.log('\n' + pass + ' verifications OK')
process.exit(0)
