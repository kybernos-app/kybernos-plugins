// Which model a person talks to right after connecting a way to one.
//
// Connecting an account, a key or a local model adds models to the selector; it does not choose one. The
// default model of the profile stays what it was (often a provider the person has no key for), so the first
// message would still fail until they open the selector. This module makes the choice, once, on their behalf:
//
//  - only when the CURRENT default cannot work (its provider is not routable, or its key is not set): a person
//    who already has a working default keeps it;
//  - only among the models of the provider the person has just connected, never a model of another;
//  - the model is picked by `pickModel` (a general-purpose chat model: not an embedding, a voice or an image one).
//
// The services come in as arguments (the host passes the engine's own: llm, agentDefaultModel, sessionController,
// settings, credentials), so the rules are tested without an engine.

/** A model that is not for chat: it must not become the default. */
const SPECIALISED = /embed|rerank|tts|whisper|transcri|audio|speech|image|dall-?e|moderation|realtime|guard|sora/i

/**
 * What to prefer, per provider route, in order. Anything not listed falls back to the first general-purpose model.
 * Inside one preference, the greatest id wins: ids carry their version or date, so that is the newest.
 */
const PREFER = {
  kybernos: [/auto/i, /default/i],
  anthropic: [/sonnet/i, /haiku/i, /opus/i],
  openai: [/^gpt-5(?!.*(mini|nano))/i, /^gpt-4\.1(?!.*(mini|nano))/i, /^gpt-4o(?!.*mini)/i],
  deepseek: [/chat/i, /v\d/i],
  google: [/flash/i, /pro/i],
}

const newest = (ids) => ids.slice().sort().reverse()[0]

/**
 * @param {string} provider  the route's id
 * @param {string[]} ids     the models it offers
 * @param {string} [wanted]  a model the caller asked for: kept when the route offers it
 * @returns {string|null}
 */
export const pickModel = (provider, ids, wanted) => {
  const all = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id !== '') : []
  if (all.length === 0) return null
  if (typeof wanted === 'string' && all.indexOf(wanted) >= 0) return wanted
  const chat = all.filter((id) => !SPECIALISED.test(id))
  const pool = chat.length > 0 ? chat : all
  const prefs = Object.prototype.hasOwnProperty.call(PREFER, provider) ? PREFER[provider] : []
  for (const re of prefs) {
    const hits = pool.filter((id) => re.test(id))
    if (hits.length > 0) return newest(hits)
  }
  return pool[0]
}

/** Does the profile's current default model have what it needs to answer? */
export const defaultWorks = async (deps) => {
  const current = deps.agentDefaultModel.currentSelection()
  if (current === null || typeof current !== 'object' || typeof current.provider !== 'string') return false
  const routable = deps.llm.listProviders()
  if (!Array.isArray(routable) || !routable.some((p) => p !== null && p.id === current.provider)) return false
  // A route that is not configured with an API key reference (an account, a local engine) is taken as working.
  const configurable = typeof deps.llm.listConfigurableProviders === 'function' ? deps.llm.listConfigurableProviders() : []
  const entry = Array.isArray(configurable) ? configurable.find((c) => c !== null && c.provider === current.provider) : undefined
  if (entry === undefined) return true
  const namespaces = deps.settings.describe({ redactSecrets: true })
  let profile = Array.isArray(namespaces) ? (namespaces.find((n) => n !== null && n.ns === entry.settingsNs) || {}).value : undefined
  for (const key of Array.isArray(entry.settingsPath) ? entry.settingsPath : []) profile = typeof profile === 'object' && profile !== null ? profile[key] : undefined
  if (typeof profile !== 'object' || profile === null) return true
  const ref = profile.apiKeyEnv
  if (typeof ref !== 'string' || ref === '') return true
  const described = await deps.credentials.describe(ref)
  return described !== null && typeof described === 'object' && described.configured === true
}

/**
 * Make `provider`'s model the one the next message uses, if the current default could not answer.
 * @param deps     { llm, agentDefaultModel, sessionController?, settings, credentials }
 * @param request  { provider, model?, sessionId?, force? }  `force` only counts with a sessionId
 * @returns {Promise<{ok:true,switched:boolean,provider?:string,model?:string,scope?:'session'|'default',reason?:string}|{ok:false,error:string}>}
 */
export const selectAfterConnect = async (deps, request) => {
  const provider = request !== null && typeof request === 'object' && typeof request.provider === 'string' ? request.provider : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(provider)) return { ok: false, error: 'bad-provider' }
  const wanted = typeof request.model === 'string' && request.model.length <= 200 ? request.model : undefined
  const sessionId = typeof request.sessionId === 'string' && request.sessionId.length > 0 && request.sessionId.length <= 200 ? request.sessionId : null
  if (deps === null || typeof deps !== 'object' || !deps.llm || !deps.agentDefaultModel || !deps.settings || !deps.credentials) return { ok: false, error: 'services-unavailable' }
  try {
    if (!deps.llm.listProviders().some((p) => p !== null && p.id === provider)) return { ok: true, switched: false, reason: 'provider-not-routable' }
    const models = await deps.llm.listModels(provider)
    const model = pickModel(provider, (Array.isArray(models) ? models : []).map((m) => (m !== null && typeof m === 'object' ? m.id : null)), wanted)
    if (model === null) return { ok: true, switched: false, reason: 'no-model' }
    // From a chat that has just failed for want of a key, the person has said what they want: that chat takes the new
    // model even if the profile's default would have worked for another one.
    const forced = request.force === true && sessionId !== null
    if (!forced && await defaultWorks(deps)) return { ok: true, switched: false, reason: 'default-works' }
    const resolved = await deps.llm.resolveCallConfig({ provider, model })
    const selection = {
      provider: resolved.provider,
      model: resolved.model,
      ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }),
    }
    // From a chat: that chat's next request too (the engine's own selection also saves the default). Anywhere else, or
    // when the chat cannot take it, only the default.
    if (sessionId !== null && deps.sessionController && typeof deps.sessionController.selectModel === 'function') {
      try {
        const done = await deps.sessionController.selectModel({ sessionId, provider: selection.provider, model: selection.model })
        if (!(done !== null && typeof done === 'object' && done.ok === false)) return { ok: true, switched: true, provider: selection.provider, model: selection.model, scope: 'session' }
      } catch (e) { /* the default is still saved below */ }
    }
    await deps.agentDefaultModel.saveSelection(selection)
    return { ok: true, switched: true, provider: selection.provider, model: selection.model, scope: 'default' }
  } catch (e) {
    return { ok: false, error: 'selection-failed' }
  }
}
