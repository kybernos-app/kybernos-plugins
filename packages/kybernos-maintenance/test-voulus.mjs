#!/usr/bin/env node
// kybernos-maintenance — « To check » only for a real problem (audit 2026-10-16, A6-07). The About page compared the profile with every
// package of the lifecycle list: a module the person switched off in the Suite, or the connectors package that is loaded by name from the
// profile patch (it is no bundle), came out as « Bundle @local/x is not declared » while the Suite page said « Off ».
//
//   node packages/kybernos-maintenance/test-voulus.mjs
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { estBundle, manifesteDuCatalogue, manquants, nomsVoulus } from './voulus.mjs'
import * as moteur from '../../scripts/lifecycle-engine.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const ICI = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(ICI, '..', '..')
const json = (rel) => JSON.parse(readFileSync(join(REPO, rel), 'utf8'))
const PACKAGES = json('scripts/lifecycle-packages.json').packages
const catalogue = json('packages/kybernos-hub/catalog.json')
const manifeste = manifesteDuCatalogue(catalogue)
const noms = PACKAGES.map((p) => p.nom)
const nom = (dir) => PACKAGES.find((p) => p.dir === dir).nom
const lirePackage = (dir) => json('packages/' + dir + '/package.json')
const complet = () => ({ deps: Object.fromEntries(noms.map((n) => [n, 'link:/somewhere/' + n])), bundles: noms.filter((n) => estBundle(lirePackage(PACKAGES.find((p) => p.nom === n).dir))) })

console.log('what the machine is meant to have')
{
  const tout = nomsVoulus({ noms, manifeste, brut: null })
  check('no activation file: everything is wanted (as the robot does)', tout.size === noms.length)
  check('no manifest to read the defaults from: everything is wanted too', nomsVoulus({ noms, manifeste: null, brut: { actives: [] } }).size === noms.length)
  const sans = nomsVoulus({ noms, manifeste, brut: { actives: [], desactives: [nom('kybernos-slides')] } })
  check('a module switched off in the Suite is not wanted', !sans.has(nom('kybernos-slides')) && sans.has(nom('kybernos-hub')) && sans.has(nom('kybernos-plugin')))
  check('the socle is always wanted, whatever the file says', manifeste.socle.bundles.every((b) => nomsVoulus({ noms, manifeste, brut: { actives: [], desactives: noms } }).has(b.nom)))
  const listed = nomsVoulus({ noms, manifeste, brut: { actives: [nom('kybernos-slides')], desactives: [] } })
  check('a satellite the file lists is wanted', listed.has(nom('kybernos-slides')))
  check('a package the manifest does not manage stays wanted (the robot keeps it on)', nomsVoulus({ noms: noms.concat('@local/unmanaged'), manifeste, brut: { actives: [] } }).has('@local/unmanaged'))
  // The same answer as the robot's own rule (a bundle cannot import scripts/, so the few lines are repeated: this keeps them honest).
  const socle = manifeste.socle.bundles.map((b) => b.nom)
  const satellites = manifeste.satellites.bundles
  const cas = [{ actives: [] }, { actives: [nom('kybernos-auto')] }, { actives: [nom('kybernos-models')], desactives: [nom('kybernos-flow')] }, { actives: socle }, [nom('kybernos-slides')]]
  const pareil = cas.every((brut) => JSON.stringify([...nomsVoulus({ noms, manifeste, brut })].sort()) === JSON.stringify([...new Set(moteur.activesResolues({ brut, satellites, socle }))].sort()))
  check('it agrees with scripts/lifecycle-engine.mjs (activesResolues) on 5 shapes of file', pareil)
}

console.log('what is reported')
{
  const { deps, bundles } = complet()
  const lire = lirePackage
  const sain = manquants({ packages: PACKAGES, voulus: new Set(noms), deps, bundles, lirePackage: lire })
  check('a profile that has everything reports nothing', sain.liens.length === 0 && sain.bundles.length === 0, sain)

  // The audit's case: Slides switched off in the Suite. The robot took it out of the bundles and of the dependencies.
  const slides = nom('kybernos-slides')
  const sansSlides = { deps: Object.fromEntries(Object.entries(deps).filter(([k]) => k !== slides)), bundles: bundles.filter((b) => b !== slides) }
  const voulus = nomsVoulus({ noms, manifeste, brut: { actives: [], desactives: [slides] } })
  const ancien = manquants({ packages: PACKAGES, voulus: new Set(noms), ...sansSlides, lirePackage: lire })
  check('the old behaviour (every package is wanted) reported the switched-off module as a problem', ancien.bundles.includes(slides) && ancien.liens.includes(slides), ancien)
  const nouveau = manquants({ packages: PACKAGES, voulus, ...sansSlides, lirePackage: lire })
  check('now a module switched off by choice is not a problem', nouveau.bundles.length === 0 && nouveau.liens.length === 0, nouveau)

  // A wanted module that is missing is still a problem.
  const perdu = { deps, bundles: bundles.filter((b) => b !== nom('kybernos-hub')) }
  const reel = manquants({ packages: PACKAGES, voulus, ...perdu, lirePackage: lire })
  check('a wanted module that is missing from the bundles is reported', reel.bundles.join() === nom('kybernos-hub'), reel)
  const delie = { deps: { ...deps, [nom('kybernos-theme')]: '1.0.0' }, bundles }
  check('a wanted package that is no longer linked is reported', manquants({ packages: PACKAGES, voulus, ...delie, lirePackage: lire }).liens.join() === nom('kybernos-theme'))

  // The connectors package is loaded by name from the profile patch: it is never declared in dsh.profile.bundles.
  const maison = nom('dsh-subagent-maison')
  check('the connectors package declares no bundle (so it is never « not declared »)', estBundle(lirePackage('dsh-subagent-maison')) === false && PACKAGES.filter((p) => p.dir !== 'dsh-subagent-maison').every((p) => estBundle(lirePackage(p.dir))))
  const sansMaison = manquants({ packages: PACKAGES, voulus: new Set(noms), deps, bundles: bundles.filter((b) => b !== maison), lirePackage: lire })
  check('…whether or not the Workers page has turned it on', sansMaison.bundles.length === 0)
}

console.log('the host uses it')
{
  const host = readFileSync(join(ICI, 'index.js'), 'utf8')
  check('the profile is compared with what is wanted, not with every package', /manquants\(\{ packages: PACKAGES, voulus, deps, bundles, lirePackage/.test(host) && /nomsVoulus\(\{ noms: PACKAGES\.map/.test(host) && !/const bundlesManquants = PACKAGES\.map/.test(host))
  check('the activation file and the Suite\'s own catalogue are what it reads', /satellites-actives\.json/.test(host) && /kybernos-hub', 'catalog\.json'/.test(host))
}

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
