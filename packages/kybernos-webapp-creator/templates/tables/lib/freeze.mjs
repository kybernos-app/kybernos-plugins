// freeze.mjs — « refuse every write for now », asked by the server that hosts a team space (POST /api/freeze, the owner's API only) for a restore or the instant between an
// Unpublish's last check and the space being given back. The state is a file in the data folder: present means frozen, so a machine that restarts while frozen comes back frozen. A
// file that cannot be written or removed is an error, never a state that holds only until the next restart.
import { renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SAFE_METHODS } from './safety.mjs'

export const FREEZE_FILE = 'frozen.json'
export const FREEZE_PATH = '/api/freeze'

/** Does a request change something? Any method that is not a read, and the one read that does: the owner's link (`/open`) makes a session. */
export const isWrite = (method, path) => !SAFE_METHODS.has(method) || path === '/open'

/** `{ frozen(), set(flag) }` over `<dir>/frozen.json`. `set` answers `{ ok: true, frozen }`, or `{ ok: false, error: 'unsaved' }` with the state unchanged. */
export function makeFreeze ({ dir, now = Date.now, log = () => {} }) {
  const file = join(dir, FREEZE_FILE)
  let frozen = false
  try { statSync(file); frozen = true } catch (e) { /* no file: not frozen */ }
  if (frozen) log('freeze: the app was frozen before it started and stays so')
  return {
    frozen: () => frozen,
    set (next) {
      if (next === frozen) return { ok: true, frozen }
      try {
        if (next) {
          const tmp = file + '.tmp'
          writeFileSync(tmp, JSON.stringify({ frozen: true, at: new Date(now()).toISOString() }) + '\n', { mode: 0o600 })
          renameSync(tmp, file)
        } else rmSync(file, { force: true })
      } catch (e) {
        log('freeze: the state could not be saved (' + String((e && e.code) || 'error').slice(0, 20) + ')')
        return { ok: false, error: 'unsaved' }
      }
      frozen = next
      log('freeze: ' + (next ? 'on' : 'off'))
      return { ok: true, frozen }
    },
  }
}
