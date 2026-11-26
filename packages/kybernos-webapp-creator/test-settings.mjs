// test-settings.mjs — the settings seam: defaults, strict values (a bad value refuses the whole
// patch), the key filter (unknown keys are dropped), and the shared settings.json left intact
// around our namespaced block.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REGLAGES_DEFAUT, ecrireReglages, lireReglages } from './index.js'

let echecs = 0
const check = (libelle, ok, detail) => {
  if (ok === true) { console.log('  \u2713 ' + libelle); return }
  echecs++
  console.log('  \u2717 ' + libelle + (detail !== undefined ? ' \u2014 ' + JSON.stringify(detail) : ''))
}

const racine = mkdtempSync(join(tmpdir(), 'kb-reglages-'))
const fichier = join(racine, 'settings.json')
try {
  console.log('defaults')
  const defauts = lireReglages(fichier)
  check('a missing file gives the defaults', defauts.deployTarget === 'computer' && defauts.linkPolicy === 'cle' && defauts.quotaMediaKo === 500, defauts)
  check('the defaults are the documented block', Object.keys(defauts).sort().join() === Object.keys(REGLAGES_DEFAUT).sort().join())

  console.log('strict writes')
  const r1 = ecrireReglages(fichier, { webappCreator: { deployTarget: 'fly', quotaProduits: 25 } })
  check('a valid patch persists', r1.ok === true && r1.reglages.deployTarget === 'fly' && r1.reglages.quotaProduits === 25, r1)
  writeFileSync(fichier, JSON.stringify({ autreBloc: { keep: true }, webappCreator: { deployTarget: 'fly', quotaProduits: 25 } }))
  const r2 = ecrireReglages(fichier, { webappCreator: { deployTarget: 'to the moon' } })
  check('an invalid value refuses the WHOLE patch', r2.ok === false && /deployTarget/.test(r2.error), r2)
  check('a refused patch writes nothing', JSON.parse(readFileSync(fichier, 'utf8')).webappCreator.deployTarget === 'fly')
  const r3 = ecrireReglages(fichier, { webappCreator: { sector: 'mode', evilKey: 'x' } })
  check('the filter drops unknown keys', r3.ok === true && r3.reglages.sector === 'mode' && Object.prototype.hasOwnProperty.call(r3.reglages, 'evilKey') === false, r3)
  check('the other blocks of the shared file survive', JSON.parse(readFileSync(fichier, 'utf8')).autreBloc.keep === true)
  check('an empty patch is refused', ecrireReglages(fichier, {}).ok === false)

  console.log('quota bounds')
  check('a zero quota is refused', ecrireReglages(fichier, { webappCreator: { quotaMediaKo: 0 } }).ok === false)
  check('a fractional quota is refused', ecrireReglages(fichier, { webappCreator: { quotaProduits: 2.5 } }).ok === false)
} finally {
  rmSync(racine, { recursive: true, force: true })
}

if (echecs > 0) { console.log('test-settings: ' + echecs + ' failure(s)'); process.exit(1) }
console.log('test-settings: all green')
