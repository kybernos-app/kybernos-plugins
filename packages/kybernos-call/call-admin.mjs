// kybernos-call: what the settings page asks of the host (read and change the call settings and secrets, test them,
// clone a recording). Pure orchestration over the store, the outside services and the call: all I/O injected.
//
// Rule of the file: a secret is never returned, and a recording never leaves the machine unless the user switched
// that on in the settings AND set the provider's key.

import { PRESETS, PROVIDERS, SLOTS, configOf, isConfigured } from './providers.mjs'

const ID_RE = /^[A-Za-z0-9._-]{1,64}$/
const ROOT_RE = /^[A-Za-z0-9._:~@/+-]{1,200}$/
const text = (e) => (e && e.message ? String(e.message) : String(e))

/** Does what is saved equal what the preset sets? (Its slots and its voice: the rest is the user's own.) */
const presetIsActive = (preset, settings) => preset.available === true && preset.patch !== undefined
  && settings.use.listen === preset.patch.use.listen && settings.use.face === preset.patch.use.face
  && settings.defaultVoice !== null && settings.defaultVoice.engine === preset.patch.defaultVoice.engine && settings.defaultVoice.voice === preset.patch.defaultVoice.voice

export function createAdmin ({ store, services, call, health = null, installer = null, env = process.env, fetch: doFetch = (...a) => globalThis.fetch(...a) }) {
  const everything = async () => {
    const [settings, keys, clones] = await Promise.all([store.readSettings(), store.keysStatus(), store.readClones()])
    // The catalogue as the page needs it: each provider with whether it is set up, and its own settings with the defaults filled in.
    const providers = PROVIDERS.map((p) => {
      const configured = isConfigured(p, keys)
      return Object.assign({}, p, { configured, ready: p.available === true && (p.source === 'none' || configured), config: configOf(p.id, settings.providers[p.id]) })
    })
    return {
      ok: true,
      settings,
      keys,
      slots: SLOTS,
      providers,
      presets: PRESETS.map((p) => ({ id: p.id, available: p.available, name: p.name, desc: p.desc, active: presetIsActive(p, settings) })),
      clones: Object.entries(clones).map(([id, c]) => ({ id, name: c.name, provider: c.provider, createdAt: c.createdAt }))
    }
  }

  /** A preset fills the slots at once. One that is not available yet is refused, not half applied. */
  const applyPreset = async (id) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (preset === undefined) return { ok: false, error: 'unknown preset' }
    if (preset.available !== true) return { ok: false, error: 'this preset is not available yet' }
    return patchSettings(preset.patch)
  }

  /** The faces the face provider offers (names and ids). Needs the key for the account's own avatars. */
  const avatars = async () => {
    const keys = await store.readKeys()
    return services.listAvatars(keys.LIVEAVATAR_API_KEY ?? null)
  }

  /** The health check. `base` is this DSH's own address, taken from the request's socket by the route. */
  const runHealth = async (base) => (health === null ? { ok: false, error: 'the health check is not available' } : health.run({ base }))

  const patchSettings = async (patch) => {
    const out = await store.writeSettings(patch)
    return out.ok === true ? { ok: true, settings: out.settings } : out
  }

  const setKeys = async (patch) => store.writeKeys(patch)

  /** Tests what the user asked to test. A call out to the service, made on this click only. */
  const test = async (service) => {
    const keys = await store.readKeys()
    if (service === 'livekit') return call.testLiveKit()
    if (service === 'groq') return keys.GROQ_API_KEY ? services.testGroq(keys.GROQ_API_KEY) : { ok: false, service: 'Groq', error: 'no Groq key is set' }
    if (service === 'elevenlabs') return keys.ELEVENLABS_API_KEY ? services.testEleven(keys.ELEVENLABS_API_KEY) : { ok: false, service: 'ElevenLabs', error: 'no ElevenLabs key is set' }
    if (service === 'liveavatar') return keys.LIVEAVATAR_API_KEY ? services.testLiveAvatar(keys.LIVEAVATAR_API_KEY) : { ok: false, service: 'LiveAvatar', error: 'no LiveAvatar key is set' }
    return { ok: false, error: 'unknown service (livekit, groq, elevenlabs, liveavatar)' }
  }

  /**
   * Gives a recording a voice at the clone provider (once: asking again returns the same one).
   * `code` tells the panel which note to show when it cannot: 'upload-off', 'no-key', 'no-sample', 'provider'.
   */
  const cloneSample = async ({ rootId, voiceId, name }) => {
    if (typeof voiceId !== 'string' || !ID_RE.test(voiceId)) return { ok: false, code: 'no-sample', error: 'unknown recording' }
    const clones = await store.readClones()
    if (clones[voiceId] !== undefined) return { ok: true, remote: { provider: clones[voiceId].provider, id: clones[voiceId].remoteId }, already: true }
    const settings = await store.readSettings()
    if (settings.cloneUpload !== true) return { ok: false, code: 'upload-off', error: 'sending recordings to the clone provider is off (Settings › Calls)' }
    const keys = await store.readKeys()
    if (!keys.ELEVENLABS_API_KEY) return { ok: false, code: 'no-key', error: 'no ElevenLabs key is set (Settings › Calls › Service)' }
    if (typeof rootId !== 'string' || !ROOT_RE.test(rootId)) return { ok: false, code: 'no-sample', error: 'unknown project' }
    // The recording is the one the app kept on this machine for that voice.
    let sample = null
    try {
      const base = 'http://127.0.0.1:' + String(env.DSH_WEB_PORT ?? '3080')
      const res = await doFetch(base + '/kybernos/voice-sample-audio?rootId=' + encodeURIComponent(rootId) + '&voiceId=' + encodeURIComponent(voiceId), { signal: AbortSignal.timeout(15000) })
      if (res.status !== 200) return { ok: false, code: 'no-sample', error: 'the recording is not on this machine (HTTP ' + String(res.status) + ')' }
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length === 0 || bytes.length > 12 * 1024 * 1024) return { ok: false, code: 'no-sample', error: 'the recording is empty or too large' }
      const mime = String(res.headers.get('content-type') ?? 'audio/mpeg').split(';')[0]
      sample = { bytes, mime, filename: voiceId + '.' + (mime.split('/')[1] ?? 'mp3').replace(/[^a-z0-9]/gi, '') }
    } catch (e) { return { ok: false, code: 'no-sample', error: 'could not read the recording: ' + text(e) } }
    const cleanName = (typeof name === 'string' && name.trim() !== '' ? name.trim() : voiceId).replace(/[\u0000-\u001f]/g, ' ').slice(0, 60)
    const made = await services.cloneVoice({ key: keys.ELEVENLABS_API_KEY, name: 'Kybernos · ' + cleanName, sample })
    if (made.ok !== true) return { ok: false, code: 'provider', error: made.error }
    const entry = await store.setClone(voiceId, { remoteId: made.remoteId, name: cleanName })
    return { ok: true, remote: { provider: entry.provider, id: entry.remoteId }, requiresVerification: made.requiresVerification === true }
  }

  /** Removes the clone at the provider, then forgets it here. The user's recording itself is not touched. */
  const deleteClone = async (voiceId) => {
    if (typeof voiceId !== 'string' || !ID_RE.test(voiceId)) return { ok: false, error: 'unknown recording' }
    const clones = await store.readClones()
    const clone = clones[voiceId]
    if (clone === undefined) return { ok: true, already: true }
    const keys = await store.readKeys()
    if (!keys.ELEVENLABS_API_KEY) return { ok: false, error: 'no ElevenLabs key is set: the clone cannot be deleted at the provider' }
    const gone = await services.deleteVoice({ key: keys.ELEVENLABS_API_KEY, remoteId: clone.remoteId })
    if (gone.ok !== true) return { ok: false, error: gone.error }
    await store.deleteClone(voiceId)
    return { ok: true }
  }

  /** The call engine's installer: `status` (what is going on) or `install` (start it; asking again while it runs only reports). */
  const engine = async (action) => {
    if (installer === null) return { ok: false, error: 'the installer is not available' }
    if (action === 'status') return installer.status()
    if (action === 'install') return installer.start()
    return { ok: false, error: 'unknown action (status, install)' }
  }

  return { everything, patchSettings, setKeys, test, cloneSample, deleteClone, applyPreset, avatars, runHealth, engine }
}
