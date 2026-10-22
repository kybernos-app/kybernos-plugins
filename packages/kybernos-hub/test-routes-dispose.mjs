// The hub's routes come off with the plugin.
//
// `monterRoutes` and `monterSuite` registered their routes inside a `liens.effect(...)` but threw away what `register` returns, so the host had
// nothing to call when the plugin unloaded: a reload of the bundle then met « duplicate exact route » and the second copy never mounted (same
// defect as L4-05 on kybernos-multi-device, noticed there). The effect now gives the host a function that removes every route it added.
//
//   node packages/kybernos-hub/test-routes-dispose.mjs
import assert from 'node:assert/strict'
import { monterRoutes, monterSuite } from './hub-host.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// A host that refuses a path twice, like DSH's web server, and hands back the way to remove each route.
const host = () => {
  const mounted = new Set()
  return {
    mounted,
    register: (route) => {
      if (mounted.has(route.path)) throw new Error('duplicate exact route ' + route.path)
      mounted.add(route.path)
      return () => { mounted.delete(route.path) }
    }
  }
}
// The effect the plugin context offers: run the function now, keep what it returns for the unload.
const liens = () => { const off = []; return { off, effect: (fn) => { const r = fn(); if (typeof r === 'function') off.push(r); return r } } }

const hub = { etat: () => ({ ok: true }), balise: () => ({ statut: 200, corps: { ok: true } }) }
const deps = { catalogue: { modules: [] }, hub, lireActivation: () => null, ecrireActivation: () => {}, relancer: async () => ({ ok: true }), executer: async () => ({}), zoneMoteur: () => ({}), hebergement: () => ({ heberge: false, raison: null }) }

for (const [name, monter, expected] of [
  ['monterRoutes', (h, l) => monterRoutes(h, hub, l), 2],
  ['monterSuite', (h, l) => monterSuite(h, deps, l), 7]
]) {
  const h = host()
  const l = liens()
  monter(h, l)
  assert.equal(h.mounted.size, expected, name + ' mounts its ' + expected + ' routes')
  assert.equal(l.off.length, 1, name + ' hands the host ONE way to take them off')
  l.off[0]()
  assert.equal(h.mounted.size, 0, name + ': unloading removes every route it added')
  // The reload: mounting again works (it threw « duplicate exact route » when nothing had been removed).
  const l2 = liens()
  monter(h, l2)
  assert.equal(h.mounted.size, expected, name + ' mounts again after an unload')
  ok(name + ': ' + expected + ' routes mounted, removed on unload, mounted again on a reload')
}

// A host with no effect service and a register that returns nothing still mounts (the plugin must never stop DSH from starting).
const bare = new Set()
monterRoutes({ register: (r) => { bare.add(r.path) } }, hub)
assert.equal(bare.size, 2)
ok('with no effect service and a register that returns nothing, the routes still mount')
console.log('\nHUB ROUTES DISPOSE — ' + pass + ' check(s), 0 échec')
