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

/** The payload of GET /kybernos-hub/suite. */
export function charge ({ catalogue, brut, etatHub }) {
  const act = lireActivation({ catalogue, brut })
  const actifs = new Set(act.actifs)
  return {
    ok: true,
    catalogue: { schema: catalogue.schema, familles: catalogue.familles, source: 'embarque' },
    modules: catalogue.modules.map((m) => ({ ...m, voulu: m.socle ? true : actifs.has(m.nom) })),
    activationFichier: act.file,
    hub: etatHub ?? null
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
