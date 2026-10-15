// Interface translation as a job the HOST runs, not a tab.
//
// The Language page used to run the whole translation inside the browser tab: close the tab and it stopped, a rate limit
// stopped it after three failed batches, nothing said when it was done. Here the host owns the run:
//
//   · the page hands the strings to translate over once (POST /kybernos/i18n-job { op: 'start', … });
//   · the host translates them in batches (3 in flight, 2 passes), retries a transient failure with backoff and jitter,
//     stops on a failure that waiting cannot fix (no key, no model, quota) or after three batches in a row that kept
//     failing, and writes every batch to the on-disk store (i18n-store.mjs) as it lands;
//   · the plan and the progress live in <i18n dir>/jobs/<lang>.plan.json and .state.json, written atomically, so a DSH
//     that is killed mid-run picks the run up where the disk says it was (at the next boot, unless the person switched
//     the automatic resume off), and a tab that is closed changes nothing;
//   · the answer is a state the page (or any tab) can read: running, pausing, paused, failed, partial, done, plus
//     `acked`: a finished run is announced until somebody acknowledges it.
//
// What is DONE is read from the store itself (a text that is there and is not a test mark), never from a counter, so
// resuming after any interruption cannot double-count or re-translate. Pure node:fs, the model call and the clock are
// injected: the whole thing is exercised without a DSH (test-i18n-job.mjs), including the failures.
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_ID } from './i18n-store.mjs'

export const JOB_VERSION = 1
export const AREAS = ['core', 'more', 'phrases']
export const BATCH_SIZE = 40
export const CHAR_BUDGET = 2600
export const CONCURRENCY = 3
export const PASSES = 2
/** Waits before the 2nd, 3rd and 4th attempt of one batch (jittered ±25 %). */
export const RETRY_DELAYS_MS = [2000, 6000, 15000]
/** Batches in a row that failed after all their attempts: the cause is the model or the host, not one batch. */
export const BREAKER = 3
export const LIMITS = { items: 40000, text: 6000, wire: 300, langName: 60, body: 16 * 1024 * 1024 }
export const RESERVED = ['en', 'kybernos']

// A failure no amount of waiting fixes: the person has to act (a key, a model, an update).
// The codes are matched as the host writes them (upper case): a provider's own words ("quota per minute") are not codes.
const FATAL_CODE = /\b(MISSING_CREDENTIAL|INVALID_CREDENTIAL|AUTH|QUOTA|ACCOUNT_QUOTA|NO_ADAPTER|ROUTE_ABSENT)\b/
const FATAL_TEXT = /aucun modele disponible|service llm indisponible|code de langue invalide/i

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v) => typeof v === 'string' && v.length > 0
const errText = (e) => (e && e.message ? String(e.message) : String(e))
/** A text wrapped in ⟦…⟧ is a pseudo-translation written by a test run: never a real translation. */
export const isTestMark = (v) => typeof v === 'string' && v.length > 2 && v.charAt(0) === '⟦' && v.charAt(v.length - 1) === '⟧'
export const holds = (v) => typeof v === 'string' && v !== '' && !isTestMark(v)
export const isFatal = (error) => { const e = String(error === undefined || error === null ? '' : error); return FATAL_CODE.test(e) || FATAL_TEXT.test(e) }

/** Pure. Items → batches of at most BATCH_SIZE strings and CHAR_BUDGET characters (a truncated JSON answer is lost whole). */
export function planBatches(items, size = BATCH_SIZE, budget = CHAR_BUDGET) {
  const batches = []
  let cur = []
  let len = 0
  for (const it of items) {
    if (cur.length >= size || (cur.length > 0 && len + it.text.length > budget)) { batches.push(cur); cur = []; len = 0 }
    cur.push(it)
    len += it.text.length
  }
  if (cur.length > 0) batches.push(cur)
  return batches
}

/** "kb:some.key" → { section: 'kb', id: 'some.key' }, or null. Only the Kybernos and DSH dictionaries are translated by a job. */
export function splitWire(wire) {
  if (typeof wire !== 'string') return null
  const i = wire.indexOf(':')
  if (i <= 0) return null
  const section = wire.slice(0, i)
  const id = wire.slice(i + 1)
  if ((section !== 'kb' && section !== 'dsh') || id === '' || id.length > LIMITS.wire) return null
  return { section, id }
}

/** Pure. A start request, checked and cleaned: { ok, spec } or { ok:false, error }. */
export function sanitizeStart(body) {
  if (!plain(body)) return { ok: false, error: 'invalid body' }
  const lang = typeof body.lang === 'string' ? body.lang : ''
  if (!STORE_ID.test(lang) || RESERVED.indexOf(lang) >= 0) return { ok: false, error: 'invalid language id' }
  if (!Array.isArray(body.items) || body.items.length === 0) return { ok: false, error: 'nothing to translate' }
  if (body.items.length > LIMITS.items) return { ok: false, error: 'too many texts' }
  const items = []
  const seen = new Set()
  for (const raw of body.items) {
    if (!plain(raw) || splitWire(raw.wire) === null || !text(raw.text) || raw.text.length > LIMITS.text || AREAS.indexOf(raw.area) < 0) return { ok: false, error: 'invalid item' }
    if (seen.has(raw.wire)) continue
    seen.add(raw.wire)
    items.push({ wire: raw.wire, text: raw.text, area: raw.area })
  }
  const total = Number.isInteger(body.total) && body.total >= items.length && body.total <= LIMITS.items * 2 ? body.total : items.length
  const baseAreas = {}
  for (const a of AREAS) {
    const inItems = items.filter((i) => i.area === a).length
    const given = plain(body.areas) && plain(body.areas[a]) ? body.areas[a] : {}
    const areaTotal = Number.isInteger(given.total) && given.total >= inItems ? given.total : inItems
    const areaDone = Number.isInteger(given.done) && given.done >= 0 && given.done <= areaTotal - inItems ? given.done : areaTotal - inItems
    baseAreas[a] = { total: areaTotal, done: areaDone }
  }
  let route = null
  if (plain(body.route) && text(body.route.provider) && text(body.route.model) && body.route.provider.length <= 200 && body.route.model.length <= 200) route = { provider: body.route.provider, model: body.route.model }
  const langName = typeof body.langName === 'string' ? body.langName.slice(0, LIMITS.langName) : ''
  return { ok: true, spec: { lang, langName, source: body.source === 'auto' ? 'auto' : 'fr', route, items, total, baseAreas } }
}

/**
 * @param {{ dir: string, store: object, translate: (args: object) => Promise<object>, now?: () => number,
 *           sleep?: (ms: number) => Promise<void>, random?: () => number, retryDelays?: number[], concurrency?: number,
 *           log?: (line: string) => void }} o
 *   dir = <DSH home>/kybernos/i18n (the folder the store reads); store = createI18nStore({ dir }).
 *   translate({ lang, langName, source, provider, model, batch, signal }) → { ok, translations, provider, model } | { ok:false, error }
 */
export function createJobRunner(o) {
  const dir = join(o.dir, 'jobs')
  const store = o.store
  const translate = o.translate
  const now = o.now || (() => Date.now())
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const random = o.random || Math.random
  const retryDelays = Array.isArray(o.retryDelays) ? o.retryDelays : RETRY_DELAYS_MS
  const concurrency = Number.isInteger(o.concurrency) && o.concurrency > 0 ? o.concurrency : CONCURRENCY
  const log = o.log || (() => {})
  const live = new Map() // lang -> { stop: null | 'pause' | 'cancel', controller, done: Promise }

  const planFile = (lang) => join(dir, lang + '.plan.json')
  const stateFile = (lang) => join(dir, lang + '.state.json')
  const writeAtomic = (file, value) => {
    mkdirSync(dir, { recursive: true })
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(value))
    renameSync(tmp, file)
  }
  const readJson = (file) => { try { const v = JSON.parse(readFileSync(file, 'utf8')); return plain(v) ? v : null } catch (e) { return null } }
  const readState = (lang) => readJson(stateFile(lang))
  const writeState = (st) => { st.updatedAt = now(); try { writeAtomic(stateFile(st.lang), st) } catch (e) { log('job state not written: ' + errText(e)) } }

  const summary = (st) => ({
    lang: st.lang, state: st.state, done: st.done, total: st.total, missing: Math.max(0, st.total - st.done),
    areas: st.areas, model: st.model, error: st.error, startedAt: st.startedAt, updatedAt: st.updatedAt,
    // The window of THIS go (a resume starts a new one): what the page needs for « minutes left ».
    runAt: st.runAt, runFrom: st.runFrom,
    finishedAt: st.finishedAt, outcome: st.outcome, acked: st.acked, interrupted: st.interrupted === true,
  })

  const sectionOf = (pack, section) => (section === 'dsh' ? pack.dsh : pack.kb)

  /** The loop of one job. Never throws: whatever goes wrong ends in a `failed` state the page can show. */
  const run = async (lang) => {
    const entry = live.get(lang)
    const plan = readJson(planFile(lang))
    const st = readState(lang)
    if (plan === null || st === null || !Array.isArray(plan.items)) {
      if (st !== null) { st.state = 'failed'; st.error = 'the plan of this run is gone'; st.finishedAt = now(); st.outcome = 'failed'; st.acked = false; writeState(st) }
      live.delete(lang)
      return
    }
    try {
      const pack = store.read(lang) || { kb: Object.create(null), dsh: Object.create(null), meta: {} }
      const items = plan.items.map((it) => Object.assign({}, it, splitWire(it.wire)))
      const has = (it) => holds(sectionOf(pack, it.section)[it.id])
      const recount = () => {
        const areas = {}
        for (const a of AREAS) areas[a] = { total: plan.baseAreas[a].total, done: plan.baseAreas[a].done }
        let held = 0
        for (const it of items) if (has(it)) { areas[it.area].done += 1; held += 1 }
        return { areas, done: Math.min(plan.total, plan.doneBefore + held) }
      }
      let route = st.route
      const base = recount()
      st.state = 'running'; st.areas = base.areas; st.done = base.done; st.error = null; st.finishedAt = null; st.outcome = null; st.acked = true; st.interrupted = false
      st.runAt = now(); st.runFrom = base.done
      writeState(st)

      let fatal = null
      let lastError = null
      let chain = Promise.resolve()
      const removedSince = () => { try { const t = store.removed(); return typeof t[lang] === 'number' && t[lang] >= st.startedAt } catch (e) { return false } }

      // One batch: attempts with backoff while the failure is a transient one.
      const translateBatch = async (batch) => {
        const wire = {}
        for (const it of batch) wire[it.wire] = it.text
        for (let attempt = 0; ; attempt += 1) {
          if (entry.stop !== null) return { aborted: true }
          const r = await translate({
            lang, langName: plan.langName, source: plan.source,
            provider: route === null ? undefined : route.provider, model: route === null ? undefined : route.model,
            batch: wire, signal: entry.controller.signal,
          })
          if (r !== null && typeof r === 'object' && r.ok === true && plain(r.translations)) return r
          const error = r !== null && typeof r === 'object' && typeof r.error === 'string' ? r.error : 'unexpected answer'
          if (entry.stop !== null) return { aborted: true }
          if (isFatal(error)) return { fatal: true, error }
          if (attempt >= retryDelays.length) return { ok: false, error }
          const wait = retryDelays[attempt] * (0.75 + random() * 0.5)
          await sleep(wait)
        }
      }

      // The write of a landed batch: serialised (three workers, one file), and the progress it earns goes with it.
      const land = (batch, result) => {
        chain = chain.then(() => {
          const patch = { kb: {}, dsh: {} }
          const fresh = []
          for (const it of batch) {
            const v = result.translations[it.wire]
            if (typeof v !== 'string' || v.trim() === '' || has(it)) continue
            patch[it.section][it.id] = v.trim()
            fresh.push(it)
          }
          if (fresh.length === 0) return
          // The disk first: a text only counts once the store has it (a refused write must not read as progress).
          const w = store.write(lang, { kb: patch.kb, dsh: patch.dsh })
          if (w.ok !== true) { if (fatal === null) fatal = 'STORE_WRITE : ' + String(w.error); return }
          for (const it of fresh) sectionOf(pack, it.section)[it.id] = patch[it.section][it.id]
          const counted = recount()
          store.write(lang, { meta: { complete: counted.done >= plan.total, total: plan.total, done: counted.done, essentials: counted.areas.core.done >= counted.areas.core.total, at: now() } })
          st.areas = counted.areas; st.done = counted.done
          st.model = typeof result.provider === 'string' && typeof result.model === 'string' ? result.provider + '/' + result.model : st.model
          writeState(st)
        }).catch((e) => { if (fatal === null) fatal = 'STORE_WRITE : ' + errText(e) })
        return chain
      }

      let breaker = null
      for (let pass = 0; pass < PASSES && entry.stop === null && fatal === null && breaker === null; pass += 1) {
        const missing = []
        for (const a of AREAS) for (const it of items) if (it.area === a && !has(it)) missing.push(it)
        if (missing.length === 0) break
        const queue = planBatches(missing)
        let next = 0
        let failedInARow = 0
        const worker = async () => {
          while (entry.stop === null && fatal === null && breaker === null) {
            const i = next
            next += 1
            if (i >= queue.length) return
            if (removedSince()) { entry.stop = 'cancel'; return }
            const result = await translateBatch(queue[i])
            if (result.aborted === true) return
            if (result.fatal === true) { if (fatal === null) fatal = result.error; return }
            if (result.ok !== true) {
              lastError = result.error
              failedInARow += 1
              if (failedInARow >= BREAKER && breaker === null) breaker = lastError
              continue
            }
            failedInARow = 0
            if (typeof result.provider === 'string' && typeof result.model === 'string') route = { provider: result.provider, model: result.model }
            await land(queue[i], result)
          }
        }
        await Promise.all(Array.from({ length: concurrency }, worker))
        await chain
      }

      // Final state. The disk is the truth: count again from the pack, not from the counters.
      const finalCount = recount()
      st.areas = finalCount.areas
      st.done = finalCount.done
      st.route = route
      if (entry.stop === 'cancel') {
        try { rmSync(planFile(lang), { force: true }); rmSync(stateFile(lang), { force: true }) } catch (e) { /* nothing to clean */ }
        live.delete(lang)
        return
      }
      if (entry.stop === 'pause') { st.state = 'paused'; st.acked = true }
      else if (fatal !== null || breaker !== null) { st.state = 'failed'; st.error = fatal !== null ? fatal : breaker; st.finishedAt = now(); st.outcome = 'failed'; st.acked = false }
      else if (finalCount.done === plan.doneBefore && items.length > 0 && finalCount.done < plan.total) { st.state = 'failed'; st.error = lastError || 'no text was translated'; st.finishedAt = now(); st.outcome = 'failed'; st.acked = false }
      else if (finalCount.done < plan.total) { st.state = 'partial'; st.finishedAt = now(); st.outcome = 'partial'; st.acked = false }
      else { st.state = 'done'; st.finishedAt = now(); st.outcome = 'done'; st.acked = false }
      writeState(st)
      // Leave the bilan the page reads (done / total / complete) in step with the final count.
      try { store.write(lang, { meta: { complete: finalCount.done >= plan.total, total: plan.total, done: finalCount.done, essentials: finalCount.areas.core.done >= finalCount.areas.core.total, at: now() } }) } catch (e) { /* the state file has it */ }
    } catch (e) {
      const cur = readState(lang) || st
      cur.state = 'failed'; cur.error = 'JOB_CRASHED : ' + errText(e); cur.finishedAt = now(); cur.outcome = 'failed'; cur.acked = false
      writeState(cur)
      log('job ' + lang + ' crashed: ' + errText(e))
    } finally {
      live.delete(lang)
    }
  }

  const launch = (lang) => {
    const entry = { stop: null, controller: new AbortController(), done: null }
    live.set(lang, entry)
    entry.done = run(lang)
    return entry
  }

  const running = () => Array.from(live.keys())

  return {
    /** Start a run (idempotent for a language that already runs). */
    start(body) {
      const v = sanitizeStart(body)
      if (v.ok !== true) return v
      const spec = v.spec
      if (live.has(spec.lang)) return { ok: true, attached: true, job: summary(readState(spec.lang)) }
      const other = running().find((l) => l !== spec.lang)
      if (other !== undefined) return { ok: false, error: 'busy', lang: other }
      const doneBefore = Math.max(0, spec.total - spec.items.length)
      try {
        writeAtomic(planFile(spec.lang), { version: JOB_VERSION, lang: spec.lang, langName: spec.langName, source: spec.source, total: spec.total, doneBefore, baseAreas: spec.baseAreas, items: spec.items })
      } catch (e) { return { ok: false, error: 'could not write the plan: ' + errText(e) } }
      const st = {
        version: JOB_VERSION, lang: spec.lang, state: 'running', total: spec.total, done: doneBefore, areas: spec.baseAreas, model: spec.route === null ? null : spec.route.provider + '/' + spec.route.model,
        route: spec.route, error: null, startedAt: now(), updatedAt: now(), finishedAt: null, outcome: null, acked: true, interrupted: false,
      }
      writeState(st)
      launch(spec.lang)
      return { ok: true, attached: false, job: summary(st) }
    },
    /** Ask a run to stop after the batches in flight (they are aborted, and what already landed is kept). */
    pause(lang) {
      const e = live.get(lang)
      if (e === undefined) { const st = readState(lang); return st === null ? { ok: false, error: 'no such job' } : { ok: true, job: summary(st) } }
      if (e.stop === null) {
        e.stop = 'pause'
        try { e.controller.abort() } catch (err) { /* already finished */ }
        const st = readState(lang)
        if (st !== null) { st.state = 'pausing'; writeState(st) }
      }
      const st = readState(lang)
      return { ok: true, job: st === null ? null : summary(st) }
    },
    /** Continue a paused, failed, partial or interrupted run from what the disk holds. */
    resume(lang) {
      if (!STORE_ID.test(String(lang))) return { ok: false, error: 'invalid language id' }
      if (live.has(lang)) return { ok: true, attached: true, job: summary(readState(lang)) }
      const st = readState(lang)
      if (st === null || readJson(planFile(lang)) === null) return { ok: false, error: 'no such job' }
      const other = running().find((l) => l !== lang)
      if (other !== undefined) return { ok: false, error: 'busy', lang: other }
      st.state = 'running'; st.error = null; st.finishedAt = null; st.outcome = null; st.acked = true
      writeState(st)
      launch(lang)
      return { ok: true, attached: false, job: summary(st) }
    },
    /** Stop a run and forget it. What was translated stays in the store. */
    cancel(lang) {
      const e = live.get(lang)
      if (e !== undefined) {
        e.stop = 'cancel'
        try { e.controller.abort() } catch (err) { /* already finished */ }
        return { ok: true }
      }
      try { rmSync(planFile(lang), { force: true }); rmSync(stateFile(lang), { force: true }) } catch (err) { /* nothing to clean */ }
      return { ok: true }
    },
    /** Somebody saw how it ended: stop announcing it. */
    ack(lang) {
      const st = readState(lang)
      if (st === null) return { ok: true }
      if (st.acked !== true) { st.acked = true; writeState(st) }
      return { ok: true, job: summary(st) }
    },
    /** One job, or all of them (cheap: small state files). */
    status(lang) {
      if (typeof lang === 'string' && lang !== '') { const st = readState(lang); return st === null ? null : summary(st) }
      let names = []
      try { names = readdirSync(dir) } catch (e) { return [] }
      const out = []
      for (const n of names.sort()) {
        const m = /^([a-z]{2,3}(?:-[A-Za-z0-9]{1,8})?)\.state\.json$/.exec(n)
        if (m === null) continue
        const st = readState(m[1])
        if (st !== null) out.push(summary(st))
      }
      return out
    },
    /**
     * At boot: a run the previous process left `running` was interrupted. With `auto` it goes on by itself (the same
     * default as the page's automatic resume); without, it is marked paused and waits for a click.
     */
    resumeInterrupted({ auto }) {
      const done = []
      for (const st of this.status()) {
        if (st.state !== 'running' && st.state !== 'pausing') continue
        if (live.has(st.lang)) continue
        if (auto === true && done.length === 0) {
          const r = this.resume(st.lang)
          if (r.ok === true) { done.push({ lang: st.lang, resumed: true }); continue }
          // Nothing to go on from (the plan is gone): say so rather than leave it « running » for ever.
          const cur = readState(st.lang)
          if (cur !== null) { cur.state = 'failed'; cur.error = 'could not resume: ' + r.error; cur.finishedAt = now(); cur.outcome = 'failed'; cur.acked = false; writeState(cur) }
          done.push({ lang: st.lang, resumed: false })
          continue
        }
        const cur = readState(st.lang)
        if (cur !== null) { cur.state = 'paused'; cur.interrupted = true; cur.acked = true; writeState(cur) }
        done.push({ lang: st.lang, resumed: false })
      }
      return done
    },
    /** Resolves when every loop that runs now has ended (tests). */
    async idle() { while (live.size > 0) await Promise.all(Array.from(live.values()).map((e) => e.done)) },
    running,
  }
}

export const MAX_BODY_BYTES = LIMITS.body

/**
 * The route, with the host's helpers handed in (`io`) so it can be tested without the host:
 *   GET [?lang=ar]                         → { ok, jobs: [summary] } or { ok, job }
 *   POST { op: 'start', lang, langName?, source?, route?, items: [{ wire, text, area }], total?, areas? }
 *   POST { op: 'pause' | 'resume' | 'cancel' | 'ack', lang }
 * io = { runner(): runner|null, sameOriginStrict(req), sameOriginLax(req), readJson(req, maxBytes), query(req), send(res, status, body) }
 */
export async function serveJobs(req, res, io) {
  if (req.method !== 'GET' && req.method !== 'POST') return io.send(res, 405, { ok: false, error: 'GET or POST expected' })
  if ((req.method === 'POST' ? io.sameOriginStrict(req) : io.sameOriginLax(req)) === false) return io.send(res, 403, { ok: false, error: 'origin refused' })
  try {
    const runner = await io.runner()
    if (runner === null || runner === undefined) return io.send(res, 200, { ok: false, error: 'DSH home not found' })
    if (req.method === 'GET') {
      const lang = io.query(req).get('lang')
      if (typeof lang === 'string' && lang !== '') {
        if (!STORE_ID.test(lang)) return io.send(res, 400, { ok: false, error: 'invalid language id' })
        return io.send(res, 200, { ok: true, job: runner.status(lang) })
      }
      return io.send(res, 200, { ok: true, jobs: runner.status() })
    }
    let body = null
    try { body = await io.readJson(req, MAX_BODY_BYTES) } catch (e) { return io.send(res, 413, { ok: false, error: 'request body too large' }) }
    if (!plain(body) || typeof body.op !== 'string') return io.send(res, 400, { ok: false, error: 'unknown op' })
    if (body.op === 'start') { const r = runner.start(body); return io.send(res, r.ok === true ? 200 : (r.error === 'busy' ? 409 : 400), r) }
    const lang = typeof body.lang === 'string' ? body.lang : ''
    if (!STORE_ID.test(lang)) return io.send(res, 400, { ok: false, error: 'invalid language id' })
    if (body.op === 'pause') return io.send(res, 200, runner.pause(lang))
    if (body.op === 'resume') { const r = runner.resume(lang); return io.send(res, r.ok === true ? 200 : (r.error === 'busy' ? 409 : 404), r) }
    if (body.op === 'cancel') return io.send(res, 200, runner.cancel(lang))
    if (body.op === 'ack') return io.send(res, 200, runner.ack(lang))
    return io.send(res, 400, { ok: false, error: 'unknown op' })
  } catch (e) {
    // The page treats any non-ok answer as "no host job": never let a host fault escape the route.
    return io.send(res, 500, { ok: false, error: 'i18n job failed: ' + errText(e) })
  }
}
