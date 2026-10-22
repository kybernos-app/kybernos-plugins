// The host half, without DSH and without a disk: the name rules, where "Documents" is, the private-folder creation
// (traversal, existing folder, permissions), and the routes' guards (method, origin, content type, body).
import { createPrivateFolder, display, documentsDir, monterRoutes, NAME_MAX, rootOf, validName } from './multi-device-host.mjs'
import { apply, name } from './index.js'
import { join } from 'node:path'

let fail = 0
const ok = (label, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + label + (cond ? '' : '  ' + (detail || ''))); if (!cond) fail++ }

// ── names ────────────────────────────────────────────────────────────────────
ok('a plain name is kept', validName('Notes TVA').name === 'Notes TVA')
ok('accents and spaces are fine', validName('  Veille   et idées ').name === 'Veille et idées')
ok('empty is refused', validName('   ').reason === 'empty' && validName('').reason === 'empty' && validName(null).reason === 'empty' && validName(12).reason === 'empty')
for (const bad of ['a/b', 'a\\b', '../x', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b', 'x\u0000y', 'x\ny']) {
  ok('refused: ' + JSON.stringify(bad), validName(bad).ok === false)
}
ok('dots at the ends are refused', validName('.hidden').reason === 'dots' && validName('name.').reason === 'dots' && validName('..').reason === 'dots')
ok('Windows reserved names are refused', validName('CON').reason === 'reserved' && validName('nul.txt').reason === 'reserved' && validName('LPT1').reason === 'reserved')
ok('too long is refused', validName('x'.repeat(NAME_MAX + 1)).reason === 'too-long' && validName('x'.repeat(NAME_MAX)).ok === true)

// ── where Documents is ────────────────────────────────────────────────────────
const home = '/home/someone'
ok('Documents under home on macOS', documentsDir({ platform: 'darwin', home, env: {} }) === join(home, 'Documents'))
ok('the override wins when absolute', documentsDir({ platform: 'darwin', home, env: { KYBERNOS_DOCUMENTS_DIR: '/data/docs' } }) === '/data/docs')
ok('a relative override is ignored', documentsDir({ platform: 'darwin', home, env: { KYBERNOS_DOCUMENTS_DIR: 'docs' } }) === join(home, 'Documents'))
ok('Linux: xdg answer is used', documentsDir({ platform: 'linux', home, env: {}, xdgDocuments: () => '/mnt/docs' }) === '/mnt/docs')
ok('Linux: xdg answering $HOME is not Documents', documentsDir({ platform: 'linux', home, env: {}, xdgDocuments: () => home }) === join(home, 'Documents'))
ok('Linux: a failing xdg falls back', documentsDir({ platform: 'linux', home, env: {}, xdgDocuments: () => { throw new Error('no xdg') } }) === join(home, 'Documents'))
ok('the root is <Documents>/Kybernos', rootOf('/d') === join('/d', 'Kybernos'))
ok('display abbreviates home', display(join(home, 'Documents', 'Kybernos'), home) === '~/Documents/Kybernos' && display('/mnt/x', home) === '/mnt/x')

// ── creation ──────────────────────────────────────────────────────────────────
const made = []
const fs = (existing = [], code = null) => ({ mkdir: (p) => { if (code !== null) { const e = new Error(code); e.code = code; throw e } if (existing.includes(p)) { const e = new Error('exists'); e.code = 'EEXIST'; throw e } made.push(p) } })
{
  const out = createPrivateFolder({ name: 'Notes TVA', documents: '/d', io: fs() })
  ok('creates under the root', out.status === 200 && out.body.path === join('/d', 'Kybernos', 'Notes TVA') && out.body.name === 'Notes TVA')
  ok('the root is made first, then the leaf (leaf not recursive)', made[0] === join('/d', 'Kybernos') && made[1] === join('/d', 'Kybernos', 'Notes TVA'))
}
{
  const out = createPrivateFolder({ name: 'Déjà', documents: '/d', io: fs([join('/d', 'Kybernos', 'Déjà')]) })
  ok('an existing folder is reported, never reused', out.status === 409 && out.body.error === 'exists')
}
ok('permission denied is a 403', createPrivateFolder({ name: 'x', documents: '/d', io: fs([], 'EACCES') }).status === 403)
ok('an unknown disk error is a 500 that leaks nothing', (() => { const o = createPrivateFolder({ name: 'x', documents: '/d', io: fs([], 'EIO') }); return o.status === 500 && JSON.stringify(o.body) === '{"ok":false,"error":"mkdir-failed"}' })())
{
  const before = made.length
  const out = createPrivateFolder({ name: '../../etc', documents: '/d', io: fs() })
  ok('traversal never reaches the disk', out.status === 400 && made.length === before)
}

// ── routes ────────────────────────────────────────────────────────────────────
const routes = []
const service = { register: (r) => { routes.push(r); return () => {} } }
const disk = []
monterRoutes(service, { documents: () => '/d', home: () => '/home/x', mkdir: (p) => { disk.push(p) } })
const get = (path) => routes.find((r) => r.path === path)
ok('two routes are registered', routes.length === 2 && get('/kybernos-multi-device/status') !== undefined && get('/kybernos-multi-device/private-folder') !== undefined)

const call = async (route, { method = 'GET', headers = {}, body, port = 3080 } = {}) => {
  let status = 0
  let payload = ''
  const res = { writeHead (s) { status = s }, end (p) { payload = String(p ?? '') } }
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
  const req = { method, headers, socket: { localPort: port }, [Symbol.asyncIterator]: async function * () { for (const c of chunks) yield c } }
  await route.handler(req, res)
  let json = null
  try { json = JSON.parse(payload) } catch (e) { /* not json */ }
  return { status, json }
}
const sameOrigin = { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', 'content-type': 'application/json' }
{
  const r = await call(get('/kybernos-multi-device/status'), { headers: { host: '127.0.0.1:3080' } })
  ok('status: GET without Origin is answered', r.status === 200 && r.json.ok === true && r.json.root === join('/d', 'Kybernos') && r.json.version === 1)
  ok('status: POST is refused', (await call(get('/kybernos-multi-device/status'), { method: 'POST', headers: sameOrigin })).status === 405)
  ok('status: a foreign Host is refused (DNS rebinding)', (await call(get('/kybernos-multi-device/status'), { headers: { host: 'attacker.example:3080' } })).status === 403)
}
{
  const route = get('/kybernos-multi-device/private-folder')
  ok('create: GET is refused', (await call(route, { headers: sameOrigin })).status === 405)
  ok('create: no Origin is refused', (await call(route, { method: 'POST', headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' }, body: { name: 'x' } })).status === 403)
  ok('create: a foreign Origin is refused', (await call(route, { method: 'POST', headers: { ...sameOrigin, origin: 'https://evil.example' }, body: { name: 'x' } })).status === 403)
  ok('create: Host = Origin = attacker is refused', (await call(route, { method: 'POST', headers: { host: 'attacker.example:3080', origin: 'http://attacker.example:3080', 'content-type': 'application/json' }, body: { name: 'x' } })).status === 403)
  ok('create: not JSON is refused', (await call(route, { method: 'POST', headers: { ...sameOrigin, 'content-type': 'text/plain' }, body: '{"name":"x"}' })).status === 415)
  ok('create: a broken body is a 400', (await call(route, { method: 'POST', headers: sameOrigin, body: '{nope' })).status === 400)
  ok('create: an oversized body is a 400', (await call(route, { method: 'POST', headers: sameOrigin, body: { name: 'x'.repeat(5000) } })).status === 400)
  disk.length = 0
  const good = await call(route, { method: 'POST', headers: sameOrigin, body: { name: 'Veille' } })
  ok('create: same origin + JSON + valid name creates the folder', good.status === 200 && good.json.path === join('/d', 'Kybernos', 'Veille') && good.json.display === '/d/Kybernos/Veille' && disk.length === 2)
  const bad = await call(route, { method: 'POST', headers: sameOrigin, body: { name: '../x' } })
  ok('create: a bad name is a 400 with a reason', bad.status === 400 && bad.json.reason === 'forbidden-char')
}

// ── L4-05: the routes live and die with the plugin (they go through the lifecycle effect) ──────────────────────
{
  const removed = []
  const svc = { register: (r) => { removed.push({ path: r.path, off: false }); const entry = removed[removed.length - 1]; return () => { entry.off = true } } }
  const deps = { documents: () => '/d', home: () => '/home/x', mkdir: () => {} }
  // without an effect link: routes are registered at once and the disposer is still handed back
  const plain = monterRoutes(svc, deps)
  ok('without an effect link the routes are registered at once, and the way to remove them is returned', removed.length === 2 && typeof plain === 'function')
  plain()
  ok('...and calling it removes both routes', removed.every((e) => e.off === true))

  removed.length = 0
  const effects = []
  const out = monterRoutes(svc, deps, { effect: (fn, label) => { effects.push({ fn, label }); return 'handled' } })
  ok('with an effect link the registration is handed to it, with a label, and not run behind its back', effects.length === 1 && typeof effects[0].label === 'string' && /kybernos-multi-device/.test(effects[0].label) && removed.length === 0 && out === 'handled')
  const dispose = effects[0].fn()
  ok('the effect callback registers both routes and returns what removes them', removed.length === 2 && typeof dispose === 'function')
  dispose()
  ok('disposing the effect removes both routes (a bundle reload leaves no old handler behind)', removed.every((e) => e.off === true))
  ok('a service whose register returns nothing does not break the disposer', (() => { try { monterRoutes({ register: () => undefined }, deps)(); return true } catch (e) { return false } })())

  // through the bundle's own apply(): the routes are registered by ctx.effect, and what it returns removes them
  const offs = []
  const applied = []
  const ctx = {
    get: (n) => (n === 'webServer' ? { register: (r) => { applied.push(r.path); return () => { offs.push(r.path) } } } : undefined),
    effect: (fn, label) => { ctx.effects.push(label); const dispose = fn(); ctx.disposers.push(dispose); return dispose },
    effects: [], disposers: [],
  }
  apply(ctx)
  ok('apply registers the routes through ctx.effect', ctx.effects.length === 1 && applied.length === 2)
  ctx.disposers[0]()
  ok('apply: disposing that effect removes both routes', offs.length === 2 && offs.includes('/kybernos-multi-device/status') && offs.includes('/kybernos-multi-device/private-folder'))
}

{
  const seen = []
  apply({ get: (n) => (n === 'webServer' ? { register: (r) => { seen.push(r.path); return () => {} } } : undefined) })
  ok('apply on a host without ctx.effect still mounts both routes', seen.length === 2)
}

// ── apply never throws ────────────────────────────────────────────────────────
ok('the bundle has its name', name === 'kybernos-multi-device')
ok('apply survives a context without services', (() => { try { apply({ get: () => undefined, inject: () => { throw new Error('no service') } }); return true } catch (e) { return false } })())
ok('apply survives a null context', (() => { try { apply(null); return true } catch (e) { return false } })())

process.exit(fail ? 1 : 0)
