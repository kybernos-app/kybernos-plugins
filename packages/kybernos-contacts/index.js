// kybernos-contacts — host half.
//
// This release is the frame: the point `kybernos/contacts#schema` is opened for the themes that extend it, and nothing else runs yet (the page, the routes
// and the agent tools arrive with the next lots of the business plugins). A broken or missing registry never stops DSH from starting.
import { CONTACTS_POINT } from './contacts-schema.mjs'

export const name = 'kybernos-contacts'

// ── telling the registry (the SAME text in the three business plugins; scripts/test-business-points.mjs compares them) ────────────────────────
const registrySeam = () => { try { const r = globalThis[Symbol.for('kybernos.registry')]; return r !== undefined && r !== null && r.version === 1 ? r : null } catch (e) { return null } }

/** Tells the registry the point this plugin owns. `true` when the registry was there to hear it (telling it twice changes nothing). */
export const tellPoint = () => {
  try {
    const registry = registrySeam()
    if (registry === null) return false
    registry.definePoint(CONTACTS_POINT)
    return true
  } catch (e) { return false }
}

/**
 * Tells the point now, and again after each delay until the registry has heard it: the registry mounts when DSH decides, maybe after this plugin
 * (measured in a sandbox: at boot the seam was not there yet, and nothing asked a question later). Never throws; the timers never hold DSH open.
 * `options.schedule` and `options.delays` are for the test.
 */
export function tellWhenReady (options = {}) {
  const schedule = options.schedule || setTimeout
  const delays = Array.isArray(options.delays) ? options.delays : [500, 1500, 4000, 10000, 30000]
  let told = tellPoint()
  let tries = 0
  const next = () => {
    if (told || tries >= delays.length) return
    const timer = schedule(() => { told = tellPoint(); next() }, delays[tries++])
    if (timer !== undefined && timer !== null && typeof timer.unref === 'function') timer.unref()
  }
  next()
  return () => told
}
// ── end of the telling ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function apply (ctx, options) {
  try {
    tellWhenReady(options)
  } catch (e) {
    console.log('[kybernos-contacts] disabled: ' + String(e && e.message ? e.message : e))
  }
}
