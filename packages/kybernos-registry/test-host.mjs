// The host half: the routes, the seam, and that nothing is read or written before a question is asked.   node packages/kybernos-registry/test-host.mjs
// A stand-in for DSH's web server keeps what is registered (the real socket test is scripts/test-route-hosts.mjs, which mounts this bundle too).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failed = 0
const check = (name, ok, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!ok) failed += 1 }
const warnings = []
console.warn = (m) => { warnings.push(String(m)) }

// A decoy HOME and a real DSH_HOME: the bundle must follow DSH_HOME and never touch the person's own folder.
const base = mkdtempSync(join(tmpdir(), 'kb-registry-host-'))
const decoy = join(base, 'decoy-home')
const dsh = join(base, 'dsh-home')
mkdirSync(decoy, { recursive: true }); mkdirSync(dsh, { recursive: true })
process.env.HOME = decoy; process.env.USERPROFILE = decoy; process.env.DSH_HOME = dsh
const SEAM = Symbol.for('kybernos.registry')
delete globalThis[SEAM]

const mod = await import('./index.js')
const routes = new Map()
const ctx = { get: (n) => (n === 'webServer' ? { register: ({ path, handler }) => { routes.set(path, handler); return () => {} } } : undefined), inject: () => {}, effect: (fn) => { void fn() } }
mod.apply(ctx)

check('three routes are mounted', [...routes.keys()].sort().join() === '/kybernos-registry/consent,/kybernos-registry/contributions,/kybernos-registry/state', [...routes.keys()])
check('the seam is published, version 1, and it is the same object after a second apply', globalThis[SEAM] !== undefined && globalThis[SEAM].version === 1 && (mod.apply(ctx), globalThis[SEAM] === mod.ensureRegistry()))
check('booting read and wrote nothing', !existsSync(join(dsh, 'kybernos')) && readdirSync(decoy).length === 0, readdirSync(dsh))

const hit = async (path, { method = 'GET', headers = {}, socket = true, host = '127.0.0.1:3080', body } = {}) => {
  const out = { status: 0, body: '', headers: {}, writeHead(s, h) { this.status = s; this.headers = h ?? {} }, end(b) { this.body = b === undefined ? '' : String(b) } }
  const req = { method, url: path, headers: { host, ...headers }, socket: socket ? { localPort: 3080 } : undefined, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) } }
  await routes.get(path.split('?')[0])(req, out)
  let json = null
  try { json = JSON.parse(out.body) } catch (e) { /* not JSON */ }
  return { status: out.status, json, headers: out.headers }
}

// a plugin as DSH's plugin manager leaves it in the profile, and a point the owner (here: the test) defines through the seam
const profile = join(dsh, 'profiles', 'web')
const dir = join(profile, 'node_modules', 'kybernos-plugin-vet')
mkdirSync(join(dir, 'domains'), { recursive: true })
writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'kybernos-plugin-vet': '1.0.0' }, dsh: { profile: { bundles: ['kybernos-plugin-vet'] } } }))
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'kybernos-plugin-vet', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
  contract: 1, id: 'acme/vet', kind: 'data', version: '0.1.0', name: { en: 'Vet' }, description: { en: 'A pack.' }, author: { id: 'acme', name: 'Acme' }, license: 'MIT', pricing: 'free',
  requires: { kybernos: '>=0.1.0', plugins: { 'kybernos/core': '^1.0' } }, extends: [{ point: 'kybernos/core#domain-pack', range: '^1.0', dir: 'domains' }]
}))
writeFileSync(join(dir, 'domains', 'vet.json'), JSON.stringify({ id: 'vet' }))
globalThis[SEAM].definePoint({ owner: 'kybernos/core', ownerVersion: '1.0.0', name: 'domain-pack', version: '1.0', kind: 'data', class: 'instruction', validate: (raw, id) => (raw.id === id ? { ok: true, value: raw } : { ok: false, errors: ['id'] }) })

const state = await hit('/kybernos-registry/state')
check('state: the plugin DSH installed is listed, waiting for the person\'s acceptance, with its point', state.status === 200 && state.json.ok === true && state.json.plugins.length === 1 && state.json.plugins[0].id === 'acme/vet' && state.json.plugins[0].status === 'needs-consent' && state.json.points[0].id === 'kybernos/core#domain-pack', state.json)
check('state: the answer is not cached by the browser', state.headers['cache-control'] === 'no-store', state.headers)
globalThis[SEAM].setConsent('acme/vet', true)
const contrib = await hit('/kybernos-registry/contributions?point=' + encodeURIComponent('kybernos/core#domain-pack'))
check('contributions: what the accepted plugin gives the point', contrib.status === 200 && contrib.json.contributions.length === 1 && contrib.json.contributions[0].value.id === 'vet', contrib.json)
check('contributions: a point must be owner/name#point', (await hit('/kybernos-registry/contributions?point=x')).status === 400 && (await hit('/kybernos-registry/contributions')).status === 400)
check('the wrong method is 405', (await hit('/kybernos-registry/state', { method: 'POST' })).status === 405 && (await hit('/kybernos-registry/consent', { method: 'GET' })).status === 405)
check('a read from a foreign Origin is refused', (await hit('/kybernos-registry/state', { headers: { origin: 'http://evil.example' } })).status === 403)
check('a read under a foreign Host (a rebound page) is refused, with or without an Origin', (await hit('/kybernos-registry/state', { host: 'attacker.example:3080' })).status === 403 && (await hit('/kybernos-registry/state', { host: 'attacker.example:3080', headers: { origin: 'http://attacker.example:3080' } })).status === 403)
check('a read with the right Origin and no cookie is fine (reads need none)', (await hit('/kybernos-registry/state', { headers: { origin: 'http://127.0.0.1:3080' } })).status === 200)
check('the person\'s own HOME was never touched', readdirSync(decoy).length === 0, readdirSync(decoy))
check('what was left out is said on the console, with the reason', (() => { writeFileSync(join(dir, 'domains', 'x.json'), '{ nope'); globalThis[SEAM].refresh(); globalThis[SEAM].plugins(); return warnings.some((w) => /x\.json: is not valid JSON/.test(w)) })())

check('apply never throws, even when the context fails', (() => { try { mod.apply({ get: () => { throw new Error('boom') }, inject: () => {}, effect: () => {} }); return true } catch (e) { return false } })())
check('apply without a web server waits for it', (() => { let cb = null; mod.apply({ get: () => undefined, inject: (_l, fn) => { cb = fn }, effect: (fn) => { void fn() } }); return typeof cb === 'function' })())

console.log(failed === 0 ? '\nHOST OK' : '\nHOST: ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
