// kybernos-kaby-customisation: the face providers Kaby's page lists.
//
// This is the one place that says which services can draw Kaby's face on a video call. The page draws its list from it, with the same
// anatomy as Settings › Calls › Face (a list, then one provider's page). Kaby's face has its OWN provider and its own keys: nothing here
// reads or writes what Settings › Calls holds, so the two can use different accounts.
//
// A provider is `available` when a call can really use it. The others are listed to show what is planned and cannot be chosen: the worker
// that speaks for Kaby does not know them yet, and a key pasted for a provider that nothing uses would only be a secret kept for nothing.
// A provider becomes available in the same change that teaches the worker to use it (and the page then gets its key field).
//
// `kind` says what the provider needs from the portrait:
//   none        nothing: calls stay voice only
//   catalogue   a face of the provider's own catalogue; the portrait is not used
//   create      a face made once from the portrait (API), then reused by id
//   session     the portrait goes with each call; nothing to create
// Prices are the providers' own, read on their pages on 2026-10-22: confirm before paying.

const t = (fr, en) => ({ fr, en })

export const FACE_PROVIDERS = Object.freeze([
  { id: 'none', kind: 'none', available: true,
    name: t('Pas de visage', 'No face'), price: t('Voix seule', 'Voice only'),
    note: t('Les appels restent vocaux. Le bouton caméra est grisé et dit pourquoi.', 'Calls stay voice only. The camera button is off and says why.') },
  { id: 'liveavatar', kind: 'catalogue', available: false,
    name: t('LiveAvatar (HeyGen)', 'LiveAvatar (HeyGen)'), price: t('1 crédit la minute (mode LITE)', '1 credit per minute (LITE mode)'),
    note: t('Gratuit : 10 crédits par mois. Les visages viennent de son catalogue : le portrait n’est pas utilisé.', 'Free: 10 credits a month. Faces come from its catalogue: the portrait is not used.') },
  { id: 'anam', kind: 'create', available: false,
    name: t('Anam', 'Anam'), price: t('0,16 $ la minute', '$0.16 per minute'),
    note: t('Un visage fait une fois à partir du portrait, par API. Gratuit : 30 minutes par mois, sans dépassement.', 'A face made once from the portrait, by API. Free: 30 minutes a month, no overage.') },
  { id: 'lemonslice', kind: 'session', available: false,
    name: t('LemonSlice', 'LemonSlice'), price: t('8 $ par mois pour 41 minutes, puis 0,22 $ la minute', '$8 a month for 41 minutes, then $0.22 per minute'),
    note: t('Rien à créer : le portrait part avec chaque appel. L’API demande une offre payante.', 'Nothing to create: the portrait goes with each call. The API needs a paid plan.') },
  { id: 'runway', kind: 'create', available: false,
    name: t('Runway Characters', 'Runway Characters'), price: t('Environ 0,20 $ la minute', 'About $0.20 per minute'),
    note: t('Un personnage fait une fois à partir du portrait, dans tous les styles. Sessions limitées à 5 minutes.', 'A character made once from the portrait, in any style. Sessions are capped at 5 minutes.') },
  { id: 'simli', kind: 'create', available: false,
    name: t('Simli', 'Simli'), price: t('Environ 0,01 $ la minute', 'About $0.01 per minute'),
    note: t('Un visage à partir d’une photo, créé sur app.simli.com.', 'A face from a photo, created on app.simli.com.') }
])

const byId = new Map(FACE_PROVIDERS.map((p) => [p.id, p]))
export const providerById = (id) => byId.get(id) ?? null
export const availableFaceIds = () => FACE_PROVIDERS.filter((p) => p.available).map((p) => p.id)
