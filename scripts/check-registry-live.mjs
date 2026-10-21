// Live check of the plugin registry on a REAL `dsh web`: the sandbox instance only (never the person's own DSH).
//
//   scripts/sandbox/setup.sh && scripts/sandbox/start.sh && source scripts/sandbox/env.sh && node scripts/check-registry-live.mjs
//
// What it proves, over HTTP, against the running DSH: the registry's routes answer; the core tells it its point; a local plugin dropped into the sandbox's
// plugin folder shows up OFF and its pack is NOT offered; a broken plugin is listed invalid and DSH carries on; switching the plugin on needs the signed session
// (no cookie 401, foreign Origin 403); with it the pack appears in /kybernos/domains with `from`; switching it off takes it away. It removes what it made.
// It touches only the sandbox's DSH_HOME and refuses to run against anything else.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lireSecretSession } from '../packages/kybernos-registry/session-guard.mjs'
import { sessionCookie } from '../packages/kybernos-registry/lib-session-test.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME
const HOST = process.env.KB_HOST
const refuse = (why) => { console.error('check-registry-live: ' + why); process.exit(2) }
if (!DSH_HOME || !HOST) refuse('source scripts/sandbox/env.sh first (DSH_HOME and KB_HOST name the sandbox)')
const realDsh = join(process.env.KB_REAL_HOME || homedir(), '.dsh')
if (resolve(DSH_HOME) === resolve(realDsh)) refuse('DSH_HOME is the real ~/.dsh; this check runs on the sandbox only')
if (/:3080$/.test(HOST)) refuse('KB_HOST is the real DSH port')

let failed = 0
const check = (name, ok, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!ok) failed += 1 }
const base = 'http://' + HOST
const secretOf = () => lireSecretSession(DSH_HOME)
const get = async (path, headers = {}) => { const r = await fetch(base + path, { headers: { accept: 'application/json', ...headers } }); let json = null; try { json = await r.json() } catch (e) { /* not JSON */ } return { status: r.status, json } }
const post = async (path, body, headers = {}) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); let json = null; try { json = await r.json() } catch (e) { /* not JSON */ } return { status: r.status, json } }

const root = join(DSH_HOME, 'kybernos', 'plugins', 'local')
const VET = 'live-check-vet'
const BROKEN = 'live-check-broken'
const cleanup = () => { rmSync(join(root, VET), { recursive: true, force: true }); rmSync(join(root, BROKEN), { recursive: true, force: true }) }

console.log('the registry answers, and the core has told it its point')
const first = await get('/kybernos-registry/state')
check('GET /kybernos-registry/state is 200, version 1', first.status === 200 && first.json?.ok === true && first.json.version === 1, first)
const shippedDomains = await get('/kybernos/domains')
check('GET /kybernos/domains answers the shipped packs', shippedDomains.status === 200 && shippedDomains.json?.ok === true && shippedDomains.json.packs.length >= 9, shippedDomains.status)
const N = shippedDomains.json?.packs.length ?? 0
const afterAsk = await get('/kybernos-registry/state')
check('the point kybernos/core#domain-pack is defined, instruction data', afterAsk.json?.points.some((p) => p.id === 'kybernos/core#domain-pack' && p.class === 'instruction' && p.version === '1.0'), afterAsk.json?.points)

console.log('a local plugin is dropped in')
cleanup()
const edu = JSON.parse(readFileSync(join(REPO, 'packages', 'kybernos-plugin', 'domains', 'edu.json'), 'utf8'))
const manifest = (id) => ({
  contract: 1, id: 'local/' + id, kind: 'data', version: '0.1.0', name: { en: 'Live check vet' }, description: { en: 'A pack made by the live check.' },
  author: { id: 'local', name: 'live check' }, license: 'MIT', pricing: 'free',
  requires: { kybernos: '>=0.1.0', plugins: { 'kybernos/core': '^1.0' } }, extends: [{ point: 'kybernos/core#domain-pack', range: '^1.0', dir: 'domains' }]
})
mkdirSync(join(root, VET, 'domains'), { recursive: true })
writeFileSync(join(root, VET, 'plugin.json'), JSON.stringify(manifest(VET)))
writeFileSync(join(root, VET, 'domains', 'vetcheck.json'), JSON.stringify({ ...edu, id: 'vetcheck', legacyJobs: [], order: 5 }))
writeFileSync(join(root, VET, 'domains', 'bad.json'), JSON.stringify({ ...edu, id: 'bad', legacyJobs: [], cron: '* * * * *' }))
mkdirSync(join(root, BROKEN), { recursive: true })
writeFileSync(join(root, BROKEN, 'plugin.json'), '{ this is not json')
await new Promise((r) => setTimeout(r, 2300)) // the registry reuses a scan for 2 s
const listed = await get('/kybernos-registry/state')
const vet = listed.json?.plugins.find((p) => p.id === 'local/' + VET)
const broken = listed.json?.plugins.find((p) => p.id === 'local/' + BROKEN)
check('the plugin is listed, off, local', vet?.status === 'disabled' && vet.enabled === false && vet.level === 'local', vet)
check('the broken one is listed as invalid, with the reason', broken?.status === 'invalid' && /not valid JSON/.test(broken.errors.join()), broken)
check('DSH carries on: its pages still answer with a broken plugin in the folder', (await get('/kybernos/domains')).status === 200)
check('while it is off its pack is not offered', (await get('/kybernos/domains')).json.packs.length === N)

console.log('switching it on needs the signed session')
const secret = secretOf()
check('the sandbox has a browser-session secret to sign with', secret !== null)
const origin = 'http://' + HOST
const body = { id: 'local/' + VET, enabled: true }
check('no header at all: 403', (await post('/kybernos-registry/enable', body)).status === 403)
check('the right Origin and no cookie: 401', (await post('/kybernos-registry/enable', body, { origin })).status === 401)
check('a foreign Origin, even with the real cookie: 403', (await post('/kybernos-registry/enable', body, { origin: 'http://evil.example', cookie: sessionCookie(HOST, { secret }) })).status === 403)
check('a forged cookie: 401', (await post('/kybernos-registry/enable', body, { origin, cookie: sessionCookie(HOST, { secret: Buffer.alloc(32, 7) }) })).status === 401)
check('nothing changed after the refusals', (await get('/kybernos/domains')).json.packs.length === N)
const on = await post('/kybernos-registry/enable', body, { origin, cookie: sessionCookie(HOST, { secret }) })
check('the right Origin and the real cookie: 200, the plugin is ok', on.status === 200 && on.json?.plugin?.status === 'ok', on)
const withPack = await get('/kybernos/domains')
const pack = withPack.json.packs.find((p) => p.id === 'vetcheck')
check('its pack is now offered by the onboarding\'s own route, from the plugin', withPack.json.packs.length === N + 1 && pack?.from === 'local/' + VET && pack.order >= 50, pack?.from)
const rej = (await get('/kybernos-registry/state')).json.plugins.find((p) => p.id === 'local/' + VET)
check('the file that failed the pack check is listed with its reason', rej?.extends[0].rejected.some((r) => r.file === 'bad.json' && /cron/.test(r.errors.join())), rej?.extends)
check('the shipped packs are untouched and first', withPack.json.packs.slice(0, 1).every((p) => p.from === undefined))
const contrib = await get('/kybernos-registry/contributions?point=' + encodeURIComponent('kybernos/core#domain-pack'))
check('/kybernos-registry/contributions gives the same pack', contrib.json?.contributions.length === 1 && contrib.json.contributions[0].value.id === 'vetcheck', contrib.json?.contributions?.length)
check('the page can read it too: the registry state is the same through the browser\'s own fetch', (await get('/kybernos-registry/state', { origin })).status === 200)

console.log('off again, and cleaned up')
const off = await post('/kybernos-registry/enable', { id: 'local/' + VET, enabled: false }, { origin, cookie: sessionCookie(HOST, { secret }) })
check('switched off: 200', off.status === 200 && off.json?.plugin?.status === 'disabled', off)
check('its pack is gone from the onboarding\'s list', (await get('/kybernos/domains')).json.packs.length === N)
cleanup()
const stateFile = join(DSH_HOME, 'kybernos', 'plugins-state.json')
if (existsSync(stateFile)) { const s = JSON.parse(readFileSync(stateFile, 'utf8')); delete s.enabled['local/' + VET]; writeFileSync(stateFile, JSON.stringify(s, null, 2) + '\n') }
await new Promise((r) => setTimeout(r, 2300))
check('the folders are gone and the list is as at the start', (await get('/kybernos-registry/state')).json.plugins.filter((p) => p.id.startsWith('local/live-check')).length === 0)

console.log(failed === 0 ? '\nREGISTRY LIVE OK' : '\nREGISTRY LIVE: ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
