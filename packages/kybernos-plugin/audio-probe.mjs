// Which way of talking to an audio model a provider accepts: a probe, run on a click, with a few words of text or a second of silence.
//
// The Models page lists models; it does not say how to ask one of them to speak, listen or hold a conversation. Providers differ:
// OpenAI's own `/audio/speech`, chat completions that return audio, DashScope's native endpoint, a WebSocket for realtime. This tries
// the known shapes in turn, stops at the first that works, and reports what each answered (status and the start of the body), so that
// a call can use the shape that is known to work for THIS provider and say plainly when none does.
//
// The key is handed in by the caller and never appears in what is returned. All I/O is injected: the tests use fakes.
const text = (e) => (e && e.message ? String(e.message) : String(e))

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
  const run = async ({ kind, base, key, model }) => {
    const tried = []
    const scrub = (s) => String(s).split(key).join('…').replace(/\s+/g, ' ').slice(0, 200)
    const auth = { authorization: 'Bearer ' + key }
    const attempt = async (shape, url, init, judge) => {
      try {
        const res = await doFetch(url, Object.assign({ signal: AbortSignal.timeout(timeoutMs) }, init))
        const type = String((res.headers && res.headers.get ? res.headers.get('content-type') : '') || '')
        let body = null
        let raw = ''
        if (/json|text/i.test(type)) { raw = await res.text(); try { body = JSON.parse(raw) } catch (e) { body = null } } else { await res.arrayBuffer() }
        const verdict = res.status >= 200 && res.status < 300 ? judge({ type, body, raw }) : null
        tried.push({ shape, status: res.status, ok: verdict !== null && verdict !== false, note: verdict ? verdict : scrub(raw || type) })
        return verdict ? shape : null
      } catch (e) { tried.push({ shape, status: 0, ok: false, note: scrub(text(e)) }); return null }
    }
    const json = (o) => JSON.stringify(o)
    let family = null
    if (kind === 'speak') {
      family = await attempt('openai-speech', base + '/audio/speech', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: json({ model, input: 'Test.', voice: 'alloy' }) },
        ({ type }) => (/audio/i.test(type) ? 'audio ' + type : false))
      if (family === null) family = await attempt('chat-audio', base + '/chat/completions', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: json({ model, messages: [{ role: 'user', content: 'Test.' }], modalities: ['text', 'audio'], audio: { voice: 'alloy', format: 'wav' } }) },
        ({ body }) => (body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.audio ? 'audio in the message' : false))
      if (family === null) family = await attempt('chat-assistant-text', base + '/chat/completions', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: json({ model, messages: [{ role: 'assistant', content: 'Test.' }], audio: { format: 'wav' } }) },
        ({ body }) => (body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.audio ? 'audio in the message' : false))
      if (family === null) family = await attempt('dashscope-native', nativeBase(base) + '/services/aigc/multimodal-generation/generation', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: json({ model, input: { text: 'Test.', voice: 'Cherry', language_type: 'Auto' } }) },
        ({ body }) => (body && body.output && body.output.audio && (body.output.audio.url || body.output.audio.data) ? 'audio ' + (body.output.audio.url ? 'url' : 'data') : false))
    } else if (kind === 'listen') {
      const wav = silentWav()
      const form = () => { const f = new FormData(); f.append('model', model); f.append('file', new Blob([wav], { type: 'audio/wav' }), 'silence.wav'); return f }
      family = await attempt('openai-transcriptions', base + '/audio/transcriptions', { method: 'POST', headers: auth, body: form() }, ({ body }) => (body && typeof body.text === 'string' ? 'text field' : false))
      if (family === null) family = await attempt('chat-input-audio', base + '/chat/completions', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: json({ model, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } }, { type: 'text', text: 'Transcribe this audio.' }] }] }) },
        ({ body }) => (body && body.choices && body.choices[0] ? 'chat answer' : false))
    } else if (kind === 'realtime') {
      if (typeof WS !== 'function') tried.push({ shape: 'websocket', status: 0, ok: false, note: 'no WebSocket in this runtime' })
      else {
        for (const c of realtimeUrls(base, model)) {
          const outcome = await new Promise((resolve) => {
            let ws = null
            const done = (v) => { try { ws && ws.close() } catch (e) { /* closed */ } resolve(v) }
            const timer = setTimeout(() => done({ status: 0, ok: false, note: 'no answer in time' }), 8000)
            try {
              ws = new WS(c.url, { headers: auth })
              ws.onopen = () => { clearTimeout(timer); done({ status: 101, ok: true, note: 'handshake accepted' }) }
              ws.onerror = (e) => { clearTimeout(timer); done({ status: 0, ok: false, note: scrub((e && (e.message || e.error && e.error.message)) || 'handshake refused') }) }
            } catch (e) { clearTimeout(timer); done({ status: 0, ok: false, note: scrub(text(e)) }) }
          })
          tried.push(Object.assign({ shape: c.shape }, outcome))
          if (outcome.ok) { family = c.shape; break }
        }
      }
    } else return { ok: false, error: 'unknown kind (speak, listen, realtime)' }
    return { ok: family !== null, family, tried }
  }
  return { run }
}
