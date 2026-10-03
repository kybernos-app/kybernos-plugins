// ── Boot guard: pure logic (no I/O, no clock, no DSH import) ────────────────
//
// Goal: notice that DSH keeps starting with an unusable GUI and recommend safe
// mode (socle only) instead of leaving the user alone with a broken screen.
//
// How a boot is judged. The host records a boot at startup. The hub client then
// reports two things from the browser:
//   · "loading": the hub client script started (a GUI was served);
//   · "alive":   the page stayed up and visible for a few seconds afterwards.
// So a boot is
//   · "ok"      → alive was reported;
//   · "failed"  → loading was reported but alive never was (GUI died or was
//                 abandoned early — a heuristic, hence a threshold of 2);
//   · "neutral" → no GUI ever hit this boot (server restarted overnight):
//                 says nothing, never counts for or against.
//
// Safe mode is only ever RECOMMENDED here. Acting on the profile is the
// lifecycle robot's job (`dsh-lifecycle.mjs safe-mode on`).

/** File name of the boot state, inside <DSH_HOME>/kybernos/. Shared with the lifecycle robot. */
export const FICHIER_ETAT = 'boot-state.json'

export const SEUIL_ECHECS = 2
export const MAX_HISTORIQUE = 12

export const etatVide = () => ({
  version: 1,
  demarrages: [],
  safe: { actif: false, depuis: null, activesAvant: [] }
})

const estTexte = (v) => typeof v === 'string' && v !== ''

/** Tolerant reader: anything unreadable becomes an empty state, never throws. */
export const normaliser = (brut) => {
  const vide = etatVide()
  if (brut === null || typeof brut !== 'object') return vide
  const demarrages = Array.isArray(brut.demarrages)
    ? brut.demarrages
      .filter((d) => d !== null && typeof d === 'object' && estTexte(d.id))
      .map((d) => ({ id: d.id, date: estTexte(d.date) ? d.date : null, gui: ['none', 'loading', 'alive'].includes(d.gui) ? d.gui : 'none' }))
      .slice(-MAX_HISTORIQUE)
    : []
  const s = brut.safe !== null && typeof brut.safe === 'object' ? brut.safe : {}
  return {
    version: 1,
    demarrages,
    safe: {
      actif: s.actif === true,
      depuis: estTexte(s.depuis) ? s.depuis : null,
      activesAvant: Array.isArray(s.activesAvant) ? s.activesAvant.filter(estTexte) : []
    }
  }
}

export const noterDemarrage = (etat, { id, date }) => {
  const e = normaliser(etat)
  if (e.demarrages.some((d) => d.id === id)) return e
  return { ...e, demarrages: [...e.demarrages, { id, date, gui: 'none' }].slice(-MAX_HISTORIQUE) }
}

const marquer = (etat, id, gui) => {
  const e = normaliser(etat)
  return { ...e, demarrages: e.demarrages.map((d) => (d.id !== id ? d : { ...d, gui: d.gui === 'alive' ? 'alive' : gui })) }
}

export const noterChargement = (etat, id) => marquer(etat, id, 'loading')
export const noterSante = (etat, id) => marquer(etat, id, 'alive')

export const verdict = (demarrage) => (demarrage.gui === 'alive' ? 'ok' : demarrage.gui === 'loading' ? 'echec' : 'neutre')

/**
 * Consecutive failed boots, newest first, neutral boots skipped, stopping at the
 * first ok. `exclure` leaves out the boot in progress (its verdict is not in yet).
 */
export const echecsConsecutifs = (etat, { exclure = null } = {}) => {
  const e = normaliser(etat)
  let n = 0
  for (const d of [...e.demarrages].reverse()) {
    if (d.id === exclure) continue
    const v = verdict(d)
    if (v === 'neutre') continue
    if (v === 'ok') break
    n += 1
  }
  return n
}

export const recommandation = (etat, { exclure = null, seuil = SEUIL_ECHECS } = {}) => {
  const e = normaliser(etat)
  if (e.safe.actif) return { mode: 'safe', echecs: 0, raison: 'safe mode is on' }
  const echecs = echecsConsecutifs(e, { exclure })
  if (echecs >= seuil) return { mode: 'safe-recommande', echecs, raison: `${echecs} consecutive boots ended without a working GUI` }
  return { mode: 'normal', echecs, raison: echecs === 0 ? 'ok' : `${echecs} failed boot(s), below the threshold of ${seuil}` }
}

/** Turn safe mode on. Keeps the FIRST saved list: calling it twice must not overwrite it with []. */
export const entrerSafe = (etat, { activesAvant, date }) => {
  const e = normaliser(etat)
  if (e.safe.actif) return e
  return { ...e, safe: { actif: true, depuis: date, activesAvant: Array.isArray(activesAvant) ? activesAvant.filter(estTexte) : [] } }
}

/** Turn safe mode off. Returns the new state AND the activation list to restore. */
export const sortirSafe = (etat) => {
  const e = normaliser(etat)
  const aRestaurer = e.safe.activesAvant
  return { etat: { ...e, demarrages: [], safe: { actif: false, depuis: null, activesAvant: [] } }, aRestaurer }
}
