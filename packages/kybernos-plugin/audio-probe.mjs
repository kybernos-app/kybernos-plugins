// Talking to the audio models of a provider: which way it accepts (a probe, run on a click, with a few words of text or a second of
// silence), and then, once the way is known, speaking and listening with it.
//
// The Models page lists models; it does not say how to ask one of them to speak, listen or hold a conversation. Providers differ:
// OpenAI's own `/audio/speech`, chat completions that return audio, DashScope's native endpoint, a WebSocket for realtime. This tries
// the known shapes in turn, stops at the first that works, and reports what each answered (status and the start of the body), so that
// a call can use the shape that is known to work for THIS provider and say plainly when none does.
//
// The key is handed in by the caller and never appears in what is returned. All I/O is injected: the tests use fakes.
const text = (e) => (e && e.message ? String(e.message) : String(e))
const text_ = text

/** A WAV of `ms` of silence, mono 16 kHz 16-bit (the smallest thing a transcription endpoint accepts as audio). */
export const silentWav = (ms = 800) => {
  const samples = Math.round(16000 * ms / 1000)
  const buf = Buffer.alloc(44 + samples * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28)
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40)
  return buf
}

/** The DashScope native address that belongs to an OpenAI-compatible one ('…/compatible-mode/v1' → '…/api/v1'). */
export const nativeBase = (base) => String(base).replace(/\/+$/, '').replace(/\/compatible-mode\/v1$/, '/api/v1')
/** The realtime WebSocket address of the same host, in the two usual styles. */
export const realtimeUrls = (base, model) => {
  const b = String(base).replace(/\/+$/, '')
  const host = b.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const q = '?model=' + encodeURIComponent(model)
  return [{ shape: 'dashscope-realtime', url: 'wss://' + host + '/api-ws/v1/realtime' + q }, { shape: 'openai-realtime', url: 'wss://' + host + '/v1/realtime' + q }]
}

export function createProbe ({ fetch: doFetch = (...a) => globalThis.fetch(...a), WebSocket: WS = globalThis.WebSocket, timeoutMs = 20000 } = {}) {
  const json = (o) => JSON.stringify(o)
  const wavOf = (b64) => { try { const b = Buffer.from(String(b64), 'base64'); return b.length > 44 && b.slice(0, 4).toString() === 'RIFF' ? b : null } catch (e) { return null } }

  /** Makes one attempt and keeps what it answered (status, the start of the body); `judge` says whether that is a success. */
  const makeAttempt = (key, tried) => {
    const scrub = (s) => String(s).split(key).join('…').replace(/\s+/g, ' ').slice(0, 200)
    return { scrub, attempt: async (shape, url, init, judge) => {
      try {
        const res = await doFetch(url, Object.assign({ signal: AbortSignal.timeout(timeoutMs) }, init))
        const type = String((res.headers && res.headers.get ? res.headers.get('content-type') : '') || '')
        let body = null
        let raw = ''
        if (/json|text|event-stream/i.test(type)) { raw = await res.text(); try { body = JSON.parse(raw) } catch (e) { body = null } } else { await res.arrayBuffer() }
        const verdict = res.status >= 200 && res.status < 300 ? judge({ type, body, raw }) : null
        const good = verdict !== null && verdict !== false && verdict !== undefined
        tried.push({ shape, status: res.status, ok: good, note: good ? (typeof verdict === 'string' ? verdict : 'ok') : scrub(raw || type) })
        return good ? { shape, verdict, body, raw } : null
      } catch (e) { tried.push({ shape, status: 0, ok: false, note: scrub(text(e)) }); return null }
    } }
  }

  /** Asks for a few words of speech. Returns { family, audio } (audio: a WAV Buffer when the answer carried one). */
  const speak = async ({ base, key, model, tried }) => {
    const { attempt } = makeAttempt(key, tried)
    const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' }
    const chat = (shape, body) => attempt(shape, base + '/chat/completions', { method: 'POST', headers, body: json(body) },
      ({ body: b }) => (b && b.choices && b.choices[0] && b.choices[0].message && b.choices[0].message.audio && b.choices[0].message.audio.data ? 'audio in the message' : false))
    const audioOf = (hit) => (hit === null || hit.body === undefined || hit.body === null ? null : wavOf(hit.body.choices[0].message.audio.data))
    let hit = await attempt('openai-speech', base + '/audio/speech', { method: 'POST', headers, body: json({ model, input: 'Test.', voice: 'alloy', response_format: 'wav' }) }, ({ type }) => (/audio/i.test(type) ? 'audio ' + type : false))
    if (hit !== null) return { family: hit.shape, audio: null }
    // A TTS model of a chat gateway wants the text as an ASSISTANT message (measured on a token plan: "messages must contain an assistant role for TTS model").
    hit = await chat('chat-assistant-text', { model, messages: [{ role: 'assistant', content: 'Test.' }], audio: { format: 'wav' } })
    if (hit !== null) return { family: hit.shape, audio: audioOf(hit) }
    hit = await chat('chat-audio', { model, messages: [{ role: 'user', content: 'Test.' }], modalities: ['text', 'audio'], audio: { voice: 'alloy', format: 'wav' } })
    if (hit !== null) return { family: hit.shape, audio: audioOf(hit) }
    hit = await attempt('chat-audio-stream', base + '/chat/completions', { method: 'POST', headers, body: json({ model, messages: [{ role: 'user', content: 'Test.' }], modalities: ['text', 'audio'], audio: { voice: 'Cherry', format: 'wav' }, stream: true }) },
      ({ raw }) => (/"audio"/.test(String(raw).slice(0, 4000)) ? 'audio in the stream' : false))
    if (hit !== null) return { family: hit.shape, audio: null }
    hit = await attempt('dashscope-native', nativeBase(base) + '/services/aigc/multimodal-generation/generation', { method: 'POST', headers, body: json({ model, input: { text: 'Test.', voice: 'Cherry', language_type: 'Auto' } }) },
      ({ body: b }) => (b && b.output && b.output.audio && (b.output.audio.url || b.output.audio.data) ? 'audio ' + (b.output.audio.url ? 'url' : 'data') : false))
    if (hit !== null) return { family: hit.shape, audio: null }
    hit = await attempt('dashscope-synthesizer', nativeBase(base) + '/services/audio/tts/SpeechSynthesizer', { method: 'POST', headers, body: json({ model, input: { text: 'Test.', voice: 'Cherry' }, parameters: { format: 'wav', sample_rate: 24000 } }) },
      ({ body: b }) => (b && b.output && b.output.audio && (b.output.audio.url || b.output.audio.data) ? 'audio ' + (b.output.audio.url ? 'url' : 'data') : false))
    if (hit !== null) return { family: hit.shape, audio: null }
    return { family: null, audio: null }
  }

  /** Asks for the words in `sample` (a WAV; the probe's own silence when there is none). A recognised "test" is the real proof. */
  const listen = async ({ base, key, model, tried, sample }) => {
    const { attempt } = makeAttempt(key, tried)
    const wav = sample ?? silentWav()
    const spoken = sample !== null && sample !== undefined
    const verdict = (said) => (typeof said === 'string' ? (/test/i.test(said) ? 'recognised "test"' : (spoken ? 'answered: "' + said.slice(0, 40) + '"' : 'answered')) : false)
    const form = () => { const f = new FormData(); f.append('model', model); f.append('file', new Blob([wav], { type: 'audio/wav' }), 'sample.wav'); return f }
    let hit = await attempt('openai-transcriptions', base + '/audio/transcriptions', { method: 'POST', headers: { authorization: 'Bearer ' + key }, body: form() }, ({ body }) => verdict(body && body.text))
    if (hit !== null) return { family: hit.shape }
    const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' }
    const said = ({ body }) => verdict(body && body.choices && body.choices[0] && body.choices[0].message ? String(body.choices[0].message.content ?? '') : null)
    // The gateway injects its own prompt: some refuse any text part, so the audio goes alone, as a data URL and as plain base64.
    hit = await attempt('chat-input-audio-base64', base + '/chat/completions', { method: 'POST', headers, body: json({ model, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } }] }] }) }, said)
    if (hit !== null) return { family: hit.shape }
    hit = await attempt('chat-input-audio-dataurl', base + '/chat/completions', { method: 'POST', headers, body: json({ model, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,' + wav.toString('base64') } }] }], stream: false }) }, said)
    if (hit !== null) return { family: hit.shape }
    return { family: null }
  }

  /**
   * Speaks `text` with a way the probe found. Returns { ok, audio } (a WAV Buffer) or { ok: false, error, status }. Only the ways that
   * return the audio itself are used at run time; the ones that answer with a link are known to the probe but not used.
   */
  const speakWith = async ({ family, base, key, model, text }) => {
    const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' }
    const clean = (s) => String(s).split(key).join('…').replace(/\s+/g, ' ').slice(0, 200)
    try {
      let res = null
      if (family === 'openai-speech') res = await doFetch(base + '/audio/speech', { method: 'POST', headers, body: json({ model, input: text, voice: 'alloy', response_format: 'wav' }), signal: AbortSignal.timeout(timeoutMs) })
      else if (family === 'chat-assistant-text') res = await doFetch(base + '/chat/completions', { method: 'POST', headers, body: json({ model, messages: [{ role: 'assistant', content: text }], audio: { format: 'wav' } }), signal: AbortSignal.timeout(timeoutMs) })
      else if (family === 'chat-audio') res = await doFetch(base + '/chat/completions', { method: 'POST', headers, body: json({ model, messages: [{ role: 'user', content: text }], modalities: ['text', 'audio'], audio: { voice: 'alloy', format: 'wav' } }), signal: AbortSignal.timeout(timeoutMs) })
      else return { ok: false, status: 0, error: 'this way of speaking is not used at run time (' + String(family) + ')' }
      if (res.status < 200 || res.status >= 300) return { ok: false, status: res.status, error: clean(await res.text().catch(() => '')) || 'HTTP ' + String(res.status) }
      if (family === 'openai-speech') { const bytes = Buffer.from(await res.arrayBuffer()); return bytes.length > 44 ? { ok: true, audio: bytes } : { ok: false, status: res.status, error: 'empty audio' } }
      const body = await res.json().catch(() => null)
      const audio = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.audio ? wavOf(body.choices[0].message.audio.data) : null
      return audio !== null ? { ok: true, audio } : { ok: false, status: res.status, error: 'no audio in the answer' }
    } catch (e) { return { ok: false, status: 0, error: clean(text_(e)) } }
  }

  /** Listens to `wav` (a WAV Buffer) with a way the probe found. Returns { ok, text } or { ok: false, error, status }. */
  const listenWith = async ({ family, base, key, model, wav, language }) => {
    const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' }
    const clean = (s) => String(s).split(key).join('…').replace(/\s+/g, ' ').slice(0, 200)
    try {
      let res = null
      if (family === 'openai-transcriptions') {
        const f = new FormData()
        f.append('model', model)
        if (typeof language === 'string' && /^[a-z]{2}$/.test(language)) f.append('language', language)
        f.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav')
        res = await doFetch(base + '/audio/transcriptions', { method: 'POST', headers: { authorization: 'Bearer ' + key }, body: f, signal: AbortSignal.timeout(timeoutMs) })
      } else if (family === 'chat-input-audio-base64' || family === 'chat-input-audio-dataurl') {
        const data = family === 'chat-input-audio-base64' ? { data: wav.toString('base64'), format: 'wav' } : { data: 'data:audio/wav;base64,' + wav.toString('base64') }
        res = await doFetch(base + '/chat/completions', { method: 'POST', headers, body: json({ model, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: data }] }], stream: false }), signal: AbortSignal.timeout(timeoutMs) })
      } else return { ok: false, status: 0, error: 'this way of listening is not used at run time (' + String(family) + ')' }
      if (res.status < 200 || res.status >= 300) return { ok: false, status: res.status, error: clean(await res.text().catch(() => '')) || 'HTTP ' + String(res.status) }
      const body = await res.json().catch(() => null)
      const said = family === 'openai-transcriptions' ? (body && body.text) : (body && body.choices && body.choices[0] && body.choices[0].message ? body.choices[0].message.content : null)
      return typeof said === 'string' ? { ok: true, text: said.trim() } : { ok: false, status: res.status, error: 'no text in the answer' }
    } catch (e) { return { ok: false, status: 0, error: clean(text_(e)) } }
  }

  /** The realtime handshake in the two usual styles, then the first event the server sends (its name says which protocol it speaks). */
  const realtime = async ({ base, key, model, tried }) => {
    const { scrub } = makeAttempt(key, tried)
    if (typeof WS !== 'function') { tried.push({ shape: 'websocket', status: 0, ok: false, note: 'no WebSocket in this runtime' }); return { family: null } }
    for (const c of realtimeUrls(base, model)) {
      const outcome = await new Promise((resolve) => {
        let ws = null
        let opened = false
        const done = (v) => { try { ws && ws.close() } catch (e) { /* closed */ } resolve(v) }
        const timer = setTimeout(() => done(opened ? { status: 101, ok: true, note: 'handshake accepted, no first event' } : { status: 0, ok: false, note: 'no answer in time' }), 6000)
        try {
          ws = new WS(c.url, { headers: { authorization: 'Bearer ' + key } })
          ws.onopen = () => { opened = true }
          ws.onmessage = (ev) => {
            let type = ''
            try { type = String(JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)).type ?? '') } catch (e) { type = '' }
            clearTimeout(timer)
            done({ status: 101, ok: true, note: 'handshake accepted, first event: ' + (type || 'unnamed') })
          }
          ws.onerror = (e) => { clearTimeout(timer); done({ status: 0, ok: false, note: scrub((e && (e.message || (e.error && e.error.message))) || 'handshake refused') }) }
        } catch (e) { clearTimeout(timer); done({ status: 0, ok: false, note: scrub(text(e)) }) }
      })
      tried.push(Object.assign({ shape: c.shape }, outcome))
      if (outcome.ok) return { family: c.shape }
    }
    return { family: null }
  }

  /**
   * kind: 'speak' | 'listen' | 'realtime'. For 'listen', `sample` (a WAV Buffer) is what to recognise: the speech a sibling
   * speaking model made, which proves the whole round trip; without one the probe sends a second of silence.
   * With `keepAudio` a 'speak' result also carries the audio it got (for the caller to feed 'listen'); it is never serialised here.
   */
  const run = async ({ kind, base, key, model, sample = null, keepAudio = false }) => {
    const tried = []
    let r = null
    if (kind === 'speak') r = await speak({ base, key, model, tried })
    else if (kind === 'listen') r = await listen({ base, key, model, tried, sample })
    else if (kind === 'realtime') r = await realtime({ base, key, model, tried })
    else return { ok: false, error: 'unknown kind (speak, listen, realtime)' }
    const out = { ok: r.family !== null, family: r.family, tried }
    if (keepAudio && r.audio) Object.defineProperty(out, 'audio', { value: r.audio, enumerable: false })
    return out
  }
  return { run, speakWith, listenWith }
}
