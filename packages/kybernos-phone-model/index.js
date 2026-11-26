// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-phone-model — host half. The small model that runs ON the phone (the app's own server on 127.0.0.1) as a provider of the engine,
// and the « Discussion » preset that goes with it: a plain chat, no tools.
//
// INERT unless the app put `KB_LOCAL_LLM_URL` (and the key) in the engine's environment and the platform is Android or iOS (phone-model.mjs
// `phoneModelConfig`): on a desktop, in a cloud computer, or in a build without the model, nothing below runs and nothing is registered.
//
// What it does when active, and nothing else:
//   1. every 10 s asks the app's server `GET /v1/models` and keeps the provider `llm-pi-ai.providers.phone-local` right (written at the first answer, because
//      the port changes at every launch, rewritten when the installed set changes, removed when the list is empty or the server is gone);
//   2. registers the preset `discussion` (no tool row) and, only while the app says the model takes tools (`"tools": true` on its row of `GET /v1/models`), the preset
//      `light-agent` (four real tools, every write behind the person's approval); it also gives the engine the prompt variable that carries today's date for that preset;
//   3. answers `GET /phone-model/state` for the page: `{ available, installed, model, preset }` (`preset`: the one to select for a blank chat, once it is registered).
// It never downloads, installs or deletes anything, never writes the key, never returns the key or the address: the provider names the key's variable
// (`apiKeyEnv`) and the engine reads it from its environment.
// ═══════════════════════════════════════════════════════════════════════════
import {
  FAILURES_BEFORE_REMOVAL, KEY_ENV, NOW_VARIABLE, POLL_MS, PROVIDER_ID,
  buildProvider, discussionPreset, lightAgentPreset, nowLine, parseModelList, phoneModelConfig, publicState, sameModels, takesTools,
} from './phone-model.mjs'

export const name = 'kybernos-phone-model'

const log = (line) => { try { console.log('[kybernos-phone-model] ' + line) } catch (e) { /* no console */ } }
// Only the message of an error, with the key blanked if it ever travelled in it: a log line must never hold the secret.
const safe = (e, key) => { let t = String(e && e.message ? e.message : e).slice(0, 160); if (typeof key === 'string' && key.length > 0) t = t.split(key).join('…'); return t }

/**
 * `GET <origin>/v1/models` with the bearer key. `{ ok: true, models }` (maybe empty) or `{ ok: false }`; never throws, never returns the key or a body that is not a model list.
 * @param {{ origin: string }} cfg
 * @param {string} key
 * @param {typeof fetch} [fetchImpl]
 * @param {number} [timeoutMs]
 */
export async function fetchInstalled(cfg, key, fetchImpl = globalThis.fetch, timeoutMs = 3000) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(cfg.origin + '/v1/models', { headers: { authorization: 'Bearer ' + key, accept: 'application/json' }, signal: controller.signal, redirect: 'error' })
      if (res.status !== 200) return { ok: false }
      const text = await res.text()
      if (text.length > 65536) return { ok: false }
      return { ok: true, models: parseModelList(JSON.parse(text)) }
    } finally { clearTimeout(timer) }
  } catch (e) { return { ok: false } }
}

/**
 * The provider's keeper: one `tick()` asks the app which models are installed and makes `llm-pi-ai.providers.phone-local` say the same.
 * Rules (contract § 3): the first tick of a launch always decides (a block left by the last launch holds a port that is gone), so it writes the block or removes it;
 * later ticks write only when the installed set changed; an EMPTY list removes the provider at once (the app says nothing is installed); a server that does not
 * answer removes it after `FAILURES_BEFORE_REMOVAL` ticks in a row. A write the settings service refuses (or cannot do yet) is tried again at the next tick.
 * `onModels(models)` (optional) is told the models of the last good answer after every tick (an empty list when the app has none or is gone): the host half offers the light
 * agent preset while the model takes tools. It never throws into the keeper.
 * @param {{ cfg: object, getKey: () => string, getSettings: () => (object | null), fetchModels?: Function, onModels?: (models: object[]) => void }} deps
 */
export function createKeeper(deps) {
  const { cfg, getKey, getSettings } = deps
  const fetchModels = deps.fetchModels !== undefined ? deps.fetchModels : (c, k) => fetchInstalled(c, k)
  let models = []
  let written = false // the provider block is in the settings right now
  let decided = false // this launch has settled once (wrote the block or removed the stale one)
  let failures = 0
  let busy = false
  let polled = false // a poll of this launch has finished (whatever it found)

  const write = async (svc, op) => {
    try {
      const ops = op === 'set'
        ? [{ op: 'set', path: ['providers', PROVIDER_ID], value: buildProvider(cfg, models) }]
        : [{ op: 'unset', path: ['providers', PROVIDER_ID] }]
      await svc.mutate('llm-pi-ai', ops, undefined)
      return true
    } catch (e) { log('settings refused the provider ' + op + ': ' + safe(e, getKey())); return false }
  }

  return {
    /** The models the last good answer listed. */
    models: () => models.slice(),
    /** Whether a provider block is in place. */
    wrote: () => written,
    /** Whether a poll of this launch has finished: before that the models are not known, not absent. */
    polled: () => polled,
    async tick() {
      if (busy) return
      busy = true
      try {
        const got = await fetchModels(cfg, getKey())
        const svc = getSettings()
        if (got.ok === true && got.models.length > 0) {
          failures = 0
          const changed = decided !== true || written !== true || !sameModels(got.models, models)
          models = got.models
          if (changed && svc !== null && typeof svc.mutate === 'function') {
            const done = await write(svc, 'set')
            written = done
            decided = decided || done
          }
          return
        }
        failures += 1
        const empty = got.ok === true
        const remove = empty || failures >= FAILURES_BEFORE_REMOVAL || decided !== true
        if (!remove) return
        models = []
        if ((written === true || decided !== true) && svc !== null && typeof svc.mutate === 'function') {
          const done = await write(svc, 'unset')
          if (done) { written = false; decided = true }
        }
      } finally {
        busy = false
        polled = true
        try { if (typeof deps.onModels === 'function') deps.onModels(models.slice()) } catch (e) { /* the listener is not the keeper's business */ }
      }
    },
  }
}

/**
 * The light agent preset's keeper: `sync(models)` registers the preset while the app's model takes tools and takes it away when it stops (or when the model goes), once per change.
 * `attach(service)` gives it the preset registry (the registry may come after the first poll), `detach()` removes the preset with the engine.
 * @param {{ context: number, maxTokens: number }} cfg
 * @param {(e: unknown) => void} [onError]
 */
export function createLightPreset(cfg, onError = () => {}) {
  let service = null
  let off = null
  let pending = false
  return {
    attach(s) { service = s },
    detach() { service = null; const f = off; off = null; try { if (typeof f === 'function') f() } catch (e) { /* gone with the engine */ } },
    /** Whether the preset is registered right now. */
    registered: () => off !== null,
    sync(models) {
      const s = service
      if (s === null || typeof s.register !== 'function') return
      if (takesTools(models)) {
        if (off !== null || pending) return
        pending = true
        Promise.resolve().then(() => s.register(lightAgentPreset(cfg)))
          .then((f) => { if (service === s) off = typeof f === 'function' ? f : () => {}; else if (typeof f === 'function') { try { f() } catch (e) { /* gone */ } } })
          .catch((e) => { try { onError(e) } catch (e2) { /* no log */ } })
          .finally(() => { pending = false })
      } else if (off !== null) {
        const f = off
        off = null
        try { f() } catch (e) { /* gone with the engine */ }
      }
    },
  }
}

// ── the host fence every route of the repository carries (scripts/test-route-hosts.mjs): a page that rebinds its own name to this machine is refused ──
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
const kbHostOK = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}
// A read: no Origin or Referer is fine (a direct navigation); a foreign one is not, and one that cannot be read is refused.
const sameOriginLax = (req) => {
  try {
    const h = req.headers !== null && req.headers !== undefined ? req.headers : {}
    const source = typeof h.origin === 'string' && h.origin !== '' ? h.origin : (typeof h.referer === 'string' && h.referer !== '' ? h.referer : null)
    if (source === null) return true
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = req.socket !== null && req.socket !== undefined && typeof req.socket.localPort === 'number' ? ':' + req.socket.localPort : ''
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch (e) { return false }
}
const sendJson = (res, status, body) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  } catch (e) { try { res.end('{}') } catch (e2) { /* socket closed */ } }
}

/** The page's route: `GET /phone-model/state` → `{ available, installed, model, preset }`, read from the last poll and from the preset registry. No key, no address, no path. */
export function stateHandler(keeper, light) {
  return (req, res) => {
    if (kbHostOK(req) !== true || sameOriginLax(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin refused' }); return }
    if (req.method !== 'GET') { sendJson(res, 405, { ok: false, error: 'GET only' }); return }
    sendJson(res, 200, publicState(true, keeper.models(), light !== undefined && light !== null && typeof light.registered === 'function' && light.registered() === true, typeof keeper.polled === 'function' ? keeper.polled() : true))
  }
}

export function apply(ctx) {
  try {
    const cfg = phoneModelConfig(process.env, process.platform)
    if (cfg === null) return // inert: nothing is registered, nothing is started
    const getKey = () => String(process.env[KEY_ENV] || '')
    const getSettings = () => { try { const s = ctx.get('settings'); return s === undefined ? null : s } catch (e) { return null } }
    // the light agent preset is registered while the app says the model takes tools, and taken away when it stops saying so
    const light = createLightPreset(cfg, (e) => log('preset light-agent not registered: ' + safe(e, getKey())))
    const syncLight = (models) => light.sync(models)
    const keeper = createKeeper({ cfg, getKey, getSettings, onModels: syncLight })

    // 1. the provider, kept right while the engine runs
    ctx.effect(() => {
      let timer = null
      let stopped = false
      const run = () => { keeper.tick().catch((e) => log('poll failed: ' + safe(e, getKey()))).finally(() => { if (!stopped) { timer = setTimeout(run, POLL_MS); if (typeof timer.unref === 'function') timer.unref() } }) }
      run()
      return () => { stopped = true; if (timer !== null) clearTimeout(timer) }
    }, 'kybernos-phone-model: keep the provider')

    // 2. the « Discussion » preset
    const mountPreset = (scope) => {
      const service = scope.get('agentPresets')
      if (service === undefined || service === null || typeof service.register !== 'function') return
      scope.effect(() => {
        const registered = Promise.resolve().then(() => service.register(discussionPreset(cfg))).catch((e) => { log('preset not registered: ' + safe(e, getKey())); return null })
        light.attach(service)
        light.sync(keeper.models()) // the first poll may have answered before the registry was there
        return () => {
          light.detach()
          registered.then((off) => (typeof off === 'function' ? off() : undefined)).catch(() => { /* gone with the engine */ })
        }
      }, 'kybernos-phone-model: preset discussion')
    }
    ctx.inject(['agentPresets'], mountPreset)

    // 2b. today's date and time for the light agent's prompt: a prompt variable the engine fills in at every request (the persona text of that preset names it)
    ctx.inject(['systemPrompt'], (scope) => {
      try {
        const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch (e) { return 'UTC' } }
        scope.effect(() => scope.systemPrompt.variable(NOW_VARIABLE, () => nowLine(new Date(), zone())), 'kybernos-phone-model: today for the light agent')
      } catch (e) { log('prompt variable not registered: ' + safe(e, getKey())) }
    })

    // 3. the page's state route
    ctx.inject(['webServer'], (scope) => {
      try {
        const web = scope.get('webServer')
        scope.effect(() => web.register({ kind: 'exact', path: '/phone-model/state', handler: stateHandler(keeper, light) }), 'kybernos-phone-model: state route')
      } catch (e) { log('state route not mounted: ' + safe(e, getKey())) }
    })
  } catch (e) {
    try { console.log('[kybernos-phone-model] disabled: ' + String(e && e.message ? e.message : e).slice(0, 160)) } catch (e2) { /* no console */ }
  }
}
