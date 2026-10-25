// Start-up shims for an embedded Node on a phone. Imported by bootstrap.mjs before the engine starts.
//  1. `node-addon-require-builtin` (a native add-on that reaches Node's internal modules) is replaced by a loader that asks Node itself; the host starts Node with --expose-internals.
//  2. hooks.mjs swaps the other native entry points (see there).
//  3. KYBERNOS_DENY_SPAWN=1 makes process creation fail the way iOS does, to rehearse a phone on a Mac or in the iOS simulator (which, unlike a device, lets processes run).
import Module, { register, syncBuiltinESMExports } from 'node:module'
import cp from 'node:child_process'
import { PassThrough } from 'node:stream'

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'node-addon-require-builtin') {
    const api = {
      requireBuiltin: (id) => originalLoad.call(Module, id, parent, false),
      isAllowedInternalId: () => true,
      getBindingInfo: () => ({ stub: true }),
    }
    return { __esModule: true, ...api, default: api }
  }
  return originalLoad.apply(this, arguments)
}
register('./hooks.mjs', import.meta.url)

if (process.env.KYBERNOS_DENY_SPAWN === '1') {
  const eperm = (fn) => Object.assign(new Error(`${fn} EPERM: process creation is not permitted (rehearsing a phone)`), { code: 'EPERM', errno: -1, syscall: 'spawn' })
  cp.spawnSync = () => ({ status: null, signal: null, output: null, pid: 0, stdout: null, stderr: null, error: eperm('spawnSync') })
  for (const fn of ['execSync', 'execFileSync']) cp[fn] = () => { throw eperm(fn) }
  const fake = (fn, a) => {
    const c = new cp.ChildProcess()
    c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.stderr = new PassThrough()
    const cb = typeof a[a.length - 1] === 'function' ? a[a.length - 1] : null
    process.nextTick(() => { const e = eperm(fn); if (cb) cb(e, '', ''); else c.emit('error', e); c.emit('close', -1, null) })
    return c
  }
  for (const fn of ['spawn', 'fork', 'exec', 'execFile']) cp[fn] = (...a) => fake(fn, a)
  syncBuiltinESMExports()
}
