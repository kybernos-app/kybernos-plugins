// kybernos-call: the health check. One call asks every slot of the pipeline whether it works, and says what to do when it does not.
//
// The microphone is the page's to check (it is the browser that hears it); everything else is checked here: the key of the
// listening provider, a real sentence through the voice engine, the face provider's account, the LiveKit line, and the call
// engine on this computer. Each check is independent and bounded: one that hangs or throws never hides the others.
//
// A result is { id, status: 'ok' | 'warn' | 'bad', code, detail?, provider?, ms }. The page turns `code` into a sentence in the
// user's language; `detail` is the provider's own words, shown as is.
import { configOf } from './providers.mjs'
const text = (e) => (e && e.message ? String(e.message) : String(e))
const refusal = (error) => /refus/i.test(String(error ?? ''))

export function createHealth ({ store, services, call, fetch: doFetch = (...a) => globalThis.fetch(...a), budgetMs = 30000 }) {
  const guarded = async (id, fn) => {
    const t0 = Date.now()
    let timer = null
    try {
      const out = await Promise.race([fn(), new Promise((resolve) => { timer = setTimeout(() => resolve({ status: 'bad', code: 'timeout' }), budgetMs) })])
      return Object.assign({ id, ms: Date.now() - t0 }, out)
    } catch (e) { return { id, ms: Date.now() - t0, status: 'bad', code: 'failed', detail: text(e).slice(0, 200) } } finally { if (timer !== null) clearTimeout(timer) }
  }

  const listen = async (settings, keys, base) => {
    if (settings.use.listen === 'models-asr') {
      const chosen = configOf('models-asr', settings.providers['models-asr']).model
      if (chosen === '') return { status: 'bad', code: 'no-model', provider: 'models-asr' }
      const sep = chosen.indexOf(':')
      const res = await doFetch(base + '/kybernos/models/audio/probe', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ provider: chosen.slice(0, sep), model: chosen.slice(sep + 1) }), signal: AbortSignal.timeout(28000) })
      let out = null
      try { out = await res.json() } catch (e) { out = null }
      if (out !== null && out.ok === true) return { status: 'ok', code: 'ok', provider: 'models-asr', detail: chosen }
      const code = out !== null && typeof out.code === 'string' ? out.code : 'failed'
      return { status: 'bad', code: code === 'no-key' || code === 'no-address' || code === 'unknown-model' ? code : 'failed', provider: 'models-asr', detail: out !== null && out.error ? String(out.error).slice(0, 200) : 'none of the known ways of listening works with ' + chosen }
    }
    if (settings.use.listen === 'app-dictation') {
      const res = await doFetch(base + '/kybernos/voice/config', { signal: AbortSignal.timeout(10000) })
      let out = null
      try { out = await res.json() } catch (e) { out = null }
      if (out !== null && out.ok === true && out.asr && out.asr.ready === true) return { status: 'ok', code: 'ok', provider: 'app-dictation' }
      return { status: 'bad', code: 'failed', provider: 'app-dictation', detail: out !== null && out.asr && out.asr.reason ? String(out.asr.reason).slice(0, 200) : 'the app’s dictation is not ready' }
    }
    if (settings.use.listen !== 'groq') return { status: 'warn', code: 'not-wired', provider: settings.use.listen }
    if (!keys.GROQ_API_KEY) return { status: 'bad', code: 'no-key', provider: 'groq' }
    const r = await services.testGroq(keys.GROQ_API_KEY)
    return r.ok === true ? { status: 'ok', code: 'ok', provider: 'groq' } : { status: 'bad', code: refusal(r.error) ? 'refused' : 'failed', provider: 'groq', detail: r.error }
  }

  const speak = async (settings, base) => {
    const voice = settings.defaultVoice
    const body = { text: 'Test.', lang: voice !== null && voice.lang !== '' ? voice.lang : 'en' }
    if (voice !== null) { body.engine = voice.engine; body.voice = voice.voice }
    const res = await doFetch(base + '/kybernos/tts/speak', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) })
    let out = null
    try { out = await res.json() } catch (e) { out = null }
    if (out === null || out.ok !== true) return { status: 'bad', code: 'failed', provider: voice === null ? 'app' : voice.engine, detail: out !== null && out.error ? String(out.error).slice(0, 200) : 'HTTP ' + String(res.status) }
    if (voice !== null && out.engine !== voice.engine) {
      const why = Array.isArray(out.attempts) && out.attempts[0] && out.attempts[0].error ? String(out.attempts[0].error).slice(0, 200) : ''
      return { status: 'warn', code: 'fell-back', provider: voice.engine, detail: why, usedEngine: out.engine }
    }
    return { status: 'ok', code: 'ok', provider: voice === null ? 'app' : voice.engine, renderMs: typeof out.ms === 'number' ? out.ms : null }
  }

  const face = async (settings, keys) => {
    if (settings.use.face === 'none') return { status: 'ok', code: 'voice-only' }
    if (!keys.LIVEAVATAR_API_KEY) return { status: 'warn', code: 'no-key', provider: 'liveavatar' }
    const r = await services.testLiveAvatar(keys.LIVEAVATAR_API_KEY)
    return r.ok === true ? { status: 'ok', code: 'ok', provider: 'liveavatar', detail: r.detail } : { status: 'bad', code: refusal(r.error) ? 'refused' : 'failed', provider: 'liveavatar', detail: r.error }
  }

  const line = async () => {
    const r = await call.testLiveKit()
    if (r.ok === true) return { status: 'ok', code: 'ok', provider: 'livekit' }
    return { status: 'bad', code: /not all set/.test(String(r.error)) ? 'no-key' : (refusal(r.error) ? 'refused' : 'failed'), provider: 'livekit', detail: r.error }
  }

  const engine = async () => {
    const r = await call.engineCheck()
    if (r.ok === true) return { status: 'ok', code: r.code }
    return { status: 'bad', code: r.code, detail: r.detail }
  }

  /** `base` is this DSH's own address (http://127.0.0.1:<port>): the voice engine is asked through it, as a call does. */
  const run = async ({ base }) => {
    const [settings, keys] = await Promise.all([store.readSettings(), store.readKeys()])
    const checks = await Promise.all([
      guarded('listen', () => listen(settings, keys, base)),
      guarded('speak', () => speak(settings, base)),
      guarded('face', () => face(settings, keys)),
      guarded('line', () => line()),
      guarded('engine', () => engine())
    ])
    return { ok: true, at: new Date().toISOString(), checks }
  }

  return { run }
}
