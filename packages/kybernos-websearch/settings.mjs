// kybernos-websearch: the settings document. Pure: it validates and fills in, the host reads and writes the file.
//
// Nothing secret lives here (keys go to DSH's credentials store). What is here is what the person chose:
// the order of the engines, which are switched on, the few addresses an engine needs, and the filters.
import { DEFAULT_ORDER, OFF_BY_DEFAULT, ENGINES } from './engines.mjs'
import { parseDomainFilter, safeUrl } from './parse.mjs'

export const LIMITS = { domainsMax: 2000, cacheMax: 60, timeoutMin: 3, timeoutMax: 60 }

const int = (v, lo, hi, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback
}

/** The domain filter as the page shows it back: `example.com, !spam.example`, normalised. */
export const joinDomains = (filter) => [...filter.allow, ...filter.block.map((d) => '!' + d)].join(', ')

/** A settings document from whatever was on disk (or posted): every field valid, every engine present. */
export const normalizeSettings = (raw) => {
  const o = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const known = new Set(ENGINES.map((e) => e.id))
  const order = []
  for (const id of Array.isArray(o.order) ? o.order : []) if (typeof id === 'string' && known.has(id) && !order.includes(id)) order.push(id)
  for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id)
  const given = o.enabled !== null && typeof o.enabled === 'object' && !Array.isArray(o.enabled) ? o.enabled : {}
  const enabled = {}
  for (const id of order) enabled[id] = typeof given[id] === 'boolean' ? given[id] : !OFF_BY_DEFAULT.includes(id)
  const text = (v, re) => (typeof v === 'string' && re.test(v.trim()) ? v.trim() : '')
  return {
    version: 1,
    order,
    enabled,
    searxngUrl: safeUrl(typeof o.searxngUrl === 'string' ? o.searxngUrl : '') || '',
    customUrl: safeUrl(typeof o.customUrl === 'string' ? o.customUrl : '') || '',
    googleCx: text(o.googleCx, /^[A-Za-z0-9:_-]{1,100}$/),
    wikiLang: text(o.wikiLang, /^[a-z]{2,3}(-[a-z]+)?$/) || 'en',
    domains: joinDomains(parseDomainFilter(typeof o.domains === 'string' ? o.domains.slice(0, LIMITS.domainsMax) : '')),
    cacheMinutes: int(o.cacheMinutes, 0, LIMITS.cacheMax, 5),
    timeoutS: int(o.timeoutS, LIMITS.timeoutMin, LIMITS.timeoutMax, 12)
  }
}

/** The fields a POST may change. Anything else in the body is ignored. */
export const EDITABLE = ['order', 'enabled', 'searxngUrl', 'customUrl', 'googleCx', 'wikiLang', 'domains', 'cacheMinutes', 'timeoutS']

/** `current` with the editable fields of `patch` laid over it, validated. `enabled` merges key by key. */
export const applyPatch = (current, patch) => {
  const base = normalizeSettings(current)
  const p = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const next = { ...base }
  for (const k of EDITABLE) {
    if (p[k] === undefined) continue
    next[k] = k === 'enabled' && p.enabled !== null && typeof p.enabled === 'object' ? { ...base.enabled, ...p.enabled } : p[k]
  }
  return normalizeSettings(next)
}
