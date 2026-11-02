// A model that reads pictures whose route never says so.
//
// The engine decides whether a picture may be sent from the route's own entry: `input` on the model (or `defaultInput` on the route).
// Without it the model is text-only and the engine refuses the attachment (`session/attachment-invalid`), even when the Models page
// shows the model as able to see (that badge comes from models.dev, an annotation the calls never read). Kimi K3.1 on a hand-added
// route is the case that showed it: the listing of its endpoint carries no modalities, so the entry was saved with a name and a window.
//
// This module only ADDS `input: ['text', 'image']`, and only when all of these hold:
//   · the PERSON's own layer gives the entry no `input` and its route no `defaultInput` (an explicit choice, even text-only, is never touched).
//     The resolved layer cannot say: it carries the schema's defaults on every route (`defaultInput: ['text']`, `input: []` on a model with no
//     choice), measured on the real settings service 2026-11-02;
//   · models.dev knows the model as a chat model that sees (picture in, text out: a generator or a speech model is not one), by its exact
//     key or, failing that, by its bare id with every match agreeing;
//   · its route is not one that another feature rewrites on every sync (`kybernos`, written by kybernos-cloud).
// It never removes an input and never guesses on a disagreement. The settings service does not traverse arrays, so a declared route
// (a `models` list) is rewritten whole from the USER layer, as the Models page does; a catalogue route gets a `modelOverrides` entry.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
/** An input list somebody wrote: a non-empty array. `[]` is the schema's default for « no choice » and counts as none. */
const chosen = (list) => Array.isArray(list) && list.length > 0
/** Routes another Kybernos feature writes itself: a heal here would be undone by its next sync. Same list as KB_MANAGED_ROUTES in client.js. */
const MANAGED_ROUTES = ['kybernos']
/** The bare-id table of an index, built once per index object (the index itself is left as it is). */
const bareTables = new WeakMap()

/** An id without its vendor spelling, so `k3.1-pro`, `kimi-k3.1-pro` and `moonshotai/Kimi-K3.1-Pro` meet. */
export const bareId = (id) => String(id === null || id === undefined ? '' : id)
  .toLowerCase().split('/').pop().replace(/^(kimi|moonshot|moonshotai)[-_]/, '')

/** One models.dev entry: does it read pictures in a chat? `null` when the entry does not say. */
const seesIn = (entry) => {
  if (!isObj(entry) || typeof entry.vision !== 'boolean') return null
  if (/(^|[-_/])embed/i.test(String(entry.id)) || entry.type === 'embedding') return false
  return entry.vision === true && entry.textOut !== false && entry.imageGen !== true && entry.videoGen !== true && entry.tts !== true
}

/**
 * Does models.dev say this is a chat model that reads pictures? `true` / `false`, or `null` when it does not know or its entries disagree.
 * @param {{byKey?:object,byId?:object}|null} index  the cached models.dev index (`vision` per entry)
 */
export const visionOf = (index, route, id) => {
  if (!isObj(index)) return null
  const byKey = isObj(index.byKey) ? index.byKey : {}
  const exact = byKey[route + '/' + id] || byKey[id]
  if (isObj(exact)) return seesIn(exact)
  const want = bareId(id)
  if (want === '') return null
  let table = bareTables.get(index)
  if (table === undefined) {
    table = new Map()
    for (const key of Object.keys(byKey)) {
      const verdict = seesIn(byKey[key])
      if (verdict === null) continue
      const b = bareId(key)
      if (!table.has(b)) table.set(b, new Set())
      table.get(b).add(verdict)
    }
    bareTables.set(index, table)
  }
  const seen = table.get(want)
  return seen !== undefined && seen.size === 1 ? Array.from(seen)[0] : null
}

const withImage = ['text', 'image']

/**
 * The settings writes that give a picture-reading model its `input`. Pure.
 * @param {{value:object,user:object}} view  the `llm-pi-ai` namespace as `settings.describe()` gives it: resolved and user layers
 * @param {(route:string,id:string)=>boolean|null} vision
 * @returns {Array<{route:string,ids:string[],ops:object[]}>}
 */
export const healPlan = (view, vision) => {
  const value = isObj(view) && isObj(view.value) && isObj(view.value.providers) ? view.value.providers : {}
  const user = isObj(view) && isObj(view.user) && isObj(view.user.providers) ? view.user.providers : {}
  const plan = []
  for (const route of Object.keys(value)) {
    const profile = isObj(value[route]) ? value[route] : {}
    const mine = isObj(user[route]) ? user[route] : {}
    if (chosen(mine.defaultInput) || MANAGED_ROUTES.indexOf(route) >= 0) continue
    const models = Array.isArray(profile.models) ? profile.models : []
    if (models.length > 0) {
      // Declared route: only the models the person's own list holds can be rewritten; an inherited one is left alone.
      if (!Array.isArray(mine.models)) continue
      const list = mine.models.map((e) => (isObj(e) ? { ...e } : e))
      const ids = []
      for (const entry of list) {
        if (!isObj(entry) || typeof entry.id !== 'string' || chosen(entry.input)) continue
        if (vision(route, entry.id) !== true) continue
        entry.input = withImage.slice()
        ids.push(entry.id)
      }
      if (ids.length > 0) plan.push({ route, ids, ops: [{ op: 'set', path: ['providers', route, 'models'], value: list }] })
    } else {
      // Catalogue route: only the models the person already tuned have an entry to complete; the catalogue itself is not readable here.
      const overrides = isObj(mine.modelOverrides) ? mine.modelOverrides : {}
      const ids = []
      const ops = []
      for (const id of Object.keys(overrides)) {
        if (!isObj(overrides[id]) || chosen(overrides[id].input) || vision(route, id) !== true) continue
        ids.push(id)
        ops.push({ op: 'set', path: ['providers', route, 'modelOverrides', id, 'input'], value: withImage.slice() })
      }
      if (ids.length > 0) plan.push({ route, ids, ops })
    }
  }
  return plan
}

/** The `llm-pi-ai` namespace of a `settings.describe()` answer, however the service words it. `null` when absent. */
export const llmView = (answer) => {
  let shapes = answer
  if (isObj(shapes) && isObj(shapes.value) && Array.isArray(shapes.value.namespaces)) shapes = shapes.value.namespaces
  if (!Array.isArray(shapes)) return null
  const hit = shapes.find((x) => isObj(x) && x.ns === 'llm-pi-ai')
  return hit === undefined ? null : hit
}

/**
 * One pass: read the settings, plan, write each route in its own mutation. Never throws; the outcome says what was done.
 * @param {{settings:{describe:Function,mutate:Function}|null, index:object|null, journal?:(line:object)=>void}} io
 * @returns {Promise<{healed:Array<{route:string,ids:string[]}>, failed:Array<{route:string,error:string}>, skipped?:string}>}
 */
export const healImages = async ({ settings, index, journal = () => {} }) => {
  const out = { healed: [], failed: [] }
  if (settings === null || settings === undefined || typeof settings.describe !== 'function' || typeof settings.mutate !== 'function') return { ...out, skipped: 'settings' }
  if (!isObj(index)) return { ...out, skipped: 'index' }
  let view
  try { view = llmView(await settings.describe()) } catch (e) { return { ...out, skipped: 'describe' } }
  if (view === null) return { ...out, skipped: 'namespace' }
  for (const step of healPlan(view, (route, id) => visionOf(index, route, id))) {
    try {
      await settings.mutate('llm-pi-ai', step.ops, undefined)
      out.healed.push({ route: step.route, ids: step.ids })
      journal({ kind: 'image-heal', route: step.route, ids: step.ids, ok: true })
    } catch (e) {
      out.failed.push({ route: step.route, error: String((e && e.message) || e).slice(0, 120) })
      journal({ kind: 'image-heal', route: step.route, ids: step.ids, ok: false })
    }
  }
  return out
}
