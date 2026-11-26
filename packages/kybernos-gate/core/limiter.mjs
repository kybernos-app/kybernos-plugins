// Login attempt limiter.
//
// Per client: after `maxTries` failures the client is locked for `lockMs`; every further lock doubles, up to
// `maxLockMs`; a success clears the client. Failures older than `windowMs` are forgotten.
// Overall: more than `globalMax` failures from anyone inside `globalWindowMs` locks EVERYONE for `globalLockMs`,
// which bounds a distributed guess that rotates its address.
export function createLimiter ({
  now = () => Date.now(),
  maxTries = 5, lockMs = 45000, maxLockMs = 15 * 60000, windowMs = 15 * 60000,
  globalMax = 60, globalWindowMs = 10 * 60000, globalLockMs = 60000, maxKeys = 10000
} = {}) {
  const clients = new Map()
  let globalFails = []
  let globalLockedUntil = 0

  const prune = () => {
    if (clients.size <= maxKeys) return
    const t = now()
    for (const [key, e] of clients) if (e.lockedUntil <= t && t - e.lastAt > windowMs) clients.delete(key)
    // still too many live entries: drop the oldest ones rather than grow without bound
    while (clients.size > maxKeys) clients.delete(clients.keys().next().value)
  }
  const seconds = (ms) => Math.max(1, Math.ceil(ms / 1000))

  /** `{ locked: false, triesLeft }` or `{ locked: true, retryAfter }` (seconds). */
  function check (key) {
    const t = now()
    if (globalLockedUntil > t) return { locked: true, retryAfter: seconds(globalLockedUntil - t) }
    const e = clients.get(key)
    if (e === undefined) return { locked: false, triesLeft: maxTries }
    if (e.lockedUntil > t) return { locked: true, retryAfter: seconds(e.lockedUntil - t) }
    if (t - e.lastAt > windowMs) { clients.delete(key); return { locked: false, triesLeft: maxTries } }
    return { locked: false, triesLeft: Math.max(0, maxTries - e.fails) }
  }

  /** Record a failed attempt and return the state AFTER it (same shape as `check`). */
  function fail (key) {
    const t = now()
    let e = clients.get(key)
    if (e === undefined || t - e.lastAt > windowMs) e = { fails: 0, locks: e === undefined ? 0 : e.locks, lockedUntil: 0, lastAt: t }
    e.fails += 1
    e.lastAt = t
    if (e.fails >= maxTries) {
      e.locks += 1
      e.lockedUntil = t + Math.min(lockMs * 2 ** (e.locks - 1), maxLockMs)
      e.fails = 0
    }
    clients.set(key, e)
    prune()
    globalFails = globalFails.filter((at) => t - at <= globalWindowMs)
    globalFails.push(t)
    if (globalFails.length > globalMax) { globalLockedUntil = t + globalLockMs; globalFails = [] }
    return check(key)
  }

  /** A good login clears this client. */
  function succeed (key) { clients.delete(key) }

  return { check, fail, succeed, size: () => clients.size, config: { maxTries, lockMs } }
}
