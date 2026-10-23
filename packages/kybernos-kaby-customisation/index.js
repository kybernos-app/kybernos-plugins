// kybernos-kaby-customisation — host half.
//
// Settings › Kaby: what the person decides about their assistant (name, portrait, voice, the face of its video calls). The logic and
// the routes live in kaby-host.mjs (played without DSH); this file only plugs in the real I/O, one folder of the DSH home:
//   <DSH home>/kybernos/kybernos-kaby-customisation/   profile.json, portrait.bin, voice-sample.bin   (mode 0600)
// and publishes the profile to the other bundles of this process under Symbol.for('kybernos.kabyProfile') (a function returning the
// current public profile), the way the core publishes its trusted-authority predicate: no bundle imports another.
//
// Everything in apply() is guarded: an error here must never stop DSH from starting.
// No @deepseek-ai/* import (an @local/… plugin does not resolve them).

import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createStore, monterKaby, publicProfile } from './kaby-host.mjs'

export const name = 'kybernos-kaby-customisation'
export const PUBLISHED = Symbol.for('kybernos.kabyProfile')

/** The folder this plugin owns, under the DSH home. */
export const folderOf = (env = process.env, home = homedir()) => join(env.DSH_HOME || join(home, '.dsh'), 'kybernos', name)

/** One folder of named files: written whole (temporary file, then rename) and readable by this user only. */
export function folderIo (dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = (file) => join(dir, file)
  return {
    read: (file) => { try { return readFileSync(path(file)) } catch (e) { return null } },
    write: (file, bytes) => {
      const tmp = path(file + '.' + process.pid + '.tmp')
      writeFileSync(tmp, bytes, { mode: 0o600 })
      try { chmodSync(tmp, 0o600) } catch (e) { /* not every file system has modes */ }
      renameSync(tmp, path(file))
    },
    remove: (file) => { try { rmSync(path(file), { force: true }) } catch (e) { /* already gone */ } },
    now: () => new Date().toISOString()
  }
}

export function apply (ctx) {
  try {
    const io = folderIo(folderOf())
    let current = publicProfile(createStore(io).read())
    ctx.effect(() => {
      globalThis[PUBLISHED] = () => current
      return () => { if (globalThis[PUBLISHED] !== undefined) delete globalThis[PUBLISHED] }
    }, name + ': publish the profile')
    const mount = (webServer) => {
      ctx.effect(() => monterKaby(webServer, io, (profile) => { current = profile }).dispose, name + ': routes')
    }
    if (ctx.get('webServer') !== undefined) mount(ctx.get('webServer'))
    else ctx.inject(['webServer'], (host) => mount(host.webServer))
  } catch (e) {
    console.log('[' + name + '] disabled: ' + String(e?.message ?? e))
  }
}
