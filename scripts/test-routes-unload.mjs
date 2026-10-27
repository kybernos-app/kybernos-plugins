// ── The routes of a bundle come off when it is unloaded ────────────────────────────────────────────────────────────
//
// DSH hot-reloads a bundle (a file of the plugin changes, a service is rebuilt) by running its disposers and calling `apply` again. A route is added with
// `webServer.register(route)`, which hands back the way to remove it and THROWS on a path that is already taken (« duplicate exact route »). A bundle that
// registers its routes outside `ctx.effect`, or throws away what `register` returns, leaves the old routes in place: the reload answers with the OLD
// handlers (the new code never serves) and logs « routes not mounted » (audit L4-05, L6-04; sessions, hub and multi-device were fixed one by one).
// Seen again on the real DSH on 2026-10-22: miniapps, slides and motion logged it on a reload.
//
// For every bundle this mounts `apply` on a host that refuses a duplicate path and keeps what is registered, unloads (calls every disposer the bundle gave to
// `ctx.effect`), and checks that the host is EMPTY, then mounts again and checks the same routes come back with no duplicate. No list of exceptions.
//
//   node scripts/test-routes-unload.mjs
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const home = mkdtempSync(join(tmpdir(), 'kb-routes-unload-'))
process.env.HOME = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.USERPROFILE = home
for (const key of ['KYBERNOS_CLOUD_STATE', 'KYBERNOS_SERVERS_FILE']) delete process.env[key]
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:9'
mkdirSync(process.env.DSH_HOME, { recursive: true })

let failed = 0
let checked = 0
const check = (label, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

/** A web server like DSH's: a path can be taken once, `register` gives back the way to remove the route. */
const makeHost = () => {
  const table = new Map()
  const duplicates = []
  const register = (route) => {
    const key = (route.kind || 'exact') + ' ' + route.path
    if (table.has(key)) { duplicates.push(key); throw new Error('duplicate exact route "' + route.path + '"') }
    table.set(key, route)
    return () => { table.delete(key) }
  }
  return { table, duplicates, service: { register, registerRoute: register } }
}

/** One `apply` of the bundle on `host`; resolves the disposers it handed to `ctx.effect`. */
const applyOn = async (apply, host) => {
  const disposers = []
  const services = { webServer: host.service, fs: {} }
  const ctx = new Proxy({
    get: (name) => services[name],
    inject: (_list, cb) => { try { cb(ctx) } catch (e) { /* a service that is not here */ } },
    effect: (fn) => { try { const r = fn(); if (typeof r === 'function') disposers.push(r); return r } catch (e) { return undefined } },
    on: () => {},
    systemPrompt: { context: () => {} },
    tools: { register: () => () => {} },
    config: {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
    webServer: host.service,
  }, { get: (t, k) => (k in t ? t[k] : (() => undefined)) })
  const quiet = console.log; const quietErr = console.error; const quietWarn = console.warn
  console.log = () => {}; console.error = () => {}; console.warn = () => {}
  try { await Promise.race([Promise.resolve(apply(ctx)), new Promise((r) => setTimeout(r, 3000))]) } catch (e) { /* what registered before it threw still counts */ }
  finally { console.log = quiet; console.error = quietErr; console.warn = quietWarn }
  return disposers
}

const packages = readdirSync(join(root, 'packages')).filter((p) => existsSync(join(root, 'packages', p, 'index.js'))).sort()
// Engine-only bundles: they extend engine classes, so they cannot be imported outside an engine profile, and they register no route (kybernos-no-process: kybernos-host/payload/test-boot.mjs boots it for real).
const ENGINE_ONLY = new Set(['kybernos-no-process'])
for (const pkg of packages) {
  if (ENGINE_ONLY.has(pkg)) continue
  let mod
  try { mod = await import(pathToFileURL(join(root, 'packages', pkg, 'index.js')).href) } catch (e) { check(pkg + ': can be imported here', false, String(e.message).slice(0, 100)); continue }
  const apply = typeof mod.apply === 'function' ? mod.apply : (mod.default !== undefined && typeof mod.default.apply === 'function' ? mod.default.apply : null)
  if (apply === null) continue
  const host = makeHost()
  const first = await applyOn(apply, host)
  const mountedFirst = [...host.table.keys()].sort()
  if (mountedFirst.length === 0) continue
  checked += 1
  for (const off of first.slice().reverse()) { try { off() } catch (e) { /* a disposer that throws is the bundle's own problem */ } }
  const left = [...host.table.keys()].sort()
  check(pkg + ': unloading removes its ' + mountedFirst.length + ' route(s)', left.length === 0, left.length + ' still served: ' + left.slice(0, 3).join(', ') + (left.length > 3 ? '…' : ''))
  // The reload: the same routes come back, and no path is refused as a duplicate.
  host.duplicates.length = 0
  await applyOn(apply, host)
  const again = [...host.table.keys()].sort()
  check(pkg + ': a reload mounts the same routes, with no duplicate', host.duplicates.length === 0 && again.length >= mountedFirst.length, host.duplicates.slice(0, 2).join(', '))
}
check('bundles with routes were looked at', checked >= 20, checked)
console.log(failed === 0 ? '\nROUTES UNLOAD — ' + checked + ' bundle(s), 0 échec' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)
