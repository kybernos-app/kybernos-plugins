// Builds the `llm-pi-ai` provider profile that wires a free OpenCode Zen model
// into DSH. Pure: no settings service, no network. index.js (and the client's
// Connect button) hand this a model entry and write the returned object.
//
// Shape matches the pi-ai profile schema (displayName, api, baseURL, apiKeyEnv,
// headers, models[]). The route is deliberately credential-free at rest: the
// gateway fills `Authorization` from the credential store (a `public` marker)
// at request time, so nothing secret lives in the settings namespace.

import { DEFAULT_PORT, GATEWAY_PATH } from './wiring.mjs'

export const PROVIDER_ID = 'opencode-free'
/** The gateway this bundle mounts, on DSH's default port. index.js passes the real port (wiring.mjs `gatewayBase`). */
export const BASE_URL = 'http://127.0.0.1:' + DEFAULT_PORT + GATEWAY_PATH
/** Credential ref the route's `apiKeyEnv` names; index.js stores the free tier's marker there (wiring.mjs `ensureFreeKey`). */
export const CREDENTIAL_REF = 'OPENCODE_FREE_API_KEY'

/** Pi-ai refuses a request without an apiKey; the gateway owns the real value. */
const PLACEHOLDER_ENV = 'OPENCODE_FREE_API_KEY'

/**
 * One model entry for the profile. Context and modality are conservative
 * defaults — the free tier does not publish them, so nothing is invented.
 */
const modelEntry = (id) => ({
  id,
  name: id,
  contextWindow: 262144,
  maxTokens: 65536,
  input: ['text'],
})

/**
 * Build the full provider profile for a set of free model ids.
 *
 * @param {object} opts
 * @param {string[]} opts.models          model ids to expose
 * @param {string}   [opts.baseURL]       gateway base (defaults to the local one)
 * @param {object}   [opts.existing]      prior profile, to merge non-model fields
 * @returns {object} the `providers[PROVIDER_ID]` value
 */
export const buildProfile = ({ models, baseURL, existing }) => {
  const ids = Array.isArray(models) ? models.filter((id) => typeof id === 'string' && id !== '') : []
  const base = typeof baseURL === 'string' && baseURL !== '' ? baseURL : BASE_URL
  const prior = existing !== null && typeof existing === 'object' ? existing : {}
  return {
    ...prior,
    displayName: 'Free LLMs',
    api: 'openai-completions',
    baseURL: base,
    apiKeyEnv: PLACEHOLDER_ENV,
    models: ids.map(modelEntry),
  }
}

/** Public summary of a profile for the panel: just what the UI shows. */
export const profileSummary = (profile) => {
  const p = profile !== null && typeof profile === 'object' ? profile : {}
  return {
    baseURL: typeof p.baseURL === 'string' ? p.baseURL : null,
    models: Array.isArray(p.models) ? p.models.map((m) => (m && typeof m.id === 'string' ? m.id : null)).filter(Boolean) : [],
  }
}
