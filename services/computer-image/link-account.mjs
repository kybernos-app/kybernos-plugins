// Links the computer's DSH to its owner's Kybernos account, the way a sign-in on a laptop would have: the suite's cloud plugin keeps its
// connection in one small file of the DSH home (`kybernos-cloud.json`: the token, and what it learned of the person). A computer is born
// connected, with ITS OWN restricted token, to ITS platform (KYBERNOS_CLOUD_API, set by the entrypoint): without this file the page opens
// on the sign-in wizard, which then tries the built-in server, an address the machine's network policy does not let out.
// What the plugin learned (the person's name, the plan, the workspaces) is kept: only the token and the address are set, and only when
// they differ. The first-run wizard is also marked done, once: a computer is not a fresh install of a person's (the account is linked and
// the models are the platform's), and a replay from the settings stays possible. Never fatal: a computer that is not linked is still a computer.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const api = String(process.env.KYBERNOS_API || '').replace(/\/+$/u, '')
const token = String(process.env.KYBERNOS_COMPUTER_TOKEN || '')
const home = String(process.env.DSH_HOME || '')
if (!/^https:\/\/[^/]+$/u.test(api) || token === '' || home === '') process.exit(0)

const file = join(home, 'kybernos-cloud.json')
let state = {}
try {
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed
} catch (e) { /* none yet */ }

const next = {
  ...state,
  token,
  api,
  device_label: typeof state.device_label === 'string' && state.device_label !== '' ? state.device_label : 'Cloud computer',
  connected_at: typeof state.connected_at === 'string' ? state.connected_at : new Date().toISOString()
}
const onboarding = join(home, 'kybernos', 'onboarding.json')
let onboarded = true
try { readFileSync(onboarding, 'utf8') } catch (e) { onboarded = false }
if (!onboarded) {
  const now = new Date().toISOString()
  try {
    mkdirSync(dirname(onboarding), { recursive: true, mode: 0o700 })
    writeFileSync(onboarding, JSON.stringify({ version: 1, completed: true, installedAt: now, completedAt: now, profil: null, uiMode: null, model: 'cloud', lang: null, memoryId: null }, null, 2) + '\n', { mode: 0o600 })
  } catch (e) { /* the wizard will open: nothing worse */ }
}

if (JSON.stringify(next) !== JSON.stringify(state)) {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 0o600 })
    renameSync(file + '.tmp', file)
    console.log('[computer] linked to its owner\'s account on ' + api)
  } catch (e) { console.log('[computer] could not link the account: ' + String((e && e.message) || e)) }
}
