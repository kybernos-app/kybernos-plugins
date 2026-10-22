#!/usr/bin/env node
/** L1-03 (audit 2026-10-20): what the client of kybernos-auto starts, it stops.
 *
 *  The client started two `setInterval` (the composer tick at 300 ms, the mount probe at 5 s) and added a `<style>` tag with nothing to
 *  undo them: the composer tick even ran from the load of the module, before `apply`. Unmounting the plugin, or hot reloading its client,
 *  left every one of them alive — one more tick and one more panel fighting over the model menu at each reload.
 *
 *  This test runs the real client.js in a VM with a fake DOM and a counting clock, mounts it the way DSH does (every `ctx.effect` is
 *  kept, its disposer called on unmount), and checks that after the unmount nothing is left: no timer, no style tag.
 *
 *    node packages/kybernos-auto/test-unmount.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, 'client.js'), 'utf8')

let ok0 = 0
let ko = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + String(detail).slice(0, 200) : '')) }
}

// ── The fake world: a clock that counts, a head that holds tags ──────────────────────────────────────────────────────
const timers = new Map() // id -> { fn, ms }
let nextTimer = 1
const tags = []
const document = {
  createElement: (name) => { const el = { name, dataset: {}, textContent: '', remove () { const i = tags.indexOf(el); if (i >= 0) tags.splice(i, 1) } }; return el },
  head: { append: (el) => { tags.push(el) } },
  querySelectorAll: () => [],
  querySelector: () => null,
  getElementById: () => null,
  body: {},
}
let loaded = null
const window = { __ModuleLoader__: { load: (def) => { loaded = def } }, __KB_LANG_RESOLVE__: () => 'en' }
const sandbox = {
  window,
  document,
  console,
  localStorage: { getItem: () => null },
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true, sessionOn: false, global: false }) }),
  setInterval: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id },
  clearInterval: (id) => { timers.delete(id) },
  setTimeout: () => 0,
  clearTimeout: () => {},
  encodeURIComponent,
}
vm.runInNewContext(source, sandbox, { filename: 'kybernos-auto/client.js' })
ok('the client registers itself with the module loader', loaded !== null && typeof loaded.factory === 'function')
ok('loading the module starts no timer', timers.size === 0, timers.size)

const React = { createElement: (...a) => ({ a }), useState: () => [null, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useReducer: () => [0, () => {}], useMemo: (f) => f(), useCallback: (f) => f, Fragment: 'f' }
const mod = loaded.factory(() => React)
ok('the factory starts no timer either (the composer tick used to start here, with no way to stop it)', timers.size === 0, timers.size)

// ── Mount as DSH does: each ctx.effect is kept with its label, its disposer is called on unmount ─────────────────────
const mount = () => {
  const effects = []
  const slots = { inject: (_name, cb) => cb(), register: () => () => {} }
  const ctx = { slots, effect: (fn, label) => { const dispose = fn(); effects.push({ label, dispose }) } }
  mod.apply(ctx)
  return { effects, unmount: () => { for (const e of effects.slice().reverse()) if (typeof e.dispose === 'function') e.dispose() } }
}

const a = mount()
const labels = a.effects.map((e) => e.label)
for (const want of ['kybernos-auto: styles', 'kybernos-auto: composer tick', 'kybernos-auto: mount state']) {
  ok('apply declares the effect « ' + want + ' »', labels.includes(want), labels.join(' | '))
}
ok('mounted: the composer tick (300 ms) and the mount probe (5 s) are running', [...timers.values()].map((t) => t.ms).sort((x, y) => x - y).join(',') === '300,5000', [...timers.values()].map((t) => t.ms))
ok('mounted: one stylesheet tag is in the head', tags.length === 1 && tags[0].dataset.plugin === '@local/kybernos-auto', tags.length)
// A tick that fires on a page without the menu open must not throw (the real interval would log it every 300 ms).
let threw = null
try { for (const t of timers.values()) t.fn() } catch (e) { threw = e }
ok('both ticks run once on a page with no model menu without throwing', threw === null, threw)

a.unmount()
ok('unmounted: no timer is left running', timers.size === 0, [...timers.values()].map((t) => t.ms))
ok('unmounted: the stylesheet tag is gone', tags.length === 0, tags.length)

// A hot reload is an unmount then a mount: it must not pile up.
const b = mount()
b.unmount()
const c = mount()
ok('after mount, unmount, mount: exactly one set of timers and one tag (no pile-up)', timers.size === 2 && tags.length === 1, timers.size + ' timers, ' + tags.length + ' tags')
c.unmount()
ok('and the last unmount leaves nothing', timers.size === 0 && tags.length === 0)

console.log(ko === 0 ? '\nclient : ' + ok0 + ' vérification(s), 0 échec' : '\nclient : ' + ko + ' échec(s)')
process.exit(ko === 0 ? 0 : 1)
