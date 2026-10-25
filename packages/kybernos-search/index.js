// kybernos-search — host half. Routes under /kybernos-search/*, an index of the person's chats kept in ~/.dsh/kybernos/search/.
// Local only: nothing here talks to the network, and nothing is given to a model.
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fenced, readBody, sameOriginLax, sameOriginStrict, send } from './guard.mjs'
import { writeGuard } from './session-guard.mjs'
import { createIndex } from './store.mjs'
import { allSources } from './sources.mjs'

export const name = 'kybernos-search'

const SCOPES = ['chat', 'skill', 'lesson', 'automation', 'team']

const dshHome = () => {
  const raw = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return raw === '' ? join(homedir(), '.dsh') : raw
}

/** The session journals on disk: <home>/sessions/<workspace slug>/<session id>/session.v*.jsonl.zstd (the newest format wins). */
export function listSessions (home) {
  const out = []
  const root = join(home, 'sessions')
  let slugs = []
  try { slugs = readdirSync(root) } catch (e) { return out }
  for (const slug of slugs) {
    let dirs = []
    try { dirs = readdirSync(join(root, slug)) } catch (e) { continue }
    for (const id of dirs) {
      let files = []
      try { files = readdirSync(join(root, slug, id)).filter((f) => /^session\.v\d+\.jsonl\.zstd$/.test(f)).sort() } catch (e) { continue }
      if (files.length === 0) continue
      const file = join(root, slug, id, files[files.length - 1])
      try { const s = statSync(file); out.push({ id, file, size: s.size, mtimeMs: Math.round(s.mtimeMs) }) } catch (e) { /* vanished */ }
    }
  }
  return out
}

export function realIo (home) {
  const dir = join(home, 'kybernos', 'search')
  const cacheFile = join(dir, 'chats.v1.json')
  return {
    listSessions: () => listSessions(home),
    readFile: (f) => readFileSync(f),
    readCache: () => { try { return JSON.parse(readFileSync(cacheFile, 'utf8')) } catch (e) { return null } },
    writeCache: (obj) => {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const tmp = cacheFile + '.tmp-' + process.pid
      writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 })
      renameSync(tmp, cacheFile)
      try { chmodSync(cacheFile, 0o600) } catch (e) { /* best effort */ }
    },
    sources: () => allSources(home),
    now: () => Date.now()
  }
}

/** Mounts the routes. `index` is injected so the tests drive them with a fake. */
export function mountRoutes (webServer, index) {
  const ws = fenced(webServer)
  // Every route here is a POST, and every POST needs DSH's signed browser session as well as the right Origin (session-guard.mjs, kybernos-terminal's rule, L3-09). `query` hands back
  // the text of the person's chats, their automations' prompts, their lessons and their agents: DSH serves plugin routes before its own login and an Origin header is forgeable by any local
  // program or any other account on the machine, so before this `curl -X POST -H 'Origin: http://127.0.0.1:<port>' .../kybernos-search/query -d '{"q":"password"}'` read them all, and `start` /
  // `reindex` made this computer read every journal on demand. The caller is the Search everywhere dialog, which sends the cookie by itself. A paired phone is refused (`refused_on_phone`)
  // except for `query` (`options.phoneMayRead`): it only reads, from the index the desktop kept on disk, and the phone's chat list is the same text.
  const post = (handler, options) => async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method-not-allowed' })
    if (sameOriginStrict(req) !== true) return send(res, 403, { ok: false, error: 'origin-refused' })
    const refused = writeGuard(req, options)
    if (refused !== null) return send(res, refused.status, { ok: false, error: refused.error })
    if (!String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')) return send(res, 415, { ok: false, error: 'json-required' })
    let body = null
    try { body = (await readBody(req)) ?? {} } catch (e) { return send(res, 400, { ok: false, error: 'bad-body' }) }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { ok: false, error: 'bad-body' })
    return handler(body, res)
  }
  ws.register({
    kind: 'exact',
    path: '/kybernos-search/status',
    handler: (req, res) => {
      if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      if (sameOriginLax(req) !== true) return send(res, 403, { ok: false, error: 'origin-refused' })
      return send(res, 200, { ok: true, scopes: SCOPES, ...index.status() })
    }
  })
  ws.register({
    kind: 'exact',
    path: '/kybernos-search/start',
    handler: post((body, res) => { void index.start(); return send(res, 202, { ok: true, ...index.status() }) })
  })
  ws.register({
    kind: 'exact',
    path: '/kybernos-search/reindex',
    handler: post((body, res) => { void index.rebuild(); return send(res, 202, { ok: true, ...index.status() }) })
  })
  ws.register({
    kind: 'exact',
    path: '/kybernos-search/query',
    handler: post((body, res) => {
      const q = typeof body.q === 'string' ? body.q.slice(0, 200) : ''
      if (q.trim() === '') return send(res, 400, { ok: false, error: 'empty-query' })
      const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s) => SCOPES.includes(s)) : SCOPES
      return send(res, 200, index.query({ q, scopes, limit: Number.isInteger(body.limit) ? body.limit : undefined, perScope: Number.isInteger(body.perScope) ? body.perScope : undefined }))
    }, { phoneMayRead: true })
  })
}

// What `register` hands back takes the route off again. It is kept here and given to `ctx.effect` by `apply`, so that unloading the plugin removes every route it
// added: without it a hot reload met « duplicate exact route », logged « routes not mounted » and went on serving the OLD handlers (audit L4-05, L6-04).
const kbRetraits = []
const kbRetirerRoutes = () => { for (const retrait of kbRetraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } } }
/** `service` with a `register` that keeps the way to remove each route it adds (see kbRetirerRoutes). */
const kbSuivi = (service) => (service === null || service === undefined || typeof service.register !== 'function'
  ? service
  : new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => { const retrait = target.register(route); if (typeof retrait === 'function') kbRetraits.push(retrait); return retrait } : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) }))

export function apply (ctx) {
  if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => kbRetirerRoutes, 'kybernos-search: routes')
  try {
    const index = createIndex(realIo(dshHome()))
    // A read-only seam for the bundles that compare the person's asks (kybernos-skills notices a task that comes back): frozen, looked up at call time by the reader.
    try { globalThis[Symbol.for('kybernos.chat-index')] = Object.freeze({ version: 1, asks: (sinceMs) => index.asks(sinceMs), refresh: () => index.start() }) } catch (e) { /* a seam that cannot be set leaves the readers without it */ }
    const mount = (webServer) => { try { mountRoutes(kbSuivi(webServer), index); console.log('[kybernos-search] routes mounted') } catch (e) { console.log('[kybernos-search] routes not mounted: ' + String(e?.message ?? e)) } }
    const have = typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined
    if (have !== undefined && have !== null) mount(have)
    else if (typeof ctx?.inject === 'function') ctx.inject(['webServer'], (h) => mount(h.webServer))
  } catch (e) {
    console.log('[kybernos-search] disabled: ' + String(e?.message ?? e))
  }
}
