// kybernos-call: the calls it makes to outside services, only when the user clicks something that needs them.
//
//   · test the keys (LiveKit, Groq, the clone provider): a read-only call each
//   · clone a recording at the provider (the recording LEAVES the machine: the settings gate it) and delete the clone
//
// All I/O is injected (`fetch`), so the tests run against fake servers. Nothing here reads a secret from disk:
// the caller hands the key in.
const text = (e) => (e && e.message ? String(e.message) : String(e))

const GROQ_MODELS = 'https://api.groq.com/openai/v1/models'
const ELEVEN = 'https://api.elevenlabs.io/v1'
const LIVEAVATAR = 'https://api.liveavatar.com/v1'
export const CLONE_MODEL = 'eleven_multilingual_v2'

export function createServices (deps = {}) {
  const doFetch = deps.fetch ?? ((...a) => globalThis.fetch(...a))
  const timeout = (ms) => AbortSignal.timeout(ms)

  /** One read-only call: ok, or a reason a person can act on. */
  const probe = async (name, url, init, refusal) => {
    try {
      const res = await doFetch(url, Object.assign({ signal: timeout(10000) }, init))
      if (res.status >= 200 && res.status < 300) return { ok: true, service: name }
      if (res.status === 401 || res.status === 403) return { ok: false, service: name, error: refusal }
      return { ok: false, service: name, error: name + ' answered HTTP ' + String(res.status) }
    } catch (e) { return { ok: false, service: name, error: name + ' is unreachable: ' + text(e) } }
  }
  const testGroq = (key) => probe('Groq', GROQ_MODELS, { headers: { authorization: 'Bearer ' + key } }, 'Groq refused the key')
  const testEleven = (key) => probe('ElevenLabs', ELEVEN + '/models', { headers: { 'xi-api-key': key } }, 'ElevenLabs refused the key')

  /** LiveAvatar has no "ping": the balance of the account is the cheapest read-only call that needs the key. */
  const testLiveAvatar = async (key) => {
    try {
      const res = await doFetch(LIVEAVATAR + '/users/credits', { headers: { 'x-api-key': key }, signal: timeout(10000) })
      if (res.status === 401 || res.status === 403) return { ok: false, service: 'LiveAvatar', error: 'LiveAvatar refused the key' }
      if (res.status < 200 || res.status >= 300) return { ok: false, service: 'LiveAvatar', error: 'LiveAvatar answered HTTP ' + String(res.status) }
      let credits = null
      try { const body = await res.json(); credits = body && body.data && body.data.credits_left !== undefined ? String(body.data.credits_left) : null } catch (e) { credits = null }
      return { ok: true, service: 'LiveAvatar', detail: credits === null ? '' : credits }
    } catch (e) { return { ok: false, service: 'LiveAvatar', error: 'LiveAvatar is unreachable: ' + text(e) } }
  }

  /** The faces a LiveAvatar account can use: its own avatars (with the key) then the public ones. Names and ids only. */
  const listAvatars = async (key) => {
    const read = async (url, headers) => {
      try {
        const res = await doFetch(url, { headers, signal: timeout(12000) })
        if (res.status < 200 || res.status >= 300) return { status: res.status, items: [] }
        const body = await res.json()
        const rows = body && body.data && Array.isArray(body.data.results) ? body.data.results : []
        return { status: res.status, items: rows }
      } catch (e) { return { status: 0, items: [] } }
    }
    const mine = key ? await read(LIVEAVATAR + '/avatars?page_size=100', { 'x-api-key': key }) : { status: 0, items: [] }
    const open = await read(LIVEAVATAR + '/avatars/public?page_size=100', {})
    const clean = (rows, source) => rows
      .filter((a) => a && typeof a.id === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(a.id) && (a.status === undefined || a.status === 'ACTIVE'))
      .map((a) => ({ id: a.id, name: typeof a.name === 'string' ? a.name.slice(0, 80) : a.id, type: a.type === 'IMAGE' ? 'IMAGE' : 'VIDEO', source }))
    if (mine.status === 401 || mine.status === 403) return { ok: false, error: 'LiveAvatar refused the key' }
    const avatars = clean(mine.items, 'yours').concat(clean(open.items, 'public'))
    if (avatars.length === 0 && mine.status === 0 && open.status === 0) return { ok: false, error: 'LiveAvatar is unreachable' }
    return { ok: true, avatars }
  }

  /**
   * Instant voice cloning: one recording in, a voice id out. `sample` is { bytes: Buffer, mime, filename }.
   * The provider may ask for a verification (a paid plan, a consent step of its own): that is reported, not hidden.
   */
  const cloneVoice = async ({ key, name, sample }) => {
    try {
      const form = new FormData()
      form.append('name', String(name).slice(0, 100))
      form.append('files', new Blob([sample.bytes], { type: sample.mime || 'audio/mpeg' }), sample.filename || 'sample')
      const res = await doFetch(ELEVEN + '/voices/add', { method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: timeout(60000) })
      const raw = await res.text()
      let body = null
      try { body = JSON.parse(raw) } catch (e) { body = null }
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'ElevenLabs refused the key or the plan does not allow voice cloning' }
      if (res.status < 200 || res.status >= 300) {
        const detail = body !== null && body.detail !== undefined ? (typeof body.detail === 'string' ? body.detail : (body.detail.message ?? body.detail.status ?? '')) : ''
        return { ok: false, error: 'ElevenLabs answered HTTP ' + String(res.status) + (detail !== '' ? ' (' + String(detail).slice(0, 160) + ')' : '') }
      }
      if (body === null || typeof body.voice_id !== 'string' || !/^[A-Za-z0-9]{6,64}$/.test(body.voice_id)) return { ok: false, error: 'ElevenLabs gave no voice id' }
      return { ok: true, remoteId: body.voice_id, requiresVerification: body.requires_verification === true }
    } catch (e) { return { ok: false, error: 'ElevenLabs is unreachable: ' + text(e) } }
  }
  const deleteVoice = async ({ key, remoteId }) => {
    try {
      const res = await doFetch(ELEVEN + '/voices/' + encodeURIComponent(remoteId), { method: 'DELETE', headers: { 'xi-api-key': key }, signal: timeout(15000) })
      // A voice that is already gone is what the user wanted.
      if ((res.status >= 200 && res.status < 300) || res.status === 404) return { ok: true }
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'ElevenLabs refused the key' }
      return { ok: false, error: 'ElevenLabs answered HTTP ' + String(res.status) }
    } catch (e) { return { ok: false, error: 'ElevenLabs is unreachable: ' + text(e) } }
  }

  return { testGroq, testEleven, testLiveAvatar, listAvatars, cloneVoice, deleteVoice }
}
