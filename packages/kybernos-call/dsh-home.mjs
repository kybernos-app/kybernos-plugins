// The DSH home, resolved the way DSH does (@deepseek-ai/dsh-home-paths resolveDshHome):
// a non-blank $DSH_HOME (trimmed, a leading `~` expanded), else <os home>/.dsh.
//
// DSH_HOME IS the DSH folder itself. Resolve it at each use, never cache it, and never build
// a path as join(homedir(), '.dsh', ...): with DSH_HOME set (an isolated instance, a second
// profile, CI) that reads and writes the user's real ~/.dsh.
//
// Synchronous on purpose: the async `dshHome()` of index.js reaches the same folder for the
// code that already awaits it; this one serves the module-level helpers and the sync paths.
// No import from `@deepseek-ai/*` (a plugin linked as `@local/…` cannot resolve them).
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function dshHomeSync(env, osHome) {
  const vars = env !== undefined ? env : (typeof process !== 'undefined' && process.env !== undefined ? process.env : {})
  const home = typeof osHome === 'function' ? osHome : homedir
  const raw = typeof vars.DSH_HOME === 'string' ? vars.DSH_HOME.trim() : ''
  if (raw === '') return join(home(), '.dsh')
  if (raw === '~') return home()
  return resolve(raw.startsWith('~/') || raw.startsWith('~\\') ? join(home(), raw.slice(2)) : raw)
}
