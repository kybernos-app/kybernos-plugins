// kybernos-pulse — host half: it watches the runs the Automations scheduler fired, keeps a small inbox of what happened, and serves it to the
// browser half. It reads tasks.json, the engine's session journals and, when they exist, the two stores beside tasks.json (the gate's gates.json
// and the queue's initiatives.json) — read only, each bounded and caught on its own — and writes one file of its own. No engine patch, no
// @deepseek-ai/* import. Everything in apply() is guarded: an error here must never stop DSH from starting.
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brandMarkFrom, buildPanelPage, extractCore, PANEL_CSP } from './panel-page.mjs'
import { PROACTIVE_FILE_MAX, QUEUE_ITEMS_PER_PASS, readRun, SESSION_ID_RE } from './pulse-core.mjs'
import { createPulse, createWatcher, helperTokenOk, mountRoutes } from './pulse-host.mjs'
import { dshHome, writeGuard } from './session-guard.mjs'

export const name = 'kybernos-pulse'

const dire = (message) => console.log('[kybernos-pulse] ' + message)

/** How often the watcher looks at the runs in flight. A pass with nothing to follow reads nothing but tasks.json. */
export const PASS_MS = 15000

const stateFile = (home) => join(home, 'kybernos', 'pulse', 'pulse.json')
const tasksFile = (home) => join(home, 'kybernos', 'tasks.json')
/** The certification gate's store (its owner writes it), beside tasks.json: `GATE_FILE` — 'gates.json' — in pulse-core.mjs. */
export const gatesFile = (home) => join(home, 'kybernos', 'gates.json')
/** The initiative ledger (its owner writes it), beside tasks.json: 'initiatives.json', the file the `queue list` action serves. */
export const entriesFile = (home) => join(home, 'kybernos', 'initiatives.json')

// What `register` hands back takes the route off again. It is kept here and given to `ctx.effect` by `apply`, so that unloading the plugin removes every route it
// added: without it a hot reload met « duplicate exact route », logged « routes not mounted » and went on serving the OLD handlers (audit L4-05, L6-04).
const kbRetraits = []
const kbRetirerRoutes = () => { for (const retrait of kbRetraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } } }
/** `service` with a `register` that keeps the way to remove each route it adds (see kbRetirerRoutes). */
const kbSuivi = (service) => (service === null || service === undefined || typeof service.register !== 'function'
  ? service
  : new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => { const retrait = target.register(route); if (typeof retrait === 'function') kbRetraits.push(retrait); return retrait } : target[key]) }))

/** The real I/O of the store: one file, written through a temporary name so a crash never leaves half a file. */
export function storeIo (home) {
  const file = stateFile(home)
  return {
    read: () => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return null } },
    write: (data) => {
      mkdirSync(join(home, 'kybernos', 'pulse'), { recursive: true, mode: 0o700 })
      const tmp = file + '.tmp-' + process.pid
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
      renameSync(tmp, file)
    }
  }
}

const here = dirname(fileURLToPath(import.meta.url))

/** The page of the Mac menu-bar app, built from two source files: the panel code of client.js and the brand mark of the brand code. Null when client.js
 *  cannot be read (the route is then not mounted and nothing else is affected); no brand code only means no mark in the page. */
export const readPanelPage = (dir = here) => {
  try {
    const core = extractCore(readFileSync(join(dir, 'client.js'), 'utf8'))
    let mark = ''
    try { mark = brandMarkFrom(readFileSync(join(dir, '..', 'kybernos-plugin', 'client.js'), 'utf8')) } catch (e) { mark = '' }
    return buildPanelPage({ core, mark })
  } catch (e) { return null }
}

export const tokenFile = (home) => join(home, 'kybernos', 'pulse', 'helper.token')
/** The Mac app's token: made once, kept in a file only its owner can read (0600, in the same folder as the store). The app reads it and puts it in its panel. */
export const ensureHelperToken = (home) => {
  const file = tokenFile(home)
  try { const t = readFileSync(file, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(t)) return t } catch (e) { /* made below */ }
  const token = randomBytes(32).toString('hex')
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = file + '.tmp-' + process.pid
  writeFileSync(tmp, token + '\n', { mode: 0o600 })
  renameSync(tmp, file)
  return token
}

/** tasks.json as a list; anything else (missing, corrupt, not a list) is an empty list: nothing to follow, nothing claimed. */
export const readTasksFile = (home) => async () => {
  try { const list = JSON.parse(readFileSync(tasksFile(home), 'utf8')); return Array.isArray(list) ? list : [] } catch (e) { return [] }
}

/** The verdict of one session from the engine's journal; null when the service is not there or the journal cannot be read. */
export const readRunFrom = (getPersistence) => async (sessionId) => {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return null
  const persistence = getPersistence()
  if (persistence === undefined || persistence === null || typeof persistence.open !== 'function') return null
  let handle = null
  try {
    handle = await persistence.open(sessionId, 'read')
    const read = await handle.read()
    return readRun(read !== null && read !== undefined ? read.events : null)
  } catch (e) { return null } finally {
    try { if (handle !== null && handle !== undefined && typeof handle.close === 'function') await handle.close() } catch (e) { /* already closed */ }
  }
}

// ── The two feeds beside tasks.json: the gate store and the initiative ledger ────────────────────────────────
// Pulse only reads them (their owner writes them), bounded by PROACTIVE_FILE_MAX and caught on their own: an absent or broken file
// yields no item and never stops the session half of a pass. Nothing is read from globalThis and nothing is cached at load time.

const QUEUE_ENTRIES_READ = 4 * QUEUE_ITEMS_PER_PASS
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A feed file parsed, or null when it is absent (the normal state), not a file, over PROACTIVE_FILE_MAX, or not JSON (one log line). */
const readFeed = (file, label) => {
  try {
    const info = statSync(file)
    if (info.isFile() !== true) return null
    if (info.size > PROACTIVE_FILE_MAX) { dire(label + ' ignored: over ' + PROACTIVE_FILE_MAX + ' bytes'); return null }
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    if (e !== null && typeof e === 'object' && e.code === 'ENOENT') return null
    dire(label + ' ignored: ' + String(e && e.message ? e.message : e))
    return null
  }
}

/** The gate records: the `records` envelope its owner writes, or a bare GateRecord[]; a record with no automationId is skipped. */
export const readGatesFile = (home) => async () => {
  const data = readFeed(gatesFile(home), 'gates.json')
  if (data === null) return []
  const list = Array.isArray(data) ? data : (isPlain(data) && Array.isArray(data.records) ? data.records : null)
  if (list === null) { dire('gates.json ignored: no records list'); return [] }
  return list.filter((r) => isPlain(r) && typeof r.automationId === 'string' && r.automationId !== '')
}

/** The ledger entries: a bare InitiativeEntry[], or the `entries` / `items` wrapper of the queue's own file. Bounded, never a throw. */
export const readEntriesFile = (home) => async () => {
  const data = readFeed(entriesFile(home), 'initiatives.json')
  if (data === null) return []
  const list = Array.isArray(data) ? data : (isPlain(data) && Array.isArray(data.entries) ? data.entries : (isPlain(data) && Array.isArray(data.items) ? data.items : null))
  if (list === null) { dire('initiatives.json ignored: no entries list'); return [] }
  const out = []
  for (const e of list) {
    if (out.length >= QUEUE_ENTRIES_READ) break
    if (isPlain(e) && typeof e.id === 'string' && e.id !== '') out.push(e)
  }
  return out
}

/** The two feeds of one pass, each read in its own try/catch: `{ gates, entries }`, empty lists when they are absent or broken. */
export const readProactiveFrom = (home) => async () => {
  const gates = readGatesFile(home)
  const entries = readEntriesFile(home)
  let g = []
  let e = []
  try { g = await gates() } catch (err) { g = [] }
  try { e = await entries() } catch (err) { e = [] }
  return { gates: Array.isArray(g) ? g : [], entries: Array.isArray(e) ? e : [] }
}

export function apply (ctx) {
  if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => kbRetirerRoutes, 'kybernos-pulse: routes')
  try {
    const home = dshHome()
    const pulse = createPulse({ ...storeIo(home) })
    const getPersistence = () => { try { return ctx.get('sessionPersistence') } catch (e) { return undefined } }
    const watcher = createWatcher({ pulse, readTasks: readTasksFile(home), readRunOf: readRunFrom(getPersistence), log: dire, readProactive: readProactiveFrom(home) })
    // The Mac app has no browser session to show: its two writes carry its own token instead (a file only the owner can read). A browser write still needs the cookie.
    let token = null
    try { token = ensureHelperToken(home) } catch (e) { dire('no token for the Mac app: ' + String(e?.message ?? e)) }
    const panelPage = readPanelPage()
    const mount = (webServer) => {
      try {
        mountRoutes(kbSuivi(webServer), pulse, (req) => (helperTokenOk(req, token) ? null : writeGuard(req)), { panelPage, panelCsp: PANEL_CSP })
        dire('routes mounted')
      } catch (e) { dire('routes not mounted: ' + String(e?.message ?? e)) }
    }
    if (ctx.get('webServer') !== undefined) mount(ctx.get('webServer'))
    else ctx.inject(['webServer'], (host) => mount(host.webServer))
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => {
        const first = setTimeout(() => { void watcher.tick() }, 3000)
        const timer = setInterval(() => { void watcher.tick() }, PASS_MS)
        for (const t of [first, timer]) if (typeof t.unref === 'function') t.unref()
        return () => { clearTimeout(first); clearInterval(timer) }
      }, 'kybernos-pulse: watcher')
    }
  } catch (e) {
    dire('disabled: ' + String(e?.message ?? e))
  }
}
