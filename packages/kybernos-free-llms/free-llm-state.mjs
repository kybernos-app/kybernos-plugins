// Pure state for the "free models on by default" decision.
//
// No I/O here: index.js reads/writes the marker file and hands values to these
// functions, so the activation rules are tested without a host.
//
// The two guardrails from the design:
//   1. The free tier may RETAIN prompts for training (OpenCode Zen terms), so a
//      first-run auto-activation records that the person was told (`acknowledged`).
//      Never silently on: `acknowledged` must be true before we wire the route.
//   2. It is one provider among many — auto-activation only runs when the person
//      has no working model of their own (no connected cloud, no key, no local),
//      so it can never become a single point of failure for someone who brought
//      their own.

export const FREE_LLM_STATE_VERSION = 1

/** The file a fresh install starts from: not wired, not acknowledged. */
export const defaultFreeLlmState = (now = new Date()) => ({
  version: FREE_LLM_STATE_VERSION,
  wired: false,
  acknowledged: false,
  autoEnabled: false,
  enabledAt: null,
})

/**
 * Whether free models should be wired at first run. True only when the person
 * brings no model of their own AND has acknowledged the prompt-retention notice.
 *
 * @param {object} state       current free-llm state
 * @param {object} opts
 * @param {boolean} opts.hasOwnModel  a cloud/key/local model already works
 * @param {boolean} opts.acknowledged person accepted the prompt-retention notice
 */
export const shouldAutoEnable = (state, { hasOwnModel, acknowledged }) => {
  if (hasOwnModel === true) return false
  if (acknowledged !== true) return false
  return state.wired !== true
}

/**
 * Record the decision. `auto` marks it came from the first-run path (so the panel
 * can say "wired automatically"), not from a manual Connect click.
 */
export const recordEnable = (state, { acknowledged, auto }, now = new Date()) => ({
  ...state,
  version: FREE_LLM_STATE_VERSION,
  wired: true,
  acknowledged: acknowledged === true || state.acknowledged === true,
  autoEnabled: auto === true,
  enabledAt: now.toISOString(),
})

/** The person turned free models off: unwire but keep the acknowledgement. */
export const recordDisable = (state) => ({
  ...state,
  version: FREE_LLM_STATE_VERSION,
  wired: false,
  autoEnabled: false,
  enabledAt: null,
})

/** Public view for the panel — no internal flags beyond what it needs. */
export const publicView = (state) => ({
  wired: state.wired === true,
  acknowledged: state.acknowledged === true,
  autoEnabled: state.autoEnabled === true,
  enabledAt: state.enabledAt || null,
})
