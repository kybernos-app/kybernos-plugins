// Which packages this machine is MEANT to have in its profile, for the « To check » of the About page.
//
// The About page used to compare the profile with EVERY package of scripts/lifecycle-packages.json. A module the person switched off in the
// Suite (the robot then takes it out of `dsh.profile.bundles` and of the dependencies), or the connectors package that is loaded by name
// from the profile patch and is never a bundle, was reported as « Bundle X is not declared »: the About page said it was a problem and the
// Suite page said « Off » (audit 2026-10-16). A module that is OFF by choice is not a problem; one that is wanted and missing is.
//
// The rule is the robot's (scripts/lifecycle-engine.mjs, activesResolues): the activation file ~/.dsh/kybernos/satellites-actives.json lists
// the satellites that are on (no file: everything is on), the socle is always on, a satellite « actif par défaut » is on unless the file
// lists it in `desactives`, and a package the manifest does not manage stays on. A bundle cannot import from scripts/ (the packaged
// archive ships bundles one by one), so the few lines are repeated here; test-voulus.mjs checks the two agree.

/**
 * @param {{ noms: string[], manifeste: object|null, brut: any }} what
 *   noms: the packages of the lifecycle list; manifeste: docs/beta/satellites.json (null when unreadable); brut: the parsed activation file
 *   (null when there is none).
 * @returns {Set<string>} the names of the packages this machine is meant to have.
 */
export const nomsVoulus = ({ noms, manifeste, brut }) => {
  const liste = Array.isArray(brut) ? brut : (brut !== null && typeof brut === 'object' && Array.isArray(brut.actives) ? brut.actives : null)
  // No file, or no manifest to read the defaults from: everything is wanted, as the robot does.
  if (liste === null || manifeste === null || typeof manifeste !== 'object') return new Set(noms)
  const socle = (manifeste.socle?.bundles ?? []).map((b) => b.nom)
  const satellites = manifeste.satellites?.bundles ?? []
  const desactives = new Set(Array.isArray(brut?.desactives) ? brut.desactives : [])
  const geres = new Set([...socle, ...satellites.map((b) => b.nom)])
  const voulus = new Set([...socle, ...liste, ...satellites.filter((s) => s.defaut === 'actif' && !desactives.has(s.nom)).map((s) => s.nom)])
  for (const n of noms) if (!geres.has(n)) voulus.add(n)
  return voulus
}

/**
 * The Suite's own catalogue (packages/kybernos-hub/catalog.json: the modules, which are the socle, which are on by default) as the manifest
 * shape nomsVoulus reads. It is the list the Suite panel switches by, and it travels with the bundles, which docs/beta/satellites.json does not.
 */
export const manifesteDuCatalogue = (catalogue) => (catalogue !== null && typeof catalogue === 'object' && Array.isArray(catalogue.modules)
  ? {
      socle: { bundles: catalogue.modules.filter((m) => m.socle === true).map((m) => ({ nom: m.nom })) },
      satellites: { bundles: catalogue.modules.filter((m) => m.socle !== true).map((m) => ({ nom: m.nom, defaut: m.defaut })) },
    }
  : null)

/** A package is a DSH bundle (declared in `dsh.profile.bundles`) when its package.json carries `dsh.bundle`. */
export const estBundle = (pkg) => pkg !== null && typeof pkg === 'object' && pkg.dsh !== undefined && pkg.dsh !== null && pkg.dsh.bundle !== undefined && pkg.dsh.bundle !== null

/**
 * What the profile lacks of what it is meant to have: the packages not linked, and the bundles not declared (a package that is no bundle is
 * never « not declared »). `lirePackage(dir)` reads packages/<dir>/package.json (null when unreadable).
 */
export const manquants = ({ packages, voulus, deps, bundles, lirePackage }) => ({
  liens: packages.map((p) => p.nom).filter((n) => voulus.has(n) && !(deps[n] || '').startsWith('link:')),
  bundles: packages.filter((p) => voulus.has(p.nom) && estBundle(lirePackage(p.dir)) && !bundles.includes(p.nom)).map((p) => p.nom),
})
