// kybernos-door: the local MCP door. Claude Code (or any MCP client) on THIS computer gives the person's Kaby a task and reads the answer, through `POST /kybernos-door/mcp` on DSH's own web
// server. It is the same idea as the assistants' door of the Kybernos server (`kaby_do`), without the cloud: the task runs in this DSH, as a new conversation put under « ask first » before anything is sent
// (the core plugin's `kybernos.askSessions` seam; no seam, no task), and a step that needs a human yes waits for the person on the Kybernos screen.
//
// No engine patch: the route is a plugin route, the sessions are the engine's `sessionController` and `sessionPersistence` services, read when a request comes in. The plugin is off until the person
// switches it on; once on it makes a token in the profile (token.mjs) and nothing is reachable without it (door-http.mjs). Nothing here can stop DSH from starting: every step is behind a try/catch.
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createMcp } from './mcp.mjs'
import { createHandler } from './door-http.mjs'
import { createToken } from './token.mjs'
import { createTasks } from './tasks.mjs'
import { createTools } from './tools.mjs'
import { createActivity } from './activity.mjs'
import { stopTurn } from './stop.mjs'
import { createSetup, SETUP_ROUTE, TOKEN_ROUTE, ROTATE_ROUTE } from './setup.mjs'

export const name = 'kybernos-door'
export const ROUTE = '/kybernos-door/mcp'

const log = (text) => { try { console.log('[kybernos-door] ' + text) } catch (e) { /* no console */ } }

/** The DSH folder, resolved the way DSH does: a non-blank $DSH_HOME (a leading `~` expanded), else ~/.dsh. */
export function dshHome (env = process.env, osHome = homedir) {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(osHome(), '.dsh')
  if (raw === '~') return osHome()
  return resolve(raw.startsWith('~/') ? join(osHome(), raw.slice(2)) : raw)
}
export const doorDir = (home = dshHome()) => join(home, 'kybernos', 'door')

const INSTRUCTIONS = 'This is Kaby MCP, the way into Kaby, the assistant of the Kybernos app on this computer. '
  + 'When the person asks you to have Kaby do or find something (use its connected apps, its memory, its skills, work on their files), call kaby_do with the task. '
  + 'A task that is not finished in wait_seconds keeps running: call kaby_do again with its task_id. '
  + 'A step that needs the person\'s approval waits for them on the Kybernos screen; you cannot approve it for them.'

/** The engine's reply shape: `{ ok: false }` is a refusal, `{ value }` or the value itself is the answer. */
const unwrap = (res) => {
  if (res === null || typeof res !== 'object') return null
  if (res.ok === false) return null
  return res.value !== undefined && res.value !== null && typeof res.value === 'object' ? res.value : res
}

/** The few things the door needs from the engine's `sessionController`, in the plain words of tools.mjs. `get(service)` is read at each call: the engine may not have it yet. */
export function sessionsFacade (get) {
  return () => {
    const sc = get('sessionController')
    if (sc === undefined || sc === null || typeof sc.create !== 'function' || typeof sc.prompt !== 'function' || typeof sc.state !== 'function') return null
    return {
      async create () {
        const v = unwrap(await sc.create({}))
        return v !== null && typeof v.sessionId === 'string' ? v.sessionId : null
      },
      /** The core plugin's « ask first » seam (kybernos-plugin, `kybernos.askSessions`): absent or refusing means the task must not start. */
      async askFirst (sessionId) {
        try {
          const seam = globalThis[Symbol.for('kybernos.askSessions')]
          if (seam === undefined || seam === null || typeof seam.begin !== 'function') return { ok: false, error: 'seam_missing' }
          const r = seam.begin(sessionId, { door: true })
          return r !== null && typeof r === 'object' && r.ok === true ? { ok: true } : { ok: false, error: r !== null && typeof r === 'object' && typeof r.error === 'string' ? r.error : 'failed' }
        } catch (e) { return { ok: false, error: 'failed' } }
      },
      async prompt (sessionId, text) {
        const ack = await sc.prompt({
          requestId: 'kb-door-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        }, new AbortController().signal)
        return !(ack !== null && typeof ack === 'object' && ack.ok === false)
      },
      /** Stops the task's session and every sub-agent below it, and removes what waits in their queues (stop.mjs): `{ ok, stopped }` or `{ ok: false, error }`. */
      async stop (sessionId) {
        return stopTurn({ sc, sessions: get('sessions'), sessionId })
      },
      async state (sessionId) {
        const st = unwrap(await sc.state({ sessionId }, new AbortController().signal))
        if (st === null) return null
        return { running: st.running === true, queue: Array.isArray(st.queue) ? st.queue : [], pendingInput: Array.isArray(st.pendingInput) ? st.pendingInput : [] }
      },
    }
  }
}

/** The events of a session, read from the engine's persistence. */
export function eventsReader (get) {
  return async (sessionId) => {
    const persistence = get('sessionPersistence')
    if (persistence === undefined || persistence === null || typeof persistence.open !== 'function') return []
    const handle = await persistence.open(sessionId, 'read')
    try {
      const read = await handle.read()
      return read !== null && read !== undefined && Array.isArray(read.events) ? read.events : []
    } finally {
      try { if (handle !== null && handle !== undefined && typeof handle.close === 'function') await handle.close() } catch (e) { /* already closed */ }
    }
  }
}

/** What the plugin builds from a way to read the engine's services; exported so the host test can drive the whole door without DSH. */
export function buildDoor (get, { home = dshHome } = {}) {
  const token = createToken({ file: () => join(doorDir(home()), 'token') })
  const tasks = createTasks({ file: () => join(doorDir(home()), 'tasks.json') })
  const activity = createActivity({ file: () => join(doorDir(home()), 'activity.json') })
  const setup = createSetup({ token, activity, tokenFile: () => join(doorDir(home()), 'token') })
  const tools = createTools({ facade: sessionsFacade(get), events: eventsReader(get), tasks })
  const mcp = createMcp({ info: { name: 'kaby-mcp', version: '0.1.0' }, instructions: INSTRUCTIONS, tools })
  return { token, tasks, activity, setup, mcp, handler: createHandler({ mcp, token: () => token.current(), onCall: () => activity.touch() }) }
}

export function apply (ctx) {
  try {
    const door = buildDoor((service) => ctx.get(service))
    try { door.token.ensure() } catch (e) { log('no token could be made, the door stays off: ' + String(e?.message ?? e)) }
    const mount = (webServer) => {
      try {
        ctx.effect(() => webServer.register({ kind: 'exact', path: ROUTE, handler: door.handler }), 'kybernos-door: route')
        // The Settings page's own routes (signed browser session needed, session-guard.mjs): the state, the token for the copy button, a new token.
        ctx.effect(() => webServer.register({ kind: 'exact', path: SETUP_ROUTE, handler: door.setup.state }), 'kybernos-door: setup state')
        ctx.effect(() => webServer.register({ kind: 'exact', path: TOKEN_ROUTE, handler: door.setup.token }), 'kybernos-door: setup token')
        ctx.effect(() => webServer.register({ kind: 'exact', path: ROTATE_ROUTE, handler: door.setup.rotate }), 'kybernos-door: setup rotate')
        log('route mounted')
      } catch (e) { log('route not mounted: ' + String(e?.message ?? e)) }
    }
    if (ctx.get('webServer') !== undefined) mount(ctx.get('webServer'))
    else ctx.inject(['webServer'], (host) => mount(host.webServer))
  } catch (e) {
    log('disabled: ' + String(e?.message ?? e))
  }
}
