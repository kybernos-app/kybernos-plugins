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
