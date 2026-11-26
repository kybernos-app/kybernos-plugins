// Which provider and model the roles of a new Agent Team are written with. No I/O: index.js reads the person's default model from the
// engine's settings (`agent-default-model`, the one the model picker starts on) and hands it here, so the rule can be tested without a host.
//
// There is NO built-in model here, on purpose: a team made by Kaby, or installed from a template, runs on the model the person chose,
// not on one a plugin picked in advance (the owner, 2026-11-08: « every static model goes »). A role the request gives no model for takes the
// person's default; when the profile has none, the role is written WITHOUT a provider and a model, which the Teams page shows as
// « provider/model not declared » and the role editor can fill in later (`applyRole` adds the missing lines).

const text = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * The person's default route as `{ provider, model }`, or null when the profile has none (both must be non-empty strings).
 * @param {unknown} def what the engine's `agent-default-model` setting holds
 */
export const defaultRoute = (def) => {
  if (def === null || def === undefined || typeof def !== 'object') return null
  const provider = text(def.provider)
  const model = text(def.model)
  return provider !== '' && model !== '' ? { provider, model } : null
}

/**
 * The provider and the model one role is written with.
 *  - both given: kept as they are (the request knows better than the default);
 *  - none given: the person's default route, or none ('' and '') when the profile has none;
 *  - only one given: kept, the other left empty. A provider is never paired with a model it did not come with.
 * @param {{ provider?: unknown, model?: unknown }} raw the role of the request
 * @param {{ provider: string, model: string } | null} route the person's default route
 */
export const roleRoute = (raw, route) => {
  const provider = text(raw === null || raw === undefined ? undefined : raw.provider)
  const model = text(raw === null || raw === undefined ? undefined : raw.model)
  if (provider === '' && model === '') return route === null || route === undefined ? { provider: '', model: '' } : { provider: route.provider, model: route.model }
  return { provider, model }
}

/**
 * The roles of a new team, ready to be written. A request without any role gets one `lead`.
 * @param {unknown} rolesRaw `roles` of the request
 * @param {{ provider: string, model: string } | null} route the person's default route
 * @param {(s: string) => string} slugify the id rule of index.js
 * @param {number} promptMax the longest prompt kept
 */
export const kyberRoles = (rolesRaw, route, slugify, promptMax) => {
  const roles = []
  for (const r of Array.isArray(rolesRaw) ? rolesRaw : []) {
    if (r === null || r === undefined || typeof r !== 'object') continue
    const id = slugify(text(r.id) !== '' ? r.id : (typeof r.role === 'string' ? r.role : 'agent'))
    const at = roleRoute(r, route)
    roles.push({
      id,
      kind: text(r.role) !== '' ? text(r.role).slice(0, 40) : undefined,
      provider: at.provider,
      model: at.model,
      prompt: typeof r.prompt === 'string' ? r.prompt.trim().slice(0, promptMax) : undefined,
    })
  }
  if (roles.length === 0) {
    const at = roleRoute(null, route)
    roles.push({ id: 'lead', kind: 'lead', provider: at.provider, model: at.model })
  }
  return roles
}

/**
 * Where the Agent Team YAML helper sends its request (index.js `kbYmlProposer`): the model the request names, else the person's default model, on the provider that model
 * belongs to. The address and the NAME of the key (never the key) come from the engine's own provider list (`llm-pi-ai.providers`: `baseURL`, `apiKeyEnv`). There is no built-in
 * model and no built-in provider here (the owner, 2026-11-08: « every static model goes »): with no model chosen it says so, and with a provider that has no address it says that.
 * A provider that needs no key (a local one) has an empty `ref`.
 * @param {{ model?: unknown, provider?: unknown }} raw the request
 * @param {{ provider: string, model: string } | null} route the person's default route
 * @param {Record<string, { baseURL?: unknown, apiKeyEnv?: unknown }>} providers the engine's provider list
 * @returns {{ ok: true, model: string, provider: string, baseUrl: string, ref: string } | { ok: false, error: string, needsModel?: true, needsProvider?: true }}
 */
export const chatRoute = (raw, route, providers) => {
  const asked = text(raw === null || raw === undefined ? undefined : raw.model)
  const askedProvider = text(raw === null || raw === undefined ? undefined : raw.provider)
  const model = asked !== '' ? asked : (route === null || route === undefined ? '' : route.model)
  if (model === '') return { ok: false, error: 'no model chosen: pick a model in the model picker first', needsModel: true }
  const provider = askedProvider !== '' ? askedProvider : (route === null || route === undefined ? '' : route.provider)
  const entry = provider !== '' && providers !== null && providers !== undefined && typeof providers === 'object' ? providers[provider] : undefined
  const baseUrl = text(entry === null || entry === undefined ? undefined : entry.baseURL).replace(/\/+$/, '')
  if (baseUrl === '') return { ok: false, error: 'the provider of ' + model + (provider === '' ? '' : ' (' + provider + ')') + ' has no address in this profile', needsProvider: true }
  return { ok: true, model, provider, baseUrl, ref: text(entry.apiKeyEnv) }
}
