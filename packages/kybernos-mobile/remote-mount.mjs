// kybernos-mobile: mounts the remote half in a running DSH. It is loaded lazily by index.js, inside its own try/catch,
// so that nothing here can ever stop the phone layout or DSH from starting.
//
//   start(ctx)   creates the manager (remote-host.mjs) with this DSH's real surroundings and starts it
//   stop()       closes every connection
//   route(name, req, res)   the person's gestures from the settings page and the sidebar panel
//
// The routes are registered by index.js (synchronously, behind the Host and Origin fences); this file only answers.
import { hostname } from 'node:os'
import { createRemote } from './remote-host.mjs'
import { localReach, remoteDir } from './remote-local.mjs'

export const CLOUD_SEAM = Symbol.for('kybernos.cloud')
let remote = null
let reach = null

const json = (res, status, body) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    res.end(JSON.stringify(body))
  } catch (e) { /* socket closed */ }
}
const readBody = async (req, max = 4096) => {
  let size = 0
  const parts = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > max) throw new Error('too-large')
    parts.push(chunk)
  }
  if (parts.length === 0) return {}
  const v = JSON.parse(Buffer.concat(parts).toString('utf8'))
  return v !== null && typeof v === 'object' && Array.isArray(v) === false ? v : {}
}

/** The manager, built from this DSH's surroundings. Exported for tests that mount it on a fake DSH. */
export function build (ctx, env = process.env) {
  let webServer = null
  try { webServer = ctx.get('webServer') } catch (e) { webServer = null }
  reach = localReach({ webServer: webServer === undefined ? null : webServer, env })
  return createRemote({
    dir: remoteDir(env),
    cloud: () => { try { const s = globalThis[CLOUD_SEAM]; return s !== undefined && s !== null && typeof s.call === 'function' ? s : null } catch (e) { return null } },
    WebSocket: typeof globalThis.WebSocket === 'function' ? globalThis.WebSocket : null,
    fetch: globalThis.fetch,
    local: () => reach(),
    label: () => { try { return hostname() || 'Computer' } catch (e) { return 'Computer' } },
    log: (m) => { try { console.error('[kybernos-mobile] remote: ' + m) } catch (e) { /* no console */ } },
  })
}

export async function start (ctx, env = process.env) {
  if (remote !== null) return remote
  remote = build(ctx, env)
  await remote.start()
  return remote
}

export function stop () {
  try { if (remote !== null) remote.stop() } catch (e) { /* closing */ }
  remote = null
  reach = null
}

/** What the phone layout can say about the remote half, for the settings page. */
export async function route (name, req, res) {
  try {
    if (remote === null) return json(res, 503, { ok: false, error: 'remote_not_running' })
    // a request of the page reveals DSH's own port, in case the web server did not publish it
    try { if (reach !== null && req.socket && typeof req.socket.localPort === 'number') reach.learn(req.socket.localPort) } catch (e) { /* no socket */ }
    if (name === 'status') return json(res, 200, await remote.status())
    const body = await readBody(req).catch(() => null)
    if (body === null) return json(res, 400, { ok: false, error: 'bad_body' })
    if (name === 'pair') return json(res, 200, await remote.pair())
    if (name === 'pair/approve') return json(res, 200, await remote.approve())
    if (name === 'pair/deny') return json(res, 200, await remote.deny())
    if (name === 'pair/cancel') return json(res, 200, await remote.cancel())
    if (name === 'devices/revoke') return json(res, 200, typeof body.id === 'string' && body.id.length < 100 ? await remote.revoke(body.id) : { ok: false, error: 'bad_id' })
    if (name === 'devices/revoke-all') return json(res, 200, await remote.revokeAll())
    return json(res, 404, { ok: false, error: 'not_found' })
  } catch (e) {
    return json(res, 500, { ok: false, error: 'internal' })
  }
}
