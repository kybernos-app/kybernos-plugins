// kybernos-call: the five slots of a call and the providers that can fill them.
//
// This file is the one place that says what a call is made of. The settings page draws itself from it (a provider page is
// its fields, its price, its key link and its test), the health check walks it, and the worker is told the choice through
// the dispatch metadata. Adding a provider to the page is adding an entry here; making it work is an adapter in the worker.
//
//   listen   your voice to text          think   who answers (the session's model: nothing to set)
//   speak    text to voice               face    an animated avatar (optional)
//   line     the live transport of voice and video (LiveKit)
//
// `cost` is the estimate in cents per minute of call, assuming the assistant speaks half the time and no free tier applies
// (prices read on the providers' own pages, October 2026).
//
// A provider is `available` when the call can really use it today. The others are listed as "coming soon": they show what
// the page will offer, and they cannot be selected.
//
// Text is { fr, en }: French is the source language of the app, English its pair.

const t = (fr, en) => ({ fr, en })

export const SLOTS = Object.freeze([
  { id: 'listen', icon: 'ear', name: t('Écoute', 'Listen'), sub: t('votre voix en texte', 'your voice to text'),
    help: t('Transforme ce que vous dites en texte pour que l’assistant puisse le lire. La précision et la vitesse comptent le plus. Gratuit ou presque.',
      'Turns what you say into text so the assistant can read it. Accuracy and speed matter most. Free or nearly free.') },
  { id: 'think', icon: 'bulb', name: t('Cerveau', 'Think'), sub: t('qui répond', 'who answers'), locked: true,
    help: t('Le modèle de ce chat répond, avec ses outils et ses droits. Rien à régler ici : changez le modèle dans le chat comme d’habitude.',
      'The model of this chat answers, with its tools and permissions. Nothing to set here: change the model in the chat as usual.') },
  { id: 'speak', icon: 'speaker', name: t('Voix', 'Speak'), sub: t('texte en voix', 'text to voice'),
    help: t('Lit la réponse à voix haute. C’est ici qu’on choisit une voix naturelle, ou la vôtre. Si un fournisseur échoue, la voix du Mac prend le relais : un appel n’est jamais muet.',
      'Reads the answer aloud. This is where a natural voice, or your own cloned voice, comes from. If a provider fails, the Mac voice takes over so a call is never silent.') },
  { id: 'face', icon: 'face', name: t('Visage', 'Face'), sub: t('avatar animé', 'animated avatar'),
    help: t('Facultatif. Un avatar dont les lèvres suivent la voix. Un même fournisseur dessine le visage, synchronise les lèvres et envoie la vidéo.',
      'Optional. An avatar whose lips follow the voice. One provider draws the face, syncs the lips and sends the video.') },
  { id: 'line', icon: 'radio', name: t('Ligne', 'Line'), sub: t('transport voix et vidéo en direct', 'live voice and video transport'),
    help: t('Transporte la voix et la vidéo en direct entre votre navigateur et l’assistant. Nécessaire pour le mode en direct.',
      'Carries voice and video live between your browser and the assistant. Needed for live mode.') }
])

const secret = (name, fr, en) => ({ kind: 'secret', name, label: t(fr, en) })

/**
 * Field kinds:
 *   secret   a value written to kybernos/livekit.env, never shown again
 *   env      a plain value in that file (shown)
 *   switch   '0' / '1' in that file
 *   setting  a choice kept in settings.json under providers.<id>.<name>
 *   models   the same, but the choices are the audio models found in the user's Models ("<provider>:<model>", listen or speak):
 *            the page lists them, the call checks them when it uses them
 */
export const PROVIDERS = Object.freeze([
  // ── listen ───────────────────────────────────────────────────────────
  { id: 'groq', cost: 0.07, slot: 'listen', available: true, source: 'key', tags: ['online'], test: 'groq',
    name: t('Groq Whisper', 'Groq Whisper'), price: t('0,04 $ l’heure d’audio', '$0.04 per audio hour'), url: 'https://console.groq.com/keys',
    note: t('Rapide. Environ 12 % de mots faux (turbo), contre 10,3 % pour la grande version, trois fois plus chère.', 'Fast. About 12 % wrong words (turbo), against 10.3 % for the large version, three times the price.'),
    fields: [
      secret('GROQ_API_KEY', 'Clé API', 'API key'),
      { kind: 'setting', name: 'model', label: t('Modèle', 'Model'), default: 'whisper-large-v3-turbo', options: [
        { value: 'whisper-large-v3-turbo', label: t('whisper-large-v3-turbo · 0,04 $/h', 'whisper-large-v3-turbo · $0.04/h') },
        { value: 'whisper-large-v3', label: t('whisper-large-v3 · 0,111 $/h', 'whisper-large-v3 · $0.111/h') }] }] },
  { id: 'models-asr', cost: 0, slot: 'listen', available: true, source: 'models', tags: ['models'], test: 'models',
    name: t('Un modèle de vos Modèles', 'A model from your Models'), price: t('Inclus dans votre offre', 'Included in your plan'),
    note: t('Un modèle d’écoute d’un fournisseur déjà configuré dans Modèles : la clé est celle de ce fournisseur, rien à coller.', 'A listening model of a provider already set up in Models: the key is that provider’s, nothing to paste.'),
    fields: [{ kind: 'models', name: 'model', want: 'listen', label: t('Modèle d’écoute', 'Listening model') }] },
  { id: 'app-dictation', cost: 0, slot: 'listen', available: true, source: 'models', tags: ['models'], test: 'dictation',
    name: t('Dictée de l’app', 'App dictation'), price: t('Inclus dans votre offre', 'Included in your plan'),
    note: t('Le modèle qu’utilise déjà la dictée de l’app (le micro de la zone de message).', 'The model the app’s dictation already uses (the microphone of the message box).'), fields: [] },
  { id: 'deepgram', cost: 0.58, slot: 'listen', available: false, source: 'key', tags: ['online'], url: 'https://console.deepgram.com',
    name: t('Deepgram Nova-3', 'Deepgram Nova-3'), price: t('0,0058 $ la minute', '$0.0058 per minute'), note: t('Pensé pour la voix en temps réel. 200 $ offerts au départ.', 'Built for realtime voice. $200 free to start.'), fields: [] },
  { id: 'openai-compatible-stt', cost: 0, slot: 'listen', available: false, source: 'key', tags: ['custom'],
    name: t('Compatible OpenAI', 'OpenAI-compatible'), price: t('Selon l’hébergeur', 'Depends on the host'), note: t('Tout service qui parle comme l’API Whisper d’OpenAI.', 'Any service that speaks like OpenAI’s Whisper API.'), fields: [] },

  // ── think ────────────────────────────────────────────────────────────
  { id: 'session', cost: 0, slot: 'think', available: true, source: 'none', tags: [],
    name: t('Le modèle de votre session', 'Your session’s model'), price: t('Déjà dans votre chat', 'Already in your chat'), note: t('Changez-le dans le chat.', 'Change it in the chat.'), fields: [] },

  // ── speak: the first four are engines of the app's own voice system (the Voice settings); ElevenLabs is the clone provider ──
  { id: 'app', cost: 0, slot: 'speak', available: true, source: 'none', tags: ['local'], engine: null,
    name: t('Voix de l’app', 'App voice'), price: t('Gratuit', 'Free'), note: t('La voix choisie dans Réglages › Voix de l’app.', 'The voice chosen in the app’s Voice settings.'), fields: [] },
  { id: 'edge', cost: 0, slot: 'speak', available: true, source: 'none', tags: ['online'], engine: 'edge',
    name: t('Edge (Microsoft)', 'Edge (Microsoft)'), price: t('Gratuit, sans clé', 'Free, no key'), note: t('Voix neuronales naturelles. Le texte est envoyé à Microsoft pour être lu.', 'Natural neural voices. The text is sent to Microsoft to be read.'), fields: [] },
  { id: 'piper', cost: 0, slot: 'speak', available: true, source: 'none', tags: ['local'], engine: 'piper',
    name: t('Piper', 'Piper'), price: t('Gratuit, sur l’ordinateur', 'Free, on this computer'), note: t('Privé. Environ 1 s avant la première phrase.', 'Private. About 1 s before the first sentence.'), fields: [] },
  { id: 'supertonic', cost: 0, slot: 'speak', available: true, source: 'none', tags: ['local'], engine: 'supertonic',
    name: t('Supertonic', 'Supertonic'), price: t('Gratuit, sur l’ordinateur', 'Free, on this computer'), note: t('Multilingue. Environ 2 s avant la première phrase.', 'Multilingual. About 2 s before the first sentence.'), fields: [] },
  { id: 'say', cost: 0, slot: 'speak', available: true, source: 'none', tags: ['local'], engine: 'say',
    name: t('Voix du Mac', 'Mac voice'), price: t('Gratuit', 'Free'), note: t('Instantanée, mais robotique.', 'Instant, but robotic.'), fields: [] },
  { id: 'elevenlabs', cost: 8, slot: 'speak', available: true, source: 'key', tags: ['online', 'clone'], test: 'elevenlabs', clone: true, url: 'https://elevenlabs.io/app/settings/api-keys',
    name: t('ElevenLabs (voix clonées)', 'ElevenLabs (cloned voices)'), price: t('À partir de 6 $ par mois', 'From $6 per month'),
    note: t('Sert aux voix enregistrées : le clonage de voix est inclus dès l’offre à 6 $ (30 000 crédits). Environ 1 crédit par caractère.', 'Used for recorded voices: voice cloning is included from the $6 plan (30,000 credits). About 1 credit per character.'),
    fields: [
      secret('ELEVENLABS_API_KEY', 'Clé API', 'API key'),
      { kind: 'setting', name: 'model', label: t('Modèle', 'Model'), default: 'eleven_multilingual_v2', options: [
        { value: 'eleven_multilingual_v2', label: t('eleven_multilingual_v2 · 1 crédit par caractère', 'eleven_multilingual_v2 · 1 credit per character') },
        { value: 'eleven_flash_v2_5', label: t('eleven_flash_v2_5 · 0,5 crédit par caractère', 'eleven_flash_v2_5 · 0.5 credit per character') }] }] },
  { id: 'models-tts', cost: 0, slot: 'speak', available: true, source: 'models', tags: ['models'], engine: 'models',
    name: t('Un modèle de vos Modèles', 'A model from your Models'), price: t('Inclus dans votre offre', 'Included in your plan'),
    note: t('Un modèle de voix d’un fournisseur déjà configuré dans Modèles : la clé est celle de ce fournisseur, rien à coller. Le texte lui est envoyé.', 'A voice model of a provider already set up in Models: the key is that provider’s, nothing to paste. The text is sent to it.'), fields: [] },
  { id: 'cartesia', cost: 2, slot: 'speak', available: false, source: 'key', tags: ['online', 'clone'], url: 'https://cartesia.ai',
    name: t('Cartesia', 'Cartesia'), price: t('À partir de 5 $ par mois', 'From $5 per month'), note: t('Très faible latence. Clonage inclus dès 5 $ (100 000 crédits).', 'Very low latency. Cloning included from $5 (100,000 credits).'), fields: [] },
  { id: 'deepgram-aura', cost: 0.6, slot: 'speak', available: false, source: 'key', tags: ['online'], url: 'https://console.deepgram.com',
    name: t('Deepgram Aura', 'Deepgram Aura'), price: t('0,015 $ les 1 000 caractères', '$0.015 per 1,000 characters'), note: t('Pas de clonage.', 'No cloning.'), fields: [] },
  { id: 'openai-compatible-tts', cost: 0, slot: 'speak', available: false, source: 'key', tags: ['custom'],
    name: t('Compatible OpenAI', 'OpenAI-compatible'), price: t('Selon l’hébergeur', 'Depends on the host'), note: t('Tout service qui parle comme l’API de voix d’OpenAI.', 'Any service that speaks like OpenAI’s voice API.'), fields: [] },

  // ── face ─────────────────────────────────────────────────────────────
  { id: 'none', cost: 0, slot: 'face', available: true, source: 'none', tags: [],
    name: t('Pas de visage', 'No face'), price: t('Voix seule', 'Voice only'), note: t('L’appel reste vocal. Le bouton caméra est grisé et dit pourquoi.', 'Calls stay voice only. The camera button is off and says why.'), fields: [] },
  { id: 'liveavatar', cost: 9.5, slot: 'face', available: true, source: 'key', tags: ['online', 'catalogue'], test: 'liveavatar', url: 'https://app.liveavatar.com/developers',
    name: t('LiveAvatar (HeyGen)', 'LiveAvatar (HeyGen)'), price: t('1 crédit la minute (mode LITE)', '1 credit per minute (LITE mode)'),
    note: t('Gratuit : 10 crédits par mois, soit environ 10 minutes. Au-delà environ 0,09 à 0,095 $ le crédit.', 'Free: 10 credits a month, about 10 minutes. Beyond that about $0.09 to $0.095 per credit.'),
    fields: [
      secret('LIVEAVATAR_API_KEY', 'Clé API', 'API key'),
      { kind: 'env', name: 'LIVEAVATAR_AVATAR_ID', label: t('Identifiant du visage', 'Avatar ID'), avatars: true, required: true },
      { kind: 'switch', name: 'LIVEAVATAR_SANDBOX', label: t('Mode test gratuit (sandbox) : un seul visage, sessions courtes', 'Free test mode (sandbox): one face, short sessions') }] },
  { id: 'anam', cost: 16, slot: 'face', available: false, source: 'key', tags: ['online', 'photo'], url: 'https://anam.ai',
    name: t('Anam', 'Anam'), price: t('0,16 $ la minute', '$0.16 per minute'), note: t('Un visage à partir d’une photo. Gratuit : 30 minutes par mois et 1 avatar perso.', 'A face from a photo. Free: 30 minutes a month and 1 custom avatar.'), fields: [] },
  { id: 'simli', cost: 5, slot: 'face', available: false, source: 'key', tags: ['online', 'photo'], url: 'https://app.simli.com',
    name: t('Simli', 'Simli'), price: t('Environ 0,05 $ la minute', 'About $0.05 per minute'), note: t('Visage à partir d’une photo, créé sur app.simli.com.', 'Face from a photo, created on app.simli.com.'), fields: [] },

  // ── line ─────────────────────────────────────────────────────────────
  { id: 'livekit', cost: 0.1, slot: 'line', available: true, source: 'key', tags: ['online'], test: 'livekit', url: 'https://cloud.livekit.io',
    name: t('LiveKit', 'LiveKit'), price: t('Gratuit pour commencer', 'Free to start'),
    note: t('LiveKit Cloud : 5 000 minutes de participants par mois, soit environ 2 500 minutes d’appel. Ou votre propre serveur LiveKit (LiveAvatar en mode LITE ne fonctionne pas avec).', 'LiveKit Cloud: 5,000 participant minutes a month, about 2,500 call minutes. Or your own LiveKit server (LiveAvatar LITE does not work with it).'),
    fields: [
      { kind: 'env', name: 'LIVEKIT_URL', label: t('Adresse du projet', 'Project address'), required: true },
      secret('LIVEKIT_API_KEY', 'Clé API', 'API key'),
      secret('LIVEKIT_API_SECRET', 'Secret API', 'API secret')] }
])

/** Is every secret (and every required value) of a provider set? `keys` is what the store reports: { NAME: { set } }. */
export const isConfigured = (provider, keys) => provider.fields
  .filter((f) => f.kind === 'secret' || f.required === true)
  .every((f) => keys[f.name] !== undefined && keys[f.name].set === true)

/** What a click on a preset sets. `available: false` presets are shown and cannot be applied. */
export const PRESETS = Object.freeze([
  { id: 'simple', available: false, name: t('Simple', 'Simple'), desc: t('Sans compte en plus : vous parlez, il répond.', 'No extra account: you talk, it answers.') },
  { id: 'live', available: true, name: t('En direct', 'Live'), desc: t('Conversation fluide, vous pouvez l’interrompre.', 'Fluid conversation, you can interrupt.'),
    patch: { use: { listen: 'groq', face: 'none' }, defaultVoice: { engine: 'edge', voice: 'fr-FR-DeniseNeural', lang: 'fr' } } },
  { id: 'best', available: true, name: t('Meilleure qualité', 'Best quality'), desc: t('Voix naturelle et un visage.', 'Natural voice and a face.'),
    patch: { use: { listen: 'groq', face: 'liveavatar' }, defaultVoice: { engine: 'edge', voice: 'fr-FR-VivienneMultilingualNeural', lang: 'fr' } } }
])

const MODEL_RE = /^[A-Za-z0-9._-]{1,80}:[A-Za-z0-9._:-]{1,80}$/
const byId = new Map(PROVIDERS.map((p) => [p.id, p]))
export const providerById = (id) => byId.get(id) ?? null
export const providersOf = (slot) => PROVIDERS.filter((p) => p.slot === slot)
export const availableIds = (slot) => providersOf(slot).filter((p) => p.available).map((p) => p.id)

/** The setting a provider's `setting` field may take: its default when nothing valid is saved. */
export const configOf = (providerId, saved) => {
  const p = providerById(providerId)
  const out = {}
  if (p === null) return out
  for (const f of p.fields) {
    const have = saved !== null && typeof saved === 'object' ? saved[f.name] : undefined
    if (f.kind === 'models') out[f.name] = (typeof have === 'string' && MODEL_RE.test(have)) ? have : ''
    else if (f.kind === 'setting') out[f.name] = (typeof have === 'string' && f.options.some((o) => o.value === have)) ? have : f.default
  }
  return out
}

/** Checks `providers: { id: { name: value } }` from a patch: only known `setting` fields with a listed option are kept. */
export const checkProviderConfig = (patch) => {
  const kept = {}
  const refused = {}
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return { kept, refused: { providers: 'an object of provider settings' } }
  for (const [id, values] of Object.entries(patch)) {
    const p = providerById(id)
    if (p === null) { refused['providers.' + id] = 'unknown provider'; continue }
    if (values === null || typeof values !== 'object' || Array.isArray(values)) { refused['providers.' + id] = 'an object'; continue }
    for (const [name, value] of Object.entries(values)) {
      const f = p.fields.find((x) => (x.kind === 'setting' || x.kind === 'models') && x.name === name)
      if (f === undefined) { refused['providers.' + id + '.' + name] = 'not a setting of this provider'; continue }
      if (f.kind === 'models') {
        // The models come from the user's own configuration: the shape is checked here, whether the model exists is checked when it is used.
        if (typeof value !== 'string' || !(value === '' || MODEL_RE.test(value))) { refused['providers.' + id + '.' + name] = 'a model as "<provider>:<model>"'; continue }
      } else if (typeof value !== 'string' || !f.options.some((o) => o.value === value)) { refused['providers.' + id + '.' + name] = 'one of: ' + f.options.map((o) => o.value).join(', '); continue }
      if (kept[id] === undefined) kept[id] = {}
      kept[id][name] = value
    }
  }
  return { kept, refused }
}
