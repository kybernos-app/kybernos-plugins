// Host half of the interface translation: POST /kybernos/i18n-translate (one
// batch of French strings -> target language) and GET /kybernos/i18n-models (the
// models the user can pick). Pure logic with injected dependencies, so it is
// tested with a fake LLM stream; the route wiring stays in index.js.
//
// Why a dedicated module: `llm.stream` never throws on a provider failure. It
// ends with a terminal `finish` chunk whose `reason` is
// `{ kind: 'error' | 'aborted', failure: { code, message } }`. The first version
// of the route only read `text-delta` chunks, so a missing credential or an
// unregistered adapter came back as an empty answer ("unusable model response",
// raw: "") and the real cause was lost — the page then counted every failed batch
// as translated.

import { explain, inspect } from './i18n-quality.mjs'

export const I18N_BATCH_MAX = 40
const REFUSED_LABEL = { placeholder: 'variable lost or changed', tags: 'tags changed', url: 'address changed', code: 'code changed', numbers: 'numbers changed', meta: 'model sentence added', script: 'wrong script', length: 'inconsistent length', empty: 'vide' }
const ATTEMPT_TIMEOUT_MS = 120000

const LANG_NAMES = {
  ar: 'into Arabic (العربية, right-to-left reading direction)',
  es: 'en espagnol', de: 'en allemand', it: 'en italien', pt: 'en portugais',
  nl: 'into Dutch', ja: 'en japonais', ko: 'into Korean', zh: 'en chinois',
  he: 'into Hebrew (right-to-left)', fa: 'into Persian (right-to-left)',
  ur: 'into Urdu (right-to-left)', ru: 'en russe', tr: 'en turc', hi: 'en hindi',
}

// "This model cannot be used from here": the next candidate may work. Anything
// else (rate limit, timeout, malformed answer) is reported as it is — switching
// model would only mix translation styles inside one language.
const NEXT_CANDIDATE_CODES = new Set(['NO_ADAPTER', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'AUTH', 'QUOTA', 'ACCOUNT_QUOTA'])

const text = (v) => (typeof v === 'string' ? v.trim() : '')
const errText = (e) => (e && e.message ? String(e.message) : String(e))

// Variables a translation must carry over untouched: {name}, %s / %d, {{x}}.
// DSH dictionaries are full of them ("{count} files"): a model that translates or
// drops one breaks the sentence at runtime, so such a translation is rejected and
// the string stays untranslated (the page retries it) rather than shown broken.
const PLACEHOLDER = /\{\{?\w+\}?\}|%[sd]/g
export const placeholdersOf = (s) => (String(s).match(PLACEHOLDER) || []).sort().join('|')
export const placeholdersMatch = (source, translated) => placeholdersOf(source) === placeholdersOf(translated)

// A language name sent by the page ("Spanish", "Português (Brasil)") ends up in
// the prompt: keep letters, marks, spaces and a little punctuation, cap the length.
export const cleanLangName = (v) => (typeof v === 'string' ? v.replace(/[^\p{L}\p{M}\s'’().-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60) : '')

// `brain` setting is "provider/model".
export const splitRoute = (key) => {
  const v = text(key)
  const i = v.indexOf('/')
  if (i <= 0 || i === v.length - 1 || v.length > 200) return null
  return { provider: v.slice(0, i), model: v.slice(i + 1) }
}

// The catalog is `{ providers: { name: [{ id, name? }] }, default }`. The model id
// is matched case-insensitively: the `brain` setting stores the display casing
// ("GLM-5.3-Flash") while the catalog id is "glm-5.3-flash".
const findInCatalog = (catalog, provider, model) => {
  const names = Object.keys(catalog.providers)
  const pKey = names.find((n) => n === provider) || names.find((n) => n.toLowerCase() === provider.toLowerCase())
  if (pKey === undefined) return null
  const models = Array.isArray(catalog.providers[pKey]) ? catalog.providers[pKey] : []
  const hit = models.find((m) => m.id === model) || models.find((m) => String(m.id).toLowerCase() === model.toLowerCase())
  return hit === undefined ? null : { provider: pKey, model: hit.id }
}

// Order: the model the user picked on the page, then the `brain` setting, then
// the catalog default. Ids are canonicalised against the catalog when found. The
// page's pick must exist in the catalog (a stale or forged request is dropped);
// `brain` and the default are explicit configuration and may name a model the
// provider discovers on its own, so they are kept as written. When the catalog is
// unreadable there is nothing to check against and every name is kept.
export const candidates = ({ requested, brainKey, catalog }) => {
  const cat = catalog !== null && catalog !== undefined && typeof catalog === 'object' && catalog.providers !== null && typeof catalog.providers === 'object' ? catalog : { providers: {}, default: null }
  const known = Object.keys(cat.providers).length > 0
  const list = []
  const push = (provider, model, source, mustExist) => {
    const p = text(provider)
    const m = text(model)
    if (p === '' || m === '') return
    const found = known ? findInCatalog(cat, p, m) : null
    if (known && found === null && mustExist) return
    const route = found !== null ? found : { provider: p, model: m }
    if (list.some((c) => c.provider === route.provider && c.model === route.model)) return
    list.push({ provider: route.provider, model: route.model, source })
  }
  if (requested !== null && requested !== undefined) push(requested.provider, requested.model, 'requested', true)
  const brain = splitRoute(brainKey)
  if (brain !== null) push(brain.provider, brain.model, 'brain', false)
  if (cat.default !== null && cat.default !== undefined && typeof cat.default === 'object') push(cat.default.provider, cat.default.model, 'default', false)
  return list
}

// Models offered by the page's selector, straight from the catalog.
export const modelList = ({ catalog, brainKey }) => {
  const providers = catalog !== null && catalog !== undefined && catalog.providers !== null && typeof catalog.providers === 'object' ? catalog.providers : {}
  const models = []
  for (const provider of Object.keys(providers)) {
    for (const m of Array.isArray(providers[provider]) ? providers[provider] : []) {
      models.push({ id: provider + '/' + m.id, provider, model: m.id, name: text(m.name) === '' ? m.id : text(m.name) })
    }
  }
  // The pre-selected entry must be one the selector actually offers.
  const first = candidates({ requested: null, brainKey, catalog }).find((c) => models.some((m) => m.id === c.provider + '/' + c.model))
  return { models, default: first !== undefined ? first.provider + '/' + first.model : (models.length > 0 ? models[0].id : null) }
}

// One streamed call. Never throws: the outcome is `{ raw, failure }`.
const attempt = async ({ llm, route, prompt, maxTokens, timeoutMs, outer }) => {
  const control = new AbortController()
  const timer = setTimeout(() => { try { control.abort() } catch (e) { /* already finished */ } }, timeoutMs)
  // A run the host drives (i18n-job.mjs) can be paused: its signal stops this call too, at once.
  let onOuter = null
  if (outer !== null && outer !== undefined) {
    if (outer.aborted === true) control.abort()
    else { onOuter = () => { try { control.abort() } catch (e) { /* already finished */ } }; outer.addEventListener('abort', onOuter, { once: true }) }
  }
  let raw = ''
  let failure = null
  let finishKind = null
  try {
    const stream = llm.stream({
      provider: route.provider, model: route.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      maxTokens, temperature: 0.2,
      purpose: 'kybernos-i18n-translate', signal: control.signal,
    })
    for await (const chunk of stream) {
      if (chunk === null || chunk === undefined || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') raw += chunk.text
      else if (chunk.type === 'finish' && chunk.reason !== null && typeof chunk.reason === 'object') {
        finishKind = chunk.reason.kind
        if (finishKind === 'error' || finishKind === 'aborted') {
          const f = chunk.reason.failure
          failure = { code: f !== null && f !== undefined && typeof f.code === 'string' ? f.code : 'UNKNOWN', message: f !== null && f !== undefined && typeof f.message === 'string' ? f.message : 'echec sans detail' }
        }
      }
    }
  } catch (e) {
    failure = { code: 'THROWN', message: errText(e) }
  } finally {
    clearTimeout(timer)
    if (onOuter !== null) { try { outer.removeEventListener('abort', onOuter) } catch (e) { /* gone */ } }
  }
  if (outer !== null && outer !== undefined && outer.aborted === true) failure = { code: 'ABORTED', message: 'interrompu' }
  else if (control.signal.aborted) failure = { code: 'TIMEOUT', message: 'pas de reponse en ' + Math.round(timeoutMs / 1000) + ' s' }
  return { raw, failure, finishKind }
}

// args: { lang, provider?, model?, batch: { key: french } }
// deps: { llm, brainKey, catalog, jsonBetween, timeoutMs? }
export const translateBatch = async (args, deps) => {
  const req = args !== null && args !== undefined && typeof args === 'object' ? args : {}
  const lang = typeof req.lang === 'string' ? req.lang.trim().toLowerCase().slice(0, 10) : ''
  if (/^[a-z]{2,3}([-_][a-z0-9]{2,8})?$/.test(lang) !== true || lang === 'kybernos') return { ok: false, error: 'invalid language code' }
  const batchIn = req.batch !== null && req.batch !== undefined && typeof req.batch === 'object' ? req.batch : null
  if (batchIn === null) return { ok: false, error: 'lot batch manquant' }
  const pairs = Object.entries(batchIn)
    .filter(([k, v]) => typeof k === 'string' && k.length > 0 && k.length <= 200 && typeof v === 'string' && v.length > 0)
    .slice(0, I18N_BATCH_MAX)
  if (pairs.length === 0) return { ok: true, translations: {} }
  const llm = deps.llm
  if (llm === null || llm === undefined || typeof llm.stream !== 'function') return { ok: false, error: 'service llm indisponible dans ce profil' }
  const routes = candidates({ requested: { provider: req.provider, model: req.model }, brainKey: deps.brainKey, catalog: deps.catalog })
  if (routes.length === 0) return { ok: false, error: 'aucun modele disponible (reglage brain vide, catalogue sans defaut)' }

  // What the checks said about an earlier answer to these same keys (reasons as codes, see i18n-quality.mjs): the model is
  // told, in a sentence, which key was refused and why. Only keys of this batch, only codes this module knows.
  const corrections = []
  if (req.hints !== null && req.hints !== undefined && typeof req.hints === 'object') {
    for (const [k] of pairs) {
      const h = req.hints[k]
      if (typeof h !== 'string' || h === '') continue
      const why = explain(h.split('+').filter((r) => /^[a-z]{3,12}$/.test(r)))
      if (why !== '') corrections.push(k + ' : ' + why)
    }
  }
  const langName = cleanLangName(req.langName)
  const target = LANG_NAMES[lang] || (langName !== '' ? 'into the language “' + langName + '” (code ' + lang + ')' : 'into the language “' + lang + '”')
  // `source: 'auto'` = strings collected from the screens: French from the
  // Kybernos plugins, English from DSH, so each value says its own language.
  const from = req.source === 'auto' ? 'French or English (each value carries its own language)' : 'French'
  const prompt = [
    'You are a professional translator of software interfaces.',
    'Translate every value from ' + from + ' ' + target + '.',
    'Register: user interface, short labels, direct tone. Do NOT translate the keys.',
    'Keep exactly as they are: variables ({name}, {{name}}, %s, %d), HTML or Markdown tags, URLs, paths, identifiers, code, and proper names (Kybernos, DSH, Claude, model or provider names).',
    'Answer ONLY with a JSON object: { key: translation, ... }. No markdown, no explanation.',
    ...(corrections.length > 0 ? ['A previous answer was refused for these keys, fix them: ' + corrections.join(' | ')] : []),
    'Object to translate:',
    JSON.stringify(Object.fromEntries(pairs)),
  ].join('\n')
  // 40 short labels fit in 4k output tokens; a batch of long paragraphs can
  // exceed it, and a truncated JSON is rejected whole by `jsonBetween`.
  const maxTokens = pairs.reduce((n, [, v]) => n + v.length, 0) > 3000 ? 16000 : 4000

  const failures = []
  for (const route of routes) {
    const label = route.provider + '/' + route.model
    const outer = typeof AbortSignal !== 'undefined' && req.signal instanceof AbortSignal ? req.signal : null
    const out = await attempt({ llm, route, prompt, maxTokens, timeoutMs: deps.timeoutMs || ATTEMPT_TIMEOUT_MS, outer })
    if (out.failure !== null) {
      failures.push(label + ' : ' + out.failure.code + ' — ' + out.failure.message)
      if (NEXT_CANDIDATE_CODES.has(out.failure.code)) continue
      break
    }
    const parsed = deps.jsonBetween(out.raw)
    if (parsed === null) {
      failures.push(label + ': unusable answer' + (out.finishKind === null ? '' : ' (finish: ' + out.finishKind + ')') + (out.raw === '' ? ' — empty answer' : ''))
      break
    }
    // Every text goes through the checks of i18n-quality.mjs before it is kept: a refused one is reported with its reasons
    // (`refused`, key → 'placeholder+url'), so the next attempt can be told; a doubtful one is kept and listed (`flagged`).
    const translations = {}
    const refused = {}
    const flagged = {}
    for (const [k, src] of pairs) {
      const v = parsed[k]
      if (typeof v !== 'string' || v.trim().length === 0) continue
      const verdict = inspect(src, v.trim(), { lang })
      if (verdict.hard.length > 0) { refused[k] = verdict.hard.join('+'); continue }
      translations[k] = v.trim()
      if (verdict.soft.length > 0) flagged[k] = verdict.soft.join('+')
    }
    const rejected = Object.keys(refused).length
    if (Object.keys(translations).length === 0) {
      const reasons = Array.from(new Set(Object.values(refused).flatMap((r) => r.split('+'))))
      const only = reasons.length === 1 && reasons[0] === 'placeholder'
      failures.push(label + ' : ' + (rejected > 0
        ? (only ? 'every translation lost a variable ({name}, %s…)' : 'every translation was refused by the checks (' + reasons.map((r) => REFUSED_LABEL[r] || r).join(', ') + ')')
        : 'the model translated none of the requested keys'))
      return { ok: false, error: failures.join(' ; '), tried: routes.map((r) => r.provider + '/' + r.model), refused }
    }
    return { ok: true, lang, provider: route.provider, model: route.model, translations, rejected, refused, flagged }
  }
  return { ok: false, error: failures.join(' ; '), tried: routes.map((r) => r.provider + '/' + r.model) }
}
