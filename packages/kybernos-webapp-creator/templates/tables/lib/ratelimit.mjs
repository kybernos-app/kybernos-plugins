// ratelimit.mjs — a small sliding-window limiter, in memory. Pure: the clock is injected, and the number of keys it keeps is bounded.
//
// `hit(key)` counts an attempt and says whether it may go on. An attempt over the limit is refused and not counted, so the window frees up as the old attempts age out.
export function makeLimiter ({ max, windowMs, now = Date.now, maxKeys = 10000 }) {
  if (!Number.isInteger(max) || max < 1 || !Number.isInteger(windowMs) || windowMs < 1) throw new Error('limiter: max and windowMs are whole numbers above zero')
  const seen = new Map()

  const fresh = (stamps, t) => { while (stamps.length > 0 && stamps[0] <= t - windowMs) stamps.shift(); return stamps }
  const make = (t) => {
    if (seen.size < maxKeys) return
    for (const [k, stamps] of seen) if (fresh(stamps, t).length === 0) seen.delete(k)
    if (seen.size >= maxKeys) seen.delete(seen.keys().next().value)
  }

  return {
    /** `{ ok: true, remaining }`, or `{ ok: false, retryAfterSec }`. */
    hit (key) {
      const t = now()
      let stamps = seen.get(key)
      if (stamps === undefined) { make(t); stamps = []; seen.set(key, stamps) }
      fresh(stamps, t)
      if (stamps.length >= max) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((stamps[0] + windowMs - t) / 1000)) }
      stamps.push(t)
      return { ok: true, remaining: max - stamps.length }
    },
    reset (key) { seen.delete(key) },
    size: () => seen.size,
  }
}
