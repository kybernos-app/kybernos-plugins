// Using the audio models of the providers already set up in Models: speak, listen, and check that a model really answers.
//
// The Models page lists models; a call needs to know HOW to ask each one (audio-probe.mjs finds out). The way found is remembered for
// the life of the process, and forgotten when it stops working (a provider can change), in which case it is found again once.
// Everything here is injected (the providers, the key of a provider, the HTTP client), so it is tested with fakes.
import { audioKindOf, providerBase } from './audio-models.mjs'

const text = (e) => (e && e.message ? String(e.message) : String(e))

/**
 * providers() → the `providers` object of the model configuration;  credential(ref) → Promise<string | null> (the provider's key);
 * api → createProbe() of audio-probe.mjs.
 */
export function createModelsAudio ({ providers, credential, api }) {
  const families = new Map() // "provider|model" → the way that works

  /** Everything needed to ask one model: its address and key, or the reason it cannot be asked. */
  const target = async (provider, model, wantKind) => {
    const all = providers()
    const def = all !== null && typeof all === 'object' && Object.prototype.hasOwnProperty.call(all, provider) ? all[provider] : null
    if (def === null || !Array.isArray(def.models) || !def.models.some((m) => m !== null && typeof m === 'object' && m.id === model)) return { ok: false, code: 'unknown-model', error: 'this model is not in the provider configuration' }
    const kind = audioKindOf(model)
    if (kind === null || (wantKind !== undefined && kind !== wantKind)) return { ok: false, code: 'wrong-kind', error: 'this is not a ' + String(wantKind ?? 'audio') + ' model' }
    const base = providerBase(provider, def)
    if (base === null) return { ok: false, code: 'no-address', error: 'the address of this provider is unknown: add its baseURL in Models' }
    const ref = typeof def.apiKeyEnv === 'string' ? def.apiKeyEnv : ''
    let key = null
    try { key = ref === '' ? null : await credential(ref) } catch (e) { key = null }
    if (key === null || key === undefined || key === '') return { ok: false, code: 'no-key', error: 'no key is set for this provider' }
    return { ok: true, base, key, kind, def }
  }

  const id = (provider, model) => provider + '|' + model

  /** Finds (and remembers) the way that works for a model; `sample` is speech to recognise, for a listening model. */
  const find = async (t, provider, model, sample) => {
    const found = await api.run({ kind: t.kind, base: t.base, key: t.key, model, sample })
    if (found.ok) families.set(id(provider, model), found.family)
    return found
  }

  const speak = async ({ provider, model, text: said }) => {
    const t = await target(provider, model, 'speak')
    if (!t.ok) return t
    const attempt = async (family) => api.speakWith({ family, base: t.base, key: t.key, model, text: said })
    let family = families.get(id(provider, model)) ?? null
    let remembered = family !== null
    if (family === null) { const f = await find(t, provider, model, null); family = f.ok ? f.family : null }
    if (family === null) return { ok: false, code: 'no-way', error: 'none of the known ways of asking this model to speak works' }
    let r = await attempt(family)
    if (!r.ok && remembered) {
      // What worked before stopped: look again, once.
      families.delete(id(provider, model))
      const f = await find(t, provider, model, null)
      if (f.ok) r = await attempt(f.family)
    }
    return r.ok ? { ok: true, audio: r.audio, family: families.get(id(provider, model)) ?? family } : { ok: false, code: 'failed', error: r.error }
  }

  const listen = async ({ provider, model, wav, language }) => {
    const t = await target(provider, model, 'listen')
    if (!t.ok) return t
    const attempt = async (family) => api.listenWith({ family, base: t.base, key: t.key, model, wav, language })
    let family = families.get(id(provider, model)) ?? null
    const remembered = family !== null
    if (family === null) { const f = await find(t, provider, model, null); family = f.ok ? f.family : null }
    if (family === null) return { ok: false, code: 'no-way', error: 'none of the known ways of asking this model to listen works' }
    let r = await attempt(family)
    if (!r.ok && remembered) {
      families.delete(id(provider, model))
      const f = await find(t, provider, model, null)
      if (f.ok) r = await attempt(f.family)
    }
    return r.ok ? { ok: true, text: r.text, family } : { ok: false, code: 'failed', error: r.error }
  }

  /**
   * "Does this model answer, and how?": the probe, with real speech to recognise when the model listens (a speaking model of the same
   * provider makes it). What it finds is remembered, so the first real use does not have to look again.
   */
  const check = async ({ provider, model }) => {
    const t = await target(provider, model)
    if (!t.ok) return t
    let sample = null
    let said = null
    if (t.kind === 'listen') {
      const sibling = (t.def.models || []).map((m) => (m !== null && typeof m === 'object' ? m.id : null)).find((x) => typeof x === 'string' && audioKindOf(x) === 'speak' && !/voiceclone|voicedesign/i.test(x))
      if (sibling !== undefined) { said = await api.run({ kind: 'speak', base: t.base, key: t.key, model: sibling, keepAudio: true }); sample = said.audio ?? null }
    }
    const out = await find(t, provider, model, sample)
    return Object.assign({ provider, model, kind: t.kind }, out, said !== null ? { sampleFrom: said.ok ? said.family : null } : {})
  }

  return { speak, listen, check, forget: () => families.clear(), known: (provider, model) => families.get(id(provider, model)) ?? null }
}
