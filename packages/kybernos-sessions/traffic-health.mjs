// traffic-health.mjs — model liveness read from what really happened, never from a paid ping.
//
// Why this file exists (2026-10-28): the « Study model » watch probed EVERY configured model with a real chat
// completion (`brain-health.mjs`, 1 output token each), including the models of the Kybernos provider — which
// points at our own gateway. One sweep was 78 paid calls, at every boot and every five hours. A model's health
// is already in the session events the harness writes: a real call that answered is a proof of life, a retry is
// a hint of trouble. This module turns that journal into the same verdict the banner shows, for free.
//
// Rules, all deliberate and all tested in test-traffic-health.mjs:
//  - a model nobody calls is `unknown`, NEVER « down » (silence is not a failure);
//  - only a real answer (`llm/answer`) proves life; a retry alone proves nothing but a doubt;
//  - the window is the person's last 24 h by default, and older events are ignored;
//  - a provider we must not pay to ping (our own gateway, `kybernos`) is excluded by name, and an operator can
//    extend the list with KB_NO_PROBE_PROVIDERS (comma separated).

export const DEFAULT_EXCLUDED = ['kybernos']

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/** `provider/model` → `provider`; anything else → ''. */
export const providerOf = (route) => {
  const s = typeof route === 'string' ? route : ''
  const i = s.indexOf('/')
  return i > 0 ? s.slice(0, i) : ''
}

/** The providers the probe must never call: our own gateway by default, plus whatever the operator adds. */
export const excludedFrom = (env = process.env) => {
  const set = new Set(DEFAULT_EXCLUDED)
  const extra = typeof env?.KB_NO_PROBE_PROVIDERS === 'string' ? env.KB_NO_PROBE_PROVIDERS : ''
  for (const name of extra.split(',')) {
    const clean = name.trim().toLowerCase()
    if (clean !== '') set.add(clean)
  }
  return set
}

/** Split a model list into what may be probed and what is left alone (with the reason, so the answer can say it). */
export const filterProbeable = (models, excluded = new Set(DEFAULT_EXCLUDED)) => {
  const probe = []
  const skipped = []
  for (const raw of Array.isArray(models) ? models : []) {
    const route = typeof raw === 'string' ? raw.trim() : ''
    if (route === '') continue
    const provider = providerOf(route)
    if (provider !== '' && excluded.has(provider.toLowerCase())) { skipped.push({ cle: route, raison: 'exclu-' + provider }); continue }
    probe.push(route)
  }
  return { probe, skipped }
}

/**
 * The verdict the banner can show, from journal records: one entry per `provider/model` seen in the window.
 * `state`: `ok` (a real answer), `suspect` (the last thing seen was a retry), `unknown` (no traffic at all).
 */
export const trafficHealth = (events, { now = Date.now(), windowMs = 24 * 3600 * 1000, maxModels = 200 } = {}) => {
  const since = now - Math.max(60_000, windowMs)
  const byModel = new Map()
  for (const r of Array.isArray(events) ? events : []) {
    if (!isObj(r) || r.type !== 'llm') continue
    const at = typeof r.at === 'number' ? r.at : 0
    if (at < since) continue
    const provider = typeof r.provider === 'string' ? r.provider : ''
    const model = typeof r.model === 'string' ? r.model : ''
    if (provider === '' || model === '') continue
    const cle = provider + '/' + model
    let entry = byModel.get(cle)
    if (entry === undefined) {
      entry = { cle, provider, model, calls: 0, tokens: 0, lastOkAt: null, lastErrorAt: null, lastError: null }
      byModel.set(cle, entry)
    }
    if (r.kind === 'answer') {
      entry.calls += 1
      entry.tokens += num(r.input) + num(r.output) + num(r.cache)
      entry.lastOkAt = Math.max(entry.lastOkAt ?? 0, at)
    } else if (r.kind === 'retry') {
      entry.lastErrorAt = Math.max(entry.lastErrorAt ?? 0, at)
      entry.lastError = typeof r.error === 'string' ? r.error : (typeof r.detail === 'string' ? r.detail : 'retry')
    }
  }
  const models = Array.from(byModel.values())
    .map((e) => ({
      ...e,
      state: e.lastOkAt === null
        ? (e.lastErrorAt === null ? 'unknown' : 'suspect')
        : (e.lastErrorAt !== null && e.lastErrorAt > e.lastOkAt ? 'suspect' : 'ok')
    }))
    .sort((a, b) => (b.lastOkAt ?? 0) - (a.lastOkAt ?? 0))
    .slice(0, maxModels)
  const sains = models.filter((m) => m.state === 'ok').length
  return {
    source: 'trafic',
    verifieA: new Date(now).toISOString(),
    fenetreHeures: Math.round(windowMs / 3600_000),
    modeles: models,
    total: models.length,
    sains,
    suspects: models.filter((m) => m.state === 'suspect').length,
    inconnus: models.filter((m) => m.state === 'unknown').length,
    // Nothing to accuse: no traffic, or every model that was used answered.
    tousEnEchec: models.length > 0 && sains === 0 && models.every((m) => m.state === 'suspect')
  }
}

/** The journal's last lines, parsed and tolerant: a torn tail line or a missing file is an empty read, never a throw. */
export const readTrafficFile = (file, { readFile, maxLines = 5000 } = {}) => {
  try {
    const raw = readFile(file)
    const lines = String(raw).split('\n')
    const tail = lines.slice(Math.max(0, lines.length - maxLines))
    const out = []
    for (const line of tail) {
      if (line.length < 2) continue
      try { out.push(JSON.parse(line)) } catch (e) { /* a torn tail line is normal after a crash */ }
    }
    return out
  } catch (e) {
    return []
  }
}
