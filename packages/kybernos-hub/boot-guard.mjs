// ── Boot guard: pure logic (no I/O, no clock, no DSH import) ────────────────
//
// Goal: notice that DSH keeps starting with an unusable GUI and recommend safe
// mode (socle only) instead of leaving the user alone with a broken screen.
//
// How a boot is judged. The host records a boot at startup. The hub client then
// reports two things from the browser:
//   · "loading": the hub client script started (a GUI was served);
//   · "alive":   the page stayed up and visible for a few seconds afterwards.
// A third signal covers the failure that matters most. When a bundle fails to
// activate, DSH still serves a page — an error screen "Failed to load plugins"
// naming the bundles — and the hub client still runs on it. Reading that screen:
//   · "broken":  the client saw that screen and reports WHICH bundles failed.
// Measured on a real DSH 0.2.0-rc.2 with a sabotaged bundle: without this signal
// the hub reported "alive" on a broken page.
//
// So a boot is
//   · "ok"      → alive was reported;
//   · "failed"  → broken was reported, or loading was reported but alive never
//                 was (page abandoned early — a weaker heuristic);
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

const NOM_BUNDLE = /^@[a-z0-9._-]+\/[a-z0-9._-]+$/i
/** Bundle names reported by a browser are untrusted input: keep only well-formed ones, at most 8. */
export const nomsValides = (v) => (Array.isArray(v) ? [...new Set(v.filter((n) => typeof n === 'string' && n.length <= 80 && NOM_BUNDLE.test(n)))].slice(0, 8) : [])

/** Tolerant reader: anything unreadable becomes an empty state, never throws. */
export const normaliser = (brut) => {
  const vide = etatVide()
  if (brut === null || typeof brut !== 'object') return vide
  const demarrages = Array.isArray(brut.demarrages)
    ? brut.demarrages
      .filter((d) => d !== null && typeof d === 'object' && estTexte(d.id))
      .map((d) => ({ id: d.id, date: estTexte(d.date) ? d.date : null, gui: ['none', 'loading', 'alive', 'broken'].includes(d.gui) ? d.gui : 'none', echouees: nomsValides(d.echouees) }))
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
  return { ...e, demarrages: [...e.demarrages, { id, date, gui: 'none', echouees: [] }].slice(-MAX_HISTORIQUE) }
}

// A boot never goes back to a weaker state: alive and broken both stick against a late "loading".
// broken beats alive (a page can break after it looked fine); alive never overrides broken.
const marquer = (etat, id, gui) => {
  const e = normaliser(etat)
  return { ...e, demarrages: e.demarrages.map((d) => (d.id !== id ? d : { ...d, gui: d.gui === 'alive' || d.gui === 'broken' ? d.gui : gui })) }
}

export const noterChargement = (etat, id) => marquer(etat, id, 'loading')
export const noterSante = (etat, id) => marquer(etat, id, 'alive')

/** Report that the browser saw DSH's "failed to load plugins" screen, naming the bundles. */
export const noterCasse = (etat, id, entrees) => {
  const e = normaliser(etat)
  return { ...e, demarrages: e.demarrages.map((d) => (d.id !== id ? d : { ...d, gui: 'broken', echouees: nomsValides(entrees) })) }
}

export const verdict = (demarrage) => (demarrage.gui === 'alive' ? 'ok' : demarrage.gui === 'loading' || demarrage.gui === 'broken' ? 'echec' : 'neutre')

/** Bundles named in EVERY counted failed boot that named any: the likely culprits. */
const suspectsCommuns = (etat, exclure) => {
  const e = normaliser(etat)
  const listes = []
  for (const d of [...e.demarrages].reverse()) {
    if (d.id === exclure) continue
    const v = verdict(d)
    if (v === 'neutre') continue
    if (v === 'ok') break
    if (d.echouees.length > 0) listes.push(d.echouees)
  }
  if (listes.length === 0) return []
  return listes[0].filter((n) => listes.every((l) => l.includes(n)))
}

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
  if (e.safe.actif) return { mode: 'safe', echecs: 0, suspects: [], raison: 'safe mode is on' }
  const echecs = echecsConsecutifs(e, { exclure })
  const suspects = suspectsCommuns(e, exclure)
  if (echecs >= seuil) return { mode: 'safe-recommande', echecs, suspects, raison: `${echecs} consecutive boots ended without a working GUI` + (suspects.length > 0 ? ` (failing: ${suspects.join(', ')})` : '') }
  return { mode: 'normal', echecs, suspects, raison: echecs === 0 ? 'ok' : `${echecs} failed boot(s), below the threshold of ${seuil}` }
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
