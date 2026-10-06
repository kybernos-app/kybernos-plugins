// ── Suite panel, host half ──────────────────────────────────────────────────
// Pure logic with every side effect injected (file I/O, process spawn, clock), so
// test-suite-host.mjs can play it without DSH, a disk or a network.
//
//   · the catalogue ships inside this bundle (catalog.json) — the first launch works
//     offline; an online, signed catalogue is a later step;
//   · activation intent lives in ~/.dsh/kybernos/satellites-actives.json, the SAME
//     file the lifecycle robot reads, so a switch made here survives `install`;
//   · installing a module = the robot (`dsh-lifecycle.mjs`), which takes the safety
//     snapshot, links the bundle, checks the boot and rolls back on failure. This file
//     never edits the DSH profile itself.

import { archivePour, evaluer, TAILLE_MAX_DOC } from './catalogue-distant.mjs'

const NOM_MODULE = /^[a-z0-9][a-z0-9-]*$/

// Same rule as scripts/lifecycle-engine.mjs (activesResolues / desactivesAEcrire);
// test-suite-host.mjs checks the two copies agree. A bundle cannot import from scripts/
// because the packaged archive ships bundles one by one.
export function activesResolues ({ brut, satellites, socle }) {
  const liste = Array.isArray(brut) ? brut : Array.isArray(brut?.actives) ? brut.actives : null
  if (liste === null) return null
  const desactives = new Set(Array.isArray(brut?.desactives) ? brut.desactives : [])
  const parDefaut = satellites.filter((s) => s.defaut === 'actif' && !desactives.has(s.nom)).map((s) => s.nom)
  return [...new Set([...socle, ...liste, ...parDefaut])]
}

export function desactivesAEcrire ({ liste, satellites }) {
  const actifs = new Set(liste)
  return satellites.filter((s) => s.defaut === 'actif' && !actifs.has(s.nom)).map((s) => s.nom)
}

const parties = (catalogue) => ({
  socle: catalogue.modules.filter((m) => m.socle).map((m) => m.nom),
  satellites: catalogue.modules.filter((m) => !m.socle).map((m) => ({ nom: m.nom, defaut: m.defaut }))
})

/**
 * Which modules the activation file switches on. `null` = no file = everything is on.
 * @returns {{ file: boolean, actifs: string[] }}
 */
export function lireActivation ({ catalogue, brut }) {
  const { socle, satellites } = parties(catalogue)
  const liste = activesResolues({ brut, satellites, socle })
  if (liste === null) return { file: false, actifs: catalogue.modules.map((m) => m.nom) }
  return { file: true, actifs: liste }
}

/** The payload of GET /kybernos-hub/suite. `effectif` is the catalogue to show (the signed online one when there is one, else the shipped
 *  one); activation is always resolved against the SHIPPED catalogue, which decides what can be switched. `distant` says what the online
 *  catalogue amounts to (see etatDistant). */
export function charge ({ catalogue, brut, etatHub, effectif, distant }) {
  const act = lireActivation({ catalogue, brut })
  const actifs = new Set(act.actifs)
  const vu = effectif ?? { ...catalogue, source: 'embarque' }
  // The help of a module ships with the suite: the signed online catalogue carries the versions and the promises, and a module it
  // describes without a help keeps the one that shipped.
  const aides = new Map(catalogue.modules.filter((m) => m.aide !== undefined).map((m) => [m.id, m.aide]))
  return {
    ok: true,
    catalogue: { schema: vu.schema, familles: vu.familles, source: vu.source, suite: vu.suite ?? null },
    modules: vu.modules.map((m) => ({ ...m, ...(m.aide === undefined && aides.has(m.id) ? { aide: aides.get(m.id) } : {}), voulu: m.socle ? true : actifs.has(m.nom) })),
    activationFichier: act.file,
    hub: etatHub ?? null,
    distant: distant ?? null
  }
}

/** The platform key a release names its archives by. */
export const plateformeDe = (processPlatform) => (processPlatform === 'darwin' ? 'mac' : processPlatform === 'win32' ? 'windows' : 'linux')

/**
 * What the online catalogue amounts to, for the panel. `evaluation` = evaluer(...) of the cached release (or null), `cle` = a trusted key is
 * installed, `urlConfiguree`, `plateforme`, `racineDev` = this is a development checkout (a git working tree: it is updated with git).
 * `miseAJour.possible` is true only when an update can really be applied from here.
 */
export function etatDistant ({ evaluation, cle, urlConfiguree, plateforme, racineDev, derniere }) {
  const ok = evaluation !== null && evaluation !== undefined && evaluation.ok === true
  let raison = null
  if (!cle) raison = 'no-key'
  else if (!ok) raison = 'no-release'
  else if (!evaluation.plusRecent) raison = 'up-to-date'
  else if (archivePour(evaluation.doc, plateforme) === null) raison = 'no-archive-for-platform'
  else if (racineDev === true) raison = 'development-checkout'
  return {
    cle: Boolean(cle),
    urlConfiguree: Boolean(urlConfiguree),
    evaluation: evaluation === null || evaluation === undefined ? 'aucune' : (ok ? 'ok' : evaluation.erreur),
    suite: ok ? evaluation.doc.suite.version : null,
    publieLe: ok ? evaluation.doc.publieLe : null,
    plusRecent: ok && evaluation.plusRecent === true,
    miseAJour: { possible: raison === null, raison },
    derniere: derniere ?? null
  }
}

/**
 * Ask the online catalogue. Nothing is downloaded without a trusted key to check it with, and nothing reaches the cache unless it
 * verifies: a refused answer leaves the cache (and so the panel) exactly as it was.
 * `telecharger(url, { max })` resolves the bytes. @returns {{ ok, etat?, erreur?, suite?, publieLe? }}
 */
export async function rafraichir ({ url, cles, versionSuite, telecharger, ecrireCache }) {
  if (!Array.isArray(cles) || cles.length === 0) return { ok: false, erreur: 'pas-de-cle' }
  if (typeof url !== 'string' || !/^https:\/\/[^\s]+$/.test(url)) return { ok: false, erreur: 'url' }
  let octets
  let signature
  try {
    octets = await telecharger(url, { max: TAILLE_MAX_DOC })
    signature = (await telecharger(url + '.sig', { max: 1024 })).toString('utf8')
  } catch (e) { return { ok: false, erreur: 'reseau', detail: String(e?.message ?? e) } }
  const v = evaluer({ octets, signature, cles, versionSuite })
  if (!v.ok) return { ok: false, erreur: v.erreur, detail: v.detail }
  try { ecrireCache({ octets, signature }) } catch (e) { return { ok: false, erreur: 'cache', detail: String(e?.message ?? e) } }
  return { ok: true, etat: v.plusRecent ? 'nouveau' : 'a-jour', suite: v.doc.suite.version, publieLe: v.doc.publieLe }
}

/** The cached release, re-verified every time it is used (a cache file that was edited stops verifying). */
export function evaluerCache ({ lireCache, cles, versionSuite }) {
  let c = null
  try { c = lireCache() } catch (e) { c = null }
  if (c === null || c === undefined) return null
  return evaluer({ octets: c.octets, signature: c.signature, cles, versionSuite })
}

/**
 * Update the WHOLE suite from the verified release: download the archive for this platform, check its SHA-256 and size against the signed
 * document, extract it, then let the lifecycle robot that ships INSIDE the archive do the install (it checks the manifest of every file,
 * takes the safety snapshot, verifies the boot and rolls back on failure). DSH is not restarted here.
 * Everything with a side effect is injected. `progres(etat)` is told: telechargement | extraction | installation.
 * @returns {{ ok: boolean, error?: string, detail?: string, relanceRequise?: boolean, version?: string }}
 */
export async function mettreAJour ({ evaluation, plateforme, racineDev, telechargerVers, extraire, executer, nettoyer, progres }) {
  if (racineDev === true) return { ok: false, error: 'development-checkout' }
  if (evaluation === null || evaluation === undefined || evaluation.ok !== true || evaluation.plusRecent !== true) return { ok: false, error: 'nothing-to-update' }
  const archive = archivePour(evaluation.doc, plateforme)
  if (archive === null) return { ok: false, error: 'no-archive-for-platform' }
  try {
    progres('telechargement')
    const recu = await telechargerVers(archive.url, { max: archive.taille })
    if (recu.taille !== archive.taille || recu.sha256 !== archive.sha256) return { ok: false, error: 'digest-mismatch' }
    progres('extraction')
    const racine = await extraire(recu.fichier)
    progres('installation')
    const r = await executer(racine)
    if (r.code !== 0) return { ok: false, error: 'robot-refused', detail: String(r.sortie ?? '').split('\n').slice(-6).join('\n') }
    return { ok: true, relanceRequise: true, version: evaluation.doc.suite.version }
  } catch (e) {
    return { ok: false, error: String(e?.code ?? 'update-failed'), detail: String(e?.message ?? e) }
  } finally {
    try { await nettoyer() } catch (e) { /* a temp folder left behind is not worth failing for */ }
  }
}

const idConnu = (catalogue, id) => (typeof id === 'string' && NOM_MODULE.test(id)) ? (catalogue.modules.find((m) => m.id === id) ?? null) : null

/**
 * Switch a satellite on or off in the activation file. The socle cannot be switched.
 * @returns {{ ok: boolean, error?: string, ecrit?: object }}
 */
export function basculer ({ catalogue, brut, id, actif }) {
  const m = idConnu(catalogue, id)
  if (m === null) return { ok: false, error: 'unknown-module' }
  if (m.socle) return { ok: false, error: 'socle-cannot-be-switched' }
  const { socle, satellites } = parties(catalogue)
  const courant = activesResolues({ brut, satellites, socle }) ?? catalogue.modules.map((x) => x.nom)
  const cible = new Set(courant)
  if (actif === true) cible.add(m.nom); else cible.delete(m.nom)
  const liste = [...cible]
  return { ok: true, ecrit: { actives: liste, desactives: desactivesAEcrire({ liste, satellites }) } }
}

/**
 * Install = activate + run the robot. `executer(argv)` resolves { code, sortie }.
 * The robot never restarts DSH here (no --relancer): the panel shows "relaunch to apply".
 */
export async function installer ({ catalogue, brut, id, ecrire, executer }) {
  const m = idConnu(catalogue, id)
  if (m === null) return { ok: false, error: 'unknown-module' }
  if (!m.socle) {
    const b = basculer({ catalogue, brut, id, actif: true })
    if (!b.ok) return b
    try { ecrire(b.ecrit) } catch (e) { return { ok: false, error: 'activation-write-failed', detail: String(e?.message ?? e) } }
  }
  let r
  try { r = await executer(['install']) } catch (e) { return { ok: false, error: 'robot-failed', detail: String(e?.message ?? e) } }
  if (r.code !== 0) return { ok: false, error: 'robot-refused', detail: String(r.sortie ?? '').split('\n').slice(-6).join('\n') }
  return { ok: true, relanceRequise: true }
}
