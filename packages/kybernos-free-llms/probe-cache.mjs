// A short memory for the free tier's health probe.
//
// The Free LLMs page asks whether the free tier answers BEFORE it offers to connect (audit A3-14): when OpenCode Zen
// locks the tier (HTTP 403 free_tier_locked), the models of the catalogue are still listed and a person who connects gets
// models that cannot answer. Opening the page must stay cheap, so the probe (one 8-token chat call) is remembered for a
// few minutes, and two pages opened together share one call. « Re-check » asks for a FRESH one.
//
// Pure: the probe, the clock and the memory are handed in.

export const PROBE_TTL_MS = 5 * 60 * 1000

/** Answers worth remembering: a verdict of the tier. A network failure says nothing about the tier and is asked again. */
const remembered = (v) => v !== null && typeof v === 'object' && v.code !== 'network' && v.code !== 'no_model'

/**
 * run   async () => { ok, code, status?, model? }     one real probe
 * now   () => ms
 * Returns { get({ fresh }) } : the last verdict when it is younger than ttlMs (and `fresh` is not asked), else a new one.
 * The answer carries `checkedAt` (ISO) and `cached` (boolean).
 */
export const createProbeCache = ({ run, now = Date.now, ttlMs = PROBE_TTL_MS }) => {
  let last = null
  let inflight = null
  const stamp = (value, at, cached) => Object.assign({}, value, { checkedAt: new Date(at).toISOString(), cached })
  return {
    get: async ({ fresh = false } = {}) => {
      if (fresh !== true && last !== null && now() - last.at < ttlMs) return stamp(last.value, last.at, true)
      if (inflight === null) {
        inflight = (async () => {
          try {
            const value = await run()
            const at = now()
            if (remembered(value) === true) last = { at, value }
            return { value, at }
          } finally { inflight = null }
        })()
      }
      const done = await inflight
      return stamp(done.value, done.at, false)
    },
  }
}
