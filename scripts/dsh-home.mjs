// The DSH home for the dev scripts, resolved the way DSH does (@deepseek-ai/dsh-home-paths
// resolveDshHome): a non-blank $DSH_HOME (trimmed, a leading `~` expanded), else <os home>/.dsh.
// DSH_HOME IS the DSH folder, so a live check aimed at an isolated instance (DSH_HOME set) must
// read that instance's profile and credentials, not the user's real ~/.dsh.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const dshHome = (env = process.env, osHome = homedir) => {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(osHome(), '.dsh')
  if (raw === '~') return osHome()
  return resolve(raw.startsWith('~/') || raw.startsWith('~\\') ? join(osHome(), raw.slice(2)) : raw)
}

/** The stored `cordis.patch.yml` of a DSH profile (KB_PROFILE, else `web`) as text; null when it can't be read. */
export const profilePatch = (profile = process.env.KB_PROFILE || 'web') => {
  try { return readFileSync(join(dshHome(), 'profiles', profile, 'cordis.patch.yml'), 'utf8') } catch (e) { return null }
}
