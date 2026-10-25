// kybernos-kaby-customisation: host logic and routes, played without DSH.
//
// What the person decides about their assistant lives here, in one small file of the DSH home: its name, the words that describe how it
// looks, the portrait, its voice and the face provider of its video calls. Pure functions validate and normalise; `monterKaby` mounts the
// routes over an injected `io` (a folder of named files and a clock), so test-host.mjs plays everything with no disk and no DSH.
//
// Nothing here calls a model, a provider or the network. The portrait is produced by the core's image route (the page asks for it) and
// handed to this file's route as a picture to keep.

import { FACE_PROVIDERS, availableFaceIds, providerById } from './providers.mjs'
import { sendUserFile } from './serve-user-file.mjs'

export const DEFAULT_NAME = 'Kaby'
export const NAME_MAX = 24
export const LOOK_MAX = 300
export const PORTRAIT_MAX_BYTES = 4.5 * 1024 * 1024
export const SAMPLE_MAX_BYTES = 10 * 1024 * 1024
export const ROUTE = '/kybernos-kaby-customisation'

/** Names that could make a message look like the platform's: refused as a whole name or as one of its words. */
export const RESERVED = Object.freeze(['kybernos', 'claude', 'anthropic', 'openai', 'admin', 'system', 'support', 'platform'])

const str = (v) => (typeof v === 'string' ? v : null)
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// ── validation ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A name for the assistant: letters, digits, spaces and a few marks, 24 characters, no reserved word. */
export function checkName (raw) {
  const value = (str(raw) ?? '').replace(/\s+/gu, ' ').trim()
  if (value.length === 0) return { ok: false, code: 'empty' }
  if ([...value].length > NAME_MAX) return { ok: false, code: 'long' }
  if (!/^[\p{L}\p{N} '’.-]+$/u.test(value)) return { ok: false, code: 'chars' }
  if (value.toLowerCase().split(/[ '’.-]+/u).some((w) => RESERVED.includes(w))) return { ok: false, code: 'reserved' }
  return { ok: true, value }
}

/** The words that describe the look: one line, bounded; it goes to an image model, never into Kaby's prompt. */
export function checkLook (raw) {
  const value = (str(raw) ?? '').replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  return [...value].length > LOOK_MAX ? { ok: false, code: 'long' } : { ok: true, value }
}

const ENGINE_RE = /^[a-z0-9_-]{1,30}$/u
const VOICE_RE = /^[\p{L}\p{N}_.:@()+/ -]{1,120}$/u
const LANG_RE = /^(?:[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)?$/u

/** `{ pick: 'default' }`, `{ pick: 'custom' }` (only once a custom voice is kept) or one voice of one engine. */
export function checkVoice (raw, hasCustom) {
  if (!isObject(raw)) return { ok: false, code: 'shape' }
  if (raw.pick === 'default') return { ok: true, value: { pick: 'default' } }
  if (raw.pick === 'custom') return hasCustom === true ? { ok: true, value: { pick: 'custom' } } : { ok: false, code: 'no-custom' }
  if (raw.pick !== 'voice') return { ok: false, code: 'shape' }
  const engine = str(raw.engine)
  const voice = str(raw.voice)
  const lang = raw.lang === undefined || raw.lang === null ? '' : str(raw.lang)
  if (engine === null || !ENGINE_RE.test(engine) || voice === null || !VOICE_RE.test(voice) || lang === null || !LANG_RE.test(lang)) return { ok: false, code: 'shape' }
  return { ok: true, value: { pick: 'voice', engine, voice, lang } }
}

const dataUrlOf = (raw, mimeRe) => {
  const m = /^data:([a-z0-9.+/-]{3,60})(?:;[a-z0-9=.+-]{1,40})*;base64,([A-Za-z0-9+/=\s]+)$/iu.exec(str(raw) ?? '')
  if (m === null || !mimeRe.test(m[1].toLowerCase())) return null
  return { mime: m[1].toLowerCase(), bytes: Buffer.from(m[2].replace(/\s+/gu, ''), 'base64') }
}

/** A picture for the portrait: PNG, JPEG or WebP (what the face providers take), by its first bytes, not by what it claims. */
export function checkImage (dataUrl) {
  const got = dataUrlOf(dataUrl, /^image\/(?:png|jpeg|webp)$/u)
  if (got === null) return { ok: false, code: 'format' }
  const b = got.bytes
  if (b.length === 0 || b.length > PORTRAIT_MAX_BYTES) return { ok: false, code: b.length === 0 ? 'format' : 'big' }
  const png = b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const jpeg = b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  const webp = b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
  const mime = png ? 'image/png' : (jpeg ? 'image/jpeg' : (webp ? 'image/webp' : null))
  if (mime === null) return { ok: false, code: 'format' }
  if (png) {
    const w = b.readUInt32BE(16)
    const h = b.readUInt32BE(20)
    if (w < 256 || h < 256) return { ok: false, code: 'small' }
  }
  return { ok: true, mime, bytes: b }
}

/** A voice sample: any audio the browser's recorder or a file gives, bounded. */
export function checkAudio (dataUrl) {
  const got = dataUrlOf(dataUrl, /^audio\/[a-z0-9.+-]+$/u)
  if (got === null || got.bytes.length === 0) return { ok: false, code: 'format' }
  if (got.bytes.length > SAMPLE_MAX_BYTES) return { ok: false, code: 'big' }
  return { ok: true, mime: got.mime, bytes: got.bytes }
}

// ── the profile ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const emptyProfile = () => ({ v: 1, name: DEFAULT_NAME, look: '', portrait: null, voice: { pick: 'default' }, customVoice: null, face: { use: 'none' } })

const isoOrNull = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null)

/** Whatever was on disk, made into a valid profile: a field that does not hold is replaced by its default, never thrown at. */
export function normaliseProfile (raw) {
  const p = emptyProfile()
  if (!isObject(raw)) return p
  const name = checkName(raw.name)
  if (name.ok) p.name = name.value
  const look = checkLook(raw.look)
  if (look.ok) p.look = look.value
  if (isObject(raw.portrait) && /^image\/(?:png|jpeg|webp)$/u.test(String(raw.portrait.mime)) && isoOrNull(raw.portrait.at) !== null) {
    p.portrait = { mime: raw.portrait.mime, at: raw.portrait.at, source: raw.portrait.source === 'generated' ? 'generated' : 'imported', model: str(raw.portrait.model), bytes: Number.isFinite(raw.portrait.bytes) ? raw.portrait.bytes : 0 }
  }
  const sample = raw.customVoice
  if (isObject(sample) && isoOrNull(sample.at) !== null && isoOrNull(sample.consentAt) !== null && /^audio\/[a-z0-9.+-]+$/u.test(String(sample.mime))) {
    const n = checkName(sample.name)
    p.customVoice = { name: n.ok ? n.value : 'My voice', at: sample.at, consentAt: sample.consentAt, mime: sample.mime, bytes: Number.isFinite(sample.bytes) ? sample.bytes : 0 }
  }
  const voice = checkVoice(raw.voice, p.customVoice !== null)
  if (voice.ok) p.voice = voice.value
  const use = isObject(raw.face) ? str(raw.face.use) : null
  if (use !== null && availableFaceIds().includes(use)) p.face = { use }
  return p
}

/** What a patch may change. Everything else is refused by name; nothing is applied unless the whole patch holds. */
export function applyPatch (profile, patch) {
  const refused = {}
  if (!isObject(patch)) return { ok: false, refused: { patch: 'an object' } }
  const next = { ...profile }
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'name') {
      const r = checkName(value)
      if (r.ok) next.name = r.value; else refused.name = r.code
    } else if (key === 'look') {
      const r = checkLook(value)
      if (r.ok) next.look = r.value; else refused.look = r.code
    } else if (key === 'voice') {
      const r = checkVoice(value, profile.customVoice !== null)
      if (r.ok) next.voice = r.value; else refused.voice = r.code
    } else if (key === 'face') {
      const use = isObject(value) ? str(value.use) : null
      if (use !== null && availableFaceIds().includes(use)) next.face = { use }
      else refused.face = providerById(use) === null ? 'unknown' : 'soon'
    } else refused[key] = 'not a setting'
  }
  return Object.keys(refused).length === 0 ? { ok: true, profile: next } : { ok: false, refused }
}

/** What the page and the other bundles may read: no file name, no path; the portrait as an address that changes with it. */
export function publicProfile (p) {
  return {
    v: 1,
    name: p.name,
    look: p.look,
    portrait: p.portrait === null ? null : { at: p.portrait.at, source: p.portrait.source, model: p.portrait.model, url: ROUTE + '/portrait?v=' + encodeURIComponent(p.portrait.at) },
    voice: p.voice,
    customVoice: p.customVoice === null ? null : { name: p.customVoice.name, at: p.customVoice.at },
    face: p.face,
    providers: FACE_PROVIDERS.map((f) => ({ id: f.id, kind: f.kind, available: f.available, name: f.name, price: f.price, note: f.note }))
  }
}

// ── the store ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const PROFILE_FILE = 'profile.json'
const PORTRAIT_FILE = 'portrait.bin'
const SAMPLE_FILE = 'voice-sample.bin'

/**
 * @param io { read(name) → Buffer|null, write(name, Buffer), remove(name), now() → ISO string } over one folder
 */
export function createStore (io) {
  const readProfile = () => {
    try {
      const b = io.read(PROFILE_FILE)
      return normaliseProfile(b === null ? null : JSON.parse(b.toString('utf8')))
    } catch (e) { return emptyProfile() }
  }
  const writeProfile = (p) => io.write(PROFILE_FILE, Buffer.from(JSON.stringify(p, null, 2) + '\n'))
  return {
    read: readProfile,
    write: writeProfile,
    patch (patch) {
      const r = applyPatch(readProfile(), patch)
      if (r.ok) writeProfile(r.profile)
      return r
    },
    savePortrait ({ bytes, mime, source, model, look }) {
      const p = readProfile()
      io.write(PORTRAIT_FILE, bytes)
      p.portrait = { mime, at: io.now(), source: source === 'generated' ? 'generated' : 'imported', model: model ?? null, bytes: bytes.length }
      if (look !== undefined) p.look = look
      writeProfile(p)
      return p
    },
    readPortrait () {
      const p = readProfile()
      const b = p.portrait === null ? null : io.read(PORTRAIT_FILE)
      return p.portrait === null || b === null ? null : { bytes: b }
    },
    removePortrait () {
      const p = readProfile()
      io.remove(PORTRAIT_FILE)
      p.portrait = null
      writeProfile(p)
      return p
    },
    saveSample ({ bytes, mime, name }) {
      const p = readProfile()
      const at = io.now()
      io.write(SAMPLE_FILE, bytes)
      p.customVoice = { name, at, consentAt: at, mime, bytes: bytes.length }
      writeProfile(p)
      return p
    },
    removeSample () {
      const p = readProfile()
      io.remove(SAMPLE_FILE)
      p.customVoice = null
      if (p.voice.pick === 'custom') p.voice = { pick: 'default' }
      writeProfile(p)
      return p
    }
  }
}

// ── routes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
const localHosts = (req) => {
  const port = typeof req?.socket?.localPort === 'number' ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}
/** DSH serves plugin routes before its own sign-in: a Host that is not this listener's is refused first (DNS rebinding). A request with no socket is a test. */
const hostOk = (req) => {
  try {
    const host = typeof req?.headers?.host === 'string' ? req.headers.host : null
    if (host === null || typeof req?.socket?.localPort !== 'number') return true
    return localHosts(req).includes(host) || kbTrusted(host)
  } catch (e) { return false }
}
/** A request that changes something must come from the page itself: its Origin (or Referer) is this listener's. */
export const sameOriginStrict = (req) => {
  try {
    const source = str(req?.headers?.origin) ?? str(req?.headers?.referer)
    if (source === null) return false
    const u = new URL(source)
    return (u.protocol === 'http:' || u.protocol === 'https:') && (localHosts(req).includes(u.host) || kbTrusted(u.host))
  } catch (e) { return false }
}

const send = (res, status, body) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  } catch (e) { /* socket closed */ }
}
const readBody = async (req, limit) => {
  let size = 0
  const parts = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('too-large')
    parts.push(chunk)
  }
  const text = Buffer.concat(parts).toString('utf8')
  return text === '' ? {} : JSON.parse(text)
}

/**
 * Mounts the routes and returns { store, dispose }. `onChange(profile)` is told after every change (the host publishes the profile to the other bundles from there).
 * Reads are open to the page's host; everything that changes the profile also needs the page's own origin.
 */
export function monterKaby (webServer, io, onChange = () => {}) {
  const store = createStore(io)
  const removers = []
  const changed = (p) => { try { onChange(publicProfile(p)) } catch (e) { /* a listener must never break a route */ } }
  // One handler per path (DSH keeps one route per path): `handlers` maps a method to { limit, run }.
  const route = (path, handlers) => { const remove = webServer.register({
    kind: 'exact',
    path: ROUTE + path,
    handler: async (req, res) => {
      if (!hostOk(req)) return send(res, 403, { ok: false, error: 'origin-refused' })
      const h = handlers[req.method]
      if (h === undefined) return send(res, 405, { ok: false, error: Object.keys(handlers).join(' or ') + ' expected' })
      let body = {}
      if (req.method === 'POST') {
        if (!sameOriginStrict(req)) return send(res, 403, { ok: false, error: 'origin-refused' })
        try { body = await readBody(req, h.limit) } catch (e) { return send(res, e.message === 'too-large' ? 413 : 400, { ok: false, error: e.message === 'too-large' ? 'too-large' : 'bad-json' }) }
      }
      try { return await h.run(req, res, body) } catch (e) { return send(res, 500, { ok: false, error: 'failed' }) }
    }
  }); if (typeof remove === 'function') removers.push(remove) }
  const done = (res, p) => send(res, 200, { ok: true, profile: publicProfile(p) })

  route('/profile', {
    GET: { run: (req, res) => done(res, store.read()) },
    POST: {
      limit: 65536,
      run: (req, res, body) => {
        const r = store.patch(body.patch)
        if (!r.ok) return send(res, 400, { ok: false, error: 'refused', refused: r.refused })
        changed(r.profile)
        return done(res, r.profile)
      }
    }
  })
  route('/portrait', {
    GET: {
      run: (req, res) => {
        const got = store.readPortrait()
        if (got === null) { try { res.writeHead(404); res.end('') } catch (e) { /* closed */ } return undefined }
        // The same exit as every file that was not made by the code (DL-04): the type is read from the bytes, never from the profile.
        try { sendUserFile(res, got.bytes) } catch (e) { /* closed */ }
        return undefined
      }
    },
    POST: {
      limit: Math.ceil(PORTRAIT_MAX_BYTES * 1.4) + 4096,
      run: (req, res, body) => {
        const img = checkImage(body.image)
        if (!img.ok) return send(res, 400, { ok: false, error: img.code })
        const look = body.look === undefined ? undefined : checkLook(body.look)
        if (look !== undefined && !look.ok) return send(res, 400, { ok: false, error: 'look-' + look.code })
        const p = store.savePortrait({ bytes: img.bytes, mime: img.mime, source: body.source, model: str(body.model)?.slice(0, 80), look: look?.value })
        changed(p)
        return done(res, p)
      }
    }
  })
  route('/portrait/remove', { POST: { limit: 4096, run: (req, res) => { const p = store.removePortrait(); changed(p); return done(res, p) } } })
  route('/voice-sample', {
    POST: {
      limit: Math.ceil(SAMPLE_MAX_BYTES * 1.4) + 4096,
      run: (req, res, body) => {
        if (body.consent !== true) return send(res, 400, { ok: false, error: 'consent' })
        const name = checkName(body.name)
        if (!name.ok) return send(res, 400, { ok: false, error: 'name-' + name.code })
        const audio = checkAudio(body.sample)
        if (!audio.ok) return send(res, 400, { ok: false, error: audio.code })
        const p = store.saveSample({ bytes: audio.bytes, mime: audio.mime, name: name.value })
        changed(p)
        return done(res, p)
      }
    }
  })
  route('/voice-sample/remove', { POST: { limit: 4096, run: (req, res) => { const p = store.removeSample(); changed(p); return done(res, p) } } })
  return { store, dispose: () => { for (const remove of removers) { try { remove() } catch (e) { /* already removed */ } } } }
}
