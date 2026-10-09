// Which of the providers already set up in Models can listen, speak or hold a realtime voice conversation.
//
// A call can reuse them without a new key (the provider's own key is the one managed in Models). This only READS the provider
// list and sorts model ids by what their names say: a provider name, a model id and a kind, never a key, an address or a value.
const LISTEN = /(^|[-_.\s/])(asr|stt|transcri[a-z]*|whisper|paraformer|sensevoice|scribe)([-_.\s/]|$)/i
const SPEAK = /(^|[-_.\s/])(tts|cosyvoice|speech|voice|text-to-speech)([-_.\s/]|$)/i
const REALTIME = /realtime/i

/** 'listen' | 'speak' | 'realtime' | null for a model id. A realtime model is its own kind: it listens AND speaks. */
export const audioKindOf = (id) => {
  const s = String(id ?? '')
  // "realtime" in a name often means a streaming listener or speaker (paraformer-realtime, a streaming TTS): the job named
  // wins, and only a model that names no job but is realtime is a speech-to-speech one.
  if (LISTEN.test(s)) return 'listen'
  if (SPEAK.test(s)) return 'speak'
  if (REALTIME.test(s)) return 'realtime'
  return null
}

/** `providers` is the `providers` object of the model configuration: { [id]: { models: [{ id }] } }. */
export const audioModelsOf = (providers) => {
  const out = []
  if (providers === null || typeof providers !== 'object') return out
  for (const [provider, def] of Object.entries(providers)) {
    const models = def !== null && typeof def === 'object' && Array.isArray(def.models) ? def.models : []
    const found = []
    for (const m of models) {
      const id = m !== null && typeof m === 'object' && typeof m.id === 'string' ? m.id : (typeof m === 'string' ? m : null)
      if (id === null) continue
      const kind = audioKindOf(id)
      if (kind !== null) found.push({ id: id.slice(0, 120), kind })
    }
    if (found.length > 0) out.push({ provider: String(provider).slice(0, 80), models: found })
  }
  return out
}

/**
 * The address to ask a provider's audio models at. A provider set up with its own `baseURL` says it itself; the built-in ones
 * keep theirs inside the model library, so the ones read from its own definitions are listed here. Unknown: null (the page then
 * asks the user for the address instead of guessing).
 */
const KNOWN_BASES = Object.freeze({
  'qwen-token-plan': 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  'xiaomi-token-plan-ams': 'https://token-plan-ams.xiaomimimo.com/v1',
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1'
})
export const providerBase = (id, def) => {
  const own = def !== null && typeof def === 'object' && typeof def.baseURL === 'string' ? def.baseURL.trim() : ''
  const base = own !== '' ? own : (KNOWN_BASES[String(id)] ?? null)
  return base === null || !/^https:\/\/[^\s]+$/.test(base) ? null : base.replace(/\/+$/, '')
}
