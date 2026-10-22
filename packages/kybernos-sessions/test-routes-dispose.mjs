// The Sessions routes come off with the plugin (audit L6-04).
//
// `monterRoutes` registered its 14 routes bare: nothing was handed to the host to remove them, so a bundle switched off kept serving routes that run git and rm, and
// a rebuilt web server met « duplicate exact route » on the second pass (the throw landed outside the try/catch of apply). `apply` now mounts them inside
// `ctx.effect`, and `monterRoutes` gives back the function that removes every route it added.
//
//   node packages/kybernos-sessions/test-routes-dispose.mjs
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monterRoutes, apply } from './index.js'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const racine = mkdtempSync(join(tmpdir(), 'kb-sessions-dispose-'))
process.env.DSH_HOME = racine
const opts = () => ({ reglagesPath: join(racine, 'settings.json'), categoriesPath: join(racine, 'categories.json'), sessionsHome: join(racine, 'sessions'), kybersHome: join(racine, 'kybers') })

// A host that refuses a path twice, like DSH's web server, and hands back the way to remove each route.
const host = () => {
  const mounted = new Set()
  return {
    mounted,
    register: (route) => {
      if (mounted.has(route.path)) throw new Error('duplicate exact route ' + route.path)
      mounted.add(route.path)
      return () => { mounted.delete(route.path) }
    },
  }
}

const h = host()
const off = monterRoutes(h, opts())
assert.equal(h.mounted.size, 14, 'the 14 routes are mounted: ' + [...h.mounted].join(' '))
assert.equal(typeof off, 'function', 'monterRoutes gives back the way to take them off')
off()
assert.equal(h.mounted.size, 0, 'taking them off removes every route it added')
monterRoutes(h, opts())
assert.equal(h.mounted.size, 14, 'and mounting again works (it threw « duplicate exact route » when nothing had been removed)')
ok('14 routes mounted, removed by the function monterRoutes returns, mounted again')

// apply(): the routes go through ctx.effect, and the host unloading the plugin removes them.
{
  const h2 = host()
  const disposers = []
  const ctx = {
    get: (name) => (name === 'webServer' ? h2 : undefined),
    webServer: h2,
    effect: (fn) => { const r = fn(); if (typeof r === 'function') disposers.push(r); return r },
    inject: (_names, cb) => cb(ctx),
  }
  apply(ctx)
  assert.equal(h2.mounted.size, 14, 'apply mounts the routes')
  assert.equal(disposers.length, 1, 'inside ONE effect the host can dispose')
  disposers[0]()
  assert.equal(h2.mounted.size, 0, 'unloading the plugin removes the routes')
  ok('apply mounts the routes inside ctx.effect; unloading removes them')
}

// A host with no effect service and a register that returns nothing still mounts: the plugin must never stop DSH from starting.
{
  const bare = new Set()
  const svc = { register: (r) => { bare.add(r.path) } }
  const ctx = { get: () => svc, webServer: svc, inject: () => {} }
  apply(ctx)
  assert.equal(bare.size, 14)
  ok('with no effect service and a register that returns nothing, the routes still mount')
}
console.log('\nSESSIONS ROUTES DISPOSE — ' + pass + ' check(s), 0 échec')
process.exit(0)
