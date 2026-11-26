// Live check of the plugin registry on a REAL `dsh web`, with DSH's OWN plugin manager doing the install: the sandbox instance only, never the person's DSH.
//
//   scripts/sandbox/setup.sh && scripts/sandbox/start.sh && source scripts/sandbox/env.sh && node scripts/check-registry-live.mjs
//
// What it proves, against the running DSH: the registry's routes answer; the core has told it its point; a data plugin installed by `dsh plugin add` (the manager
// the Plugins page and the `plugin_manager` tool share; an empty patch, so DSH loads no code) is read from the profile and waits for the
// person's acceptance, and its pack is NOT offered; accepting needs the signed session (no cookie 401, foreign Origin 403); once accepted the pack appears in
// /kybernos/domains with `from`; `dsh plugin remove` takes it away. It removes what it made.
//
// It touches only the sandbox's DSH_HOME and refuses to run against anything else. `dsh plugin add` runs pnpm, which keeps one store per HOME: the command is run
// with the real HOME (so the store matches the one the profile was cloned from) and the sandbox's DSH_HOME (so the profile is the sandbox's). pnpm may add the
// demo package to that store (a content-addressed cache) and rewrite some links of the sandbox profile: run scripts/sandbox/setup.sh afterwards.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lireSecretSession } from '../packages/kybernos-registry/session-guard.mjs'
import { sessionCookie } from '../packages/kybernos-registry/lib-session-test.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME
const HOST = process.env.KB_HOST
const refuse = (why) => { console.error('check-registry-live: ' + why); process.exit(2) }
if (!DSH_HOME || !HOST) refuse('source scripts/sandbox/env.sh first (DSH_HOME and KB_HOST name the sandbox)')
const realHome = process.env.KB_REAL_HOME || homedir()
if (resolve(DSH_HOME) === resolve(join(realHome, '.dsh'))) refuse('DSH_HOME is the real ~/.dsh; this check runs on the sandbox only')
if (/:3080$/.test(HOST)) refuse('KB_HOST is the real DSH port')

let failed = 0
const check = (name, ok, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!ok) failed += 1 }
const base = 'http://' + HOST
const origin = base
const get = async (path, headers = {}) => { const r = await fetch(base + path, { headers: { accept: 'application/json', ...headers } }); let json = null; try { json = await r.json() } catch (e) { /* not JSON */ } return { status: r.status, json } }
const post = async (path, body, headers = {}) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); let json = null; try { json = await r.json() } catch (e) { /* not JSON */ } return { status: r.status, json } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const PROFILE = join(DSH_HOME, 'profiles', 'web')
const NAME = 'kybernos-plugin-live-check'
const readProfile = () => JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8'))
/** DSH's own manager, the way `dsh plugin` runs it (pnpm in the profile). */
const dsh = (...args) => execFileSync('dsh', ['plugin', '--profile', 'web', ...args], { env: { ...process.env, HOME: realHome, DSH_HOME }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000 })

const pkgDir = mkdtempSync(join(tmpdir(), 'kb-live-check-'))
const cleanup = () => { try { if (NAME in (readProfile().dependencies ?? {})) dsh('remove', NAME) } catch (e) { /* already gone */ } rmSync(pkgDir, { recursive: true, force: true }) }
process.on('exit', () => { rmSync(pkgDir, { recursive: true, force: true }) })

console.log('the registry answers, and the core has told it its point')
const first = await get('/kybernos-registry/state')
check('GET /kybernos-registry/state is 200, version 1', first.status === 200 && first.json?.ok === true && first.json.version === 1, first)
const shippedDomains = await get('/kybernos/domains')
check('GET /kybernos/domains answers the shipped packs', shippedDomains.status === 200 && shippedDomains.json?.ok === true && shippedDomains.json.packs.length >= 9, shippedDomains.status)
const N = shippedDomains.json?.packs.length ?? 0
const afterAsk = await get('/kybernos-registry/state')
check('the point kybernos/core#domain-pack is defined, instruction data', afterAsk.json?.points.some((p) => p.id === 'kybernos/core#domain-pack' && p.class === 'instruction' && p.version === '1.0'), afterAsk.json?.points)
check('nothing of ours is listed as a plugin yet', !afterAsk.json?.plugins.some((p) => p.package === NAME), afterAsk.json?.plugins.map((p) => p.package))

console.log('DSH installs a data plugin with its own manager')
cleanup()
mkdirSync(join(pkgDir, 'domains'), { recursive: true })
const edu = JSON.parse(readFileSync(join(REPO, 'packages', 'kybernos-plugin', 'domains', 'edu.json'), 'utf8'))
writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: NAME, version: '0.1.0', description: 'A data plugin made by the live check. Its patch is empty, so DSH loads no code.', license: 'MIT', dsh: { bundle: { patch: './cordis.patch.yml' } } }, null, 2))
writeFileSync(join(pkgDir, 'cordis.patch.yml'), '# A data plugin: no entry names a module, so no JavaScript is ever loaded.\n[]\n')
writeFileSync(join(pkgDir, 'plugin.json'), JSON.stringify({
  contract: 1, id: 'acme/live-check-vet', kind: 'data', version: '0.1.0', name: { en: 'Live check vet' }, description: { en: 'A pack made by the live check.' },
  author: { id: 'acme', name: 'live check' }, license: 'MIT', pricing: 'free',
  requires: { kybernos: '>=0.1.0', plugins: { 'kybernos/core': '^1.0' } }, extends: [{ point: 'kybernos/core#domain-pack', range: '^1.0', dir: 'domains' }]
}))
writeFileSync(join(pkgDir, 'domains', 'vetcheck.json'), JSON.stringify({ ...edu, id: 'vetcheck', legacyJobs: [], order: 5 }))
writeFileSync(join(pkgDir, 'domains', 'bad.json'), JSON.stringify({ ...edu, id: 'bad', legacyJobs: [], cron: '* * * * *' }))
let out = ''
try { out = dsh('add', 'file:' + pkgDir) } catch (e) { out = String(e.stdout ?? '') + String(e.stderr ?? e.message) }
const profile = readProfile()
check('DSH accepted the package with its empty patch and selected it as a bundle', (profile.dsh?.profile?.bundles ?? []).includes(NAME) && NAME in (profile.dependencies ?? {}), out.slice(-400))
check('it sits in the profile as a real package folder', existsSync(join(PROFILE, 'node_modules', NAME, 'plugin.json')))
await wait(2600)
check('DSH carries on: its pages still answer', (await get('/kybernos/domains')).status === 200)
const listed = await get('/kybernos-registry/state')
const mine = listed.json?.plugins.find((p) => p.id === 'acme/live-check-vet')
check('the registry reads it from the profile: a folder of this computer (file:), so Local; selected; waiting for the person\'s acceptance', mine?.package === NAME && mine.level === 'local' && mine.enabled === true && mine.status === 'needs-consent', mine)
check('it brings instructions, so its pack is not offered yet', (await get('/kybernos/domains')).json.packs.length === N)

console.log('accepting needs the signed session')
const secret = lireSecretSession(DSH_HOME)
check('the sandbox has a browser-session secret to sign with', secret !== null)
const body = { id: 'acme/live-check-vet', accepted: true }
check('no header at all: 403', (await post('/kybernos-registry/consent', body)).status === 403)
check('the right Origin and no cookie: 401', (await post('/kybernos-registry/consent', body, { origin })).status === 401)
check('a foreign Origin, even with the real cookie: 403', (await post('/kybernos-registry/consent', body, { origin: 'http://evil.example', cookie: sessionCookie(HOST, { secret }) })).status === 403)
check('a forged cookie: 401', (await post('/kybernos-registry/consent', body, { origin, cookie: sessionCookie(HOST, { secret: Buffer.alloc(32, 7) }) })).status === 401)
check('nothing changed after the refusals', (await get('/kybernos/domains')).json.packs.length === N)
const on = await post('/kybernos-registry/consent', body, { origin, cookie: sessionCookie(HOST, { secret }) })
check('the right Origin and the real cookie: 200, the plugin is ok', on.status === 200 && on.json?.plugin?.status === 'ok', on)
const withPack = await get('/kybernos/domains')
const pack = withPack.json.packs.find((p) => p.id === 'vetcheck')
check('its pack is now offered by the onboarding\'s own route, marked as coming from the plugin', withPack.json.packs.length === N + 1 && pack?.from === 'acme/live-check-vet' && pack.order >= 50, pack?.from)
const rej = (await get('/kybernos-registry/state')).json.plugins.find((p) => p.id === 'acme/live-check-vet')
check('the file that failed the pack check is listed with its reason', rej?.extends[0].rejected.some((r) => r.file === 'bad.json' && /cron/.test(r.errors.join())), rej?.extends)
check('the shipped packs are untouched and first', withPack.json.packs[0].from === undefined)
const contrib = await get('/kybernos-registry/contributions?point=' + encodeURIComponent('kybernos/core#domain-pack'))
check('/kybernos-registry/contributions gives the same pack', contrib.json?.contributions.length === 1 && contrib.json.contributions[0].value.id === 'vetcheck', contrib.json?.contributions?.length)

console.log('DSH removes it, and the registry follows')
let removed = ''
try { removed = dsh('remove', NAME) } catch (e) { removed = String(e.stdout ?? '') + String(e.stderr ?? e.message) }
const after = readProfile()
check('DSH removed the package and deselected the bundle', !(NAME in (after.dependencies ?? {})) && !(after.dsh?.profile?.bundles ?? []).includes(NAME), removed.slice(-300))
await wait(2600)
check('its pack is gone from the onboarding\'s list and the plugin from the registry', (await get('/kybernos/domains')).json.packs.length === N && !(await get('/kybernos-registry/state')).json.plugins.some((p) => p.package === NAME))
const stateFile = join(DSH_HOME, 'kybernos', 'plugins-state.json')
if (existsSync(stateFile)) { const s = JSON.parse(readFileSync(stateFile, 'utf8')); delete s.consented['acme/live-check-vet']; writeFileSync(stateFile, JSON.stringify(s, null, 2) + '\n') }
cleanup()

console.log(failed === 0 ? '\nREGISTRY LIVE OK' : '\nREGISTRY LIVE: ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
